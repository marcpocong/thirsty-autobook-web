import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { armPrecisionRace, dispatchArmedPrecisionRace } from '../../src/api-booking/armed-dispatch.js';
import { BrowserSessionTransportError } from '../../src/api-booking/browser-session-transport.js';
import { consumeSubmissionPermit, DurableSubmissionJournal, isSubmissionPermitUnspent } from '../../src/api-booking/durable-submission-journal.js';
import { freezePrecisionRace, precisionTargetPlan, validatePrecisionTargets, type PrecisionTarget } from '../../src/api-booking/precision-race.js';
import type { DirectTransport, ProoflessCheckoutRequest } from '../../src/api-booking/proofless-checkout.js';
import type { TierStatus } from '../../src/api-booking/prewarm-scheduler.js';
import { dispatchWithCoordinators, startCoordinatorPool } from '../../src/api-booking/dispatch-coordinator.js';
import { CriticalPathRecorder } from '../../src/api-booking/critical-path.js';
import { TrustedReleaseClock } from '../../src/release-clock.js';

const date = '2026-09-26';
const customer = { clientId: '00000000-0000-4000-8000-00000000c11e', customerId: '00000000-0000-4000-8000-000000000b00',
  customerEmail: 'fixture@example.invalid', customerPhone: '09123456789', customerFirstName: 'Fixture', customerLastName: 'Player' };
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'fanout-dispatch-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); delete process.env.FAKE_COORDINATOR_MODE; });
const requestKey = (request: ProoflessCheckoutRequest) => DurableSubmissionJournal.key(request.facilityId, request.items[0]!.spaceId,
  request.items[0]!.date, request.items[0]!.startTime, request.items.at(-1)!.endTime);
const conflict = () => Promise.reject(new BrowserSessionTransportError('ONDA_HTTP_STATUS_INVALID', true,
  { status: 409, category: 'http-rejection', contentKind: 'json', responseSource: 'application', errorHint: 'availability' }, true));

/** `workers` targets, each fanned out into `width` children at the given offsets (index order). */
async function armChildren(workers: number, offsets: number[], leadMs: number) {
  const releaseMs = Date.now() + leadMs;
  const targets = validatePrecisionTargets(Array.from({ length: workers }, (_, index) => ({ court: 7 - index, start: '17:00', durationHours: 3 })), date);
  const attempts = targets.flatMap(target => offsets.map(offset => { const child: PrecisionTarget = { ...target, ...(offset ? { releaseOffsetMs: offset } : {}) };
    return { target: child, plan: precisionTargetPlan(child, date) }; }));
  const race = freezePrecisionRace(date, releaseMs, attempts);
  const clock = TrustedReleaseClock.fromOffset(0, { method: 'test', sampleCount: 5 });
  const armed = await armPrecisionRace(race, { customerFor: () => customer, journalRoot: root, releaseMs, now: () => clock.nowMs() });
  return { armed, race, clock, releaseMs };
}

describe('priority-aware prewarm in the armed dispatcher', () => {
  it('fires Tier 1 on time and omits lower-tier children that were not ready, never sending them late', async () => {
    const { armed, clock, releaseMs } = await armChildren(2, [0, 0, 0], 1_600);
    const calls: Array<{ key: string; at: number }> = [];
    const transport: DirectTransport = { publicCheckoutProofless: async (request, permit, options) => {
      consumeSubmissionPermit(permit, requestKey(request)); options?.beforePost?.(); calls.push({ key: requestKey(request), at: clock.nowMs() - releaseMs }); return conflict(); } };
    const statuses: TierStatus[][] = [];
    const prepared: string[] = [];
    const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 1_200, spinTailMs: 20, isAborted: () => false,
      prewarmPolicy: { concurrency: 2, perGroupConcurrency: 1, tierBarrierTimeoutMs: Infinity }, prewarmStopStartingLeadMs: 1_000,
      onPrewarmStatus: status => statuses.push(status),
      transportFor: () => transport,
      // Tier 1 (index 0) prepares in 30 ms; Tier 2 in 100 ms; Tier 3 never finishes in time (a stuck redundant child).
      prewarm: async attempt => { prepared.push(`${attempt.target.workerId}${attempt.attempt.fanOutIndex}`);
        await new Promise(done => setTimeout(done, attempt.attempt.fanOutIndex === 0 ? 30 : attempt.attempt.fanOutIndex === 1 ? 100 : 60_000)); } });
    const byIndex = (index: number) => outcome.results.filter(result => result.attempt.fanOutIndex === index);
    expect(byIndex(0).map(result => result.state)).toEqual(['REJECTED', 'REJECTED']);
    expect(byIndex(1).map(result => result.state)).toEqual(['REJECTED', 'REJECTED']);
    expect(byIndex(2).map(result => [result.state, result.code])).toEqual([['NOT_DISPATCHED', 'PREWARM_TIER_OMITTED'], ['NOT_DISPATCHED', 'PREWARM_TIER_OMITTED']]);
    // Tier 1 was prepared first and nothing late was sent: every send left at the trigger, none after the window.
    expect(prepared.slice(0, 2)).toEqual(['A0', 'B0']);
    expect(calls).toHaveLength(4);
    expect(Math.max(...calls.map(call => call.at))).toBeLessThan(100);
    // The omitted children are durably recorded as provably unsent (journal 'rejected' with their code).
    for (const result of byIndex(2)) {
      const attempt = armed.attempts.find(value => value.attempt.id === result.attempt.id)!;
      const record = await attempt.journal.read(attempt.key);
      expect(record.state).toBe('rejected');
      expect(isSubmissionPermitUnspent(attempt.permit)).toBe(false);
    }
    expect(statuses.at(-1)?.map(status => [status.tier, status.ready])).toEqual([[0, 2], [1, 2], [2, 0]]);
  });

  it('without a policy every attempt prepares at once and a late Tier-1 child keeps its dispatch window (unchanged behavior)', async () => {
    const { armed, clock } = await armChildren(1, [0, 0], 900);
    const started: number[] = [];
    const transport: DirectTransport = { publicCheckoutProofless: async (request, permit) => { consumeSubmissionPermit(permit, requestKey(request)); return conflict(); } };
    const outcome = await dispatchArmedPrecisionRace(armed, { clock, prewarmLeadMs: 500, spinTailMs: 20, isAborted: () => false, transportFor: () => transport,
      prewarm: async attempt => { started.push(performance.now()); await new Promise(done => setTimeout(done, attempt.attempt.fanOutIndex === 1 ? 700 : 5)); } });
    expect(Math.max(...started) - Math.min(...started)).toBeLessThan(50);
    // The second child was ready ~200 ms after release: without a tier policy it still fires inside the one-second window.
    expect(outcome.results.map(result => result.state)).toEqual(['REJECTED', 'REJECTED']);
  });
});

