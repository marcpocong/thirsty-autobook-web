import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { openRenderer, showRendererView } from './renderer-harness.js';
import { defaultObjective } from '../src/booking-objective.js';
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) }); await mkdir('.local/ui-overhaul/shots', { recursive: true }); });
afterAll(async () => { await browser.close(); });
it('separates fresh provider confirmation, QR readiness, local results and elapsed deadlines', async () => {
  const page = await openRenderer(browser, {}, 'home', { width: 1280, height: 900 });
  try {
    await page.evaluate(() => { const w = window as any; w.fixturePendingHolds = [{ id: 'a'.repeat(64), worker: 'B', wing: 'MANGO', courts: [6], date: '2026-11-04', start: '08:00', end: '10:00', amount: 1200,
      advertisedExpiry: new Date(Date.now() + 60000).toISOString(), local: 'LOCAL_RESPONSE_VALID', provider: 'PROVIDER_HOLD_CONFIRMED', qr: 'QR_READY', outstanding: true, freshConfirmationRequired: false, lastCheckedAt: new Date().toISOString(), diagnostic: 'PROVIDER_HOLD_CONFIRMED', contradiction: false }]; });
    await showRendererView(page, 'live');
    await expect.poll(() => page.locator('#monitor-title').innerText()).toBe('QR READY');
    await page.evaluate(()=>{const w=window as any;w.fixturePublish(w.fixtureState);});
    expect(await page.locator('#live-run-state').innerText()).toBe('QR READY');
    expect(await page.locator('#monitor-countdown').innerText()).toContain('Hold expires in');
    expect(await page.locator('#monitor-holds').innerText()).toContain('Payment remains manual');
    expect(await page.locator('#monitor-holds').innerText()).toContain('Browser B');
    await page.screenshot({ path: '.local/ui-overhaul/shots/1280-qr-ready.png', fullPage: true });
    const action = page.locator('#monitor-holds').getByRole('button', { name: 'Recover Existing Checkout' });
    await action.focus();
    await page.evaluate(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
    expect(await action.evaluate(e => e === document.activeElement)).toBe(true);
    await action.click();
    expect(await page.evaluate(() => (window as any).fixturePendingRecoveryRequest)).toEqual({ action: 'recover', id: 'a'.repeat(64), mode: 'fresh' });
    await expect.poll(()=>page.locator('#monitor-holds [role="status"]').innerText()).toBe('PROVIDER_NOT_CHECKED');
    await page.evaluate(() => { const w = window as any; w.fixturePendingHolds[0].freshConfirmationRequired = true; w.fixturePendingHolds[0].provider = 'UNKNOWN'; });
    await showRendererView(page, 'records'); await showRendererView(page, 'live');
    await expect.poll(() => page.locator('#monitor-title').innerText()).not.toBe('QR READY');
    expect(await page.locator('#monitor-holds').innerText()).toContain('fresh confirmation required');
    await page.evaluate(() => { const w = window as any; w.fixturePendingHolds[0].advertisedExpiry = new Date(Date.now() - 1).toISOString(); });
    await showRendererView(page, 'records'); await showRendererView(page, 'live');
    await expect.poll(() => page.locator('#monitor-holds .monitor-hold').count()).toBe(0);
    expect(await page.evaluate(() => (window as any).fixtureCalls)).toEqual(['pendingHolds:recover']);
  } finally { await page.close(); }
});
it('shows an archived current-target overlap while keeping unrelated history compact', async () => {
  const o = defaultObjective(Date.now()); o.wings.MANGO.courts = [{ court: 7, priority: 1 }]; o.wings.MANGO.startTimes = ['19:00']; o.wings.MANGO.durationHours = 2;
  const hold = { key: 'fixture', date: o.wings.MANGO.bookingDate, courts: [7], startTime: '20:00', endTime: '21:00', holdExpiresAt: new Date(Date.now() - 60000).toISOString(), bookingIds: ['SECRET-ID'], bookingNumbers: ['SECRET-REF'], code: 'UNKNOWN', archived: true };
  const page = await openRenderer(browser, { objectiveDocument: { version: 1, objective: o, savedAt: new Date().toISOString(), binding: null }, possibleHolds: [hold] }, 'setup');
  try {
    await expect.poll(() => page.locator('#possible-hold-alert').innerText()).toContain('overlap this draft');
    expect(await page.locator('#possible-hold-alert').innerText()).toContain('Do not submit these targets again');
    expect(await page.locator('#possible-hold-alert').innerText()).not.toContain('SECRET-');
    await page.locator('#possible-hold-alert button').first().click();
    expect(await page.locator('#view-records').isVisible()).toBe(true);
    expect(await page.evaluate(() => (window as any).fixtureCalls)).toEqual([]);
  } finally { await page.close(); }
});
it('traps confirmation keyboard focus and returns it after cancelling', async () => {
  const page = await openRenderer(browser, {}, 'home');
  try {
    await page.locator('#home-start-setup').focus();
    await page.evaluate(() => (window as any).fixtureConfirmRequest({ id: 'fixture-confirm', tone: 'warning', title: 'Fixture confirmation', message: 'Review exact action', detail: '', confirmLabel: 'Confirm' }));
    await page.keyboard.press('Shift+Tab'); expect(await page.locator('#confirm-ok').evaluate(e => e === document.activeElement)).toBe(true);
    await page.keyboard.press('Tab'); expect(await page.locator('#confirm-cancel').evaluate(e => e === document.activeElement)).toBe(true);
    await page.keyboard.press('Escape'); expect(await page.locator('#confirm-modal').isHidden()).toBe(true);
    expect(await page.locator('#home-start-setup').evaluate(e => e === document.activeElement)).toBe(true);
    expect(await page.evaluate(() => (window as any).fixtureConfirmResponse)).toEqual({ id: 'fixture-confirm', confirmed: false });
  } finally { await page.close(); }
});
