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
