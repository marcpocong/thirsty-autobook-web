import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResponseEvidence } from './response-evidence.js';

/**
 * Passive provider/network trace for checkout POSTs.
 *
 * A second Chrome DevTools session on the worker's page. It is attached before
 * release with NO domain enabled, which costs nothing per request. The Network
 * domain is enabled for all traces together once every traced worker's POST has
 * been seen leaving its page (fallbacks: 50 ms after the first POST, and T+1.1 s),
 * so no DevTools command is sent while another POST may still be on its way to its
 * browser. Chrome still reports the in-flight request's response to a late-enabled
 * session: protocol, connection reuse, DNS/connect/TLS/send timing, header arrival
 * and body completion.
 *
 * It never intercepts, modifies, delays, duplicates or reroutes a request: the only
 * commands it sends are Network.enable and Network.disable (no Fetch domain, no
 * request interception, no extra headers, no cache override). It never listens to
 * request events, so request headers, cookies and the request body never reach it;
 * of each response it keeps a strict allowlist of headers and never the body or IPs.
 * Nothing is written until persist(), which the runner calls after every POST has
 * settled. If attaching, enabling or any handler fails, the trace is simply missing.
 */
export const CHECKOUT_TRACE_URL = 'https://app.onda.fit/api/bookings/public-checkout';
/** If some traced worker never reports its POST, every trace is enabled this long after the first one did. */
export const POST_ENABLE_FALLBACK_MS = 50;
/** The only DevTools commands this trace may send. */
export const PROVIDER_TRACE_COMMANDS: ReadonlySet<string> = new Set(['Network.enable', 'Network.disable']);

export interface CdpSessionLike {
  on(event: string, listener: (params: unknown) => void): unknown;
  off?(event: string, listener: (params: unknown) => void): unknown;
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  detach?(): Promise<void>;
}
export interface ProviderTraceContext { workerId: string; attemptId?: string; court?: number; startTime?: string; endTime?: string }
export interface ServerTimingEntry { name: string; durMs?: number }
/** Minimal response facts captured by the normal fetch path after dispatch, even if CDP misses the response. */
export interface ProviderResponseFallback {
  type: 'response-fallback'; workerId: string; attemptId?: string; candidateId?: string; wave?: 'WAVE_1' | 'WAVE_2' | 'RESCUE';
  status: number; contentType: string | null; server: string | null; cfRay: string | null;
  vercelId: string | null; requestId: string | null; serverTiming: ServerTimingEntry[] | null;
  responseReceivedMs: number | null; responseCompletedMs: number | null;
  /** Sanitized structure-first evidence of a rejected response (response-evidence.ts); never body text. */
  evidence?: ResponseEvidence;
}
export interface ProviderTraceRecord {
  type: 'provider-trace';
  workerId: string; attemptId?: string; target?: { court: number; startTime: string; endTime: string };
  method: 'POST'; path: '/api/bookings/public-checkout';
  /** Release-relative ms on the runner's trusted clock when Node received each DevTools event (includes delivery lag). */
  nodeObserved: { enabledOffsetMs: number | null; headersOffsetMs: number | null; finishedOffsetMs: number | null };
  /** Browser-monotonic ms after Chrome's network request start (ResourceTiming.requestTime), exact within Chrome. */
  browser: {
    dnsMs: number | null; connectMs: number | null; tlsMs: number | null; sendMs: number | null;
    /** Request sent → first response-header byte (includes provider processing and queueing). */
    waitMs: number | null;
    headersStartMs: number | null; headersEndMs: number | null;
    bodyCompleteMs: number | null; failedMs: number | null;
  };
  connection: { protocol: string | null; reused: boolean | null };
  response: {
    status: number | null; contentType: string | null; server: string | null; cfRay: string | null; cfMitigated: string | null;
    vercelId: string | null; requestId: string | null; vercelCache: string | null; ageS: number | null;
    serverTiming: ServerTimingEntry[] | null; encodedBytes: number | null;
  };
  failure: { errorText: string; canceled: boolean } | null;
  complete: boolean;
}
export type ProviderTraceStatus = 'attaching' | 'attached' | 'enabling' | 'active' | 'unavailable' | 'detached';

