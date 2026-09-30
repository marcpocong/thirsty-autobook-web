import {describe,expect,it} from 'vitest';
import {ReleaseCriticalLockdown} from '../src/release-lockdown.js';

const tick=()=>new Promise<void>(done=>setImmediate(done));

describe('release critical lockdown',()=>{
  it('defers nonessential work but flushes it after exit',async()=>{
    let now=960,value=0;const lockdown=new ReleaseCriticalLockdown(1000,()=>now);
    lockdown.enter();lockdown.defer(()=>{value++});now=992;lockdown.mark('scheduler');expect(value).toBe(0);
    lockdown.exit();await tick();
    expect(value).toBe(1);expect(lockdown.summary()).toMatchObject({deferred:1,flushed:1,workInFinal10Ms:1});
  });

  it('never defers work outside the critical window',()=>{let value=0;const lockdown=new ReleaseCriticalLockdown(0,()=>0);lockdown.defer(()=>value++);expect(value).toBe(1);});

  it('does not run deferred work before exit, and never between enter and exit on the timer thread',async()=>{
    let value=0;const lockdown=new ReleaseCriticalLockdown(1000,()=>0);lockdown.enter();
    lockdown.defer(()=>value++);lockdown.defer(()=>value++);
    await tick();await tick();expect(value).toBe(0);expect(lockdown.state).toBe('RELEASE_CRITICAL_LOCKDOWN');
    lockdown.exit();expect(value).toBe(0);expect(lockdown.state).toBe('FLUSHING');
    await tick();expect(value).toBe(2);expect(lockdown.state).toBe('IDLE');
  });

  it('keeps telemetry complete in order and survives a failing deferred callback',async()=>{
    const lines:string[]=[];const lockdown=new ReleaseCriticalLockdown(1000,()=>0);lockdown.enter();
    lockdown.defer(()=>lines.push('prewarm-ready A0'));lockdown.defer(()=>{throw Error('log sink failed');});lockdown.defer(()=>lines.push('prewarm-ready B0'));
    lockdown.exit();await tick();
    expect(lines).toEqual(['prewarm-ready A0','prewarm-ready B0']);
    expect(lockdown.summary()).toMatchObject({deferred:3,flushed:3});
  });

  it('runs work immediately again while flushing and after it has finished',async()=>{
    let value=0;const lockdown=new ReleaseCriticalLockdown(1000,()=>0);lockdown.enter();lockdown.exit();
    lockdown.defer(()=>value++);expect(value).toBe(1);await tick();lockdown.defer(()=>value++);expect(value).toBe(2);
  });

  it('buckets marks by the final 50/20/10 ms before release and ignores marks outside lockdown',()=>{
    let now=0;const lockdown=new ReleaseCriticalLockdown(1000,()=>now);
    lockdown.mark('before-enter');lockdown.enter();
    for(const at of [900,960,985,995,1000,1004]){now=at;lockdown.mark(`at-${at}`);}
    lockdown.exit();now=1100;lockdown.mark('after-exit');
    const summary=lockdown.summary();
    expect(summary.marks.map(mark=>mark.name)).toEqual(['at-900','at-960','at-985','at-995','at-1000','at-1004']);
    expect(summary).toMatchObject({workInFinal50Ms:4,workInFinal20Ms:3,workInFinal10Ms:2,enteredAtMs:-1000,exitedAtMs:4});
  });

  it('enters and exits once',()=>{
    let now=0;const lockdown=new ReleaseCriticalLockdown(1000,()=>now);
    lockdown.exit();expect(lockdown.state).toBe('IDLE');
    now=10;lockdown.enter();now=20;lockdown.enter();expect(lockdown.summary().enteredAtMs).toBe(-990);
  });
});
