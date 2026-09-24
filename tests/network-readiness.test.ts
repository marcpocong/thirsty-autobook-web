import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NETWORK_CHECK_MAX_REQUESTS, readNetworkReadinessHistory, runNetworkReadiness, saveNetworkReadiness, verdictOf } from '../src/network-readiness.js';
import { availabilityFixture } from './availability-fixture.js';
import type { ClockConsensus } from '../src/release-clock.js';

const date = '2026-10-03';
const roots: string[] = [];
afterEach(() => { for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true }); });
function fakeFetch(options: { fail?: number[]; delayMs?: number; cache?: string } = {}) {
  const calls: Array<{ url: string; method: string }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET' });
    if (options.delayMs) await new Promise(done => setTimeout(done, options.delayMs));
    if (options.fail?.includes(calls.length)) return new Response('busy', { status: 503 });
    return new Response(JSON.stringify(availabilityFixture(date)), { status: 200, headers: { 'content-type': 'application/json', 'x-vercel-cache': options.cache ?? 'MISS' } });
  }) as typeof fetch;
  return { fetcher, calls };
}
const consensus = (kept = 5, quality: ClockConsensus['quality'] = 'GOOD'): ClockConsensus => ({ method: 'ntp-consensus-v1', offsetMs: 12.4, sampleCount: 10, keptCount: kept, rejectedCount: 10 - kept,
  minRoundTripMs: 30, medianRoundTripMs: 40, maxRoundTripMs: 60, spreadMs: 3, uncertaintyMs: 15, quality, bestHost: 'time.google.com',
  samples: Array.from({ length: 10 }, (_, index) => ({ host: 'time.google.com', offsetMs: 12, roundTripMs: 30 + index, kept: index < kept })) });
const base = { spacingMs: 0, date, dns: async () => undefined, clockRound: async () => consensus(),
  interfaces: () => ({ 'Wi-Fi': [{ address: '192.168.1.23', netmask: '255.255.255.0', family: 'IPv4' as const, mac: 'aa:bb:cc:dd:ee:ff', internal: false, cidr: '192.168.1.23/24' }],
    'Loopback Pseudo-Interface 1': [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4' as const, mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }] }) };

describe('Network Readiness', () => {
  it('is bounded and uses only the public read-only availability GET', async () => {
    const { fetcher, calls } = fakeFetch();
    const result = await runNetworkReadiness({ ...base, fetcher, requests: 500 });
    expect(calls).toHaveLength(NETWORK_CHECK_MAX_REQUESTS);
    const defaulted = fakeFetch(); await runNetworkReadiness({ ...base, fetcher: defaulted.fetcher });
    expect(defaulted.calls).toHaveLength(5);
    for (const call of calls) { expect(call.method).toBe('GET'); expect(new URL(call.url).origin).toBe('https://app.onda.fit');
      expect(new URL(call.url).pathname).toMatch(/^\/api\/public\/facilities\/[0-9a-f-]+\/date-availability$/); }
    expect(result).toMatchObject({ requests: 10, succeeded: 10, failed: 0, complete: 10, verdict: 'READY' });
    expect(result.samples.every(sample => sample.cache === 'MISS')).toBe(true);
    expect(result.p90Ms).not.toBeNull(); expect(result.p95Ms).toBeNull();
  });

  it('never acquires checkout security or opens a browser', () => {
    const source = readFileSync('src/network-readiness.ts', 'utf8');
    expect(source).not.toMatch(/prepareCheckoutContext|browser-session-transport|playwright|turnstile|public-checkout|writeNetworkClockState|synchronizeNetworkClock/i);
  });

  it('gives Ready / Needs attention / Insufficient data with the reason', async () => {
    const failing = fakeFetch({ fail: [2] });
    const attention = await runNetworkReadiness({ ...base, fetcher: failing.fetcher });
    expect(attention.verdict).toBe('NEEDS_ATTENTION'); expect(attention.reasons[0]).toBe('1 of 5 availability reads failed.');
    const insufficient = await runNetworkReadiness({ ...base, fetcher: fakeFetch().fetcher, clockRound: async () => consensus(2, 'DEGRADED') });
    expect(insufficient.verdict).toBe('INSUFFICIENT_DATA'); expect(insufficient.reasons.join(' ')).toContain('network-clock samples');
    const degraded = await runNetworkReadiness({ ...base, fetcher: fakeFetch().fetcher, clockRound: async () => consensus(4, 'DEGRADED') });
    expect(degraded.verdict).toBe('NEEDS_ATTENTION');
    const slow = verdictOf({ ...attention, failed: 0, succeeded: 5, complete: 5, medianMs: 2400, maxMs: 2600 });
    expect(slow).toEqual({ verdict: 'NEEDS_ATTENTION', reasons: ['Median read time 2400 ms is above 1500 ms.'] });
  });

  it('persists a sanitized history without addresses, URLs or response bodies and compares with it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'readiness-')); roots.push(root);
    const first = await runNetworkReadiness({ ...base, fetcher: fakeFetch().fetcher, now: () => Date.parse('2026-09-24T10:00:00Z') });
    saveNetworkReadiness(root, first);
    const second = await runNetworkReadiness({ ...base, fetcher: fakeFetch().fetcher, now: () => Date.parse('2026-09-24T11:00:00Z'), history: readNetworkReadinessHistory(root) });
    saveNetworkReadiness(root, second);
    expect(second.history).toMatchObject({ previousRuns: 1 });
    const files = readdirSync(join(root, '.local', 'network-readiness'));
    expect(files).toHaveLength(2);
    const text = files.map(name => readFileSync(join(root, '.local', 'network-readiness', name), 'utf8')).join('\n');
    for (const forbidden of ['192.168.1.23', 'aa:bb:cc', 'https://', 'slotsBySpace', 'pricing', '127.0.0.1']) expect(text).not.toContain(forbidden);
    expect(second.interfaces).toEqual([{ name: 'Wi-Fi', kind: 'Wi-Fi' }]);
    expect(readNetworkReadinessHistory(root).map(value => value.measuredAt)).toEqual(['2026-09-24T11:00:00.000Z', '2026-09-24T10:00:00.000Z']);
  });
});
