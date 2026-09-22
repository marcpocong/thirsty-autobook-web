import {readFile,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {unknownBrowser,type BrowserReview} from '../src/lock-browser.js';
export interface DualWorkerReview extends BrowserReview { id:'A'|'B'; pid:number|null; alive:boolean|null; recordedState:string }
export interface LockReview extends BrowserReview {mode?:'single'|'dual';workers?:DualWorkerReview[];runID:string;pid:number|null;alive:boolean|null;owned:boolean;fingerprint:string;reason:string;canClear:boolean;verifiedAt:string}
export function pidAlive(pid:number):boolean|null {
  if(!Number.isSafeInteger(pid)||pid<=0)return null;
  try{process.kill(pid,0);return true;}catch(error){
    const code=(error as NodeJS.ErrnoException).code;
    if(code==='ESRCH')return false;
    // On Windows, Node can report EPERM for a PID that does not exist.
    // Resolve that ambiguity with Windows process metadata; fail closed if it is unavailable.
    if(process.platform==='win32'&&code==='EPERM'){
      try{
        const result=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
          `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' -ErrorAction Stop) -ne $null`],
          {encoding:'utf8',windowsHide:true,timeout:5000,stdio:['ignore','pipe','ignore']}).trim();
        return result==='True'?true:result==='False'?false:null;
      }catch{return null;}
    }
    return null;
  }
}
export function lockReason(r:Pick<LockReview,'pid'|'alive'|'owned'|'clean'|'page'|'selected'|'hold'>){
  if(r.alive===true||r.owned)return 'LOCK_PID_RUNNING';
  if(r.hold==='Active')return 'LOCK_PAYMENT_HOLD_ACTIVE';
  if(r.selected!==null&&r.selected>0)return 'LOCK_SELECTED_SLOTS';
  if(r.pid===null||r.alive!==false||!r.clean||r.page!=='Schedule'||r.selected!==0||r.hold!=='Not detected')return 'LOCK_BROWSER_STATE_UNKNOWN';
  return 'VERIFIED_STALE_LOCK';
}
export async function reviewLock(root:string,owned:boolean,probe:()=>Promise<BrowserReview>,alive=pidAlive,probeB?:()=>Promise<BrowserReview>):Promise<LockReview>{
  const raw=await readFile(resolve(root,'.local/automation.lock'),'utf8');
  let pid:number|null=null,runID='Unknown';
  try {const data=JSON.parse(raw);if(Number.isSafeInteger(data.pid)&&data.pid>0)pid=data.pid;if(typeof data.runID==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(data.runID))runID=data.runID;}catch{}
  const data = (()=>{try{return JSON.parse(raw);}catch{return {};}})();
  if(data.mode==='dual')return reviewDual(root,raw,data,owned,probe,probeB,alive);
  if(data.mode==='extended'||Array.isArray(data.workers)&&data.workers.length>1)return {...unknownBrowser,runID,pid,alive:pid===null?null:alive(pid),owned,fingerprint:createHash('sha256').update(raw).digest('hex'),verifiedAt:new Date().toISOString(),reason:'USE_RESET_AND_PREPARE',canClear:false};
  if(data.stage==='FINAL_ACTION_DISPATCHING')return {...unknownBrowser,runID,pid,alive:pid===null?null:alive(pid),owned,fingerprint:createHash('sha256').update(raw).digest('hex'),verifiedAt:new Date().toISOString(),reason:'PAYMENT_HOLD_MAY_BE_ACTIVE',canClear:false};
  if(data.stage==='HOLD_VERIFIED'||data.handoff||data.state==='hold'){
    const expiry=typeof data.holdExpiresAt==='string'?Date.parse(data.holdExpiresAt):NaN;
    const base={runID,pid,alive:pid===null?null:alive(pid),owned,fingerprint:createHash('sha256').update(raw).digest('hex'),verifiedAt:new Date().toISOString()};
    if(!Number.isFinite(expiry)||expiry>Date.now())return {...unknownBrowser,...base,reason:'LOCK_PAYMENT_HOLD_ACTIVE',canClear:false};
    const browser=await probe().catch(()=>unknownBrowser);
    const reviewed={...browser,...base};
    const reason=lockReason(reviewed);
    return {...reviewed,reason,canClear:reason==='VERIFIED_STALE_LOCK'};
  }
  const browser=await probe().catch(()=>unknownBrowser);
  const r={...browser,runID,pid,alive:pid===null?null:alive(pid),owned,fingerprint:createHash('sha256').update(raw).digest('hex'),verifiedAt:new Date().toISOString()};
  const reason=lockReason(r);return {...r,reason,canClear:reason==='VERIFIED_STALE_LOCK'};
}
export async function clearVerifiedLock(root:string,expected:string,owned:()=>boolean,probe:()=>Promise<BrowserReview>,alive=pidAlive,probeB?:()=>Promise<BrowserReview>){
  const review=await reviewLock(root,owned(),probe,alive,probeB);
  if(review.fingerprint!==expected)throw Error('LOCK_BROWSER_STATE_UNKNOWN');
  if(!review.canClear||owned())throw Error(review.reason);
  // Recheck identity and PID after browser verification; never unlink a replacement lock.
  const path=resolve(root,'.local/automation.lock');
  const raw=await readFile(path,'utf8');
  const currentFingerprint = review.mode==='dual' ? await dualLockFingerprint(root,raw) : createHash('sha256').update(raw).digest('hex');
  if(currentFingerprint!==expected||alive(review.pid!)!==false||owned())throw Error('LOCK_BROWSER_STATE_UNKNOWN');
  if(review.mode==='dual')for(const id of ['a','b'])await unlink(resolve(root,`.local/dual/worker-${id}.lock`));
  await unlink(path);
}
export function browserProbe(root:string,node:string,worker:'A'|'B'='A'){return async():Promise<BrowserReview>=>{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const {stdout}=await promisify(execFile)(node,['--import','tsx',resolve(root,'src/lock-probe.ts'),...(worker==='B'?['--worker-b']:[])],{cwd:root,env,windowsHide:true,timeout:12000,maxBuffer:8192});
  return JSON.parse(stdout) as BrowserReview;
};}

