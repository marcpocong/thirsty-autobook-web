import { logNormal, seededRandom } from './stats.js';

/**
 * Local contention simulator for the release-time checkout race. A HYPOTHESIS TOOL, never evidence:
 * it answers "could provider mechanism X, under some crowd load, produce what we observed?" and, more
 * usefully, "which mechanisms cannot, anywhere in the explored ranges?". It contacts nothing.
 *
 * One discrete-event simulation of the provider during a release:
 *
 *   client ── edge arrival ──► [per-IP limit] ──► [admission limit] ──► instance (random routing)
 *          ──► [instance DB connection] ──► checkout: pre-lock work ──► [lock: none | court | facility-date]
 *          ──► in-lock work ──► commit: slots free → 200 hold, taken → retry with backoff or 409
 *          ──► read: DB read (optionally behind the same lock)
 *
 * Every mechanism of the investigation is a parameter setting (see MODEL_FAMILIES in release-replay.ts):
 *   A edge FIFO / general overload   admissionLimit finite, everything else parallel
 *   B instance admission              few instances with one connection each (per-instance FIFO)
 *   C pessimistic lock per court      lock 'court'
 *   D optimistic, no retry            lock 'none', conflictRetries 0
 *   E optimistic with retry/backoff   lock 'none', conflictRetries > 0
 *   F facility/date serialization     lock 'facility-date' (FIFO or random grant order)
 *   G separate lanes                  prooflessExtraMs: extra work only for proofless requests
 *   H per-IP limiter                  perIpLimit on our own IP (reads and checkouts)
 *   P general overload                sharedCapacity: all work shares one processor (egalitarian processor sharing),
 *                                     so everything slows together instead of queueing
 *
 * Deterministic: one seeded PRNG, one event heap with FIFO tie-breaking.
 */

export interface Dist { median: number; sigma: number }
export type LockScope = 'none' | 'court' | 'facility-date';
export type ModelFamily = 'A_EDGE_FIFO' | 'B_INSTANCE_ADMISSION' | 'C_PESSIMISTIC_COURT_LOCK' | 'D_OPTIMISTIC' | 'E_RETRY_BACKOFF'
  | 'F_FACILITY_DATE_SERIAL' | 'G_LANES' | 'H_PER_IP' | 'P_PROCESSOR_SHARING';

export interface ProviderModel {
  family: ModelFamily;
  /** Concurrent requests admitted past the edge (Infinity: no limit). */
  admissionLimit: number;
  /** Function instances; requests are routed uniformly at random (Infinity: one instance per request). */
  instances: number;
  /** DB connections per instance (Infinity: unbounded). A checkout holds its connection for its whole transaction. */
  connectionsPerInstance: number;
  lock: LockScope;
  lockOrder: 'fifo' | 'random';
  readsTakeLock: boolean;
  /** On a taken slot: retry this many times (after exponential backoff) before answering 409. */
  conflictRetries: number;
  backoffBaseMs: number;
  /** Concurrent requests admitted per client IP (Infinity: no limit). Applies to every request from an IP. */
  perIpLimit: number;
  preLockMs: Dist;
  lockHoldMs: Dist;
  readMs: Dist;
  /** Model G: extra work for proofless checkouts only (null: same lane). */
  prooflessExtraMs: Dist | null;
  /**
   * Model P: work units that run at full speed at once. Above that, every active piece of work (pre-lock, in-lock,
   * reads) slows equally (processor sharing). Omitted or Infinity: work never slows.
   */
  sharedCapacity?: number;
  /**
   * Share of reads answered by a separate data view (a lagging replica or a cache), as §4.3 of
   * SERVER_ARBITRATION_INVESTIGATION.md infers from provably stale fast reads. Such reads still pass the edge
   * (per-IP limit, admission) but never wait for an instance connection, a lock or the shared processor.
   * 0 or omitted: every read takes the same path as checkouts.
   */
  replicaReadShare?: number;
  returnMs: Dist;
}

