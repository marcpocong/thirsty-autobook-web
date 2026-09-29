import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * Fan-out Capacity Profile: what THIS machine's local dispatch path (Node → Playwright/CDP → Chrome) does
 * when W workers each send F child attempts at once. Produced offline by scripts/benchmark-fanout-capacity.ts
 * (no Onda request is ever made) and read by the app to recommend a fan-out width and derive timing presets.
 *
 * It measures local dispatch only. Nothing here predicts server arbitration or a booking outcome: a width that
 * stays inside the gates is merely one whose extra children do not measurably degrade the local send timing.
 */
export const FANOUT_PROFILE_SCHEMA = 'fanout-capacity-profile/v1';
export const FANOUT_MAX_WIDTH = 4;

export interface Stats { n: number; p50: number | null; p95: number | null; p99: number | null; max: number | null; min: number | null; mean: number | null }
const round = (value: number) => Math.round(value * 100) / 100;
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}
export function stats(values: ReadonlyArray<number | null | undefined>): Stats {
  const finite = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const pick = (p: number) => { const value = percentile(finite, p); return value === null ? null : round(value); };
  return { n: finite.length, p50: pick(50), p95: pick(95), p99: pick(99), max: finite.length ? round(Math.max(...finite)) : null,
    min: finite.length ? round(Math.min(...finite)) : null, mean: finite.length ? round(finite.reduce((sum, value) => sum + value, 0) / finite.length) : null };
}

/** One child attempt of one benchmark run. Every *Ms value is release-relative on the trusted clock (negative = before release). */
export interface ChildSample {
  run: number; workerIndex: number; workerId: string; fanOutIndex: number; fanOutCount: number;
  /** The configured trigger relative to release (Release Offset). */
  configuredOffsetMs: number;
  schedulerWakeMs: number | null; workerInvokedMs: number | null; transportEnteredMs: number | null; prePostMs: number | null;
  evaluateEnteredMs: number | null; fetchInvokedMs: number | null; chromeStartMs: number | null; requestEventMs: number | null; responseMs: number | null;
  state: string;
  /** Security preparation of this child: duration and completion time (release-relative), null when it never finished. */
  prewarmDurationMs: number | null; prewarmReadyMs: number | null;
}
export interface RunSample { run: number; width: number; workers: number; firstTriggerOffsetMs: number; children: ChildSample[];
  /** Node CPU (user+system) from prewarm start to the last response, and the machine's busy share over the dispatch window. */
  nodeCpuMs: number | null; systemBusyPct: number | null }

export interface WidthSummary {
  width: number; workers: number; attempts: number; runs: number;
  /** configured trigger → transport call / fetch() / Chrome request start (the last one is the configured→actual error). */
  triggerToTransport: Stats; triggerToFetch: Stats; triggerToChromeStart: Stats; triggerToRequestEvent: Stats;
  /** Chrome request start of the first vs last child of a run. */
  spread: Stats;
  perChildIndex: Array<{ fanOutIndex: number; triggerToChromeStart: Stats; chromeStart: Stats }>;
  perWorker: Record<string, Stats>;
  prewarm: { duration: Stats; lastReadyMarginMs: Stats; notReady: number };
  cpu: { nodeCpuMs: Stats; systemBusyPct: Stats; busyVsSpreadCorrelation: number | null };
  states: Record<string, number>;
  /** Safety: Chrome started a child's request before its configured trigger (must be 0). */
  earlyTransmissions: number;
  /** Children whose Chrome request start was never recorded (a fallback or failure; must be 0). */
  missingChromeStart: number;
}

const diff = (a: number | null, b: number | null) => a === null || b === null ? null : b - a;
function correlation(xs: number[], ys: number[]): number | null {
  if (xs.length < 3 || xs.length !== ys.length) return null;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let index = 0; index < xs.length; index++) { const dx = xs[index]! - mx, dy = ys[index]! - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? round(sxy / Math.sqrt(sxx * syy)) : null;
}

