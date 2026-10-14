import type { DualWingTarget } from './dual-wing-plan.js';
export function assertLabSlotEvidence(target:DualWingTarget, now=Date.now()) {
  const price=target.priceAuthority,age=now-Date.parse(price.capturedAt);
  if(price.kind!=='TARGET_DATE_PUBLISHED'||!Number.isFinite(age)||age<0||age>15000||price.perHour.length!==target.durationHours||price.perHour.some(p=>!Number.isFinite(p)||p<=0))throw Error('LAB_SLOT_EVIDENCE_UNKNOWN');
}
