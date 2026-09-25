import { clusters, kendallTau, seededRandom, summarize } from './stats.js';
import { crowdRequests, simulateRelease, slotKeys, type CrowdParams, type Dist, type ModelFamily, type ProviderModel, type SimOutcome,
  type SimRequest } from './contention-sim.js';

/**
 * Deterministic release replay: our real requests of a release day (send and edge times from the archive)
 * are replayed through every provider model of contention-sim.ts under a grid of crowd loads, and each run
 * is scored against that day's observed signatures. Output is COMPATIBILITY, not proof: a model that
 * reproduces every signature somewhere in the grid stays a hypothesis; a model that reproduces a signature
 * nowhere in the explored ranges is contradicted within those ranges (and only there).
 */

export interface ObservedCheckout { id: string; court: number; startTime: string; hours: number; sendMs: number; edgeMs: number; responseMs: number; status: number }
export interface ObservedRead { id: string; sendMs: number; responseMs: number }
export interface DaySignatures {
  /** Every one of our checkouts answered inside this window (ms after release). */
  latencyWindowMs: [number, number];
  /** Last minus first of our responses. */
  spreadWindowMs: [number, number] | null;
  /** Every one of our checkouts answered 409. */
  allConflict: boolean;
  /** Kendall tau of (edge arrival order, response order) of our checkouts, within ± tolerance. */
  arrivalOrderTau: { observed: number; tolerance: number } | null;
  /** At least one batch of ≥3 slow reads (≥2 s) completing back to back (gaps ≤150 ms), issued ≥3 s apart. */
  readFlush: boolean | null;
  /** A later read completes fast (<500 ms) while an earlier read is still stuck for ≥1 s more. */
  readOvertake: boolean | null;
}
export interface ObservedRelease {
  label: string;
  checkouts: ObservedCheckout[];
  reads: ObservedRead[];
  signatures: DaySignatures;
  hotStartHours: number[];
  provenance: string[];
}

export interface Signals {
  latency: boolean; conflict: boolean; spread: boolean | null; order: boolean | null; readFlush: boolean | null; readOvertake: boolean | null;
  score: number; applicable: number; full: boolean;
  metrics: { firstResponseMs: number | null; lastResponseMs: number | null; spreadMs: number | null; arrivalTau: number | null; conflicts: number; flushes: number; overtakes: number };
}

const FLUSH_SLOW_MS = 2_000, FLUSH_WINDOW_MS = 150, FLUSH_REQUEST_SPAN_MS = 3_000;

export function readFlushes(reads: ReadonlyArray<{ id: string; sendMs: number; responseMs: number }>): number {
  const slow = reads.filter(read => Number.isFinite(read.responseMs) && read.responseMs - read.sendMs >= FLUSH_SLOW_MS);
  const byId = new Map(slow.map(read => [read.id, read]));
  return clusters(slow.map(read => ({ id: read.id, at: read.responseMs })), FLUSH_WINDOW_MS).filter(cluster => {
    if (cluster.ids.length < 3) return false;
    const sends = cluster.ids.map(id => byId.get(id)!.sendMs);
    return Math.max(...sends) - Math.min(...sends) >= FLUSH_REQUEST_SPAN_MS;
  }).length;
}

export function readOvertakes(reads: ReadonlyArray<{ sendMs: number; responseMs: number }>, windowMs = 30_000): number {
  const inWindow = reads.filter(read => read.sendMs >= 0 && read.sendMs <= windowMs && Number.isFinite(read.responseMs));
  let count = 0;
  for (const late of inWindow) {
    if (late.responseMs - late.sendMs >= 500) continue;
    if (inWindow.some(early => early.sendMs < late.sendMs && early.responseMs >= late.responseMs + 1_000)) count++;
  }
  return count;
}

