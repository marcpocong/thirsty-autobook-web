import { describe, expect, it } from 'vitest';
import { releasePreflight, type PreflightInput } from '../src/release-preflight.js';
import { primaryActionFacts, readinessLayers, type ReadinessLayer } from '../src/execution-state.js';
import { savedPlanDate } from '../src/release-plan-date.js';
import type { ShotgunTimingVerdict } from '../src/shotgun-timing.js';

const now = Date.parse('2026-10-20T06:30:00Z');
const timing = (patch: Partial<ShotgunTimingVerdict> = {}): ShotgunTimingVerdict => ({ status: 'READY', reason: 'Every calibrated attempt started within 50 ms of its trigger.', testedAt: new Date(now - 3_600_000).toISOString(),
  expiresAt: new Date(now + 23 * 3_600_000).toISOString(), p95: 4.13, max: 4.37, shotCount: 2, runs: 10, matchesPlan: true, mismatches: [], ...patch });
const good = (id: string, label: string, hardBlock = false) => ({ id, label, level: 'GOOD' as const, hardBlock, detail: `${label} fine` });
function input(patch: Partial<PreflightInput> = {}): PreflightInput {
  const layers: ReadinessLayer[] = readinessLayers({ plan: { problems: 0, runtime: 'VALID', saved: true }, environment: { prepared: true, forOtherPlan: false, required: 2, connected: 2, identityIssues: 0 },
    forecast: { verdict: 'READY', ready: 2, configured: 2, atRisk: 0, omitted: 0, measured: true, samples: 84 }, security: null,
    securityCheck: { status: 'PASSED', detail: 'A verified in 3.3 s · B verified in 3.1 s' }, armed: { armed: false, running: false } });
  return { now, shotgun: true, savedPlan: { exists: true, fingerprint: 'f'.repeat(64), summary: 'Court 7 · Court 6 · 7:00 PM–10:00 PM · 2 Shotgun attempts at 0 ms' },
    planDate: savedPlanDate({ PRECISION_PHASE3: { candidates: [{ rateEvidence: { date: '2026-10-23' } }] } }, '2026-10-23'), releaseMs: Date.parse('2026-10-21T00:00:00Z'), layers,
    checks: [good('config', 'Configuration', true), good('clock', 'Trusted clock'), good('machine', 'Machine'), good('build', 'Build integrity'), good('shotgun-topology', 'Exact Shotgun topology', true),
      good('wave1-preparation-capacity', 'Wave 1 preparation capacity', true), good('shotgun-timing', 'Local Shotgun timing test', true), good('security-check', 'Pre-release security check', true)],
    operation: 'idle', prepared: { forSaved: true, forOther: false }, armed: false, running: false,
    securityCheck: { status: 'PASSED', detail: 'A verified in 3.3 s · B verified in 3.1 s', checkedAt: new Date(now - 240_000).toISOString(), expiresAt: new Date(now + 3_360_000).toISOString(),
      workers: [{ id: 'A', outcome: 'READY', durationMs: 3301, challengeFrame: 'none' }, { id: 'B', outcome: 'READY', durationMs: 3118, challengeFrame: 'none' }] },
    forecast: { leadMs: 53_115, p95Ms: 30_492, measured: true, samples: 84 }, timing: timing(), lock: { present: false, unresolvedSubmission: false, canPrepareOver: false },
    unknownResults: 0, termsAuthorized: false, ...patch };
}
const row = (p: ReturnType<typeof releasePreflight>, id: string) => p.rows.find(r => r.id === id)!;

