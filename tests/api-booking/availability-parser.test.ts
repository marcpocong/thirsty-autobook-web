import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { availabilityFixture } from '../availability-fixture.js';
import { AvailabilityValidationError, COURT_TO_SPACE_ID, parseAvailability } from '../../src/api-booking/availability-parser.js';

const fixturePath = fileURLToPath(new URL('../../src/api-booking/fixtures/onda-availability-snapshot-2026-09-17.json', import.meta.url));
const historical = JSON.parse(readFileSync(fixturePath, 'utf8')) as any;
const historicalOptions = {
  startDate: '2026-09-17', endDate: '2026-09-19', capturedAt: '2026-09-17T12:00:00.000Z',
  fixtureKind: 'captured-historical' as const, label: 'SANITIZED HISTORICAL SNAPSHOT',
  now: new Date('2026-09-17T12:01:00.000Z'), maximumAgeMs: 120_000,
};

function code(error: unknown) {
  expect(error).toBeInstanceOf(AvailabilityValidationError);
  return (error as AvailabilityValidationError).code;
}

describe('captured historical availability parsing', () => {
  it('rejects impossible dates and false date flags with available slots', () => {
    expect(() => parseAvailability(historical, { ...historicalOptions, startDate: '2026-02-31' }))
      .toThrowError('AVAILABILITY_DATE_INVALID');
    const raw = structuredClone(historical);
    raw.data.dates['2026-09-18'] = false;
    expect(() => parseAvailability(raw, historicalOptions)).toThrowError('AVAILABILITY_DATE_FLAG_CONFLICT');
  });

  it('allows additional envelope metadata and omitted unavailable slots', () => {
    const raw = structuredClone(historical);
    raw.trace = { captured: true };
    raw.data.note = 'offline';
    raw.data.slotsBySpace[COURT_TO_SPACE_ID[1]].shift();
    expect(parseAvailability(raw, historicalOptions).slots).toHaveLength(335);
  });
  it('confirms the observed schema, seven courts, 336 slots, and 13 available hours', () => {
    const snapshot = parseAvailability(historical, historicalOptions);
    expect(Object.keys(snapshot.returnedDates)).toEqual(['2026-09-17', '2026-09-18', '2026-09-19']);
    expect(snapshot.returnedDates).toEqual({ '2026-09-17': false, '2026-09-18': true, '2026-09-19': true });
    expect(snapshot.slots).toHaveLength(336);
    expect(snapshot.slots.filter(slot => slot.isAvailable)).toHaveLength(13);
    expect(new Set(snapshot.slots.map(slot => slot.spaceId))).toEqual(new Set(Object.values(COURT_TO_SPACE_ID)));
    expect(snapshot.fixtureKind).toBe('captured-historical');
  });

  it('does not interpret a date-level true flag as required-hour availability', () => {
    const snapshot = parseAvailability(historical, historicalOptions);
    const court2 = snapshot.slots.filter(slot => slot.date === '2026-09-18' && slot.court === 2);
    expect(snapshot.returnedDates['2026-09-18']).toBe(true);
    expect(court2.every(slot => !slot.isAvailable)).toBe(true);
  });

  it('rejects the originally requested but incomplete September 17-23 range', () => {
    expect(() => parseAvailability(historical, { ...historicalOptions, endDate: '2026-09-23' }))
      .toThrowError('AVAILABILITY_DATE_RANGE_INCOMPLETE');
  });

  it('reports incomplete dates when explicitly allowed for investigation', () => {
    const snapshot = parseAvailability(historical, { ...historicalOptions, endDate: '2026-09-23', requireCompleteRange: false });
    expect(snapshot.incompleteDates).toEqual(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23']);
  });

  it('rejects stale historical evidence', () => {
    expect(() => parseAvailability(historical, { ...historicalOptions, now: new Date('2026-09-18T12:00:00Z') }))
      .toThrowError('AVAILABILITY_SNAPSHOT_STALE');
  });

  it('rejects invalid freshness controls', () => {
    expect(() => parseAvailability(historical, { ...historicalOptions, now: new Date('invalid') })).toThrowError('AVAILABILITY_FRESHNESS_OPTIONS_INVALID');
    expect(() => parseAvailability(historical, { ...historicalOptions, maximumAgeMs: Number.NaN })).toThrowError('AVAILABILITY_FRESHNESS_OPTIONS_INVALID');
  });

  it.each([
    ['booking date conflict', (raw: any) => { raw.data.slotsBySpace[COURT_TO_SPACE_ID[1]][0].bookingDate = '2026-09-18'; }, 'AVAILABILITY_SLOT_DATE_CONFLICT'],
    ['hour boundary conflict', (raw: any) => { raw.data.slotsBySpace[COURT_TO_SPACE_ID[1]][0].endTime = '10:00'; }, 'AVAILABILITY_SLOT_BOUNDARY_INVALID'],
    ['pricing conflict', (raw: any) => { raw.data.slotsBySpace[COURT_TO_SPACE_ID[1]][0].pricing.amount = 999; }, 'AVAILABILITY_PRICING_CONFLICT'],
    ['pricing segment boundary conflict', (raw: any) => { raw.data.slotsBySpace[COURT_TO_SPACE_ID[1]][0].pricing.segments[0].startMinute = 600; }, 'AVAILABILITY_PRICING_CONFLICT'],
    ['unknown court', (raw: any) => { raw.data.slotsBySpace['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] = raw.data.slotsBySpace[COURT_TO_SPACE_ID[1]]; }, 'AVAILABILITY_UNKNOWN_COURT'],
  ])('rejects %s', (_name, mutate, expected) => {
    const raw = structuredClone(historical);
    mutate(raw);
    try { parseAvailability(raw, historicalOptions); } catch (error) { expect(code(error)).toBe(expected); return; }
    throw Error('EXPECTED_VALIDATION_FAILURE');
  });

  it('distinguishes duplicate and conflicting court/date/hour records', () => {
    const duplicate = structuredClone(historical);
    duplicate.data.slotsBySpace[COURT_TO_SPACE_ID[1]].push(structuredClone(duplicate.data.slotsBySpace[COURT_TO_SPACE_ID[1]][0]));
    expect(() => parseAvailability(duplicate, historicalOptions)).toThrowError('AVAILABILITY_SLOT_DUPLICATE');

    const conflict = structuredClone(historical);
    const changed = structuredClone(conflict.data.slotsBySpace[COURT_TO_SPACE_ID[1]][0]);
    changed.isAvailable = !changed.isAvailable;
    conflict.data.slotsBySpace[COURT_TO_SPACE_ID[1]].push(changed);
    expect(() => parseAvailability(conflict, historicalOptions)).toThrowError('AVAILABILITY_SLOT_CONFLICT');
  });

  it('treats omitted slots as unavailable without assuming a full grid', () => {
    const raw = structuredClone(historical);
    raw.data.slotsBySpace[COURT_TO_SPACE_ID[1]].shift();
    expect(parseAvailability(raw, historicalOptions).slots).toHaveLength(335);
  });

  it('rejects unsuccessful response envelopes', () => {
    expect(() => parseAvailability({ success: false, error: 'offline' }, historicalOptions)).toThrowError('AVAILABILITY_RESPONSE_INVALID');
  });
});

describe('separate synthetic fixture parsing', () => {
  it('parses the existing synthetic seven-court fixture without treating it as captured data', () => {
    const snapshot = parseAvailability(availabilityFixture('2026-09-18'), {
      startDate: '2026-09-18', endDate: '2026-09-18', capturedAt: '2026-09-18T00:00:00Z',
      fixtureKind: 'synthetic', label: 'SYNTHETIC ALL-OPEN FIXTURE', now: new Date('2026-09-18T00:00:01Z'), maximumAgeMs: 5_000,
    });
    expect(snapshot.fixtureKind).toBe('synthetic');
    expect(snapshot.slots).toHaveLength(112);
    expect(snapshot.slots.every(slot => slot.isAvailable && slot.price === 600)).toBe(true);
  });
});
