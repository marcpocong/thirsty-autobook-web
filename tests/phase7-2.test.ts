import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {chromium,type Browser} from 'playwright';
import {DateTime} from 'luxon';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {ConfigSchema,ObservationSchema,type BookingSetup} from '../src/config.js';
import {defaultSetup,bookingView} from '../ui/booking.js';
import {Controller} from '../ui/controller.js';
import {clockStatus} from '../ui/status.js';
import type {Command} from '../ui/types.js';
import type {Runner} from '../ui/processes.js';
import {commandSpec} from '../ui/processes.js';
import {expectedPreparationFingerprint} from '../src/prepared-context.js';
import {inspectLockPage} from '../src/lock-browser.js';
import {assertResetSafe,resetAndPrepare,type PreparedBrowser} from '../src/booking-prepare.js';
import {Safety} from '../src/safety.js';
import {lifecycleWriter} from '../src/checkout-lifecycle.js';

const player={PLAYER_FULL_NAME:'Synthetic Primary',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'primary@example.invalid',PLAYER_B_FULL_NAME:'Synthetic Extended',PLAYER_B_PHONE:'09987654321',PLAYER_B_EMAIL:'extended@example.invalid'};
const makeView=(setup:BookingSetup=defaultSetup)=>bookingView(ConfigSchema.parse({...setup,...player}));
const testInput=(strategy:'standard'|'extended'='extended',courtCount:1|2=2)=>({workflow:'test' as const,request:{strategy,date:'2026-09-15',start:strategy==='extended'?'20:00':'18:00',duration:strategy==='extended'?4:3,courtCount,priority:[7,6,5,4,3,2,1],fallbackStarts:[]},maximum:1800});
function controllerHarness(options:{health?:{A:boolean;B:boolean};view?:ReturnType<typeof makeView>}={}){
  let view=options.view??makeView(),health=options.health??{A:true,B:true},locked=false;
  const calls:Command[]=[],saved:unknown[]=[];
  const runner:Runner=(command,event)=>{
    calls.push(command);
    if(typeof command==='object'&&command.kind==='resetPrepare'){
      const input=command.input,strategy=input.workflow==='test'?input.request.strategy:view.setup.BOOKING_TYPE;
      event({type:'preparationResult',result:{workflow:input.workflow,strategy,fingerprint:expectedPreparationFingerprint(input,input.workflow==='release'?view.fingerprint:undefined),browsers:(strategy==='extended'?['A','B'] as const:['A'] as const).map(id=>({id,dedicatedProfileVerified:true,ondaVerified:true,preparedDate:input.workflow==='test'?input.request.date:'2026-09-10',gridVerified:true,selectedCount:0,hold:'Not detected' as const})),solutionAvailable:true,...(input.workflow==='release'?{releaseTargetDate:view.targetDate,releaseMs:view.releaseMs}:{})}});
    }
    return {pid:42,done:Promise.resolve(0),stop:async()=>{}};
  };
  const c=new Controller({runner,lock:async()=>locked,cdp:async()=>health.A,browserHealth:async()=>health,playerStatus:()=>({primary:true,extended:true}),clock:()=>clockStatus(ObservationSchema.parse({}),DateTime.fromISO('2026-09-10T07:00:00+08:00')),booking:()=>view,saveBooking:input=>{saved.push(input);view=makeView(input as BookingSetup);return view;},confirm:async()=>true,publish:()=>{}});
  return {c,calls,saved,setHealth:(h:{A:boolean;B:boolean})=>{health=h;},view:()=>view,setLock:(v:boolean)=>{locked=v;}};
}

