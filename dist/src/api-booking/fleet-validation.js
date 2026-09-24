import { resolveActiveCustomers } from './customer-identity.js';
import { PRECISION_WORKER_IDS } from '../workers.js';
/**
 * One read-only readiness pass over exactly the given workers: contact binding,
 * unique Onda customer ID (first in A-H order keeps a shared ID), dedicated browser
 * reachable, no blocking journal for the configured target, security preparation
 * supported. It never launches or navigates a browser, writes a journal, or prints an ID.
 */
export async function validatePrecisionFleet(input) {
    const identities = resolveActiveCustomers(input.workers, input.loadCustomer);
    const security = input.securitySupported ?? ((worker) => PRECISION_WORKER_IDS.includes(worker));
    const workers = await Promise.all(identities.map(async (identity) => {
        const worker = identity.worker, key = input.targetKeys?.get(worker);
        const [browser, journal] = await Promise.all([
            input.browserAvailable(worker).catch(() => false),
            key ? input.journalReadiness(key).catch(() => 'blocked') : Promise.resolve('NOT_CHECKED'),
        ]);
        const report = { workerId: worker, identity: identity.ok ? 'VALID' : identity.code,
            ...(!identity.ok && identity.duplicateOf ? { duplicateOf: identity.duplicateOf } : {}),
            browser: browser ? 'AVAILABLE' : 'UNAVAILABLE', journal, security: security(worker) ? 'SUPPORTED' : 'UNSUPPORTED', ready: false };
        report.ready = identity.ok && browser && journal !== 'blocked' && report.security === 'SUPPORTED';
        return report;
    }));
    return { workers, activeWorkers: workers.length, uniqueValidIds: identities.filter(identity => identity.ok).length,
        readyWorkers: workers.filter(worker => worker.ready).length };
}
//# sourceMappingURL=fleet-validation.js.map