import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { Controller, type Dependencies } from '../ui/controller.js';
import { bookingView, defaultSetup } from '../ui/booking.js';
import { ConfigSchema, ObservationSchema } from '../src/config.js';
import { clockStatus } from '../ui/status.js';
import { compileSmartPlan, confirmSmartRates, emptySmartDraft } from '../src/precision-simple.js';
import { logicalTargetId } from '../src/shotgun.js';
import type { Runner } from '../ui/processes.js';
import type { Command } from '../ui/types.js';
import { preregistered } from './arbitration-manifest-stub.js';
import type { SecurityCheck } from '../src/security-check.js';

/** A genuine pre-release check record as the runner writes it: every worker verified just now for this exact plan. */
const passedCheck = (view: { targetDate: string; fingerprint: string }, outcome: 'READY' | 'FAILED' = 'READY', at = new Date()): SecurityCheck => ({ schema: 'security-check/v1',
  checkedAt: at.toISOString(), targetDate: view.targetDate, fingerprint: view.fingerprint,
  workers: Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(id => [id, { outcome, durationMs: 4200, ...(outcome === 'FAILED' ? { code: 'ONDA_SECURITY_VERIFICATION_FAILED' } : {}) }])) });

const players = { PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' };
function shotgunView(objective?: { ideal: number }) {
  const base = bookingView(ConfigSchema.parse({ ...defaultSetup, ...players })), targetDate = base.targetDate;
  const immediate = [{ court: 7, start: '19:00', durationHours: 2 }, { court: 6, start: '19:00', durationHours: 2 }];
  const shotgun = { enabled: true, budget: 6, allocationMode: 'EQUAL' as const, selectedTargetIds: immediate.map(logicalTargetId), windowStartMs: -2000, windowEndMs: 0, timingMode: 'AUTO' as const, timingCapacityOverride: false, allowStandbyConsumption: true };
  const compiled = compileSmartPlan({ ...emptySmartDraft(), rates: confirmSmartRates(600, 700, 'VENUE_SCHEDULE', targetDate, new Date()), immediate, shotgun, advanced: { wave2: 0, rescue: 0 } }, { targetDate });
  if (!compiled.phase3 || !compiled.shotgun) throw Error(compiled.problems.join(' '));
  const plan = compiled.shotgun;
  return bookingView(ConfigSchema.parse({ ...defaultSetup, ...players, BOOKING_METHOD: 'proofless', RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: [], PRECISION_PHASE3: compiled.phase3,
    STRATEGY_V2: { version: 1, preset: 'CUSTOM', goal: { primeFrom: '18:00', primeUntil: '24:00', durations: [2], courts: [7, 6] },
      fanOut: { width: 1, source: 'OPERATOR_OVERRIDE', recommendedWidth: null, timing: 'BALANCED', profileCreatedAt: null },
      shotgun: { version: 1, ...shotgun, counts: plan.counts, exactSchedule: plan.shots.map(({ logicalTargetId, shotIndex, configuredOffsetMs }) => ({ logicalTargetId, shotIndex, configuredOffsetMs })),
        capacity: { meaningfulSpacingMs: plan.meaningfulSpacingMs, recommendedMaximum: plan.recommendedMaximum, warning: plan.capacityWarning, groupAnchorMs: plan.groupAnchorMs } },
      ...(objective ? { objective: { version: 3, fingerprint: 'a'.repeat(64), scope: 'PER_WING', wings: { MANGO: { minimum: 1, ideal: objective.ideal } } } } : {}) } }));
}
async function arm(view: ReturnType<typeof shotgunView>, extra: Partial<Dependencies>, beforeArm?: (controller:Controller)=>void) {
  const previous = process.env.THIRSTY_API_INSTALLATION; process.env.THIRSTY_API_INSTALLATION = '1';
  try {
    const calls: Command[] = [], releaseMs = Date.now() + 3_600_000, attestations: unknown[] = [];
    const runner: Runner = command => { calls.push(command); return { pid: 1, done: Promise.resolve(0), stop: async () => undefined }; };
    const probe = { connected: true, targetReady: true, tabCount: 6, chromeVersion: '155' };
    const controller = new Controller({ ensureArbitrationManifest: preregistered, runner, lock: async () => false, cdp: async () => true,
      browserHealth: async () => ({ A: true, B: true, C: true, D: true, E: true, F: true, G: true }), playerStatus: () => ({ primary: true, extended: true, third: true, fourth: true, fifth: true, sixth: true, seventh: true }),
      browserReadiness: async () => ({ A: probe, B: probe, C: probe, D: probe, E: probe, F: probe, G: probe }) as never, machineHealth: () => ({ eventLoopP95Ms: 4, memoryUsedPct: 40 }) as never,
      clock: () => ({ ...clockStatus(ObservationSchema.parse({}), DateTime.fromISO('2026-10-14T21:00:00+08:00')), releaseMs, targetDate: view.targetDate, networkSynced: true, clockOffsetMs: 0 }),
      confirm: async () => true, publish: () => undefined, booking: () => view, saveBooking: () => view, recordShotgunAttestation: record => attestations.push(record),
      securityCheck: () => passedCheck(view), ...extra });
    // Preparation is bound to the exact saved plan it prepared (as resetPrepare records it).
    controller.state.apiFirstReady = true; controller.state.ready = true; controller.state.termsAuthorized = true; controller.state.preparedPlanFingerprint = view.fingerprint;
    beforeArm?.(controller);
    await controller.armFullBooking();
    return { calls, controller, attestations };
  } finally { process.env.THIRSTY_API_INSTALLATION = previous; }
}

describe('live Shotgun capability gate', () => {
  it.each(['syncClock','browserReadiness','confirm','confirmShotgunLive'] as const)('Stop revokes delayed %s and duplicate arming', async step=>{
    let controller!:Controller,entered!:()=>void,resolve!:(value:never)=>void;
    const waiting=new Promise<void>(done=>entered=done),pending=new Promise<never>(done=>resolve=done);
    let first=true;
    const extra:Partial<Dependencies>={confirmShotgunLive:async()=>true,[step]:async()=>{
      if(first){first=false;entered();return pending;}
      return step==='browserReadiness'?{}:true;
    }};
    const result=arm(shotgunView(),extra,c=>controller=c);
    await waiting;
    expect(controller.state.operation).toBe('confirming');
    await controller.armFullBooking();
    await controller.abortAutomation();await controller.abortAutomation();
    const stoppedHeadline=controller.state.headline;
    resolve(true as never);
    const {calls,attestations}=await result;
    await new Promise(done=>setImmediate(done));
    expect(calls).toEqual([]);expect(attestations).toEqual([]);
    expect(controller.state.operation).toBe('idle');
    expect(controller.state.headline).toBe(stoppedHeadline);
  });
  it('a rejected confirmation releases arming ownership for deliberately reauthorized work', async()=>{
    let first=true;
    const view=shotgunView();
    const {controller,calls}=await arm(view,{confirm:async()=>{if(first){first=false;throw Error('fixture rejection');}return true;},confirmShotgunLive:async()=>true});
    expect(calls).toEqual([]);expect(controller.state.operation).toBe('idle');
    const previous=process.env.THIRSTY_API_INSTALLATION;process.env.THIRSTY_API_INSTALLATION='1';
    try{controller.state.termsAuthorized=true;await controller.armFullBooking();}
    finally{if(previous===undefined)delete process.env.THIRSTY_API_INSTALLATION;else process.env.THIRSTY_API_INSTALLATION=previous;}
    expect(calls.filter(c=>typeof c==='object'&&c.kind==='apiRun')).toHaveLength(1);
  });
  it('fails closed without an explicit owner attestation for the exact plan', async () => {
    const { calls, controller } = await arm(shotgunView(), {});
    expect(calls.filter(c => typeof c === 'object' && c.kind === 'apiRun' && c.mode === 'live')).toEqual([]);
    expect(controller.state.headline).toBe('Live Shotgun not armed');
  });
  it('arms the Mango pilot with the attestation bound to the plan fingerprint and records it', async () => {
    const view = shotgunView();
    const { calls, attestations } = await arm(view, { confirmShotgunLive: async () => true });
    const live = calls.find(c => typeof c === 'object' && c.kind === 'apiRun' && c.mode === 'live') as Extract<Command, { kind: 'apiRun' }>;
    expect(live).toMatchObject({ fingerprint: view.fingerprint, shotgunAttestation: view.fingerprint });
    expect(attestations).toEqual([expect.objectContaining({ fingerprint: view.fingerprint, attempts: 6 })]);
  });
  it.each([
    ['no check has run', () => null, 'SECURITY_CHECK_REQUIRED'],
    ['a worker failed verification', (view: ReturnType<typeof shotgunView>) => passedCheck(view, 'FAILED'), 'SECURITY_CHECK_FAILED'],
    ['the check is over an hour old', (view: ReturnType<typeof shotgunView>) => passedCheck(view, 'READY', new Date(Date.now() - 61 * 60_000)), 'SECURITY_CHECK_REQUIRED'],
    ['the check was for another saved plan', (view: ReturnType<typeof shotgunView>) => ({ ...passedCheck(view), fingerprint: 'f'.repeat(64) }), 'SECURITY_CHECK_REQUIRED'],
  ] as const)('refuses live Shotgun before any confirmation when %s', async (_name, record, code) => {
    const view = shotgunView();
    let asked = false;
    const { calls, controller } = await arm(view, { securityCheck: () => record(view), confirm: async () => { asked = true; return true; }, confirmShotgunLive: async () => true });
    expect(calls.filter(c => typeof c === 'object' && c.kind === 'apiRun')).toEqual([]);
    expect(asked).toBe(false);
    expect(controller.state.attention).toMatchObject({ code, recovery: { action: 'CHECK_SECURITY' } });
    expect(controller.state.securityCheck?.status).not.toBe('PASSED');
  });
  it('includes a saved distinct-court objective in the authorization fingerprint only when present', () => {
    const plain = shotgunView(), quota = shotgunView({ ideal: 2 });
    expect(quota.fingerprint).not.toBe(plain.fingerprint);
    expect(shotgunView().fingerprint).toBe(plain.fingerprint);
    expect(() => shotgunView({ ideal: 3 })).toThrow(/needs 3 distinct immediate courts/);
  });
});
