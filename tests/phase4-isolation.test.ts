import { readFileSync } from 'node:fs';
import { DateTime } from 'luxon';
import { describe, expect, it, vi } from 'vitest';
import { Controller } from '../ui/controller.js';
import { bookingView, defaultSetup } from '../ui/booking.js';
import { ConfigSchema, ObservationSchema } from '../src/config.js';
import { clockStatus } from '../ui/status.js';
import type { Runner } from '../ui/processes.js';

/** Phase 4 must stay off the release path: separate modules, separate process, and paused near a release. */
const PHASE4 = ['release-intelligence', 'release-advisor', 'strategy-replay', 'network-readiness', 'checkout-path-research'];
const players = { PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' };

function controller(releaseInMs: number, extra: Record<string, unknown> = {}) {
  const view = bookingView(ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: 'proofless', ...players }));
  const calls: string[] = [];
  const runner: Runner = () => ({ pid: 1, done: Promise.resolve(0), stop: async () => undefined });
  const instance = new Controller({ runner, lock: async () => false, cdp: async () => true, confirm: async () => true, publish: () => undefined,
    booking: () => view, saveBooking: () => view,
    clock: () => ({ ...clockStatus(ObservationSchema.parse({}), DateTime.fromISO('2026-09-24T06:00:00+08:00')), releaseMs: Date.now() + releaseInMs, clockOffsetMs: 0 }),
    rebuildReleaseIntelligence: () => { calls.push('rebuild'); return { generatedAt: '', releases: 0, realReleases: 0, adequateReleases: 0, synthetic: 0, benchmarks: 0, skipped: 0, directory: '' }; },
    clearReleaseIntelligence: () => { calls.push('clear'); return 0; },
    runNetworkReadiness: async () => { calls.push('network'); throw Error('not in this test'); },
    replayPlan: () => { calls.push('replay'); return { results: [], skipped: [] }; },
    adviseFromHistory: () => { calls.push('advise'); return { dayOfWeek: 'Saturday', wellObservedReleases: 0, releasesConsidered: 0, insufficient: true, rule: '', notes: [], suggestions: [], candidatesConsidered: 0 }; },
    ...extra });
  return { instance, calls };
}

describe('Phase 4 performance isolation', () => {
  it('the release runner and its dispatch modules import no Phase 4 module', () => {
    for (const file of ['src/api-booking/desktop-runner.ts', 'src/api-booking/armed-dispatch.ts', 'src/api-booking/precision-phase3.ts', 'src/api-booking/proofless-checkout.ts',
      'src/api-booking/browser-session-transport.ts', 'src/slot-watch.ts']) {
      const imports = (readFileSync(file, 'utf8').match(/^import[\s\S]*?from '[^']+';/gm) ?? []).join('\n');
      for (const module of PHASE4) expect(imports, `${file} imports ${module}`).not.toContain(module);
    }
  });

  it('pauses every Phase 4 tool from 10 minutes before release and while a run or watch is active', async () => {
    const near = controller(5 * 60_000);
    await near.instance.rebuildIntelligence(); await near.instance.runNetworkCheck(); await near.instance.clearIntelligence();
    expect(await near.instance.replayPlan({ source: 'saved' })).toMatchObject({ blocked: expect.stringContaining('10 minutes before') });
    expect(await near.instance.adviseFromHistory({ courts: [7], earliestStart: '17:00', latestStart: '19:00', durationHours: 3, immediate: 1, backups: 0 }))
      .toEqual({ blocked: expect.stringContaining('10 minutes before') });
    expect(near.calls).toEqual([]);
    expect(near.instance.state.phase4?.message).toContain('paused');
    const far = controller(6 * 60 * 60_000);
    await far.instance.rebuildIntelligence();
    expect(far.calls).toEqual(['rebuild']);
    (far.instance as unknown as { slotWatch: object }).slotWatch = { id: 'watch' };
    expect(far.instance.phase4Blocked()).toContain('slot watch');
    (far.instance as unknown as { slotWatch?: object }).slotWatch = undefined;
    far.instance.state.operation = 'scheduled';
    expect(far.instance.phase4Blocked()).toContain('armed release');
  });

  it('rebuilds intelligence only after the final post-run report, never for a preliminary one', async () => {
    const { instance, calls } = controller(6 * 60 * 60_000, { buildReleaseForensics: () => undefined });
    const build = (instance as unknown as { buildForensics(runId: string, status: 'preliminary' | 'final'): void }).buildForensics.bind(instance);
    build('run-1', 'preliminary'); await new Promise(done => setImmediate(done)); await new Promise(done => setImmediate(done));
    expect(calls).toEqual([]);
    build('run-1', 'final'); await new Promise(done => setImmediate(done)); await new Promise(done => setImmediate(done));
    expect(calls).toEqual(['rebuild']);
  });

  it('defers the post-run rebuild while a watch is still active, and ignores only the release-time window afterwards', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const { instance, calls } = controller(60_000, { buildReleaseForensics: () => undefined });
      (instance as unknown as { slotWatch?: object }).slotWatch = { id: 'still-watching' };
      (instance as unknown as { buildForensics(runId: string, status: 'final'): void }).buildForensics('run-2', 'final');
      await new Promise(done => setImmediate(done));
      expect(calls).toEqual([]);
      expect(instance.phase4Blocked()).toContain('slot watch');
      (instance as unknown as { slotWatch?: object }).slotWatch = undefined;
      expect(instance.phase4Blocked()).toContain('10 minutes before'); // an operator request is still refused near release
      expect(instance.phase4Blocked({ afterRelease: true })).toBeNull();
      await vi.advanceTimersByTimeAsync(60_000); await new Promise(done => setImmediate(done));
      expect(calls).toEqual(['rebuild']);
    } finally { vi.useRealTimers(); }
  });

  it('rejects malformed replay and advisor requests before any work', async () => {
    const { instance, calls } = controller(6 * 60 * 60_000);
    await expect(instance.replayPlan({ source: 'draft', phase3: { candidates: [] } })).rejects.toThrow();
    await expect(instance.adviseFromHistory({ courts: [9], earliestStart: '17:00', latestStart: '19:00', durationHours: 3, immediate: 1, backups: 0 })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
