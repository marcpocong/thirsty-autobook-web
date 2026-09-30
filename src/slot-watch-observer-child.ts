import { SlotWatch } from './slot-watch.js';
import { SLOT_WATCH_OBSERVER_PROTOCOL, type ObserverCommand, type ObserverEvent } from './slot-watch-observer-protocol.js';
import {networkNowMs,readNetworkClock} from './network-clock.js';

let watch: SlotWatch | undefined, activeId = '', seq = 0;
const send = (event: {type:ObserverEvent['type'];[key:string]:unknown}) => process.send?.({ protocol:SLOT_WATCH_OBSERVER_PROTOCOL,id:activeId,seq:++seq,...event });
const safeCode=(error:unknown)=>error instanceof Error&&/^[A-Z][A-Z0-9_]{0,79}$/.test(error.message)?error.message:'OBSERVER_FAILED';
process.on('message',(raw:unknown)=>{void (async()=>{
  const command=raw as ObserverCommand;
  if (!command || command.protocol!==SLOT_WATCH_OBSERVER_PROTOCOL || typeof command.id!=='string') return;
  if(command.type==='stop'&&watch&&command.id===activeId){await watch.stop(command.reason);return;}
  if(command.type!=='start'||watch) return;
  activeId=command.id;seq=0;
  try{
    const offset=()=>command.clockPath?readNetworkClock(command.clockPath)?.offsetMs??command.clockOffsetMs:command.clockOffsetMs;
    watch=new SlotWatch({date:command.date,releaseMs:command.releaseMs,directory:command.directory,clockOffsetMs:command.clockOffsetMs,clockSynced:command.clockSynced,
      now:()=>command.clockPath?networkNowMs(command.clockPath):Date.now()+command.clockOffsetMs,clockOffset:offset,candidates:command.candidates,
      onUpdate:view=>send({type:'view',view:{...view,id:activeId}}),onObservation:observation=>send({type:'observation',observation})});
    send({type:'started'});
    const summary=await watch.done;send({type:'complete',summary:{...summary,id:activeId}});process.disconnect?.();
  }catch(error){send({type:'failed',code:safeCode(error)});process.disconnect?.();}
  })();});
process.on('disconnect',()=>{void watch?.stop('observer parent disconnected').finally(()=>process.exit(0));});