export interface SimRequest {
  id: string;
  owner: 'us' | 'crowd';
  kind: 'checkout' | 'read';
  ip: string;
  /** Client send and edge arrival, ms after the release instant. */
  sendMs: number;
  edgeMs: number;
  /** Checkout only: slot keys `court@HH` for the target date. */
  slots: readonly string[];
  court: number;
  proofless: boolean;
}

export interface SimOutcome {
  id: string;
  owner: 'us' | 'crowd';
  kind: 'checkout' | 'read';
  sendMs: number;
  edgeMs: number;
  /** Response received by the client, ms after release. */
  responseMs: number;
  status: 200 | 409 | null;
  attempts: number;
  instance: number;
  connectionWaitMs: number;
  lockWaitMs: number;
  /** When the lock was granted (first attempt), for ordering analysis; null without a lock. */
  lockGrantedMs: number | null;
}

const sample = (random: () => number, dist: Dist) => (dist.sigma > 0 ? logNormal(random, dist.median, dist.sigma) : dist.median);

class EventHeap {
  private readonly items: Array<{ at: number; seq: number; run: () => void }> = [];
  private seq = 0;
  push(at: number, run: () => void) {
    const item = { at, seq: this.seq++, run }, items = this.items;
    items.push(item);
    for (let index = items.length - 1; index > 0;) {
      const parent = (index - 1) >> 1;
      if (!EventHeap.before(items[index]!, items[parent]!)) break;
      [items[index], items[parent]] = [items[parent]!, items[index]!];
      index = parent;
    }
  }
  pop() {
    const items = this.items;
    if (!items.length) return undefined;
    const top = items[0]!, last = items.pop()!;
    if (items.length) {
      items[0] = last;
      for (let index = 0; ;) {
        const left = index * 2 + 1, right = left + 1;
        let best = index;
        if (left < items.length && EventHeap.before(items[left]!, items[best]!)) best = left;
        if (right < items.length && EventHeap.before(items[right]!, items[best]!)) best = right;
        if (best === index) break;
        [items[index], items[best]] = [items[best]!, items[index]!];
        index = best;
      }
    }
    return top;
  }
  private static before(a: { at: number; seq: number }, b: { at: number; seq: number }) { return a.at < b.at || (a.at === b.at && a.seq < b.seq); }
}

/** A counting semaphore; waiters are granted in FIFO or uniformly random order. */
class Gate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly capacity: number, private readonly order: 'fifo' | 'random', private readonly random: () => number,
    private readonly defer: (run: () => void) => void) {}
  acquire(granted: () => void) {
    if (this.active < this.capacity) { this.active++; granted(); } else this.waiting.push(granted);
  }
  release() {
    if (!this.waiting.length) { this.active--; return; }
    const index = this.order === 'random' ? Math.floor(this.random() * this.waiting.length) : 0;
    const next = this.waiting.splice(index, 1)[0]!;
    this.defer(next); // the slot passes straight to the next holder
  }
}

/** Egalitarian processor sharing: n active jobs each progress at min(1, capacity / n). */
class ProcessorSharing {
  private readonly jobs = new Map<number, { remaining: number; done: () => void }>();
  private last = 0; private version = 0; private nextId = 0;
  constructor(private readonly capacity: number, private readonly at: (time: number, run: () => void) => void, private readonly now: () => number) {}
  private rate() { return Math.min(1, this.capacity / Math.max(1, this.jobs.size)); }
  private advance() {
    const now = this.now(), elapsed = now - this.last, rate = this.rate();
    if (elapsed > 0) for (const job of this.jobs.values()) job.remaining -= elapsed * rate;
    this.last = now;
  }
  private schedule() {
    const version = ++this.version;
    if (!this.jobs.size) return;
    let least = Infinity;
    for (const job of this.jobs.values()) least = Math.min(least, job.remaining);
    this.at(this.now() + Math.max(0, least) / this.rate(), () => {
      if (version !== this.version) return;
      this.advance();
      const finished = [...this.jobs].filter(([, job]) => job.remaining <= 1e-9);
      for (const [id] of finished) this.jobs.delete(id);
      this.schedule();
      for (const [, job] of finished) job.done();
    });
  }
  run(work: number, done: () => void) { this.advance(); this.jobs.set(this.nextId++, { remaining: work, done }); this.schedule(); }
}

