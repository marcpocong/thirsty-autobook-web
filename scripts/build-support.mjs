/**
 * Shared build helpers: clean compile, asset copy, build provenance and source-vs-dist verification.
 *
 * Generated output is never trusted blindly. `verifyDist` compiles the current source into a sibling
 * directory at the same depth (so source maps are comparable byte for byte) and compares every file:
 * a stale, missing or orphaned module in the dist fails the check.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BUILD_INFO_FILE = 'build-info.json';
/** Files a dist legitimately contains that tsc does not produce. */
export const COPIED_ASSETS = Object.freeze([
  'ui/renderer/index.html', 'ui/renderer/styles.css', 'ui/renderer/thirsty-pickle-bot.png',
  'src/api-booking/calendar-free-security-context-browser.js', BUILD_INFO_FILE,
]);

const posix = path => path.split(sep).join('/');
async function walk(directory, base = directory) {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path, base) : Promise.resolve([posix(relative(base, path))]);
  }));
  return files.flat().sort();
}

/** Compiles tsconfig.ui.json (src + ui) into `outDir`. Throws on any type error. */
export function compile(outDir, root = sourceRoot) {
  execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', resolve(root, 'tsconfig.ui.json'), '--outDir', outDir],
    { cwd: root, stdio: 'inherit' });
}

/** Copies the renderer assets and the page-injected browser script next to the compiled output. */
export async function copyAssets(outDir, root = sourceRoot) {
  await mkdir(join(outDir, 'ui/renderer'), { recursive: true });
  await mkdir(join(outDir, 'src/api-booking'), { recursive: true });
  for (const name of ['index.html', 'styles.css']) await copyFile(join(root, 'ui/renderer', name), join(outDir, 'ui/renderer', name));
  await copyFile(join(root, 'assets/brand/thirsty-pickle-bot.png'), join(outDir, 'ui/renderer/thirsty-pickle-bot.png'));
  await copyFile(join(root, 'src/api-booking/calendar-free-security-context-browser.js'), join(outDir, 'src/api-booking/calendar-free-security-context-browser.js'));
}

/** Git provenance of the source tree ('unknown' outside a repository). */
export function gitInfo(root = sourceRoot) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    // Tracked changes anywhere, or untracked files where tsc would compile them, make the build dirty.
    const changes = git(['status', '--porcelain', '--untracked-files=all', '--', '.']).split('\n').filter(Boolean)
      .filter(line => !line.startsWith('??') || /^\?\? (src|ui)\//.test(line));
    return { gitSha: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']) || 'detached', dirty: changes.length > 0 };
  } catch { return { gitSha: 'unknown', branch: 'unknown', dirty: null }; }
}

/** Content ID of a dist: SHA-256 over every runtime file's path and bytes (source maps and build-info excluded). */
export async function distContentId(distDir) {
  const hash = createHash('sha256');
  for (const file of await walk(distDir)) {
    if (file === BUILD_INFO_FILE || file.endsWith('.map')) continue;
    hash.update(file).update('\0').update(await readFile(join(distDir, file))).update('\0');
  }
  return hash.digest('hex');
}

/** Writes dist/build-info.json: git SHA, dirty state, build time and the dist content ID. */
export async function writeBuildInfo(distDir, { root = sourceRoot, kind = 'source-build', now = new Date() } = {}) {
  const git = gitInfo(root);
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const contentId = await distContentId(distDir);
  const info = { schema: 'thirsty-build-info/v1', kind, ...git, builtAt: now.toISOString(), packageVersion: pkg.version,
    node: process.version, contentId, buildId: `${git.gitSha.slice(0, 7)}${git.dirty ? '+dirty' : ''}-${contentId.slice(0, 10)}` };
  await writeFile(join(distDir, BUILD_INFO_FILE), `${JSON.stringify(info, null, 2)}\n`);
  return info;
}

/** Removes a generated directory (only ever called on dist/staging/verify output directories). */
export async function removeGenerated(directory) {
  const name = directory.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
  if (!/^dist(?:\.[a-z-]+)?$/.test(name)) throw Error(`REFUSING_TO_REMOVE_NON_DIST_DIRECTORY ${directory}`);
  await rm(directory, { recursive: true, force: true });
}

/**
 * Compares `distDir` with a fresh compile of the current source. Returns the differences; empty means consistent.
 * Categories: stale (content differs), missing (source module not in dist), orphan (dist module with no source).
 */
export async function verifyDist(distDir, { root = sourceRoot, keepFresh = false } = {}) {
  // The fresh compile always lives in the source tree, never next to an installed app. Source maps embed the
  // path from the map to the source, so they are compared only when the dist is also a direct child of the source root.
  const fresh = join(root, 'dist.verify');
  const compareMaps = resolve(dirname(resolve(distDir))) === resolve(root);
  await removeGenerated(fresh);
  compile(fresh, root);
  await copyAssets(fresh, root);
  try { return { distDir, ...await compareTrees(fresh, distDir, { compareMaps }) }; }
  finally { if (!keepFresh) await removeGenerated(fresh); }
}

/** File-by-file comparison of an expected (fresh) tree with an actual dist. Pure apart from reading files. */
export async function compareTrees(freshDir, distDir, { compareMaps = true } = {}) {
  const expected = (await walk(freshDir)).filter(file => compareMaps || !file.endsWith('.map')), actual = new Set(await walk(distDir));
  const problems = [];
  for (const file of expected) {
    if (!actual.has(file)) { problems.push({ kind: 'missing', file }); continue; }
    const [a, b] = await Promise.all([readFile(join(freshDir, file)), readFile(join(distDir, file))]);
    if (!a.equals(b)) problems.push({ kind: 'stale', file });
  }
  const produced = new Set(expected);
  for (const file of actual) if (!produced.has(file) && !COPIED_ASSETS.includes(file) && (compareMaps || !file.endsWith('.map')))
    problems.push({ kind: 'orphan', file });
  return { checkedFiles: expected.length, mapsCompared: compareMaps, problems };
}

export async function isDirectory(path) { try { return (await stat(path)).isDirectory(); } catch { return false; } }
