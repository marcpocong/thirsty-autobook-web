import type { Wing } from './court-registry.js';
import { WING_RELEASE_POLICIES, type WingReleaseStatus } from './wing-release-data.js';

/**
 * Evidence-based capability system. Each verdict names the exact evidence it relies on and, when blocked,
 * the precise reason and how the owner could verify it. Dependency-free (renderer and main process share it).
 *
 * LIVE_VERIFIED   genuine provider checkout to QR was observed on this path.
 * LIVE_SUPPORTED  the existing gated live path is used in production; one boundary is still unproven.
 * LIVE_PILOT      the dispatch path is live-exercised but this configuration has not reached a provider hold;
 *                 arming requires an explicit owner attestation for this run.
 * OFFLINE_ONLY    planning and intercepted rehearsal only; a live run is refused.
 * BLOCKED         not offered; the reason is shown.
 */
export type CapabilityStatus = 'LIVE_VERIFIED' | 'LIVE_SUPPORTED' | 'LIVE_PILOT' | 'OFFLINE_ONLY' | 'BLOCKED';
export type BookingModeId = 'AVAILABLE_NOW' | 'NEXT_RELEASE';
export type StrategyId = 'SHOTGUN' | 'PRECISION' | 'NORMAL';
export type CheckoutMethodId = 'PROOFLESS' | 'API_FRESH_PROOF' | 'BROWSER' | 'HYBRID';
export const CHECKOUT_METHODS: readonly CheckoutMethodId[] = ['PROOFLESS', 'API_FRESH_PROOF', 'BROWSER', 'HYBRID'];
export const STRATEGIES: readonly StrategyId[] = ['SHOTGUN', 'PRECISION', 'NORMAL'];
export const METHOD_LABEL: Readonly<Record<CheckoutMethodId, string>> = Object.freeze({
  PROOFLESS: 'Proofless direct checkout', API_FRESH_PROOF: 'API checkout with fresh availability proofs',
  BROWSER: 'Normal browser checkout (legacy)', HYBRID: 'Hybrid availability + browser checkout (legacy)' });
export const STRATEGY_LABEL: Readonly<Record<StrategyId, string>> = Object.freeze({
  SHOTGUN: 'Shotgun', PRECISION: 'Precision', NORMAL: 'Normal' });
/** Legacy saved BOOKING_METHOD values. */
export const METHOD_TO_SETUP: Readonly<Record<CheckoutMethodId, 'proofless' | 'api-first' | 'browser' | 'hybrid'>> = Object.freeze({
  PROOFLESS: 'proofless', API_FRESH_PROOF: 'api-first', BROWSER: 'browser', HYBRID: 'hybrid' });
export const SETUP_TO_METHOD: Readonly<Record<string, CheckoutMethodId>> = Object.freeze({
  proofless: 'PROOFLESS', 'api-first': 'API_FRESH_PROOF', browser: 'BROWSER', hybrid: 'HYBRID' });

export interface EvidenceRef { id: string; date: string; summary: string }
/** Recorded, citable evidence. Historical results are evidence of that path, not of any other configuration. */
export const EVIDENCE: Readonly<Record<string, EvidenceRef>> = Object.freeze({
  MANGO_PROOFLESS_OFFPEAK: { id: 'MANGO_PROOFLESS_OFFPEAK', date: '2026-09-23', summary: 'Mango proofless direct checkout reached genuine pending holds off-peak (1, 4 and 6 parallel workers; 2-court checkout).' },
  MANGO_PRECISION_RELEASES: { id: 'MANGO_PRECISION_RELEASES', date: '2026-09-25..2026-09-30', summary: 'Mango Precision fan-out dispatched live at 08:00 releases (up to 28 POSTs); provider answered every POST; no 200 hold at a release boundary yet.' },
  MANGO_NORMAL_QR: { id: 'MANGO_NORMAL_QR', date: '2026-10-14', summary: 'Mango Court 2 fresh-proof Normal flow verified to genuine QR (supervised official UI) and historical desktop API runner QR handoffs.' },
  BUKO_NORMAL_QR: { id: 'BUKO_NORMAL_QR', date: '2026-10-14', summary: 'Buko Court 4 fresh-proof Normal flow verified to genuine QR; production Worker B API adapter reached QR in a separate customer context.' },
  BUKO_PAYMENT_CONFLICT: { id: 'BUKO_PAYMENT_CONFLICT', date: '2026-10-14', summary: 'HTTP 409 "existing payment" when a second checkout used the first customer\'s pending context; separately configured Worker B succeeded.' },
  BROWSER_FLOW_QR: { id: 'BROWSER_FLOW_QR', date: '2026-09 (historical)', summary: 'Legacy browser selection/full-flow practice reached QR for Mango with 1–2 courts.' },
});

