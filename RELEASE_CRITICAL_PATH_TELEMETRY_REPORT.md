# Release critical path telemetry audit

Status: historical audit and passive recorder implemented; offline checked only. No live Oonda booking, hold, checkout, payment, or release test was run.

## A. Historical comparison

The ignored local `DiagnosticsLocal` directory contains three relevant 08:00 release traces. Times below are Asia/Manila. Durations labelled **derived** are differences between recorded process monotonic timestamps. A missing marker means **NOT OBSERVED**, not zero duration. The old traces do not record an immutable plan, booking method, source SHA, executable build, or browser state. The September 12 report's `806b687` was the report-preparation HEAD, not proven runtime provenance.

| Run | Context and outcome | Last completed milestone and recorded/derived timing | API and hold |
| --- | --- | --- | --- |
| `a9c37b00-9f63-4451-ad3c-a7186120e221`, Sep 11 | Release scheduled 08:00:00, trigger +4 ms. Booking date and exact method **UNKNOWN** in diagnostic. Failed before target-grid readiness; error classification **UNKNOWN** in this old file. | Reload commit 08:00:00.339; shell ready 08:00:18.522. Commit→shell **18,182.783 ms derived**. Target clicked 08:00:19.419; correct heading detected 08:00:19.437; `failed` 08:00:19.476. | API completion **NOT OBSERVED**; no request marker in this trace. Selection and verified hold **NOT OBSERVED**. |
| `b52e5ded-2743-4a0a-ac12-57a17dcedbe3`, Sep 12 | Release scheduled 08:00:00, trigger +10 ms. Hybrid option enabled, actual candidate `UI_ONLY` with reload fallback. Sep 14 booking date corroborated by the production report and retained hold. **Verified pending QRPH hold**, not paid booking. | Commit 08:00:00.331; shell 08:00:01.273; strict grid 08:00:01.600; first slot click 08:00:01.624; selection verified 08:00:01.911; final action started 08:00:09.518; checkout and pending hold first observed 08:00:13.379; QR handoff verified 08:00:14.684. Trigger→grid **1,590.840 ms**, trigger→first click **1,614.230 ms**, trigger→selection **1,900.913 ms**, trigger→QR **14,674.483 ms** derived. | Optional availability request started but no response/parse marker; fallback recorded before reload commit. It may have been canceled by navigation, but the old trace cannot prove that. API response latency **NOT MEASURED**. Hold verified by handoff validation. |
| `7c149777-d7e4-4212-b38d-ca29e0fa85e9`, Sep 17 | Extended, two browser workers in the release report; exact booking date and binary SHA **UNKNOWN** in diagnostic. Trigger +10 ms A and +12 ms B. Top-level `OPERATION_FAILED`; later source investigation attributed the shell stage. | A commit 08:00:00.246; B commit 08:00:01.679. Neither has venue-attached, picker, target heading, or grid markers. Failure recorded 08:00:15.258. Commit→failure is **15,012.478 ms A** and **13,579.266 ms B derived**; these are upper bounds on observed work before failure, not shell-ready durations. | API completion **NOT OBSERVED**. No grid, selection, checkout, or verified hold. The later fix addressed bounded shell recovery and preservation of both workers' failure evidence; it does not retroactively add timings to this trace. |

The Sep 11 delay occurred between navigation commit and shell readiness. That interval combines Oonda document delivery, browser startup/JavaScript work, venue and date-picker readiness, and Playwright observation. The old trace cannot apportion it. Sep 12 shows a fast UI path on one release and two longer observed UI intervals: Player Proceed→Payment Summary **6,002.228 ms** and final action start→QR verification **5,165.673 ms**. Neither interval isolates a server call. Sep 17 shows a second failed release at the shell stage, with a different two-worker configuration and unproven binary provenance. The three runs are not controlled comparisons.

## B. Existing telemetry audit

Already present in `src/telemetry.ts`, `src/release-navigation.ts`, `src/release.ts`, selection and checkout code: scheduled epoch and trigger error; reload start/commit and release URL/venue/picker stages; target date detection, enablement, click, heading, strict 112-cell grid and snapshot; optional availability request start, response/parse/fallback; preference, per-hour selection and complete verification; Booking Proceed, Review, Player, Payment Summary, Terms and final Oonda action; checkout first detected, hold first detected and verified QR handoff. Recent code also records classified shell failures, navigation outcome and worker identity. The old Sep 11 and Sep 12 files predate some of these markers. `releasePerformance` derives intervals only when both endpoints exist and returns null otherwise.

Missing before this change: passive network dispatch/headers/completion/failure for exact normal-site endpoints, explicit navigation cancellation classification, and separate first presence versus safe DOM eligibility for configured preferred cells. A successful HTTP status still does not prove reservation creation. No server-side hold-creation instant is exposed.

## C. Exact changes and observation method

`src/passive-release-network.ts` listens to Playwright page `request`, `response`, `requestfinished`, and `requestfailed`. It accepts only same-origin exact paths for `GET /api/public/facilities/{known facility}/date-availability`, `POST /api/public/facilities/{known facility}/member-only-court-slots`, and `POST /api/bookings/public-checkout`. It records `DISPATCHED`, `HEADERS`, `COMPLETED`, or `FAILED`, bounded local request ID, endpoint category, optional status and allowlisted failure class. `ERR_ABORTED` is classified `CANCELED_OR_NAVIGATED`; that class does not prove which event canceled it. It never reads request or response bodies or stores URLs, headers, query strings, identities or tokens. An active request at listener cleanup is `FAILED/UNKNOWN`.

