import type { AvailabilitySnapshot } from './types.js';

export const MATRIX_COURTS = [1, 2, 3, 4, 5, 6, 7] as const;
export const MATRIX_HOURS = Array.from({ length: 16 }, (_, index) => `${String(index + 8).padStart(2, '0')}:00`);

/** What Onda's public availability says about one court-hour at the moment it was read. */
export type SlotState = 'OPEN' | 'TAKEN' | 'UNRELEASED' | 'UNKNOWN';
export const SLOT_STATE_CODE: Record<SlotState, string> = { OPEN: 'O', TAKEN: 'X', UNRELEASED: 'U', UNKNOWN: '?' };
export type CourtHourStates = Record<number, Record<string, SlotState>>;

/** When the read was answered, relative to the release it is judged against (both network-corrected epoch ms). */
export interface ReleaseObservationContext { releaseMs?: number; observedAtMs?: number }
export type TargetDateState = 'RELEASED' | 'UNRELEASED' | 'UNKNOWN';
/** Clock uncertainty allowance: an empty response this close to release is not trusted as "unreleased". */
export const UNRELEASED_OBSERVATION_MARGIN_MS = 1_000;

/**
 * Whether one snapshot shows the target date as published. Onda omits an
 * unpublished date (`dates: {}`) instead of flagging it `false`, so a missing
 * date counts as UNRELEASED only for that exact empty response and only when
 * the response arrived before the known release instant. A failed read, a
 * partial response, an unknown release time, or a date missing after release
 * stays UNKNOWN and fails closed.
 */
export function targetDateState(snapshot: AvailabilitySnapshot | undefined, date: string,
  context: ReleaseObservationContext = {}): TargetDateState {
  const flag = snapshot?.returnedDates[date];
  if (flag === true) return 'RELEASED';
  if (flag === false) return 'UNRELEASED';
  const { releaseMs, observedAtMs } = context;
  if (!snapshot?.emptyUnreleasedResponse || releaseMs === undefined || observedAtMs === undefined ||
    !Number.isFinite(releaseMs) || !Number.isFinite(observedAtMs)) return 'UNKNOWN';
  return observedAtMs < releaseMs - UNRELEASED_OBSERVATION_MARGIN_MS ? 'UNRELEASED' : 'UNKNOWN';
}

/**
 * Classifies all 112 cells from one availability snapshot. A published slot is
 * OPEN or TAKEN; a missing slot on a date Onda has not released yet is
 * UNRELEASED; anything else (failed read, missing slot on a released date) is
 * UNKNOWN and never treated as open.
 */
export function courtHourStates(snapshot: AvailabilitySnapshot | undefined, date: string,
  context: ReleaseObservationContext = {}): CourtHourStates {
  const released = ({ RELEASED: true, UNRELEASED: false, UNKNOWN: undefined } as const)[targetDateState(snapshot, date, context)];
  const states: CourtHourStates = {};
  for (const court of MATRIX_COURTS) {
    states[court] = {};
    for (const hour of MATRIX_HOURS) {
      const slot = snapshot?.slots.find(value => value.date === date && value.court === court && value.startTime === hour);
      states[court]![hour] = slot ? (slot.isAvailable ? 'OPEN' : 'TAKEN') : released === false ? 'UNRELEASED' : 'UNKNOWN';
    }
  }
  return states;
}

/** Compact exact matrix, one row per court: `1:OOXX…` in 08:00→23:00 order. */
export function encodeCourtHourStates(states: CourtHourStates): string {
  return MATRIX_COURTS.map(court => `${court}:${MATRIX_HOURS.map(hour => SLOT_STATE_CODE[states[court]?.[hour] ?? 'UNKNOWN']).join('')}`).join(',');
}

export function countCourtHourStates(states: CourtHourStates): Record<SlotState, number> {
  const counts: Record<SlotState, number> = { OPEN: 0, TAKEN: 0, UNRELEASED: 0, UNKNOWN: 0 };
  for (const court of MATRIX_COURTS) for (const hour of MATRIX_HOURS) counts[states[court]?.[hour] ?? 'UNKNOWN']++;
  return counts;
}
