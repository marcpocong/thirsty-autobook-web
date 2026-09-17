import type { Page } from 'playwright';
import { ONDA_URL } from '../config.js';
import { consumeSubmissionPermit, DurableSubmissionJournal, type SubmissionPermit } from './durable-submission-journal.js';
import type { SlotCheckRequest, TwoHourCheckoutRequest, TwoHourTransport } from './two-hour-reservation.js';
import { SubmissionDispatchError } from './submission-errors.js';

const ORIGIN = 'https://app.onda.fit';
const SLOT_PATH = '/api/public/is-slot-available';
const CHECKOUT_PATH = '/api/bookings/public-checkout';
const MAX_RESPONSE_BYTES = 1_000_000;

export interface CurrentCheckoutHeaders {
  turnstileToken: string;
  publicFingerprint: string;
}

/** Values must come from the current normal site flow immediately before checkout; this transport cannot create them. */
export type CurrentCheckoutHeadersProvider = () => Promise<CurrentCheckoutHeaders>;

export class BrowserSessionTransportError extends SubmissionDispatchError {
  constructor(code: string, dispatched = false, diagnostic?: SubmissionDispatchError['diagnostic']) {
    super(code, dispatched, diagnostic); this.name = 'BrowserSessionTransportError'; }
}

function usable(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !/^<.*>$/.test(value) && !/[\r\n]/.test(value);
}

/** Sends only the two observed POSTs in an existing, verified browser page. It never launches a browser. */
export class OndaBrowserSessionTransport implements TwoHourTransport {
  constructor(private readonly page: Page, private readonly currentCheckoutHeaders: CurrentCheckoutHeadersProvider) {}

  private assertPage(): void {
    if (this.page.isClosed() || this.page.url() !== ONDA_URL) throw new BrowserSessionTransportError('ONDA_SESSION_PAGE_INVALID');
  }

  private async post(path: typeof SLOT_PATH | typeof CHECKOUT_PATH, body: unknown,
    extraHeaders?: Record<string, string>): Promise<unknown> {
    this.assertPage();
    let result: { status: number; contentType: string; body: string };
    try {
      result = await this.page.evaluate(async ({ url, payload, headers }) => {
        const response = await fetch(url, { method: 'POST', credentials: 'same-origin', redirect: 'error',
          cache: 'no-store', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
          body: JSON.stringify(payload) });
        return { status: response.status, contentType: response.headers.get('content-type') ?? '', body: await response.text() };
      }, { url: `${ORIGIN}${path}`, payload: body, headers: extraHeaders ?? {} });
    } catch { throw new BrowserSessionTransportError('ONDA_TRANSPORT_FAILED', true); }
    try { this.assertPage(); }
    catch { throw new BrowserSessionTransportError('ONDA_SESSION_DISCONNECTED_AFTER_DISPATCH', true); }
    if (result.status !== 200) {
      let applicationCode: string | undefined;
      if (result.contentType.toLowerCase().includes('application/json') &&
        Buffer.byteLength(result.body, 'utf8') <= MAX_RESPONSE_BYTES) {
        try {
          const parsed: unknown = JSON.parse(result.body);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const code = (parsed as Record<string, unknown>).code;
            if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)) applicationCode = code;
          }
        } catch {/* response is not parseable */}
      }
      throw new BrowserSessionTransportError('ONDA_HTTP_STATUS_INVALID', true,
        { status: result.status, category: 'http-rejection', ...(applicationCode ? { applicationCode } : {}) });
    }
    if (!result.contentType.toLowerCase().includes('application/json')) throw new BrowserSessionTransportError('ONDA_CONTENT_TYPE_INVALID', true);
    if (Buffer.byteLength(result.body, 'utf8') > MAX_RESPONSE_BYTES) throw new BrowserSessionTransportError('ONDA_RESPONSE_TOO_LARGE', true);
    try { return JSON.parse(result.body) as unknown; }
    catch { throw new BrowserSessionTransportError('ONDA_RESPONSE_JSON_INVALID', true); }
  }

  async checkSlot(request: SlotCheckRequest): Promise<unknown> {
    this.assertPage();
    // No checkout-only headers are added to this observed request. Browser cookies follow same-origin policy.
    return this.post(SLOT_PATH, request);
  }

  async publicCheckout(request: TwoHourCheckoutRequest, permit: SubmissionPermit): Promise<unknown> {
    this.assertPage();
    if (process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT !== 'SUPERVISED_ONE_SHOT')
      throw new BrowserSessionTransportError('LIVE_SUBMISSION_DISABLED');
    let current: CurrentCheckoutHeaders;
    try { current = await this.currentCheckoutHeaders(); }
    catch { throw new BrowserSessionTransportError('CURRENT_CHECKOUT_HEADERS_UNAVAILABLE'); }
    if (!usable(current?.turnstileToken) || !usable(current?.publicFingerprint))
      throw new BrowserSessionTransportError('CURRENT_CHECKOUT_HEADERS_INVALID');
    const [first, second] = request.items;
    const expectedKey = DurableSubmissionJournal.key(request.facilityId, first.spaceId, first.date, first.startTime, second.endTime);
    consumeSubmissionPermit(permit, expectedKey);
    // The header values are ephemeral and never logged or stored by this adapter.
    return this.post(CHECKOUT_PATH, request, {
      'X-Turnstile-Token': current.turnstileToken,
      'X-Onda-Public-Fingerprint': current.publicFingerprint,
    });
  }
}
