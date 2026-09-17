import { describe, expect, it, vi } from 'vitest';
import { currentHeadersFromNormalSiteHelpers } from '../../src/api-booking/normal-site-security-context.js';

describe('normal site security context', () => {
  it('awaits the actual helper pair, including an interactive verification delay, without caching values', async () => {
    let complete!: (value: string) => void;
    const turnstile = vi.fn().mockImplementationOnce(() => new Promise<string>(resolve => { complete = resolve; }))
      .mockResolvedValueOnce('fresh-second-token');
    const fingerprint = vi.fn(async () => 'current-browser-visitor-id');
    const provider = currentHeadersFromNormalSiteHelpers({ getPublicBookingTurnstileToken: turnstile,
      getPublicFingerprintId: fingerprint });
    const pending = provider();
    expect(turnstile).toHaveBeenCalledOnce();
    expect(fingerprint).toHaveBeenCalledOnce();
    complete('fresh-first-token');
    await expect(pending).resolves.toEqual({ turnstileToken: 'fresh-first-token', publicFingerprint: 'current-browser-visitor-id' });
    await expect(provider()).resolves.toMatchObject({ turnstileToken: 'fresh-second-token' });
    expect(turnstile).toHaveBeenCalledTimes(2);
    expect(fingerprint).toHaveBeenCalledTimes(2);
  });

  it('fails closed for unavailable, missing, or failed normal verification', async () => {
    await expect(currentHeadersFromNormalSiteHelpers({} as never)()).rejects.toThrow('NORMAL_SITE_HELPERS_UNAVAILABLE');
    await expect(currentHeadersFromNormalSiteHelpers({
      getPublicBookingTurnstileToken: async () => null, getPublicFingerprintId: async () => 'visitor',
    })()).rejects.toThrow('NORMAL_SITE_SECURITY_CONTEXT_MISSING');
    await expect(currentHeadersFromNormalSiteHelpers({
      getPublicBookingTurnstileToken: async () => { throw Error('Cloudflare challenge failed'); },
      getPublicFingerprintId: async () => 'visitor',
    })()).rejects.toThrow('NORMAL_SITE_SECURITY_VERIFICATION_FAILED');
  });
});
