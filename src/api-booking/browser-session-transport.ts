import type { Page } from 'playwright';
import { ONDA_URL } from '../config.js';
import { consumeSubmissionPermit, DurableSubmissionJournal, type SubmissionPermit } from './durable-submission-journal.js';
import type { SlotCheckRequest, TwoHourCheckoutRequest, TwoHourTransport } from './two-hour-reservation.js';
import { SubmissionDispatchError } from './submission-errors.js';
import { checkoutDiagnostic } from './checkout-diagnostics.js';
import { CalendarFreeSecurityError } from './calendar-free-security-context.js';

const ORIGIN = 'https://app.onda.fit';
const SLOT_PATH = '/api/public/is-slot-available';
const CHECKOUT_PATH = '/api/bookings/public-checkout';
const MAX_RESPONSE_BYTES = 1_000_000;

export interface CurrentCheckoutHeaders {
  turnstileToken: string;
  publicFingerprint: string;
}
export interface CheckoutContextHooks {
  onHumanVerificationRequired?(): Promise<void>;
  onHumanVerificationCompleted?(): Promise<void>;
}

/** Values must come from the current normal site flow immediately before checkout; this transport cannot create them. */
export type CurrentCheckoutHeadersProvider = () => Promise<CurrentCheckoutHeaders>;
export interface CheckoutHttpResponse { status: number; contentType: string; server: string;
  cloudflareRay: string; cfMitigated: string; body: string }
export type CheckoutResponseCapture = (response: CheckoutHttpResponse) => Promise<void>;

export class BrowserSessionTransportError extends SubmissionDispatchError {
  constructor(code: string, dispatched = false, diagnostic?: SubmissionDispatchError['diagnostic']) {
    super(code, dispatched, diagnostic); this.name = 'BrowserSessionTransportError'; }
}

function usable(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !/^<.*>$/.test(value) && !/[\r\n]/.test(value);
}

function securityContextError(error: unknown): BrowserSessionTransportError {
  return error instanceof CalendarFreeSecurityError && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
    ? new BrowserSessionTransportError(error.code)
    : new BrowserSessionTransportError('CURRENT_CHECKOUT_HEADERS_UNAVAILABLE');
}

/** Sends only the two observed POSTs in an existing, verified browser page. It never launches a browser. */
export class OndaBrowserSessionTransport implements TwoHourTransport {
  private preparedHeaders?: CurrentCheckoutHeaders;
  private preparedAt?: number;
  constructor(private readonly page: Page, private readonly currentCheckoutHeaders: CurrentCheckoutHeadersProvider,
    private readonly captureCheckoutResponse?: CheckoutResponseCapture, private readonly contextHooks: CheckoutContextHooks = {}) {}

  private async acquireCheckoutHeaders(): Promise<CurrentCheckoutHeaders> {
    let settled = false, verificationShown = false;
    const acquisition = this.currentCheckoutHeaders().finally(() => { settled = true; });
    while (!settled) {
      await Promise.race([acquisition.then(() => undefined, () => undefined),
        new Promise<void>(resolve => setTimeout(resolve, 200))]);
      if (settled) break;
      const challengeVisible = await this.page.locator('iframe[src*="challenges.cloudflare.com"]:visible').count().then(count => count > 0).catch(() => false);
      if (challengeVisible && !verificationShown) {
        verificationShown = true;
        await this.contextHooks.onHumanVerificationRequired?.();
      }
    }
    const headers = await acquisition;
    if (verificationShown) await this.contextHooks.onHumanVerificationCompleted?.();
    return headers;
  }

  async prepareCheckoutContext(): Promise<void> {
    this.assertPage();
    if (process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT !== 'SUPERVISED_ONE_SHOT')
      throw new BrowserSessionTransportError('LIVE_SUBMISSION_DISABLED');
    let current: CurrentCheckoutHeaders;
    try { current = await this.acquireCheckoutHeaders(); }
    catch (error) { throw securityContextError(error); }
    if (!usable(current?.turnstileToken) || !usable(current?.publicFingerprint))
      throw new BrowserSessionTransportError('CURRENT_CHECKOUT_HEADERS_INVALID');
    this.assertPage();
    this.preparedHeaders = current;
    this.preparedAt = Date.now();
  }

  private assertPage(): void {
    if (this.page.isClosed() || this.page.url() !== ONDA_URL) throw new BrowserSessionTransportError('ONDA_SESSION_PAGE_INVALID');
  }

  private async post(path: typeof SLOT_PATH | typeof CHECKOUT_PATH, body: unknown,
    extraHeaders?: Record<string, string>): Promise<unknown> {
    this.assertPage();
    let result: CheckoutHttpResponse;
    try {
      result = await this.page.evaluate(async ({ url, payload, headers }) => {
        const response = await fetch(url, { method: 'POST', credentials: 'same-origin', redirect: 'error',
          cache: 'no-store', headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(payload) });
        return { status: response.status, contentType: response.headers.get('content-type') ?? '',
          server: response.headers.get('server') ?? '', cloudflareRay: response.headers.get('cf-ray') ?? '',
          cfMitigated: response.headers.get('cf-mitigated') ?? '',
          body: await response.text() };
      }, { url: `${ORIGIN}${path}`, payload: body, headers: extraHeaders ?? {} });
    } catch { throw new BrowserSessionTransportError('ONDA_TRANSPORT_FAILED', true); }
    if (path === CHECKOUT_PATH && this.captureCheckoutResponse) {
      try { await this.captureCheckoutResponse(result); }
      catch { throw new BrowserSessionTransportError('CHECKOUT_RESPONSE_CAPTURE_FAILED', true); }
    }
    try { this.assertPage(); }
    catch { throw new BrowserSessionTransportError('ONDA_SESSION_DISCONNECTED_AFTER_DISPATCH', true); }
    if (result.status !== 200) throw new BrowserSessionTransportError('ONDA_HTTP_STATUS_INVALID', true,
      checkoutDiagnostic(result));
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
    let current = this.preparedHeaders;
    let preparedAt = this.preparedAt;
    this.preparedHeaders = undefined;
    this.preparedAt = undefined;
    if (!current) {
      try { current = await this.acquireCheckoutHeaders(); }
      catch (error) { throw securityContextError(error); }
      preparedAt = Date.now();
    }
    if (!usable(current?.turnstileToken) || !usable(current?.publicFingerprint))
      throw new BrowserSessionTransportError('CURRENT_CHECKOUT_HEADERS_INVALID');
    // Cloudflare tokens expire after five minutes. A wide margin covers proof calls and dispatch latency.
    if (preparedAt === undefined || !Number.isFinite(preparedAt) || Date.now() - preparedAt < 0 ||
      Date.now() - preparedAt > 120_000)
      throw new BrowserSessionTransportError('CURRENT_CHECKOUT_HEADERS_STALE');
    this.assertPage();
    const [first] = request.items;
    const last = request.items.at(-1);
    if (!first || !last || request.items.length > 6) throw new BrowserSessionTransportError('CHECKOUT_ITEMS_INVALID');
    const expectedKey = DurableSubmissionJournal.key(request.facilityId, first.spaceId, first.date, first.startTime, last.endTime);
    consumeSubmissionPermit(permit, expectedKey);
    // The header values are ephemeral and never logged or stored by this adapter.
    return this.post(CHECKOUT_PATH, request, {
      'X-Turnstile-Token': current.turnstileToken,
      'X-Onda-Public-Fingerprint': current.publicFingerprint,
    });
  }
}
