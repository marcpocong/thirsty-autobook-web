# October 18, 2026 Mango release incident

All times below are Asia/Manila. This report contains sanitized facts; the raw evidence stays in the private installation directory.

## Observed outcome

Run `5da5f605-d565-4c21-b0d4-6c93bcf8668b` targeted Mango Court 7, October 20, 19:00–22:00. The operator armed three attempts at −1000, −80 and 0 ms. All three settled as `NOT_DISPATCHED / SHOTGUN_TRIGGER_MISSED`. The run trace has no checkout POST initiation or verified hold. No QR handoff was reported.

The app was stopped through its normal abort action after the evidence was captured. The post-stop snapshot records idle operation and no active lock. No new booking, payment, cancellation or retry was initiated during investigation.

## Preserved evidence

Private archive: installation `.local/incidents/2026-10-18-release-failure/`.

The initial archive contains 809 evidence files (65,359,151 bytes), a SHA-256 manifest, the app state and a full-page screenshot. All 809 initial hashes were verified. A post-stop supplement preserves six changed/new files. The error index references 31 error events in the initial capture. It covers today's booking activity, API progress and journals, frozen authorization, diagnostics, clock evidence, attestation, retained-hold records, slot-watch data and build metadata. Configuration is preserved privately for reproducibility. This archive must not be published: it contains private configuration and booking identifiers.

Key originals:

- `.local/api-booking/run-progress/5da5f605-d565-4c21-b0d4-6c93bcf8668b.ndjson`
- `.local/api-booking/precision-races/5da5f605-d565-4c21-b0d4-6c93bcf8668b-phase3-freeze.json`
- `.local/booking-runs/83d90d0e-6185-44db-bcce-e48126c9a246.ndjson` (retained-session preparation failure)
- `DiagnosticsLocal/a22c5885-3d10-49b8-a5b9-fe1d5bd93aa2.json`
- `BUILD-INFO.txt`: installed build `f1af256-78a8c8c7fb`

## Timeline and errors

| Time | Evidence and consequence |
| --- | --- |
| 07:44–07:48 | A migrated custom allocation had 20 shots on Court 7 and omitted counts for Courts 6/5/4. The UI displayed zero for missing values while the allocator rejected them. Explicit zeros repaired the draft. |
| 07:49 | `BOOKING_SETTINGS_INVALID`: serialization included zero-count targets without wave1 authorization. Strict runtime validation correctly rejected the inconsistent selected-target/count/schedule representation. |
| 07:50:35 | Retained-session normalization reached its final step, then emitted only `BOOKING_OPERATION_FAILED`. Raw diagnostics do not identify the underlying exception. The hold record was retained/archived and the lock was clear afterward. A subsequent normal preparation succeeded. Do not label this root cause as proven. |
| 07:51 | Four browsers prepared and a dry run completed. The renderer still unconditionally disabled live Shotgun even though the backend supported the owner-attested Mango pilot. |
| 07:52:41 | `SHOTGUN_PREWARM_NOT_FULLY_READY`: the 20-shot forecast predicted 11 ready and nine omitted at successful-preparation p95 30,492 ms. A dry run did not establish live child readiness. |
| 07:53 | The operator-reviewed three-shot plan forecast 3/3 ready, then was armed through the normal Terms/confirmation/owner-attestation path. A forecast is not proof that provider security will succeed. |
| 07:58:00–07:58:01 | Authorization froze and one-shot attempts were armed. |
| 07:59:00 and 07:59:30 | Near-release clock consensus ran. The runner awaited both rounds before invoking the dispatch coordinator. |
| 07:59:30.209 | `PREWARM_PLAN` calculated a 105,000 ms preparation lead, but execution was already inside the final 30 seconds. Security began at 07:59:30.222. |
| 07:59:56.013 | Actual readiness: tier 1 still preparing, tiers 2 and 3 omitted. |
| 08:00:01.041 | All three attempts settled unsent with `SHOTGUN_TRIGGER_MISSED`. The strict deadline correctly prevented late sends. |
| 08:00:30.382 | `SECURITY_PREWARM_FAILED / ONDA_SECURITY_VERIFICATION_FAILED`; underlying security operation duration 60,159 ms. These logs establish failure, not its provider-side reason. |
| After release | The strict UI protocol rejected operational events containing `workerGroupIndex` and other supported runner fields. The app displayed “Unrecognized structured event omitted” instead of the outcomes. The adaptive loop continued waiting even though wave2/rescue budgets were zero. |

## Corrections

