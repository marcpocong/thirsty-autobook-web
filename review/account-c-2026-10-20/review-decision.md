> Historical evidence snapshot. The current decision is REQUEST CHANGES; see [README](README.md).

# Account C follow-up review - October 20, 2026

Decision: REQUEST CHANGES. Retain installed ad8cadf; do not integrate/deploy this proposal before the release on the present evidence. Live Shotgun remains NO-GO (0/2 forecast ready; installed-runtime calibration NOT VERIFIED).

Reviewed commit: c6c01eddbac2f4c33cd9e051249b7a8db686da53, direct parent ad8cadf67093b04a3edadb16da90e99ad9bafdf9. The commit was available locally; no GitHub fetch, push, merge or installation change was needed. All eight changed files were reviewed in full against ad8cadf.

## Findings requiring changes

### P1 - Emergency Stop does not cancel pending controller arming

The proposal makes inline Emergency Stop visible while the renderer's pendingAction is arming (booking-setup.ts:185 and :699), and describes it as cancelling unsent work. Controller.abortAutomation returns immediately when controller operation is still idle (ui/controller.ts:1378). During armApiRelease's clock refresh and confirmation awaits, operation is still idle. The original Terms authorization has already been captured in a local variable. Stop clears state.termsAuthorized but neither invalidates pending arming nor prevents its continuation.

Two deterministic review-only tests defer (a) the clock refresh before any confirmation and (b) the confirmation promise, call abortAutomation, then resolve the pending step and accept confirmation. Both record one apiRun mode=live command where zero is required. All runner calls are fake; no provider request was made. Both tests also fail on ad8cadf, so this is a pre-existing controller cancellation defect newly exposed by the proposal's pending-operation Stop control and not covered by its recording-only UI test. This is not evidence that the patch removed an existing controller guard.

Required correction: track pending arming in the controller, invalidate it on Stop even before the runner starts, and check cancellation after awaited clock/browser/confirmation/attestation steps and immediately before launching work. Preserve a deliberately fresh later authorization path. Extend the review cases to owner attestation and rejected promises, and prove zero runner launches after cancellation. A renderer-only disabled button or a fake abort call count does not establish this guarantee.

Evidence: [review-cancellation-combined.txt](logs/review-cancellation-combined.txt); [review-baseline-cancellation.txt](logs/review-baseline-cancellation.txt). Executable review tests: ../../tests/review-cancellation.test.ts and ../../tests/review-preconfirmation-stop.test.ts (relative to the worktree root, use tests/...).

### P2 - Valid Fixed Precision plans are newly blocked by the readiness adapter

operator-status.ts:8 imports every controller hard blocker into the Arm gate (execution-state.ts:150). Controller.refresh currently sets authorizationValid false for every precision plan without PRECISION_PHASE3 (ui/controller.ts:713), including supported Fixed Precision plans with PRECISION_TARGETS. That pre-existing diagnostic false positive was not previously an Arm-button gate.

A review test uses the real Controller and a schema-valid Fixed Precision plan. resetPrepare, refresh and Terms succeed. validateReleaseSetup reports ok=true. The controller accepts arming through its fake runner. Nevertheless the proposal's actual releaseBlockers + operatorGates combination disables Arm with 'Configuration: Saved authorization does not compile'. The same gate scenario passes on baseline ad8cadf. Existing worker/UI fixtures omit real releaseReadiness, which hides this regression.

Required correction: reconcile the readiness producer with supported General, Fixed and Smart authorization formats before promoting its diagnostics into mandatory UI gates. Add real-controller-state renderer/gate regressions for all three strategies; do not simply ignore genuine configuration failures.

Evidence: [review-fixed-readiness.txt](logs/review-fixed-readiness.txt) (candidate FAIL) and [review-baseline-fixed-readiness.txt](logs/review-baseline-fixed-readiness.txt) (baseline PASS). Review-only executable: tests/review-fixed-readiness.test.ts.

## Independent execution

