import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { Controller, type Dependencies } from '../ui/controller.js';
import { bookingView, defaultSetup, type BookingView } from '../ui/booking.js';
import { BookingSetupSchema, ConfigSchema, ObservationSchema } from '../src/config.js';
import { clockStatus } from '../ui/status.js';
import type { Runner } from '../ui/processes.js';
import type { Command } from '../ui/types.js';
import type { UiEvent } from '../src/ui-events.js';
import { UiEventSchema, UI_EVENT_PROTOCOL_VERSION } from '../src/ui-events.js';
import { preregistered } from './arbitration-manifest-stub.js';

const players = { PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' };
const precision = (targets: Array<{ court: number; start: string; durationHours: number }>) =>
  bookingView(ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: 'proofless', DURATION_HOURS: 3, RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: targets, ...players }));
const one = [{ court: 7, start: '17:00', durationHours: 3 }], two = [{ court: 7, start: '17:00', durationHours: 3 }, { court: 6, start: '17:00', durationHours: 3 }];
let previous: string | undefined;
beforeEach(() => { previous = process.env.THIRSTY_API_INSTALLATION; process.env.THIRSTY_API_INSTALLATION = '1'; });
afterEach(() => { if (previous === undefined) delete process.env.THIRSTY_API_INSTALLATION; else process.env.THIRSTY_API_INSTALLATION = previous; });

/** A controller over a mutable saved plan, recording every runner command. `script` may emit events and choose the exit code. */
function harness(initial: BookingView, script: (command: Command, emit: (event: UiEvent) => void, line: (text: string) => void) => number = () => 0, extra: Partial<Dependencies> = {}) {
  // One fixed release instant: the controller rejects a release that moves between its own reads (SCHEDULE_CONTEXT_MISMATCH).
  let saved = initial; const calls: Command[] = []; let locked = false; const releaseMs = Date.now() + 3_600_000;
  const runner: Runner = (command, event, onLine) => { calls.push(command); const code = script(command, event, text => onLine(text, true)); return { pid: 1, done: Promise.resolve(code), stop: async () => undefined }; };
  const controller = new Controller({ ensureArbitrationManifest: preregistered, runner, lock: async () => locked, cdp: async () => true,
    browserHealth: async () => ({ A: true, B: true }), playerStatus: () => ({ primary: true, extended: true }),
    clock: () => ({ ...clockStatus(ObservationSchema.parse({}), DateTime.fromISO('2026-09-24T06:00:00+08:00')), releaseMs, targetDate: saved.targetDate, networkSynced: true, clockOffsetMs: 0 }),
    confirm: async () => true, publish: () => undefined, booking: () => saved, saveBooking: (input: unknown) => { saved = bookingView(ConfigSchema.parse({ ...BookingSetupSchema.parse(input), ...players })); return saved; }, ...extra });
  return { controller, calls, setSaved: (view: BookingView) => { saved = view; }, setLock: (value: boolean) => { locked = value; } };
}
const liveRuns = (calls: Command[]) => calls.filter(c => typeof c === 'object' && c.kind === 'apiRun' && c.mode === 'live');


import { operatorGates } from '../src/execution-state.js';
import { releaseBlockers } from '../ui/renderer/operator-status.js';
import {compileSmartPlan,confirmSmartRates,emptySmartDraft} from '../src/precision-simple.js';
it('review: a schema-valid prepared Fixed Precision plan remains armable after a real controller refresh', async () => {
  const saved = precision(one), h = harness(saved);
  expect(h.controller.validateReleaseSetup(saved.setup).ok).toBe(true);
  await h.controller.resetPrepare({workflow:'release',strategy:'standard'});
  await h.controller.refresh();
  await h.controller.authorizeTerms(true);
  const blockers = releaseBlockers(h.controller.state);
  const gates = operatorGates({ mode:'NEXT_RELEASE',owns:false,draftProblems:[],liveSaveProblems:[],runtime:{status:'VALID',problems:[]},
    savedPlan:{exists:true,matchesDraft:true,differences:0},operation:'idle',prepared:{forSavedPlan:true,forOtherPlan:false},armed:false,running:false,
    lock:{present:false,canPrepareOver:false,unresolvedSubmission:false},disconnected:[],playersMissing:[],termsAuthorized:true,
    forecast:{verdict:'NOT_APPLICABLE',ready:0,configured:0,omitted:0,required:false},readinessBlockers:blockers });
  await h.controller.armFullBooking();
  expect(liveRuns(h.calls)).toHaveLength(1);
  expect(gates.arm.enabled).toBe(true);
});

