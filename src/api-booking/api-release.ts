import { isValidReleaseTrigger } from '../release-offset.js';

export const API_RELEASE_MAX_LATENESS_MS=5_000;

export function assertApiReleaseFresh(releaseMs:number,now=Date.now(),triggerMs=releaseMs){
  if(!Number.isSafeInteger(releaseMs)||releaseMs<=0||!isValidReleaseTrigger(releaseMs,triggerMs)||!Number.isFinite(now)||now<triggerMs||now-releaseMs>API_RELEASE_MAX_LATENESS_MS)
    throw Error('RELEASE_MISSED');
}
