import { compileSmartPlan, emptySmartDraft, type SmartSlot, type SmartPhase3 } from './precision-simple.js';
import { logicalTargetId, type ShotgunAllocationMode, type ShotgunSettings } from './shotgun.js';
import { exactReleaseTarget, canonicalReleaseTargetId, releaseTargetEnd, type ExactReleaseTarget } from './release-target.js';
import { releaseForTarget, WING_RELEASE_POLICIES, assertVerifiedRelease } from './wing-release-policy.js';
import type { Wing } from './court-registry.js';

import { raceQuota, validRaceObjective, type RaceObjective } from './api-booking/precision-race.js';
/** Legacy ANY_ONE / ONE_PER_WING, or an explicit distinct-court quota. */
export type BookingObjective = RaceObjective;
export interface DualWingTarget extends ExactReleaseTarget {
  priority: number; priceAuthority: {source:string;capturedAt:string;perHour:number[];kind:'OPERATOR_CONFIRMED'|'TARGET_DATE_PUBLISHED'|'OFFLINE_FIXTURE'};
}
/** A versioned wrapper over the same compiler, allocator, topology and dispatcher.
 * It is saved separately on explicit operator action, never over a legacy Mango save.
 * This wrapper is planning authority only; execution remains intercepted. */
export interface DualWingPlan {
  version: 2; purpose: 'RELEASE_PLAN' | 'CURRENT_SLOT_REHEARSAL';
  objective: BookingObjective; targets: DualWingTarget[];
  shotgun: ShotgunSettings; releaseAt?: string;
}
export function compileDualWingPlan(plan: DualWingPlan, unavailable: ReadonlySet<string> = new Set()) {
  const problems:string[]=[];
  if (plan.version!==2 || !['RELEASE_PLAN','CURRENT_SLOT_REHEARSAL'].includes(plan.purpose) || !validRaceObjective(plan.objective)) throw Error('DUAL_WING_PLAN_INVALID');
  const quota=raceQuota(plan.objective)!;
  const targets = plan.targets.map(target=>({...target,...exactReleaseTarget(target)}));
  if (!targets.length || targets.length>7) problems.push('Choose 1–7 exact targets.');
  if (plan.objective==='ONE_PER_WING' && !(['MANGO','BUKO'] as Wing[]).every(wing=>targets.some(t=>t.wing===wing))) problems.push('One in each wing requires both Mango and Buko targets.');
  if (typeof plan.objective==='object' && quota.scope==='PER_WING') for (const [wing,ideal] of Object.entries(quota.wings) as [Wing,number][]) {
    const courts=new Set(targets.filter(t=>t.wing===wing).map(t=>t.court)).size;
    if (courts<ideal) problems.push(`${wing==='MANGO'?'Mango':'Buko'} needs ${ideal} distinct courts but only ${courts} are targeted.`);
  }
  if (!plan.shotgun.enabled) problems.push('Enable the shared Shotgun allocation.');
  const ids=targets.map(canonicalReleaseTargetId);
  if (new Set(ids).size!==ids.length) problems.push('An exact target is listed twice.');
  if (ids.some(id=>!plan.shotgun.selectedTargetIds.includes(id))) problems.push('Every target in this wrapper must be allocated explicitly.');
  let releaseAt:string|null=null;
  if (plan.purpose==='RELEASE_PLAN') {
    const releases=targets.map(t=>releaseForTarget(t.bookingDate,t.wing).toMillis());
    if (new Set(releases).size>1) problems.push('Target release instants differ. Use separate scheduled cohorts; dates will not be changed.');
    if (releases.length) releaseAt=new Date(releases[0]!).toISOString();
    if (plan.releaseAt!==undefined && Date.parse(plan.releaseAt)!==releases[0]) problems.push('The reviewed release instant does not match the exact targets.');
  }
  const immediate:SmartSlot[]=targets.map(t=> {
    const price=t.priceAuthority;
    if (!price || !price.source.trim() || !Number.isFinite(Date.parse(price.capturedAt)) || price.perHour.length!==t.durationHours || price.perHour.some(p=>!Number.isFinite(p)||p<=0)) problems.push('Each target needs its own exact price authority.');
    return {...t,rate:{source:price?.kind==='OFFLINE_FIXTURE'?'offline fixture':price?.source??'',capturedAt:price?.capturedAt??'',date:t.bookingDate,perHour:price?.perHour??[],status:price?.kind==='TARGET_DATE_PUBLISHED'?'TARGET_DATE_PUBLISHED':'OPERATOR_CONFIRMED',actionable:true}};
  });
  const compiled=compileSmartPlan({...emptySmartDraft(),immediate,shotgun:plan.shotgun,advanced:{wave2:0,rescue:0}},{targetDate:targets[0]?.bookingDate??'',unavailable});
  problems.push(...compiled.problems);
  if (plan.objective==='ONE_PER_WING' && (['MANGO','BUKO'] as Wing[]).some(wing=>!targets.some(t=>t.wing===wing&&(compiled.shotgun?.counts[logicalTargetId(t)]??0)>0))) problems.push('Allocate at least one attempt to each required wing.');
  if (typeof plan.objective==='object' && quota.scope==='PER_WING') for (const [wing,ideal] of Object.entries(quota.wings) as [Wing,number][])
    if (new Set(targets.filter(t=>t.wing===wing&&(compiled.shotgun?.counts[logicalTargetId(t)]??0)>0).map(t=>t.court)).size<ideal) problems.push(`Allocate attempts to at least ${ideal} distinct ${wing==='MANGO'?'Mango':'Buko'} courts.`);
  const phase3=problems.length?null:compiled.phase3;
  const warnings=[...compiled.warnings,'OFFLINE / INTERCEPTED only. In-flight attempts may produce extra simulated holds.','Per-wing completion is evidenced separately for every court; multiple holds are never an atomic multi-court booking.'];
  if(targets.some(t=>t.priceAuthority.kind==='OFFLINE_FIXTURE'))warnings.push('Fixture prices are synthetic and cannot authorize live checkout.');
  const policy=Object.fromEntries((['MANGO','BUKO'] as Wing[]).map(w=>[w,WING_RELEASE_POLICIES[w]?.status??'UNKNOWN']));
  return {phase3,shotgun:compiled.shotgun,problems:[...new Set(problems)],warnings,releaseAt,policy,
    liveStatus:'SHOTGUN_LIVE_COMPATIBILITY_UNVERIFIED' as const,
    targets:targets.map(t=>({...t,id:logicalTargetId(t),end:releaseTargetEnd(t),attempts:compiled.shotgun?.counts[logicalTargetId(t)]??0}))};
}
export function assertDualWingLiveEligible(plan:DualWingPlan):never {
  if(plan.purpose!=='RELEASE_PLAN')throw Error('CURRENT_SLOT_REHEARSAL_CANNOT_ARM_RELEASE');
  const compiled=compileDualWingPlan(plan);
  if(compiled.problems.length)throw Error('DUAL_WING_PLAN_INVALID');
  for(const t of plan.targets)assertVerifiedRelease(t.bookingDate,t.wing);
  throw Error('SHOTGUN_LIVE_COMPATIBILITY_UNVERIFIED');
}
/** In-memory legacy interpretation; old durable keys and saved bytes remain untouched. */
export function migrateLegacyTargets(targets:readonly SmartSlot[], date:string) {
  return targets.map(t=>({...t,...exactReleaseTarget(t,date)}));
}
export type DualWingCompiledPhase3 = SmartPhase3;
