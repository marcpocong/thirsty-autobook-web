import {it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resetAndPrepare,type PreparedBrowser} from '../src/booking-prepare.js';
import {Safety} from '../src/safety.js';
import type {BrowserIdentity} from '../src/browser.js';
const clean={page:'Schedule' as const,selected:0,hold:'Not detected' as const,clean:true};
async function fixture(work:(h:{root:string;path:string;inspect:ReturnType<typeof vi.fn<(b:BrowserIdentity)=>Promise<PreparedBrowser>>>;normalize:ReturnType<typeof vi.fn<()=>Promise<void>>>;run:(strategy?:'standard'|'extended')=>Promise<void>;record:(mode:string,stage:string)=>Promise<void>})=>Promise<void>){
  const root=await mkdtemp(join(tmpdir(),'thirsty-reset-')),path=join(root,'.local/automation.lock');await mkdir(join(root,'.local/dual'),{recursive:true});
  const normalize=vi.fn(async()=>{}),inspect=vi.fn(async(_b:BrowserIdentity):Promise<PreparedBrowser>=>({observed:clean,expired:false,normalize}));
  const run=(strategy:'standard'|'extended'='standard')=>resetAndPrepare(strategy,new Safety(),{root,alive:()=>false,inspect});
  const record=async(mode:string,stage:string)=>{await writeFile(path,JSON.stringify({pid:123,runID:'fixture',mode,stage}));if(mode==='extended'||mode==='dual')for(const id of ['a','b'])await writeFile(join(root,`.local/dual/worker-${id}.lock`),JSON.stringify({pid:123,runID:'fixture',id:id.toUpperCase(),stage,state:'selection'}));};
  try{await work({root,path,inspect,normalize,run,record});}finally{await rm(root,{recursive:true,force:true});}
}
it.each(['standard','extended'] as const)('no-lock %s preparation starts/reuses only its required browsers',strategy=>fixture(async h=>{await h.run(strategy);expect(h.inspect.mock.calls.map(c=>c[0].workerId)).toEqual(strategy==='standard'?['A']:['A','B']);expect(h.normalize).toHaveBeenCalledTimes(strategy==='standard'?1:2);await expect(readFile(h.path)).rejects.toThrow();}));
it.each(['SELECTION','REVIEW','PAYMENT_SUMMARY'])('recovers a dead Standard %s record',stage=>fixture(async h=>{await h.record('standard',stage);h.inspect.mockImplementation(async()=>({observed:{page:stage==='SELECTION'?'Schedule':'Payment Summary',selected:stage==='SELECTION'?2:null,hold:stage==='SELECTION'?'Not detected':'Unknown',clean:false},expired:false,normalize:h.normalize}));await h.run();expect(h.normalize).toHaveBeenCalledOnce();await expect(readFile(h.path)).rejects.toThrow();}));
it.each(['extended','dual'])('recovers safe stale %s state before preparing Standard',mode=>fixture(async h=>{await h.record(mode,'SELECTION');await h.run();expect(h.inspect.mock.calls.map(c=>c[0].workerId)).toEqual(['A','B']);for(const p of ['automation.lock','dual/worker-a.lock','dual/worker-b.lock'])await expect(readFile(join(h.root,'.local',p))).rejects.toThrow();}));
it('refuses an active PID before inspecting or normalizing',()=>fixture(async h=>{await h.record('standard','SELECTION');await expect(resetAndPrepare('standard',new Safety(),{root:h.root,alive:()=>true,inspect:h.inspect})).rejects.toThrow('LOCK_PID_RUNNING');expect(h.inspect).not.toHaveBeenCalled();}));
it.each(['FINAL_ACTION_DISPATCHING','HOLD_VERIFIED'])('blocks Extended %s in B without resetting A',stage=>fixture(async h=>{await h.record('extended','SELECTION');await writeFile(join(h.root,'.local/dual/worker-b.lock'),JSON.stringify({pid:123,runID:'fixture',stage}));h.inspect.mockImplementation(async b=>({observed:b.workerId==='B'?{page:'QR Checkout',selected:null,hold:'Active',clean:false}:clean,expired:false,normalize:h.normalize}));await expect(h.run('extended')).rejects.toThrow('PAYMENT_HOLD_MAY_BE_ACTIVE');expect(h.normalize).not.toHaveBeenCalled();}));
it('both expired verified holds allow later one-click recovery',()=>fixture(async h=>{await h.record('extended','HOLD_VERIFIED');h.inspect.mockImplementation(async()=>({observed:{page:'QR Checkout',selected:null,hold:'Active',clean:false},expired:true,normalize:h.normalize}));await h.run('extended');expect(h.normalize).toHaveBeenCalledTimes(2);}));
it('replacement during normalization is retained',()=>fixture(async h=>{await h.record('standard','REVIEW');h.normalize.mockImplementation(async()=>{await writeFile(h.path,JSON.stringify({pid:456,runID:'replacement'}));});await expect(h.run()).rejects.toThrow('LOCK_REPLACED');expect(JSON.parse(await readFile(h.path,'utf8')).runID).toBe('replacement');}));
it('replacement after inspection blocks all normalization even when starting without a lock',()=>fixture(async h=>{h.inspect.mockImplementation(async()=>{await writeFile(h.path,JSON.stringify({pid:456,runID:'replacement'}));return {observed:clean,expired:false,normalize:h.normalize};});await expect(h.run()).rejects.toThrow('LOCK_REPLACED');expect(h.normalize).not.toHaveBeenCalled();}));
it('a dead interrupted preparation guard can be recovered',()=>fixture(async h=>{await writeFile(join(h.root,'.local/preparation.lock'),JSON.stringify({pid:321}));await h.run();expect(h.normalize).toHaveBeenCalledOnce();}));
it.each(['standard','extended'] as const)('%s prepares the exact Test Now date in every required browser',strategy=>fixture(async h=>{
  await resetAndPrepare(strategy,new Safety(),{root:h.root,alive:()=>false,inspect:h.inspect},'2026-09-15');
  expect(h.normalize.mock.calls).toEqual(Array.from({length:strategy==='standard'?1:2},()=>['2026-09-15']));
}));
it('unavailable target date retains state and cannot complete preparation',()=>fixture(async h=>{
  await h.record('standard','REVIEW');h.normalize.mockRejectedValue(Error('TARGET_DATE_UNAVAILABLE'));
  await expect(resetAndPrepare('standard',new Safety(),{root:h.root,alive:()=>false,inspect:h.inspect},'2030-01-01')).rejects.toThrow('TARGET_DATE_UNAVAILABLE');
  expect(JSON.parse(await readFile(h.path,'utf8')).stage).toBe('REVIEW');
}));
it('inspects both Extended browsers before refusing an uncertain final dispatch and never normalizes',()=>fixture(async h=>{
  await h.record('extended','SELECTION');
  await writeFile(join(h.root,'.local/dual/worker-a.lock'),JSON.stringify({pid:123,runID:'fixture',id:'A',stage:'FINAL_ACTION_DISPATCHING'}));
  await expect(h.run('extended')).rejects.toThrow('PAYMENT_HOLD_MAY_BE_ACTIVE');
  expect(h.inspect.mock.calls.map(c=>c[0].workerId)).toEqual(['A','B']);
  expect(h.normalize).not.toHaveBeenCalled();
  expect(JSON.parse(await readFile(h.path,'utf8')).mode).toBe('extended');
}));