export function summarizeWidth(width: number, runs: readonly RunSample[]): WidthSummary {
  const children = runs.flatMap(run => run.children);
  const error = (child: ChildSample, value: number | null) => diff(child.configuredOffsetMs, value);
  const spreads = runs.map(run => { const starts = run.children.map(child => child.chromeStartMs).filter((value): value is number => value !== null);
    return starts.length === run.children.length && starts.length > 1 ? Math.max(...starts) - Math.min(...starts) : null; });
  const margins = runs.map(run => { const ready = run.children.map(child => child.prewarmReadyMs);
    return ready.some(value => value === null) ? null : run.firstTriggerOffsetMs - Math.max(...(ready as number[])); });
  const states: Record<string, number> = {};
  for (const child of children) states[child.state] = (states[child.state] ?? 0) + 1;
  const indices = [...new Set(children.map(child => child.fanOutIndex))].sort((a, b) => a - b);
  const workerIds = [...new Set(children.map(child => child.workerId))].sort();
  const busy = runs.flatMap((run, index) => run.systemBusyPct !== null && spreads[index] !== null ? [[run.systemBusyPct, spreads[index]!] as const] : []);
  return {
    width, workers: runs[0]?.workers ?? 0, attempts: (runs[0]?.workers ?? 0) * width, runs: runs.length,
    triggerToTransport: stats(children.map(child => error(child, child.workerInvokedMs))),
    triggerToFetch: stats(children.map(child => error(child, child.fetchInvokedMs))),
    triggerToChromeStart: stats(children.map(child => error(child, child.chromeStartMs))),
    triggerToRequestEvent: stats(children.map(child => error(child, child.requestEventMs))),
    spread: stats(spreads),
    perChildIndex: indices.map(index => { const selected = children.filter(child => child.fanOutIndex === index);
      return { fanOutIndex: index, triggerToChromeStart: stats(selected.map(child => error(child, child.chromeStartMs))), chromeStart: stats(selected.map(child => child.chromeStartMs)) }; }),
    perWorker: Object.fromEntries(workerIds.map(worker => [worker, stats(children.filter(child => child.workerId === worker).map(child => error(child, child.chromeStartMs)))])),
    prewarm: { duration: stats(children.map(child => child.prewarmDurationMs)), lastReadyMarginMs: stats(margins),
      notReady: children.filter(child => child.prewarmReadyMs === null || child.prewarmReadyMs > child.configuredOffsetMs).length },
    cpu: { nodeCpuMs: stats(runs.map(run => run.nodeCpuMs)), systemBusyPct: stats(runs.map(run => run.systemBusyPct)),
      busyVsSpreadCorrelation: correlation(busy.map(value => value[0]), busy.map(value => value[1])) },
    states,
    earlyTransmissions: children.filter(child => child.chromeStartMs !== null && child.chromeStartMs < child.configuredOffsetMs).length,
    missingChromeStart: children.filter(child => child.chromeStartMs === null).length,
  };
}

/**
 * Local dispatch regression gates, in the spirit of src/arbitration/benchmark-gates.ts: a wider fan-out passes only
 * while its timing stays within factor × (the same machine's width-1 value) + slack. There are no absolute
 * "winning" targets; these limits only say how much local degradation is tolerated for extra children.
 */
export interface FanOutGate { metric: 'triggerToChromeStart' | 'spread'; stat: 'p50' | 'p95' | 'p99' | 'max'; factor: number; slackMs: number }
export const FANOUT_GATES: readonly FanOutGate[] = Object.freeze([
  { metric: 'triggerToChromeStart', stat: 'p50', factor: 1.5, slackMs: 2 },
  { metric: 'triggerToChromeStart', stat: 'p95', factor: 1.5, slackMs: 3 },
  { metric: 'triggerToChromeStart', stat: 'p99', factor: 1.5, slackMs: 5 },
  { metric: 'spread', stat: 'p95', factor: 2, slackMs: 5 },
  // Tails: one descheduled process or a stalled browser shows up only here (a median or p95 can hide it).
  { metric: 'spread', stat: 'p99', factor: 2, slackMs: 8 },
  { metric: 'triggerToChromeStart', stat: 'max', factor: 2, slackMs: 15 },
] as FanOutGate[]);
/** A width whose slowest child was not ready at least this long before its trigger fails the readiness gate. */
export const FANOUT_MIN_READY_MARGIN_MS = 1_000;

