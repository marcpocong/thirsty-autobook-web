import type { WorkerId } from '../workers.js';
import { pricedPrecisionPlan, revalidateAdaptiveAttempt, type AdaptiveRevalidation, type AdaptiveSkipReason,
  type AuthorizedCandidate, type PrecisionSession, type RaceAttempt } from './precision-phase3.js';
import type { PrecisionDispatchResult } from './precision-race.js';
import { SubmissionDispatchError } from './submission-errors.js';
import type { BookingPlan } from './types.js';

/**
 * One adaptive (Wave 2 / Rescue) attempt, from security preparation to settlement. Every checkpoint
 * applies the same semantic rule (revalidateAdaptiveAttempt): a newer Slot Watch read that still shows
 * the SAME candidate fully open and fresh becomes the effective evidence; anything else stops the
 * attempt with an explicit reason. Browser, journal and file work is injected by the release runner.
 */
export interface AdaptiveSelection { candidate: AuthorizedCandidate; workerId: WorkerId; prices: number[]; evidenceSeq: number; reopenEpoch?: number }
export type AdaptiveCheckpoint = 'BEFORE_SECURITY' | 'AFTER_SECURITY' | 'BEFORE_RESERVE' | 'BEFORE_POST';
export interface AdaptiveReservation {
  attemptId: string;
  /** Runs the durable-journal checkout; `beforePost` is its final synchronous gate before the request leaves. */
  dispatch(beforePost: () => void): Promise<void>;
}
export interface AdaptiveAttemptDeps {
  session: PrecisionSession; date: string;
  /** Network-corrected wall clock, used for evidence freshness. */
  now(): number;
  /** Release clock, used for the release-time guard immediately before POST. */
  dispatchNow(): number;
  newestSeq(): number; securityRefreshMs(): number; aborted(): boolean; verifiedHold(): boolean;
  workerReady(): boolean;
  prepareSecurity(): Promise<void>;
  journalReusable(): Promise<boolean>;
  /** Persists the attempt and binds its request to `plan`; nothing is sent. */
  reserve(input: { plan: BookingPlan; prices: readonly number[]; evidenceSeq: number; selectedEvidenceSeq: number }): Promise<AdaptiveReservation>;
  classifyFailure(error: unknown): Promise<PrecisionDispatchResult>;
  failureCode(error: unknown): string;
  event(stage: string, extra: Record<string, string | number | boolean>): void;
  /** Schedules telemetry raised inside the pre-POST gate (default: next macrotask). */
  defer?(callback: () => void): void;
}
export type AdaptiveAttemptResult =
  | { outcome: 'SKIPPED'; checkpoint: AdaptiveCheckpoint; reason: AdaptiveSkipReason }
  | { outcome: 'SETTLED'; attemptId: string; state: RaceAttempt['state']; selectedEvidenceSeq: number; evidenceSeq: number;
    guardClosed?: AdaptiveSkipReason }
  | { outcome: 'FAILED'; code: string };

