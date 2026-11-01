import type { Dashboard } from '../types.js';
import type { PendingHoldRow } from '../../src/api-booking/pending-hold-service.js';
import { planWorkerIds } from '../../src/workers.js';
import { UNSENT_STATES } from '../../src/run-outcome.js';
import { planDateArmable } from '../../src/release-plan-date.js';

/** Presentation only. No bridge, storage, provider or scheduling side effects. */
export function operationalState(s: Dashboard, holds: readonly PendingHoldRow[] = [], now = Date.now()) {
  const release = s.scheduledRelease ?? s.activeApiRelease;
  const children = s.runTiming?.endedAt && release ? [] : s.live?.parents.flatMap(p => p.children) ?? [];
  const running = ['full', 'selection', 'practice', 'fullPractice'].includes(s.operation);
  const active = !!release || running;
  let label = 'IDLE', detail = 'Nothing currently running.', tone = 'muted';
  if (s.operation === 'stopping') { label = 'STOPPING'; detail = 'Future attempts are stopping. Dispatched requests cannot be retracted.'; tone = 'warn'; }
  else if (active) {
    tone = 'running';
    if (children.some(c => ['IN_FLIGHT', 'RESERVED'].includes(c.state))) {
      label = children.some(c => c.state === 'ARMED') ? 'DISPATCHING' : 'WAITING FOR PROVIDER'; detail = 'Requests initiated. Waiting for authoritative provider results.';
    } else if (s.activeApiRelease?.phase === 'FAILED') { label = 'NEEDS ATTENTION'; detail = s.attention?.detail ?? 'The release reported a failure. Review its evidence.'; tone = 'warn'; }
    else if (s.activeApiRelease?.phase === 'PREPARING' || children.some(c => c.state === 'PREPARING')) { label = 'SECURITY PREPARATION'; detail = 'Preparing the authorized browser contexts.'; }
    else if (s.activeApiRelease?.phase === 'RUNNING' || s.scheduleStatus === 'RUNNING' || running && !release) { label = 'DISPATCHING'; detail = 'Operation active. Attempt results appear below.'; }
    else { label = 'ARMED'; detail = 'Waiting for the authorized release. Keep the PC awake and the saved plan unchanged.'; }
  } else if (['prepare', 'resetting', 'checkingSecurity', 'confirming'].includes(s.operation)) { label = 'PREPARING'; detail = s.detail; tone = 'running'; }
  else if (s.attention || s.runSummary?.unknown || children.some(c => c.state === 'UNKNOWN')) { label = 'NEEDS ATTENTION'; detail = s.attention?.detail ?? 'A previous outcome remains UNKNOWN. Review before any retry.'; tone = 'warn'; }
  else if (s.scheduleStatus === 'MISSED') { label = 'RELEASE MISSED'; detail = 'The release window was missed. Review Activity.'; tone = 'warn'; }
  else if (s.lock) { label = 'SAFETY LOCK'; detail = s.retainedLockStage === 'HOLD_VERIFIED' ? 'A retained hold lock protects the original target. Review existing checkout evidence.' : 'Retained submission evidence blocks booking actions. This does not mean a release is armed.'; tone = 'warn'; }
  else if (s.runSummary?.settled && s.runSummary.planned) { label = 'COMPLETED'; detail = s.runSummary.nextStep; }
  else if (s.ready && planDateArmable(s.planDate) && (!s.preparedPlanFingerprint || s.preparedPlanFingerprint===s.booking?.fingerprint)) { label = 'PREPARED'; detail = 'Review readiness and authorize the exact saved plan before arming.'; tone = 'ok'; }
  else if (s.booking) { label = 'SAVED'; detail = 'Continue Booking Setup to review and prepare the saved plan.'; }
  const confirmed=presentedHolds(s,holds,now).filter(row=>holdPresentation(row,now).confirmed);
  if(s.operation==='idle'&&confirmed.length) {label=confirmed.some(row=>holdPresentation(row,now).qrReady)?'QR READY':'HOLD CONFIRMED';detail='Existing reservation confirmed. Review its expiry and complete payment manually in its original browser.';tone='ok';}
  return { label, detail, tone, active, releaseMs: release?.releaseMs, targetDate: release?.targetDate ?? s.booking?.targetDate,
    fingerprint: s.scheduledRelease?.configFingerprint ?? s.booking?.fingerprint,
    workers: s.scheduledRelease?.requiredBrowsers ?? (s.booking ? planWorkerIds(s.booking.setup) : []) };
}

