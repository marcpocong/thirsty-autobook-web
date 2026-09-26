import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DurableSubmissionJournal } from '../../src/api-booking/durable-submission-journal.js';
import { adaptiveMaxAgeMs, authorizePrecision, candidatePriceFromObservation, classifyActionableObservation, precisionCandidateId,
  PrecisionSession, revalidateAdaptiveAttempt, type CandidateInput } from '../../src/api-booking/precision-phase3.js';
import { MATRIX_HOURS } from '../../src/api-booking/court-hour-matrix.js';
import type { AvailabilityObservation } from '../../src/slot-evidence.js';
import { UiEventSchema } from '../../src/ui-events.js';
import { AdaptiveHarness, SYNTHETIC_CUSTOMER } from '../helpers/adaptive-harness.js';

/**
 * Rescue / Wave 2 starvation fix: a newer Slot Watch sequence during security preparation must not by itself
 * end the attempt. Each scenario opens like September 26: the Rescue target C2 17:00–20:00 is unavailable in
 * #127, fully open in #128 (selected on G), and security preparation runs while newer reads arrive.
 */
const date = '2026-09-28', releaseMs = Date.parse('2026-09-26T00:00:00Z');
const rate = (perHour: number[]) => ({ source: 'venue schedule', capturedAt: '2026-09-25T19:44:44Z', status: 'VENUE_SCHEDULE' as const,
  date, perHour, actionable: true });
const target: CandidateInput = { court: 2, start: '17:00', durationHours: 3, priority: 1,
  permissions: { wave1: true, wave2: false, rescue: true }, rateEvidence: rate([700, 700, 700]) };
const backup: CandidateInput = { court: 6, start: '20:00', durationHours: 3, priority: 2,
  permissions: { wave1: false, wave2: true, rescue: false }, rateEvidence: rate([700, 700, 700]) };
const targetId = precisionCandidateId(date, target);
const TARGET_CELLS = ['2/17', '2/18', '2/19'];

interface GridOptions { closed?: string[]; codes?: Record<string, string>; price?: number; prices?: Record<string, number | null>;
  cache?: string; latencyMs?: number; outcome?: AvailabilityObservation['outcome']; dropCourt?: number }
/** A complete 7×16 grid, every cell OPEN at PHP 700 unless overridden. Cells are `court/hour` (hour 8–23). */
function grid(seq: number, requestOffsetMs: number, options: GridOptions = {}): AvailabilityObservation {
  const code = (court: number, hour: number) => options.codes?.[`${court}/${hour}`] ?? (options.closed?.includes(`${court}/${hour}`) ? 'X' : 'O');
  const rows = Array.from({ length: 7 }, (_, index) => index + 1).filter(court => court !== options.dropCourt)
    .map(court => `${court}:${MATRIX_HOURS.map(hour => code(court, Number(hour.slice(0, 2)))).join('')}`);
  return { seq, scheduledOffsetMs: Math.round(requestOffsetMs), requestOffsetMs, responseOffsetMs: requestOffsetMs + (options.latencyMs ?? 150),
    outcome: options.outcome ?? 'ok', targetDatePresent: true, matrix: rows.join(','), cache: { status: options.cache ?? 'MISS', ageS: 0 },
    prices: Array.from({ length: 7 }, (_, court) => MATRIX_HOURS.map(hour => {
      const key = `${court + 1}/${Number(hour.slice(0, 2))}`;
      return (key in (options.prices ?? {}) ? options.prices![key] : options.price ?? 700) as number;
    })) };
}

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

/** Wave 1 on D was rejected; #127 shows the target taken, #128 shows it fully open again: Rescue selects it on G. */
async function reopened(budgets = { wave2: 1, rescue: 1, total: 3 }) {
  const authorization = authorizePrecision({ date, releaseMs, candidates: [target, backup], wave1: [{ workerId: 'D', candidateId: targetId }],
    standby: ['G'], budgets, concurrentWave2: true, rescueEnabled: true, authorizedAt: '2026-09-25T23:30:26Z' });
  const session = new PrecisionSession(authorization), root = await mkdtemp(join(tmpdir(), 'adaptive-revalidation-'));
  roots.push(root);
  session.record({ id: 'wave1-D', candidateId: targetId, workerId: 'D', wave: 'WAVE_1', state: 'REJECTED' });
  const harness = new AdaptiveHarness(session, root);
  harness.advanceTo(596_150);
  harness.deliver(grid(127, 596_000, { closed: TARGET_CELLS }));
  harness.advanceTo(597_365);
  harness.deliver(grid(128, 597_005, { latencyMs: 337 }));
  const choices = session.select('RESCUE', releaseMs + harness.now, adaptiveMaxAgeMs(337, harness.securityRefreshMs));
  expect(choices).toHaveLength(1);
  const selection = choices[0]!;
  expect(selection).toMatchObject({ workerId: 'G', evidenceSeq: 128, reopenEpoch: 127, prices: [700, 700, 700] });
  expect(selection.candidate.id).toBe(targetId);
  harness.securityMs = [1_481];
  return { harness, session, selection, root, authorization };
}
const rescueAttempts = (session: PrecisionSession) => session.attempts.filter(value => value.wave === 'RESCUE');
/** The durable journal the runner keeps per logical block (directory and key are the candidate's logical key). */
const journalFor = (root: string, selection: { candidate: { logicalKey: string } }) =>
  new DurableSubmissionJournal(join(root, selection.candidate.logicalKey));
