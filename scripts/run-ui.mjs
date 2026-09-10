import { spawn } from 'node:child_process';
import electron from 'electron';
const env = { ...process.env, THIRSTY_NODE_EXEC: process.execPath };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['dist/ui/main.js'], { env, stdio: 'inherit', windowsHide: false });
child.on('error', () => { console.error('Unable to launch Electron. Run npm ci.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