describe('Shotgun same-target stop conditions',()=>{
  const run=async(mode:'unknown'|'rejected'|'throttle'|'hold')=>{
    const {armed,clock}=await armChildren(1,[-500,-100],1_200);let calls=0;
    const transport:DirectTransport={publicCheckoutProofless:async(request,permit,options)=>{calls++;consumeSubmissionPermit(permit,requestKey(request));options?.beforePost?.();
      if(mode==='unknown')throw Error('network outcome unavailable');
      if(mode==='throttle')throw new BrowserSessionTransportError('ONDA_HTTP_STATUS_INVALID',true,{status:429,category:'http-rejection',contentKind:'json',responseSource:'application',errorHint:'rate-limit'},true);
      if(mode==='hold'){const ids=request.items.map((_,index)=>`booking-${index}`),holdExpiresAt=new Date(Date.now()+600_000).toISOString();return {success:true,bookings:request.items.map((item,index)=>({id:ids[index],booking_no:`number-${index}`,customer_id:request.customerId,
        space_id:item.spaceId,facility_id:item.facilityId,date:item.date,start_time:`${item.startTime}:00`,end_time:`${item.endTime}:00`,duration:60,rate:item.rate,guest_count:1,
        booking_status:'pending',payment_status:'pending',booking_session_id:'session',hold_expires_at:holdExpiresAt})),bookingSessions:[{requestSessionRef:'session_1',bookingSessionId:'session',facilityId:request.facilityId,
        spaceId:request.items[0]!.spaceId,date,startTime:'17:00:00',endTime:'20:00:00',durationHours:3,bookingIds:ids}],transaction:{id:'transaction',reference:'number-0',amount:2100,status:'pending'},trustedTotalAmount:2100};}
      return conflict();}};
    const outcome=await dispatchArmedPrecisionRace(armed,{clock,prewarmLeadMs:500,spinTailMs:20,isAborted:()=>false,transportFor:()=>transport,prewarm:async()=>undefined,
      ...(mode==='hold'?{onVerifiedHold:async()=>({state:'QR_READY' as const})}:{})});
    return {outcome,calls};
  };
  it('UNKNOWN suppresses a later same-target child as provably unsent',async()=>{
    const {outcome,calls}=await run('unknown');expect(calls).toBe(1);
    expect(outcome.results.map(value=>[value.state,value.code])).toEqual([['UNKNOWN','SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED'],['NOT_DISPATCHED','SHOTGUN_TARGET_OUTCOME_UNKNOWN']]);
  });
  it('a confirmed rejection permits the later child',async()=>{const {outcome,calls}=await run('rejected');expect(calls).toBe(2);expect(outcome.results.map(value=>value.state)).toEqual(['REJECTED','REJECTED']);});
  it('keeps the schedule time-driven while an earlier response remains in flight',async()=>{const {armed,clock,releaseMs}=await armChildren(1,[-200,-150],900);const starts:number[]=[];
    const transport:DirectTransport={publicCheckoutProofless:async(request,permit,options)=>{consumeSubmissionPermit(permit,requestKey(request));options?.beforePost?.();starts.push(clock.nowMs()-releaseMs);
      await new Promise(done=>setTimeout(done,250));return conflict();}};
    const outcome=await dispatchArmedPrecisionRace(armed,{clock,prewarmLeadMs:500,spinTailMs:20,isAborted:()=>false,transportFor:()=>transport,prewarm:async()=>undefined});
    expect(starts).toHaveLength(2);expect(starts[0]).toBeLessThan(-150);expect(starts[1]).toBeLessThan(0);expect(starts[1]!-starts[0]!).toBeLessThan(150);
    expect(outcome.results.map(value=>value.state)).toEqual(['REJECTED','REJECTED']);});
  it('HTTP 429 stops later redundant children instead of increasing traffic',async()=>{
    const {outcome,calls}=await run('throttle');expect(calls).toBe(1);
    expect(outcome.results.map(value=>[value.state,value.code])).toEqual([['REJECTED','SHOTGUN_PROVIDER_THROTTLE_STOP'],['NOT_DISPATCHED','SHOTGUN_PROVIDER_THROTTLE_STOP']]);
  });
  it('a verified hold suppresses later same-target children',async()=>{const {outcome,calls}=await run('hold');expect(calls).toBe(1);
    expect(outcome.results.map(value=>[value.state,value.code])).toEqual([['QR_READY',undefined],['NOT_DISPATCHED','SHOTGUN_TARGET_ALREADY_ACHIEVED']]);});
  it('dispatches and tracks the authoritative sixth child',async()=>{const {armed,clock}=await armChildren(1,[-100,-80,-60,-40,-20,0],900);let calls=0;
    const transport:DirectTransport={publicCheckoutProofless:async(request,permit,options)=>{calls++;consumeSubmissionPermit(permit,requestKey(request));options?.beforePost?.();return conflict();}};
    const outcome=await dispatchArmedPrecisionRace(armed,{clock,prewarmLeadMs:500,spinTailMs:20,isAborted:()=>false,transportFor:()=>transport,prewarm:async()=>undefined});
    expect(calls).toBe(6);expect(outcome.results.at(-1)?.attempt).toMatchObject({fanOutIndex:5,fanOutCount:6});});
});

