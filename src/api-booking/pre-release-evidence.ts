import type { AvailabilitySnapshot } from './types.js';
import type { PublicBookingRecords } from './public-bookings.js';
import type { PublicBookingBlock } from './proofless-checkout.js';
import { targetDateState, type TargetDateState } from './court-hour-matrix.js';
import { LiveAvailabilityError } from './live-availability-provider.js';

/** Bounded, rate-respectful retries: the first read plus at most two more. */
export const PRE_RELEASE_RETRY_DELAYS_MS = [5_000, 15_000] as const;

export interface PreReleaseEvidence {
  snapshot?: AvailabilitySnapshot;
  /** Network-corrected time the successful availability response arrived. */
  observedAtMs?: number;
  availabilityAttempts: number;
  blocks: PublicBookingBlock[];
  failedCourts: number[];
  bookingAttempts: number;
  dateState: TargetDateState;
}

export interface PreReleaseEvidenceOptions {
  date: string;
  releaseMs: number;
  readAvailability: () => Promise<AvailabilitySnapshot | undefined>;
  readBookings: () => Promise<PublicBookingRecords>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  retryDelaysMs?: readonly number[];
  onRead?: (read: { source: 'availability' | 'bookings'; attempt: number; ok: boolean; failedCourts?: number[];code?:string;httpStatus?:number;requestSent?:boolean }) => void;
}

/** Fills courts that failed in `first` from a later read; a court never recovered stays failed. */
export function mergeBookingReads(first: PublicBookingRecords, next: PublicBookingRecords): PublicBookingRecords {
  const recovered = first.failedCourts.filter(court => !next.failedCourts.includes(court));
  return { blocks: [...first.blocks, ...next.blocks.filter(block => recovered.includes(block.court))],
    failedCourts: first.failedCourts.filter(court => next.failedCourts.includes(court)) };
}

/**
 * One pre-release evidence checkpoint. Availability and public-booking reads
 * retry independently a bounded number of times. A read that still fails is
 * reported as failed, never as "unreleased" or "no booking".
 */
export async function readPreReleaseEvidence(options: PreReleaseEvidenceOptions): Promise<PreReleaseEvidence> {
  const delays = options.retryDelaysMs ?? PRE_RELEASE_RETRY_DELAYS_MS;
  const availability = (async () => {
    for (let attempt = 1; ; attempt++) {
      let error:unknown;
      const snapshot = await options.readAvailability().catch(value => {error=value;return undefined;});
      const observedAtMs = options.now();
      options.onRead?.({ source: 'availability', attempt, ok: !!snapshot,
        ...(error instanceof LiveAvailabilityError?{code:error.code,httpStatus:error.httpStatus,requestSent:error.requestSent}:{}) });
      const refused=error instanceof LiveAvailabilityError&&([401,403,429].includes(error.httpStatus??0)||error.requestSent===false);
      if (snapshot || refused || attempt > delays.length) return { snapshot, observedAtMs, attempts: attempt };
      await options.sleep(delays[attempt - 1]!);
    }
  })();
  const bookings = (async () => {
    let merged: PublicBookingRecords | undefined;
    for (let attempt = 1; ; attempt++) {
      const read = await options.readBookings().catch(() => ({ blocks: [], failedCourts: [1, 2, 3, 4, 5, 6, 7] }));
      merged = merged ? mergeBookingReads(merged, read) : read;
      options.onRead?.({ source: 'bookings', attempt, ok: !merged.failedCourts.length, failedCourts: merged.failedCourts });
      if (!merged.failedCourts.length || attempt > delays.length) return { records: merged, attempts: attempt };
      await options.sleep(delays[attempt - 1]!);
    }
  })();
  const [a, b] = await Promise.all([availability, bookings]);
  return { ...(a.snapshot ? { snapshot: a.snapshot, observedAtMs: a.observedAtMs } : {}), availabilityAttempts: a.attempts,
    blocks: b.records.blocks, failedCourts: b.records.failedCourts, bookingAttempts: b.attempts,
    dateState: targetDateState(a.snapshot, options.date, { releaseMs: options.releaseMs, observedAtMs: a.observedAtMs }) };
}

