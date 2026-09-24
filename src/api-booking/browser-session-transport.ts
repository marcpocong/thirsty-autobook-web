import type { Page } from 'playwright';
import { ONDA_URL } from '../config.js';
import { consumeSubmissionPermit, DurableSubmissionJournal, type SubmissionPermit } from './durable-submission-journal.js';
import type { SlotCheckRequest, TwoHourCheckoutRequest, TwoHourTransport } from './two-hour-reservation.js';
import type { ProoflessCheckoutRequest } from './proofless-checkout.js';
import { SubmissionDispatchError } from './submission-errors.js';
import { checkoutDiagnostic, type CheckoutDiagnostic } from './checkout-diagnostics.js';
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
export type BrowserTransportObservation =
  | { event: 'SECURITY_PREPARATION_STARTED'; securitySource: 'FRESH_ACQUISITION' | 'RECENT_CONTEXT_REUSE' | 'SHARED_ACQUISITION' }
  | { event: 'SECURITY_PREPARATION_COMPLETED'; securitySource: 'FRESH_ACQUISITION' | 'RECENT_CONTEXT_REUSE' | 'SHARED_ACQUISITION'; durationMs: number; failureCategory?: string }
  | { event: 'SECURITY_CHALLENGE_OBSERVED' | 'SECURITY_CHALLENGE_COMPLETED' }
  | { event: 'SLOT_CHECK_STARTED' }
  | { event: 'SLOT_CHECK_COMPLETED'; durationMs: number; resultCategory: string; success: boolean; isAvailable?: boolean; failureCategory?: string }
  | { event: 'CHECKOUT_FUNCTION_ENTERED'; preparedContextAgeMs: number; securitySource: 'PREPARED_CONTEXT' | 'CHECKOUT_ACQUISITION' }
  | { event: 'CHECKOUT_PRE_POST'; preparedContextAgeMs: number; securitySource: 'PREPARED_CONTEXT' | 'CHECKOUT_ACQUISITION' }
  | { event: 'CHECKOUT_HTTP_POST_INITIATED'; initiationEvidence: 'PLAYWRIGHT_REQUEST_EVENT' }
  | { event: 'CHECKOUT_RESPONSE_COMPLETED'; networkDurationMs: number; statusCode?: number; dispatchState: 'RESPONSE_CAPTURED' | 'UNKNOWN'; failureCategory?: string;
      /** Bounded categories from checkoutDiagnostic (never response text). */
      errorHint?: CheckoutDiagnostic['errorHint']; responseSource?: CheckoutDiagnostic['responseSource'] };
export type BrowserTransportObserver = (observation: BrowserTransportObservation) => void;

/** Values must come from the current normal site flow immediately before checkout; this transport cannot create them. */
export type CurrentCheckoutHeadersProvider = () => Promise<CurrentCheckoutHeaders>;
export interface CheckoutHttpResponse { status: number; contentType: string; server: string;
  vercelId?: string; requestId?: string; serverTiming?: string; responseReceivedMs?: number; responseCompletedMs?: number;
  cloudflareRay: string; cfMitigated: string; body: string }
export type CheckoutResponseCapture = (response: CheckoutHttpResponse) => Promise<void>;
/** Release-dispatch guards. A scheduled release must not spend seconds acquiring
 * security after its window check, so it can require the prewarmed context and
 * re-check the window as the very last step before the POST. */
export interface CheckoutDispatchOptions {
  requirePreparedContext?: boolean;
  /** Throws (for example SubmissionDispatchError with dispatched=false) to stop before the POST. */
  beforePost?: () => void;
}

/**
 * Armed Precision requests: the journal key and the exact JSON body are computed
 * once, before release, for a deeply frozen request object. Because the object can
 * never change afterwards, the cached values stay exact and the release instant
 * needs no hashing or serialization. Unarmed requests are unaffected.
 */
