import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validatePrecisionFleet } from '../../src/api-booking/fleet-validation.js';
import { DurableSubmissionJournal } from '../../src/api-booking/durable-submission-journal.js';
import { LocalCustomerError } from '../../src/api-booking/local-customer.js';
import { validatePrecisionTargets } from '../../src/api-booking/precision-race.js';
import { planWorkerIds, type WorkerId } from '../../src/workers.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const customer = (customerId: string) => ({ clientId: 'client', customerId, customerEmail: 'x@example.invalid', customerPhone: '09123456789', customerFirstName: 'F', customerLastName: 'P' });
const loader = (ids: Partial<Record<WorkerId, string>>) => (worker: WorkerId) => {
  const value = ids[worker]; if (!value) throw new LocalCustomerError(`LOCAL_PLAYER_${worker}_CUSTOMER_ID_UNVERIFIED`); return customer(value);
};
const AG = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const satisfies readonly WorkerId[];
const unique = Object.fromEntries(AG.map((worker, index) => [worker, id(index + 1)])) as Record<WorkerId, string>;
const allUp = async () => true;
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'fleet-')); });
afterEach(async () => { if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw Error('UNSAFE_TEST_PATH'); await rm(root, { recursive: true, force: true }); });

describe('Precision fleet validation (A-G together)', () => {
  it('seven unique, bound identities with browsers and clear journals -> 7/7 ready', async () => {
    const report = await validatePrecisionFleet({ workers: AG, loadCustomer: loader(unique), browserAvailable: allUp, journalReadiness: async () => 'unused',
      targetKeys: new Map(AG.map(worker => [worker, 'a'.repeat(64)])) });
    expect(report).toMatchObject({ activeWorkers: 7, uniqueValidIds: 7, readyWorkers: 7 });
    expect(report.workers.every(worker => worker.identity === 'VALID' && worker.security === 'SUPPORTED')).toBe(true);
  });

  it('B duplicating A excludes only B; a legitimately distinct B is valid', async () => {
    const duplicate = await validatePrecisionFleet({ workers: AG, loadCustomer: loader({ ...unique, B: unique.A }), browserAvailable: allUp, journalReadiness: async () => 'unused' });
    expect(duplicate.workers.find(worker => worker.workerId === 'B')).toMatchObject({ identity: 'DUPLICATE_ONDA_CUSTOMER_ID', duplicateOf: 'A', ready: false });
    expect(duplicate).toMatchObject({ uniqueValidIds: 6, readyWorkers: 6 });
    const fixed = await validatePrecisionFleet({ workers: AG, loadCustomer: loader({ ...unique, B: id(42) }), browserAvailable: allUp, journalReadiness: async () => 'unused' });
    expect(fixed.workers.find(worker => worker.workerId === 'B')).toMatchObject({ identity: 'VALID', ready: true });
  });

  it('a missing browser or a blocked journal makes only that worker not ready', async () => {
    const report = await validatePrecisionFleet({ workers: ['A', 'B', 'C'], loadCustomer: loader(unique), browserAvailable: async worker => worker !== 'B',
      targetKeys: new Map([['C', 'c'.repeat(64)]]), journalReadiness: async () => 'blocked' });
    expect(report.workers.map(worker => [worker.workerId, worker.browser, worker.journal, worker.ready])).toEqual([
      ['A', 'AVAILABLE', 'NOT_CHECKED', true], ['B', 'UNAVAILABLE', 'NOT_CHECKED', false], ['C', 'AVAILABLE', 'blocked', false]]);
  });

  it('an unused worker with a duplicate never blocks the active plan and is never loaded', async () => {
    const active = planWorkerIds({ RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: [1, 2, 3, 4], BOOKING_TYPE: 'standard', COURT_COUNT: 1 });
    const loaded: string[] = [];
    const report = await validatePrecisionFleet({ workers: active, browserAvailable: allUp, journalReadiness: async () => 'unused',
      loadCustomer: worker => { loaded.push(worker); return loader({ ...unique, H: unique.A, G: unique.A })(worker); } });
    expect(loaded).toEqual(['A', 'B', 'C', 'D']);
    expect(report.readyWorkers).toBe(4);
  });

  it('H is never a Precision worker (security preparation unsupported)', async () => {
    const report = await validatePrecisionFleet({ workers: ['H'], loadCustomer: loader({ H: id(8) }), browserAvailable: allUp, journalReadiness: async () => 'unused' });
    expect(report.workers[0]).toMatchObject({ security: 'UNSUPPORTED', ready: false });
  });

  it('reads journals without changing them (reusable, blocked, unused)', async () => {
    const target = validatePrecisionTargets([{ court: 3, start: '15:00', durationHours: 3 }], '2026-09-26')[0]!;
    const journal = new DurableSubmissionJournal(join(root, target.targetKey));
    expect(await journal.peekDisposition(target.targetKey)).toBe('unused');
    await journal.begin(target.targetKey, new Date(), { attemptId: target.targetKey, planFingerprint: target.targetKey, targetDate: '2026-09-26',
      courtIds: [3], hourlyBoundaries: [], expectedBookingCount: 3, maximumAmount: 2000, stage: 'dispatching' });
    expect(await journal.peekDisposition(target.targetKey)).toBe('blocked');
    await journal.mark(target.targetKey, 'rejected', new Date(), undefined, undefined, 'ONDA_HTTP_STATUS_INVALID');
    expect(await journal.peekDisposition(target.targetKey)).toBe('reusable');
    expect((await journal.read(target.targetKey)).state).toBe('rejected'); // still in place: nothing was archived
  });

  it('reports worker letters and codes only, never a customer ID', async () => {
    const report = await validatePrecisionFleet({ workers: AG, loadCustomer: loader({ ...unique, B: unique.A }), browserAvailable: allUp, journalReadiness: async () => 'unused' });
    expect(JSON.stringify(report)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
});
