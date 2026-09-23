import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Activity, QrHandoffSummary, RunHistoryEntry } from './types.js';

/** Private, append-only UI timeline shared by every booking method and test run. */
export class ActivityJournal {
  private readonly handles = new Map<string, number>();
  constructor(private readonly root: string) {}

  begin(label: string, at: string) {
    const runId = randomUUID();
    const directory = resolve(this.root, '.local/booking-runs');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${runId}.ndjson`);
    const handle = openSync(path, 'wx', 0o600);
    this.handles.set(runId, handle);
    writeSync(handle, `${JSON.stringify({ type: 'run-start', runId, label, at, elapsedMs: 0, deltaMs: 0 })}\n`);
    return { runId, path };
  }

  record(runId: string, activity: Activity) {
    const handle = this.handles.get(runId);
    if (handle === undefined) return;
    writeSync(handle, `${JSON.stringify({ type: 'activity', runId, ...activity })}\n`);
  }

  ready(runId:string,at:string,elapsedMs:number) {
    const handle=this.handles.get(runId);
    if(handle===undefined)return;
    writeSync(handle,`${JSON.stringify({type:'browser-ready',runId,at,elapsedMs})}\n`);
  }

  handoff(runId:string,summary:QrHandoffSummary) {
    const handle=this.handles.get(runId);
    if(handle===undefined)return;
    writeSync(handle,`${JSON.stringify({type:'handoff',runId,summary})}\n`);
  }

  end(runId: string, at: string, elapsedMs: number, outcome: string, readyElapsedMs?:number, label?:string) {
    const handle = this.handles.get(runId);
    if (handle === undefined) return;
    try { writeSync(handle, `${JSON.stringify({ type: 'run-end', runId, at, elapsedMs, outcome, ...(readyElapsedMs===undefined?{}:{readyElapsedMs}), ...(label?{label}:{}) })}\n`); }
    finally { closeSync(handle); this.handles.delete(runId); }
  }

  history(limit=500):RunHistoryEntry[] {
    const directory=resolve(this.root,'.local/booking-runs');
    if(!existsSync(directory))return [];
    return readdirSync(directory).filter(name=>name.endsWith('.ndjson')).map(name=>({name,mtime:statSync(join(directory,name)).mtimeMs}))
      .sort((a,b)=>b.mtime-a.mtime).slice(0,Math.max(limit*3,limit)).flatMap(({name})=>{
        try{
          const rows=readFileSync(join(directory,name),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line) as Record<string,unknown>);
          const start=rows.find(row=>row.type==='run-start'),end=[...rows].reverse().find(row=>row.type==='run-end');
          if(!start||!end||typeof start.runId!=='string'||typeof start.at!=='string'||typeof end.at!=='string'||typeof end.elapsedMs!=='number'||typeof end.outcome!=='string')return [];
          const marker=rows.find(row=>row.type==='browser-ready')??rows.find(row=>row.type==='activity'&&typeof row.text==='string'&&/API browser ready|DUAL READY/.test(row.text));
          const inferredStart=typeof start.label==='string'&&!['prepare','chrome','inspect','saving','reviewing','clearing','resetting','apiPreview','closingBrowsers'].includes(start.label);
          const markerElapsed=marker&&typeof marker.elapsedMs==='number'?marker.elapsedMs:inferredStart?0:undefined;
          const readyElapsedMs=typeof end.readyElapsedMs==='number'?end.readyElapsedMs:markerElapsed===undefined?undefined:Math.max(0,end.elapsedMs-markerElapsed);
          const readyAt=marker&&typeof marker.at==='string'?marker.at:inferredStart?start.at:undefined;
          const activities=rows.flatMap(row=>row.type==='activity'&&typeof row.at==='string'&&typeof row.text==='string'&&(row.level==='info'||row.level==='error')
            ? [{at:row.at,text:row.text,level:row.level,...(typeof row.elapsedMs==='number'?{elapsedMs:row.elapsedMs}:{}),...(typeof row.deltaMs==='number'?{deltaMs:row.deltaMs}:{})} satisfies Activity]
            : []);
          const qrHandoffs=rows.reduce<QrHandoffSummary[]>((list,row)=>{
            if(row.type!=='handoff'||typeof row.summary!=='object'||!row.summary)return list;
            const summary=row.summary as QrHandoffSummary;
            const same=(value:QrHandoffSummary)=>value.checkout&&summary.checkout
              ? value.checkout===summary.checkout
              : value.date===summary.date&&value.startTime===summary.startTime&&value.endTime===summary.endTime&&value.courts.join(',')===summary.courts.join(',');
            const previous=list.find(same);
            const merged=previous?{...previous,...summary,status:previous.status==='qr-ready'?'qr-ready':summary.status}:summary;
            return [...list.filter(value=>!same(value)),merged];
          },[]).sort((a,b)=>(a.checkout??'A').localeCompare(b.checkout??'A'));
          return [{runId:start.runId,label:typeof end.label==='string'?end.label:typeof start.label==='string'?start.label:'run',startedAt:start.at,endedAt:end.at,outcome:end.outcome,totalElapsedMs:end.elapsedMs,...(readyAt?{readyAt}:{}),...(readyElapsedMs===undefined?{}:{readyElapsedMs}),activities,...(qrHandoffs.length?{qrHandoffs}:{})} satisfies RunHistoryEntry];
        }catch{return [];}
      }).slice(0,limit);
  }
}
