import {readFile,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {unknownBrowser,type BrowserReview} from '../src/lock-browser.js';
export interface LockReview extends BrowserReview {runID:string;pid:number|null;alive:boolean|null;owned:boolean;fingerprint:string;reason:string;canClear:boolean;verifiedAt:string}
export function pidAlive(pid:number):boolean|null {try{process.kill(pid,0);return true;}catch(e){return (e as NodeJS.ErrnoException).code==='ESRCH'?false:null;}}
export function lockReason(r:Pick<LockReview,'pid'|'alive'|'owned'|'clean'|'page'|'selected'|'hold'>){
  if(r.alive===true||r.owned)return 'LOCK_PID_RUNNING';
  if(r.hold==='Active')return 'LOCK_PAYMENT_HOLD_ACTIVE';
  if(r.selected!==null&&r.selected>0)return 'LOCK_SELECTED_SLOTS';
  if(r.pid===null||r.alive!==false||!r.clean||r.page!=='Schedule'||r.selected!==0||r.hold!=='Not detected')return 'LOCK_BROWSER_STATE_UNKNOWN';
  return 'VERIFIED_STALE_LOCK';
}
export async function reviewLock(root:string,owned:boolean,probe:()=>Promise<BrowserReview>,alive=pidAlive):Promise<LockReview>{
  const raw=await readFile(resolve(root,'.local/automation.lock'),'utf8');
  let pid:number|null=null,runID='Unknown';
  try {const data=JSON.parse(raw);if(Number.isSafeInteger(data.pid)&&data.pid>0)pid=data.pid;if(typeof data.runID==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(data.runID))runID=data.runID;}catch{}
  const browser=await probe().catch(()=>unknownBrowser);
  const r={...browser,runID,pid,alive:pid===null?null:alive(pid),owned,fingerprint:createHash('sha256').update(raw).digest('hex'),verifiedAt:new Date().toISOString()};
  const reason=lockReason(r);return {...r,reason,canClear:reason==='VERIFIED_STALE_LOCK'};
}
export async function clearVerifiedLock(root:string,expected:string,owned:()=>boolean,probe:()=>Promise<BrowserReview>,alive=pidAlive){
  const review=await reviewLock(root,owned(),probe,alive);
  if(!review.canClear||owned())throw Error(review.reason);
  if(review.fingerprint!==expected)throw Error('LOCK_BROWSER_STATE_UNKNOWN');
  // Recheck identity and PID after browser verification; never unlink a replacement lock.
  const path=resolve(root,'.local/automation.lock');
  const raw=await readFile(path,'utf8');
  if(createHash('sha256').update(raw).digest('hex')!==expected||alive(review.pid!)!==false||owned())throw Error('LOCK_BROWSER_STATE_UNKNOWN');
  await unlink(path);
}
export function browserProbe(root:string,node:string){return async():Promise<BrowserReview>=>{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const {stdout}=await promisify(execFile)(node,['--import','tsx',resolve(root,'src/lock-probe.ts')],{cwd:root,env,windowsHide:true,timeout:12000,maxBuffer:8192});
  return JSON.parse(stdout) as BrowserReview;
};}
