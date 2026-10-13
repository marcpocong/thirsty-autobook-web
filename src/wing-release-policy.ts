import { DateTime } from 'luxon';
import type { Wing } from './court-registry.js';
import type { AvailabilitySnapshot } from './api-booking/types.js';

/** Calendar-day offset, not the public site's inclusive "3 days" label. */
export interface WingReleasePolicy {
  wing: Wing; timezone: 'Asia/Manila'; horizonOffsetDays: number;
  releaseTime: string; evidence: string;
}
export const WING_RELEASE_POLICIES: Readonly<Record<Wing, WingReleasePolicy | null>> = Object.freeze({
  MANGO: Object.freeze({ wing: 'MANGO', timezone: 'Asia/Manila', horizonOffsetDays: 2,
    releaseTime: '08:00:00', evidence: 'Existing Mango offset; public facility metadata 2026-10-14: 3 days, 08:00:00' }),
  // Observed Buko dates through Oct 19 at 02:xx on Oct 14 do not prove
  // a recurring release time, rolling window, or inclusive day count.
  BUKO: null,
});
export function releaseForTarget(date: string, wing: Wing, policy = WING_RELEASE_POLICIES[wing]): DateTime {
  if (!policy || policy.wing !== wing || policy.timezone !== 'Asia/Manila' || !policy.evidence.trim() ||
    !Number.isSafeInteger(policy.horizonOffsetDays) || policy.horizonOffsetDays < 0 || policy.horizonOffsetDays > 31 ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(policy.releaseTime)) throw Error('WING_RELEASE_POLICY_UNKNOWN');
  const target = DateTime.fromISO(date, { zone: policy.timezone });
  if (!target.isValid || target.toISODate() !== date) throw Error('WING_TARGET_DATE_INVALID');
  return DateTime.fromISO(`${target.minus({ days: policy.horizonOffsetDays }).toISODate()}T${policy.releaseTime}`, { zone: policy.timezone });
}
export type WingTargetState = 'AVAILABLE NOW' | 'NOT YET RELEASED' | 'FULLY BOOKED' | 'UNKNOWN / NEEDS VERIFICATION';
export interface WingWorkflow { state: WingTargetState; workflow: 'BOOK_AVAILABLE_NOW' | 'PREPARE_FOR_RELEASE' | 'NONE'; releaseAt?: string }
/** All requested cells must be explicit before declaring fully booked. Missing
 * records and a facility-wide true flag do not establish publication of a wing.
 * The caller must supply a fresh parsed snapshot, never persisted historical data.
 */
export function wingWorkflow(input: { wing: Wing; date: string; courts: number[]; hours: string[];
  snapshot?: AvailabilitySnapshot; now: Date; policy?: WingReleasePolicy | null }): WingWorkflow {
  const unknown: WingWorkflow = { state: 'UNKNOWN / NEEDS VERIFICATION', workflow: 'NONE' };
  const { snapshot, wing, date, now } = input;
  const keys = input.courts.flatMap(court => input.hours.map(hour => `${court}/${hour}`));
  if (!keys.length || new Set(keys).size !== keys.length || input.courts.some(c => !Number.isInteger(c) || c < 1 || c > 7) ||
    input.hours.some(h => !/^(0[89]|1\d|2[0-3]):00$/.test(h)) || !Number.isFinite(now.getTime())) return unknown;
  if (snapshot && (snapshot.wing ?? 'MANGO') !== wing) return unknown;
  const age = snapshot ? now.getTime() - Date.parse(snapshot.capturedAt) : NaN;
  if (!snapshot || !Number.isFinite(age) || age < 0 || age > 15000) return unknown;
  const slots = snapshot.slots.filter(slot => slot.date === date);
  const selected = keys.map(key => slots.find(slot => `${slot.court}/${slot.startTime}` === key));
  if (selected.every(slot => slot?.isAvailable)) return { state: 'AVAILABLE NOW', workflow: 'BOOK_AVAILABLE_NOW' };
  // One open hour does not authorize a longer target; a wing can publish only
  // part of a date. Explicit closed cells before a known release can represent
  // "not released yet", rather than fully booked (observed for Mango Oct 16).
  if (selected.some(slot => slot?.isAvailable)) return unknown;
  const policy = input.policy === undefined ? WING_RELEASE_POLICIES[wing] : input.policy;
  if (selected.every(slot => slot !== undefined)) {
    try { if (now.getTime() < releaseForTarget(date,wing,policy).toMillis()) return unknown; }
    catch { return unknown; }
    return { state: 'FULLY BOOKED', workflow: 'NONE' };
  }
  let release: DateTime;
  try { release = releaseForTarget(date, wing, policy); } catch { return unknown; }
  // Partial publication is not an unreleased wing; never schedule its missing cells.
  if (slots.length || !snapshot.emptyUnreleasedResponse || now.getTime() >= release.toMillis()) return unknown;
  return { state: 'NOT YET RELEASED', workflow: 'PREPARE_FOR_RELEASE', releaseAt: release.toISO()! };
}
