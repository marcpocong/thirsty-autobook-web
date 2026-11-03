# November 3 08:00 release incident and repair

**Incident date: November 3, 2026. Operational times below are Asia/Manila (UTC+08:00).** UTC timestamps in [evidence.json](evidence.json) retain their original representation.

## Finding

The owner armed before the release. The application stopped the live run at **07:58:00.971**, before any booking POST. Its “Shotgun browser tabs are not ready” message identified the wrong cause.

The freeze read reported a public booking conflict on **Mango Court 7, November 5, 19:00–22:00**. The runner excluded worker C's two attempts, leaving six other configured attempts. A later completeness check still required the original eight and threw `SHOTGUN_TOPOLOGY_NOT_READY`. That ended the entire run, including the non-conflicting targets on Courts 5, 6 and 4. All four browsers had reported ready during initial preparation.

The owner selected the repair policy: **“Skip that court; continue remaining saved attempts.”** The repaired runner now validates the original saved authorization minus only public-conflict exclusions. It retains every surviving worker, target and literal offset, and reports each excluded child as unsent. It does not redistribute the skipped attempts.

**Incident outcome: zero booking POSTs, zero independently confirmed holds and zero QR handoffs.** The subsequent six-attempt success described here is an offline policy/dispatcher replay, not a live booking or a recovered release.

## 1. Intended release and exact saved schedule

| Item | Saved scope for the incident |
|---|---|
| Release | November 3, 2026, 08:00 Manila |
| Service | November 5, 2026, Mango, 19:00–22:00 |
| Court priority | 5 → 6 → 7 → 4 |
| Workers | A→5, B→6, C→7, D→4; two children each |
| Maximum configured attempts | Eight; no standby, Wave 2, Rescue or automatic fallback |
| Original relative offsets | A −840/−360; B −720/−240; C −600/−120; D −480/0 ms |
| Limits | PHP 2,100 per three-hour checkout; payment remains manual |

The original schedule uses the saved pre-release timing policy. This incident does not demonstrate provider publication or acceptance at those offsets. Local trigger times, browser request initiation and provider receive time are different measurements.

## 2. Evidence timeline

The live runner was `bced8297-f70e-440c-949c-1a705ca75ead`; its controller activity run was `890f014e-83e4-4c9c-b07f-eb774f34751d`.

| Manila time | Recorded event and interpretation |
|---|---|
| 07:43:17 | Live runner started for November 5 with four workers and the eight-attempt maximum. The run was active well before release. |
| 07:43:20 | A/B/C/D all reported `BROWSER_READY`. This establishes initial preparation, not indefinite browser or security readiness. |
| 07:50 | The runner refreshed its network clock before release. |
| 07:58:00 | Freeze reads succeeded. Detailed availability classified the target date `UNRELEASED`; public-booking queries succeeded for all seven courts. Court 7 had three represented records; the other three saved courts had none. |
| 07:58:00.967 | `PHASE3_WAVE1_EXCLUDED`: worker C, `PUBLIC_BOOKING_PRESENT`, `PUBLIC_BOOKING_CONFLICT_AT_FREEZE`. |
| 07:58:00.969–.971 | A/B/D reached Wave 1 pricing. C was absent from that set. |
| 07:58:00.971 | `FAILED / SHOTGUN_TOPOLOGY_NOT_READY`. The runner never reached the child armer or checkout dispatch. |
| 07:58:00 | Controller classified the failure as `INVALID_VENUE_OR_TAB` with recovery `RECHECK_BROWSERS`. That advice did not address the conflict/count mismatch. |
| 07:58:32–35 | The owner's subsequent preparation and dry validation completed. These modes do not submit a booking. |
| 07:59:00 | Separate observer recorded `7/19:00`, `7/20:00`, `7/21:00`. Court 7 response: HTTP 200, cache MISS, Age 0. |
| 07:59:38 | The first subsequent security-only run failed worker D's challenge helper after 60,095 ms. A/B/C passed. |
| 07:59:50 | A second security-only check passed A/B/C/D. It did not re-arm the failed live run. |
| 08:00 onward | Saved public-booking observer reads continued to show the Court 7 cells. No later live booking runner was launched in this recovery sequence. |
| 08:03 | The owner closed the bot browsers and saved the next plan for November 6. |

The original freeze response bodies were not retained in the live trace. The runner's successful read and exclusion events establish what its classifier decided. The independent observer corroborates the exact Court 7 hours a minute later, including fresh cache metadata; it cannot reconstruct the earlier provider-side state or explain how those records came to exist before nominal release.

Public records do not prove ownership, payment, an active bot hold or the provider's internal publication rules. No account ban or blanket availability denial was established by this incident.

## 3. Root cause and misleading recovery advice

The failure was the interaction of two existing policies in [desktop-runner.ts](../../../src/api-booking/desktop-runner.ts):