/** Runs one release. Every request gets exactly one outcome; unfinished requests (none, by construction) would be null-status. */
export function simulateRelease(model: ProviderModel, requests: readonly SimRequest[], seed: number): SimOutcome[] {
  const random = seededRandom(seed);
  const heap = new EventHeap();
  let now = -Infinity;
  const at = (time: number, run: () => void) => heap.push(Math.max(time, now), run);
  const defer = (run: () => void) => at(now, run);
  const gate = (capacity: number, order: 'fifo' | 'random' = 'fifo') => Number.isFinite(capacity) ? new Gate(capacity, order, random, defer) : undefined;
  const through = (target: Gate | undefined, granted: () => void) => { if (target) target.acquire(granted); else granted(); };
  const admission = gate(model.admissionLimit);
  const ipGates = new Map<string, Gate | undefined>();
  const connectionGates = new Map<number, Gate | undefined>();
  const locks = new Map<string, Gate>();
  const held = new Map<string, string>();
  const outcomes = new Map<string, SimOutcome>();
  const connectionGate = (instance: number) => {
    if (!connectionGates.has(instance)) connectionGates.set(instance, gate(model.connectionsPerInstance));
    return connectionGates.get(instance);
  };
  const lockFor = (request: SimRequest) => {
    if (model.lock === 'none') return undefined;
    const key = model.lock === 'court' ? `court:${request.court}` : 'facility-date';
    let value = locks.get(key);
    if (!value) { value = new Gate(1, model.lockOrder, random, defer); locks.set(key, value); }
    return value;
  };
  let nextInstance = 0;
  const pickInstance = () => Number.isFinite(model.instances) ? Math.floor(random() * model.instances) : nextInstance++;
  const shared = model.sharedCapacity !== undefined && Number.isFinite(model.sharedCapacity) ? new ProcessorSharing(model.sharedCapacity, at, () => now) : undefined;
  /** `work` ms of processing, then `done`: plain delay, or a share of the overloaded processor (model P). */
  const work = (ms: number, done: () => void) => { if (shared) shared.run(ms, done); else at(now + ms, done); };

  for (const request of requests) {
    at(request.edgeMs, () => {
      const outcome: SimOutcome = { id: request.id, owner: request.owner, kind: request.kind, sendMs: request.sendMs, edgeMs: request.edgeMs,
        responseMs: NaN, status: null, attempts: 0, instance: -1, connectionWaitMs: 0, lockWaitMs: 0, lockGrantedMs: null };
      outcomes.set(request.id, outcome);
      if (!ipGates.has(request.ip)) ipGates.set(request.ip, gate(model.perIpLimit));
      const ipGate = ipGates.get(request.ip);
      const replica = request.kind === 'read' && (model.replicaReadShare ?? 0) > 0 && random() < model.replicaReadShare!;
      through(ipGate, () => through(admission, () => {
        if (replica) {
          // Replica/cache view: past the edge, but no instance connection, lock or shared processor.
          at(now + sample(random, model.readMs), () => { admission?.release(); ipGate?.release(); outcome.responseMs = now + sample(random, model.returnMs); });
          return;
        }
        const instance = pickInstance(), connections = connectionGate(instance);
        outcome.instance = instance;
        const finish = (status: 200 | 409 | null) => {
          outcome.status = status;
          admission?.release(); ipGate?.release();
          outcome.responseMs = now + sample(random, model.returnMs);
        };
        const attempt = () => {
          outcome.attempts++;
          const waitingSince = now;
          through(connections, () => {
            outcome.connectionWaitMs += now - waitingSince;
            if (request.kind === 'read') {
              const lock = model.readsTakeLock ? lockFor(request) : undefined, lockSince = now;
              through(lock, () => {
                outcome.lockWaitMs += now - lockSince;
                work(sample(random, model.readMs), () => { lock?.release(); connections?.release(); finish(null); });
              });
              return;
            }
            const pre = sample(random, model.preLockMs) + (request.proofless && model.prooflessExtraMs ? sample(random, model.prooflessExtraMs) : 0);
            work(pre, () => {
              const lock = lockFor(request), lockSince = now;
              through(lock, () => {
                outcome.lockWaitMs += now - lockSince;
                outcome.lockGrantedMs ??= lock ? now : null;
                work(sample(random, model.lockHoldMs), () => {
                  const free = request.slots.every(slot => !held.has(slot));
                  if (free) for (const slot of request.slots) held.set(slot, request.id);
                  lock?.release(); connections?.release();
                  if (free) { finish(200); return; }
                  if (outcome.attempts <= model.conflictRetries) {
                    const backoff = model.backoffBaseMs * 2 ** (outcome.attempts - 1) * (0.5 + random());
                    at(now + backoff, attempt);
                    return;
                  }
                  finish(409);
                });
              });
            });
          });
        };
        attempt();
      }));
    });
  }
  for (let event = heap.pop(); event; event = heap.pop()) { now = event.at; event.run(); }
  return requests.map(request => outcomes.get(request.id)!);
}