const armedRequests = new WeakMap<object, { key: string; body: string }>();
function deeplyFrozen(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return true;
  return Object.isFrozen(value) && Object.values(value).every(deeplyFrozen);
}
function requestKey(request: TwoHourCheckoutRequest | ProoflessCheckoutRequest): string {
  const [first] = request.items;
  const last = request.items.at(-1);
  if (!first || !last || request.items.length > 6) throw new BrowserSessionTransportError('CHECKOUT_ITEMS_INVALID');
  return DurableSubmissionJournal.key(request.facilityId, first.spaceId, first.date, first.startTime, last.endTime);
}
export function armCheckoutRequest(request: ProoflessCheckoutRequest): { key: string; body: string } {
  if (!deeplyFrozen(request)) throw new BrowserSessionTransportError('ARMED_REQUEST_NOT_FROZEN');
  if (request.items.some(item => item.availabilityProof !== null)) throw new BrowserSessionTransportError('DIRECT_PROOFLESS_SHAPE_INVALID');
  const armed = { key: requestKey(request), body: JSON.stringify(request) };
  armedRequests.set(request, armed);
  return armed;
}

export class BrowserSessionTransportError extends SubmissionDispatchError {
  constructor(code: string, dispatched = false, diagnostic?: SubmissionDispatchError['diagnostic'], confirmedRejected = false) {
    super(code, dispatched, diagnostic, confirmedRejected); this.name = 'BrowserSessionTransportError'; }
}

function usable(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !/^<.*>$/.test(value) && !/[\r\n]/.test(value);
}

function securityContextError(error: unknown): BrowserSessionTransportError {
  return error instanceof CalendarFreeSecurityError && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
    ? new BrowserSessionTransportError(error.code)
    : new BrowserSessionTransportError('CURRENT_CHECKOUT_HEADERS_UNAVAILABLE');
}

function confirmedApplicationConflict(result: CheckoutHttpResponse): boolean {
  if (![400,409].includes(result.status) || !result.contentType.toLowerCase().includes('application/json')) return false;
  try {
    const value = JSON.parse(result.body) as Record<string, unknown>;
    const explicitRejection=result.status===409 || value.error==='This booking date is not available yet.';
    return explicitRejection && value.success === false && typeof value.error === 'string' && value.error.length > 0 &&
      !Object.hasOwn(value, 'bookings') && !Object.hasOwn(value, 'transaction');
  } catch { return false; }
}

/** Sends only the two observed POSTs in an existing, verified browser page. It never launches a browser. */
export class OndaBrowserSessionTransport implements TwoHourTransport {
  private preparedHeaders?: CurrentCheckoutHeaders;
  private preparedAt?: number;
  private preparation?: Promise<void>;
  constructor(private readonly page: Page, private readonly currentCheckoutHeaders: CurrentCheckoutHeadersProvider,
    private readonly captureCheckoutResponse?: CheckoutResponseCapture, private readonly contextHooks: CheckoutContextHooks = {},
    private readonly observer?: BrowserTransportObserver) {
    page.on?.('framenavigated',frame=>{
      if(frame===page.mainFrame()){
        this.preparedHeaders=undefined;
        this.preparedAt=undefined;
      }
    });
  }

  isForPage(page:Page):boolean{return this.page===page;}

  private observe(observation: BrowserTransportObservation): void {
    try { this.observer?.(observation); } catch { /* Observability cannot affect transport behavior. */ }
  }

