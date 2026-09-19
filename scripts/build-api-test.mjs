import { execFileSync } from 'node:child_process';
import { cp, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') throw Error('WINDOWS_BUILD_REQUIRED');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '..', 'Thirsty Bot API Test');
if (existsSync(output)) throw Error('API_TEST_OUTPUT_ALREADY_EXISTS');
const productionExe = resolve(root, 'Thirsty Bot.exe');
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex').toUpperCase();
const before = await hash(productionExe);
await mkdir(output, { recursive: false });
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
const savedSetup = JSON.parse(await readFile(resolve(root, 'config.local.json'), 'utf8'));
await writeFile(join(output, 'config.local.json'), JSON.stringify({ ...savedSetup, BOOKING_METHOD: 'browser' }, null, 2) + '\n');
await copyFile(process.execPath, join(output, '.local/runtime/node.exe'));
const windows = process.env.SystemRoot;
if (!windows) throw Error('WINDOWS_SYSTEM_ROOT_MISSING');
const compiler = ['Framework64', 'Framework'].map(arch => resolve(windows, 'Microsoft.NET', arch, 'v4.0.30319/csc.exe')).find(existsSync);
if (!compiler) throw Error('CSC_NOT_FOUND');
const icon = join(output, '.local/api-test.ico');
execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
  resolve(root, 'scripts/build-brand-assets.ps1'), '-Source', resolve(root, 'assets/brand/thirsty-pickle-bot.png'),
  '-Icon', icon], { cwd: root, stdio: 'inherit', windowsHide: true });
execFileSync(compiler, ['/nologo', '/target:winexe', '/optimize+', `/win32icon:${icon}`,
  '/reference:System.Windows.Forms.dll', `/out:${join(output, 'Thirsty Bot API Test.exe')}`,
  resolve(root, 'scripts/ApiTestLauncher.cs')], { cwd: root, stdio: 'inherit', windowsHide: true });
const after = await hash(productionExe);
if (after !== before) throw Error('PRODUCTION_EXE_HASH_CHANGED');
await writeFile(join(output, 'BUILD-INFO.txt'),
  `API Test folder installation\nBuilt: ${new Date().toISOString()}\nProduction EXE SHA256 before: ${before}\nProduction EXE SHA256 after: ${after}\n`+
  'This folder includes its own Node and Electron runtime. It needs installed Chrome. Add local player/customer configuration privately before live use.\n');
await mkdir(join(output, '.local/private'), { recursive: true });
await copyFile(join(root, '.env.example'), join(output, '.local/private/.env.example'));
console.log(JSON.stringify({ output, exe: join(output, 'Thirsty Bot API Test.exe'), productionSha256: after }));
