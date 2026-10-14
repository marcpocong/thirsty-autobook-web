import { OndaLiveAvailabilityProvider, LiveAvailabilityError, type LiveAvailabilityOptions } from './live-availability-provider.js';
import { parseAvailability } from './availability-parser.js';
import { networkNowMs } from '../network-clock.js';
import type { UiEvent } from '../ui-events.js';
import type { AvailabilityProvider } from './availability-provider.js';
type Diagnostics=NonNullable<Extract<UiEvent,{type:'blockAudit'}>['diagnostics']>;
/** One public GET, no retries, credentials or raw provider/customer data in diagnostics. */
export async function readAuditAvailability(date:string, options:LiveAvailabilityOptions={}, provider?:AvailabilityProvider) {
  const started=performance.now();
  const durationMs=()=>Math.round(performance.now()-started);
  try {
    if(!provider&&!options.fetcher)throw Error('AVAILABILITY_BROWSER_PREPARATION_REQUIRED');
    // An explicit injected fetcher is retained solely for offline/legacy comparisons.
    const envelope=await (provider??new OndaLiveAvailabilityProvider({...options,allowIncompleteRange:true})).getAvailability({startDate:date,endDate:date});
    const snapshot=parseAvailability(envelope.raw,{startDate:date,endDate:date,capturedAt:envelope.capturedAt,
      fixtureKind:envelope.fixtureKind,label:envelope.label,now:options.clock?.()??new Date(),maximumAgeMs:15_000,requireCompleteRange:false});
    return {snapshot,observedAtMs:networkNowMs(),diagnostics:{status:'SUCCESS',durationMs:durationMs()} satisfies Diagnostics['availability']};
  } catch(error) {
    const code=error instanceof Error&&/^[A-Z][A-Z0-9_]{1,79}$/.test(error.message)?error.message:'AVAILABILITY_READ_FAILED';
    return {snapshot:undefined,observedAtMs:networkNowMs(),diagnostics:{status:'FAILED',code,
      ...(error instanceof LiveAvailabilityError&&error.httpStatus?{httpStatus:error.httpStatus}:{}),durationMs:durationMs()} satisfies Diagnostics['availability']};
  }
}
