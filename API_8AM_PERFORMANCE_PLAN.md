# Prewarmed API-first release preparation

Status at **2026-09-18 02:23 Asia/Manila**: An isolated, read-only prewarmed runner is implemented and measured off peak. It has no checkout transport or submission permit import and did not create a reservation. Independent checkout verification remains unsupported; the prior 02:00:05 journal intent is still `unknown`. The complete release-to-pending-reservation time is **not measured**.

## Current browser critical path

The production path triggers at 08:00, may reload the official page, waits for the venue shell and enabled date picker, navigates to the released date, waits for 16 rows and all 112 grid cells, validates that snapshot, chooses and clicks cells, then progresses through Review Booking, Player Information, Payment Summary, Terms, final action, and official hold/QRPH handoff. Hybrid availability starts an API read early but still waits for the full grid before resolving and selecting a preference. This is the browser rendering dependency the API-first design removes from **candidate preparation**.

Historical evidence has wide variance. The September 11 08:00 log recorded reload commit at +335 ms, shell ready at +18,518 ms, target-date click at +19,415 ms, then failure before grid readiness. Another log recorded shell ready at +1,264 ms, grid ready at +1,591 ms and Proceed clicked at +2,774 ms. An off-peak observed reload reached commit in 182 ms, shell in 2,252 ms and a validated target grid in 7,288 ms. These are separate runs and do not supply a like-for-like release-to-pending baseline.

## Prewarmed architecture

`src/api-booking/prewarmed-runner.ts` reads the saved configuration and privately validates the configured customer ID before waiting. It calculates the next release and target date from the configured timezone and horizon. Optionally it verifies and attaches once to the already running dedicated Chrome A process and exact Onda venue tab. It never launches Chrome, navigates, reloads, waits for the calendar, selects a cell, or invokes Onda checkout. It reports readiness and blockers before waiting.

At the release time it performs **one** availability GET, parses and ranks candidates using the saved preferences, requests fresh hourly slot proofs for the first candidate with bounded concurrency of two, and constructs the validated standard one-court checkout body in memory where supported. It prints only court/time/amount, counts and timings. Proofs and the customer identity are not printed or persisted. The request is discarded after the read-only run. There is no polling of Onda endpoints while waiting and no live reservation call. An exact benchmark override is available only with `--benchmark-date` so the saved desktop plan remains intact.

The saved desktop setup currently says `browser`, standard **three hours, 15:00–18:00**, courts 7 through 1, and PHP 10,000 maximum. The live isolated reservation adapter validates only a **one-court, two-hour** response. The previous Court 6, 12:00–14:00 trial is a separate candidate, not the saved release plan. The runner reports both the method mismatch and adapter mismatch; it does not silently convert the saved plan.

### Before release

Load configuration and preference order; validate the private contact-bound customer ID; calculate the release and target dates; instantiate the API provider; inspect the unresolved journal; optionally verify and attach Chrome and confirm the venue title. Node startup, Chrome startup, full app loading, and customer preparation should occur before 08:00. The runner does not start Chrome or create a customer. It leaves the browser on its existing page.

### At or after release

Record intended and actual trigger times; fetch and parse current availability; select an available candidate under the configured preference and price ceiling; acquire distinct fresh hourly proofs; construct the request in memory. Checkout-time Turnstile verification, one-shot journal claim, reservation POST, strict pending validation, and official QRPH restoration remain gated until Onda supplies a supported verification bridge and the prior intent is reconciled. No verification token is acquired early or cached.

## Commands and measured timings

The new command is `npm run api:prewarm -- [--release-date YYYY-MM-DD] [--attach-browser]`. Without a date it calculates the next 08:00 Asia/Manila release; `--release-date` selects a future release day and still waits without refreshing Onda. For an already released read-only measurement, use `npm run api:prewarm -- --benchmark-date YYYY-MM-DD [--attach-browser]`. An explicit two-hour benchmark candidate can be specified with `--benchmark-two-hour HH:00 COURT`; this affects only the benchmark and does not save a plan.

The runner emits `API_PREWARM_READY` and `API_PREPARATION_RESULT` JSON records. Elapsed durations use Node's monotonic `performance.now()`. Wall timestamps are separate UTC ISO values. Availability headers time is measured from fetch start until response headers; the availability engine's `responseReceivedMs` includes body reading and provider validation. Slot header durations are recorded separately from the full proof stage. Browser attachment and process startup are outside the release path when the runner is started early. Null timing fields mean the stage was not performed.

| Off-peak observation, September 18 | Measured result |
| --- | ---: |
| Saved 15:00, three-hour plan: startup / Chrome attachment / availability and planning | 515 / 2,309 / 311 ms; no candidate, so no proofs |
| Court 6, 12:00–14:00 benchmark: startup / Chrome attachment | 502 / 2,442 ms, before the simulated trigger |
| Court 6: availability response headers / availability through planning | 397 / 409 ms |
| Court 6: candidate ranking after parse / two hourly proofs / in-memory request construction | 0.9 / 359 / 0.3 ms |
| Court 6: trigger to validated read-only preparation | **769 ms** |
| Checkout verification / submission / pending validation / QRPH handoff | **Not measured** |
| Complete release-to-pending reservation | **Not measured** |

The Court 6 proof request header durations were 248 and 357 ms. The two requests ran concurrently and the overall proof stage was 359 ms. No visual calendar operation was in this measured API preparation stage. Comparing 769 ms with the 7,288 ms off-peak browser grid observation suggests a potential preparation benefit, but these are different times and workflows. It is **not** a measured booking speedup or a forecast for 08:00 congestion. The first actual 08:00 API trace must separate Onda availability/proof network delays from local scheduling and browser rendering; the first accepted checkout must additionally measure verification, request/response, validation and handoff.

## Safety and remaining gate

The runner reports `CHECKOUT_VERIFICATION_BINDING_UNSUPPORTED`, `EXACT_BOOKING_APPROVAL_REQUIRED`, and `PRIOR_INTENT_UNRECONCILED`. The 02:00:05 Court 6 journal record remains `unknown`; the consumed permit and journal were not deleted or reset. Public availability does not authoritatively reconcile it. The official frontend's Turnstile and fingerprint helpers are module-local, with no supported external binding yet. Browser attachment by itself does not solve that. The runner cannot submit a reservation even if the release time arrives.

The specific next step toward a genuine API reservation is an Onda-supported checkout verification interface and an authoritative operator/provider search resolving the 02:00:05 attempt. Then a separate two-hour plan must be chosen from fresh availability, reviewed for exact court/date/hours/price and hold effect, and explicitly approved before one new API POST. Its pending bookings, transaction, common expiry and official QRPH page must be validated before the user pays manually. No experimental change was merged into main, and production browser/hybrid files were not changed.

`npm run typecheck`, `git diff --check`, and four relevant offline test files (**24 tests**) passed. The read-only runner was exercised twice against the already released September 18 date with the verified Chrome A tab. The first used the saved plan and found no candidate; the second used the explicit Court 6 benchmark override, obtained two valid proofs, and prepared two checkout items without dispatch. The future release waiting path and a genuine 08:00 run have not been exercised.
