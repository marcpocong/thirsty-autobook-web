import type { Recovery } from './execution-state.js';

/**
 * Typed classification of preparation and arming failures. Dependency-free (renderer-safe).
 *
 * The category is derived only from the sanitized failure code plus the controller's own context (operation, last
 * preparation step, worker, lock). It never inspects provider bodies, tokens or customer data. A retry is offered only
 * when the category is conclusively safe to retry: anything involving a retained lock, a verified hold or an unknown
 * submission is review-first and is never retried, cleared or reclassified automatically.
 */
export type FailureCategory = 'BROWSER_DISCONNECTED' | 'WRONG_PROFILE' | 'INVALID_VENUE_OR_TAB' | 'SECURITY_VERIFICATION_FAILED' | 'PROVIDER_THROTTLED'
  | 'STALE_PREPARATION' | 'PLAN_FINGERPRINT_MISMATCH' | 'INVALID_PREPARATION_EVIDENCE' | 'INVALID_PLAN' | 'PLAYER_CONFIGURATION'
  | 'CLOCK_UNTRUSTED' | 'TIMING_UNCALIBRATED' | 'CAPACITY_LIMITED' | 'RUN_NOT_ACHIEVED' | 'RETAINED_LOCK' | 'VERIFIED_HOLD' | 'UNKNOWN_SUBMISSION' | 'OPERATOR_CANCELLED' | 'INTERNAL_ERROR';
