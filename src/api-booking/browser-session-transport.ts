import {calibrateRendererClockAdaptive,assertCalibrationUsable,type RendererClockCalibration} from './renderer-clock.js';
import type { Page } from 'playwright';
import { ONDA_URL } from '../config.js';
import { consumeSubmissionPermit, DurableSubmissionJournal, type SubmissionPermit } from './durable-submission-journal.js';
import type { SlotCheckRequest, TwoHourCheckoutRequest, TwoHourTransport } from './two-hour-reservation.js';
import type { ProoflessCheckoutRequest } from './proofless-checkout.js';
import { SubmissionDispatchError } from './submission-errors.js';
import { checkoutDiagnostic, type CheckoutDiagnostic } from './checkout-diagnostics.js';
import { CalendarFreeSecurityError } from './calendar-free-security-context.js';
import { responseEvidence, type ResponseEvidence } from './response-evidence.js';
import { armedRequestFor, checkoutRequestKey } from './armed-request.js';
import { RENDERER_ARMED_CHECKOUT, RENDERER_DISARM, type RendererArmedOutcome, type RendererFirePlan } from './renderer-dispatch.js';

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
  | { event: 'SECURITY_PREPARATION_COMPLETED'; securitySource: 'FRESH_ACQUISITION' | 'RECENT_CONTEXT_REUSE' | 'SHARED_ACQUISITION'; durationMs: number; failureCategory?: string;
      /** Fresh acquisitions: the most visible Cloudflare challenge frame seen on the page meanwhile, and which helper rejected. Observations, not a provider verdict. */
      challengeFrame?: 'none' | 'hidden' | 'visible'; failedHelper?: 'challenge' | 'fingerprint' }
  | { event: 'SECURITY_CHALLENGE_OBSERVED' | 'SECURITY_CHALLENGE_COMPLETED' }
  | { event: 'SLOT_CHECK_STARTED' }
  | { event: 'SLOT_CHECK_COMPLETED'; durationMs: number; resultCategory: string; success: boolean; isAvailable?: boolean; failureCategory?: string }
  | { event: 'CHECKOUT_FUNCTION_ENTERED'; preparedContextAgeMs: number; securitySource: 'PREPARED_CONTEXT' | 'CHECKOUT_ACQUISITION' }
  | { event: 'CHECKOUT_PRE_POST'; preparedContextAgeMs: number; securitySource: 'PREPARED_CONTEXT' | 'CHECKOUT_ACQUISITION' }
  | { event: 'CHECKOUT_HTTP_POST_INITIATED'; initiationEvidence: 'PLAYWRIGHT_REQUEST_EVENT' }
  /** EXPERIMENTAL renderer-resident dispatch: the exact request was handed to the page, which fires on its own clock. */
  | { event: 'RENDERER_DISPATCH_ARMED'; preparedContextAgeMs: number; calibrationUncertaintyMs: number }
  /** The page refused before fetch(): provably unsent. */
  | { event: 'RENDERER_DISPATCH_REFUSED'; failureCategory: string }
  | { event: 'CHECKOUT_RESPONSE_COMPLETED'; networkDurationMs: number; statusCode?: number; dispatchState: 'RESPONSE_CAPTURED' | 'UNKNOWN'; failureCategory?: string;
      /** Bounded categories from checkoutDiagnostic (never response text). */
      errorHint?: CheckoutDiagnostic['errorHint']; responseSource?: CheckoutDiagnostic['responseSource'];
      /** Body size and a 12-hex prefix of the sanitized shape fingerprint (rejections only), to tell response classes apart. */
      responseBytes?: number; bodyShape?: string;
      /** Renderer performance.now() marks of this POST (see CheckoutRendererTiming); mapped to trusted time after dispatch. */
      renderer?: CheckoutRendererTiming;
      /** Chrome's own wall-clock stamp of the request start (CDP wallTime via Playwright, available once the response arrived). */
      browserRequestWallMs?: number };
export type BrowserTransportObserver = (observation: BrowserTransportObservation) => void;

