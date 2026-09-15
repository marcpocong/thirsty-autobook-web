import {afterEach,expect,it,vi} from 'vitest';
import {DateTime} from 'luxon';
import {ConfigSchema,ObservationSchema,releaseCalendar} from '../src/config.js';
import {bookingView,defaultSetup} from '../ui/booking.js';
import {clockStatus} from '../ui/status.js';
import {Controller} from '../ui/controller.js';
import {expectedPreparationFingerprint} from '../src/prepared-context.js';
import type {Command} from '../ui/types.js';
import type {Runner} from '../ui/processes.js';

afterEach(()=>vi.useRealTimers());

it('chooses today before release, tomorrow after release, and applies the configured horizon',()=>{
  const settings=ObservationSchema.parse({RELEASE_TIME:'08:00:00',BOOKING_HORIZON_DAYS:5});
  const before=releaseCalendar(settings,DateTime.fromISO('2026-09-15T07:30:00+08:00'));
  expect(before).toMatchObject({releaseMs:Date.parse('2026-09-15T08:00:00+08:00'),targetDate:'2026-09-20'});
  const after=releaseCalendar(settings,DateTime.fromISO('2026-09-15T08:30:00+08:00'));
  expect(after).toMatchObject({releaseMs:Date.parse('2026-09-16T08:00:00+08:00'),targetDate:'2026-09-21'});
});

function harness(){
  vi.useFakeTimers();vi.setSystemTime(Date.parse('2026-09-15T10:00:00+08:00'));
  const settings=ObservationSchema.parse({RELEASE_TIME:'08:00:00',BOOKING_HORIZON_DAYS:2,SCHEDULE_WAKE_SECONDS_BEFORE:90});
  let plan=bookingView(ConfigSchema.parse({...defaultSetup,BOOKING_TYPE:'extended',DURATION_HOURS:6,START_TIME:'18:00',COURT_COUNT:2,PLAYER_FULL_NAME:'Fixture Player',PLAYER_PHONE:'09123456789',PLAYER_EMAIL:'fixture@example.invalid',PLAYER_B_FULL_NAME:'Second Player',PLAYER_B_PHONE:'09987654321',PLAYER_B_EMAIL:'second@example.invalid'}));
  const calls:Command[]=[];
  const runner:Runner=(command,event)=>{calls.push(command);if(typeof command==='object'&&command.kind==='resetPrepare')event({type:'preparationResult',result:{workflow:'release',strategy:'extended',fingerprint:expectedPreparationFingerprint(command.input,plan.fingerprint),browsers:(['A','B'] as const).map(id=>({id,dedicatedProfileVerified:true as const,ondaVerified:true as const,preparedDate:'2026-09-15',gridVerified:true as const,selectedCount:0 as const,hold:'Not detected' as const})),solutionAvailable:true,releaseTargetDate:plan.targetDate,releaseMs:plan.releaseMs}});return {pid:1,done:Promise.resolve(0),stop:vi.fn(async()=>{})};};
  const start=vi.fn(()=>17),stop=vi.fn();
  const controller=new Controller({runner,lock:async()=>false,cdp:async()=>true,browserHealth:async()=>({A:true,B:true}),clock:()=>clockStatus(settings,DateTime.fromMillis(Date.now())),confirm:async()=>true,booking:()=>plan,saveBooking:()=>plan,publish:()=>{},startSleepProtection:start,stopSleepProtection:stop});
  return {controller,calls,start,stop,changePlan:()=>{plan={...plan,fingerprint:'f'.repeat(64)};}};
}

async function arm(h:ReturnType<typeof harness>){await h.controller.setWorkflow('release');await h.controller.resetPrepare({workflow:'release',strategy:'extended'});await h.controller.authorizeTerms(true);await h.controller.armFullBooking();}

it('arms twenty-two hours early without a Playwright worker and freezes the exact run',async()=>{
  const h=harness();await arm(h);
  expect(h.calls).toEqual([{kind:'resetPrepare',input:{workflow:'release',strategy:'extended'}}]);
  expect(h.controller.state.scheduledRelease).toMatchObject({releaseMs:Date.parse('2026-09-16T08:00:00+08:00'),targetDate:'2026-09-18',strategy:'extended',courtCount:2,requiredBrowsers:['A','B']});
  expect(JSON.stringify(h.controller.state.scheduledRelease)).not.toMatch(/Player|phone|email/i);
  expect(h.start).toHaveBeenCalledOnce();expect(h.controller.state.sleepProtection).toBe(true);
  await h.controller.cancelScheduledRelease();expect(h.stop).toHaveBeenCalledWith(17);expect(h.controller.state.scheduledRelease).toBeNull();expect(h.controller.state.preparedContext).toBeNull();expect(h.controller.state.termsAuthorized).toBe(false);
});

it('a settings change cancels the scheduled context, preparation, Terms and sleep blocker',async()=>{
  const h=harness();await arm(h);h.changePlan();await h.controller.invalidatePreparation();
  expect(h.controller.state.headline).toContain('SETTINGS CHANGED');expect(h.controller.state.scheduledRelease).toBeNull();expect(h.controller.state.preparedContext).toBeNull();expect(h.controller.state.termsAuthorized).toBe(false);expect(h.stop).toHaveBeenCalledOnce();
});

it('resume after the frozen timestamp marks missed and never rolls or starts a worker',async()=>{
  const h=harness();await arm(h);const armed=h.controller.state.scheduledRelease!;vi.setSystemTime(armed.releaseMs+10000);await h.controller.refresh();
  expect(h.controller.state.headline).toBe('RELEASE MISSED');expect(h.controller.state.scheduledRelease).toBeNull();expect(h.calls).toHaveLength(1);expect(h.stop).toHaveBeenCalledOnce();
});

it('worker failure after scheduler wake stops sleep protection and never re-arms',async()=>{
  const h=harness();await arm(h);const scheduled=h.controller.state.scheduledRelease!;
  await vi.advanceTimersByTimeAsync(scheduled.releaseMs-90000-Date.now()+1);
  expect(h.calls.some(c=>typeof c==='object'&&c.kind==='full')).toBe(true);expect(h.controller.state.scheduledRelease).toBeNull();expect(h.controller.state.operation).toBe('idle');expect(h.stop).toHaveBeenCalledOnce();
});

it('a new controller never restores an old arm or Terms authorization',()=>{
  const h=harness();expect(h.controller.state.scheduledRelease).toBeNull();expect(h.controller.state.termsAuthorized).toBe(false);expect(h.controller.state.operation).toBe('idle');
});