/** Crowd load: competitor checkouts and page reads. Every competitor has its own IP. */
export interface CrowdParams {
  checkouts: number;
  /** Competitor checkout arrivals after release: Gamma(2) with this mean (peaked shortly after release, long tail). */
  arrivalMeanMs: number;
  /**
   * Share of competitor checkouts that reach the provider during the second BEFORE release and are held until it
   * opens (a HYPOTHESIS about the provider, modelled only; nothing here sends anything). 0 = none.
   */
  preReleaseShare?: number;
  /** Share of competitor checkouts aimed at the day's hot start times (the ones we also target). */
  hotShare: number;
  hotStartHours: readonly number[];
  readsPerSecond: number;
  readWindowMs: number;
  oneWayMs: Dist;
}

export function crowdRequests(params: CrowdParams, seed: number): SimRequest[] {
  const random = seededRandom(seed ^ 0x5bd1e995);
  const requests: SimRequest[] = [];
  for (let index = 0; index < params.checkouts; index++) {
    const early = random() < (params.preReleaseShare ?? 0);
    const sendMs = early ? -random() * 1_000
      : -Math.log(Math.max(random(), 1e-12)) * params.arrivalMeanMs / 2 - Math.log(Math.max(random(), 1e-12)) * params.arrivalMeanMs / 2;
    const court = 1 + Math.floor(random() * 7);
    const hot = random() < params.hotShare && params.hotStartHours.length > 0;
    const hours = 1 + Math.floor(random() * 3);
    const start = hot ? params.hotStartHours[Math.floor(random() * params.hotStartHours.length)]! : 8 + Math.floor(random() * (22 - 8 - hours + 1));
    const slots = Array.from({ length: hours }, (_, offset) => `${court}@${String(start + offset).padStart(2, '0')}`);
    requests.push({ id: `crowd-c${index}`, owner: 'crowd', kind: 'checkout', ip: `crowd-${index}`, sendMs, edgeMs: sendMs + sample(random, params.oneWayMs),
      slots, court, proofless: false });
  }
  const reads = Math.round(params.readsPerSecond * params.readWindowMs / 1000);
  for (let index = 0; index < reads; index++) {
    const sendMs = random() * params.readWindowMs;
    requests.push({ id: `crowd-r${index}`, owner: 'crowd', kind: 'read', ip: `crowd-read-${index}`, sendMs, edgeMs: sendMs + sample(random, params.oneWayMs),
      slots: [], court: 0, proofless: false });
  }
  return requests;
}

/** `court@HH` keys for a booking of `hours` hours starting at `startTime` (HH:MM). */
export function slotKeys(court: number, startTime: string, hours: number): string[] {
  const start = Number(startTime.slice(0, 2));
  return Array.from({ length: hours }, (_, offset) => `${court}@${String(start + offset).padStart(2, '0')}`);
}
