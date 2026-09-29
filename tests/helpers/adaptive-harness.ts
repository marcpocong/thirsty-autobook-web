import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runAdaptiveAttempt, type AdaptiveAttemptDeps, type AdaptiveAttemptResult, type AdaptiveSelection } from '../../src/api-booking/adaptive-attempt.js';
import { BrowserSessionTransportError, type OndaBrowserSessionTransport } from '../../src/api-booking/browser-session-transport.js';
import { DurableSubmissionJournal, type SubmissionRecord } from '../../src/api-booking/durable-submission-journal.js';
import { adaptiveFitness, adaptiveMaxAgeMs, classifyActionableObservation, isActionableEvidenceFitness, type ActionableObservation,
  type PrecisionSession } from '../../src/api-booking/precision-phase3.js';
import { classifyPrecisionDispatchError } from '../../src/api-booking/precision-race.js';
import { submitDirectCheckout, type ProoflessCheckoutRequest } from '../../src/api-booking/proofless-checkout.js';
import type { BookingPlan } from '../../src/api-booking/types.js';
import {freshestAvailabilityObservation,type AvailabilityObservation} from '../../src/slot-evidence.js';

/**
 * Deterministic, offline stand-in for the release runner around runAdaptiveAttempt. Time is virtual
 * (milliseconds after release). Slot Watch observations are delivered exactly as the runner's adaptive
 * loop does (select the freshest represented state, then session.observe). Security preparation only moves
 * virtual time. Checkout goes through the real submitDirectCheckout and a real DurableSubmissionJournal
 * in `root`; the transport is fake and never touches the network.
 */
export const SYNTHETIC_CUSTOMER = { clientId: 'client', customerId: 'customer', customerEmail: 'synthetic@example.invalid',
  customerPhone: '09123456789', customerFirstName: 'Synthetic', customerLastName: 'Player' };
/**
 * Onda's answer to a POST that left the browser, raised exactly as the real transport's post() raises it:
 * REJECTED — HTTP 409 with a confirmed application conflict (journal: rejected);
 * UNKNOWN — fetch failed after dispatch (journal: unknown);
 * VERIFIED — a valid pending hold for exactly this request (journal: verified).
 */
export type PostResponse = 'REJECTED' | 'UNKNOWN' | 'VERIFIED';
export interface HarnessPost { attemptId: string; workerId: string; at: number; evidenceSeq: number | undefined; rates: number[]; candidateId: string }
export interface HarnessEvent { stage: string; at: number; [key: string]: string | number | boolean }
export interface HarnessSecurity { workerId: string; startedAt: number; completedAt: number; newestSeqAtCompletion: number | undefined }
type Arrival = { at: number; order: number } & ({ kind: 'observation'; observation: AvailabilityObservation } | { kind: 'call'; run: () => void });

export class AdaptiveHarness {
  now = 0;
  newestSeq = 0;
  securityRefreshMs = 2_500;
  aborted = false;
  verifiedHold = false;
  workerReady = true;
  securityFails = false;
  /** Security preparation durations, consumed in order (the last one repeats). */
  securityMs: number[] = [1_500];
  respond: PostResponse = 'REJECTED';
  /** A refusal the transport raises before its final gate and before fetch (dispatched=false), e.g. CURRENT_CHECKOUT_HEADERS_STALE. */
  refuseBeforeFetch?: string;
  /** Runs after reservation, before the durable journal entry is begun. */
  afterReserve?: () => Promise<void> | void;
  /** Runs inside the transport, after reservation and immediately before the final pre-POST gate. */
  beforeFinalGate?: () => void;
  /** Called after each delivered arrival (the adaptive loop uses it). */
  onArrival?: (arrival: { kind: 'observation'; evidence: ActionableObservation } | { kind: 'call' }) => void;
  readonly events: HarnessEvent[] = [];
  readonly posts: HarnessPost[] = [];
  readonly security: HarnessSecurity[] = [];
  readonly reservations: Array<{ attemptId: string; evidenceSeq: number; selectedEvidenceSeq: number; prices: readonly number[] }> = [];
  private readonly queue: Arrival[] = [];
  private order = 0;
  private securityCalls = 0;
  private attempts = 0;
  private readonly observations:AvailabilityObservation[]=[];

  constructor(readonly session: PrecisionSession, readonly root: string) {}
  get releaseMs(): number { return this.session.authorization.releaseMs; }

  schedule(at: number, observation: AvailabilityObservation): this {
    this.queue.push({ at, order: this.order++, kind: 'observation', observation });
    return this;
  }
  scheduleCall(at: number, run: () => void): this {
    this.queue.push({ at, order: this.order++, kind: 'call', run });
    return this;
  }
  get queued(): number { return this.queue.length; }
  nextArrivalAt(): number | undefined { return this.sorted()[0]?.at; }

