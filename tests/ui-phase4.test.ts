import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { bookingView, defaultSetup } from '../ui/booking.js';
import { ConfigSchema } from '../src/config.js';
import { compileSmartPlan, confirmSmartRates, emptySmartDraft } from '../src/precision-simple.js';
import { openRenderer, showRendererView } from './renderer-harness.js';

/** Phase 4 in the operator UI: plain summaries by default, details on request, and the advisor edits only the draft. */
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) }); });
afterAll(async () => { await browser.close(); });
const players = { PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' };
function smartBooking() {
  const targetDate = bookingView(ConfigSchema.parse({ ...defaultSetup, ...players })).targetDate;
  const phase3 = compileSmartPlan({ ...emptySmartDraft(), immediate: [{ court: 7, start: '19:00', durationHours: 3 }], backups: [{ court: 6, start: '19:00', durationHours: 3 }],
    rates: confirmSmartRates(600, 700, 'VENUE_SCHEDULE', targetDate, new Date()) }, { targetDate }).phase3!;
  return bookingView(ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: 'proofless', DURATION_HOURS: 3, RELEASE_STRATEGY: 'precision', PRECISION_TARGETS: [], PRECISION_PHASE3: phase3, ...players }));
}
const intelligence = { generatedAt: '2026-09-24T12:00:00.000Z', realReleases: 2, adequateReleases: 0, skipped: 5, benchmarks: 12, releases: [
  { key: '2026-09-26@2026-09-24T00-00-00-000Z', targetDate: '2026-09-26', dayOfWeek: 'Saturday', releaseAt: '2026-09-24T00:00:00.000Z', origin: 'HISTORICAL_PRE_PHASE3', quality: 'POOR',
    firstPublishedResponseOffsetMs: 15_744, attempts: { immediate: 4, backup: 0, reopened: 0 }, outcome: 'OBJECTIVE_NOT_ACHIEVED_ALL_REJECTED', reopened: 15,
    notes: ['Historical, before the current release architecture (Precision v1 run).'], reasons: ['The first published read answered at +15.7 s, later than +10 s: it is not release-instant evidence.'] },
  { key: '2026-09-25@2026-09-23T00-00-00-000Z', targetDate: '2026-09-25', dayOfWeek: 'Friday', releaseAt: '2026-09-23T00:00:00.000Z', origin: 'HISTORICAL_PRE_PHASE3', quality: 'POOR',
    firstPublishedResponseOffsetMs: 6017, attempts: { immediate: 2, backup: 0, reopened: 0 }, outcome: 'SPECIAL_SESSION_NOT_AVAILABLE', reopened: 0, notes: [], reasons: [] }] };
const network = { version: 1, measuredAt: '2026-09-24T12:00:00.000Z', target: 'Onda public availability (read-only GET)', requests: 5, succeeded: 5, failed: 0, complete: 5,
  medianMs: 180, p90Ms: null, p95Ms: null, maxMs: 260, protocol: 'HTTP/1.1 (Node fetch; the browser checkout may differ)', newConnections: 1, reusedRequests: 4, connectMs: [85], dnsMs: 12,
  samples: [], clock: { samples: 10, kept: 7, offsetMs: 12, minRoundTripMs: 31, medianRoundTripMs: 40, spreadMs: 3, quality: 'GOOD' }, interfaces: [{ name: 'Wi-Fi', kind: 'Wi-Fi' }],
  verdict: 'READY', reasons: ['5 of 5 reads succeeded and were complete; median 180 ms; network clock GOOD from 7 samples.'], history: { previousRuns: 0, previousMedianMs: null } };
const visible = (page: Page, selector: string) => page.locator(selector).innerText();

