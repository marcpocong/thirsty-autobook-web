import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { AvailabilityObservation } from './slot-evidence.js';
import type { SlotWatchCandidate, SlotWatchSummary, SlotWatchView } from './slot-watch.js';
import { isObserverEvent, SLOT_WATCH_OBSERVER_PROTOCOL, type ObserverCommand } from './slot-watch-observer-protocol.js';

export type ObserverHealthState='ONLINE'|'DEGRADED'|'OFFLINE';
export interface ObserverHealth {state:ObserverHealthState;lastEventAt:string|null;lastSuccessfulReadAt:string|null;lastLatencyMs:number|null;reason:string|null;sequence:number}
export interface ObserverHandle {id:string;done:Promise<SlotWatchSummary>;stop(reason:string):Promise<SlotWatchSummary>;health():ObserverHealth}
export interface ObserverLaunch {browserObservation?:boolean;nodePath:string;childPath:string;date:string;releaseMs:number;directory:string;clockPath?:string;clockOffsetMs:number;clockSynced:boolean;candidates?:SlotWatchCandidate[];
  onUpdate(view:SlotWatchView):void;onObservation?(observation:AvailabilityObservation):void;spawn?:typeof fork;execArgv?:string[]}

/** Separate Node process: availability reads and evidence aggregation never share the release dispatch event loop. */
export function startSlotWatchObserver(input:ObserverLaunch):ObserverHandle{
  const id=randomUUID(),spawn=input.spawn??fork;
  const child:ChildProcess=spawn(input.childPath,[],{execPath:input.nodePath,...(input.execArgv?{execArgv:input.execArgv}:{}),stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,THIRSTY_SLOT_WATCH_OBSERVER:'1'}});
  let settled=false,lastSeq=0,health:ObserverHealth={state:'OFFLINE',lastEventAt:null,lastSuccessfulReadAt:null,lastLatencyMs:null,reason:'starting',sequence:0};
  let resolveDone!:(value:SlotWatchSummary)=>void,rejectDone!:(reason:Error)=>void;
  const done=new Promise<SlotWatchSummary>((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});
  const fail=(code:string)=>{if(settled)return;settled=true;health={...health,state:'DEGRADED',reason:code};rejectDone(Error(code));};
  child.on('message',raw=>{
    if(!isObserverEvent(raw)||raw.id!==id){health={...health,state:'DEGRADED',reason:'OBSERVER_EVENT_MALFORMED'};return;}
    if(raw.seq<=lastSeq){health={...health,state:'DEGRADED',reason:'OBSERVER_SEQUENCE_REJECTED'};return;}
    lastSeq=raw.seq;health={...health,state:'ONLINE',lastEventAt:new Date().toISOString(),reason:null,sequence:lastSeq};
    if(raw.type==='view'){const view={...raw.view,id};if(view.lastPollAt)health={...health,lastSuccessfulReadAt:view.lastPollAt,lastLatencyMs:view.lastLatencyMs??null};input.onUpdate(view);}
    else if(raw.type==='observation')input.onObservation?.(raw.observation);
    else if(raw.type==='complete'){settled=true;health={...health,state:'OFFLINE',reason:'complete'};resolveDone({...raw.summary,id});}
    else if(raw.type==='failed')fail(raw.code);
  });
  child.once('error',()=>fail('OBSERVER_PROCESS_ERROR'));child.once('exit',code=>{if(!settled)fail(code===0?'OBSERVER_DISCONNECTED':'OBSERVER_CRASHED');});
  const start:ObserverCommand={protocol:SLOT_WATCH_OBSERVER_PROTOCOL,type:'start',...(input.browserObservation===true?{browserObservation:true}:{}),id,date:input.date,releaseMs:input.releaseMs,directory:input.directory,
    ...(input.clockPath?{clockPath:input.clockPath}:{}),clockOffsetMs:input.clockOffsetMs,clockSynced:input.clockSynced,candidates:[...(input.candidates??[])]};child.send(start);
  return {id,done,health:()=>({...health}),stop:reason=>{if(!settled){const command:ObserverCommand={protocol:SLOT_WATCH_OBSERVER_PROTOCOL,type:'stop',id,reason};child.send(command);}
    return done.finally(()=>{if(child.connected)child.disconnect();});}};
}
