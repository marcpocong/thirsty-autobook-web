/**
 * Controlled Release Timing: the operator may schedule the release trigger up to two seconds
 * before the official release instant. Only the pre-armed Proofless Direct dispatch (General and
 * Precision Wave 1) uses the trigger. The official instant (releaseMs) stays the reference for
 * everything else: journals, the lock, Slot Watch, forensics, adaptive attempts and the
 * maximum-lateness bound. 0 ms (the default) keeps the original never-early behaviour exactly.
 */
export const RELEASE_OFFSET_MIN_MS = -2_000;
export const RELEASE_OFFSET_MAX_MS = 0;
export type ReleaseOffsetMs = number;

export const isReleaseOffsetMs = (value: unknown): value is ReleaseOffsetMs =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= RELEASE_OFFSET_MIN_MS && value <= RELEASE_OFFSET_MAX_MS;

/** The scheduled trigger instant for an official release instant. Throws on an out-of-range offset. */
export function releaseTriggerMs(releaseMs: number, offsetMs = 0): number {
  if (!Number.isSafeInteger(releaseMs) || !isReleaseOffsetMs(offsetMs)) throw Error('RELEASE_OFFSET_INVALID');
  return releaseMs + offsetMs;
}

/** A legacy trigger is valid only from two seconds before release through release. */
export const isValidReleaseTrigger = (releaseMs: number, triggerMs: number) =>
  Number.isSafeInteger(releaseMs) && Number.isSafeInteger(triggerMs) && isReleaseOffsetMs(triggerMs - releaseMs);

/** Operator wording, e.g. "−50 ms" or "0 ms". */
export const formatReleaseOffset = (offsetMs: number) => offsetMs < 0 ? `−${-offsetMs} ms` : offsetMs > 0 ? `+${offsetMs} ms` : '0 ms';