`src/passive-target-cells.ts` installs a small mutation-driven observer before the release wait and on a reload. It watches only the configured first-priority court and configured hours on the exact target date. `preferredCellsPresent` means those cells and the correct heading were present. `preferredCellsDomEligible` additionally requires explicit available state, matching label, enabled and visible cells, and no `aria-busy` indicator. This is **DOM_ELIGIBLE**, not proven Playwright clickability. The observer batches checks to animation frames and stops after eligibility or 256 scans on the target heading. It does not trial-click. The actual selected candidate may differ from this configured preference; the existing selection markers continue to describe the actual choice. No earlier preferred-cell observation is retroactively attributed to the final choice.

`src/telemetry.ts` adds bounded `passiveNetwork` records and a closed `releaseContext` with target date and effective browser/hybrid method to the existing ignored diagnostic JSON; all timestamps use Node's monotonic `performance.now()` and wall UTC ISO time (convert to Asia/Manila for display). Browser `performance.now()` is not subtracted from Node times. DOM callback receipt includes bridge/scheduling delay, so it is an observed upper bound on appearance. `src/booking-runtime.ts` and `src/index.ts` attach and clean up these observers for release runs. Neither adds an Oonda request or booking action. Failure and abort paths retain partial in-memory records for the existing diagnostic flush. Source SHA is still **UNKNOWN** unless separately recorded at build/deployment time; no Git command was added to the critical path.

## D. Synthetic offline representation

This example is illustrative, **not a live trace**. `NOT OBSERVED` is shown in analysis, rather than invented as a timestamp.

| Synthetic case | Passive records and existing milestones | Interpretation |
| --- | --- | --- |
| Failed | `releaseTriggerFired` → `reloadStarted` → availability request `DISPATCHED` → `FAILED/CANCELED_OR_NAVIGATED` → `reloadCommitted` → `releaseVenueAttached`; picker, preferred cells, grid, selection, final request and hold: **NOT OBSERVED**. | The request did not complete; the last proven UI milestone is venue attachment. No API latency or reservation claim. |
| Successful | `releaseTriggerFired` → availability `DISPATCHED/HEADERS/COMPLETED` → correct heading → `preferredCellsPresent` → `preferredCellsDomEligible` → `targetGridReady` → existing selection/checkout markers → reservation `DISPATCHED/HEADERS/COMPLETED` → `checkoutPageDetected` → `holdStatusDetected` → `qrHandoffVerified`. | Compare Node-observed network and UI intervals. Pending hold is first verified by the existing hold marker, not by request dispatch or HTTP status. |

## E. Safety and performance

All existing action, wait, timeout, retry, fallback, grid validation, choice, Terms, checkout and manual-payment rules remain unchanged. The network recorder is an exact allowlist, bounded to 16 active requests and 128 records. It performs no body processing or disk write on the booking path. Diagnostic callbacks catch their own errors. The target observer does no polling loop and sends at most two fixed labels to Node. It can still add small browser scheduling and bridge overhead; only an actual release trace can quantify that overhead and release-time behavior. The observer records its configured first preference only; it does not cover all fallback candidates.

## F. Offline checks

Commands run in this checkout:

```text
npx vitest run tests/passive-release-telemetry.test.ts tests/release.test.ts tests/dual-runtime.test.ts  # 51 tests passed in 3 files
npm run typecheck  # passed
git diff --check   # passed; CRLF normalization warning only
```

The targeted tests cover exact allowlisting, sanitized records, phase order, cancellation, missing completion, partial evidence, release context, listener cleanup, duplicate network and DOM callback suppression, and a throwing diagnostic sink. They use no Oonda request or booking interaction. The full suite and live release were not run. No production performance claim follows from these tests.

## G. Remaining unknowns and next 08:00 trace

The next authorized normal-browser release can show whether an existing availability request is dispatched, receives headers, completes, fails or is navigation-canceled; whether shell/venue/picker delay precedes the availability response; when preferred cells first appear and become DOM eligible relative to the strict full grid; how long Review, Player and Payment Summary stages take; when the site's reservation POST is dispatched and completes; and when the first verified pending hold is observed. It cannot establish the exact server-side protection instant, independent server processing time, or that a DOM-eligible cell would have passed Playwright's full click actionability checks. Source build provenance must be recorded separately for a strict cross-run comparison.

## H. Deployment

This checkout is `feature/api-booking-experimental`; `main` at `62da6a5` is an ancestor. The existing `Thirsty Bot.exe` is a launcher for this project folder (`scripts/ThirstyLauncher.cs`), not an embedded application binary. The new runtime `.ts` files are loaded through the existing Node/tsx worker, so this instrumentation does **not** require rebuilding or replacing the executable or UI assets. To use it after review, update the exact project folder used by the launcher if it differs from this checkout, keep its installed dependencies, then perform the usual desktop **Reset & Prepare** and explicit future normal-browser arming. No deployment, executable replacement, or arming was performed for this investigation. If the launcher or UI build itself later changes, `npm run exe:build` is the documented rebuild command, but it is unnecessary for this source-only recorder.
