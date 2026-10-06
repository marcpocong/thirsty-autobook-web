import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CriticalPathRecorder } from '../../src/api-booking/critical-path.js';
import { assertCalibrationUsable, calibrateRendererClock, calibrateRendererClockAdaptive, earliestSafeRendererTime, rendererToNode, RendererClockError, sampleRendererClock,
  type RendererClockSample } from '../../src/api-booking/renderer-clock.js';
import { seededRandom } from '../../src/arbitration/stats.js';

/** Synthetic round trips against a known true offset (node = renderer + trueOffset). */
function samplesFor(trueOffset: number, count: number, random: () => number, start = 1_000): RendererClockSample[] {
  const samples: RendererClockSample[] = [];
  let node = start;
  for (let index = 0; index < count; index++) {
    const before = node, there = 0.05 + random() * 1.5, back = 0.05 + random() * 1.5;
    const renderer = before + there - trueOffset;
    samples.push({ nodeBefore: before, renderer, nodeAfter: before + there + back });
    node += there + back + random() * 5;
  }
  return samples;
}

describe('renderer clock calibration', () => {
  it('brackets the true offset and never maps a deadline early (1000 random clocks)', () => {
    const random = seededRandom(20260925);
    for (let run = 0; run < 1_000; run++) {
      const trueOffset = (random() - 0.5) * 1_000_000;
      const calibration = calibrateRendererClock(samplesFor(trueOffset, 8, random));
      expect(calibration.consistent).toBe(true);
      expect(calibration.offsetLowMs).toBeLessThanOrEqual(trueOffset);
      expect(calibration.offsetHighMs).toBeGreaterThanOrEqual(trueOffset);
      const nodeDeadline = 50_000 + random() * 1_000;
      const fireAt = earliestSafeRendererTime(calibration, nodeDeadline);
      // What Node's clock truly reads when the renderer reaches fireAt:
      expect(fireAt + trueOffset).toBeGreaterThanOrEqual(nodeDeadline);
      expect(fireAt + trueOffset - nodeDeadline).toBeLessThanOrEqual(2 * calibration.uncertaintyMs + 1e-9);
    }
  });

  it('detects inconsistent clocks, stale and loose calibrations and refuses them', () => {
    const random = seededRandom(1);
    const good = samplesFor(123.4, 6, random);
    const stepped = [...good, { ...good[0]!, renderer: good[0]!.renderer + 50 }];
    const inconsistent = calibrateRendererClock(stepped);
    expect(inconsistent.consistent).toBe(false);
    expect(() => assertCalibrationUsable(inconsistent, inconsistent.calibratedAtNodeMs, { maxAgeMs: 10_000, maxUncertaintyMs: 5 })).toThrow('RENDERER_CLOCK_INCONSISTENT');
    const calibration = calibrateRendererClock(good);
    expect(() => assertCalibrationUsable(calibration, calibration.calibratedAtNodeMs + 10_001, { maxAgeMs: 10_000, maxUncertaintyMs: 5 })).toThrow('RENDERER_CLOCK_STALE');
    expect(() => assertCalibrationUsable(calibration, calibration.calibratedAtNodeMs - 1, { maxAgeMs: 10_000, maxUncertaintyMs: 5 })).toThrow('RENDERER_CLOCK_STALE');
    expect(() => assertCalibrationUsable(calibration, calibration.calibratedAtNodeMs, { maxAgeMs: 10_000, maxUncertaintyMs: 0.01 })).toThrow('RENDERER_CLOCK_UNCERTAIN');
    expect(() => assertCalibrationUsable(undefined, 0, { maxAgeMs: 1, maxUncertaintyMs: 1 })).toThrow(RendererClockError);
    expect(() => calibrateRendererClock([])).toThrow('RENDERER_CLOCK_NO_SAMPLES');
    expect(() => calibrateRendererClock([{ nodeBefore: 5, renderer: 1, nodeAfter: 4 }])).toThrow('RENDERER_CLOCK_NO_SAMPLES');
  });
});

