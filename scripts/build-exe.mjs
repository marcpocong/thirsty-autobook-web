import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

if (process.platform !== 'win32') throw new Error('The launcher build requires Windows.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.env.SystemRoot;
if (!windows) throw new Error('Windows system directory is unavailable.');
const compiler = ['Framework64', 'Framework'].map(arch => resolve(windows, 'Microsoft.NET', arch, 'v4.0.30319/csc.exe')).find(existsSync);
if (!compiler) throw new Error('The Windows .NET Framework C# compiler was not found.');
const icon=resolve(root,'.local/build/thirsty-bot.ico');
execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve(root,'scripts/build-brand-assets.ps1'),'-Source',resolve(root,'assets/brand/thirsty-pickle-bot.png'),'-Icon',icon],{cwd:root,stdio:'inherit',windowsHide:true});
// Electron installs its binary lazily. Finish that during the build, before double-click launch.
const {default: electron} = await import('electron');
if (!existsSync(electron)) throw new Error('Electron runtime installation did not complete.');
execFileSync(compiler, ['/nologo', '/target:winexe', '/optimize+', `/win32icon:${icon}`, '/reference:System.Windows.Forms.dll', `/out:${resolve(root, 'Thirsty Bot.exe')}`, resolve(root, 'scripts/ThirstyLauncher.cs')], {cwd:root, stdio:'inherit', windowsHide:true});
mkdirSync(resolve(root, '.local'), {recursive:true});
writeFileSync(resolve(root, '.local/launcher-node.txt'), process.execPath + '\n');
console.log('Created Thirsty Bot.exe. Double-click it in the project folder; no terminal is needed.');
