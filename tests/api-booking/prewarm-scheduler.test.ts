import { describe, expect, it } from 'vitest';
import { adaptivePrewarmLeadMs, describeTierStatus, schedulePrewarm, UNBOUNDED_PREWARM, type PrewarmClock, type PrewarmTask } from '../../src/api-booking/prewarm-scheduler.js';

/** Manual clock: timers fire only when the test advances time. */
function manualClock() {
  let now = 0; const timers: Array<{ at: number; callback: () => void; cancelled: boolean }> = [];
  const clock: PrewarmClock = { now: () => now, setTimer: (callback, ms) => { const timer = { at: now + ms, callback, cancelled: false }; timers.push(timer); return { cancel: () => { timer.cancelled = true; } }; } };
  return { clock, advance: async (ms: number) => { now += ms; for (const timer of timers.splice(0)) { if (timer.cancelled) continue; if (timer.at <= now) timer.callback(); else timers.push(timer); } await flush(); } };
}
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
const fanOut = (workers: string[], width: number): PrewarmTask[] =>
  workers.flatMap((worker, order) => Array.from({ length: width }, (_, tier) => ({ id: `${worker}${tier}`, tier, order, group: worker })));
/** Controllable preparations: each `run` waits until the test finishes it. */
function controllable() {
  const started: string[] = [], finishers = new Map<string, (ok: boolean) => void>();
  const run = (task: PrewarmTask) => { started.push(task.id); return new Promise<boolean>(done => finishers.set(task.id, done)); };
  return { started, run, finish: async (id: string, ok = true) => { finishers.get(id)!(ok); await flush(); } };
}
const workers = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