  private async acquireCheckoutHeaders(): Promise<CurrentCheckoutHeaders> {
    const started = performance.now();
    this.observe({ event: 'SECURITY_PREPARATION_STARTED', securitySource: 'FRESH_ACQUISITION' });
    let settled = false, verificationShown = false;
    const acquisition = this.currentCheckoutHeaders().finally(() => { settled = true; });
    try {
      while (!settled) {
        await Promise.race([acquisition.then(() => undefined, () => undefined),
          new Promise<void>(resolve => setTimeout(resolve, 200))]);
        if (settled) break;
        const challengeVisible = await this.page.locator('iframe[src*="challenges.cloudflare.com"]:visible').count().then(count => count > 0).catch(() => false);
        if (challengeVisible && !verificationShown) {
          verificationShown = true;
          this.observe({ event: 'SECURITY_CHALLENGE_OBSERVED' });
          await this.contextHooks.onHumanVerificationRequired?.();
        }
      }
      const headers = await acquisition;
      if (verificationShown) {
        await this.contextHooks.onHumanVerificationCompleted?.();
        this.observe({ event: 'SECURITY_CHALLENGE_COMPLETED' });
      }
      this.observe({ event: 'SECURITY_PREPARATION_COMPLETED', securitySource: 'FRESH_ACQUISITION',
        durationMs: Math.max(0, Math.round(performance.now() - started)) });
      return headers;
    } catch (error) {
      this.observe({ event: 'SECURITY_PREPARATION_COMPLETED', securitySource: 'FRESH_ACQUISITION',
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        failureCategory: error instanceof CalendarFreeSecurityError && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
          ? error.code : 'SECURITY_CONTEXT_ACQUISITION_FAILED' });
      throw error;
    }
  }

  async prepareCheckoutContext(forceRefresh = false): Promise<void> {
    this.assertPage();
    if (process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT !== 'SUPERVISED_ONE_SHOT')
      throw new BrowserSessionTransportError('LIVE_SUBMISSION_DISABLED');
    // An armed run may acquire the genuine page context just before release.
    // Keep it only briefly and consume it once at checkout.
    if (!forceRefresh && this.preparedHeaders && this.preparedAt !== undefined && Date.now() - this.preparedAt >= 0 &&
      Date.now() - this.preparedAt <= 20_000) {
      this.observe({ event: 'SECURITY_PREPARATION_STARTED', securitySource: 'RECENT_CONTEXT_REUSE' });
      this.observe({ event: 'SECURITY_PREPARATION_COMPLETED', securitySource: 'RECENT_CONTEXT_REUSE', durationMs: 0 });
      return;
    }
    // The adaptive proof and proofless paths can ask the same E/F transport to
    // prewarm at nearly the same instant. Share one acquisition so concurrent
    // callers cannot overwrite each other's genuine page-bound token.
    if(this.preparation){
      const started=performance.now();
      this.observe({ event: 'SECURITY_PREPARATION_STARTED', securitySource: 'SHARED_ACQUISITION' });
      try { await this.preparation;
        this.observe({ event: 'SECURITY_PREPARATION_COMPLETED', securitySource: 'SHARED_ACQUISITION',
          durationMs: Math.max(0,Math.round(performance.now()-started)) });
      } catch (error) {
        this.observe({ event: 'SECURITY_PREPARATION_COMPLETED', securitySource: 'SHARED_ACQUISITION',
          durationMs: Math.max(0,Math.round(performance.now()-started)), failureCategory: 'SECURITY_CONTEXT_ACQUISITION_FAILED' });
        throw error;
      }
      if (forceRefresh) return this.prepareCheckoutContext(true);
      return;
    }
    const preparation=(async()=>{
      this.preparedHeaders = undefined;
      this.preparedAt = undefined;
      let current: CurrentCheckoutHeaders;
      try { current = await this.acquireCheckoutHeaders(); }
      catch (error) { throw securityContextError(error); }
      if (!usable(current?.turnstileToken) || !usable(current?.publicFingerprint))
        throw new BrowserSessionTransportError('CURRENT_CHECKOUT_HEADERS_INVALID');
      this.assertPage();
      this.preparedHeaders = current;
      this.preparedAt = Date.now();
    })();
    this.preparation=preparation;
    try{await preparation;}finally{if(this.preparation===preparation)this.preparation=undefined;}
  }

  private assertPage(): void {
    if (this.page.isClosed() || this.page.url() !== ONDA_URL) throw new BrowserSessionTransportError('ONDA_SESSION_PAGE_INVALID');
  }

