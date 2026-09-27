export type HypothesisId = 'H1' | 'H2' | 'H3' | 'H4' | 'H5';
export type EvidenceQuality = 'HIGH' | 'MEDIUM' | 'LOW';

export interface HypothesisSpec {
  id: HypothesisId;
  label: string;
  expectedObservableSignatures: string[];
  supports: string[];
  contradicts: string[];
  neutral: string[];
  minimumEvidenceQuality: EvidenceQuality;
  limitations: string[];
}

/**
 * Pre-registered before the next live release. These are observable signatures, not provider internals.
 * Analyzer verdicts remain SUPPORTING / CONTRADICTING / NEUTRAL / INSUFFICIENT and never probabilities.
 */
export const WAVE1_HYPOTHESIS_SPEC_VERSION = 'wave1-arbitration-hypotheses/v2.0.0';

export const WAVE1_HYPOTHESES: readonly HypothesisSpec[] = [
  {
    id: 'H1', label: 'ARRIVAL_SENSITIVE_SHARED_ADMISSION_OR_FIFO_LIKE_QUEUE', minimumEvidenceQuality: 'MEDIUM',
    expectedObservableSignatures: ['Arrival-proxy rank and provider-decision rank move together across courts and clean releases.'],
    supports: ['Contestable n >= 4 with strong positive tie-aware rank association.', 'The same ordering signature recurs across multiple clean releases.'],
    contradicts: ['Repeated major overtakes or non-positive association in adequately sized contestable samples.'],
    neutral: ['Tied arrival proxies.', 'Known-impossible targets.', 'n <= 3.', 'One release with mixed evidence.'],
    limitations: ['The x-vercel-id embedded timestamp candidate is UNDOCUMENTED and is not proven queue-entry time.', 'Response order can include post-admission work.'],
  },
  {
    id: 'H2', label: 'FACILITY_DATE_SERIALIZATION_OR_SHARED_CURRENT_STATE_BOTTLENECK', minimumEvidenceQuality: 'MEDIUM',
    expectedObservableSignatures: ['Cross-court operations stall or complete in related windows.', 'Slow current-looking reads flush near checkout decisions.'],
    supports: ['Recurring cross-court slow-read flush proximity.', 'Cross-court target state transitions are synchronized beyond observer resolution.'],
    contradicts: ['Repeated clean releases show independent court progress with no shared stalls or flush relationship.'],
    neutral: ['Temporal proximity in a single release.', 'Missing or sparse read evidence.'],
    limitations: ['Temporal proximity is not causation.', 'A shared upstream admission limit can mimic facility/date serialization.'],
  },
  {
    id: 'H3', label: 'BACKEND_ADMISSION_OR_INSTANCE_SPLIT', minimumEvidenceQuality: 'MEDIUM',
    expectedObservableSignatures: ['Later operations overtake stalled ones.', 'Delay/reason/read groups split into distinct paths or clusters.'],
    supports: ['Major arrival/decision inversions.', 'Fast state-regressive reads complete while older reads remain stalled.', 'Stable response clusters not explained by court.'],
    contradicts: ['Repeated adequately sized clean releases exhibit strict shared FIFO behavior with no overtakes.'],
    neutral: ['A single inversion among tied arrival candidates.', 'Different response reasons alone.'],
    limitations: ['External evidence cannot identify a specific instance, pool or deployment topology.'],
  },
  {
    id: 'H4', label: 'PER_COURT_SERIALIZATION', minimumEvidenceQuality: 'MEDIUM',
    expectedObservableSignatures: ['Same-court operations couple more strongly than cross-court operations.', 'Different courts progress independently.'],
    supports: ['Repeated same-court ordering/latency coupling with cross-court overtakes.', 'Court-specific disappearance windows recur independently.'],
    contradicts: ['Cross-court synchronized stalls dominate while same-court behavior is not distinct.'],
    neutral: ['One request per court.', 'Too few same-court contestable attempts.'],
    limitations: ['A run with one Wave 1 request per court cannot materially test per-court serialization.'],
  },
  {
    id: 'H5', label: 'SPLIT_OR_STALE_READ_PATH', minimumEvidenceQuality: 'HIGH',
    expectedObservableSignatures: ['A completed observation shows unavailable before a later-sent observation returns open, absent reopening evidence.'],
    supports: ['One or more strong state-regression cases preserving raw observations.', 'The signature recurs across releases.'],
    contradicts: ['Multiple dense clean releases show no regression or overtaking despite state transitions.'],
    neutral: ['Ordinary open-to-unavailable advancement.', 'Plausible/confirmed cancellation, expiry or reopening.'],
    limitations: ['Availability reads expose state at an unknown instant inside their request/response intervals.', 'A genuine reopening can resemble stale data without booking evidence.'],
  },
] as const;
