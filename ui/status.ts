import { browserSessionId } from '../src/browser-session.js';
import { access,readFile,readdir,stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DateTime } from 'luxon';
import { loadObservationConfig, releaseCalendar, releaseCalendarOn, type ReleaseSettings } from '../src/config.js';
import {UiEventSchema} from '../src/ui-events.js';
import type {Dashboard,QrHandoffSummary} from './types.js';
import {browserIdentity} from '../src/browser.js';
import {networkClockFresh,networkNowMs,readNetworkClock} from '../src/network-clock.js';

export async function readLock(root: string): Promise<boolean> {
  try { await access(resolve(root, '.local/automation.lock')); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; return true; }
}
export interface RetainedHoldStatus { stage:'HOLD_VERIFIED'|'FINAL_ACTION_DISPATCHING'; expiresAt:string|null; remainingSeconds:number|null }
export interface PreviousHold { runID:string; archivedAt:string; expiresAt:string|null }
export async function readPreviousHolds(root:string):Promise<PreviousHold[]>{
  const directory=resolve(root,'.local/retained-holds');
  const names=await readdir(directory).catch(()=>[] as string[]);
  const holds=await Promise.all(names.filter(name=>/^[a-f0-9-]{36}\.json$/.test(name)).map(async name=>{
    try{
      const value=JSON.parse(await readFile(resolve(directory,name),'utf8')) as {archivedAt?:unknown;lock?:Record<string,unknown>;workers?:Record<string,unknown>[]};
      if(typeof value.archivedAt!=='string'||!Number.isFinite(Date.parse(value.archivedAt)))return null;
      const records=[value.lock??{},...(Array.isArray(value.workers)?value.workers:[])];
      const expiries=records.filter(record=>record.stage==='HOLD_VERIFIED').map(record=>record.holdExpiresAt).filter((v):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v)));
      const runID=typeof value.lock?.runID==='string'?value.lock.runID:'Unknown';
      return {runID,archivedAt:value.archivedAt,expiresAt:expiries.sort((a,b)=>Date.parse(b)-Date.parse(a))[0]??null};
    }catch{return null;}
  }));
  return holds.filter((hold):hold is PreviousHold=>!!hold).sort((a,b)=>Date.parse(b.archivedAt)-Date.parse(a.archivedAt));
}
export async function readRetainedHold(root:string,now=Date.now()):Promise<RetainedHoldStatus|null>{
  try{
    const lock=JSON.parse(await readFile(resolve(root,'.local/automation.lock'),'utf8')) as Record<string,unknown>;
    const workers:Record<string,unknown>[]=lock.mode==='extended'?await Promise.all(['a','b'].map(id=>readFile(resolve(root,`.local/dual/worker-${id}.lock`),'utf8').then(raw=>JSON.parse(raw) as Record<string,unknown>).catch(()=>({} as Record<string,unknown>)))):[];
    const records:Record<string,unknown>[]=[lock,...workers];
    // An armed Precision lock is shown (and recovered) exactly like an unresolved final action.
    const stage=records.some(record=>record.stage==='FINAL_ACTION_DISPATCHING'||record.stage==='FINAL_ACTION_ARMED')?'FINAL_ACTION_DISPATCHING':records.some(record=>record.stage==='HOLD_VERIFIED')?'HOLD_VERIFIED':null;
    if(!stage)return null;
    const expiries=records.filter(record=>record.stage==='HOLD_VERIFIED').map(record=>record.holdExpiresAt).filter((value):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value)));
    const expiresAt=expiries.sort((a,b)=>Date.parse(b)-Date.parse(a))[0]??null;
    return {stage,expiresAt,remainingSeconds:expiresAt?Math.max(0,Math.ceil((Date.parse(expiresAt)-now)/1000)):null};
  }catch{return null;}
}
export async function readHandoff(root:string):Promise<Dashboard['handoff']>{
  try {const lock=JSON.parse(await readFile(resolve(root,'.local/automation.lock'),'utf8'));const event=UiEventSchema.safeParse(lock.handoff);return event.success&&event.data.type==='handoff'?event.data:null;}catch{return null;}
}
/** Restore only QR pages verified in the latest API run that matches the retained hold. */
export async function readLatestQrHandoffs(root:string,expiresAt:string):Promise<QrHandoffSummary[]>{
  const directory=resolve(root,'.local/api-booking/run-progress');
  const files=await readdir(directory).catch(()=>[] as string[]);
  const dated=await Promise.all(files.filter(name=>/^[a-f0-9-]{36}\.ndjson$/.test(name)).map(async name=>({name,modified:(await stat(resolve(directory,name)).catch(()=>null))?.mtimeMs??0})));
  const latest=dated.sort((a,b)=>b.modified-a.modified)[0];
  if(!latest)return [];
  try{
    const entries=(await readFile(resolve(directory,latest.name),'utf8')).split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line) as Record<string,unknown>);
    const qr=entries.filter(entry=>entry.stage==='OFFICIAL_QRPH_HANDOFF');
    if(!qr.some(entry=>entry.holdExpiresAt===expiresAt))return [];
    const results=new Map<string,QrHandoffSummary>();
    for(const entry of qr){
      const worker=entry.workerId;
      if(!['A','B','C','D','E','F','G','H'].includes(String(worker))||typeof entry.date!=='string'||typeof entry.startTime!=='string'||typeof entry.court!=='number'||typeof entry.durationHours!=='number'||typeof entry.price!=='number'||typeof entry.at!=='string')continue;
      const courts=[entry.court,...(typeof entry.courtB==='number'?[entry.courtB]:[])];
      if(entry.wing!==undefined&&entry.wing!=='MANGO'&&entry.wing!=='BUKO')continue;
      results.set(String(worker),{...(entry.wing?{wing:entry.wing as 'MANGO'|'BUKO'}:{}),checkout:worker as import('../src/workers.js').WorkerId,courts,date:entry.date,startTime:entry.startTime,endTime:`${String(Number(entry.startTime.slice(0,2))+entry.durationHours).padStart(2,'0')}:00`,amount:entry.price,verifiedAt:entry.at,...(typeof entry.holdExpiresAt==='string'?{holdExpiresAt:entry.holdExpiresAt}:{})});
    }
    return [...results.values()].sort((a,b)=>a.checkout!.localeCompare(b.checkout!));
  }catch{return [];}
}
export async function probeCdp(): Promise<boolean> {
  return (await probeBrowserHealth()).A;
}
async function probePort(port:number):Promise<boolean>{
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1200), redirect: 'error' });
    const data = await response.json() as { Browser?: string };
    return response.ok && typeof data.Browser === 'string' && data.Browser.startsWith('Chrome/');
  } catch { return false; }
}
export async function probeBrowserHealth(){const ids=['A','B','C','D','E','F','G','H'] as const;const values=await Promise.all(ids.map(id=>probePort(browserIdentity(id).port)));return Object.fromEntries(ids.map((id,index)=>[id,!!values[index]])) as Record<import('../src/workers.js').WorkerId,boolean>;}
export interface BrowserReadinessProbe {chromeVersion?:string|null;connected:boolean;commandLatencyMs:number|null;tabCount:number;targetReady:boolean;
  /** Opaque per-launch identity (src/browser-session.ts); changes whenever this Chrome is closed and reopened. */ sessionId?:string|null}