/** Scores our requests' outcomes (simulated, or the observed ones themselves) against a day's signatures. */
export function scoreOutcomes(signatures: DaySignatures, checkouts: ReadonlyArray<{ edgeMs: number; responseMs: number; status: number | null }>,
  reads: ReadonlyArray<{ id: string; sendMs: number; responseMs: number }>): Signals {
  const responses = checkouts.map(value => value.responseMs).filter(Number.isFinite);
  const first = responses.length ? Math.min(...responses) : null, last = responses.length ? Math.max(...responses) : null;
  const spreadMs = first === null || last === null ? null : last - first;
  const arrivalTau = kendallTau(checkouts.map(value => value.edgeMs), checkouts.map(value => value.responseMs));
  const conflicts = checkouts.filter(value => value.status === 409).length;
  const flushes = readFlushes(reads), overtakes = readOvertakes(reads);
  const [low, high] = signatures.latencyWindowMs;
  const latency = responses.length === checkouts.length && responses.every(value => value >= low && value <= high);
  const conflict = signatures.allConflict ? conflicts === checkouts.length : conflicts < checkouts.length;
  const spread = signatures.spreadWindowMs ? spreadMs !== null && spreadMs >= signatures.spreadWindowMs[0] && spreadMs <= signatures.spreadWindowMs[1] : null;
  const order = signatures.arrivalOrderTau ? arrivalTau !== null && Math.abs(arrivalTau - signatures.arrivalOrderTau.observed) <= signatures.arrivalOrderTau.tolerance : null;
  const readFlush = signatures.readFlush === null ? null : (flushes > 0) === signatures.readFlush;
  const readOvertake = signatures.readOvertake === null ? null : (overtakes > 0) === signatures.readOvertake;
  const checks = [latency, conflict, spread, order, readFlush, readOvertake].filter((value): value is boolean => value !== null);
  const score = checks.filter(Boolean).length;
  return { latency, conflict, spread, order, readFlush, readOvertake, score, applicable: checks.length, full: score === checks.length,
    metrics: { firstResponseMs: first, lastResponseMs: last, spreadMs, arrivalTau, conflicts, flushes, overtakes } };
}

// ---------------------------------------------------------------------------------------------------------
// Observed days, from the arbitration evidence written by scripts/analyze-release-arbitration.ts.

interface EvidenceFile {
  sep25: { attempts: Array<{ workerId: string; court: number; startTime: string; sendOffsetMs: number; responseOffsetMs: number; statusCode: number }>;
    provider: Array<{ workerId: string; embeddedOffsetMs: number | null }>;
    congestion: { reads: Array<{ requestOffsetMs: number; responseOffsetMs: number | null }> } };
  sep24: { attempts: Array<{ workerId: string; court: number; startTime: string; sendOffsetMs: number; responseOffsetMs: number; statusCode: number }> };
  sep23: { attempts: Array<{ courtIds: number[]; hours: string[]; sendOffsetMs: number; responseOffsetMs: number; diagnostic?: { status?: number } }> };
}
/** Edge arrival assumed this long after send when no provider stamp exists (INFERENCE; Sept 25 stamps say 20–27 ms). */
export const DEFAULT_ONE_WAY_MS = 20;

