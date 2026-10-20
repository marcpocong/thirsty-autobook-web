import type { Page } from 'playwright';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { CalendarFreeSecurityError, calendarFreeSecurityContext } from '../../src/api-booking/calendar-free-security-context.js';

/** Runs the real page script against a simulated Onda runtime whose two helpers the test controls. */
function simulatedPage(helpers: { challenge: () => Promise<string | null>; fingerprint: () => Promise<string | null> }) {
  const evaluate = vi.fn(async (source: string) => {
    const window = { TURBOPACK: { push: (entry: unknown[]) => {
      if (typeof entry[2] === 'function') (entry[2] as (module: unknown) => void)({ i: (id: number) =>
        id === 709892 ? { getPublicBookingTurnstileToken: helpers.challenge } : id === 139691 ? { getPublicFingerprintId: helpers.fingerprint } : {} });
    } } };
    return runInNewContext(source, { window, setTimeout, clearTimeout, Promise, Math });
  });
  return { isClosed: () => false, url: () => 'https://app.onda.fit/book/thirsty-pickle',
    locator: () => ({ evaluateAll: async () => ['https://app.onda.fit/_next/static/immutable/chunks/current.js'] }), evaluate } as unknown as Page;
}

describe('calendar-free checkout verification preparation', () => {
  it('invokes Onda loaded helpers without injecting a custom challenge', async () => {
    const evaluate = vi.fn(async (_source: string) =>
      ({ turnstileToken: 'synthetic-fresh-token', publicFingerprint: 'synthetic-visitor' }));
    const page = { isClosed: () => false, url: () => 'https://app.onda.fit/book/thirsty-pickle',
      locator: () => ({ evaluateAll: async () => [
        'https://app.onda.fit/_next/static/immutable/chunks/current-booking-runtime.js',
      ] }), evaluate } as unknown as Page;
    const provider = calendarFreeSecurityContext(page);
    await expect(provider()).resolves.toEqual({ turnstileToken: 'synthetic-fresh-token', publicFingerprint: 'synthetic-visitor' });
    expect(evaluate).toHaveBeenCalledWith(expect.stringContaining('module.i(709892).getPublicBookingTurnstileToken'));
    expect(evaluate.mock.calls[0]![0]).toContain('module.i(139691).getPublicFingerprintId');
    await expect(provider()).rejects.toThrow('SECURITY_CONTEXT_ALREADY_USED');
  });

  it('accepts routine Onda chunk filename changes and delegates capability checks to the page helper',async()=>{
    const evaluate=vi.fn(async()=>({turnstileToken:'fresh-token',publicFingerprint:'fresh-fingerprint'}));
    const page={isClosed:()=>false,url:()=> 'https://app.onda.fit/book/thirsty-pickle',
      locator:()=>({evaluateAll:async()=>['https://app.onda.fit/_next/static/immutable/chunks/2apa6-qkw71e9.js']}),evaluate} as unknown as Page;
    await expect(calendarFreeSecurityContext(page)()).resolves.toEqual({turnstileToken:'fresh-token',publicFingerprint:'fresh-fingerprint'});
    expect(evaluate).toHaveBeenCalledOnce();
  });

  it('fails closed when the exact venue has no loaded Onda application bundle',async()=>{
    const evaluate=vi.fn();
    const page={isClosed:()=>false,url:()=> 'https://app.onda.fit/book/thirsty-pickle',
      locator:()=>({evaluateAll:async()=>['https://example.invalid/not-onda.js']}),evaluate} as unknown as Page;
    await expect(calendarFreeSecurityContext(page)()).rejects.toThrow('ONDA_SECURITY_BUNDLE_CHANGED');
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('reports which helper rejected, without returning its reason or any value', async () => {
    const page = simulatedPage({ challenge: () => Promise.reject(Error('provider text must not surface')), fingerprint: async () => 'visitor' });
    const failure = await calendarFreeSecurityContext(page)().catch(error => error);
    expect(failure).toBeInstanceOf(CalendarFreeSecurityError);
    expect(failure.code).toBe('ONDA_SECURITY_VERIFICATION_FAILED');
    expect(failure.detail).toEqual({ failedHelper: 'challenge' });
    expect(JSON.stringify(failure.detail)).not.toMatch(/provider text|visitor/);
  });

  it('keeps Promise.all settlement: the first rejection fails at once even while the other helper is pending', async () => {
    const page = simulatedPage({ challenge: () => new Promise(() => undefined), fingerprint: () => Promise.reject(Error('x')) });
    const failure = await calendarFreeSecurityContext(page)().catch(error => error);
    expect(failure.detail).toEqual({ failedHelper: 'fingerprint' });
  });

  it('returns both genuine helper values only when both resolve, with no diagnostic fields', async () => {
    const page = simulatedPage({ challenge: async () => 'fresh-token', fingerprint: async () => 'visitor' });
    await expect(calendarFreeSecurityContext(page)()).resolves.toEqual({ turnstileToken: 'fresh-token', publicFingerprint: 'visitor' });
    const empty = simulatedPage({ challenge: async () => 'fresh-token', fingerprint: async () => null });
    const failure = await calendarFreeSecurityContext(empty)().catch(error => error);
    expect(failure.code).toBe('ONDA_SECURITY_CONTEXT_EMPTY');
    expect(failure.detail).toEqual({});
  });

  it('fails before loading verification code when the page is not the exact Onda venue', async () => {
    const evaluate = vi.fn();
    const page = { isClosed: () => false, url: () => 'https://example.invalid/', evaluate } as unknown as Page;
    await expect(calendarFreeSecurityContext(page)()).rejects.toThrow('SECURITY_CONTEXT_PAGE_INVALID');
    expect(evaluate).not.toHaveBeenCalled();
  });
});