export async function probeBrowserReadiness(){
  const ids=['A','B','C','D','E','F','G','H'] as const;
  const values=await Promise.all(ids.map(async id=>{const start=performance.now(),port=browserIdentity(id).port;
    try{const [version,tabs]=await Promise.all([fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(1200),redirect:'error'}),
      fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(1200),redirect:'error'})]);
      const versionBody=await version.json() as {Browser?:unknown;webSocketDebuggerUrl?:unknown},tabBody=await tabs.json() as Array<{type?:unknown;url?:unknown}>;
      const connected=version.ok&&typeof versionBody.Browser==='string'&&versionBody.Browser.startsWith('Chrome/');
      const pages=Array.isArray(tabBody)?tabBody.filter(tab=>tab.type==='page'):[];
      return {connected,chromeVersion:connected?String(versionBody.Browser):null,sessionId:connected?browserSessionId(versionBody.webSocketDebuggerUrl):null,commandLatencyMs:Math.round((performance.now()-start)*10)/10,tabCount:pages.filter(tab=>tab.url==='https://app.onda.fit/book/thirsty-pickle').length,targetReady:pages.some(tab=>tab.url==='https://app.onda.fit/book/thirsty-pickle')};
    }catch{return {connected:false,commandLatencyMs:null,tabCount:0,targetReady:false};}}));
  return Object.fromEntries(ids.map((id,index)=>[id,values[index]!])) as Record<import('../src/workers.js').WorkerId,BrowserReadinessProbe>;
}
export function clockStatus(config: ReleaseSettings, now?: DateTime) {
  const injected=now!==undefined,network=readNetworkClock(),effective=now??DateTime.fromMillis(networkNowMs());
  const local=effective.setZone(config.TIMEZONE),today=releaseCalendarOn(config,local.toISODate()!);
  const next = releaseCalendar(config,effective);
  return { manilaTime: effective.setZone('Asia/Manila').toFormat('HH:mm:ss'), manilaDate: effective.setZone('Asia/Manila').toFormat('ccc, LLL d, yyyy'),
    releaseMs: next.releaseMs, targetDate: next.targetDate, releaseTime: config.RELEASE_TIME, timezone: config.TIMEZONE,
    canArmToday: next.releaseMs > effective.toMillis(), canArmNext:true, todayReleasePassed:effective.toMillis()>=today.releaseMs,
    remainingMs: Math.max(0, next.releaseMs - effective.toMillis()), horizon: config.BOOKING_HORIZON_DAYS, maxReloads: config.MAX_RELEASE_RELOADS, leadMs: config.RELEASE_LEAD_MS, preopenCalendar: config.RELEASE_PREOPEN_CALENDAR,
    networkSynced:injected||networkClockFresh(network,effective.toMillis()),clockSource:injected?'injected-test-clock':network?.source??null,clockOffsetMs:network?.offsetMs??0,clockRoundTripMs:injected?0:network?.roundTripMs??null,clockSynchronizedAt:injected?effective.toISO():network?.synchronizedAt??null,
    preflightSecondsBefore:config.PREFLIGHT_SECONDS_BEFORE,wakeSecondsBefore:config.SCHEDULE_WAKE_SECONDS_BEFORE };
}
export function readClock() { return clockStatus(loadObservationConfig()); }
