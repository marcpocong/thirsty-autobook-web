import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SECURITY_CHECK_MAX_AGE_MS, readSecurityCheck, securityCheckVerdict, writeSecurityCheck, type SecurityCheck } from '../src/security-check.js';

const fingerprint = 'a'.repeat(64), now = Date.parse('2026-10-22T23:40:00Z');
const check = (overrides: Partial<SecurityCheck> = {}): SecurityCheck => ({ schema: 'security-check/v1', checkedAt: new Date(now - 5 * 60_000).toISOString(), targetDate: '2026-10-24', fingerprint,
  workers: { A: { outcome: 'READY', durationMs: 4200, challengeFrame: 'none' }, B: { outcome: 'READY', durationMs: 3800, challengeFrame: 'visible' } }, ...overrides });
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('pre-release security check verdict', () => {
  it('passes only for this exact plan, every required worker verified, within the hour', () => {
    const verdict = securityCheckVerdict(check(), { fingerprint, workers: ['A', 'B'] }, now);
    expect(verdict.status).toBe('PASSED');
    expect(verdict.detail).toBe('A verified in 4.2 s · B verified in 3.8 s (after a person completed the check)');
  });
  it('never treats a missing, foreign, stale, future-dated or incomplete record as evidence', () => {
    expect(securityCheckVerdict(null, { fingerprint, workers: ['A'] }, now).status).toBe('MISSING');
    expect(securityCheckVerdict(check(), { fingerprint: 'b'.repeat(64), workers: ['A'] }, now).status).toBe('OTHER_PLAN');
    expect(securityCheckVerdict(check(), { fingerprint: null, workers: ['A'] }, now).status).toBe('OTHER_PLAN');
    expect(securityCheckVerdict(check({ checkedAt: new Date(now - SECURITY_CHECK_MAX_AGE_MS - 1).toISOString() }), { fingerprint, workers: ['A'] }, now).status).toBe('STALE');
    expect(securityCheckVerdict(check({ checkedAt: new Date(now + 120_000).toISOString() }), { fingerprint, workers: ['A'] }, now).status).toBe('STALE');
    const partial = securityCheckVerdict(check(), { fingerprint, workers: ['A', 'B', 'C'] }, now);
    expect(partial).toMatchObject({ status: 'FAILED' });
    expect(partial.detail).toContain('C not checked');
    const failed = check({ workers: { A: { outcome: 'FAILED', durationMs: 60159, code: 'ONDA_SECURITY_VERIFICATION_FAILED', challengeFrame: 'hidden', failedHelper: 'challenge' } } });
    expect(securityCheckVerdict(failed, { fingerprint, workers: ['A'] }, now).detail).toBe('A failed (ONDA_SECURITY_VERIFICATION_FAILED) after 60.2 s · challenge frame hidden');
    expect(securityCheckVerdict(check(), { fingerprint, workers: [] }, now).status).toBe('FAILED');
  });
  it('stores only closed observations: any extra field, such as a token, is refused', () => {
    const root = mkdtempSync(join(tmpdir(), 'security-check-')); roots.push(root);
    expect(readSecurityCheck(root)).toBeNull();
    writeSecurityCheck(root, check());
    expect(readSecurityCheck(root)).toEqual(check());
    expect(() => writeSecurityCheck(root, { ...check(), workers: { A: { outcome: 'READY', durationMs: 1, turnstileToken: 'x' } } } as unknown as SecurityCheck)).toThrow();
    expect(readSecurityCheck(root)).toEqual(check());
  });
});
