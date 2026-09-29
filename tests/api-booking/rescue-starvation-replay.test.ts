import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdaptiveSelection } from '../../src/api-booking/adaptive-attempt.js';
import { adaptiveFitness, authorizePrecision, isActionableEvidenceFitness, PrecisionSession, type CandidateInput } from '../../src/api-booking/precision-phase3.js';
import type { AvailabilityObservation } from '../../src/slot-evidence.js';
import type { WorkerId } from '../../src/workers.js';
import { AdaptiveHarness } from '../helpers/adaptive-harness.js';

/**
 * September 26 Rescue starvation, replayed offline from the archived run (diagnostics-archive/2026-09-26):
 * the frozen Phase 3 authorization, every Slot Watch observation at the moment the runner processed it,
 * Wave 1's real start/settle times, and G's four measured security preparations (1481/1196/1238/1558 ms).
 *
 * It proves only that Rescue no longer fails because the Slot Watch sequence changed while the same
 * candidate stayed actionable. It does not predict Onda's answer: each replayed POST is treated as
 * rejected, and someone else took both reopened blocks by #136.
 */
const archive = resolve(import.meta.dirname, '../../diagnostics-archive/2026-09-26');
const ndjson = (path: string) => readFileSync(join(archive, path), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
const freeze = JSON.parse(readFileSync(join(archive, 'logs/phase3-freeze.json'), 'utf8')) as {
  authorization: { date: string; releaseMs: number; candidates: Array<CandidateInput & { id: string }>; wave1: Array<{ workerId: WorkerId; candidateId: string }>;
    standby: WorkerId[]; budgets: { wave2: number; rescue: number; total: number }; concurrentWave2: boolean; rescueEnabled: boolean;
    authorizedAt: string; fingerprint: string } };
const progress = ndjson('logs/run-progress.ndjson'), watch = ndjson('logs/slot-watch.ndjson');
const codex = JSON.parse(readFileSync(join(archive, 'codex/analysis.json'), 'utf8')) as {
  refreshes: Array<{ selectedSeq: number; latestSeqAtCompletion: number; durationMs: number }> };
const frozen = freeze.authorization, releaseMs = frozen.releaseMs, date = frozen.date;
const offset = (at: unknown) => Date.parse(String(at)) - releaseMs;
const stages = (name: string) => progress.filter(line => line.stage === name);
/** G's security preparations after 08:00, in order, as measured in the live run. */
const G_PREPARATIONS = stages('SECURITY_PREPARATION_COMPLETED').filter(line => line.workerId === 'G' && offset(line.at) > 0)
  .map(line => Number(line.durationMs));
const C2_1700 = frozen.candidates.find(value => value.court === 2 && value.start === '17:00')!.id;

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function september26(securityMs = G_PREPARATIONS) {
  const authorization = authorizePrecision({ date, releaseMs,
    candidates: frozen.candidates.map(({ court, start, durationHours, priority, permissions, rateEvidence }) =>
      ({ court, start, durationHours, priority, permissions, rateEvidence })),
    wave1: frozen.wave1, standby: frozen.standby, budgets: frozen.budgets, concurrentWave2: frozen.concurrentWave2,
    rescueEnabled: frozen.rescueEnabled, authorizedAt: frozen.authorizedAt });
  // The rebuilt authorization is byte-for-byte the one frozen on September 26.
  expect(authorization.fingerprint).toBe(frozen.fingerprint);
  const session = new PrecisionSession(authorization), root = await mkdtemp(join(tmpdir(), 'rescue-replay-'));
  roots.push(root);
  const harness = new AdaptiveHarness(session, root);
  harness.now = -61_000;
  harness.securityMs = [...securityMs];
  const bySeq = new Map(watch.filter(line => line.type === 'availability').map(line => [line.seq as number, line as unknown as AvailabilityObservation]));
  for (const line of stages('PHASE3_EVIDENCE')) harness.schedule(offset(line.at), bySeq.get(line.seq as number)!);
  for (const line of stages('PHASE3_WAVE1_STARTED')) harness.scheduleCall(offset(line.at), () => session.record({ id: String(line.attemptId),
    candidateId: String(line.candidateId), workerId: line.workerId as WorkerId, wave: 'WAVE_1', state: 'IN_FLIGHT' }));
  for (const line of stages('PHASE3_SETTLED')) harness.scheduleCall(offset(line.at), () => {
    session.attempts.find(value => value.id === line.attemptId)!.state = line.state === 'REJECTED' ? 'REJECTED' : 'UNKNOWN'; });
  return { harness, session };
}

/**
 * The adaptive attempt as it was before this fix (desktop-runner.ts at 06114db, lines 883–891): after
 * security preparation it returned, without logging, unless the newest read was the very read it was selected from.
 */
function legacyAttempt(harness: AdaptiveHarness, outcomes: Array<{ selectedSeq: number; candidateId: string; outcome: string }>) {
  return async (selection: AdaptiveSelection) => {
    const deps = harness.deps(selection, date), record = (outcome: string) =>
      outcomes.push({ selectedSeq: selection.evidenceSeq, candidateId: selection.candidate.id, outcome });
    await deps.prepareSecurity();
    const current = harness.session.latest, attempts = harness.session.attempts;
    if (!current || current.observation.seq !== selection.evidenceSeq ||
      !isActionableEvidenceFitness(adaptiveFitness(current.observation, harness.newestSeq, releaseMs, deps.now(), harness.securityRefreshMs).fitness) ||
      harness.verifiedHold || harness.aborted || attempts.some(value => value.state === 'UNKNOWN' || value.state === 'VERIFIED') ||
      attempts.some(value => value.state === 'IN_FLIGHT')) { record('SILENT_RETURN'); return; }
    record('PASSED_SEQUENCE_GUARD');
  };
}

describe('September 26 replay: Rescue sequence churn', () => {
  it('uses the archived run: G prepared security four times after release', () => {
    expect(G_PREPARATIONS).toEqual([1481, 1196, 1238, 1558]);
    expect(stages('PHASE3_ATTEMPT_RESERVED')).toEqual([]);
  });

  it('the pre-fix rule starves exactly as observed: #128→#129, #130→#131, #132→#133, #134→#135, and no POST', async () => {
    const { harness } = await september26();
    const outcomes: Array<{ selectedSeq: number; candidateId: string; outcome: string }> = [];
    await harness.runLoop(legacyAttempt(harness, outcomes), { wave2: true });
    expect(harness.security.map(value => [value.startedAt, value.newestSeqAtCompletion]))
      .toEqual([[597_365, 129], [599_117, 131], [601_162, 133], [603_140, 135]]);
    expect(outcomes).toEqual([128, 130, 132, 134].map(selectedSeq => ({ selectedSeq, candidateId: C2_1700, outcome: 'SILENT_RETURN' })));
    // Same reconstruction as the forensic report (§11) and Codex's analysis of the live run.
    expect(harness.security.map((value, index) => ({ selectedSeq: outcomes[index]!.selectedSeq, latestSeqAtCompletion: value.newestSeqAtCompletion,
      durationMs: value.completedAt - value.startedAt }))).toEqual(codex.refreshes.map(({ selectedSeq, latestSeqAtCompletion, durationMs }) =>
      ({ selectedSeq, latestSeqAtCompletion, durationMs })));
    expect(harness.posts).toEqual([]);
    expect(harness.wave2Selections).toEqual([]);
  });

  it('the corrected rule rebases #128 → #129 and makes exactly one Rescue POST for C2 17:00–20:00 on G', async () => {
    const { harness, session } = await september26();
    await harness.runLoop(choice => harness.run(choice, 'RESCUE', date), { wave2: true });
    expect(harness.security.map(value => [value.workerId, value.startedAt, value.newestSeqAtCompletion])).toEqual([['G', 597_365, 129]]);
    expect(harness.stages('PHASE3_EVIDENCE_REBASED')).toEqual([expect.objectContaining({ workerId: 'G', candidateId: C2_1700, wave: 'RESCUE',
      checkpoint: 'AFTER_SECURITY', fromSeq: 128, toSeq: 129 })]);
    expect(harness.stages('PHASE3_ADAPTIVE_SKIPPED')).toEqual([]);
    expect(harness.posts).toEqual([expect.objectContaining({ workerId: 'G', candidateId: C2_1700, evidenceSeq: 129, at: 598_846,
      rates: [700, 700, 700] })]);
    expect(session.attempts.filter(value => value.wave === 'RESCUE')).toEqual([expect.objectContaining({ workerId: 'G', candidateId: C2_1700,
      selectedEvidenceSeq: 128, evidenceSeq: 129, state: 'REJECTED' })]);
    // Budget (Rescue 1) and the reopen epoch still hold: no further Rescue for the rest of the log.
    expect(harness.queued).toBe(0);
    expect(harness.wave2Selections).toEqual([]);
  });

  it('even a 7 s preparation spanning #129–#135 still dispatches once, on #135', async () => {
    const { harness } = await september26([7_000]);
    await harness.runLoop(choice => harness.run(choice, 'RESCUE', date));
    expect(harness.stages('PHASE3_EVIDENCE_REBASED').map(value => [value.fromSeq, value.toSeq])).toEqual([[128, 135]]);
    expect(harness.posts.map(value => [value.evidenceSeq, value.at])).toEqual([[135, 604_365]]);
  });

  it('an 8 s preparation ends after #136 took the block: no POST, CANDIDATE_NO_LONGER_OPEN', async () => {
    const { harness } = await september26([8_000]);
    await harness.runLoop(choice => harness.run(choice, 'RESCUE', date));
    expect(harness.stages('PHASE3_ADAPTIVE_SKIPPED')).toEqual([expect.objectContaining({ workerId: 'G', candidateId: C2_1700,
      checkpoint: 'AFTER_SECURITY', reason: 'CANDIDATE_NO_LONGER_OPEN', seq: 136 })]);
    expect(harness.posts).toEqual([]);
  });

  it('an injected pre-fetch refusal of the first attempt does not burn the only Rescue: #130 → #131 is still sent once', async () => {
    const { harness, session } = await september26();
    let reservations = 0;
    // Fault injection on the real timeline (no observation is altered): the transport refuses the first reservation before fetch.
    harness.afterReserve = () => { harness.refuseBeforeFetch = reservations++ === 0 ? 'CURRENT_CHECKOUT_HEADERS_STALE' : undefined; };
    await harness.runLoop(choice => harness.run(choice, 'RESCUE', date), { wave2: true });
    expect(harness.security.map(value => [value.startedAt, value.newestSeqAtCompletion])).toEqual([[597_365, 129], [599_117, 131]]);
    expect(harness.stages('PHASE3_SETTLED').map(value => [value.state, value.budgetReleased]))
      .toEqual([['NOT_DISPATCHED', true], ['REJECTED', false]]);
    expect(harness.posts).toEqual([expect.objectContaining({ workerId: 'G', candidateId: C2_1700, evidenceSeq: 131, at: 600_313 })]);
    expect(session.attempts.filter(value => value.wave === 'RESCUE').map(value => [value.state, value.selectedEvidenceSeq, value.evidenceSeq]))
      .toEqual([['NOT_DISPATCHED', 128, 129], ['REJECTED', 130, 131]]);
  });
});