const journalState = async (root: string, selection: { candidate: { logicalKey: string } }) => {
  try { return (await journalFor(root, selection).read(selection.candidate.logicalKey)).state; } catch { return 'NONE'; }
};
async function settleTelemetry() { await new Promise<void>(done => setImmediate(done)); }

describe('Test 1: the September 26 starvation, reproduced synthetically', () => {
  it('a newer read showing the same candidate open during security preparation rebases 128 → 129 and dispatches once', async () => {
    const { harness, session, selection, root } = await reopened();
    harness.schedule(598_152, grid(129, 598_000, { latencyMs: 138 }));
    const result = await harness.run(selection, 'RESCUE', date);
    await settleTelemetry();
    // Exactly the pre-fix abort condition: preparation finished with a newer sequence than the selected one.
    expect(harness.security).toEqual([expect.objectContaining({ workerId: 'G', newestSeqAtCompletion: 129 })]);
    expect(result).toMatchObject({ outcome: 'SETTLED', state: 'REJECTED', selectedEvidenceSeq: 128, evidenceSeq: 129 });
    expect(harness.posts).toEqual([expect.objectContaining({ workerId: 'G', candidateId: targetId, evidenceSeq: 129, rates: [700, 700, 700] })]);
    expect(harness.stages('PHASE3_EVIDENCE_REBASED')).toEqual([expect.objectContaining({ workerId: 'G', candidateId: targetId, wave: 'RESCUE',
      checkpoint: 'AFTER_SECURITY', fromSeq: 128, toSeq: 129, selectedEvidenceSeq: 128, priceChanged: false })]);
    expect(harness.stages('PHASE3_ADAPTIVE_SKIPPED')).toEqual([]);
    expect(harness.stages('PHASE3_ADAPTIVE_REVALIDATED').map(value => [value.checkpoint, value.evidenceSeq]))
      .toEqual([['AFTER_SECURITY', 129], ['BEFORE_RESERVE', 129], ['BEFORE_POST', 129]]);
    expect(harness.stages('PHASE3_ATTEMPT_RESERVED')).toEqual([expect.objectContaining({ evidenceSeq: 129, selectedEvidenceSeq: 128, amount: 2100 })]);
    expect(harness.reservations).toEqual([expect.objectContaining({ evidenceSeq: 129, selectedEvidenceSeq: 128, prices: [700, 700, 700] })]);
    expect(rescueAttempts(session)).toEqual([expect.objectContaining({ state: 'REJECTED', evidenceSeq: 129, selectedEvidenceSeq: 128, reopenEpoch: 127 })]);
    expect(await journalState(root, selection)).toBe('rejected');
  });
});

describe('Test 2: several sequence changes', () => {
  it('uses the newest valid read after preparation spanning #129–#131 and dispatches once', async () => {
    const { harness, selection } = await reopened();
    harness.securityMs = [3_600];
    for (const [seq, at] of [[129, 598_000], [130, 599_000], [131, 600_000]] as const) harness.schedule(at + 150, grid(seq, at));
    const result = await harness.run(selection, 'RESCUE', date);
    await settleTelemetry();
    expect(result).toMatchObject({ outcome: 'SETTLED', selectedEvidenceSeq: 128, evidenceSeq: 131 });
    expect(harness.posts.map(value => value.evidenceSeq)).toEqual([131]);
    expect(harness.stages('PHASE3_EVIDENCE_REBASED').map(value => [value.checkpoint, value.fromSeq, value.toSeq]))
      .toEqual([['AFTER_SECURITY', 128, 131]]);
  });
  it('a read arriving between reservation and fetch rebases again at the final gate instead of killing the POST', async () => {
    const { harness, selection } = await reopened();
    harness.securityMs = [2_700];
    harness.schedule(598_150, grid(129, 598_000)).schedule(599_150, grid(130, 599_000)).schedule(600_130, grid(131, 600_000));
    harness.beforeFinalGate = () => harness.advanceTo(600_200);
    const result = await harness.run(selection, 'RESCUE', date);
    await settleTelemetry();
    expect(harness.reservations).toEqual([expect.objectContaining({ selectedEvidenceSeq: 128, evidenceSeq: 130 })]);
    expect(result).toMatchObject({ outcome: 'SETTLED', evidenceSeq: 131 });
    expect(harness.posts.map(value => value.evidenceSeq)).toEqual([131]);
    expect(harness.stages('PHASE3_EVIDENCE_REBASED').map(value => [value.checkpoint, value.fromSeq, value.toSeq]))
      .toEqual([['AFTER_SECURITY', 128, 130], ['BEFORE_POST', 130, 131]]);
  });
});

