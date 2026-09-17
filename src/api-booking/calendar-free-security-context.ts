import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Page } from 'playwright';
import { ONDA_URL } from '../config.js';
import type { CurrentCheckoutHeadersProvider } from './browser-session-transport.js';

// Public values and action observed in Onda's current court checkout bundle. They must be
// checked against that bundle after a site release; a changed value fails the live probe.
export const PUBLIC_BOOKING_TURNSTILE_ACTION = 'public_booking_checkout';
export const OBSERVED_ONDA_TURNSTILE_SITEKEY = '0x4AAAAAAD5zq_Qk95r1WD-X';
const require = createRequire(import.meta.url);
const fingerprintBundle = join(dirname(require.resolve('@fingerprintjs/fingerprintjs')), 'fp.umd.min.js');

export class CalendarFreeSecurityError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'CalendarFreeSecurityError'; }
}

/** Runs Onda's public challenge action and the same FingerprintJS version in its normal origin. */
export function calendarFreeSecurityContext(page: Page): CurrentCheckoutHeadersProvider {
  let used = false;
  return async () => {
    if (used) throw new CalendarFreeSecurityError('SECURITY_CONTEXT_ALREADY_USED');
    used = true;
    if (page.isClosed() || page.url() !== ONDA_URL) throw new CalendarFreeSecurityError('SECURITY_CONTEXT_PAGE_INVALID');
    // Only the library is injected. No token, visitor ID, cookie or challenge result is persisted.
    const script = await readFile(fingerprintBundle, 'utf8');
    try { await page.addScriptTag({ content: script }); }
    catch { throw new CalendarFreeSecurityError('FINGERPRINT_LIBRARY_LOAD_FAILED'); }
    if (page.isClosed() || page.url() !== ONDA_URL) throw new CalendarFreeSecurityError('SECURITY_CONTEXT_PAGE_CHANGED');
    try {
      const source = await readFile(new URL('./calendar-free-security-context-browser.js', import.meta.url), 'utf8');
      const result = await page.evaluate<{ code?: string; turnstileToken?: string; publicFingerprint?: string }>(
        `(${source})(${JSON.stringify({ sitekey: OBSERVED_ONDA_TURNSTILE_SITEKEY,
          action: PUBLIC_BOOKING_TURNSTILE_ACTION })})`);
      if (page.isClosed() || page.url() !== ONDA_URL) throw new CalendarFreeSecurityError('SECURITY_CONTEXT_PAGE_CHANGED');
      if ('code' in result) throw new CalendarFreeSecurityError(result.code ?? 'SECURITY_CONTEXT_VERIFICATION_FAILED');
      if (!result.turnstileToken || !result.publicFingerprint)
        throw new CalendarFreeSecurityError('SECURITY_CONTEXT_EMPTY');
      return { turnstileToken: result.turnstileToken, publicFingerprint: result.publicFingerprint };
    } catch (error) {
      if (error instanceof CalendarFreeSecurityError) throw error;
      throw new CalendarFreeSecurityError('SECURITY_CONTEXT_BROWSER_FAILED');
    }
  };
}
