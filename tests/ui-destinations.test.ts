import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { openRenderer, showRendererView } from './renderer-harness.js';
import { bookingView, defaultSetup } from '../ui/booking.js';
import { ConfigSchema } from '../src/config.js';

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) }); await mkdir('.local/ui-v3/shots', { recursive: true }); });
afterAll(async () => { await browser.close(); });
const booking = bookingView(ConfigSchema.parse({ ...defaultSetup, PLAYER_FULL_NAME: 'Fixture', PLAYER_PHONE: '09123456789', PLAYER_EMAIL: 'fixture@example.invalid' }));
const players = { primary: true, extended: true, third: true, fourth: true, fifth: true, sixth: true, seventh: true };

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) it(`renders all four destinations and every Booking Setup step without errors at ${viewport.width}px`, async () => {
  const page = await openRenderer(browser, { booking, playerStatus: players, browserHealth: { A: true } }, 'home', viewport), errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const overflow = async () => { const value = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (value > 1) console.log('OVERFLOW', await page.evaluate(() => [...document.querySelectorAll('[id^=setup-step-]')].find(e => !(e as HTMLElement).hidden)?.id), await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => (e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 || e.scrollWidth > document.documentElement.clientWidth + 1 && getComputedStyle(e).overflowX === 'visible') && ![...document.querySelectorAll('.availability-wing,.table-scroll,pre')].some(c => c !== e && c.contains(e)))
      .slice(0, 12).map(e => `${e.tagName.toLowerCase()}#${e.id}.${(e.className || '').toString().split(' ')[0]} right=${Math.round(e.getBoundingClientRect().right)} w=${Math.round(e.getBoundingClientRect().width)}`).join(' | ')));
    return value; };
  expect(await page.locator('nav [data-dest]').allTextContents()).toEqual(['Home', 'Booking Setup', 'Activity', 'Settings']);
  expect(await page.locator('#home-release-body').innerText()).toMatch(/Mango date[sS]*Sat, Oct 17|Mango date/i);
  await page.screenshot({ path: `.local/ui-v3/shots/${viewport.width}-home.png`, fullPage: true });
  await page.locator('#home-start-setup').click();
  expect(await page.locator('#dest-setup').isVisible()).toBe(true);
  for (const mode of ['NEXT_RELEASE', 'AVAILABLE_NOW']) {
    await page.locator(`input[name="setup-mode"][value="${mode}"]`).check();
    for (const step of [1, 2, 3, 4, 5]) {
      await page.locator(`#setup-steps [data-step="${step}"]`).click();
      expect(await page.locator(`#setup-step-${step}`).isVisible()).toBe(true);
      expect(await overflow()).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `.local/ui-v3/shots/${viewport.width}-${mode}-${step}.png`, fullPage: true });
    }
  }
  for (const view of ['strategy', 'live', 'history', 'records', 'tools', 'home']) { await showRendererView(page, view); expect(await overflow()).toBeLessThanOrEqual(1); await page.screenshot({ path: `.local/ui-v3/shots/${viewport.width}-${view}.png`, fullPage: true }); }
  expect(errors).toEqual([]);
  await page.close();
}, 120000);
