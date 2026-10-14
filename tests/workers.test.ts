import {describe,expect,it} from 'vitest';
import {normalWorkerIds,requiredWorkerIds} from '../src/workers.js';
import {PlanRequestSchema,TestBookingSchema} from '../src/booking-plan.js';

describe('booking-plan browser allocation',()=>{
  it('prepares only Browser A for a one-court three-hour Standard plan',()=>{
    expect(requiredWorkerIds('standard',1)).toEqual(['A']);
  });

  it.each([
    ['standard',2,['A']],
    ['standard',3,['A','B']],
    ['standard',4,['A','B']],
    ['standard',5,['A','B','C']],
    ['standard',6,['A','B','C']],
    ['standard',7,['A','B','C','D']],
    ['extended',1,['A','B']],
    ['extended',2,['A','B']],
    ['extended',3,['A','B','C','D']],
    ['extended',4,['A','B','C','D']],
    ['extended',5,['A','B','C','D','E','F']],
    ['extended',6,['A','B','C','D','E','F']],
    ['extended',7,['A','B','C','D','E','F','G','H']],
  ] as const)('%s with %i court(s) prepares exactly %j', (strategy,courtCount,workers)=>{
    expect(requiredWorkerIds(strategy,courtCount)).toEqual(workers);
  });
});

describe('explicit Normal browser assignment',()=>{
  it('lets a second wing run in a different customer context while keeping the checkout count exact',()=>{
    expect(normalWorkerIds('standard',1)).toEqual(['A']);
    expect(normalWorkerIds('standard',1,['B'])).toEqual(['B']);
    expect(normalWorkerIds('standard',4,['C','D'])).toEqual(['C','D']);
    for(const bad of [['A','B'],['B','B'],['Z']])expect(()=>normalWorkerIds('standard',bad.length===2&&bad[0]===bad[1]?3:1,bad)).toThrow('NORMAL_WORKER_ASSIGNMENT_INVALID');
  });
  it('is validated by the request schemas and refused for the legacy browser method',()=>{
    const request={wing:'BUKO' as const,strategy:'standard' as const,date:'2026-10-16',start:'19:00',duration:2,courtCount:1 as const,priority:[4],fallbackStarts:[],exact:[[4]],workers:['B' as const]};
    expect(PlanRequestSchema.parse(request).workers).toEqual(['B']);
    expect(()=>PlanRequestSchema.parse({...request,workers:['B','C']})).toThrow();
    expect(TestBookingSchema.safeParse({method:'api-first',request,authorizeTerms:true}).success).toBe(true);
    expect(TestBookingSchema.safeParse({method:'browser',request:{...request,wing:'MANGO',exact:undefined,priority:[7]},authorizeTerms:true}).success).toBe(false);
  });
});
