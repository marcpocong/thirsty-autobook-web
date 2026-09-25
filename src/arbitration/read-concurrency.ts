import { parseVercelId, sanitizeResponseHeaders } from '../api-booking/response-evidence.js';
import { kendallTau, seededRandom, summarize } from './stats.js';

/**
 * Safe, read-only concurrency characterization (1/2/4/7 simultaneous reads from one client).
 *
 * Question: does the provider process simultaneous requests from one client in parallel, or serialize them
 * (a per-IP/per-client limiter, a per-connection queue, a shared lock)? Checkouts cannot be used for this
 * (each would create a hold), so only the public availability read the booking page itself performs is used:
 * GET /api/public/facilities/{facility}/date-availability, no credentials, no cookies.
 *
 * Safety (enforced here, not by convention):
 *   - never between 07:45 and 08:45 Asia/Manila (release window) — refused before any request;
 *   - at most 7 in flight, rounds at least 5 s apart, a hard total request cap;
 *   - STOP at the first 403/429/5xx, Cloudflare/Vercel mitigation header, non-JSON (challenge) page or a read
 *     slower than 10 s: the provider's normal protections and load are respected, never worked around;
 *   - offline unless the caller passes the exact live acknowledgement (scripts/characterize-read-concurrency.ts).
 */
export const LIVE_ACKNOWLEDGEMENT = 'READ_ONLY_PUBLIC_AVAILABILITY';
export const SAFE_LEVELS: readonly number[] = [1, 2, 4, 7];
export interface HarnessLimits { maxRequests: number; minRoundGapMs: number; slowReadStopMs: number; blackout: { fromMinute: number; toMinute: number } }
export const DEFAULT_HARNESS_LIMITS: HarnessLimits = Object.freeze({ maxRequests: 120, minRoundGapMs: 5_000, slowReadStopMs: 10_000,
  blackout: { fromMinute: 7 * 60 + 45, toMinute: 8 * 60 + 45 } });

export class HarnessStop extends Error { constructor(readonly code: string) { super(code); this.name = 'HarnessStop'; } }

/** Manila is UTC+8 with no daylight saving. */
export function manilaMinuteOfDay(epochMs: number): number { return Math.floor(((epochMs + 8 * 3_600_000) % 86_400_000) / 60_000); }
export function assertOutsideBlackout(epochMs: number, limits: HarnessLimits = DEFAULT_HARNESS_LIMITS): void {
  const minute = manilaMinuteOfDay(epochMs);
  if (minute >= limits.blackout.fromMinute && minute < limits.blackout.toMinute) throw new HarnessStop('HARNESS_RELEASE_WINDOW_BLACKOUT');
}

/** A balanced, shuffled order of levels (each `rounds` times), so drift over the session does not bias one level. */
export function roundPlan(levels: readonly number[], rounds: number, seed: number, limits: HarnessLimits = DEFAULT_HARNESS_LIMITS): number[] {
  if (!levels.length || levels.some(level => !SAFE_LEVELS.includes(level)) || !(rounds >= 1)) throw new HarnessStop('HARNESS_PLAN_INVALID');
  const plan = levels.flatMap(level => Array.from({ length: rounds }, () => level));
  const random = seededRandom(seed);
  for (let index = plan.length - 1; index > 0; index--) { const other = Math.floor(random() * (index + 1)); [plan[index], plan[other]] = [plan[other]!, plan[index]!]; }
  if (plan.reduce((sum, level) => sum + level, 0) > limits.maxRequests) throw new HarnessStop('HARNESS_REQUEST_CAP');
  return plan;
}

