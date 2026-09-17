import type { Page } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { calendarFreeSecurityContext, OBSERVED_ONDA_TURNSTILE_SITEKEY,
  PUBLIC_BOOKING_TURNSTILE_ACTION } from '../../src/api-booking/calendar-free-security-context.js';

describe('calendar-free checkout verification preparation', () => {
  it('uses the Onda booking action and same-page fingerprint bundle without a calendar read', async () => {
    const addScriptTag = vi.fn(async () => undefined);
    const evaluate = vi.fn(async (_fn: unknown, args: unknown) =>
      ({ turnstileToken: 'synthetic-fresh-token', publicFingerprint: 'synthetic-visitor' }));
    const page = { isClosed: () => false, url: () => 'https://app.onda.fit/book/thirsty-pickle',
      addScriptTag, evaluate } as unknown as Page;
    const provider = calendarFreeSecurityContext(page);
    await expect(provider()).resolves.toEqual({ turnstileToken: 'synthetic-fresh-token', publicFingerprint: 'synthetic-visitor' });
    expect(addScriptTag).toHaveBeenCalledOnce();
    expect(evaluate).toHaveBeenCalledWith(expect.stringContaining('async ({ sitekey, action })'));
    expect(evaluate.mock.calls[0]![0]).toContain(OBSERVED_ONDA_TURNSTILE_SITEKEY);
    expect(evaluate.mock.calls[0]![0]).toContain(PUBLIC_BOOKING_TURNSTILE_ACTION);
    await expect(provider()).rejects.toThrow('SECURITY_CONTEXT_ALREADY_USED');
  });

  it('fails before loading verification code when the page is not the exact Onda venue', async () => {
    const addScriptTag = vi.fn();
    const page = { isClosed: () => false, url: () => 'https://example.invalid/', addScriptTag } as unknown as Page;
    await expect(calendarFreeSecurityContext(page)()).rejects.toThrow('SECURITY_CONTEXT_PAGE_INVALID');
    expect(addScriptTag).not.toHaveBeenCalled();
  });
});
