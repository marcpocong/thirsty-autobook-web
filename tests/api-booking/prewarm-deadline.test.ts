import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {readBeforePreparation} from '../../src/api-booking/prewarm-deadline.js';
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(0);});
afterEach(()=>vi.useRealTimers());
describe('freeze evidence cannot consume the preparation window',()=>{
  it('uses an answer that arrives before preparation must begin',async()=>{
    const value=await readBeforePreparation(async()=>({evidence:'fixture'}),100,new AbortController().signal);
    expect(value).toEqual({evidence:'fixture'});expect(vi.getTimerCount()).toBe(0);
  });
  it('times out a hung read and ignores its later answer',async()=>{
    let answer!:(value:string)=>void;
    const result=readBeforePreparation(()=>new Promise<string>(done=>answer=done),100,new AbortController().signal);
    await vi.advanceTimersByTimeAsync(100);expect(await result).toBeUndefined();answer('late conflict');
    await Promise.resolve();expect(vi.getTimerCount()).toBe(0);
  });
  it('does not begin evidence work when its preparation budget has already elapsed',async()=>{
    const read=vi.fn(async()=>true);expect(await readBeforePreparation(read,0,new AbortController().signal)).toBeUndefined();expect(read).not.toHaveBeenCalled();
  });
  it('rechecks a late clock advance before beginning the deferred read',async()=>{
    const read=vi.fn(async()=>true),result=readBeforePreparation(read,100,new AbortController().signal);
    vi.setSystemTime(200);expect(await result).toBeUndefined();expect(read).not.toHaveBeenCalled();
  });
  it('Stop releases a hung read immediately and observes a later rejection',async()=>{
    const abort=new AbortController();let fail!:(error:Error)=>void;
    const result=readBeforePreparation(()=>new Promise<boolean>((_,reject)=>fail=reject),100,abort.signal);
    const check=expect(result).rejects.toThrow('USER_ABORT');await Promise.resolve();abort.abort();await check;
    fail(Error('late failure'));await Promise.resolve();expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects a failed read without leaving a timer or a busy waiter',async()=>{
    await expect(readBeforePreparation(async()=>{throw Error('fixture failure');},100,new AbortController().signal)).rejects.toThrow('fixture failure');expect(vi.getTimerCount()).toBe(0);
  });
});
