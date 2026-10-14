# Thirsty Single-App Update and Release Policy Report

October 14, 2026, Asia/Manila. Implementation and offline validation completed. **The canonical installation update is blocked by existing unresolved submission journals.** The working installation remains intact. No live provider checkout, booking, new hold, payment or live Shotgun burst was performed.

## Source and publication

Starting source and fetched main: `e07207547f3d2b387c5841a7046a295869c8771d` (clean). Final implementation: `e2089e4133e4f408bdf25b7033c4f34bf9204727`. The report-containing publication tip and final GitHub CI URL/status are recorded exactly in `.local/single-app/publication.json`; a tracked report cannot contain its own final commit SHA. Local source, remote main and CI head must match before the updater can package. This report does not treat a successful source publication as a successful installed update.

## Configured calendar and live boundaries

Mango retains its existing VERIFIED 08:00:00 Asia/Manila / release date +2 calendar day policy. Buko now uses OWNER_ASSUMED 08:00:00 / +6 calendar days, explicitly owner-approved October 14 based on the official advertised October 20 horizon. No further release-window observation is required for planning. The observed banner is historical evidence; this assignment did not independently observe a recurring Buko rollover.

October 15 at 08:00 Manila therefore plans Mango October 17 and Buko October 21. Exact matching release timestamps allow a shared cohort. Independent dates, court registry UUIDs and wing-specific identity remain intact; Mango Court 3 and Buko Court 3 are distinct. The planner displays the next release and both booking dates with readable owner-assumed wording. Existing saved strategies are never rewritten.

`assertVerifiedRelease` still refuses OWNER_ASSUMED policy as independently verified provider authorization. Proofless release compatibility and provider request-rate permission continue to block live Shotgun. The existing Normal availability/proof, identity, Terms, one-shot, hold and QR gates remain authoritative. No live test was executed.

## One application and update pipeline

Verified canonical launcher:

`C:\Users\marcp\Downloads\Thirsty Pickle Bot\Thirsty Pickle Bot.exe`

Recognition checked original installation markers, launcher SHA-256, saved configuration, private directory, Node/Electron runtime, launcher script and the runtime content ID. There is no new-path or nested-folder fallback. `npm run app:update`, `npm run release:build` and `npm run exe:build` use the same canonical release checks. Alternate output and dirty-source bypass arguments are refused. Committed clean main must match remote main and its successful final-SHA GitHub CI.

Eight older source/test-package/archive launcher filenames were retired to adjacent `launcher.retired.bin` backups, with SHA-256 equality verified. Their folders and data were preserved. The stale tracked source-root EXE was removed from Git distribution. A workspace inventory now finds only the canonical `Thirsty Pickle Bot.exe`. Retirement details are local in `.local/single-app/retired-launchers.json`. No shortcuts or Start Menu entries were created.

The updater stages all new managed files in the installation's internal `.local/build/staging`, verifies freshly compiled dist and hashes launcher/runtime/dependencies, rechecks source identity and lifecycle safety, then uses same-volume renames. Previous managed files are retained as numbered internal rollback entries without a second user-facing EXE. A persistent transaction record and exclusive lock detect interrupted updates. In-process replacement or validation failure restores previous files. No automatic process termination is used.

Only explicit application paths can be replaced. Saved configuration is not parsed-and-rewritten, migrated, reset or normalized during an update. Private state is not copied into the package. Configuration and `.local/private` digests are checked during installation. All profiles, journals, holds, handoffs, historical runs, bindings, security settings, allocations and offsets remain outside the managed replacement set. Existing source SHA/build ID display in the navigation and Tools remains covered by tests.

## Actual installed version and refusal

Previous **and current** installed package version: `0.1.0`.

Installed source SHA: `55d940a5e2d06f5b82fd47a4bcb9e46800fdbbcb`.

Installed build ID: `55d940a-9e1d4f91d7`.

Installed content ID: `9e1d4f91d784927fdefd13e113ec724b1c4bf0873d0ebeb784dc2f0c421a2af3`.

Installed launcher SHA-256: `174B4BA8758675C1E17EE0AA672601FF0C213B99B20A54F3F4BF9DDA21D287DF`.

