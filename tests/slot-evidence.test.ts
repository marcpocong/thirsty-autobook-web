import { describe, expect, it } from 'vitest';
import { MATRIX_COURTS, MATRIX_HOURS } from '../src/api-booking/court-hour-matrix.js';
import { deriveSlotEvidence, rangeHours, rangeState, targetEvidence, type AvailabilityObservation, type BookingObservation } from '../src/slot-evidence.js';

/** Matrix with every cell `fill`, then per-cell overrides like { '3/15:00': 'X' }. */
function matrix(fill: string, cells: Record<string, string> = {}) {
  return MATRIX_COURTS.map(court => `${court}:${MATRIX_HOURS.map(hour => cells[`${court}/${hour}`] ?? fill).join('')}`).join(',');
}
const read = (seq: number, requestOffsetMs: number, responseOffsetMs: number, cells?: Record<string, string>, published = true): AvailabilityObservation =>
  ({ seq, scheduledOffsetMs: requestOffsetMs, requestOffsetMs, responseOffsetMs, outcome: 'ok', targetDatePresent: published, matrix: published ? matrix('O', cells) : matrix('?') });
const bookings = (seq: number, requestOffsetMs: number, responseOffsetMs: number, cells: string[], failedCourts: number[] = []): BookingObservation =>
  ({ seq, scheduledOffsetMs: requestOffsetMs, requestOffsetMs, responseOffsetMs, outcome: 'ok', failedCourts, cells });

describe('target range evidence', () => {
  it('maps the exact target range to its court/hours only', () => {
    expect(rangeHours('15:00', '18:00')).toEqual(['15:00', '16:00', '17:00']);
    expect(rangeHours('22:00', '00:00')).toEqual(['22:00', '23:00']);
    expect(rangeHours('18:00', '15:00')).toEqual([]);
    // An unavailable hour just outside the range (18:00) and on another court must not touch the target.
    const evidence = targetEvidence([read(1, 250, 900, { '3/18:00': 'X', '4/16:00': 'X' })], [], { court: 3, startTime: '15:00', endTime: '18:00' });
    expect(evidence.hours).toEqual(['15:00', '16:00', '17:00']);
    expect(evidence.firstPublished).toMatchObject({ state: 'FULLY_OPEN', observation: { seq: 1, requestOffsetMs: 250, responseOffsetMs: 900 } });
  });

  it('a multi-hour target is FULLY_OPEN only when every hour is open, and UNKNOWN when any hour is unknown', () => {
    expect(rangeState(['OPEN', 'OPEN', 'OPEN'])).toBe('FULLY_OPEN');
    expect(rangeState(['OPEN', 'UNAVAILABLE', 'OPEN'])).toBe('PARTIALLY_UNAVAILABLE');
    expect(rangeState(['UNAVAILABLE', 'UNAVAILABLE'])).toBe('FULLY_UNAVAILABLE');
    expect(rangeState(['OPEN', 'UNKNOWN', 'OPEN'])).toBe('UNKNOWN_INCOMPLETE');
    expect(rangeState(['UNAVAILABLE', 'UNKNOWN'])).toBe('UNKNOWN_INCOMPLETE');
    expect(rangeState([])).toBe('UNKNOWN_INCOMPLETE');
    const partial = targetEvidence([read(1, 0, 400, { '6/16:00': 'X' })], [], { court: 6, startTime: '15:00', endTime: '18:00' });
    expect(partial.firstPublished).toMatchObject({ state: 'PARTIALLY_UNAVAILABLE', hours: [{ hour: '15:00', state: 'OPEN' }, { hour: '16:00', state: 'UNAVAILABLE' }, { hour: '17:00', state: 'OPEN' }] });
    const incomplete = targetEvidence([read(1, 0, 400, { '6/17:00': '?' })], [], { court: 6, startTime: '15:00', endTime: '18:00' });
    expect(incomplete.firstPublished?.state).toBe('UNKNOWN_INCOMPLETE');
    const none = targetEvidence([read(1, 0, 400, undefined, false)], [], { court: 6, startTime: '15:00', endTime: '18:00' });
    expect(none.firstPublished).toBeNull();
    expect(none.latest.state).toBe('UNKNOWN_INCOMPLETE');
  });

  it('tracks first unavailable, public record (by hour) and a reopen of the whole range, in request order', () => {
    const availability = [read(1, 0, 6_000), read(2, 250, 700, { '3/16:00': 'X' }), read(3, 1_000, 1_100, { '3/16:00': 'X' }), read(4, 60_000, 60_100)];
    const records = [bookings(1, -60_000, -59_900, []), bookings(2, 2_000, 2_300, ['3/16:00', '5/10:00'])];
    const evidence = targetEvidence(availability, records, { court: 3, startTime: '15:00', endTime: '18:00' });
    expect(evidence.firstPublished).toMatchObject({ state: 'FULLY_OPEN', observation: { seq: 1 } });
    expect(evidence.firstFullyOpen).toEqual({ seq: 1, requestOffsetMs: 0, responseOffsetMs: 6_000 });
    expect(evidence.firstUnavailable).toEqual({ observation: { seq: 2, requestOffsetMs: 250, responseOffsetMs: 700 }, hours: ['16:00'] });
    expect(evidence.firstRecord).toEqual({ observation: { seq: 2, requestOffsetMs: 2_000, responseOffsetMs: 2_300 }, hours: ['16:00'] });
    expect(evidence.reopen).toEqual({ before: { seq: 3, requestOffsetMs: 1_000, responseOffsetMs: 1_100 }, after: { seq: 4, requestOffsetMs: 60_000, responseOffsetMs: 60_100 }, overlapping: false,confidence:'UNKNOWN' });
    expect(evidence.latest).toEqual({ observation: { seq: 4, requestOffsetMs: 60_000, responseOffsetMs: 60_100 }, state: 'FULLY_OPEN',
      freshness:{class:'UNBOUNDED',ageUpperBoundMs:null,representedAtLowerBoundOffsetMs:null} });
  });

  it('a public booking record is presence only: a failed court query is unknown, never "no record"', () => {
    const records = [bookings(1, -60_000, -59_900, ['3/16:00']), bookings(2, 2_000, 2_300, [], [3]), bookings(3, 10_000, 10_100, [])];
    const evidence = deriveSlotEvidence([read(1, 0, 400)], records);
    const cell = evidence.cells.find(value => value.court === 3 && value.hour === '16:00')!;
    expect(cell.firstRecord).toEqual({ observation: { seq: 1, requestOffsetMs: -60_000, responseOffsetMs: -59_900 }, previous: null });
    expect(cell.recordRemoved?.observation.seq).toBe(3);
    expect(cell.latest.record).toBe(false);
  });
});

