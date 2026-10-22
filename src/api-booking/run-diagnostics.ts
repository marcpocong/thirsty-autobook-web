import { performance } from 'node:perf_hooks';
import type { WorkerId } from '../workers.js';
import type { AvailabilitySnapshot } from './types.js';
import { countCourtHourStates, courtHourStates, encodeCourtHourStates, type ReleaseObservationContext } from './court-hour-matrix.js';
import type { ApiRunProgressLog } from './run-progress-log.js';

export type DiagnosticLane = 'core';
export type DiagnosticAttemptType = 'early' | 'official' | 'retry';
export type DiagnosticOperation = 'availability' | 'security' | 'slotCheck' | 'checkout';
export interface DiagnosticCorrelation {
  workerId?: WorkerId;
  lane?: DiagnosticLane;
  attemptId?: string;
  attemptType?: DiagnosticAttemptType;
}
type DiagnosticValue = string | number | boolean;
type DiagnosticExtra = Record<string, DiagnosticValue>;

const safeCode = /^[A-Z][A-Z0-9_]{0,79}$/;
const allowedFields = new Set([
  'workerId','lane','attemptId','attemptType','operation','timingKind','eventAt','durationMs','networkDurationMs',
  'status','statusCode','requestSent','failureCategory','dispatchState','initiationEvidence','resultCategory','success','isAvailable',
  'targetDatePresent','responseComplete','slotCount','availableCount','takenCount','unreleasedCount','unknownCount',
  'courtHourSummary','securitySource','preparedContextAgeMs','challengeFrame','failedHelper',
  'challengeState','activeAvailability','activeSecurity','activeSlotChecks','activeCheckouts','droppedCount','retryCount',
  'verifiedHoldCount','qrHandoffCount','partialHolds','coreElapsedMs','slowestStages',
  'absentEvidence','finalCode','aborted','workerOutcome','court','startTime','durationHours','price','responseObserved',
  'releaseLatenessMs','checkpoint','errorHint','responseSource','responseBytes','bodyShape','calibrationUncertaintyMs',
]);

export function diagnosticLaneForWorker(_workerId: WorkerId): DiagnosticLane {
  return 'core';
}

export function safeDiagnosticCode(error: unknown, fallback: string): string {
  return error instanceof Error && safeCode.test(error.message) ? error.message : fallback;
}

/** Keep diagnostic payloads scalar and allowlisted even if a hook is accidentally called with raw data. */
export function sanitizeDiagnosticExtra(extra: Record<string, unknown>): DiagnosticExtra {
  const safe: DiagnosticExtra = {};
  for (const [key, value] of Object.entries(extra)) {
    if (!allowedFields.has(key) || !['string','number','boolean'].includes(typeof value)) continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    if (typeof value === 'string' && (value.length > 240 || /(?:https?:\/\/|token|cookie|fingerprint|authorization)/i.test(value))) continue;
    safe[key] = value as DiagnosticValue;
  }
  return safe;
}

/**
 * Exact court-by-hour state of one availability read, for the run trace.
 * `courtHourSummary` is `court:08→23 codes` with O open, X taken, U unreleased, ? unknown.
 */
export function availabilityObservation(snapshot: AvailabilitySnapshot, targetDate: string, context?: ReleaseObservationContext): DiagnosticExtra {
  const targetDatePresent = snapshot.returnedDates[targetDate] === true;
  const states = courtHourStates(snapshot, targetDate, context), counts = countCourtHourStates(states);
  return { targetDatePresent, responseComplete: targetDatePresent && !snapshot.incompleteDates.includes(targetDate),
    slotCount: snapshot.slots.length, availableCount: counts.OPEN, takenCount: counts.TAKEN,
    unreleasedCount: counts.UNRELEASED, unknownCount: counts.UNKNOWN, courtHourSummary: encodeCourtHourStates(states) };
}

interface StoredObservation { stage: string; elapsedMs: number; extra: DiagnosticExtra }

export class RunDiagnostics {
  private readonly active: Record<DiagnosticOperation, number> = { availability: 0, security: 0, slotCheck: 0, checkout: 0 };
  private readonly observations: StoredObservation[] = [];
  private attemptCounter = 0;
  private finished = false;

  constructor(private readonly log: ApiRunProgressLog, private readonly started = performance.now(),
    private readonly wallClock: () => Date = () => new Date(), private readonly monotonic: () => number = () => performance.now()) {}

  nextAttemptId(lane: DiagnosticLane, workerId: WorkerId, attemptType: DiagnosticAttemptType): string {
    return `${lane}-${workerId}-${attemptType}-${++this.attemptCounter}`;
  }