describe('real controller readiness by applicable authorization',()=>{
  function smart(){
    const base=precision(two),compiled=compileSmartPlan({...emptySmartDraft(),rates:confirmSmartRates(600,700,'VENUE_SCHEDULE',base.targetDate,new Date()),
      immediate:two,advanced:{wave2:0,rescue:0}},{targetDate:base.targetDate});
    if(!compiled.phase3)throw Error(compiled.problems.join(' '));
    return bookingView(ConfigSchema.parse({...defaultSetup,...players,BOOKING_METHOD:'proofless',RELEASE_STRATEGY:'precision',PRECISION_PHASE3:compiled.phase3}));
  }
  it.each(['general','fixed','smart'] as const)('accepts the real %s authorization without requiring another strategy format',async strategy=>{
    const view=strategy==='general'?bookingView(ConfigSchema.parse({...defaultSetup,...players,BOOKING_METHOD:'proofless'})):strategy==='smart'?smart():precision(two);
    const h=harness(view);await h.controller.resetPrepare({workflow:'release',strategy:'standard'});await h.controller.refresh();
    expect(h.controller.validateReleaseSetup(view.setup).ok).toBe(true);
    expect(h.controller.state.releaseReadiness?.checks.find(c=>c.id==='config')).toMatchObject({level:'GOOD',hardBlock:true});
    expect(releaseBlockers(h.controller.state)).toEqual([]);
    await h.controller.authorizeTerms(true);await h.controller.armFullBooking();expect(liveRuns(h.calls)).toHaveLength(1);
  });
  it('keeps malformed and absent authorization blocked',async()=>{
    const view=precision(one),invalid={...view,setup:{...view.setup,PRECISION_TARGETS:[]}};
    const h=harness(invalid);await h.controller.refresh();
    expect(releaseBlockers(h.controller.state).some(c=>c.reason.includes('Configuration'))).toBe(true);
    const missing=harness(view,()=>0,{booking:()=>{throw Error('CONFIG_INVALID');}});await missing.controller.refresh();
    expect(releaseBlockers(missing.controller.state).some(c=>c.reason.includes('Configuration'))).toBe(true);
  });
  it('a changed saved fingerprint clears preparation and cannot launch',async()=>{
    const h=harness(precision(two));await h.controller.resetPrepare({workflow:'release',strategy:'standard'});
    h.setSaved(precision(one));await h.controller.refresh();
    expect(h.controller.state.preparedPlanFingerprint).toBeNull();await h.controller.armFullBooking();expect(liveRuns(h.calls)).toEqual([]);
  });
  it('a disconnected required worker prevents readiness and real clock blockers remain visible',async()=>{
    let connected=true;const h=harness(precision(two),()=>0,{browserHealth:async()=>({A:true,B:connected})});
    await h.controller.resetPrepare({workflow:'release',strategy:'standard'});connected=false;await h.controller.refresh();
    expect(h.controller.state.ready).toBe(false);await h.controller.armFullBooking();expect(liveRuns(h.calls)).toEqual([]);
    const clock=harness(precision(two),()=>0,{clock:()=>({...clockStatus(ObservationSchema.parse({})),networkSynced:false})});
    await clock.controller.refresh();expect(releaseBlockers(clock.controller.state).some(c=>c.reason.includes('Trusted clock'))).toBe(true);
  });
});
