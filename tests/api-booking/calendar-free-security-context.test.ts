import type { Page } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { calendarFreeSecurityContext } from '../../src/api-booking/calendar-free-security-context.js';

describe('calendar-free checkout verification preparation', () => {
  it('invokes Onda loaded helpers without injecting a custom challenge', async () => {
    const evaluate = vi.fn(async (_source: string) =>
      ({ turnstileToken: 'synthetic-fresh-token', publicFingerprint: 'synthetic-visitor' }));
    const page = { isClosed: () => false, url: () => 'https://app.onda.fit/book/thirsty-pickle',
      locator: () => ({ evaluateAll: async () => [
        'https://app.onda.fit/_next/static/immutable/chunks/445pzov5_5spg.js',
        'https://app.onda.fit/_next/static/immutable/chunks/1y9e760opu2ka.js',
      ] }), evaluate } as unknown as Page;
    const provider = calendarFreeSecurityContext(page);
    await expect(provider()).resolves.toEqual({ turnstileToken: 'synthetic-fresh-token', publicFingerprint: 'synthetic-visitor' });
    expect(evaluate).toHaveBeenCalledWith(expect.stringContaining('module.i(709892).getPublicBookingTurnstileToken'));
    expect(evaluate.mock.calls[0]![0]).toContain('module.i(139691).getPublicFingerprintId');
    await expect(provider()).rejects.toThrow('SECURITY_CONTEXT_ALREADY_USED');
  });

  it('fails before loading verification code when the page is not the exact Onda venue', async () => {
    const evaluate = vi.fn();
    const page = { isClosed: () => false, url: () => 'https://example.invalid/', evaluate } as unknown as Page;
    await expect(calendarFreeSecurityContext(page)()).rejects.toThrow('SECURITY_CONTEXT_PAGE_INVALID');
    expect(evaluate).not.toHaveBeenCalled();
  });
});
