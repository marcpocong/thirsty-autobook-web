# Thirsty Dual-Wing Release and Shotgun Test Lab Report

Implemented October 14, 2026, Asia/Manila. Scope authorized implementation, read-only public investigation, intercepted local tests, separate Windows packaging and publication to main. **No live booking POST, live burst, new provider hold, payment or reservation change was performed.** Simulated holds below are offline fixtures; historical genuine QR evidence remains historical.

## 1. Source and architecture

Starting clean local HEAD and fetched `origin/main`: `55d940a5e2d06f5b82fd47a4bcb9e46800fdbbcb`. Core implementation: `9de6504e655c51846e37c449fc5f479979b2fa4c`. Desktop/UI implementation and benchmark source: `da2c42ae1ce22db669887062a2603e24959b7ca0`. The final report-containing publication tip is recorded exactly in the separate package's `BUILD-INFO.txt` and `.local/dual-wing/publication.json`; a commit cannot truthfully contain its own SHA.

Actual source review confirmed the original numeric target ID, shared strategy date, Mango Precision UUID mapping, null Buko release policy, fresh-proof Normal path and explicit live Shotgun block. The shortest safe path was a version 2 exact-target wrapper over the **existing** Smart compiler, allocator, topology, armed transport, scheduler, permits, response validator and journals. No competing dispatch engine was introduced.

The new primary modules are `release-target.ts`, `dual-wing-plan.ts`, its bounded schema, the Test Lab runtime/child and desktop service/renderer. Existing modules were extended only for explicit target scope, zero-count allocation, offline execution identity, objective suppression and early payment-conflict classification. Operational Node availability retirement remains intact.

## 2. Release-policy evidence