export interface FailureContext { operation: 'prepare' | 'arm' | 'run'; step?: string | null; workerId?: string | null; lockPresent?: boolean }
export interface ClassifiedFailure {
  category: FailureCategory; code: string; title: string; detail: string; operation: FailureContext['operation'];
  step: string | null; workerId: string | null; retrySafe: boolean; recovery: Recovery; at: string;
}
const CODES: Record<Exclude<FailureCategory, 'INTERNAL_ERROR'>, readonly string[]> = {
  BROWSER_DISCONNECTED: ['CHROME_DISCONNECTED', 'CDP_ENDPOINT_UNAVAILABLE', 'CHROME_START_TIMEOUT', 'CHROME_START_FAILED', 'CHROME_NOT_INSTALLED', 'CDP_PROFILE_OR_BIND_UNVERIFIED',
    'API_CHECKOUT_WORKER_MISSING', 'BROWSER_FAILED', 'DEDICATED_CHROME_CLOSE_TIMEOUT', 'CDP_NOT_LISTENING', 'CDP_PROCESS_METADATA_UNAVAILABLE', 'API_BROWSER_CONTEXT_MISSING'],
  WRONG_PROFILE: ['WRONG_CHROME_PROFILE', 'DEDICATED_CHROME_NOT_IDENTIFIED', 'DEDICATED_PROFILE_UNVERIFIED', 'CDP_WRONG_PROFILE', 'CDP_PROFILE_MISSING', 'CDP_WRONG_PORT',
    'CDP_PROCESS_NOT_CHROME', 'CDP_UNSAFE_BIND', 'CDP_AMBIGUOUS_LISTENER'],
  INVALID_VENUE_OR_TAB: ['WRONG_VENUE', 'ONDA_TAB_AMBIGUOUS_OR_MISSING', 'TAB_NOT_VISIBLE', 'STALE_OR_INCOMPLETE_GRID', 'COURT_FILTER_NOT_ALL', 'PREEXISTING_SELECTION',
    'ONDA_TAB_OPEN_FAILED', 'ONDA_PAGE_NAVIGATION_FAILED', 'ONDA_PAGE_LOAD_TIMEOUT', 'ONDA_PAGE_NOT_READY', 'BROWSER_PRESENTATION_FAILED', 'API_BROWSER_PAGE_TIMEOUT',
    'TARGET_DATE_UNAVAILABLE', 'TARGET_NOT_AVAILABLE', 'SHOTGUN_TOPOLOGY_NOT_READY', 'LOCK_SELECTED_SLOTS'],
  SECURITY_VERIFICATION_FAILED: ['SECURITY_CHALLENGE', 'ONDA_SECURITY_VERIFICATION_FAILED', 'SECURITY_PREWARM_FAILED', 'SECURITY_PREWARM_RETRY_FAILED', 'HUMAN_VERIFICATION_REQUIRED',
    'CLOUDFLARE_CHALLENGE', 'SECURITY_CONTEXT_STALE', 'SECURITY_CHECK_FAILED', 'SECURITY_CHECK_REQUIRED', 'SECURITY_CHECK_NEEDS_PREPARATION'],
  PROVIDER_THROTTLED: ['RATE_LIMITED', 'SHOTGUN_PROVIDER_THROTTLE_STOP', 'PROVIDER_THROTTLED'],
  STALE_PREPARATION: ['RESET_REQUIRED', 'TODAYS_RELEASE_PASSED', 'TOO_LATE_FOR_PREFLIGHT', 'RELEASE_MISSED', 'PRECISION_TOO_LATE_TO_ARM', 'PREPARATION_STALE'],
  PLAN_FINGERPRINT_MISMATCH: ['PREPARATION_RESULT_MISMATCH', 'PREPARED_FINGERPRINT_MISMATCH', 'BOOKING_PLAN_CHANGED', 'SCHEDULE_CONTEXT_MISMATCH', 'PREPARED_PLAN_CHANGED'],
  INVALID_PREPARATION_EVIDENCE: ['PREPARATION_RESULT_INVALID', 'PREPARATION_RESULT_MISSING'],
  INVALID_PLAN: ['BOOKING_SETTINGS_INVALID', 'CONFIG_INVALID', 'PREPARATION_INPUT_INVALID', 'SHOTGUN_PLAN_INCOMPATIBLE_POSITIVE_OFFSET', 'PRECISION_REQUIRES_PROOFLESS_STANDARD',
    'EXTENDED_DURATION_LIMIT', 'SAVED_PLAN_DATE_STALE', 'PRECISION_CANDIDATE_INVALID', 'BUKO_SCHEDULED_LIVE_BLOCKED', 'SHOTGUN_IMMEDIATE_BURST_BLOCKED', 'PRECISION_NO_ELIGIBLE_TARGET'],
  PLAYER_CONFIGURATION: ['PLAYER_INFO_MISSING', 'EXTENDED_PLAYER_INFO_MISSING', 'THIRD_PLAYER_INFO_MISSING', 'FOURTH_PLAYER_INFO_MISSING', 'DUPLICATE_ONDA_CUSTOMER_ID',
    'PRECISION_NO_VALID_CUSTOMER_IDENTITY'],
  CLOCK_UNTRUSTED: ['NETWORK_CLOCK_SYNC_REQUIRED', 'NETWORK_CLOCK_SYNC_FAILED', 'NETWORK_CLOCK_STALE', 'RELEASE_CLOCK_REFRESH_TIMEOUT', 'NETWORK_CLOCK_OFFSET_INVALID'],
  TIMING_UNCALIBRATED: ['SHOTGUN_TIMING_REQUIRED', 'TIMING_CALIBRATION_FAILED', 'TIMING_CALIBRATION_UNAVAILABLE'],
  CAPACITY_LIMITED: ['PREWARM_PLAN_NOT_FEASIBLE', 'SHOTGUN_PREWARM_NOT_FULLY_READY', 'PREWARM_FEASIBILITY_UNAVAILABLE', 'SHOTGUN_TIMING_NOT_READY', 'SHOTGUN_MACHINE_NOT_READY'],
  RUN_NOT_ACHIEVED: ['NOTHING_DISPATCHED', 'OBJECTIVE_NOT_ACHIEVED_NOTHING_DISPATCHED', 'OBJECTIVE_NOT_ACHIEVED_ALL_REJECTED', 'ARMED_NOT_DISPATCHED', 'SHOTGUN_TRIGGER_MISSED'],
  RETAINED_LOCK: ['AUTOMATION_LOCK_EXISTS', 'LOCK_PID_RUNNING', 'AUTOMATION_STILL_RUNNING', 'LOCK_BROWSER_STATE_UNKNOWN', 'STOP_NOT_CONFIRMED', 'OPERATION_ALREADY_RUNNING'],
  VERIFIED_HOLD: ['PAYMENT_HOLD_MAY_BE_ACTIVE', 'LOCK_PAYMENT_HOLD_ACTIVE', 'PRACTICE_RESET_HOLD_ACTIVE'],
  UNKNOWN_SUBMISSION: ['HANDOFF_STATUS_UNKNOWN', 'FINAL_ACTION_DISPATCHING', 'OBJECTIVE_NOT_CONFIRMED_MANUAL_RECONCILIATION', 'API_NO_UNUSED_CANDIDATE', 'DUPLICATE_LOGICAL_BOOKING_BLOCKED'],
  OPERATOR_CANCELLED: ['USER_ABORT', 'CANCELLED', 'SHOTGUN_LIVE_ATTESTATION_DECLINED'],
};
const LOOKUP = new Map<string, FailureCategory>(Object.entries(CODES).flatMap(([category, codes]) => codes.map(code => [code, category as FailureCategory] as const)));
const PLAYER_PATTERN = /^(?:LOCAL_.*CUSTOMER_ID_UNVERIFIED|PLAYER_[A-H]_INFO_MISSING)$/;

