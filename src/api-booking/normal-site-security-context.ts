import type { CurrentCheckoutHeadersProvider } from './browser-session-transport.js';

/** Bind these to Onda's live browser helpers, not captured values or independent token generation. */
export interface NormalSiteSecurityHelpers {
  getPublicBookingTurnstileToken(): Promise<string | null>;
  getPublicFingerprintId(): Promise<string | null>;
}

export type SecurityContextStatus = 'ready' | 'user-interaction-required' | 'verification-failed' | 'unsupported-integration' | 'browser-disconnected' | 'rate-limited';
export interface SecurityContextReadiness { status: SecurityContextStatus; code?: string }

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

/**
 * Readiness-only probe for UI and preparation diagnostics. It deliberately
 * returns no token or fingerprint and never invents a fallback value.
 */
export async function inspectNormalSiteSecurityContext(
  helpers: NormalSiteSecurityHelpers,
  timeoutMs = 30_000,
): Promise<SecurityContextReadiness> {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) return { status: 'unsupported-integration', code: 'SECURITY_CONTEXT_OPTIONS_INVALID' };
  const provider = currentHeadersFromNormalSiteHelpers(helpers);
  try {
    await Promise.race([provider(), new Promise<never>((_, reject) => setTimeout(() => reject(new NormalSiteSecurityContextError('NORMAL_SITE_SECURITY_INTERACTION_REQUIRED')), timeoutMs))]);
    return { status: 'ready' };
  } catch (error) {
    const code = error instanceof NormalSiteSecurityContextError ? error.code : 'NORMAL_SITE_SECURITY_VERIFICATION_FAILED';
    if (code === 'NORMAL_SITE_SECURITY_INTERACTION_REQUIRED') return { status: 'user-interaction-required', code };
    if (code === 'NORMAL_SITE_HELPERS_UNAVAILABLE') return { status: 'unsupported-integration', code };
    if (/DISCONNECTED/.test(code)) return { status: 'browser-disconnected', code };
    if (/RATE_LIMIT/.test(code)) return { status: 'rate-limited', code };
    return { status: 'verification-failed', code };
  }
}