1. At T−2 minutes, classify immediate targets against public evidence and remove known public conflicts unless the owner explicitly included an existing conflict override.
2. For Shotgun, require the final Wave 1 array to contain the same number of children as the original unfiltered authorization.

For this run, policy 1 removed C's two children. Policy 2 compared six surviving children with eight configured children and threw the same error used for missing or invalid browser tabs. The physical-tab check followed that count check; the recorded failure therefore does not demonstrate a physical-tab failure at 07:58.

The controller mapped that generic error to browser recovery instructions. Re-preparing browsers could not fix the inconsistency between conflict filtering and the original count. The earlier green preparation, machine/build and local timing checks had not exercised this freeze-conflict branch. Their success did not establish actual release qualification.

### Separate later security failure

Security-only run `61ad3baf-0023-4bbf-bba5-bfd90b6d6d0d` failed D with `ONDA_SECURITY_VERIFICATION_FAILED`, `failedHelper=challenge`, after 60,095 ms; no visible challenge frame was reported. Run `0b7a7949-1b93-49f1-bb0f-33c4c45eeb52` subsequently passed all four workers at 07:59:50.

The available evidence does not establish the provider-internal cause of the timeout. A later pass is not proof of a permanent repair. This patch fixes the freeze/count failure; it does not claim to fix that separate challenge-helper event, reuse security values, bypass verification or automatically restore arming.

## 4. Incident accounting versus replay accounting

| Measurement | Original live incident | Repaired offline replay |
|---|---:|---:|
| Configured maximum children | 8 | 8 |
| Children excluded for Court 7 conflict | 2 | 2 |
| Other configured children | 6, then aborted | 6 retained |
| Booking POSTs to provider | **0** | **0** |
| Core synthetic dispatcher invocations | 0 | 6 |
| Independently confirmed live holds | 0 | 0 |
| Official live QR handoffs | 0 | 0 |

All eight original incident children remained unsent: two were excluded and the other six were prevented by the whole-run abort. The original error and outcome records were not rewritten to make them look like the repaired behavior. Initial UI arming and child-specific durable submission permits are separate stages; the failed live runner never reached the latter.

## 5. Implemented repair

