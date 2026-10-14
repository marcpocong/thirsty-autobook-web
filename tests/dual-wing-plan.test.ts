import { describe, it, expect } from 'vitest';
import { fixturePlan } from '../scripts/dual-wing-fixtures.js';
import { compileDualWingPlan, assertDualWingLiveEligible, migrateLegacyTargets } from '../src/dual-wing-plan.js';
import { canonicalReleaseTargetId, exactReleaseTarget } from '../src/release-target.js';
import { logicalTargetId } from '../src/shotgun.js';
import { compileSmartPlan, emptySmartDraft, smartDraftFromPhase3 } from '../src/precision-simple.js';
import { releaseForTarget, assertVerifiedRelease, nextWingRelease, WING_RELEASE_POLICIES } from '../src/wing-release-policy.js';
import { MANGO_SPACE_IDS, BUKO_SPACE_IDS } from '../src/court-registry.js';
import { PrecisionPhase3Schema } from '../src/config.js';
import { authorizePrecision, candidateWirePlan } from '../src/api-booking/precision-phase3.js';
import { DurableSubmissionJournal } from '../src/api-booking/durable-submission-journal.js';
import { FACILITY_ID } from '../src/court-registry.js';

describe('evidence-aware release policies',()=>{
  it('keeps actual offsets independent of labels and Buko live-ineligible',()=>{
    expect(WING_RELEASE_POLICIES.MANGO?.horizonOffsetDays).toBe(2);expect(WING_RELEASE_POLICIES.BUKO?.horizonOffsetDays).toBe(6);
    expect(WING_RELEASE_POLICIES.BUKO?.status).toBe('OWNER_ASSUMED');expect(WING_RELEASE_POLICIES.BUKO?.publicLabel).toContain('five');
    expect(()=>assertVerifiedRelease('2026-10-21','BUKO')).toThrow('UNVERIFIED');
    expect(releaseForTarget('2026-10-21','BUKO').toISO()).toBe('2026-10-15T08:00:00.000+08:00');
  });
  it('estimates next Manila cohorts before and after 08:00, independent of host timezone or DST',()=>{
    const before=new Date('2026-10-14T23:59:59Z'),after=new Date('2026-10-15T00:00:00Z');
    expect(nextWingRelease(before,'MANGO').bookingDate).toBe('2026-10-17');expect(nextWingRelease(before,'BUKO').bookingDate).toBe('2026-10-21');
    expect(nextWingRelease(after,'MANGO').bookingDate).toBe('2026-10-18');expect(nextWingRelease(after,'BUKO').bookingDate).toBe('2026-10-22');
    expect(releaseForTarget('2026-03-10','MANGO').offset).toBe(480);
  });
  it('requires explicit verified evidence and validates real dates',()=>{
    const synthetic={...WING_RELEASE_POLICIES.BUKO!,status:'VERIFIED' as const,evidence:'SYNTHETIC TEST ONLY'};
    expect(assertVerifiedRelease('2026-10-21','BUKO',synthetic).toISODate()).toBe('2026-10-15');
    expect(()=>releaseForTarget('2026-10-21','BUKO',{...synthetic,status:'UNKNOWN'})).toThrow('UNKNOWN');
    expect(()=>releaseForTarget('2026-02-31','MANGO')).toThrow('DATE_INVALID');
  });
});
describe('exact target identity and legacy preservation',()=>{
  it('separates wing, provider UUID and date, including matching court numbers',()=>{
    const mango=exactReleaseTarget({court:3,start:'18:00',durationHours:2},'2026-10-17');
    const buko=exactReleaseTarget({...mango,wing:'BUKO',spaceId:BUKO_SPACE_IDS[3]});
    expect(mango.spaceId).toBe(MANGO_SPACE_IDS[3]);expect(canonicalReleaseTargetId(mango)).not.toBe(canonicalReleaseTargetId(buko));
    expect(canonicalReleaseTargetId(mango)).not.toBe(canonicalReleaseTargetId({...mango,bookingDate:'2026-10-18'}));
    expect(()=>exactReleaseTarget({...mango,wing:'BUKO'})).toThrow('SPACE_MISMATCH');
    const key=(t:typeof mango)=>DurableSubmissionJournal.key(FACILITY_ID,t.spaceId,t.bookingDate,t.start,'20:00');
    expect(new Set([key(mango),key(buko),key({...mango,bookingDate:'2026-10-18'})]).size).toBe(3);
  });
  it('migrates copies only, preserving legacy allocation identities and exact saved values',()=>{
    const old=[{court:3,start:'18:00',durationHours:2,fanOutOffsetsMs:[-25,0],worker:'C' as const}];const bytes=JSON.stringify(old);
    const migrated=migrateLegacyTargets(old,'2026-10-17');expect(JSON.stringify(old)).toBe(bytes);expect(migrated[0]?.wing).toBe('MANGO');expect(migrated[0]?.worker).toBe('C');
    expect(logicalTargetId(old[0]!)).toBe('court-3:18:00:2h');expect(migrated[0]?.fanOutOffsetsMs).toEqual([-25,0]);
  });
  it('does not change canonical identity after visual reordering',()=>{const p=fixturePlan();expect(p.targets.map(canonicalReleaseTargetId).sort()).toEqual([...p.targets].reverse().map(canonicalReleaseTargetId).sort());});
});
describe('one shared compiler and aggregate schedule',()=>{
  for(const wings of [['MANGO'],['BUKO'],['MANGO','BUKO']] as Array<('MANGO'|'BUKO')[]>)for(const mode of ['EQUAL','PRIORITY_WEIGHTED'] as const)it(`${wings.join('+')} ${mode} allocates exactly eight globally spaced sends`,()=>{
    const c=compileDualWingPlan(fixturePlan(wings,'ANY_ONE',mode));expect(c.problems).toEqual([]);expect(c.shotgun?.shots).toHaveLength(8);
    expect(c.phase3!.wave1.reduce((sum,a)=>sum+(a.fanOutOffsetsMs?.length??1),0)).toBe(8);expect(new Set(c.shotgun?.shots.map(s=>s.configuredOffsetMs)).size).toBe(8);
    expect(PrecisionPhase3Schema.parse(c.phase3)).toEqual(c.phase3);
  });
  it('accepts same-number cross-wing overlap and rejects same-wing same-date overlap',()=>{
    const p=fixturePlan();p.targets[1]={...p.targets[1]!,court:3,spaceId:BUKO_SPACE_IDS[3]};p.shotgun.selectedTargetIds=p.targets.map(canonicalReleaseTargetId);expect(compileDualWingPlan(p).problems).toEqual([]);
    p.targets[1]={...p.targets[0]!,start:'19:00'};p.shotgun.selectedTargetIds=p.targets.map(canonicalReleaseTargetId);expect(compileDualWingPlan(p).problems.join(' ')).toContain('overlap');
  });
  it('rejects different release cohorts and refuses live Buko and current-slot arming',()=>{
    const p=fixturePlan();p.targets[1]!.bookingDate='2026-10-22';p.shotgun.selectedTargetIds=p.targets.map(canonicalReleaseTargetId);expect(compileDualWingPlan(p).problems.join(' ')).toContain('instants differ');
    expect(()=>assertDualWingLiveEligible(fixturePlan())).toThrow('UNVERIFIED');expect(()=>assertDualWingLiveEligible({...fixturePlan(),purpose:'CURRENT_SLOT_REHEARSAL'})).toThrow('CANNOT_ARM');
    expect(()=>assertDualWingLiveEligible(fixturePlan(['MANGO']))).toThrow('SHOTGUN_LIVE_COMPATIBILITY_UNVERIFIED');
  });
  it('preserves custom under-budget and zero-count targets without inventing extra sends',()=>{
    const p=fixturePlan();p.shotgun.allocationMode='CUSTOM';p.shotgun.customCounts=Object.fromEntries(p.targets.map((t,i)=>[canonicalReleaseTargetId(t),i===0?3:0]));p.shotgun.customOffsetsMs=[-2000,-1000,0];
    const c=compileDualWingPlan(p);expect(c.problems).toEqual([]);expect(c.phase3?.budgets.total).toBe(3);expect(c.phase3?.wave1).toHaveLength(1);expect(c.phase3?.wave1[0]?.fanOutOffsetsMs).toHaveLength(3);
    p.objective='ONE_PER_WING';expect(compileDualWingPlan(p).problems.join(' ')).toContain('each required wing');
  });
  it('refuses missing workers, duplicate targets and bad price authority',()=>{
    expect(compileDualWingPlan(fixturePlan(),new Set(['A','B','C','D','E','F','G'])).problems.join(' ')).toContain('ready worker');
    const p=fixturePlan();p.targets.push(p.targets[0]!);expect(compileDualWingPlan(p).problems.join(' ')).toContain('twice');
    const price=fixturePlan();price.targets[1]!.priceAuthority.perHour=[0,700];expect(compileDualWingPlan(price).problems.join(' ')).toContain('price authority');
  });
  it('reopens scoped compiled targets with exact rates and refuses legacy live execution adapters',()=>{
    const c=compileDualWingPlan(fixturePlan());const draft=smartDraftFromPhase3(c.phase3!,{targetDate:'2026-10-17'});
    expect(draft.immediate[1]?.bookingDate).toBe('2026-10-21');expect(draft.immediate[1]?.spaceId).toBe(BUKO_SPACE_IDS[2]);
    expect(()=>candidateWirePlan('2026-10-17',c.phase3!.candidates[1]!)).toThrow('SCOPED_RELEASE_LIVE_UNVERIFIED');
    expect(()=>authorizePrecision({candidates:c.phase3!.candidates} as never)).toThrow('SCOPED_RELEASE_LIVE_UNVERIFIED');
  });
});
