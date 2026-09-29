import { performance } from 'node:perf_hooks';
import type { BrowserTransportObservation, CheckoutRendererTiming } from './browser-session-transport.js';
import { rendererToNode, type RendererClockCalibration } from './renderer-clock.js';

/**
 * Release critical-path telemetry: where the milliseconds between the trusted release deadline and
 * the checkout request actually go, per worker, across four clock domains.
 *
 *   trusted epoch   ── TrustedReleaseClock: anchored NTP consensus, advanced by Node's monotonic clock
 *   Node monotonic  ── performance.now() in the runner; releaseMono = clock.monotonicDeadline(release)
 *   renderer        ── performance.now() in each page; mapped with a round-trip calibration (renderer-clock.ts)
 *   browser wall    ── CDP requestWillBeSent wallTime (via Playwright request.timing().startTime after the
 *                      response); same OS wall clock as Node, mapped with the trusted clock's wall offset
 *
 * During dispatch the recorder only stores numbers in preallocated per-worker objects (no I/O, no
 * formatting, no hashing, no allocation for known workers). Everything is converted and written after
 * every POST has settled.
 */
export type CriticalMarkName = 'schedulerFired' | 'workerInvoked' | 'transportEntered' | 'prePost' | 'requestObserved' | 'responseObserved'
  | 'rendererArmSent' | 'rendererArmReturned';
export type DispatchMode = 'node' | 'renderer-experimental';
interface WorkerRecord {
  node: Partial<Record<CriticalMarkName, number>>;
  renderer?: CheckoutRendererTiming & { armedAt?: number; firedAt?: number };
  browserRequestWallMs?: number;
  calibration?: RendererClockCalibration;
  dispatchMode: DispatchMode;
  meta?: CriticalPathMeta;
}
/** Per-attempt identity and outcome (Phase 13): parent goal, worker, fan-out position, configured offset, wave and final state. Never private data. */
export type CriticalPathMeta = Partial<{ parentGoalId: string; workerId: string; fanOutIndex: number; fanOutCount: number; configuredOffsetMs: number;
  wave: string; finalState: string; finalCode: string; prewarmReadyMs: number }>;

export interface CriticalPathRow {
  schema: 'critical-path/v1';
  workerId: string;
  dispatchMode: DispatchMode;
  /** Release-relative ms on the trusted clock. Renderer values carry [low, high] bounds from the calibration. */
  schedulerFiredMs: number | null;
  workerInvokedMs: number | null;
  transportEnteredMs: number | null;
  prePostMs: number | null;
  rendererArmSentMs: number | null;
  rendererArmedMs: Bounded | null;
  evaluateEnteredMs: Bounded | null;
  fetchInvokedMs: Bounded | null;
  browserRequestStartMs: number | null;
  requestObservedMs: number | null;
  responseHeadersMs: Bounded | null;
  responseCompleteMs: Bounded | null;
  responseObservedMs: number | null;
  segments: {
    /** Node's last gate → renderer entry (CDP command transit + renderer scheduling). */
    nodeToRendererMs: number | null;
    /** Renderer entry → fetch() call. */
    rendererToFetchMs: number | null;
    /** fetch() call → browser network request start (CDP wall stamp; ±1 ms wall/monotonic mapping). */
    fetchToRequestStartMs: number | null;
    /** Browser request start → Node receiving Playwright's request event (observation lag). */
    requestEventLagMs: number | null;
  };
  calibration: { samples: number; uncertaintyMs: number; minRoundTripMs: number; consistent: boolean } | null;
  meta?: CriticalPathMeta;
}
export interface Bounded { ms: number; lowMs: number; highMs: number }

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Exercises every recorder method once on a throwaway instance. The first call of a method in a fresh process
 * pays for V8's lazy compilation (≈0.2 ms for a 7-worker release, measured by
 * scripts/benchmark-critical-path-overhead.ts); calling this before release moves that cost off the T-0 path.
 */
