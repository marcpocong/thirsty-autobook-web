import type { ObjectiveOutcomeStatus } from './booking-objective.js';

/**
 * One operator-facing execution state, derived (never stored) from the authoritative inputs. Dependency-free.
 * The same plan fingerprint must connect review, save, preparation, arming, dispatch and outcome reporting.
 */
export type ExecutionState = 'DRAFT' | 'SAVED' | 'PREPARING' | 'PREPARED' | 'ARMED' | 'RUNNING' | 'RECONCILING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'NEEDS_REVIEW';
export interface ExecutionInputs {
  /** Fingerprint of the compiled draft on screen (null if it cannot compile). */ draftFingerprint: string | null;
  /** Fingerprint the saved/authorized plan was compiled from. */ savedFingerprint: string | null;
  problems: number;
  operation: string;
  /** The backend reports preparation complete for the saved plan. */ prepared: boolean;
  armed: boolean; dispatching: boolean; reconciling?: boolean;
  outcome?: ObjectiveOutcomeStatus | null; runFailed?: boolean;
  /** An UNKNOWN submission, unresolved lock or payment-in-progress needs a person. */ needsReview?: boolean;
}
export interface ExecutionView {
  state: ExecutionState; label: string; detail: string; tone: 'muted' | 'info' | 'ready' | 'live' | 'good' | 'warn' | 'bad';
  can: { edit: boolean; save: boolean; prepare: boolean; test: boolean; arm: boolean; stop: boolean };
}
const PREPARING_OPERATIONS = new Set(['prepare', 'resetting', 'chrome', 'inspect', 'stopping']);
export function executionState(i: ExecutionInputs): ExecutionView {
  const view = (state: ExecutionState, label: string, detail: string, tone: ExecutionView['tone'], can: Partial<ExecutionView['can']> = {}): ExecutionView =>
    ({ state, label, detail, tone, can: { edit: false, save: false, prepare: false, test: false, arm: false, stop: false, ...can } });
  const saved = i.savedFingerprint !== null && i.draftFingerprint === i.savedFingerprint;
  if (i.dispatching) return view('RUNNING', 'RUNNING', 'Attempts are being sent. Emergency Stop cancels unsent attempts only; holds already created stay with the provider.', 'live', { stop: true });
  if (i.reconciling) return view('RECONCILING', 'RECONCILING', 'Every sent attempt is being settled against its durable journal and provider response.', 'live', { stop: true });
  if (i.armed) return view('ARMED', 'ARMED', 'Waiting for the release. Disarm (Emergency Stop) before changing the plan.', 'live', { stop: true });
  if (PREPARING_OPERATIONS.has(i.operation)) return view('PREPARING', 'PREPARING', 'Preparing browsers and checking the plan. Nothing is sent.', 'info', { stop: true });
  if (i.operation !== 'idle' && i.operation !== 'scheduled') return view('RUNNING', 'BUSY', `Operation in progress: ${i.operation}.`, 'info', { stop: true });
  if (i.needsReview || i.outcome === 'UNKNOWN') return view('NEEDS_REVIEW', 'UNKNOWN · NEEDS REVIEW', 'A result is unknown or a safety lock needs review. Nothing is retried automatically.', 'bad', { edit: true, save: i.problems === 0, test: true });
  if (i.outcome === 'IDEAL') return view('COMPLETED', 'COMPLETED · IDEAL', 'The ideal number of courts has verified temporary holds. Payment remains manual.', 'good', { edit: true, save: i.problems === 0, test: true, prepare: saved });
  if (i.outcome === 'MINIMUM') return view('PARTIAL', 'PARTIAL · MINIMUM MET', 'The minimum is met with verified temporary holds; the ideal was not reached.', 'warn', { edit: true, save: i.problems === 0, test: true, prepare: saved });
  if (i.outcome === 'PARTIAL') return view('PARTIAL', 'PARTIAL · BELOW MINIMUM', 'Some courts have verified holds, below the minimum.', 'warn', { edit: true, save: i.problems === 0, test: true, prepare: saved });
  if (i.runFailed || i.outcome === 'NONE') return view('FAILED', 'FAILED', 'No court was achieved in the last run.', 'bad', { edit: true, save: i.problems === 0, test: true, prepare: saved });
  if (!saved) return view('DRAFT', 'DRAFT', i.problems ? `${i.problems} item${i.problems === 1 ? '' : 's'} to fix before saving.` : 'Unsaved changes. Save to bind this exact plan.', 'muted',
    { edit: true, save: i.problems === 0, test: i.problems === 0 });
  if (i.prepared) return view('PREPARED', 'PREPARED', 'Browsers are prepared for this exact plan. Authorize and arm when ready.', 'ready', { edit: true, test: true, prepare: true, arm: true });
  return view('SAVED', 'SAVED', 'This exact plan is saved. Prepare browsers next.', 'info', { edit: true, test: true, prepare: i.problems === 0 });
}
/** What an edit must do in the current state. Edits never silently change an armed or running plan. */
export function editEffect(state: ExecutionState): 'ALLOW' | 'INVALIDATES_PREPARATION' | 'REFUSE_DISARM_FIRST' | 'REFUSE_RUNNING' {
  if (state === 'ARMED') return 'REFUSE_DISARM_FIRST';
  if (state === 'RUNNING' || state === 'RECONCILING' || state === 'PREPARING') return 'REFUSE_RUNNING';
  if (state === 'PREPARED') return 'INVALIDATES_PREPARATION';
  return 'ALLOW';
}

