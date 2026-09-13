import { it, expect, vi } from 'vitest';
import { DateTime } from 'luxon';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ConfigSchema, BookingSetupSchema, compilePreferences, planFingerprint } from '../src/config.js';
import { bookingView, defaultSetup, describePlan } from '../ui/booking.js';
import { browserA, browserB, validateBrowserIdentity } from '../src/browser.js';
import { coordinateDual, resolveDualPair, cleanupOwned, dualArmGate, abortDualWorkers, type DualWorker } from '../src/dual-coordinator.js';
import { Safety } from '../src/safety.js';
import { Telemetry } from '../src/telemetry.js';
import type { Snapshot } from '../src/grid.js';
import { parseDualCommand } from '../src/dual-cli.js';
import { commandSpec } from '../ui/processes.js';
import { dualValidationFingerprint } from '../src/dual-runtime.js';

const date='2026-09-14';
const config=(extra:Record<string,unknown>={})=>ConfigSchema.parse({...defaultSetup,COURT_COUNT:2,START_TIME:'10:00',DURATION_HOURS:2,PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid',...extra});
function fixture():Snapshot {
  const grid:Snapshot={heading:DateTime.fromISO(date).setLocale('en').toFormat('ccc, LLLL d'),busy:false,rows:[],cells:[]};
  const h=(n:number)=>`${n%12||12} ${n%24<12?'AM':'PM'}`;
  for(let n=8;n<24;n++) { const hour=`${String(n).padStart(2,'0')}:00`;grid.rows.push({date,hour});
    for(let court=1;court<=7;court++)grid.cells.push({date,hour,label:`Court ${court}: Mango Wing ${h(n)} to ${h(n+1)} available`,state:'available',disabled:false}); }
  return grid;
}
function set(grid:Snapshot,court:number,hour:string,state:string){const c=grid.cells.find(c=>c.hour===hour&&c.label.startsWith(`Court ${court}:`))!;c.state=state;c.label=c.label.replace(/ (available|unavailable|selected)$/,' '+state);c.disabled=state==='unavailable';}
function harness(extra:Record<string,unknown>={}) {
  const c=config(extra),grids:[Snapshot,Snapshot]=[fixture(),fixture()],calls:string[]=[],t=new Telemetry();
  const workers=grids.map((grid,i):DualWorker=>{
    const id=i===0?'A':'B',safety=new Safety();
    return {id,safety,telemetry:new Telemetry(),state:vi.fn(async(state)=>{calls.push(`${id}:${state}`);}),
      checkout:vi.fn(async()=>{calls.push(`${id}:Proceed`);safety.boundary=true;}),
      port:{guard:async()=>safety.check(),read:async()=>structuredClone(grid),click:async(d,c,h,state)=>{safety.check();expect(d).toBe(date);calls.push(`${id}:${c}/${h}/${state}`);set(grid,c,h,state==='OPEN'?'selected':'available');},summary:async()=>({count:`1 Court • ${c.DURATION_HOURS} Slots`,amount:'PHP 1200',actionable:true})}};
  }) as [DualWorker,DualWorker];
  const run=(mode:'dry'|'practice'|'selection'|'full'='full')=>coordinateDual(workers,date,grids.map(g=>structuredClone(g)) as [Snapshot,Snapshot],c,mode,t);
  return {c,grids,calls,t,workers,run};
}
it.each([undefined,1,2])('court count %s defaults/validates',count=>{
  const raw={...defaultSetup};delete (raw as any).COURT_COUNT;if(count!==undefined)(raw as any).COURT_COUNT=count;
  expect(BookingSetupSchema.parse(raw).COURT_COUNT).toBe(count??1);
  expect(config({COURT_COUNT:count}).COURT_COUNT).toBe(count??1);
});
it.each([0,3,-1,1.5,'2',null,true])('rejects arbitrary court count %s',count=>expect(BookingSetupSchema.safeParse({...defaultSetup,COURT_COUNT:count}).success).toBe(false));
it('fingerprints change with count; single view otherwise retains compiled semantics',()=>{
  const a=bookingView(config({COURT_COUNT:1})),b=bookingView(config());
  expect(a.fingerprint).not.toBe(b.fingerprint);expect(a.preferences).toEqual(b.preferences);expect(a.slots).toEqual(b.slots);
  expect({...a.setup,COURT_COUNT:2}).toEqual(b.setup);expect(describePlan(b)).toContain('Maximum possible combined: PHP 2400');
  expect(dualValidationFingerprint(config())).not.toBe(dualValidationFingerprint(config({MAX_PRICE:1300})));
});
it('the single release and checkout default path remains gated and uses no B command',()=>{
  const source=readFileSync('src/index.ts','utf8');expect(source).toContain("config.COURT_COUNT === 2 && ['race','race:dry','selection:armed'].includes(mode)");
  expect(source.indexOf("await import('./dual-runtime.js')")).toBeGreaterThan(source.indexOf('config.COURT_COUNT === 2'));
  expect(commandSpec('chrome','root','node').args.join(' ')).not.toMatch(/dual|-Worker B/);
  expect(commandSpec({kind:'full',planHash:planFingerprint(config({COURT_COUNT:1})),authorizeTerms:true},'root','node').args).toContain('race');
  for(const file of ['src/selection.ts','src/booking-checkout.ts','src/checkout.ts','src/onda-checkout.ts','src/payment-handoff.ts','src/safety.ts'])expect(readFileSync(file,'utf8').replaceAll('\r\n','\n')).toBe(execFileSync('git',['show',`c740253:${file}`],{encoding:'utf8'}).replaceAll('\r\n','\n'));
});
it('identities enforce separate profiles and ports',()=>{
  expect(browserA.port).toBe(9222);expect(browserB.port).toBe(9223);expect(browserA.expectedProfile).toBe('.local/onda-chrome-profile');expect(browserB.expectedProfile).toBe('.local/onda-chrome-profile-b');
  expect(()=>validateBrowserIdentity(browserA)).not.toThrow();expect(()=>validateBrowserIdentity(browserB)).not.toThrow();
});
it.each([{port:9222},{expectedProfile:browserA.expectedProfile},{cdpUrl:browserA.cdpUrl},{cdpUrl:'http://192.168.1.2:9223'}])('B refuses wrong identity %s',change=>expect(()=>validateBrowserIdentity({...browserB,...change})).toThrow('CDP_IDENTITY_MISMATCH'));
it.each([1,2,3])('ranks a same-date, same-block, distinct pair for %i hours',duration=>{
  const h=harness({DURATION_HOURS:duration}),pair=resolveDualPair(date,h.grids,compilePreferences(h.c))!;
  expect(pair.date).toBe(date);expect(pair.a.court).toBe(7);expect(pair.b.court).toBe(6);expect(pair.hours).toHaveLength(duration);expect(pair.a.hours).toEqual(pair.b.hours);
});
it('skips holes, preserves court priority and primary before fallback',()=>{
  const h=harness({FALLBACK_TIMES:['14:00']});for(const g of h.grids){set(g,7,'11:00','unavailable');set(g,5,'10:00','unavailable');}
  const pair=resolveDualPair(date,h.grids,compilePreferences(h.c))!;expect([pair.a.court,pair.b.court]).toEqual([6,4]);expect(pair.start).toBe('10:00');
});
it('never mixes fallback blocks to make a pair from one court per time',()=>{
  const h=harness({FALLBACK_TIMES:['14:00']});for(const g of h.grids)for(let c=1;c<=7;c++){if(c!==7)set(g,c,'10:00','unavailable');if(c!==6)set(g,c,'14:00','unavailable');}
  expect(resolveDualPair(date,h.grids,compilePreferences(h.c))).toBeUndefined();
});
it('moves to fallback only when primary has no pair',()=>{
  const h=harness({FALLBACK_TIMES:['14:00','16:00']});for(const g of h.grids)for(let c=1;c<7;c++)set(g,c,'10:00','unavailable');
  expect(resolveDualPair(date,h.grids,compilePreferences(h.c))?.start).toBe('14:00');
});
it.each(['wrong-row-date','wrong-cell-date','unknown','selected','busy'])('fails closed before assignment for %s',kind=>{
  const h=harness(),g=h.grids[1];if(kind==='wrong-row-date')g.rows[0]!.date='2026-09-15';if(kind==='wrong-cell-date')g.cells[0]!.date='2026-09-15';if(kind==='unknown')g.cells[0]!.state='mystery';if(kind==='selected')set(g,1,'08:00','selected');if(kind==='busy')g.busy=true;
  expect(()=>resolveDualPair(date,h.grids,compilePreferences(h.c))).toThrow();expect(h.calls).toEqual([]);
});
it('optional API vetoes known overpriced candidates without changing configuration priority',()=>{
  const h=harness();const veto={rank:(_c:any,p:any[])=>p.filter(p=>p.court!==7),refresh:vi.fn()};
  const pair=resolveDualPair(date,h.grids,compilePreferences(h.c),new Set(),[veto,veto])!;expect([pair.a.court,pair.b.court]).toEqual([6,5]);expect(veto.refresh).not.toHaveBeenCalled();
});
it('dry pair has zero slot and Proceed clicks',async()=>{const h=harness();expect((await h.run('dry')).status).toBe('DUAL_DRY_PASS');expect(h.calls).toEqual([]);});
it('cannot select a single remaining court in dual mode',async()=>{const h=harness();for(const g of h.grids)for(let c=1;c<7;c++)set(g,c,'10:00','unavailable');await expect(h.run()).rejects.toThrow('NO_DUAL_PAIR_AVAILABLE');expect(h.calls).toEqual([]);});
it('selection practice verifies and cleans both workers without Proceed',async()=>{const h=harness();expect((await h.run('practice')).status).toBe('DUAL_SELECTION_PASS');expect(h.calls).toContain('A:7/10:00/SELECTED');expect(h.calls).toContain('B:6/10:00/SELECTED');expect(h.calls.some(c=>c.includes('Proceed'))).toBe(false);expect(h.grids.flatMap(g=>g.cells).some(c=>c.state==='selected')).toBe(false);});
it('both verified selections must finish before either Proceed, then checkouts run concurrently',async()=>{
  const h=harness();let finishSelection!:()=>void;const waiting=new Promise<void>(r=>finishSelection=r);const summary=h.workers[1].port.summary;
  h.workers[1].port.summary=async()=>{await waiting;return summary();};
  let finishCheckout!:()=>void;const checkoutWait=new Promise<void>(r=>finishCheckout=r);
  h.workers[0].checkout=vi.fn(async()=>{h.calls.push('A:Proceed');await checkoutWait;});
  h.workers[1].checkout=vi.fn(async()=>{h.calls.push('B:Proceed');finishCheckout();});
  const result=h.run();await vi.waitFor(()=>expect(h.calls).toContain('A:selection'));expect(h.calls).not.toContain('A:Proceed');expect(h.calls).not.toContain('B:Proceed');finishSelection();expect((await result).status).toBe('DUAL_HOLD_VERIFIED');
  expect(h.calls.indexOf('A:Proceed')).toBeGreaterThan(h.calls.indexOf('B:selection'));
});
it('B conflict causes both cleanups before A7+B5 replan',async()=>{
  const h=harness(),click=h.workers[1].port.click;
  h.workers[1].port.click=async(d,c,hour,state)=>{if(c===6&&hour==='11:00'&&state==='OPEN'){set(h.grids[1],c,hour,'unavailable');throw Error('conflict');}await click(d,c,hour,state);};
  expect((await h.run()).pair.b.court).toBe(5);expect(h.calls).toContain('A:7/10:00/SELECTED');expect(h.calls).toContain('B:6/10:00/SELECTED');
  expect(h.calls.lastIndexOf('A:7/10:00/OPEN')).toBeGreaterThan(h.calls.indexOf('A:clean'));expect(h.calls.lastIndexOf('A:7/10:00/OPEN')).toBeGreaterThan(h.calls.indexOf('B:clean'));
});
it.each(['unknown','foreign','changed-date','failed-click'])('unsafe %s cleanup cannot replan or Proceed',async(kind)=>{
  const h=harness(),click=h.workers[1].port.click;
  h.workers[1].port.click=async(...args)=>{await click(...args);if(kind==='unknown')h.grids[1].cells[0]!.state='unknown';if(kind==='foreign')set(h.grids[1],1,'08:00','selected');if(kind==='changed-date')h.grids[1].rows[0]!.date='2026-09-15';if(kind==='failed-click'&&args[3]==='SELECTED')throw Error('conflict');};
  if(kind==='failed-click')h.workers[1].port.summary=async()=>({count:'1 Court • 2 Slots',amount:'PHP 1201',actionable:true});
  await expect(h.run()).rejects.toThrow('DUAL_CLEANUP_UNVERIFIED');expect(h.calls.some(c=>c.includes('Proceed'))).toBe(false);
});
it('pair attempts are bounded and failed assignments never repeat',async()=>{const h=harness({MAX_SELECTION_ATTEMPTS:2});h.workers[1].port.click=async(_d,c,hour)=>{h.calls.push(`lost:${c}/${hour}`);throw Error('conflict');};await expect(h.run()).rejects.toThrow('DUAL_PAIR_ATTEMPTS_EXHAUSTED');expect(h.calls.filter(c=>c.startsWith('lost:'))).toEqual(['lost:6/10:00','lost:5/10:00']);});
it.each(['A','B'])('each worker enforces its own maximum in selection summary (%s)',async id=>{
  const h=harness({MAX_SELECTION_ATTEMPTS:1});h.workers[id==='A'?0:1].port.summary=async()=>({count:'1 Court • 2 Slots',amount:'PHP 1201',actionable:true});await expect(h.run()).rejects.toThrow('DUAL_PAIR_ATTEMPTS_EXHAUSTED');expect(h.calls.some(c=>c.includes('Proceed'))).toBe(false);
});
it('one checkout failure retains the other hold and never cancels it',async()=>{const h=harness();h.workers[1].checkout=vi.fn(async()=>{throw Error('checkout failed');});const r=await h.run();expect(r.status).toBe('DUAL_PARTIAL_SUCCESS');expect(r.workers).toEqual(['hold','failed']);expect(h.workers[0].safety.boundary).toBe(true);expect(h.calls.filter(c=>c.endsWith('/SELECTED'))).toEqual([]);});
it('selection only retains two verified selections and never Proceed',async()=>{const h=harness();expect((await h.run('selection')).status).toBe('DUAL_SELECTION_VERIFIED');expect(h.grids.map(g=>g.cells.filter(c=>c.state==='selected').length)).toEqual([2,2]);expect(h.calls.some(c=>c.includes('Proceed'))).toBe(false);});
it('cleanup refuses payment boundary workers',async()=>{const h=harness();h.workers[0].safety.boundary=true;await expect(cleanupOwned(h.workers[0],date,new Set())).rejects.toThrow('PAYMENT_BOUNDARY_REACHED');expect(h.calls).toEqual([]);});
it('Stop signals both active workers while leaving a payment-boundary worker untouched',()=>{
  const a=new Safety(),b=new Safety();abortDualWorkers([a,b]);expect(a.signal.aborted).toBe(true);expect(b.signal.aborted).toBe(true);
  const hold=new Safety(),active=new Safety();hold.boundary=true;abortDualWorkers([hold,active]);expect(hold.signal.aborted).toBe(false);expect(hold.boundary).toBe(true);expect(active.signal.aborted).toBe(true);
});
it('dual arming barrier waits for both workers and fails on abort',async()=>{
  const safety=new Safety(),t=new Telemetry(),gate=dualArmGate({releaseMs:Date.now()+5000},safety,t);let aReady=false;const a=gate('A').then(()=>aReady=true);await Promise.resolve();expect(aReady).toBe(false);await gate('B');await a;expect(aReady).toBe(true);expect(t.events.filter(e=>e.event==='dualArmed')).toHaveLength(1);
  const aborted=new Safety(),failed=dualArmGate({releaseMs:Date.now()+5000},aborted,new Telemetry())('A');aborted.stop('USER_ABORT');await expect(failed).rejects.toThrow('DUAL_PREFLIGHT_FAILED');
});
const fullArgs=['--armed','--authorize-terms','--noncompetitive','--date',date,'--court-a','7','--court-b','6','--start','10:00','--duration','1','--maximum-per-court','600'];
it.each(['--armed','--authorize-terms','--noncompetitive','--date','--court-a','--court-b','--start','--duration','--maximum-per-court'])('full practice requires explicit %s',flag=>{const args=[...fullArgs],index=args.indexOf(flag);args.splice(index,['--armed','--authorize-terms','--noncompetitive'].includes(flag)?1:2);expect(()=>parseDualCommand('full',args)).toThrow();});
it('full practice accepts exact authorized inputs only, distinct courts, no fallbacks',()=>{expect(parseDualCommand('full',fullArgs).exact?.b.court).toBe(6);expect(()=>parseDualCommand('full',fullArgs.map((v,i)=>fullArgs[i-1]==='--court-b'?'7':v))).toThrow();expect(()=>parseDualCommand('full',[...fullArgs,'--fallback','14:00'])).toThrow();expect(()=>parseDualCommand('race:dry',[])).toThrow('ARMED_FLAG_REQUIRED');});
