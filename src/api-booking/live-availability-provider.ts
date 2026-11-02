import { parseAvailability } from './availability-parser.js';
import type { AvailabilityProvider } from './availability-provider.js';
import type { AvailabilityEnvelope, AvailabilityQuery } from './types.js';
import { FACILITY_ID, type Wing } from '../court-registry.js';
import {AVAILABILITY_ORIGIN,availabilityRequestPath,availabilityFailureStatus} from './availability-contract.js';

// Confirmed historical facility ID; the live provider does not import Chrome bot code.
export const THIRSTY_PICKLE_FACILITY_ID = FACILITY_ID;
const MAX_RESPONSE_BYTES = 4_000_000;
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export class LiveAvailabilityError extends Error {
  get classification(){return availabilityFailureStatus(this);}
  constructor(readonly code: string, readonly httpStatus?: number, readonly requestSent?: boolean,
    readonly retryAfterMs?: number) { super(code); this.name = 'LiveAvailabilityError'; }
}

export interface LiveAvailabilityOptions {
  /** Scope validation only; Buko booking authorization is a separate boundary. */
  wing?: Wing;
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
  private readonly wing: Wing;

  constructor(options: LiveAvailabilityOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.clock = options.clock ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maximumAgeMs = options.maximumAgeMs ?? 15_000;
    this.allowIncompleteRange = options.allowIncompleteRange ?? false;
    this.wing = options.wing ?? 'MANGO';
    if (!['MANGO', 'BUKO'].includes(this.wing)) throw new LiveAvailabilityError('AVAILABILITY_WING_INVALID');
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0 || !Number.isFinite(this.maximumAgeMs) || this.maximumAgeMs < 0)
      throw new LiveAvailabilityError('AVAILABILITY_OPTIONS_INVALID');
  }

  async getAvailability(query: AvailabilityQuery): Promise<AvailabilityEnvelope> {
    if (!validDate(query.startDate) || !validDate(query.endDate) || query.endDate < query.startDate)
      throw new LiveAvailabilityError('AVAILABILITY_QUERY_INVALID');
    const url = AVAILABILITY_ORIGIN+availabilityRequestPath(query.startDate,query.endDate);
    let response: Response;
    try {
      response = await this.fetcher(url, { method: 'GET', redirect: 'error', credentials: 'omit',
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch(error) { if(error instanceof LiveAvailabilityError)throw error;throw new LiveAvailabilityError('AVAILABILITY_TRANSPORT_FAILED'); }
    const releaseBody=async()=>{try{await response.body?.cancel();}catch{throw new LiveAvailabilityError('AVAILABILITY_RESPONSE_CLOSE_FAILED',response.status,true);}};
    if (!response.ok) {
      // Release the failed response stream before returning the typed denial. Never retry it here.
      await releaseBody();
      const retry=response.headers.get('retry-after'),seconds=retry&&/^\d{1,6}$/.test(retry)?Number(retry):undefined;
      const retryDate=retry&&seconds===undefined?Date.parse(retry):NaN;
      throw new LiveAvailabilityError(response.status === 429 ? 'AVAILABILITY_RATE_LIMITED' : 'AVAILABILITY_HTTP_FAILED', response.status,true,
        seconds!==undefined?Math.max(1000,seconds*1000):Number.isFinite(retryDate)?Math.max(1000,retryDate-this.clock().getTime()):undefined);
    }
    const age=response.headers.get('age'),cache=response.headers.get('x-vercel-cache');
    if(age!==null&&!/^\d+$/.test(age)){
      await releaseBody();throw new LiveAvailabilityError('AVAILABILITY_CACHE_AGE_INVALID',response.status,true);
    }
    if(cache?.toUpperCase()==='STALE'||age!==null&&Number(age)*1000>this.maximumAgeMs){
      await releaseBody();throw new LiveAvailabilityError('AVAILABILITY_SNAPSHOT_STALE',response.status,true);
    }
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')){await releaseBody();throw new LiveAvailabilityError('AVAILABILITY_CONTENT_TYPE_INVALID');}
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
    parseAvailability(raw, { ...query, wing: this.wing, capturedAt, fixtureKind: 'live', label: envelope.label,
      now: this.clock(), maximumAgeMs: this.maximumAgeMs, requireCompleteRange:!this.allowIncompleteRange });
    return envelope;
  }
}
