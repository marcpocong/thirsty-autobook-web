import { describe, expect, it } from 'vitest';
import { fitNormalAttemptLimits } from '../src/normal-strategy.js';
import { compileSmartPlan, confirmSmartRates, emptySmartDraft } from '../src/precision-simple.js';
import { quickShotgunSettings } from '../src/quick-shotgun.js';

const targetDate = '2026-10-09';
const context = { targetDate };
const draft = () => ({ ...emptySmartDraft(),
  immediate: [7, 6, 5, 4].map((court, i) => ({ court, start: `${19 + i}:00`, durationHours: 2 })),
  backups: [{ court: 3, start: '19:00', durationHours: 3 }],
  rates: confirmSmartRates(600, 700, 'VENUE_SCHEDULE', targetDate, new Date()),
});

describe('Normal stale attempt-limit repair', () => {
  it('previews a compiler-valid minimal reset without mutating targets or other choices', () => {
    const value = draft(); value.advanced = { total: 1, wave2: 0, rescue: 0, standby: ['E'] };
    const before = structuredClone(value), fit = fitNormalAttemptLimits(value, context);
    expect(fit.normalized).toEqual(['total']);
    expect(fit.compiled.problems).toEqual([]); expect(fit.compiled.budgets.total).toBe(4);
    expect(fit.draft.advanced).toEqual({ wave2: 0, rescue: 0, standby: ['E'] });
    expect(fit.draft.immediate).toEqual(before.immediate); expect(fit.draft.backups).toEqual(before.backups);
    expect(fit.draft.rates).toEqual(before.rates); expect(fit.draft.retryReopened).toBe(before.retryReopened);
    expect(value).toEqual(before);
    expect(compileSmartPlan(fit.draft, context).phase3).toEqual(fit.compiled.phase3);
  });
  it('resets only an incompatible Wave 2 limit while preserving a valid total ceiling', () => {
    const value = draft(); value.advanced = { wave2: 7, total: 4 };
    const fit = fitNormalAttemptLimits(value, context);
    expect(fit.normalized).toEqual(['wave2']); expect(fit.draft.advanced.total).toBe(4);
    expect(fit.compiled.phase3).toBeDefined(); expect(fit.compiled.problems).toEqual([]);
  });
  it('keeps all compatible explicit limits', () => {
    const value = draft(); value.advanced = { total: 4, wave2: 0, rescue: 0 };
    const fit = fitNormalAttemptLimits(value, context);
    expect(fit.normalized).toEqual([]); expect(fit.draft).toBe(value);
  });
  it('never repairs past target, rate, worker or Shotgun safety blockers', () => {
    for (const kind of ['target', 'rate', 'worker', 'shotgun']) {
      const value = draft(); value.advanced = { total: 1 };
      if (kind === 'target') value.immediate[0]!.court = 99;
      if (kind === 'rate') value.immediate[0]!.start = '09:00', value.rates.day = null;
      if (kind === 'worker') value.advanced.standby = ['A', 'A'];
      if (kind === 'shotgun') value.shotgun = quickShotgunSettings(value, 20)!;
      const fit = fitNormalAttemptLimits(value, context);
      expect(fit.normalized).toEqual([]); expect(fit.draft).toBe(value);
      expect(fit.compiled.problems.length).toBeGreaterThan(0);
    }
  });
});