export interface CapabilityQuery {
  wing: Wing; mode: BookingModeId; strategy: StrategyId; method: CheckoutMethodId;
  /** Distinct courts this wing needs (ideal quota). */ courts: number;
  /** Optional operator-accepted, locally recorded release verification for an OWNER_ASSUMED wing. */
  releaseVerified?: boolean;
}
export interface CapabilityVerdict {
  status: CapabilityStatus; live: boolean; offline: boolean; reasons: string[]; evidence: EvidenceRef[];
  verify?: string; requiresAttestation?: boolean; checkoutShape?: string;
}
const verdict = (status: CapabilityStatus, reasons: string[], evidence: EvidenceRef[] = [], extra: Partial<CapabilityVerdict> = {}): CapabilityVerdict =>
  ({ status, live: ['LIVE_VERIFIED', 'LIVE_SUPPORTED', 'LIVE_PILOT'].includes(status), offline: status !== 'BLOCKED', reasons, evidence, ...extra });

export const releaseStatusOf = (wing: Wing): WingReleaseStatus => WING_RELEASE_POLICIES[wing]?.status ?? 'UNKNOWN';

/** Which strategies a booking mode offers, default first. */
export const strategiesFor = (mode: BookingModeId): StrategyId[] => mode === 'NEXT_RELEASE' ? ['SHOTGUN', 'PRECISION', 'NORMAL'] : ['NORMAL'];
export const defaultStrategy = (mode: BookingModeId): StrategyId => mode === 'NEXT_RELEASE' ? 'SHOTGUN' : 'NORMAL';
/** Checkout methods a strategy can use at all, preferred first (independent of wing). */
export const methodsForStrategy = (strategy: StrategyId, mode: BookingModeId): CheckoutMethodId[] =>
  strategy === 'NORMAL' ? (mode === 'AVAILABLE_NOW' ? ['API_FRESH_PROOF', 'PROOFLESS', 'BROWSER', 'HYBRID'] : ['API_FRESH_PROOF', 'PROOFLESS', 'BROWSER', 'HYBRID']) : ['PROOFLESS'];
export const defaultMethod = (strategy: StrategyId, mode: BookingModeId): CheckoutMethodId => methodsForStrategy(strategy, mode)[0]!;

