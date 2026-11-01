# Pending hold recovery implementation report

This report is the initial implementation snapshot. The subsequent owner-authorized canonical installation and authentication-flow repair are described in [PENDING_HOLD_AUTH_RECOVERY.md](PENDING_HOLD_AUTH_RECOVERY.md); the installation-blocked observations below remain historical evidence.

## Overall status

**Source implemented; canonical installation and new live qualification blocked.** This report records the source implementation and its actual test boundaries. Final source commit/push and GitHub CI are reported with the task completion response and retained in the `main` history/[workflow results](https://github.com/marcpocong/thirsty-autobook-web/actions/workflows/ci.yml?query=branch%3Amain). No PR is used for this task.

## Modules and entry points

- `src/api-booking/checkout-recovery.ts`: backward-compatible private capture v2, strict historical revalidation, original intent matching and the shared verified recovery entry point.
- `private-persistence.ts`: complete-file, flushed, write-once publication.
- `pending-hold-state.ts`: separate immutable state/milestone history with exclusive sequence publication.
- `provider-hold-verification.ts`: strict independent official lookup validation.
- `pending-hold-recovery.ts`: identity-bound, read/access-only recovery, bounded retries, exact checkout/order/QR checks.
- `recovery-claim.ts`: cross-process per-worker recovery ownership and safe restart handling.
- `pending-hold-service.ts`: restart discovery, current-session freshness, original/fresh-tab browser connection and browser-rotation eligibility.
- `recovery-runtime.ts` / `recovery-window.ts`: canonical provenance/integrity and external-dispatch exclusion, without clearing original lifecycle state.
- `desktop-runner.ts`: response capture binds original customer/profile; both handoff paths use the shared controller after existing release-critical bookkeeping gates.
- `qr-order-summary.ts`: exact labelled totals and retained exact hourly/aggregate matching.
- `ui/pending-hold-actions.ts`, `main.ts`, `preload.cts`, `types.ts`, renderer `pending-holds.ts`/Activity: validated IPC and functional Pending Holds & Recovery actions. Existing release summaries distinguish local validation from independent provider status.
- `scripts/recover-checkout.ts`: shared list/recover CLI, canonical entry-point checks and safe output.
- `scripts/rehearse-shotgun-live.ts`: requires a verified canonical runtime and installed recovery-verification v2; no source fallback around an update blocker.

Architecture, state semantics, operator steps and security boundaries are detailed in [PENDING_HOLD_RECOVERY.md](PENDING_HOLD_RECOVERY.md).

## Automated evidence

Tests cover HTTP 200 capture and malformed data, strict timestamp compatibility, disk write/link/flush failure, write-once behavior, concurrent immutable receipts, actual process restart, lost-process claim evidence, current customer/profile binding, historical UNKNOWN preservation, missing post-response journal data, token absence versus malformed token, original/fresh browser tabs, multi-worker isolation, HTTP 401/403/404/410/429/5xx, timeout/transport/size failures, Retry-After bounds, group/identity/date/session/amount mismatch, partial/extra/duplicate hours, expiry/payment evidence, canvas/image/broken/missing QR, wrong checkout identity, zero new booking requests, renderer action wiring and narrow viewport behavior.

At runtime freeze:

- Four core recovery/persistence/restart suites: **82 tests passed**.
- The preceding targeted run including operator workflow UI: **90 tests passed**; subsequent immutable-file checks were revalidated by the core run.
- Earlier isolated browser/UI recovery run: **74 tests passed across four suites**, including actual Chrome fixtures and fresh-tab recovery. Additional negative cases were added afterward and included in final regression validation.
- Typecheck passed.
- Clean source build and source/distribution verification passed: **531 compiled files, zero problems**.
- The first broad regression pass found one introduced expectation for the old display label `HOLD VERIFIED`; its fixture now requires `LOCAL RESPONSE VALIDATED` and the independent-provider explanation. No deadline, timeout, production assertion, permit rule or failure classification was relaxed.
- Final full regression: `node scripts/test-all.mjs` **passed, exit 0: 2,256 tests across 194 files**, November 1, 22:40–22:52 Manila. This includes all eight isolated heavy suites and the strict dispatcher/observer timing tests; no platform crash occurred in this run. GitHub CI independently runs the full configured suites, typecheck, clean build and distribution verification for the pushed `main` SHA.

The intercepted browser tests refuse every external destination and count both booking creation routes. Their fixture response is synthetic; they are not presented as Onda provider acceptance or real QR settlement.

## Real historical compatibility: offline only

The new discovery path read **17 existing private recovery records, zero unreadable**, without modifying them or making a provider request. It asserted **zero active provider confirmations** from those historical files.

All seven original November 1 sent-child captures pass current strict local historical response validation and exact original journal identity checks. All seven capture hashes remain unchanged. This is backward-compatibility evidence, not a provider confirmation, recovery success or reclassification of those UNKNOWN attempts.

## Phase A baseline and live gate

Read-only baseline was recorded on November 1 at `2026-11-01T14:01:05.040Z` (22:01 Manila):

| Browser | Dedicated profile | Existing local customer binding | Page observation | New provider verification |
|---|---|---|---|---|
| A | Verified | Verified | One clean venue page; no detected hold | Not performed |
| B | Verified | Verified | Two venue pages; one not clean, one clean; no detected hold | Not performed |
| C | Verified | Verified | One clean venue page; no detected hold | Not performed |

A verified profile/local binding is not proof of an authenticated provider account or a free slot. No page, selection or identity was discarded. Browser B's non-clean page was not normalized for another test.

Canonical detector: **`APP_INSTALLATION_RUNTIME_INCONSISTENT`**. The existing base runtime still includes earlier recorded targeted hotfixes and is not a complete installation of this source. Existing read-only update safety: **REFUSED**, including `APP_UPDATE_ACTIVE_PROCESS` and recent `APP_UPDATE_UNRESOLVED_JOURNAL` blockers; 53 historical UNKNOWN records were reported in the snapshot. These counts are time-specific and not a current provider result.

The existing retained lock advertises the earlier Court 7 hold's expiry at 15:40:07.160 Manila. That advertisement has elapsed, but this implementation did not obtain new provider terminal evidence, clear the lock, cancel the hold or mark it reconciled. Original UNKNOWN/duplicate safeguards remain.

The owner authorizes broad controlled live tests, but expressly forbids bypassing installation/update protections or using a substitute unverified installation. Therefore no new booking test, provider verification, fresh-tab live recovery or installed-app restart test was attempted through the new source. No fresh slot was asserted open from missing/stale observer data. Offline and intercepted validation continued instead.

## Live counts for this implementation task

| Metric | A | B | C | Total |
|---|---:|---:|---:|---:|
| Real checkout submissions | 0 | 0 | 0 | **0** |
| New real locally valid responses | 0 | 0 | 0 | **0** |
| New independently provider-confirmed holds | 0 | 0 | 0 | **0** |
| Successful new live original-tab recoveries | 0 | 0 | 0 | **0** |
| Successful new live fresh-tab recoveries | 0 | 0 | 0 | **0** |
| New live QR handoffs | 0 | 0 | 0 | **0** |
| Actual payments | 0 | 0 | 0 | **0** |

There are **zero new outstanding test holds created by this task**. Historical outstanding/unresolved evidence is retained; that statement does not claim every older provider reservation is absent. The earlier Court 5/Court 7 live tests belong to the historical incident/rehearsal report and are not counted again as validation of this new implementation.

## Safety findings and remaining qualification

- Post-validation preservation check at 22:53 Manila: **all 925 protected lifecycle files unchanged**, with unchanged `config.local.json` hash and `.local/private` tree digest. Private receipts remain local and are not published.
- UNKNOWN journals remain UNKNOWN even if the separate provider verification/QR recovery succeeds. Their original target stays duplicate-blocking; no journal IDs are backfilled and no permit is reused.
- Browser rotation is an eligibility calculation, not a release/cancellation mechanism. Outstanding/unconfirmed records continue to exclude a worker from another test. Correct profile/customer and fresh non-overlapping availability remain independently required.
- All provider confirmation/QR work stays outside the scheduled Shotgun critical interval; no schedule, strict 50 ms tolerance, concurrency, shot budget or safety stop was changed.
- Recovery never substitutes another customer/browser for an ambiguous original attempt. Missing legacy identity evidence, unsupported provider shape, corrupt records, active/unknown ownership and live-dispatch overlap fail visibly.
- The new controller is not installed. Installed UI/IPC behavior, current real provider payload compatibility, real A/B/C rotation, actual installed application restart recovery and new provider-confirmed live recoveries remain **UNVERIFIED/BLOCKED**, not passed.
- The November 1 08:00 HTTP 200/early-404 contradiction is still unresolved. Source validation does not supply provider-side commit evidence or explain original reservation absence.

Next qualification must use the canonical updater only after its existing integrity/lifecycle conditions permit replacement, then verify the actual installed build and execute controlled fresh-slot tests through that installation. No force-update or alternate-install route is introduced.