const TEXT: Record<FailureCategory, { title: string; detail: string; recovery: Recovery; retrySafe: boolean }> = {
  BROWSER_DISCONNECTED: { title: 'Browser not available', detail: 'A required dedicated Chrome browser is closed, disconnected or did not start. Nothing was submitted.', recovery: { label: 'Recheck browsers', action: 'RECHECK_BROWSERS' }, retrySafe: true },
  WRONG_PROFILE: { title: 'Wrong Chrome profile', detail: 'The debugging port belongs to a Chrome that is not the dedicated bot profile. Close that window; the bot never takes over your own Chrome.', recovery: { label: 'Recheck browsers', action: 'RECHECK_BROWSERS' }, retrySafe: true },
  INVALID_VENUE_OR_TAB: { title: 'Onda page not ready', detail: 'The expected Thirsty Pickle booking page or tab could not be verified in a dedicated browser. Nothing was submitted.', recovery: { label: 'Recheck browsers', action: 'RECHECK_BROWSERS' }, retrySafe: true },
  SECURITY_VERIFICATION_FAILED: { title: 'Security verification not completed', detail: 'Onda security verification did not complete. The bot never solves challenges: if a THIRSTY BOT window says VERIFY HERE, complete the check Onda shows there. Otherwise keep the bot windows open and Prepare again; the run log records which helper failed and whether a challenge frame appeared (shown or not). These logs establish the failure, not the provider-side reason.', recovery: { label: 'Review readiness', action: 'REVIEW_READINESS' }, retrySafe: true },
  PROVIDER_THROTTLED: { title: 'Provider is limiting requests', detail: 'Onda reported rate limiting. Every unsent attempt stops and nothing is retried automatically. Wait before trying again.', recovery: { label: 'Open Activity', action: 'OPEN_ACTIVITY' }, retrySafe: false },
  STALE_PREPARATION: { title: 'Preparation is too late or stale', detail: 'The release window for this preparation has passed or is too close. Nothing was sent late.', recovery: { label: 'Prepare again', action: 'PREPARE' }, retrySafe: true },
  PLAN_FINGERPRINT_MISMATCH: { title: 'Saved plan changed', detail: 'The saved release plan no longer matches the plan that was prepared or armed. Nothing was armed with the changed plan.', recovery: { label: 'Review changes', action: 'REVIEW_CHANGES' }, retrySafe: true },
  INVALID_PREPARATION_EVIDENCE: { title: 'Preparation evidence invalid', detail: 'Preparation reached its final check but its evidence did not validate (field paths are in Activity). Nothing was submitted.', recovery: { label: 'Prepare again', action: 'PREPARE' }, retrySafe: true },
  INVALID_PLAN: { title: 'Plan needs attention', detail: 'The saved plan is invalid or not permitted for live use. Fix the listed problem; nothing was changed automatically.', recovery: { label: 'Review problems', action: 'REVIEW_PROBLEMS' }, retrySafe: true },
  PLAYER_CONFIGURATION: { title: 'Player or customer configuration', detail: 'A required player or Onda customer identity is missing, invalid or duplicated.', recovery: { label: 'Configure players', action: 'CONFIGURE_PLAYERS' }, retrySafe: true },
  CLOCK_UNTRUSTED: { title: 'Trusted clock unavailable', detail: 'The Google network clock could not be verified. Dispatch never proceeds on an untrusted clock.', recovery: { label: 'Review readiness', action: 'REVIEW_READINESS' }, retrySafe: true },
  TIMING_UNCALIBRATED: { title: 'Timing calibration needed', detail: 'Live Shotgun requires a READY local timing calibration for this exact plan, installed build, Chrome and machine from the last 24 hours. The calibration is local only; nothing reaches Onda. Nothing was armed.', recovery: { label: 'Run timing calibration', action: 'CALIBRATE_TIMING' }, retrySafe: true },
  CAPACITY_LIMITED: { title: 'Plan exceeds measured capacity', detail: 'This machine cannot ready every configured attempt in time. Reduce attempts or widen the schedule; the plan is never reduced automatically.', recovery: { label: 'Review capacity', action: 'REVIEW_CAPACITY' }, retrySafe: true },
  RUN_NOT_ACHIEVED: { title: 'Release did not achieve the goal', detail: 'The run settled without a verified hold. The outcome summary lists every planned, sent, rejected and definitively unsent attempt.', recovery: { label: 'Open Activity', action: 'OPEN_ACTIVITY' }, retrySafe: true },
  RETAINED_LOCK: { title: 'Automation lock retained', detail: 'A safety lock from an earlier or running automation is still present. It is never cleared automatically.', recovery: { label: 'Review lock', action: 'REVIEW_LOCK' }, retrySafe: false },
  VERIFIED_HOLD: { title: 'Payment hold may be active', detail: 'A temporary payment hold may still be active in this customer context. It is never cancelled automatically; payment stays manual.', recovery: { label: 'Review lock', action: 'REVIEW_LOCK' }, retrySafe: false },
  UNKNOWN_SUBMISSION: { title: 'Earlier submission outcome unknown', detail: 'An earlier checkout may have been sent without a confirmed outcome. DO NOT retry. Check Onda manually; the record stays UNKNOWN.', recovery: { label: 'Review previous submission', action: 'REVIEW_SUBMISSION' }, retrySafe: false },
  OPERATOR_CANCELLED: { title: 'Cancelled', detail: 'The operation was cancelled. Nothing further was started.', recovery: { label: 'Prepare again', action: 'PREPARE' }, retrySafe: true },
  INTERNAL_ERROR: { title: 'Unexpected internal error', detail: 'The application failed without a specific reason. The sanitized step and error class are recorded in Activity.', recovery: { label: 'Open Activity', action: 'OPEN_ACTIVITY' }, retrySafe: false },
};