describe('Test 3: the candidate becomes unavailable', () => {
  it('one required hour taken in the newest read: no POST, CANDIDATE_NO_LONGER_OPEN, nothing reserved', async () => {
    const { harness, session, selection, root } = await reopened();
    harness.schedule(598_150, grid(129, 598_000, { closed: ['2/18'] }));
    const result = await harness.run(selection, 'RESCUE', date);
    expect(result).toEqual({ outcome: 'SKIPPED', checkpoint: 'AFTER_SECURITY', reason: 'CANDIDATE_NO_LONGER_OPEN' });
    expect(harness.posts).toEqual([]);
    expect(harness.stages('PHASE3_ADAPTIVE_SKIPPED')).toEqual([expect.objectContaining({ workerId: 'G', candidateId: targetId, wave: 'RESCUE',
      checkpoint: 'AFTER_SECURITY', reason: 'CANDIDATE_NO_LONGER_OPEN', selectedEvidenceSeq: 128, seq: 129 })]);
    expect(rescueAttempts(session)).toEqual([]);
    expect(await journalState(root, selection)).toBe('NONE');
    // The normal loop may consider it again separately, as a new reopening.
    harness.advanceTo(599_150);
    harness.deliver(grid(130, 599_000));
    expect(session.select('RESCUE', releaseMs + harness.now, 6_000).map(value => [value.candidate.id, value.reopenEpoch]))
      .toEqual([[targetId, 129]]);
  });
  it('taken and reopened during preparation is not continuity: CANDIDATE_NO_LONGER_OPEN even though the newest read is open', async () => {
    const { harness, selection } = await reopened();
    harness.securityMs = [2_500];
    harness.schedule(598_150, grid(129, 598_000, { closed: ['2/19'] })).schedule(599_150, grid(130, 599_000));
    expect(await harness.run(selection, 'RESCUE', date)).toMatchObject({ outcome: 'SKIPPED', reason: 'CANDIDATE_NO_LONGER_OPEN' });
    expect(harness.posts).toEqual([]);
  });
  it('taken between reservation and fetch: the final gate stops the POST', async () => {
    const { harness, session, selection, root } = await reopened();
    harness.schedule(599_150, grid(129, 599_000, { closed: ['2/17'] }));
    harness.beforeFinalGate = () => harness.advanceTo(599_200);
    const result = await harness.run(selection, 'RESCUE', date);
    await settleTelemetry();
    expect(result).toMatchObject({ outcome: 'SETTLED', state: 'NOT_DISPATCHED', guardClosed: 'CANDIDATE_NO_LONGER_OPEN' });
    expect(harness.posts).toEqual([]);
    expect(harness.stages('PHASE3_ADAPTIVE_SKIPPED')).toEqual([expect.objectContaining({ checkpoint: 'BEFORE_POST', reason: 'CANDIDATE_NO_LONGER_OPEN' })]);
    expect(harness.stages('PHASE3_SETTLED')).toEqual([expect.objectContaining({ state: 'NOT_DISPATCHED', code: 'PHASE3_DISPATCH_GUARD_CLOSED',
      budgetReleased: true })]);
    expect(rescueAttempts(session)).toEqual([expect.objectContaining({ state: 'NOT_DISPATCHED' })]);
    expect(await journalState(root, selection)).toBe('rejected');
  });
});

describe('Test 4: the candidate becomes UNKNOWN or the grid incomplete', () => {
  it('an unknown required cell: no POST, CANDIDATE_STATE_UNKNOWN', async () => {
    const { harness, selection } = await reopened();
    harness.schedule(598_150, grid(129, 598_000, { codes: { '2/18': '?' } }));
    expect(await harness.run(selection, 'RESCUE', date)).toMatchObject({ outcome: 'SKIPPED', reason: 'CANDIDATE_STATE_UNKNOWN' });
    expect(harness.posts).toEqual([]);
  });
  it('an incomplete grid is not actionable: no POST, LATEST_NOT_ACTIONABLE', async () => {
    const { harness, selection } = await reopened();
    harness.schedule(598_150, grid(129, 598_000, { dropCourt: 2 }));
    expect(await harness.run(selection, 'RESCUE', date)).toMatchObject({ outcome: 'SKIPPED', reason: 'LATEST_NOT_ACTIONABLE' });
    expect(harness.stages('PHASE3_ADAPTIVE_SKIPPED')[0]).toMatchObject({ fitness: 'FORENSIC_ONLY_INCOMPLETE', seq: 129 });
    expect(harness.posts).toEqual([]);
  });
});

