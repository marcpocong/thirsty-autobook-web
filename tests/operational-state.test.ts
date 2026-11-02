import { expect, it } from 'vitest';
import type { Dashboard } from '../ui/types.js';
import type { PendingHoldRow } from '../src/api-booking/pending-hold-service.js';
import { operationalState, releaseCountdown, holdPresentation, attemptCounters, operatorEventText, presentedHolds,confirmedCourtHours } from '../ui/renderer/operational-state.js';
import {courtObjective} from '../ui/renderer/operator-status.js';

const state = (extra: Record<string, unknown> = {}) => ({ operation: 'idle', lock: false, ready: false, ...extra }) as Dashboard;
const release = { releaseMs: 100000, targetDate: '2026-11-04', phase: 'WAITING' as const };
it('never paints grid ownership or satisfies the court quota from a local hold-created response',()=>{
 const now=Date.now(),date='2026-11-04',s=state({booking:{targetDate:date,setup:{}},qrHandoffs:[{status:'hold-created',checkout:'A',wing:'MANGO',courts:[7],date,startTime:'19:00',endTime:'22:00',amount:2100,verifiedAt:new Date(now).toISOString(),holdExpiresAt:new Date(now+60000).toISOString()}],live:{parents:[{court:7,children:[{state:'HOLD_VERIFIED_QR_ATTENTION'}]}]}});
 expect([...confirmedCourtHours(s,[],date,now)]).toEqual([]);expect(courtObjective(s,[],now)).toMatchObject({held:[],met:false});
 const row={id:'a'.repeat(64),worker:'A',wing:'MANGO',courts:[7],date,start:'19:00',end:'22:00',amount:2100,advertisedExpiry:new Date(now+60000).toISOString(),local:'LOCAL_RESPONSE_VALID',provider:'PROVIDER_HOLD_CONFIRMED',qr:'NOT_CHECKED',outstanding:true,freshConfirmationRequired:false,lastCheckedAt:new Date(now).toISOString(),diagnostic:'PROVIDER_HOLD_CONFIRMED',contradiction:false} as PendingHoldRow;
 expect([...confirmedCourtHours(s,[row],date,now)]).toEqual(['7/19:00','7/20:00','7/21:00']);expect(courtObjective(s,[row],now).met).toBe(true);
 expect([...confirmedCourtHours(s,[{...row,provider:'UNKNOWN',contradiction:true}],date,now)]).toEqual([]);
 expect(courtObjective(s,[row],now+31000).met).toBe(false);expect([...confirmedCourtHours(s,[row],'2026-11-05',now)]).toEqual([]);
});
it('preserves the saved candidate date instead of substituting the next publishable date',()=>{
  const s=state({booking:{targetDate:'2026-11-04',setup:{}},planDate:{status:'STALE',planDate:'2026-11-03',targetDate:'2026-11-04'}});
  expect(operationalState(s).targetDate).toBe('2026-11-03');
  expect(operationalState({...s,activeApiRelease:release}).targetDate).toBe('2026-11-04');
  s.planDate={status:'MIXED',planDate:null,targetDate:'2026-11-04',detail:'Mixed'};
  expect(operationalState(s).targetDate).toBe('Multiple saved dates · review Setup');
});
it.each([
  [{}, 'IDLE'], [{ lock: true }, 'SAFETY LOCK'], [{ ready: true }, 'PREPARED'],
  [{ ready: true, planDate: { status: 'STALE' } }, 'IDLE'],
  [{ operation: 'scheduled', activeApiRelease: release, lock: true }, 'ARMED'],
  [{ scheduledRelease: { ...release, requiredBrowsers: ['B'], configFingerprint: 'frozen' } }, 'ARMED'],
  [{ operation: 'full', activeApiRelease: { ...release, phase: 'PREPARING' } }, 'SECURITY PREPARATION'],
  [{ operation: 'full', activeApiRelease: { ...release, phase: 'RUNNING' } }, 'DISPATCHING'],
  [{ operation: 'full', activeApiRelease: { ...release, phase: 'FAILED' } }, 'NEEDS ATTENTION'],
  [{ operation: 'stopping' }, 'STOPPING'], [{ runSummary: { settled: true, planned: 3, unknown: 1 } }, 'NEEDS ATTENTION'],
  [{ runSummary: { settled: true, planned: 3, unknown: 0 } }, 'COMPLETED'],
  [{ operation: 'prepare' }, 'PREPARING'], [{ scheduleStatus: 'MISSED' }, 'RELEASE MISSED'],
])('selects authoritative state %j → %s', (extra, expected) => expect(operationalState(state(extra)).label).toBe(expected));
it('keeps sent, unknown, rejected and definitively unsent separate', () => {
  const s = state({ operation: 'full', live: { parents: [{ children: ['ARMED', 'IN_FLIGHT', 'UNKNOWN', 'REJECTED', 'NOT_DISPATCHED', 'FAILED'].map(state => ({ state })) }] } });
  expect(operationalState(s).label).toBe('DISPATCHING');
  expect(attemptCounters(s)).toEqual({ planned: 6, armed: 1, inFlight: 1, unknown: 1, rejected: 1, unsent: 1, failed: 1 });
  s.live!.parents[0]!.children.shift(); expect(operationalState(s).label).toBe('WAITING FOR PROVIDER');
});
it('uses only the controller clock sample and bounded monotonic interpolation', () => {
  const s = state({ activeApiRelease: release, clock: { networkSynced: true, releaseMs: 100000, remainingMs: 8500 } });
  expect(releaseCountdown(s, 500)).toBe('Release in 00:08');
  expect(releaseCountdown(s, 5001)).toContain('fresh sample');
  s.clock!.networkSynced = false; expect(releaseCountdown(s)).toContain('unavailable');
  s.clock!.networkSynced = true; s.clock!.remainingMs = 0; expect(releaseCountdown(s)).toContain('fresh clock');
});
it('requires fresh provider evidence, QR evidence and a future deadline independently', () => {
  const row = { provider: 'PROVIDER_HOLD_CONFIRMED', qr: 'QR_READY', freshConfirmationRequired: false, lastCheckedAt: new Date(0).toISOString(), advertisedExpiry: new Date(10000).toISOString() } as PendingHoldRow;
  expect(holdPresentation(row, 1000)).toMatchObject({ confirmed: true, qrReady: true, label: 'QR READY' });
  expect(holdPresentation({ ...row, provider: 'UNKNOWN' }, 1000).confirmed).toBe(false);
  expect(holdPresentation({ ...row, freshConfirmationRequired: true }, 1000).confirmed).toBe(false);
  expect(holdPresentation({ ...row, qr: 'NOT_CHECKED' }, 1000)).toMatchObject({ confirmed: true, qrReady: false });
  expect(holdPresentation(row, 10000)).toMatchObject({ confirmed: false, qrReady: false, label: 'FRESH CONFIRMATION REQUIRED' });
});
it('does not reuse the previous finished run as an active release',()=>{
  const s=state({activeApiRelease:release,runTiming:{endedAt:'2026-11-01T00:00:00Z'},live:{parents:[{children:[{state:'IN_FLIGHT'}]}]}});
  expect(operationalState(s).label).toBe('ARMED');
  expect(operationalState(state({ready:true,planDate:{status:'FUTURE'}})).label).toBe('IDLE');
});
it('excludes profile contact values and checkout capabilities from the primary timeline',()=>{
  const s=state({playerStatus:{primaryDetails:{fullName:'Synthetic Customer',phone:'09123456789',email:'fixture@example.invalid'}}});
  const message=operatorEventText('Synthetic Customer 09123456789 fixture@example.invalid token=private-cookie bookingId=private-id https://onda.invalid/?capability=secret · Booking BK-123 · ID 12345678-abcd-1234-abcd-123456789abc',s);
  expect(message).not.toMatch(/Synthetic Customer|09123456789|fixture@|private-cookie|private-id|capability=secret|BK-123|12345678-abcd/);
});
it('accepts only explicit fresh current-run official QR handoffs and preserves contradictory provider evidence',()=>{
  const now=Date.now(),at=new Date(now-1000).toISOString();
  const h={status:'qr-ready',checkout:'A',wing:'MANGO',courts:[7],date:'2026-11-04',startTime:'19:00',endTime:'20:00',amount:700,verifiedAt:at,holdExpiresAt:new Date(now+60000).toISOString()};
  const s=state({runTiming:{startedAt:new Date(now-2000).toISOString()},apiStage:{runId:'fixture'},qrHandoffs:[h]});
  expect(presentedHolds(s,[],now)).toHaveLength(1);expect(operationalState(s,[],now).label).toBe('QR READY');
  expect(presentedHolds(s,[],now+31_000)).toEqual([expect.objectContaining({provider:'UNKNOWN',freshConfirmationRequired:true,outstanding:true})]);
  expect(presentedHolds(state({...s,qrHandoffs:[{...h,status:'hold-created'}]}),[],now)).toHaveLength(0);
  expect(presentedHolds(state({...s,apiStage:null}),[],now)).toHaveLength(0);
  expect(presentedHolds(state({...s,runTiming:{startedAt:new Date(now).toISOString()}}),[],now)).toHaveLength(0);
  const row={...presentedHolds(s,[],now)[0]!,id:'saved',provider:'UNKNOWN',qr:'NOT_CHECKED',lastCheckedAt:new Date(now).toISOString(),freshConfirmationRequired:true} as PendingHoldRow;
  expect(presentedHolds(s,[row],now)[0]!.provider).toBe('UNKNOWN');
  expect(presentedHolds(s,[{...row,provider:'EXPIRED_OR_UNAVAILABLE'}],now)[0]!.provider).toBe('EXPIRED_OR_UNAVAILABLE');
});
it('uses the Available Now request instead of the unrelated saved release date and workers',()=>{
  const s=state({operation:'full',workflow:'test',booking:{targetDate:'2026-11-04',fingerprint:'saved',setup:{PRECISION_PHASE3:{wave1:[{workerId:'A',fanOutOffsetsMs:[-100,0]}]}}},preparedContext:{workflow:'test',date:'2026-11-03',configFingerprint:'prepared-test',requiredBrowsers:['C']},apiStage:{date:'2026-11-03',workerId:'C',wing:'BUKO',court:4}});
  expect(operationalState(s)).toMatchObject({availableNow:true,targetDate:'2026-11-03',fingerprint:'prepared-test',workers:['C']});
  expect(attemptCounters(s).planned).toBe(0);
  s.runTiming={startedAt:'2026-11-02T00:00:00Z'} as Dashboard['runTiming'];
  s.apiStage={...s.apiStage!,date:'2026-01-01',workerId:'B',at:'2026-01-01T00:00:00Z'};
  expect(operationalState(s)).toMatchObject({targetDate:'2026-11-03',workers:['C'],currentTarget:null});
});
