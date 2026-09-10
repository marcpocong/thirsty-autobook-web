import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { UiEventSchema, type UiEvent } from '../src/ui-events.js';
import type { Command } from './types.js';

export interface RunningCommand { pid: number | undefined; done: Promise<number>; stop(): Promise<void> }
export type Runner = (command: Command, onEvent: (event: UiEvent) => void, onLine: (line: string, error: boolean) => void) => RunningCommand;
export function sanitizeLine(text: string): string {
  return text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    .replace(/(?:gh[pousr]_|github_pat_|sk-)[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email redacted]')
    .replace(/\+?\d[\d ()-]{8,}\d/g, '[number redacted]')
    .replace(/((?:PLAYER_[A-Z_]+|cookie|token|password|authorization)\s*[=:]\s*).*/gi, '$1[redacted]').slice(0, 500);
}
export function commandSpec(command: Command, root: string, node: string) {
  switch (command) {
    case 'chrome': return { executable: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve(root, 'scripts/start-onda-chrome.ps1')], automation: false };
    case 'inspect': return { executable: node, args: ['--import', 'tsx', resolve(root, 'src/index.ts'), 'inspect'], automation: true };
    case 'observe': return { executable: node, args: ['--import', 'tsx', resolve(root, 'src/index.ts'), 'release:observe', '--armed'], automation: true };
    default: throw new Error('COMMAND_NOT_ALLOWED');
  }
}
export function createRunner(root: string, node: string): Runner {
  return (command, onEvent, onLine) => {
    const spec = commandSpec(command, root, node);
    const env: NodeJS.ProcessEnv = { ...process.env, THIRSTY_UI_EVENTS: '1', THIRSTY_UI_PARENT_PID: String(process.pid) };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(spec.executable, spec.args, { cwd: root, env, windowsHide: true, shell: false,
      stdio: spec.automation ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'] });
    let ended = false;
    const done = new Promise<number>(resolveDone => {
      child.once('error', () => { onLine('PROCESS_START_FAILED', true); });
      child.once('close', code => { ended = true; resolveDone(code ?? 1); });
    });
    for (const [stream, isError] of [[child.stdout, false], [child.stderr, true]] as const) {
      let buffer = '';
      const consume = (line: string) => {
        if (line.startsWith('THIRSTY_EVENT ')) {
          try { const event = UiEventSchema.safeParse(JSON.parse(line.slice(14))); if (event.success) { onEvent(event.data); return; } } catch {}
          onLine('Unrecognized structured event omitted.', true); return;
        }
        // The CLI's pretty JSON is represented by validated structured events.
        // Keep human stdout/stderr, avoiding braces/field fragments in the log.
        if (!isError && /^(?:[{}\[\],]+|"[^"]+"\s*:.*)$/.test(line.trim())) return;
        const safe = sanitizeLine(line.trim()); if (safe) onLine(safe, isError);
      };
      stream?.setEncoding('utf8');
      stream?.on('data', (chunk: string) => {
        buffer += chunk;
        if (buffer.length > 65536) { buffer = ''; onLine('Oversized output omitted.', true); return; }
        let i: number; while ((i = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, i).replace(/\r$/, '')); buffer = buffer.slice(i + 1); }
      });
      stream?.on('end', () => { if (buffer) consume(buffer); });
    }
    let stopping: Promise<void> | undefined;
    return { pid: child.pid, done, stop: () => stopping ??= (async () => {
      if (ended) return;
      if (spec.automation && child.connected) child.send({ type: 'abort' }, () => {});
      // Single Node owns Playwright. Give its shared abort path 350 ms to exit,
      // then kill only that known automation tree. It ATTACHES to Chrome and
      // never launches Chrome. Never use /T on the Chrome launcher process.
      await Promise.race([done, new Promise<void>(r => setTimeout(r, 350))]);
      if (!ended) {
        if (spec.automation && process.platform === 'win32' && child.pid) await killAutomationTree(child);
        else child.kill('SIGKILL');
      }
      await Promise.race([done, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('STOP_NOT_CONFIRMED')), 3000); timer.unref(); })]);
    })() };
  };
}
async function killAutomationTree(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return;
  await new Promise<void>(resolveDone => {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
    killer.once('error', () => resolveDone()); killer.once('exit', () => resolveDone());
  });
}
