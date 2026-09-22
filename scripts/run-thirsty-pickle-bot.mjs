import { spawn } from 'node:child_process';
import electron from 'electron';
const env = { ...process.env, THIRSTY_API_INSTALLATION: '1', THIRSTY_NODE_EXEC: process.execPath };
delete env.ELECTRON_RUN_AS_NODE;
// Keep panel diagnostics away from the dedicated booking Chrome ports (19444–19451).
const child = spawn(electron, ['--remote-debugging-port=19500', 'dist/ui/main.js'], { env, stdio: 'inherit', windowsHide: false });
child.on('error', () => { console.error('THIRSTY_PICKLE_BOT_START_FAILED'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