export function failureCategory(code: string): FailureCategory {
  return LOOKUP.get(code) ?? (PLAYER_PATTERN.test(code) ? 'PLAYER_CONFIGURATION' : 'INTERNAL_ERROR');
}
export function classifyFailure(rawCode: string, context: FailureContext, at = new Date().toISOString()): ClassifiedFailure {
  const code = /^[A-Z][A-Z0-9_]{0,79}$/.test(rawCode) ? rawCode : 'OPERATION_FAILED';
  const category = failureCategory(code), text = TEXT[category];
  // An unexplained failure is retry-safe only when no lock or submission record remains afterwards.
  const retrySafe = category === 'INTERNAL_ERROR' ? context.lockPresent === false : text.retrySafe && !(context.lockPresent && category !== 'RETAINED_LOCK');
  const recovery = category === 'INTERNAL_ERROR' && retrySafe ? { label: 'Prepare again', action: 'PREPARE' as const }
    : code === 'SECURITY_CHECK_REQUIRED' || code === 'SECURITY_CHECK_FAILED' ? { label: 'Run security check', action: 'CHECK_SECURITY' as const }
      : code === 'SECURITY_CHECK_NEEDS_PREPARATION' ? { label: 'Prepare again', action: 'PREPARE' as const }
        : code === 'SAVED_PLAN_DATE_STALE' ? { label: 'Review plan date', action: 'REVIEW_PLAN_DATE' as const } : text.recovery;
  const where = [context.step ? `step ${context.step}` : '', context.workerId ? `browser ${context.workerId}` : ''].filter(Boolean).join(' · ');
  return { category, code, title: text.title, detail: `${text.detail}${where ? ` (${where})` : ''}${retrySafe ? '' : ' Retrying is not offered until it is reviewed.'}`,
    operation: context.operation, step: context.step ?? null, workerId: context.workerId ?? null, retrySafe, recovery, at };
}