export function warmUpCriticalPath(iterations = 300): void {
  // Enough repetitions for V8 to tier the hot methods up from the interpreter; ~1 ms, well before release.
  for (let round = 0; round < iterations; round++) warmUpOnce();
}
function warmUpOnce(): void {
  const recorder = new CriticalPathRecorder(0, 0, 0, ['A', 'B']);
  for (const worker of ['A', 'B']) {
    recorder.mark('*', 'schedulerFired'); recorder.mark(worker, 'workerInvoked'); recorder.mark(worker, 'rendererArmSent');
    recorder.observeTransport(worker, { event: 'CHECKOUT_FUNCTION_ENTERED', preparedContextAgeMs: 0, securitySource: 'PREPARED_CONTEXT' });
    recorder.observeTransport(worker, { event: 'CHECKOUT_PRE_POST', preparedContextAgeMs: 0, securitySource: 'PREPARED_CONTEXT' });
    recorder.observeTransport(worker, { event: 'RENDERER_DISPATCH_ARMED', preparedContextAgeMs: 0, calibrationUncertaintyMs: 0 });
    recorder.observeTransport(worker, { event: 'CHECKOUT_HTTP_POST_INITIATED', initiationEvidence: 'PLAYWRIGHT_REQUEST_EVENT' });
    recorder.observeTransport(worker, { event: 'CHECKOUT_RESPONSE_COMPLETED', networkDurationMs: 0, statusCode: 409, dispatchState: 'RESPONSE_CAPTURED',
      renderer: { timeOrigin: 0, enteredAt: 0, fetchAt: 0, headersAt: 0, completedAt: 0 }, browserRequestWallMs: 1 });
  }
  recorder.rows();
}

export class CriticalPathRecorder {
  private readonly workers = new Map<string, WorkerRecord>();
  /** Rows measured elsewhere (an experimental dispatch coordinator process), already release-relative on the trusted clock. */
  private readonly adopted = new Map<string, CriticalPathRow>();
  private schedulerFired: number | undefined;

  /**
   * @param releaseMono Node performance.now() value of the release instant (clock.monotonicDeadline(releaseMs))
   * @param wallToTrustedMs trusted = wall + this (clock.offsetMs − clock.wallDisagreementMs() at dispatch)
   */
  constructor(readonly releaseMs: number, readonly releaseMono: number, readonly wallToTrustedMs: number, workers: readonly string[] = [],
    private readonly perf: () => number = () => performance.now(), readonly defaultMode: DispatchMode = 'node') {
    for (const worker of workers) this.workers.set(worker, { node: {}, dispatchMode: defaultMode });
  }

  /** Transport key (e.g. "A:2") → attempt ID, so one child's marks and transport observations land on one row. */
  private readonly aliases = new Map<string, string>();
  alias(from: string, to: string): void { if (from !== to) this.aliases.set(from, to); }
  private entry(key: string): WorkerRecord {
    const worker = this.aliases.get(key) ?? key;
    let value = this.workers.get(worker);
    if (!value) { value = { node: {}, dispatchMode: this.defaultMode }; this.workers.set(worker, value); }
    return value;
  }

  /** Hot-path safe: one clock read and one property write. First value wins. */
  mark(worker: string, name: CriticalMarkName, at = this.perf()): void {
    if (name === 'schedulerFired') { this.schedulerFired ??= at; return; }
    const node = this.entry(worker).node;
    if (node[name] === undefined) node[name] = at;
  }
  mode(worker: string, mode: DispatchMode): void { this.entry(worker).dispatchMode = mode; }
  /** First checkout of a worker wins (a later Wave 2/Rescue POST on the same page never overwrites Wave 1). */
  renderer(worker: string, timing: WorkerRecord['renderer']): void { const entry = this.entry(worker); if (timing && !entry.renderer) entry.renderer = { ...timing }; }
  browserRequestWall(worker: string, wallMs: number | undefined): void {
    const entry = this.entry(worker);
    if (typeof wallMs === 'number' && wallMs > 0 && entry.browserRequestWallMs === undefined) entry.browserRequestWallMs = wallMs;
  }
  /** Maps the transport's own observations onto marks. Never throws; the timestamp is taken on entry. */
  observeTransport(worker: string, observation: BrowserTransportObservation, at = this.perf()): void {
    try {
      switch (observation.event) {
        case 'CHECKOUT_FUNCTION_ENTERED': this.mark(worker, 'transportEntered', at); break;
        case 'CHECKOUT_PRE_POST': this.mark(worker, 'prePost', at); break;
        case 'RENDERER_DISPATCH_ARMED': this.mark(worker, 'rendererArmSent', at); this.mode(worker, 'renderer-experimental'); break;
        case 'CHECKOUT_HTTP_POST_INITIATED': this.mark(worker, 'requestObserved', at); break;
        case 'CHECKOUT_RESPONSE_COMPLETED':
          this.mark(worker, 'responseObserved', at);
          this.renderer(worker, observation.renderer);
          this.browserRequestWall(worker, observation.browserRequestWallMs);
          break;
        default: break;
      }
    } catch { /* telemetry only */ }
  }
  /** Adds identity/outcome metadata to a row (after dispatch, never on the hot path). */
  describe(worker: string, meta: CriticalPathMeta): void { const entry = this.entry(worker); entry.meta = { ...(entry.meta ?? {}), ...meta }; }
  calibration(worker: string, calibration: RendererClockCalibration | undefined): void { if (calibration) this.entry(worker).calibration = calibration; }
  workerIds(): string[] { return [...new Set([...this.workers.keys(), ...this.adopted.keys()])].sort(); }
  /** Takes over a complete row measured in another process; it replaces this recorder's row for the same ID. */
  adopt(row: CriticalPathRow): void { if (row && row.schema === 'critical-path/v1' && typeof row.workerId === 'string') this.adopted.set(row.workerId, row); }

