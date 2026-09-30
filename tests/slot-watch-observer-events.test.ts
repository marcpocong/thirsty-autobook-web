import {EventEmitter} from 'node:events';
import {describe,expect,it} from 'vitest';
import {startSlotWatchObserver,type ObserverLaunch} from '../src/slot-watch-observer.js';
import {SLOT_WATCH_OBSERVER_PROTOCOL} from '../src/slot-watch-observer-protocol.js';

/** In-memory stand-in for the forked observer: deterministic IPC ordering, crashes and restarts. */
class FakeChild extends EventEmitter { sent:any[]=[];connected=true;send(message:unknown){this.sent.push(message);return true;}disconnect(){this.connected=false;} }
function launch(overrides:Partial<ObserverLaunch>={}){
  const child=new FakeChild(),views:any[]=[],observations:any[]=[];
  const handle=startSlotWatchObserver({nodePath:'node',childPath:'observer.js',date:'2026-10-03',releaseMs:Date.parse('2026-10-01T00:00:00Z'),directory:'unused',
    clockOffsetMs:0,clockSynced:true,onUpdate:view=>views.push(view),onObservation:observation=>observations.push(observation),spawn:(()=>child) as any,...overrides});
  const emit=(event:Record<string,unknown>)=>child.emit('message',{protocol:SLOT_WATCH_OBSERVER_PROTOCOL,id:handle.id,...event});
  return {child,handle,views,observations,emit};
}
const view=(seq:number)=>({type:'view',seq,view:{id:'child-local',lastPollAt:`2026-10-01T00:00:0${seq}.000Z`,lastLatencyMs:40+seq}});

describe('Slot Watch observer event validation (parent side)',()=>{
  it('sends a sanitized start command with no booking, permit or customer data',()=>{
    const {child,handle}=launch();
    expect(child.sent[0]).toMatchObject({protocol:SLOT_WATCH_OBSERVER_PROTOCOL,type:'start',id:handle.id,date:'2026-10-03'});
    expect(Object.keys(child.sent[0]).sort()).toEqual(['candidates','clockOffsetMs','clockSynced','date','directory','id','protocol','releaseMs','type']);
    expect(handle.health()).toMatchObject({state:'OFFLINE',reason:'starting'});
  });

  it('forwards ordered views and observations and tracks the newest successful read',()=>{
    const {handle,views,observations,emit}=launch();
    emit({type:'started',seq:1});emit(view(2));emit({type:'observation',seq:3,observation:{seq:1}});emit(view(4));
    expect(views.map(value=>value.lastLatencyMs)).toEqual([42,44]);
    expect(views.every(value=>value.id===handle.id)).toBe(true);
    expect(observations).toEqual([{seq:1}]);
    expect(handle.health()).toMatchObject({state:'ONLINE',sequence:4,lastSuccessfulReadAt:'2026-10-01T00:00:04.000Z',lastLatencyMs:44});
  });

  it('rejects duplicate and out-of-order events without forwarding them',()=>{
    const {handle,views,emit}=launch();
    emit(view(2));emit(view(2));
    expect(views).toHaveLength(1);expect(handle.health()).toMatchObject({state:'DEGRADED',reason:'OBSERVER_SEQUENCE_REJECTED'});
    emit(view(1));expect(views).toHaveLength(1);
    emit(view(3));expect(views).toHaveLength(2);expect(handle.health()).toMatchObject({state:'ONLINE',sequence:3});
  });

  it('rejects malformed events and events for another observer id',()=>{
    const {child,handle,views,emit}=launch();
    emit({type:'view',seq:1,view:{}});
    emit({type:'failed',seq:2,code:'raw text with secrets'});
    child.emit('message',{protocol:SLOT_WATCH_OBSERVER_PROTOCOL,id:'someone-else',...view(3)});
    child.emit('message','not an object');
    expect(views).toEqual([]);expect(handle.health()).toMatchObject({state:'DEGRADED',reason:'OBSERVER_EVENT_MALFORMED'});
  });

  it('fails the watch on a crash and never resolves it with stale data',async()=>{
    const {child,handle,emit}=launch();
    emit(view(1));child.emit('exit',1);
    await expect(handle.done).rejects.toThrow('OBSERVER_CRASHED');
    expect(handle.health()).toMatchObject({state:'DEGRADED',reason:'OBSERVER_CRASHED',lastSuccessfulReadAt:'2026-10-01T00:00:01.000Z'});
  });

  it('treats an exit before completion as a disconnect and a failed event as its code',async()=>{
    const a=launch();a.child.emit('exit',0);await expect(a.handle.done).rejects.toThrow('OBSERVER_DISCONNECTED');
    const b=launch();b.emit({type:'failed',seq:1,code:'SLOT_WATCH_CLOCK_UNSYNCED'});await expect(b.handle.done).rejects.toThrow('SLOT_WATCH_CLOCK_UNSYNCED');
    const c=launch();c.child.emit('error',Error('spawn failed'));await expect(c.handle.done).rejects.toThrow('OBSERVER_PROCESS_ERROR');
  });

  it('restarts as a fresh observer whose sequence starts again',async()=>{
    const first=launch();first.emit(view(5));first.child.emit('exit',1);await expect(first.handle.done).rejects.toThrow();
    const second=launch();expect(second.handle.id).not.toBe(first.handle.id);
    second.emit(view(1));expect(second.views).toHaveLength(1);expect(second.handle.health()).toMatchObject({state:'ONLINE',sequence:1});
  });

  it('resolves a completed watch with the parent id and stops through a scoped stop command',async()=>{
    const {child,handle,emit}=launch();
    const stopped=handle.stop('operator');
    expect(child.sent[1]).toEqual({protocol:SLOT_WATCH_OBSERVER_PROTOCOL,type:'stop',id:handle.id,reason:'operator'});
    emit({type:'complete',seq:1,summary:{version:3,id:'child-local',status:'stopped'}});
    await expect(stopped).resolves.toMatchObject({version:3,id:handle.id,status:'stopped'});
    expect(handle.health().state).toBe('OFFLINE');expect(child.connected).toBe(false);
  });
});