describe('Test 5: the newest read is stale or not actionable', () => {
  for (const [label, observation, fitness] of [
    ['cached', grid(129, 598_000, { cache: 'HIT' }), 'FORENSIC_ONLY_CACHE_AGE_UNKNOWN'],
    ['failed', grid(129, 598_000, { outcome: 'failed' }), 'FAILED'],
  ] as const) {
    it(`a ${label} newest read ends the attempt without falling back to #128`, async () => {
      const { harness, selection } = await reopened();
      harness.schedule(598_150, observation);
      expect(await harness.run(selection, 'RESCUE', date)).toMatchObject({ outcome: 'SKIPPED', reason: 'LATEST_NOT_ACTIONABLE' });
      expect(harness.stages('PHASE3_ADAPTIVE_SKIPPED')[0]).toMatchObject({ seq: 129, fitness });
      expect(harness.posts).toEqual([]);
    });
  }
  it('no newer read, but the selected read has aged past the freshness window: no POST', async () => {
    const { harness, selection } = await reopened();
    harness.securityMs = [20_000];
    expect(await harness.run(selection, 'RESCUE', date)).toMatchObject({ outcome: 'SKIPPED', reason: 'LATEST_NOT_ACTIONABLE' });
    expect(harness.stages('PHASE3_ADAPTIVE_SKIPPED')[0]).toMatchObject({ seq: 128, fitness: 'FORENSIC_ONLY_STALE' });
    expect(harness.posts).toEqual([]);
  });
});

describe('Test 6: price changes', () => {
  it('a newer read with a different valid price is adopted with its own prices', async () => {
    const { harness, selection } = await reopened();
    harness.schedule(598_150, grid(129, 598_000, { price: 800 }));
    expect(await harness.run(selection, 'RESCUE', date)).toMatchObject({ outcome: 'SETTLED', evidenceSeq: 129 });
    await settleTelemetry();
    expect(harness.posts).toEqual([expect.objectContaining({ evidenceSeq: 129, rates: [800, 800, 800] })]);
    expect(harness.reservations[0]!.prices).toEqual([800, 800, 800]);
    expect(harness.stages('PHASE3_ATTEMPT_RESERVED')[0]).toMatchObject({ amount: 2400 });
    expect(harness.stages('PHASE3_EVIDENCE_REBASED')[0]).toMatchObject({ fromSeq: 128, toSeq: 129, priceChanged: true });
  });
  it('an invalid price in the newest read ends the attempt: no stale price is used', async () => {
    for (const prices of [{ '2/18': 0 }, { '2/19': null }] as Array<Record<string, number | null>>) {
      const { harness, selection } = await reopened();
      harness.schedule(598_150, grid(129, 598_000, { prices }));
      expect(await harness.run(selection, 'RESCUE', date)).toMatchObject({ outcome: 'SKIPPED', reason: 'PRICE_INVALID' });
      expect(harness.posts).toEqual([]);
    }
  });
  it('a price change after the request is bound stops the POST (PRICE_CHANGED)', async () => {
    const { harness, selection } = await reopened();
    harness.schedule(599_150, grid(129, 599_000, { prices: { '2/17': 750 } }));
    harness.beforeFinalGate = () => harness.advanceTo(599_200);
    expect(await harness.run(selection, 'RESCUE', date)).toMatchObject({ outcome: 'SETTLED', state: 'NOT_DISPATCHED', guardClosed: 'PRICE_CHANGED' });
    expect(harness.posts).toEqual([]);
  });
});

