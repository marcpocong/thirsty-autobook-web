import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { WORKER_IDS } from './workers.js';

/**
 * Pre-release security check: one genuine Onda verification per worker's booking tab, run during preparation through
 * the exact transport path a release uses, with the value discarded. It shows that verification works in these
 * browsers now (or that it needs a person) minutes before release instead of seconds. It is not a promise that the
 * release-time acquisition will succeed, and it never makes a forecast or dry run count as security evidence.
 */
export const SECURITY_CHECK_PATH = '.local/security-check/latest.json';
/** A check older than this no longer stands for the current browser sessions. */
export const SECURITY_CHECK_MAX_AGE_MS = 60 * 60_000;
const code = z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/);
export const SecurityCheckWorkerSchema = z.object({ outcome: z.enum(['READY', 'FAILED']), durationMs: z.number().int().nonnegative(), code: code.optional(),
  challengeFrame: z.enum(['none', 'hidden', 'visible']).optional(), failedHelper: z.enum(['challenge', 'fingerprint']).optional(),
  /** Opaque launch identity of the Chrome that ran the check (src/browser-session.ts); never a token or the raw CDP id. */
  browserSession: z.string().regex(/^[a-f0-9]{16}$/).optional() }).strict();
export const SecurityCheckSchema = z.object({ schema: z.literal('security-check/v1'), checkedAt: z.iso.datetime(), targetDate: z.iso.date(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), workers: z.partialRecord(z.enum(WORKER_IDS), SecurityCheckWorkerSchema) }).strict();
export type SecurityCheck = z.infer<typeof SecurityCheckSchema>;
export type SecurityCheckWorker = z.infer<typeof SecurityCheckWorkerSchema>;

export function writeSecurityCheck(root: string, record: SecurityCheck): void {
  const path = join(root, SECURITY_CHECK_PATH), temporary = `${path}.${process.pid}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(temporary, `${JSON.stringify(SecurityCheckSchema.parse(record), null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}
export function readSecurityCheck(root: string): SecurityCheck | null {
  try { return SecurityCheckSchema.parse(JSON.parse(readFileSync(join(root, SECURITY_CHECK_PATH), 'utf8'))); } catch { return null; }
}

export type SecurityCheckStatus = 'PASSED' | 'FAILED' | 'STALE' | 'OTHER_PLAN' | 'OTHER_BROWSER' | 'MISSING';
export interface SecurityCheckWorkerResult { id: string; outcome: 'READY' | 'FAILED' | 'NOT_CHECKED'; durationMs: number | null; challengeFrame: 'none' | 'hidden' | 'visible' | null; code: string | null }
export interface SecurityCheckVerdict { status: SecurityCheckStatus; detail: string; checkedAt: string | null;
  /** When a PASSED check stops counting (checkedAt + SECURITY_CHECK_MAX_AGE_MS); null without a record. */ expiresAt?: string | null;
  /** Per required worker, for operator display only (no identity values). */ workers?: SecurityCheckWorkerResult[] }
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const describeWorker = (id: string, value: SecurityCheckWorker | undefined) => !value ? `${id} not checked`
  : value.outcome === 'READY' ? `${id} verified in ${seconds(value.durationMs)}${value.challengeFrame === 'visible' ? ' (after a person completed the check)' : ''}`
    : `${id} failed${value.code ? ` (${value.code})` : ''} after ${seconds(value.durationMs)}${value.challengeFrame && value.challengeFrame !== 'none' ? ` · challenge frame ${value.challengeFrame}` : ''}`;

/**
 * Whether the latest check stands for this exact saved plan, booking date and these exact browser processes now.
 * Only PASSED is evidence. `targetDate` and `sessions` are compared whenever the caller supplies them: a record for
 * another booking date, or from a Chrome that has since been closed or restarted, never establishes readiness even when
 * every other field matches. A worker without a known current session (closed, not probed) cannot be confirmed.
 */
export function securityCheckVerdict(record: SecurityCheck | null, plan: { fingerprint: string | null | undefined; workers: readonly string[]; targetDate?: string | null;
  sessions?: Readonly<Partial<Record<string, string | null | undefined>>> }, now = Date.now()): SecurityCheckVerdict {
  if (!record) return { status: 'MISSING', detail: 'No pre-release security check has run for these browsers.', checkedAt: null, expiresAt: null, workers: [] };
  const checkedAt = record.checkedAt, age = now - Date.parse(checkedAt), expiresAt = new Date(Date.parse(checkedAt) + SECURITY_CHECK_MAX_AGE_MS).toISOString();
  const workers: SecurityCheckWorkerResult[] = plan.workers.map(id => { const value = record.workers[id as keyof SecurityCheck['workers']];
    return { id, outcome: value?.outcome ?? 'NOT_CHECKED', durationMs: value?.durationMs ?? null, challengeFrame: value?.challengeFrame ?? null, code: value?.code ?? null }; });
  const base = { checkedAt, expiresAt, workers };
  if (!plan.fingerprint || record.fingerprint !== plan.fingerprint) return { status: 'OTHER_PLAN', detail: 'The last security check was for a different saved plan.', ...base };
  if (plan.targetDate !== undefined && record.targetDate !== plan.targetDate)
    return { status: 'OTHER_PLAN', detail: `The last security check was for booking date ${record.targetDate}, not ${plan.targetDate ?? 'the current target'}.`, ...base };
  if (!(age >= -60_000) || age > SECURITY_CHECK_MAX_AGE_MS) return { status: 'STALE', detail: `The last security check is older than ${SECURITY_CHECK_MAX_AGE_MS / 60_000} minutes.`, ...base };
  if (plan.sessions) {
    const changed = plan.workers.filter(id => { const recorded = record.workers[id as keyof SecurityCheck['workers']]?.browserSession, current = plan.sessions![id];
      return !recorded || !current || recorded !== current; });
    if (changed.length) return { status: 'OTHER_BROWSER', detail: `Browser ${changed.join(', ')} ${changed.length === 1 ? 'was' : 'were'} closed, restarted or not confirmed since the check. Run the security check again in the current browsers.`, ...base };
  }
  const results = plan.workers.map(id => [id, record.workers[id as keyof SecurityCheck['workers']]] as const);
  const detail = results.map(([id, value]) => describeWorker(id, value)).join(' · ');
  return { status: results.length && results.every(([, value]) => value?.outcome === 'READY') ? 'PASSED' : 'FAILED', detail, ...base };
}