export interface ReadSample {
  level: number; round: number; index: number; date: string;
  /** Local monotonic ms. */
  startMs: number; headersMs: number | null; endMs: number | null;
  status: number | null; bytes: number | null; contentType: string | null;
  cache: string | null; ageS: number | null; edgeRegion: string | null; functionRegion: string | null; embeddedMs: number | null;
  headers: Partial<Record<string, string>>; mitigated: boolean; error: string | null;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
export interface RoundOptions { urlFor: (date: string) => string; dates: readonly string[]; fetcher: Fetcher; perf?: () => number; timeoutMs?: number }

/** Launches `level` reads in the same tick and waits for all of them. Throws HarnessStop on any protective signal. */
export async function runRound(level: number, round: number, options: RoundOptions, limits: HarnessLimits = DEFAULT_HARNESS_LIMITS): Promise<ReadSample[]> {
  const perf = options.perf ?? (() => performance.now());
  const launches = Array.from({ length: level }, (_, index) => {
    const date = options.dates[(round + index) % options.dates.length]!;
    const sample: ReadSample = { level, round, index, date, startMs: perf(), headersMs: null, endMs: null, status: null, bytes: null, contentType: null,
      cache: null, ageS: null, edgeRegion: null, functionRegion: null, embeddedMs: null, headers: {}, mitigated: false, error: null };
    const done = (async () => {
      try {
        const response = await options.fetcher(options.urlFor(date), { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
          headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(options.timeoutMs ?? 15_000) });
        sample.headersMs = perf();
        const body = await response.text();
        sample.endMs = perf();
        const headers: Record<string, string> = {};
        response.headers.forEach((value, name) => { headers[name] = value; });
        sample.headers = sanitizeResponseHeaders(headers);
        sample.mitigated = Boolean(headers['cf-mitigated']) || /challenge|deny/i.test(headers['x-vercel-mitigated'] ?? '');
        sample.status = response.status; sample.bytes = Buffer.byteLength(body, 'utf8'); sample.contentType = response.headers.get('content-type');
        sample.cache = response.headers.get('x-vercel-cache');
        const age = Number(response.headers.get('age')); sample.ageS = Number.isFinite(age) && response.headers.get('age') !== null ? age : null;
        const vercel = parseVercelId(response.headers.get('x-vercel-id') ?? '');
        sample.edgeRegion = vercel?.edgeRegion ?? null; sample.functionRegion = vercel?.functionRegion ?? null; sample.embeddedMs = vercel?.embeddedMs ?? null;
      } catch (error) { sample.endMs = perf(); sample.error = error instanceof Error ? error.name : 'ERROR'; }
    })();
    return { sample, done };
  });
  await Promise.all(launches.map(launch => launch.done));
  const samples = launches.map(launch => launch.sample);
  for (const sample of samples) {
    if (sample.error) throw new HarnessStop('HARNESS_STOP_TRANSPORT_ERROR');
    if (sample.status === 403 || sample.status === 429 || (sample.status ?? 0) >= 500) throw new HarnessStop(`HARNESS_STOP_HTTP_${sample.status}`);
    if (sample.mitigated) throw new HarnessStop('HARNESS_STOP_MITIGATED');
    if (!(sample.contentType ?? '').toLowerCase().includes('application/json')) throw new HarnessStop('HARNESS_STOP_NOT_JSON');
    if (sample.endMs! - sample.startMs > limits.slowReadStopMs) throw new HarnessStop('HARNESS_STOP_SLOW_READ');
  }
  return samples;
}

export interface LevelAnalysis {
  level: number; rounds: number;
  latencyMs: ReturnType<typeof summarize>;
  /** Last minus first completion within a round. Parallel: ≈ jitter. Serialized: ≈ (level − 1) × service time. */
  completionSpanMs: ReturnType<typeof summarize>;
  /** completion span ÷ (level − 1) ÷ median level-1 latency: ≈1 when fully serialized, ≈0 when parallel. */
  serializationIndex: number | null;
  /** Kendall tau between launch order and completion order, per round (FIFO serialization pushes it towards 1). */
  orderTau: ReturnType<typeof summarize>;
  /** Spread of the provider-embedded x-vercel-id numbers within a round (UNDOCUMENTED meaning). */
  embeddedSpreadMs: ReturnType<typeof summarize>;
  cache: Record<string, number>;
  regions: Record<string, number>;
}
export function analyzeRounds(samples: readonly ReadSample[]): LevelAnalysis[] {
  const levels = [...new Set(samples.map(sample => sample.level))].sort((a, b) => a - b);
  const single = summarize(samples.filter(sample => sample.level === 1).map(sample => sample.endMs! - sample.startMs)).p50;
  return levels.map(level => {
    const own = samples.filter(sample => sample.level === level);
    const rounds = [...new Set(own.map(sample => sample.round))].map(round => own.filter(sample => sample.round === round));
    const spans = rounds.filter(round => round.length > 1).map(round => Math.max(...round.map(sample => sample.endMs!)) - Math.min(...round.map(sample => sample.endMs!)));
    const spanSummary = summarize(spans);
    const count = (pick: (sample: ReadSample) => string | null) => own.reduce<Record<string, number>>((result, sample) => {
      const key = pick(sample) ?? 'none'; result[key] = (result[key] ?? 0) + 1; return result; }, {});
    return { level, rounds: rounds.length, latencyMs: summarize(own.map(sample => sample.endMs! - sample.startMs)), completionSpanMs: spanSummary,
      serializationIndex: level > 1 && single && spanSummary.p50 !== null ? Math.round(spanSummary.p50 / (level - 1) / single * 1000) / 1000 : null,
      orderTau: summarize(rounds.filter(round => round.length > 1).map(round => kendallTau(round.map(sample => sample.startMs), round.map(sample => sample.endMs!)) ?? NaN)),
      embeddedSpreadMs: summarize(rounds.map(round => { const values = round.map(sample => sample.embeddedMs).filter((value): value is number => value !== null);
        return values.length > 1 ? Math.max(...values) - Math.min(...values) : NaN; })),
      cache: count(sample => sample.cache), regions: count(sample => sample.edgeRegion && sample.functionRegion ? `${sample.edgeRegion}→${sample.functionRegion}` : null) };
  });
}
