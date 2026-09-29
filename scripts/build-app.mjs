import { execFileSync } from 'node:child_process';
import { cp, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, copyAssets, removeGenerated, verifyDist, writeBuildInfo } from './build-support.mjs';

if (process.platform !== 'win32') throw Error('WINDOWS_BUILD_REQUIRED');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const parent = resolve(root, '..');
const args = process.argv.slice(2);
const outputOption = args.includes('--output') ? args[args.indexOf('--output') + 1] : undefined;
// Support both the legacy sibling source layout and the consolidated
// `Thirsty Pickle Bot/Source` layout without copying the repository into itself.
// --output <dir> packages into another folder instead (for example a scratch folder to verify packaging).
const output = outputOption ? resolve(outputOption) : existsSync(join(parent, 'Thirsty Pickle Bot.exe'))
  ? parent
  : resolve(parent, 'Thirsty Pickle Bot');
if (output === root) throw Error('APP_OUTPUT_IS_SOURCE');
const updating=existsSync(output);
if(updating&&!outputOption&&(!existsSync(join(output,'Thirsty Pickle Bot.exe'))||!existsSync(join(output,'.local/private'))))throw Error('APP_OUTPUT_UNRECOGNIZED');
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex').toUpperCase();
if(!updating)await mkdir(output, { recursive: true });
await mkdir(join(output, '.local/runtime'), { recursive: true });
// Clean, verified runtime: compile into dist.staging (same depth as dist, so source maps stay valid after the swap),
// verify it against a fresh compile of the current source, then swap it in. The previous dist is kept as
// .local/build/dist.previous for one rebuild. No stale or orphaned module can survive a rebuild.
const staging = join(output, 'dist.staging'), live = join(output, 'dist');
await removeGenerated(staging);
compile(staging, root);
await copyAssets(staging, root);
const buildInfo = await writeBuildInfo(staging, { root, kind: 'installation' });
const verification = await verifyDist(staging, { root });
if (verification.problems.length) {
  for (const problem of verification.problems.slice(0, 20)) console.error(`${problem.kind.toUpperCase()} ${problem.file}`);
  throw Error('PACKAGED_DIST_INCONSISTENT');
}
await Promise.all(['src', 'ui', 'scripts'].map(name => cp(join(root, name), join(output, name), { recursive: true })));
await cp(join(root, 'node_modules'), join(output, 'node_modules'), { recursive: true });
await copyFile(join(root, 'package.json'), join(output, 'package.json'));
await copyFile(join(root, 'package-lock.json'), join(output, 'package-lock.json'));
await cp(join(root, 'assets/brand'), join(output, 'assets/brand'), { recursive: true });
const previous = join(output, '.local/build/dist.previous');
if (existsSync(live)) {
  await mkdir(join(output, '.local/build'), { recursive: true });
  await removeGenerated(previous);
  await rename(live, previous);
}
await rename(staging, live);
const savedSetup = JSON.parse(await readFile(resolve(updating&&existsSync(join(output,'config.local.json'))?output:root, 'config.local.json'), 'utf8'));
const {MAX_PRICE: _legacyPriceLimit, ...savedSetupWithoutPriceLimit}=savedSetup;
// Keep the operator's saved method (Proofless or API-first); only an unsupported/missing method falls back to API-first.
const savedMethod=['api-first','proofless'].includes(savedSetup.BOOKING_METHOD)?savedSetup.BOOKING_METHOD:'api-first';
await writeFile(join(output, 'config.local.json'), JSON.stringify({ ...savedSetupWithoutPriceLimit, BOOKING_METHOD: savedMethod }, null, 2) + '\n');
if(!existsSync(join(output,'.local/runtime/node.exe')))await copyFile(process.execPath, join(output, '.local/runtime/node.exe'));
const windows = process.env.SystemRoot;
if (!windows) throw Error('WINDOWS_SYSTEM_ROOT_MISSING');
const compiler = ['Framework64', 'Framework'].map(arch => resolve(windows, 'Microsoft.NET', arch, 'v4.0.30319/csc.exe')).find(existsSync);
if (!compiler) throw Error('CSC_NOT_FOUND');
const icon = join(output, '.local/thirsty-pickle-bot.ico');
execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
  resolve(root, 'scripts/build-brand-assets.ps1'), '-Source', resolve(root, 'assets/brand/thirsty-pickle-bot.png'),
  '-Icon', icon], { cwd: root, stdio: 'inherit', windowsHide: true });
execFileSync(compiler, ['/nologo', '/target:winexe', '/optimize+', `/win32icon:${icon}`,
  '/reference:System.Windows.Forms.dll', `/out:${join(output, 'Thirsty Pickle Bot.exe')}`,
  resolve(root, 'scripts/ThirstyPickleBotLauncher.cs')], { cwd: root, stdio: 'inherit', windowsHide: true });
const appHash=await hash(join(output,'Thirsty Pickle Bot.exe'));
await writeFile(join(output, 'BUILD-INFO.txt'),
  `Thirsty Pickle Bot self-contained installation\nBuilt: ${buildInfo.builtAt}\nSource Commit: ${buildInfo.gitSha}\nBranch: ${buildInfo.branch}\nDirty: ${buildInfo.dirty===null?'unknown':buildInfo.dirty?'yes':'no'}\n`+
  `Build ID: ${buildInfo.buildId}\nDist Content ID: ${buildInfo.contentId}\nDist Verified: yes (${verification.checkedFiles} files against a fresh compile of the source)\nLauncher SHA256: ${appHash}\n`+
  'API-first is the primary booking method. Payment remains manual. This folder includes its own Node and Electron runtime and requires installed Chrome.\n');
await mkdir(join(output, '.local/private'), { recursive: true });
if(!existsSync(join(output,'.local/private/.env.example')))await copyFile(join(root, '.env.example'), join(output, '.local/private/.env.example'));
console.log(JSON.stringify({ output, exe: join(output, 'Thirsty Pickle Bot.exe'), sha256:appHash, buildId: buildInfo.buildId, gitSha: buildInfo.gitSha, dirty: buildInfo.dirty }));