const finite = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const tenth = (value: number) => Math.round(value * 10) / 10;
const span = (start: unknown, end: unknown) => { const s = finite(start), e = finite(end); return s !== undefined && e !== undefined && s >= 0 && e >= s ? tenth(e - s) : null; };
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const safeCode = (error: unknown, fallback: string) => error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.message) ? error.message : fallback;

/** Strict per-header validation. Anything that does not match is dropped, never truncated or escaped. */
const HEADER_RULES: Record<string, RegExp> = {
  server: /^[A-Za-z0-9 ._/()-]{1,40}$/,
  'cf-ray': /^[a-f0-9]{8,32}(?:-[A-Za-z0-9]{2,8})?$/,
  'cf-mitigated': /^[a-z]{1,20}$/,
  'x-vercel-id': /^[a-z0-9]{2,8}(?:::[a-z0-9]{2,8}){0,3}::[a-z0-9]{3,12}-\d{10,16}-[a-f0-9]{6,20}$/,
  'x-request-id': /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/,
  'x-vercel-cache': /^[A-Z_]{2,16}$/,
  age: /^\d{1,7}$/,
};
export function sanitizeHeader(name: string, value: unknown): string | null {
  const rule = HEADER_RULES[name];
  return rule && typeof value === 'string' && rule.test(value.trim()) ? value.trim() : null;
}
/** Media type only: parameters (charset, boundaries) are dropped. */
export function sanitizeContentType(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const type = value.split(';')[0]!.trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]{1,40}\/[a-z0-9!#$&^_.+-]{1,60}$/.test(type) ? type : null;
}
/** Server-Timing names and durations only; descriptions (free text) are dropped. */
export function sanitizeServerTiming(value: unknown): ServerTimingEntry[] | null {
  if (typeof value !== 'string' || value.length > 2_000) return null;
  const entries: ServerTimingEntry[] = [];
  for (const part of value.split(',').slice(0, 8)) {
    const [rawName, ...params] = part.split(';').map(item => item.trim());
    if (!rawName || !/^[A-Za-z0-9_.-]{1,32}$/.test(rawName)) continue;
    const dur = params.map(param => /^dur=(\d{1,7}(?:\.\d{1,3})?)$/i.exec(param)?.[1]).find(Boolean);
    entries.push({ name: rawName, ...(dur !== undefined ? { durMs: Number(dur) } : {}) });
  }
  return entries.length ? entries : null;
}
export function sanitizeProtocol(value: unknown): string | null {
  return typeof value === 'string' && /^(?:h2|h3(?:-[a-z0-9]{1,8})?|http\/1\.[01]|http\/2|quic|spdy\/[0-9.]{1,4})$/i.test(value) ? value.toLowerCase() : null;
}
const sanitizeNetError = (value: unknown) => typeof value === 'string' && /^net::[A-Z0-9_]{1,60}$/.test(value) ? value : 'net::UNKNOWN';

interface Draft { requestTimeMs: number | null; record: ProviderTraceRecord }

export class CheckoutProviderTrace {
  status: ProviderTraceStatus = 'attaching';
  failureCode?: string;
  private session?: CdpSessionLike;
  private enabledAt: number | null = null;
  private readonly drafts = new Map<string, Draft>();
  private readonly order: ProviderTraceRecord[] = [];
  private readonly listeners: Array<[string, (params: unknown) => void]>;

  /**
   * @param offsetNow release-relative ms on the runner's trusted clock
   * @param url the exact checkout URL to trace (tests point it at a local server)
   */
  constructor(public context: ProviderTraceContext, private readonly offsetNow: () => number,
    private readonly url = CHECKOUT_TRACE_URL, private readonly maxRequests = 4) {
    this.listeners = [['Network.responseReceived', this.onResponse], ['Network.loadingFinished', this.onFinished], ['Network.loadingFailed', this.onFailed]];
  }