/** Current, factual evidence for one exact court/time target. It never claims a
 * venue block: "unavailable without public booking" is an observation only. */
export type TargetEvidence =
  | 'PUBLIC_BOOKING_PRESENT'
  | 'UNAVAILABLE_WITH_PUBLIC_BOOKING'
  | 'UNAVAILABLE_WITHOUT_PUBLIC_BOOKING'
  | 'UNKNOWN'
  | 'NO_PUBLIC_BOOKING_DATE_UNRELEASED'
  | 'CONFIRMED_OPEN';
const SEVERITY: readonly TargetEvidence[] = ['PUBLIC_BOOKING_PRESENT', 'UNAVAILABLE_WITH_PUBLIC_BOOKING',
  'UNAVAILABLE_WITHOUT_PUBLIC_BOOKING', 'UNKNOWN', 'NO_PUBLIC_BOOKING_DATE_UNRELEASED', 'CONFIRMED_OPEN'];
export const ELIGIBLE_TARGET_EVIDENCE: ReadonlySet<TargetEvidence> = new Set(['NO_PUBLIC_BOOKING_DATE_UNRELEASED', 'CONFIRMED_OPEN']);

export const TARGET_EVIDENCE_LABEL: Record<TargetEvidence, string> = {
  PUBLIC_BOOKING_PRESENT: 'Public booking present',
  UNAVAILABLE_WITH_PUBLIC_BOOKING: 'Unavailable with public booking record',
  UNAVAILABLE_WITHOUT_PUBLIC_BOOKING: 'Unavailable without public booking record',
  UNKNOWN: 'Unknown / read failed',
  NO_PUBLIC_BOOKING_DATE_UNRELEASED: 'No known booking · target date not yet published',
  CONFIRMED_OPEN: 'Confirmed open (published)',
};

const hourEnd = (hour: string) => `${String(Number(hour.slice(0, 2)) + 1).padStart(2, '0')}:00`;

export function classifyTargetEvidence(target: { court: number; start: string; durationHours: number },
  evidence: Pick<PreReleaseEvidence, 'snapshot' | 'blocks' | 'failedCourts' | 'dateState'>, date: string):
  { evidence: TargetEvidence; eligible: boolean; hours: Array<{ hour: string; evidence: TargetEvidence }> } {
  const first = Number(target.start.slice(0, 2));
  const hours = Array.from({ length: target.durationHours }, (_, index) => `${String(first + index).padStart(2, '0')}:00`).map(hour => {
    const record = evidence.blocks.some(block => block.court === target.court && block.startTime < hourEnd(hour) && block.endTime > hour);
    const slot = evidence.snapshot?.slots.find(value => value.date === date && value.court === target.court && value.startTime === hour);
    let value: TargetEvidence;
    if (record) value = evidence.dateState === 'RELEASED' && slot ? (slot.isAvailable ? 'UNKNOWN' : 'UNAVAILABLE_WITH_PUBLIC_BOOKING') : 'PUBLIC_BOOKING_PRESENT';
    else if (evidence.failedCourts.includes(target.court)) value = 'UNKNOWN';
    else if (evidence.dateState === 'UNRELEASED') value = 'NO_PUBLIC_BOOKING_DATE_UNRELEASED';
    else if (evidence.dateState === 'RELEASED' && slot) value = slot.isAvailable ? 'CONFIRMED_OPEN' : 'UNAVAILABLE_WITHOUT_PUBLIC_BOOKING';
    else value = 'UNKNOWN';
    return { hour, evidence: value };
  });
  const worst = SEVERITY.find(level => hours.some(hour => hour.evidence === level)) ?? 'UNKNOWN';
  return { evidence: worst, eligible: ELIGIBLE_TARGET_EVIDENCE.has(worst), hours };
}