describe('Tests 7–9: UNKNOWN, VERIFIED and concurrency blocks stay effective', () => {
  const other = (state: 'UNKNOWN' | 'VERIFIED' | 'IN_FLIGHT') => ({ id: `wave2-${state}`, candidateId: precisionCandidateId(date, backup),
    workerId: 'E' as const, wave: 'WAVE_2' as const, state });
  for (const [state, reason] of [['UNKNOWN', 'UNKNOWN_ATTEMPT_EXISTS'], ['VERIFIED', 'VERIFIED_HOLD_EXISTS'],
    ['IN_FLIGHT', 'CONCURRENT_ATTEMPT_IN_FLIGHT']] as const) {
    it(`${state} arriving during preparation: no Rescue POST (${reason})`, async () => {
      const { harness, session, selection } = await reopened();
      harness.schedule(598_150, grid(129, 598_000));
      harness.scheduleCall(598_300, () => session.record(other(state)));
      expect(await harness.run(selection, 'RESCUE', date)).toMatchObject({ outcome: 'SKIPPED', checkpoint: 'AFTER_SECURITY', reason });
      expect(harness.posts).toEqual([]);
    });
    it(`${state} arriving between reservation and fetch: the final gate stops the POST`, async () => {
      const { harness, session, selection } = await reopened();
      harness.beforeFinalGate = () => session.record(other(state));
      expect(await harness.run(selection, 'RESCUE', date)).toMatchObject({ outcome: 'SETTLED', state: 'NOT_DISPATCHED', guardClosed: reason });
      expect(harness.posts).toEqual([]);
      // Releasing the unsent reservation does not lift the other attempt's block.
      harness.advanceTo(harness.now + 150);
      harness.deliver(grid(129, harness.now - 100));
      expect(session.select('RESCUE', releaseMs + harness.now, 6_000)).toEqual([]);
    });
  }
  it('the runner-level verified hold flag blocks the Rescue', async () => {
    const { harness, selection } = await reopened();
    harness.scheduleCall(598_000, () => { harness.verifiedHold = true; });
    expect(await harness.run(selection, 'RESCUE', date)).toMatchObject({ outcome: 'SKIPPED', reason: 'VERIFIED_HOLD_EXISTS' });
    expect(harness.posts).toEqual([]);
  });
  it('while a Rescue is in flight, a fresh open read selects no second Rescue', async () => {
    const { harness, session, selection } = await reopened({ wave2: 1, rescue: 2, total: 4 });
    let selectedDuringFlight: unknown[] | undefined;
    harness.beforeFinalGate = () => {
      harness.deliver(grid(129, harness.now - 100));
      selectedDuringFlight = session.select('RESCUE', releaseMs + harness.now, 6_000);
    };
    await harness.run(selection, 'RESCUE', date);
    expect(selectedDuringFlight).toEqual([]);
    expect(harness.posts).toHaveLength(1);
  });
});

describe('Test 10: one reopening dispatches one Rescue', () => {
  it('eight consecutive open reads of the same reopen epoch create exactly one Rescue POST; a new reopening may create another', async () => {
    const { harness, session, selection } = await reopened({ wave2: 1, rescue: 2, total: 4 });
    expect(selection.reopenEpoch).toBe(127);
    for (let seq = 129; seq <= 135; seq++) harness.schedule(598_150 + (seq - 129) * 1000, grid(seq, 598_000 + (seq - 129) * 1000));
    harness.schedule(605_300, grid(136, 605_000, { closed: TARGET_CELLS }));
    harness.schedule(606_150, grid(137, 606_000));
    harness.schedule(607_150, grid(138, 607_000));
    await harness.run(selection, 'RESCUE', date);
    await harness.runLoop(choice => harness.run(choice, 'RESCUE', date));
    // #130–#135 still show the same reopening open and fresh: no second POST for epoch #127.
    expect(harness.posts.map(value => [value.evidenceSeq, value.at])).toEqual([[129, 598_846], [138, 607_631]]);
    expect(rescueAttempts(session).map(value => [value.selectedEvidenceSeq, value.evidenceSeq, value.reopenEpoch]))
      .toEqual([[128, 129, 127], [137, 138, 136]]);
  });
  it('with the Rescue budget spent, later reopenings dispatch nothing more', async () => {
    const { harness, session, selection } = await reopened();
    harness.schedule(598_150, grid(129, 598_000));
    harness.schedule(605_300, grid(136, 605_000, { closed: TARGET_CELLS })).schedule(606_150, grid(137, 606_000));
    await harness.run(selection, 'RESCUE', date);
    await harness.runLoop(choice => harness.run(choice, 'RESCUE', date));
    expect(harness.posts).toHaveLength(1);
    expect(rescueAttempts(session)).toHaveLength(1);
  });
});

