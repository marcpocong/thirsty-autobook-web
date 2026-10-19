# Account C proposal and independent review - October 20, 2026

**Current decision: REQUEST CHANGES. Do not deploy the proposal. Live Shotgun remains NO-GO.**

This bundle publishes the proposal, prior evidence, independent review and failing reproducers for peer/AI review. It deliberately changes no active application source, configuration, runtime state or CI test selection on main. The candidate is retained separately at its exact original commit.

## Start here

- [Independent review and required changes](review-decision.md)
- [Original Account C report](original-report.md) - a historical report, superseded by the independent review decision.
- [Complete candidate patch against ad8cadf](proposal.patch)
- [Earlier baseline audit checkpoint patch](baseline-checkpoint.patch) - provenance only, not a release candidate.
- [Logs](logs/) and [synthetic UI screenshots](screenshots/)
- [Review-only failing reproducers](reproducers/)
- [Artifact hashes](SHA256SUMS.json)

## Exact source references

| Reference | SHA | Meaning |
|---|---|---|
| Runtime baseline | `ad8cadf67093b04a3edadb16da90e99ad9bafdf9` | Installed build retained; this publication does not update it |
| Proposed branch `codex/operator-ux-verification-20261020` | `c6c01eddbac2f4c33cd9e051249b7a8db686da53` | Eight-file UI proposal; **not integrated into active source on main** |
| Earlier branch `codex/operator-ux-20261020` | `1041bea` | Preserved baseline audit checkpoint from 8a2bf0a; not approved for integration |

Use `git diff ad8cadf c6c01ed` after fetching the proposed branch. The candidate patch here contains the same complete diff. Main contains this review bundle only; seeing it on main does not mean the proposal was accepted or installed.

## Verified findings

The original four defect categories reproduce on ad8cadf. The candidate's supplied regressions and relevant integration suites passed independently: **6 files / 101 tests**, plus passing typecheck, UI build and distribution verification (468 files, zero problems).

Additional review cases prevent acceptance:

1. **P1: Stop does not invalidate pending controller arming.** Two tests defer clock refresh or confirmation, call Stop, then complete the awaited step and accept confirmation. Each records one live-mode command through a fake runner instead of zero. The backend flaw also exists on ad8cadf; the proposal exposes a pending-operation Stop control without establishing cancellation. No real checkout occurred.
2. **P2: Supported Fixed Precision plans become unarmable.** A real controller refresh emits an existing false configuration diagnostic for Fixed Precision. The proposal promotes it into an Arm-button blocker despite successful schema validation and controller arming. The review case passes on baseline and fails on the proposal.

The original 1,853-test full run and separate sixth UI check are retained as historical evidence, not claimed as a new full rerun by the reviewer. The supplied UI tests alone did not cover the two findings above.

## Reproduce safely

Use a fresh checkout of the candidate branch with Node 24+ and dependencies installed. The review reproducers use stubbed runners, clocks and confirmations; do not use production profiles or configuration. The `.test.ts.txt` suffix keeps deliberately failing review cases outside the normal Vitest discovery on main.

Copy the three files from `reproducers/` into that checkout's `tests/`, removing only the final `.txt`, then run:

```text
npx vitest run tests/review-cancellation.test.ts tests/review-preconfirmation-stop.test.ts tests/review-fixed-readiness.test.ts --maxWorkers=1
```

Expected at c6c01ed: three failures, as recorded in the logs. The Fixed Precision baseline comparison uses the baseline gate implementation with the same controller hard-check data; both cancellation tests also fail on baseline. See the independent review for the exact distinction between pre-existing defects and newly introduced behavior.

## Before any later integration or deployment

Correct the findings and retain their regressions. Require the full repository test runner, typecheck, build/distribution checks, and CI on the exact proposed integration SHA. Independently verify isolated packaged-Electron IPC, confirmation/attestation cancellation, Stop before/during arming, failed bridge calls and a legitimate fresh re-arm. Deployment still needs a separate explicit decision, canonical updater preflight, installed SHA/hash/distribution checks, protected-state preservation and an idle/unarmed smoke test.

**Unresolved operational blockers:** preparation forecast **0/2 ready**; installed Electron-runtime timing calibration **NOT VERIFIED**. UI corrections do not change the live Shotgun NO-GO verdict. No live plan, Terms authorization, provider submission, hold or payment was changed by this publication.

All screenshots and runner commands in this bundle are synthetic test evidence. Private profiles, credentials, customer data, session material and raw runtime archives are excluded. Local temporary paths in textual logs were redacted and log whitespace normalized for publication; source SHA references and assertions are retained. Patch bytes are preserved exactly.
