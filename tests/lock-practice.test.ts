import {it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {reviewLock,clearVerifiedLock,lockReason,pidAlive} from '../ui/locks.js';
import {Controller} from '../ui/controller.js';
import {bookingView,defaultSetup} from '../ui/booking.js';
import {ConfigSchema,ObservationSchema} from '../src/config.js';
import {clockStatus} from '../ui/status.js';
import {readRetainedHold} from '../ui/status.js';
import {DateTime} from 'luxon';
import {FullPracticeSchema} from '../src/full-practice.js';
import {commandSpec} from '../ui/processes.js';
const clean={page:'Schedule' as const,selected:0,hold:'Not detected' as const,clean:true};
const safe={...clean,pid:123,alive:false,owned:false};
it.each([
 [{alive:true},'LOCK_PID_RUNNING'],[{owned:true},'LOCK_PID_RUNNING'],[{selected:2,clean:false},'LOCK_SELECTED_SLOTS'],
 [{page:'QR Checkout',hold:'Active',clean:false},'LOCK_PAYMENT_HOLD_ACTIVE'],[{page:'Unknown',clean:false},'LOCK_BROWSER_STATE_UNKNOWN'],
 [{alive:null},'LOCK_BROWSER_STATE_UNKNOWN'],[{pid:null},'LOCK_BROWSER_STATE_UNKNOWN'],[{hold:'Unknown'},'LOCK_BROWSER_STATE_UNKNOWN'],
 [{page:'Payment Summary'},'LOCK_BROWSER_STATE_UNKNOWN'],[{},'VERIFIED_STALE_LOCK']
])('fails closed for lock state %j', (change,reason)=>{expect(lockReason({...safe,...change} as typeof safe)).toBe(reason);});
it('PID check identifies the current live process',()=>expect(pidAlive(process.pid)).toBe(true));
it.skipIf(process.platform!=='win32')('PID check confirms a nonexistent Windows process',()=>expect(pidAlive(2147483647)).toBe(false));
it('reads without mutation, rechecks on clear and preserves changed locks',async()=>{
 await mkdir('.local',{recursive:true});const root=await mkdtemp(resolve('.local/lock-review-test-'));
 try{
  await mkdir(resolve(root,'.local'));const path=resolve(root,'.local/automation.lock'),raw=JSON.stringify({pid:123,runID:'fixture'});await writeFile(path,raw);
  const probe=vi.fn(async()=>clean),dead=()=>false;const review=await reviewLock(root,false,probe,dead);
  expect(review.canClear).toBe(true);expect(await readFile(path,'utf8')).toBe(raw);
  await expect(clearVerifiedLock(root,review.fingerprint,()=>false,async()=>({...clean,hold:'Active'}),dead)).rejects.toThrow('LOCK_PAYMENT_HOLD_ACTIVE');
  await expect(clearVerifiedLock(root,review.fingerprint,()=>false,probe,()=>true)).rejects.toThrow('LOCK_PID_RUNNING');
  await writeFile(path,JSON.stringify({pid:124,runID:'replacement'}));await expect(clearVerifiedLock(root,review.fingerprint,()=>false,probe,dead)).rejects.toThrow('LOCK_BROWSER_STATE_UNKNOWN');
  await writeFile(path,raw);await clearVerifiedLock(root,review.fingerprint,()=>false,probe,dead);await expect(readFile(path)).rejects.toThrow();
 }finally{if(!root.startsWith(resolve('.local')+sep))throw Error('UNSAFE_TEST_PATH');await rm(root,{recursive:true,force:true});}
});
it('keeps an active verified hold locked, then clears it only after expiry and a clean browser review',async()=>{
 await mkdir('.local',{recursive:true});const root=await mkdtemp(resolve('.local/expired-hold-review-'));
 try{
  await mkdir(resolve(root,'.local'));const path=resolve(root,'.local/automation.lock');
  const raw=JSON.stringify({pid:123,runID:'fixture',mode:'standard',stage:'HOLD_VERIFIED',holdExpiresAt:new Date(Date.now()+60000).toISOString()});
  await writeFile(path,raw);
  const probe=vi.fn(async()=>clean),dead=()=>false;
  const active=await reviewLock(root,false,probe,dead);
  expect(active.canClear).toBe(false);expect(active.reason).toBe('LOCK_PAYMENT_HOLD_ACTIVE');expect(probe).not.toHaveBeenCalled();
  await expect(clearVerifiedLock(root,active.fingerprint,()=>false,probe,dead)).rejects.toThrow('LOCK_PAYMENT_HOLD_ACTIVE');
  await writeFile(path,JSON.stringify({pid:123,runID:'fixture',mode:'standard',stage:'HOLD_VERIFIED',holdExpiresAt:new Date(Date.now()-1000).toISOString()}));
  const expired=await reviewLock(root,false,probe,dead);
  expect(expired).toMatchObject({canClear:true,reason:'VERIFIED_STALE_LOCK',page:'Schedule',selected:0,hold:'Not detected'});
  await clearVerifiedLock(root,expired.fingerprint,()=>false,probe,dead);
  await expect(readFile(path)).rejects.toThrow();
 }finally{if(!root.startsWith(resolve('.local')+sep))throw Error('UNSAFE_TEST_PATH');await rm(root,{recursive:true,force:true});}
});
it('reads the retained hold expiry as an absolute timestamp for the panel',async()=>{
 await mkdir('.local',{recursive:true});const root=await mkdtemp(resolve('.local/hold-clock-'));
 try{await mkdir(resolve(root,'.local'));await writeFile(resolve(root,'.local/automation.lock'),JSON.stringify({stage:'HOLD_VERIFIED',holdExpiresAt:'2026-09-20T19:16:19.000Z'}));
  expect(await readRetainedHold(root,Date.parse('2026-09-20T19:06:19.000Z'))).toMatchObject({remainingSeconds:600});
  expect(await readRetainedHold(root,Date.parse('2026-09-20T19:16:19.000Z'))).toMatchObject({remainingSeconds:0});
 }finally{if(!root.startsWith(resolve('.local')+sep))throw Error('UNSAFE_TEST_PATH');await rm(root,{recursive:true,force:true});}
});
function harness(locked=true,confirmed=true){
 const plan=bookingView(ConfigSchema.parse({...defaultSetup,PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
 const run=vi.fn((command:unknown,event:(e:any)=>void)=>{event({type:'handoff',date:'2026-09-11',court:7,hours:['10:00','11:00'],amount:1200,currency:'PHP',status:'Pending',countdown:'09:57',verifiedAt:new Date().toISOString()});return {pid:42,done:Promise.resolve(0),stop:async()=>{}};});
 const review={...safe,runID:'fixture',fingerprint:'abc',verifiedAt:new Date().toISOString(),reason:'VERIFIED_STALE_LOCK',canClear:true};
 const deps={runner:run,lock:async()=>locked,cdp:async()=>true,clock:()=>clockStatus(ObservationSchema.parse({}),DateTime.fromISO('2026-09-11T20:00:00+08:00')),booking:()=>plan,saveBooking:vi.fn(()=>plan),publish:()=>{},confirm:vi.fn(async()=>confirmed),confirmPractice:vi.fn(async()=>confirmed),reviewLock:vi.fn(async()=>review),clearLock:vi.fn(async()=>{locked=false;}),confirmClear:vi.fn(async()=>confirmed),resetPractice:vi.fn(async()=>{locked=false;}),confirmReset:vi.fn(async()=>confirmed)};
 return {c:new Controller(deps),deps};
}
it('locked configuration save is local only and review remains available',async()=>{const {c,deps}=harness();await c.saveBooking({...defaultSetup,DURATION_HOURS:3,MAX_PRICE:1800});expect(deps.saveBooking).toHaveBeenCalledOnce();expect(deps.runner).not.toHaveBeenCalled();expect(c.state.lock).toBe(true);await c.reviewLock();expect(deps.reviewLock).toHaveBeenCalled();});
it('requires clear confirmation, then refreshes state',async()=>{const {c,deps}=harness();await c.clearLock();expect(deps.confirmClear).toHaveBeenCalledOnce();expect(deps.clearLock).toHaveBeenCalledOnce();expect(c.state.lock).toBe(false);const no=harness(true,false);await no.c.clearLock();expect(no.deps.clearLock).not.toHaveBeenCalled();});
it('resets a practice session through the dedicated browser reset path',async()=>{const {c,deps}=harness(false);await c.resetPractice();expect(deps.confirmReset).toHaveBeenCalledOnce();expect(deps.resetPractice).toHaveBeenCalledOnce();expect(c.state).toMatchObject({headline:'Practice session reset',lock:false,cdp:true,ready:false});});
it('does not reset practice when the operator cancels',async()=>{const {c,deps}=harness(false);deps.confirmReset=vi.fn(async()=>false);await c.resetPractice();expect(deps.resetPractice).not.toHaveBeenCalled();expect(c.state.headline).toBe('Practice reset cancelled');});
it('lock blocks selection, full, slot practice, full practice, dry and observation',async()=>{const {c,deps}=harness();await c.armSelection();c.state.termsAuthorized=true;await c.armFullBooking();await c.runPractice({date:'2026-09-11',court:7,start:'10:00',duration:2});await c.runFullPractice(input);await c.dryRace();await c.armObservation();expect(deps.runner).not.toHaveBeenCalled();});
it('retained lock still permits the non-booking Chrome launcher for review',async()=>{const {c,deps}=harness();await c.startChrome();expect(deps.runner).toHaveBeenCalledWith('chrome',expect.anything(),expect.anything(),expect.anything());});
const input={target:{date:'2026-09-11',court:7,start:'10:00',duration:2},maximum:1200,authorizeTerms:true as const};
it('full practice starts today after release with exact target and explicit confirmation',async()=>{const {c,deps}=harness(false);await c.runFullPractice(input);expect(deps.confirmPractice).toHaveBeenCalledWith(input);expect(deps.runner.mock.calls[0]?.[0]).toEqual({kind:'fullPractice',input});expect(c.state.headline).toBe('FULL FLOW PRACTICE COMPLETE');expect(c.state.detail).toContain('DO NOT PAY');});
it('full practice rejects missing terms and cancellation before worker launch',async()=>{const {c,deps}=harness(false);await c.runFullPractice({...input,authorizeTerms:false});expect(deps.runner).not.toHaveBeenCalled();const no=harness(false,false);await no.c.runFullPractice(input);expect(no.deps.runner).not.toHaveBeenCalled();});
it('practice command carries maximum and no plan/fallback/scheduler flags',()=>{const spec=commandSpec({kind:'fullPractice',input},process.cwd(),process.execPath);expect(spec.args).toContain('practice:full');expect(spec.args.slice(-2)).toEqual(['--maximum','1200']);expect(spec.args).not.toContain('--plan-hash');expect(()=>FullPracticeSchema.parse({...input,target:{...input.target,fallback:[1]}})).toThrow();});
