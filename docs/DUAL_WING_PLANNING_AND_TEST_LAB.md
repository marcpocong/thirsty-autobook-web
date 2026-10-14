# Dual-wing planning and Shotgun Test Lab

> Superseded for operators on October 15, 2026 by Booking Setup and the universal Booking Test Lab ([Booking Setup v3](BOOKING_SETUP_V3.md)). The planning wrapper, its saved file and the isolation rules below remain valid; the lab now also accepts the exact Booking Setup objective with distinct-court quotas.

The exact dual-wing planner is a version 2 wrapper over `compileSmartPlan`, `planShotgun`, `exactShotgunTopology`, `freezePrecisionRace`, `armPrecisionRace` and `dispatchArmedPrecisionRace`. It is not a second booking engine. Its compiled `PRECISION_PHASE3` candidates carry wing, registry space UUID and individual booking date. One aggregate budget produces one global offset schedule; the worker grouping retains the existing six-tab ceiling and seven Precision workers.

## Evidence and authorization

Mango retains its existing 08:00 Manila / two-calendar-day offset. On October 14, the official Onda page independently displayed Mango through October 16 and Buko through October 20. Buko's six-calendar-day offset and proposed 08:00 time are provisional. A banner cutoff establishes neither an exact court's publication nor a recurring release transition. `releaseForTarget` calculates estimates; `assertVerifiedRelease` separately requires VERIFIED evidence. Both wings' target releases must match for a shared scheduled cohort. No date is rewritten to hide a mismatch.

Live Shotgun remains blocked. Historical fresh-proof Normal QR results do not establish proofless acceptance or request-rate permission. Scoped candidates are explicitly refused by the legacy live authorization and candidate-wire adapters. Rehearsal builders use Buko's registry UUID and observed Normal activity metadata solely for intercepted tests.

## Identity and persistence

New IDs are `v2:WING:spaceUUID:YYYY-MM-DD:HH:00:END:durationh`. Exact UUID/wing/number mismatches and impossible dates fail closed. Release instant, objective, worker assignment, offsets, complete payload identity, prices and the wrapper's price-authority fingerprint are bound at freeze. Legacy Mango target IDs, durable facility/space/date/range keys, allocation metadata, customer bindings and saved bytes are unchanged. Migration interprets copies as Mango; it never rewrites old journal identities.

The owner saves the wrapper explicitly under `.local/shotgun-test-lab/planning-only.json`. Reopening recomputes the same compiler output. This file cannot arm a production release and does not overwrite `config.local.json`. Legacy and explicitly scoped targets cannot be combined without first migrating copies. Selected zero-count custom targets produce zero sends.

## Rehearsal isolation

The desktop starts a single child in a fresh `.local/shotgun-test-lab/runs/<id>` directory. It receives only the public exact plan and scenario, not operator configuration, customer profiles, cookies or worker security. Each worker gets a separate Chrome process/profile, synthetic distinct customer/session fixture, and child tabs. DNS and a closed local proxy block external traffic; page/context routing intercepts or aborts all requests. A network-escape self-check runs before preparation. Local synthetic security is explicitly not provider security verification.

Preparation, strict page timing, one-shot permits, the scheduler, dispatcher, payload self-checks, response validator and journal settlement use the existing modules. The child acquires its own isolated automation lock. Journals carry `OFFLINE_INTERCEPTED` plus exact wing/UUID/date attribution. No production journal is opened. Browser cleanup sends `Browser.close` to the Chrome processes the child launched; disconnecting CDP alone is insufficient. Stop during startup is remembered, unsent work is disarmed, and application shutdown waits for child cleanup.

ANY_ONE suppresses alternatives in both wings after a validated simulated hold. ONE_PER_WING suppresses the successful wing while the other continues. UNKNOWN, recognized throttling and payment-in-progress stop all unsent objectives. Already-dispatched requests are settled separately; two simulated holds are not described as an atomic two-court booking. QR navigation is never performed in rehearsal. The 50 ms strict production tolerance remains unchanged.

Scenarios cover first/later success, individual/both wing success, unknown and wrong-wing responses, payment-in-progress, throttling, failed preparation, unavailable workers, a delayed browser trigger, concurrent in-flight successes, previous retained hold, duplicate targets and missing/stale evidence. The delayed-trigger fixture deliberately occupies a ready tab's main thread around its trigger; production deadline checks must omit that request.

## Operator path

1. Open Shotgun Test Lab, or select Buko/Both from Edit Release Plan.
2. Choose future-release planning or a current-slot rehearsal, wings and objective.
3. Enter exact targets and inspect each date and price authority. Default fixture prices authorize only simulation. Use the read-only published-slot picker after preparing dedicated Chrome in Book Now to add fresh one-hour slots.
4. Set the combined attempt budget and Focused, equal, weighted or custom allocation. Reorder target priorities and review the compiled plan. Save explicitly if desired.
5. Choose a scenario and Run offline rehearsal. Inspect initiated/omitted attempts, readiness, local timing, compression, per-wing outcomes and simulated completion. Global Emergency Stop and Stop rehearsal remain available. Raw isolated results remain in the run directory.
6. For a separately authorized real current-slot smoke test, use Live Checkout Test to open Book Now. Select one exact Mango/Buko target, prepare the correct customer/browser, load fresh availability, review and authorize Terms at action time. The existing proof-based path stops at genuine QR; payment is manual. This development assignment does not execute that action.

Offline timing measures configured test trigger to local Chrome request initiation. It is not server receipt order, proofless compatibility, provider permission, live security readiness or booking probability. Buko scheduled execution, live mixed-wing Shotgun and uncontrolled current-slot bursts remain blocked.
