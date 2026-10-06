import type { Browser, Page } from 'playwright';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';

/**
 * Loads the real renderer (index.html, styles.css and app.ts with every module it imports) into Chrome with a
 * recording fake bridge. Files are served from a fake origin: a request for `x.js` is answered with `x.ts` from the
 * source tree, types stripped, so the renderer's ES module graph (ui/renderer/*.ts and the pure src/ modules it
 * imports) loads exactly as in the packaged app. `window.fixtureCalls` lists every bridge call; `window.fixtureSaved`
 * is the last saved setup. Phase 4 calls answer with `window.fixtureAdvice` / `window.fixtureReplay`.
 *
 * Legacy view names map onto the reorganized views: plan → Strategy (with Advanced overrides open), slots → Live,
 * runs → History & Insights; tests is reached from Tools.
 */
export const RENDERER_ORIGIN = 'http://renderer.test';
const LEGACY_VIEWS: Record<string, string> = { plan: 'strategy', slots: 'live', runs: 'history' };

async function serve(page: Page): Promise<void> {
  // Offline renderer fixtures fail closed for every real network destination.
  await page.route('**/*', route => route.abort('blockedbyclient'));
  await page.route(`${RENDERER_ORIGIN}/**`, async route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, '');
    const file = resolve(path);
    if (!file.startsWith(resolve('.'))) { await route.fulfill({ status: 403, body: '' }); return; }
    if (path.endsWith('.js')) {
      const source = file.replace(/\.js$/, '.ts');
      if (existsSync(source)) { await route.fulfill({ status: 200, contentType: 'text/javascript', body: stripTypeScriptTypes(await readFile(source, 'utf8')) }); return; }
      if (existsSync(file)) { await route.fulfill({ status: 200, contentType: 'text/javascript', body: await readFile(file, 'utf8') }); return; }
    }
    if (path.endsWith('.html') && existsSync(file)) { await route.fulfill({ status: 200, contentType: 'text/html', body: await readFile(file, 'utf8') }); return; }
    if (path.endsWith('.css') && existsSync(file)) { await route.fulfill({ status: 200, contentType: 'text/css', body: await readFile(file, 'utf8') }); return; }
    if (path.endsWith('.png')) { await route.fulfill({ status: 200, contentType: 'image/png', body: await readFile('assets/brand/thirsty-pickle-bot.png') }); return; }
    await route.fulfill({ status: 404, body: '' });
  });
}

export async function openRenderer(browser: Browser, extra: Record<string, unknown>, view = 'plan', viewport = { width: 1060, height: 900 }): Promise<Page> {
  const page = await browser.newPage({ viewport });
  await serve(page);
  const state = { operation: 'idle', headline: 'Fixture status', detail: 'Ready for review', ready: false, workflow: 'release', cdp: false, lock: false,
    inspection: null, clock: null, plan: null, logs: [], liveRace: true, termsAuthorized: false, apiFirstReady: false,
    browserHealth: {}, capabilities: { selectionReady: true, checkoutReady: true, paymentBoundaryReady: true },
    selection: null, mode: 'full', handoff: null, preparedContext: null, playerStatus: { primary: true, extended: true }, ...extra };
  await page.addInitScript((value: Record<string, unknown>) => {
    const w = window as any; w.fixtureState = value; w.fixtureCalls = [];
    const record = (name: string) => async (...args: unknown[]) => { w.fixtureCalls.push(name); w.fixtureArgs = { ...(w.fixtureArgs ?? {}), [name]: args[0] }; };
    w.thirsty = { getStatus: async () => w.fixtureState, onStatus: (callback: any) => { w.fixturePublish = callback; return () => {}; },
      setWorkflow: async (workflow: string) => { w.fixtureState.workflow = workflow; w.fixtureState.ready = false; }, invalidatePreparation: async () => {},
      authorizeTerms: async (authorized: boolean) => { w.fixtureCalls.push('authorizeTerms'); w.fixtureState.termsAuthorized = authorized; w.fixturePublish?.(w.fixtureState); },
      focusBrowser: async (request: unknown) => { w.fixtureFocusedBrowser = request; return w.fixtureFocusResult ?? 'focused'; },
      saveBooking: async (setup: unknown) => { w.fixtureCalls.push('saveBooking'); w.fixtureSaved = setup; w.fixtureState = { ...w.fixtureState, booking: {...w.fixtureState.booking,setup}, headline: 'Booking plan saved' }; },
      resetPrepare: record('resetPrepare'), armFullBooking: record('armFullBooking'), prepare: record('prepare'), dryRace: record('dryRace'), reviewLock: record('reviewLock'),
      checkReleaseBlocks: record('checkReleaseBlocks'), testBooking: record('testBooking'), cancelScheduledRelease: record('cancelScheduledRelease'),
      rebuildIntelligence: record('rebuildIntelligence'), clearIntelligence: record('clearIntelligence'), runNetworkCheck: record('runNetworkCheck'),
      watchNextRelease: record('watchNextRelease'), stopSlotWatch: record('stopSlotWatch'), closeBotBrowsers: record('closeBotBrowsers'), syncClock: record('syncClock'),
      setMode: record('setMode'), abortAutomation: record('abortAutomation'), apiPreview: record('apiPreview'),
      adviseFromHistory: async (input: unknown) => { w.fixtureCalls.push('adviseFromHistory'); w.fixtureAdviceInput = input; return w.fixtureAdvice; },
      replayPlan: async (input: unknown) => { w.fixtureCalls.push('replayPlan'); w.fixtureReplayInput = input; return w.fixtureReplay; },
      onConfirmRequest: (callback: any) => { w.fixtureConfirmRequest = callback; return () => {}; },
      confirmResponse: async (id: string, confirmed: boolean) => { w.fixtureConfirmResponse = { id, confirmed }; } };
  }, state);
  await page.goto(`${RENDERER_ORIGIN}/ui/renderer/index.html`);
  await page.waitForFunction(expected => document.getElementById('headline')?.textContent === expected, state.headline);
  await showRendererView(page, view);
  return page;
}

/** Opens a view by its current or legacy name, the way an operator would. */
export async function showRendererView(page: Page, view: string): Promise<void> {
  const target = LEGACY_VIEWS[view] ?? view;
  if (target === 'tests') { await page.locator('nav [data-view="tools"]').click(); await page.locator('#view-tools [data-view="tests"]').click(); return; }
  await page.locator(`nav [data-view="${target}"]`).click();
  if (view === 'plan') await page.locator('#strategy-advanced').evaluate(element => { (element as HTMLDetailsElement).open = true; });
}
