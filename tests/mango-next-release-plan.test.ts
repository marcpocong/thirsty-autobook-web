import {describe,it,expect} from 'vitest';
import {compileObjective,defaultObjective,savedMangoReleaseSetup,withStrategy} from '../src/booking-objective.js';
import {nextReleaseFor,releaseInstantFor} from '../src/wing-release-data.js';
import {BookingSetupSchema} from '../src/config.js';
const nowMs=Date.parse('2026-10-22T08:00:00Z');
function objective(){
  const o=withStrategy(defaultObjective(nowMs),'SHOTGUN');
  o.wings.MANGO={...o.wings.MANGO,courts:[7,6,5].map((court,i)=>({court,priority:i+1})),minimum:2,ideal:2,durationHours:3,startTimes:['19:00']};
  o.wings.BUKO.enabled=false;
  o.shotgun={...o.shotgun,budget:8,allocationMode:'EQUAL',timingMode:'BALANCED',limitToIdeal:true};
  return o;
}
describe('next Mango release: two distinct courts from 7, 6, 5',()=>{
  it('derives the release date and serializes only eight authorized immediate shots',()=>{
    const o=objective(),c=compileObjective(o,{nowMs}),release=nextReleaseFor(nowMs,'MANGO');
    expect(release).toMatchObject({bookingDate:'2026-10-25',releaseAt:'2026-10-23T00:00:00.000Z'});
    expect(releaseInstantFor(o.wings.MANGO.bookingDate,'MANGO')).toBe(release.releaseMs);
    expect(c.problems).toEqual([]);expect(c.cohorts[0]!.immediate.map(t=>t.court)).toEqual([7,6]);
    expect(c.cohorts[0]!.backups).toEqual([]);expect(c.attemptCount).toBe(8);
    expect(c.warnings.join(' ')).toContain('MANGO Court 5');expect(c.warnings.join(' ')).toContain('cannot replace an armed target');
    const saved=savedMangoReleaseSetup(c,release.bookingDate);expect(saved.problems).toEqual([]);
    const setup=BookingSetupSchema.parse(saved.setup);
    expect(setup.PRECISION_PHASE3!.candidates.map(t=>t.court)).toEqual([7,6]);
    expect(Object.values(setup.STRATEGY_V2!.shotgun!.counts)).toEqual([4,4]);
    expect(setup.STRATEGY_V2!.shotgun!.exactSchedule.map(s=>s.configuredOffsetMs)).toEqual(c.cohorts[0]!.smart!.shotgun!.shots.map(s=>s.configuredOffsetMs));
  });
  it.each([[6,[7,5]],[7,[6,5]],[5,[7,6]]] as const)('selects approved alternatives when Court %s is freshly blocked', (court,expected)=>{
    const o=objective(),before=JSON.stringify(o),c=compileObjective(o,{nowMs,blockedCells:new Set([`MANGO:${court}:20:00`])});
    expect(c.problems).toEqual([]);expect(c.cohorts[0]!.immediate.map(t=>t.court)).toEqual(expected);
    expect(c.attemptCount).toBe(8);expect(JSON.stringify(o)).toBe(before);
  });
  it.each(['UNRELEASED','UNKNOWN'])('does not infer a conflict or free court from %s',()=>{
    const c=compileObjective(objective(),{nowMs});expect(c.problems).toEqual([]);
    expect(c.cohorts[0]!.immediate.map(t=>t.court)).toEqual([7,6]);
    expect(c.cohorts[0]!.backups).toEqual([]);
  });
  it('refuses a two-court plan with only one conflict-free authorized target',()=>{
    const c=compileObjective(objective(),{nowMs,blockedCells:new Set(['MANGO:6:19:00','MANGO:5:19:00'])});
    expect(c.problems.length).toBeGreaterThan(0);
    expect(c.cohorts[0]!.immediate.every(t=>[7,6,5].includes(t.court))).toBe(true);
  });
});
