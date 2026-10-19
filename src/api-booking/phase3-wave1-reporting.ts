import type { ApiStageFields } from '../ui-events.js';
import type { ArmedDispatchOutcome, ArmedPrecisionRace } from './armed-dispatch.js';
import type { PrecisionAttempt } from './precision-race.js';
import { safeApiFailureCode } from './run-observability.js';

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
