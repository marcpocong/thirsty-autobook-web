import { parseAvailability } from './availability-parser.js';
import type { AvailabilityProvider } from './availability-provider.js';
import type { AvailabilityEnvelope, AvailabilityQuery } from './types.js';

// Confirmed historical facility ID; the live provider does not import Chrome bot code.
export const THIRSTY_PICKLE_FACILITY_ID = '5f8786bd-dc61-4509-b893-74cda8f783f7';
const ORIGIN = 'https://app.onda.fit';
const MAX_RESPONSE_BYTES = 4_000_000;
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export class LiveAvailabilityError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'LiveAvailabilityError'; }
}

export interface LiveAvailabilityOptions {
  fetcher?: typeof fetch;
  clock?: () => Date;
  timeoutMs?: number;
  maximumAgeMs?: number;
  allowIncompleteRange?: boolean;
}

/** Read-only GET adapter. It does not carry customer credentials or reservation state. */
export class OndaLiveAvailabilityProvider implements AvailabilityProvider {
  readonly kind = 'onda-live-availability' as const;
  private readonly fetcher: typeof fetch;
  private readonly clock: () => Date;
  private readonly timeoutMs: number;
  private readonly maximumAgeMs: number;
  private readonly allowIncompleteRange: boolean;

  constructor(options: LiveAvailabilityOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.clock = options.clock ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maximumAgeMs = options.maximumAgeMs ?? 15_000;
    this.allowIncompleteRange = options.allowIncompleteRange ?? false;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0 || !Number.isFinite(this.maximumAgeMs) || this.maximumAgeMs < 0)
      throw new LiveAvailabilityError('AVAILABILITY_OPTIONS_INVALID');
  }

  async getAvailability(query: AvailabilityQuery): Promise<AvailabilityEnvelope> {
    if (!validDate(query.startDate) || !validDate(query.endDate) || query.endDate < query.startDate)
      throw new LiveAvailabilityError('AVAILABILITY_QUERY_INVALID');
    const params = new URLSearchParams({ startDate: query.startDate, endDate: query.endDate, duration: '60', includeSchedule: 'true' });
    const url = `${ORIGIN}/api/public/facilities/${THIRSTY_PICKLE_FACILITY_ID}/date-availability?${params}`;
    let response: Response;
    try {
      response = await this.fetcher(url, { method: 'GET', redirect: 'error', credentials: 'omit',
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch { throw new LiveAvailabilityError('AVAILABILITY_TRANSPORT_FAILED'); }
    if (!response.ok) throw new LiveAvailabilityError(response.status === 429 ? 'AVAILABILITY_RATE_LIMITED' : 'AVAILABILITY_HTTP_FAILED');
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new LiveAvailabilityError('AVAILABILITY_CONTENT_TYPE_INVALID');
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new LiveAvailabilityError('AVAILABILITY_RESPONSE_TOO_LARGE');
    let body: string;
    try { body = await response.text(); }
    catch { throw new LiveAvailabilityError('AVAILABILITY_BODY_FAILED'); }
    if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) throw new LiveAvailabilityError('AVAILABILITY_RESPONSE_TOO_LARGE');
    let raw: unknown;
    try { raw = JSON.parse(body) as unknown; }
    catch { throw new LiveAvailabilityError('AVAILABILITY_JSON_INVALID'); }
    const capturedAt = this.clock().toISOString();
    const envelope: AvailabilityEnvelope = { raw, capturedAt, fixtureKind: 'live', label: 'ONDA LIVE READ-ONLY AVAILABILITY' };
    // Validate before handing data to the coordinator. The coordinator rechecks freshness.
    parseAvailability(raw, { ...query, capturedAt, fixtureKind: 'live', label: envelope.label,
      now: this.clock(), maximumAgeMs: this.maximumAgeMs, requireCompleteRange:!this.allowIncompleteRange });
    return envelope;
  }
}