  private async post(path: typeof SLOT_PATH | typeof CHECKOUT_PATH, body: unknown,
    extraHeaders?: Record<string, string>, bodyText?: string): Promise<unknown> {
    this.assertPage();
    const checkout = path === CHECKOUT_PATH;
    const networkStarted = performance.now();
    let requestObserved = false;
    const requestListener = (request: { method(): string; url(): string }) => {
      try {
        if (!checkout || requestObserved || request.method() !== 'POST' || new URL(request.url()).pathname !== CHECKOUT_PATH) return;
        requestObserved = true;
        this.observe({ event: 'CHECKOUT_HTTP_POST_INITIATED', initiationEvidence: 'PLAYWRIGHT_REQUEST_EVENT' });
      } catch { /* A malformed unrelated request is not diagnostic evidence. */ }
    };
    if (checkout) this.page.on?.('request', requestListener);
    let result: CheckoutHttpResponse;
    try {
      result = await this.page.evaluate(async ({ url, payload, text, headers }) => {
        const started = performance.now();
        const response = await fetch(url, { method: 'POST', credentials: 'same-origin', redirect: 'error',
          cache: 'no-store', headers: { 'Content-Type': 'application/json', ...headers },
          body: typeof text === 'string' ? text : JSON.stringify(payload) });
        const responseReceivedMs = performance.now() - started;
        const body = await response.text();
        return { status: response.status, contentType: response.headers.get('content-type') ?? '',
          server: response.headers.get('server') ?? '', cloudflareRay: response.headers.get('cf-ray') ?? '',
          cfMitigated: response.headers.get('cf-mitigated') ?? '',
          vercelId: response.headers.get('x-vercel-id') ?? '', requestId: response.headers.get('x-request-id') ?? '',
          serverTiming: response.headers.get('server-timing') ?? '', responseReceivedMs,
          responseCompletedMs: performance.now() - started, body };
      }, bodyText === undefined ? { url: `${ORIGIN}${path}`, payload: body, text: undefined, headers: extraHeaders ?? {} }
        : { url: `${ORIGIN}${path}`, payload: null, text: bodyText, headers: extraHeaders ?? {} });
    } catch {
      if (checkout) this.observe({ event: 'CHECKOUT_RESPONSE_COMPLETED',
        networkDurationMs: Math.max(0, Math.round(performance.now() - networkStarted)), dispatchState: 'UNKNOWN',
        failureCategory: 'ONDA_TRANSPORT_FAILED' });
      throw new BrowserSessionTransportError('ONDA_TRANSPORT_FAILED', true);
    } finally {
      if (checkout) this.page.off?.('request', requestListener);
    }
    const networkDurationMs = Math.max(0, Math.round(performance.now() - networkStarted));
    const diagnostic = result.status === 200 ? undefined : checkoutDiagnostic(result);
    if (checkout) this.observe({ event: 'CHECKOUT_RESPONSE_COMPLETED', networkDurationMs, statusCode: result.status,
      dispatchState: 'RESPONSE_CAPTURED', ...(diagnostic ? { failureCategory: 'ONDA_HTTP_STATUS_INVALID',
        errorHint: diagnostic.errorHint, responseSource: diagnostic.responseSource } : {}) });
    if (path === CHECKOUT_PATH && this.captureCheckoutResponse) {
      try { await this.captureCheckoutResponse(result); }
      catch { throw new BrowserSessionTransportError('CHECKOUT_RESPONSE_CAPTURE_FAILED', true); }
    }
    try { this.assertPage(); }
    catch { throw new BrowserSessionTransportError('ONDA_SESSION_DISCONNECTED_AFTER_DISPATCH', true); }
    if (diagnostic) throw new BrowserSessionTransportError('ONDA_HTTP_STATUS_INVALID', true,
      diagnostic, confirmedApplicationConflict(result));
    if (!result.contentType.toLowerCase().includes('application/json')) throw new BrowserSessionTransportError('ONDA_CONTENT_TYPE_INVALID', true);
    if (Buffer.byteLength(result.body, 'utf8') > MAX_RESPONSE_BYTES) throw new BrowserSessionTransportError('ONDA_RESPONSE_TOO_LARGE', true);
    try { return JSON.parse(result.body) as unknown; }
    catch { throw new BrowserSessionTransportError('ONDA_RESPONSE_JSON_INVALID', true); }
  }

