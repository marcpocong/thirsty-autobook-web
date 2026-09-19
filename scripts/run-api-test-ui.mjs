import { spawn } from 'node:child_process';
import electron from 'electron';
const env = { ...process.env, THIRSTY_API_TEST_INSTALLATION: '1', THIRSTY_NODE_EXEC: process.execPath };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['--remote-debugging-port=19446', 'dist/ui/main.js'], { env, stdio: 'inherit', windowsHide: false });
child.on('error', () => { console.error('API_TEST_ELECTRON_START_FAILED'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