describe('slot evidence derivation', () => {
  it('ignores failed and cancelled reads, and does not treat a read without the date as publication', () => {
    const failed: AvailabilityObservation = { seq: 2, scheduledOffsetMs: 250, requestOffsetMs: 250, responseOffsetMs: 5_250, outcome: 'failed', code: 'AVAILABILITY_READ_TIMEOUT', targetDatePresent: false };
    const evidence = deriveSlotEvidence([read(1, 0, 90, undefined, false), failed, read(3, 500, 4_000, { '1/08:00': 'X' })]);
    expect(evidence.publication).toEqual({ lastUnpublished: { seq: 1, requestOffsetMs: 0, responseOffsetMs: 90 },
      firstPublished: { seq: 3, requestOffsetMs: 500, responseOffsetMs: 4_000 }, firstPublishedResponse: { seq: 3, requestOffsetMs: 500, responseOffsetMs: 4_000 } });
    expect(evidence.current?.seq).toBe(3);
    expect(evidence.cells.find(cell => cell.court === 1 && cell.hour === '08:00')!.firstPublished?.state).toBe('UNAVAILABLE');
  });

  it('marks overlapping reads around a change instead of ordering them by response time', () => {
    const evidence = deriveSlotEvidence([read(2, 250, 2_000), read(3, 500, 900, { '3/15:00': 'X' })]);
    expect(evidence.cells.find(cell => cell.court === 3 && cell.hour === '15:00')!.openToUnavailable).toEqual({
      before: { seq: 2, requestOffsetMs: 250, responseOffsetMs: 2_000 }, after: { seq: 3, requestOffsetMs: 500, responseOffsetMs: 900 }, overlapping: true });
    // Earliest REQUEST with the date is #2 even though #3 answered first.
    expect(evidence.publication.firstPublished?.seq).toBe(2);
    expect(evidence.publication.firstPublishedResponse?.seq).toBe(3);
  });

  it('uses the freshest represented state, so a newer STALE Age 10 response cannot replace an older MISS Age 0 response',()=>{
    const fresh={...read(1,1_000,1_200,{'7/19:00':'X'}),cache:{status:'MISS',ageS:0}};
    const stale={...read(2,2_000,2_100),cache:{status:'STALE',ageS:10}};
    const newerFresh={...read(3,3_000,3_200),cache:{status:'MISS',ageS:0}};
    expect(deriveSlotEvidence([fresh,stale]).current?.seq).toBe(1);
    expect(deriveSlotEvidence([fresh,stale]).cells.find(cell=>cell.court===7&&cell.hour==='19:00')?.latest.state).toBe('UNAVAILABLE');
    expect(deriveSlotEvidence([fresh,stale,newerFresh]).current?.seq).toBe(3);
  });
});