export interface GateOutcome { width: number; gate: string; value: number | null; limit: number | null; pass: boolean }
export function evaluateFanOutGates(summary: WidthSummary, baseline: WidthSummary, gates: readonly FanOutGate[] = FANOUT_GATES): GateOutcome[] {
  const outcomes: GateOutcome[] = [];
  for (const gate of gates) {
    const value = summary[gate.metric][gate.stat], base = baseline[gate.metric][gate.stat];
    // A width-1 run has no meaningful spread across one child per worker only when there is one worker.
    if (value === null && base === null) continue;
    const limit = base === null ? null : round(Math.max(0, base) * gate.factor + gate.slackMs);
    outcomes.push({ width: summary.width, gate: `${gate.metric}.${gate.stat} ≤ ${gate.factor}× width-1 + ${gate.slackMs} ms`, value, limit,
      pass: value !== null && limit !== null && value <= limit });
  }
  const safety = Object.entries(summary.states).filter(([state]) => state !== 'REJECTED').reduce((sum, [, count]) => sum + count, 0);
  outcomes.push({ width: summary.width, gate: 'every offline attempt settled REJECTED', value: safety, limit: 0, pass: safety === 0 && (summary.states.REJECTED ?? 0) > 0 });
  outcomes.push({ width: summary.width, gate: 'no Chrome request before its configured trigger', value: summary.earlyTransmissions, limit: 0, pass: summary.earlyTransmissions === 0 });
  outcomes.push({ width: summary.width, gate: 'every child recorded a Chrome request start', value: summary.missingChromeStart, limit: 0, pass: summary.missingChromeStart === 0 });
  const margin = summary.prewarm.lastReadyMarginMs.min;
  outcomes.push({ width: summary.width, gate: `every child prepared ≥ ${FANOUT_MIN_READY_MARGIN_MS} ms before its trigger`, value: margin, limit: FANOUT_MIN_READY_MARGIN_MS,
    pass: summary.prewarm.notReady === 0 && margin !== null && margin >= FANOUT_MIN_READY_MARGIN_MS });
  return outcomes;
}

export interface FanOutRecommendation {
  width: number; reasons: string[]; gates: GateOutcome[];
  /** Always true: this is a local dispatch recommendation, never a statement about winning a booking. */
  localDispatchOnly: true;
}
/** The widest measured width such that it and every narrower width pass all gates against width 1. */
export function recommendFanOutWidth(widths: readonly WidthSummary[]): FanOutRecommendation {
  const sorted = [...widths].sort((a, b) => a.width - b.width), baseline = sorted.find(value => value.width === 1);
  if (!baseline) return { width: 1, reasons: ['No width-1 baseline was measured; 1 attempt per target is the only safe recommendation.'], gates: [], localDispatchOnly: true };
  const gates: GateOutcome[] = [], reasons: string[] = [];
  let width = 1;
  const baseSafety = evaluateFanOutGates(baseline, baseline).filter(gate => !gate.gate.includes('width-1'));
  gates.push(...baseSafety);
  if (baseSafety.some(gate => !gate.pass)) reasons.push(`Width 1 itself failed a safety or readiness gate (${baseSafety.filter(gate => !gate.pass).map(gate => gate.gate).join('; ')}); fix that before using fan-out.`);
  for (const summary of sorted.filter(value => value.width > 1)) {
    const outcome = evaluateFanOutGates(summary, baseline);
    gates.push(...outcome);
    const failed = outcome.filter(gate => !gate.pass);
    if (failed.length || baseSafety.some(gate => !gate.pass)) {
      reasons.push(`${summary.attempts}-way fan-out (${summary.width} per target) exceeds the local gates: ${failed.map(gate =>
        `${gate.gate} (measured ${gate.value ?? 'n/a'}${gate.limit !== null ? `, limit ${gate.limit}` : ''})`).join('; ') || 'width 1 failed first'}.`);
      break;
    }
    width = summary.width;
    reasons.push(`${summary.attempts}-way fan-out (${summary.width} per target) stays inside the local dispatch regression gates `
      + `(Chrome-start p95 ${summary.triggerToChromeStart.p95} ms vs ${baseline.triggerToChromeStart.p95} ms at width 1; spread p95 ${summary.spread.p95} ms).`);
  }
  return { width, reasons, gates, localDispatchOnly: true };
}

export const MachineSchema = z.object({ cpuModel: z.string().max(200), logicalCores: z.number().int().positive(), totalMemGb: z.number().nonnegative(),
  platform: z.string().max(40), osRelease: z.string().max(80), chromeVersion: z.string().max(80).nullable() }).strict();