/** Advance only a controller-published network-clock sample using monotonic elapsed time. */
export function releaseCountdown(s: Dashboard, elapsedMs = 0): string {
  const releaseMs = s.scheduledRelease?.releaseMs ?? s.activeApiRelease?.releaseMs;
  if (!releaseMs) return 'No release armed';
  const clock = s.clock;
  if (!clock?.networkSynced || elapsedMs < 0 || elapsedMs > 5_000) return 'Trusted clock unavailable · waiting for fresh sample';
  const sampledNow = clock.releaseMs - clock.remainingMs;
  // A clamped zero sample no longer identifies "now" after the clock's release boundary.
  if (clock.remainingMs <= 0) return 'Release boundary · waiting for fresh clock';
  const remaining = releaseMs - sampledNow - elapsedMs;
  if (remaining <= 0) return 'Release window passed';
  const seconds = Math.ceil(remaining / 1000);
  return `Release in ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function holdPresentation(row: PendingHoldRow, now: number) {
  const remaining = row.advertisedExpiry ? Date.parse(row.advertisedExpiry) - now : NaN;
  const age = row.lastCheckedAt ? now - Date.parse(row.lastCheckedAt) : Infinity;
  const confirmed = row.provider === 'PROVIDER_HOLD_CONFIRMED' && !row.freshConfirmationRequired && age >= 0 && age <= 30_000 && remaining > 0;
  return { confirmed, qrReady: confirmed && row.qr === 'QR_READY', remaining,
    label: confirmed ? row.qr === 'QR_READY' ? 'QR READY' : 'HOLD CONFIRMED' : row.provider === 'EXPIRED_OR_UNAVAILABLE' ? 'EXPIRED / UNAVAILABLE' : 'FRESH CONFIRMATION REQUIRED' };
}

export type PresentedHold=PendingHoldRow&{currentHandoff?:boolean};
/** Explicit current API QR handoffs follow provider confirmation in desktop-runner. Never upgrade hold-created,
 * legacy missing-status handoffs, previous-process history or a newer contradictory provider observation. */
export function presentedHolds(s:Dashboard, rows:readonly PendingHoldRow[],now:number):PresentedHold[]{
  const result:PresentedHold[]=[...rows];
  if(!s.runTiming?.startedAt||!s.apiStage?.runId)return result;
  for(const [index,h] of (s.qrHandoffs??[]).entries()){
    const at=Date.parse(h.verifiedAt),age=now-at;
    if(h.status!=='qr-ready'||!h.checkout||!h.holdExpiresAt||Date.parse(h.holdExpiresAt)<=now||at<Date.parse(s.runTiming.startedAt)||age<0||age>30_000)continue;
    const sameTarget=result.filter(r=>!r.currentHandoff&&r.worker===h.checkout&&r.wing===(h.wing??'MANGO')&&r.date===h.date&&r.start===h.startTime&&r.end===h.endTime&&r.amount===h.amount&&JSON.stringify(r.courts)===JSON.stringify(h.courts));
    if(sameTarget.some(r=>['EXPIRED_OR_UNAVAILABLE','PAYMENT_CONFIRMED'].includes(r.provider)||r.contradiction||r.lastCheckedAt&&Date.parse(r.lastCheckedAt)>=at))continue;
    const id=`current-handoff-${index}`;if(result.some(r=>r.currentHandoff&&r.id===id))continue;
    // Different evidence sources cannot be joined by target alone. Keep separate, never upgrade a saved row.
    result.push({id,worker:h.checkout,wing:h.wing??'MANGO',courts:h.courts,date:h.date,start:h.startTime,end:h.endTime,amount:h.amount,advertisedExpiry:h.holdExpiresAt,
      local:'LOCAL_RESPONSE_VALID',provider:'PROVIDER_HOLD_CONFIRMED',qr:'QR_READY',outstanding:true,freshConfirmationRequired:false,lastCheckedAt:h.verifiedAt,diagnostic:'CURRENT_OFFICIAL_QR_HANDOFF',contradiction:false,currentHandoff:true});
  }
  return result;
}

export function attemptCounters(s: Dashboard) {
  const c = s.live?.parents.flatMap(p => p.children) ?? [];
  const planned = s.booking?.setup.PRECISION_PHASE3?.wave1.reduce((n, a) => n + (a.fanOutOffsetsMs?.length ?? 1), 0) ?? c.length;
  return { planned: Math.max(planned, c.length), armed: c.filter(a => a.state === 'ARMED').length,
    inFlight: c.filter(a => ['IN_FLIGHT', 'RESERVED'].includes(a.state)).length,
    unknown: c.filter(a => a.state === 'UNKNOWN').length, rejected: c.filter(a => a.state === 'REJECTED').length,
    unsent: c.filter(a => UNSENT_STATES.has(a.state)).length, failed: c.filter(a => a.state === 'FAILED').length };
}

/** Primary timeline never needs contact data, checkout capabilities or private recovery identifiers. */
export function operatorEventText(value: string, s: Dashboard): string {
  let text=value;
  const known=Object.values(s.playerStatus??{}).filter((v):v is {fullName:string;phone:string;email:string}=>!!v&&typeof v==='object').flatMap(v=>[v.fullName,v.phone,v.email]).filter(v=>v?.length>=3);
  for(const privateValue of known)text=text.split(privateValue).join('[private]');
  return text.replace(/https?:\/\/\S+/gi,'[provider link]')
    .replace(/\b(?:Bearer\s+\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/gi,'[private]')
    .replace(/\b(?:token|cookie|capability|authorization|bookingId|bookingNo|sessionId|transactionId)["']?\s*[:=]\s*["']?[^\s,}"']+/gi,'[private]')
    .slice(0,500);
}
