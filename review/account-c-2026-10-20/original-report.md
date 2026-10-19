> Historical evidence snapshot. The current decision is REQUEST CHANGES; see [README](README.md).

# Independent operator workflow verification - October 20, 2026

Decision: the integrated baseline has reproducible UI defects. The isolated corrections are proposed for Account A review only. Live Shotgun remains NO-GO.

## Source and boundaries

- Verified local main is ad8cadf67093b04a3edadb16da90e99ad9bafdf9 and clean. Remote main/CI were not independently queried in this task.
- Review branch: codex/operator-ux-verification-20261020, based directly on ad8cadf.
- The earlier baseline audit is preserved on codex/operator-ux-20261020 at 1041bea. Its logs and worktree remain available; it is a checkpoint, not a deployment candidate.
- Existing C fix 4945457 already uses planWorkerIds in Booking Setup and Next Release, including General, Fixed Precision and standby workers. It and its integrated journey/outcome regressions were verified and not duplicated in this proposal.
- No main push, merge, installation update, live plan edit, live Terms authorization, real provider submission, hold or payment was performed. Renderer fixtures block real network destinations. Controller tests use fake runners; Chrome Lab uses intercepted synthetic providers.
- Canonical EXE was read only for its hash: 20640bd07070bac72fc4af509bb00bf3c52be4beff6c5d45893c22d06808bbf6, matching the supplied installed report. This is not a packaged-app UI smoke-test claim.

## Reproduced defects and proposed narrow corrections

1. FAIL on ad8cadf: entering fractional custom counts/offsets in Customize left the old compiled authorization executable. The editor returned after native validity reporting, so the draft never received the edit. Regression uses fill + Tab + Review & Run, without DOM mutation. Finite edits now reach existing compiler validation, which blocks the draft and identifies the invalid court/offset; no saved authorization is overwritten. Evidence: [integrated-editor-baseline.txt](logs/original-integrated-editor-baseline.txt); 1440-entered-invalid-count.png and 1440-entered-invalid-offset.png.
2. FAIL on ad8cadf: a prepared plan with Terms checked could show enabled Arm despite identity issues or controller hard blockers. Arm gates now consume those already-published reasons. Booking Setup and Next Release show the same hard-block detail, and the clock recovery invokes syncClock; profile recovery invokes resetPrepare. No capacity, clock, timing or dispatch thresholds were changed. Evidence: [integrated-baseline.txt](logs/original-integrated-baseline.txt); 1366/1440/390-clock-blocker.png.
3. FAIL on ad8cadf: Prepare/Arm/Save Draft could remain available before the pending bridge call published controller status. A local pending guard now closes conflicting actions and draft decisions during the call, restores them on settlement, and leaves Emergency Stop reachable. The regression defers bridge promises and clicks only visible controls; it records one call per action. Evidence: [integrated-baseline.txt](logs/original-integrated-baseline.txt); [regression-final.txt](logs/original-regression-final.txt).
4. FAIL on ad8cadf: the saved Smart summary and Precision panel hardcoded one hold/court for a saved two-court quota. Both now render the saved STRATEGY_V2 objective quota. Legacy plans retain a one-hold objective. Engine quota behavior was not changed. Evidence: [integrated-quota-baseline.txt](logs/original-integrated-quota-baseline.txt); [integrated-panel-baseline.txt](logs/original-integrated-panel-baseline.txt); two-court-saved-summary.png.

## Exact changed files

- src/execution-state.ts: presentation gates and shared hard-block readiness layer.
- ui/renderer/booking-setup.ts: pending guards, published readiness/identity inputs and real clock recovery.
- ui/renderer/next-release.ts: same published hard-block reasons.
- ui/renderer/operator-status.ts: controller-check-to-visible-recovery adapter.
- ui/renderer/shotgun-editor.ts: invalid edits reach compiler validation.
- ui/renderer/app.ts and ui/renderer/index.html: saved quota in the two misleading summaries.
- tests/operator-verification-ui.test.ts: six behavioral renderer cases (count, offset, readiness/recovery, pending operations, quota, owner dialog).

No ui/controller.ts, src/workers.ts, calibration module, provider client, submission journal or dispatch module changed.

## Verification coverage

