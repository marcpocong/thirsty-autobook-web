import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { Controller, type Dependencies } from '../ui/controller.js';
import { bookingView, defaultSetup } from '../ui/booking.js';
import { ConfigSchema, ObservationSchema } from '../src/config.js';
import { clockStatus } from '../ui/status.js';
import type { Runner } from '../ui/processes.js';
import type { SlotWatchSummary, SlotWatchView } from '../src/slot-watch.js';
import { preregistered } from './arbitration-manifest-stub.js';

const plan = () => bookingView(ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: 'api-first',
  PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' }));
const clock = () => clockStatus(ObservationSchema.parse({}), DateTime.fromISO('2026-09-23T07:00:00+08:00'));

function fakeWatches() {
  const started: Array<{ id: string; input: { date: string; releaseMs: number }; onUpdate: (view: SlotWatchView) => void; stoppedWith?: string }> = [];
  const start: NonNullable<Dependencies['startSlotWatch']> = (input, onUpdate) => {
    const id = `watch-${started.length + 1}`, entry: (typeof started)[number] = { id, input, onUpdate };
    let finish!: (summary: SlotWatchSummary) => void;
    const done = new Promise<SlotWatchSummary>(resolve => { finish = resolve; });
    started.push(entry);
    return { id, done, stop: async reason => {
      entry.stoppedWith = reason;
      const summary = { id, date: input.date, status: 'stopped', polls: 0, taken: [], fastestTakeMs: null, reportPath: 'report.txt' } as unknown as SlotWatchSummary;
      finish(summary); return summary;
    } };
  };
  return { started, start };
}
function controller(extra: Partial<Dependencies> = {}, runner: Runner = () => ({ pid: 1, done: Promise.resolve(0), stop: async () => undefined })) {
  const view = plan();
  return new Controller({ ensureArbitrationManifest: preregistered, runner, lock: async () => false, cdp: async () => true, clock, confirm: async () => true,
    booking: () => view, saveBooking: () => view, publish: () => undefined, browserHealth: async () => ({ A: true }), ...extra });
}

describe('Close all bot browsers', () => {
  it('asks first, then closes only through the bot-profile closer and clears preparation', async () => {
    const close = vi.fn(async () => ({ found: 2, closed: 2, forced: 1 }));
    const confirm = vi.fn(async () => true);
    const c = controller({ countBotBrowsers: async () => 2, closeBotBrowsers: close, confirmCloseBrowsers: confirm });
    c.state.ready = true; c.state.apiFirstReady = true;
    await c.closeBotBrowsers();
    expect(confirm).toHaveBeenCalledWith({ open: 2, qrPages: 0, lock: false });
    expect(close).toHaveBeenCalledOnce();
    expect(c.state.headline).toBe('BOT BROWSERS CLOSED');
    expect(c.state.detail).toContain('2 Chrome browsers started by the bot were closed');
    expect(c.state.apiFirstReady).toBe(false);
    expect(c.state.logs.some(line => line.text.includes('1 force-closed'))).toBe(true);
  });

  it('does nothing without confirmation or when no bot browser is open', async () => {
    const close = vi.fn(async () => ({ found: 1, closed: 1, forced: 0 }));
    const declined = controller({ countBotBrowsers: async () => 1, closeBotBrowsers: close, confirmCloseBrowsers: async () => false });
    await declined.closeBotBrowsers();
    expect(declined.state.headline).toBe('Close browsers cancelled');
    const confirm = vi.fn(async () => true);
    const none = controller({ countBotBrowsers: async () => 0, closeBotBrowsers: close, confirmCloseBrowsers: confirm });
    await none.closeBotBrowsers();
    expect(none.state.headline).toBe('NO BOT BROWSERS OPEN');
    expect(confirm).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('warns about open QR pages and is refused while a run is active', async () => {
    const confirm = vi.fn(async () => false);
    let finish!: (code: number) => void;
    const runner: Runner = () => ({ pid: 1, done: new Promise<number>(resolve => { finish = resolve; }), stop: async () => finish(130) });
    const close = vi.fn(async () => ({ found: 1, closed: 1, forced: 0 }));
    const c = controller({ countBotBrowsers: async () => 1, closeBotBrowsers: close, confirmCloseBrowsers: confirm }, runner);
    c.state.qrHandoffs = [{ checkout: 'A', courts: [7], date: '2026-09-25', startTime: '10:00', endTime: '12:00', amount: 1200,
      verifiedAt: new Date().toISOString(), holdExpiresAt: new Date(Date.now() + 600_000).toISOString() }];
    await c.closeBotBrowsers();
    expect(confirm).toHaveBeenCalledWith({ open: 1, qrPages: 1, lock: false });
    const running = c.runPractice({ date: '2026-09-24', court: 7, start: '10:00', duration: 2 });
    await vi.waitFor(() => expect(c.state.operation).toBe('practice'));
    await expect(c.closeBotBrowsers()).rejects.toThrow('OPERATION_ALREADY_RUNNING');
    await c.abortAutomation(); await running;
    expect(close).not.toHaveBeenCalled();
  });
});

describe('Release slot watch control', () => {
  it('starts a read-only watch for the next release and shows its updates', async () => {
    const watches = fakeWatches();
    const c = controller({ startSlotWatch: watches.start });
    await c.watchNextRelease();
    expect(watches.started).toHaveLength(1);
    expect(watches.started[0]!.input).toMatchObject({ date: clock().targetDate, releaseMs: clock().releaseMs });
    watches.started[0]!.onUpdate({ id: 'watch-1', date: clock().targetDate, releaseMs: clock().releaseMs, status: 'waiting', polls: 0 } as SlotWatchView);
    expect(c.state.slotWatch?.status).toBe('waiting');
    // A second request for the same release keeps the running watch.
    await c.watchNextRelease();
    expect(watches.started).toHaveLength(1);
    await c.stopSlotWatch();
    expect(watches.started[0]!.stoppedWith).toBe('stopped by operator');
  });

  it('watches every armed API release and cancels that watch only if the release is aborted before it happens', async () => {
    const previous = process.env.THIRSTY_API_TEST_INSTALLATION;
    process.env.THIRSTY_API_TEST_INSTALLATION = '1';
    try {
      const watches = fakeWatches();
      let finish!: (code: number) => void;
      const runner: Runner = command => ({ pid: 1, stop: async () => finish(130),
        done: typeof command === 'object' && command.kind === 'apiRun' && command.mode === 'live' ? new Promise<number>(resolve => { finish = resolve; }) : Promise.resolve(0) });
      const releaseMs = Date.now() + 3_600_000, future = { ...clock(), releaseMs, targetDate: plan().targetDate };
      const c = controller({ startSlotWatch: watches.start, clock: () => future }, runner);
      await c.resetPrepare({ workflow: 'release', strategy: 'standard' });
      await c.authorizeTerms(true);
      const armed = c.armFullBooking();
      await vi.waitFor(() => expect(watches.started).toHaveLength(1));
      expect(watches.started[0]!.input).toMatchObject({ date: plan().targetDate, releaseMs });
      await c.abortAutomation(); await armed;
      expect(watches.started[0]!.stoppedWith).toBe('release aborted');
    } finally {
      if (previous === undefined) delete process.env.THIRSTY_API_TEST_INSTALLATION;
      else process.env.THIRSTY_API_TEST_INSTALLATION = previous;
    }
  });

  it('builds the forensic report only after the runner exits, then finalizes it when the release watch ends', async () => {
    const previous = process.env.THIRSTY_API_TEST_INSTALLATION;
    process.env.THIRSTY_API_TEST_INSTALLATION = '1';
    try {
      const watches = fakeWatches();
      let finish!: (code: number) => void, runnerExited = false;
      const builds: Array<{ runId: string; status: string; runnerExited: boolean }> = [];
      const runner: Runner = (command, onEvent) => {
        if (typeof command !== 'object' || command.kind !== 'apiRun' || command.mode !== 'live') return { pid: 1, done: Promise.resolve(0), stop: async () => undefined };
        setImmediate(() => onEvent({ type: 'apiStage', stage: 'RUN_STARTED', at: new Date().toISOString(), elapsedMs: 0, runId: 'run-live-1' } as never));
        return { pid: 1, stop: async () => finish(130), done: new Promise<number>(resolve => { finish = code => { runnerExited = true; resolve(code); }; }) };
      };
      const releaseMs = Date.now() + 3_600_000, future = { ...clock(), releaseMs, targetDate: plan().targetDate };
      const digest = (runId: string, status: string) => ({ runId, status, reportPath: `C:\\bot\\.local\\release-forensics\\${runId}\\report.txt` }) as never;
      const c = controller({ startSlotWatch: watches.start, clock: () => future, releaseForensicsHistory: () => [],
        buildReleaseForensics: input => { builds.push({ ...input, runnerExited }); return digest(input.runId, input.status); } }, runner);
      await c.resetPrepare({ workflow: 'release', strategy: 'standard' });
      await c.authorizeTerms(true);
      const armed = c.armFullBooking();
      await vi.waitFor(() => expect(c.state.apiStage?.stage).toBe('RUN_STARTED'));
      await new Promise(done => setTimeout(done, 20));
      expect(builds).toEqual([]);
      finish(1); await armed;
      await vi.waitFor(() => expect(builds).toHaveLength(1));
      // The release watch is still observing: preliminary now, final when it ends.
      expect(builds[0]).toEqual({ runId: 'run-live-1', status: 'preliminary', runnerExited: true });
      await c.stopSlotWatch();
      await vi.waitFor(() => expect(builds).toHaveLength(2));
      expect(builds[1]).toEqual({ runId: 'run-live-1', status: 'final', runnerExited: true });
      expect(c.state.logs.some(line => line.text.includes('Release forensics final: C:\\bot\\.local\\release-forensics\\run-live-1\\report.txt'))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.THIRSTY_API_TEST_INSTALLATION;
      else process.env.THIRSTY_API_TEST_INSTALLATION = previous;
    }
  });

  it('keeps an operator-started watch running through Emergency Stop', async () => {
    const watches = fakeWatches();
    let finish!: (code: number) => void;
    const runner: Runner = () => ({ pid: 1, done: new Promise<number>(resolve => { finish = resolve; }), stop: async () => finish(130) });
    const c = controller({ startSlotWatch: watches.start }, runner);
    await c.watchNextRelease();
    const running = c.runPractice({ date: '2026-09-24', court: 7, start: '10:00', duration: 2 });
    await vi.waitFor(() => expect(c.state.operation).toBe('practice'));
    await c.abortAutomation(); await running;
    expect(watches.started[0]!.stoppedWith).toBeUndefined();
  });
});
