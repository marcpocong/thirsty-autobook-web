import {it,expect,vi,beforeEach} from 'vitest';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {ConfigSchema} from '../src/config.js';
import {defaultSetup} from '../ui/booking.js';
import {Safety} from '../src/safety.js';
import {Telemetry} from '../src/telemetry.js';
const mocks=vi.hoisted(()=>({attach:vi.fn(),checkout:vi.fn(),coordinate:vi.fn(),event:vi.fn()}));
vi.mock('../src/browser.js',async original=>({...await original<typeof import('../src/browser.js')>(),attach:mocks.attach}));
vi.mock('../src/diagnostic-schedule.js',()=>({assertDiagnosticSchedule:vi.fn()}));
vi.mock('../src/grid.js',async original=>({...await original<typeof import('../src/grid.js')>(),navigateDate:vi.fn(),snapshot:vi.fn(async()=>({}))}));
vi.mock('../src/release.js',()=>({observeRelease:vi.fn(async()=>({grid:{}}))}));
vi.mock('../src/booking-checkout.js',()=>({fullBookingToQr:mocks.checkout}));
vi.mock('../src/booking-coordinator.js',()=>({coordinateBooking:mocks.coordinate}));
vi.mock('../src/ui-events.js',()=>({emitUiEvent:mocks.event}));
import {runBooking} from '../src/booking-runtime.js';
const profiles={PLAYER_FULL_NAME:'Synthetic A',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'synthetic-a@example.invalid',PLAYER_B_FULL_NAME:'Synthetic B',PLAYER_B_PHONE:'09987654321',PLAYER_B_EMAIL:'synthetic-b@example.invalid'};
beforeEach(()=>{vi.clearAllMocks();mocks.attach.mockImplementation(async(_s,_t,b)=>({page:{worker:b.workerId}}));});
it.each(['test','race'] as const)('%s runtime routes every strategy/count by browser identity, without persisting players',async mode=>{
  const cwd=process.cwd();await mkdir('.local',{recursive:true});const root=await mkdtemp(resolve('.local/player-runtime-'));
  try{
    process.chdir(root);await mkdir('.local/onda-chrome-profile',{recursive:true});await mkdir('.local/onda-chrome-profile-b');
    for(const strategy of ['standard','extended'] as const)for(const courtCount of [1,2] as const){
      vi.clearAllMocks();const duration=strategy==='standard'?2:4;
      const config=ConfigSchema.parse({...defaultSetup,...profiles,BOOKING_TYPE:strategy,COURT_COUNT:courtCount,DURATION_HOURS:duration});
      const t=new Telemetry(),request={strategy,courtCount,duration,date:'2026-09-15',start:'08:00',priority:[7,6],fallbackStarts:[]};
      mocks.coordinate.mockImplementation(async workers=>{
        for(const worker of workers)await worker.checkout({});
        const persisted=await readFile('.local/automation.lock','utf8')+(strategy==='extended'?await readFile('.local/dual/worker-b.lock','utf8'):'');
        for(const value of Object.values(profiles))expect(persisted).not.toContain(value);
        return {status:'CANCELLED',plan:{strategy,date:request.date,requestedStart:request.start,requestedDuration:duration,courtCount,chunks:[]}};
      });
      await runBooking(config,mode,new Safety(),t,{request,authorizeTerms:true,confirm:async()=>false});
      expect(mocks.attach.mock.calls.map(c=>c[2].workerId)).toEqual(strategy==='standard'?['A']:['A','B']);
      expect(mocks.checkout.mock.calls[0]![2]).toEqual({fullName:profiles.PLAYER_FULL_NAME,phone:profiles.PLAYER_PHONE,email:profiles.PLAYER_EMAIL});
      if(strategy==='extended')expect(mocks.checkout.mock.calls[1]![2]).toEqual({fullName:profiles.PLAYER_B_FULL_NAME,phone:profiles.PLAYER_B_PHONE,email:profiles.PLAYER_B_EMAIL});
      for(const value of Object.values(profiles)){expect(JSON.stringify(t.events)).not.toContain(value);expect(JSON.stringify(mocks.event.mock.calls)).not.toContain(value);}
    }
  }finally{process.chdir(cwd);if(!root.startsWith(resolve(cwd,'.local')+sep))throw Error('UNSAFE_TEST_PATH');await rm(root,{recursive:true,force:true});}
});
it('missing B fails in the runtime before attachment or booking interaction',async()=>{
  const c=ConfigSchema.parse({...defaultSetup,...profiles,PLAYER_B_EMAIL:undefined,BOOKING_TYPE:'extended',DURATION_HOURS:4});
  await expect(runBooking(c,'race',new Safety(),new Telemetry(),{authorizeTerms:true})).rejects.toThrow('EXTENDED_PLAYER_INFO_MISSING');expect(mocks.attach).not.toHaveBeenCalled();expect(mocks.coordinate).not.toHaveBeenCalled();
});
