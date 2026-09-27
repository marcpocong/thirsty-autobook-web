import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { DateTime } from 'luxon';
import { bookingView, defaultSetup } from '../ui/booking.js';
import { ConfigSchema, ObservationSchema } from '../src/config.js';
import { clockStatus } from '../ui/status.js';
import { openRenderer } from './renderer-harness.js';

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) }); });
afterAll(async () => { await browser.close(); });
const players = { PLAYER_FULL_NAME: 'Fixture Player', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' };
const booking = (method: 'proofless' | 'browser') => bookingView(ConfigSchema.parse({ ...defaultSetup, BOOKING_METHOD: method, ...players }));
const clock = clockStatus(ObservationSchema.parse({}), DateTime.fromISO('2026-09-28T07:00:00+08:00'));
const row = (page: Page) => page.locator('#release-readiness .gate').filter({ hasText: 'Investigation manifest' });
const publish = (page: Page, manifest: unknown) => page.evaluate(value => {
  const w = window as any; w.fixtureState = { ...w.fixtureState, arbitrationManifest: value }; w.fixturePublish(w.fixtureState);
}, manifest);

describe('Release readiness: investigation manifest row', () => {
  it('shows automatic, ready, verified and blocked states for the release being armed', async () => {
    const page = await openRenderer(browser, { booking: booking('proofless'), clock }, 'release');
    expect(await row(page).getAttribute('class')).toBe('gate pending');
    expect((await row(page).textContent())?.trim()).toBe('○Investigation manifest · Automatic when you arm');

    await publish(page, { status: 'ready', targetDate: clock.targetDate, releaseMs: clock.releaseMs, verified: false });
    expect(await row(page).getAttribute('class')).toBe('gate good');
    expect(await row(page).textContent()).toContain('Investigation manifest · READY · preregistered before run');

    await publish(page, { status: 'ready', targetDate: clock.targetDate, releaseMs: clock.releaseMs, verified: true });
    expect(await row(page).textContent()).toContain('Investigation manifest · READY · existing preregistration verified');

    const reason = 'Investigation setup could not be saved. Nothing was armed. Check that the app can write to its local data folder, then try again.';
    await publish(page, { status: 'blocked', targetDate: clock.targetDate, releaseMs: clock.releaseMs, code: 'ARBITRATION_MANIFEST_STORAGE_FAILED', reason });
    expect(await row(page).getAttribute('class')).toBe('gate bad');
    expect(await row(page).textContent()).toContain('Investigation manifest · BLOCKED · could not preregister this release');
    expect(await row(page).locator('.gate-detail').textContent()).toBe(reason);
    expect(await row(page).textContent()).not.toContain('arbitration-manifests');

    // A result for another release never describes this one.
    await publish(page, { status: 'ready', targetDate: clock.targetDate, releaseMs: clock.releaseMs - 86_400_000, verified: false });
    expect(await row(page).getAttribute('class')).toBe('gate pending');
    await page.close();
  });

  it('adds no manifest row for browser-method releases, which have no Wave 1 runner', async () => {
    const page = await openRenderer(browser, { booking: booking('browser'), clock }, 'release');
    expect(await page.locator('#release-readiness .gate').count()).toBeGreaterThan(0);
    expect(await row(page).count()).toBe(0);
    await page.close();
  });
});
