import type { CheckoutHttpResponse } from './browser-session-transport.js';
import type { CheckoutDiagnostic } from './checkout-diagnostics.js';
import type { CriticalPathRow } from './critical-path.js';
import type { PrewarmPolicy, TierStatus } from './prewarm-scheduler.js';

/**
 * EXPERIMENTAL per-browser dispatch coordinator (ONDA_EXPERIMENTAL_DISPATCH_COORDINATOR=PER_BROWSER_V1): IPC messages.
 * Everything a coordinator needs to dispatch is sent BEFORE the first trigger; nothing crosses IPC at the dispatch
 * instant. Results travel back only after each response (or refusal).
 */
export type SecurityMode = { kind: 'synthetic'; cpuMs: number; waitMs: number } | { kind: 'genuine' };
export interface CoordinatorInit { type: 'init'; workerId: string; cdpUrl: string; pageUrl: string;
  /** CDP target IDs of this worker's child tabs in fan-out order (production); absent = first `pageCount` tabs on pageUrl (benchmark). */
  targetIds?: string[]; pageCount: number; security: SecurityMode; captureResponses: boolean }
export interface DelegatedAttempt { attemptId: string; key: string; body: string; pageIndex: number; tier: number; order: number;
  releaseMs: number; triggerMs: number; dispatchDeadlineMs: number }
export interface CoordinatorArm { type: 'arm'; attempts: DelegatedAttempt[];
  /** Trusted-clock anchor read in the parent back to back: process.hrtime.bigint() (system-wide monotonic) and trusted epoch ms. */
  anchor: { hrNs: string; trustedMs: number };
  prewarmAtMs: number; prewarmPolicy: PrewarmPolicy | null; prewarmStopStartingAtMs: number | null; retryCutoffMs: number; spinTailMs: number }
export type ParentMessage = CoordinatorInit | CoordinatorArm | { type: 'abort' } | { type: 'capture-ack'; id: number; ok: boolean } | { type: 'shutdown' };

export type DelegatedOutcome =
  /** Refused before the transport sent anything: provably unsent (the coordinator's permit was never used). */
  | { kind: 'unsent'; code: string }
  /** HTTP 200 JSON body; the parent validates it against the exact request and plan. */
  | { kind: 'response'; body: unknown }
  /** A failure after (or possibly after) the request left, with the transport's own dispatched/confirmedRejected evidence. */
  | { kind: 'error'; code: string; dispatched: boolean; confirmedRejected: boolean; diagnostic?: CheckoutDiagnostic };
export type ChildMessage =
  | { type: 'ready'; pageCount: number }
  | { type: 'fatal'; code: string }
  | { type: 'armed'; count: number }
  | { type: 'prewarm'; attemptId: string; ok: boolean; startedMs: number; readyMs: number | null; code?: string }
  | { type: 'prewarm-status'; status: TierStatus[] }
  | { type: 'capture'; id: number; attemptId: string; response: CheckoutHttpResponse }
  | { type: 'human-verification'; pageIndex: number; state: 'required' | 'completed' }
  | { type: 'result'; attemptId: string; outcome: DelegatedOutcome }
  | { type: 'telemetry'; rows: CriticalPathRow[] };
