/**
 * Priority-aware security preparation ("prewarm") for fan-out children.
 *
 * 2026-09-29: 28 genuine page-bound preparations were started at once 15 s before release and took 7.6–11.8 s; the
 * last was ready 3.2 s before release. Primary attempts competed with redundant children for the same browsers.
 *
 * Here every child has a TIER (its fan-out index: A0…G0 are tier 0, A1…G1 tier 1, …) and an ORDER inside the tier
 * (strategy priority). Tier 0 starts first; a lower tier may start only when every higher tier has settled (or a
 * bounded barrier timeout passed, so one stuck challenge cannot starve everything), a global concurrency slot is
 * free, and the child's browser is below its own concurrency limit. Late in the countdown no new preparation is
 * started at all; whatever has not started is OMITTED (never sent), so low-value children can never delay primaries.
 *
 * The scheduler never sends anything and never touches journals; it only decides when `run(task)` is called.
 */
export interface PrewarmTask { id: string; tier: number; order: number; group: string }
export interface PrewarmReadiness { settled: boolean; ok: boolean; omitted: boolean; started: boolean; promise: Promise<boolean> }
export interface PrewarmPolicy {
  /** Maximum preparations in flight at once (Infinity = unbounded). */
  concurrency: number;
  /** Maximum preparations in flight per browser/worker group (Infinity = unbounded). */
  perGroupConcurrency: number;
  /** Tier t+1 may start this long after tier t started even if tier t has not settled (Infinity = strict barrier). */
  tierBarrierTimeoutMs: number;
}
/** Exactly the previous behavior: everything starts together. */
export const UNBOUNDED_PREWARM: PrewarmPolicy = Object.freeze({ concurrency: Infinity, perGroupConcurrency: Infinity, tierBarrierTimeoutMs: 0 });
export interface TierStatus { tier: number; total: number; ready: number; failed: number; inFlight: number; waiting: number; omitted: number }
export interface PrewarmSchedule {
  readiness: ReadonlyMap<string, PrewarmReadiness>;
  /** No further preparation starts; every task not yet started is omitted. Idempotent. */
  stopStarting(): void;
  status(): TierStatus[];
}
export interface PrewarmClock { now(): number; setTimer(callback: () => void, ms: number): { cancel(): void } }
export const realPrewarmClock: PrewarmClock = { now: () => performance.now(),
  setTimer: (callback, ms) => { const timer = setTimeout(callback, Math.max(0, ms)); return { cancel: () => clearTimeout(timer) }; } };

