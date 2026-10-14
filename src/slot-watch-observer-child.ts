import { openSlotWatchBrowser } from './slot-watch-browser.js';
import { SlotWatch } from './slot-watch.js';
import { SLOT_WATCH_OBSERVER_PROTOCOL, type ObserverCommand, type ObserverEvent } from './slot-watch-observer-protocol.js';
import {networkNowMs,readNetworkClock} from './network-clock.js';

let starting=false,pendingStop:string|undefined;
let observer:Awaited<ReturnType<typeof openSlotWatchBrowser>>|undefined;
let watch: SlotWatch | undefined, activeId = '', seq = 0;
const send = (event: {type:ObserverEvent['type'];[key:string]:unknown}) => process.send?.({ protocol:SLOT_WATCH_OBSERVER_PROTOCOL,id:activeId,seq:++seq,...event });
const safeCode=(error:unknown)=>error instanceof Error&&/^[A-Z][A-Z0-9_]{0,79}$/.test(error.message)?error.message:'OBSERVER_FAILED';
process.on('message',(raw:unknown)=>{void (async()=>{
  const command=raw as ObserverCommand;
  if (!command || command.protocol!==SLOT_WATCH_OBSERVER_PROTOCOL || typeof command.id!=='string') return;
  if(command.type==='stop'&&command.id===activeId){pendingStop=command.reason;if(watch)await watch.stop(command.reason);return;}
  if(command.type!=='start'||watch||starting) return;
  starting=true;
  activeId=command.id;seq=0;
  try{
    observer=command.browserObservation===true?await openSlotWatchBrowser(command.directory).catch(()=>undefined):undefined;
    const offset=()=>command.clockPath?readNetworkClock(command.clockPath)?.offsetMs??command.clockOffsetMs:command.clockOffsetMs;
    watch=new SlotWatch({date:command.date,releaseMs:command.releaseMs,directory:command.directory,clockOffsetMs:command.clockOffsetMs,clockSynced:command.clockSynced,
      readAvailability:observer?.read??(async()=>{throw Error('AVAILABILITY_OBSERVER_BROWSER_REQUIRED');}),
      now:()=>command.clockPath?networkNowMs(command.clockPath):Date.now()+command.clockOffsetMs,clockOffset:offset,candidates:command.candidates,
      onUpdate:view=>send({type:'view',view:{...view,id:activeId}}),onObservation:observation=>send({type:'observation',observation})});
    if(pendingStop)void watch.stop(pendingStop);
    send({type:'started'});
    const summary=await watch.done;await observer?.close();send({type:'complete',summary:{...summary,id:activeId}});process.disconnect?.();
  }catch(error){send({type:'failed',code:safeCode(error)});await observer?.close();process.disconnect?.();}
  })();});
process.on('disconnect',()=>{pendingStop='observer parent disconnected';void (async()=>{await watch?.stop(pendingStop);await observer?.close();process.exit(0);})();});