describe('critical path recorder', () => {
  it('maps node, renderer and browser-wall marks onto release-relative trusted time', () => {
    const releaseMono = 10_000, releaseMs = 1_790_294_400_000, offset = -5_000; // node = renderer - 5000
    const recorder = new CriticalPathRecorder(releaseMs, releaseMono, 23.3, ['A'], () => 0);
    recorder.mark('*', 'schedulerFired', 10_000.05);
    recorder.mark('A', 'workerInvoked', 10_000.2);
    recorder.observeTransport('A', { event: 'CHECKOUT_FUNCTION_ENTERED', preparedContextAgeMs: 1, securitySource: 'PREPARED_CONTEXT' }, 10_000.3);
    recorder.observeTransport('A', { event: 'CHECKOUT_PRE_POST', preparedContextAgeMs: 1, securitySource: 'PREPARED_CONTEXT' }, 10_000.4);
    recorder.observeTransport('A', { event: 'CHECKOUT_HTTP_POST_INITIATED', initiationEvidence: 'PLAYWRIGHT_REQUEST_EVENT' }, 10_009.8);
    recorder.observeTransport('A', { event: 'CHECKOUT_RESPONSE_COMPLETED', networkDurationMs: 30_000, statusCode: 409, dispatchState: 'RESPONSE_CAPTURED',
      renderer: { timeOrigin: 0, enteredAt: 15_006.9, fetchAt: 15_007.0, headersAt: 45_000, completedAt: 45_001 }, browserRequestWallMs: releaseMs - 23.3 + 8 }, 40_001);
    // A later Wave 2 POST on the same page never overwrites Wave 1 marks.
    recorder.observeTransport('A', { event: 'CHECKOUT_RESPONSE_COMPLETED', networkDurationMs: 1, statusCode: 409, dispatchState: 'RESPONSE_CAPTURED',
      renderer: { timeOrigin: 0, enteredAt: 99_999, fetchAt: 99_999, headersAt: 99_999, completedAt: 99_999 }, browserRequestWallMs: releaseMs + 9_999 }, 90_000);
    recorder.calibration('A', { version: 1, samples: 8, offsetLowMs: offset - 0.2, offsetHighMs: offset + 0.2, offsetMs: offset, uncertaintyMs: 0.2,
      minRoundTripMs: 0.4, calibratedAtNodeMs: 60_000, consistent: true });
    const [row] = recorder.rows();
    expect(row).toMatchObject({ workerId: 'A', dispatchMode: 'node', schedulerFiredMs: 0.05, workerInvokedMs: 0.2, transportEnteredMs: 0.3, prePostMs: 0.4,
      evaluateEnteredMs: { ms: 6.9, lowMs: 6.7, highMs: 7.1 }, fetchInvokedMs: { ms: 7, lowMs: 6.8, highMs: 7.2 }, browserRequestStartMs: 8, requestObservedMs: 9.8,
      responseObservedMs: 30_001, segments: { nodeToRendererMs: 6.5, rendererToFetchMs: 0.1, fetchToRequestStartMs: 1, requestEventLagMs: 1.8 } });
    expect(recorder.toNdjson().split('\n').filter(Boolean)).toHaveLength(2);
  });
});

describe('real renderer clock (test-owned Chromium, no network)', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser?.close(); });

  it('calibrates a page clock consistently and maps an in-page mark between its Node brackets', async () => {
    const page = await browser.newPage();
    await page.setContent('<p>clock</p>');
    const calibration = await calibrateRendererClockAdaptive(page, { targetUncertaintyMs: 1.5, maxSamples: 32 });
    expect(calibration.consistent).toBe(true);
    // Tightness depends on machine load (CDP round trips); the properties under test are consistency and bracketing.
    expect(calibration.uncertaintyMs).toBeLessThan(10);
    const before = performance.now();
    const mark = await page.evaluate(() => performance.now());
    const after = performance.now();
    const mapped = rendererToNode(calibration, mark);
    expect(mapped.highMs).toBeGreaterThanOrEqual(before);
    expect(mapped.lowMs).toBeLessThanOrEqual(after);
    await page.close();
  });
});

describe('adaptive renderer clock calibration', () => {
  it('keeps sampling until the interval is tight enough, and stops at once on an inconsistent clock', async () => {
    const random = seededRandom(5);
    let node = 1_000;
    const trueOffset = 250;
    // A page whose round trips are slow and noisy (busy CDP): each answer lands 0.5–8.5 ms into a 1–17 ms round trip,
    // so 8 round trips alone rarely bound the offset to ±0.9 ms (this seed needs more).
    const page = { evaluate: async () => { const there = 0.5 + random() * 8, back = 0.5 + random() * 8; node += there; const renderer = node - trueOffset; node += back; return renderer; } };
    const calibration = await calibrateRendererClockAdaptive(page, { targetUncertaintyMs: 0.9, maxSamples: 64 }, () => node);
    expect(calibration.consistent).toBe(true);
    expect(calibration.offsetLowMs).toBeLessThanOrEqual(trueOffset);
    expect(calibration.offsetHighMs).toBeGreaterThanOrEqual(trueOffset);
    expect(calibration.samples).toBeGreaterThan(8);
    expect(calibration.uncertaintyMs).toBeLessThanOrEqual(0.9);
    let calls = 0;
    const jumping = { evaluate: async () => { calls++; node += 1; return calls === 3 ? node + 500 : node - trueOffset; } };
    const broken = await calibrateRendererClockAdaptive(jumping, { targetUncertaintyMs: 0.01, maxSamples: 64 }, () => node);
    expect(broken.consistent).toBe(false);
    expect(calls).toBe(8);
  });
});

it('records independent scheduler wakes while preserving generic shared-wake compatibility',()=>{
  const recorder=new CriticalPathRecorder(1000,1000,0,['a','b'],()=>0);
  recorder.mark('*','schedulerFired',900);recorder.mark('a','schedulerFired',500);recorder.mark('b','schedulerFired',995);
  expect(recorder.rows().map(r=>r.schedulerFiredMs)).toEqual([-500,-5]);
});
