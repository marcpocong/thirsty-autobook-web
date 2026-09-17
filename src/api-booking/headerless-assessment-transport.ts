import type { Page } from 'playwright';
import { ONDA_URL } from '../config.js';
import { consumeSubmissionPermit, DurableSubmissionJournal, type SubmissionPermit } from './durable-submission-journal.js';
import { OndaBrowserSessionTransport } from './browser-session-transport.js';
import { SubmissionDispatchError } from './submission-errors.js';
import { checkoutDiagnostic } from './checkout-diagnostics.js';
import type { SlotCheckRequest, TwoHourCheckoutRequest, TwoHourTransport } from './two-hour-reservation.js';

export interface ApprovedHeaderlessAttempt {
  readonly environment: 'production';
  readonly facilityId: string;
  readonly spaceId: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly maximumAmount: number;
  readonly clientId: string;
  readonly customerId: string;
  readonly approvalReference: string;
}

export interface SanitizedAssessmentResponse {
  status: number;
  json: boolean;
  success?: boolean;
  bookingCount?: number;
  sessionCount?: number;
  pendingTransaction?: boolean;
  challengeHint?: boolean;
}

export class HeaderlessAssessmentError extends SubmissionDispatchError {
  constructor(code: string, dispatched = false, diagnostic?: SubmissionDispatchError['diagnostic']) {
    super(code, dispatched, diagnostic); this.name = 'HeaderlessAssessmentError'; }
}

/** Isolated, single-attempt transport. It is never used by the desktop or production booking engines. */
export class HeaderlessAssessmentTransport implements TwoHourTransport {
  private readonly slotTransport: OndaBrowserSessionTransport;
  private attempted = false;
  constructor(private readonly page: Page, private readonly approved: ApprovedHeaderlessAttempt,
    private readonly observe: (result: SanitizedAssessmentResponse) => void) {
    this.slotTransport = new OndaBrowserSessionTransport(page, async () => { throw Error('ASSESSMENT_HEADER_PROVIDER_DISABLED'); });
  }

  checkSlot(request: SlotCheckRequest): Promise<unknown> {
    if (request.facilityId !== this.approved.facilityId || request.spaceId !== this.approved.spaceId ||
      request.date !== this.approved.date || request.clientId !== this.approved.clientId)
      throw new HeaderlessAssessmentError('ASSESSMENT_SLOT_MISMATCH');
    return this.slotTransport.checkSlot(request);
  }

  async publicCheckout(request: TwoHourCheckoutRequest, permit: SubmissionPermit): Promise<unknown> {
    if (this.attempted) throw new HeaderlessAssessmentError('ASSESSMENT_ALREADY_ATTEMPTED');
    if (process.env.ONDA_HEADERLESS_ASSESSMENT !== 'APPROVED_ONE_SHOT' ||
      process.env.ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT !== 'SUPERVISED_ONE_SHOT')
      throw new HeaderlessAssessmentError('ASSESSMENT_GATE_CLOSED');
    if (this.page.isClosed() || this.page.url() !== ONDA_URL || this.approved.environment !== 'production')
      throw new HeaderlessAssessmentError('ASSESSMENT_PAGE_INVALID');
    const [first, second] = request.items;
    if (request.items.length !== 2 || request.facilityId !== this.approved.facilityId ||
      request.customerId !== this.approved.customerId || request.clientId !== this.approved.clientId ||
      first.spaceId !== this.approved.spaceId ||
      second.spaceId !== this.approved.spaceId || first.date !== this.approved.date || second.date !== this.approved.date ||
      first.startTime !== this.approved.startTime || second.endTime !== this.approved.endTime ||
      first.endTime !== second.startTime ||
      request.items.reduce((sum, item) => sum + item.chargedAmount, 0) > this.approved.maximumAmount ||
      !Number.isFinite(this.approved.maximumAmount) || !this.approved.approvalReference.trim())
      throw new HeaderlessAssessmentError('ASSESSMENT_PLAN_MISMATCH');
    const key = DurableSubmissionJournal.key(request.facilityId, first.spaceId, first.date, first.startTime, second.endTime);
    consumeSubmissionPermit(permit, key);
    this.attempted = true;
    let result: { status: number; contentType: string; server: string; cloudflareRay: string; body: string };
    try {
      result = await this.page.evaluate(async ({ payload }) => {
        const response = await fetch('https://app.onda.fit/api/bookings/public-checkout', {
          method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
        });
        return { status: response.status, contentType: response.headers.get('content-type') ?? '',
          server: response.headers.get('server') ?? '', cloudflareRay: response.headers.get('cf-ray') ?? '',
          body: await response.text() };
      }, { payload: request });
    } catch { throw new HeaderlessAssessmentError('ASSESSMENT_TRANSPORT_UNKNOWN', true); }
    if (this.page.isClosed() || this.page.url() !== ONDA_URL)
      throw new HeaderlessAssessmentError('ASSESSMENT_SESSION_UNKNOWN', true);
    const json = result.contentType.toLowerCase().includes('application/json');
    let parsed: unknown;
    if (json && Buffer.byteLength(result.body, 'utf8') <= 1_000_000) {
      try { parsed = JSON.parse(result.body) as unknown; } catch {/* malformed response */}
    }
    const value = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : undefined;
    try { this.observe({ status: result.status, json,
      challengeHint: /(?:turnstile|captcha|challenge)/i.test(result.body),
      ...(value ? { success: value.success === true,
        bookingCount: Array.isArray(value.bookings) ? value.bookings.length : undefined,
        sessionCount: Array.isArray(value.bookingSessions) ? value.bookingSessions.length : undefined,
        pendingTransaction: value.transaction !== null && typeof value.transaction === 'object' &&
          (value.transaction as Record<string, unknown>).status === 'pending' } : {}) }); } catch {/* passive */}
    const diagnostic = checkoutDiagnostic(result);
    if (result.status !== 200) throw new HeaderlessAssessmentError('ASSESSMENT_HTTP_REJECTED', true, diagnostic);
    if (!json) throw new HeaderlessAssessmentError('ASSESSMENT_CONTENT_TYPE_INVALID', true, diagnostic);
    if (Buffer.byteLength(result.body, 'utf8') > 1_000_000) throw new HeaderlessAssessmentError('ASSESSMENT_RESPONSE_TOO_LARGE', true, diagnostic);
    if (!value) throw new HeaderlessAssessmentError('ASSESSMENT_RESPONSE_JSON_INVALID', true, diagnostic);
    return value;
  }
}