  async checkSlot(request: SlotCheckRequest): Promise<unknown> {
    this.assertPage();
    // No checkout-only headers are added to this observed request. Browser cookies follow same-origin policy.
    const started=performance.now();
    this.observe({event:'SLOT_CHECK_STARTED'});
    try {
      const result=await this.post(SLOT_PATH, request);
      const record=result!==null&&typeof result==='object'&&!Array.isArray(result)?result as Record<string,unknown>:undefined;
      this.observe({event:'SLOT_CHECK_COMPLETED',durationMs:Math.max(0,Math.round(performance.now()-started)),
        resultCategory:record?.success===true?'SUCCESS':'REJECTED',success:record?.success===true,
        ...(typeof record?.isAvailable==='boolean'?{isAvailable:record.isAvailable}:{})});
      return result;
    } catch (error) {
      this.observe({event:'SLOT_CHECK_COMPLETED',durationMs:Math.max(0,Math.round(performance.now()-started)),
        resultCategory:'FAILED',success:false,failureCategory:error instanceof BrowserSessionTransportError?error.code:'SLOT_CHECK_FAILED'});
      throw error;
    }
  }

  async publicCheckout(request: TwoHourCheckoutRequest, permit: SubmissionPermit): Promise<unknown> {
    return this.submitCheckout(request,permit);
  }

  async publicCheckoutProofless(request: ProoflessCheckoutRequest, permit: SubmissionPermit, options: CheckoutDispatchOptions = {}): Promise<unknown> {
    if(request.items.some(item=>item.availabilityProof!==null))throw new BrowserSessionTransportError('DIRECT_PROOFLESS_SHAPE_INVALID');
    return this.submitCheckout(request,permit,options);
  }

  /** Age of the prewarmed context, or undefined when none is held (never acquired, consumed, or cleared by navigation). */
  preparedContextAgeMs(now = Date.now()): number | undefined {
    return this.preparedHeaders && this.preparedAt !== undefined ? now - this.preparedAt : undefined;
  }

  private async submitCheckout(request: TwoHourCheckoutRequest | ProoflessCheckoutRequest, permit: SubmissionPermit,
    options: CheckoutDispatchOptions = {}): Promise<unknown> {
    this.assertPage();
    if (process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT !== 'SUPERVISED_ONE_SHOT')
      throw new BrowserSessionTransportError('LIVE_SUBMISSION_DISABLED');
    let current = this.preparedHeaders;
    let preparedAt = this.preparedAt;
    const preparedContextAgeMs = preparedAt === undefined ? -1 : Date.now() - preparedAt;
    this.observe({ event: 'CHECKOUT_FUNCTION_ENTERED', preparedContextAgeMs,
      securitySource: current ? 'PREPARED_CONTEXT' : 'CHECKOUT_ACQUISITION' });
    this.preparedHeaders = undefined;
    this.preparedAt = undefined;
    const securitySource = current ? 'PREPARED_CONTEXT' as const : 'CHECKOUT_ACQUISITION' as const;
    // Provably unsent: a release dispatch never acquires security after its window check.
    if (!current && options.requirePreparedContext) throw new BrowserSessionTransportError('PREPARED_SECURITY_CONTEXT_REQUIRED');
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
    const armed = armedRequests.get(request);
    consumeSubmissionPermit(permit, armed?.key ?? requestKey(request));
    // Last gate before the network: a late dispatch stops here, still provably unsent.
    options.beforePost?.();
    this.observe({ event: 'CHECKOUT_PRE_POST', preparedContextAgeMs: Math.max(0, Date.now() - preparedAt), securitySource });
    // The header values are ephemeral and never logged or stored by this adapter.
    return this.post(CHECKOUT_PATH, request, {
      'X-Turnstile-Token': current.turnstileToken,
      'X-Onda-Public-Fingerprint': current.publicFingerprint,
    }, armed?.body);
  }
}
