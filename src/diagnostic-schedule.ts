import type { Page } from 'playwright';
import { assertPage } from './browser.js';
import { inspectLockPage } from './lock-browser.js';
import type { Safety } from './safety.js';

// Reuse the lock review's fail-closed schedule/selection/payment sentinels.
export async function assertDiagnosticSchedule(page: Page, safety: Safety, retainedQrPages: readonly Page[] = []) {
  const browser = page.context().browser();
  const ondaPages = browser?.contexts().flatMap(context => context.pages()).filter(candidate => {
    try { const host = new URL(candidate.url()).hostname; return host === 'onda.fit' || host.endsWith('.onda.fit'); }
    catch { return false; }
  });
  // Only Reset & Prepare for a durable HOLD_VERIFIED record supplies this
  // explicit page identity. Ordinary diagnostics still require one Onda tab.
  if (!ondaPages || retainedQrPages.length > 1 || retainedQrPages.includes(page) ||
      new Set([page,...retainedQrPages]).size !== ondaPages.length ||
      ondaPages.some(candidate => candidate !== page && !retainedQrPages.includes(candidate)))
    throw Error('ONDA_TAB_AMBIGUOUS_OR_MISSING');
  for (const retained of retainedQrPages) {
    const hold = await inspectLockPage(retained);
    if (hold.page !== 'QR Checkout' || !['Active','Expired'].includes(hold.hold))
      throw Error('PAYMENT_HOLD_MAY_BE_ACTIVE');
  }
  await assertPage(page, safety);
  const state = await inspectLockPage(page);
  if (!state.clean || state.page !== 'Schedule' || state.selected !== 0 || state.hold !== 'Not detected') {
    throw Error('DIAGNOSTIC_SCHEDULE_NOT_CLEAN');
  }
  if (!await page.evaluate(() => document.visibilityState === 'visible')) throw Error('TAB_NOT_VISIBLE');
  safety.check();
}