/** Values must come from the current normal site flow immediately before checkout; this transport cannot create them. */
export type CurrentCheckoutHeadersProvider = () => Promise<CurrentCheckoutHeaders>;
/**
 * performance.now() marks taken inside the page (renderer clock, ms since the document's timeOrigin):
 * entry into the evaluate function, the instant just before fetch() is called, response headers, and body read.
 * They cost one clock read before fetch() and are returned with the response, never on the path to it.
 */
export interface CheckoutRendererTiming { timeOrigin: number; enteredAt: number; fetchAt: number; headersAt: number; completedAt: number;
  resource?:{startTime:number;fetchStart:number;requestStart:number;responseStart:number;responseEnd:number;workerStart:number;nextHopProtocol:string};
  /** Renderer-resident dispatch only: when the page accepted the arm command and when it called fetch(). */
  armedAt?: number; firedAt?: number }
export interface CheckoutHttpResponse { status: number; contentType: string; server: string;
  vercelId?: string; requestId?: string; serverTiming?: string; responseReceivedMs?: number; responseCompletedMs?: number;
  cloudflareRay: string; cfMitigated: string; body: string;
  /** Allowlisted response headers read in the page (values validated again before anything is stored). */
  headers?: Record<string, string>;
  renderer?: CheckoutRendererTiming;
  /** Sanitized structure-first evidence for a non-200 checkout response (never the body text). */
  evidence?: ResponseEvidence }
export type CheckoutResponseCapture = (response: CheckoutHttpResponse) => Promise<void>;
/** Release-dispatch guards. A scheduled release must not spend seconds acquiring
 * security after its window check, so it can require the prewarmed context and
 * re-check the window as the very last step before the POST. */
export interface CheckoutDispatchOptions {
  requirePreparedContext?: boolean;
  /** Throws (for example SubmissionDispatchError with dispatched=false) to stop before the POST. */
  beforePost?: () => void;
  strictTiming?: {notBeforeNodeMs:number;notAfterNodeMs:number};
  /** In-memory safety signal before optional response persistence is deferred. */
  onResponseSafety?:(raw:unknown,error?:SubmissionDispatchError)=>void;
  beforeResponseBookkeeping?:()=>Promise<void>;
}

export { armCheckoutRequest } from './armed-request.js';

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

/** Chrome's request-start wall stamp, read after the response (Playwright fills it from CDP wallTime); never before. */
function browserRequestWall(request: { timing?(): { startTime?: number } } | undefined): { browserRequestWallMs?: number } {
  try {
    const value = request?.timing?.().startTime;
    return typeof value === 'number' && Number.isFinite(value) && value > 1_000_000_000_000 ? { browserRequestWallMs: value } : {};
  } catch { return {}; }
}