export function observedReleases(evidence: EvidenceFile): ObservedRelease[] {
  const sep25 = evidence.sep25;
  const embedded = new Map(sep25.provider.map(row => [row.workerId, row.embeddedOffsetMs]));
  const checkouts25 = sep25.attempts.map(attempt => ({ id: attempt.workerId, court: attempt.court, startTime: attempt.startTime, hours: 3,
    sendMs: attempt.sendOffsetMs, edgeMs: embedded.get(attempt.workerId) ?? attempt.sendOffsetMs + DEFAULT_ONE_WAY_MS,
    responseMs: attempt.responseOffsetMs, status: attempt.statusCode }));
  const reads25 = sep25.congestion.reads.filter(read => read.requestOffsetMs >= -2_000 && read.requestOffsetMs <= 45_000 && read.responseOffsetMs !== null)
    .map((read, index) => ({ id: `watch-${index}`, sendMs: read.requestOffsetMs, responseMs: read.responseOffsetMs! }));
  const tau25 = kendallTau(checkouts25.map(value => value.edgeMs), checkouts25.map(value => value.responseMs)) ?? 0;
  const days: ObservedRelease[] = [{
    label: '2026-09-25', checkouts: checkouts25, reads: reads25, hotStartHours: [15, 19],
    signatures: { latencyWindowMs: [28_500, 36_000], spreadWindowMs: [4_000, 7_500], allConflict: true, arrivalOrderTau: { observed: tau25, tolerance: 0.3 },
      readFlush: true, readOvertake: true },
    provenance: ['FACT: send offsets (Playwright request events) and response offsets (CHECKOUT_PRE_POST + network duration) on the dispatch clock',
      'INFERENCE: edge arrival = x-vercel-id embedded number (UNDOCUMENTED meaning) on the dispatch clock',
      'FACT: Slot Watch read request/response offsets, shifted to the dispatch clock',
      'INFERENCE: every one of our requests (7 browsers and the Slot Watch) left from one public IP'],
  }];
  const checkouts24 = evidence.sep24.attempts.map(attempt => ({ id: attempt.workerId, court: attempt.court, startTime: attempt.startTime, hours: 3,
    sendMs: attempt.sendOffsetMs, edgeMs: attempt.sendOffsetMs + DEFAULT_ONE_WAY_MS, responseMs: attempt.responseOffsetMs, status: attempt.statusCode }));
  days.push({ label: '2026-09-24', checkouts: checkouts24, reads: [], hotStartHours: [15],
    signatures: { latencyWindowMs: [16_500, 29_500], spreadWindowMs: [8_000, 13_000], allConflict: true, arrivalOrderTau: null, readFlush: null, readOvertake: null },
    provenance: ['FACT: send and response offsets on the runner clock', 'INFERENCE: edge = send + 20 ms (no provider stamp retained)',
      'Reads are not replayed (they timed out client-side at 5 s that day)'] });
  const checkouts23 = evidence.sep23.attempts.map((attempt, index) => ({ id: `sep23-${index}`, court: attempt.courtIds[0]!, startTime: attempt.hours[0]!,
    hours: attempt.hours.length, sendMs: attempt.sendOffsetMs, edgeMs: attempt.sendOffsetMs + DEFAULT_ONE_WAY_MS, responseMs: attempt.responseOffsetMs,
    status: attempt.diagnostic?.status ?? 409 }));
  days.push({ label: '2026-09-23', checkouts: checkouts23, reads: [], hotStartHours: [17, 20],
    signatures: { latencyWindowMs: [10_500, 14_500], spreadWindowMs: [800, 3_000], allConflict: true, arrivalOrderTau: null, readFlush: null, readOvertake: null },
    provenance: ['FACT: journal createdAt/updatedAt on the runner network-corrected clock', 'INFERENCE: edge = send + 20 ms',
      'Reads are not replayed (few samples, PC wall clock)'] });
  return days;
}

/** Our own requests of a day, as simulator input. All leave from one IP ("us"). */
export function ourRequests(day: ObservedRelease, oneWayMs = DEFAULT_ONE_WAY_MS): SimRequest[] {
  return [
    ...day.checkouts.map(value => ({ id: value.id, owner: 'us' as const, kind: 'checkout' as const, ip: 'us', sendMs: value.sendMs, edgeMs: value.edgeMs,
      slots: slotKeys(value.court, value.startTime, value.hours), court: value.court, proofless: true })),
    ...day.reads.map(value => ({ id: value.id, owner: 'us' as const, kind: 'read' as const, ip: 'us', sendMs: value.sendMs, edgeMs: value.sendMs + oneWayMs,
      slots: [], court: 0, proofless: false })),
  ];
}

// ---------------------------------------------------------------------------------------------------------
// Model families and the explored grid. Baseline service times come from off-peak FACTS: a verified hold takes
// ~1.0–2.6 s end to end (p50 ≈ 1.2 s) and commits late in that time; an uncontended read takes ~70–100 ms.

const d = (median: number, sigma = 0.3): Dist => ({ median, sigma });
const BASE: Omit<ProviderModel, 'family'> = { admissionLimit: Infinity, instances: Infinity, connectionsPerInstance: Infinity, lock: 'none', lockOrder: 'fifo',
  readsTakeLock: false, conflictRetries: 0, backoffBaseMs: 0, perIpLimit: Infinity, preLockMs: d(600), lockHoldMs: d(400, 0.4), readMs: d(60),
  prooflessExtraMs: null, returnMs: d(60, 0.2) };