  rows(): CriticalPathRow[] {
    const rel = (mono: number | undefined) => mono === undefined ? null : round(mono - this.releaseMono);
    return this.workerIds().map(workerId => {
      const adopted = this.adopted.get(workerId);
      if (adopted) return adopted;
      const record = this.workers.get(workerId)!, node = record.node, calibration = record.calibration;
      const mapped = (rendererMs: number | undefined): Bounded | null => {
        if (rendererMs === undefined || !calibration?.consistent || !Number.isFinite(rendererMs)) return null;
        const value = rendererToNode(calibration, rendererMs);
        return { ms: round(value.nodeMs - this.releaseMono), lowMs: round(value.lowMs - this.releaseMono), highMs: round(value.highMs - this.releaseMono) };
      };
      const evaluateEntered = mapped(record.renderer?.enteredAt), fetchInvoked = mapped(record.renderer?.firedAt ?? record.renderer?.fetchAt);
      const browserRequestStart = record.browserRequestWallMs === undefined ? null : round(record.browserRequestWallMs + this.wallToTrustedMs - this.releaseMs);
      const prePost = rel(node.prePost), requestObserved = rel(node.requestObserved);
      const diff = (a: number | null | undefined, b: number | null | undefined) => a === null || a === undefined || b === null || b === undefined ? null : round(b - a);
      return { schema: 'critical-path/v1', workerId, dispatchMode: record.dispatchMode,
        schedulerFiredMs: rel(this.schedulerFired), workerInvokedMs: rel(node.workerInvoked), transportEnteredMs: rel(node.transportEntered), prePostMs: prePost,
        rendererArmSentMs: rel(node.rendererArmSent), rendererArmedMs: mapped(record.renderer?.armedAt),
        evaluateEnteredMs: evaluateEntered, fetchInvokedMs: fetchInvoked, browserRequestStartMs: browserRequestStart, requestObservedMs: requestObserved,
        responseHeadersMs: mapped(record.renderer?.headersAt), responseCompleteMs: mapped(record.renderer?.completedAt), responseObservedMs: rel(node.responseObserved),
        segments: { nodeToRendererMs: record.dispatchMode === 'node' ? diff(prePost, evaluateEntered?.ms) : null, rendererToFetchMs: diff(evaluateEntered?.ms, fetchInvoked?.ms),
          fetchToRequestStartMs: diff(fetchInvoked?.ms, browserRequestStart), requestEventLagMs: diff(browserRequestStart, requestObserved) },
        calibration: calibration ? { samples: calibration.samples, uncertaintyMs: round(calibration.uncertaintyMs), minRoundTripMs: round(calibration.minRoundTripMs), consistent: calibration.consistent } : null,
        ...(record.meta ? { meta: { ...record.meta } } : {}) };
    });
  }

  toNdjson(meta: Record<string, unknown> = {}): string {
    const header = { schema: 'critical-path/v1', type: 'header', releaseMs: this.releaseMs, wallToTrustedMs: round(this.wallToTrustedMs), ...meta,
      note: 'All *Ms values are milliseconds after the release instant on the trusted clock. Renderer values are mapped through a round-trip calibration and carry [lowMs, highMs].' };
    return [header, ...this.rows()].map(line => JSON.stringify(line)).join('\n') + '\n';
  }
}
