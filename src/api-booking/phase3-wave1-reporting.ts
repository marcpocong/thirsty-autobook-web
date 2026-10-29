import type { ApiStageFields } from '../ui-events.js';
import type { ArmedDispatchOutcome, ArmedPrecisionRace } from './armed-dispatch.js';
import type { PrecisionAttempt } from './precision-race.js';
import { safeApiFailureCode } from './run-observability.js';
import { PRECISION_UNSENT_STATES } from './precision-race.js';
import type { RaceAttempt, PrecisionSession } from './precision-phase3.js';

/** Reconcile the complete frozen result set, including children with no dispatch-start event.
 * Missing or duplicate results are an accounting error, never evidence of non-dispatch. */
export function reconcileWave1Attempts(session: PrecisionSession, frozen: readonly PrecisionAttempt[],
  results: ArmedDispatchOutcome['results'], fieldsFor: (child: PrecisionAttempt) => Pick<RaceAttempt, 'id' | 'candidateId' | 'workerId'>): void {
  const expected = new Set(frozen.map(child => child.id));
  if (expected.size !== frozen.length || results.length !== frozen.length || new Set(results.map(r => r.attempt.id)).size !== expected.size ||
    results.some(result => !expected.has(result.attempt.id))) throw Error('PHASE3_ACCOUNTING_INVALID');
  const identities=results.map(result=>fieldsFor(result.attempt));
  if(new Set(identities.map(value=>value.id)).size!==results.length||identities.some(identity=>{
    const existing=session.attempts.find(value=>value.id===identity.id);
    return existing&&(existing.candidateId!==identity.candidateId||existing.workerId!==identity.workerId||existing.wave!=='WAVE_1');
  }))throw Error('PHASE3_ACCOUNTING_INVALID');
  for (const result of results) {
    const child = result.attempt, identity = fieldsFor(child);
    const state: RaceAttempt['state'] = PRECISION_UNSENT_STATES.has(result.state) ? 'NOT_DISPATCHED' :
      result.state === 'REJECTED' ? 'REJECTED' : result.state === 'QR_READY' || result.state === 'HOLD_VERIFIED_QR_ATTENTION' ? 'VERIFIED' : 'UNKNOWN';
    const existing = session.attempts.find(a => a.id === identity.id);
    if (existing) existing.state = state;
    else session.record({ ...identity, wave: 'WAVE_1', state, fanOutIndex: child.fanOutIndex, fanOutCount: child.fanOutCount });
  }
}

export function phase3AttemptCounts(attempts: readonly RaceAttempt[]) {
  if (new Set(attempts.map(a => a.id)).size !== attempts.length) throw Error('PHASE3_ACCOUNTING_INVALID');
  const count = (state: RaceAttempt['state']) => attempts.filter(a => a.state === state).length;
  const unsentCount = count('NOT_DISPATCHED'), pendingCount = count('IN_FLIGHT');
  return { attemptCount: attempts.length, sentCount: attempts.length - unsentCount - pendingCount, settledCount: attempts.length - pendingCount,
    pendingCount, unsentCount, unknownCount: count('UNKNOWN'), rejectedCount: count('REJECTED'), verifiedCount: count('VERIFIED') };
}

interface Wave1Reporting {
  fieldsFor: (child: PrecisionAttempt) => ApiStageFields;
  stage: (name: 'PHASE3_WAVE1_UNSENT', fields: ApiStageFields) => void;
  releaseBinding: (child: PrecisionAttempt) => void;
}

/** Report conclusive local non-dispatch after coordinator failure; never reinterpret a fired child. */
export async function dispatchPhase3Wave1(armed: ArmedPrecisionRace,
  dispatch: () => Promise<ArmedDispatchOutcome>, reporting: Wave1Reporting): Promise<ArmedDispatchOutcome> {
  try { return await dispatch(); }
  catch (error) {
    const fallback = safeApiFailureCode(error, 'ARMED_NOT_DISPATCHED');
    const unsent = await Promise.all(armed.attempts.filter(attempt => attempt.state !== 'fired').map(async attempt => {
      // The coordinator may already have expired one child with a different reason before Stop or refresh failure.
      const record = await attempt.journal.read(attempt.key).catch(() => undefined);
      const code = record?.state === 'rejected' && record.failureCode && /^[A-Z][A-Z0-9_]{0,79}$/.test(record.failureCode)
        ? record.failureCode : fallback;
      return { child: attempt.attempt, state: 'NOT_DISPATCHED' as const, code };
    }));
    const reported = new Set<string>();
    for (const { child, state, code } of [...unsent, ...armed.unarmed.map(value => ({ child: value.attempt, state: value.state, code: value.code }))]) {
      if (reported.has(child.id) || armed.attempts.some(attempt => attempt.attempt.id === child.id && attempt.state === 'fired')) continue;
      reported.add(child.id);
      try { reporting.stage('PHASE3_WAVE1_UNSENT', { ...reporting.fieldsFor(child), workerId: child.target.workerId,
        state, code, fanOutIndex: child.fanOutIndex, fanOutCount: child.fanOutCount }); }
      catch { /* Reporting must not replace the coordinator failure or prevent remaining cleanup. */ }
      try { reporting.releaseBinding(child); } catch { /* Preserve the original failure and continue other bindings. */ }
    }
    throw error;
  }
}
