import { compilePreferences, expandHours, type Config, type Preference } from './config.js';
import { validateSnapshot, resolvePreference, type Snapshot } from './grid.js';
import { selectResolvedPreference, type SelectionPort, type SelectionResult } from './selection.js';
import { Safety } from './safety.js';
import { Telemetry } from './telemetry.js';
import type { CandidateDiscovery } from './availability-discovery.js';

export type WorkerId = 'A' | 'B';
export interface DualCandidate { date: string; start: string; hours: string[]; a: Preference; b: Preference }
export const preferenceKey = (p: Preference) => `${p.court}/${p.hours.join(',')}`;
export const pairKey = (p: DualCandidate) => `${p.date}/${preferenceKey(p.a)}/${preferenceKey(p.b)}`;
export function assertDualPair(p: DualCandidate, date: string) {
  if (p.date !== date || p.a.court === p.b.court || p.start !== p.hours[0] ||
    ![p.a.court,p.b.court].every(c => Number.isInteger(c) && c >= 1 && c <= 7) ||
    JSON.stringify(expandHours(p.start,p.hours.length)) !== JSON.stringify(p.hours) ||
    JSON.stringify(p.a.hours) !== JSON.stringify(p.hours) || JSON.stringify(p.b.hours) !== JSON.stringify(p.hours)) throw Error('INVALID_DUAL_PAIR');
}
export function cleanCells(grid: Snapshot, date: string) {
  const cells = validateSnapshot(grid, date);
  if (cells.some(c => c.state === 'UNKNOWN')) throw Error('SELECTION_STATE_UNKNOWN');
  if (cells.some(c => c.state === 'SELECTED')) throw Error('PREEXISTING_SELECTION');
  return cells;
}
export function resolveDualPair(date: string, grids: [Snapshot, Snapshot], preferences: Preference[],
  excluded = new Set<string>(), discoveries?: [CandidateDiscovery | undefined, CandidateDiscovery | undefined]): DualCandidate | undefined {
  const cells = grids.map(g => cleanCells(g, date));
  // Discovery may veto known prices; configuration order remains authoritative.
  const eligible = cells.map((c, i) => new Set((discoveries?.[i]?.rank(c, preferences) ?? preferences).map(preferenceKey)));
  for (const a of preferences) {
    if (!eligible[0]!.has(preferenceKey(a)) || !resolvePreference(cells[0]!, [a])) continue;
    for (const b of preferences) {
      if (a.court === b.court || JSON.stringify(a.hours) !== JSON.stringify(b.hours) ||
        !eligible[1]!.has(preferenceKey(b)) || !resolvePreference(cells[1]!, [b])) continue;
      const pair = { date, start: a.hours[0]!, hours: [...a.hours], a, b };
      if (!excluded.has(pairKey(pair))) return pair;
    }
  }
}
export interface DualWorker {
  id: WorkerId; safety: Safety; telemetry: Telemetry; port: SelectionPort;
  discovery?: CandidateDiscovery;
  checkout(selected: SelectionResult): Promise<void>;
  state(state: 'clean' | 'selection' | 'checkout' | 'hold' | 'unknown', selected?: SelectionResult): Promise<void>;
}
// The coordinator owns both local workers; no standalone entrypoint can bypass its lock.
// Every selection click is recorded BEFORE dispatch so ambiguous results remain owned only
// if they are positively identified on the exact assigned grid during cleanup.
export function trackedPort(worker: DualWorker, dispatched: Set<string>): SelectionPort {
  return { guard: () => worker.port.guard(), read: () => worker.port.read(), summary: () => worker.port.summary(),
    click: async (date, court, hour, state) => {
      if (state === 'OPEN') dispatched.add(`${date}/${court}/${hour}`);
      await worker.port.click(date, court, hour, state);
    } };
}
export async function cleanupOwned(worker: DualWorker, date: string, dispatched: Set<string>) {
  const readOwned = async () => {
    await worker.port.guard(); worker.safety.check();
    const cells = validateSnapshot(await worker.port.read(), date); worker.safety.check();
    if (cells.some(c => c.state === 'UNKNOWN')) throw Error('CLEANUP_STATE_UNKNOWN');
    const selected = cells.filter(c => c.state === 'SELECTED');
    if (selected.some(c => !dispatched.has(`${date}/${c.court}/${c.hour}`))) throw Error('UNOWNED_SELECTION');
    return selected;
  };
  const selected = await readOwned();
  for (const cell of selected) {
    if (!(await readOwned()).some(c => c.court === cell.court && c.hour === cell.hour)) throw Error('CLEANUP_STATE_CHANGED');
    await worker.port.click(date, cell.court, cell.hour, 'SELECTED');
  }
  if ((await readOwned()).length) throw Error('CLEANUP_NOT_VERIFIED');
  worker.safety.locked = false; // Only a strictly proven clean, pre-Proceed worker may replan.
  await worker.state('clean'); worker.telemetry.mark('selectionCleanupVerified');
}
export type DualResult = { status: 'DUAL_DRY_PASS' | 'DUAL_SELECTION_PASS' | 'DUAL_SELECTION_VERIFIED' | 'DUAL_HOLD_VERIFIED' | 'DUAL_PARTIAL_SUCCESS' | 'DUAL_FAILED'; pair: DualCandidate; workers?: ['hold' | 'failed', 'hold' | 'failed']; candidateSource: 'UI_ONLY' | 'API+UI' };
export async function coordinateDual(workers: [DualWorker, DualWorker], date: string, grids: [Snapshot, Snapshot],
  config: Config, mode: 'dry' | 'practice' | 'selection' | 'full', telemetry: Telemetry, exact?: DualCandidate): Promise<DualResult> {
  if (config.COURT_COUNT !== 2 || workers[0].id !== 'A' || workers[1].id !== 'B' || workers[0].safety === workers[1].safety || workers[0].port === workers[1].port) throw Error('DUAL_ISOLATION_REQUIRED');
  const preferences = compilePreferences(config), excluded = new Set<string>();
  const maximum = exact ? 1 : config.MAX_SELECTION_ATTEMPTS;
  if (exact) assertDualPair(exact, date);
  for (let attempt = 1; attempt <= maximum; attempt++) {
    workers.forEach(w => w.safety.fallback());
    const pair = exact ?? resolveDualPair(date, grids, preferences, excluded, [workers[0].discovery, workers[1].discovery]);
    if (!pair) throw Error('NO_DUAL_PAIR_AVAILABLE');
    assertDualPair(pair, date);
    if (!resolvePreference(cleanCells(grids[0], date), [pair.a]) || !resolvePreference(cleanCells(grids[1], date), [pair.b])) throw Error('NO_DUAL_PAIR_AVAILABLE');
    excluded.add(pairKey(pair));
    telemetry.mark('dualPairResolved', attempt);
    telemetry.mark('workerAAssigned', pair.a.court); telemetry.mark('workerBAssigned', pair.b.court);
    const source = workers.some(w => w.discovery && 'source' in w.discovery && w.discovery.source === 'API+UI') ? 'API+UI' as const : 'UI_ONLY' as const;
    if (mode === 'dry') return { status:'DUAL_DRY_PASS', pair, candidateSource:source };
    const dispatched = [new Set<string>(), new Set<string>()];
    telemetry.mark('dualSelectionStarted');
    const selections = await Promise.allSettled(workers.map(async (w, i) => {
      await w.state('unknown');
      const selected = await selectResolvedPreference(trackedPort(w, dispatched[i]!), date, grids[i]!, [i === 0 ? pair.a : pair.b], config.MAX_PRICE, 1, w.safety, w.telemetry);
      await w.state('selection', selected); telemetry.mark(`worker${w.id}SelectionVerified`); return selected;
    }));
    if (selections.some(s => s.status === 'rejected') || mode === 'practice') {
      const cleaned = await Promise.allSettled(workers.map((w, i) => cleanupOwned(w, date, dispatched[i]!)));
      if (cleaned.some(s => s.status === 'rejected')) throw Error('DUAL_CLEANUP_UNVERIFIED');
      if (selections.every(s => s.status === 'fulfilled')) {
        telemetry.mark('dualSelectionVerified');
        return { status:'DUAL_SELECTION_PASS', pair, candidateSource:source };
      }
      // Exclude a failed assignment in either orientation, while allowing the successful
      // court to be paired with the next configured court. No request/refresh loop.
      const failed = selections.flatMap((s, i) => s.status === 'rejected' ? [preferenceKey(i === 0 ? pair.a : pair.b)] : []);
      for (const a of preferences) for (const b of preferences) if (failed.includes(preferenceKey(a)) || failed.includes(preferenceKey(b))) excluded.add(pairKey({ date, start:a.hours[0]!, hours:a.hours, a, b }));
      grids = await Promise.all(workers.map(w => w.port.read())) as [Snapshot, Snapshot];
      continue;
    }
    const selected = selections.map(s => { if (s.status !== 'fulfilled') throw Error('DUAL_SELECTION_UNVERIFIED'); return s.value; });
    telemetry.mark('dualSelectionVerified');
    workers.forEach(w => w.safety.check());
    if (mode === 'selection') return { status:'DUAL_SELECTION_VERIFIED', pair, candidateSource:source };
    // This is the only checkout dispatch site. No worker can reach it alone.
    telemetry.mark('dualProceedReleased');
    const holds = await Promise.allSettled(workers.map(async (w, i) => {
      await w.state('checkout', selected[i]);
      try { await w.checkout(selected[i]!); await w.state('hold', selected[i]); telemetry.mark(`worker${w.id}HoldVerified`); }
      catch (error) { await w.state('unknown', selected[i]); throw error; }
    }));
    const outcomes = holds.map(h => h.status === 'fulfilled' ? 'hold' : 'failed') as ['hold' | 'failed', 'hold' | 'failed'];
    const count = outcomes.filter(h => h === 'hold').length;
    const status = count === 2 ? 'DUAL_HOLD_VERIFIED' : count === 1 ? 'DUAL_PARTIAL_SUCCESS' : 'DUAL_FAILED';
    telemetry.mark(count === 2 ? 'dualHoldVerified' : count === 1 ? 'dualPartialSuccess' : 'dualFailed');
    return { status, pair, workers:outcomes, candidateSource:source };
  }
  throw Error('DUAL_PAIR_ATTEMPTS_EXHAUSTED');
}