PASS: integrated Draft -> Save -> Prepare -> Terms -> Arm -> monitor -> verified hold/UNKNOWN/unsent presentation; exact saved/prepared fingerprint gates; explicit keep/load saved plan; invalid count with court/field detail; capacity recommendation is draft-only; disconnected required workers; categorized safe recovery; retained lock and unknown review; all four destinations and setup steps at desktop/narrow widths. These use the existing real renderer with controller bridge stubs plus controller regressions, not live provider execution.

PASS: new owner-dialog UI check at 390x844. Arm opens a synthetic exact-fingerprint attestation dialog; Cancel has initial keyboard focus; Escape declines; the visible confirmation button accepts only the supplied fixture fingerprint. Actual live attestation enforcement is covered separately by live-shotgun-gate tests. No real attestation record was created.

PASS: screenshot review at 1366x768, 1440x900 and 390x844 for clock recovery; invalid count/offset and two-court summaries; no horizontal overflow in the tested states. Scrolling is required on the narrow screen. Important screenshots are in screenshots/ (relative to this report directory). Screenshot content and timestamps are synthetic renderer fixtures, not current readiness evidence.

Validation results and proposed commit SHA are appended after final completion below.

## Remaining risks and limits

- Windows production EXE/Electron UI was not launched or changed in this task. Chrome renderer + stubbed bridge + controller tests do not establish Electron IPC, packaged dialog lifecycle, actual browser startup or provider-session readiness.
- The two recorded release blockers remain unresolved: preparation capacity projects omissions, and installed Electron-runtime calibration has not been independently validated here. These UI corrections provide no new live acceptance evidence.
- The automatic browser-start failure and October 18 provider security failure remain unproven. No retry or live experiment was attempted.
- A passing offline journey does not establish provider acceptance, release-boundary ordering, real holds or both-court booking success.
- Readiness checks and worker/session state are volatile. The UI displays controller evidence; Account A must review these changes and perform any separately authorized integrated/package verification before considering deployment.


## Final PASS/FAIL result and review commit

- Integrated ad8cadf: FAIL on the four defect categories above; each correction has failing baseline regression evidence.
- Proposed isolated correction: PASS for tested offline renderer/controller workflows.
- Full `npm test` runner: PASS, **165 files / 1853 tests**. Batch counts: general 1,721; intercepted Chrome Lab 24; strategy flow 5; Normal Lab 4; destinations 2; armed dispatch 53; fanout dispatch 12; October 18 incident 26; observer independence 6.
- Final six-case UI file: PASS, **6/6**. Five were included in the full batch; the owner-dialog check was added afterward and the complete six-case file was then rerun. Unique tested cases across these runs: 1,854.
- Final typecheck: PASS. Clean committed UI build: PASS, build `c6c01ed-e2226f2723`, dirty=false. Distribution check: PASS, **468 files / 0 problems**. Whitespace check: PASS.
- Proposed commit for Account A: **`c6c01eddbac2f4c33cd9e051249b7a8db686da53`** on `codex/operator-ux-verification-20261020`, direct parent `ad8cadf67093b04a3edadb16da90e99ad9bafdf9`.
- No merge, push, deployment or live booking is authorized or performed. Account A must review before any further integration. Live Shotgun remains **NO-GO**.

Screenshots inspected:

- [Invalid custom count](screenshots/1440-entered-invalid-count.png)
- [Invalid literal offset](screenshots/1440-entered-invalid-offset.png)
- [Clock blocker and recovery at 1366 px](screenshots/1366-clock-blocker.png)
- [Clock blocker and recovery at 390 px](screenshots/390-clock-blocker.png)
- [Exact-plan owner dialog at 390 px](screenshots/390-owner-dialog.png)
- [Saved two-court goal](screenshots/two-court-saved-summary.png)
- [Integrated prepared Terms stage](screenshots/1366-prepared-terms.png)
- [Integrated armed stage](screenshots/1366-armed.png)
- [Integrated outcome at 560 px](screenshots/560-outcome.png)

Evidence logs are alongside this report. They include the red baseline runs, full validation, final six checks, typecheck and committed build/distribution proof. Earlier baseline checkpoint logs remain in the separate preserved worktree.
