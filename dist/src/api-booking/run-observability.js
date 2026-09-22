export const API_SECURITY_PREWARM_LEAD_MS = 15_000;
export const API_DIRECT_SECURITY_PREWARM_LEAD_MS = 15_000;
const safeCode = /^[A-Z][A-Z0-9_]{0,79}$/;
/** Preserve useful failure categories without writing exception text, URLs, or tokens. */
export function safeApiFailureCode(error, fallback) {
    let current = error;
    for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
        if (safeCode.test(current.message))
            return current.message;
        if (current.name === 'TimeoutError' || /\btimeout\b.*\bexceeded\b/i.test(current.message))
            return 'API_BROWSER_PAGE_TIMEOUT';
        current = current.cause;
    }
    return safeCode.test(fallback) ? fallback : 'API_FIRST_RUN_FAILED';
}
//# sourceMappingURL=run-observability.js.map