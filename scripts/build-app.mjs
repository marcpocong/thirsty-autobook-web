import { execFileSync } from 'node:child_process';
import { cp, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') throw Error('WINDOWS_BUILD_REQUIRED');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const parent = resolve(root, '..');
// Support both the legacy sibling source layout and the consolidated
// `Thirsty Pickle Bot/Source` layout without copying the repository into itself.
const output = existsSync(join(parent, 'Thirsty Pickle Bot.exe'))
  ? parent
  : resolve(parent, 'Thirsty Pickle Bot');
const updating=existsSync(output);
if(updating&&(!existsSync(join(output,'Thirsty Pickle Bot.exe'))||!existsSync(join(output,'.local/private'))))throw Error('APP_OUTPUT_UNRECOGNIZED');
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex').toUpperCase();
if(!updating)await mkdir(output, { recursive: false });
await mkdir(join(output, 'dist/ui/renderer'), { recursive: true });
await mkdir(join(output, 'dist/src/api-booking'), { recursive: true });
await mkdir(join(output, '.local/runtime'), { recursive: true });
// Compile directly into the separate installation; the production dist folder is untouched.
execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p',
  resolve(root, 'tsconfig.ui.json'), '--outDir', join(output, 'dist')], { cwd: root, stdio: 'inherit' });
await Promise.all(['src', 'ui', 'scripts'].map(name => cp(join(root, name), join(output, name), { recursive: true })));
await cp(join(root, 'node_modules'), join(output, 'node_modules'), { recursive: true });
await copyFile(join(root, 'package.json'), join(output, 'package.json'));
await copyFile(join(root, 'package-lock.json'), join(output, 'package-lock.json'));
await cp(join(root, 'assets/brand'), join(output, 'assets/brand'), { recursive: true });
for (const name of ['index.html', 'styles.css']) await copyFile(join(root, 'ui/renderer', name), join(output, 'dist/ui/renderer', name));
await copyFile(join(root, 'assets/brand/thirsty-pickle-bot.png'), join(output, 'dist/ui/renderer/thirsty-pickle-bot.png'));
await copyFile(join(root, 'src/api-booking/calendar-free-security-context-browser.js'),
  join(output, 'dist/src/api-booking/calendar-free-security-context-browser.js'));
const savedSetup = JSON.parse(await readFile(resolve(updating?output:root, 'config.local.json'), 'utf8'));
await writeFile(join(output, 'config.local.json'), JSON.stringify({ ...savedSetup, BOOKING_METHOD: 'api-first' }, null, 2) + '\n');
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
  `Thirsty Pickle Bot self-contained installation\nBuilt: ${new Date().toISOString()}\nLauncher SHA256: ${appHash}\n`+
  'API-first is the primary booking method. Payment remains manual. This folder includes its own Node and Electron runtime and requires installed Chrome.\n');
await mkdir(join(output, '.local/private'), { recursive: true });
if(!existsSync(join(output,'.local/private/.env.example')))await copyFile(join(root, '.env.example'), join(output, '.local/private/.env.example'));
console.log(JSON.stringify({ output, exe: join(output, 'Thirsty Pickle Bot.exe'), sha256:appHash }));
