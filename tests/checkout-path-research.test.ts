import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareCheckoutPaths, connectionWarmth, pathSamplesFromTrace } from '../src/checkout-path-research.js';
import type { AttemptRecord, ReleaseRecord } from '../src/release-intelligence.js';

const proofless = [{ runId: 'r1', mode: 'live-now' }, { stage: 'PRIMARY_PROOFLESS_DISPATCHING', elapsedMs: 1000 },
  { stage: 'CHECKOUT_HTTP_POST_INITIATED', workerId: 'A', elapsedMs: 1004 }, { stage: 'CHECKOUT_RESPONSE_COMPLETED', workerId: 'A', elapsedMs: 2210, networkDurationMs: 1200, statusCode: 200 }];
const proofBased = [{ runId: 'r2', mode: 'live-now' }, { stage: 'FETCHING_AVAILABILITY', elapsedMs: 100 }, { stage: 'CANDIDATE_READY', elapsedMs: 400 },
  { stage: 'FRESH_VERIFICATION_AND_PROOFS', elapsedMs: 420 }, { stage: 'SECURITY_CONTEXT_READY', elapsedMs: 4900 }, { stage: 'SLOT_PROOFS_READY', elapsedMs: 5200 },
  { stage: 'CHECKOUT_RESPONSE_RECEIVED', elapsedMs: 6000, statusCode: 200 }];
const attempt = (patch: Partial<AttemptRecord>): AttemptRecord => ({ wave: 'IMMEDIATE', workerId: 'A', court: 7, startTime: '19:00', endTime: '22:00', postOffsetMs: 4, responseOffsetMs: 900,
  networkDurationMs: 900, statusCode: 409, result: 'REJECTED', expectedAmount: 2100, rateStatus: null, protocol: 'h2', reused: true, ...patch });
const record = (key: string, attempts: AttemptRecord[], origin: ReleaseRecord['origin'] = 'REAL_RELEASE') => ({ key, origin, attempts,
  coarseSamples: [{ responseOffsetMs: 6000, durationMs: 6000, published: true, open: 90, total: 112 }] }) as unknown as ReleaseRecord;

describe('Proofless vs proof-based research harness', () => {
  it('measures each complete path from recorded traces, reporting in-path security separately', () => {
    expect(pathSamplesFromTrace(proofless, 'r1')).toEqual([{ runId: 'r1', mode: 'live-now', method: 'proofless', opportunityToPostMs: 4, proofMs: null, securityMs: null,
      postToOutcomeMs: 1200, completeMs: 1204, completeWithoutSecurityMs: 1204, statusCode: 200 }]);
    expect(pathSamplesFromTrace(proofBased, 'r2')).toEqual([{ runId: 'r2', mode: 'live-now', method: 'proof-based', opportunityToPostMs: null, proofMs: 4800, securityMs: 4480,
      postToOutcomeMs: 800, completeMs: 5600, completeWithoutSecurityMs: 1120, statusCode: 200 }]);
  });

  it('compares both paths with release-time inputs and never changes the live strategy', () => {
    const samples = [...pathSamplesFromTrace(proofless, 'r1'), ...pathSamplesFromTrace(proofBased, 'r2')];
    const result = compareCheckoutPaths(samples, [record('a', [attempt({ networkDurationMs: 22_988 })], 'HISTORICAL_PRE_PHASE3'), record('s', [attempt({ networkDurationMs: 1 })], 'SYNTHETIC')]);
    expect(result.strategyChanged).toBe(false);
    expect(result.offPeak.proofless).toMatchObject({ n: 1, p50: 1204 }); expect(result.offPeak.proofBased).toMatchObject({ n: 1, p50: 5600 });
    expect(result.release.postToOutcomeMs).toMatchObject({ n: 1, p50: 22_988 }); // synthetic excluded
    expect(result.release.availabilityReadMs).toMatchObject({ n: 1, p50: 6000 });
    expect(result.findings.at(-1)).toContain('The live strategy is unchanged.');
    const source = readFileSync('src/checkout-path-research.ts', 'utf8');
    expect(source).not.toMatch(/fetch\(|config\.local|writeFile|saveBooking|BOOKING_METHOD/);
  });
});

describe('connection warmth', () => {
  it('needs real traced POSTs from at least two current-architecture releases', () => {
    expect(connectionWarmth([record('h', [attempt({})], 'HISTORICAL_PRE_PHASE3')]).verdict).toBe('INSUFFICIENT EVIDENCE');
    expect(connectionWarmth([record('a', [attempt({}), attempt({ workerId: 'C' })])]).verdict).toBe('INSUFFICIENT EVIDENCE');
  });
  it('reports already warm when every traced POST reused a connection, and never recommends a warm-up by itself', () => {
    const warm = connectionWarmth([record('a', [attempt({}), attempt({ workerId: 'C' })]), record('b', [attempt({ workerId: 'D' })])]);
    expect(warm).toMatchObject({ verdict: 'ALREADY WARM — NO EXTRA WARM-UP', traced: 3, reused: 3, fresh: 0, releases: 2 });
    const cold = connectionWarmth([record('a', [attempt({ reused: false }), attempt({ workerId: 'C' })]), record('b', [attempt({ workerId: 'D' })])]);
    expect(cold.verdict).toBe('INSUFFICIENT EVIDENCE'); expect(cold.reasons[0]).toContain('repeatable read-only measurement');
  });
});
