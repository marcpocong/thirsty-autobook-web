import type { Wing } from './court-registry.js';

/**
 * Renderer-safe copy of the configured wing release calendar. Dependency-free so the Booking Setup
 * compiler, the renderer and the main process derive the same dates. Asia/Manila has no daylight
 * saving, so a fixed +08:00 offset is exact. wing-release-policy.ts re-exports these constants and
 * its Luxon implementation is test-checked against releaseInstantFor below.
 */
export type WingReleaseStatus = 'VERIFIED' | 'PROVISIONAL' | 'OWNER_ASSUMED' | 'UNKNOWN';
export interface WingReleasePolicy {
  wing: Wing; timezone: 'Asia/Manila'; horizonOffsetDays: number;
  releaseTime: string; evidence: string;
  status?: WingReleaseStatus; publicLabel?: string; observedAt?: string;
}
export const WING_RELEASE_POLICIES: Readonly<Record<Wing, WingReleasePolicy | null>> = Object.freeze({
  MANGO: Object.freeze({ wing: 'MANGO', timezone: 'Asia/Manila', horizonOffsetDays: 2,
    releaseTime: '08:00:00', status: 'VERIFIED', publicLabel: '3 days inclusive', evidence: 'Existing Mango offset; public facility metadata 2026-10-14: 3 days, 08:00:00' }),
  // The +6 date rule is observed on consecutive days; the 08:00 instant is owner-approved planning, not yet observed.
  // PROVISIONAL is planning and offline rehearsal only: assertVerifiedRelease still refuses it.
  BUKO: Object.freeze({ wing: 'BUKO', timezone: 'Asia/Manila', horizonOffsetDays: 6, releaseTime: '08:00:00', status: 'PROVISIONAL', publicLabel: 'five days in advance (observed as release date +6 calendar days)', observedAt: '2026-10-15', evidence: 'Date rule observed on consecutive days: official booking-page banner 2026-10-14 showed Buko Oct 20; on 2026-10-15 the owner saw Buko Oct 21 as the newest date and the read-only availability check confirmed Oct 21 published and Oct 22 unreleased at 12:43 Manila. The 08:00 release instant is owner-approved planning and has not been observed' }),
});

const MANILA_OFFSET_MS = 8 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
export const isIsoDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
/** Calendar date in Manila for an epoch instant. */
export const manilaDate = (epochMs: number) => new Date(epochMs + MANILA_OFFSET_MS).toISOString().slice(0, 10);
export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const releaseMsOn = (releaseDate: string, releaseTime: string) => Date.parse(`${releaseDate}T${releaseTime}+08:00`);
const usablePolicy = (policy: WingReleasePolicy | null | undefined, wing: Wing): policy is WingReleasePolicy =>
  !!policy && policy.status !== 'UNKNOWN' && policy.wing === wing && policy.timezone === 'Asia/Manila' && !!policy.evidence.trim() &&
  Number.isSafeInteger(policy.horizonOffsetDays) && policy.horizonOffsetDays >= 0 && policy.horizonOffsetDays <= 31 &&
  /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(policy.releaseTime);

/** Estimated release instant (epoch ms) that publishes `date` for `wing`. Never an authorization. */
export function releaseInstantFor(date: string, wing: Wing, policy = WING_RELEASE_POLICIES[wing]): number {
  if (!usablePolicy(policy, wing)) throw Error('WING_RELEASE_POLICY_UNKNOWN');
  if (!isIsoDate(date)) throw Error('WING_TARGET_DATE_INVALID');
  return releaseMsOn(addDays(date, -policy.horizonOffsetDays), policy.releaseTime);
}
/** The next release strictly after `nowMs`, and the booking date it publishes for this wing. */
export function nextReleaseFor(nowMs: number, wing: Wing, policy = WING_RELEASE_POLICIES[wing]) {
  if (!usablePolicy(policy, wing)) throw Error('WING_RELEASE_POLICY_UNKNOWN');
  let releaseDate = manilaDate(nowMs);
  if (releaseMsOn(releaseDate, policy.releaseTime) <= nowMs) releaseDate = addDays(releaseDate, 1);
  const releaseMs = releaseMsOn(releaseDate, policy.releaseTime);
  return { releaseMs, releaseAt: new Date(releaseMs).toISOString(), bookingDate: addDays(releaseDate, policy.horizonOffsetDays), status: policy.status ?? 'UNKNOWN' };
}
/** Booking dates that are already published (open for Normal booking) for this wing at `nowMs`. */
export const latestPublishedDate = (nowMs: number, wing: Wing) => addDays(nextReleaseFor(nowMs, wing).bookingDate, -1);
