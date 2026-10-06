import type { TrustedReleaseClock } from '../release-clock.js';
import { assertCalibrationUsable, earliestSafeRendererTime, type RendererClockCalibration } from './renderer-clock.js';

/**
 * EXPERIMENTAL renderer-resident release dispatch. Off unless ONDA_EXPERIMENTAL_RENDERER_DISPATCH is
 * exactly RENDERER_RESIDENT_V1. The Node-triggered path (armed-dispatch.ts fireArmedAttempt) stays the
 * default and the fallback.
 *
 * Idea: the ~6–9 ms between Node's release instant and Chrome starting the request (2026-09-25: pre-POST
 * +0.4…2.9 ms, Chrome request start ≤ +8.0…10.6 ms) is CDP transit and renderer scheduling. Here Node sends
 * the exact, pre-serialized request to the page ARM_LEAD before release, and the page itself calls fetch()
 * when ITS clock says the release has certainly passed. Node only observes the T-0 moment.
 *
 * Never early: the renderer fire time uses the LOWER bound of the calibrated offset (renderer-clock.ts), so
 * when the page fires, Node's monotonic clock — the same anchored clock the Node path uses — is certainly
 * at or past the release deadline. A second, independent guard on the wall clock (with the trusted offset)
 * must also agree, within a tolerance. Anything unusual refuses BEFORE fetch() and is provably unsent.
 */
export const RENDERER_DISPATCH_ENV = 'ONDA_EXPERIMENTAL_RENDERER_DISPATCH';
export const RENDERER_DISPATCH_VALUE = 'RENDERER_RESIDENT_V1';
export function rendererDispatchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[RENDERER_DISPATCH_ENV] === RENDERER_DISPATCH_VALUE;
}

export interface RendererDispatchOptions {
  /** How long before release Node sends the arm command. Must cover CDP transit (Phase 1 p99 ≈ 10 ms). */
  armLeadMs: number;
  /** A calibration older than this (Node clock) is refused. */
  maxCalibrationAgeMs: number;
  /** A calibration looser than this (half-width, ms) is refused. */
  maxCalibrationUncertaintyMs: number;
  /** Final synchronous spin before fetch(); the rest of the wait yields through MessageChannel. */
  syncSpinMs: number;
  /** The wall-clock guard may run at most this far ahead of the monotonic guard before refusing to wait. */
  wallGuardToleranceMs: number;
  /** The page refuses to arm if its fire time is further away than this (a stuck or misconfigured arm). */
  maxArmAheadMs: number;
}
export const DEFAULT_RENDERER_DISPATCH_OPTIONS: RendererDispatchOptions = Object.freeze({
  armLeadMs: 40, maxCalibrationAgeMs: 15_000, maxCalibrationUncertaintyMs: 2, syncSpinMs: 1, wallGuardToleranceMs: 5, maxArmAheadMs: 250,
});

/** Everything the page needs, all in the page's own clock domains. */
export interface RendererFirePlan {
  key: string;
  trustedTriggerMs?:number;
  trustedDeadlineMs?:number;
  missedCode?:'SHOTGUN_TRIGGER_MISSED';
  pageUrl: string;
  /** Renderer performance.now() at or after which Node's clock is certainly ≥ release. */
  fireAtRendererMs: number;
  /** Renderer performance.now() after which Node's clock may be past the dispatch deadline: refuse. */
  notAfterRendererMs: number;
  /** Local wall-clock (Date.now) value at which the trusted clock reads the release instant. */
  releaseWallMs: number;
  wallGuardToleranceMs: number;
  syncSpinMs: number;
  maxArmAheadMs: number;
  /** Diagnostics only. */
  calibrationUncertaintyMs: number;
}

/**
 * Converts the trusted release window into the page's clocks. Throws RendererClockError (a pre-arm,
 * provably-unsent refusal) when the calibration is missing, inconsistent, stale or too loose.
 */
export function planRendererFire(input: { key: string; pageUrl: string; calibration: RendererClockCalibration | undefined; clock: Pick<TrustedReleaseClock,
  'monotonicDeadline' | 'offsetMs' | 'wallDisagreementMs'>; releaseMs: number; dispatchDeadlineMs: number; nodeNowMs: number; options?: Partial<RendererDispatchOptions> }): RendererFirePlan {
  const options = { ...DEFAULT_RENDERER_DISPATCH_OPTIONS, ...(input.options ?? {}) };
  assertCalibrationUsable(input.calibration, input.nodeNowMs, { maxAgeMs: options.maxCalibrationAgeMs, maxUncertaintyMs: options.maxCalibrationUncertaintyMs });
  const calibration = input.calibration;
  const releaseMono = input.clock.monotonicDeadline(input.releaseMs), deadlineMono = input.clock.monotonicDeadline(input.dispatchDeadlineMs);
  // trusted(wall) = wall + offset − disagreement  ⇒  wall at release = release − offset + disagreement.
  const releaseWallMs = input.releaseMs - input.clock.offsetMs + input.clock.wallDisagreementMs();
  return { key: input.key,trustedTriggerMs:input.releaseMs,trustedDeadlineMs:input.dispatchDeadlineMs, pageUrl: input.pageUrl, fireAtRendererMs: earliestSafeRendererTime(calibration, releaseMono),
    notAfterRendererMs: deadlineMono - calibration.offsetHighMs, releaseWallMs, wallGuardToleranceMs: options.wallGuardToleranceMs,
    syncSpinMs: options.syncSpinMs, maxArmAheadMs: options.maxArmAheadMs, calibrationUncertaintyMs: calibration.uncertaintyMs };
}