describe('a provably unsent reservation consumes no Rescue budget or reopen epoch', () => {
  /** The next fresh Slot Watch read one second on, delivered as the adaptive loop would; returns Rescue's selection on it. */
  const nextRead = (harness: AdaptiveHarness, session: PrecisionSession, seq: number, options: GridOptions = {}) => {
    const requestedAt = harness.now + 1_000;
    harness.advanceTo(requestedAt + 150);
    harness.deliver(grid(seq, requestedAt, options));
    return session.select('RESCUE', releaseMs + harness.now, 6_000);
  };
  const busyJournal = { planFingerprint: 'a'.repeat(64), targetDate: date, courtIds: [2], hourlyBoundaries: [{ startTime: '17:00', endTime: '18:00' }],
    expectedBookingCount: 3, maximumAmount: 2100, stage: 'dispatching' as const };

  it('1. final price change: PRICE_CHANGED, no POST, NOT_DISPATCHED; the same reopening stays eligible and is sent once at the new price', async () => {
    const { harness, session, selection, root } = await reopened();
    harness.schedule(599_150, grid(129, 599_000, { prices: { '2/17': 750 } }));
    harness.beforeFinalGate = () => harness.advanceTo(599_200);
    expect(await harness.run(selection, 'RESCUE', date)).toMatchObject({ outcome: 'SETTLED', state: 'NOT_DISPATCHED', guardClosed: 'PRICE_CHANGED' });
    await settleTelemetry();
    expect(harness.posts).toEqual([]);
    expect(harness.stages('PHASE3_ADAPTIVE_SKIPPED')).toEqual([expect.objectContaining({ checkpoint: 'BEFORE_POST', reason: 'PRICE_CHANGED' })]);
    expect(harness.stages('PHASE3_SETTLED')).toEqual([expect.objectContaining({ state: 'NOT_DISPATCHED', code: 'PHASE3_DISPATCH_GUARD_CLOSED',
      budgetReleased: true })]);
    // The unsent reservation stays in the history and in the durable journal.
    expect(rescueAttempts(session)).toEqual([expect.objectContaining({ state: 'NOT_DISPATCHED', reopenEpoch: 127 })]);
    expect(await journalState(root, selection)).toBe('rejected');
    // Rescue budget (1) and reopen epoch #127 are still available: the next fresh OPEN read selects the same reopening.
    harness.beforeFinalGate = undefined;
    const again = nextRead(harness, session, 130, { prices: { '2/17': 750 } });
    expect(again).toEqual([expect.objectContaining({ workerId: 'G', reopenEpoch: 127, prices: [750, 700, 700] })]);
    await harness.run(again[0]!, 'RESCUE', date);
    expect(harness.posts).toEqual([expect.objectContaining({ evidenceSeq: 130, rates: [750, 700, 700] })]);
    // The unsent journal was archived as rejected, not deleted; the sent attempt consumes the budget and the epoch.
    expect((await harness.archivedRecords('rejected-attempts', selection.candidate.logicalKey)).map(value => [value.state, value.failureCode]))
      .toEqual([['rejected', 'PHASE3_DISPATCH_GUARD_CLOSED']]);
    expect(rescueAttempts(session).map(value => value.state)).toEqual(['NOT_DISPATCHED', 'REJECTED']);
    expect(nextRead(harness, session, 131, { prices: { '2/17': 750 } })).toEqual([]);
  });

  it('2. candidate closes immediately before POST: CANDIDATE_NO_LONGER_OPEN, no POST, budget kept; a genuine reopening is rescued', async () => {
    const { harness, session, selection } = await reopened();
    harness.schedule(599_150, grid(129, 599_000, { closed: ['2/17'] }));
    harness.beforeFinalGate = () => harness.advanceTo(599_200);
    expect(await harness.run(selection, 'RESCUE', date)).toMatchObject({ state: 'NOT_DISPATCHED', guardClosed: 'CANDIDATE_NO_LONGER_OPEN' });
    await settleTelemetry();
    expect(harness.posts).toEqual([]);
    expect(harness.stages('PHASE3_SETTLED')).toEqual([expect.objectContaining({ state: 'NOT_DISPATCHED', budgetReleased: true })]);
    harness.beforeFinalGate = undefined;
    expect(nextRead(harness, session, 130, { closed: ['2/17'] })).toEqual([]);
    const genuine = nextRead(harness, session, 131);
    expect(genuine).toEqual([expect.objectContaining({ workerId: 'G', reopenEpoch: 129 })]);
    await harness.run(genuine[0]!, 'RESCUE', date);
    expect(harness.posts).toEqual([expect.objectContaining({ evidenceSeq: 131 })]);
  });

  it('3. evidence goes stale before POST: LATEST_NOT_ACTIONABLE, no POST, budget kept', async () => {
    const { harness, session, selection } = await reopened();
    // No newer read arrives; by the transport's final gate #128 is older than the freshness window.
    harness.beforeFinalGate = () => harness.advanceTo(harness.now + 6_500);
    expect(await harness.run(selection, 'RESCUE', date)).toMatchObject({ state: 'NOT_DISPATCHED', guardClosed: 'LATEST_NOT_ACTIONABLE' });
    await settleTelemetry();
    expect(harness.posts).toEqual([]);
    expect(harness.stages('PHASE3_ADAPTIVE_SKIPPED')).toEqual([expect.objectContaining({ checkpoint: 'BEFORE_POST',
      reason: 'LATEST_NOT_ACTIONABLE', seq: 128, fitness: 'FORENSIC_ONLY_STALE' })]);
    expect(harness.stages('PHASE3_SETTLED')).toEqual([expect.objectContaining({ state: 'NOT_DISPATCHED', budgetReleased: true })]);
    harness.beforeFinalGate = undefined;
    expect(nextRead(harness, session, 129)).toEqual([expect.objectContaining({ workerId: 'G', reopenEpoch: 127 })]);
  });

  it('4. a real HTTP 409 after the POST left: REJECTED, budget and reopen epoch consumed', async () => {
    {
      // Rescue budget 1: even a later, genuine reopening is not rescued again.
      const { harness, session, selection } = await reopened();
      harness.schedule(598_150, grid(129, 598_000));
      expect(await harness.run(selection, 'RESCUE', date)).toMatchObject({ state: 'REJECTED' });
      expect(harness.posts).toHaveLength(1);
      expect(harness.stages('PHASE3_SETTLED')).toEqual([expect.objectContaining({ state: 'REJECTED', code: 'ONDA_HTTP_STATUS_INVALID',
        budgetReleased: false })]);
      expect(nextRead(harness, session, 130, { closed: TARGET_CELLS })).toEqual([]);
      expect(nextRead(harness, session, 131)).toEqual([]);
    }
    {
      // Rescue budget 2: the same reopening (epoch #127) is still never rescued twice.
      const { harness, session, selection } = await reopened({ wave2: 1, rescue: 2, total: 4 });
      harness.schedule(598_150, grid(129, 598_000));
      await harness.run(selection, 'RESCUE', date);
      expect(harness.posts).toHaveLength(1);
      expect(nextRead(harness, session, 130)).toEqual([]);
    }
  });

  it('5. an UNKNOWN dispatched outcome keeps the budget consumed and nothing is retried', async () => {
    const { harness, session, selection, root } = await reopened({ wave2: 1, rescue: 2, total: 4 });
    harness.respond = 'UNKNOWN';
    harness.schedule(598_150, grid(129, 598_000));
    expect(await harness.run(selection, 'RESCUE', date)).toMatchObject({ state: 'UNKNOWN' });
    expect(harness.posts).toHaveLength(1);
    expect(harness.stages('PHASE3_SETTLED')).toEqual([expect.objectContaining({ state: 'UNKNOWN', budgetReleased: false })]);
    expect(await journalState(root, selection)).toBe('unknown');
    expect(session.status).toBe('MANUAL_RECONCILIATION_REQUIRED');
    // A later, genuine reopening: no selection, and the loop stops without preparing or sending anything.
    expect(nextRead(harness, session, 130, { closed: TARGET_CELLS })).toEqual([]);
    expect(nextRead(harness, session, 131)).toEqual([]);
    harness.schedule(harness.now + 1_150, grid(132, harness.now + 1_000));
    await harness.runLoop(choice => harness.run(choice, 'RESCUE', date));
    expect(harness.security).toHaveLength(1);
    expect(harness.posts).toHaveLength(1);
    expect(await journalFor(root, selection).recycleReusable(selection.candidate.logicalKey)).toBe('blocked');
  });

  it('6. a verified hold consumes the budget and Rescue stops normally', async () => {
    const { harness, session, selection, root } = await reopened({ wave2: 1, rescue: 2, total: 4 });
    harness.respond = 'VERIFIED';
    harness.schedule(598_150, grid(129, 598_000));
    expect(await harness.run(selection, 'RESCUE', date)).toMatchObject({ state: 'VERIFIED' });
    expect(harness.posts).toHaveLength(1);
    expect(await journalState(root, selection)).toBe('verified');
    expect(session.status).toBe('OBJECTIVE_ACHIEVED');
    expect(nextRead(harness, session, 130, { closed: TARGET_CELLS })).toEqual([]);
    expect(nextRead(harness, session, 131)).toEqual([]);
    harness.schedule(harness.now + 1_150, grid(132, harness.now + 1_000));
    await harness.runLoop(choice => harness.run(choice, 'RESCUE', date));
    expect(harness.security).toHaveLength(1);
    expect(harness.posts).toHaveLength(1);
  });

  it('only positive evidence releases: a pre-fetch transport refusal does; a journal conflict inferred before begin does not', async () => {
    {
      // The transport refuses before its final gate and before fetch (dispatched=false): provably unsent.
      const { harness, session, selection, root } = await reopened();
      harness.refuseBeforeFetch = 'CURRENT_CHECKOUT_HEADERS_STALE';
      expect(await harness.run(selection, 'RESCUE', date)).toMatchObject({ state: 'NOT_DISPATCHED' });
      expect(harness.posts).toEqual([]);
      expect(harness.stages('PHASE3_SETTLED')).toEqual([expect.objectContaining({ state: 'NOT_DISPATCHED',
        code: 'CURRENT_CHECKOUT_HEADERS_STALE', budgetReleased: true })]);
      expect(await journalState(root, selection)).toBe('rejected');
      harness.refuseBeforeFetch = undefined;
      expect(nextRead(harness, session, 129)).toEqual([expect.objectContaining({ reopenEpoch: 127 })]);
    }
    {
      // Another writer holds this block's journal: NOT_DISPATCHED is inferred from the journal, not proven by the
      // dispatch path, so the reservation keeps consuming exactly as before this change.
      const { harness, session, selection, root } = await reopened();
      harness.afterReserve = () => journalFor(root, selection).begin(selection.candidate.logicalKey, new Date(),
        { attemptId: selection.candidate.logicalKey, ...busyJournal });
      expect(await harness.run(selection, 'RESCUE', date)).toMatchObject({ state: 'REJECTED' });
      expect(harness.posts).toEqual([]);
      expect(harness.stages('PHASE3_SETTLED')).toEqual([expect.objectContaining({ state: 'NOT_DISPATCHED',
        code: 'DUPLICATE_LOGICAL_BOOKING_BLOCKED', budgetReleased: false })]);
      expect(nextRead(harness, session, 129)).toEqual([]);
    }
  });
});