describe('priority-aware prewarm', () => {
  it('without a policy starts everything at once (previous behavior)', async () => {
    const control = controllable();
    schedulePrewarm(fanOut(workers, 4), control.run, UNBOUNDED_PREWARM);
    await flush();
    expect(control.started).toHaveLength(28);
  });

  it('starts Tier 1 (A0…G0) first and holds lower tiers behind the tier barrier', async () => {
    const control = controllable(), { clock } = manualClock();
    const schedule = schedulePrewarm(fanOut(workers, 4), control.run, { concurrency: 7, perGroupConcurrency: Infinity, tierBarrierTimeoutMs: Infinity }, clock);
    await flush();
    expect(control.started).toEqual(['A0', 'B0', 'C0', 'D0', 'E0', 'F0', 'G0']);
    for (const worker of workers.slice(0, 6)) await control.finish(`${worker}0`);
    // One Tier-1 preparation is still running: no Tier-2 child may start yet.
    expect(control.started).toHaveLength(7);
    expect(describeTierStatus(schedule.status())).toContain('Tier 1 ready: 6/7 (1 preparing)');
    await control.finish('G0');
    expect(control.started.slice(7)).toEqual(['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1']);
    expect(schedule.status()[0]).toMatchObject({ tier: 0, total: 7, ready: 7 });
  });

  it('never lets lower tiers delay Tier 1: a lower tier only takes slots Tier 1 does not need', async () => {
    const control = controllable(), { clock } = manualClock();
    // Only 4 slots: Tier 1 still gets every slot first, in strategy order.
    schedulePrewarm(fanOut(workers, 3), control.run, { concurrency: 4, perGroupConcurrency: Infinity, tierBarrierTimeoutMs: 0 }, clock);
    await flush();
    expect(control.started).toEqual(['A0', 'B0', 'C0', 'D0']);
    await control.finish('A0');
    expect(control.started.at(-1)).toBe('E0');
    await control.finish('B0'); await control.finish('C0');
    expect(control.started.slice(4)).toEqual(['E0', 'F0', 'G0']);
    await control.finish('D0');
    // Only now, with every Tier-1 child started, does Tier 2 get a slot.
    expect(control.started.at(-1)).toBe('A1');
  });

  it('a stuck Tier-1 preparation cannot starve lower tiers forever (bounded barrier)', async () => {
    const control = controllable(), manual = manualClock();
    schedulePrewarm(fanOut(['A', 'B'], 2), control.run, { concurrency: Infinity, perGroupConcurrency: Infinity, tierBarrierTimeoutMs: 4_000 }, manual.clock);
    await flush();
    await control.finish('A0');
    expect(control.started).toEqual(['A0', 'B0']);
    await manual.advance(3_999);
    expect(control.started).toHaveLength(2);
    await manual.advance(1);
    expect(control.started).toEqual(['A0', 'B0', 'A1', 'B1']);
  });

  it('limits concurrent preparations per browser', async () => {
    const control = controllable(), { clock } = manualClock();
    schedulePrewarm(fanOut(['A', 'B'], 3), control.run, { concurrency: Infinity, perGroupConcurrency: 1, tierBarrierTimeoutMs: 0 }, clock);
    await flush();
    expect(control.started).toEqual(['A0', 'B0']);
    await control.finish('A0');
    expect(control.started).toEqual(['A0', 'B0', 'A1']);
  });

  it('stopStarting omits everything not yet started, and omitted children are never prepared', async () => {
    const control = controllable(), { clock } = manualClock();
    const schedule = schedulePrewarm(fanOut(['A', 'B'], 3), control.run, { concurrency: 2, perGroupConcurrency: Infinity, tierBarrierTimeoutMs: Infinity }, clock);
    await flush();
    schedule.stopStarting();
    await control.finish('A0'); await control.finish('B0');
    expect(control.started).toEqual(['A0', 'B0']);
    expect(schedule.readiness.get('A1')).toMatchObject({ settled: true, ok: false, omitted: true, started: false });
    expect(schedule.status().map(value => [value.tier, value.ready, value.omitted])).toEqual([[0, 2, 0], [1, 0, 2], [2, 0, 2]]);
    expect(describeTierStatus(schedule.status())).toBe('Tier 1 ready: 2/2 · Tier 2 ready: 0/2 (2 omitted) · Tier 3 ready: 0/2 (2 omitted)');
  });

  it('a failed or throwing preparation settles as not ready and frees its slot', async () => {
    const { clock } = manualClock();
    const started: string[] = [];
    const schedule = schedulePrewarm(fanOut(['A'], 2), async task => { started.push(task.id); if (task.id === 'A0') throw Error('boom'); return true; },
      { concurrency: 1, perGroupConcurrency: 1, tierBarrierTimeoutMs: Infinity }, clock);
    await flush();
    expect(schedule.readiness.get('A0')).toMatchObject({ settled: true, ok: false, omitted: false });
    expect(started).toEqual(['A0', 'A1']);
  });
});

describe('adaptive prewarm lead', () => {
  it('reserves a preparation round even for a single tier and conservative rounds without measurements', () => {
    expect(adaptivePrewarmLeadMs({ tiers: 1, workers: 7, concurrency: 7, prepP95Ms: 8_000 })).toBe(25_000);
    expect(adaptivePrewarmLeadMs({ tiers: 1, workers: 2, concurrency: 2, prepP95Ms: 30_492 })).toBe(53_115);
    expect(adaptivePrewarmLeadMs({ tiers: 4, workers: 7, concurrency: 7, prepP95Ms: null })).toBe(75_000);
  });
  it('grows with the number of tiers and the measured p95, capped inside the context freshness limit', () => {
    expect(adaptivePrewarmLeadMs({ tiers: 2, workers: 7, concurrency: 7, prepP95Ms: 8_000 })).toBe(35_000);
    expect(adaptivePrewarmLeadMs({ tiers: 4, workers: 7, concurrency: 7, prepP95Ms: 8_000 })).toBe(55_000);
    expect(adaptivePrewarmLeadMs({ tiers: 4, workers: 7, concurrency: 7, prepP95Ms: 30_000 })).toBe(105_000);
  });
});
