import { describe, expect, it } from 'vitest';
import { checkoutDiagnostic } from '../../src/api-booking/checkout-diagnostics.js';

describe('checkout rejection diagnostics', () => {
  it('retains only bounded categories and an allowlisted application code', () => {
    const diagnostic = checkoutDiagnostic({ status: 403, contentType: 'application/json',
      body: JSON.stringify({ success: false, code: 'VERIFICATION_REQUIRED',
        error: 'Turnstile missing for jane@example.invalid with private-token-123' }) });
    expect(diagnostic).toEqual({ status: 403, category: 'http-rejection', contentKind: 'json',
      responseSource: 'application', errorHint: 'verification', applicationCode: 'VERIFICATION_REQUIRED' });
    expect(JSON.stringify(diagnostic)).not.toMatch(/jane|private-token/i);
  });

  it('distinguishes a Cloudflare HTML response without retaining its body', () => {
    const diagnostic = checkoutDiagnostic({ status: 403, contentType: 'text/html', server: 'cloudflare',
      cloudflareRay: 'abc123def4567890-MNL', body: '<html>Access denied for secret@example.invalid</html>' });
    expect(diagnostic).toMatchObject({ responseSource: 'cloudflare', contentKind: 'html',
      errorHint: 'access', cloudflareRay: 'abc123def4567890-MNL' });
    expect(JSON.stringify(diagnostic)).not.toContain('secret@example.invalid');
  });
});