/** `run` resolves true when the child is ready, false (or rejects) when it failed. It is called at most once per task. */
export function schedulePrewarm(tasks: readonly PrewarmTask[], run: (task: PrewarmTask) => Promise<boolean>, policy: PrewarmPolicy,
  clock: PrewarmClock = realPrewarmClock, onChange?: (status: TierStatus[]) => void): PrewarmSchedule {
  if (!(policy.concurrency >= 1) || !(policy.perGroupConcurrency >= 1) || !(policy.tierBarrierTimeoutMs >= 0)) throw Error('PREWARM_POLICY_INVALID');
  const queue = [...tasks].sort((a, b) => a.tier - b.tier || a.order - b.order);
  const readiness = new Map<string, PrewarmReadiness & { resolve(value: boolean): void }>();
  for (const task of queue) {
    let resolve!: (value: boolean) => void;
    const promise = new Promise<boolean>(done => { resolve = done; });
    readiness.set(task.id, { settled: false, ok: false, omitted: false, started: false, promise, resolve });
  }
  const tiers = [...new Set(queue.map(task => task.tier))].sort((a, b) => a - b);
  const tierStartedAt = new Map<number, number>();
  const inGroup = new Map<string, number>();
  let inFlight = 0, stopped = false, timer: { cancel(): void } | undefined;
  const notify = () => { try { onChange?.(status()); } catch { /* observability only */ } };
  const settle = (task: PrewarmTask, ok: boolean, omitted = false) => {
    const entry = readiness.get(task.id)!;
    if (entry.settled) return;
    entry.settled = true; entry.ok = ok; entry.omitted = omitted; entry.resolve(ok);
  };
  /** Tier t is unlocked when every earlier tier settled, or the previous tier started ≥ barrier timeout ago. */
  const unlocked = (tier: number): { open: boolean; wakeAt?: number } => {
    const index = tiers.indexOf(tier);
    if (index <= 0) return { open: true };
    const previous = tiers[index - 1]!;
    if (!unlocked(previous).open) return { open: false };
    const earlierSettled = queue.every(task => task.tier >= tier || readiness.get(task.id)!.settled);
    if (earlierSettled) return { open: true };
    const started = tierStartedAt.get(previous);
    if (started === undefined) return { open: false };
    const wakeAt = started + policy.tierBarrierTimeoutMs;
    return clock.now() >= wakeAt ? { open: true } : { open: false, wakeAt };
  };
  const pump = () => {
    if (stopped) return;
    let nextWake: number | undefined;
    for (const task of queue) {
      if (inFlight >= policy.concurrency) break;
      const entry = readiness.get(task.id)!;
      if (entry.started || entry.settled) continue;
      const gate = unlocked(task.tier);
      if (!gate.open) { if (gate.wakeAt !== undefined) nextWake = Math.min(nextWake ?? Infinity, gate.wakeAt); continue; }
      if ((inGroup.get(task.group) ?? 0) >= policy.perGroupConcurrency) continue;
      entry.started = true; inFlight++; inGroup.set(task.group, (inGroup.get(task.group) ?? 0) + 1);
      if (!tierStartedAt.has(task.tier)) tierStartedAt.set(task.tier, clock.now());
      void Promise.resolve().then(() => run(task)).then(ok => ok === true, () => false).then(ok => {
        inFlight--; inGroup.set(task.group, (inGroup.get(task.group) ?? 1) - 1);
        settle(task, ok); notify(); pump();
      });
    }
    timer?.cancel(); timer = undefined;
    if (nextWake !== undefined && Number.isFinite(nextWake)) timer = clock.setTimer(pump, nextWake - clock.now());
  };
  const status = (): TierStatus[] => tiers.map(tier => {
    const entries = queue.filter(task => task.tier === tier).map(task => readiness.get(task.id)!);
    return { tier, total: entries.length, ready: entries.filter(entry => entry.settled && entry.ok).length,
      failed: entries.filter(entry => entry.settled && !entry.ok && !entry.omitted).length,
      inFlight: entries.filter(entry => entry.started && !entry.settled).length, waiting: entries.filter(entry => !entry.started && !entry.settled).length,
      omitted: entries.filter(entry => entry.omitted).length };
  });
  pump();
  notify();
  return {
    readiness,
    stopStarting() {
      if (stopped) return;
      stopped = true; timer?.cancel();
      for (const task of queue) if (!readiness.get(task.id)!.started) settle(task, false, true);
      notify();
    },
    status,
  };
}

/** Human-readable readiness, e.g. "Tier 1 ready: 7/7 · Tier 2 ready: 5/7 (2 preparing)". Tiers are shown 1-based. */
export function describeTierStatus(status: readonly TierStatus[]): string {
  return status.map(value => `Tier ${value.tier + 1} ready: ${value.ready}/${value.total}` +
    [value.inFlight ? `${value.inFlight} preparing` : '', value.waiting ? `${value.waiting} waiting` : '', value.failed ? `${value.failed} failed` : '',
      value.omitted ? `${value.omitted} omitted` : ''].filter(Boolean).map(text => ` (${text})`).join('')).join(' · ');
}

/**
 * Prewarm lead for a fan-out plan. With one tier this is the base lead (15 s, as before). With several tiers
 * prepared behind a barrier the lead grows so that, at the measured p95 preparation time, every tier can finish
 * with a margin — capped well inside the 120 s prepared-context freshness limit.
 */
export const BASE_PREWARM_LEAD_MS = 15_000;
// Leave at least 15 seconds between the earliest possible preparation and the 120-second freshness boundary.
export const MAX_PREWARM_LEAD_MS = 105_000;
export function adaptivePrewarmLeadMs(input: { tiers: number; workers: number; concurrency: number; prepP95Ms: number | null; baseLeadMs?: number; marginMs?: number }): number {
  const base = input.baseLeadMs ?? BASE_PREWARM_LEAD_MS, margin = input.marginMs ?? 15_000;
  if (!(input.tiers > 1)) return base;
  // Without a compatible history, reserve a conservative preparation round per tier; never silently use the single-shot 15 s lead.
  const prepP95Ms=input.prepP95Ms!==null&&input.prepP95Ms>0?input.prepP95Ms:12_000;
  const children = input.tiers * Math.max(1, input.workers);
  const waves = Math.ceil(children / Math.max(1, Math.min(input.concurrency, children)));
  // Each tier waits for the previous one, so at least one preparation round per tier.
  const rounds = Math.max(waves, input.tiers);
  return Math.min(MAX_PREWARM_LEAD_MS, Math.max(base, Math.ceil(rounds * prepP95Ms * 1.25 + margin)));
}