  /** Same steps as the runner's adaptive loop for one received Slot Watch observation. */
  deliver(observation: AvailabilityObservation): ActionableObservation {
    this.observations.push(observation);
    const operational=freshestAvailabilityObservation(this.observations);
    this.newestSeq=operational?.seq??0;
    const maxAge = adaptiveMaxAgeMs(Math.max(0, observation.responseOffsetMs - observation.requestOffsetMs), this.securityRefreshMs);
    const evidence = classifyActionableObservation(observation, this.newestSeq, this.releaseMs, this.releaseMs + this.now, maxAge);
    if(operational)this.session.observe(adaptiveFitness(operational,this.newestSeq,this.releaseMs,this.releaseMs+this.now,this.securityRefreshMs));
    this.events.push({ stage: 'PHASE3_EVIDENCE', at: this.now, seq: observation.seq, fitness: evidence.fitness });
    return evidence;
  }

  /** Delivers every arrival due by `until`, in time order, then leaves the clock at `until`. */
  advanceTo(until: number, limit = Infinity): void {
    let delivered = 0;
    while (delivered < limit) {
      const next = this.sorted()[0];
      if (!next || next.at > until) break;
      this.queue.splice(this.queue.indexOf(next), 1);
      this.now = Math.max(this.now, next.at);
      delivered++;
      if (next.kind === 'observation') {
        const evidence = this.deliver(next.observation);
        this.onArrival?.({ kind: 'observation', evidence });
      } else { next.run(); this.onArrival?.({ kind: 'call' }); }
    }
    if (delivered < limit) this.now = Math.max(this.now, until);
  }

  /** Delivers exactly the next arrival (the adaptive loop's step). */
  step(): boolean {
    const next = this.sorted()[0];
    if (!next) return false;
    this.advanceTo(next.at, 1);
    return true;
  }

