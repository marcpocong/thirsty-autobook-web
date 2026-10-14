import { exactReleaseTarget, canonicalReleaseTargetId } from '../src/release-target.js';
import { shotgunOffsets } from '../src/shotgun.js';
import type { DualWingPlan, DualWingTarget } from '../src/dual-wing-plan.js';
export function fixturePlan(wings:('MANGO'|'BUKO')[]=['MANGO','BUKO'],objective:DualWingPlan['objective']='ANY_ONE',allocation:DualWingPlan['shotgun']['allocationMode']='EQUAL'):DualWingPlan {
  const targets:DualWingTarget[]=wings.map((wing,i)=>({...exactReleaseTarget({wing,court:3-i,start:'18:00',durationHours:2,bookingDate:wing==='MANGO'?'2026-10-17':'2026-10-21'}),priority:i+1,
    priceAuthority:{source:'offline fixture',capturedAt:'2026-10-14T00:00:00.000Z',perHour:[700,700],kind:'OFFLINE_FIXTURE'}}));
  return {version:2,purpose:'RELEASE_PLAN',objective,targets,shotgun:{enabled:true,budget:8,allocationMode:allocation,selectedTargetIds:targets.map(canonicalReleaseTargetId),windowStartMs:-2000,windowEndMs:0,timingMode:'CUSTOM',customOffsetsMs:shotgunOffsets(8,-2000,0)}};
}
