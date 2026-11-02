# Four-court, eight-child preparation qualification

Owner intent: release 2026-11-03 08:00 Asia/Manila; Mango service 2026-11-05,
19:00–22:00; priority 5 → 6 → 7 → 4; A→5, B→6, C→7, D→4; two children each.
This assignment permits development, intercepted testing, saving and preparation only.
It grants no production submission permit, arming, payment or cancellation authority.

## Literal schedule and limits

The existing CUSTOM pre-release policy is used separately from optional ZERO_BOUNDARY_V1:

| Worker | Court | Offsets relative to release (ms) |
|---|---:|---|
| A | 5 | -840, -360 |
| B | 6 | -720, -240 |
| C | 7 | -600, -120 |
| D | 4 | -480, 0 |

Chronological spacing is 120 ms, above the existing 105 ms local reference. This narrows
the historical two-second interval without asserting a provider publication or network
advantage. No positive offset, silent clamp, early local firing or deadline extension is
introduced. The existing trigger +50 ms gates remain at scheduler, Node and renderer.
Provider receipt time and publication time remain unknown. Calibration is local only.

Eight is a maximum configured budget. Explicit rejections may leave all eight eligible;
valid provisional responses suppress later children of that court, UNKNOWN stops later
unsent children globally, and active identical targets remain protected. Requests already
in flight settle independently. A quota of minimum one / ideal four retains all four
immediate courts. Wave 2, Rescue, standby consumption and automatic fallback are disabled.

Each checkout is capped at PHP 2,100. Four unique three-hour holds represent PHP 8,400;
eight hypothetical successful children represent PHP 16,800 of pending-hold exposure.
Neither quantity represents a payment or guarantees that duplicate holds are possible.

## Targeted safety repair

HTTP 401/403 booking responses now stop all later unsent Shotgun children through an
explicit SHOTGUN_PROVIDER_ACCESS_STOP. The production callback carries that stop into
later phases. A confirmed rejection stays rejected; an ambiguous denial stays UNKNOWN.
An unsent local refusal remains unsent. Existing 429, provisional, payment and duplicate
stops retain their behavior. No denial is retried to fill the configured budget.

## Offline evidence

`tests/four-court-qualification.test.ts` uses the real objective compiler, isolated Chrome,
freeze, armer, dispatcher, transport and journal with blocked external networking. It
exercises eight children, exact offsets, four distinct courts, successful synthetic lookup
validation, HTTP 200 without persistence, the observed HTTP 400 rejection text, access
denial, throttle, concurrent in-flight responses, missed deadlines, prior holds, UNKNOWN
restart barriers and A–G/fourteen-child capacity. Results expose configured, authorized,
sent, suppressed, omitted, provider-fixture-confirmed and HTTP response counts separately.

Lab success uses a separate synthetic lookup representation and the production exact
provider validator. It does not prove a live provider hold or QR. Separate exact-date,
exact-hour A/B/C/D recovery fixtures exercise the production provider and QR validators,
profile/token separation, durable journals and repeated recovery without new creations.
Their page is synthetic; they do not establish live browser QR delivery or release success.

The local runner and CI isolate this browser suite from other strict timing suites. No
test timeout, 50 ms allowance, identity assertion or UNKNOWN barrier is relaxed.
Initial failures and any native Windows child exit are retained in local evidence; a
later pass is not a claim that an unexplained native failure has been repaired.

Installation, live preparation, exact saved fingerprints and final counts are recorded
in the workspace `SHOTGUN_FOUR_COURT_EIGHT_ATTEMPT_PREPARATION_REPORT.md`.
