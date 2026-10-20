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
  challengeFrame: z.enum(['none', 'hidden', 'visible']).optional(), failedHelper: z.enum(['challenge', 'fingerprint']).optional() }).strict();
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

export type SecurityCheckStatus = 'PASSED' | 'FAILED' | 'STALE' | 'OTHER_PLAN' | 'MISSING';
export interface SecurityCheckVerdict { status: SecurityCheckStatus; detail: string; checkedAt: string | null }
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const describeWorker = (id: string, value: SecurityCheckWorker | undefined) => !value ? `${id} not checked`
  : value.outcome === 'READY' ? `${id} verified in ${seconds(value.durationMs)}${value.challengeFrame === 'visible' ? ' (after a person completed the check)' : ''}`
    : `${id} failed${value.code ? ` (${value.code})` : ''} after ${seconds(value.durationMs)}${value.challengeFrame && value.challengeFrame !== 'none' ? ` · challenge frame ${value.challengeFrame}` : ''}`;

/** Whether the latest check stands for this exact plan and these workers now. Only PASSED is evidence. */
export function securityCheckVerdict(record: SecurityCheck | null, plan: { fingerprint: string | null | undefined; workers: readonly string[] }, now = Date.now()): SecurityCheckVerdict {
  if (!record) return { status: 'MISSING', detail: 'No pre-release security check has run for these browsers.', checkedAt: null };
  const checkedAt = record.checkedAt, age = now - Date.parse(checkedAt);
  if (!plan.fingerprint || record.fingerprint !== plan.fingerprint) return { status: 'OTHER_PLAN', detail: 'The last security check was for a different saved plan.', checkedAt };
  if (!(age >= -60_000) || age > SECURITY_CHECK_MAX_AGE_MS) return { status: 'STALE', detail: `The last security check is older than ${SECURITY_CHECK_MAX_AGE_MS / 60_000} minutes.`, checkedAt };
  const results = plan.workers.map(id => [id, record.workers[id as keyof SecurityCheck['workers']]] as const);
  const detail = results.map(([id, value]) => describeWorker(id, value)).join(' · ');
  return { status: results.length && results.every(([, value]) => value?.outcome === 'READY') ? 'PASSED' : 'FAILED', detail, checkedAt };
}
