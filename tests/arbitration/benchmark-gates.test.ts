import { describe, expect, it } from 'vitest';
import { evaluateLatency, evaluateSafety } from '../../src/arbitration/benchmark-gates.js';

const stats = (p50: number, p95: number, p99: number) => ({ n: 100, p50, p95, p99, max: p99, mean: p50 });
const configuration = (overrides: Record<string, unknown> = {}) => ({
  states: { REJECTED: 700 }, releaseToRequestEvent_allWorkers: stats(5, 8, 10), firstToLastSpread: stats(1, 2, 3),
  criticalPath: { planEvents: { renderer: 700 }, earlyTransmission: { fetchProvablyEarly: 0, fetchNotProvablyOnTime: 3, browserRequestStartBeforeRelease: 0, routeSeenBeforeRelease: 0 },
    releaseToFetchInvoked: stats(1, 1.5, 2), releaseToBrowserRequestStart: stats(3, 4, 5), browserRequestStartSpread: stats(1, 2, 2.5) },
  ...overrides,
});

describe('release benchmark gates', () => {
  it('passes a clean summary and fails any early transmission, unsettled attempt or silent renderer fallback', () => {
    expect(evaluateSafety({ configurations: { '7w': configuration() } }, { requireRenderer: true }).every(result => result.pass)).toBe(true);
    const early = configuration({ criticalPath: { ...configuration().criticalPath, earlyTransmission: { fetchProvablyEarly: 1, browserRequestStartBeforeRelease: 0, routeSeenBeforeRelease: 0 } } });
    expect(evaluateSafety({ configurations: { '7w': early } }).filter(result => !result.pass).map(result => result.gate)).toEqual(['no early transmission: fetchProvablyEarly']);
    expect(evaluateSafety({ configurations: { '7w': configuration({ states: { REJECTED: 699, UNKNOWN: 1 } }) } }).some(result => !result.pass)).toBe(true);
    const fallback = configuration({ criticalPath: { ...configuration().criticalPath, planEvents: { renderer: 699, 'node-fallback:RENDERER_CALIBRATION_TIMEOUT': 1 } } });
    expect(evaluateSafety({ configurations: { '7w': fallback } }, { requireRenderer: true }).some(result => !result.pass)).toBe(true);
    // "Not provably on time" is inside post-run calibration error, not a transmission before release: no gate.
    expect(evaluateSafety({ configurations: { '7w': configuration() } }).every(result => result.pass)).toBe(true);
    // A summary without critical-path rows cannot prove anything about early transmission.
    expect(evaluateSafety({ configurations: { '7w': configuration({ criticalPath: undefined }) } }).some(result => !result.pass)).toBe(true);
  });

  it('holds p50/p95/p99 to the same-machine baseline with a factor and slack', () => {
    const baseline = { configurations: { '7w': configuration() } };
    expect(evaluateLatency({ configurations: { '7w': configuration() } }, baseline).every(result => result.pass)).toBe(true);
    const slower = configuration({ releaseToRequestEvent_allWorkers: stats(5, 8, 13.6) });
    const failed = evaluateLatency({ configurations: { '7w': slower } }, baseline).filter(result => !result.pass);
    expect(failed.map(result => [result.gate, result.limit])).toEqual([['releaseToRequestEvent_allWorkers.p99 ≤ 1.25× baseline + 1 ms', 13.5]]);
    // Configurations missing from the baseline are not compared.
    expect(evaluateLatency({ configurations: { '1w': slower } }, baseline)).toEqual([]);
  });
});