// ── Operator gates ───────────────────────────────────────────────────────────────────────────────────────────
// Every state-dependent control is derived here from the same inputs as the execution state. A control that is
// unavailable always carries a plain-language reason and one recovery the operator can press. These gates mirror,
// and never replace, the controller and runner checks that remain authoritative.
export type RecoveryAction = 'REVIEW_PROBLEMS' | 'REVIEW_CHANGES' | 'SAVE_PLAN' | 'PREPARE' | 'RECHECK_BROWSERS' | 'REVIEW_READINESS' | 'REVIEW_LOCK'
  | 'REVIEW_SUBMISSION' | 'AUTHORIZE_TERMS' | 'CONFIGURE_PLAYERS' | 'REVIEW_CAPACITY' | 'SYNC_CLOCK' | 'STOP' | 'WAIT' | 'OPEN_ACTIVITY' | 'CHECK_SECURITY';
export interface Recovery { label: string; action: RecoveryAction }
export interface Gate { enabled: boolean; reason: string | null; recovery: Recovery | null }
export type PrimaryAction = 'SAVE_PLAN' | 'PREPARE' | 'AUTHORIZE_ARM' | 'STOP' | 'WAIT' | 'REVIEW_LOCK' | 'REVIEW_SUBMISSION';
export type RuntimeValidation = 'PENDING' | 'VALID' | 'INVALID' | 'UNAVAILABLE';
export type ForecastVerdict = 'READY' | 'AT_RISK' | 'NOT_FEASIBLE' | 'UNAVAILABLE' | 'NOT_APPLICABLE';
export interface OperatorInputs {
  mode: 'NEXT_RELEASE' | 'AVAILABLE_NOW';
  /** False when the operator chose to keep a saved plan edited in the advanced editor; the draft is then not used. */
  owns: boolean;
  draftProblems: readonly string[];
  /** NEXT_RELEASE: why this draft cannot become the live release authorization (Buko, wrong date, …). */
  liveSaveProblems: readonly string[];
  /** The exact runtime representation checked against the real configuration schema. */
  runtime: { status: RuntimeValidation; problems: readonly string[] };
  savedPlan: { exists: boolean; matchesDraft: boolean | null; differences: number };
  operation: string;
  prepared: { forSavedPlan: boolean; forOtherPlan: boolean };
  armed: boolean; running: boolean;
  lock: { present: boolean; canPrepareOver: boolean; unresolvedSubmission: boolean };
  /** Required browsers of the prepared plan that are currently disconnected (letters). */
  disconnected: readonly string[];
  playersMissing: readonly string[];
  identityIssues?: readonly string[];
  /** Published controller checks only; the renderer never estimates capacity or timing. */
  readinessBlockers?: readonly { reason: string; recovery: Recovery }[];
  termsAuthorized: boolean;
  /** Shotgun plans require a complete preparation forecast; other plans pass NOT_APPLICABLE when none applies. */
  forecast: { verdict: ForecastVerdict; ready: number; configured: number; omitted: number; required: boolean };
  /** Available Now only: a checkout step exists for the goal. */
  hasCheckoutStep?: boolean;
  labRunning?: boolean;
}
export interface OperatorGates {
  primary: { action: PrimaryAction; label: string; gate: Gate };
  save: Gate; prepare: Gate; terms: Gate; arm: Gate; saveDraft: Gate; test: Gate; stop: Gate;
  /** Every distinct reason something is unavailable, most important first. */
  blockers: Array<{ control: string; reason: string; recovery: Recovery | null }>;
}
const open = (): Gate => ({ enabled: true, reason: null, recovery: null });
const closed = (reason: string, recovery: Recovery | null): Gate => ({ enabled: false, reason, recovery });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const BUSY_PREPARE = new Set(['prepare', 'resetting', 'chrome', 'inspect', 'stopping', 'saving', 'reviewing', 'clearing', 'closingBrowsers']);

