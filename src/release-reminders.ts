export interface LocalNotice { id: string; title: string; body: string; destination: 'home' | 'release' | 'live' }
export interface ReminderState {
  fingerprint: string; releaseMs: number; armed: boolean; prepared: boolean; calibration: string;
  browsersConnected: boolean; runId?: string; settled?: boolean; holds?: number; unknown?: number;
  draftId?: string; draftPending?: boolean;
}
/** Only bounded local observations. Delivery identity is persisted by the desktop service. */
export function releaseNotices(s: ReminderState, now: number, minutes: readonly number[]): LocalNotice[] {
  const notices: LocalNotice[] = [], left = s.releaseMs - now;
  const add = (key: string, title: string, body: string, destination: LocalNotice['destination'] = 'release') => notices.push({ id: `${s.fingerprint}:${key}`, title, body, destination });
  if (s.draftId && s.draftPending) notices.push({ id: `draft:${s.draftId}`, title: 'Next release draft ready', body: 'Review the proposed dates and preferences. Nothing is saved as a release plan or armed.', destination: 'home' });
  if (left > 0) {
    // Only the nearest crossed reminder is delivered after a restart; no burst of old reminders.
    const due = [...minutes].sort((a,b) => a-b).find(m => left <= m * 60_000);
    if (due !== undefined) add(`reminder:${due}`, 'Release approaching', `${Math.ceil(left/60_000)} minutes left. ${s.armed ? 'Exact plan armed.' : 'Review, prepare and authorize the saved plan.'}`);
    if (left <= 10*60_000 && !s.armed) add('critical', 'Release is not armed', 'Owner authorization is still required. Nothing will submit automatically.');
    if (left <= 30*60_000 && !s.prepared) add('preparation', 'Preparation incomplete', 'Use Check & Prepare for release; genuine security work requires your explicit action.');
    if (left <= 30*60_000 && s.calibration !== 'READY') add(`calibration:${s.calibration}`, 'Timing calibration needs attention', 'Open readiness to inspect the exact plan and current machine calibration.');
    if (left <= 30*60_000 && !s.browsersConnected) add('browsers', 'Required browser is disconnected', 'Use the supported preparation workflow to inspect dedicated browser ownership.');
  } else if (!s.armed && !s.runId && left >= -24*60*60_000) add('missed', 'Saved release window passed', 'The saved plan was not armed. Review the next draft; old authorization is never moved to another date.');
  if (s.armed) add('armed', 'Release armed', 'The exact reviewed plan is armed. Payment remains manual.');
  if (s.runId && s.settled) add(`complete:${s.runId}`, 'Run complete', 'Open Live & History for the recorded outcomes and safe next steps.', 'live');
  if (s.runId && s.holds) add(`holds:${s.runId}`, 'Temporary hold needs attention', 'A verified temporary hold is awaiting manual QR/payment attention. It is not a paid booking.', 'live');
  if (s.runId && s.unknown) add(`unknown:${s.runId}`, 'UNKNOWN outcome — review required', 'Do not retry. Reconcile the existing submission using authoritative provider evidence.', 'live');
  return notices;
}
