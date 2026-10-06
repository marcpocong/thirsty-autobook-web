import {it,expect,vi} from 'vitest';
import {readAuditAvailability} from '../../src/api-booking/block-audit-read.js';
import {prooflessCourtHourStatuses} from '../../src/api-booking/proofless-checkout.js';
import {UiEventSchema} from '../../src/ui-events.js';
it('reports a provider 403 and preserves UNKNOWN cells without retrying',async()=>{
  const fetcher=vi.fn(async()=>new Response('{}',{status:403,headers:{'content-type':'application/json'}}));
  const result=await readAuditAvailability('2026-10-09',{fetcher:fetcher as typeof fetch});
  expect(result.snapshot).toBeUndefined();expect(result.diagnostics).toMatchObject({status:'FAILED',httpStatus:403,code:'AVAILABILITY_HTTP_FAILED'});
  expect(fetcher).toHaveBeenCalledOnce();expect(result.diagnostics.durationMs).toBeGreaterThanOrEqual(0);
  const cells=prooflessCourtHourStatuses(result.snapshot,'2026-10-09',[{court:7,startTime:'19:00',endTime:'20:00'}]);
  expect(cells.filter(v=>v.status==='UNKNOWN')).toHaveLength(111);expect(cells.find(v=>v.court===7&&v.hour==='19:00')?.status).toBe('BLOCKED');
  expect(UiEventSchema.parse({type:'blockAudit',date:'2026-10-09',cells,diagnostics:{availability:result.diagnostics,publicBookings:{failedCourts:[],durationMs:12},durationMs:20}}).type).toBe('blockAudit');
});
it('keeps HTTP 429 and transport errors distinct, sanitizes unexpected error text, and never retries',async()=>{
  for(const [error,status,code] of [[false,429,'AVAILABILITY_RATE_LIMITED'],[true,undefined,'AVAILABILITY_TRANSPORT_FAILED']] as const){
    const fetcher=vi.fn(async()=>{if(error)throw Error('private raw request details');return new Response('{}',{status:status!});});
    const value=await readAuditAvailability('2026-10-09',{fetcher:fetcher as typeof fetch});
    expect(value.diagnostics).toMatchObject({status:'FAILED',code});expect('httpStatus' in value.diagnostics?value.diagnostics.httpStatus:undefined).toBe(status);expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.stringify(value.diagnostics)).not.toContain('private');
  }
});
