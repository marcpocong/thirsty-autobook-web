import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crowdRequests, simulateRelease, slotKeys, type ProviderModel, type SimRequest } from '../../src/arbitration/contention-sim.js';
import { evaluateCell, familyVerdicts, modelVariants, observedReleases, readFlushes, readOvertakes, scoreOutcomes, simulateDay,
  type CrowdVariant } from '../../src/arbitration/release-replay.js';

const fixed = (median: number) => ({ median, sigma: 0 });
const model = (overrides: Partial<ProviderModel> = {}): ProviderModel => ({ family: 'D_OPTIMISTIC', admissionLimit: Infinity, instances: Infinity,
  connectionsPerInstance: Infinity, lock: 'none', lockOrder: 'fifo', readsTakeLock: false, conflictRetries: 0, backoffBaseMs: 0, perIpLimit: Infinity,
  preLockMs: fixed(100), lockHoldMs: fixed(500), readMs: fixed(20), prooflessExtraMs: null, returnMs: fixed(10), ...overrides });
const checkout = (id: string, edgeMs: number, slots: string[], owner: 'us' | 'crowd' = 'us', ip = owner === 'us' ? 'us' : id): SimRequest => ({
  id, owner, kind: 'checkout', ip, sendMs: edgeMs, edgeMs, slots, court: Number(slots[0]!.split('@')[0]), proofless: owner === 'us' });
const read = (id: string, edgeMs: number, ip = 'us'): SimRequest => ({ id, owner: 'us', kind: 'read', ip, sendMs: edgeMs, edgeMs, slots: [], court: 0, proofless: false });
const evidence = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../diagnostics-archive/2026-09-25/arbitration/arbitration-evidence.json'), 'utf8'));

describe('contention simulator mechanics', () => {
  it('serializes a facility/date lock in arrival order and answers the first one 200, the rest 409', () => {
    const requests = [0, 1, 2, 3, 4].map(index => checkout(`r${index}`, index, slotKeys(3, '19:00', 3)));
    const outcomes = simulateRelease(model({ lock: 'facility-date' }), requests, 1);
    expect(outcomes.map(value => value.responseMs)).toEqual([610, 1_110, 1_610, 2_110, 2_610]);
    expect(outcomes.map(value => value.status)).toEqual([200, 409, 409, 409, 409]);
    expect(outcomes.map(value => value.lockWaitMs)).toEqual([0, 499, 998, 1_497, 1_996]);
  });

  it('optimistic concurrency answers a loser fast; retry with backoff answers it late', () => {
    const race = [checkout('crowd', 0, ['1@19'], 'crowd'), checkout('ours', 5, ['1@19'])];
    const optimistic = simulateRelease(model(), race, 1);
    expect(optimistic.map(value => [value.status, value.responseMs])).toEqual([[200, 610], [409, 615]]);
    const retried = simulateRelease(model({ conflictRetries: 3, backoffBaseMs: 1_000 }), race, 1).find(value => value.id === 'ours')!;
    expect(retried.status).toBe(409);
    expect(retried.attempts).toBe(4);
    expect(retried.responseMs).toBeGreaterThanOrEqual(605 + 3 * 600 + 0.5 * (1_000 + 2_000 + 4_000) + 10);
  });

  it('a per-IP limit serializes our own requests even on unrelated slots', () => {
    const ours = [checkout('a', 0, ['1@19']), checkout('b', 1, ['2@19'])];
    const free = simulateRelease(model(), ours, 1), limited = simulateRelease(model({ perIpLimit: 1 }), ours, 1);
    expect(free.map(value => value.responseMs)).toEqual([610, 611]);
    expect(limited.map(value => value.responseMs)).toEqual([610, 1_210]);
    expect(limited.map(value => value.status)).toEqual([200, 200]);
  });

  it('reads stuck behind a long transaction on a one-connection instance flush together', () => {
    const requests = [checkout('long', 0, ['1@19'], 'crowd'), read('r1', 1_000), read('r2', 3_000), read('r3', 5_000), read('r4', 7_000)];
    const outcomes = simulateRelease(model({ instances: 1, connectionsPerInstance: 1, preLockMs: fixed(5_000), lockHoldMs: fixed(5_000) }), requests, 1);
    const reads = outcomes.filter(value => value.kind === 'read');
    expect(reads.map(value => value.responseMs)).toEqual([10_030, 10_050, 10_070, 10_090]);
    expect(readFlushes(reads.map(value => ({ id: value.id, sendMs: value.sendMs, responseMs: value.responseMs })))).toBe(1);
    // With enough instances nothing waits: no flush.
    const spread = simulateRelease(model({ instances: Infinity, connectionsPerInstance: 1, preLockMs: fixed(5_000), lockHoldMs: fixed(5_000) }), requests, 1);
    expect(readFlushes(spread.filter(value => value.kind === 'read').map(value => ({ id: value.id, sendMs: value.sendMs, responseMs: value.responseMs })))).toBe(0);
  });

  it('processor sharing slows everything together instead of queueing', () => {
    const requests = [0, 1, 2, 3].map(index => checkout(`r${index}`, 0, [`${index + 1}@19`]));
    // Four 600 ms jobs on capacity 2: each runs at half speed, so all finish together at 1,200 ms (then +10 ms return).
    const outcomes = simulateRelease(model({ sharedCapacity: 2, preLockMs: fixed(0), lockHoldMs: fixed(600) }), requests, 1);
    expect(outcomes.map(value => Math.round(value.responseMs))).toEqual([1_210, 1_210, 1_210, 1_210]);
    expect(outcomes.every(value => value.status === 200)).toBe(true);
    // Unlimited capacity: plain 600 ms each.
    expect(simulateRelease(model({ preLockMs: fixed(0), lockHoldMs: fixed(600) }), requests, 1).map(value => value.responseMs)).toEqual([610, 610, 610, 610]);
  });

  it('a replica read path answers fast even while the current-data path is blocked', () => {
    const requests = [checkout('long', 0, ['1@19'], 'crowd'), ...Array.from({ length: 20 }, (_, index) => read(`r${index}`, 1_000 + index * 100))];
    const blocked = model({ instances: 1, connectionsPerInstance: 1, preLockMs: fixed(5_000), lockHoldMs: fixed(5_000) });
    const withReplica = simulateRelease({ ...blocked, replicaReadShare: 0.5 }, requests, 3).filter(value => value.kind === 'read');
    const fast = withReplica.filter(value => value.responseMs - value.sendMs < 100), stuck = withReplica.filter(value => value.responseMs >= 10_000);
    expect(fast.length).toBeGreaterThan(3);
    expect(stuck.length).toBeGreaterThan(3);
    expect(fast.length + stuck.length).toBe(20);
    expect(readOvertakes(withReplica.map(value => ({ sendMs: value.sendMs, responseMs: value.responseMs })))).toBeGreaterThan(0);
    // Replica reads still pass the edge: behind a per-IP limit of 1, nothing of ours can overtake.
    const serialized = simulateRelease({ ...blocked, replicaReadShare: 0.5, perIpLimit: 1 }, requests.map(value => ({ ...value, ip: 'us' })), 3)
      .filter(value => value.kind === 'read');
    expect(readOvertakes(serialized.map(value => ({ sendMs: value.sendMs, responseMs: value.responseMs })))).toBe(0);
  });

  it('is deterministic for a seed and changes with it', () => {
    const crowd = { checkouts: 40, arrivalMeanMs: 1_000, hotShare: 0.6, hotStartHours: [19], readsPerSecond: 10, readWindowMs: 20_000, oneWayMs: { median: 25, sigma: 0.3 } };
    expect(crowdRequests(crowd, 3)).toEqual(crowdRequests(crowd, 3));
    const variant = modelVariants().find(value => value.key === 'F_FACILITY_DATE_SERIAL:fifo,hold=600')!.model;
    const day = observedReleases(evidence)[0]!;
    const first = simulateDay(day, variant, crowd, 7);
    expect(simulateDay(day, variant, crowd, 7)).toEqual(first);
    expect(simulateDay(day, variant, crowd, 8)).not.toEqual(first);
    expect(first.every(value => Number.isFinite(value.responseMs))).toBe(true);
  });
});

