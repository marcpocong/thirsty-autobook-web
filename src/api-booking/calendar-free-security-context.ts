import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright';
import { ONDA_URL } from '../config.js';
import type { CurrentCheckoutHeadersProvider } from './browser-session-transport.js';

export class CalendarFreeSecurityError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'CalendarFreeSecurityError'; }
}

/** Calls Onda's current booking challenge and fingerprint helpers in its own page runtime. */
export function calendarFreeSecurityContext(page: Page): CurrentCheckoutHeadersProvider {
  let used = false;
  return async () => {
    if (used) throw new CalendarFreeSecurityError('SECURITY_CONTEXT_ALREADY_USED');
    used = true;
    if (page.isClosed() || page.url() !== ONDA_URL) throw new CalendarFreeSecurityError('SECURITY_CONTEXT_PAGE_INVALID');
    const scripts = await page.locator('script[src]').evaluateAll(elements =>
      elements.map(element => (element as HTMLScriptElement).src));
    if (!scripts.some(src => src.endsWith('/445pzov5_5spg.js')) ||
      !scripts.some(src => src.endsWith('/1y9e760opu2ka.js')))
      throw new CalendarFreeSecurityError('ONDA_SECURITY_BUNDLE_CHANGED');
    try {
      const source = await readFile(new URL('./calendar-free-security-context-browser.js', import.meta.url), 'utf8');
      const result = await page.evaluate<{ code?: string; turnstileToken?: string; publicFingerprint?: string }>(
        `(${source})()`);
      if (page.isClosed() || page.url() !== ONDA_URL) throw new CalendarFreeSecurityError('SECURITY_CONTEXT_PAGE_CHANGED');
      if (result.code) throw new CalendarFreeSecurityError(result.code);
      if (!result.turnstileToken || !result.publicFingerprint)
        throw new CalendarFreeSecurityError('SECURITY_CONTEXT_EMPTY');
      return { turnstileToken: result.turnstileToken, publicFingerprint: result.publicFingerprint };
    } catch (error) {
      if (error instanceof CalendarFreeSecurityError) throw error;
      throw new CalendarFreeSecurityError('SECURITY_CONTEXT_BROWSER_FAILED');
    }
  };
}
