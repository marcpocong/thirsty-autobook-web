import {it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {DateTime} from 'luxon';
import {Controller} from '../ui/controller.js';
import {clockStatus,readLock,readHandoff} from '../ui/status.js';
import {bookingView,defaultSetup} from '../ui/booking.js';
import {ConfigSchema,ObservationSchema} from '../src/config.js';
import {commandSpec,type Runner} from '../ui/processes.js';
import type {Command} from '../ui/types.js';
const hold={type:'handoff' as const,date:'2026-09-11',court:7,hours:['12:00'],amount:600,currency:'PHP' as const,status:'Pending' as const,countdown:'09:57',verifiedAt:'2026-09-10T13:00:00.000Z'};
function harness(success=true,confirmed=true){
  const calls:Command[]=[];let locked=false;
  const plan=bookingView(ConfigSchema.parse({...defaultSetup,PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
  const runner:Runner=(command,event)=>{calls.push(command);if(success){locked=true;event(hold);}return {pid:42,done:Promise.resolve(0),stop:async()=>{}};};
  const confirm=vi.fn(async()=>confirmed);
  const controller=new Controller({runner,confirm,lock:async()=>locked,cdp:async()=>true,clock:()=>clockStatus(ObservationSchema.parse({}),DateTime.fromISO('2026-09-10T07:00:00+08:00')),booking:()=>plan,saveBooking:()=>plan,publish:()=>{}});
  return {controller,calls,confirm};
}
it('requires fresh terms before full confirmation or worker launch',async()=>{
  const h=harness();await h.controller.armFullBooking();expect(h.calls).toEqual([]);expect(h.confirm).not.toHaveBeenCalled();expect(h.controller.state.detail).toBe('Authorize accepting Onda Terms for this run first.');
});
it('launches the confirmed full plan and shows verified handoff with retained lock and consumed terms',async()=>{
  const h=harness();await h.controller.authorizeTerms(true);await h.controller.armFullBooking();
  expect(h.confirm).toHaveBeenCalledWith('full',expect.objectContaining({playerConfigured:true}));
  expect(h.calls).toEqual([{kind:'full',authorizeTerms:true,planHash:expect.stringMatching(/^[a-f0-9]{64}$/)}]);
  expect(h.controller.state).toMatchObject({headline:'PAYMENT HOLD ACTIVE',termsAuthorized:false,lock:true,handoff:hold,operation:'idle'});
  await h.controller.armFullBooking();expect(h.calls).toHaveLength(1);
});
it('consumes authorization even when full confirmation is cancelled',async()=>{
  const h=harness(true,false);await h.controller.authorizeTerms(true);await h.controller.armFullBooking();expect(h.calls).toEqual([]);expect(h.controller.state.termsAuthorized).toBe(false);
});
it('mode change resets authorization and selection mode cannot authorize terms',async()=>{
  const h=harness();await h.controller.authorizeTerms(true);await h.controller.setMode('selection');expect(h.controller.state.termsAuthorized).toBe(false);await expect(h.controller.authorizeTerms(true)).rejects.toThrow('TERMS_AUTHORIZATION_NOT_ALLOWED');
});
it('missing passive success produces an explicit unknown handoff without a retry',async()=>{
  const h=harness(false);await h.controller.authorizeTerms(true);await h.controller.armFullBooking();expect(h.calls).toHaveLength(1);expect(h.controller.state.headline).toBe('HANDOFF STATUS UNKNOWN');expect(h.controller.state.detail).toContain('DO NOT START ANOTHER BOOKING');
});
it('maps only a closed authorized full command to the production CLI',()=>{
  expect(commandSpec({kind:'full',authorizeTerms:true,planHash:'a'.repeat(64)},process.cwd(),process.execPath).args.slice(-5)).toEqual(['race','--armed','--authorize-terms','--plan-hash','a'.repeat(64)]);
  expect(()=>commandSpec({kind:'full',authorizeTerms:false,planHash:'a'.repeat(64)} as never,process.cwd(),process.execPath)).toThrow();
});
it('restores recorded handoff without clearing or mutating its filesystem lock',async()=>{
  await mkdir('.local',{recursive:true});const root=await mkdtemp(resolve('.local/handoff-lock-test-'));
  try{
    await mkdir(resolve(root,'.local'));const path=resolve(root,'.local/automation.lock');const original=JSON.stringify({pid:42,runID:'fixture',handoff:hold});await writeFile(path,original);
    expect(await readHandoff(root)).toEqual(hold);expect(await readLock(root)).toBe(true);expect(await readFile(path,'utf8')).toBe(original);
  }finally{if(!root.startsWith(resolve('.local')+sep))throw Error('UNSAFE_TEST_PATH');await rm(root,{recursive:true,force:true});}
});