The official [Onda booking page](https://app.onda.fit/book/thirsty-pickle) was independently read in normal Chrome on October 14. Its banner displayed: “Mango Wing bookings open through Oct 16. Buko Wing bookings open through Oct 20.” This corroborates the owner's observation. The generic web reader's Onda link returned 403; this is a different access context and is not a new provider root-cause diagnosis.

Calendar arithmetic on October 14 is October 16 minus October 14 = **2** calendar days for Mango, and October 20 minus October 14 = **6** for Buko. Public labels such as three days inclusive or five days in advance are stored separately. The five-day wording does not override the observed dates, and its counting convention remains unresolved.

Mango retains its existing VERIFIED-scope 08:00 Manila / +2 policy, based on existing repository/provider metadata evidence. This assignment did not perform a new Mango release transition. Buko has a **PROVISIONAL** +6 policy with a proposed 08:00 time. A banner horizon, available future date or shared facility is not verification of a recurring Buko rollover. No actual release-window transition was observed during this assignment.

`releaseForTarget` calculates policy estimates; `assertVerifiedRelease` separately requires VERIFIED evidence. UNKNOWN and PROVISIONAL policies cannot authorize a live scheduled submission. The legacy `wingWorkflow` does not promote provisional policy into booking readiness.

For the proposed October 15 08:00 cohort, Mango October 17 and Buko October 21 yield the same **estimated** instant. Before/after-08:00 Manila tests check independent +2/+6 dates and fixed UTC+08 handling. Different target release instants produce a cohort conflict rather than silently changing a booking date.

A bounded operational availability read for October 20 stopped at `CDP_NOT_LISTENING`: the verified dedicated Worker A session was not prepared. It did not navigate or prepare a worker, acquire security, fall back to Node, retry or submit. Therefore this assignment has no new exact per-court publication, price or backend rollover evidence. The banner is advertised-window evidence only.

## 3. Exact identity and migration

Each new target has wing, registry UUID, actual booking date, court number, start/end, duration, priority and its own price authority. Canonical identity is:

`v2:MANGO:0e853a91-33b6-4de2-9237-778007a9313b:2026-10-17:18:00:20:00:2h`

Buko Court 3 has a different registry UUID; changing wing or date changes the canonical identity and durable facility/space/date/range key. Invalid UUID/wing/number combinations, impossible dates, duplicate targets and same-court/date overlapping immediate targets fail closed. Cross-wing clock overlap is accepted for rehearsal.

Legacy unscoped targets retain Mango interpretation and their original IDs, selections, allocations, offsets, workers and saved bytes. Migration returns explicit copies; no existing journal identity is rewritten or recycled. Legacy and scoped rows cannot be mixed without explicitly migrating copies. Scoped plans are saved only on owner action to `.local/shotgun-test-lab/planning-only.json`, never over `config.local.json`. Reopen retains exact dates and custom counts. Legacy Precision fingerprints remain unchanged.

## 4. Combined compiler and frozen dispatch

`compileDualWingPlan` invokes `compileSmartPlan`, which still invokes `planShotgun`. The output is the existing `PRECISION_PHASE3` shape with scoped candidates. Equal, priority-weighted, custom and Focused allocations share one aggregate budget and one global schedule. Worker groups still use at most six tabs each and workers A–G. Selected custom zero-count targets now produce zero sends; under-budget custom counts are preserved without redirected attempts.

The reviewed wrapper is planning authority only. Frozen intercepted attempts bind exact wing/UUID/date/time, per-hour prices, assigned worker, local test trigger, literal offset, checkout method and a fingerprint of the wrapper's price authority/objective. Payload wire checks and the response validator independently verify the exact plan. Simulated Buko payloads carry the observed Normal `pickleball` activity metadata; that does not establish live proofless acceptance.

The old Mango-only adaptive evidence matrix, recovery/live candidate builder, release clock and observer are not silently repurposed. Scoped candidates explicitly refuse in the legacy live authorization and candidate-wire adapters. Slot Watch/history of real releases remains Mango scoped. New offline outcome rows carry exact wing/date/UUID attribution. There is no cross-wing fallback substitution.

## 5. Objectives, identities and provider stops

**Any one acceptable court:** a validated simulated hold in either wing suppresses all remaining unsent alternatives. **One in each wing:** the successful wing's alternatives stop, while the other wing continues. Completion evidence remains separate; two unrelated holds are not claimed as an atomic two-court booking. Arbitrary multiple-required-court goals are not enabled.

UNKNOWN, wrong-wing evidence, recognized throttling and payment-in-progress stop all unsent objectives. Ordinary confirmed rejection may permit the next approved fixture attempt. Already-in-flight results are settled and journalled separately, including extra simulated holds. No cancellation, payment or QR navigation is invented.

Real-Chrome testing caught an existing early-response gap: the immediate safety callback gave payment-in-progress HTTP 409 the generic contention hint until deferred bookkeeping. A bounded in-memory classifier now preserves that stop before later triggers. Hashing, evidence persistence and hold navigation remain deferred outside the protected interval. The production 50 ms strict tolerance and late-send refusal gates are unchanged.

Rehearsal workers have distinct synthetic customer/session fixtures and separate isolated Chrome processes/profiles. No real identities are duplicated and no provider credentials/security are copied. Live one-per-wing coordination is deliberately unverified: real customer/browser/session bindings, existing holds, provider permission and reconciliation must be independently established before any live expansion. The proven Normal path's identity, Terms, fresh proofs, one-shot, locks and retained-hold safeguards remain mandatory.

## 6. Shotgun Test Lab

The visible **Shotgun Test Lab** navigation entry contains exact dual-wing planning, **Offline Rehearsal** and **Live Checkout Test**. Choosing Buko/Both in Edit Release Plan opens this planner while retaining the existing Mango editor/save boundary.

Targets display wing, court, date, range, priority, price authority and compiled attempt allocation. The owner can reorder/remove targets, edit hourly prices, select Focused/equal/weighted/custom allocation, review and explicitly save/reopen a planning draft. Default fixture prices are synthetic. A read-only published-slot picker uses the existing verified Chrome availability path; only fresh explicit open one-hour cells can be added, and an edit to a longer range invalidates that price authority. Missing/stale evidence is not fabricated.

Each rehearsal runs in a new child-owned `.local/shotgun-test-lab/runs/<id>` directory. It receives only the public plan/scenario, not installation configuration or private fleet data. Separate Chrome profiles, blocked DNS, a closed localhost proxy, context/page routes and a network-escape self-check prevent external checkout traffic. Every state-changing request is locally fulfilled or aborted. The child uses the real prepared transport, scheduler, strict page timing, isolated global lock, one-shot permits and journals marked `OFFLINE_INTERCEPTED` with exact wing/space/date attribution.

Startup/Stop cleanup is explicit. Stop requested before child startup is remembered. Application shutdown waits for cleanup. Testing corrected another lifecycle gap: disconnecting CDP alone did not close spawned Chrome; the owned browsers now receive `Browser.close`. Existing worker/browser profiles are not touched.

Results show planned/initiated/omitted attempts, readiness, missed deadlines, compressed pairs, p50/p95/max local trigger error, CPU busy share, per-wing allocation/holds, exact per-target outcomes, objective completion and warnings. Records remain isolated locally. Simulated holds are labelled **OFFLINE / INTERCEPTED**, with no simulated QR presented as a reservation.

All 18 scenario choices are exercised: ordinary rejection, first/later success, individual/both wing success, UNKNOWN, payment conflict, throttle, failed preparation, unavailable worker, missed trigger, concurrent in-flight success, previous hold, duplicate target, wrong-wing response, stale and missing evidence. The missed-trigger fixture deliberately delays a ready tab near its trigger and must be omitted by the unchanged strict guard.

## 7. Current-slot live boundary

Live Checkout Test opens the existing **Book Now** exact Normal workflow. It supports one Mango or Buko court, explicit current date/start and 1–3 hours, fresh verified browser availability/proofs, correct customer/browser binding, exact review, action-time Terms/confirmation, durable one-shot checkout, validated genuine pending hold and QR handoff. Payment remains manual. This feature can create a real pending booking only after the owner's separate action-time authorization.

This assignment did not execute that action. Historical Mango/Buko Normal QR results are preserved, but new package-driven/UI-to-runner live checkout and proofless release acceptance remain unverified. A successful Normal smoke test cannot unlock proofless Shotgun. Multiple live current-slot submissions remain blocked pending provider rate permission, exact proof acquisition, unique real session/identity coordination and reviewed per-target authorization/reconciliation.

## 8. Timing comparisons

Measured clean source: `da2c42ae1ce22db669887062a2603e24959b7ca0`. Machine: i5-13500HX, 20 logical cores, 32 GB, Windows 10.0.26300; Node 24.15.0; Chrome 155.0.8059.40. Each case used ten measured runs plus two warmups, six-second preparation lead, preparation concurrency four, central production dispatcher and synthetic security CPU 0 / wait 0. Every checkout was intercepted as synthetic HTTP 409.

Each plan had eight aggregate attempts at literal offsets **-2000, -1714, -1429, -1143, -857, -571, -286, 0 ms**, minimum gap 285 ms. Every case recorded 80/80 measured Chrome starts, zero missing/unready workers, zero omitted shots, zero missed tolerance starts, zero compressed pairs and zero early transmissions.

| Plan | Allocation | Worker tabs | p50 / p95 / max ms | Local verdict |
|---|---|---|---|---|
| mango-focused-8 | 8 | A:6, B:2 | 3.50 / 4.13 / 4.34 | READY, offline only |
| mango-diversified-8 | 4/4 | A:4, B:4 | 3.05 / 3.87 / 4.72 | READY, offline only |
| buko-diversified-8 | 4/4 | A:4, B:4 | 4.01 / 4.88 / 5.15 | READY, offline only |
| mixed-equal-8 | 4/4 | A:4, B:4 | 3.65 / 4.43 / 26.98 | READY, offline only |
| mixed-weighted-8 | 5/3 | A:5, B:3 | 3.20 / 3.98 / 4.38 | READY, offline only |
| mixed-one-per-wing-8 | 4/4 | A:4, B:4 | 3.70 / 4.25 / 4.56 | READY, offline only |

Preparation duration p95 / minimum last-ready margin / system busy p95, in the same case order:
- mango-focused-8: 22.50 ms / 5896.42 ms / 18.2%.
- mango-diversified-8: 29.10 ms / 5909.46 ms / 19.8%.
- buko-diversified-8: 31.60 ms / 5881.06 ms / 20.7%.
- mixed-equal-8: 31.70 ms / 5879.53 ms / 17.2%.
- mixed-weighted-8: 31.70 ms / 5874.40 ms / 15.4%.
- mixed-one-per-wing-8: 31.60 ms / 5876.48 ms / 18.9%.

The timing column is configured local trigger to local Chrome request initiation. The mixed equal sample includes a 26.98 ms tail; it remains inside the unchanged 50 ms limit. Conditions were observed rather than identical controlled loads. The sequential samples do not establish a winning allocation or provider probability advantage. No saved strategy was automatically adopted.

The separate-objective timing case used ordinary 409 rejections to measure its full schedule; successful-objective suppression was verified by the intercepted scenario regressions, not invented from these timing samples. Raw summaries, per-attempt rows and topology/build/machine identities remain under `.local/dual-wing/comparison/`. These profiles bind to their measured source and are not promoted as final-build live readiness. Later Linux startup/cleanup corrections retain the Windows execution path; they do not re-label this measurement provenance.

## 9. Verification and publication

Baseline: **145 files / 1,621 tests passed**. Final stable implementation suite: **148 files / 1,658 passed**, including all intercepted scenarios and desktop/narrow renderer tests. Typecheck, clean UI/runtime build and distribution consistency passed; the implementation build verified **422 compiled files, zero problems**. No tests were removed, and no production timing tolerance was weakened. Earlier failures exposed the CDP cleanup/payment safety gaps and a renderer fixture's new read-only-defaults counter; those were corrected and the full suite passed.

The initial implementation [CI run](https://github.com/marcpocong/thirsty-autobook-web/actions/runs/38544397322) exposed Linux raw-CDP Chrome startup failures and an existing 30-second UI flow timeout. The offline helper now uses supported Playwright persistent-context startup on Linux while retaining the Windows raw Chrome/CDP path, blocked DNS/proxy and interception self-check. A follow-up removed a redundant process cleanup after the optional Linux-owned process change. No timing threshold or existing UI timeout was increased. Corrected source `2972b47a522fc8174c1397b06d842d8921a28ce1` [CI passed](https://github.com/marcpocong/thirsty-autobook-web/actions/runs/38546103357): 148 files, 1,654 passed and four existing platform-specific skips on Linux; distribution consistency passed with 422 compiled files. A final-tip CI rerun encountered only the existing 30-second screenshot-heavy strategy-flow timeout; all new Test Lab scenarios passed. CI now runs the two heavy browser suites sequentially in the same existing job, after the remaining tests, to avoid fixture contention. Every test and timeout is retained. Final CI totals and its exact URL are checked in the publication record. A subsequent accessible-label correction `85099198e9bc537c46d8af5c329a02c6118644ec` passed its focused renderer test.

Separate Windows output: `Source/.local/build/dual-wing-release-2026-10-14/Thirsty Pickle Bot.exe`, version 0.1.0. Its clean staged runtime verified 213 compiled package files against a fresh source compile (package-depth source maps are excluded from that comparison). The packaged Electron smoke actually ran the isolated rehearsal to two simulated wing holds and six omissions, saved/reopened the planning draft, checked wide/narrow layout and opened Buko Book Now. It reported zero renderer errors. It did not prepare a provider booking browser, read live provider slots, authorize Terms, submit or pay.

The package is rebuilt for the final report-containing tip using `npm run release:build -- --output .local/build/dual-wing-release-2026-10-14`, followed by the same packaged runtime smoke. The final exact HEAD, remote equality, GitHub CI, build/content identities, launcher digest and preservation checks are captured in `.local/dual-wing/publication.json` and package `BUILD-INFO.txt` before completion. This final-tip record is the authority for publication provenance, rather than inventing a self-referential SHA here. Package-driven simulated profiles and journals are moved into the local review evidence folder after smoke; they are not shipped as customer runtime or real holds.

Installed EXE, parent `BUILD-INFO.txt`, installed configuration and source configuration were hashed before work and are rechecked at handoff. Existing journals, contacts, authenticated profiles, customer/security material and original saved release strategy are preserved. Private runtime data, raw benchmark captures and simulation journals remain excluded from Git/package distribution.

## 10. Capability matrix

| Capability | Evidence-based status |
|---|---|
| Mango Normal booking | Historical genuine QR evidence retained; existing exact workflow regressions preserved; no new live checkout |
| Buko Normal booking | Historical genuine QR evidence retained; exact Normal path preserved; new package-driven live submission unverified |
| Mango 08:00 release | Existing +2/08:00 policy retained; no new release-window test |
| Buko 08:00 release | +6 horizon corroborated by current banner; 08:00 recurring rollover PROVISIONAL; live scheduled submission blocked |
| Mango Focused Shotgun | Offline compiler/dispatcher verified; live proofless/rate compatibility blocked |
| Mango Diversified Shotgun | Offline allocation/coordination verified; same live block |
| Buko Shotgun | Exact offline scoped planning/dispatch verified; live blocked |
| Simultaneous Mango + Buko Shotgun | Offline shared schedule and both objective modes verified; live blocked |
| Offline Shotgun Test Lab | Real isolated Chrome, intercepted transport/fixtures, safety scenarios and UI verified |
| Current-slot live test | Controlled Normal feature available behind existing action-time gates; not executed in this assignment |
| Windows EXE | Clean separate package and real Electron UI / intercepted rehearsal verified; no live reservation test |

## 11. Simple operator guide

1. Keep the installed app/configuration intact; open the separate build after checking `BUILD-INFO.txt`. Its private authenticated fleet is not bundled.
2. For a current booking, Home → Book Available Now. Choose one exact Mango/Buko target, prepare/verify Chrome, load availability, review details and authorize Terms. The real checkout ends at genuine QR; payment is manual.
3. For dual-wing planning, open Shotgun Test Lab or choose Buko/Both in Edit Release Plan. Inspect independent dates and provisional policy labels. Differing release instants require separate cohorts.
4. Choose goal, exact targets, price authority and one aggregate budget. Review allocation and save explicitly. This does not arm a release or replace the saved Mango plan.
5. Choose an offline scenario and countdown, then Run offline rehearsal. Inspect readiness, omitted sends, per-wing/target results and simulated objective completion. Use Stop rehearsal or Emergency Stop when needed.
6. UNKNOWN/payment-in-progress requires review; do not convert uncertainty into repeated live submissions. Any actual current-slot QR smoke test is a separate owner-authorized checkout, never proof of proofless release compatibility.

Remaining external blockers are recurring Buko timing, exact release publication, live proofless acceptance, provider request-rate permission and genuine mixed-objective identity/session coordination. No provider timing advantage or booking probability is established. All safely testable mixed-wing planning and intercepted dispatch work is implemented independently of those live blockers.