1. Interpret absent custom counts consistently as zero in the objective compiler; keep invalid numeric values subject to validation. Keep zero-count alternatives in the editable objective while serializing only active targets into runtime authorization. Regression tests exercise both sparse and explicit zeros through `BookingSetupSchema`.
2. Remove the obsolete renderer-only live Shotgun refusal. Preserve Terms, exact-plan owner attestation, browser/readiness checks, deadlines, throttling stops, durable journals and UNKNOWN handling.
3. Start the dispatch coordinator's prewarm schedule alongside final clock consensus instead of after it. Adopt the final clock into the shared monotonic clock before dispatch, preserving large-earlier-jump rejection. Re-anchor timing evidence and release lockdown to that same clock.
4. End adaptive waiting after wave1 settles when no permitted future work exists; stop the loop on exceptional exit. Emit an explicit wave1 completion summary and show a clear nothing-dispatched outcome.
5. Accept the runner's bounded scalar pilot/quota/topology/lockdown event fields. Continue strict validation. Rejected events now report stage, issue codes and field names, without copying rejected values or secrets, into the durable activity log.
6. Show actual prewarm tier counts in operator detail. Label the arming refusal as a preparation forecast limitation, not generic machine timing failure.
7. Report invalid final preparation evidence as `PREPARATION_RESULT_INVALID` with failing field paths, rather than losing that schema diagnosis behind a generic error. Also preserve strict booking-authorization validator reasons in the operator detail and durable activity log. The earlier generic failure's precise root cause remains unproven.

## Validation and deployment

Targeted dispatch, clock, objective, UI-protocol and capability-gate tests passed (103 tests). The full scheduled suite passed 158 files / 1,734 tests, including intercepted browser scenarios and the sequential dispatch suites. The final controller/protocol refinements additionally passed 14 scoped tests. Final typecheck, UI build, distribution verification (454 compiled files, zero problems) and whitespace checks passed. Validation records and the captured full-suite output are in the private archive. No live provider test was used as validation.

The incident-session UI repairs did not rebuild the installed app. Source fixes are not an installed release until the canonical updater completes. `scripts/build-app.mjs` requires a clean committed main branch matching origin/main and successful CI for that exact commit. The updater must also find no active lifecycle blockers and preserve private profiles, configuration, journals, holds and history. Historical UNKNOWN records must remain UNKNOWN; they are not deleted or reclassified to permit installation.

## Limits

These changes prevent the reproduced local scheduling/serialization/protocol failures and make failures observable. They cannot guarantee provider availability, successful security verification, request arrival order or a booking. Do not bypass security challenges, freshness windows, late-send refusal, UNKNOWN reconciliation or payment boundaries to make a readiness indicator green.

## Follow-up reliability overhaul (same day)

A second audit after `dba38a6` found these additional defects. Each is fixed and covered by regression tests; none is claimed as the proven cause of the 07:50:35 generic failure.

| Area | Verified defect | Correction |
| --- | --- | --- |
| Operator controls | The legacy console's form `dirty` flag and draft check still disabled Prepare and turned “Authorize and Arm” back into “Prepare” while Booking Setup owned the plan. “Authorize and Arm” clicked a hidden legacy button, so any legacy-only condition (form player count, browser A health, unsynced clock that arming itself syncs) made the click do nothing. Terms refusals silently unticked the box. | One gate model (`operatorGates` in `src/execution-state.ts`) drives the primary button. Every blocked control shows a plain-language reason and a recovery button. Booking Setup calls the controller directly; legacy form flags no longer apply to its plan. Terms refusals state their reason. |
| Plan lifecycle | Next Release had no separate Validate or Save stage: Prepare silently saved and replaced the authorization. The draft was bound to the saved plan by reading the button's text during the click. | Draft → Validated → Saved → Prepared → Armed → Executed. The draft's exact runtime representation is checked against `BookingSetupSchema` in the main process before saving (`validateReleaseSetup`) and compared with the saved plan field by field. Prepare sends no setup, so exactly the saved plan is prepared. A difference is shown with before/after values and explicit choices (save draft, load saved plan, keep saved plan). |
| Preparation binding | The live proofless preparation recorded no plan fingerprint. Saving another plan left it “prepared”, and arming took whatever was saved. | `preparedPlanFingerprint` is recorded at preparation. A later save clears it with “SAVED PLAN CHANGED”, and arming refuses with `PREPARED_PLAN_CHANGED` (or `RESET_REQUIRED` when unbound). |
| Readiness claims | Every worker was reported `securityReady` once preparation finished; “Prewarm: GOOD” and “✓ READY FOR RELEASE” appeared before any release security work ran. | Five separate layers: plan valid, environment prepared, timing forecast, live security (actual run evidence only), armed. The summary reports the earliest incomplete stage and never calls a forecast security readiness. |
| Clock refresh | The coordinator awaited the near-release consensus without a bound. A stalled T−30 s round would hold it past every trigger and the run would never settle. | The refresh must settle 2 s before the earliest trigger. Otherwise `RELEASE_CLOCK_REFRESH_TIMEOUT` fails closed: every attempt is recorded unsent and no request is initiated. The coordinator now reports the preparation window it actually obtained against the earliest trigger (`PREWARM_WINDOW`, `PREWARM_LATE_START`). |
| Event contract | Runner stage fields were untyped. Typing `stage()` from the UI schema revealed four more stages the UI was rejecting: every informational stage deferred through the final-second lockdown (`lockdownDeferredMs`), `PRECISION_ARMED` (`fanOut`, `parentGoalCount`), `PRECISION_RACE_CONFIGURED` (`fanOut`) and `PHASE3_EVIDENCE` (`operational`). | Fields added to the versioned contract (protocol 2). A field the UI would reject is now a compile error. Rejected events remain visible in Booking Setup by stage, field paths and codes. |
| Outcome reporting | Definitively unsent attempts (`NOT_DISPATCHED`, `WINDOW_MISSED`, `OMITTED`) were shown as “OUTCOME UNKNOWN”. A failed strict-Shotgun preparation or a missing browser was recorded as `SHOTGUN_TRIGGER_MISSED`. | One accounting (`src/run-outcome.ts`): planned, prepared, initiated, holds, rejected, definitively unsent (with reasons), unknown, pending. Unsent is never unknown or rejected. Strict settlement records `SECURITY_PREWARM_FAILED`, `PREWARM_TIER_OMITTED` or `API_CHECKOUT_WORKER_MISSING` when that is the reason. |
| Preparation diagnostics | `booking-entry` still dereferenced `snapshot.rows[0].date` before the schema check, so an empty grid produced a raw `TypeError` that became `BOOKING_OPERATION_FAILED`. | Evidence is read defensively, so a missing value becomes a reported field path. Any remaining generic failure emits `PREPARATION_STEP_FAILED` with the last step and the JS error class (engine messages only; no browser or provider text). Every preparation/arming/run failure gets a typed record (`src/preparation-failure.ts`): category, step, worker, retry safety, one recovery. |
| Custom counts | A `null` count (what a NaN becomes in JSON) silently became 0. | Only an absent key means 0. Any present invalid value stays invalid and is named by court (for example “Mango Court 6 · 19:00 … found 1.5”). |