export type MachineIdentity = z.infer<typeof MachineSchema>;
const statsSchema = z.object({ n: z.number(), p50: z.number().nullable(), p95: z.number().nullable(), p99: z.number().nullable(), max: z.number().nullable(),
  min: z.number().nullable(), mean: z.number().nullable() }).strict();
export const FanOutProfileSchema = z.object({
  schema: z.literal(FANOUT_PROFILE_SCHEMA),
  createdAt: z.iso.datetime(),
  build: z.object({ gitSha: z.string().max(64), buildId: z.string().max(80), dirty: z.boolean().nullable() }).strict(),
  machine: MachineSchema,
  config: z.object({ workers: z.number().int().min(1).max(7), widths: z.array(z.number().int().min(1).max(FANOUT_MAX_WIDTH)).min(1), runsPerWidth: z.number().int().positive(),
    pattern: z.string().max(80), dispatcher: z.enum(['central', 'coordinator', 'renderer']), prewarmLeadMs: z.number().int().nonnegative(),
    prewarmConcurrency: z.number().int().positive().nullable(), headed: z.boolean(), syntheticPrewarm: z.string().max(80), pageBusy: z.string().max(40) }).strict(),
  widths: z.array(z.object({ width: z.number().int(), workers: z.number().int(), attempts: z.number().int(), runs: z.number().int(),
    triggerToTransport: statsSchema, triggerToFetch: statsSchema, triggerToChromeStart: statsSchema, triggerToRequestEvent: statsSchema, spread: statsSchema,
    perChildIndex: z.array(z.object({ fanOutIndex: z.number().int(), triggerToChromeStart: statsSchema, chromeStart: statsSchema }).strict()),
    perWorker: z.record(z.string(), statsSchema),
    prewarm: z.object({ duration: statsSchema, lastReadyMarginMs: statsSchema, notReady: z.number().int() }).strict(),
    cpu: z.object({ nodeCpuMs: statsSchema, systemBusyPct: statsSchema, busyVsSpreadCorrelation: z.number().nullable() }).strict(),
    states: z.record(z.string(), z.number()), earlyTransmissions: z.number().int(), missingChromeStart: z.number().int() }).strict()).min(1),
  recommendation: z.object({ width: z.number().int().min(1).max(FANOUT_MAX_WIDTH), reasons: z.array(z.string()), localDispatchOnly: z.literal(true),
    gates: z.array(z.object({ width: z.number().int(), gate: z.string(), value: z.number().nullable(), limit: z.number().nullable(), pass: z.boolean() }).strict()) }).strict(),
}).strict();
export type FanOutProfile = z.infer<typeof FanOutProfileSchema>;

export const FANOUT_PROFILE_DIRECTORY = '.local/fanout-capacity';
/** Profiles older than this are shown as stale (the machine, Chrome or background load may have changed). */
export const FANOUT_PROFILE_MAX_AGE_MS = 30 * 24 * 60 * 60_000;

export interface ProfileCompatibility { compatible: boolean; stale: boolean; notes: string[] }
/** A profile applies only to the machine it was measured on and to the Node dispatcher the app uses. */
export function profileCompatibility(profile: FanOutProfile, current: { machine: MachineIdentity; gitSha?: string; now?: number; dispatcher?: FanOutProfile['config']['dispatcher'] }): ProfileCompatibility {
  const notes: string[] = [];
  const same = profile.machine.cpuModel === current.machine.cpuModel && profile.machine.logicalCores === current.machine.logicalCores && profile.machine.platform === current.machine.platform;
  if (!same) notes.push('Measured on a different machine.');
  if (profile.config.dispatcher !== (current.dispatcher ?? 'central')) notes.push(`Measured with the ${profile.config.dispatcher} dispatcher.`);
  const age = (current.now ?? Date.now()) - Date.parse(profile.createdAt);
  const stale = age > FANOUT_PROFILE_MAX_AGE_MS || (!!current.gitSha && current.gitSha !== 'unknown' && profile.build.gitSha !== current.gitSha);
  if (age > FANOUT_PROFILE_MAX_AGE_MS) notes.push('Older than 30 days: re-run the benchmark.');
  if (current.machine.chromeVersion && profile.machine.chromeVersion && current.machine.chromeVersion !== profile.machine.chromeVersion) notes.push(`Chrome changed since (${profile.machine.chromeVersion} → ${current.machine.chromeVersion}).`);
  if (current.gitSha && current.gitSha !== 'unknown' && profile.build.gitSha !== current.gitSha) notes.push(`Measured on build ${profile.build.gitSha.slice(0, 7)}; this build is ${current.gitSha.slice(0, 7)}.`);
  return { compatible: same && profile.config.dispatcher === (current.dispatcher ?? 'central'), stale, notes };
}