  /** Opens the session and registers listeners; enables nothing. Never throws; a failure leaves the trace unavailable. */
  async attach(openSession: () => Promise<CdpSessionLike>, timeoutMs = 5_000): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const attached = (async () => {
        const session = await openSession();
        // A late session after a timeout (or a detach) is closed, never used.
        if (this.status !== 'attaching') { await session.detach?.().catch(() => undefined); return; }
        this.session = session;
        for (const [event, listener] of this.listeners) session.on(event, listener);
      })();
      attached.catch(() => undefined);
      await Promise.race([attached, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('PROVIDER_TRACE_ATTACH_TIMEOUT')), timeoutMs); })]);
      if (this.status === 'attaching') this.status = 'attached';
      return this.status === 'attached';
    } catch (error) {
      await this.fail(error, 'PROVIDER_TRACE_ATTACH_FAILED');
      return false;
    } finally { if (timer) clearTimeout(timer); }
  }

  /**
   * Enables the Network domain once. Call only after this worker's POST has left (or after the
   * dispatch window): never on the path to a POST. Never throws.
   */
  async enable(): Promise<boolean> {
    if (this.status !== 'attached') return this.status === 'active';
    this.status = 'enabling';
    try {
      this.enabledAt = this.now();
      await this.command('Network.enable', { maxPostDataSize: 1, maxResourceBufferSize: 0, maxTotalBufferSize: 0 });
      if (this.status === 'enabling') this.status = 'active';
      return this.status === 'active';
    } catch (error) { await this.fail(error, 'PROVIDER_TRACE_ENABLE_FAILED'); return false; }
  }

  private async fail(error: unknown, fallback: string) {
    this.failureCode = safeCode(error, fallback);
    this.status = 'unavailable';
    await this.release();
  }

  private command(method: string, params?: Record<string, unknown>) {
    if (!PROVIDER_TRACE_COMMANDS.has(method) || !this.session) return Promise.reject(Error('PROVIDER_TRACE_COMMAND_REFUSED'));
    return this.session.send(method, params);
  }

  private async release() {
    const session = this.session, wasEnabled = this.enabledAt !== null;
    this.session = undefined;
    if (!session) return;
    for (const [event, listener] of this.listeners) try { session.off?.(event, listener); } catch { /* best-effort */ }
    if (wasEnabled) try { await session.send('Network.disable'); } catch { /* the page or browser may already be gone */ }
    try { await session.detach?.(); } catch { /* best-effort */ }
  }

  /** Stops listening. Safe to call more than once. */
  async detach(): Promise<void> {
    if (this.status !== 'unavailable') this.status = 'detached';
    await this.release();
  }

  /** Copies of the traced requests in response order; unfinished ones have complete=false. */
  records(): ProviderTraceRecord[] { return this.order.map(value => structuredClone(value)); }

  private now(): number | null { try { const value = this.offsetNow(); return Number.isFinite(value) ? tenth(value) : null; } catch { return null; } }

  private readonly onResponse = (params: unknown) => {
    try {
      if (this.status !== 'active' && this.status !== 'enabling') return;
      const event = record(params), response = record(event?.response), id = event?.requestId;
      // The checkout path only accepts POST; nothing else on this page is traced.
      if (!response || typeof id !== 'string' || this.drafts.has(id) || this.drafts.size >= this.maxRequests) return;
      const url = response.url;
      if (typeof url !== 'string' || (url !== this.url && !url.startsWith(`${this.url}?`))) return;
      const { workerId, attemptId, court, startTime, endTime } = this.context;
      const timing = record(response.timing), base = finite(timing?.requestTime);
      const at = (value: unknown) => { const ms = finite(value); return ms !== undefined && ms >= 0 ? tenth(ms) : null; };
      const headersStart = finite(timing?.receiveHeadersStart);
      // Allowlisted response headers only (case-insensitive lookup); everything else is ignored.
      const headers = new Map(Object.entries(record(response.headers) ?? {}).map(([name, value]) => [name.toLowerCase(), value]));
      const age = sanitizeHeader('age', headers.get('age'));
      const trace: ProviderTraceRecord = { type: 'provider-trace', workerId, ...(attemptId ? { attemptId } : {}),
        ...(court !== undefined && startTime && endTime ? { target: { court, startTime, endTime } } : {}),
        method: 'POST', path: '/api/bookings/public-checkout',
        nodeObserved: { enabledOffsetMs: this.enabledAt, headersOffsetMs: this.now(), finishedOffsetMs: null },
        browser: { dnsMs: span(timing?.dnsStart, timing?.dnsEnd), connectMs: span(timing?.connectStart, timing?.connectEnd), tlsMs: span(timing?.sslStart, timing?.sslEnd),
          sendMs: span(timing?.sendStart, timing?.sendEnd),
          waitMs: span(timing?.sendEnd, headersStart !== undefined && headersStart >= 0 ? headersStart : timing?.receiveHeadersEnd),
          headersStartMs: at(timing?.receiveHeadersStart), headersEndMs: at(timing?.receiveHeadersEnd), bodyCompleteMs: null, failedMs: null },
        connection: { protocol: sanitizeProtocol(response.protocol), reused: typeof response.connectionReused === 'boolean' ? response.connectionReused : null },
        response: { status: Number.isInteger(response.status) ? response.status as number : null, contentType: sanitizeContentType(headers.get('content-type')),
          server: sanitizeHeader('server', headers.get('server')), cfRay: sanitizeHeader('cf-ray', headers.get('cf-ray')),
          cfMitigated: sanitizeHeader('cf-mitigated', headers.get('cf-mitigated')), vercelId: sanitizeHeader('x-vercel-id', headers.get('x-vercel-id')),
          requestId: sanitizeHeader('x-request-id', headers.get('x-request-id')), vercelCache: sanitizeHeader('x-vercel-cache', headers.get('x-vercel-cache')),
          ageS: age === null ? null : Number(age), serverTiming: sanitizeServerTiming(headers.get('server-timing')), encodedBytes: null },
        failure: null, complete: false };
      this.drafts.set(id, { requestTimeMs: base === undefined ? null : base * 1000, record: trace });
      this.order.push(trace);
    } catch { /* telemetry only */ }
  };

  private readonly onFinished = (params: unknown) => {
    try {
      const event = record(params), draft = typeof event?.requestId === 'string' ? this.drafts.get(event.requestId) : undefined, ts = finite(event?.timestamp);
      if (!draft) return;
      draft.record.nodeObserved.finishedOffsetMs = this.now();
      draft.record.browser.bodyCompleteMs = ts === undefined || draft.requestTimeMs === null ? null : tenth(ts * 1000 - draft.requestTimeMs);
      const bytes = finite(event?.encodedDataLength);
      draft.record.response.encodedBytes = bytes !== undefined && bytes >= 0 ? Math.round(bytes) : null;
      draft.record.complete = true;
    } catch { /* telemetry only */ }
  };

  private readonly onFailed = (params: unknown) => {
    try {
      const event = record(params), draft = typeof event?.requestId === 'string' ? this.drafts.get(event.requestId) : undefined, ts = finite(event?.timestamp);
      if (!draft) return;
      draft.record.nodeObserved.finishedOffsetMs = this.now();
      draft.record.browser.failedMs = ts === undefined || draft.requestTimeMs === null ? null : tenth(ts * 1000 - draft.requestTimeMs);
      draft.record.failure = { errorText: sanitizeNetError(event?.errorText), canceled: event?.canceled === true };
      draft.record.complete = true;
    } catch { /* telemetry only */ }
  };
}

