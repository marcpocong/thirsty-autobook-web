# Thirsty Workflow Modernization and Multi-target Shotgun Report

Implemented and verified October 14, 2026, Asia/Manila. This assignment authorized implementation, offline intercepted checkout tests, Windows packaging and publication to main. No new live booking, temporary hold, payment or live Shotgun burst was performed. Historical genuine QR evidence remains explicitly historical.

## A. Repository and build

- Repository: `marcpocong/thirsty-autobook-web`, existing `main` checkout in `C:\Users\marcp\Downloads\Thirsty Pickle Bot\Source`. Fetch confirmed a clean starting `HEAD` and `origin/main` at `d630f67f11c2f1f750d277bd04d892553f967e6e`.
- Implementation: `8bddf1084ebaea339808c7293f43c23ef5d3b925`. CI correction/measurement honesty: `c2bca0a4a551c239b9e7648af5a001c064234e63`. The report-containing documentation commit is the final publication tip; its exact full SHA and content identity are recorded in the separate package's `BUILD-INFO.txt` and local `.local/modernization/final-publication.json`. This avoids inventing a self-referential SHA inside its own commit.
- Baseline: 143 test files / 1,609 tests. Initial baseline had one timing-sensitive observer-stop failure (1,608 passed), without any engine edits. Final complete local suite: **145 files / 1,621 passed**. Focused workflow, observer and safety checks also passed. Typecheck, clean UI/runtime build and source distribution verification passed. The implementation canonical build checked 404 compiled files with zero problems; final package verification is recorded in the final publication record.
- The first implementation CI [run](https://github.com/marcpocong/thirsty-autobook-web/actions/runs/38530440890) failed its hold-state regression, which also failed in loaded local suites while passing in isolation. The state test now controls its test clock and still asserts verified QR, the second rejection and the independent lock error. All real-clock deadline tests, production 50 ms Shotgun tolerance and refusal gates remain unchanged. The corrected implementation [CI run](https://github.com/marcpocong/thirsty-autobook-web/actions/runs/38532423566) passed. The final documentation-tip CI is checked separately before handoff and recorded in the final publication JSON.
- Separate Windows package: `Source/.local/build/workflow-modernization-2026-10-14/Thirsty Pickle Bot.exe`. Version stays 0.1.0. Consult its `BUILD-INFO.txt` for final source SHA, build ID, content ID and launcher SHA256. The final handoff verifies package provenance against local HEAD and GitHub main. The packaged Electron runtime smoke verified Home, navigation, Buko court controls, UNKNOWN unverified slots and zero renderer errors. It did not prepare a booking browser, read live court availability, submit, or pay. The package is rebuilt for the final documentation tip, and the same runtime smoke is rechecked before handoff.
- The existing installed app remains at `c2d365d564116b207f7ea60baa45f460befa00c4`. Installed EXE, installed/source saved configuration and original build-information digests were recorded and rechecked unchanged. No private profile fleet, contacts, customer bindings, security material or lifecycle journals were copied into the separate package or committed.

Changes are concentrated in existing source/UI/tests plus three operational availability modules, the isolated browser observer, and the caller audit. Exact changed files are available through `git diff --name-only d630f67..HEAD`. Main was pushed normally, without force-push. Final-tip CI, remote SHA equality and the preserved installation digests are checked before completion and captured in the final publication record.

## B. Availability modernization

The dependency inventory is [docs/AVAILABILITY_CALLER_AUDIT.md](docs/AVAILABILITY_CALLER_AUDIT.md). The shared parser remains authoritative; its freshness, registry UUID, currency, per-slot pricing and completeness checks were preserved.

Operational desktop discovery already used Chrome. Its release/audit snapshot reader now refuses a missing prepared page instead of falling back to standalone Node. Court-hour audits and CLI previews attach read-only to a verified dedicated Worker A schedule. They never navigate that attachment, acquire checkout security or copy/replay cookies. The new court browser reads both wings sequentially through the existing browser provider. No request retries were added.

Network Readiness uses the verified browser path. An explicitly injected Node fetcher remains for offline comparison tests. Browser connection protocol/reuse cannot be inferred from Node's DNS/TCP hooks: its new/reused connection totals are null and displayed as unmeasured. Availability failure does not turn into a successful read.

The old `OndaLiveAvailabilityProvider` remains the browser adapter's parser/HTTP base and a regression/historical implementation. Five experimental entry points (`prewarmed-runner`, `calendar-free-live-attempt`, `calendar-independent-probe`, `verify-candidate`, `real-checkout-dry-run`) now refuse immediately with `LEGACY_ENTRYPOINT_RETIRED_USE_DESKTOP_RUNNER`. Their historical source was retained rather than deleted. Standalone public-read concurrency/probe experiments remain explicitly outside booking decisions. The archived `api:prewarm` command consequently refuses; use the guarded desktop preparation workflow.

Public occupancy remains supplemental. Known public conflicts can block a target, but an absent record cannot establish publication, price or openness. Browserless failure is UNKNOWN with a preparation/verification recovery action. The previous independent Node HTTP 403 is historical evidence from the Phase 2 report; this assignment did not establish a new provider root cause or claim that Node was repaired.

## C. Slot Watch

The desktop launches the existing isolated Node observer child with a separate persistent Chrome guest observer at `.local/slot-watch/observer-chrome-profile`. It does not connect to dispatch CDP endpoints, copy a worker profile, resolve customer identities or acquire worker checkout security. Browser context routing blocks every non-GET request and service workers; its availability GET stays same-origin and uses ordinary guest-session behavior.

The venue title and page identity are verified before reads. Missing/closed/wrong-venue browser states produce UNKNOWN. An access refusal or throttle stops additional availability network requests for that observer session; recorded failed observations remain visible. Observer startup failure still leaves the occupancy/historical observation process useful and explicitly unknown for availability. Existing request cadence, in-flight ceiling, timeouts, request/response timestamps, append-only logs, cache/provider metadata, historical records and observer IPC isolation are retained. Stop during startup is remembered; the browser closes before completion is reported.

New routed real-Chrome tests verify read parsing, metadata preservation, POST refusal, closed-browser refusal and wrong-venue cleanup. The production observer process/IPC regressions remain covered. **The new guest observer has offline verification; a sustained live release-window read run is unverified.** It cannot solve or bypass a site challenge. Its release matrix remains Mango scoped, because Buko has no verified recurring release policy. Replacing a still-closing observer can fail closed on the profile lock; wait for Stop to finish before starting another watch.

## D. UI/UX redesign

Previously the app opened on a technical release dashboard and relegated open-date booking to Test Now using saved release hours. It now opens on Home with two goal actions: **BOOK AVAILABLE NOW** and **PLAN NEXT RELEASE**. Navigation is Home / Book Now / Next Release / Edit Release Plan / Live / History / Settings. Keeping edit and saved-release review distinct preserves the existing operator review boundary.

Book Now independently selects wing, target date, exact court, start and 1–3-hour duration. It displays the Normal/fresh-proof request and no-substitution rule. These edits invalidate preparation and Terms but do not save over the Mango release strategy. The default safe goal is one exact court. The existing saved-plan option preserves previously supported advanced Normal combinations; this change does not authorize new multi-court checkout shapes.

The existing release preference editor, historical suggestions, priorities, editable exact rows, manual addition, reset provenance and saved/reopened authoritative plans are reused. Release suggestions remain suggestions, not evidence that unreleased slots are open. Advanced engine, workers, offsets and diagnostics stay in drawers. Focused and Diversified choices and their allocation editor are promoted into the primary Shotgun area. The final review is still generated by the existing compiler.

Book Now has one state-dependent primary action: Prepare, then Review & Book. Existing per-run Terms, confirmation, locks, readiness and retained-QR protections remain. Emergency Stop stays in the global footer. Goal controls and grid checks are disabled during active operations; observation views remain accessible. Desktop/narrow layout checks and screenshots caught and corrected an overflowing preference row. The grid scrolls internally rather than widening the window.

## E. Fourteen-court compatibility

`court-registry.ts` remains the only space identity registry: Mango 1–7 and Buko 1–7, fourteen distinct UUIDs. Grid facts carry both wing and number; every request carries explicit wing. Legacy numeric release plans retain Mango interpretation. Buko is never renamed as Courts 8–14.

The Book Now browser filters all fourteen identities by wing and shows open, blocked and unknown hourly cells with verified prices. Clicking an open cell edits the exact target. Capture freshness uses the earliest of the two wing reads and expires after 15 seconds. Wrong-date, stale, future or missing evidence cannot enable an available cell. Changing target details clears booking preparation and Terms. Checkout independently revalidates the complete requested duration and price; a single open grid cell is not a claim that a multi-hour booking is available.

Missing/closed morning cells are never fabricated as open; per-slot responses govern hours, maintenance restrictions and prices. Observed registry schedule summaries are explanatory, not immutable scheduling rules. A blocked Boolean slot alone does not distinguish maintenance from another restriction. The facility-wide date flag is not displayed as proof that a specific wing is open.

Mango's existing today + 2 / 08:00 Manila policy remains. Buko supports explicit currently open Normal requests only, one exact court with 1–3 hours and no fallback substitution. Buko release strategies, scheduled arming, Shotgun and Proofless remain rejected. The one-court launcher still uses Worker A; this task introduces no unverified customer/worker reassignment. Historical Worker B Buko API-adapter QR evidence is preserved, but a full new Buko UI-to-desktop-runner live submission remains unverified.

## F. Multi-target Shotgun

There is no second allocator or dispatcher. Focused/Diversified actions edit the same Smart draft, and `compileSmartPlan` delegates to the existing `shotgun.ts` allocator and emits the authoritative `PRECISION_PHASE3` and exact saved schedule. Equal, priority-weighted and custom allocations remain supported. Budget, target priority, worker groups, literal offsets, resource effects, backup behavior and capacity warnings remain reviewable.

Diversified explicitly selects the current immediate target portfolio for equal allocation; the operator can then choose weighted or custom counts. Focused explicitly moves alternatives to backups and concentrates allocation on the priority target; the button states this consequence. Neither action saves or authorizes execution by itself. Saved Dense Core plans, budgets and timings are not automatically rewritten. The existing Quick Focused helper remains labelled as a legacy quick setup rather than becoming a second engine.

The compiler constructs one global schedule and distributes its positions across targets; it does not multiply a burst by the number of targets. Worker/tab ceilings, exact topology, independent child permits and 50 ms per-attempt deadlines remain unchanged. Overlapping immediate windows on the same court remain compiler-rejected. Alternatives on different courts with overlapping clock ranges are supported offline. Custom allocations below budget remain explicitly represented rather than filled with redirected attempts.

**Live Shotgun is explicitly blocked** in the controller and desktop execution boundary with `SHOTGUN_LIVE_COMPATIBILITY_UNVERIFIED`, and the primary release action explains the blocker. Its existing checkout builder omits fresh availability proofs. Historical successful Normal tests supplied fresh proofs, so they cannot verify proofless release acceptance. No proof was fabricated, no checkout method was silently substituted and no protection was bypassed.

## G. Objective-level safety

An existing Precision race is a one-court objective. A validated qualifying hold now stops all remaining unsent alternatives across that objective, not only children of the same logical target. Cheap in-memory response safety signals remain available during the protected interval; hashing, journal settlement and QR navigation remain deferred. The final Node pre-POST gate rechecks objective suppression. Later armed renderer pages are disarmed best-effort and exact omission reasons are recorded.

UNKNOWN stops later sends and remains subject to durable reconciliation. HTTP 429/recognized throttling stops remaining alternatives and prevents Wave 2/Rescue. A separately classified payment-in-progress response likewise stops the objective and prevents backups/Rescue; it is not treated as ordinary slot contention. Confirmed ordinary rejection can permit the next approved attempt. Provider-stop paths retain the lifecycle lock for review rather than assuming that a new submission is safe.

Requests already in flight may still complete. Every result is settled and journalled, and additional verified holds retain separate QR/hold evidence; cancellation or payment is not invented. This is suppression of unsubmitted work, not an atomic provider guarantee against simultaneous extra holds. A goal requiring multiple courts still uses the existing separately validated Normal completion semantics; this redesign does not combine unrelated one-court successes into a multi-court result.

Five new intercepted safety regressions cover hold, UNKNOWN, throttle, payment-in-progress and ordinary rejection across different courts. Existing tests retain simultaneous dispatch, one-shot reuse rejection, deadline/prewarm omissions, Stop, wrong responses, journal recovery and QR handoff coverage. These state regressions do not publish invented latency distributions for failure scenarios.

## H. Timing benchmarks

Measured source: clean implementation `8bddf1084ebaea339808c7293f43c23ef5d3b925`. Machine: i5-13500HX, 20 logical cores, 32 GB, Windows NT build 10.0.26300; Node 24.15.0; Chrome 155.0.8059.40. Each valid case used ten measured runs plus two warmups, six-second preparation lead, preparation concurrency four, the production central dispatcher and synthetic security CPU 0 / wait 0. Onda-shaped checkout requests were answered by a local synthetic HTTP 409 interceptor; none reached Onda.

Every valid plan had eight aggregate attempts at literal offsets **−2000, −1714, −1429, −1143, −857, −571, −286, 0 ms**, minimum gap 285 ms. Each measured case recorded 80/80 intercepted attempts, zero missing/unready workers, zero omissions, zero compressed pairs, zero outside-tolerance starts and zero early transmissions.

| Plan | Allocation | Worker tabs | p50 / p95 / max ms | Local verdict |
|---|---|---|---|---|
| Focused | Court 7 19:00, 3 h: 8 | A:6, B:2 | 3.63 / 4.67 / 5.40 | READY, offline only |
| Equal, two targets | Court 7 19:00 3 h: 4; Court 6 18:00 3 h: 4 | A:4, B:4 | 3.35 / 4.42 / 5.31 | READY, offline only |
| Weighted, three targets | Court 7 19:00 3 h: 3; Court 6 18:00 3 h: 3; Court 5 17:00 2 h: 2 | A:3, B:3, C:2 | 3.64 / 4.76 / 5.97 | READY, offline only |
| Custom, four targets | Above courts: 3 / 2 / 2; Court 4 20:00 2 h: 1 | A:3, B:2, C:2, D:1 | 3.57 / 4.48 / 4.98 | READY, offline only |
| Same-court overlap | Court 7 19:00–22:00 vs 18:00–21:00 | Not dispatched | Unmeasured | COMPILER REJECTED |

The timing column measures configured trigger to local Chrome request initiation. Preparation duration p95 / smallest last-ready margin were respectively 31.0 / 5817.67 ms, 32.1 / 5868.53 ms, 31.8 / 5903.75 ms and 32.4 / 5919.79 ms. System busy p95 was 10.8%, 7.3%, 12.9% and 11.3%, respectively. Conditions were observed, not controlled to identical load.

Eight globally spaced attempts across two seconds are a locally supported lower-density candidate on this machine. No saved plan was adopted automatically. The small sequential samples do not establish a winning allocation or probability advantage. Synthetic security does not establish real security readiness, provider arrival order, proofless acceptance or request-rate permission. Historical Dense 20 remains AT_RISK evidence; its 1 ms regions were not retested or reclassified. Benchmark files bind to their measured source/topology/machine and are not promoted as final-build live readiness.

The first comparator stopped after four completed cases when the overlap guard rejected case five. Those raw records were preserved. The comparator now records that expected compiler rejection; an explicit resume completed the fifth record without rerunning or relabelling the four measured cases. Raw summaries, attempt rows, topology fingerprints and comparison JSON remain local under `.local/modernization/shotgun-comparison/`.

## I. Production readiness

| Capability | Evidence-based status |
|---|---|
| Mango Book Available Now | Updated UI/runner OFFLINE VERIFIED; historical full Normal desktop API runner and Browser flow VERIFIED TO QR; no new live test |
| Buko Book Available Now | Updated exact UI/preparation OFFLINE VERIFIED; historical official flow and production Worker B API adapter VERIFIED TO QR; full new UI-to-runner submission unverified |
| Mango Next Release Normal | Existing gated engine/regressions preserved; no new live 08:00 release test or proofless-acceptance claim |
| Mango Focused Shotgun | Offline compiler/dispatcher/timing VERIFIED; LIVE BLOCKED by proofless compatibility and provider-rate evidence |
| Mango Diversified Shotgun | Offline allocation/objective coordination/timing VERIFIED; LIVE BLOCKED at the same boundary |
| Buko scheduled release | BLOCKED: recurring policy unverified; backend/UI agree |
| Slot Watch | Isolated browser observation OFFLINE VERIFIED; sustained live guest-session observation unverified; missing evidence UNKNOWN |
| Separate Windows package | Clean build/dist/provenance and runtime UI OFFLINE VERIFIED; no package-driven live booking |

Local timing READY is never substituted for any of these live evidence gaps. A prepared or armed UI state is not a verified reservation or QR page.

## J. Operator guide

1. Keep the installed app intact. Review the separate package's `BUILD-INFO.txt`; its private authenticated worker/contact fleet is not bundled. Configure it deliberately before attempting real bookings.
2. Home → **BOOK AVAILABLE NOW**. Select wing/date/court/start/duration. Prepare the required dedicated Chrome with the existing guarded workflow. Retained QR pages and lifecycle records remain protected; preparation inspects them instead of deleting evidence.
3. Check Live Availability to browse the selected wing, or use the exact-target read-only check. UNKNOWN means no current verification. Open cells show prices, but the complete target is still rechecked before checkout.
4. Review the exact Normal target. Changing it invalidates preparation and Terms. Authorize the existing per-run Terms and choose **Review & Book**; review the existing confirmation and maximum amount before the final action.
5. Live/History show preparation, dispatch, pending/unknown results, verified hold and QR handoff. Emergency Stop stays available. UNKNOWN or payment-in-progress requires review; do not turn it into repeated submissions.
6. At genuine QR, verify wing, court, date, every hour, amount, pending status and expiry countdown. Automation stops; payment remains manual.
7. For future Mango planning, Home → **PLAN NEXT RELEASE**. Edit priorities and exact targets, choose Normal or edit an offline Focused/Diversified Shotgun plan, review the compiled allocation and save explicitly. Prepare separately. Live Shotgun cannot be armed until its compatibility blocker is resolved. Buko remains Book Now only.

## K. Remaining blockers and safe scope

No recurring Buko release rule, proofless release acceptance, provider request-rate permission, provider timing advantage or success probability was established. No live Shotgun burst, hold, payment, security replay or challenge automation occurred. A complete Buko UI-to-desktop-runner live submission, new package-driven booking and sustained isolated-observer release run remain separate authorized verification tasks.

Book Now intentionally offers one exact Normal target by default, rather than an unverified new multi-court checkout or a new cross-wing alternative dispatcher. Existing advanced Normal combinations remain subject to their existing engine limits. Multiple-court Shotgun completion and overlapping same-court immediate targets were not enabled. The new Normal goal is transient; saved/reopened release plans continue using the existing authoritative compiler and persistence format.

Historical evidence, journals, private profiles, contacts, installed/source saved choices, Dense Core allocation and offsets were preserved. Git includes source/tests/documentation only; runtime reports, raw captures, customer values, cookies, security contexts, proofs, payment/checkout capabilities and QR payloads remain excluded.