/** All readable profiles under one or more roots (e.g. the installation and its Source folder), newest first. Malformed files are skipped. */
export function readFanOutProfiles(root: string | readonly string[]): FanOutProfile[] {
  const seen = new Set<string>();
  return (typeof root === 'string' ? [root] : root).flatMap(base => {
    const directory = join(base, FANOUT_PROFILE_DIRECTORY);
    if (!existsSync(directory)) return [];
    return readdirSync(directory).filter(name => /^profile-.*\.json$/.test(name)).flatMap(name => {
      try { return [FanOutProfileSchema.parse(JSON.parse(readFileSync(join(directory, name), 'utf8')))]; } catch { return []; }
    });
  }).filter(profile => { const key = `${profile.createdAt}/${profile.config.dispatcher}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
/** The newest profile compatible with this machine and dispatcher, or null. */
export function readLatestCompatibleFanOutProfile(root: string | readonly string[], current: Parameters<typeof profileCompatibility>[1]): { profile: FanOutProfile; compatibility: ProfileCompatibility } | null {
  for (const profile of readFanOutProfiles(root)) {
    const compatibility = profileCompatibility(profile, current);
    if (compatibility.compatible) return { profile, compatibility };
  }
  return null;
}

/** This process's machine identity (Chrome version unknown here). */
export function currentMachineIdentity(): MachineIdentity {
  // Lazy import keeps this module's top level free of Node-only side effects for type-only consumers.
  const os = process.getBuiltinModule('node:os') as typeof import('node:os');
  return { cpuModel: os.cpus()[0]?.model ?? 'unknown', logicalCores: os.cpus().length, totalMemGb: Math.round(os.totalmem() / 2 ** 30), platform: os.platform(),
    osRelease: os.release(), chromeVersion: null };
}
export interface FanOutProfileDigestEntry { createdAt: string; dispatcher: string; compatible: boolean; stale: boolean; notes: string[]; recommendedWidth: number; reasons: string[];
  widths: Array<{ width: number; attempts: number; chromeP50: number | null; chromeP95: number | null; chromeP99: number | null; chromeMax: number | null; spreadP95: number | null; perChildP95: Array<number | null> }> }
function digestEntry(profile: FanOutProfile, compatibility: ProfileCompatibility): FanOutProfileDigestEntry {
  return { createdAt: profile.createdAt, dispatcher: profile.config.dispatcher, compatible: compatibility.compatible, stale: compatibility.stale, notes: compatibility.notes,
    recommendedWidth: profile.recommendation.width, reasons: profile.recommendation.reasons,
    widths: profile.widths.map(width => ({ width: width.width, attempts: width.attempts, chromeP50: width.triggerToChromeStart.p50, chromeP95: width.triggerToChromeStart.p95,
      chromeP99: width.triggerToChromeStart.p99, chromeMax: width.triggerToChromeStart.max, spreadP95: width.spread.p95,
      perChildP95: width.perChildIndex.map(value => value.triggerToChromeStart.p95) })) };
}
/** Newest compatible profile (in full, for timing presets) plus a short history of every readable profile on this machine. */
export function fanOutDigest(root: string | readonly string[], current: Parameters<typeof profileCompatibility>[1]): { latest: (FanOutProfileDigestEntry & { profile: FanOutProfile }) | null; history: FanOutProfileDigestEntry[] } {
  const profiles = readFanOutProfiles(root);
  const history = profiles.slice(0, 12).map(profile => digestEntry(profile, profileCompatibility(profile, current)));
  const latest = readLatestCompatibleFanOutProfile(root, current);
  return { latest: latest ? { ...digestEntry(latest.profile, latest.compatibility), profile: latest.profile } : null, history };
}
