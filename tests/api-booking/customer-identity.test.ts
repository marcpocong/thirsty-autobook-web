import { describe, expect, it } from 'vitest';
import { assertActiveCustomersValid, customerIdentityProblem, DUPLICATE_ONDA_CUSTOMER_ID, resolveActiveCustomers, type CustomerIdentityResult } from '../../src/api-booking/customer-identity.js';
import { dispatchPrecisionRace, freezePrecisionRace, precisionTargetPlan, reducePrecisionOutcome, validatePrecisionTargets } from '../../src/api-booking/precision-race.js';
import { planWorkerIds, requiredWorkerIds, type WorkerId } from '../../src/workers.js';
import { LocalCustomerError } from '../../src/api-booking/local-customer.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const customer = (customerId: string) => ({ clientId: 'client', customerId, customerEmail: 'x@example.invalid', customerPhone: '09123456789', customerFirstName: 'F', customerLastName: 'P' });
const loader = (ids: Partial<Record<WorkerId, string | Error>>) => (worker: WorkerId) => {
  const value = ids[worker];
  if (value instanceof Error) throw value;
  if (!value) throw new LocalCustomerError(`LOCAL_PLAYER_${worker}_CUSTOMER_ID_UNVERIFIED`);
  return customer(value);
};
const AG = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const satisfies readonly WorkerId[];
const summary = (results: CustomerIdentityResult[]) => results.map(result => result.ok ? `${result.worker}:ok` : `${result.worker}:${result.code}${result.duplicateOf ? `>${result.duplicateOf}` : ''}`);

