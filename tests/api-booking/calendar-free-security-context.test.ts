import type { Page } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { calendarFreeSecurityContext } from '../../src/api-booking/calendar-free-security-context.js';

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

  it('fails before loading verification code when the page is not the exact Onda venue', async () => {
    const evaluate = vi.fn();
    const page = { isClosed: () => false, url: () => 'https://example.invalid/', evaluate } as unknown as Page;
    await expect(calendarFreeSecurityContext(page)()).rejects.toThrow('SECURITY_CONTEXT_PAGE_INVALID');
    expect(evaluate).not.toHaveBeenCalled();
  });
});