describe('other pre-POST exits are explicit, never silent', () => {
  it('abort, release time, journal, security and worker exits each log a reason', async () => {
    {
      const { harness, selection } = await reopened();
      harness.scheduleCall(598_000, () => { harness.aborted = true; });
      expect(await harness.run(selection, 'RESCUE', date)).toMatchObject({ reason: 'ABORTED' });
    }
    {
      const { harness, selection } = await reopened();
      harness.securityFails = true;
      expect(await harness.run(selection, 'RESCUE', date)).toMatchObject({ checkpoint: 'AFTER_SECURITY', reason: 'SECURITY_FAILED' });
    }
    {
      const { harness, selection } = await reopened();
      harness.workerReady = false;
      expect(await harness.run(selection, 'RESCUE', date)).toMatchObject({ checkpoint: 'BEFORE_SECURITY', reason: 'WORKER_UNAVAILABLE' });
      expect(harness.security).toEqual([]);
    }
    {
      // An unresolved (UNKNOWN) journal for the same logical block: the one-shot protection holds.
      const { harness, selection, root } = await reopened();
      const journal = journalFor(root, selection), key = selection.candidate.logicalKey;
      await journal.begin(key, new Date(), { attemptId: key, planFingerprint: 'a'.repeat(64), targetDate: date,
        courtIds: [2], hourlyBoundaries: [{ startTime: '17:00', endTime: '18:00' }], expectedBookingCount: 3, maximumAmount: 2100, stage: 'dispatching' });
      await journal.mark(key, 'unknown', new Date());
      expect(await harness.run(selection, 'RESCUE', date)).toMatchObject({ checkpoint: 'BEFORE_RESERVE', reason: 'JOURNAL_BLOCKED' });
      expect(harness.posts).toEqual([]);
    }
    {
      const { harness, session, selection } = await reopened();
      const result = revalidateAdaptiveAttempt({ session, candidate: selection.candidate, wave: 'RESCUE', selectedEvidenceSeq: 128,
        newestSeq: harness.newestSeq, nowMs: releaseMs + harness.now, securityRefreshMs: 2_500, aborted: false, verifiedHold: false,
        dispatchClockMs: releaseMs - 1 });
      expect(result).toEqual({ valid: false, reason: 'RELEASE_NOT_REACHED' });
    }
  });
  it('every adaptive telemetry event is accepted by the UI schema and carries no customer or security data', async () => {
    const { harness, selection } = await reopened();
    harness.schedule(598_150, grid(129, 598_000));
    await harness.run(selection, 'RESCUE', date);
    await settleTelemetry();
    const adaptive = harness.events.filter(value => /^PHASE3_(ADAPTIVE|EVIDENCE_REBASED|ATTEMPT_RESERVED|SETTLED)/.test(value.stage));
    expect(adaptive.length).toBeGreaterThan(3);
    for (const { stage, at: _at, ...extra } of adaptive)
      expect(UiEventSchema.safeParse({ type: 'apiStage', stage, elapsedMs: 0, ...extra }).success, stage).toBe(true);
    const text = JSON.stringify(harness.events);
    for (const secret of Object.values(SYNTHETIC_CUSTOMER)) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/turnstile|fingerprint|cookie|token/i);
  });
});