  deps(selection: AdaptiveSelection, date: string): AdaptiveAttemptDeps {
    const { candidate, workerId } = selection;
    const journal = new DurableSubmissionJournal(join(this.root, candidate.logicalKey));
    const clock = () => this.releaseMs + this.now;
    return {
      session: this.session, date, now: clock, dispatchNow: clock,
      newestSeq: () => this.newestSeq, securityRefreshMs: () => this.securityRefreshMs,
      aborted: () => this.aborted, verifiedHold: () => this.verifiedHold, workerReady: () => this.workerReady,
      prepareSecurity: async () => {
        const startedAt = this.now, duration = this.securityMs[Math.min(this.securityCalls++, this.securityMs.length - 1)]!;
        this.advanceTo(startedAt + duration);
        this.security.push({ workerId, startedAt, completedAt: this.now, newestSeqAtCompletion: this.session.latest?.observation.seq });
        if (this.securityFails) throw Error('SECURITY_PREWARM_FAILED');
        this.securityRefreshMs = Math.max(this.securityRefreshMs, duration);
      },
      journalReusable: async () => await journal.recycleReusable(candidate.logicalKey).catch(() => 'blocked' as const) !== 'blocked',
      reserve: async ({ plan, prices, evidenceSeq, selectedEvidenceSeq }) => {
        const attemptId = `harness-${workerId}-${++this.attempts}`;
        this.reservations.push({ attemptId, evidenceSeq, selectedEvidenceSeq, prices });
        const transport = { publicCheckoutProofless: async (request: ProoflessCheckoutRequest, _permit: unknown, options: { beforePost?: () => void }) => {
          if (this.refuseBeforeFetch) throw new BrowserSessionTransportError(this.refuseBeforeFetch);
          this.beforeFinalGate?.();
          options.beforePost?.();
          this.posts.push({ attemptId, workerId, at: this.now, candidateId: candidate.id, rates: request.items.map(item => item.rate),
            evidenceSeq: this.session.attempts.find(value => value.id === attemptId)?.evidenceSeq });
          if (this.respond === 'VERIFIED') return this.pendingHold(request, plan);
          if (this.respond === 'REJECTED') throw new BrowserSessionTransportError('ONDA_HTTP_STATUS_INVALID', true, undefined, true);
          throw new BrowserSessionTransportError('ONDA_TRANSPORT_FAILED', true);
        } } as unknown as OndaBrowserSessionTransport;
        return { attemptId, dispatch: async beforePost => {
          await this.afterReserve?.();
          await submitDirectCheckout(plan, SYNTHETIC_CUSTOMER, transport, journal, undefined, [], clock, { requirePreparedContext: true, beforePost });
          // As the runner's completeVerifiedProoflessHold does once a hold verifies.
          this.verifiedHold = true;
        } };
      },
      classifyFailure: error => classifyPrecisionDispatchError(error, async () => {
        try { return (await journal.read(candidate.logicalKey)).state; } catch { return undefined; } }),
      failureCode: error => error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message) ? error.message : 'PHASE3_ADAPTIVE_FAILED',
      event: (stage, extra) => { this.events.push({ stage, at: this.now, ...extra }); },
      // Pre-POST telemetry is recorded after the gate returns, as the runner does on a later macrotask.
      defer: callback => { queueMicrotask(callback); },
    };
  }

  run(selection: AdaptiveSelection, wave: 'WAVE_2' | 'RESCUE', date: string): Promise<AdaptiveAttemptResult> {
    return runAdaptiveAttempt(selection, wave, this.deps(selection, date));
  }

  /**
   * The runner's adaptive loop, one arrival at a time: a fresh observation with nothing pending selects
   * Rescue and runs the attempt (arrivals during it are delivered with the attempt pending). Wave 2 is
   * only recorded when selected; the loop stops, like the runner's, on a verified hold or UNKNOWN.
   */
  async runLoop(attempt: (selection: AdaptiveSelection) => Promise<unknown>, options: { wave2?: boolean } = {}): Promise<void> {
    let pending = false, trigger: ActionableObservation | undefined;
    const latency = (observation: AvailabilityObservation) => Math.max(0, observation.responseOffsetMs - observation.requestOffsetMs);
    this.onArrival = arrival => {
      if (arrival.kind === 'observation' && !pending && !trigger && isActionableEvidenceFitness(arrival.evidence.fitness)) trigger = arrival.evidence;
      const latest = this.session.latest;
      if (options.wave2 && latest) {
        const choices = this.session.select('WAVE_2', this.releaseMs + this.now, adaptiveMaxAgeMs(latency(latest.observation), this.securityRefreshMs));
        if (choices.length) this.wave2Selections.push({ at: this.now, seq: latest.observation.seq, candidateIds: choices.map(value => value.candidate.id) });
      }
    };
    try {
      while (this.step()) {
        const evidence = trigger;
        trigger = undefined;
        if (evidence && this.session.authorization.rescueEnabled &&
          isActionableEvidenceFitness(adaptiveFitness(evidence.observation, this.newestSeq, this.releaseMs, this.releaseMs + this.now, this.securityRefreshMs).fitness)) {
          const choices = this.session.select('RESCUE', this.releaseMs + this.now, adaptiveMaxAgeMs(latency(evidence.observation), this.securityRefreshMs));
          if (choices.length) {
            pending = true;
            try { await Promise.all(choices.map(choice => attempt(choice))); } finally { pending = false; }
          }
        }
        if (this.verifiedHold || this.session.attempts.some(value => value.state === 'UNKNOWN')) break;
      }
    } finally { this.onArrival = undefined; }
  }
  readonly wave2Selections: Array<{ at: number; seq: number; candidateIds: string[] }> = [];

  stages(name: string): HarnessEvent[] { return this.events.filter(value => value.stage === name); }

  /** Durable records the journal archived for `key` (recycleReusable moves a whole attempt directory there). */
  async archivedRecords(kind: 'rejected-attempts' | 'unsent-attempts' | 'expired-holds', key: string): Promise<SubmissionRecord[]> {
    let entries: string[];
    try { entries = (await readdir(join(this.root, kind))).filter(name => name.startsWith(key)).sort(); } catch { return []; }
    return Promise.all(entries.map(name => new DurableSubmissionJournal(join(this.root, kind, name)).read(key)));
  }

  /** A pending hold that passes the production response validator for exactly this request. */
  private pendingHold(request: ProoflessCheckoutRequest, plan: BookingPlan): unknown {
    const ids = request.items.map((_, index) => `harness-booking-${index}`), first = request.items[0]!, last = request.items.at(-1)!;
    const holdExpiresAt = new Date(this.releaseMs + this.now + 10 * 60_000).toISOString();
    return { success: true,
      bookings: request.items.map((item, index) => ({ id: ids[index], booking_no: `harness-${index}`, customer_id: SYNTHETIC_CUSTOMER.customerId,
        space_id: item.spaceId, facility_id: item.facilityId, date: item.date, start_time: `${item.startTime}:00`, end_time: `${item.endTime}:00`,
        duration: 60, rate: item.rate, guest_count: 1, booking_status: 'pending', payment_status: 'pending', booking_session_id: 'harness-session',
        hold_expires_at: holdExpiresAt })),
      bookingSessions: [{ requestSessionRef: 'session_1', bookingSessionId: 'harness-session', facilityId: request.facilityId, spaceId: first.spaceId,
        date: first.date, startTime: `${first.startTime}:00`, endTime: `${last.endTime}:00`, durationHours: plan.durationHours, bookingIds: ids }],
      transaction: { id: 'harness-transaction', reference: 'harness-0', amount: plan.totalPrice, status: 'pending' }, trustedTotalAmount: plan.totalPrice };
  }

  private sorted(): Arrival[] { return [...this.queue].sort((a, b) => a.at - b.at || a.order - b.order); }
}
