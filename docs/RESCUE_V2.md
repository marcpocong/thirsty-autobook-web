# Reopen Rescue V2

Pending holds expire ten minutes after the checkout that created them. On 2026-09-29, holds made at about +4–6 s disappeared at +604–606 s, and C3/C7 21:00–24:00 stayed open for at least 141 s with nothing running to act on it. Rescue is now part of every Smart strategy.

## What Rescue acts on

- **Only authorized candidates.** The Strategy Engine gives every pool window Rescue permission. Priorities follow the goal (duration order, prime fit, court order), so Rescue inherits the configured preferences; there is no separate Rescue preference model.
- **Only a genuine reopening.** The candidate must be seen unavailable and then **freshly** open again. The existing freshness model is authoritative: represented time, cache `Age` and request/response timing. The fitness classes are `ACTIONABLE_FRESH`, `ACTIONABLE_BOUNDED_CACHE` and `FORENSIC_ONLY_*`. A later `STALE Age:10` response never replaces fresher evidence.
- **Final checks.** Selection is followed by revalidation, a durable reservation and the final pre-POST gate. Price changes invalidate or rebind under the existing rules.
- **UNKNOWN blocks every later adaptive send.** A verified hold blocks conflicting sends. Rescue never races another in-flight attempt.

## Worker reuse and readiness

Rescue uses standby workers first. It then uses immediate workers whose attempts all settled: reuse after a conclusive rejection. No reuse is possible after an UNKNOWN, because an UNKNOWN blocks every adaptive send.

Workers with a usable prepared context are preferred. Wave 2 and Rescue reuse an **unused** security context prepared within the last 60 s: standby preparation at T−30 s, or a Rescue prewarm. The transport still refuses anything older than 120 s at the POST.

Before V2, standby preparation was never reusable by Wave 2, because the reuse window was 20 s. Rescue always paid a fresh preparation, measured at 3.5–8 s.

## Reopen prediction (prepare, never send)

`src/api-booking/reopen-prediction.ts` works from fresh reads after release. For each unavailable Rescue candidate it predicts a window ten minutes after the latest open → unavailable transition of its hours. Every hour must have expired, so the latest window wins. An hour that was unavailable from its first published read gives only a LOW-confidence window.

The runner uses a prediction only to prepare:

- about 35 s before the window it refreshes the security context of the worker Rescue would use first;
- it refreshes again every 50 s while the window lasts;
- this is bounded to 8 preparations per release and one at a time;
- it never runs while an adaptive attempt is in flight, or after an UNKNOWN or a verified hold.

**Reaching a predicted time never selects or sends anything.**

Every Rescue selection logs the prediction's observed error (`RESCUE_PREDICTION_OUTCOME`), for tuning.

## Slot Watch support

Slot Watch already schedules bounded 1 s availability reads and 2 s public-booking reads around each predicted expiry window, with an in-flight cap. It records skipped launches (`not-launched`, with reason and in-flight count), in-flight counts per read and overlapping-read flags. It now also scores its own expiry predictions against the first observed reopening per cell (`quality.expiryPredictions`). History & Insights shows this under "Reopen prediction accuracy".
