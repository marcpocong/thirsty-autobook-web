import { compareAvailabilityFreshness, decodeMatrix, type AvailabilityObservation } from '../slot-evidence.js';

/**
 * Reopen PREDICTION for Rescue V2. Pending holds expire ten minutes after the checkout that created them
 * (hold_expires_at); on 2026-09-29 holds made at about +4–6 s disappeared at +604–606 s. When an authorized
 * candidate's hours turn unavailable after release, the latest such transition dates a likely hold, and the
 * candidate may reopen about ten minutes later — if that hold is not paid.
 *
 * A prediction only lets the runner PREPARE (security for a Rescue worker) before the window. It never sends
 * anything: a Rescue attempt still needs a genuinely fresh unavailable → open observation, selection,
 * revalidation, a durable reservation and the final pre-POST gate. Predictions and their observed error are
 * logged for tuning.
 */
export const HOLD_DURATION_MS = 10 * 60_000;
/** Slot Watch's own expiry-window bounds use the same ±2 s around the bracketing reads. */
export const PREDICTION_LEAD_MS = 2_000;
export const PREDICTION_TAIL_MS = 2_000;

export type PredictionConfidence = 'HOLD_EXPIRY_PATTERN' | 'LOW';
export interface CandidateRange { id: string; court: number; start: string; durationHours: number }
export interface ReopenPrediction {
  candidateId: string;
  /** Release-relative window in which the candidate may reopen, and its middle. */
  windowStartMs: number; windowEndMs: number; centerMs: number;
  /** HOLD_EXPIRY_PATTERN: every unavailable hour was seen turning unavailable after release. LOW: some hour was unavailable
   * from its first published read (its cause and age are unknown). */
  confidence: PredictionConfidence;
  /** Sequence of the newest read that showed the candidate unavailable (the prediction epoch). */
  epochSeq: number;
}

const hourText = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

/**
 * One prediction per candidate that is unavailable in the freshest usable read. Each unavailable hour contributes the
 * window of its LATEST open → unavailable transition (bracketed by the last read showing it open and the first showing
 * it unavailable); the candidate reopens only when all of them have expired, so the windows combine by their maxima.
 * Reads are compared with the freshness model (a staler read never replaces a fresher one).
 */
export function predictReopenings(candidates: readonly CandidateRange[], observations: readonly AvailabilityObservation[],
  options: { holdMs?: number; leadMs?: number; tailMs?: number; /** Reused across calls: decoded matrices by read sequence. */ decoded?: Map<number, Map<string, string>> } = {}): ReopenPrediction[] {
  const hold = options.holdMs ?? HOLD_DURATION_MS, lead = options.leadMs ?? PREDICTION_LEAD_MS, tail = options.tailMs ?? PREDICTION_TAIL_MS;
  const published = observations.filter(value => value.outcome === 'ok' && value.targetDatePresent && value.requestOffsetMs >= 0 && value.matrix)
    .sort((a, b) => a.seq - b.seq);
  if (!published.length) return [];
  const decoded = options.decoded ?? new Map<number, Map<string, string>>();
  for (const value of published) if (!decoded.has(value.seq)) decoded.set(value.seq, decodeMatrix(value.matrix));
  // Per cell: its operational state sequence (fresher reads only) and its latest open→unavailable bracket.
  interface CellTrack { state?: 'O' | 'X'; last?: AvailabilityObservation; openBefore?: AvailabilityObservation;
    transition?: { before: AvailabilityObservation; after: AvailabilityObservation }; unavailableFromFirst: boolean }
  const tracks = new Map<string, CellTrack>();
  const cellsOf = (candidate: CandidateRange) => Array.from({ length: candidate.durationHours }, (_, offset) =>
    `${candidate.court}/${hourText(Number(candidate.start.slice(0, 2)) + offset)}`);
  const wanted = new Set(candidates.flatMap(cellsOf));
  for (const observation of published) {
    const cells = decoded.get(observation.seq)!;
    for (const key of wanted) {
      const code = cells.get(key);
      if (code !== 'O' && code !== 'X') continue;
      const track = tracks.get(key) ?? { unavailableFromFirst: false };
      if (track.last && compareAvailabilityFreshness(observation, track.last) <= 0) { tracks.set(key, track); continue; }
      if (!track.state) track.unavailableFromFirst = code === 'X';
      else if (track.state === 'O' && code === 'X') track.transition = { before: track.last!, after: observation };
      if (code === 'O') track.unavailableFromFirst = false;
      track.state = code; track.last = observation;
      tracks.set(key, track);
    }
  }
  const predictions: ReopenPrediction[] = [];
  for (const candidate of candidates) {
    const cells = cellsOf(candidate).map(key => tracks.get(key));
    if (cells.some(track => !track?.state) || !cells.some(track => track!.state === 'X')) continue;
    let start = -Infinity, end = -Infinity, low = false, epochSeq = 0;
    for (const track of cells) {
      if (track!.state !== 'X') continue;
      epochSeq = Math.max(epochSeq, track!.last!.seq);
      if (track!.transition) {
        start = Math.max(start, track!.transition.before.responseOffsetMs + hold - lead);
        end = Math.max(end, track!.transition.after.responseOffsetMs + hold + tail);
      } else {
        // Unavailable since its first published read: the hold (if it is one) was made before that read answered.
        low = true;
        start = Math.max(start, hold - lead);
        end = Math.max(end, track!.last!.responseOffsetMs + hold + tail);
      }
    }
    predictions.push({ candidateId: candidate.id, windowStartMs: Math.round(start), windowEndMs: Math.round(end), centerMs: Math.round((start + end) / 2),
      confidence: low ? 'LOW' : 'HOLD_EXPIRY_PATTERN', epochSeq });
  }
  return predictions.sort((a, b) => a.windowStartMs - b.windowStartMs || a.candidateId.localeCompare(b.candidateId));
}

/** Observed error of a prediction once the candidate was seen open again: observed reopening minus the predicted middle. */
export function predictionError(prediction: ReopenPrediction, observedReopenResponseOffsetMs: number): { errorMs: number; insideWindow: boolean } {
  return { errorMs: Math.round(observedReopenResponseOffsetMs - prediction.centerMs),
    insideWindow: observedReopenResponseOffsetMs >= prediction.windowStartMs && observedReopenResponseOffsetMs <= prediction.windowEndMs + 10_000 };
}

/** Rescue security prewarm plan: prepare this long before a predicted window, refresh while inside it, and stop after it. */
export const RESCUE_PREWARM_LEAD_MS = 35_000;
export const RESCUE_PREWARM_REFRESH_MS = 50_000;
/** A Rescue attempt may reuse a context prepared this recently (inside the transport's 120 s freshness limit). */
export const RESCUE_CONTEXT_REUSE_MS = 60_000;
export const RESCUE_PREWARM_MAX_PER_RELEASE = 8;
export function rescuePrewarmDue(prediction: ReopenPrediction, nowOffsetMs: number, contextAgeMs: number | undefined): boolean {
  if (nowOffsetMs < prediction.windowStartMs - RESCUE_PREWARM_LEAD_MS || nowOffsetMs > prediction.windowEndMs + 30_000) return false;
  return contextAgeMs === undefined || contextAgeMs > RESCUE_PREWARM_REFRESH_MS;
}