- Fresh detached baseline worktree: <LOCAL_WORKTREE> at ad8cadf.
- Fresh detached candidate worktree: <LOCAL_WORKTREE> at c6c01ed.
- Supplied six-case UI regression file on baseline: 5 failed / 1 passed. The five failures reproduce fractional count, fractional offset, profile readiness, pending-call control and two-court summary defects, covering all four reported categories.
- Candidate supplied regressions and relevant integration tests: PASS, 6 files / 101 tests. Command: npx vitest run tests/operator-verification-ui.test.ts tests/operator-workflow-ui.test.ts tests/operator-workflow.test.ts tests/operator-controller.test.ts tests/live-shotgun-gate.test.ts tests/ui-lock-renderer.test.ts tests/run-outcome.test.ts --maxWorkers=1. Vitest matched six files; run-outcome.test.ts is not a separate file at that location. Outcome/UNKNOWN behavior was covered by operator workflow/controller suites.
- New review cancellation cases: FAIL 2/2 on both baseline and candidate.
- New Fixed Precision gate case: FAIL on candidate; PASS on baseline. Baseline uses the same real diagnostic checks, with its original gate implementation, which does not consume the new optional readinessBlockers field.
- Candidate typecheck: PASS. UI build: PASS, c6c01ed-e2226f2723, dirty=false for tracked source. Distribution: PASS, 468 files / 0 problems. Whitespace check: PASS.
- No full 1,853/1,854-case rerun was performed in this review. Those totals remain Account C's earlier evidence; this review independently reran the targeted 101 and the three additional review cases.

The supplied tests exercise saved/prepared mismatch, Terms refusal, exact-plan owner attestation enforcement, UNKNOWN accounting, unsent outcomes, locks and normal UI recovery. The production controller, runner, fingerprint calculations, journal logic and timing thresholds are unchanged by the proposal. The two findings above prevent an end-to-end safety/operation acceptance despite the passing existing suites.

## Packaged Electron and later integration requirements

Packaged Electron verification is still required: the pendingAction guard interacts with asynchronous IPC status publication, confirmation/owner-dialog cancellation, Emergency Stop and rejected bridge promises. Chrome renderer fixtures and fake runners cannot establish those Electron lifecycle properties. Test in an isolated package with synthetic controller/provider paths, no real profiles or saved live plan. Include window close, Escape/cancel, Stop before/during confirmation, stale status arrival, rejected calls and a legitimate fresh re-arm after cancellation.

After correction, require:

1. All supplied and review regressions pass; real-controller readiness cases cover General, Fixed and Smart, fingerprints, Terms, attestation, UNKNOWN/holds and cancellation.
2. Full repository runner, typecheck, UI build, distribution verification and whitespace checks pass without relaxed timing thresholds.
3. Passing GitHub CI for the exact proposed integration SHA; do not infer CI coverage from ad8cadf or from the original c6c01ed local tests.
4. Passing isolated packaged-Electron checks above, followed by a separate explicit deployment decision.
5. If deployment is later authorized: canonical updater preflight, exact installed SHA/build/hash and installed distribution verification; before/after preservation of profiles, configuration, objective, journals/UNKNOWN records; fresh idle/unarmed packaged-app smoke. No automatic live Terms authorization or arming.

Neither UI fixes nor these offline checks resolve preparation capacity or compatible Electron-runtime timing calibration. New passing live-readiness evidence and a separately authorized operational decision would still be required to change NO-GO.

## Preservation and review artifacts

No tracked candidate source was changed and no proposed commit was amended. Three review-only test files remain untracked in the detached candidate worktree; baseline has copies used for comparison. The original Account C branch, commit and report remain intact. Local main remains clean at ad8cadf. The canonical EXE hash still matches 20640bd07070bac72fc4af509bb00bf3c52be4beff6c5d45893c22d06808bbf6. No live configuration, Terms, booking plan, provider checkout, hold or payment was changed.

Logs are copied alongside this review. New UI screenshots from the independent regression run remain in screenshots/ under this candidate worktree's .local directory; they are synthetic fixtures, not installed-runtime readiness proof.
