/**
 * Before/after differences between the saved release authorization and a draft's runtime representation.
 * Dependency-free. The summary rows are what an operator reasons about (attempts, offsets, courts, browsers, times);
 * the field rows list every other changed value so nothing differs silently.
 */
export interface PlanDifference { label: string; saved: string; draft: string }
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
interface SetupLike {
  BOOKING_METHOD?: string; RELEASE_STRATEGY?: string; START_TIME?: string; DURATION_HOURS?: number; COURT_COUNT?: number;
  PRECISION_PHASE3?: { candidates: Array<{ court: number; start: string; durationHours: number; wing?: string; rateEvidence?: { date?: string } }>; wave1: Array<{ candidateIndex: number; workerId: string; releaseOffsetMs?: number; fanOutOffsetsMs?: number[] }>;
    budgets?: { wave2: number; rescue: number; total: number }; rescueEnabled?: boolean };
  STRATEGY_V2?: { shotgun?: { enabled?: boolean; exactSchedule?: Array<{ configuredOffsetMs: number }>; counts?: Record<string, number> } };
}
const text = (value: unknown, max = 90): string => { const s = value === undefined ? '—' : typeof value === 'string' ? value : JSON.stringify(value); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };
const sends = (s: SetupLike) => s.PRECISION_PHASE3?.wave1.reduce((n, a) => n + (a.fanOutOffsetsMs?.length ?? 1), 0);
const offsets = (s: SetupLike) => {
  const shotgun = s.STRATEGY_V2?.shotgun?.exactSchedule?.map(shot => shot.configuredOffsetMs);
  const list = shotgun ?? s.PRECISION_PHASE3?.wave1.flatMap(a => a.fanOutOffsetsMs ?? [a.releaseOffsetMs ?? 0]);
  return list ? [...list].sort((a, b) => a - b).join(', ') : undefined;
};
const allocation = (s: SetupLike) => {
  const p = s.PRECISION_PHASE3; if (!p) return undefined;
  const byCourt = new Map<string, number>();
  for (const a of p.wave1) { const c = p.candidates[a.candidateIndex]; if (!c) continue; const key = `${c.wing === 'BUKO' ? 'Buko' : 'Court'} ${c.court} ${c.start} ${c.durationHours}h`; byCourt.set(key, (byCourt.get(key) ?? 0) + (a.fanOutOffsetsMs?.length ?? 1)); }
  return [...byCourt].map(([k, n]) => `${k} ×${n}`).join(' · ');
};
const browsers = (s: SetupLike) => s.PRECISION_PHASE3?.wave1.map(a => `${a.workerId}:${a.fanOutOffsetsMs?.length ?? 1}`).join(' ');
const backups = (s: SetupLike) => s.PRECISION_PHASE3 ? `wave 2 ${s.PRECISION_PHASE3.budgets?.wave2 ?? 0} · rescue ${s.PRECISION_PHASE3.rescueEnabled ? s.PRECISION_PHASE3.budgets?.rescue ?? 0 : 'off'}` : undefined;
const SUMMARY: Array<[string, (s: SetupLike) => unknown]> = [
  ['Booking date', s => s.PRECISION_PHASE3 ? [...new Set(s.PRECISION_PHASE3.candidates.map(c => c.rateEvidence?.date ?? '—'))].join(', ') : undefined],
  ['Checkout method', s => s.BOOKING_METHOD], ['Release strategy', s => s.STRATEGY_V2?.shotgun?.enabled ? 'Shotgun' : s.RELEASE_STRATEGY],
  ['Attempts', sends], ['Court allocation', allocation], ['Exact offsets (ms)', offsets], ['Browsers (tabs)', browsers], ['Backups / rescue', backups],
  ['Start · duration', s => s.START_TIME !== undefined ? `${s.START_TIME} · ${s.DURATION_HOURS} h` : undefined],
];
function leaves(value: unknown, path: string, out: Map<string, string>) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) { for (const [k, v] of Object.entries(value as Record<string, Json>)) leaves(v, path ? `${path}.${k}` : k, out); return; }
  if (Array.isArray(value) && value.some(v => v !== null && typeof v === 'object')) { value.forEach((v, i) => leaves(v, `${path}[${i}]`, out)); if (!value.length) out.set(path, '[]'); return; }
  out.set(path, JSON.stringify(value));
}
/**
 * Lineage metadata that authorizes nothing: the Booking Setup objective fingerprint embeds the release instant, so it
 * changes every release day for an otherwise identical plan. It is not part of planFingerprint and no runtime reads it.
 */
const NON_AUTHORIZING = new Set(['STRATEGY_V2.objective.fingerprint']);
export function setupDifferences(saved: unknown, draft: unknown, limit = 30): { summary: PlanDifference[]; fields: PlanDifference[]; total: number } {
  const a = (saved ?? {}) as SetupLike, b = (draft ?? {}) as SetupLike;
  const summary = SUMMARY.flatMap(([label, read]) => { const x = text(read(a)), y = text(read(b)); return x === y ? [] : [{ label, saved: x, draft: y }]; });
  const left = new Map<string, string>(), right = new Map<string, string>();
  leaves(saved, '', left); leaves(draft, '', right);
  const paths = [...new Set([...left.keys(), ...right.keys()])].filter(p => !NON_AUTHORIZING.has(p) && left.get(p) !== right.get(p)).sort();
  return { summary, fields: paths.slice(0, limit).map(p => ({ label: p, saved: text(left.has(p) ? JSON.parse(left.get(p)!) : undefined, 60), draft: text(right.has(p) ? JSON.parse(right.get(p)!) : undefined, 60) })), total: paths.length };
}