describe('experimental per-browser coordinators: safety semantics (fake coordinator process)', () => {
  const fake = resolve('tests/fixtures/fake-coordinator-child.mjs');
  const run = async (mode: string) => {
    process.env.FAKE_COORDINATOR_MODE = mode;
    const { armed, clock } = await armChildren(2, [0, -10], 3_000);
    const pool = await startCoordinatorPool(['A', 'B'].map(workerId => ({ workerId, cdpUrl: 'http://127.0.0.1:1', pageUrl: 'about:blank', pageCount: 2 })),
      { security: { kind: 'synthetic', cpuMs: 0, waitMs: 0 }, captureResponses: false, childEntry: fake, initTimeoutMs: 5_000 });
    const recorder = new CriticalPathRecorder(armed.releaseMs, clock.monotonicDeadline(armed.releaseMs), 0);
    try {
      const outcome = await dispatchWithCoordinators(armed, { clock, prewarmLeadMs: 1_000, isAborted: () => false, pool, recorder });
      return { armed, outcome, pool };
    } finally { await pool.close(); }
  };

  it('delegation spends the parent permit, and a confirmed 409 from a coordinator is REJECTED in the durable journal', async () => {
    const { armed, outcome } = await run('conflict');
    expect(outcome.results.map(result => result.state)).toEqual(['REJECTED', 'REJECTED', 'REJECTED', 'REJECTED']);
    for (const attempt of armed.attempts) {
      expect(attempt.state).toBe('fired');
      expect(isSubmissionPermitUnspent(attempt.permit)).toBe(false);
      expect((await attempt.journal.read(attempt.key)).state).toBe('rejected');
    }
    for (const guard of armed.fanOutGuards) expect((await guard.journal.read(guard.key)).state).toBe('rejected');
  });

  it("only the coordinator's own report can prove an attempt unsent", async () => {
    const { armed, outcome } = await run('unsent');
    expect(outcome.results.map(result => [result.state, result.code])).toEqual(Array(4).fill(['WINDOW_MISSED', 'DIRECT_RELEASE_WINDOW_MISSED']));
    for (const attempt of armed.attempts) expect((await attempt.journal.read(attempt.key)).state).toBe('rejected');
  });

  it('a coordinator that dies after delegation leaves every delegated attempt UNKNOWN (never retried, never "unsent")', async () => {
    const { armed, outcome } = await run('crash');
    expect(outcome.results.map(result => result.state)).toEqual(['UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
    for (const attempt of armed.attempts) expect((await attempt.journal.read(attempt.key)).state).toBe('unknown');
    for (const guard of armed.fanOutGuards) expect((await guard.journal.read(guard.key)).state).toBe('unknown');
  });

  it('a coordinator that never became ready is not used: its attempts stay with the parent and are disarmed as provably unsent', async () => {
    const { armed, outcome } = await run('init-fail');
    expect(outcome.results.map(result => [result.state, result.code])).toEqual(Array(4).fill(['NOT_DISPATCHED', 'COORDINATOR_UNAVAILABLE']));
    for (const attempt of armed.attempts) {
      expect(attempt.state).toBe('disarmed');
      expect((await attempt.journal.read(attempt.key)).state).toBe('rejected');
    }
  });
});
