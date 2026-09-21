export function classifyRateLimit(response) {
    const status = response.status();
    const retryAfter = response.headers()['retry-after'];
    const retryAfterPresent = retryAfter !== undefined;
    if (status !== 429 && !retryAfterPresent)
        return;
    let hostname;
    try {
        hostname = new URL(response.url()).hostname.toLowerCase();
    }
    catch {
        return;
    }
    const now = Date.now();
    const value = retryAfter?.trim() ?? '';
    // Positive delay-seconds or a future HTTP date imposes an actual wait.
    const restricted = status === 429 || (/^\d+$/.test(value) ? Number(value) > 0 :
        /^[A-Za-z]{3},/.test(value) && Date.parse(value) > now);
    const request = response.request();
    return { restricted, evidence: {
            reason: 'RATE_LIMITED', timestamp: new Date(now).toISOString(), monoMs: performance.now(),
            hostname, status, resourceType: request.resourceType(), navigation: request.isNavigationRequest(),
            retryAfterPresent, sameOndaSite: hostname === 'onda.fit' || hostname.endsWith('.onda.fit'),
        } };
}
//# sourceMappingURL=rate-limit.js.map