export function operatorGates(i: OperatorInputs): OperatorGates {
  const live = i.armed || i.running, busy = !live && i.operation !== 'idle' && i.operation !== 'scheduled';
  const lockBlocks = i.lock.present && !i.lock.canPrepareOver;
  const release = i.mode === 'NEXT_RELEASE';
  const reviewProblems: Recovery = { label: 'Review problems', action: 'REVIEW_PROBLEMS' };
  const draftCount = i.draftProblems.length;

  // Save (bind the exact draft as the release authorization). Never needed for Available Now.
  let save: Gate = open();
  if (!release) save = closed('Available Now runs each checkout directly; nothing is saved as a release authorization.', null);
  else if (live) save = closed('The release is armed or running. Use Emergency Stop to disarm before changing the saved plan.', { label: 'Emergency Stop', action: 'STOP' });
  else if (busy) save = closed('Another operation is running. Wait for it to finish.', { label: 'Wait', action: 'WAIT' });
  else if (!i.owns) save = closed('You chose to keep the saved plan from the advanced editor. Choose "Use this Booking Setup plan" to save this draft instead.', { label: 'Review changes', action: 'REVIEW_CHANGES' });
  else if (draftCount) save = closed(`${plural(draftCount, 'plan problem')} must be fixed before saving: ${i.draftProblems[0]}`, reviewProblems);
  else if (i.liveSaveProblems.length) save = closed(i.liveSaveProblems[0]!, reviewProblems);
  else if (i.runtime.status === 'INVALID') save = closed(`The release runtime rejects this exact plan: ${i.runtime.problems[0] ?? 'invalid configuration'}`, reviewProblems);
  else if (i.runtime.status === 'PENDING') save = closed('Checking this exact plan against the release configuration…', { label: 'Wait', action: 'WAIT' });
  else if (i.savedPlan.matchesDraft === true) save = closed('This exact plan is already the saved release plan.', null);

  // Prepare (open the browsers this saved plan needs).
  let prepare: Gate = open();
  if (live) prepare = closed('The release is armed or running.', { label: 'Emergency Stop', action: 'STOP' });
  else if (busy) prepare = closed(BUSY_PREPARE.has(i.operation) ? 'Preparation is running. Wait for it to finish, or use Emergency Stop.' : 'Another operation is running. Wait for it to finish.', { label: 'Wait', action: 'WAIT' });
  else if (i.labRunning) prepare = closed('The Booking Test Lab is running. Stop or finish it first.', { label: 'Wait', action: 'WAIT' });
  else if (lockBlocks) prepare = i.lock.unresolvedSubmission
    ? closed('An earlier checkout outcome is unknown. Review the previous submission before another run.', { label: 'Review previous submission', action: 'REVIEW_SUBMISSION' })
    : closed('A retained automation lock or payment hold needs review before another run.', { label: 'Review lock', action: 'REVIEW_LOCK' });
  else if (release && i.owns && draftCount) prepare = closed(`${plural(draftCount, 'plan problem')} must be fixed first: ${i.draftProblems[0]}`, reviewProblems);
  else if (release && i.owns && i.liveSaveProblems.length) prepare = closed(i.liveSaveProblems[0]!, reviewProblems);
  else if (release && !i.savedPlan.exists) prepare = closed('There is no saved release plan yet. Save this plan first.', { label: 'Save release plan', action: 'SAVE_PLAN' });
  else if (release && i.owns && i.savedPlan.matchesDraft === false) prepare = closed(`The current draft is different from your saved release plan (${plural(i.savedPlan.differences, 'change')}). Save it, or load the saved plan back, before preparing.`, { label: 'Review changes', action: 'REVIEW_CHANGES' });
  else if (release && i.owns && i.savedPlan.matchesDraft === null) prepare = closed('Checking whether this draft matches the saved release plan…', { label: 'Wait', action: 'WAIT' });
  else if (!release && draftCount) prepare = closed(`${plural(draftCount, 'plan problem')} must be fixed first: ${i.draftProblems[0]}`, reviewProblems);
  else if (!release && i.hasCheckoutStep === false) prepare = closed('No checkout step is available for this goal.', reviewProblems);
  else if (i.playersMissing.length) prepare = closed(`Browser ${i.playersMissing.join(', ')} has no configured player/customer.`, { label: 'Configure players', action: 'CONFIGURE_PLAYERS' });

  // Terms authorization is per prepared run.
  let terms: Gate = open();
  if (live) terms = closed('Terms are already authorized for the armed run.', null);
  else if (busy) terms = closed('Wait for the current operation to finish.', { label: 'Wait', action: 'WAIT' });
  else if (lockBlocks) terms = closed('Review the retained lock first.', { label: 'Review lock', action: 'REVIEW_LOCK' });
  else if (i.prepared.forOtherPlan) terms = closed('Preparation belongs to an older plan. Prepare the saved plan again.', { label: 'Prepare again', action: 'PREPARE' });
  else if (!i.prepared.forSavedPlan) terms = closed('Terms are authorized for a prepared run. Prepare the saved plan first.', { label: 'Prepare', action: 'PREPARE' });

  // Arm / book.
  let arm: Gate = open();
  if (live) arm = closed('Already armed.', null);
  else if (!terms.enabled) arm = terms;
  else if (i.disconnected.length) arm = closed(`Browser ${i.disconnected.join(', ')} ${i.disconnected.length === 1 ? 'is' : 'are'} disconnected.`, { label: 'Recheck browsers', action: 'RECHECK_BROWSERS' });
  else if (i.playersMissing.length) arm = closed(`Browser ${i.playersMissing.join(', ')} has no configured player/customer.`, { label: 'Configure players', action: 'CONFIGURE_PLAYERS' });
  else if (i.identityIssues?.length) arm = closed(i.identityIssues.join('; '), { label: 'Recheck browsers', action: 'RECHECK_BROWSERS' });
  else if (release && i.readinessBlockers?.length) arm = closed(i.readinessBlockers[0]!.reason, i.readinessBlockers[0]!.recovery);
  else if (release && i.forecast.required && i.forecast.verdict === 'NOT_FEASIBLE')
    arm = closed(`Preparation forecast: only ${i.forecast.ready} of ${i.forecast.configured} attempts can be ready before their triggers (${i.forecast.omitted} would be omitted). Reduce attempts or widen the schedule, then save and prepare again.`, { label: 'Review capacity', action: 'REVIEW_CAPACITY' });
  else if (release && i.forecast.required && i.forecast.verdict === 'UNAVAILABLE')
    arm = closed('The preparation forecast for this exact plan is unavailable. Prepare again.', { label: 'Prepare again', action: 'PREPARE' });
  else if (!i.termsAuthorized) arm = closed('Tick the Terms authorization for this run.', { label: 'Authorize Terms', action: 'AUTHORIZE_TERMS' });

  const editable = !live && !busy;
  const saveDraft = editable ? open() : closed(live ? 'The plan is armed or running. Use Emergency Stop to disarm before editing.' : 'Wait for the current operation to finish.', live ? { label: 'Emergency Stop', action: 'STOP' } : { label: 'Wait', action: 'WAIT' });
  let test: Gate = open();
  if (live) test = closed('Offline testing is unavailable while a release is armed or running.', null);
  else if (busy) test = closed('Wait for the current operation to finish.', { label: 'Wait', action: 'WAIT' });
  else if (draftCount) test = closed(`${plural(draftCount, 'plan problem')} must be fixed before testing.`, reviewProblems);
  const stop = live || busy || i.labRunning ? open() : closed('Nothing is armed or running.', null);

  // One primary button that walks Save → Prepare → Authorize and Arm → Emergency Stop.
  let primary: OperatorGates['primary'];
  if (live) primary = { action: 'STOP', label: 'Emergency Stop', gate: open() };
  else if (busy) primary = { action: 'WAIT', label: BUSY_PREPARE.has(i.operation) ? 'Preparing…' : 'Working…', gate: prepare };
  else if (lockBlocks) primary = i.lock.unresolvedSubmission
    ? { action: 'REVIEW_SUBMISSION', label: 'Review previous submission', gate: open() } : { action: 'REVIEW_LOCK', label: 'Review lock', gate: open() };
  else if (release && i.owns && i.savedPlan.matchesDraft !== true) primary = { action: 'SAVE_PLAN', label: 'Save release plan', gate: save };
  else if (!i.prepared.forSavedPlan) primary = { action: 'PREPARE', label: i.lock.canPrepareOver ? 'Prepare New Run' : i.prepared.forOtherPlan ? 'Prepare again' : 'Prepare', gate: prepare };
  else primary = { action: 'AUTHORIZE_ARM', label: release ? 'Authorize and Arm' : 'Authorize and Book to QR', gate: arm };

  const blockers: OperatorGates['blockers'] = [];
  const add = (control: string, gate: Gate) => { if (!gate.enabled && gate.reason && !blockers.some(b => b.reason === gate.reason)) blockers.push({ control, reason: gate.reason, recovery: gate.recovery }); };
  // Prepare is listed only when it adds information (why the next step is not yet Prepare), never as a reworded duplicate.
  if (!live) { add(primary.label, primary.gate); if (primary.action !== 'PREPARE' && primary.gate.enabled) add('Prepare', prepare); if (primary.action === 'AUTHORIZE_ARM') add('Terms', terms); }
  return { primary, save, prepare, terms, arm, saveDraft, test, stop, blockers };
}

