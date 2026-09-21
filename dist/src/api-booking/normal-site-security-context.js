export class NormalSiteSecurityContextError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
        this.name = 'NormalSiteSecurityContextError';
    }
}
/** Mirrors the actual public-checkout call site's concurrent helper invocation. No value is cached. */
export function currentHeadersFromNormalSiteHelpers(helpers) {
    return async () => {
        if (typeof helpers?.getPublicBookingTurnstileToken !== 'function' ||
            typeof helpers?.getPublicFingerprintId !== 'function')
            throw new NormalSiteSecurityContextError('NORMAL_SITE_HELPERS_UNAVAILABLE');
        let token;
        let fingerprint;
        try {
            [token, fingerprint] = await Promise.all([
                helpers.getPublicBookingTurnstileToken(),
                helpers.getPublicFingerprintId(),
            ]);
        }
        catch {
            throw new NormalSiteSecurityContextError('NORMAL_SITE_SECURITY_VERIFICATION_FAILED');
        }
        if (!token || !fingerprint)
            throw new NormalSiteSecurityContextError('NORMAL_SITE_SECURITY_CONTEXT_MISSING');
        return { turnstileToken: token, publicFingerprint: fingerprint };
    };
}
/**
 * Readiness-only probe for UI and preparation diagnostics. It deliberately
 * returns no token or fingerprint and never invents a fallback value.
 */
export async function inspectNormalSiteSecurityContext(helpers, timeoutMs = 30_000) {
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0)
        return { status: 'unsupported-integration', code: 'SECURITY_CONTEXT_OPTIONS_INVALID' };
    const provider = currentHeadersFromNormalSiteHelpers(helpers);
    try {
        await Promise.race([provider(), new Promise((_, reject) => setTimeout(() => reject(new NormalSiteSecurityContextError('NORMAL_SITE_SECURITY_INTERACTION_REQUIRED')), timeoutMs))]);
        return { status: 'ready' };
    }
    catch (error) {
        const code = error instanceof NormalSiteSecurityContextError ? error.code : 'NORMAL_SITE_SECURITY_VERIFICATION_FAILED';
        if (code === 'NORMAL_SITE_SECURITY_INTERACTION_REQUIRED')
            return { status: 'user-interaction-required', code };
        if (code === 'NORMAL_SITE_HELPERS_UNAVAILABLE')
            return { status: 'unsupported-integration', code };
        if (/DISCONNECTED/.test(code))
            return { status: 'browser-disconnected', code };
        if (/RATE_LIMIT/.test(code))
            return { status: 'rate-limited', code };
        return { status: 'verification-failed', code };
    }
}
//# sourceMappingURL=normal-site-security-context.js.map