Repair commit: **[`68deab8caf1fe7446e23d5e8c0b540642735b66b`](https://github.com/marcpocong/thirsty-autobook-web/commit/68deab8caf1fe7446e23d5e8c0b540642735b66b)**.

- [phase3-freeze-selection.ts](../../../src/api-booking/phase3-freeze-selection.ts) uses the existing evidence classifier to identify retained and excluded assignments. Existing explicit public-conflict overrides retain their meaning.
- The runner compares actual children against the original authorization minus only those excluded assignments. Every survivor must match its original worker, logical target key, court, start/end, duration, amount and literal release offset, with exact multiplicity. Missing or extra survivors fail closed.
- Physical tab validation remains required for each surviving worker. Missing transports, unavailable workers, journal restrictions and altered plans are not relabelled as public conflicts.
- Each excluded child emits `PHASE3_WAVE1_UNSENT`, state `NOT_DISPATCHED`, code `PUBLIC_BOOKING_CONFLICT_AT_FREEZE`, with its worker/court, tab index and original offset. The monitor names the skipped court and reports configured, retained and skipped counts.
- If all targets conflict, the specific error is `PHASE3_PUBLIC_CONFLICT_ALL_TARGETS`. Unexpected missing/altered survivors produce `SHOTGUN_FROZEN_PLAN_INCOMPLETE`. Real tab problems still use their browser error.
- The new module is included in the live rehearsal module hashes. Old authorizations are not reused to qualify changed production code.

For the incident fixture, surviving chronological offsets are:

| Worker | Court | Original offsets retained |
|---|---:|---|
| A | 5 | −840, −360 ms |
| B | 6 | −720, −240 ms |
| D | 4 | −480, 0 ms |
| C | 7 | −600 and −120 ms are both unsent |

No missing attempt is moved to another court, worker, tab or offset. The saved eight-attempt configuration remains unchanged; the surviving frozen dispatch set receives its own existing fingerprint. The configured objective is not silently reduced or declared achieved merely because fewer targets survive.

### Protections preserved

Actual applicable access denials and throttles remain hard stops. Original UNKNOWN journals and duplicate barriers remain target-protecting. UNKNOWN evidence alone is not invented as a public booking conflict or promoted to OPEN. Genuine fresh security, trusted clock, exact-plan/build timing calibration, strict trigger deadlines, one-use permits, provisional response suppression, independent provider hold confirmation and exact QR validation remain required. No automatic fallback, late catch-up, payment, cancellation, retry of the missed release or re-arming was added.

## 6. Regression and validation evidence

[phase3-freeze-selection.test.ts](../../../tests/api-booking/phase3-freeze-selection.test.ts) contains seven new tests. They exercise the real classifier, freeze and dispatcher using a virtual clock, and separately use the real local armer/journals in isolated synthetic fixtures. The armer produces six local test permits and no journal for the excluded Court 7 target. These are offline fixture permits, not production booking authority.

Coverage includes the exact incident schedule, no conflict, several conflicts, all targets conflicting, UNKNOWN reads, explicit overrides, changed workers/targets/amounts/offsets, missing/extra children, access restrictions and monitor accounting for both excluded children. Existing deadline and safety assertions were not weakened.

| Final check for repair commit `68deab8` | Result |
|---|---|
| Typecheck | PASS |
| Complete local suite, 208 files | **2,437 passed; 0 failed; 0 skipped** |
| Exact-commit CI | **2,430 passed; 0 failed; 7 existing platform skips** |
| Focused regression run | 48 passed; overlaps full suite, not added to totals |
| Clean source distribution verification | 549 files verified |
| Fresh source-to-installed distribution comparison | 277 compiled files; 0 problems |
| Pure policy replay from actual installed modules | 8 configured → 6 retained, 2 skipped; no transport or permit created by that replay |

[Exact repair CI run 41550789606](https://github.com/marcpocong/thirsty-autobook-web/actions/runs/41550789606) completed successfully. CI has 2,437 total cases including skips. The final local and CI counts describe the same repair commit; focused results overlap them.

Initial new fixtures omitted required rate-evidence metadata and used a type-only import from the wrong module. Those fixtures were corrected without changing production validation. An installation comparison helper initially pointed compilation at the installed directory, which intentionally omits compiler configuration; the normal fresh-source comparison was then used and passed. These setup failures were not reported as provider failures or concealed as live successes.

## 7. Canonical installation and preservation

Installed runtime at the repair handoff:

| Provenance | Value |
|---|---|
| Runtime repair SHA | `68deab8caf1fe7446e23d5e8c0b540642735b66b` |
| Installed build | `68deab8-e91ec02c21` |
| Content ID | `e91ec02c21faf533e4aac8d1dfebfccc871c329d7cd22c890400a01d07665af0` |
| Installation completed | November 3, 08:27 Manila |
| Final preservation audit | November 3, 08:28:43 Manila |

A fresh one-use INSTALL-only maintenance authorization was bound to the repair SHA, original hashes and owner directive, consumed once and completed. The two existing historical aggregate blockers remained intact; all 63 historical UNKNOWN journals remained target-protecting. No global lease was archived and no old exception was reused. The previous rollback was copied and digest-verified before transactional replacement.

The post-startup audit found **all 1,400 original lifecycle files unchanged**, zero changed/missing and zero new lifecycle files. Current configuration, durable objective, private identity tree and browser-endpoint hashes matched their baseline. All eleven nondependency managed paths matched the installation manifest; dependencies were fully verified during replacement. No additional post-startup dependency rescan is claimed. The legacy packaged-test record was byte-identical; build readiness used genuine exact-commit CI and completed canonical installation evidence.

## 8. Historical handoff and remaining qualification

At **08:28:44 Manila**, the repaired app was open on Booking Setup → Review & Run, idle, terms off, no scheduled release, browsers closed and not prepared. The owner-saved **November 6** plan for the **November 4 08:00** release was preserved. It was not substituted by the investigator. Actual machine/build and locks/holds rows were VERIFIED; fresh browser preparation, security and build-compatible timing calibration were correctly still required before another arm.

The repair created **zero new live booking POSTs, zero recovery creation POSTs, zero production submission permits, zero payments, zero cancellations, zero arming actions and zero newly asserted provider terminal outcomes**. It did not retry the original target. It does not establish a provider-accepted 08:00 release, promise unattended execution or explain D's later timeout.

This publication is a **documentation-only follow-up** to the installed repair. Its later main-branch documentation commit does not replace or reinstall runtime `68deab8`; runtime and CI evidence above remain explicitly bound to that repair SHA. The handoff is historical evidence, not a claim about the app's state when this report is read.

## 9. Evidence package and review entry points

[evidence.json](evidence.json) publishes whitelisted event fields, observer cells/cache metadata, validation counts, installed replay, aggregate preservation results and SHA-256 integrity records for four original/archived log pairs. Each original log and archived copy was rechecked against its recorded digest during publication preparation. Hashes establish byte identity; they do not independently prove provider state.

Raw logs, full validation/installation output, screenshots, configuration archives and private preservation manifests remain local under `DiagnosticsLocal/release-freeze-conflict-nov3/`. Customer identities, cookies, security values, capabilities, profile endpoints, raw checkout data and private configuration are excluded from this public package. GitHub readers should use the committed sanitized summary rather than expect those private local paths to resolve online.

Related engineering records: [short repair note](../../RELEASE_FREEZE_CONFLICT_NOV3.md), [four-court qualification](../../FOUR_COURT_EIGHT_ATTEMPT_QUALIFICATION.md), [release day preflight](../../RELEASE_DAY_PREFLIGHT.md), [pending-hold confirmation boundaries](../../PENDING_HOLD_RECOVERY.md).