export async function runAdaptiveAttempt(selection: AdaptiveSelection, wave: 'WAVE_2' | 'RESCUE',
  deps: AdaptiveAttemptDeps): Promise<AdaptiveAttemptResult> {
  const { candidate, workerId } = selection, selectedEvidenceSeq = selection.evidenceSeq;
  const defer = deps.defer ?? (callback => { setImmediate(callback); });
  const context = { workerId, candidateId: candidate.id, wave };
  let attempt: RaceAttempt | undefined, effectiveSeq = selectedEvidenceSeq, prices: readonly number[] = selection.prices;
  const skip = (checkpoint: AdaptiveCheckpoint, rejection: Extract<AdaptiveRevalidation, { valid: false }> | { reason: AdaptiveSkipReason }) => {
    const detail = rejection as { seq?: number; fitness?: string };
    deps.event('PHASE3_ADAPTIVE_SKIPPED', { ...context, checkpoint, reason: rejection.reason, selectedEvidenceSeq,
      ...(detail.seq !== undefined ? { seq: detail.seq } : {}), ...(detail.fitness ? { fitness: detail.fitness } : {}) });
    return { outcome: 'SKIPPED', checkpoint, reason: rejection.reason } as const;
  };
  const revalidate = (checkpoint: AdaptiveCheckpoint) => revalidateAdaptiveAttempt({ session: deps.session, candidate, wave,
    selectedEvidenceSeq, newestSeq: deps.newestSeq(), nowMs: deps.now(), securityRefreshMs: deps.securityRefreshMs(),
    aborted: deps.aborted(), verifiedHold: deps.verifiedHold(),
    ...(checkpoint === 'BEFORE_POST' ? { dispatchClockMs: deps.dispatchNow(), ownAttemptId: attempt?.id, lockedPrices: prices } : {}) });
  /** Adopts the newest valid evidence (and its prices) as the attempt's effective evidence. */
  const adopt = (checkpoint: AdaptiveCheckpoint, result: Extract<AdaptiveRevalidation, { valid: true }>,
    emit: (stage: string, extra: Record<string, string | number | boolean>) => void, announce = true) => {
    if (result.evidenceSeq !== effectiveSeq) {
      emit('PHASE3_EVIDENCE_REBASED', { ...context, checkpoint, fromSeq: effectiveSeq, toSeq: result.evidenceSeq, selectedEvidenceSeq,
        priceChanged: result.prices.length !== prices.length || result.prices.some((price, index) => price !== prices[index]) });
      effectiveSeq = result.evidenceSeq;
      if (attempt) attempt.evidenceSeq = effectiveSeq;
      announce = true;
    }
    prices = result.prices;
    if (announce) emit('PHASE3_ADAPTIVE_REVALIDATED', { ...context, checkpoint, evidenceSeq: effectiveSeq, selectedEvidenceSeq });
  };
  try {
    if (!deps.workerReady()) return skip('BEFORE_SECURITY', { reason: 'WORKER_UNAVAILABLE' });
    try { await deps.prepareSecurity(); } catch { return skip('AFTER_SECURITY', { reason: 'SECURITY_FAILED' }); }
    const afterSecurity = revalidate('AFTER_SECURITY');
    if (!afterSecurity.valid) return skip('AFTER_SECURITY', afterSecurity);
    adopt('AFTER_SECURITY', afterSecurity, deps.event);
    if (!(await deps.journalReusable())) return skip('BEFORE_RESERVE', { reason: 'JOURNAL_BLOCKED' });
    const beforeReserve = revalidate('BEFORE_RESERVE');
    if (!beforeReserve.valid) return skip('BEFORE_RESERVE', beforeReserve);
    adopt('BEFORE_RESERVE', beforeReserve, deps.event);
    // The request carries exactly the effective evidence's prices; the final gate requires they still hold.
    const plan = pricedPrecisionPlan(candidate, deps.date, prices);
    const reservation = await deps.reserve({ plan, prices, evidenceSeq: effectiveSeq, selectedEvidenceSeq });
    attempt = { id: reservation.attemptId, candidateId: candidate.id, workerId, wave, state: 'IN_FLIGHT', evidenceSeq: effectiveSeq,
      selectedEvidenceSeq, ...(selection.reopenEpoch !== undefined ? { reopenEpoch: selection.reopenEpoch } : {}) };
    deps.session.record(attempt);
    deps.event('PHASE3_ATTEMPT_RESERVED', { ...context, evidenceSeq: effectiveSeq, selectedEvidenceSeq, attemptId: attempt.id,
      amount: plan.totalPrice, court: candidate.court, startTime: candidate.start, endTime: candidate.end });
    let guardClosed: AdaptiveSkipReason | undefined, postChecked = false;
    const reserved = attempt;
    try {
      await reservation.dispatch(() => {
        // Synchronous and I/O-free: runs immediately before the request leaves (and again as the transport's last step).
        const result = revalidate('BEFORE_POST');
        if (!result.valid) {
          guardClosed = result.reason;
          defer(() => { skip('BEFORE_POST', result); });
          throw new SubmissionDispatchError('PHASE3_DISPATCH_GUARD_CLOSED', false);
        }
        const events: Array<[string, Record<string, string | number | boolean>]> = [];
        adopt('BEFORE_POST', result, (stage, extra) => { events.push([stage, extra]); }, !postChecked);
        postChecked = true;
        if (events.length) defer(() => { for (const [stage, extra] of events) deps.event(stage, extra); });
      });
      reserved.state = 'VERIFIED';
    } catch (error) {
      const settled = await deps.classifyFailure(error);
      reserved.state = settled.state === 'REJECTED' || settled.state === 'NOT_DISPATCHED' ? 'REJECTED' :
        settled.state === 'QR_READY' || settled.state === 'HOLD_VERIFIED_QR_ATTENTION' ? 'VERIFIED' : 'UNKNOWN';
      deps.event('PHASE3_SETTLED', { ...context, attemptId: reserved.id, state: settled.state, code: settled.code ?? 'COMPLETED' });
    }
    return { outcome: 'SETTLED', attemptId: reserved.id, state: reserved.state, selectedEvidenceSeq, evidenceSeq: effectiveSeq,
      ...(guardClosed ? { guardClosed } : {}) };
  } catch (error) {
    if (attempt) attempt.state = 'UNKNOWN';
    const code = deps.failureCode(error);
    deps.event('PHASE3_ADAPTIVE_FAILED', { ...context, code });
    return { outcome: 'FAILED', code };
  }
}