async function dualRaw(root:string) {
  return Promise.all(['a','b'].map(id=>readFile(resolve(root,`.local/dual/worker-${id}.lock`),'utf8').catch(()=>'')));
}
async function dualLockFingerprint(root:string,raw:string) { return createHash('sha256').update(JSON.stringify([raw,...await dualRaw(root)])).digest('hex'); }
async function reviewDual(root:string,raw:string,data:any,owned:boolean,probe:()=>Promise<BrowserReview>,probeB:(()=>Promise<BrowserReview>)|undefined,alive:typeof pidAlive):Promise<LockReview> {
  const raws=await dualRaw(root);
  const coordinatorPid=Number.isSafeInteger(data.pid)&&data.pid>0?data.pid:null;
  const runID=typeof data.runID==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(data.runID)?data.runID:'Unknown';
  const workers=await Promise.all(raws.map(async (r,i):Promise<DualWorkerReview>=>{
    const id=i===0?'A':'B';
    const state=(()=>{try{return JSON.parse(r);}catch{return {};}})();
    const matching=state.id===id&&state.runID===runID&&state.pid===coordinatorPid&&coordinatorPid!==null&&Array.isArray(data.workers)&&data.workers.length===2&&data.workers[i]?.id===id&&data.workers[i]?.pid===coordinatorPid&&data.workers[i]?.runID===runID;
    const browser=await (i===0?probe:probeB??(async()=>unknownBrowser))().catch(()=>unknownBrowser);
    return {...browser,id,pid:matching?state.pid:null,alive:matching?alive(state.pid):null,recordedState:state.stage==='FINAL_ACTION_DISPATCHING'?'FINAL_ACTION_DISPATCHING':state.stage==='HOLD_VERIFIED'?'hold':['clean','selection','checkout','hold','unknown'].includes(state.state)?state.state:'unknown'};
  }));
  const clean=workers.every(w=>w.clean&&w.page==='Schedule'&&w.selected===0&&w.hold==='Not detected'&&w.alive===false);
  const hold=workers.some(w=>w.hold==='Active')?'Active':workers.every(w=>w.hold==='Not detected')?'Not detected':'Unknown';
  const r:LockReview={mode:'dual',workers,runID,pid:coordinatorPid,alive:coordinatorPid===null?null:alive(coordinatorPid),owned,
    page:clean?'Schedule':'Unknown',selected:workers.every(w=>w.selected!==null)?workers.reduce((n,w)=>n+w.selected!,0):null,hold,clean,
    fingerprint:createHash('sha256').update(JSON.stringify([raw,...raws])).digest('hex'),verifiedAt:new Date().toISOString(),reason:'',canClear:false};
  r.reason=workers.some(w=>['FINAL_ACTION_DISPATCHING','hold'].includes(w.recordedState))?'USE_RESET_AND_PREPARE':workers.some(w=>w.alive===true)?'LOCK_PID_RUNNING':lockReason(r);r.canClear=r.reason==='VERIFIED_STALE_LOCK';return r;
}
