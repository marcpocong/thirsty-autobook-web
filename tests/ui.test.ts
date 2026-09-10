import { describe, it, expect, vi } from 'vitest';
import { DateTime } from 'luxon';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { Controller } from '../ui/controller.js';
import { commandSpec, createRunner, sanitizeLine, type Runner } from '../ui/processes.js';
import { clockStatus, readLock } from '../ui/status.js';
import { ObservationSchema, ConfigSchema } from '../src/config.js';
import { bookingView, defaultSetup } from '../ui/booking.js';
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
  const booking=()=>bookingView(ConfigSchema.parse({...defaultSetup,PLAYER_FULL_NAME:'Test Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'test@example.com'}));
  const controller = new Controller({ runner, lock: async () => lock, cdp: async () => true, clock, confirm, booking, saveBooking:booking, publish: () => {} });
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
  it('confirms the compiled selection plan and sends only a validated selection command',async()=>{
    const h=harness();await h.controller.armSelection();
    expect(h.confirm).toHaveBeenCalledWith('selection',expect.objectContaining({playerConfigured:true,setup:expect.objectContaining({DURATION_HOURS:2})}));
    expect(h.calls).toEqual([{kind:'selection',planHash:expect.stringMatching(/^[a-f0-9]{64}$/)}]);
  });
  it('cancels selection without launching and refuses it while locked',async()=>{
    const h=harness(false);await h.controller.armSelection();expect(h.calls).toEqual([]);h.setLock(true);await h.controller.armSelection();expect(h.calls).toEqual([]);
  });
  it('runs Dry Race with the same plan fingerprint and practice through its existing engine',async()=>{
    const h=harness();await h.controller.dryRace();await h.controller.runPractice({date:'2026-09-11',court:7,start:'10:00',duration:2});
    expect(h.calls[0]).toEqual({kind:'dry',planHash:expect.stringMatching(/^[a-f0-9]{64}$/)});expect(h.calls[1]).toEqual({kind:'practice',input:{date:'2026-09-11',court:7,start:'10:00',duration:2}});
  });
  it('resets terms on startup, plan creation, completion and abort',async()=>{
    const h=harness();expect(h.controller.state.termsAuthorized).toBe(false);
    h.controller.state.termsAuthorized=true;await h.controller.saveBooking(defaultSetup);expect(h.controller.state.termsAuthorized).toBe(false);
    h.controller.state.termsAuthorized=true;await h.controller.runPractice({date:'2026-09-11',court:7,start:'10:00',duration:2});expect(h.controller.state.termsAuthorized).toBe(false);
    h.controller.state.termsAuthorized=true;await h.controller.abortAutomation();expect(h.controller.state.termsAuthorized).toBe(false);
  });
  it('rejects malformed practice and booking configuration before any worker starts',async()=>{
    const h=harness();await h.controller.runPractice({date:'2026-09-11',court:7,start:'23:00',duration:2});await h.controller.saveBooking({...defaultSetup,START_TIME:'23:00',DURATION_HOURS:3});expect(h.calls).toEqual([]);
  });
  it('maps selection with arming and exact hash; rejects command payload injection',()=>{
    const spec=commandSpec({kind:'selection',planHash:'a'.repeat(64)},process.cwd(),process.execPath);expect(spec.args.slice(-4)).toEqual(['selection:armed','--armed','--plan-hash','a'.repeat(64)]);
    expect(()=>commandSpec({kind:'selection',planHash:';anything'} as Command,process.cwd(),process.execPath)).toThrow();
    expect(()=>commandSpec({kind:'practice',input:{date:'2026-09-11',court:7,start:'10:00',duration:2,command:'anything'}} as Command,process.cwd(),process.execPath)).toThrow();
  });
  it('stops a selection worker through the shared owned-process abort path and blocks simultaneous commands',async()=>{
    let finish!:(code:number)=>void;const stop=vi.fn(async()=>finish(130));const calls:Command[]=[];
    const plan=bookingView(ConfigSchema.parse({...defaultSetup,PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
    const runner:Runner=(command)=>{calls.push(command);return {pid:42,done:new Promise<number>(resolve=>{finish=resolve;}),stop};};
    const controller=new Controller({runner,lock:async()=>false,cdp:async()=>true,clock,confirm:async()=>true,booking:()=>plan,saveBooking:()=>plan,publish:()=>{}});
    const running=controller.armSelection();await vi.waitFor(()=>expect(calls).toHaveLength(1));
    await expect(controller.runPractice({date:'2026-09-11',court:7,start:'10:00',duration:2})).rejects.toThrow('ALREADY_RUNNING');await controller.abortAutomation();await running;
    expect(stop).toHaveBeenCalledOnce();expect(controller.state.headline).toBe('Automation aborted');expect(controller.state.operation).toBe('idle');expect(calls).toHaveLength(1);
  });
  it('refuses a changed plan after confirmation rather than launching a different booking',async()=>{
    let changed=false;const calls:Command[]=[];
    const make=(start:string)=>bookingView(ConfigSchema.parse({...defaultSetup,START_TIME:start,PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
    const controller=new Controller({runner:command=>{calls.push(command);throw Error('SHOULD_NOT_START');},lock:async()=>false,cdp:async()=>true,clock,confirm:async()=>{changed=true;return true;},booking:()=>make(changed?'10:00':'08:00'),saveBooking:()=>make('08:00'),publish:()=>{}});
    await controller.armSelection();expect(calls).toEqual([]);expect(controller.state.detail).toBe('BOOKING_PLAN_CHANGED');
  });
  it('rejects arbitrary commands and never maps live race', () => {
    for (const command of ['race', 'practice', 'powershell -Command anything', '../src/index.ts']) expect(() => commandSpec(command as Command, process.cwd(), process.execPath)).toThrow('COMMAND_NOT_ALLOWED');
    expect(commandSpec('observe', process.cwd(), process.execPath).args.slice(-2)).toEqual(['release:observe', '--armed']);
    expect(commandSpec('inspect', process.cwd(), process.execPath).args).not.toContain('--armed');
  });
  it('keeps full booking gated and exposes only its dedicated validated bridge', async () => {
    const html = await readFile('ui/renderer/index.html', 'utf8');
    expect(html).toContain('FULL BOOKING — STOP AT QR PAYMENT');
    const h=harness();h.controller.state.capabilities={selectionReady:true,checkoutReady:true,paymentBoundaryReady:false};await expect(h.controller.setMode('full')).rejects.toThrow('LIVE_RACE_BLOCKED');
    const preload = await readFile('ui/preload.cts', 'utf8');
    expect(preload).not.toMatch(/exec|spawn|['"]thirsty:race['"]|shell|readFile/);
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
