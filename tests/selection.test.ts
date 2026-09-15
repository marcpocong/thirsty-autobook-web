import { describe,it,expect,vi } from 'vitest';
import { selectResolvedPreference, selectionAmount, type SelectionPort, type SelectionSummary } from '../src/selection.js';
import { type Snapshot } from '../src/grid.js';
import { Safety } from '../src/safety.js';
import { Telemetry } from '../src/telemetry.js';
import { requireCapability } from '../src/capabilities.js';
import { BookingSetupSchema } from '../src/config.js';
import type { CandidateDiscovery } from '../src/availability-discovery.js';

const date='2026-09-11';
const pref=[{court:7,hours:['10:00','11:00']},{court:6,hours:['10:00','11:00']},{court:5,hours:['10:00','11:00']}];
function fixture(){
  const hour=(h:number)=>`${h%12||12} ${h%24<12?'AM':'PM'}`;
  const grid:Snapshot={heading:'Fri, September 11',busy:false,rows:[],cells:[]};
  for(let h=8;h<24;h++){const time=`${String(h).padStart(2,'0')}:00`;grid.rows.push({date,hour:time});for(let court=1;court<=7;court++)grid.cells.push({label:`Court ${court}: Mango Wing ${hour(h)} to ${hour(h+1)} available`,date,hour:time,state:'available',disabled:false});}
  return grid;
}
function harness(){
  const grid=fixture(),safety=new Safety(),t=new Telemetry(),calls:string[]=[];
  const set=(court:number,hour:string,state:string)=>{const c=grid.cells.find(c=>c.hour===hour&&c.label.startsWith(`Court ${court}:`))!;c.state=state;c.label=c.label.replace(/ (available|selected|unavailable)$/,' '+state);c.disabled=state==='unavailable';};
  const port:SelectionPort={guard:async()=>{safety.check();},read:async()=>structuredClone(grid),click:async(_d,c,h,state)=>{calls.push(`${c}/${h}/${state}`);set(c,h,state==='OPEN'?'selected':'available');},summary:async()=>({count:'1 Court • 2 Slots',amount:'₱1,200',actionable:true})};
  const run=(preferences=pref,max=3,discovery?:CandidateDiscovery)=>selectResolvedPreference(port,date,structuredClone(grid),preferences,1200,max,safety,t,discovery);
  return {grid,safety,t,calls,set,port,run};
}
describe('selection-only engine',()=>{
  it('selects and verifies consecutive same-court slots; locks without a Proceed operation',async()=>{
    const h=harness();const r=await h.run();expect(r).toMatchObject({court:7,amount:1200,proceedReady:true,attempts:1});expect(h.calls).toEqual(['7/10:00/OPEN','7/11:00/OPEN']);expect(h.safety.locked).toBe(true);expect(()=>h.safety.fallback()).toThrow('BOOKING_LOCKED');
  });
  it.each([0,1])('handles a lost race on slot index %i, cleans owned partial selection, then takes next court',async(index)=>{
    const h=harness(),click=h.port.click;let lost=false;
    h.port.click=async(d,c,hour,state)=>{if(!lost&&c===7&&hour===pref[0]!.hours[index]&&state==='OPEN'){lost=true;h.calls.push('conflict');h.set(c,hour,'unavailable');throw Error('conflict');}await click(d,c,hour,state);};
    const r=await h.run();expect(r.court).toBe(6);expect(r.attempts).toBe(2);expect(h.calls.includes('7/10:00/SELECTED')).toBe(index===1);expect(h.t.events.some(e=>e.event==='selectionConflict')).toBe(true);
  });
  it('recognizes a dispatched selection despite a click timeout and safely cleans it before fallback',async()=>{
    const h=harness(),click=h.port.click;let failed=false;h.port.click=async(...a)=>{await click(...a);if(!failed){failed=true;throw Error('timeout after dispatch');}};
    expect((await h.run()).court).toBe(6);expect(h.calls).toContain('7/10:00/SELECTED');
  });
  it('falls back after an incomplete selection without an exception',async()=>{
    const h=harness(),click=h.port.click;h.port.click=async(...a)=>{if(a[1]===7&&a[2]==='11:00'&&a[3]==='OPEN')return;await click(...a);};expect((await h.run()).court).toBe(6);
  });
  it('bounds attempts and never repeats duplicate candidates',async()=>{
    const h=harness();h.port.click=async(_d,c,hour)=>{h.calls.push(`${c}/${hour}`);throw Error('conflict');};
    await expect(h.run([pref[0]!,pref[0]!,pref[1]!,pref[2]!],2)).rejects.toThrow('ATTEMPTS_EXHAUSTED');expect(h.calls).toEqual(['7/10:00','6/10:00']);
  });
  it('uses ordered fallback times after exhausted primary courts',async()=>{
    const h=harness();for(const p of pref)h.set(p.court,'10:00','unavailable');expect((await h.run([...pref,{court:7,hours:['12:00','13:00']}])).hours).toEqual(['12:00','13:00']);
  });
  it('cleans a complete selection if Proceed is not actionable, then uses next preference',async()=>{
    const h=harness();let n=0;h.port.summary=async()=>({count:'1 Court • 2 Slots',amount:'₱1,200',actionable:++n>1});expect((await h.run()).court).toBe(6);expect(h.calls).toContain('7/11:00/SELECTED');
  });
  it.each(['price','count','amount'])('fails closed on %s mismatch without cleanup or Proceed',async(kind)=>{
    const h=harness();h.port.summary=async()=>({count:kind==='count'?'2 Courts • 2 Slots':'1 Court • 2 Slots',amount:kind==='price'?'₱1,201':kind==='amount'?'unknown':'₱1,200',actionable:true});await expect(h.run()).rejects.toThrow('SELECTION_');expect(h.calls).toHaveLength(2);expect(h.safety.locked).toBe(false);
  });
  it.each(['date','unknown','foreign'])('stops on %s uncertainty and performs no cleanup',async(kind)=>{
    const h=harness(),click=h.port.click;h.port.click=async(...a)=>{await click(...a);if(kind==='date')h.grid.rows[0]!.date='2026-09-12';else if(kind==='unknown')h.grid.cells[0]!.state='new-state';else h.set(1,'08:00','selected');};await expect(h.run()).rejects.toThrow();expect(h.calls).toHaveLength(2);
  });
  it('refuses existing selected cells',async()=>{const h=harness();h.set(1,'08:00','selected');await expect(h.run()).rejects.toThrow('PREEXISTING');expect(h.calls).toEqual([]);});
  it.each([0,1])('abort after slot %i prevents all later actions, including cleanup',async(index)=>{
    const h=harness(),click=h.port.click;h.port.click=async(...a)=>{await click(...a);if(a[2]===pref[0]!.hours[index])h.safety.stop('USER_ABORT');};await expect(h.run()).rejects.toThrow('USER_ABORT');expect(h.calls).toHaveLength(index+1);
  });
  it('security guard failure never cleans up or retries',async()=>{const h=harness();let n=0;h.port.guard=async()=>{if(++n===2)h.safety.stop('SECURITY_CHALLENGE');h.safety.check();};await expect(h.run()).rejects.toThrow('SECURITY_CHALLENGE');expect(h.calls).toHaveLength(2);});
  it('cleanup failure never starts another candidate',async()=>{const h=harness(),click=h.port.click;h.port.click=async(...a)=>{if(a[2]==='11:00'||a[3]==='SELECTED')throw Error('changed');await click(...a);};await expect(h.run()).rejects.toThrow('changed');expect(h.calls.every(c=>c.startsWith('7/'))).toBe(true);});
  it('rejects nonconsecutive hours before clicking',async()=>{const h=harness();await expect(h.run([{court:7,hours:['10:00','12:00']}])).rejects.toThrow('INVALID_PREFERENCE');expect(h.calls).toEqual([]);});
  it('selection is enabled while full booking requires every verified capability',()=>{expect(()=>requireCapability('selection:armed')).not.toThrow();expect(()=>requireCapability('race',{selectionReady:true,checkoutReady:true,paymentBoundaryReady:false})).toThrow('LIVE_RACE_BLOCKED');});
  it('does not expose arbitrary summary text through telemetry',async()=>{const h=harness();h.port.summary=async()=>({count:'a-private-name',amount:'user@example.com',actionable:true});await expect(h.run()).rejects.toThrow();const serialized=JSON.stringify(h.t.events);expect(serialized).not.toContain('a-private-name');expect(serialized).not.toContain('@');});
  it('refreshes only after verified cleanup, excludes attempts and never trusts a candidate over UI',async()=>{
    const h=harness(),click=h.port.click;
    h.port.click=async(...args)=>{if(args[1]===7&&args[2]==='11:00'&&args[3]==='OPEN')throw Error('conflict');await click(...args);};
    const rank=vi.fn((_cells,preferences)=>preferences);
    const refresh=vi.fn(()=>{expect(h.t.events.at(-1)?.event).toBe('selectionCleanupVerified');expect(h.grid.cells.some(c=>c.state==='selected')).toBe(false);});
    const result=await h.run(pref,3,{rank,refresh});
    expect(result.court).toBe(6);expect(refresh).toHaveBeenCalledOnce();
    expect(rank.mock.calls[1]![1].some((p:{court:number})=>p.court===7)).toBe(false);
    expect(h.calls).toContain('7/10:00/SELECTED');
  });
  it('never refreshes after unsafe cleanup or the last permitted attempt',async()=>{
    const h=harness(),refresh=vi.fn();h.port.click=async()=>{throw Error('conflict');};
    await expect(h.run(pref,1,{rank:(_cells,p)=>p,refresh})).rejects.toThrow('ATTEMPTS_EXHAUSTED');
    expect(refresh).not.toHaveBeenCalled();
  });
});
it('validates schedule bounds, court permutations and fallback ordering at the settings boundary',()=>{
  const base={START_TIME:'22:00',DURATION_HOURS:2,PREFERRED_COURTS:[7,6,5,4,3,2,1],FALLBACK_TIMES:[],MAX_PRICE:1200};expect(BookingSetupSchema.safeParse(base).success).toBe(true);
  for(const invalid of [{DURATION_HOURS:3},{START_TIME:'07:00'},{PREFERRED_COURTS:[7,7,5,4,3,2,1]},{FALLBACK_TIMES:['22:00']},{MAX_SELECTION_ATTEMPTS:6},{PLAYER_FULL_NAME:'not permitted'}])expect(BookingSetupSchema.safeParse({...base,...invalid}).success).toBe(false);
});