export interface RendererArmedArgs extends RendererFirePlan { url: string; text: string; headers: Record<string, string> }
export type RendererArmedOutcome =
  | { refused: string; armedAt: number; firedAt?: number }
  | { fired: true; status: number; contentType: string; server: string; cloudflareRay: string; cfMitigated: string; vercelId: string; requestId: string;
      serverTiming: string; responseReceivedMs: number; responseCompletedMs: number; body: string; headers: Record<string, string>;
      renderer: { timeOrigin: number; enteredAt: number; fetchAt: number; headersAt: number; completedAt: number; armedAt: number; firedAt: number } };

/**
 * The page-side function, kept as a STATIC SOURCE STRING: page.evaluate() serializes functions with
 * toString(), and tsx/esbuild would decorate any nested named function with a Node-only __name helper
 * (see selection.ts). The same source runs in the page and, in tests, inside a Node vm with a virtual clock.
 * It references only globals and its own argument.
 */
export const RENDERER_ARMED_CHECKOUT_SOURCE = `async (args) => {
  const armedAt = performance.now();
  const registry = (globalThis.__thirstyRendererDispatch = globalThis.__thirstyRendererDispatch || {});
  if (registry[args.key]) return { refused: 'RENDERER_ALREADY_ARMED', armedAt };
  const slot = { disarmed: false, fired: false };
  registry[args.key] = slot;
  // A refusal is provably unsent: it releases the key. A fired key stays taken for the page's lifetime.
  const refuse = (code, firedAt) => {
    if (registry[args.key] === slot) delete registry[args.key];
    return firedAt === undefined ? { refused: code, armedAt } : { refused: code, armedAt, firedAt };
  };
  if (location.href !== args.pageUrl) return refuse('RENDERER_PAGE_INVALID');
  if (!(args.fireAtRendererMs < args.notAfterRendererMs) || args.fireAtRendererMs - armedAt > args.maxArmAheadMs) return refuse('RENDERER_ARM_WINDOW_INVALID');
  const channel = new MessageChannel();
  while (performance.now() < args.fireAtRendererMs - args.syncSpinMs) {
    if (slot.disarmed) { channel.port1.close(); return refuse('RENDERER_DISARMED'); }
    await new Promise((resolve) => { channel.port1.onmessage = () => resolve(); channel.port2.postMessage(0); });
  }
  channel.port1.close();
  if (slot.disarmed) return refuse('RENDERER_DISARMED');
  while (performance.now() < args.fireAtRendererMs) { /* final synchronous spin, at most syncSpinMs */ }
  while (Date.now() < args.releaseWallMs - args.wallGuardToleranceMs) {
    if (performance.now() > args.notAfterRendererMs) return refuse(args.missedCode || 'RENDERER_WALL_GUARD');
  }
  const firedAt = performance.now();
  if (firedAt > args.notAfterRendererMs) return refuse(args.missedCode || 'RENDERER_WINDOW_MISSED', firedAt);
  if (location.href !== args.pageUrl) return refuse('RENDERER_PAGE_INVALID');
  slot.fired = true;
  const response = await fetch(args.url, { method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
    headers: Object.assign({ 'Content-Type': 'application/json' }, args.headers), body: args.text });
  const headersAt = performance.now();
  const body = await response.text();
  const completedAt = performance.now();
  const kept = {};
  for (const name of ['content-length', 'date', 'age', 'cache-control', 'x-vercel-cache', 'x-matched-path', 'retry-after', 'x-ratelimit-limit',
    'x-ratelimit-remaining', 'x-ratelimit-reset', 'ratelimit', 'ratelimit-policy', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'x-powered-by', 'via']) {
    const value = response.headers.get(name);
    if (value !== null) kept[name] = value;
  }
  const header = (name) => response.headers.get(name) || '';
  return { fired: true, status: response.status, contentType: header('content-type'), server: header('server'), cloudflareRay: header('cf-ray'),
    cfMitigated: header('cf-mitigated'), vercelId: header('x-vercel-id'), requestId: header('x-request-id'), serverTiming: header('server-timing'),
    responseReceivedMs: headersAt - firedAt, responseCompletedMs: completedAt - firedAt, body, headers: kept,
    renderer: { timeOrigin: performance.timeOrigin, enteredAt: armedAt, fetchAt: firedAt, headersAt, completedAt, armedAt, firedAt } };
}`;
/** Page-side disarm: effective until the page has started its final ≤ syncSpinMs spin. */
export const RENDERER_DISARM_SOURCE = `(key) => {
  const registry = globalThis.__thirstyRendererDispatch;
  const slot = registry ? registry[key] : undefined;
  if (!slot) return 'NOT_ARMED';
  if (slot.fired) return 'ALREADY_FIRED';
  slot.disarmed = true;
  return 'DISARMED';
}`;
// Functions built from the static sources: their toString() is exactly the source, whatever compiled this module.
export const RENDERER_ARMED_CHECKOUT = new Function(`return (${RENDERER_ARMED_CHECKOUT_SOURCE});`)() as (args: RendererArmedArgs) => Promise<RendererArmedOutcome>;
export const RENDERER_DISARM = new Function(`return (${RENDERER_DISARM_SOURCE});`)() as (key: string) => 'DISARMED' | 'ALREADY_FIRED' | 'NOT_ARMED';
