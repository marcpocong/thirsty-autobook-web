import { resolve } from 'node:path';
import type { Page } from 'playwright';
import type { BrowserIdentity } from './browser.js';
import { readFile, open, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { DateTime } from 'luxon';
import { browserA,browserB,verifyDedicatedChrome,monitorConnection } from './browser.js';
import { ONDA_URL, VENUE } from './config.js';
import { inspectLockPage, type BrowserReview } from './lock-browser.js';
import { snapshot, validateSnapshot, navigateDate } from './grid.js';
import { Safety, securityReason } from './safety.js';
import { assertDiagnosticSchedule } from './diagnostic-schedule.js';
import { pidAlive } from '../ui/locks.js';

export function assertResetSafe(record:{stage?:string;state?:string;handoff?:unknown}|undefined,browser:BrowserReview,expired=false){
  if(record?.stage==='FINAL_ACTION_DISPATCHING'||(!record?.stage&&['checkout','unknown'].includes(record?.state??'')))throw Error('PAYMENT_HOLD_MAY_BE_ACTIVE');
  if(browser.hold==='Active'||browser.page==='QR Checkout'){
    if(!(record?.stage==='HOLD_VERIFIED'&&expired))throw Error('PAYMENT_HOLD_MAY_BE_ACTIVE');
    return;
  }
  if(record?.stage==='HOLD_VERIFIED'||record?.handoff||record?.state==='hold'){
    if(!browser.clean||browser.hold!=='Not detected')throw Error('PAYMENT_HOLD_MAY_BE_ACTIVE');
    return;
  }
  if(browser.page==='Schedule'&&browser.hold==='Not detected')return;
  if(record&&['SELECTION','SELECTION_VERIFIED','REVIEW','PAYMENT_SUMMARY'].includes(record.stage??'')&&['Review Booking','Payment Summary'].includes(browser.page))return;
  throw Error('PAYMENT_HOLD_MAY_BE_ACTIVE');
}
async function maybeRead(path:string){try{return await readFile(path,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw e;}}
export interface PreparedBrowser { observed:BrowserReview; expired:boolean; normalize(date?:string):Promise<void> }
export interface PreparationDependencies { root?:string; alive?:typeof pidAlive; inspect?:(identity:BrowserIdentity,safety:Safety)=>Promise<PreparedBrowser> }
export async function resetAndPrepare(strategy:'standard'|'extended',safety:Safety,deps:PreparationDependencies={},date?:string){
  const root=deps.root??'.',alive=deps.alive??pidAlive;
  const path=resolve(root,'.local/automation.lock'),raw=await maybeRead(path);
  let expectedRaw=raw;
  const record=raw?JSON.parse(raw):undefined;
  if(record&&(!Number.isSafeInteger(record.pid)||record.pid<=0||alive(record.pid)!==false))throw Error('LOCK_PID_RUNNING');
  const legacy=record?.mode==='dual',two=legacy||record?.mode==='extended'||strategy==='extended';
  const workerPaths=['.local/dual/worker-a.lock','.local/dual/worker-b.lock'].map(p=>resolve(root,p));
  const guardPath=resolve(root,'.local/preparation.lock');
  const subordinate=await Promise.all(workerPaths.map(maybeRead));
  if(!record&&subordinate.some(Boolean))throw Error('ORPHAN_WORKER_STATE');
  if(record&&!legacy&&record.mode!=='extended'&&subordinate.some(Boolean))throw Error('ORPHAN_WORKER_STATE');
  const records=subordinate.map(r=>r?JSON.parse(r):undefined);
  if(legacy||record?.mode==='extended')for(const r of records)if(!r||r.pid!==record.pid||r.runID!==record.runID||alive(r.pid)!==false)throw Error('WORKER_STATE_UNKNOWN');
  const same=async()=>{
    safety.check();if(await maybeRead(path)!==expectedRaw)throw Error('LOCK_REPLACED');
    const now=await Promise.all(workerPaths.map(maybeRead));if(now.some((r,i)=>r!==subordinate[i]))throw Error('LOCK_REPLACED');
    if(record&&alive(record.pid)!==false)throw Error('LOCK_PID_RUNNING');
  };
  // Serialize preparation instances separately; ordinary automation is still excluded
  // by the retained global lock, or a temporary reservation when starting clean.
  const previous=await maybeRead(guardPath);
  if(previous){const p=JSON.parse(previous);if(!Number.isSafeInteger(p.pid)||alive(p.pid)!==false)throw Error('PREPARATION_ALREADY_RUNNING');if(await maybeRead(guardPath)!==previous)throw Error('LOCK_REPLACED');await unlink(guardPath);}
  const guard=await open(guardPath,'wx').catch(()=>{throw Error('PREPARATION_ALREADY_RUNNING');});
  await guard.writeFile(JSON.stringify({pid:process.pid}));await guard.sync();
  let reserved=false;
  try{
    await same();
    if(!raw){const f=await open(path,'wx');expectedRaw=JSON.stringify({pid:process.pid,mode:'preparing'});await f.writeFile(expectedRaw);await f.close();reserved=true;}
    const browsers:PreparedBrowser[]=[];
    for(const [i,b] of (two?[browserA,browserB]:[browserA]).entries()){
      const prepared=await (deps.inspect??inspectForPreparation)(b,safety);
      browsers.push(prepared);
    }
    // Inspect every required browser before deciding whether any state is safe
    // to normalize. In particular, a FINAL_ACTION_DISPATCHING record in A must
    // not prevent inspection of B's independent Onda checkout.
    for(const [i,browser] of browsers.entries()){
      const workerRecord=legacy||record?.mode==='extended'?records[i]:i===0?record:undefined;
      assertResetSafe(workerRecord,browser.observed,browser.expired);
    }
    // Only normalize after all browser state and durable records are safe.
    for(const browser of browsers){await same();safety.check();await browser.normalize(date);}
    if(raw){await same();for(const [i,r] of subordinate.entries())if(r)await unlink(workerPaths[i]!);await unlink(path);}
    else if(reserved){const r=JSON.parse((await readFile(path,'utf8')));if(r.pid!==process.pid||r.mode!=='preparing')throw Error('LOCK_REPLACED');await unlink(path);reserved=false;}
  }finally{await guard.close();await unlink(guardPath);}
}

async function inspectForPreparation(b:BrowserIdentity,safety:Safety):Promise<PreparedBrowser>{
  await promisify(execFile)('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/start-onda-chrome.ps1',...(b.workerId==='B'?['-Worker','B']:[])],{windowsHide:true,timeout:60000});
  safety.check();verifyDedicatedChrome(b);
  const browser=await chromium.connectOverCDP(b.cdpUrl,{timeout:10000});
  const candidates=browser.contexts().flatMap(c=>c.pages()).filter(p=>{try{return new URL(p.url()).origin===new URL(ONDA_URL).origin;}catch{return false;}});
  if(candidates.length!==1)throw Error('ONDA_TAB_AMBIGUOUS_OR_MISSING');
  const page=candidates[0]!;page.setDefaultTimeout(10000);monitorConnection(browser,page,safety);
  const reason=securityReason(await page.locator('body').innerText());if(reason)throw Error(reason);
  const observed=await inspectLockPage(page);
  if(['Review Booking','Payment Summary'].includes(observed.page)&&(page.url()!==ONDA_URL||await page.locator('h2').count()!==1||(await page.locator('h2').innerText()).trim()!==VENUE))throw Error('WRONG_VENUE');
  const expired=await page.evaluate(()=>{
    const labels=[...document.querySelectorAll('p')].filter(p=>p.textContent?.trim()==='Slot reserved for'&&p.getClientRects().length);
    return labels.length===1&&[...(labels[0]!.parentElement?.querySelectorAll('p')??[])].some(p=>/^(?:0?0):00$/.test(p.textContent?.trim()??''));
  });
  return {observed,expired,normalize:async(date)=>{
    await prepareSchedule(page,safety,date);
  }};
}

export async function prepareSchedule(page:Page,safety:Safety,date?:string){
  safety.check();
    await page.goto(ONDA_URL,{waitUntil:'domcontentloaded'});
    const target=date??DateTime.now().setZone('Asia/Manila').toISODate()!;
    await navigateDate(page,target,safety);
    const cells=validateSnapshot(await snapshot(page),target);
    if(cells.some(c=>c.state==='SELECTED'))throw Error('PREEXISTING_SELECTION');
    await assertDiagnosticSchedule(page,safety);
}