export function dualArmGate(target: { releaseMs: number }, safety: Safety, telemetry: Telemetry) {
  const ready = new Set<WorkerId>();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  return async (id: WorkerId) => {
    safety.check(); if (ready.has(id)) throw Error('DUAL_PLAN_MISMATCH');
    ready.add(id); telemetry.mark(`worker${id}Ready`);
    if (ready.size === 2) { if (Date.now() >= target.releaseMs) throw Error('PREFLIGHT_MISSED_RELEASE'); telemetry.mark('dualArmed'); release(); }
    let timer:ReturnType<typeof setTimeout>|undefined;
    let aborted = () => {};
    try { await Promise.race([gate, new Promise<never>((_, reject) => {
      aborted = () => reject(Error('DUAL_PREFLIGHT_FAILED'));
      safety.signal.addEventListener('abort', aborted, { once:true });
      timer = setTimeout(() => reject(Error('PREFLIGHT_MISSED_RELEASE')), Math.max(0,target.releaseMs-Date.now()));
    })]); } finally { clearTimeout(timer); safety.signal.removeEventListener('abort',aborted); }
    safety.check();
  };
}
export function abortDualWorkers(workers:Safety[]) { for(const worker of workers) if(!worker.boundary)worker.stop('USER_ABORT'); }
