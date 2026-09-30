import {describe,expect,it} from 'vitest';
import {ReleaseCriticalLockdown} from '../src/release-lockdown.js';

describe('release critical lockdown',()=>{
  it('defers nonessential work but flushes it after exit',async()=>{
    let now=960,value=0;const lockdown=new ReleaseCriticalLockdown(1000,()=>now);
    lockdown.enter();lockdown.defer(()=>{value++});now=992;lockdown.mark('scheduler');expect(value).toBe(0);
    lockdown.exit();await new Promise<void>(done=>setImmediate(done));
    expect(value).toBe(1);expect(lockdown.summary()).toMatchObject({deferred:1,flushed:1,workInFinal10Ms:1});
  });
  it('never defers work outside the critical window',()=>{let value=0;const lockdown=new ReleaseCriticalLockdown(0,()=>0);lockdown.defer(()=>value++);expect(value).toBe(1);});
});
