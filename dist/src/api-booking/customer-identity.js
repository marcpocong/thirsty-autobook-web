import { WORKER_IDS } from '../workers.js';
import { loadLocalCheckoutCustomer } from './local-customer.js';
export const DUPLICATE_ONDA_CUSTOMER_ID = 'DUPLICATE_ONDA_CUSTOMER_ID';
/**
 * Loads and validates the Onda customer identity of every worker the CURRENT run
 * needs, and nothing else. Each worker must pass its own contact binding, and no
 * two active workers may share one Onda customer ID. Duplicates resolve in A->H
 * order: the first worker keeps the ID, every later one fails with
 * DUPLICATE_ONDA_CUSTOMER_ID. A worker whose own binding fails never claims an ID.
 * Results carry codes and worker letters only, never a customer ID.
 */
export function resolveActiveCustomers(workers, load = loadLocalCheckoutCustomer) {
    const ordered = [...new Set(workers)].sort((a, b) => WORKER_IDS.indexOf(a) - WORKER_IDS.indexOf(b));
    const owners = new Map();
    return ordered.map(worker => {
        let customer;
        try {
            customer = load(worker);
        }
        catch (error) {
            const code = error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message) ? error.message : 'LOCAL_CUSTOMER_ID_UNVERIFIED';
            return { worker, ok: false, code };
        }
        const id = customer.customerId.trim().toLowerCase();
        const owner = owners.get(id);
        if (owner)
            return { worker, ok: false, code: DUPLICATE_ONDA_CUSTOMER_ID, duplicateOf: owner };
        owners.set(id, worker);
        return { worker, ok: true, customer };
    });
}
/** Operator-facing text; never includes a customer ID. */
export function customerIdentityProblem(result) {
    return result.code === DUPLICATE_ONDA_CUSTOMER_ID && result.duplicateOf
        ? `Worker ${result.worker} — customer identity invalid: duplicates Worker ${result.duplicateOf}`
        : `Worker ${result.worker} — customer identity invalid: ${result.code}`;
}
/** General Release: every required worker is part of one booking, so any invalid identity fails closed. */
export function assertActiveCustomersValid(results) {
    const invalid = results.find((result) => !result.ok);
    if (invalid)
        throw Error(invalid.code);
    return Object.fromEntries(results.flatMap(result => result.ok ? [[result.worker, result.customer]] : []));
}
//# sourceMappingURL=customer-identity.js.map