describe('Phase 4 operator UI', () => {
  it('Runs shows a plain Release insights summary with technical detail collapsed', async () => {
    const page = await openRenderer(browser, { booking: smartBooking(), intelligence, phase4: { busy: null, message: '', networkReadiness: null } }, 'runs');
    const text = await visible(page, '#release-insights');
    expect(text).toContain('answered +15.7 s after 8:00 · quality Poor');
    expect(text).toContain('4 immediate · 0 backup · 0 reopened-slot');
    expect(text).toContain('All sent attempts were rejected');
    expect(text).toContain('15 court-hours were seen reopening later (cause unknown)');
    expect(text).toContain('Earlier releases answered their first useful grid at a median +6.0 s (1 release).');
    expect(text).not.toContain('not release-instant evidence'); // details stay collapsed
    await page.locator('#release-insights summary').click();
    expect(await visible(page, '#release-insights')).toContain('not release-instant evidence');
    await page.close();
  });

  it('Tools keeps the network verdict; History & Insights holds rebuild/clear, history and replay', async () => {
    const page = await openRenderer(browser, { booking: smartBooking(), intelligence, phase4: { busy: null, message: '', networkReadiness: network,
      warmth: { verdict: 'INSUFFICIENT EVIDENCE', traced: 0, reused: 0, fresh: 0, releases: 0, reasons: ['No traced checkout POST yet.'] } } }, 'tools');
    expect(await visible(page, '#network-result .tool-verdict')).toBe('Ready');
    expect(await visible(page, '#network-result')).not.toContain('Connections:');
    await page.locator('#run-network-check').click();
    // Analysis moved out of Tools (UI reorganization): intelligence and replay live under History & Insights.
    await showRendererView(page, 'history');
    await page.locator('#rebuild-intelligence').click(); await page.locator('#clear-intelligence').click();
    await page.locator('#intelligence-history > summary').click();
    expect(await visible(page, '#intelligence-list')).toContain('Connection warmth: INSUFFICIENT EVIDENCE.');
    await page.evaluate(() => { (window as any).fixtureReplay = { plan: 'saved', skipped: [{ releaseKey: '2026-09-25@x', reason: 'Only availability counts were recorded; no court/hour grid to replay.' }], results: [{
      releaseKey: 'k', targetDate: '2026-09-26', releaseAt: '2026-09-24T00:00:00.000Z', origin: 'HISTORICAL_PRE_PHASE3', quality: 'POOR', statement: 'No backup or reopened-slot opportunity was observed in this release.',
      assumptions: ['Every immediate attempt is treated as sent at 08:00.'], censored: ['The first published grid answered at +15.7 s.'], fitness: { FORENSIC_ONLY_INCOMPLETE: 102 },
      immediate: [{ workerId: 'A', court: 7, startTime: '19:00', endTime: '22:00', firstPublished: 'PARTIALLY_UNAVAILABLE', firstPublishedRead: { seq: 12, requestOffsetMs: 11293, responseOffsetMs: 15744 },
        firstFullyOpen: null, firstUnavailable: null, reopen: null }], backup: null, rescue: [], conflicts: [], forensicOpenings: [] }] }; });
    await page.locator('#replay-saved').click();
    await page.waitForFunction(() => document.querySelector('#replay-results .replay-statement'));
    expect(await visible(page, '#replay-results')).toContain('No backup or reopened-slot opportunity was observed in this release.');
    expect(await visible(page, '#replay-results')).toContain('Not replayed (2026-09-25 target)');
    expect(await page.evaluate(() => (window as any).fixtureReplayInput)).toEqual({ source: 'saved' });
    expect(await page.evaluate(() => (window as any).fixtureCalls)).toEqual(['runNetworkCheck', 'rebuildIntelligence', 'clearIntelligence', 'replayPlan']);
    expect(await visible(page, '#view-history')).not.toMatch(/\{"|would have won/);
    await page.close();
  });

  it('Suggest from history adds to the draft only: nothing is saved, prepared or armed', async () => {
    const page = await openRenderer(browser, { booking: smartBooking() }, 'plan');
    await page.evaluate(() => { (window as any).fixtureAdvice = { dayOfWeek: 'Saturday', wellObservedReleases: 5, releasesConsidered: 5, insufficient: false,
      rule: 'Order: fully open in the first well-observed snapshot, then still open at +1 s.', notes: ['Suggestions change only the draft. Review, then save the plan yourself.'],
      candidatesConsidered: 8, suggestions: [{ role: 'BACKUP', court: 3, start: '18:00', durationHours: 3, title: 'Court 3 · 6:00 PM–9:00 PM', sharedWithPicks: [],
        evidence: {}, lines: ['Fully open in first usable snapshot: 4 of 5 well-observed Saturdays', 'Still observed open at +1 s: 3 of 5', 'Evidence quality: 3 good, 2 fair'] }] }; });
    await page.locator('#smart-suggest').click();
    await page.locator('#advisor-courts').fill('3,4'); await page.locator('#advisor-exclude').fill('4@19:00');
    await page.locator('#advisor-run').click();
    await page.waitForFunction(() => document.querySelector('.advisor-card'));
    expect(await page.evaluate(() => (window as any).fixtureAdviceInput)).toMatchObject({ courts: [3, 4], earliestStart: '17:00', latestStart: '20:00', durationHours: 3,
      exclude: [{ court: 4, start: '19:00' }], existing: [{ court: 7, start: '19:00', durationHours: 3 }, { court: 6, start: '19:00', durationHours: 3 }] });
    const card = await visible(page, '.advisor-card');
    expect(card).toContain('Fully open in first usable snapshot: 4 of 5 well-observed Saturdays');
    expect(card).toContain('Evidence quality: 3 good, 2 fair');
    await page.getByRole('button', { name: /Add Court 3 · 6:00 PM–9:00 PM to the draft as a backup choice/ }).click();
    expect(await page.locator('#smart-backups .smart-row').count()).toBe(2);
    expect(await page.locator('#smart-backups-court-1').inputValue()).toBe('3');
    expect(await page.locator('#edit-status').innerText()).toContain('SETTINGS CHANGED');
    const calls = await page.evaluate(() => (window as any).fixtureCalls as string[]);
    expect(calls).toEqual(['adviseFromHistory']);
    await page.close();
  });

  it('replays the unsaved draft on request without saving it', async () => {
    const page = await openRenderer(browser, { booking: smartBooking() }, 'plan');
    await page.evaluate(() => { (window as any).fixtureReplay = { plan: 'draft', skipped: [], results: [] }; });
    await page.locator('#smart-replay').click();
    await page.waitForFunction(() => (window as any).fixtureCalls.includes('replayPlan'));
    const input = await page.evaluate(() => (window as any).fixtureReplayInput);
    expect(input.source).toBe('draft'); expect(input.phase3.wave1).toEqual([{ workerId: 'A', candidateIndex: 0 }]);
    expect(await page.evaluate(() => (window as any).fixtureCalls)).toEqual(['replayPlan']);
    await page.close();
  });
});