describe('release replay scoring', () => {
  it('scores every observed day as a full match of its own signatures', () => {
    for (const day of observedReleases(evidence)) {
      const self = scoreOutcomes(day.signatures, day.checkouts, day.reads);
      expect({ day: day.label, full: self.full }).toEqual({ day: day.label, full: true });
    }
  });

  it('extracts the Sept 25 facts the replay depends on', () => {
    const [sep25] = observedReleases(evidence);
    expect(sep25!.checkouts.map(value => value.edgeMs)).toEqual([30, 31, 32, 31, 38, 32, 34]);
    expect(sep25!.checkouts.every(value => value.status === 409)).toBe(true);
    expect(readFlushes(sep25!.reads)).toBe(2);
    expect(readOvertakes(sep25!.reads)).toBeGreaterThan(0);
  });

  it('rejects the optimistic model on Sept 25 latency and keeps the verdict machinery honest', () => {
    const [sep25] = observedReleases(evidence);
    const crowd: CrowdVariant = { key: 'small', params: { checkouts: 40, arrivalMeanMs: 1_000, hotShare: 0.6, readsPerSecond: 10, readWindowMs: 45_000, oneWayMs: { median: 25, sigma: 0.3 } } };
    const optimistic = modelVariants().filter(value => value.key.startsWith('D_OPTIMISTIC:'));
    const cells = optimistic.map(variant => evaluateCell(sep25!, variant, crowd, [1, 2, 3]));
    expect(cells.every(cell => cell.signatureRates.latency === 0)).toBe(true);
    expect(familyVerdicts(sep25!.label, cells)[0]).toMatchObject({ family: 'D_OPTIMISTIC', verdict: 'NOT_REPRODUCED_IN_GRID' });
  });
});
