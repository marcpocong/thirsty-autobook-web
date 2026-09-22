import {describe,expect,it} from 'vitest';
import {requiredWorkerIds} from '../src/workers.js';

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
