import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { Controller } from '../ui/controller.js';
import { bookingView, defaultSetup } from '../ui/booking.js';
import { ConfigSchema, ObservationSchema } from '../src/config.js';
import { clockStatus } from '../ui/status.js';
import type { Runner } from '../ui/processes.js';
import type { Command } from '../ui/types.js';
import { preregistered } from './arbitration-manifest-stub.js';

describe('API-first UI boundary', () => {
  it('starts extended API run timing only after both dedicated browsers are ready',async()=>{
    const view=bookingView(ConfigSchema.parse({...defaultSetup,BOOKING_METHOD:'api-first',BOOKING_TYPE:'extended',DURATION_HOURS:4,
      PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid',
      PLAYER_B_FULL_NAME:'Second Fixture',PLAYER_B_PHONE:'09987654321',PLAYER_B_EMAIL:'second@example.invalid'}));
    let readyAfterA:string|undefined,readyAfterB:string|undefined;
    let controller:Controller;
    const runner:Runner=(command,event)=>{
      if(typeof command==='object'&&command.kind==='apiRun'&&command.mode==='live-now'){
        event({type:'apiStage',stage:'RUN_STARTED',elapsedMs:0});
        event({type:'apiStage',stage:'BROWSER_READY',workerId:'A',elapsedMs:1,at:new Date().toISOString()});
        readyAfterA=controller.state.runTiming?.readyAt;
        event({type:'apiStage',stage:'BROWSER_READY',workerId:'B',elapsedMs:2,at:new Date().toISOString()});
        readyAfterB=controller.state.runTiming?.readyAt;
      }
      return {pid:1,done:Promise.resolve(0),stop:async()=>undefined};
    };
    controller=new Controller({runner,lock:async()=>false,cdp:async()=>true,browserHealth:async()=>({A:true,B:true}),
      playerStatus:()=>({primary:true,extended:true}),confirmApiTest:async()=>true,
      clock:()=>clockStatus(ObservationSchema.parse({}),DateTime.fromISO('2026-09-21T08:00:00+08:00')),
      confirm:async()=>true,publish:()=>undefined,booking:()=>view,saveBooking:()=>view});
    const request={strategy:'extended' as const,date:'2026-09-22',start:'12:00',duration:4,courtCount:2 as const,priority:[7,6,5,4,3,2,1],fallbackStarts:[]};
    await controller.setWorkflow('test');
    await controller.resetPrepare({workflow:'test',method:'api-first',request});
    await controller.authorizeTerms(true);
    await controller.testBooking({method:'api-first',request,authorizeTerms:true});
    expect(readyAfterA).toBeUndefined();expect(readyAfterB).toBeDefined();
  });
  it('describes an elapsed verified hold as spent instead of recorded until a past time',async()=>{
    const view=bookingView(ConfigSchema.parse({...defaultSetup,PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
    const runner:Runner=()=>({pid:1,done:Promise.resolve(0),stop:async()=>undefined});
    const hold=(remainingSeconds:number)=>new Controller({runner,lock:async()=>true,
      retainedHold:async()=>({stage:'HOLD_VERIFIED',expiresAt:new Date(Date.now()+remainingSeconds*1000).toISOString(),remainingSeconds}),
      cdp:async()=>true,browserHealth:async()=>({A:true,B:true}),playerStatus:()=>({primary:true,extended:true}),
      clock:()=>clockStatus(ObservationSchema.parse({}),DateTime.fromISO('2026-09-21T08:00:00+08:00')),
      confirm:async()=>true,publish:()=>undefined,booking:()=>view,saveBooking:()=>view});

    const elapsed=hold(0);await elapsed.refresh();
    expect(elapsed.state.headline).toBe('HOLD TIMER ELAPSED');
    expect(elapsed.state.detail).toContain('elapsed');
    // The run is not blocked, so the detail must not read like a live deadline.
    expect(elapsed.state.detail).not.toContain('remains recorded until');
    expect(elapsed.state.canPrepareOverHold).toBe(true);

    const active=hold(120);await active.refresh();
    expect(active.state.headline).toBe('PAYMENT HOLD ACTIVE');
    expect(active.state.detail).toContain('remains recorded until');
  });
  it('prepares another API test beside a verified active hold through the normal reset path',async()=>{
    const view=bookingView(ConfigSchema.parse({...defaultSetup,PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
    const calls:Command[]=[];let locked=true;
    const expiresAt=new Date(Date.now()+120000).toISOString();
    const runner:Runner=command=>{calls.push(command);if(typeof command==='object'&&command.kind==='resetPrepare')locked=false;return {pid:1,done:Promise.resolve(0),stop:async()=>undefined};};
    const controller=new Controller({runner,lock:async()=>locked,retainedHold:async()=>({stage:'HOLD_VERIFIED',expiresAt,remainingSeconds:120}),
      reviewLock:async()=>({runID:'fixture',pid:1,alive:false,owned:false,fingerprint:'fixture',verifiedAt:new Date().toISOString(),reason:'VERIFIED_STALE_LOCK',canClear:true,page:'Schedule',selected:0,hold:'Not detected',clean:true}),
      clearLock:async()=>{throw Error('VERIFIED_HOLD_MUST_BE_ARCHIVED');},
      cdp:async()=>true,browserHealth:async()=>({A:true,B:false}),playerStatus:()=>({primary:true,extended:false}),
      clock:()=>clockStatus(ObservationSchema.parse({}),DateTime.fromISO('2026-09-21T08:00:00+08:00')),
      confirm:async()=>true,publish:()=>undefined,booking:()=>view,saveBooking:()=>view});
    const input={workflow:'test' as const,method:'api-first' as const,request:{strategy:'standard' as const,date:'2026-09-22',start:'12:00',duration:1,courtCount:1 as const,priority:[7,6,5,4,3,2,1],fallbackStarts:[]},maximum:1200};
    await controller.resetPrepare(input);
    expect(calls.map(command=>typeof command==='string'?command:command.kind)).toEqual(['resetPrepare','apiRun']);
    expect(controller.state).toMatchObject({headline:'API READY TO TEST',ready:true,lock:false});
  });
  it('routes an Extended retained lock through the existing two-browser reset checks before API preparation',async()=>{
    const view=bookingView(ConfigSchema.parse({...defaultSetup,PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
    const calls:Command[]=[];let locked=true;
    const runner:Runner=command=>{calls.push(command);if(typeof command==='object'&&command.kind==='resetPrepare')locked=false;return {pid:1,done:Promise.resolve(0),stop:async()=>undefined};};
    const controller=new Controller({runner,lock:async()=>locked,retainedHold:async()=>null,
      reviewLock:async()=>({runID:'fixture',pid:1,alive:false,owned:false,fingerprint:'fixture',verifiedAt:new Date().toISOString(),reason:'USE_RESET_AND_PREPARE',canClear:false,page:'Unknown',selected:null,hold:'Unknown',clean:false}),
      clearLock:async()=>{throw Error('UNEXPECTED_DIRECT_CLEAR');},
      cdp:async()=>true,browserHealth:async()=>({A:true,B:true}),playerStatus:()=>({primary:true,extended:true}),
      clock:()=>clockStatus(ObservationSchema.parse({}),DateTime.fromISO('2026-09-21T08:00:00+08:00')),
      confirm:async()=>true,publish:()=>undefined,booking:()=>view,saveBooking:()=>view});
    await controller.resetPrepare({workflow:'test',method:'api-first',request:{strategy:'extended',date:'2026-09-22',start:'12:00',duration:4,courtCount:2,priority:[7,6,5,4,3,2,1],fallbackStarts:[]},maximum:4800});
    expect(calls.map(command=>typeof command==='string'?command:command.kind),controller.state.detail).toEqual(['resetPrepare','apiRun']);
    expect(controller.state).toMatchObject({headline:'API READY TO TEST',ready:true,lock:false});
  });
  it('routes an unresolved final API action through safe browser inspection instead of blocking forever',async()=>{
    const view=bookingView(ConfigSchema.parse({...defaultSetup,PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
    const calls:Command[]=[];let locked=true;
    const runner:Runner=command=>{calls.push(command);if(typeof command==='object'&&command.kind==='resetPrepare')locked=false;return {pid:1,done:Promise.resolve(0),stop:async()=>undefined};};
    const controller=new Controller({runner,lock:async()=>locked,retainedHold:async()=>({stage:'FINAL_ACTION_DISPATCHING',expiresAt:null,remainingSeconds:null}),
      reviewLock:async()=>({runID:'fixture',pid:1,alive:false,owned:false,fingerprint:'fixture',verifiedAt:new Date().toISOString(),reason:'PAYMENT_HOLD_MAY_BE_ACTIVE',canClear:false,page:'Unknown',selected:null,hold:'Unknown',clean:false}),
      clearLock:async()=>{throw Error('UNEXPECTED_DIRECT_CLEAR');},cdp:async()=>true,browserHealth:async()=>({A:true,B:false}),playerStatus:()=>({primary:true,extended:false}),
      clock:()=>clockStatus(ObservationSchema.parse({}),DateTime.fromISO('2026-09-21T08:00:00+08:00')),confirm:async()=>true,publish:()=>undefined,booking:()=>view,saveBooking:()=>view});
    await controller.refresh();
    expect(controller.state).toMatchObject({headline:'UNRESOLVED CHECKOUT LOCK',canPrepareOverHold:true,retainedLockStage:'FINAL_ACTION_DISPATCHING'});
    await controller.resetPrepare({workflow:'test',method:'api-first',request:{strategy:'standard',date:'2026-09-22',start:'12:00',duration:1,courtCount:1,priority:[7,6,5,4,3,2,1],fallbackStarts:[]},maximum:1200});
    expect(calls.map(command=>typeof command==='string'?command:command.kind)).toEqual(['resetPrepare','apiRun']);
    expect(controller.state).toMatchObject({headline:'API READY TO TEST',ready:true,lock:false});
  });
  it('normalizes an expired Standard API QR page through Reset & Prepare before API preparation',async()=>{
    const view=bookingView(ConfigSchema.parse({...defaultSetup,PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
    const calls:Command[]=[];let locked=true;
    const runner:Runner=command=>{calls.push(command);if(typeof command==='object'&&command.kind==='resetPrepare')locked=false;return {pid:1,done:Promise.resolve(0),stop:async()=>undefined};};
    const controller=new Controller({runner,lock:async()=>locked,retainedHold:async()=>({stage:'HOLD_VERIFIED',expiresAt:new Date(Date.now()-1000).toISOString(),remainingSeconds:0}),
      reviewLock:async()=>({runID:'fixture',pid:1,alive:false,owned:false,fingerprint:'fixture',verifiedAt:new Date().toISOString(),reason:'LOCK_BROWSER_STATE_UNKNOWN',canClear:false,page:'QR Checkout',selected:null,hold:'Expired',clean:false}),
      clearLock:async()=>{throw Error('UNEXPECTED_DIRECT_CLEAR');},cdp:async()=>true,browserHealth:async()=>({A:true,B:false}),playerStatus:()=>({primary:true,extended:false}),
      clock:()=>clockStatus(ObservationSchema.parse({}),DateTime.fromISO('2026-09-21T08:00:00+08:00')),confirm:async()=>true,publish:()=>undefined,booking:()=>view,saveBooking:()=>view});
    await controller.resetPrepare({workflow:'test',method:'api-first',request:{strategy:'standard',date:'2026-09-22',start:'12:00',duration:1,courtCount:1,priority:[7,6,5,4,3,2,1],fallbackStarts:[]},maximum:1200});
    expect(calls.map(command=>typeof command==='string'?command:command.kind)).toEqual(['resetPrepare','apiRun']);
    expect(controller.state).toMatchObject({headline:'API READY TO TEST',ready:true,lock:false});
  });
  it('prepares the API browser and sends an explicit non-submitting dry run to the real runner', async () => {
    const view = bookingView(ConfigSchema.parse({ ...defaultSetup, PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' }));
    const calls: Command[] = [];
    const runner: Runner = command => { calls.push(command); return { pid: 1, done: Promise.resolve(0), stop: async () => undefined }; };
    const controller = new Controller({ runner, lock: async () => false, cdp: async () => true,
      browserHealth: async () => ({ A: true, B: false }),
      clock: () => ({ ...clockStatus(ObservationSchema.parse({}), DateTime.fromISO('2026-09-17T07:00:00+08:00')), releaseMs: view.releaseMs, targetDate: view.targetDate }),
      confirm: async () => true, publish: () => undefined, booking: () => view, saveBooking: () => view });
    const preparation = { workflow: 'test' as const, method: 'api-first' as const, request: { strategy: 'standard' as const,
      date: '2026-09-20', start: '12:00', duration: 1, courtCount: 1 as const,
      priority: [7, 6, 5, 4, 3, 2, 1], fallbackStarts: ['13:00'] }, maximum: 1200 };
    await controller.resetPrepare(preparation);
    expect(calls[0]).toMatchObject({ kind: 'apiRun', mode: 'prepare', date: preparation.request.date, preferences: { start: '12:00', duration: 1 } });
    expect(controller.state).toMatchObject({ workflow: 'test', ready: true, apiFirstReady: true, headline: 'API READY TO TEST' });
    await controller.apiPreview(preparation.request.date);
    expect(calls.at(-1)).toMatchObject({ kind: 'apiRun', mode: 'dry', date: preparation.request.date, preferences: { start: '12:00', duration: 1 } });
    expect(controller.state.headline).toBe('API AVAILABILITY CHECK COMPLETE');
  });

  it('runs the visible release block audit without creating a checkout command',async()=>{
    const view=bookingView(ConfigSchema.parse({...defaultSetup,BOOKING_METHOD:'proofless',PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
    const calls:Command[]=[];
    const cells=Array.from({length:7},(_,courtIndex)=>Array.from({length:16},(_,hourIndex)=>({court:courtIndex+1,hour:`${String(hourIndex+8).padStart(2,'0')}:00`,status:(courtIndex===0&&hourIndex===9?'BLOCKED':'UNRELEASED') as 'BLOCKED'|'UNRELEASED',source:(courtIndex===0&&hourIndex===9?'PUBLIC_BOOKING':'DATE_UNRELEASED') as 'PUBLIC_BOOKING'|'DATE_UNRELEASED'}))).flat();
    const runner:Runner=(command,event)=>{calls.push(command);if(typeof command==='object'&&command.kind==='blockAudit')event({type:'blockAudit',date:command.date,cells});return {pid:1,done:Promise.resolve(0),stop:async()=>undefined};};
    const controller=new Controller({runner,lock:async()=>false,cdp:async()=>true,browserHealth:async()=>({A:true,B:false}),playerStatus:()=>({primary:true,extended:false}),
      clock:()=>({...clockStatus(ObservationSchema.parse({}),DateTime.fromISO('2026-09-21T07:00:00+08:00')),targetDate:view.targetDate}),
      confirm:async()=>true,publish:()=>undefined,booking:()=>view,saveBooking:()=>view});
    await controller.resetPrepare({workflow:'release',strategy:'standard',setup:view.setup});
    const before=calls.length;await controller.checkReleaseBlocks(view.targetDate);
    expect(calls.slice(before)).toEqual([{kind:'blockAudit',date:view.targetDate}]);
    expect(controller.state.blockAudit?.cells).toHaveLength(112);
    expect(controller.state.detail).toContain('Blocked 1');
    expect(calls.some(command=>typeof command==='object'&&command.kind==='apiRun'&&command.mode==='live-now')).toBe(false);
  });

  it('checks unreleased blocks by date without preparation or a configured run',async()=>{
    const view=bookingView(ConfigSchema.parse({...defaultSetup,PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
    const date='2026-09-25',calls:Command[]=[];
    const cells=Array.from({length:7},(_,courtIndex)=>Array.from({length:16},(_,hourIndex)=>({court:courtIndex+1,
      hour:`${String(hourIndex+8).padStart(2,'0')}:00`,status:'UNRELEASED' as const,source:'DATE_UNRELEASED' as const}))).flat();
    const runner:Runner=(command,event)=>{calls.push(command);if(typeof command==='object'&&command.kind==='blockAudit')
      event({type:'blockAudit',date:command.date,cells});return {pid:1,done:Promise.resolve(0),stop:async()=>undefined};};
    const controller=new Controller({runner,lock:async()=>true,cdp:async()=>false,browserHealth:async()=>({}),
      clock:()=>({...clockStatus(ObservationSchema.parse({}),DateTime.fromISO('2026-09-23T07:00:00+08:00')),targetDate:date}),
      confirm:async()=>true,publish:()=>undefined,booking:()=>view,saveBooking:()=>view});
    expect(controller.state.booking).toBeNull();
    await controller.checkReleaseBlocks(date);
    expect(calls).toEqual([{kind:'blockAudit',date}]);
    expect(controller.state.blockAudit).toMatchObject({date,cells});
    expect(controller.state.detail).toContain('Unreleased 112');
  });

  it('uses the same API runner for a saved release plan with only an exact release wait added',async()=>{
    const previous=process.env.THIRSTY_API_INSTALLATION;process.env.THIRSTY_API_INSTALLATION='1';
    try{
      const view=bookingView(ConfigSchema.parse({...defaultSetup,BOOKING_METHOD:'api-first',PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
      const calls:Command[]=[];const runner:Runner=command=>{calls.push(command);return {pid:1,done:Promise.resolve(0),stop:async()=>undefined};};
      const started:number[]=[],stopped:number[]=[],releaseMs=Date.now()+3600000;
      const controller=new Controller({ensureArbitrationManifest:preregistered,runner,lock:async()=>false,cdp:async()=>true,browserHealth:async()=>({A:true,B:false}),playerStatus:()=>({primary:true,extended:false}),
        clock:()=>({...clockStatus(ObservationSchema.parse({}),DateTime.fromISO('2026-09-21T07:00:00+08:00')),releaseMs,targetDate:view.targetDate}),
        startSleepProtection:()=>{started.push(77);return 77;},stopSleepProtection:id=>{stopped.push(id);},
        confirm:async()=>true,publish:()=>undefined,booking:()=>view,saveBooking:()=>view});
      await controller.resetPrepare({workflow:'release',strategy:'standard',setup:view.setup});
      const preparedCallCount=calls.length;await controller.apiPreview(view.targetDate);
      expect(calls).toHaveLength(preparedCallCount);expect(controller.state.detail).toBe('RESET REQUIRED. Press Reset & Prepare for these settings.');
      await controller.authorizeTerms(true);await controller.armFullBooking();
      expect(calls).toEqual([{kind:'apiRun',mode:'prepare',date:view.targetDate,fingerprint:view.fingerprint,checkoutMethod:'proof-based'},
        {kind:'apiRun',mode:'live',date:view.targetDate,fingerprint:view.fingerprint,checkoutMethod:'proof-based',clockOffsetMs:0,releaseMs}]);
      expect(started).toEqual([77]);expect(stopped).toEqual([77]);expect(controller.state.sleepProtection).toBe(false);
    }finally{if(previous===undefined)delete process.env.THIRSTY_API_INSTALLATION;else process.env.THIRSTY_API_INSTALLATION=previous;}
  });

  it('keeps Test Now API readiness through refresh and routes one confirmed run directly to QR', async () => {
    const view = bookingView(ConfigSchema.parse({ ...defaultSetup, PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' }));
    const calls: Command[] = [];
    const confirms: unknown[] = [];
    const runner: Runner = (command,event) => { calls.push(command);if(typeof command==='object'&&command.kind==='apiRun'&&command.mode==='live-now')event({type:'apiStage',stage:'OFFICIAL_QRPH_HANDOFF',elapsedMs:2500,at:'2026-09-19T00:00:02.500Z',workerId:'A',date:'2026-09-20',court:7,startTime:'12:00',durationHours:1,price:600,bookingId:'fixture-booking',bookingNo:'fixture-number',holdExpiresAt:'2026-09-19T00:10:02.500Z'});return { pid: 1, done: Promise.resolve(0), stop: async () => undefined }; };
    const controller = new Controller({ runner, lock: async () => false, cdp: async () => true,
      browserHealth: async () => ({ A: true, B: false }), playerStatus: () => ({ primary: true, extended: false }),
      clock: () => clockStatus(ObservationSchema.parse({}), DateTime.fromISO('2026-09-19T08:00:00+08:00')),
      confirm: async () => true, confirmApiTest: async input => { confirms.push(input); return true; },
      publish: () => undefined, booking: () => view, saveBooking: () => view });
    const preparation = { workflow: 'test' as const, method: 'api-first' as const, request: { strategy: 'standard' as const,
      date: '2026-09-20', start: '12:00', duration: 1, courtCount: 1 as const,
      priority: [7, 6, 5, 4, 3, 2, 1], fallbackStarts: ['13:00'] }, maximum: 1200 };
    await controller.resetPrepare(preparation);
    expect(calls[0]).toMatchObject({ kind: 'apiRun', mode: 'prepare', date: '2026-09-20', preferences: { start: '12:00', duration: 1 } });
    await controller.refresh();
    expect(controller.state).toMatchObject({ workflow: 'test', ready: true, apiFirstReady: true, headline: 'API READY TO TEST' });
    await controller.authorizeTerms(true);
    await controller.testBooking({ method: preparation.method, request: preparation.request, maximum: preparation.maximum, authorizeTerms: true });
    expect(confirms).toEqual([{ method:'api-first', strategy: 'standard', date: '2026-09-20', start: '12:00', duration: 1, courtCount: 1, maximum: 1200, priority: [7, 6, 5, 4, 3, 2, 1] }]);
    expect(calls.at(-1)).toMatchObject({ kind: 'apiRun', mode: 'live-now', date: '2026-09-20', preferences: { start: '12:00', duration: 1 } });
    expect(controller.state.qrHandoffs).toEqual([{checkout:'A',status:'qr-ready',courts:[7],date:'2026-09-20',startTime:'12:00',endTime:'13:00',amount:600,verifiedAt:'2026-09-19T00:00:02.500Z',holdExpiresAt:'2026-09-19T00:10:02.500Z',bookingId:'fixture-booking',bookingNo:'fixture-number'}]);
    expect(controller.state.detail).toContain('Court 7 · 2026-09-20 · 12:00–13:00');
  });

  it('updates one checkout in real time from payment hold to verified QR details',async()=>{
    const view=bookingView(ConfigSchema.parse({...defaultSetup,PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
    const snapshots:unknown[]=[];
    const runner:Runner=(command,event)=>{
      if(typeof command==='object'&&command.kind==='apiRun'&&command.mode==='live-now'){
        const base={elapsedMs:1000,workerId:'A' as const,date:'2026-09-20',court:7,startTime:'12:00',durationHours:2,price:1200,bookingId:'fixture-booking',bookingNo:'BK-FIXTURE',holdExpiresAt:'2026-09-19T00:10:00.000Z'};
        event({type:'apiStage',stage:'PENDING_HOLD',at:'2026-09-19T00:00:01.000Z',...base});snapshots.push(structuredClone(controller.state.qrHandoffs));
        event({type:'apiStage',stage:'OFFICIAL_QRPH_HANDOFF',at:'2026-09-19T00:00:02.000Z',...base});snapshots.push(structuredClone(controller.state.qrHandoffs));
      }
      return {pid:1,done:Promise.resolve(0),stop:async()=>undefined};
    };
    const controller=new Controller({runner,lock:async()=>false,cdp:async()=>true,browserHealth:async()=>({A:true,B:false}),playerStatus:()=>({primary:true,extended:false}),
      clock:()=>clockStatus(ObservationSchema.parse({}),DateTime.fromISO('2026-09-19T08:00:00+08:00')),confirm:async()=>true,confirmApiTest:async()=>true,publish:()=>undefined,booking:()=>view,saveBooking:()=>view});
    const preparation={workflow:'test' as const,method:'api-first' as const,request:{strategy:'standard' as const,date:'2026-09-20',start:'12:00',duration:2,courtCount:1 as const,priority:[7,6,5,4,3,2,1],fallbackStarts:[]}};
    await controller.setWorkflow('test');await controller.resetPrepare(preparation);await controller.authorizeTerms(true);await controller.testBooking({method:preparation.method,request:preparation.request,authorizeTerms:true});
    expect(snapshots).toEqual([
      [expect.objectContaining({checkout:'A',status:'hold-created',courts:[7],startTime:'12:00',endTime:'14:00',bookingNo:'BK-FIXTURE'})],
      [expect.objectContaining({checkout:'A',status:'qr-ready',courts:[7],startTime:'12:00',endTime:'14:00',bookingNo:'BK-FIXTURE'})],
    ]);
    expect(controller.state.qrHandoffs).toHaveLength(1);
  });

  it('prepares Extended API Test Now with both players and routes two-checkout preferences', async () => {
    const view = bookingView(ConfigSchema.parse({ ...defaultSetup, BOOKING_TYPE: 'extended', DURATION_HOURS: 4,
      PLAYER_FULL_NAME: 'Fixture Primary', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'primary@example.invalid',
      PLAYER_B_FULL_NAME: 'Fixture Extended', PLAYER_B_PHONE: '09987654321', PLAYER_B_EMAIL: 'extended@example.invalid' }));
    const calls: Command[] = [];
    const runner: Runner = command => { calls.push(command); return { pid: 1, done: Promise.resolve(0), stop: async () => undefined }; };
    const controller = new Controller({ runner, lock: async () => false, cdp: async () => true,
      browserHealth: async () => ({ A: true, B: true }), playerStatus: () => ({ primary: true, extended: true }),
      clock: () => clockStatus(ObservationSchema.parse({}), DateTime.fromISO('2026-09-19T08:00:00+08:00')),
      confirm: async () => true, confirmApiTest: async () => true, publish: () => undefined,
      booking: () => view, saveBooking: () => view });
    const preparation = { workflow: 'test' as const, method: 'api-first' as const, request: { strategy: 'extended' as const,
      date: '2026-09-21', start: '12:00', duration: 4, courtCount: 2 as const,
      priority: [7, 6, 5, 4, 3, 2, 1], fallbackStarts: [] }, maximum: 1800 };
    await controller.resetPrepare(preparation);
    expect(calls[0]).toMatchObject({ kind: 'apiRun', mode: 'prepare', preferences: { strategy: 'extended', duration: 4, courtCount: 2 } });
    await controller.refresh(); expect(controller.state.ready).toBe(true);
    await controller.authorizeTerms(true);
    await controller.testBooking({ method: 'api-first', request: preparation.request, maximum: 1800, authorizeTerms: true });
    expect(calls.at(-1)).toMatchObject({ kind: 'apiRun', mode: 'live-now', preferences: { strategy: 'extended', duration: 4, courtCount: 2 } });
  });
});
