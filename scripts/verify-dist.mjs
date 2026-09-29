/**
 * Source-vs-dist consistency check. Compiles the current source and compares it with a dist, file by file.
 * Exits 1 on any stale, missing or orphaned module, or (with --expect-head) when the dist's build-info
 * does not name the current git HEAD.
 *
 * Usage: node scripts/verify-dist.mjs [--dist <dir>] [--expect-head]
 *   default --dist is ./dist; to check the installed app:  node scripts/verify-dist.mjs --dist "../dist"
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BUILD_INFO_FILE, gitInfo, sourceRoot, verifyDist } from './build-support.mjs';

const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };
const distDir = resolve(sourceRoot, option('dist') ?? 'dist');
if (!existsSync(distDir)) { console.error(`DIST_MISSING ${distDir}`); process.exit(1); }
const result = await verifyDist(distDir);
for (const problem of result.problems.slice(0, 50)) console.log(`${problem.kind.toUpperCase().padEnd(7)} ${problem.file}`);
if (result.problems.length > 50) console.log(`... and ${result.problems.length - 50} more`);
let headProblem = null;
if (args.includes('--expect-head')) {
  const infoPath = join(distDir, BUILD_INFO_FILE);
  const info = existsSync(infoPath) ? JSON.parse(readFileSync(infoPath, 'utf8')) : null;
  const head = gitInfo().gitSha;
  if (!info) headProblem = 'build-info.json missing';
  else if (info.gitSha !== head) headProblem = `build-info names ${info.gitSha}, HEAD is ${head}`;
  if (headProblem) console.log(`HEAD    ${headProblem}`);
}
const ok = !result.problems.length && !headProblem;
console.log(`${ok ? 'DIST CONSISTENT' : 'DIST INCONSISTENT'} · ${result.checkedFiles} compiled files checked · ${result.problems.length} problem(s) · ${distDir}`);
process.exitCode = ok ? 0 : 1;