it.each([['standard',1,['A']],['standard',2,['A']],['extended',1,['A','B']],['extended',2,['A','B']]] as const)('preparation routing is strategy-based: %s/%i -> %j',async(strategy,count,ids)=>{
  const h=controllerHarness();await h.c.resetPrepare(testInput(strategy,count));
  expect(h.c.state.preparedContext?.requiredBrowsers).toEqual(ids);expect(h.c.state.ready).toBe(true);
  expect(h.calls[0]).toMatchObject({kind:'resetPrepare',input:{workflow:'test',request:{strategy,courtCount:count}}});
});
it('Extended readiness fails when Browser B is disconnected',async()=>{
  const h=controllerHarness({health:{A:true,B:false}});await h.c.resetPrepare(testInput());
  expect(h.c.state.ready).toBe(false);expect(h.c.state.preparedContext).toBeNull();expect(h.c.state.detail).toContain('RESET REQUIRED');
});
it('Test and Release primary actions are controller-blocked without matching preparation',async()=>{
  const h=controllerHarness(),test=testInput();await h.c.testBooking({request:test.request,maximum:test.maximum,authorizeTerms:true});expect(h.calls).toEqual([]);expect(h.c.state.detail).toContain('RESET REQUIRED');
  await h.c.setWorkflow('release');await h.c.armFullBooking();expect(h.calls).toEqual([]);expect(h.c.state.detail).toContain('RESET REQUIRED');
});
it('prepared readiness does not expire after 61 seconds without a state change',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-10T00:00:00Z'));try{const h=controllerHarness();await h.c.resetPrepare(testInput('standard',1));vi.advanceTimersByTime(61000);await h.c.refresh();expect(h.c.state.ready).toBe(true);expect(h.c.state.preparedContext).not.toBeNull();}finally{vi.useRealTimers();}
});
it('Release Reset & Prepare validates, saves, re-reads and prepares the current draft',async()=>{
  const h=controllerHarness(),setup:BookingSetup={...defaultSetup,BOOKING_TYPE:'extended',COURT_COUNT:2,START_TIME:'20:00',DURATION_HOURS:4,MAX_PRICE:1800,FALLBACK_TIMES:['19:00'],MAX_SELECTION_ATTEMPTS:2};
  await h.c.setWorkflow('release');await h.c.resetPrepare({workflow:'release',strategy:'extended',setup});
  expect(h.saved).toEqual([setup]);expect(h.view().setup).toEqual(setup);expect(h.c.state).toMatchObject({ready:true,headline:'READY TO ARM'});expect(h.c.state.preparedContext?.configFingerprint).toBe(h.view().fingerprint);
});
it('legacy selection mode does not change the meaning of the normal Release action',async()=>{
  const h=controllerHarness();await h.c.setWorkflow('release');await h.c.resetPrepare({workflow:'release',strategy:'standard'});await h.c.setMode('selection');await h.c.authorizeTerms(true);await h.c.armFullBooking();
  expect(h.calls.at(-1)).toMatchObject({kind:'full',authorizeTerms:true});
});
it('editing invalidates PreparedContext and Terms immediately',async()=>{
  const h=controllerHarness();await h.c.resetPrepare(testInput('standard',1));await h.c.authorizeTerms(true);await h.c.invalidatePreparation();expect(h.c.state).toMatchObject({ready:false,termsAuthorized:false,preparedContext:null,headline:'SETTINGS CHANGED'});
});