export interface ModelVariant { key: string; model: ProviderModel }
export function modelVariants(): ModelVariant[] {
  const variants: ModelVariant[] = [];
  const add = (family: ModelFamily, key: string, overrides: Partial<ProviderModel>) => variants.push({ key: `${family}:${key}`, model: { ...BASE, family, ...overrides } });
  for (const limit of [2, 4, 8]) add('A_EDGE_FIFO', `admission=${limit}`, { admissionLimit: limit });
  for (const instances of [4, 8, 16]) add('B_INSTANCE_ADMISSION', `instances=${instances},conn=1`, { instances, connectionsPerInstance: 1 });
  for (const hold of [300, 600, 900]) add('C_PESSIMISTIC_COURT_LOCK', `hold=${hold}`, { lock: 'court', lockHoldMs: d(hold, 0.4) });
  for (const hold of [300, 600, 900]) add('D_OPTIMISTIC', `service=${hold}`, { lockHoldMs: d(hold, 0.4) });
  for (const retries of [3, 6]) for (const base of [500, 2_000]) add('E_RETRY_BACKOFF', `retries=${retries},base=${base}`, { conflictRetries: retries, backoffBaseMs: base });
  for (const order of ['fifo', 'random'] as const) for (const hold of [300, 600, 900]) {
    add('F_FACILITY_DATE_SERIAL', `${order},hold=${hold}`, { lock: 'facility-date', lockOrder: order, lockHoldMs: d(hold, 0.4) });
    add('F_FACILITY_DATE_SERIAL', `${order},hold=${hold},instances=16,conn=1`, { lock: 'facility-date', lockOrder: order, lockHoldMs: d(hold, 0.4), instances: 16, connectionsPerInstance: 1 });
  }
  for (const extra of [10_000, 30_000]) add('G_LANES', `optimistic,prooflessExtra=${extra}`, { prooflessExtraMs: d(extra, 0.2) });
  for (const extra of [3_000, 10_000]) add('G_LANES', `facility-fifo,hold=600,prooflessExtra=${extra}`, { lock: 'facility-date', lockHoldMs: d(600, 0.4), prooflessExtraMs: d(extra, 0.2) });
  for (const limit of [1, 2]) add('H_PER_IP', `perIp=${limit}`, { perIpLimit: limit });
  for (const capacity of [2, 4, 8]) add('P_PROCESSOR_SHARING', `capacity=${capacity}`, { sharedCapacity: capacity });
  add('P_PROCESSOR_SHARING', 'capacity=4,facility-fifo,hold=300', { sharedCapacity: 4, lock: 'facility-date', lockHoldMs: d(300, 0.4) });
  return variants;
}

export interface CrowdVariant { key: string; params: Omit<CrowdParams, 'hotStartHours'> }
export function crowdVariants(): CrowdVariant[] {
  const variants: CrowdVariant[] = [];
  for (const checkouts of [20, 40, 80, 160]) for (const arrivalMeanMs of [200, 1_000, 4_000]) for (const readsPerSecond of [10, 40])
    for (const preReleaseShare of [0, 0.3])
      variants.push({ key: `checkouts=${checkouts},arrivalMean=${arrivalMeanMs},reads/s=${readsPerSecond},preRelease=${preReleaseShare}`,
        params: { checkouts, arrivalMeanMs, preReleaseShare, hotShare: 0.6, readsPerSecond, readWindowMs: 45_000, oneWayMs: d(25, 0.3) } });
  return variants;
}

export interface CellResult {
  model: string; crowd: string; seeds: number;
  fullMatchRate: number; meanScore: number; applicable: number;
  signatureRates: Record<'latency' | 'conflict' | 'spread' | 'order' | 'readFlush' | 'readOvertake', number | null>;
  ourLatencyMs: ReturnType<typeof summarize>;
}

