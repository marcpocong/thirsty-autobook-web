import type { CurrentCheckoutHeadersProvider } from './browser-session-transport.js';

/** Bind these to Onda's live browser helpers, not captured values or independent token generation. */
export interface NormalSiteSecurityHelpers {
  getPublicBookingTurnstileToken(): Promise<string | null>;
  getPublicFingerprintId(): Promise<string | null>;
}

export class NormalSiteSecurityContextError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'NormalSiteSecurityContextError'; }
}

/** Mirrors the actual public-checkout call site's concurrent helper invocation. No value is cached. */
export function currentHeadersFromNormalSiteHelpers(helpers: NormalSiteSecurityHelpers): CurrentCheckoutHeadersProvider {
  return async () => {
    if (typeof helpers?.getPublicBookingTurnstileToken !== 'function' ||
      typeof helpers?.getPublicFingerprintId !== 'function')
      throw new NormalSiteSecurityContextError('NORMAL_SITE_HELPERS_UNAVAILABLE');
    let token: string | null;
    let fingerprint: string | null;
    try {
      [token, fingerprint] = await Promise.all([
        helpers.getPublicBookingTurnstileToken(),
        helpers.getPublicFingerprintId(),
      ]);
    } catch { throw new NormalSiteSecurityContextError('NORMAL_SITE_SECURITY_VERIFICATION_FAILED'); }
    if (!token || !fingerprint) throw new NormalSiteSecurityContextError('NORMAL_SITE_SECURITY_CONTEXT_MISSING');
    return { turnstileToken: token, publicFingerprint: fingerprint };
  };
}
