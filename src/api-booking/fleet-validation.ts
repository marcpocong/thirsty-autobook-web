import { resolveActiveCustomers } from './customer-identity.js';
import type { CheckoutCustomer } from './two-hour-reservation.js';
import { PRECISION_WORKER_IDS, type WorkerId } from '../workers.js';

export type JournalReadiness = 'unused' | 'reusable' | 'blocked';
export interface FleetWorkerReport {
  workerId: WorkerId;
  /** 'VALID' or the failure code (never a customer ID). */
  identity: string;
  duplicateOf?: WorkerId;
  browser: 'AVAILABLE' | 'UNAVAILABLE';
  journal: JournalReadiness | 'NOT_CHECKED';
  security: 'SUPPORTED' | 'UNSUPPORTED';
  ready: boolean;
}
export interface FleetReport {
  workers: FleetWorkerReport[];
  activeWorkers: number;
  uniqueValidIds: number;
  readyWorkers: number;
}
export interface FleetValidationInput {
  workers: readonly WorkerId[];
  /** Journal key of each worker's currently configured Precision target, when one exists. */
  targetKeys?: ReadonlyMap<WorkerId, string>;
  loadCustomer?: (worker: WorkerId) => CheckoutCustomer;
  browserAvailable: (worker: WorkerId) => Promise<boolean>;
  journalReadiness: (key: string) => Promise<JournalReadiness>;
  /** Whether the page-bound checkout security preparation exists for this worker (A-G yes, H never). */
  securitySupported?: (worker: WorkerId) => boolean;
}

/**
 * One read-only readiness pass over exactly the given workers: contact binding,
 * unique Onda customer ID (first in A-H order keeps a shared ID), dedicated browser
 * reachable, no blocking journal for the configured target, security preparation
 * supported. It never launches or navigates a browser, writes a journal, or prints an ID.
 */
export async function validatePrecisionFleet(input: FleetValidationInput): Promise<FleetReport> {
  const identities = resolveActiveCustomers(input.workers, input.loadCustomer);
  const security = input.securitySupported ?? ((worker: WorkerId) => PRECISION_WORKER_IDS.includes(worker));
  const workers = await Promise.all(identities.map(async (identity): Promise<FleetWorkerReport> => {
    const worker = identity.worker, key = input.targetKeys?.get(worker);
    const [browser, journal] = await Promise.all([
      input.browserAvailable(worker).catch(() => false),
      key ? input.journalReadiness(key).catch(() => 'blocked' as const) : Promise.resolve('NOT_CHECKED' as const),
    ]);
    const report: FleetWorkerReport = { workerId: worker, identity: identity.ok ? 'VALID' : identity.code,
      ...(!identity.ok && identity.duplicateOf ? { duplicateOf: identity.duplicateOf } : {}),
      browser: browser ? 'AVAILABLE' : 'UNAVAILABLE', journal, security: security(worker) ? 'SUPPORTED' : 'UNSUPPORTED', ready: false };
    report.ready = identity.ok && browser && journal !== 'blocked' && report.security === 'SUPPORTED';
    return report;
  }));
  return { workers, activeWorkers: workers.length, uniqueValidIds: identities.filter(identity => identity.ok).length,
    readyWorkers: workers.filter(worker => worker.ready).length };
}