export function evaluateCell(day: ObservedRelease, variant: ModelVariant, crowd: CrowdVariant, seeds: readonly number[]): CellResult {
  const signals: Signals[] = [];
  const latencies: number[] = [];
  const ours = ourRequests(day);
  for (const seed of seeds) {
    const requests = [...ours, ...crowdRequests({ ...crowd.params, hotStartHours: day.hotStartHours }, seed)];
    const outcomes = simulateRelease(variant.model, requests, seed);
    const byId = new Map(outcomes.map(outcome => [outcome.id, outcome]));
    const checkouts = day.checkouts.map(value => byId.get(value.id)!).map(outcome => ({ edgeMs: outcome.edgeMs, responseMs: outcome.responseMs, status: outcome.status }));
    const reads = day.reads.map(value => byId.get(value.id)!).map(outcome => ({ id: outcome.id, sendMs: outcome.sendMs, responseMs: outcome.responseMs }));
    signals.push(scoreOutcomes(day.signatures, checkouts, reads));
    latencies.push(...checkouts.map(value => value.responseMs));
  }
  const rate = (pick: (signal: Signals) => boolean | null) => {
    const values = signals.map(pick).filter((value): value is boolean => value !== null);
    return values.length ? Math.round(values.filter(Boolean).length / values.length * 1000) / 1000 : null;
  };
  return { model: variant.key, crowd: crowd.key, seeds: seeds.length, fullMatchRate: rate(signal => signal.full) ?? 0,
    meanScore: Math.round(signals.reduce((sum, signal) => sum + signal.score, 0) / signals.length * 1000) / 1000, applicable: signals[0]?.applicable ?? 0,
    signatureRates: { latency: rate(signal => signal.latency), conflict: rate(signal => signal.conflict), spread: rate(signal => signal.spread),
      order: rate(signal => signal.order), readFlush: rate(signal => signal.readFlush), readOvertake: rate(signal => signal.readOvertake) },
    ourLatencyMs: summarize(latencies, 0) };
}

export interface FamilyVerdict {
  family: ModelFamily;
  day: string;
  cells: number;
  cellsWithAnyFullMatch: number;
  best: CellResult;
  /** Best rate reached anywhere in the grid, per signature: a 0 means "never reproduced in the explored ranges". */
  maxSignatureRates: CellResult['signatureRates'];
  verdict: 'COMPATIBLE_SOMEWHERE_IN_GRID' | 'NOT_REPRODUCED_IN_GRID';
}

export function familyVerdicts(day: string, cells: readonly CellResult[]): FamilyVerdict[] {
  const families = [...new Set(cells.map(cell => cell.model.split(':')[0] as ModelFamily))];
  return families.map(family => {
    const own = cells.filter(cell => cell.model.startsWith(`${family}:`));
    const best = [...own].sort((a, b) => b.fullMatchRate - a.fullMatchRate || b.meanScore - a.meanScore)[0]!;
    const max = (key: keyof CellResult['signatureRates']) => {
      const values = own.map(cell => cell.signatureRates[key]).filter((value): value is number => value !== null);
      return values.length ? Math.max(...values) : null;
    };
    const cellsWithAnyFullMatch = own.filter(cell => cell.fullMatchRate > 0).length;
    return { family, day, cells: own.length, cellsWithAnyFullMatch, best,
      maxSignatureRates: { latency: max('latency'), conflict: max('conflict'), spread: max('spread'), order: max('order'), readFlush: max('readFlush'), readOvertake: max('readOvertake') },
      verdict: cellsWithAnyFullMatch > 0 ? 'COMPATIBLE_SOMEWHERE_IN_GRID' : 'NOT_REPRODUCED_IN_GRID' };
  });
}

/** Simulated outcomes of our own requests only (for tests and spot checks). */
export function simulateDay(day: ObservedRelease, model: ProviderModel, crowd: Omit<CrowdParams, 'hotStartHours'>, seed: number): SimOutcome[] {
  const outcomes = simulateRelease(model, [...ourRequests(day), ...crowdRequests({ ...crowd, hotStartHours: day.hotStartHours }, seed)], seed);
  return outcomes.filter(outcome => outcome.owner === 'us');
}

// ---------------------------------------------------------------------------------------------------------
// Random search: the fixed grid is coarse. For one day, sample each family's parameters (log-uniform over wide,
// plausible ranges, seeded) to ask whether ANY configuration reproduces every signature. A family that never does
// in `samples` draws is "not reproduced in the searched ranges", which is still not proof of impossibility.

