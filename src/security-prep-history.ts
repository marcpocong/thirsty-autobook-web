import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Measured genuine security-preparation durations from this installation's own run logs
 * (.local/api-booking/run-progress/*.ndjson, stage SECURITY_PREPARATION_COMPLETED, FRESH_ACQUISITION only).
 * Used to size the prewarm lead of a fan-out release; it never changes what is sent.
 */
export interface PrepSample { durationMs: number; concurrent: number; at: string }
export interface PrepHistory { samples: number; p50Ms: number | null; p95Ms: number | null; atConcurrency: number | null; files: number }

const percentile = (values: number[], p: number) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!; };

export function readSecurityPrepSamples(root: string, options: { maxFiles?: number; maxAgeMs?: number; now?: number } = {}): { samples: PrepSample[]; files: number } {
  const directory = join(root, '.local/api-booking/run-progress');
  if (!existsSync(directory)) return { samples: [], files: 0 };
  const now = options.now ?? Date.now(), maxAge = options.maxAgeMs ?? 21 * 24 * 60 * 60_000;
  const files = readdirSync(directory).filter(name => name.endsWith('.ndjson')).map(name => ({ name, mtime: statSync(join(directory, name)).mtimeMs }))
    .filter(file => now - file.mtime <= maxAge).sort((a, b) => b.mtime - a.mtime).slice(0, options.maxFiles ?? 60);
  const samples: PrepSample[] = [];
  for (const file of files) {
    let text: string;
    try { text = readFileSync(join(directory, file.name), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.includes('"SECURITY_PREPARATION_COMPLETED"') || !line.includes('"FRESH_ACQUISITION"')) continue;
      try {
        const value = JSON.parse(line) as { durationMs?: unknown; activeSecurity?: unknown; at?: unknown; failureCategory?: unknown };
        if (typeof value.durationMs !== 'number' || !(value.durationMs > 0) || value.durationMs > 120_000 || value.failureCategory) continue;
        samples.push({ durationMs: value.durationMs, concurrent: typeof value.activeSecurity === 'number' ? value.activeSecurity + 1 : 1, at: String(value.at ?? '') });
      } catch { /* a torn line is skipped */ }
    }
  }
  return { samples, files: files.length };
}

/**
 * p50/p95 preparation time at (up to) the given concurrency; falls back to every sample when none match.
 * Genuine preparations slow down when many run at once (2026-09-29: 28 in parallel took 7.6–11.8 s).
 */
export function securityPrepHistory(root: string, concurrency: number, options?: Parameters<typeof readSecurityPrepSamples>[1]): PrepHistory {
  const { samples, files } = readSecurityPrepSamples(root, options);
  const matching = samples.filter(sample => sample.concurrent <= Math.max(1, concurrency));
  const chosen = matching.length >= 5 ? matching : samples;
  return { samples: chosen.length, p50Ms: percentile(chosen.map(sample => sample.durationMs), 50), p95Ms: percentile(chosen.map(sample => sample.durationMs), 95),
    atConcurrency: matching.length >= 5 ? concurrency : null, files };
}
