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
