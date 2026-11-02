# November 2, 2026, 08:00 release: detailed forensic review and complete repair record

| Item | Record |
|---|---|
| Incident | `47f4b850-2caa-4d63-923e-e20e6efefd80` |
| Nominal release | November 2, 2026, 08:00 Asia/Manila (`2026-11-02T00:00:00.000Z`) |
| Requested service date | November 4, 2026 |
| Wing and targets | Mango Courts 7, 6 and 5; each 19:00–22:00 |
| Runtime at incident | `00bf43d966408261c831bc87368f9bfcc48289da`, build `00bf43d-87a6ed3a81` |
| Original reported outcome | `OBJECTIVE_ACHIEVED_EXTRA_HOLD`, process exit 0 |
| Evidence-supported review outcome | `MANUAL_RECONCILIATION_REQUIRED` |
| Qualified repaired runtime | `48d2859f477192f15fdeb1a07e634e6deeade1b2`, build `48d2859-60bb1aad7c` |

This report is written for reviewers who did not observe the run or the subsequent repair work. It explains the intended operation, all eight authorized attempts, what the provider actually returned, how the application incorrectly reported success, what was changed, how those changes were qualified, and which questions remain unresolved.

The accompanying [evidence.json](evidence.json) is an allowlisted projection of 90 original evidence files, with a SHA-256 manifest. It contains no usable checkout access, raw customer identifiers, booking identifiers/numbers, session identifiers, browser profiles, proof values, or payment QR payloads. Private originals remain local. [VALIDATION.md](VALIDATION.md) explains reproduction, publication checks and their limits.

## Contents