describe('active-worker Onda customer-ID uniqueness', () => {
  it('unique A-G IDs -> all valid', () => {
    const results = resolveActiveCustomers(AG, loader(Object.fromEntries(AG.map((w, i) => [w, id(i + 1)]))));
    expect(summary(results)).toEqual(AG.map(w => `${w}:ok`));
  });
  it('A/B duplicate -> A keeps the ID, B fails, C-G unaffected', () => {
    const results = resolveActiveCustomers(AG, loader({ A: id(1), B: id(1), C: id(3), D: id(4), E: id(5), F: id(6), G: id(7) }));
    expect(summary(results)).toEqual(['A:ok', `B:${DUPLICATE_ONDA_CUSTOMER_ID}>A`, 'C:ok', 'D:ok', 'E:ok', 'F:ok', 'G:ok']);
  });
  it('B/C duplicate -> B valid, C fails deterministically regardless of input order', () => {
    const ids = { A: id(1), B: id(2), C: id(2), D: id(4) };
    expect(summary(resolveActiveCustomers(['D', 'C', 'B', 'A'], loader(ids)))).toEqual(['A:ok', 'B:ok', `C:${DUPLICATE_ONDA_CUSTOMER_ID}>B`, 'D:ok']);
  });
  it('multiple duplicate pairs resolve to the first owner of each ID', () => {
    const results = resolveActiveCustomers(AG, loader({ A: id(1), B: id(1), C: id(3), D: id(3), E: id(3), F: id(6), G: id(1) }));
    expect(summary(results)).toEqual(['A:ok', `B:${DUPLICATE_ONDA_CUSTOMER_ID}>A`, 'C:ok', `D:${DUPLICATE_ONDA_CUSTOMER_ID}>C`,
      `E:${DUPLICATE_ONDA_CUSTOMER_ID}>C`, 'F:ok', `G:${DUPLICATE_ONDA_CUSTOMER_ID}>A`]);
  });
  it('compares IDs case-insensitively', () => {
    expect(summary(resolveActiveCustomers(['A', 'B'], loader({ A: id(1), B: id(1).toUpperCase() })))).toEqual(['A:ok', `B:${DUPLICATE_ONDA_CUSTOMER_ID}>A`]);
  });
  it('a duplicate belonging only to an unused worker does not affect the active plan', () => {
    const ids = { A: id(1), B: id(2), C: id(3), H: id(1) };
    const active = planWorkerIds({ RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: [1, 2, 3], BOOKING_TYPE: 'standard', COURT_COUNT: 1 });
    expect(summary(resolveActiveCustomers(active, loader(ids)))).toEqual(['A:ok', 'B:ok', 'C:ok']);
    // Stale configuration of an unused worker is not even loaded.
    const loaded: string[] = [];
    resolveActiveCustomers(['A'], worker => { loaded.push(worker); return customer(id(1)); });
    expect(loaded).toEqual(['A']);
  });
  it('General: a duplicate between two required workers fails closed', () => {
    const results = resolveActiveCustomers(requiredWorkerIds('standard', 3), loader({ A: id(1), B: id(1) }));
    expect(() => assertActiveCustomersValid(results)).toThrow(DUPLICATE_ONDA_CUSTOMER_ID);
    expect(Object.keys(assertActiveCustomersValid(resolveActiveCustomers(['A', 'B'], loader({ A: id(1), B: id(2) }))))).toEqual(['A', 'B']);
  });
  it('an existing contact-binding failure is reported unchanged and never claims an ID', () => {
    const results = resolveActiveCustomers(['A', 'B', 'C'], loader({ A: new LocalCustomerError('LOCAL_CUSTOMER_ID_UNVERIFIED'), B: id(1), C: id(1) }));
    expect(summary(results)).toEqual(['A:LOCAL_CUSTOMER_ID_UNVERIFIED', 'B:ok', `C:${DUPLICATE_ONDA_CUSTOMER_ID}>B`]);
    expect(() => assertActiveCustomersValid(results)).toThrow('LOCAL_CUSTOMER_ID_UNVERIFIED');
  });
  it('never exposes a customer ID in failures or operator text', () => {
    const secret = id(424242);
    const results = resolveActiveCustomers(['A', 'B'], loader({ A: secret, B: secret }));
    const failure = results.find(result => !result.ok)!;
    expect(failure.ok).toBe(false);
    if (failure.ok) return;
    expect(JSON.stringify(failure)).not.toContain(secret);
    expect(customerIdentityProblem(failure)).toBe('Worker B — customer identity invalid: duplicates Worker A');
    let thrown = '';
    try { assertActiveCustomersValid(results); } catch (error) { thrown = String((error as Error).message); }
    expect(thrown).toBe(DUPLICATE_ONDA_CUSTOMER_ID);
  });
  it('Precision still dispatches every remaining independently valid worker (B duplicate only disables B)', async () => {
    const date = '2026-09-26', releaseMs = Date.parse('2026-09-24T00:00:00.000Z');
    const identities = resolveActiveCustomers(AG, loader({ A: id(1), B: id(1), C: id(3), D: id(4), E: id(5), F: id(6), G: id(7) }));
    const valid = new Set(identities.filter(result => result.ok).map(result => result.worker));
    const targets = validatePrecisionTargets([1, 2, 3, 4, 5, 6, 7].map(court => ({ court, start: '17:00', durationHours: 3 })), date)
      .filter(target => valid.has(target.workerId));
    const race = freezePrecisionRace(date, releaseMs, targets.map(target => ({ target, plan: precisionTargetPlan(target, date) })));
    let now = releaseMs - 20_000;
    const dispatched: string[] = [];
    const results = await dispatchPrecisionRace(race, { now: () => now, prewarmLeadMs: 15_000, prewarm: async () => undefined,
      waitUntil: async at => { await new Promise(resolve => setTimeout(resolve, 0)); now = Math.max(now, at); },
      dispatch: async attempt => { dispatched.push(attempt.target.workerId); return { state: attempt.target.workerId === 'C' ? 'QR_READY' : 'REJECTED' }; } });
    expect(dispatched.sort()).toEqual(['A', 'C', 'D', 'E', 'F', 'G']);
    expect(reducePrecisionOutcome([...results.map(result => result.state), 'IDENTITY_FAILED']))
      .toMatchObject({ outcome: 'OBJECTIVE_ACHIEVED', unsentCount: 1 });
  });
});
