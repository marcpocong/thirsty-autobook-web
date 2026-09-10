import { describe, it, expect, vi } from 'vitest';
import { DateTime } from 'luxon';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { Controller } from '../ui/controller.js';
import { commandSpec, createRunner, sanitizeLine, type Runner } from '../ui/processes.js';
import { clockStatus, readLock } from '../ui/status.js';
import { ObservationSchema } from '../src/config.js';
import type { Command } from '../ui/types.js';

const settings = ObservationSchema.parse({});
const clock = () => clockStatus(settings, DateTime.fromISO('2026-09-10T07:00:00+08:00'));
function harness(confirmed = true) {
  const calls: Command[] = []; let lock = false;
  let finish: (code: number) => void = () => {};
  const stop = vi.fn(async () => { finish(130); });
  const runner: Runner = (command, onEvent) => {
    calls.push(command);
    if (command === 'inspect') onEvent({ type: 'inspection', date: '2026-09-10', gridToday: true, selected: 0, allCourts: true, visible: true, verifiedAt: new Date().toISOString() });
    return { pid: 123, done: command === 'observe' ? new Promise<number>(resolveDone => { finish = resolveDone; }) : Promise.resolve(0), stop };
  };
  const confirm = vi.fn(async () => confirmed);
  const controller = new Controller({ runner, lock: async () => lock, cdp: async () => true, clock, confirm, publish: () => {} });
  return { controller, calls, confirm, stop, setLock: (value: boolean) => { lock = value; } };
}
describe('desktop orchestration', () => {
  it('Prepare only starts Chrome and inspects; never arms or books', async () => {
    const h = harness(); await h.controller.prepare();
    expect(h.calls).toEqual(['chrome', 'inspect']); expect(h.controller.state.ready).toBe(true); expect(h.confirm).not.toHaveBeenCalled();
  });
  it('requires explicit confirmation before creating any observer', async () => {
    const h = harness(false); await h.controller.armObservation(); expect(h.confirm).toHaveBeenCalledOnce(); expect(h.calls).toEqual([]);
  });
  it('enforces one observer and stops its process, not Chrome', async () => {
    const h = harness(); const run = h.controller.armObservation();
    await vi.waitFor(() => expect(h.calls).toEqual(['observe']));
    await expect(h.controller.armObservation()).rejects.toThrow('ALREADY_RUNNING');
    await expect(h.controller.prepare()).rejects.toThrow('ALREADY_RUNNING');
    await h.controller.abortAutomation(); await run;
    expect(h.stop).toHaveBeenCalledOnce(); expect(h.calls).toEqual(['observe']); expect(h.controller.state.operation).toBe('idle');
    expect(h.controller.state.headline).toBe('Automation aborted');
  });
  it('never launches when a lock exists', async () => {
    const h = harness(); h.setLock(true); await h.controller.prepare(); await h.controller.armObservation();
    expect(h.calls).toEqual([]); expect(h.confirm).not.toHaveBeenCalled(); expect(h.controller.state.ready).toBe(false);
  });
  it('rejects arbitrary commands and never maps live race', () => {
    for (const command of ['race', 'practice', 'powershell -Command anything', '../src/index.ts']) expect(() => commandSpec(command as Command, process.cwd(), process.execPath)).toThrow('COMMAND_NOT_ALLOWED');
    expect(commandSpec('observe', process.cwd(), process.execPath).args.slice(-2)).toEqual(['release:observe', '--armed']);
    expect(commandSpec('inspect', process.cwd(), process.execPath).args).not.toContain('--armed');
  });
  it('keeps live race disabled with no preload bridge to it', async () => {
    const html = await readFile('ui/renderer/index.html', 'utf8');
    expect(html).toMatch(/<button disabled[^>]*>LOCKED \/ NOT READY<\/button>/);
    expect(harness().controller.state.liveRace).toBe(false);
    const preload = await readFile('ui/preload.cts', 'utf8');
    expect(preload).not.toMatch(/exec|spawn|race|shell|readFile/);
  });
  it('redacts sensitive output before it reaches renderer', () => {
    const line = sanitizeLine('person@example.com +639123456789 Bearer abcdef token=secret');
    expect(line).not.toContain('person@'); expect(line).not.toContain('639123'); expect(line).not.toContain('abcdef'); expect(line).not.toContain('secret');
  });
  it('calculates Manila clock, next countdown and calendar target using existing rules', () => {
    const before = clockStatus(settings, DateTime.fromISO('2026-09-10T07:59:00+08:00'));
    expect(before.manilaTime).toBe('07:59:00'); expect(before.remainingMs).toBe(60000); expect(before.targetDate).toBe('2026-09-12'); expect(before.canArmToday).toBe(true);
    const after = clockStatus(settings, DateTime.fromISO('2026-12-31T09:00:00+08:00'));
    expect(after.targetDate).toBe('2027-01-03'); expect(after.canArmToday).toBe(false); expect(after.remainingMs).toBe(23 * 3600000);
  });
  it('lock detection is read-only, including malformed stale locks', async () => {
    await mkdir('.local', { recursive: true }); const root = await mkdtemp(resolve('.local/ui-lock-test-'));
    try {
      expect(await readLock(root)).toBe(false); await mkdir(resolve(root, '.local'));
      const path = resolve(root, '.local/automation.lock'); await writeFile(path, 'invalid-but-preserved');
      expect(await readLock(root)).toBe(true); expect(await readFile(path, 'utf8')).toBe('invalid-but-preserved');
    } finally { if (!root.startsWith(resolve('.local') + sep)) throw Error('UNSAFE_TEST_PATH'); await rm(root, { recursive: true, force: true }); }
  });
});
describe('actual Node process ownership', () => {
  it('IPC abort exits the direct worker without an npm/tsx process chain', async () => {
    await mkdir('.local', { recursive: true }); const root = await mkdtemp(resolve('.local/ui-worker-test-'));
    try {
      await mkdir(resolve(root, 'src'));
      await writeFile(resolve(root, 'src/index.ts'), "process.on('message', m => { if ((m as {type:string}).type === 'abort') process.exit(130); }); console.log('WORKER_READY'); setInterval(() => {}, 1000);");
      let ready!: () => void; const started = new Promise<void>(r => { ready = r; });
      const worker = createRunner(root, process.execPath)('observe', () => {}, line => { if (line === 'WORKER_READY') ready(); });
      await started; expect(worker.pid).toBeTypeOf('number'); await worker.stop(); expect(await worker.done).toBe(130);
      expect(() => process.kill(worker.pid!, 0)).toThrow();
    } finally { if (!root.startsWith(resolve('.local') + sep)) throw Error('UNSAFE_TEST_PATH'); await rm(root, { recursive: true, force: true }); }
  });
  it.skipIf(process.platform !== 'win32')('Windows fallback kills a blocked automation tree and leaves an unrelated process alive', async () => {
    const { spawn } = await import('node:child_process');
    await mkdir('.local', { recursive: true }); const root = await mkdtemp(resolve('.local/ui-tree-test-'));
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
    try {
      await mkdir(resolve(root, 'src'));
      await writeFile(resolve(root, 'src/index.ts'), "import {spawn} from 'node:child_process'; const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'}); console.log('DESCENDANT '+child.pid); while(true){};");
      let ready!: (pid: number) => void; const descendant = new Promise<number>(r => { ready = r; });
      const worker = createRunner(root, process.execPath)('observe', () => {}, line => { if (line.startsWith('DESCENDANT ')) ready(Number(line.slice(11))); });
      const pid = await descendant; await worker.stop(); await worker.done;
      expect(() => process.kill(worker.pid!, 0)).toThrow(); expect(() => process.kill(pid, 0)).toThrow();
      expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
    } finally {
      unrelated.kill(); if (!root.startsWith(resolve('.local') + sep)) throw Error('UNSAFE_TEST_PATH'); await rm(root, { recursive: true, force: true });
    }
  });
});
