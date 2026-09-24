import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Offline Phase 4 fixtures: synthetic Slot Watch logs and runner traces in a temporary root. */
export const NOW_MS = Date.parse('2026-12-01T00:00:00.000Z');
export const HOURS = Array.from({ length: 16 }, (_, index) => `${String(index + 8).padStart(2, '0')}:00`);
/** 'court/HH:00' → code; everything else `fill`. */
export function matrix(states: Record<string, string> = {}, fill = 'O') {
  return Array.from({ length: 7 }, (_, court) => `${court + 1}:${HOURS.map(hour => states[`${court + 1}/${hour}`] ?? fill).join('')}`).join(',');
}
export const prices = (evening = 700, day = 600) => Array.from({ length: 7 }, () => HOURS.map(hour => Number(hour.slice(0, 2)) >= 16 ? evening : day));
export interface ReadSpec { seq: number; request: number; response: number; states?: Record<string, string>; published?: boolean; cache?: string | null; ageS?: number; outcome?: 'ok' | 'failed'; fill?: string; noPrices?: boolean }
export function availability(spec: ReadSpec) {
  const published = spec.published ?? true;
  return { type: 'availability', seq: spec.seq, scheduledOffsetMs: spec.request, requestOffsetMs: spec.request, responseOffsetMs: spec.response,
    outcome: spec.outcome ?? 'ok', targetDatePresent: published, ...(spec.outcome === 'failed' ? { code: 'READ_FAILED' } : {
      matrix: published ? matrix(spec.states, spec.fill) : matrix({}, 'U'), ...(published && !spec.noPrices ? { prices: prices() } : {}) }),
    ...(spec.cache === null ? {} : { cache: { status: spec.cache ?? 'MISS', ...(spec.ageS !== undefined ? { ageS: spec.ageS } : {}) } }) };
}
export function bookings(seq: number, request: number, cells: string[], failedCourts: number[] = []) {
  return { type: 'bookings', seq, scheduledOffsetMs: request, requestOffsetMs: request, responseOffsetMs: request + 300, outcome: 'ok', failedCourts, cells };
}
export function v2Log(date: string, releaseMs: number, reads: ReadSpec[], bookingLines: unknown[] = []) {
  return [{ type: 'header', version: 2, id: `fixture-${date}`, date, releaseMs, schedule: { availability: [0, 250, 500, 1000], maxInFlight: 6 } },
    ...reads.map(availability), ...bookingLines].map(line => JSON.stringify(line)).join('\n') + '\n';
}
export function v1Log(date: string, releaseMs: number, polls: Array<{ seq: number; request: number; response: number; released: boolean; states?: Record<string, string> }>) {
  const iso = (offset: number) => new Date(releaseMs + offset).toISOString();
  return [{ type: 'header', version: 1, id: 'fixture-v1', date, releaseAt: new Date(releaseMs).toISOString() },
    ...polls.map(poll => ({ type: 'poll', seq: poll.seq, requestedAt: iso(poll.request), respondedAt: iso(poll.response), availability: 'ok',
      dateReleased: poll.released, matrix: poll.released ? matrix(poll.states) : matrix({}, '?') }))].map(line => JSON.stringify(line)).join('\n') + '\n';
}
export function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'phase4-'));
  for (const folder of ['slot-watch', 'api-booking/run-progress', 'release-forensics', 'booking-runs', 'benchmarks']) mkdirSync(join(root, '.local', folder), { recursive: true });
  return root;
}
export const write = (root: string, path: string, content: string) => { mkdirSync(join(root, '.local', path, '..'), { recursive: true }); writeFileSync(join(root, '.local', path), content); };
export const ndjson = (lines: unknown[]) => lines.map(line => JSON.stringify(line)).join('\n') + '\n';
/** Two well-observed Saturday releases (targets Oct 3 and Oct 10, released two days earlier at 08:00 Manila). */
export const SAT1 = { date: '2026-10-03', releaseMs: Date.parse('2026-10-01T00:00:00.000Z') };
export const SAT2 = { date: '2026-10-10', releaseMs: Date.parse('2026-10-08T00:00:00.000Z') };
export function twoSaturdays(root: string) {
  write(root, `slot-watch/${SAT1.date}_a.ndjson`, v2Log(SAT1.date, SAT1.releaseMs, [
    { seq: 1, request: -2000, response: -1800, published: false },
    { seq: 2, request: 0, response: 1200, states: { '3/19:00': 'X', '5/08:00': 'X' } },
    { seq: 3, request: 500, response: 1500, states: { '3/19:00': 'X', '5/08:00': 'X', '7/19:00': 'X' } },
    { seq: 4, request: 1000, response: 1800, states: { '3/19:00': 'X', '5/08:00': 'X', '7/19:00': 'X' } },
    { seq: 5, request: 2000, response: 2600, states: { '5/08:00': 'X', '7/19:00': 'X' } },
  ], [bookings(1, 1500, ['3/19:00'])]));
  write(root, `slot-watch/${SAT2.date}_b.ndjson`, v2Log(SAT2.date, SAT2.releaseMs, [
    { seq: 1, request: 0, response: 1000 }, { seq: 2, request: 1000, response: 1600 },
  ]));
}