describe('release day preflight', () => {
  it('is READY FOR OPERATOR AUTHORIZATION only when every current check passes; owner authorization stays the operator\'s step', () => {
    const p = releasePreflight(input());
    expect(p.verdict).toBe('READY_FOR_AUTHORIZATION');
    expect(p.rows.filter(r => r.id !== 'authorization').every(r => r.status === 'VERIFIED')).toBe(true);
    expect(row(p, 'authorization')).toMatchObject({ status: 'NEEDS_ACTION' });
    expect(row(p, 'authorization').detail).toMatch(/Nothing is authorized automatically/);
    expect(p.summary).toMatch(/not proven/);
    expect(row(p, 'security').inspection).toBe('genuine'); expect(row(p, 'timing').inspection).toBe('local');
  });
  it('never reports READY without an applicable READY calibration, and offers the calibration as the recovery', () => {
    for (const [t, status, action] of [[null, 'NEEDS_ACTION', 'CALIBRATE_TIMING'], [timing({ status: 'NOT_TESTED' }), 'NEEDS_ACTION', 'CALIBRATE_TIMING'],
      [timing({ status: 'EXPIRED' }), 'EXPIRED', 'CALIBRATE_TIMING'], [timing({ status: 'INCOMPATIBLE', mismatches: ['installed build'] }), 'NEEDS_ACTION', 'CALIBRATE_TIMING'],
      [timing({ status: 'INCOMPATIBLE', mismatches: ['Chrome version (bot browsers not open)'] }), 'NEEDS_ACTION', 'PREPARE'],
      [timing({ status: 'FAILED' }), 'BLOCKED', 'REVIEW_CAPACITY'], [timing({ status: 'AT_RISK' }), 'BLOCKED', 'REVIEW_CAPACITY']] as const) {
      const p = releasePreflight(input({ timing: t as ShotgunTimingVerdict | null }));
      expect(row(p, 'timing')).toMatchObject({ status, recovery: { action } });
      expect(p.verdict).not.toBe('READY_FOR_AUTHORIZATION');
    }
    expect(row(releasePreflight(input({ operation: 'calibrating' })), 'timing').status).toBe('RUNNING');
    expect(releasePreflight(input({ shotgun: false, timing: null })).rows.some(r => r.id === 'timing')).toBe(false);
  });
  it('blocks a plan saved for a passed release and points to the plan date, never re-dating it', () => {
    const p = releasePreflight(input({ planDate: savedPlanDate({ PRECISION_PHASE3: { candidates: [{ rateEvidence: { date: '2026-10-22' } }] } }, '2026-10-23') }));
    expect(p.verdict).toBe('BLOCKED');
    expect(row(p, 'date')).toMatchObject({ status: 'BLOCKED', recovery: { action: 'REVIEW_PLAN_DATE' } });
    expect(row(p, 'date').detail).toContain('2026-10-22');
    expect(p.summary).toContain('Target date');
  });
  it('treats a changed browser, another date, an expired or failed check distinctly', () => {
    const sc = input().securityCheck!;
    expect(row(releasePreflight(input({ securityCheck: { ...sc, status: 'OTHER_BROWSER', detail: 'Browser B was closed, restarted or not confirmed since the check.' } })), 'security'))
      .toMatchObject({ status: 'NEEDS_ACTION', recovery: { action: 'CHECK_SECURITY' } });
    expect(row(releasePreflight(input({ securityCheck: { ...sc, status: 'STALE' } })), 'security').status).toBe('EXPIRED');
    expect(row(releasePreflight(input({ securityCheck: { ...sc, status: 'FAILED' } })), 'security').status).toBe('BLOCKED');
    // A check that is not required (non-Shotgun) informs and never blocks.
    expect(row(releasePreflight(input({ shotgun: false, securityCheck: { ...sc, status: 'FAILED' } })), 'security').status).toBe('NEEDS_ACTION');
    expect(row(releasePreflight(input({ prepared: { forSaved: false, forOther: false } })), 'security')).toMatchObject({ status: 'NEEDS_ACTION', recovery: { action: 'PREPARE' } });
    expect(row(releasePreflight(input({ operation: 'checkingSecurity' })), 'security').status).toBe('RUNNING');
  });
  it('flags a slow or challenged check against the lead the release reserves, without changing any timing', () => {
    const sc = input().securityCheck!;
    const slow = releasePreflight(input({ securityCheck: { ...sc, workers: [{ id: 'A', outcome: 'READY', durationMs: 41_200, challengeFrame: 'visible' }, { id: 'B', outcome: 'READY', durationMs: 3_100, challengeFrame: 'none' }] } }));
    expect(row(slow, 'security').status).toBe('VERIFIED');
    expect(row(slow, 'security').caution).toMatch(/A took 41\.2 s — slower than the 30\.5 s/);
    expect(row(slow, 'security').caution).toMatch(/verification frame in browser A/);
    expect(row(slow, 'forecast').caution).toMatch(/fails within 46\.1 s can be retried once; a longer stall fails closed/);
  });
  it('before preparation follows the capacity forecast, not the live check that counts closed browsers as omissions', () => {
    const omitted = { id: 'wave1-preparation-capacity', label: 'Wave 1 preparation capacity', level: 'UNAVAILABLE' as const, hardBlock: true, detail: 'NOT FEASIBLE · 2 configured · 0 projected ready' };
    const checks = [...input().checks.filter(c => c.id !== 'wave1-preparation-capacity'), omitted];
    expect(row(releasePreflight(input({ checks, prepared: { forSaved: false, forOther: false } })), 'forecast').status).toBe('VERIFIED');
    expect(row(releasePreflight(input({ checks })), 'forecast').status).toBe('BLOCKED');
  });
  it('keeps UNKNOWN results and retained locks review-first, and never drops an unmapped controller hard block', () => {
    expect(row(releasePreflight(input({ unknownResults: 1 })), 'locks')).toMatchObject({ status: 'BLOCKED', recovery: { action: 'OPEN_ACTIVITY' } });
    expect(row(releasePreflight(input({ lock: { present: true, unresolvedSubmission: true, canPrepareOver: false } })), 'locks')).toMatchObject({ status: 'BLOCKED', recovery: { action: 'REVIEW_SUBMISSION' } });
    expect(row(releasePreflight(input({ lock: { present: true, unresolvedSubmission: false, canPrepareOver: true } })), 'locks').status).toBe('NEEDS_ACTION');
    const extra = releasePreflight(input({ checks: [...input().checks, { id: 'future-check', label: 'Future check', level: 'UNAVAILABLE', hardBlock: true, detail: 'not satisfied' }] }));
    expect(extra.verdict).toBe('BLOCKED'); expect(row(extra, 'other').detail).toContain('Future check: not satisfied');
  });
  it('reports the armed state with live security evidence instead of pre-arming checks', () => {
    const layers = readinessLayers({ plan: { problems: 0, runtime: 'VALID', saved: true }, environment: { prepared: true, forOtherPlan: false, required: 2, connected: 2, identityIssues: 0 },
      forecast: null, security: { planned: 2, ready: 1, preparing: 1, failed: 0, omitted: 0, leadMs: 53_115 }, armed: { armed: true, running: false } });
    const p = releasePreflight(input({ armed: true, layers }));
    expect(p.verdict).toBe('ARMED'); expect(row(p, 'security')).toMatchObject({ label: 'Live security', status: 'NEEDS_ACTION' });
    expect(row(p, 'authorization').detail).toContain('AUTHORIZED FOR THIS RUN');
  });
});