  /**
   * Captures the event time now but records it on a later macrotask. Used on the
   * release hot path so diagnostics bookkeeping runs after every POST has started.
   */
  observeDeferred(stage: string, correlation: DiagnosticCorrelation = {}, extra: Record<string, unknown> = {}): void {
    const timing = { wall: this.wallClock(), mono: this.monotonic() };
    setImmediate(() => this.observe(stage, correlation, extra, timing));
  }

  observe(stage: string, correlation: DiagnosticCorrelation = {}, extra: Record<string, unknown> = {},
    timing?: { wall: Date; mono: number }): void {
    try {
      const elapsedMs = Math.max(0, Math.round((timing?.mono ?? this.monotonic()) - this.started));
      const at = (timing?.wall ?? this.wallClock()).toISOString();
      const safe = sanitizeDiagnosticExtra({ ...correlation, timingKind: 'EVENT_TIMESTAMP', eventAt: at, ...extra,
        activeAvailability: this.active.availability, activeSecurity: this.active.security,
        activeSlotChecks: this.active.slotCheck, activeCheckouts: this.active.checkout });
      this.observations.push({ stage, elapsedMs, extra: safe });
      this.log.recordDiagnostic(stage, at, elapsedMs, safe);
    } catch { /* Diagnostics must never change a booking outcome. */ }
  }

  begin(operation: DiagnosticOperation, stage: string, correlation: DiagnosticCorrelation = {},
    extra: Record<string, unknown> = {}): (endStage: string, endExtra?: Record<string, unknown>) => void {
    const began = this.monotonic();
    this.active[operation]++;
    this.observe(stage, correlation, { ...extra, operation });
    let ended = false;
    return (endStage, endExtra = {}) => {
      if (ended) return;
      ended = true;
      this.active[operation] = Math.max(0, this.active[operation] - 1);
      this.observe(endStage, correlation, { ...endExtra, operation, timingKind: 'MEASURED_DURATION',
        durationMs: Math.max(0, Math.round(this.monotonic() - began)) });
    };
  }

  finish(finalCode: string, aborted: boolean): void {
    if (this.finished) return;
    this.finished = true;
    const laneElapsed = (lane: DiagnosticLane) => {
      const events = this.observations.filter(value => value.extra.lane === lane);
      return events.length ? Math.max(...events.map(value => value.elapsedMs)) - Math.min(...events.map(value => value.elapsedMs)) : 0;
    };
    const durations = this.observations.flatMap(value => {
      const duration = typeof value.extra.networkDurationMs === 'number' ? value.extra.networkDurationMs
        : typeof value.extra.durationMs === 'number' ? value.extra.durationMs : undefined;
      return duration === undefined ? [] : [{ stage: value.stage, duration }];
    }).sort((a, b) => b.duration - a.duration).slice(0, 5);
    const stages = new Set(this.observations.map(value => value.stage));
    const holds = this.observations.filter(value => value.stage === 'DIAGNOSTIC_VERIFIED_HOLD').length;
    const qr = this.observations.filter(value => value.stage === 'DIAGNOSTIC_QR_HANDOFF').length;
    const attempts = this.observations.filter(value => value.stage === 'DIAGNOSTIC_ATTEMPT_STARTED');
    const absent: string[] = [];
    if (!stages.has('AVAILABILITY_REQUEST_COMPLETED')) absent.push('availability-response');
    if (attempts.length && !stages.has('SECURITY_PREPARATION_COMPLETED')) absent.push('security-completion');
    if (stages.has('CHECKOUT_FUNCTION_ENTERED') && !stages.has('CHECKOUT_HTTP_POST_INITIATED')) absent.push('post-initiation');
    if (stages.has('CHECKOUT_HTTP_POST_INITIATED') && !stages.has('CHECKOUT_RESPONSE_COMPLETED')) absent.push('checkout-response');
    if (holds > qr) absent.push('qr-handoff');
    if (!attempts.some(value => value.extra.lane === 'core')) absent.push('core-attempt');
    this.observe('RUN_DIAGNOSTIC_SUMMARY', {}, { finalCode, aborted,
      retryCount: attempts.filter(value => value.extra.attemptType === 'retry').length,
      verifiedHoldCount: holds, qrHandoffCount: qr, partialHolds: holds > 0 && qr < holds,
      coreElapsedMs: laneElapsed('core'),
      slowestStages: durations.map(value => `${value.stage}:${value.duration}`).join(','),
      absentEvidence: absent.length ? absent.join(',') : 'NONE' });
  }
}