let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});});
afterAll(async()=>{await browser.close();});
it.each([['05:00','Active',300],['00:00','Expired',0]] as const)('classifies the associated hold countdown %s as %s',async(countdown,hold,seconds)=>{
  const page=await browser.newPage();await page.setContent(`<h1>Checkout</h1><div><p>Slot reserved for</p><p>${countdown}</p></div>`);expect(await inspectLockPage(page)).toMatchObject({page:'QR Checkout',hold,countdownSeconds:seconds});await page.close();
});
it('fails closed when hold countdown association is missing or ambiguous',async()=>{
  const page=await browser.newPage();await page.setContent('<h1>Checkout</h1><div><p>Slot reserved for</p></div><span>05:00</span>');expect((await inspectLockPage(page)).hold).toBe('Unknown');await page.setContent('<h1>Checkout</h1><div><p>Slot reserved for</p><p>05:00</p><p>04:59</p></div>');expect((await inspectLockPage(page)).hold).toBe('Unknown');await page.close();
});
it('protects recorded holds before expiry and legacy final dispatch on clean Schedule',()=>{
  const clean={page:'Schedule' as const,selected:0,hold:'Not detected' as const,clean:true};
  expect(()=>assertResetSafe({stage:'HOLD_VERIFIED',holdExpiresAt:new Date(Date.now()+60000).toISOString()},clean)).toThrow('PAYMENT_HOLD_MAY_BE_ACTIVE');
  expect(()=>assertResetSafe({stage:'HOLD_VERIFIED',holdExpiresAt:new Date(Date.now()-1).toISOString()},clean)).not.toThrow();
  expect(()=>assertResetSafe({stage:'FINAL_ACTION_DISPATCHING'},clean)).toThrow('PAYMENT_HOLD_MAY_BE_ACTIVE');
  expect(()=>assertResetSafe({stage:'FINAL_ACTION_DISPATCHING'},{page:'QR Checkout',selected:null,hold:'Expired',countdownSeconds:0,clean:false})).not.toThrow();
});
it('persists stageAt and sanitized hold expiry evidence atomically',async()=>{
  const root=await mkdtemp(join(tmpdir(),'thirsty-lifecycle-')),path=join(root,'lock');try{await writeFile(path,JSON.stringify({pid:123,runID:'fixture'}));const write=lifecycleWriter(path,{pid:123,runID:'fixture'});await write('HOLD_VERIFIED',{holdVerifiedAt:'2026-09-15T00:00:00.000Z',holdExpiresAt:'2026-09-15T00:10:00.000Z'});const record=JSON.parse(await readFile(path,'utf8'));expect(record).toMatchObject({stage:'HOLD_VERIFIED',holdVerifiedAt:'2026-09-15T00:00:00.000Z',holdExpiresAt:'2026-09-15T00:10:00.000Z'});expect(Date.parse(record.stageAt)).not.toBeNaN();expect(JSON.stringify(record)).not.toMatch(/qr|email|phone/i);}finally{await rm(root,{recursive:true,force:true});}
});
it('cleans its temporary preparing and guard locks after a failed preparation',async()=>{
  const root=await mkdtemp(join(tmpdir(),'thirsty-prepare-fail-'));try{await mkdir(join(root,'.local/dual'),{recursive:true});const inspect=async():Promise<PreparedBrowser>=>({observed:{page:'Unknown',selected:null,hold:'Unknown',clean:false},normalize:async()=>{}});await expect(resetAndPrepare('standard',new Safety(),{root,alive:()=>false,inspect})).rejects.toThrow('PAYMENT_HOLD_MAY_BE_ACTIVE');await expect(readFile(join(root,'.local/automation.lock'))).rejects.toThrow();await expect(readFile(join(root,'.local/preparation.lock'))).rejects.toThrow();}finally{await rm(root,{recursive:true,force:true});}
});
it('the renderer/controller command serializes Extended through the booking-entry boundary',()=>{
  const input=testInput('extended',2),command={kind:'resetPrepare' as const,input};const spec=commandSpec(command,process.cwd(),process.execPath);expect(spec.args.some(a=>a.replaceAll('\\','/').endsWith('/src/booking-entry.ts'))).toBe(true);expect(spec.args.at(-2)).toBe('prepare');expect(JSON.parse(spec.args.at(-1)!)).toMatchObject({workflow:'test',request:{strategy:'extended',courtCount:2}});
});
it('hold inspection works through the production node --import tsx boundary',async()=>{
  const moduleUrl=pathToFileURL(join(process.cwd(),'src/lock-browser.ts')).href;
  const launch=process.platform==='win32'?{headless:true,channel:'chrome'}:{headless:true};
  const source=`import {chromium} from 'playwright';import {inspectLockPage} from ${JSON.stringify(moduleUrl)};const browser=await chromium.launch(${JSON.stringify(launch)});const page=await browser.newPage();await page.setContent('<h1>Checkout</h1><div><p>Slot reserved for</p><p>05:00</p></div>');console.log(JSON.stringify(await inspectLockPage(page)));await browser.close();`;
  const {stdout}=await promisify(execFile)(process.execPath,['--import','tsx','--input-type=module','--eval',source],{cwd:process.cwd(),timeout:30000,windowsHide:true});
  expect(JSON.parse(stdout)).toMatchObject({page:'QR Checkout',hold:'Active',countdownSeconds:300});
});