describe('primary action facts come from the typed action, never the button text', () => {
  it('states whether the action changes the saved plan or can lead to live dispatch', () => {
    expect(primaryActionFacts('SAVE_PLAN')).toMatchObject({ changesSavedPlan: true, liveDispatch: 'NO' });
    expect(primaryActionFacts('PREPARE', { shotgun: true })).toMatchObject({ changesSavedPlan: false, liveDispatch: 'NO', does: expect.stringContaining('genuine security check') });
    expect(primaryActionFacts('AUTHORIZE_ARM', { shotgun: true })).toMatchObject({ changesSavedPlan: false, liveDispatch: 'AFTER_CONFIRMATION', does: expect.stringContaining('attest') });
    expect(primaryActionFacts('STOP').doesNot).toMatch(/holds already created stay/);
  });
});


it('V3 exposes full-lead security overruns, scheduled preparation time and possible-hold reconciliation',()=>{
  const i=input(),p=releasePreflight({...i,forecast:{...i.forecast!,firstOffsetMs:-1000},securityCheck:{...i.securityCheck!,workers:[{id:'A',outcome:'FAILED',durationMs:60000,challengeFrame:'none'}]},possibleHolds:1});
  expect(row(p,'security').caution).toContain('exceeded the entire current release preparation lead');
  expect(row(p,'forecast').detail).toContain('preparation scheduled');expect(row(p,'locks').status).toBe('BLOCKED');expect(row(p,'locks').detail).toContain('not verified bookings');
});