The Booking Setup Shotgun step now shows the draft's preparation forecast. When it predicts omissions, it shows a capacity recommendation: the largest attempt count the same forecast predicts fully preparable, with exact before/after attempts, omissions, browser tabs and offsets. It changes the draft only when the operator accepts it, and the plan must still be saved and prepared.

Repository hygiene: the GitHub repository is public. `DiagnosticsLocal/` was ignored but 324 files were still tracked; they are no longer tracked (local copies kept, history not rewritten). `diagnostics-archive/` (deliberately committed) holds 166 files with provider booking IDs, booking numbers, transaction IDs and hold expiries of past temporary holds. No customer names, contact details, tokens, cookies, QR payloads or payment URLs were found. Removing or rewriting that published material needs the owner's decision.

## Follow-up investigation (October 20)

**Security preparation.** Run logs record 80+ successful acquisitions in September (about 1.2–14 s) and three failures since: two on October 3 that ended at the same instant after about 36.6 s in fan-out child tabs (the same run later reached a verified hold), and the 60,159 ms failure on October 18. No `HUMAN_VERIFICATION_REQUIRED` was emitted, so no visible challenge frame appeared. Hidden-page timer throttling was tested and **refuted** as the cause: in isolated Chrome 155 profiles, a page reports `visible`/focused and runs its timers unthrottled after 6.7 minutes minimized or in a background tab while Playwright is attached (focus emulation), and the release runner stays attached from arming through release. Without Playwright the same page reports `hidden`. The provider-side reason remains unproven. Inspecting Onda's own helper source was not pursued.

Diagnostics now record which of the two page helpers rejected (`failedHelper`) and whether a challenge frame appeared during the acquisition, shown or not (`challengeFrame`), without any value or provider text. A **pre-release security check** now runs one genuine verification per worker at the end of release preparation, through the release transport path, with the value discarded. It records `.local/security-check/latest.json`. Live Shotgun arming requires a passing check for the exact prepared plan within the last hour. A visible challenge raises that worker's window for the operator, as in a run. The check proves that verification works in these browsers at that moment; it does not prove the release-time acquisition will succeed.

**Browser preparation.** The two automatic failures at 00:53 on October 20 (both workers, 3.96 s, generic `API_BROWSER_PREPARATION_FAILED`) could not be traced: the runner discarded the starter's output and Playwright's message. An isolated reproduction of the same cold-start sequence (temporary profiles, real starter and verification scripts, A and B in parallel) succeeded 6/6 in about 7 s, so the original cause is still unknown. Each preparation step now reports its own closed code: the starter's printed code or `CHROME_START_FAILED`/`CHROME_START_TIMEOUT`, `CDP_ENDPOINT_UNAVAILABLE`, `ONDA_TAB_OPEN_FAILED`, `ONDA_PAGE_NAVIGATION_FAILED`/`ONDA_PAGE_LOAD_TIMEOUT`, `ONDA_PAGE_NOT_READY` or `BROWSER_PRESENTATION_FAILED`. Each code has a typed failure category and recovery.

**Remaining limit.** With the 53 s lead, an acquisition that fails after 36–60 s leaves no time for a retry before the trigger. The lead model and the 120 s freshness limit were not changed.
