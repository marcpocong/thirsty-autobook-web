import { it,expect,vi } from 'vitest';
import { DateTime } from 'luxon';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlanRequestSchema,candidatePlans,resolveBookingPlan,splitPatterns,type PlanRequest } from '../src/booking-plan.js';
import { coordinateBooking } from '../src/booking-coordinator.js';
import { selectionAmount } from '../src/selection.js';
import { Safety } from '../src/safety.js';
import { Telemetry } from '../src/telemetry.js';
import { lifecycleWriter } from '../src/checkout-lifecycle.js';
import { assertResetSafe } from '../src/booking-prepare.js';
import { type Snapshot } from '../src/grid.js';
import { type DualWorker } from '../src/dual-coordinator.js';
import { reviewBundleSummary } from '../src/onda-checkout.js';
import { VENUE,BookingSetupSchema } from '../src/config.js';
import { defaultSetup } from '../ui/booking.js';
const date='2026-09-15';
function request(duration=4,count:1|2=2):PlanRequest{return {strategy:duration>3?'extended':'standard',date,start:'18:00',duration,courtCount:count,priority:[7,6,5,4,3,2,1],fallbackStarts:[]};}
function grid():Snapshot{const g:Snapshot={heading:DateTime.fromISO(date).toFormat('ccc, LLLL d'),busy:false,rows:[],cells:[]};const h=(n:number)=>`${n%12||12} ${n%24<12?'AM':'PM'}`;for(let n=8;n<24;n++){const hour=`${String(n).padStart(2,'0')}:00`;g.rows.push({date,hour});for(let court=1;court<=7;court++)g.cells.push({date,hour,label:`Court ${court}: Mango Wing ${h(n)} to ${h(n+1)} available`,state:'available',disabled:false});}return g;}
function set(g:Snapshot,court:number,hour:string,state:string){const c=g.cells.find(c=>c.hour===hour&&c.label.startsWith(`Court ${court}:`))!;c.state=state;c.disabled=state==='unavailable';c.label=c.label.replace(/(available|unavailable|selected)$/,state);}
function only(g:Snapshot,hours:string[],courts:number[]){for(const hour of hours)for(let c=1;c<=7;c++)if(!courts.includes(c))set(g,c,hour,'unavailable');}
function harness(r=request()){
  const grids=r.strategy==='standard'?[grid()]:[grid(),grid()],calls:string[]=[];
  const workers=grids.map((g,i):DualWorker=>{const safety=new Safety();return {id:i===0?'A':'B',safety,telemetry:new Telemetry(),state:async()=>{},checkout:vi.fn(async()=>{expect(workers.every(w=>w.safety.locked)).toBe(true);calls.push(`${i}:Proceed`);}),port:{guard:async()=>safety.check(),read:async()=>structuredClone(g),click:async(d,c,h,state)=>{calls.push(`${i}:${c}/${h}/${state}`);set(g,c,h,state==='OPEN'?'selected':'available');},summary:async()=>{const selected=g.cells.filter(c=>c.state==='selected');const count=new Set(selected.map(c=>c.label.slice(0,7))).size;return {count:`${count} Court${count===1?'':'s'} • ${selected.length} Slots`,amount:`PHP ${count*500}`,actionable:true};}}};});
  return {grids,workers,calls,run:(confirm?:()=>Promise<boolean>)=>coordinateBooking(workers,r,grids,1000,3,'full',confirm)};
}
it.each([1,2,3,4,5,6])('accepts strategy duration %i and exact continuous same-date coverage',duration=>{
  const r=request(duration);expect(PlanRequestSchema.safeParse(r).success).toBe(true);
  for(const p of candidatePlans(r)){expect(p.chunks.flatMap(c=>c.hours)).toEqual(Array.from({length:duration},(_,i)=>`${18+i}:00`));expect(p.chunks.every(c=>c.duration<=3)).toBe(true);expect(p.date).toBe(date);}
});
it.each([['standard',4],['extended',3],['extended',7]])('rejects %s duration %s',(strategy,duration)=>{expect(PlanRequestSchema.safeParse({...request(),strategy,duration}).success).toBe(false);expect(BookingSetupSchema.safeParse({...defaultSetup,BOOKING_TYPE:strategy,DURATION_HOURS:duration}).success).toBe(false);});
it('rejects crossing midnight, permits midnight endpoint',()=>{expect(PlanRequestSchema.safeParse({...request(),start:'20:00'}).success).toBe(true);expect(PlanRequestSchema.safeParse({...request(),start:'21:00'}).success).toBe(false);});
it('ranks every supported split',()=>{expect(splitPatterns(4)).toEqual([[3,1],[2,2],[1,3]]);expect(splitPatterns(5)).toEqual([[3,2],[2,3]]);expect(splitPatterns(6)).toEqual([[3,3]]);});
it.each([2,1])('falls back to %i hour first chunk before declaring unavailable',first=>{
  const a=grid(),b=grid();only(a,['18:00','19:00','20:00'],[7,6]);only(b,['19:00','20:00','21:00'],[5,4]);
  only(a,first===2?['20:00']:['19:00','20:00'],[]);
  expect(resolveBookingPlan(request(),[a,b])!.chunks.map(c=>c.duration)).toEqual([first,4-first]);
});
it.each([[[7,6],[7,6]],[[7,5,4],[7,5]],[[4,3],[4,3]]])('preserves maximum available overlap or switches the entire pair', (available,expected)=>{
  const a=grid(),b=grid();only(a,['18:00','19:00','20:00'],[7,6,4]);only(b,['21:00'],available);
  const plan=resolveBookingPlan(request(),[a,b])!;expect(plan.chunks[0]!.courts).toEqual([7,6]);expect(plan.chunks[1]!.courts).toEqual(expected);
});
it('does not switch courts inside a chunk',()=>{const a=grid(),b=grid();only(a,['18:00'],[7]);only(a,['19:00'],[6]);only(a,['20:00'],[5]);expect(resolveBookingPlan({...request(6,1)},[a,b])).toBeUndefined();});
it('moves the entire block to a fallback start',()=>{const a=grid(),b=grid();only(a,['18:00'],[]);const p=resolveBookingPlan({...request(),fallbackStarts:['19:00']},[a,b])!;expect(p.requestedStart).toBe('19:00');expect(p.chunks.flatMap(c=>c.hours)).toEqual(['19:00','20:00','21:00','22:00']);});
it('exact targets do not substitute',()=>{const a=grid(),b=grid();only(b,['21:00'],[7,5]);expect(resolveBookingPlan({...request(),exact:[[7,6],[7,6]]},[a,b])).toBeUndefined();});
it.each([1,2] as const)('Standard %i court uses one worker and one checkout',async count=>{const h=harness(request(3,count));const r=await h.run();expect(r.status).toBe('PAYMENT HOLD ACTIVE');expect(h.workers).toHaveLength(1);expect(h.calls.filter(c=>c.endsWith('OPEN'))).toHaveLength(3*count);expect(h.calls.filter(c=>c.endsWith('Proceed'))).toHaveLength(1);});
it.each([1,2] as const)('Extended %i court verifies both complete selections before two checkouts',async count=>{const h=harness(request(4,count));const r=await h.run();expect(r.status).toBe('PAYMENT HOLD ACTIVE');expect(h.calls.filter(c=>c.endsWith('OPEN'))).toHaveLength(4*count);expect(h.calls.filter(c=>c.endsWith('Proceed'))).toHaveLength(2);});
it('confirmation cancellation creates no selections or holds',async()=>{const h=harness();expect((await h.run(async()=>false)).status).toBe('CANCELLED');expect(h.calls).toEqual([]);});
it('confirmed Test Now retries a safe conflict with just one confirmation',async()=>{const h=harness(),confirm=vi.fn(async()=>true),click=h.workers[1]!.port.click;let failed=false;h.workers[1]!.port.click=async(...a)=>{if(!failed){failed=true;set(h.grids[1]!,a[1],a[2],'unavailable');throw Error('conflict');}await click(...a);};expect((await h.run(confirm)).status).toBe('PAYMENT HOLD ACTIVE');expect(confirm).toHaveBeenCalledOnce();});
it('an over-limit second checkout prevents both Proceeds despite a lower first-checkout total',async()=>{const h=harness();h.workers[1]!.port.summary=async()=>({count:'2 Courts • 2 Slots',amount:'PHP 2001',actionable:true});await expect(h.run()).rejects.toThrow('UNSAFE_FOR_RECOVERY');expect(h.calls.filter(c=>c.endsWith('Proceed'))).toHaveLength(0);});
it('a durable write failure prevents final dispatch',async()=>{const s=new Safety(),action=vi.fn(async()=>{});s.persistStage=async()=>{throw Error('DISK_WRITE_FAILED');};await expect(s.finalAction(action)).rejects.toThrow('DISK_WRITE_FAILED');expect(action).not.toHaveBeenCalled();});
it('failed second chunk cleans both before a fresh bounded replan',async()=>{const h=harness(),click=h.workers[1]!.port.click;let failed=false;h.workers[1]!.port.click=async(...a)=>{if(!failed){failed=true;set(h.grids[1]!,a[1],a[2],'unavailable');throw Error('conflict');}await click(...a);};expect((await h.run()).status).toBe('PAYMENT HOLD ACTIVE');expect(h.calls.some(c=>c.endsWith('SELECTED'))).toBe(true);});
it('foreign selection stops without cleanup or Proceed',async()=>{const h=harness(),click=h.workers[1]!.port.click;h.workers[1]!.port.click=async(...a)=>{await click(...a);set(h.grids[1]!,1,'08:00','selected');};await expect(h.run()).rejects.toThrow('UNSAFE_FOR_RECOVERY');expect(h.calls.some(c=>c.endsWith('SELECTED')||c.endsWith('Proceed'))).toBe(false);});
it('partial success preserves first hold and reports second failure',async()=>{const h=harness();h.workers[1]!.checkout=async()=>{throw Error('PAYMENT_FAILED');};const r=await h.run();expect(r.status).toBe('PARTIAL SUCCESS');expect(r.outcomes).toEqual(['PAYMENT HOLD ACTIVE','FAILED']);});
it.each([1,2])('enforces maximum independently for each %i court checkout',count=>{expect(selectionAmount({count:`${count} Court${count===1?'':'s'} • 3 Slots`,amount:`PHP ${count*1000}`,actionable:true},3,count*1000,count)).toBe(count*1000);expect(()=>selectionAmount({count:`${count} Court${count===1?'':'s'} • 3 Slots`,amount:`PHP ${count*1000+1}`,actionable:true},3,count*1000,count)).toThrow('PRICE');});
it('validates multi-court review identities, full hours and reservation count',()=>{
  const card={venue:VENUE,fullDate:'Tuesday, September 15, 2026',shortDate:'Tue, Sep 15',court:'Court 7: Mango Wing',times:['8:00 PM - 9:00 PM','9:00 PM - 10:00 PM']};
  expect(reviewBundleSummary({count:'Your Reservations (4)',cards:[card,{...card,court:'Court 6: Mango Wing'}]},2000).courts).toEqual([7,6]);
  expect(()=>reviewBundleSummary({count:'Your Reservations (4)',cards:[card,card]},2000)).toThrow();expect(()=>reviewBundleSummary({count:'Your Reservations (5)',cards:[card,{...card,court:'Court 6: Mango Wing'}]},2000)).toThrow();
});
it.each(['SELECTION','SELECTION_VERIFIED','REVIEW','PAYMENT_SUMMARY'])('allows safe dead pre-final %s reset',stage=>{expect(()=>assertResetSafe({stage},{page:'Payment Summary',selected:null,hold:'Unknown',clean:false})).not.toThrow();});
it.each(['FINAL_ACTION_DISPATCHING','HOLD_VERIFIED'])('blocks uncertain or active %s',stage=>{expect(()=>assertResetSafe({stage},{page:'QR Checkout',selected:null,hold:'Active',clean:false})).toThrow('PAYMENT_HOLD_MAY_BE_ACTIVE');});
it('requires conclusive expiry for recorded holds; ambiguity stays blocked',()=>{const b={page:'QR Checkout' as const,selected:null,hold:'Active' as const,clean:false};expect(()=>assertResetSafe({stage:'HOLD_VERIFIED'},b,true)).not.toThrow();expect(()=>assertResetSafe({stage:'FINAL_ACTION_DISPATCHING'},b,true)).toThrow();});
it('records final dispatch durably before any final action and refuses replaced state',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'thirsty-stage-'));const path=join(dir,'lock');try{
    await writeFile(path,JSON.stringify({pid:123,runID:'fixture'}));const s=new Safety();s.persistStage=lifecycleWriter(path,{pid:123,runID:'fixture'});
    await s.finalAction(async()=>{expect(JSON.parse(await readFile(path,'utf8')).stage).toBe('FINAL_ACTION_DISPATCHING');});
    await writeFile(path,JSON.stringify({pid:456,runID:'replacement'}));await expect(s.stage('HOLD_VERIFIED')).rejects.toThrow('LOCK_REPLACED');
  }finally{await rm(dir,{recursive:true,force:true});}
});