/** Exact private values of one request (identity fields and the security header values), for response redaction. */
function privateRequestValues(body: unknown, headers: Record<string, string> | undefined): string[] {
  const values: string[] = [];
  const record = body !== null && typeof body === 'object' ? body as Record<string, unknown> : {};
  for (const key of ['clientId', 'customerId', 'customerEmail', 'customerPhone', 'customerFirstName', 'customerLastName', 'userId']) {
    const value = record[key];
    if (typeof value === 'string') values.push(value);
  }
  const phone = typeof record.customerPhone === 'string' ? record.customerPhone.replace(/\D/g, '') : '';
  if (phone.length >= 10) values.push(phone, phone.replace(/^0/, ''), phone.replace(/^0/, '63'));
  const email = typeof record.customerEmail === 'string' ? record.customerEmail : '';
  if (email.includes('@')) values.push(email.split('@')[0]!);
  for (const value of Object.values(headers ?? {})) if (typeof value === 'string') values.push(value);
  return values.filter(value => value.trim().length >= 3);
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

/**
 * Onda error texts that deterministically reject the request's SHAPE before any booking work. Observed:
 * 2026-09-29, 28 × HTTP 400, 56-byte JSON `{"success":false,"error":"Invalid booking session time"}` when the
 * 23:00 hour was sent ending "24:00"; no booking, hold or transaction was created.
 */
export const PAYLOAD_REJECTION_ERRORS: ReadonlySet<string> = new Set(['Invalid booking session time']);
/**
 * A conclusive payload rejection: HTTP 400 JSON whose body is exactly a known payload error with success=false
 * and no booking, session or transaction field. Anything else (other 400 texts, extra fields, HTML, a large
 * body) stays generic and therefore UNKNOWN, as before.
 */
export function isPayloadRejection(result: Pick<CheckoutHttpResponse, 'status' | 'contentType' | 'body'>): boolean {
  if (result.status !== 400 || !result.contentType.toLowerCase().includes('application/json') || Buffer.byteLength(result.body, 'utf8') > 1024) return false;
  try {
    const value = JSON.parse(result.body) as Record<string, unknown>;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const error = typeof value.error === 'string' ? value.error.trim().replace(/\.$/, '') : '';
    return value.success === false && PAYLOAD_REJECTION_ERRORS.has(error) &&
      !['bookings', 'bookingSessions', 'transaction', 'booking', 'data'].some(key => Object.hasOwn(value, key));
  } catch { return false; }
}

/** Sends only the two observed POSTs in an existing, verified browser page. It never launches a browser. */
export class OndaBrowserSessionTransport implements TwoHourTransport {
  private strictCalibration?:RendererClockCalibration;
  /** Preparation only: map the already existing page clock; no calibration at dispatch. */
  async prepareStrictTiming():Promise<void>{
    this.assertPage();this.strictCalibration=await calibrateRendererClockAdaptive(this.page,{targetUncertaintyMs:1.5,maxSamples:32});
    assertCalibrationUsable(this.strictCalibration,performance.now(),{maxAgeMs:120_000,maxUncertaintyMs:2});
  }
  private preparedHeaders?: CurrentCheckoutHeaders;
  private preparedAt?: number;
  private preparation?: Promise<void>;
  constructor(private readonly page: Page, private readonly currentCheckoutHeaders: CurrentCheckoutHeadersProvider,
    private readonly captureCheckoutResponse?: CheckoutResponseCapture, private readonly contextHooks: CheckoutContextHooks = {},
    private readonly observer?: BrowserTransportObserver) {
    page.on?.('framenavigated',frame=>{
      if(frame===page.mainFrame()){
        this.strictCalibration=undefined;
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
    // Seen while polling (2026-10-03/10-18 failures took 36-60 s with no visible challenge): a frame Onda rendered but
    // did not display means verification waited where nobody could answer it. Observation only; never touched.
    let challengeFrame: 'none' | 'hidden' | 'visible' = 'none';
    const acquisition = this.currentCheckoutHeaders().finally(() => { settled = true; });
    try {
      while (!settled) {
        await Promise.race([acquisition.then(() => undefined, () => undefined),
          new Promise<void>(resolve => setTimeout(resolve, 200))]);
        if (settled) break;
        const challengeVisible = await this.page.locator('iframe[src*="challenges.cloudflare.com"]:visible').count().then(count => count > 0).catch(() => false);
        if (challengeVisible) challengeFrame = 'visible';
        else if (challengeFrame === 'none' && await this.page.locator('iframe[src*="challenges.cloudflare.com"]').count().then(count => count > 0).catch(() => false))
          challengeFrame = 'hidden';
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
        durationMs: Math.max(0, Math.round(performance.now() - started)), challengeFrame });
      return headers;
    } catch (error) {
      const failedHelper = error instanceof CalendarFreeSecurityError ? error.detail.failedHelper : undefined;
      this.observe({ event: 'SECURITY_PREPARATION_COMPLETED', securitySource: 'FRESH_ACQUISITION',
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        failureCategory: error instanceof CalendarFreeSecurityError && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
          ? error.code : 'SECURITY_CONTEXT_ACQUISITION_FAILED', challengeFrame, ...(failedHelper ? { failedHelper } : {}) });
      throw error;
    }
  }

  /**
   * Pre-release security check: one genuine acquisition through exactly the path a run uses (same helpers, same
   * challenge prompt and observations), with the value discarded at once. It is never stored, so no checkout can use
   * it, and it needs no live-submission gate because nothing here can submit. Evidence for now, not for the release.
   */
  async checkSecurityReadiness(): Promise<void> {
    this.assertPage();
    if (this.preparation) throw new BrowserSessionTransportError('SECURITY_CHECK_BUSY');
    await this.acquireCheckoutHeaders();
  }

  /** `reuseWithinMs`: a prepared, unused context at most this old is kept (default 20 s; Rescue V2 allows up to 60 s, still inside the 120 s submit limit). */
  async prepareCheckoutContext(forceRefresh = false, reuseWithinMs = 20_000): Promise<void> {
    this.assertPage();
    if (process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT !== 'SUPERVISED_ONE_SHOT')
      throw new BrowserSessionTransportError('LIVE_SUBMISSION_DISABLED');
    // An armed run may acquire the genuine page context just before release.
    // Keep it only briefly and consume it once at checkout.
    if (!forceRefresh && this.preparedHeaders && this.preparedAt !== undefined && Date.now() - this.preparedAt >= 0 &&
      Date.now() - this.preparedAt <= Math.min(reuseWithinMs, 90_000)) {
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
    extraHeaders?: Record<string, string>, bodyText?: string, rendererPlan?: RendererFirePlan, strictTiming?:{notBeforeRendererMs:number;notAfterRendererMs:number}, lifecycle:Pick<CheckoutDispatchOptions,'onResponseSafety'|'beforeResponseBookkeeping'>={}): Promise<unknown> {
    this.assertPage();
    const checkout = path === CHECKOUT_PATH;
    const networkStarted = performance.now();
    let requestObserved = false;
    let observedRequest: { timing?(): { startTime?: number } } | undefined;
    const requestListener = (request: { method(): string; url(): string; timing?(): { startTime?: number } }) => {
      try {
        if (!checkout || requestObserved || request.method() !== 'POST' || new URL(request.url()).pathname !== CHECKOUT_PATH) return;
        requestObserved = true;
        observedRequest = request;
        this.observe({ event: 'CHECKOUT_HTTP_POST_INITIATED', initiationEvidence: 'PLAYWRIGHT_REQUEST_EVENT' });
      } catch { /* A malformed unrelated request is not diagnostic evidence. */ }
    };
    if (checkout) this.page.on?.('request', requestListener);
    let result!: CheckoutHttpResponse;
    let refused: string | undefined;
    try {
      if (rendererPlan) {
        // EXPERIMENTAL: the page fires on its own calibrated clock (renderer-dispatch.ts). A refusal is provably unsent.
        if (!checkout || typeof bodyText !== 'string') throw new BrowserSessionTransportError('RENDERER_DISPATCH_REQUIRES_ARMED_CHECKOUT');
        const outcome: RendererArmedOutcome = await this.page.evaluate(RENDERER_ARMED_CHECKOUT,
          { ...rendererPlan, url: `${ORIGIN}${path}`, text: bodyText, headers: extraHeaders ?? {} });
        if ('refused' in outcome) refused = typeof outcome.refused === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(outcome.refused) ? outcome.refused : 'RENDERER_DISPATCH_REFUSED';
        else { const { fired: _fired, ...response } = outcome; result = response; }
      } else { const outcome=await this.page.evaluate(async ({ url, payload, text, headers, strictTiming }) => {
        const enteredAt = performance.now();
        const init: RequestInit = { method: 'POST', credentials: 'same-origin', redirect: 'error',
          cache: 'no-store', headers: { 'Content-Type': 'application/json', ...headers },
          body: typeof text === 'string' ? text : JSON.stringify(payload) };
        const started = performance.now();
        if(strictTiming){
          if(started<strictTiming.notBeforeRendererMs)return {refused:'DIRECT_RELEASE_NOT_REACHED'};
          if(started>strictTiming.notAfterRendererMs)return {refused:'SHOTGUN_TRIGGER_MISSED'};
        }
        const response = await fetch(url, init);
        const headersAt = performance.now();
        const body = await response.text();
        const completedAt = performance.now();
        // Post-response only: independent renderer-origin resource timing. No URL,
        // headers or payload retained, and no Network.enable work before dispatch.
        const resource=performance.getEntriesByName(url,'resource').filter(entry=>entry.startTime>=started-1).at(-1) as PerformanceResourceTiming|undefined;
        // Read after the response only: provider diagnostics (validated again in Node before anything is stored).
        const kept: Record<string, string> = {};
        for (const name of ['content-length', 'date', 'age', 'cache-control', 'x-vercel-cache', 'x-matched-path', 'retry-after', 'x-ratelimit-limit',
          'x-ratelimit-remaining', 'x-ratelimit-reset', 'ratelimit', 'ratelimit-policy', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'x-powered-by', 'via']) {
          const value = response.headers.get(name);
          if (value !== null) kept[name] = value;
        }
        return { status: response.status, contentType: response.headers.get('content-type') ?? '',
          server: response.headers.get('server') ?? '', cloudflareRay: response.headers.get('cf-ray') ?? '',
          cfMitigated: response.headers.get('cf-mitigated') ?? '',
          vercelId: response.headers.get('x-vercel-id') ?? '', requestId: response.headers.get('x-request-id') ?? '',
          serverTiming: response.headers.get('server-timing') ?? '', responseReceivedMs: headersAt - started,
          responseCompletedMs: completedAt - started, body, headers: kept,
          renderer: { timeOrigin: performance.timeOrigin, enteredAt, fetchAt: started, headersAt, completedAt,
            ...(resource?{resource:{startTime:resource.startTime,fetchStart:resource.fetchStart,requestStart:resource.requestStart,
              responseStart:resource.responseStart,responseEnd:resource.responseEnd,workerStart:resource.workerStart,nextHopProtocol:resource.nextHopProtocol}}:{}) } };
      }, bodyText === undefined ? { url: `${ORIGIN}${path}`, payload: body, text: undefined, headers: extraHeaders ?? {},strictTiming }
        : { url: `${ORIGIN}${path}`, payload: null, text: bodyText, headers: extraHeaders ?? {},strictTiming });
        if('refused' in outcome)refused=outcome.refused;else result=outcome;
      }
    } catch (error) {
      if (error instanceof BrowserSessionTransportError && !error.dispatched) throw error;
      if(checkout){lifecycle.onResponseSafety?.(undefined,new BrowserSessionTransportError('ONDA_TRANSPORT_FAILED',true));await lifecycle.beforeResponseBookkeeping?.();}
      if (checkout) this.observe({ event: 'CHECKOUT_RESPONSE_COMPLETED',
        networkDurationMs: Math.max(0, Math.round(performance.now() - networkStarted)), dispatchState: 'UNKNOWN',
        failureCategory: 'ONDA_TRANSPORT_FAILED' });
      throw new BrowserSessionTransportError('ONDA_TRANSPORT_FAILED', true);
    } finally {
      if (checkout) this.page.off?.('request', requestListener);
    }
    if (refused !== undefined) {
      // The page returned before calling fetch(): nothing left this browser.
      this.observe({ event: 'RENDERER_DISPATCH_REFUSED', failureCategory: refused });
      throw new BrowserSessionTransportError(refused, false);
    }
    const networkDurationMs = Math.max(0, Math.round(performance.now() - networkStarted));
    if(checkout && lifecycle.onResponseSafety){
      let raw:unknown;try{if(result.status===200 && result.body.length<=MAX_RESPONSE_BYTES)raw=JSON.parse(result.body);}catch{}
      // Preserve this bounded signal before bookkeeping is deferred to T+1s.
      const paymentInProgress=result.status===409 && /(?:payment|checkout).*(?:already|in progress)|(?:already|existing).*(?:payment|checkout)/i.test(result.body.slice(0,4096));
      lifecycle.onResponseSafety(raw,result.status===200?undefined:new BrowserSessionTransportError('ONDA_HTTP_STATUS_INVALID',true,
        {status:result.status,category:'http-rejection',contentKind:'json',responseSource:'application',errorHint:paymentInProgress?'payment-in-progress':'other'},isPayloadRejection(result)||confirmedApplicationConflict(result)));
    }
    await lifecycle.beforeResponseBookkeeping?.();
    const diagnostic = result.status === 200 ? undefined : checkoutDiagnostic(result);
    const payloadRejected = checkout && diagnostic !== undefined && isPayloadRejection(result);
    // A rejection keeps structure-first evidence (never text); private request values are redacted exactly.
    if (checkout && diagnostic) result.evidence = responseEvidence({ status: result.status, contentType: result.contentType, body: result.body,
      headers: { ...(result.headers ?? {}), server: result.server, 'x-vercel-id': result.vercelId, 'x-request-id': result.requestId,
        'server-timing': result.serverTiming, 'cf-ray': result.cloudflareRay, 'cf-mitigated': result.cfMitigated } }, privateRequestValues(body, extraHeaders));
    if (checkout) this.observe({ event: 'CHECKOUT_RESPONSE_COMPLETED', networkDurationMs, statusCode: result.status,
      dispatchState: 'RESPONSE_CAPTURED', ...(diagnostic ? { failureCategory: payloadRejected ? 'ONDA_PAYLOAD_REJECTED' : 'ONDA_HTTP_STATUS_INVALID',
        errorHint: diagnostic.errorHint, responseSource: diagnostic.responseSource } : {}),
      ...(typeof result.body === 'string' ? { responseBytes: Buffer.byteLength(result.body, 'utf8') } : {}),
      ...(result.evidence?.body.shapeFingerprint ? { bodyShape: result.evidence.body.shapeFingerprint.slice(0, 12) } : {}),
      ...(result.renderer ? { renderer: result.renderer } : {}), ...browserRequestWall(observedRequest) });
    if (path === CHECKOUT_PATH && this.captureCheckoutResponse) {
      try { await this.captureCheckoutResponse(result); }
      catch { throw new BrowserSessionTransportError('CHECKOUT_RESPONSE_CAPTURE_FAILED', true); }
    }
    try { this.assertPage(); }
    catch { throw new BrowserSessionTransportError('ONDA_SESSION_DISCONNECTED_AFTER_DISPATCH', true); }
    // A known payload rejection is conclusive (nothing was created) but distinct from an availability conflict.
    if (diagnostic) throw new BrowserSessionTransportError(payloadRejected ? 'ONDA_PAYLOAD_REJECTED' : 'ONDA_HTTP_STATUS_INVALID', true,
      diagnostic, payloadRejected || confirmedApplicationConflict(result));
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

  /**
   * EXPERIMENTAL renderer-resident dispatch (renderer-dispatch.ts): sends the exact armed request to the page
   * before release; the page calls fetch() when its calibrated clock has certainly passed the release. Same
   * gates as the Node path (prepared context, freshness, page, one-shot permit), plus `beforeArm`, which must
   * prove the arm is happening before release and inside the arm lead. Requires a deep-frozen armed request.
   */
  async publicCheckoutProoflessRendererArmed(request: ProoflessCheckoutRequest, permit: SubmissionPermit, plan: RendererFirePlan,
    options: Pick<CheckoutDispatchOptions,'onResponseSafety'|'beforeResponseBookkeeping'> & { beforeArm?: () => void } = {}): Promise<unknown> {
    if (request.items.some(item => item.availabilityProof !== null)) throw new BrowserSessionTransportError('DIRECT_PROOFLESS_SHAPE_INVALID');
    this.assertPage();
    if (process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT !== 'SUPERVISED_ONE_SHOT') throw new BrowserSessionTransportError('LIVE_SUBMISSION_DISABLED');
    const armed = armedRequestFor(request);
    if (!armed) throw new BrowserSessionTransportError('RENDERER_DISPATCH_REQUIRES_ARMED_REQUEST');
    const current = this.preparedHeaders, preparedAt = this.preparedAt;
    this.observe({ event: 'CHECKOUT_FUNCTION_ENTERED', preparedContextAgeMs: preparedAt === undefined ? -1 : Date.now() - preparedAt,
      securitySource: current ? 'PREPARED_CONTEXT' : 'CHECKOUT_ACQUISITION' });
    this.preparedHeaders = undefined;
    this.preparedAt = undefined;
    // A release dispatch never acquires security after its window check.
    if (!current) throw new BrowserSessionTransportError('PREPARED_SECURITY_CONTEXT_REQUIRED');
    if (!usable(current.turnstileToken) || !usable(current.publicFingerprint)) throw new BrowserSessionTransportError('CURRENT_CHECKOUT_HEADERS_INVALID');
    if (preparedAt === undefined || !Number.isFinite(preparedAt) || Date.now() - preparedAt < 0 || Date.now() - preparedAt > 120_000)
      throw new BrowserSessionTransportError('CURRENT_CHECKOUT_HEADERS_STALE');
    if (plan.key !== armed.key) throw new BrowserSessionTransportError('RENDERER_DISPATCH_KEY_MISMATCH');
    this.assertPage();
    consumeSubmissionPermit(permit, armed.key);
    options.beforeArm?.();
    this.observe({ event: 'RENDERER_DISPATCH_ARMED', preparedContextAgeMs: Math.max(0, Date.now() - preparedAt), calibrationUncertaintyMs: plan.calibrationUncertaintyMs });
    return this.post(CHECKOUT_PATH, request, { 'X-Turnstile-Token': current.turnstileToken, 'X-Onda-Public-Fingerprint': current.publicFingerprint },
      armed.body, plan,undefined,options);
  }

  /** Best-effort disarm of an armed page (effective until the page's final ≤ 1 ms spin). Never throws. */
  async disarmRendererCheckout(key: string): Promise<'DISARMED' | 'ALREADY_FIRED' | 'NOT_ARMED' | 'UNREACHABLE'> {
    try { return await this.page.evaluate(RENDERER_DISARM, key); } catch { return 'UNREACHABLE'; }
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
    const armed = armedRequestFor(request);
    consumeSubmissionPermit(permit, armed?.key ?? checkoutRequestKey(request));
    // Last gate before the network: a late dispatch stops here, still provably unsent.
    let strictTiming:{notBeforeRendererMs:number;notAfterRendererMs:number}|undefined;
    if(options.strictTiming){
      try{assertCalibrationUsable(this.strictCalibration,performance.now(),{maxAgeMs:120_000,maxUncertaintyMs:2});}
      catch{throw new BrowserSessionTransportError('SHOTGUN_TIMING_CLOCK_NOT_READY');}
      const {notBeforeNodeMs,notAfterNodeMs}=options.strictTiming;
      if(!Number.isFinite(notBeforeNodeMs)||!Number.isFinite(notAfterNodeMs))throw new BrowserSessionTransportError('SHOTGUN_TIMING_CLOCK_NOT_READY');
      strictTiming={notBeforeRendererMs:notBeforeNodeMs-this.strictCalibration.offsetLowMs,notAfterRendererMs:notAfterNodeMs-this.strictCalibration.offsetHighMs};
    }
    if(options.strictTiming && !armed)throw new BrowserSessionTransportError('SHOTGUN_REQUEST_NOT_ARMED');
    options.beforePost?.();
    this.observe({ event: 'CHECKOUT_PRE_POST', preparedContextAgeMs: Math.max(0, Date.now() - preparedAt), securitySource });
    // The header values are ephemeral and never logged or stored by this adapter.
    return this.post(CHECKOUT_PATH, request, {
      'X-Turnstile-Token': current.turnstileToken,
      'X-Onda-Public-Fingerprint': current.publicFingerprint,
    }, armed?.body,undefined,strictTiming,options);
  }
}