export interface SearchResult {
  family: ModelFamily; samples: number; seeds: number;
  cellsWithAnyFullMatch: number;
  best: CellResult & { params: Record<string, number | string> };
  maxSignatureRates: CellResult['signatureRates'];
}
export function randomSearch(day: ObservedRelease, family: ModelFamily, samples: number, seeds: readonly number[], seed: number): SearchResult {
  const random = seededRandom(seed);
  const logUniform = (low: number, high: number) => low * (high / low) ** random();
  let best: SearchResult['best'] | undefined;
  let withFull = 0;
  const max: Record<keyof CellResult['signatureRates'], number | null> = { latency: null, conflict: null, spread: null, order: null, readFlush: null, readOvertake: null };
  for (let index = 0; index < samples; index++) {
    const params: Record<string, number | string> = { checkouts: Math.round(logUniform(20, 400)), arrivalMeanMs: Math.round(logUniform(100, 8_000)),
      preReleaseShare: Math.round(random() * 60) / 100, readsPerSecond: Math.round(logUniform(5, 60)), preLockMs: Math.round(logUniform(200, 1_500)),
      holdMs: Math.round(logUniform(150, 1_500)) };
    const overrides: Partial<ProviderModel> = {};
    switch (family) {
      case 'A_EDGE_FIFO': params.admissionLimit = Math.round(logUniform(1, 16)); overrides.admissionLimit = params.admissionLimit as number; break;
      case 'B_INSTANCE_ADMISSION': params.instances = Math.round(logUniform(2, 32)); Object.assign(overrides, { instances: params.instances, connectionsPerInstance: 1 }); break;
      case 'C_PESSIMISTIC_COURT_LOCK': params.holdMs = Math.round(logUniform(300, 5_000)); overrides.lock = 'court'; break;
      case 'D_OPTIMISTIC': params.holdMs = Math.round(logUniform(150, 5_000)); break;
      case 'E_RETRY_BACKOFF': params.retries = 1 + Math.floor(random() * 8); params.backoffBaseMs = Math.round(logUniform(200, 4_000));
        Object.assign(overrides, { conflictRetries: params.retries, backoffBaseMs: params.backoffBaseMs }); break;
      case 'F_FACILITY_DATE_SERIAL': params.lockOrder = random() < 0.5 ? 'fifo' : 'random'; params.instances = random() < 0.5 ? 'unbounded' : Math.round(logUniform(4, 32));
        Object.assign(overrides, { lock: 'facility-date', lockOrder: params.lockOrder, ...(params.instances === 'unbounded' ? {} : { instances: params.instances, connectionsPerInstance: 1 }) }); break;
      case 'G_LANES': params.prooflessExtraMs = Math.round(logUniform(1_000, 40_000)); params.lock = random() < 0.5 ? 'none' : 'facility-date';
        Object.assign(overrides, { prooflessExtraMs: d(params.prooflessExtraMs as number, 0.2), lock: params.lock }); break;
      case 'H_PER_IP': params.perIpLimit = random() < 0.5 ? 1 : 2; overrides.perIpLimit = params.perIpLimit as number; break;
      case 'P_PROCESSOR_SHARING': params.sharedCapacity = Math.round(logUniform(1, 16) * 10) / 10; params.lock = random() < 0.3 ? 'facility-date' : 'none';
        Object.assign(overrides, { sharedCapacity: params.sharedCapacity, lock: params.lock }); break;
    }
    // Half of the draws add a replica/cache read path (§4.3 of the report: fast reads were provably stale).
    params.replicaReadShare = random() < 0.5 ? 0 : Math.round(random() * 80) / 100;
    const model: ProviderModel = { ...BASE, family, preLockMs: d(params.preLockMs as number), lockHoldMs: d(params.holdMs as number, 0.4), ...overrides,
      replicaReadShare: params.replicaReadShare as number };
    const crowd: CrowdVariant = { key: `search#${index}`, params: { checkouts: params.checkouts as number, arrivalMeanMs: params.arrivalMeanMs as number,
      preReleaseShare: params.preReleaseShare as number, hotShare: 0.6, readsPerSecond: params.readsPerSecond as number, readWindowMs: 45_000, oneWayMs: d(25, 0.3) } };
    const cell = evaluateCell(day, { key: `${family}:search#${index}`, model }, crowd, seeds);
    if (cell.fullMatchRate > 0) withFull++;
    for (const key of Object.keys(max) as Array<keyof typeof max>) {
      const value = cell.signatureRates[key];
      if (value !== null) max[key] = Math.max(max[key] ?? 0, value);
    }
    if (!best || cell.fullMatchRate > best.fullMatchRate || (cell.fullMatchRate === best.fullMatchRate && cell.meanScore > best.meanScore)) best = { ...cell, params };
  }
  return { family, samples, seeds: seeds.length, cellsWithAnyFullMatch: withFull, best: best!, maxSignatureRates: max };
}
