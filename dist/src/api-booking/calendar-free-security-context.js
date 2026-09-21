import { readFile } from 'node:fs/promises';
import { ONDA_URL } from '../config.js';
export class CalendarFreeSecurityError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
        this.name = 'CalendarFreeSecurityError';
    }
}
/** Calls Onda's current booking challenge and fingerprint helpers in its own page runtime. */
export function calendarFreeSecurityContext(page) {
    let used = false;
    return async () => {
        if (used)
            throw new CalendarFreeSecurityError('SECURITY_CONTEXT_ALREADY_USED');
        used = true;
        if (page.isClosed() || page.url() !== ONDA_URL)
            throw new CalendarFreeSecurityError('SECURITY_CONTEXT_PAGE_INVALID');
        const scripts = await page.locator('script[src]').evaluateAll(elements => elements.map(element => element.src));
        const origin = new URL(ONDA_URL).origin;
        if (!scripts.some(src => {
            try {
                const url = new URL(src);
                return url.origin === origin && url.pathname.startsWith('/_next/static/immutable/chunks/');
            }
            catch {
                return false;
            }
        }))
            throw new CalendarFreeSecurityError('ONDA_SECURITY_BUNDLE_CHANGED');
        try {
            const source = await readFile(new URL('./calendar-free-security-context-browser.js', import.meta.url), 'utf8');
            const result = await page.evaluate(`(${source})()`);
            if (page.isClosed() || page.url() !== ONDA_URL)
                throw new CalendarFreeSecurityError('SECURITY_CONTEXT_PAGE_CHANGED');
            if (result.code)
                throw new CalendarFreeSecurityError(result.code);
            if (!result.turnstileToken || !result.publicFingerprint)
                throw new CalendarFreeSecurityError('SECURITY_CONTEXT_EMPTY');
            return { turnstileToken: result.turnstileToken, publicFingerprint: result.publicFingerprint };
        }
        catch (error) {
            if (error instanceof CalendarFreeSecurityError)
                throw error;
            throw new CalendarFreeSecurityError('SECURITY_CONTEXT_BROWSER_FAILED');
        }
    };
}
//# sourceMappingURL=calendar-free-security-context.js.map