1. [Findings and accounting](#1-findings-that-must-survive-every-summary)
2. [Scope and evidence hierarchy](#2-scope-evidence-hierarchy-and-terminology)
3. [Runtime provenance](#3-runtime-provenance-and-the-separate-after-midnight-qualification)
4. [Frozen authorization](#4-exact-frozen-authorization-and-objective)
5. [Chronology](#5-operational-chronology)
6. [Clock domains](#6-clock-domains-and-the-limits-of-millisecond-claims)
7. [Security preparation](#7-security-preparation-seven-ready-one-late-failure)
8. [Attempt-by-attempt results](#8-complete-eight-child-accounting)
9. [Dispatch timing](#9-dispatch-and-response-timing-without-mixing-anchors)
10. [HTTP 200 evidence](#10-what-the-five-http-200-responses-actually-establish)
11. [HTTP 400 evidence](#11-the-two-http-400-responses)
12. [Independent recovery observations](#12-independent-provider-lookups-before-advertised-expiry)
13. [Unsent child](#13-the-eighth-child-was-proven-unsent)
14. [Availability and public records](#14-availability-and-public-booking-observation)
15. [Network trace](#15-provider-and-network-trace-coverage)
16. [False-success cause](#16-established-local-root-cause-the-false-success-path)
17. [Fix inventory](#17-implemented-fixes-and-their-exact-boundaries)
18. [Historical reconstruction](#18-corrected-reconstruction-without-rewriting-history)
19. [Validation](#19-regression-ci-and-installed-validation)
20. [Installation and preservation](#20-canonical-installation-and-evidence-preservation)
21. [Remaining questions](#21-unresolved-issues-and-hypotheses)
22. [Independent review plan](#22-independent-review-plan)
23. [Final status](#23-final-status-and-action-boundaries)
24. [Appendices](#appendix-a-machine-readable-evidence-map)

## 1. Findings that must survive every summary

1. **Eight children were authorized, seven checkout POSTs were observed, and one child was proven unsent.** Three browsers represented three logical court targets. Parent journals, child journals, hourly booking rows and provider groups are different accounting units.
2. The seven responses were **five HTTP 200s and two HTTP 400s**. Each HTTP 200 described three hourly bookings and three hourly sessions for one PHP 2,100 target. Across those captures there are **15 distinct booking IDs**, not merely repeated views of a single response.
3. The correct hold statement is **five apparent pending-response groups; zero independently confirmed holds**. There were zero successful official QR handoffs in the scheduled incident. An HTTP 200, a pending transaction, a locally valid capture, or a durable journal marked `verified` does not establish that Onda retained an independently retrievable reservation.
4. Both HTTP 400 bodies explicitly said **“This booking date is not available yet.”** That is a recorded provider rejection. The generic local `ONDA_HTTP_STATUS_INVALID` code and `other` hint do not convey that useful body detail by themselves.
5. Four of the five initial automatic recovery outcomes reported `RECOVERY_WORKER_BUSY`; one reported `PROVIDER_404_BEFORE_ADVERTISED_EXPIRY`. The old runner wrapped these as a verified hold with a QR problem. The error class was therefore carrying a stronger success assertion than the evidence supported.
6. At 08:06–08:07 Manila, independent recovery reads using each record's bound identity returned **HTTP 404 for all five captured groups**, still approximately 179–201 seconds before their advertised deadlines. The records remained `UNKNOWN` with `QR=NOT_CHECKED`. A 404 is not evidence of payment, successful checkout, cancellation, or proven expiry.
7. The original runner reported five verified holds and objective achievement, then exited 0. The reconstructed result is **five UNKNOWN children, two rejected children and one unsent child**, with `MANUAL_RECONCILIATION_REQUIRED`. This is a correction to interpretation, not a rewrite of the original durable journals.
8. The unsent child was recorded as `SHOTGUN_TARGET_ALREADY_ACHIEVED`. Its Node transport, fetch and browser request fields are absent. A later `SECURITY_CONTEXT_BROWSER_FAILED` event for that same child must not be substituted for the already-recorded suppression reason or described as an eighth network rejection.
9. The source repairs in [`4d1834e`](https://github.com/marcpocong/thirsty-autobook-web/commit/4d1834e02be18b6bb95f8132ce157b89b0395666) separate unconfirmed provider results from confirmed holds with a QR failure, serialize same-profile automatic recovery, and correct downstream reporting. Native acceptance then found one remaining historical success claim; [`48d2859`](https://github.com/marcpocong/thirsty-autobook-web/commit/48d2859f477192f15fdeb1a07e634e6deeade1b2) corrects Activity and browser-management wording.
10. The final corrective runtime was installed and inspected in the canonical application. All **1,140 lifecycle files** in the pre-fix baseline, configuration and private state remained unchanged. No booking, payment, cancellation or arming action was performed during that continuation. **The cause of Onda's HTTP 200/404 contradiction remains unresolved.**

### 1.1 Accounting at a glance

| Measure | Evidence-supported result | Meaning |
|---|---:|---|
| Logical targets | 3 | Mango Courts 7, 6, 5 |
| Browser workers | 3 | A, B, C |
| Authorized child attempts | 8 | Frozen allocation 3/3/2 |
| Security-ready children | 7 | One child did not become ready successfully |
| Checkout POSTs | 7 | Seven exact per-child browser/request events |
| HTTP 200 responses | 5 | Three on Court 7, two on Court 6 |
| HTTP 400 responses | 2 | Both on Court 5 |
| Proven-unsent children | 1 | Browser B's third child |
| Apparent provider groups | 5 | One locally captured group per HTTP 200 |
| Captured hourly booking records | 15 | Three per group; 15 distinct IDs checked locally |
| Captured hourly session records | 15 | Three per group |
| Independent active provider confirmations | **0** | No matching confirmation established |
| Successful official QR handoffs | **0** | No payable official checkout was qualified |
| Later bound-profile lookup 404s | 5 | One read of each original group during investigation |
| Reviewer UNKNOWN children | 5 | The five apparent groups remain uncertain |
| Provider-rejected children | 2 | HTTP 400 and explicit unavailable-date error |
| Scheduled-incident payment evidence | None established | Pending response rows are not payment receipts |
| New booking/payment actions in fix continuation | 0 / 0 | Offline/source/installation work only |

The five PHP 2,100 response amounts sum to PHP 10,500 of **apparent pending response value**. That is not a proven charge, money paid, recoverable balance, or five independently active reservations. The authorizations and captures are not permission to pay or retry them.

## 2. Scope, evidence hierarchy and terminology

### 2.1 Which run this report covers

The primary subject is the scheduled November 2 release, run `47f4b850-2caa-4d63-923e-e20e6efefd80`, requesting November 4 courts. The report also covers the repairs and their qualification up to the final installed acceptance at approximately 09:29 Manila that day.

The earlier successful after-midnight November 2 Available Now qualification requested **November 3 morning intervals**. It is a separate experiment, on another runtime revision and different target intervals. Its success is relevant background for recovery capability; it is not success evidence for the 08:00 release. Section 3 gives the exact distinction.

The [November 1 incident](../2026-11-01-release/README.md) is also separate. Its seven HTTP 200 groups, time-format rejection and blocked availability observer must not be merged into this incident's five HTTP 200 groups, locally valid responses and functioning observer.

### 2.2 Evidence order

| Evidence | What it can establish | What it cannot establish alone |
|---|---|---|
| Frozen authorization and child bindings | Targets, offsets, budgets, exact attempt identities | That transport ran or provider accepted |
| Per-child critical path and request events | Local scheduler/transport activity and observed browser request events | Provider receipt time or database commit |
| Captured HTTP response and response hash | Exact locally received response material and structure | An independently active reservation |
| Durable journal | Local one-shot lifecycle, consumed intent, rejection/unknown/legacy verification state | Fresh provider status merely because state says `verified` |
| Independent provider lookup | What the official lookup returned for the original bound record at that time | Why an absent record is absent |
| QR summary and actual QR handoff | Qualified official checkout presentation when all checks pass | Payment or final booking without additional evidence |
| Slot Watch grid/public records | Observed availability and public-record read windows | Ownership, causal release/expiry, or bot reservation success |
| Derived summary/telemetry/UI | A useful interpretation of its input records | Stronger facts than the input contains |

The original report and original UI are evidence of what the application claimed. They are not independent corroboration of that claim. The corrected report, this write-up and the sanitized export are new derived artifacts and do not replace the originals.

### 2.3 State names are not interchangeable

- **Captured:** an HTTP response was saved.
- **Locally valid:** the response passed local checks of the expected target, shape, amount, grouping and advertised state.
- **Provider confirmed:** an independent official read matched the original booking/group and all required assertions.
- **QR ready:** the official checkout passed the required summary/visible-QR checks.
- **Paid/final:** payment/final-booking evidence; not established by this incident.
- **UNKNOWN:** an attempted creation may have had effects, but the required authoritative evidence is missing or contradictory.
- **Rejected:** a conclusive provider refusal for that sent attempt.
- **Not dispatched:** affirmative local evidence shows the attempt never invoked its booking transport.

The legacy journal state `verified` in this run belongs to the local submission lifecycle. It must not be silently renamed in the original file, nor read as equivalent to independent provider confirmation. Both facts can coexist: **the original journal says `verified`; the reviewer must classify the provider outcome UNKNOWN.**

## 3. Runtime provenance and the separate after-midnight qualification

### 3.1 Relevant revisions

| Revision/build | Role | Evidence and limits |
|---|---|---|
| `84137c6c97a75a10586095625da93cba7f672846` | After-midnight facility-recovery repair | Three new November 3 groups qualified on A/B/C; not the 08:00 incident |
| `00bf43d966408261c831bc87368f9bfcc48289da` / `00bf43d-87a6ed3a81` | Canonical installed runtime before the 08:00 release | Installation verification timestamp 07:09:18.572 Manila; UI redesign and saved-date correction installed |
| `4d1834e02be18b6bb95f8132ce157b89b0395666` / `4d1834e-821378422a` | Main false-success and post-response recovery fix | Pushed 08:29:51 Manila; installed qualification recorded 09:06:07.628 |
| `48d2859f477192f15fdeb1a07e634e6deeade1b2` / `48d2859-60bb1aad7c` | Final historical-label correction | Pushed 09:11:44 Manila; corrective installed verification recorded 09:25:54.703 |
| This report's publication commit | Documentation and export tooling | Does not itself install another runtime or requalify a live release |

The incident runtime was a qualified canonical installation, not an assumption that source checkout and installed files matched. Its exact installation verification is hashed in the export. The subsequent fixes did not exist in that runtime at 08:00.

### 3.2 What the after-midnight tests proved

The separate local qualification report records four creation POSTs for November 3 Mango morning intervals, one of which exposed an optional-facility-field recovery mismatch. The repair validates the provider facility against the registered original court rather than requiring equality with an absent optional captured hourly field.

After that repair and installation, three **different** groups were independently confirmed and their correct unpaid official QR pages inspected: A/Court 1 09:00–10:00, B/Court 2 08:00–10:00, and C/Court 3 10:00–11:00. Each passed original-tab, fresh-tab and actual application-restart recovery, for nine successful recoveries and zero additional creation POSTs. Those tests did not pay or cancel the groups.

The same report records a separate terminal limitation: the Browser B two-hour group's later aggregate verification remained `UNKNOWN / PROVIDER_PARTIAL_HOURLY_GROUP`, although separate reads of both original individual booking IDs reported expired. That individual-expiry observation was not substituted for a complete aggregate reconciliation.

These earlier results demonstrate that the recovery system could work on genuinely retrievable records under bounded Available Now conditions. They do **not** prove that the later scheduled responses persisted, that all fan-out recoveries can run concurrently in one profile, that provider behavior at publication matches Available Now behavior, or that contested fixed-08:00 timing was qualified. The present report preserves both outcomes rather than using one to erase the other.

## 4. Exact frozen authorization and objective

The authorization was recorded at **07:33:36.469 Manila** and frozen at **07:58:00.829**. The freeze file's SHA-256 is `1c5296d6ea02bffd7d46ae4d3ea972d7597e16159cda053b736e9fc9947e8fd2`.

| Worker | Priority | Court | Interval | Expected hourly prices | Target amount | Authorized offsets from nominal release |
|---|---:|---:|---|---|---:|---|
| A | 1 | 7 | 19:00–22:00 | 700 / 700 / 700 | PHP 2,100 | −2,000; −1,143; −286 ms |
| B | 2 | 6 | 19:00–22:00 | 700 / 700 / 700 | PHP 2,100 | −1,714; −857; 0 ms |
| C | 3 | 5 | 19:00–22:00 | 700 / 700 / 700 | PHP 2,100 | −1,429; −571 ms |

The objective event specifies `scope=PER_WING`, `mango=1`, `buko=0`. Do not substitute an older two-court plan as the morning quota. The frozen candidates all allow Wave 1 and explicitly disallow Wave 2 and Rescue. Wave 2 budget was 0; Rescue budget was 0; total child budget was 8. There were no standby assignments, concurrent Wave 2 was false, and Rescue was disabled.

Shotgun was enabled with budget 8, EQUAL allocation, AUTO timing, and window −2,000 through 0 ms. `timingCapacityOverride=false` and `allowStandbyConsumption=false`. The exact schedule, rather than list ordering in a dashboard, determines the per-child configured offsets above.

The price evidence was explicitly labelled `VENUE_SCHEDULE`, captured September 30, with PHP 700 for each evening hour. That provenance is not a claim that each pre-release availability read independently returned a fresh open-price quote. The freeze carried the known warning that all three logical attempts shared 19:00–22:00 and therefore a time-wide unavailable block could affect every target.

Each fan-out child is a separately authorized one-shot attempt. Several responses can describe the same court-hours while carrying distinct provider IDs. That is different from retrying one consumed child. The existence of multiple pending-looking responses also does not make later duplicate submission permissible.

## 5. Operational chronology

All display times in this table are Manila on November 2. Original ISO values, physical line numbers, `eventAt`, `timingKind`, and measured durations are retained in `evidence.json.events`. This is an operational chronology, not a claim that every `at` value is a network timestamp.

| Recorded time | Event | Evidence-supported interpretation |
|---|---|---|
| 07:09:18.572 | Pre-incident installation verification | Canonical `00bf43d` installed and verified |
| 07:33:33.810 | `RUN_STARTED` | Scheduled live runner began waiting/preparation |
| 07:33:33.881–.910 | A/B/C browser preparation began | Three workers, not eight separate profiles |
| 07:33:36.377–.466 | C/A/B `BROWSER_READY` | Initial dedicated browser preparation completed |
| 07:33:36.469 | Authorization timestamp | Exact upcoming November 4 candidate set authorized |
| 07:50:00.202 | T−10M clock refresh stage | Ten samples; +98.0 ms offset |
| 07:58:00.359–.824 | Freeze audit reads | Evidence read before freeze; not a checkout |
| 07:58:00.829 | Quota and freeze | Eight children, quota Mango 1 |
| 07:58:00.832 | Eight fan-out child bindings | Stable diagnostic identities assigned |
| 07:58:00.994 | `PREWARM_PLAN` | Planned lead 32,190 ms; 56 historical samples; duration estimate 4,584 ms |
| 07:59:00.180 | T−60S consensus stage | +102.5 ms offset, ±20.6 ms uncertainty |
| 07:59:00.007–.654, approximately | First Slot Watch request/response interval | Date-labelled matrix visible; all 112 cells unavailable; not proof of actual release opening |
| 07:59:25.7–25.8 | First security preparations began | A1/B1/C1 preparation overlapped by worker |
| 07:59:28–34 | Seven children became security-ready | Three worker-specific waves; all seven sent children ready before their trigger |
| 07:59:30.176 | T−30S consensus stage | +102.8 ms offset, ±20.5 ms uncertainty |
| 07:59:58.315 through 08:00:00.175, nominal trusted-clock centers | Seven browser request events | Six before nominal 08:00, one after; exact table in section 9 |
| 08:00:00 +0.01 ms scheduler center | B3 trigger examined | No transport invocation; suppressed as target already achieved |
| About 08:00:01 | Deferred/collected response and request stages appeared | These stage timestamps must not replace the recorded request offsets |
| 08:00:01.587–.608 | Four QR-attention events | Four local `RECOVERY_WORKER_BUSY` outcomes |
| 08:00:04.019 provider-result record | A2 automatic lookup returned 404 | No independent active hold was established |
| 08:00:04.118–.180 | A2 failure/state recorded | Still incorrectly classified as verified hold with QR attention |
| 08:00:04.186–.298 | Wave 1 complete and final outcome | 8 accounted, 7 sent, 1 unsent; original claimed 5 verified and objective achieved |
| 08:00:04.209/.312 | B3 late preparation completion/failure records | A 33,023 ms measured preparation ended with browser failure; B3 had already been suppressed |
| 08:00:04.319 | `PROCESS_EXIT` | Exit code 0; not evidence of provider success |
| 08:01:55.006–.670 | First fully open Court 7 candidate observation | Sampled availability, not bot ownership |
| 08:06:40.150–08:07:01.478 | Five follow-up official lookup results | All 404, before advertised deadlines |
| 08:09:59.935–08:10:00.724 | Advertised deadlines in original captures | Clock passage alone did not reconcile the groups |
| 08:15:00.741 | Observer ended | 226 availability reads and 78 public-booking read rounds answered |
| 08:29:51 | Core classification fix pushed | `4d1834e`; no historical journal rewrite |
| 08:49:26.199 | Corrected offline forensic reconstruction generated | Same original input files; separate derived output |
| 09:06:07.628 | First repaired installation verification | Installed `4d1834e`; preservation passed |
| 09:09–09:11 | Native Activity finding and correction | Old history card still claimed verified hold Yes · 5; corrected in `48d2859` |
| 09:25:54.703 | Corrective installed verification | Final build `48d2859-60bb1aad7c` |
| 09:28:30.904 | Native acceptance record | All five destinations, zero fresh confirmed checkout counts, no release armed |
| 09:29:06.754 | Final integrity/preservation record | Backend matches qualified `4d1834e`; 1,140 lifecycle files unchanged |

The first Slot Watch interval above is derived from observer offsets −59,993 through −59,346 ms. The dispatch clock differs from the observer clock by 4.8 ms. Its exact ordering must not be used to imply provider-side publication precision.

## 6. Clock domains and the limits of millisecond claims

### 6.1 Network-clock measurements

| Checkpoint | Samples | Offset | RTT | Spread | Reported uncertainty |
|---|---:|---:|---:|---:|---:|
| T−10M | 10 | +98.0 ms | 40 ms | 10.9 ms | ±21.9 ms |
| T−60S | 10 | +102.5 ms | 41 ms | 7.8 ms | ±20.6 ms |
| T−30S | 10 | +102.8 ms | 41 ms | 1.1 ms | ±20.5 ms |

The original summary gives observer offset +98.0 ms and dispatch offset +102.8 ms, hence observer minus dispatch **−4.8 ms**. The critical-path header separately records `wallToTrustedMs=103.28`. These are recorded measurements from their respective anchors; do not overwrite one with another because they look similar.

### 6.2 Five distinct timing concepts

1. **Configured offset:** the signed trigger authorized before dispatch.
2. **Node scheduler/transport time:** local execution relative to the trusted nominal release.
3. **Renderer/fetch mapping:** browser values mapped through a bounded round-trip calibration, carrying `ms`, `lowMs`, `highMs`.
4. **Observed browser request event:** the correlated browser/Playwright event and its trusted-clock mapping.
5. **Provider receipt/commit time:** unavailable in this evidence set.

Renderer calibration used eight samples per child, with approximately 0.55–0.67 ms reported mapping uncertainty for the sent attempts. That small local mapping uncertainty does **not** eliminate the network-clock uncertainty, identify the exact provider-side release instant, or prove when a server committed a booking.

### 6.3 Deferred stages and misleading wall timestamps

All seven `CHECKOUT_HTTP_POST_INITIATED` stage rows have a recorded `at` near **08:00:00.909**, even though their retained `releaseLatenessMs` values span −1,684.7 through +175.2 ms. They were collected/emitted around the critical-window handoff. Treating those seven `at` values as seven simultaneous POST send times would erase the actual timing evidence.

For timing analysis use the explicit per-child critical-path/request fields. Retain both fields in an export rather than "correcting" the original timestamp. Physical append order also is not a universal event ordering: diagnostics have `eventAt`/`timingKind` and measured duration semantics, while other stage dates use the controller's adjusted clock.

Browser ResourceTiming and the browser request-event series also have different origins and can disagree substantially in this capture. For example, A1's mapped ResourceTiming request point is −157.26 ms while its browser request-start field is −1,685.03 ms. These are not values to splice into a single artificial latency equation. Section 9 deliberately keeps each series separate.

### 6.4 The strict deadline applies to the guarded initiation boundary

The child journals retain `SHOTGUN_STRICT` and `shotDeadlineMs = triggerMs + 50 ms`. The configured trigger is not a promise that a later CDP/request event will occur within that 50 ms. The local scheduler/fetch boundary and the browser's externally observed request event are distinct. A request-event lag of 300–460 ms does not, by itself, prove the pre-transport strict gate was bypassed.

Conversely, a precise scheduler does not prove good contested-release timing. This incident records low Node scheduling error and much larger browser/request-event delay. Neither permits a provider-receive-time claim.

## 7. Security preparation: seven ready, one late failure

Initial A/B/C browser readiness at 07:33 was not the same as each child having a fresh, plan-bound security context ready at its trigger. The runner prepared individual child contexts before release.

| Child alias | Diagnostic identity | Measured preparation duration | Prewarm-ready offset in critical path | Result |
|---|---|---:|---:|---|
| A1 | `core-A-official-1` | 2,741 ms | −31,430 ms | Ready; later sent |
| B1 | `core-B-official-4` | 2,576 ms | −31,590 ms | Ready; later sent |
| C1 | `core-C-official-7` | 2,184 ms | −31,984 ms | Ready; later sent |
| A2 | `core-A-official-2` | 2,663 ms | −28,735 ms | Ready; later sent |
| B2 | `core-B-official-5` | 2,628 ms | −28,764 ms | Ready; later sent |
| C2 | `core-C-official-8` | 2,521 ms | −28,874 ms | Ready; later sent |
| A3 | `core-A-official-3` | 2,790 ms | −25,917 ms | Ready; later sent |
| B3 | `core-B-official-6` | 33,023 ms | Not recorded ready | Late `SECURITY_CONTEXT_BROWSER_FAILED`; no send |

The ready offsets above are the critical-path metadata values, not a fresh recalculation from stage dates. The eighth preparation's failure is a real local finding. It does not explain the five later provider 404s for other children whose security preparation completed successfully and whose POSTs produced HTTP 200.

The final run event reports `preparedCount=7`. The diagnostic stage name `SECURITY_PREPARATION_COMPLETED` exists eight times because completion includes the slow operation ending in failure. Counting that stage name as eight successfully prepared children would be another accounting error.

## 8. Complete eight-child accounting

Aliases A1/A2/A3, B1/B2/B3 and C1/C2 in this document are readable labels. Their immutable diagnostic identities remain in the next column. They are not provider booking IDs.

| Alias | Exact diagnostic identity | Court | Configured offset | POST? | HTTP | Original settled result/code | Raw child journal | Reviewer outcome |
|---|---|---:|---:|---|---:|---|---|---|
| A1 | `core-A-official-1` | 7 | −2,000 ms | Yes | 200 | `HOLD_VERIFIED_QR_ATTENTION / RECOVERY_WORKER_BUSY` | `verified` | **UNKNOWN** |
| B1 | `core-B-official-4` | 6 | −1,714 ms | Yes | 200 | `HOLD_VERIFIED_QR_ATTENTION / RECOVERY_WORKER_BUSY` | `verified` | **UNKNOWN** |
| C1 | `core-C-official-7` | 5 | −1,429 ms | Yes | 400 | `REJECTED / ONDA_HTTP_STATUS_INVALID` | `rejected` | **REJECTED** |
| A2 | `core-A-official-2` | 7 | −1,143 ms | Yes | 200 | `HOLD_VERIFIED_QR_ATTENTION / PROVIDER_404_BEFORE_ADVERTISED_EXPIRY` | `verified` | **UNKNOWN** |
| B2 | `core-B-official-5` | 6 | −857 ms | Yes | 200 | `HOLD_VERIFIED_QR_ATTENTION / RECOVERY_WORKER_BUSY` | `verified` | **UNKNOWN** |
| C2 | `core-C-official-8` | 5 | −571 ms | Yes | 400 | `REJECTED / ONDA_HTTP_STATUS_INVALID` | `rejected` | **REJECTED** |
| A3 | `core-A-official-3` | 7 | −286 ms | Yes | 200 | `HOLD_VERIFIED_QR_ATTENTION / RECOVERY_WORKER_BUSY` | `verified` | **UNKNOWN** |
| B3 | `core-B-official-6` | 6 | 0 ms | **No** | — | `NOT_DISPATCHED / SHOTGUN_TARGET_ALREADY_ACHIEVED` | `rejected` | **NOT_DISPATCHED** |

The parent journals remain `verified` for Courts 7 and 6 and `rejected / FAN_OUT_ALL_CHILDREN_CONCLUSIVE` for Court 5. Those are three aggregate lifecycle records; they do not add three POSTs, three reservations, or three independent confirmations.

The unsent B3 journal is locally `rejected` because its guarded lifecycle was conclusively refused before transport. That does not mean Onda rejected a request it never received. The independent-review outcome deliberately uses **NOT_DISPATCHED** for that child.

The original final event itself already gives the useful transport accounting: authorized 8, prepared 7, sent 7, settled 8, pending 0, unsent 1. Its *success* accounting was wrong: verified 5 and unknown 0. The report separates the accurate counts from the invalid success interpretation rather than discarding the entire trace.

## 9. Dispatch and response timing without mixing anchors

### 9.1 Per-child trusted-clock timing

Every value in this table is milliseconds relative to nominal 08:00. A negative value precedes the nominal anchor. Renderer/fetch and response-body values are bounded mapped centers; full bounds are in the JSON.

| Alias | Configured | Scheduler fired | Fetch center | Browser request start | Request-event stage offset | Response body center | Node response observed |
|---|---:|---:|---:|---:|---:|---:|---:|
| A1 | −2000 | −1999.91 | −1996.76 | −1685.03 | −1684.7 | −34.86 | +1000.22 |
| B1 | −1714 | −1713.97 | −1710.58 | −1470.90 | −1471.1 | +431.32 | +1011.38 |
| C1 | −1429 | −1428.96 | −1426.20 | −1253.80 | −1253.8 | +1135.30 | +1153.95 |
| A2 | −1143 | −1142.98 | −1140.26 | −855.52 | −853.9 | +759.54 | +1010.14 |
| B2 | −857 | −856.97 | −853.79 | −625.63 | −625.4 | +743.21 | +1008.92 |
| C2 | −571 | −570.98 | −568.13 | −308.57 | −308.5 | +1220.77 | +1224.87 |
| A3 | −286 | −285.98 | −283.56 | +175.21 | +175.2 | +384.44 | +1010.95 |
| B3 | 0 | +0.01 | — | — | — | — | — |

The POST-event range is **−1,684.7 to +175.2 ms**, a spread of **1,859.9 ms**. Six request events occurred before the nominal release anchor and one after. The configured schedule explicitly authorized negative offsets; this table is not an allegation that an unapproved retry or hidden extra request occurred.

The last configured negative shot, A3 at −286 ms, was observed as a browser request at +175.21 ms: approximately **461.21 ms after its configured point**. That is local/browser observed timing, not the provider's receipt timestamp.

### 9.2 Local segment measurements and recorded duration

| Alias | Node scheduler error | Fetch→browser-request segment | Node response observed minus mapped body center | Recorded `networkDurationMs` |
|---|---:|---:|---:|---:|
| A1 | +0.09 ms | 311.73 ms | 1035.08 ms | 1967 ms |
| B1 | +0.03 ms | 239.68 ms | 580.06 ms | 2147 ms |
| C1 | +0.04 ms | 172.40 ms | 18.65 ms | 2580 ms |
| A2 | +0.02 ms | 284.74 ms | 250.60 ms | 1903 ms |
| B2 | +0.03 ms | 228.16 ms | 265.71 ms | 1602 ms |
| C2 | +0.02 ms | 259.56 ms | 4.10 ms | 1795 ms |
| A3 | +0.02 ms | 458.77 ms | 626.51 ms | 672 ms |

The third numeric column is a comparison of recorded mapped/Node centers, useful for identifying deferred observation; it is not a measurement of a provider phase. `networkDurationMs` is retained as recorded by the runner. It must not be substituted for browser ResourceTiming wait or added to a request event to manufacture a server receipt/commit time.

The data show that fast local scheduler wake-up did not imply uniformly prompt browser request events or immediately processed response callbacks. They do not prove which delay is dominant at Onda's release gate. No offset/deadline change was made as part of the false-success fixes.

## 10. What the five HTTP 200 responses actually establish

### 10.1 Structure and arithmetic

All five captures describe:

- Service date November 4, 2026.
- The assigned Court 7 or Court 6 target.
- Three 60-minute hourly bookings: 19:00–20:00, 20:00–21:00 and 21:00–22:00.
- PHP 700 per hour, PHP 2,100 total.
- Three hourly sessions, one booking linked in each projected session.
- `success=true`, pending booking/payment statuses, a pending transaction with amount 2,100 and `trustedTotalAmount=2100`.
- An advertised hold deadline near 08:10 Manila.

The locally checked private identifiers are distinct across all 15 hourly booking rows. The publication retains counts and hashes rather than those identifiers or access material. A reviewer with lawful access to the originals can reproduce the exporter and verify that assertion without publishing the identifiers.

### 10.2 Capture and advertised-deadline ledger

| Alias | Worker/court | Capture timestamp, Manila | Advertised deadline, Manila | Amount | Booking/session rows |
|---|---|---|---|---:|---|
| A1 | A / 7 | 08:00:01.000 | 08:09:59.935 | PHP 2,100 | 3 / 3 |
| A2 | A / 7 | 08:00:01.009 | 08:10:00.724 | PHP 2,100 | 3 / 3 |
| A3 | A / 7 | 08:00:01.010 | 08:10:00.356 | PHP 2,100 | 3 / 3 |
| B1 | B / 6 | 08:00:01.010 | 08:10:00.403 | PHP 2,100 | 3 / 3 |
| B2 | B / 6 | 08:00:01.008 | 08:10:00.714 | PHP 2,100 | 3 / 3 |

These are capture/write timestamps, not provider creation timestamps. Their concentration around +1 second is consistent with deferred post-response work; it does not erase earlier mapped response/request measurements.

### 10.3 Why "pending" is insufficient

A provider may return internally plausible pending objects without the later public lookup establishing a corresponding active group. This incident demonstrates exactly that observation gap. The captured payloads remain valuable evidence that requests were sent and responses received. They cannot establish the persistence guarantees of Onda's backend.

Neither the advertised deadline nor a constructed official-checkout URL proves that the checkout is accessible. A pending transaction in a response is also not a payment receipt. No successful live `PROVIDER_HOLD_CONFIRMED` stage exists for this run, and no successful official QR handoff was recorded.

### 10.4 Identity claims that are justified

The five private captures carry identity-binding material. Each worker has one consistent captured binding across its own response groups, and the captured A and B bindings are distinct. The follow-up recovery operation performed the production binding checks before its lookup.

That supports a bound-record investigation. It does not provide a comprehensive provider-side identity audit, prove that an absent record belongs to another account, or transfer the earlier after-midnight A/B/C isolation PASS to every aspect of this scheduled incident. Browser C produced no successful captured group in this run.

## 11. The two HTTP 400 responses

The fallback evidence for both C1 and C2 contains a 67-byte JSON body projection:

```json
{
  "success": false,
  "error": "This booking date is not available yet."
}
```

Both responses had JSON content type, Vercel server metadata and cache MISS in the passive trace. Both local results were `REJECTED / ONDA_HTTP_STATUS_INVALID`. There is no observed 429 throttle response and no recorded provider-throttle signal for these children.

The body establishes a provider refusal for the requested date. It does not identify whether the responsible gate was a schedule/publication check, an internal availability rule or another provider implementation branch. Its response arrived after the nominal 08:00 anchor while its request event occurred before that anchor; those facts do not supply the provider's request-processing start time.

The same two-error message is important when evaluating the five HTTP 200 responses. It shows nonuniform outcomes in the same short release window. It does not prove why A/B got pending-looking objects or why those objects later failed lookup. Hypotheses about early acceptance, eventual consistency or provider branch differences remain hypotheses.

## 12. Independent provider lookups before advertised expiry

### 12.1 Automatic recovery during the original run

The original automatic post-response path had four `RECOVERY_WORKER_BUSY` outcomes: A1, A3, B1 and B2. Those are local claim/refusal outcomes, not provider responses. In particular, a busy recovery must not be described as HTTP 404 unless an actual later lookup produced one.

A2 acquired a recovery path and its saved verification history records:

| Time, Manila | Recorded verification step | Meaning |
|---|---|---|
| 08:00:01.587 | `LOCAL_RESPONSE_VALID` | Original capture passed local revalidation |
| 08:00:03.848 | `PROVIDER_LOOKUP_REQUESTED` | Independent official lookup started |
| 08:00:04.019 | `PROVIDER_LOOKUP_RESULT` | Lookup response milestone |
| 08:00:04.118 | `PROVIDER_404_BEFORE_ADVERTISED_EXPIRY` | Provider UNKNOWN, QR not checked, contradiction retained |

The original runner nevertheless settled A2 as `HOLD_VERIFIED_QR_ATTENTION`. That contradiction is direct evidence of the local classification defect; it is not an inference from a late advertised expiry alone.

### 12.2 Follow-up reads of all five original groups

The subsequent investigation used the installed recovery service/controller and each record's bound browser identity. It did not create a new reservation or exchange capabilities between profiles. Every result was correlated with the same original capture hash.

| Alias | Official lookup result time, Manila | HTTP | Advertised expiry | Approx. seconds remaining at lookup result | Final recovery state |
|---|---|---:|---|---:|---|
| A1 | 08:06:50.757 | 404 | 08:09:59.935 | 189.18 | `UNKNOWN / PROVIDER_404_BEFORE_ADVERTISED_EXPIRY` |
| A2 | 08:06:40.150 | 404 | 08:10:00.724 | 200.57 | Same |
| A3 | 08:06:45.622 | 404 | 08:10:00.356 | 194.73 | Same |
| B1 | 08:06:56.160 | 404 | 08:10:00.403 | 184.24 | Same |
| B2 | 08:07:01.478 | 404 | 08:10:00.714 | 179.24 | Same |

These lookup milestones identify their clock as `NODE_WALL` and their measured durations as `NODE_MONOTONIC`. The remaining-time column subtracts the recorded timestamps; it is not a new clock calibration. Its approximately three-minute margins are much larger than the tens-of-milliseconds clock uncertainties recorded for the release.

All five results had `qr=NOT_CHECKED` and `contradiction=true`. There were no successful QR handoffs in this investigation. The preservation result records **669 original journal/capture files unchanged** in that investigation's own scope. That count is not the same manifest as the later all-lifecycle 1,140-file installation baseline.

### 12.3 What a 404 does and does not settle

**Established:** the official read available to the bound recovery operation did not establish the original pending booking/group at that time, despite a captured response advertising remaining hold time.

**Not established:** that the reservation never existed anywhere; that it expired normally; that a cancellation happened; that it was paid; that another identity could recover it; that all provider replicas had the same state; or that repeating checkout is safe.

The target remains protected. A later absence of the object or passage of the advertised deadline is not permission to relabel a sent, unconfirmed original attempt as rejected or unsent.

## 13. The eighth child was proven unsent

B3, `core-B-official-6`, was assigned Court 6 at configured 0 ms. Its critical path records scheduler entry at +0.01 ms, then null for worker invocation, transport entry, pre-post, renderer/fetch, browser request start and response observations. There is no checkout POST event or response event for it.

The terminal code is **`SHOTGUN_TARGET_ALREADY_ACHIEVED`**. Its original durable child state is locally `rejected`, reflecting a conclusive pre-transport refusal. The reviewer classification is **NOT_DISPATCHED**. Do not count B3 as an eighth HTTP 400, a failed provider checkout, or an UNKNOWN sent reservation.

The source's safety callback is relevant: it can recognize a locally valid success-shaped response and suppress future attempts before the independent post-response recovery finishes. The current implementation retains this conservative suppression rule. Its code string contains "achieved," but that string does not independently establish provider confirmation. The later correction to outcome accounting is not a promise that B3 would be sent under the repaired runtime, and this investigation did not replay it.

The separate B3 preparation lasted 33,023 ms and eventually reported `SECURITY_CONTEXT_BROWSER_FAILED`. That event can affect the operator's attention message, but the primary terminal accounting remains the recorded unsent suppression. The evidence does not justify a counterfactual claim that the child would otherwise have produced a valid hold.

## 14. Availability and public-booking observation

### 14.1 Coverage

| Measure | Recorded value |
|---|---:|
| Availability reads launched / answered | 226 / 226 |
| Availability failures / aborted / not launched | 0 / 0 / 0 |
| Actual maximum availability in flight | 3 |
| Configured maximum in flight | 6 |
| Median / p95 availability latency | 632 / 1,228 ms |
| Minimum / maximum availability latency | 474 / 1,627 ms |
| Availability cache classifications | 226 MISS; 0 HIT; 0 STALE; 0 UNKNOWN |
| Public booking read rounds launched / answered | 78 / 78 |
| Failed public-booking rounds / court queries | 0 / 0 |
| Successful court queries | 546 / 546 |
| First matrix OPEN / UNAVAILABLE / UNKNOWN | 0 / 112 / 0 |
| UNAVAILABLE→OPEN cell transitions | 90 |
| Distinct cells ever opened after initial unavailable observation | 90 |
| Subsequent repeat opening transitions | 0 |
| OPEN→UNAVAILABLE cell transitions | 8 |
| Cells still open at final matrix | 82 |

This observer worked, unlike the separate November 1 observer defect. Its raw NDJSON, summary and quality output are separately hashed in the export.

### 14.2 The initial "published" label is not proof of actual release publication

The derived observer calls its first date-labelled observation "first published." That first request was at −59.993 seconds and response at −59.346 seconds; every one of 112 court-hour cells was unavailable.

The defensible statement is that a date-labelled matrix was returned before nominal release and all displayed cells were unavailable. The record does not establish that all 112 had been reserved, that the provider had already opened booking, or that 08:00 was the exact backend publication instant. An unreleased-date representation and an unavailable/occupied representation can require provider-specific interpretation.

### 14.3 Target observations

| Target | First observed matrix | First fully open candidate read | First matching public-record observation | Final watched state |
|---|---|---|---|---|
| Court 7, 19:00–22:00 | All three unavailable | Read 79: request +115.006 s → response +115.670 s; preceding read 78 +110.012 → +110.750 s | Court 7 19:00: booking round 42, +225.017 → +225.284 s | Partially unavailable |
| Court 6, 19:00–22:00 | All three unavailable | None observed | None observed for these target hours in the original target summary | Fully unavailable |
| Court 5, 19:00–22:00 | All three unavailable | None observed | None observed for these target hours in the original target summary | Fully unavailable |

All 90 recorded UNAVAILABLE→OPEN transitions were distinct first openings in this watch, not 90 proven expiries or 90 releases of bot-owned holds. The quality report's word "confirmed" describes the observation/window consistency of the grid transition. It does not confirm the owner or cause.

The first all-open Court 7 interval is approximately 115 seconds after the nominal release. It precedes the captures' ten-minute advertised deadlines by many minutes. No evidence joins that availability change to the bot's specific private booking IDs. It must not be called the expiry of one of these groups.

### 14.4 Public records and expiry predictions

The original reconstruction counts 104 initially unavailable cells without a matching public booking record during the watch. Absence of a public record does not explain unavailability. A later public record for Court 7 19:00 establishes that a public record was observed for that cell, not that it belonged to this bot or matched one of the private captures.

The quality output has eight expiry predictions: six cells on Courts 1/2 for 18:00–21:00 with predicted windows +738 to +748 seconds, plus Court 7 18:00 and 19:00 at +818 to +828 seconds. None was observed reopening in its prediction window; all eight remained in `notReopened`. These predictions are observations about public/grid evidence, not authoritative hold expiries for A1/A2/A3/B1/B2.

The observer's final candidates carry evidence-age upper bounds of 726 ms and `ORIGIN_FRESH`. Cache MISS and these age bounds describe client-observed freshness classification. They do not prove the absence of provider-side caching, gating, replication or validation differences.

## 15. Provider and network trace coverage

There are two complete passive provider traces, both for Browser C's HTTP 400 children. There are also seven response-fallback records, one per observed response. A missing passive trace for an HTTP 200 is missing instrumentation coverage, not evidence that no network request occurred.

| Trace field | C1 / `core-C-official-7` | C2 / `core-C-official-8` |
|---|---:|---:|
| Node trace enabled offset | +1063.6 ms | +1063.8 ms |
| Node headers observed | +1147.6 ms | +1221.8 ms |
| Node finished observed | +1150.0 ms | +1223.2 ms |
| Browser send interval | 0.4 ms | 0.2 ms |
| Browser wait interval | 916.7 ms | 857.2 ms |
| Protocol / connection | h2 / reused | h2 / reused |
| HTTP / server / cache | 400 / Vercel / MISS | 400 / Vercel / MISS |
| DNS / connect / TLS intervals | Not separately recorded | Not separately recorded |

The passive tracer is enabled after a checkout has left to avoid adding critical-path work at dispatch. Therefore early/fast responses can be untraced. The two successful *trace captures* are not successful bookings.

Provider IDs, Vercel region strings, embedded milliseconds and HTTP Date headers may help a provider operator correlate server logs. They do not define a documented provider queue or commit timestamp. The publication omits raw correlation IDs from its projected response metadata; authorized reviewers can use the original private/local trace under the appropriate access boundary.

HTTP Date is second-resolution server metadata, not a millisecond acceptance timestamp. Do not infer execution ordering from identifier text or add browser wait intervals to a Node request-event timestamp from a different clock origin.

## 16. Established local root cause: the false-success path

### 16.1 Incorrect implication in the original runtime

The old flow could do the following:

```text
HTTP 200 captured
  → local response validated
  → durable submission marked locally verified
  → PENDING_HOLD and an early verified-hold diagnostic
  → automatic recovery fails (busy claim or provider 404)
  → generic failure wrapped in VerifiedHoldQrError
  → classifier returns HOLD_VERIFIED_QR_ATTENTION
  → five results count as verified / objective achieved
  → UI, telemetry and grid repeat the unsupported success
```

`VerifiedHoldQrError` semantically means **a provider-confirmed hold exists, but presenting its QR needs attention**. The original runner used that class for recovery failures that did not establish any such hold. That is the core implementation defect.

The classifier also treated a locally `verified` durable journal as sufficient support for the same verified-hold/QR-attention outcome. That second path could upgrade a generic post-response failure even without a fresh provider read. Together these assumptions made local response validation look like independent provider acceptance.

### 16.2 Recovery contention was a separate local operational problem

Recovery claims are conservative and per worker/profile. A contender publishes its complete identity before examining other live/unknown owners. Simultaneous contenders can both refuse; they must not both proceed. Browser B's two simultaneous contenders can therefore both report busy without any successful Browser B provider lookup. The evidence establishes four busy outcomes; it does not establish the precise winner/loser scheduling of every claim-file scan.

The fix serializes automatic recovery work by worker/profile, while retaining the claim mechanism. It does not remove identity checks, ignore stale claims indiscriminately, share capabilities across profiles or alter checkout dispatch times.

### 16.3 Controller and presentation amplified the mistake

The controller previously promoted `PENDING_HOLD` to a hold-verified state and could promote `QR_HANDOFF_NEEDS_ATTENTION` to verified-hold attention without independent confirmation. Local handoffs also fed court-quota and Slot Watch ownership presentation. Historical timing summaries counted success-shaped final-state strings as "Verified hold: Yes · 5."

These are related propagation defects: multiple screens can agree with one another while sharing the same unsupported source assumption. Their agreement was not additional evidence.

### 16.4 What is established versus unresolved

**Established implementation defect:** missing provider confirmation was incorrectly promoted to a verified-hold result, and multiple downstream consumers repeated it.

**Established recovery behavior:** four initial local busy refusals, one initial provider 404, then five bound-record 404s during the investigation.

**Unresolved provider issue:** why five apparently valid pending creation responses were not independently retrievable before advertised expiry. Correcting the local classification does not repair or explain the provider's persistence behavior.

## 17. Implemented fixes and their exact boundaries

### 17.1 Core fix: `4d1834e`

The [core commit](https://github.com/marcpocong/thirsty-autobook-web/commit/4d1834e02be18b6bb95f8132ce157b89b0395666) changed 23 files, including regression coverage and documentation.

| Component | Change | Evidence boundary preserved |
|---|---|---|
| [hold-confirmation-errors.ts](../../../src/api-booking/hold-confirmation-errors.ts) | Separate `ProviderHoldUnconfirmedError` from `VerifiedHoldQrError` | A sent but unconfirmed creation remains UNKNOWN |
| [checkout-recovery.ts](../../../src/api-booking/checkout-recovery.ts) | Require explicit provider-confirmed state; wrap generic/local failures as unconfirmed | Busy/404/identity/group errors do not become verified holds |
| Same recovery controller, confirmed QR failure branch | Verify successful LOOKUP milestone, age within 30 seconds and unelapsed hold deadline before allowing confirmed-hold QR attention | A genuine confirmed hold can still be retained when only QR presentation fails |
| [checkout-recovery-queue.ts](../../../src/api-booking/checkout-recovery-queue.ts) | Queue automatic recovery per worker; allow other workers independently; continue after rejected work | Production claim checks remain, booking sends are not retried/rescheduled |
| [desktop-runner.ts](../../../src/api-booking/desktop-runner.ts) | Emit correlated `PROVIDER_HOLD_CONFIRMED` and verified diagnostic only after confirmation; propagate actual error category | Early local pending response is not a verified diagnostic |
| [precision-race.ts](../../../src/api-booking/precision-race.ts) | Unconfirmed error returns UNKNOWN even if journal says verified or lookup of the journal is unavailable | A captured sent response cannot become provably unsent merely because journal access fails |
| [armed-dispatch.ts](../../../src/api-booking/armed-dispatch.ts) | Missing confirmation callback defaults to UNKNOWN / `PROVIDER_CONFIRMATION_REQUIRED` | Absence of a required confirmation hook cannot imply QR success |
| [controller.ts](../../../ui/controller.ts) | Pending local response stays in flight; explicit provider stage establishes hold state; unconfirmed QR-attention becomes UNKNOWN | Intermediate UI cannot independently upgrade a local response |
| [release-forensics.ts](../../../src/release-forensics.ts) | Require per-attempt provider-confirmation correlation; preserve original labels in separate fields | Original traces/journals are not rewritten |
| [operational-state.ts](../../../ui/renderer/operational-state.ts), [operator-status.ts](../../../ui/renderer/operator-status.ts), [live.ts](../../../ui/renderer/live.ts) | Distinguish local results from confirmed hold/quota evidence | Attempt labels alone do not satisfy a provider-confirmed court quota |
| [slot-watch-view.ts](../../../ui/renderer/slot-watch-view.ts) | Ownership overlay requires fresh independent evidence | A public/unavailable cell is not coloured as this bot's hold from a local response alone |
| [pending-holds.ts](../../../ui/renderer/pending-holds.ts), [monitor.ts](../../../ui/renderer/monitor.ts) | Fresh-tab recovery action and direct result feedback in Live Monitor | Supported existing-checkout recovery; no new creation path |

The 30-second freshness check is not a retry timer or a promise of continued provider persistence. Expired/stale confirmation must cease to qualify as fresh presentation evidence. The provider verifier's full identity, customer, grouping, amount, date and expiry assertions remain required.

### 17.2 Native acceptance found an additional historical-label defect

After the first repaired installation, actual Windows navigation showed that Live Monitor's current confirmation counts were correct, but Activity's saved timing summary still displayed **"Verified hold: Yes · 5."** That card derived its count directly from historical telemetry state strings. It did not use the newly corrected forensic reconstruction.

This was preserved as a failed acceptance finding rather than dismissed as historical text. It explains why source tests and a corrected live monitor were insufficient for a complete handoff.

### 17.3 Final presentation fix: `48d2859`

The [follow-up commit](https://github.com/marcpocong/thirsty-autobook-web/commit/48d2859f477192f15fdeb1a07e634e6deeade1b2) changes two renderer files, two regression scenarios in the existing test file, and documentation:

- [insights.ts](../../../ui/renderer/insights.ts) labels the count **Recorded success labels**, displays **5 · not provider proof** for the original run, calls the adjacent figures recorded outcomes, and explains that timing logs do not independently confirm a provider hold. Per-child timing tables call their state a **Recorded outcome**.
- [booking-setup.ts](../../../ui/renderer/booking-setup.ts) describes an unexpired local handoff in the browser manager as a **Retained checkout** with an advertised deadline and fresh-confirmation requirement. It keeps the customer/profile unavailable for reuse under the same existing rule.
- [ui-monitor-holds.test.ts](../../../tests/ui-monitor-holds.test.ts) covers all legacy success-shaped state variants in a history fixture, checks that original telemetry is unchanged and no bridge action is called, and verifies that a locally captured checkout remains reuse-blocking without being called a verified hold.
- [PROVIDER_HOLD_CONFIRMATION.md](../../PROVIDER_HOLD_CONFIRMATION.md) records the intended semantics for future changes.

The engine and controller are unchanged between `4d1834e` and `48d2859`. Final installed backend byte comparison against the prior qualified installed backend passed.

### 17.4 Behavior intentionally not changed

The fixes did not change the exact Shotgun offsets, attempt budget, strict shot deadline, timing policy, authorization, customer/profile bindings, payment boundary, durable evidence, or a consumed submission permit. They did not retry any of the original targets.

The conservative raw-response suppression rule remains. Therefore the string `SHOTGUN_TARGET_ALREADY_ACHIEVED` can still describe a local stop decision; it is not newly promoted to a provider-confirmation assertion by these repairs. Section 21 identifies remaining review work rather than suggesting every historical counter now has authoritative semantics.

## 18. Corrected reconstruction without rewriting history

The corrected offline reconstruction was written to a separate directory, `DiagnosticsLocal/hold-classification-fix-nov2/reclassified-run/`. It reads the original 190-row progress log, frozen attempt identities, critical-path/provider trace, and Slot Watch evidence. It does not contact Onda.

| Field or view | Original recorded claim | Corrected interpretation |
|---|---|---|
| Overall outcome | `OBJECTIVE_ACHIEVED_EXTRA_HOLD` | `MANUAL_RECONCILIATION_REQUIRED`; original retained as `recordedOutcome` |
| Five HTTP 200 children | Verified/pending-hold success | UNKNOWN without per-attempt independent provider confirmation |
| Logical Court 7 final result | `HOLD_VERIFIED_QR_ATTENTION` | UNKNOWN; old label retained as `recordedFinalState` |
| Logical Court 6 final result | `HOLD_VERIFIED_QR_ATTENTION` | UNKNOWN; old label retained as `recordedFinalState` |
| Logical Court 5 | Rejected | Rejected, supported by two HTTP 400s |
| B3 | Locally rejected / unsent | Proven NOT_DISPATCHED; not a provider refusal |
| Activity latest-summary hold label | Verified hold Yes · 5 | Five recorded success labels, explicitly not provider proof |
| Current quota/grid ownership | Local response could look successful | Requires fresh independent evidence |

The reconstruction explicitly identifies absence of matching per-attempt provider-confirmation evidence. A legacy verified diagnostic, worker-only matching, or repeated derived success label cannot substitute for the exact attempt correlation.

The original files remain at their original paths with their original bytes. This publication includes their hashes and the preserved original claims so reviewers can challenge the interpretation without losing the historical record.

## 19. Regression, CI and installed validation

### 19.1 Focused functional coverage

The recovery/outcome regressions cover:

| Scenario | Required result |
|---|---|
| Official lookup 404 before deadline | UNKNOWN; no provider-confirmed quota |
| Busy recovery claim | UNKNOWN; no confirmed-hold QR-attention upgrade |
| Identity changed / wrong group | UNKNOWN; failed independent validation is not success |
| Provider confirmed, QR presentation fails | Explicit confirmed-hold QR attention, subject to freshness/expiry conditions |
| Provider confirmed, valid official QR | QR_READY |
| Generic post-response error and locally verified journal | UNKNOWN |
| Sent/unconfirmed capture with unavailable journal evidence | UNKNOWN, not provably unsent |
| Missing provider-confirmation callback | UNKNOWN / PROVIDER_CONFIRMATION_REQUIRED |
| Multiple same-profile automatic recoveries | Serialized; later work continues after a failure |
| Separate profiles | May verify independently |
| Controller pending-response event | In flight until actual provider confirmation |
| Legacy forensic success without correlated confirmation | Preserve old label, classify review result UNKNOWN |
| Quota and Slot Watch ownership | No success from local handoff alone |
| Historical timing success labels | Recorded data remains unchanged, never asserted as provider proof |
| Browser-manager local checkout | Fresh confirmation required; reuse remains blocked |

These are offline/intercepted or in-memory tests. Their success qualifies code behavior; it does not establish a new live reservation or reconcile one of the original groups.

### 19.2 Exact validation counts and provenance

| Qualification | Result | Scope |
|---|---|---|
| Core-fix broad local batch | 2,164 passed, 190 files | Exact `4d1834e` source |
| Complete isolated local batch after retained native failure | 148 passed, eight files | Exact `4d1834e`: Shotgun 36, strategy 5, Normal 4, destinations 2, armed 57, fan-out 12, timing 26, independence 6 |
| Core-fix complete local coverage | 2,312 passed, 0 skipped | Broad plus final complete isolated batch |
| [Core exact-SHA CI](https://github.com/marcpocong/thirsty-autobook-web/actions/runs/41367461882) | 2,305 passed, 7 existing platform skips | All stages successful for `4d1834e` |
| Final history-correction focused renderer file | 5 passed | Includes both added history/browser-manager cases |
| Final broad local batch | 2,166 passed, 190 files | Exact `48d2859` source |
| Combined final local coverage | 2,314 passed, 0 skipped | Final broad batch plus 148 isolated tests on unchanged engine/topology at `4d1834e`; not represented as a single exact-final-SHA local invocation |
| [Final exact-SHA CI](https://github.com/marcpocong/thirsty-autobook-web/actions/runs/41371181860) | 2,307 passed, 7 existing platform skips | Complete final commit, including heavy labs, UI and build checks |
| Final typecheck | PASS | Source, UI and tests |
| Clean source build and distribution verification | PASS | 539 compiled files; zero problems |
| Actual packaged runtime comparison | PASS | 272 compiled files; zero problems |
| First installed backend's separate synthetic checks | 3 passed | 404→UNKNOWN, busy→UNKNOWN, confirmed QR→QR_READY; unchanged fixture journals and no extra creation |
| Final installed backend comparison | PASS | Byte-identical backend to that installed `4d1834e` qualification |
| Native destination checks | PASS | Home, Setup, Live Monitor, Activity, Settings |

The final commit's only changes relative to the complete engine qualification are `docs/PROVIDER_HOLD_CONFIRMATION.md`, `tests/ui-monitor-holds.test.ts`, `ui/renderer/booking-setup.ts`, and `ui/renderer/insights.ts`. That exact file-list check was enforced in the corrective installation record; it is not an informal assumption that the engine "probably" did not change.

### 19.3 Retained Windows native crash limitation

The first continuation attempt at the 36-test Shotgun lab had **35 passed and one native child exit** in the `BROWSER_CLOSED` case. The exit was `3221226505 / 0xC0000409`, surfaced as `LAB_TEST_CHILD_EXIT`. It did not provide a failing business assertion explaining the native termination.

The same case passed alone (one selected, 35 unselected). A subsequent complete isolated batch then passed all 148 tests, including the full 36-test Shotgun lab. The final exact-commit CI also passed. The initial failure log and incomplete qualification JSON were retained.

This establishes intermittence and successful subsequent qualification. It does **not** establish the underlying native crash cause or prove it was repaired. No assertion, timeout or strict dispatch deadline was removed or loosened to obtain the passing rerun.

### 19.4 What native acceptance actually observed

At final acceptance the canonical application visibly displayed **Build 48d2859**. Normal Windows navigation, scrolling and selecting a saved local watch were used; no injected renderer command changed booking state.

- Home showed the retained safety lock and saved November 4 goal.
- Setup retained a compact historical-record summary and the stale saved-date warning.
- Live Monitor showed the November 4 saved date, required A/B/C topology, **No release armed**, zero recovery-confirmed checkouts, zero current official QR handoffs, and the retained safety lock.
- The saved November 2 availability grid had **no bot-owned court-hour highlights**. Its public/unavailable cell states remained visible; opening that saved view was local-only rendering.
- Activity displayed **Recorded success labels: 5 · not provider proof**, together with the explicit timing-log limitation. The old telemetry was preserved.
- Settings exposed the final build metadata and existing application/system sections.

Screenshots and original native acceptance files remain in the local qualification directory. The public package includes the allowlisted native observation record in `evidence.json.qualification.native`, but omits screenshots because broader application screens can contain configuration or identity context unrelated to the incident. Reviewers also have source hashes, code and tests to inspect.

## 20. Canonical installation and evidence preservation

### 20.1 Canonical runtime and build identity

The application was updated through its existing canonical staged/transactional installation process. No second installation was substituted for the real application, and no managed production file was manually patched for the fix.

| Installed revision | Build ID | Content ID | Verification time, Manila |
|---|---|---|---|
| First repaired `4d1834e` | `4d1834e-821378422a` | `821378422ab928368491a8f670cc9d6cd1bd1716003ca8ebd52dd5f0529117cb` | 09:06:07.628 |
| Final corrective `48d2859` | `48d2859-60bb1aad7c` | `60bb1aad7c2d84508f5d19463779854df4abf74292f8ee3a230a58dc60778bed` | 09:25:54.703 |

At each installation the 12 managed paths, deterministic runtime branding, launcher, dependency content, source/build provenance, exact successful CI and protected/private state were checked. Rollback and preceding transaction manifests were retained. The final runtime was reopened normally and inspected.

### 20.2 Why an audited maintenance exception was needed

Normal preflight refused the two Court 7/6 **parent** journals because their legacy `verified` state had no observed-response expiry fields. The child evidence was richer: all six children under those parents were accounted for, five had immutable original captures with elapsed advertised windows and contradictory 404 results, and one was conclusively unsent.

The owner-authorized continuation used a new, time-limited, installation-only maintenance wrapper. It admitted the **exact hashes of those two parent records**, while rechecking the entire protected baseline and captured child evidence. It admitted zero dedicated Chrome process exceptions because none remained. It did not turn UNKNOWN into expired, change a permit, remove a journal, or authorize a new booking.

The first and corrective updates each used their own fresh audit/policy. Exact source/remote main, clean source, successful exact-SHA CI, staged verification, rollback and transaction checks remained enforced. Any unrelated/new blocker, changed lifecycle byte, private/configuration digest mismatch, wrong source SHA, wrong root or expired policy refused the action.

Both exceptions were marked consumed and subsequently tested to reject reuse with `OWNER_UPDATE_EXCEPTION_ALREADY_USED`. The wrappers are local maintenance evidence; they are not a permanent updater bypass or a new operator control.

### 20.3 Exact preservation scopes

| Check | Result | Scope caveat |
|---|---|---|
| Bound-record recovery investigation | 669 original journal/capture files unchanged | Its own earlier baseline; not a count of all installation files |
| Fix continuation baseline | **1,140 lifecycle files unchanged** | All files in the supported lifecycle manifest at baseline |
| Configuration | Digest unchanged | No saved-date or customer/preference rewrite |
| Private state | Tree digest unchanged | No capability/profile/customer copying |
| Original incident summary/report/progress/freeze/captures | Retained; hashes published | New derived report is separate |
| Final application backend | Matches qualified installed `4d1834e` backend | `48d2859` is a renderer/documentation/test correction |
| Final main/remote/runtime snapshot | Matched `48d2859` at 09:29:06.754 | Later documentation publication does not imply another runtime installation |

The retained lock snapshot remains `HOLD_VERIFIED`, recorded at `2026-11-02T00:00:04.085Z`, with advertised expiry `2026-11-02T00:10:00.724Z` and original release/deadline anchors. Its historical stage name was not rewritten to make the new report look consistent. The expired advertised timer does not by itself resolve the underlying unconfirmed outcomes or authorize a retry.

### 20.4 Generated metadata differences after startup

The first installed offline verification generated one Vitest cache result inside the installed dependency tree. The audit reproduced the staged dependency digest, confirmed all **213 previous cache entries** were unchanged, and identified the one new synthetic-test entry plus an append-only Electron log. Those metadata changes were disclosed rather than reported as a byte-identical full dependency tree.

The corrective canonical package restored its normal staged dependency cache through the ordinary transaction. The final post-startup comparison examined **3,125 dependency files**. Its only remaining difference was `electron/dist/debug.log`: the original 830-byte prefix was intact and 332 bytes were appended. All other dependency/code bytes matched. The final runtime-log hash and precise byte counts are included in `evidence.json.qualification.final.runtimeLog`.

This is an explicit metadata exception in the forensic description, not a relaxation of the production updater's integrity checks. The application was left running on Live Monitor, unarmed. No further installation is performed by publishing this report.

## 21. Unresolved issues and hypotheses

### 21.1 Established versus unknown matrix

| Question | Status | Evidence / remaining requirement |
|---|---|---|
| Were seven POSTs sent? | **Established** | Exact child request events, response events and run sentCount |
| Did five responses advertise pending groups? | **Established** | Original captures, structures, amounts and hashes |
| Were there 15 distinct captured hourly booking IDs? | **Established locally** | Checked in exporter; raw IDs intentionally unpublished |
| Did all five official follow-up lookups return 404 before deadline? | **Established** | Bound-record lookup milestones and capture hashes |
| Did the bot independently confirm a hold for this run? | **No confirmation established** | Zero matching confirmation stages; no successful recovery/QR |
| Was the original objective-achieved claim justified? | **No** | Local classification promoted unconfirmed recovery failures |
| Why did Onda return HTTP 200 and later 404? | **UNKNOWN** | Requires provider-side authoritative correlation/state, not local relabelling |
| Did a pending group exist transiently in some provider subsystem? | **UNKNOWN** | Local response objects do not settle persistence |
| Did each apparent group expire normally? | **UNKNOWN** | Advertised time passage is not matched terminal provider evidence |
| What caused B3's late browser/security failure? | **Not fully explained here** | Recorded failure and duration exist; no proven native/provider root cause |
| What caused the Windows lab native crash? | **UNKNOWN** | Isolated and full reruns passed; original native failure retained |
| Does the new runtime guarantee the next 08:00 release? | **UNVERIFIED / NOT READY at acceptance** | Stale saved date; missing/prepared browser, timing and security qualification still required |

### 21.2 Provider-side hypotheses are not findings

Plausible lines of inquiry include a pre-publication gate, different provider validation branches, transient/transactional object creation without committed persistence, lookup authorization/scope differences, read-replica consistency, or inconsistent publication state across endpoints. The two explicit unavailable-date 400s and six pre-anchor request events make publication-boundary behavior particularly relevant to ask about.

None is proved by the available data. There are no provider database transaction logs, documented queue timestamps, server-side identity traces, or authoritative commit/rollback records in this package. A hypothesis must not be upgraded merely because it fits the grid movement or response timing.

### 21.3 Remaining historical dispatch-count discrepancy

The actual saved Activity timing-summary card still displays **8/8 dispatched** for the old trace. Its underlying telemetry inference is not the same as authoritative request-event accounting. The exact original `PHASE3_OUTCOME` event, seven POST events and the all-null unsent B3 transport establish **seven POSTs and one unsent child**.

The follow-up renderer fix changes the unsupported verified-hold label; it does **not** claim to repair every historical dispatch counter or to rewrite the telemetry file. This discrepancy is deliberately documented for reviewers. Any future fix should qualify its evidence source, preserve the old record, and use exact child transport identity rather than treating every scheduled/started child as sent.

### 21.4 Retained suppression terminology and other derived consumers

`SHOTGUN_TARGET_ALREADY_ACHIEVED` remains the local raw-response safety/suppression code described in section 13. Reviewers should distinguish that conservative stop mechanism from independently confirmed objective achievement.

The historical forensic builder and the Activity wording were corrected, but a consumer that independently interprets old raw final-state strings can still misread them if it ignores these provenance rules. This report does not certify every archived third-party/exported dashboard. Review the [release telemetry](../../../src/release-telemetry.ts) and [Release Lab analysis](../../../src/release-lab-analysis.ts) consumers when assessing any older aggregate that asserts success.

### 21.5 Operational readiness remains a separate decision

At final installed acceptance, the saved November 4 release date was stale, the required A/B/C browsers were not prepared, and no release was armed. The UI correctly retained the date and warned rather than automatically substituting the next publishable target.

Offline regression, installed integrity, a synchronized clock, and earlier Available Now QR success do not qualify the next scheduled topology, timing calibration or live security for a new target. This report authorizes none of those operations.

## 22. Independent review plan

### 22.1 Suggested review order

1. Read sections 1, 8, 12, 16, 17 and 21 before reading success-oriented historical logs. Establish the actual accounting and uncertainty first.
2. Inspect `evidence.json.accounting`, `authorization`, the eight `children`, and their original versus review states. Confirm the seven POSTs and unsent B3 using exact identities.
3. Check the five response projections and capture hashes. Reproduce the private-ID uniqueness assertion locally if access to originals is authorized. Do not ask for access tokens or customer data in a public issue.
4. Compare each `manualRecovery` against its `capture.sha256` and `verificationHistory[].responseHash`. Confirm the lookup result occurred before the recorded advertised deadline, with the declared clock caveat.
5. Review the two explicit HTTP 400 body projections and the passive-trace coverage limits.
6. Review timing using the separate configured, Node, bounded renderer and browser-event columns. Do not use deferred `at` fields as send times.
7. Diff the exact incident code revision against the core fix, then review the narrower follow-up renderer commit. Confirm UNKNOWN takes precedence over a legacy locally verified journal and genuine confirmed QR-attention remains possible.
8. Inspect qualification provenance: exact CI SHA, local batch SHA, unchanged-engine comparison, actual installed content ID and native acceptance. Keep source, installed, synthetic and live statements separate.
9. Review the unresolved issues rather than accepting the fixes as proof of provider persistence or next-release readiness.

### 22.2 Questions for code reviewers

| Area | Review question |
|---|---|
| Error typing | Can any unconfirmed post-response error still reach `VerifiedHoldQrError` or QR_READY without the required confirmation evidence? |
| Journal semantics | Can a legacy locally verified journal alone increase a confirmed quota, ownership overlay or final success? |
| Queue/claim interaction | Does per-worker serialization retain the original claim, identity and failure behavior while allowing other profiles independently? |
| Missing evidence | Is a sent/unconfirmed response still UNKNOWN if journal lookup fails or returns no record? |
| Confirmed QR failure | Are fresh lookup correlation, 30-second age and remaining expiry enforced without weakening identity/group checks? |
| Child accounting | Are fan-out children joined by immutable child/attempt identity rather than only worker or court? |
| Timing | Is a timestamp explicitly from Node, renderer, browser or provider metadata before arithmetic is done? |
| Historical UI | Are raw historical labels presented as recorded data, with unsupported success claims qualified? |
| Suppression | Is a duplicate-protection stop distinguished from provider-confirmed goal achievement? |
| Privacy | Can a public report be reproduced without publishing capabilities, contact data, proofs or raw booking identifiers? |

### 22.3 Questions for a provider-assisted investigation

An authorized provider investigation should correlate the original private creation identifiers and transaction/session relationships with server-side records, using a private channel with appropriate access. The public report deliberately supplies only pseudonyms, hashes and timing/shape facts.

Useful questions include whether each response was committed, rolled back or subsequently removed; what exact publication/date gate applied to each request; whether creation and lookup endpoints used the same scope/state; whether a lookup 404 can mask authorization or incomplete group creation; and which provider timestamp, if any, has documented receipt/commit semantics.

Requesting those answers is distinct from replaying creation, paying, cancelling, or changing the original evidence. No such live action was performed to prepare this report.

### 22.4 Offline reproduction

From the `Source` checkout, with the original installation directory available as its parent:

```powershell
# Pick a NEW output file in an existing review directory.
# The exporter reads local files only; it never imports a browser or booking engine.
node scripts/forensics/export-nov2-evidence.mjs .. C:/review/nov2-evidence-new.json

# Compare the SHA-256 with the published evidence.json hash in VALIDATION.md.
Get-FileHash -Algorithm SHA256 C:/review/nov2-evidence-new.json
```

The exporter refuses to overwrite its output. It requires all expected incident identities/counts, checks five capture-to-verification hash relationships, checks distinct IDs privately, checks the before-deadline 404 margins, and rehashes all 90 input files before writing. If an original changes, treat that as evidence drift; do not edit the original to make a reproduction pass.

An independent reviewer without the private originals can inspect the full sanitized projection, code diffs and CI links, but cannot independently regenerate private hashes or prove the unpublished identities from the public package alone. That limitation is explicit.

## 23. Final status and action boundaries

| Capability or question | Verdict |
|---|---|
| Scheduled run transport accounting | **ESTABLISHED:** 8 authorized, 7 sent, 1 unsent |
| Scheduled run independently confirmed holds | **0 established** |
| Scheduled run successful official QR handoffs | **0 established** |
| Original five apparent groups | **UNKNOWN**, original evidence retained |
| Original false-success classification | **REPAIRED AND QUALIFIED** in later source/runtime |
| Same-profile automatic recovery contention handling | **REPAIRED / OFFLINE QUALIFIED**; no live replay of incident |
| Final corrected native history wording | **PASS**, observed in canonical application |
| Final runtime integrity and preservation | **PASS**, with explicit append-only runtime-log exception |
| Provider HTTP 200/404 cause | **UNRESOLVED** |
| Native Windows fixture crash cause | **UNRESOLVED**, subsequent isolated/full qualification passed |
| Historical 8/8 dispatched summary | **KNOWN LIMITATION**; authoritative count remains seven POSTs |
| Next scheduled release at final acceptance | **NOT READY / NOT QUALIFIED BY THIS WORK** |

The repair continuation left the canonical app running on Live Monitor with the safety lock, original saved date and original protected target evidence. This documentation publication does not install a new runtime, clear a lock, alter a journal, recover another checkout, send a booking, pay, cancel, arm, or automatically re-date a plan.

## Appendix A. Machine-readable evidence map

| JSON path | Contents |
|---|---|
| `accounting` | Primary counts, original/review outcome and journal/review-state distinction |
| `authorization` | Exact candidate set, offsets, budgets, quota, schedule and rate-evidence provenance |
| `clock`, `criticalHeader` | Clock rounds, offset relationships and runtime browser version |
| `events` | All 190 progress rows projected through an explicit field allowlist, retaining original line numbers |
| `parents` | Three raw parent journal projections |
| `children` | All eight child journals, exact identity joins, critical timing, original/review states |
| `children[*].capture` | Five sanitized response structures, timestamps and SHA-256s |
| `children[*].verificationHistory` | Original immutable provider-verification milestones |
| `children[*].manualRecovery` | Same-record 404 results, declared clocks and before-deadline margin |
| `identityProjection` | Binding presence and uniqueness assertions without publishing bindings |
| `observer` | Read counts, first/final grid facts, quality metrics, target states and sanitized timeline |
| `provider` | Two passive trace projections and seven response fallbacks, including the two fixed error messages |
| `review` | Corrected derived outcome, preserved original labels and stated limitations |
| `installationAtIncident` | Pre-run canonical runtime identity |
| `fixes` | First/final installation identities, CI/local qualification and scoped consumed exceptions |
| `qualification` | Native acceptance, installed synthetic checks, backend equivalence and native failure limitation |
| `preservation` | Protected baseline count/digest, private/configuration digests and retained lock snapshot |
| `sourceManifest` | 90 root-relative input paths, byte lengths and SHA-256s |

## Appendix B. Primary source hashes

These hashes anchor original inputs. The complete manifest, including every projected journal/capture/verification record and qualification log, is in `evidence.json.sourceManifest`.

| Input | SHA-256 |
|---|---|
| Frozen authorization | `1c5296d6ea02bffd7d46ae4d3ea972d7597e16159cda053b736e9fc9947e8fd2` |
| 190-row run progress | `40db9498418a2658215ea2e333114b23f6f29bf33214429dfb696b63ef3d6c2e` |
| Critical path | `2b2a688d3bad1d011b7224a899eba101adc04f9f5d892de6d75d80eb19099030` |
| Provider trace | `73f9862f968826de9024af820acd0ecf8c0005e26a9399f31d4c70110de6e95d` |
| Original generated summary | `cea6c27635aafda64cfd7fa5a6943a6480049953b210dd2bf1ebfe6bfaa56ab4` |
| Original generated report | `f160a0507ae3ca535ee26222134de68b14cc4a725ad7bf9f28e3be089b098080` |
| Slot Watch raw NDJSON | `070af97f2a68b1f24bd5821b81c2163b659c1507ebfa88401bd0d7831437ebdd` |
| Slot Watch summary | `193d4a94f1ae95e4e47506a6691c91f9549698b787510a4fdfb05391f28e7558` |
| Slot Watch quality | `ba588fe6b171dad15c9cf4a26e0bcfeb62f9d64686fce78781e2ec4ccb18c0f0` |
| Retained automation lock | `7b508d573224ae8456a4be041adb852eeca56e6e3d5591c7a910a1c8a7f25376` |

### Original private capture hashes, with public aliases

| Alias | SHA-256 |
|---|---|
| A1 | `134104de3682fc0ed285cc92ba47d482bae4c95299fb50331e71d71174d4db64` |
| A2 | `84df3041947fa3ead1fed3f3610a2af19992f34407b391efac56926cb4b082cf` |
| A3 | `9467f7c3dfe45852c99b5444c78d98e7a6de99aa26d523b9b2f9690c61107426` |
| B1 | `48ccb0d0d1e2393f4efaaf008a32dfda079b10c706552fcec98255d16b0116ad` |
| B2 | `17edf156f49fd2594a0e1e9bac2b4746723ab2243be00fce0b2889531837bf6c` |

A hash is not a checkout capability. Publishing it permits integrity comparison by an authorized reviewer; it does not reveal the underlying private record or confer permission to use it.

## Appendix C. Source review entry points

- Incident behavior: inspect the repository at commit `00bf43d966408261c831bc87368f9bfcc48289da`.
- Main repair: [commit 4d1834e](https://github.com/marcpocong/thirsty-autobook-web/commit/4d1834e02be18b6bb95f8132ce157b89b0395666).
- Final history wording: [commit 48d2859](https://github.com/marcpocong/thirsty-autobook-web/commit/48d2859f477192f15fdeb1a07e634e6deeade1b2).
- Safety/error logic: [armed-dispatch.ts](../../../src/api-booking/armed-dispatch.ts), [precision-race.ts](../../../src/api-booking/precision-race.ts), [hold-confirmation-errors.ts](../../../src/api-booking/hold-confirmation-errors.ts).
- Recovery and claim logic: [checkout-recovery.ts](../../../src/api-booking/checkout-recovery.ts), [pending-hold-recovery.ts](../../../src/api-booking/pending-hold-recovery.ts), [recovery-claim.ts](../../../src/api-booking/recovery-claim.ts), [checkout-recovery-queue.ts](../../../src/api-booking/checkout-recovery-queue.ts).
- Original-evidence interpretation: [release-forensics.ts](../../../src/release-forensics.ts), [release-telemetry.ts](../../../src/release-telemetry.ts), [release-lab-analysis.ts](../../../src/release-lab-analysis.ts).
- Core regression: [provider-confirmed-outcome.test.ts](../../../tests/api-booking/provider-confirmed-outcome.test.ts), [armed-dispatch.test.ts](../../../tests/api-booking/armed-dispatch.test.ts), [release-forensics.test.ts](../../../tests/release-forensics.test.ts), [ui-precision.test.ts](../../../tests/ui-precision.test.ts).
- Presentation regressions: [operational-state.test.ts](../../../tests/operational-state.test.ts), [ui-monitor-holds.test.ts](../../../tests/ui-monitor-holds.test.ts), [release-preflight-ui.test.ts](../../../tests/release-preflight-ui.test.ts).
- Publication reproduction: [export-nov2-evidence.mjs](../../../scripts/forensics/export-nov2-evidence.mjs).

Relative source links refer to the repository version being viewed. Use the explicit commit links or `git show <sha>:<path>` when reviewing the incident implementation versus either repair.