// ── Plan ladder ──────────────────────────────────────────────────────────────────────────────────────────────
export type LadderStage = 'DRAFT' | 'VALIDATED' | 'SAVED' | 'PREPARED' | 'ARMED' | 'EXECUTED';
export type LadderStatus = 'DONE' | 'CURRENT' | 'BLOCKED' | 'STALE' | 'PENDING';
export interface LadderStep { stage: LadderStage; label: string; status: LadderStatus; detail: string }
/** Draft Plan → Validated Plan → Saved Plan → Prepared Plan → Armed Plan → Executed Plan, each with its own status. */
export function planLadder(i: OperatorInputs & { executed?: string | null }): LadderStep[] {
  const steps: LadderStep[] = [];
  const draftOk = !i.draftProblems.length && !i.liveSaveProblems.length;
  steps.push({ stage: 'DRAFT', label: 'Draft plan', status: draftOk ? 'DONE' : 'BLOCKED',
    detail: draftOk ? 'Compiles to an exact plan' : i.draftProblems.length ? plural(i.draftProblems.length, 'problem') + ' to fix' : i.liveSaveProblems[0]! });
  const runtime = i.runtime.status;
  steps.push({ stage: 'VALIDATED', label: 'Validated plan', status: !draftOk ? 'PENDING' : runtime === 'VALID' ? 'DONE' : runtime === 'INVALID' ? 'BLOCKED' : runtime === 'PENDING' ? 'CURRENT' : 'PENDING',
    detail: !draftOk ? 'After the draft compiles' : runtime === 'VALID' ? 'Release configuration accepts it' : runtime === 'INVALID' ? (i.runtime.problems[0] ?? 'Rejected by the release configuration') : runtime === 'PENDING' ? 'Checking…' : 'Checked again when saved' });
  const match = i.savedPlan.matchesDraft;
  steps.push({ stage: 'SAVED', label: 'Saved plan', status: match === true ? 'DONE' : !draftOk ? 'PENDING' : i.savedPlan.exists && match === false ? 'STALE' : 'PENDING',
    detail: match === true ? 'This exact plan is the release authorization' : !draftOk ? (i.savedPlan.exists ? 'The saved plan is unchanged until this draft is valid and saved' : 'After the draft is valid')
      : i.savedPlan.exists && match === false ? `Saved plan differs from this draft (${plural(i.savedPlan.differences, 'change')})` : i.savedPlan.exists ? 'Comparing with the saved plan…' : 'Not saved yet' });
  steps.push({ stage: 'PREPARED', label: 'Prepared plan', status: i.prepared.forSavedPlan ? 'DONE' : i.prepared.forOtherPlan ? 'STALE' : i.operation === 'prepare' ? 'CURRENT' : 'PENDING',
    detail: i.prepared.forSavedPlan ? 'Browsers prepared for the saved plan' : i.prepared.forOtherPlan ? 'Prepared for an older plan — prepare again' : i.operation === 'prepare' ? 'Preparing…' : 'Not prepared' });
  steps.push({ stage: 'ARMED', label: 'Armed plan', status: i.armed || i.running ? 'DONE' : 'PENDING', detail: i.armed || i.running ? 'Exact authorization frozen' : 'Not armed' });
  steps.push({ stage: 'EXECUTED', label: 'Executed plan', status: i.running ? 'CURRENT' : i.executed ? 'DONE' : 'PENDING', detail: i.running ? 'Running' : i.executed ?? 'Not run' });
  return steps;
}

