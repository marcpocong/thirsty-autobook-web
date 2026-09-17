/** Deliberately excludes response text, IDs, contact details, cookies, proofs and verification values. */
export interface CheckoutDiagnostic {
  status: number;
  category: 'http-rejection' | 'invalid-response';
  contentKind: 'json' | 'html' | 'text' | 'empty' | 'other';
  responseSource: 'cloudflare' | 'application' | 'unknown';
  errorHint: 'verification' | 'availability' | 'customer' | 'rate-limit' | 'access' | 'other' | 'none';
  applicationCode?: string;
  cloudflareRay?: string;
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function checkoutDiagnostic(input: { status: number; contentType: string; server?: string;
  cloudflareRay?: string; body: string }): CheckoutDiagnostic {
  const type = input.contentType.toLowerCase();
  const contentKind = !input.body ? 'empty' : type.includes('json') ? 'json' :
    type.includes('html') ? 'html' : type.startsWith('text/') ? 'text' : 'other';
  let parsed: Record<string, unknown> | null = null;
  if (contentKind === 'json' && Buffer.byteLength(input.body, 'utf8') <= 1_000_000) {
    try { parsed = object(JSON.parse(input.body)); } catch { /* Keep only the format category. */ }
  }
  const code = parsed?.code ?? parsed?.errorCode;
  const applicationCode = typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : undefined;
  // Text is inspected only for bounded categories. Its contents never leave this function.
  const text = [applicationCode, parsed?.error, parsed?.message, contentKind === 'html' ? input.body.slice(0, 4096) : '']
    .filter((value): value is string => typeof value === 'string').join(' ').slice(0, 4096);
  const errorHint = /turnstile|captcha|challenge|fingerprint|verification|verify/i.test(text) ? 'verification' :
    /slot|availability|unavailable|booked|proof|conflict/i.test(text) ? 'availability' :
      /customer|member|client/i.test(text) ? 'customer' :
        /rate.?limit|too many requests/i.test(text) ? 'rate-limit' :
          /forbidden|unauthori[sz]ed|access denied|blocked/i.test(text) ? 'access' : text ? 'other' : 'none';
  const ray = input.cloudflareRay?.trim();
  return { status: input.status, category: input.status === 200 ? 'invalid-response' : 'http-rejection',
    contentKind, responseSource: parsed ? 'application' :
      (contentKind === 'html' && (/cloudflare/i.test(input.server ?? '') || !!ray) ? 'cloudflare' : 'unknown'),
    errorHint, ...(applicationCode ? { applicationCode } : {}),
    ...(ray && /^[a-f0-9]{8,32}(?:-[A-Za-z0-9]{2,8})?$/.test(ray) ? { cloudflareRay: ray } : {}) };
}
