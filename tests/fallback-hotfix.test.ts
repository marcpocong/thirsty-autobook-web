import {expect,it} from 'vitest';
import {DateTime} from 'luxon';
import {BookingSetupSchema,ConfigSchema,ObservationSchema,type BookingSetup} from '../src/config.js';
import {bookingSetupProblem,reconcileFallbackTimes} from '../src/booking-setup.js';
import {bookingView,defaultSetup} from '../ui/booking.js';
import {Controller} from '../ui/controller.js';
import {clockStatus} from '../ui/status.js';
import {expectedPreparationFingerprint} from '../src/prepared-context.js';
import type {Command} from '../ui/types.js';
import type {Runner} from '../ui/processes.js';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

const player={PLAYER_FULL_NAME:'Fixture Primary',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'primary@example.invalid',PLAYER_B_FULL_NAME:'Fixture Extended',PLAYER_B_PHONE:'09987654321',PLAYER_B_EMAIL:'extended@example.invalid'};
const view=(setup:BookingSetup)=>bookingView(ConfigSchema.parse({...setup,...player}));

it('keeps the valid 18:00–24:00 primary booking and removes only stale fallback alternatives',()=>{
  const setup={...defaultSetup,BOOKING_TYPE:'extended' as const,START_TIME:'18:00',DURATION_HOURS:6,FALLBACK_TIMES:[]};
  expect(BookingSetupSchema.safeParse(setup).success).toBe(true);
  expect(bookingSetupProblem(setup)).toBeUndefined();
  expect(reconcileFallbackTimes('18:00',6,['20:00'])).toEqual({valid:[],removed:[{time:'20:00',reason:'CROSSES_MIDNIGHT'}]});
});

it('removes duplicate-primary, duplicate-fallback and cross-midnight starts while preserving order',()=>{
  expect(reconcileFallbackTimes('18:00',6,['17:00','18:00','19:00','20:00','17:00'])).toEqual({
    valid:['17:00'],
    removed:[
      {time:'18:00',reason:'DUPLICATES_PRIMARY_START'},
      {time:'19:00',reason:'CROSSES_MIDNIGHT'},
      {time:'20:00',reason:'CROSSES_MIDNIGHT'},
      {time:'17:00',reason:'DUPLICATE_FALLBACK'},
    ],
  });
});

it('reconciles duration and primary-start changes without changing the primary booking',()=>{
  expect(reconcileFallbackTimes('18:00',3,['19:00','20:00']).valid).toEqual(['19:00','20:00']);
  expect(reconcileFallbackTimes('18:00',6,['19:00','20:00']).valid).toEqual([]);
  expect(reconcileFallbackTimes('17:00',6,['18:00']).valid).toEqual(['18:00']);
  expect(reconcileFallbackTimes('18:00',6,['18:00']).valid).toEqual([]);
  expect(reconcileFallbackTimes('18:00',6,['not-a-time']).removed).toEqual([{time:'not-a-time',reason:'INVALID_FORMAT'}]);
});

function controllerHarness(){
  let current=view({...defaultSetup,BOOKING_TYPE:'extended',START_TIME:'18:00',DURATION_HOURS:6});
  const calls:Command[]=[],saved:BookingSetup[]=[];
  const runner:Runner=(command,event)=>{
    calls.push(command);
    if(typeof command==='object'&&command.kind==='resetPrepare')event({type:'preparationResult',result:{workflow:'release',strategy:'extended',fingerprint:expectedPreparationFingerprint(command.input,current.fingerprint),browsers:['A','B'].map(id=>({id:id as 'A'|'B',dedicatedProfileVerified:true as const,ondaVerified:true as const,preparedDate:'2026-09-15',gridVerified:true as const,selectedCount:0 as const,hold:'Not detected' as const})),solutionAvailable:true,releaseTargetDate:current.targetDate,releaseMs:current.releaseMs}});
    return {pid:42,done:Promise.resolve(0),stop:async()=>{}};
  };
  const controller=new Controller({runner,lock:async()=>false,cdp:async()=>true,browserHealth:async()=>({A:true,B:true}),playerStatus:()=>({primary:true,extended:true}),clock:()=>clockStatus(ObservationSchema.parse({}),DateTime.fromISO('2026-09-15T07:00:00+08:00')),booking:()=>current,saveBooking:input=>{saved.push(input as BookingSetup);current=view(input as BookingSetup);return current;},confirm:async()=>true,publish:()=>{}});
  return {controller,calls,saved,current:()=>current};
}

it('defensively repairs Release setup at Reset & Prepare and completes on the first press',async()=>{
  const h=controllerHarness();h.controller.state.termsAuthorized=true;
  await h.controller.resetPrepare({workflow:'release',strategy:'extended',setup:{...defaultSetup,BOOKING_TYPE:'extended',START_TIME:'18:00',DURATION_HOURS:6,FALLBACK_TIMES:['20:00']}});
  expect(h.saved).toHaveLength(1);expect(h.saved[0]).toMatchObject({START_TIME:'18:00',DURATION_HOURS:6,FALLBACK_TIMES:[]});
  expect(h.calls).toHaveLength(1);expect(h.current().setup.FALLBACK_TIMES).toEqual([]);
  expect(h.controller.state).toMatchObject({ready:true,headline:'READY TO ARM',termsAuthorized:false});
  expect(h.controller.state.preparedContext?.fallbackStarts).toEqual([]);
  expect(h.controller.state.preparedContext?.configFingerprint).toBe(h.current().fingerprint);
});

it('blocks an invalid primary block with a friendly status and never renders raw Zod details',async()=>{
  const h=controllerHarness();
  await h.controller.resetPrepare({workflow:'release',strategy:'extended',setup:{...defaultSetup,BOOKING_TYPE:'extended',START_TIME:'20:00',DURATION_HOURS:6}});
  expect(h.calls).toEqual([]);expect(h.saved).toEqual([]);
  expect(h.controller.state.headline).toBe('BOOKING SETTINGS NEED ATTENTION');
  expect(h.controller.state.detail).toContain('The main booking would end after midnight.');
  expect(`${h.controller.state.headline}\n${h.controller.state.detail}`).not.toMatch(/"code"|custom|"path"|\[\{|Zod/i);
});

it('loads a stale saved Release draft reconciled without silently overwriting the file',async()=>{
  const root=await mkdtemp(join(tmpdir(),'thirsty-fallback-load-'));
  const saved={...defaultSetup,BOOKING_TYPE:'extended',START_TIME:'18:00',DURATION_HOURS:6,FALLBACK_TIMES:['20:00']};
  try{
    const path=join(root,'config.local.json');await writeFile(path,JSON.stringify(saved,null,2)+'\n');
    await writeFile(join(root,'.env.local'),'PLAYER_FULL_NAME=Fixture Player\nPLAYER_PHONE=09123456789\nPLAYER_EMAIL=fixture@example.invalid\n');
    const booking=pathToFileURL(join(process.cwd(),'ui/booking.ts')).href;
    const output=execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',`import {readBooking} from ${JSON.stringify(booking)};process.chdir(${JSON.stringify(root)});const view=readBooking();console.log(JSON.stringify({fallbacks:view.setup.FALLBACK_TIMES,removed:view.fallbackReconciliation.removed}));`],{encoding:'utf8',windowsHide:true});
    expect(JSON.parse(output)).toEqual({fallbacks:[],removed:[{time:'20:00',reason:'CROSSES_MIDNIGHT'}]});
    expect(JSON.parse(await readFile(path,'utf8'))).toEqual(saved);
  }finally{await rm(root,{recursive:true,force:true});}
});
