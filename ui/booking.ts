import { writeFileSync, renameSync } from 'node:fs';
import { playerReadiness, BookingSetupSchema, loadConfigWithReconciliation, calculateTarget, planFingerprint, type BookingSetup, type Config } from '../src/config.js';
import type {FallbackReconciliation} from '../src/booking-setup.js';
import { candidatePlans, describeBookingPlan } from '../src/booking-plan.js';
import { PRECISION_WORKER_IDS } from '../src/workers.js';
import { authorizePrecision, precisionCandidateId } from '../src/api-booking/precision-phase3.js';
import { describeSmartPlan, smartPlanText } from '../src/precision-simple.js';
import { formatReleaseOffset } from '../src/release-offset.js';
export const defaultSetup: BookingSetup = { BOOKING_METHOD:'browser', BOOKING_TYPE:'standard', RELEASE_STRATEGY:'general', PRECISION_TARGETS:[], RELEASE_OFFSET_MS:0, COURT_COUNT:1, START_TIME: '08:00', DURATION_HOURS: 2, PREFERRED_COURTS: [7,6,5,4,3,2,1], FALLBACK_COURTS: [], FALLBACK_TIMES: [], MAX_SELECTION_ATTEMPTS: 3 };
export function bookingView(c: Config, fallbackReconciliation:FallbackReconciliation={valid:c.FALLBACK_TIMES,removed:[]}) {
  const target = calculateTarget(c);
  const setup = BookingSetupSchema.parse({ BOOKING_METHOD:c.BOOKING_METHOD, BOOKING_TYPE:c.BOOKING_TYPE, RELEASE_STRATEGY:c.RELEASE_STRATEGY, PRECISION_TARGETS:c.PRECISION_TARGETS,
    ...(c.PRECISION_PHASE3?{PRECISION_PHASE3:c.PRECISION_PHASE3}:{}), RELEASE_OFFSET_MS:c.RELEASE_OFFSET_MS, COURT_COUNT:c.COURT_COUNT, START_TIME:c.START_TIME, DURATION_HOURS:c.DURATION_HOURS, PREFERRED_COURTS:[...c.PREFERRED_COURTS,...c.FALLBACK_COURTS], FALLBACK_COURTS:[], FALLBACK_TIMES:c.FALLBACK_TIMES, MAX_SELECTION_ATTEMPTS:c.MAX_SELECTION_ATTEMPTS });
  const players=playerReadiness(c);
  return { setup, fallbackReconciliation, targetDate:target.targetDate, releaseMs:target.releaseMs, preferences:target.preferences, playerConfigured:players.primary, extendedPlayerConfigured:players.extended,thirdPlayerConfigured:players.third,fourthPlayerConfigured:players.fourth,fifthPlayerConfigured:players.fifth,sixthPlayerConfigured:players.sixth,seventhPlayerConfigured:players.seventh,eighthPlayerConfigured:players.eighth,fingerprint:planFingerprint(c),
    slots:target.preferences[0]!.hours.map(h => `${h}–${String(Number(h.slice(0,2))+1).padStart(2,'0')}:00`) };
}
export type BookingView = ReturnType<typeof bookingView>;
export function readBooking(): BookingView { const loaded=loadConfigWithReconciliation();return bookingView(loaded.config,loaded.fallbackReconciliation); }
export function saveBooking(input: unknown) {
  const setup = BookingSetupSchema.parse(input);
  writeFileSync('config.local.json.tmp', JSON.stringify(setup, null, 2) + '\n');
  renameSync('config.local.json.tmp', 'config.local.json');
  return readBooking();
}
const releaseOffsetLine=(s:BookingSetup)=>s.RELEASE_OFFSET_MS
  ?`\nRelease offset: ${formatReleaseOffset(s.RELEASE_OFFSET_MS)} · checkout may be sent up to ${-s.RELEASE_OFFSET_MS} ms before the official release time.`:'';
export function describePlan(plan: BookingView) {
  const s=plan.setup;
  if(s.RELEASE_STRATEGY==='precision')return describePrecisionPlan(plan)+releaseOffsetLine(s);
  const plans=candidatePlans({strategy:s.BOOKING_TYPE,date:plan.targetDate,start:s.START_TIME,duration:s.DURATION_HOURS,courtCount:s.COURT_COUNT,priority:s.PREFERRED_COURTS,fallbackStarts:s.FALLBACK_TIMES});
  const method=s.BOOKING_METHOD==='browser'?'Normal Browser':s.BOOKING_METHOD==='hybrid'?'Hybrid Availability':s.BOOKING_METHOD==='proofless'?'Proofless Direct':'API-First';
  return describeBookingPlan(plans[0]!,Infinity)+`\nBooking method: ${method}\nCourt priority: ${s.PREFERRED_COURTS.join(' → ')}\nFallback starts move the whole block: ${s.FALLBACK_TIMES.join(', ')||'None'}\nValid splits: ${plans.filter(p=>p.requestedStart===s.START_TIME).map(p=>p.chunks.map(c=>c.duration).join('+')).join(' → ')}\nSame courts are prioritized across checkouts when available.\nPlayer information: Configured`+releaseOffsetLine(s);
}