// ── Readiness layers ─────────────────────────────────────────────────────────────────────────────────────────
// Five separate claims. None of them implies another: a valid plan is not a prepared environment, a favorable
// forecast is not live security readiness, and nothing here predicts a provider outcome.
export type LayerStatus = 'OK' | 'WARN' | 'BLOCKED' | 'PENDING' | 'NA';
export interface ReadinessLayer { id: 'PLAN' | 'ENVIRONMENT' | 'FORECAST' | 'SECURITY' | 'ARMED' | 'RUNTIME'; label: string; status: LayerStatus; detail: string }
export interface ReadinessInputs {
  plan: { problems: number; runtime: RuntimeValidation; saved: boolean };
  environment: { prepared: boolean; forOtherPlan: boolean; required: number; connected: number; identityIssues: number };
  forecast: { verdict: ForecastVerdict; ready: number; configured: number; atRisk: number; omitted: number; measured: boolean; samples: number;
    /** Which forecast this is (capacity before preparation, or live over connected browsers) and what limits it. */ basis?: string; limits?: string[] } | null;
  security: { planned: number; ready: number; preparing: number; failed: number; omitted: number; leadMs: number | null } | null;
  /** Pre-release security check (genuine verification minutes before release); only PASSED is evidence. */
  securityCheck?: { status: 'PASSED' | 'FAILED' | 'STALE' | 'OTHER_PLAN' | 'MISSING'; detail: string } | null;
  armed: { armed: boolean; running: boolean };
  readinessBlockers?: readonly { reason: string }[];
}
export function readinessLayers(i: ReadinessInputs): ReadinessLayer[] {
  const layers: ReadinessLayer[] = [];
  const planOk = !i.plan.problems && i.plan.runtime !== 'INVALID';
  layers.push({ id: 'PLAN', label: 'Plan valid', status: !planOk ? 'BLOCKED' : i.plan.runtime === 'VALID' && i.plan.saved ? 'OK' : 'PENDING',
    detail: i.plan.problems ? `${plural(i.plan.problems, 'problem')} to fix` : i.plan.runtime === 'INVALID' ? 'Rejected by the release configuration' : !i.plan.saved ? 'Valid draft · not saved as the release plan' : i.plan.runtime === 'VALID' ? 'Exact plan compiles and is the saved release plan' : 'Saved · validating' });
  const e = i.environment;
  layers.push({ id: 'ENVIRONMENT', label: 'Environment prepared', status: e.forOtherPlan ? 'BLOCKED' : !e.prepared ? 'PENDING' : e.connected < e.required || e.identityIssues ? 'BLOCKED' : 'OK',
    detail: e.forOtherPlan ? 'Prepared for an older plan — prepare again' : !e.prepared ? 'Not prepared' : `${e.connected}/${e.required} browsers connected${e.identityIssues ? ` · ${plural(e.identityIssues, 'identity issue')}` : ''} · sessions checked during preparation` });
  const f = i.forecast;
  if (i.readinessBlockers?.length) layers.push({ id: 'RUNTIME', label: 'Release checks', status: 'BLOCKED', detail: i.readinessBlockers.map(b => b.reason).join('; ') });
  layers.push(!f || f.verdict === 'NOT_APPLICABLE' ? { id: 'FORECAST', label: 'Timing forecast', status: 'NA', detail: 'No staged preparation forecast applies to this plan' }
    : { id: 'FORECAST', label: 'Timing forecast', status: f.verdict === 'READY' ? 'OK' : f.verdict === 'AT_RISK' ? 'WARN' : 'BLOCKED',
      detail: f.verdict === 'UNAVAILABLE' ? 'Forecast unavailable' : `${f.ready}/${f.configured} predicted ready${f.atRisk ? ` · ${f.atRisk} at risk` : ''}${f.omitted ? ` · ${f.omitted} predicted omitted` : ''}${f.limits?.length ? ` (limited by ${[...new Set(f.limits)].join(', ')})` : ''}${f.basis ? ` · ${f.basis}` : ''} · ${f.measured ? `${plural(f.samples, 'measured sample')}` : 'fallback estimate'} · a forecast is not proof of security readiness` });
  const s = i.security, check = i.securityCheck;
  layers.push(!s || (!s.ready && !s.preparing && !s.failed && !s.omitted)
    ? !(i.armed.armed || i.armed.running) && check
      ? { id: 'SECURITY', label: 'Security check', status: check.status === 'PASSED' ? 'OK' : check.status === 'FAILED' ? 'BLOCKED' : 'PENDING',
        detail: check.status === 'PASSED' ? `Pre-release check passed · ${check.detail} · the run still acquires its own fresh verification shortly before release`
          : check.status === 'FAILED' ? `Pre-release check failed · ${check.detail}` : `${check.detail} Run the security check (nothing is submitted).` }
      : { id: 'SECURITY', label: 'Live security', status: 'PENDING', detail: i.armed.armed || i.armed.running ? `Not started yet${s?.leadMs ? ` · starts about ${Math.round(s.leadMs / 1000)} s before the first trigger` : ''}` : 'Not started · runs only after arming, shortly before the first trigger. A dry run or forecast does not prove it will succeed.' }
    : { id: 'SECURITY', label: 'Live security', status: s.failed || s.omitted ? 'BLOCKED' : s.ready >= s.planned ? 'OK' : 'WARN',
      detail: `${s.ready}/${s.planned} ready${s.preparing ? ` · ${s.preparing} preparing` : ''}${s.failed ? ` · ${s.failed} failed` : ''}${s.omitted ? ` · ${s.omitted} omitted` : ''} · actual evidence for this run` });
  layers.push({ id: 'ARMED', label: 'Armed', status: i.armed.running ? 'OK' : i.armed.armed ? 'OK' : 'PENDING', detail: i.armed.running ? 'Running' : i.armed.armed ? 'Exact plan authorized and waiting for its scheduled time' : 'Not armed' });
  return layers;
}
/** One honest sentence: never "fully ready" from a forecast alone. */
export function readinessSummary(layers: readonly ReadinessLayer[]): string {
  // Reports the earliest stage that is not complete, so an unprepared plan never leads with a later-stage claim.
  const by = (id: ReadinessLayer['id']) => layers.find(l => l.id === id)!;
  const plan = by('PLAN'), env = by('ENVIRONMENT'), forecast = by('FORECAST'), security = by('SECURITY'), armed = by('ARMED');
  if (plan.status !== 'OK') return `${plan.label}: ${plan.detail}`;
  if (armed.status === 'OK') return security.status === 'OK' ? 'Armed · live security ready for every planned attempt' : security.status === 'BLOCKED' ? `Armed · live security: ${security.detail}` : 'Armed · live security has not yet been verified for every attempt';
  if (env.status === 'BLOCKED') return `${env.label}: ${env.detail}`;
  if (env.status !== 'OK') return `Saved plan is valid · not prepared yet${forecast.status === 'BLOCKED' ? ` · forecast: ${forecast.detail}` : ''}`;
  const runtime = layers.find(l => l.id === 'RUNTIME');
  if (runtime?.status === 'BLOCKED') return `${runtime.label}: ${runtime.detail}`;
  if (forecast.status === 'BLOCKED') return `Prepared · forecast: ${forecast.detail}`;
  if (security.label === 'Security check' && security.status === 'BLOCKED') return `Prepared · ${security.detail}`;
  return `Prepared${forecast.status === 'OK' ? ' · forecast feasible' : forecast.status === 'WARN' ? ' · forecast at risk' : ''} · ${security.label === 'Security check' && security.status === 'OK'
    ? 'pre-release security check passed; live security is verified again after arming' : 'live security is verified only after arming'}`;
}
