import { resolve } from 'node:path';
import { loadConfig, loadObservationConfig } from './config.js';
import { browserIdentity } from './browser.js';
import { clockStatus } from '../ui/status.js';
import { DurableSubmissionJournal } from './api-booking/durable-submission-journal.js';
import { validatePrecisionTargets } from './api-booking/precision-race.js';
import { validatePrecisionFleet } from './api-booking/fleet-validation.js';
import { PRECISION_WORKER_IDS, type WorkerId } from './workers.js';

/**
 * Read-only Precision fleet readiness for the saved plan's exact active workers
 * (or every A-G worker with --all). Prints worker letters and codes only: no
 * customer ID, contact hash, name, phone or email. Never launches a browser,
 * never writes a journal or the lock.
 */
const all = process.argv.includes('--all');
const result: Record<string, unknown> = {};
try {
  const config = loadConfig(), next = clockStatus(loadObservationConfig());
  const targets = config.RELEASE_STRATEGY === 'precision' ? validatePrecisionTargets(config.PRECISION_TARGETS, next.targetDate) : [];
  const workers: WorkerId[] = all ? [...PRECISION_WORKER_IDS] : targets.map(target => target.workerId);
  Object.assign(result, { releaseStrategy: config.RELEASE_STRATEGY, targetDate: next.targetDate, scope: all ? 'ALL_A_G' : 'ACTIVE_PLAN',
    targets: targets.map(target => ({ workerId: target.workerId, court: target.court, start: target.start, end: target.end })) });
  const probe = async (worker: WorkerId) => {
    try {
      const response = await fetch(`http://127.0.0.1:${browserIdentity(worker).port}/json/version`, { signal: AbortSignal.timeout(1500), redirect: 'error' });
      const data = await response.json() as { Browser?: string };
      return response.ok && typeof data.Browser === 'string' && data.Browser.startsWith('Chrome/');
    } catch { return false; }
  };
  const report = await validatePrecisionFleet({ workers, browserAvailable: probe,
    targetKeys: new Map(targets.map(target => [target.workerId, target.targetKey])),
    journalReadiness: key => new DurableSubmissionJournal(resolve('.local/api-booking/api-first-journals', key)).peekDisposition(key) });
  Object.assign(result, report);
} catch (error) {
  const message = (error as Error).message;
  result.blocker = /^[A-Z][A-Z0-9_]{0,79}$/.test(message) ? message : 'FLEET_VALIDATION_FAILED';
}
console.log(JSON.stringify(result, null, 2));
