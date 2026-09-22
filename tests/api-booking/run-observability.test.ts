import {describe,expect,it} from 'vitest';
import {API_DIRECT_SECURITY_PREWARM_LEAD_MS,API_SECURITY_PREWARM_LEAD_MS,safeApiFailureCode} from '../../src/api-booking/run-observability.js';
import {UiEventSchema} from '../../src/ui-events.js';

describe('API run observability',()=>{
  it('uses a bounded fifteen-second prewarm window for both release paths',()=>{
    expect(API_SECURITY_PREWARM_LEAD_MS).toBe(15_000);
    expect(API_DIRECT_SECURITY_PREWARM_LEAD_MS).toBe(15_000);
    expect(UiEventSchema.safeParse({type:'apiStage',stage:'RUN_CONFIGURATION',elapsedMs:1,
      sessionMode:'special-friday',bookingMethod:'api-first',workerCount:8,
      prewarmLeadMs:API_SECURITY_PREWARM_LEAD_MS,directPrewarmLeadMs:API_DIRECT_SECURITY_PREWARM_LEAD_MS}).success).toBe(true);
  });

  it('preserves safe codes and classifies timeouts without exposing exception text',()=>{
    expect(safeApiFailureCode(Error('CDP_NOT_LISTENING'),'API_BROWSER_PREPARATION_FAILED')).toBe('CDP_NOT_LISTENING');
    const timeout=Object.assign(Error('Timeout 30000ms exceeded at https://private.invalid/?token=secret'),{name:'TimeoutError'});
    expect(safeApiFailureCode(Error('wrapper',{cause:timeout}),'API_BROWSER_PREPARATION_FAILED')).toBe('API_BROWSER_PAGE_TIMEOUT');
    expect(safeApiFailureCode(Error('customer private@example.com token=secret'),'API_BROWSER_PREPARATION_FAILED'))
      .toBe('API_BROWSER_PREPARATION_FAILED');
  });
});