/** Arming text for Precision Release: every exact target, and what the operator is authorizing. */
export function describePrecisionPlan(plan: BookingView) {
  if(plan.setup.PRECISION_PHASE3){
    const draft=plan.setup.PRECISION_PHASE3;
    const auth=authorizePrecision({date:plan.targetDate,releaseMs:plan.releaseMs,candidates:draft.candidates,
      wave1:draft.wave1.map(value=>({workerId:value.workerId,candidateId:precisionCandidateId(plan.targetDate,draft.candidates[value.candidateIndex]!)})),
      standby:draft.standby,budgets:draft.budgets,concurrentWave2:draft.concurrentWave2,
      rescueEnabled:draft.rescueEnabled,authorizedAt:new Date().toISOString()});
    const byId=new Map(auth.candidates.map(value=>[value.id,value]));
    return ['PRECISION RELEASE · SMART BACKUPS · GOAL: 1 VERIFIED HOLD',`Target date: ${plan.targetDate} · Proofless Direct · Standard`,'',
      smartPlanText(describeSmartPlan(draft)),'','Exact authorization:',...auth.wave1.map(value=>{const c=byId.get(value.candidateId)!;
        return `Immediate · Worker ${value.workerId} → Court ${c.court} ${c.start}–${c.end} · PHP ${c.expectedAmount} · ${c.rateEvidence.status} (${c.rateEvidence.source}, ${c.rateEvidence.capturedAt})`;}),
      `Backup workers: ${auth.standby.length?auth.standby.map(value=>`Worker ${value}`).join(', '):'none'} (no slot assigned until fresh availability confirms one)`,
      `Backup choices: ${auth.candidates.filter(value=>value.permissions.wave2).length} · max ${auth.budgets.wave2} backup sends · used while immediate attempts are pending: ${auth.concurrentWave2?'YES':'NO'}.`,
      `Try reopened slots: ${auth.rescueEnabled?'ON':'OFF'} · max ${auth.budgets.rescue} sends. Maximum total sends: ${auth.budgets.total}.`,
      ...(auth.warning?[auth.warning]:[]),
      'More than one temporary hold may be created. Payment remains manual. UNKNOWN stops all later dispatch. No automatic cancellation.',
      'Backup and reopened-slot sends require fresh published, complete, uncached OPEN cells and current hourly prices.'].join('\n');
  }
  const targets=plan.setup.PRECISION_TARGETS;
  const end=(start:string,hours:number)=>`${String(Number(start.slice(0,2))+hours).padStart(2,'0')}:00`;
  const price=(start:string,hours:number)=>Array.from({length:hours},(_,i)=>Number(start.slice(0,2))+i>=16?700:600).reduce((a,b)=>a+b,0);
  const rows=targets.map((t,i)=>`Worker ${PRECISION_WORKER_IDS[i]} | Court ${t.court} | ${t.start}–${end(t.start,t.durationHours)} | ${t.durationHours} h | ~PHP ${price(t.start,t.durationHours)} (assumed rate)`+
    (t.releaseOffsetMs?` | Offset ${formatReleaseOffset(t.releaseOffsetMs)}: sent up to ${-t.releaseOffsetMs} ms before the official release time`:' | Normal'));
  return ['PRECISION RELEASE · GOAL: 1 SUCCESSFUL COURT',`Target date: ${plan.targetDate} · Proofless Direct · Standard`,'',...rows,'',
    `${targets.length} independent checkout attempt${targets.length===1?' is':'s are'} authorized: each is one court, one exact time, one player/browser.`,
    'These are independent checkout attempts. More than one temporary QR hold may be created. Payment remains manual.',
    'Evidence is read at T-60, T-30, T-10 and T-2 min. The set is frozen 2 minutes before release: a target showing a public booking or unknown evidence at that moment is excluded. No target is ever added, moved or substituted.',
    'The date is not published before 08:00, so no target is confirmed open. Nothing is cancelled automatically; each unpaid hold expires on its own.'].join('\n');
}
