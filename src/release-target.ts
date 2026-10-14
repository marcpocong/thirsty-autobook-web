import { COURT_REGISTRY, type Wing } from './court-registry.js';

export interface ExactReleaseTarget {
  wing: Wing; spaceId: string; bookingDate: string;
  court: number; start: string; durationHours: number;
}
export function exactReleaseTarget(value: { wing?: Wing; spaceId?: string; bookingDate?: string; court: number; start: string; durationHours: number }, legacyDate?: string): ExactReleaseTarget {
  const wing = value.wing ?? 'MANGO', bookingDate = value.bookingDate ?? legacyDate ?? '';
  const registered = COURT_REGISTRY.find(c => c.wing === wing && c.number === value.court);
  if (!registered || (value.spaceId !== undefined && value.spaceId !== registered.spaceId)) throw Error('RELEASE_TARGET_SPACE_MISMATCH');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate) || !Number.isFinite(Date.parse(`${bookingDate}T00:00:00Z`)) || new Date(`${bookingDate}T00:00:00Z`).toISOString().slice(0,10) !== bookingDate) throw Error('RELEASE_TARGET_DATE_INVALID');
  if (!/^(0[89]|1\d|2[0-3]):00$/.test(value.start) || !Number.isInteger(value.durationHours) || value.durationHours < 1 || value.durationHours > 3 || Number(value.start.slice(0,2)) + value.durationHours > 24) throw Error('RELEASE_TARGET_RANGE_INVALID');
  return { wing, spaceId: registered.spaceId, bookingDate, court: value.court, start: value.start, durationHours: value.durationHours };
}
export const releaseTargetEnd = (target: Pick<ExactReleaseTarget,'start'|'durationHours'>) => `${String(Number(target.start.slice(0,2)) + target.durationHours).padStart(2,'0')}:00`;
export function canonicalReleaseTargetId(value: ExactReleaseTarget): string {
  const target = exactReleaseTarget(value);
  return `v2:${target.wing}:${target.spaceId}:${target.bookingDate}:${target.start}:${releaseTargetEnd(target)}:${target.durationHours}h`;
}