**New installed version/build ID: none; installation was not applied.** Detection verifies the existing executable and runtime against their original metadata. The canonical safety check returns `APP_UPDATE_UNRESOLVED_JOURNAL`. A sanitized read found 42 historical real-scope journals still marked `unknown`: two September 21, four September 23, one September 30 and 35 October 1 target records. None is labelled OFFLINE_INTERCEPTED. Their age and generic HTTP errors do not prove rejected or unsent outcomes. No records were deleted, rewritten, reclassified or retried.

The retained validated hold's recorded expiry has elapsed. No running main app or dedicated booking browser was found at the preflight inspection. Neither fact resolves UNKNOWN journal evidence. Per the owner's explicit refusal requirement, the updater stops before creating a package stage or replacing working files. Existing lifecycle state must be reconciled from authoritative evidence before an actual update can proceed. Merely clearing a lock, approving a retry or waiting longer is not reconciliation.

Private configuration and `.local/private` baseline hashes are recorded in `.local/single-app/baseline.json`; protected profile/journal/settings digests are in `protected-state.json`. Final equality results, existing installed provenance and the precise release-command failure are recorded in `publication.json`. The actual installed new UI/Test Lab cannot be claimed verified because the installation was refused.

## Verification results

- Typecheck passed.
- Complete sequential local suite: **149 files / 1,663 tests passed**, with no automatic retries, removed tests, increased timeouts or weakened strict trigger tolerance.
- Clean UI/runtime build and source-versus-dist verification: **422 compiled files, zero problems**.
- Installation tests cover recognized/missing/ambiguous targets, launcher and runtime inconsistency, active processes, dispatch/UNKNOWN/active holds, successful in-place replacement, mid-update failure rollback, installed-validation rollback, pre-replacement refusal and byte-preserved config/private/profile fixtures.
- Existing release/migration/identity/allocation/provenance regressions remain. Owner-assumed planning and both next booking dates are asserted in renderer coverage.
- All intercepted Test Lab scenarios passed. The first concurrent full-suite attempt exposed one silent payment-conflict child exit; its focused rerun passed. Local default testing now follows CI's existing sequential scheduling for the two heavy browser suites. Child-exit diagnostics were improved without changing execution rules.
- Existing Electron packaged-runtime smoke steps were reproduced in an **internal test stage**, with synthetic configuration, no new launcher and no private fleet. Both-wing rehearsal initiated two simulated holds and omitted six attempts; draft save/reopen, wide/narrow layout, Buko Book Now navigation and provenance display passed with **zero renderer errors**. Screenshots and smoke JSON are under `.local/single-app/smoke`. This verifies staged compiled runtime, not an installed new EXE. The stage is not a user-facing application and can only perform the explicitly intercepted test.
- Final exact CI status, final SHA and release-command results are in the publication sidecar. Successful CI does not override the local unresolved-lifecycle gate.

## Recovery and next update

Normal future updates use `npm run app:update` from Source after clean-source publication and final CI. Resolve uncertain lifecycle evidence first; do not delete it to make installation pass.

On an in-process update failure, the updater restores previous managed files automatically. For an explicit completed-update rollback, safely close the app and run `node scripts/app-rollback.mjs`. The script restores numbered backups, validates previous SHA/content ID/configuration and retains displaced files internally. No rollback is needed for this assignment because replacement never began.

After a power interruption, inspect `.local/build/update-transaction.json` and verify no updater is running. Review and remove only a proven stale updater mutex before using the rollback command; never remove the automation/booking lock for this purpose. Existing stages and recovery artifacts are refused rather than silently discarded. Full instructions are in `docs/BUILD_AND_RELEASE.md`.

Remaining live blockers are independently verified recurring Buko timing, release-slot proof/publication, proofless checkout acceptance, provider rate permission and genuine mixed-objective identity/session coordination. The chosen schedule supports planning and offline rehearsals without claiming any provider advantage or live compatibility. The remaining local blocker is reconciliation of the existing UNKNOWN submissions; the installed application update remains incomplete until that safety condition is satisfied.
