import type { BrowserContext, Page } from 'playwright';
/** Synthetic live-helper contract; no provider security or captured value. */
export async function installAvailabilityHelper(target:Pick<BrowserContext|Page,'addInitScript'>) {
  await target.addInitScript(()=>{
    const scope=window as unknown as {TURBOPACK:{push:(chunk:unknown[])=>void};availabilityHelperCalls:number};
    scope.availabilityHelperCalls=0;
    scope.TURBOPACK={push(chunk){if(typeof chunk[2]==='function')chunk[2]({i:()=>({getPublicFingerprintId:async()=>{scope.availabilityHelperCalls++;return `offline-availability-fingerprint-${scope.availabilityHelperCalls}`;}})});}};
  });
}
