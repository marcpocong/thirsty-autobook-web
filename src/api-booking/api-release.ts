export const API_RELEASE_MAX_LATENESS_MS=5_000;

export function assertApiReleaseFresh(releaseMs:number,now=Date.now()){
  if(!Number.isSafeInteger(releaseMs)||releaseMs<=0||!Number.isFinite(now)||now<releaseMs||now-releaseMs>API_RELEASE_MAX_LATENESS_MS)
    throw Error('RELEASE_MISSED');
}