export function evaluateCapability(q: CapabilityQuery): CapabilityVerdict {
  const E = EVIDENCE;
  if (!methodsForStrategy(q.strategy, q.mode).includes(q.method))
    return verdict('BLOCKED', [`${STRATEGY_LABEL[q.strategy]} schedules pre-planned proofless dispatch; ${METHOD_LABEL[q.method]} reads availability at send time and cannot be pre-armed.`]);
  if (!strategiesFor(q.mode).includes(q.strategy))
    return verdict('BLOCKED', [`${STRATEGY_LABEL[q.strategy]} is a scheduled-release strategy. For a currently open date use Normal.`]);
  if (!Number.isInteger(q.courts) || q.courts < 1 || q.courts > 7) return verdict('BLOCKED', ['Choose 1–7 courts for this wing.']);
  const legacyCourtLimit = (q.method === 'BROWSER' || q.method === 'HYBRID') && q.courts > 2;
  if (q.wing === 'MANGO') {
    if (legacyCourtLimit) return verdict('BLOCKED', ['Browser and Hybrid checkouts support at most two Mango courts. Three or more require API or Proofless checkout.']);
    if (q.mode === 'AVAILABLE_NOW') {
      const shape = q.courts <= 2 ? 'one checkout' : `${Math.ceil(q.courts / 2)} checkouts of up to two courts, one browser/customer each`;
      if (q.method === 'PROOFLESS') return verdict('LIVE_VERIFIED', ['Proofless direct checkout reached genuine holds off-peak, including parallel workers.'], [E.MANGO_PROOFLESS_OFFPEAK!], { checkoutShape: shape });
      if (q.method === 'API_FRESH_PROOF') return verdict('LIVE_VERIFIED', ['Fresh-proof Normal checkout is the verified reference path.'], [E.MANGO_NORMAL_QR!], { checkoutShape: shape });
      return verdict('LIVE_VERIFIED', ['Legacy browser flow; retained for compatibility.'], [E.BROWSER_FLOW_QR!], { checkoutShape: shape });
    }
    if (q.strategy === 'NORMAL') return verdict('LIVE_SUPPORTED', ['Existing gated Normal release: reads published availability at release, then checks out. No release-boundary win is recorded.'],
      [q.method === 'PROOFLESS' ? E.MANGO_PROOFLESS_OFFPEAK! : E.MANGO_NORMAL_QR!], { checkoutShape: q.courts <= 2 ? 'one checkout' : `${Math.ceil(q.courts / 2)} checkouts of up to two courts` });
    if (q.strategy === 'PRECISION') return verdict('LIVE_SUPPORTED', ['Production Precision path used at Mango releases. Provider acceptance of a proofless checkout exactly at 08:00 is still unproven.'],
      [E.MANGO_PRECISION_RELEASES!, E.MANGO_PROOFLESS_OFFPEAK!], { checkoutShape: 'one-court checkout per attempt' });
    return verdict('LIVE_PILOT', [
      'Shotgun dispatches through the same armed Precision fan-out path used live at Mango releases, with offsets from −2000 to 0 ms.',
      'No live Shotgun has reached a provider hold, and release-boundary proofless acceptance is unproven.',
      'Arming requires your explicit attestation that Onda/Thirsty Pickle authorize this multi-attempt run. HTTP 429 or payment-in-progress stops all unsent attempts.'],
      [E.MANGO_PRECISION_RELEASES!, E.MANGO_PROOFLESS_OFFPEAK!], { requiresAttestation: true, checkoutShape: 'one-court checkout per attempt', verify: 'The first authorized live Shotgun release is the pilot; its forensic report records request timing and every provider response.' });
  }
  // BUKO
  if (q.mode === 'AVAILABLE_NOW') {
    if (q.method !== 'API_FRESH_PROOF') return verdict('BLOCKED', [q.method === 'PROOFLESS'
      ? 'Buko proofless checkout has never been verified and the checkout builder refuses it (BUKO_PROOFLESS_NOT_ENABLED).'
      : 'The browser booking planner is Mango-only (BUKO_BROWSER_PLANNER_NOT_ENABLED).'], [], { verify: 'Use API checkout with fresh proofs for Buko.' });
    if (q.courts === 1) return verdict('LIVE_VERIFIED', ['One exact Buko court, 1–3 hours, fresh proofs, no substitution.'], [E.BUKO_NORMAL_QR!], { checkoutShape: 'one checkout' });
    return verdict('LIVE_PILOT', [`Buko checkout accepts one exact court. ${q.courts} courts run as ${q.courts} separate one-court checkouts, each in its own configured browser/customer, one after another.`,
      'Each checkout uses the verified one-court path; the multi-checkout sequence itself has not been run live.'],
      [E.BUKO_NORMAL_QR!, E.BUKO_PAYMENT_CONFLICT!], { requiresAttestation: false, checkoutShape: `${q.courts} sequential one-court checkouts` });
  }
  const release = releaseStatusOf('BUKO');
  const releaseReason = release === 'VERIFIED' || q.releaseVerified ? null
    : `Buko's 08:00 / +6 day release is ${release.replace('_', ' ')}: no recurring Buko release transition has been independently observed.`;
  if (q.strategy === 'NORMAL') return verdict('OFFLINE_ONLY', [...(releaseReason ? [releaseReason] : []), 'The scheduled Normal release planner is Mango-only (BUKO_BROWSER_PLANNER_NOT_ENABLED).'],
    [], { verify: 'Record a Buko release observation (Settings → Release verification), then book Buko once the date is open with Available Now.' });
  return verdict('OFFLINE_ONLY', [...(releaseReason ? [releaseReason] : []), 'Buko proofless checkout has never been verified and is refused by the checkout builder and journal (BUKO_PROOFLESS_NOT_ENABLED).'],
    [], { verify: 'Buko scheduled Shotgun/Precision needs (1) an observed Buko release transition and (2) a verified Buko proofless checkout. Until then Buko is offline rehearsal only; book open Buko dates with Available Now.' });
}

/** Rows for the operator's capability matrix. */
export function capabilityMatrix(courts = 1) {
  const rows: Array<CapabilityQuery & { verdict: CapabilityVerdict }> = [];
  for (const mode of ['AVAILABLE_NOW', 'NEXT_RELEASE'] as const) for (const strategy of strategiesFor(mode)) for (const method of methodsForStrategy(strategy, mode))
    for (const wing of ['MANGO', 'BUKO'] as const) rows.push({ wing, mode, strategy, method, courts, verdict: evaluateCapability({ wing, mode, strategy, method, courts }) });
  return rows;
}
/** Plan-level live status is the most restrictive enabled wing. */
const ORDER: CapabilityStatus[] = ['BLOCKED', 'OFFLINE_ONLY', 'LIVE_PILOT', 'LIVE_SUPPORTED', 'LIVE_VERIFIED'];
export const weakestCapability = (verdicts: readonly CapabilityVerdict[]): CapabilityStatus =>
  verdicts.length ? verdicts.map(v => v.status).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0]! : 'BLOCKED';
