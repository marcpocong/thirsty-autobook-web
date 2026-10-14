import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { BUKO_SPACE_IDS, MANGO_SPACE_IDS, COURT_REGISTRY, FACILITY_ID, assertCourtFacility } from '../src/court-registry.js';
import { parseAvailability } from '../src/api-booking/availability-parser.js';
import { planBooking } from '../src/api-booking/booking-planner.js';
import { validateSnapshot, type Snapshot } from '../src/grid.js';
import { availabilityFixture } from './availability-fixture.js';
import { releaseForTarget, wingWorkflow, type WingReleasePolicy } from '../src/wing-release-policy.js';
import { reviewSummary } from '../src/onda-checkout.js';
import { VENUE } from '../src/config.js';

const date = '2026-10-16', now = new Date('2026-10-14T00:00:00Z');
const options = { startDate: date, endDate: date, capturedAt: now.toISOString(), fixtureKind: 'synthetic' as const,
  label: 'SYNTHETIC MIXED-WING RESPONSE; NOT LIVE CAPTURE', now, maximumAgeMs: 15000 };
function mixed() {
  const raw = availabilityFixture(date);
  for (const [number, id] of Object.entries(BUKO_SPACE_IDS)) raw.data.slotsBySpace[id] = structuredClone(raw.data.slotsBySpace[MANGO_SPACE_IDS[Number(number) as keyof typeof MANGO_SPACE_IDS]]!);
  return raw;
}
function grid(includeBuko = true): Snapshot {
  const rows = Array.from({length:16}, (_, i) => ({ date, hour: `${i+8}:00`.padStart(5,'0') }));
  const time = (hour: number) => `${hour % 12 || 12} ${hour % 24 < 12 ? 'AM' : 'PM'}`;
  return { heading: 'Fri, October 16', busy:false, rows, cells: rows.flatMap((row, i) =>
    COURT_REGISTRY.filter(c => includeBuko || c.wing === 'MANGO').map(c => ({date, hour: row.hour,
      label: `${c.displayName} ${time(i+8)} to ${time(i+9)} available`, state:'available', disabled:false}))) };
}
describe('mixed-wing safety and legacy Mango compatibility', () => {
  it('keeps Mango mapping and stable identities while Buko automation is disabled', () => {
    expect(COURT_REGISTRY).toHaveLength(14);
    expect(new Set(COURT_REGISTRY.map(c => c.id)).size).toBe(14);
    expect(new Set(COURT_REGISTRY.map(c => c.spaceId)).size).toBe(14);
    expect(COURT_REGISTRY.filter(c => c.wing === 'BUKO').every(c => c.bookingMethods.join() === 'api-first-normal' && c.disabledReason)).toBe(true);
    expect(assertCourtFacility(BUKO_SPACE_IDS[1], FACILITY_ID).id).toBe('BUKO:1');
    expect(() => assertCourtFacility(BUKO_SPACE_IDS[1], 'wrong-facility')).toThrow('COURT_FACILITY_MISMATCH');
  });
  it('accepts verified out-of-scope Buko spaces without changing any Mango slot', () => {
    const old = parseAvailability(availabilityFixture(date), options), updated = parseAvailability(mixed(), options);
    expect(updated.slots).toEqual(old.slots);
    expect(updated.wing).toBe('MANGO');
    expect(new Set(updated.excludedSpaceIds)).toEqual(new Set(Object.values(BUKO_SPACE_IDS)));
  });
  it('unknown additional space identities remain fatal', () => {
    const raw = mixed(); raw.data.slotsBySpace['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] = [];
    expect(() => parseAvailability(raw, options)).toThrow('AVAILABILITY_UNKNOWN_COURT');
    expect(() => parseAvailability(raw, {...options,facilityId:'wrong'})).toThrow('AVAILABILITY_FACILITY_MISMATCH');
  });
  it('allows Buko inspection but refuses to pass its overlapping numbers to the Mango planner', () => {
    const snapshot = parseAvailability(mixed(), {...options,wing:'BUKO'});
    expect(snapshot.slots).toHaveLength(112);
    expect(snapshot.slots.find(s => s.court === 1)?.spaceId).toBe(BUKO_SPACE_IDS[1]);
    expect(() => planBooking(snapshot, {} as never)).toThrow('BOOKING_WING_NOT_ENABLED');
  });
  it('does not infer Mango publication from a Buko-only response', () => {
    const raw = mixed(); for (const id of Object.values(MANGO_SPACE_IDS)) delete raw.data.slotsBySpace[id];
    const snapshot = parseAvailability(raw, options);
    expect(snapshot.slots).toEqual([]);
    expect(wingWorkflow({wing:'MANGO',date,courts:[7],hours:['19:00'],snapshot,now}).state).toBe('UNKNOWN / NEEDS VERIFICATION');
  });
  it('validates the Mango subset of a 14-column grid and retains legacy labels', () => {
    expect(validateSnapshot(grid(), date)).toEqual(validateSnapshot(grid(false), date));
    const legacy=grid(false);for(const cell of legacy.cells)cell.label=cell.label.replace(' 🥭','');
    expect(validateSnapshot(legacy,date).every(c => c.state === 'OPEN')).toBe(true);
  });
  it('rejects unknown columns, missing Mango cells, and selected Buko cells', () => {
    const unknown=grid();unknown.cells[0]!.label=unknown.cells[0]!.label.replace('Mango','Unknown');
    expect(() => validateSnapshot(unknown,date)).toThrow('GRID_STRUCTURE_CHANGED');
    const partial=grid();partial.cells.splice(0,1);expect(() => validateSnapshot(partial,date)).toThrow('GRID_STRUCTURE_CHANGED');
    const selected=grid();const b=selected.cells.find(c=>c.label.includes('Buko'))!;b.state='selected';
    expect(() => validateSnapshot(selected,date)).toThrow('OUT_OF_SCOPE_COURT_SELECTED');
  });
  it('accepts the current Mango review name without accepting Buko as Mango', () => {
    const evidence={venue:VENUE,fullDate:'Friday, October 16, 2026',shortDate:'Fri, Oct 16',count:'Your Reservations (1)',court:'Court 7: Mango Wing 🥭',times:['7:00 PM - 8:00 PM']};
    expect(reviewSummary(evidence,700).court).toBe(7);
    expect(() => reviewSummary({...evidence,court:'🥥 Buko Wing: Court 7'},700)).toThrow('REVIEW_STRUCTURE_CHANGED');
  });
});
describe('independent wing release policies and publication', () => {
  const policy:WingReleasePolicy={wing:'BUKO',timezone:'Asia/Manila',horizonOffsetDays:4,releaseTime:'09:30:00',evidence:'SYNTHETIC TEST POLICY ONLY'};
  it('preserves Mango inclusive three-day behavior and independent configured Buko timing', () => {
    expect(releaseForTarget(date,'MANGO').toISO()).toBe('2026-10-14T08:00:00.000+08:00');
    expect(releaseForTarget(date,'BUKO',policy).toISO()).toBe('2026-10-12T09:30:00.000+08:00');
    expect(releaseForTarget('2026-10-20','BUKO').toISO()).toBe('2026-10-14T08:00:00.000+08:00');
    expect(() => releaseForTarget(date,'BUKO',{...policy,wing:'MANGO'})).toThrow('WING_RELEASE_POLICY_UNKNOWN');
    expect(() => releaseForTarget('2026-02-31','MANGO')).toThrow('WING_TARGET_DATE_INVALID');
  });
  it('published available targets use Book Available Now even before a configured future release', () => {
    const snapshot=parseAvailability(mixed(),{...options,wing:'BUKO'});
    expect(wingWorkflow({wing:'BUKO',date,courts:[1],hours:['19:00'],snapshot,now,policy:{...policy,horizonOffsetDays:0}})).toEqual({state:'AVAILABLE NOW',workflow:'BOOK_AVAILABLE_NOW'});
  });
  it('requires explicit complete cells to declare fully booked', () => {
    const snapshot=parseAvailability(mixed(),options);snapshot.slots.forEach(s=>s.isAvailable=false);
    const input={wing:'MANGO' as const,date,courts:[7],hours:['19:00','20:00'],snapshot,now};
    expect(wingWorkflow(input).state).toBe('FULLY BOOKED');
    snapshot.slots=snapshot.slots.filter(s=>s.court!==7||s.startTime!=='20:00');
    expect(wingWorkflow(input).state).toBe('UNKNOWN / NEEDS VERIFICATION');
  });
  it('does not advertise a partially open target or call pre-release Mango cells fully booked',()=>{
    const snapshot=parseAvailability(mixed(),options);
    snapshot.slots.find(s=>s.court===7&&s.startTime==='20:00')!.isAvailable=false;
    expect(wingWorkflow({wing:'MANGO',date,courts:[7],hours:['19:00','20:00'],snapshot,now}).workflow).toBe('NONE');
    snapshot.slots.forEach(s=>s.isAvailable=false);
    const before=new Date('2026-10-13T19:00:00Z');snapshot.capturedAt=before.toISOString();
    expect(wingWorkflow({wing:'MANGO',date,courts:[7],hours:['19:00'],snapshot,now:before}).state).toBe('UNKNOWN / NEEDS VERIFICATION');
  });
  it('only schedules a genuinely empty response before a verified future release', () => {
    const before=new Date('2026-10-13T23:00:00Z');
    const snapshot=parseAvailability({success:true,data:{dates:{},slotsBySpace:{}}},{...options,now:before,capturedAt:before.toISOString(),requireCompleteRange:false});
    const input={wing:'MANGO' as const,date,courts:[7],hours:['19:00'],snapshot,now:before};
    expect(wingWorkflow(input)).toEqual({state:'NOT YET RELEASED',workflow:'PREPARE_FOR_RELEASE',releaseAt:'2026-10-14T08:00:00.000+08:00'});
    expect(wingWorkflow({...input,wing:'BUKO',snapshot:{...snapshot,wing:'BUKO'}}).workflow).toBe('NONE');
    expect(wingWorkflow({...input,now:DateTime.fromISO('2026-10-14T08:00:00+08:00').toJSDate(),snapshot:{...snapshot,capturedAt:'2026-10-14T00:00:00Z'}}).state).toBe('UNKNOWN / NEEDS VERIFICATION');
  });
  it('rejects stale, wrong-wing and incomplete evidence as a release signal', () => {
    const snapshot=parseAvailability(mixed(),options);
    const input={wing:'MANGO' as const,date,courts:[7],hours:['19:00'],snapshot,now};
    expect(wingWorkflow({...input,now:new Date(now.getTime()+16000)}).workflow).toBe('NONE');
    expect(wingWorkflow({...input,wing:'BUKO'}).workflow).toBe('NONE');
    snapshot.slots=[];snapshot.emptyUnreleasedResponse=false;
    expect(wingWorkflow({...input,now:new Date(now.getTime()-1000)}).workflow).toBe('NONE');
  });
});