/**
 * One trace per dispatching worker. start() and postInitiated() are synchronous and never
 * throw; DevTools work runs in the background. persist() writes after the dispatch has settled.
 */
export class ProviderTraceSet {
  private readonly traces: CheckoutProviderTrace[] = [];
  private readonly responseFallbacks: ProviderResponseFallback[] = [];
  private readonly attaching: Array<Promise<boolean>> = [];
  private readonly enabling: Array<Promise<boolean>> = [];
  private readonly posted = new Set<string>();
  private persisted?: Promise<string | undefined>;

  constructor(readonly runId: string, readonly reference: 'release' | 'dispatch-start', public referenceMs: number | null,
    private readonly offsetNow: () => number, private readonly url = CHECKOUT_TRACE_URL) {}

  start(context: ProviderTraceContext, openSession: () => Promise<CdpSessionLike>): void {
    try {
      if (this.traces.some(trace => trace.context.workerId === context.workerId)) return;
      const trace = new CheckoutProviderTrace(context, this.offsetNow, this.url);
      this.traces.push(trace);
      this.attaching.push(trace.attach(openSession).catch(() => false));
    } catch { /* telemetry only */ }
  }

  /** Waits (bounded) for the background attaches; used only where no release deadline is running. */
  async ready(timeoutMs: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.allSettled(this.attaching), new Promise<void>(done => { timer = setTimeout(done, timeoutMs); })]);
    if (timer) clearTimeout(timer);
  }

  /**
   * A worker's POST has been seen leaving its page. Nothing is enabled while other workers' POSTs may
   * still be in flight to their browsers: once every traced worker's POST has been seen, all traces are
   * enabled on a later macrotask; if some never report, all are enabled 50 ms after the first POST
   * (a remote response cannot arrive that fast).
   */
  postInitiated(workerId: string): void {
    try {
      this.posted.add(workerId);
      if (this.traces.every(trace => this.posted.has(trace.context.workerId))) setImmediate(() => this.enableAll());
      else if (this.posted.size === 1) setTimeout(() => this.enableAll(), POST_ENABLE_FALLBACK_MS).unref?.();
    } catch { /* telemetry only */ }
  }

  /** Enables every attached trace (after the dispatch window, for a POST whose request event was not seen). */
  enableAll(): void { for (const trace of this.traces) this.enable(trace.context.workerId); }

  private enable(workerId: string) {
    try { const trace = this.traces.find(value => value.context.workerId === workerId); if (trace) this.enabling.push(trace.enable().catch(() => false)); }
    catch { /* telemetry only */ }
  }

  statuses() { return this.traces.map(trace => ({ workerId: trace.context.workerId, status: trace.status, ...(trace.failureCode ? { code: trace.failureCode } : {}) })); }
  /** Rebind a worker after its preceding attempt has settled (used for Rescue on that same page). */
  updateContext(workerId: string, context: ProviderTraceContext): void {
    try { const trace = this.traces.find(value => value.context.workerId === workerId); if (trace) trace.context = context; }
    catch { /* telemetry only */ }
  }
  records(): ProviderTraceRecord[] { return this.traces.flatMap(trace => trace.records()); }
  fallbacks(): ProviderResponseFallback[] { return this.responseFallbacks.map(value => structuredClone(value)); }
  captureFallback(context: Pick<ProviderResponseFallback, 'workerId' | 'attemptId' | 'candidateId' | 'wave'>,
    response: { status: number; contentType: string; server: string; cloudflareRay: string;
      vercelId?: string; requestId?: string; serverTiming?: string; responseReceivedMs?: number; responseCompletedMs?: number; evidence?: ResponseEvidence }): void {
    try {
      const timing = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 120_000 ? tenth(value) : null;
      if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) return;
      this.responseFallbacks.push({ type: 'response-fallback', workerId: context.workerId,
        ...(context.attemptId ? { attemptId: context.attemptId } : {}),
        ...(context.candidateId ? { candidateId: context.candidateId } : {}), ...(context.wave ? { wave: context.wave } : {}),
        status: response.status, contentType: sanitizeContentType(response.contentType), server: sanitizeHeader('server', response.server),
        cfRay: sanitizeHeader('cf-ray', response.cloudflareRay), vercelId: sanitizeHeader('x-vercel-id', response.vercelId),
        requestId: sanitizeHeader('x-request-id', response.requestId), serverTiming: sanitizeServerTiming(response.serverTiming),
        responseReceivedMs: timing(response.responseReceivedMs), responseCompletedMs: timing(response.responseCompletedMs),
        // Already sanitized by the transport; copied structurally so a later mutation cannot leak into the file.
        ...(response.evidence ? { evidence: structuredClone(response.evidence) } : {}) });
    } catch { /* telemetry must never affect checkout */ }
  }

  /** Detaches every session and writes provider-trace.ndjson once. Call only after every POST has settled. Never throws. */
  persist(directory: string): Promise<string | undefined> {
    this.persisted ??= (async () => {
      try {
        await Promise.allSettled([...this.attaching, ...this.enabling]);
        const statuses = this.statuses();
        await Promise.allSettled(this.traces.map(trace => trace.detach()));
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const path = join(directory, 'provider-trace.ndjson');
        const lines = [{ type: 'header', version: 2, runId: this.runId, reference: this.reference, referenceMs: this.referenceMs, traces: statuses,
          note: 'Passive DevTools Network events, enabled only after each POST had left. browser.* are browser-monotonic ms after Chrome\'s network request start; nodeObserved.* are ms after the reference on the runner trusted clock when Node received the event.' },
          ...this.records(), ...this.fallbacks()];
        const file = await open(path, 'wx', 0o600);
        try { await file.writeFile(lines.map(line => JSON.stringify(line)).join('\n') + '\n'); } finally { await file.close(); }
        return path;
      } catch { return undefined; }
    })();
    return this.persisted;
  }
}
