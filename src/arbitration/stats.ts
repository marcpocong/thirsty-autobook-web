/** Small, dependency-free statistics used by the arbitration analyses, simulator and benchmarks. Deterministic. */

export interface Summary { n: number; min: number | null; p50: number | null; p95: number | null; p99: number | null; max: number | null; mean: number | null }
const round = (value: number, digits = 3) => { const scale = 10 ** digits; return Math.round(value * scale) / scale; };

/** Nearest-rank percentile (the convention used by the existing release benchmarks). */
export function percentile(values: readonly number[], p: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

export function summarize(values: readonly number[], digits = 3): Summary {
  const finite = values.filter(Number.isFinite);
  const at = (p: number) => { const value = percentile(finite, p); return value === null ? null : round(value, digits); };
  return { n: finite.length, min: finite.length ? round(Math.min(...finite), digits) : null, p50: at(50), p95: at(95), p99: at(99),
    max: finite.length ? round(Math.max(...finite), digits) : null,
    mean: finite.length ? round(finite.reduce((sum, value) => sum + value, 0) / finite.length, digits) : null };
}

/** Kendall's tau-a between two equally long rankings (ties count as neither concordant nor discordant). */
export function kendallTau(a: readonly number[], b: readonly number[]): number | null {
  if (a.length !== b.length || a.length < 2) return null;
  let concordant = 0, discordant = 0;
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) {
    const sign = Math.sign(a[i]! - a[j]!) * Math.sign(b[i]! - b[j]!);
    if (sign > 0) concordant++; else if (sign < 0) discordant++;
  }
  return round((concordant - discordant) / (a.length * (a.length - 1) / 2), 4);
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/**
 * Two-sided Mann–Whitney U test with the normal approximation and tie correction.
 * Returns the probability-of-superiority effect size P(a > b) + 0.5·P(a = b) as well.
 */
export function mannWhitney(a: readonly number[], b: readonly number[]): { u: number; z: number; pTwoSided: number; probabilityAGreater: number } | null {
  const x = a.filter(Number.isFinite), y = b.filter(Number.isFinite);
  if (x.length < 2 || y.length < 2) return null;
  const all = [...x.map(value => ({ value, group: 0 })), ...y.map(value => ({ value, group: 1 }))].sort((p, q) => p.value - q.value);
  const ranks = new Array<number>(all.length);
  let tieTerm = 0;
  for (let i = 0; i < all.length;) {
    let j = i; while (j + 1 < all.length && all[j + 1]!.value === all[i]!.value) j++;
    const rank = (i + j) / 2 + 1, size = j - i + 1;
    for (let k = i; k <= j; k++) ranks[k] = rank;
    tieTerm += size ** 3 - size;
    i = j + 1;
  }
  const rankSumA = all.reduce((sum, item, index) => item.group === 0 ? sum + ranks[index]! : sum, 0);
  const n1 = x.length, n2 = y.length, n = n1 + n2;
  const u = rankSumA - n1 * (n1 + 1) / 2;
  const mean = n1 * n2 / 2, variance = (n1 * n2 / 12) * ((n + 1) - tieTerm / (n * (n - 1)));
  const z = variance > 0 ? (u - mean) / Math.sqrt(variance) : 0;
  return { u: round(u, 2), z: round(z, 3), pTwoSided: round(2 * (1 - normalCdf(Math.abs(z))), 4), probabilityAGreater: round(u / (n1 * n2), 4) };
}

/** Deterministic PRNG (mulberry32). Same seed, same sequence, on every platform. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Log-normal sample with the given median and dispersion (sigma of the underlying normal). */
export function logNormal(random: () => number, median: number, sigma: number): number {
  const u1 = Math.max(random(), 1e-12), u2 = random();
  const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return median * Math.exp(sigma * normal);
}

/**
 * Groups completion times into bursts: consecutive values (sorted) closer than `gapMs` form one cluster.
 * Used to find "stall and flush" batches where many requests finish together.
 */
export function clusters(times: ReadonlyArray<{ id: string; at: number }>, gapMs: number): Array<{ start: number; end: number; ids: string[] }> {
  const sorted = [...times].filter(item => Number.isFinite(item.at)).sort((a, b) => a.at - b.at);
  const result: Array<{ start: number; end: number; ids: string[] }> = [];
  for (const item of sorted) {
    const last = result.at(-1);
    if (last && item.at - last.end <= gapMs) { last.end = item.at; last.ids.push(item.id); }
    else result.push({ start: item.at, end: item.at, ids: [item.id] });
  }
  return result;
}
