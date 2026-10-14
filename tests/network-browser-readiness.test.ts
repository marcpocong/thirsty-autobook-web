import { afterEach,expect,it,vi } from 'vitest';
import { runNetworkReadiness } from '../src/network-readiness.js';
import { availabilityFixture } from './availability-fixture.js';
const session=vi.hoisted(()=>({open:vi.fn()}));
vi.mock('../src/api-booking/verified-availability-session.js',()=>({verifiedAvailabilitySession:session.open}));
afterEach(()=>vi.restoreAllMocks());
const options={date:'2026-10-14',requests:3,spacingMs:0,dns:async()=>{},clockRound:async()=>{throw Error('OFFLINE_NTP');},interfaces:()=>({})};
it('uses verified browser reads and marks connection reuse unmeasured',async()=>{
 const close=vi.fn();session.open.mockResolvedValue({close,provider:()=>({getAvailability:async()=>({raw:availabilityFixture(options.date),capturedAt:new Date().toISOString(),fixtureKind:'live',label:'OFFLINE BROWSER FIXTURE'})})});
 const nodeFetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NODE_HTTP_NOT_ALLOWED'));
 const result=await runNetworkReadiness(options);expect(result).toMatchObject({succeeded:3,complete:3,newConnections:null,reusedRequests:null});expect(close).toHaveBeenCalledOnce();expect(nodeFetch).not.toHaveBeenCalled();
});
it('missing browser never falls back to Node availability',async()=>{
 session.open.mockRejectedValue(Error('CDP_NOT_LISTENING'));const nodeFetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NODE_HTTP_NOT_ALLOWED'));
 const result=await runNetworkReadiness(options);expect(result.succeeded).toBe(0);expect(result.samples.every(sample=>sample.code==='AVAILABILITY_BROWSER_PREPARATION_REQUIRED')).toBe(true);expect(nodeFetch).not.toHaveBeenCalled();
});