describe('revalidateAdaptiveAttempt is the one semantic rule', () => {
  it('keeps selection pricing unchanged and never swaps the candidate', async () => {
    const { harness, session, selection } = await reopened();
    const evidence = classifyActionableObservation(grid(129, 598_000), 129, releaseMs, releaseMs + 598_200, 6_000);
    expect(candidatePriceFromObservation(selection.candidate, evidence)).toEqual([700, 700, 700]);
    expect(candidatePriceFromObservation(selection.candidate, { ...evidence, fitness: 'FORENSIC_ONLY_STALE' })).toBeNull();
    expect(candidatePriceFromObservation(selection.candidate,
      classifyActionableObservation(grid(129, 598_000, { closed: ['2/19'] }), 129, releaseMs, releaseMs + 598_200, 6_000))).toBeNull();
    // Another candidate open in the newest read does not rescue a closed selected one.
    harness.advanceTo(598_150);
    harness.deliver(grid(129, 598_000, { closed: ['2/18'] }));
    const result = revalidateAdaptiveAttempt({ session, candidate: selection.candidate, wave: 'RESCUE', selectedEvidenceSeq: 128,
      newestSeq: harness.newestSeq, nowMs: releaseMs + harness.now, securityRefreshMs: 2_500, aborted: false, verifiedHold: false });
    expect(result).toEqual({ valid: false, reason: 'CANDIDATE_NO_LONGER_OPEN', seq: 129 });
  });
});
