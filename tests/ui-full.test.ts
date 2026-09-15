import {it,expect,vi,afterEach} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {DateTime} from 'luxon';
import {Controller} from '../ui/controller.js';
import {clockStatus,readLock,readHandoff} from '../ui/status.js';
import {bookingView,defaultSetup} from '../ui/booking.js';
import {ConfigSchema,ObservationSchema} from '../src/config.js';
import {commandSpec,type Runner} from '../ui/processes.js';
import type {Command} from '../ui/types.js';
import {expectedPreparationFingerprint} from '../src/prepared-context.js';
const hold={type:'handoff' as const,date:'2026-09-11',court:7,hours:['12:00'],amount:600,currency:'PHP' as const,status:'Pending' as const,countdown:'09:57',verifiedAt:'2026-09-10T13:00:00.000Z'};
function harness(success=true,confirmed=true){
  const calls:Command[]=[];let locked=false;
  const base=bookingView(ConfigSchema.parse({...defaultSetup,PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
  const plan={...base,releaseMs:Date.now()+120000};
  const runner:Runner=(command,event)=>{calls.push(command);if(typeof command==='object'&&command.kind==='resetPrepare'){event({type:'preparationResult',result:{workflow:'release',strategy:'standard',fingerprint:expectedPreparationFingerprint(command.input,plan.fingerprint),browsers:[{id:'A',dedicatedProfileVerified:true,ondaVerified:true,preparedDate:'2026-09-10',gridVerified:true,selectedCount:0,hold:'Not detected'}],solutionAvailable:true,releaseTargetDate:plan.targetDate,releaseMs:plan.releaseMs}});}else if(success){locked=true;event(hold);}return {pid:42,done:Promise.resolve(0),stop:async()=>{}};};
  const confirm=vi.fn(async()=>confirmed);
  const controller=new Controller({runner,confirm,lock:async()=>locked,cdp:async()=>true,clock:()=>({...clockStatus(ObservationSchema.parse({}),DateTime.fromMillis(Date.now())),releaseMs:plan.releaseMs,targetDate:plan.targetDate,wakeSecondsBefore:90}),booking:()=>plan,saveBooking:()=>plan,publish:()=>{}});
  return {controller,calls,confirm};
}
afterEach(()=>vi.useRealTimers());
async function prepareRelease(h:ReturnType<typeof harness>){await h.controller.setWorkflow('release');await h.controller.resetPrepare({workflow:'release',strategy:'standard'});}
it('requires matching preparation before full confirmation or worker launch',async()=>{
  const h=harness();await h.controller.armFullBooking();expect(h.calls).toEqual([]);expect(h.confirm).not.toHaveBeenCalled();expect(h.controller.state.detail).toContain('RESET REQUIRED');
});
it('launches the confirmed full plan and shows verified handoff with retained lock and consumed terms',async()=>{
  vi.useFakeTimers();const h=harness();await prepareRelease(h);await h.controller.authorizeTerms(true);await h.controller.armFullBooking();
  expect(h.confirm).toHaveBeenCalledWith('full',expect.objectContaining({playerConfigured:true}));
  expect(h.controller.state.scheduledRelease).toMatchObject({releaseMs:h.controller.state.booking!.releaseMs,targetDate:h.controller.state.booking!.targetDate,configFingerprint:h.controller.state.booking!.fingerprint});
  expect(h.calls).toEqual([{kind:'resetPrepare',input:{workflow:'release',strategy:'standard'}}]);
  await vi.advanceTimersByTimeAsync(30001);
  expect(h.calls).toEqual([{kind:'resetPrepare',input:{workflow:'release',strategy:'standard'}},'chrome',{kind:'resetPrepare',input:{workflow:'release',strategy:'standard'}},expect.objectContaining({kind:'full',authorizeTerms:true,context:expect.objectContaining({releaseMs:h.controller.state.booking!.releaseMs})})]);
  expect(h.controller.state).toMatchObject({headline:'PAYMENT HOLD ACTIVE',termsAuthorized:false,lock:true,handoff:hold,operation:'idle'});
});
it('consumes authorization even when full confirmation is cancelled',async()=>{
  const h=harness(true,false);await prepareRelease(h);await h.controller.authorizeTerms(true);await h.controller.armFullBooking();expect(h.calls).toHaveLength(1);expect(h.controller.state.termsAuthorized).toBe(false);
});
it('mode change resets authorization and selection mode cannot authorize terms',async()=>{
  const h=harness();await prepareRelease(h);await h.controller.authorizeTerms(true);await h.controller.setMode('selection');expect(h.controller.state.termsAuthorized).toBe(false);await expect(h.controller.authorizeTerms(true)).resolves.toBeUndefined();
});
it('cancels a future run without starting its worker and clears authorization',async()=>{
  const h=harness(false);await prepareRelease(h);await h.controller.authorizeTerms(true);await h.controller.armFullBooking();expect(h.calls).toHaveLength(1);await h.controller.cancelScheduledRelease();expect(h.controller.state.scheduledRelease).toBeNull();expect(h.controller.state.termsAuthorized).toBe(false);expect(h.calls).toHaveLength(1);
});
it('maps only a closed authorized full command to the production CLI',()=>{
  expect(()=>commandSpec({kind:'full',authorizeTerms:true,planHash:'a'.repeat(64)} as never,process.cwd(),process.execPath)).toThrow();
  expect(()=>commandSpec({kind:'full',authorizeTerms:false,planHash:'a'.repeat(64)} as never,process.cwd(),process.execPath)).toThrow();
});
it('restores recorded handoff without clearing or mutating its filesystem lock',async()=>{
  await mkdir('.local',{recursive:true});const root=await mkdtemp(resolve('.local/handoff-lock-test-'));
  try{
    await mkdir(resolve(root,'.local'));const path=resolve(root,'.local/automation.lock');const original=JSON.stringify({pid:42,runID:'fixture',handoff:hold});await writeFile(path,original);
    expect(await readHandoff(root)).toEqual(hold);expect(await readLock(root)).toBe(true);expect(await readFile(path,'utf8')).toBe(original);
  }finally{if(!root.startsWith(resolve('.local')+sep))throw Error('UNSAFE_TEST_PATH');await rm(root,{recursive:true,force:true});}
});
