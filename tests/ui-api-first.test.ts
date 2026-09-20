import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { Controller } from '../ui/controller.js';
import { bookingView, defaultSetup } from '../ui/booking.js';
import { ConfigSchema, ObservationSchema } from '../src/config.js';
import { clockStatus } from '../ui/status.js';
import type { Runner } from '../ui/processes.js';
import type { Command } from '../ui/types.js';

describe('API-first UI boundary', () => {
  it('makes Reset & Prepare respect an active QR hold and recover a verified expired stale lock',async()=>{
    const view=bookingView(ConfigSchema.parse({...defaultSetup,PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
    const calls:Command[]=[];let locked=true;
    let remainingSeconds=120;
    const expiresAt=new Date(Date.now()+120000).toISOString();
    const runner:Runner=command=>{calls.push(command);return {pid:1,done:Promise.resolve(0),stop:async()=>undefined};};
    const controller=new Controller({runner,lock:async()=>locked,retainedHold:async()=>({stage:'HOLD_VERIFIED',expiresAt,remainingSeconds}),
      reviewLock:async()=>({runID:'fixture',pid:1,alive:false,owned:false,fingerprint:'fixture',verifiedAt:new Date().toISOString(),reason:'VERIFIED_STALE_LOCK',canClear:true,page:'Schedule',selected:0,hold:'Not detected',clean:true}),
      clearLock:async fingerprint=>{expect(fingerprint).toBe('fixture');locked=false;},
      cdp:async()=>true,browserHealth:async()=>({A:true,B:false}),playerStatus:()=>({primary:true,extended:false}),
      clock:()=>clockStatus(ObservationSchema.parse({}),DateTime.fromISO('2026-09-21T08:00:00+08:00')),
      confirm:async()=>true,publish:()=>undefined,booking:()=>view,saveBooking:()=>view});
    const input={workflow:'test' as const,method:'api-first' as const,request:{strategy:'standard' as const,date:'2026-09-22',start:'12:00',duration:1,courtCount:1 as const,priority:[7,6,5,4,3,2,1],fallbackStarts:[]},maximum:1200};
    await controller.resetPrepare(input);
    expect(calls).toEqual([]);expect(controller.state).toMatchObject({headline:'PAYMENT HOLD ACTIVE',ready:false,lock:true});
    expect(controller.state.detail).toContain('remaining');
    remainingSeconds=0;
    await controller.resetPrepare(input);
    expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({kind:'apiRun',mode:'prepare'});
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

  it('uses the same API runner for a saved release plan with only an exact release wait added',async()=>{
    const previous=process.env.THIRSTY_API_INSTALLATION;process.env.THIRSTY_API_INSTALLATION='1';
    try{
      const view=bookingView(ConfigSchema.parse({...defaultSetup,BOOKING_METHOD:'api-first',PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid'}));
      const calls:Command[]=[];const runner:Runner=command=>{calls.push(command);return {pid:1,done:Promise.resolve(0),stop:async()=>undefined};};
      const started:number[]=[],stopped:number[]=[];
      const controller=new Controller({runner,lock:async()=>false,cdp:async()=>true,browserHealth:async()=>({A:true,B:false}),playerStatus:()=>({primary:true,extended:false}),
        clock:()=>({...clockStatus(ObservationSchema.parse({}),DateTime.fromISO('2026-09-21T07:00:00+08:00')),releaseMs:Date.parse('2026-09-21T08:00:00+08:00'),targetDate:view.targetDate}),
        startSleepProtection:()=>{started.push(77);return 77;},stopSleepProtection:id=>{stopped.push(id);},
        confirm:async()=>true,publish:()=>undefined,booking:()=>view,saveBooking:()=>view});
      await controller.resetPrepare({workflow:'release',strategy:'standard',setup:view.setup});
      const preparedCallCount=calls.length;await controller.apiPreview(view.targetDate);
      expect(calls).toHaveLength(preparedCallCount);expect(controller.state.detail).toBe('RESET REQUIRED. Press Reset & Prepare for these settings.');
      await controller.authorizeTerms(true);await controller.armFullBooking();
      expect(calls).toEqual([{kind:'apiRun',mode:'prepare',date:view.targetDate,fingerprint:view.fingerprint},
        {kind:'apiRun',mode:'live',date:view.targetDate,fingerprint:view.fingerprint,releaseMs:Date.parse('2026-09-21T08:00:00+08:00')}]);
      expect(started).toEqual([77]);expect(stopped).toEqual([77]);expect(controller.state.sleepProtection).toBe(false);
    }finally{if(previous===undefined)delete process.env.THIRSTY_API_INSTALLATION;else process.env.THIRSTY_API_INSTALLATION=previous;}
  });

  it('keeps Test Now API readiness through refresh and routes one confirmed run directly to QR', async () => {
    const view = bookingView(ConfigSchema.parse({ ...defaultSetup, PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' }));
    const calls: Command[] = [];
    const confirms: unknown[] = [];
    const runner: Runner = command => { calls.push(command); return { pid: 1, done: Promise.resolve(0), stop: async () => undefined }; };
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
    expect(confirms).toEqual([{ strategy: 'standard', date: '2026-09-20', start: '12:00', duration: 1, courtCount: 1, maximum: 1200, priority: [7, 6, 5, 4, 3, 2, 1] }]);
    expect(calls.at(-1)).toMatchObject({ kind: 'apiRun', mode: 'live-now', date: '2026-09-20', preferences: { start: '12:00', duration: 1 } });
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
