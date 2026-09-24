import type { Browser, Page } from 'playwright';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

/**
 * Loads the real renderer (index.html, styles.css, app.ts with its two pure imports inlined) into Chrome
 * with a recording fake bridge. `window.fixtureCalls` lists every bridge call; `window.fixtureSaved` is
 * the last saved setup. Phase 4 calls answer with `window.fixtureAdvice` / `window.fixtureReplay`.
 */
export async function openRenderer(browser: Browser, extra: Record<string, unknown>, view = 'plan'): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1060, height: 900 } });
  const html = (await readFile('ui/renderer/index.html', 'utf8')).replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '').replace(/<script[^>]*src="app.js"[^>]*><\/script>/, '');
  await page.setContent(html);
  await page.addStyleTag({ content: await readFile('ui/renderer/styles.css', 'utf8') });
  const state = { operation: 'idle', headline: 'Fixture status', detail: 'Ready for review', ready: false, workflow: 'release', cdp: false, lock: false,
    inspection: null, clock: null, plan: null, logs: [], liveRace: true, termsAuthorized: false, apiFirstReady: false,
    browserHealth: {}, capabilities: { selectionReady: true, checkoutReady: true, paymentBoundaryReady: true },
    selection: null, mode: 'full', handoff: null, preparedContext: null, playerStatus: { primary: true, extended: true }, ...extra };
  await page.evaluate(value => {
    const w = window as any; w.fixtureState = value; w.fixtureCalls = [];
    const record = (name: string) => async (...args: unknown[]) => { w.fixtureCalls.push(name); w.fixtureArgs = { ...(w.fixtureArgs ?? {}), [name]: args[0] }; };
    w.thirsty = { getStatus: async () => w.fixtureState, onStatus: (callback: any) => { w.fixturePublish = callback; return () => {}; },
      setWorkflow: async () => {}, invalidatePreparation: async () => {}, authorizeTerms: async () => {},
      saveBooking: async (setup: unknown) => { w.fixtureCalls.push('saveBooking'); w.fixtureSaved = setup; w.fixtureState = { ...w.fixtureState, headline: 'Booking plan saved' }; },
      resetPrepare: record('resetPrepare'), armFullBooking: record('armFullBooking'), prepare: record('prepare'), dryRace: record('dryRace'),
      rebuildIntelligence: record('rebuildIntelligence'), clearIntelligence: record('clearIntelligence'), runNetworkCheck: record('runNetworkCheck'),
      adviseFromHistory: async (input: unknown) => { w.fixtureCalls.push('adviseFromHistory'); w.fixtureAdviceInput = input; return w.fixtureAdvice; },
      replayPlan: async (input: unknown) => { w.fixtureCalls.push('replayPlan'); w.fixtureReplayInput = input; return w.fixtureReplay; },
      onConfirmRequest: () => () => {}, confirmResponse: async () => {} };
  }, state);
  const source = (await readFile('src/booking-setup.ts', 'utf8')) + '\n' + (await readFile('src/precision-simple.ts', 'utf8')) + '\n' + (await readFile('ui/renderer/app.ts', 'utf8'))
    .replace(/^import .*booking-setup\.js';\r?\n/m, '').replace(/^import \{[^}]*\} from '\.\.\/\.\.\/src\/precision-simple\.js';\r?\n/m, '');
  await page.addScriptTag({ type: 'module', content: stripTypeScriptTypes(source) });
  await page.waitForFunction(expected => document.getElementById('headline')?.textContent === expected, state.headline);
  await page.locator(`[data-view="${view}"]`).click();
  return page;
}
