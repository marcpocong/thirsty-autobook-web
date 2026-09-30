import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {startSlotWatchObserver} from '../src/slot-watch-observer.js';

const paths:string[]=[];
afterEach(async()=>{for(const path of paths.splice(0))await rm(path,{recursive:true,force:true});});
const waitFor=async(check:()=>boolean)=>{const end=Date.now()+5_000;while(!check()&&Date.now()<end)await new Promise(done=>setTimeout(done,20));};

describe('dedicated Slot Watch observer process',()=>{
  it('starts in a child process and stops with a complete summary before any scheduled read',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'thirsty-observer-'));paths.push(directory);
    const handle=startSlotWatchObserver({nodePath:process.execPath,childPath:resolve('src/slot-watch-observer-child.ts'),execArgv:['--import','tsx'],directory,
      date:'2026-10-02',releaseMs:Date.now()+120_000,clockOffsetMs:0,clockSynced:true,candidates:[],onUpdate:()=>{}});
    await waitFor(()=>handle.health().state==='ONLINE');expect(handle.health().state).toBe('ONLINE');
    const summary=await handle.stop('test stop');expect(summary).toMatchObject({version:3,status:'stopped',reason:'test stop',id:handle.id});
  },10_000);
  it('reports a child startup failure as degraded',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'thirsty-observer-fail-'));paths.push(directory);
    const handle=startSlotWatchObserver({nodePath:process.execPath,childPath:resolve('src/not-present-observer.ts'),execArgv:['--import','tsx'],directory,
      date:'2026-10-02',releaseMs:Date.now()+120_000,clockOffsetMs:0,clockSynced:true,onUpdate:()=>{}});
    await expect(handle.done).rejects.toThrow(/OBSERVER_/);expect(handle.health().state).toBe('DEGRADED');
  },10_000);
});
