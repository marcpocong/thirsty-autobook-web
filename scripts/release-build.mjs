/**
 * The one canonical release build. Every step must pass before the next runs:
 *
 *   1. typecheck            tsc --noEmit (src, ui, tests, scripts)
 *   2. tests                the complete vitest suite (heavy browser suites run sequentially)
 *   3. UI/runtime build     clean ./dist (build-ui.mjs)
 *   4. dist verification    ./dist against a fresh compile of the source (verify-dist)
 *   5. packaging            build-app.mjs: staged, verified install dist swapped in (skipped with --no-package)
 *   6. build metadata       build-info.json in every dist + BUILD-INFO.txt + .local/build/last-release-build.json
 *
 * A dirty source tree is refused for packaging; updates require committed source.
 *
 * Usage: npm run release:build [-- --no-package]
 * The default packaging target is the installed app; close the app first.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gitInfo, sourceRoot, verifyDist } from './build-support.mjs';

const args = process.argv.slice(2);
const packageApp = !args.includes('--no-package');
if(args.some(arg=>arg!=='--no-package'))throw Error('RELEASE_BUILD_OPTIONS_REFUSED (canonical updates only; commit source first)');
const steps = [];
const run = (name, command, commandArgs) => {
  const started = Date.now();
  process.stdout.write(`\n=== ${name} ===\n`);
  try { execFileSync(command, commandArgs, { cwd: sourceRoot, stdio: 'inherit' }); }
  catch { steps.push({ name, ok: false, ms: Date.now() - started }); throw Error(`RELEASE_BUILD_STEP_FAILED ${name}`); }
  steps.push({ name, ok: true, ms: Date.now() - started });
};
const bin = name => resolve(sourceRoot, 'node_modules', name);
try {
  const git = gitInfo();
  if (packageApp && git.dirty !== false) throw Error('RELEASE_BUILD_DIRTY_TREE (commit source first)');
  run('typecheck', process.execPath, [bin('typescript/bin/tsc'), '--noEmit']);
  run('tests', process.execPath, [resolve(sourceRoot,'scripts/test-all.mjs')]);
  run('UI/runtime build', process.execPath, [resolve(sourceRoot, 'scripts/build-ui.mjs')]);
  process.stdout.write('\n=== dist verification ===\n');
  const verification = await verifyDist(join(sourceRoot, 'dist'));
  if (verification.problems.length) { for (const problem of verification.problems) console.error(`${problem.kind} ${problem.file}`); throw Error('RELEASE_BUILD_DIST_INCONSISTENT'); }
  steps.push({ name: 'dist verification', ok: true, files: verification.checkedFiles });
  if (packageApp) run('packaging', process.execPath, [resolve(sourceRoot, 'scripts/build-app.mjs')]);
  const info = JSON.parse(await readFile(join(sourceRoot, 'dist/build-info.json'), 'utf8'));
  const record = { finishedAt: new Date().toISOString(), buildId: info.buildId, gitSha: info.gitSha, dirty: info.dirty, packaged: packageApp,
    output: packageApp ? 'installation' : null, steps };
  await mkdir(join(sourceRoot, '.local/build'), { recursive: true });
  await writeFile(join(sourceRoot, '.local/build/last-release-build.json'), `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`\nRELEASE BUILD OK · ${info.buildId} · ${steps.map(step => step.name).join(' → ')}\n`);
} catch (error) {
  process.stderr.write(`\nRELEASE BUILD FAILED · ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
