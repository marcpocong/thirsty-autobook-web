import type { Page } from 'playwright';
import { OndaLiveAvailabilityProvider, LiveAvailabilityError, THIRSTY_PICKLE_FACILITY_ID, type LiveAvailabilityOptions } from './live-availability-provider.js';

const ORIGIN = 'https://app.onda.fit';
const PATH = `/api/public/facilities/${THIRSTY_PICKLE_FACILITY_ID}/date-availability`;
const MAX_BYTES = 4_000_000;

/** Normal same-origin GET in the operator's verified browser. No copied cookies,
 * credentials, security headers, proof replay, navigation or checkout fallback.
 * The parent retains the exact parser, pricing and freshness checks.
 */
export class OndaBrowserAvailabilityProvider extends OndaLiveAvailabilityProvider {
  constructor(page: Pick<Page, 'url' | 'evaluate'>, options: Omit<LiveAvailabilityOptions, 'fetcher'> = {}) {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      let pageUrl: URL;
      try { pageUrl = new URL(page.url()); } catch { throw new LiveAvailabilityError('AVAILABILITY_BROWSER_ORIGIN_INVALID'); }
      if (pageUrl.origin !== ORIGIN || url.origin !== ORIGIN || url.pathname !== PATH ||
          init?.method !== 'GET' || url.username || url.password)
        throw new LiveAvailabilityError('AVAILABILITY_BROWSER_SCOPE_INVALID');
      const result = await page.evaluate(async ({ path, timeoutMs, maximum }) => {
        if (location.origin !== 'https://app.onda.fit') throw Error('AVAILABILITY_BROWSER_ORIGIN_INVALID');
        const response = await fetch(path, { method: 'GET', credentials: 'same-origin', redirect: 'error',
          headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
        const contentType = response.headers.get('content-type') ?? '';
        // Rejections never return provider text or security values to Node.
        if (!response.ok) return { status: response.status, contentType, body: '' };
        if (!contentType.toLowerCase().includes('application/json')) return { status: response.status, contentType, body: '' };
        const reader = response.body?.getReader();
        if (!reader) throw Error('AVAILABILITY_BODY_FAILED');
        const chunks: Uint8Array[] = []; let length = 0;
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          length += value.byteLength;
          if (length > maximum) { await reader.cancel(); throw Error('AVAILABILITY_RESPONSE_TOO_LARGE'); }
          chunks.push(value);
        }
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return { status: response.status, contentType, body: new TextDecoder().decode(bytes) };
      }, { path: url.pathname + url.search, timeoutMs, maximum: MAX_BYTES });
      return new Response(result.body, { status: result.status, headers: { 'content-type': result.contentType } });
    };
    super({ ...options, fetcher });
  }
}
