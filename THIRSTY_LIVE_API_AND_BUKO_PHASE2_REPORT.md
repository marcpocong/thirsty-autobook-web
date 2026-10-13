# Thirsty Live API and Buko Phase 2 Report

Observed and tested October 14, 2026, Asia/Manila. Initial live UI/network observations were approximately 02:55–03:25 Manila; offline comparisons followed. The separately owner-approved production Browser-runner test completed at 03:45:17 Manila. No payment was made. Actual QR handoffs, compiled adapter reads, intercepted tests and packaged application checks are distinguished below.

## A. Source and build status

- Repository: `marcpocong/thirsty-autobook-web`, `main`, `C:\Users\marcp\Downloads\Thirsty Pickle Bot\Source`.
- Initial fetched `HEAD` and `origin/main`: `555cd7ae62b51e463d29c6e68d54bf58115bb433`, clean. Phase 1 report and its implementation diff were reviewed before edits.
- Booking implementation: `dc1b7952c293ef03c31ea314ad4c0e6599e1e7c1`. Offline comparator preparation correction: `4ded54c6ccd28ea5379b409480513c0d0734a1c5`. A documentation commit containing this report follows; resolve the exact final SHA with `git log -1` and the packaged `BUILD-INFO.txt`.
- Baseline: 140 files / 1,581 tests. Final full suite: 142 files / 1,607 tests. Typecheck, clean UI/runtime build and distribution verification passed. Source verification checked 398 compiled files; packaged installation verification checked 201 files with zero problems.
- First full run exposed the expected outdated Buko-disabled UI wording and the documented timing-sensitive armed-dispatch assertion. The wording was updated; both suites then passed (65 tests), followed by a green complete suite. No timing tolerance or safety gate was weakened. Recovery changes passed their focused 54-test suite and the canonical release build's complete suite.
- Implementation [GitHub CI](https://github.com/marcpocong/thirsty-autobook-web/actions/runs/38454916874) passed. Final-tip publication/build verification is recorded locally in `.local/phase2-live/final-publication.json` and the final response.
- Version remains `0.1.0`. Clean separate package: `.local/build/onda-phase2-2026-10-14/Thirsty Pickle Bot.exe`. The implementation package was `dc1b795-27ce76c426`, content ID `27ce76c426842ce147ac6ade9a36f7cf1f5cf1ff2d3968645e88a87ad7559601`, launcher SHA256 `F97F1D4C5915F4FC10145A58D92597EAAC7340443CCA09981A56B3064F2EEB1C`. A clean final-tip package supersedes its metadata in the same separate output folder; consult that folder's `BUILD-INFO.txt` for final provenance.
- Existing installation stays at `c2d365d564116b207f7ea60baa45f460befa00c4`. Its EXE and both source/installed saved configurations match the preserved Phase 1 SHA256 records. No installation replacement, customer-binding rewrite, browser-profile export or configuration migration occurred. The new separate package does not contain the authenticated worker fleet or private contacts.
- Architecture remains one shared Strategy compiler and authoritative `PRECISION_PHASE3`, dedicated Chrome workers, prebuilt armed transport, durable journals and locks, isolated Slot Watch, manual payment and existing Stop/reconciliation protections.

## B. Verified endpoint inventory

Facility and client identifiers are the registry's existing public UUIDs. `{customerId}`, `{bookingId}`, `{bookingNumber}` and `{transactionId}` below are placeholders; no private IDs, cookies, tokens, proofs or QR/payment credentials are included. "Normal guest session" describes the successful official browser workflow; it does not prove a route accepts every unauthenticated client.

| Endpoint | Method / purpose | Context and response | Mango | Buko | Observed status |
|---|---|---|---|---|---|
| `/book/thirsty-pickle` | GET venue page | Public HTML/Next metadata: facility, registered spaces, schedules, prices, maintenance, checkout limits | Yes | Yes | Working |
| `/api/public/facilities/{facilityId}/date-availability` | GET dated availability | Normal browser session; `success`, `data.dates`, `data.slotsBySpace`, optional member-only slot context; hourly pricing segments | 112 scoped cells | 56 weekday evening / 112 Friday cells | Browser 200; Node 403 |
| Same route without `includeSchedule` | GET calendar range | Normal browser; `success`, date-to-boolean `data` | Shared calendar flag | Shared calendar flag | 200; cannot establish wing publication |
| `/api/public/spaces/bookings?spaceIds={spaceId}&date={date}` | GET occupancy | Node and browser; `success`, `data[spaceId][]` containing date/start/end/bookingStatus | Court 2 tested | Court 4 tested | 200; occupancy only |
| `/api/public/facilities/{facilityId}/member-access` | GET membership feature presence | Official page; `success`, `data.hasMemberships` | Facility scoped | Facility scoped | 200 |
| `/api/public/clients/{clientId}/classes` | GET public classes | Official page; successful array, empty in observation | Client scoped | Client scoped | 200; not court availability |
| `/api/public/clients/{clientId}/promotions` (optional `date`) | GET promotions | Official page; successful array, empty in observation | Client scoped | Client scoped | 200; not proof authority |
| `/api/public/check-facility-member` | POST membership check | Official review workflow; `success`, `isMember` | Observed | Observed | 200 |
| `/api/public/customers` | POST resolve configured guest | Official review; `success`, customer identity object; values remain private | Observed | Observed | 200 |
| `/api/public/customers/{customerId}/memberships` | GET customer memberships | Legitimate review/checkout session; schema-only capture | Observed | Observed | 200 |
| `/api/public/is-slot-available` | POST exact fresh slot check | Official final checkout; `success`, fresh `availabilityProof`; proof values never saved | Request/status observed | Successful schema captured | 200 |
| `/api/bookings/public-checkout` | POST create temporary reservation | Normal final action; hourly items, sessions, pending bookings/transaction, trusted totals, expiry, private checkout capability | QR verified | Accepted Buko shape captured and validated | 200; shared-checkout Buko attempt 409 |
| `/api/transactions/{transactionId}/paymentMethod` | PATCH select QRPH | Official checkout initialization; payment method selection, not a paid confirmation | QR flow observed | Response schema captured | 200 |
| `/api/public/bookings/booking-no/{bookingNumber}` | GET official checkout access | Browser's normal grant flow; private checkout capability excluded from evidence | Observed | Observed | 200 |
| `/api/public/bookings/{bookingId}` | GET hold/recovery status | Authorized checkout polling; booking/session identity, dates, rate, pending status, expiry, resume flag; capability excluded | Exact hold independently checked | Response schema captured | 200 |
| `/api/xendit/create-payment-request` | POST generate QRPH handoff | Official QR initialization; amount/channel/status, QR string and payment URL (values excluded) | Request/status and canvas observed | Successful schema captured | 200; no payment completed |
| `/api/xendit/verify-payment` | POST read payment status | Official UI's automatic pending-status check; status, booking/payment status, conflict flags | Observed | Observed | 200; no simulated or actual payment invoked |

Single-date read query preserved by the bot:

```text
startDate=<date>&endDate=<date>&duration=60&includeSchedule=true&slotDateMode=web-operating-day
```

The site additionally uses `includeMemberOnlyAccess=true`, occasional `fresh=true`, range reads and nearby-date prefetch. The bot's unchanged query worked in Chrome without adding those flags. Response headers included `content-type: application/json`, availability `cache-control: private, no-store`, `age: 0`, `x-vercel-cache: MISS`, provider date and matched route. Other metadata routes showed public cache policies; one member-access response was STALE. A cached metadata response is not current slot evidence.

Public client source also references `/api/spaces`, `/api/facilities`, `/api/bookings/public-checkout/bot-verification`, checkout-context/cancellation routes, private-booking routes, and payment-finalization/simulation routes. These were source-only discoveries, not independently exercised endpoints. Private/internal routes were not enumerated, guessed or invoked. Payment-finalization and simulation were outside authorization. No unobserved route was treated as an alternative availability provider.

Evidence: `.local/phase2-live/endpoint-inventory.json`, the two sanitized Buko network/schema files, public route-pattern inventory and wing/date observations. Mango's original response listener was interrupted before the owner completed the final action; its old response bodies were not retrospectively reconstructed. Its official resource history and later normal booking-status response are separate evidence.

## C. HTTP 403 investigation and fix

The identical public availability query returned 403 in independent Node and 200 through the normal dedicated Chrome session. The Node body was a generic `success:false` refresh/error message with a diagnostic reference; it did not disclose an authorization rule or root cause. Browser-session success without the optional membership flag rules out that flag alone as the missing requirement. Endpoint path, dates, operating-day mode and facility were held constant. Origin/session/normal browser request context differ; the decisive internal server condition is **not established**.

No User-Agent/Origin spoofing, cookie extraction/replay, credential copying, security bypass, challenge automation or guessed route was used. The implemented fix is `OndaBrowserAvailabilityProvider`: one same-origin GET in an already verified worker browser, using ordinary session behavior, bounded timeout/body size, no redirect, no retry and the existing strict freshness/pricing parser. The desktop runner uses it after browser preparation. Failure remains a failure; it does not trigger an automatic checkout fallback.

The compiled adapter was verified live on October 19: Mango 112 cells / zero open; Buko 56 cells / 21 open; each excluded the other seven registered spaces. The shared planner produced exact Buko Court 4 at PHP 700, without checkout. Earlier sanitized October 14 responses also passed the real parser: Mango 112 cells / 38 open, Buko 56 cells / 13 open at that snapshot.

Independent Node availability remains **BLOCKED**. Browserless preview/audit/readiness tools and isolated Slot Watch retain their existing transport and may still report 403. They do not borrow a dispatch browser's credentials or become a second booking authority. `/spaces/bookings` remains useful as a conservative occupancy source, not a replacement for availability, pricing or fresh slot proofs.

## D. Live Mango booking test — VERIFIED TO QR (official browser flow)

- Actual target: Mango Court 2, UUID `df1a98c3-deb2-4721-949a-d5a1e54fdce0`, October 14, 2026, 12:00–13:00, PHP 600.
- Used the installed configured primary contact after its local binding passed validation; the unrelated autofill in the initial personal Chrome tab was not used for the dedicated-worker submission.
- Selected the live available cell, checked the official review and payment summary, filled configured contact details privately, and obtained the owner's action-time Terms approval. The owner completed the final confirmation after the automation-control interruption.
- Official resource history recorded `is-slot-available` 200, `public-checkout` 200 and QR payment-request generation 200. The genuine Checkout/QRPH page showed PHP 600, the exact court/date/time, Pending and a running reservation countdown.
- A later normal provider booking-status response independently confirmed facility/space, booking date, `12:00:00–13:00:00`, rate/checkoutTotal 600, bookingStatus/paymentStatus pending and hold expiry **03:10:05.317 Manila**. This establishes a real temporary reservation plus provider-generated QR handoff, rather than a QR-looking page alone.
- The initial checkout response body was unavailable after the controller timeout; no payload or latency measurement is fabricated from that gap. The later booking-status endpoint used a recovery session summary with durationHours 0; that getter shape was not substituted for the stricter checkout response schema.

No payment or paid marking occurred. This initial test used the official UI. Screenshot evidence is QR-redacted: `.local/phase2-live/mango-qr-redacted.png`; reservation facts are in `mango-provider-hold.json`.

### Separately approved production Browser-runner test — VERIFIED TO QR

After the first Mango and Buko holds expired, the owner explicitly approved one additional production bot test to QR, including the same Terms. The existing `src/booking-entry.ts` → `runBooking` → `fullBookingToQr` Browser workflow was invoked from the installed runtime working directory using the current source; this was not a fixture or a manually selected QR-looking page.

- Read-only preparation returned an exact standard target: Mango Court 2, October 14, 12:00–13:00, maximum PHP 600, one court, no fallback, zero selected cells and no detected hold.
- The private one-shot approval matched that exact request and amount. The runner's confirmation callback independently checked date, court, start, duration, court count and the single plan chunk before approval.
- Started **03:44:58.049 Manila**; exited successfully **03:45:17.940 Manila**. At **03:45:17.912 Manila**, the production handoff event verified date October 14, Court 2, hour 12:00, PHP 600, currency PHP, Pending and countdown **09:59**. The final booking result was **PAYMENT HOLD ACTIVE**.
- The Browser workflow reached the genuine QR page and stopped. No payment or further submission followed. This was the additional hold explicitly authorized by the owner, not an automatic retry of the earlier successful hold.
- Local sanitized evidence: `production-browser-prepare-result.json`, `production-browser-test-result.json`, and `production-browser-test-events.json`. These contain the exact target, successful exit and verified handoff facts without contact values, booking capabilities or QR payloads.

This closes the production **Browser** runner's Mango-to-QR proof gap. It does not establish the new API-first desktop runner's security acquisition or the packaged app's own live submission. The recorded runtime interval is not a provider response-time or server-arrival-order measurement. The last recorded additional hold state is pending; this report does not claim a fresh post-expiry reconciliation or remove its preserved lifecycle lock.

## E. Live Buko booking test — VERIFIED TO QR (official browser flow)

- Actual target: Buko Court 4, UUID `a49b62f8-5713-4e08-a69d-de9072ecc914`, October 14, 2026, 16:00–17:00, PHP 700.
- After Mango success, the owner explicitly revised the initial stop-after-first-hold instruction to continue and requested a different browser.
- A Buko final action using the first customer's pending checkout context returned a definitive application 409: an existing payment checkout was already in progress. It created no verified Buko hold. This was not an unknown timeout or ordinary slot conflict.
- Continued in the separate, verified installed Worker B Chrome profile, with its distinct configured customer/contact binding. Rechecked the exact Buko cell, official review, price and approved Terms. One guarded final action in Worker B returned 200 with one pending Buko booking, one continuous session, a pending PHP 700 transaction, trustedTotalAmount 700 and expiry **03:14:54.390 Manila**.
- Accepted item shape: exact Buko space/facility IDs, date, `16:00–17:00`, duration 60, rate/chargedAmount 700, guestCount 1, no promotion, `activityKey: pickleball`, `activityLabel: Pickleball`, `sessionRef: session_1`, and a fresh proof. Proof/customer/capability values were not saved.
- Genuine QRPH page showed the same Buko court/date/time and PHP 700 with Pending/countdown. Successful provider QR generation was captured as a schema-only response. The compiled production checkout validator later validated the actual retained in-memory response against the intended plan at the original response time; no second submission was made for this validation.
- The official flow canonicalized customer identity: booking customer IDs differed from both persisted and request identifiers, while the submitted email/phone matched the configured contact. The existing standard-response validator already permits consistent canonical customer IDs. That behavior was preserved; private bindings were not rewritten. It does not establish that the new programmatic runner's identity/security acquisition has been exercised live.

Exactly one successful Buko hold was created; no automatic retry followed success. The earlier shared-checkout 409 and independent Worker B success are recorded separately. No payment was made. Both initial hold timers elapsed; the official pages returned to schedules. At 03:25:40 Manila, leftover selected cells were deselected and both final worker schedules had zero selected cells and no Checkout heading. No cancellation endpoint or paid/finalization action was called.

Evidence: `buko-provider-hold.json`, `compiled-live-checkout-response-validation.json`, `buko-attempt-state.json`, `buko-worker-b-network.json`, `buko-qr-redacted.png`, and `post-expiry-browser-state.json` under `.local/phase2-live/`.

## F. Booking method comparison

| Method | Evidence and reliability | Authorization / recovery | Latency evidence | Recommendation |
|---|---|---|---|---|
| Independent Node API-first | Availability still 403; occupancy works but is insufficient | Existing strict authorization and journals remain; no forced fallback | No successful live end-to-end measurement | Do not use as an availability default |
| Official Browser | Official Mango/Buko flows and the production Mango Browser runner reached verified QR | Normal guest/customer/Terms flow; site refuses an existing pending checkout; stop at QR | Production Mango run interval recorded; no provider latency or server-order claim | Best currently live-proven Mango runner and official Buko flow |
| Browser-session API / Hybrid | Compiled GET/planner verified live for both wings; official slot proof and Buko accepted checkout shape captured | Shared fresh proofs, strict response validation, exact wing, journals/locks/Stop; no credential replay | Availability reads observed; new desktop submission not measured live | Evidence-backed bot integration; full runner-to-QR still unverified |
| Calendar-Free proof-based | Current fresh slot/proof and public-checkout shape remain present | Uses the existing one-shot approval/permit and journal protections | Offline validated; no separate live runner measurement | Retain guarded behavior; Buko exact Normal added |
| Proofless | Official accepted UI payload contained a fresh proof; proof omission was not tested live | Existing Mango-only authority and strict dispatch gates preserved | Local intercepted dispatch only | No Buko support; no current live proofless acceptance claim |

No saved default method was silently changed. Buko's explicit Test Now request uses the supported browser-session, proof-based Normal path and displays that choice separately from the saved Mango release strategy.

## G. Release mechanism findings

Read-only normal browser samples around 03:07 Manila:

| Target date | Mango cells / open | Buko cells / open | Confirmed implication |
|---|---:|---:|---|
| October 15 | 112 / 73 | 56 / 15 | Both wings have currently open hours |
| October 16 | 112 / 0 | 112 / 59 | Buko is open; Mango is not open in this sample |
| October 19 | 112 / 0 | 56 / 21 | Buko is open farther ahead; Mango is not open |

The endpoint's facility date flag was true on all three dates. It is not a wing publication flag. Buko has only evening slots on Thursday/Monday and full-day slots on Friday, matching the observed weekly schedule. Different maintenance/occupancy counts remain per-court evidence.

Mango's existing target offset 2 / 08:00 Manila is preserved. No live 08:00 transition was observed in this session. Buko's rolling horizon, recurring release time, inclusive count or manual/court-specific publication mechanism remains unverified; no 5-day or 08:00 rule was invented. The new Normal path uses currently open exact Buko cells without requiring or inventing a release policy. Buko release Strategy, scheduled arming, Proofless and Shotgun remain rejected at the backend boundary.

`wingWorkflow` now requires **all** requested cells open to advertise Book Available Now. Partial targets stay unknown. Explicit closed cells before a known future Mango release are no longer mislabeled fully booked. No scheduling signal is inferred from a facility-wide true flag or an occupancy list.

## H. Shotgun comparison

All six cases used the exact central production dispatcher in isolated interception: 10 measured runs plus two warm-ups, a single synthetic logical target, six-second preparation lead, prewarm concurrency four, unchanged 50 ms trigger deadline, and synthetic security work (CPU 0 / wait 0). Machine: i5-13500HX, 20 logical cores, 32 GB, Windows 10.0.26300; Node 24.15.0; Chrome 154.0.8037.99; source `4ded54c`. No provider booking requests were sent. Intercepted responses were deliberately rejected; that outcome is not a provider acceptance test.

| Schedule | Tabs by worker | Min gap ms | Intercepted shots | p50 / p95 / max ms | Compressed pairs | Omissions | Local verdict |
|---|---|---:|---:|---|---:|---:|---|
| dense-20 | A:6, B:6, C:6, D:2 | 1 | 200/200 | 3.03 / 3.87 / 4.78 | 8 | 0 | AT_RISK |
| wide-5 | A:5 | 500 | 50/50 | 3.27 / 4.22 / 4.49 | 0 | 0 | READY |
| wide-8 | A:6, B:2 | 285 | 80/80 | 3.55 / 4.64 / 5.01 | 0 | 0 | READY |
| wide-10 | A:6, B:4 | 222 | 100/100 | 3.41 / 4.37 / 5.06 | 0 | 0 | READY |
| wide-15 | A:6, B:6, C:3 | 142 | 150/150 | 2.93 / 3.90 / 4.25 | 0 | 0 | READY |
| wide-8-round-robin | A:2, B:2, C:2, D:2 | 285 | 80/80 | 2.86 / 3.54 / 3.90 | 0 | 0 | READY |

The timing column measures trigger-to-Chrome request initiation. All cases had zero outside-tolerance triggers and zero unready workers. Dense 20 remains **AT_RISK**, with eight measured compressed pairs: seven at offsets −2→−1 ms across workers C/D and one at −1→0 ms within D. Those one-millisecond planned gaps are below the observed roughly 3–5 ms trigger-to-Chrome overhead; the cross-worker pair dominates. This is evidence of insufficient local separation, not proof of the exact internal scheduling cause or provider receipt compression. No threshold was relaxed.

| Schedule | Prewarm duration p95 ms | Smallest last-ready margin ms | System busy p50 / p95 % | Node CPU p50 ms per run |
|---|---:|---:|---|---:|
| dense-20 | 31.5 | 5794.36 | 8.7 / 11.6 | 922 |
| wide-5 | 23.5 | 5910.54 | 7.8 / 10.7 | 594 |
| wide-8 | 31.1 | 5826.44 | 9.0 / 18.3 | 892 |
| wide-10 | 31.2 | 5820.93 | 11.5 / 21.1 | 1141 |
| wide-15 | 31.3 | 5818.31 | 10.5 / 11.9 | 1624 |
| wide-8-round-robin | 31.0 | 5935.60 | 8.3 / 9.6 | 891 |

For an operator-reviewed lower-density candidate, **wide-5** is the smallest tested schedule: offsets −2000, −1500, −1000, −500, 0 ms, five tabs on one worker, 50/50 intercepted attempts, no omissions/compression, p95 4.22 ms. Eight shots distributed over four workers had the lowest measured p95 (3.54 ms), but require more worker processes. The ten-run samples and sequential comparison do not establish a statistically winning configuration; system load was observed rather than controlled to an identical level. Synthetic security preparation does not prove real security readiness.

No saved plan, default, authorization or timing profile was overwritten. These results are bound to the measured source/machine/topology; the final documentation-build SHA differs. Do not promote or reuse them as final-build live readiness. Provider request-rate permission, verified release context and exact saved operator consent remain unestablished. No live Shotgun test was run; the existing Dense 20 live block remains.

Evidence: `.local/shotgun-comparison/phase2-ready-preparation/comparison.json`, per-case summaries and raw attempt records. Earlier too-late synthetic preparation observations remain preserved separately; the comparator correction starts before the existing preparation cutoff rather than changing that gate.

## I. Production-readiness matrix

| Capability | Verdict | Evidence / remaining limitation |
|---|---|---|
| Mango Browser booking | VERIFIED TO QR | Official UI plus separately approved exact production Browser-runner test; verified Pending QR handoff |
| Mango API-First booking | OFFLINE VERIFIED | Browser-session read is live verified; checkout regressions pass. Independent Node read remains blocked, new desktop end-to-end unverified |
| Mango Hybrid booking | OFFLINE VERIFIED | Existing API/UI intersection and regressions retained; normal website flow live verified, no separate hybrid-runner live test |
| Mango Shotgun | BLOCKED | Saved Dense 20 remains AT_RISK; alternative local timings do not establish provider rate permission, exact operator authorization or real security readiness |
| Buko availability checking | VERIFIED TO QR | Live browser API response and compiled scoped parser/planner verified; the same wing was booked via official UI to QR |
| Buko normal booking | OFFLINE VERIFIED | Official site VERIFIED TO QR; new exact-date bot path, response validator, journal identities, recovery and UI tested. Full desktop-runner submission still unverified |
| Buko scheduled release | BLOCKED | Recurring release policy unknown; backend rejects scheduled Buko requests |
| Buko Shotgun | BLOCKED | Buko only supports exact Normal requests; release policy/provider rate authority unverified |
| Windows packaged application | OFFLINE VERIFIED | Clean independent packaging/dist verification and packaged runtime UI smoke; no private authenticated fleet, no package-driven live booking |

The allowed four labels cannot express "read-only verified" separately. Buko availability's VERIFIED TO QR refers to live read verification plus the official same-wing QR test; it does not promote the new Buko desktop booking path to live verified.

## J. Operator instructions and remaining work

1. Keep the installed app as-is until you intentionally install the separate package. Review the package's `BUILD-INFO.txt`; its private customer/profile fleet is not bundled. Existing installed/source configuration hashes are preserved.
2. Existing saved Strategy and Next Release court numbers remain Mango. Use their unchanged Normal/Shotgun workflow and readiness checks. The 20-shot strategy was not reduced or rewritten.
3. For an open Buko date, use the new package's Test Now view: choose **Buko Wing · Book Available Now**, the exact Buko court and date. The displayed time and 1–3-hour duration come from the saved plan. This request uses one court and no fallback substitution; it does not save over the Mango release plan. Prepare, review the exact facts, authorize Terms, then run to QR. A closed/incomplete target, existing hold, unverified identity, challenge or unknown outcome blocks progress. Human verification stays manual.
4. The strongest live-proven fallback is the official browser UI. If the new runner cannot obtain legitimate session/security/proofs, use that flow; do not force API-first, replay a token, weaken validation or turn off gates.
5. At QR, verify wing, court, date, time, amount and pending hold. Automation stops; payment remains yours. Never retry an unknown result. An existing payment checkout is not a slot-contention rejection to spam.
6. Buko recurring release and Shotgun remain disabled. Preserve Mango's 08:00 settings. Further read-only observations of publication transitions or authoritative operator/provider evidence are needed before enabling a Buko release policy.
7. Wider Shotgun offsets are a measured local option, not a winning provider strategy. Adopting one is your explicit saved-plan decision; it needs matching final-build/machine/topology evidence, real security readiness and provider request-rate evidence before a live release experiment. No live Shotgun was run.
8. Remaining proof gap: a complete new API-first desktop-runner/packaged-app execution to QR, including its own legitimate identity/security acquisition and official handoff. This session proved official UI transactions, live compiled reads/planning, actual Buko checkout-response compatibility and offline safeguards. The production Mango Browser runner also reached verified QR under separate owner approval. No package-driven or API-first live booking result is claimed.

All raw timing results and sanitized network/hold schemas remain local under `.local/shotgun-comparison/` and `.local/phase2-live/`. Existing append-only historical evidence was untouched. Git contains source/tests/docs only; no private profiles, configuration, credentials, customer values, proof values, checkout capabilities, QR payloads, signing/payment URLs or logs were committed.
