# November 1, 2026, 08:00 release: forensic review and repair record

**Incident:** `63a216a2-cc04-42bc-b982-df174537634d`

**Release:** November 1, 2026, 08:00 Manila / `2026-11-01T00:00:00.000Z`

**Requested booking date:** November 3, 2026

**Targets:** Mango Courts 7, 6 and 5, each 19:00–22:00, PHP 2,100 per three-hour target

**Original outcome:** `MANUAL_RECONCILIATION_REQUIRED`, process exit 1

**Review status:** multiple local defects identified and repaired; original provider-side noncreation/404 cause remains unresolved.

This report is intended for independent human and AI review. It distinguishes original durable evidence, derived timing measurements, historical offline revalidation, subsequent live experiments, installed changes, and source-only changes. Publishing it does not authorize another reservation, replay of a request, payment, deletion of evidence, or retry of an UNKNOWN target.

## 1. Findings that should survive every summary

1. The actual scheduled Shotgun engine was used at 08:00. Eight children were frozen and armed across three logical court targets. Seven children have observed POSTs and HTTP 200 responses. The eighth was suppressed before its transport was called because another target's outcome was already ambiguous.
2. The seven responses describe **seven apparent temporary pending-reservation groups, but zero bot-verified holds at incident time**. Each response contains three hourly bookings, three hourly sessions and PHP 2,100. These are not seven paid bookings, nor seven independently recoverable reservations established by this investigation.
3. The installed response validator rejected those captures with `CHECKOUT_SESSION_INVALID`. Its literal time comparison required `HH:mm:ss`; the saved responses used equivalent `HH:mm` values. The previously repaired source had not been fully installed. Historical offline replay with the narrowly patched installed module passes all seven unchanged captures at their original valid times.
4. That compatibility defect explains the local validation failure and conservative UNKNOWN handling. **It does not explain why Onda's official lookup subsequently returned HTTP 404, “Booking not found,” for every saved group while their advertised hold windows had not yet elapsed.** Offline validation cannot establish persistence in Onda's database.
5. The availability observer had a separate helper compatibility failure. Original watch records show one locally refused helper acquisition, followed by 194 locally blocked reads. There were no availability network launches and no answered availability grid. Therefore this incident has no trustworthy observed availability transition timeline.
6. All eight release security preparations completed before the first trigger. The pre-release missing-helper problem was repaired before the release. A later rehearsal's security timeout must not be retroactively substituted as the morning failure cause.
7. Later authorized tests proved that new holds can be created and recovered for other November 3 intervals. One actual Shotgun attempt produced a validated Court 7 08:00–11:00 hold and a fresh-tab payment QR. Those later results do not reconcile the morning UNKNOWN records or reproduce the full eight-shot release.
8. Further QR presentation defects were found: exact hourly summary rows versus an aggregate range, and an image versus a canvas QR renderer. Their source repairs preserve court/date/time/amount/status checks. The latest canvas/image changes were not installed during this publication task.

## 2. Evidence package and trust boundaries

The accompanying [evidence.json](evidence.json) is a schema-labelled, allowlisted projection of the original local files. It includes all eight child identities, their journal states, response shapes, exact hourly times and rates, critical-path measurements, progress events, original clock rounds, observer refusal counts, read-only recovery results, replay results and repair hashes. `sourceManifest` contains SHA-256 and byte length for 35 source files.

The export deliberately excludes customer names, email, phone, cookies, browser profiles, challenge/fingerprint values, checkout access tokens, payment QR payloads, raw request bodies, transaction identifiers and usable booking identifiers. Hashes identify original private files without publishing their contents. Safe local worker aliases A/B/C, target hashes and diagnostic attempt IDs remain for joining evidence. Files with “private” in their manifest path are hash references only; their contents are not copied verbatim.

The original files remain outside this repository in the canonical installation. Important locations, relative to that installation:

| Evidence | Original location | Role / caution |
|---|---|---|
| Append-only runner progress | `.local/api-booking/run-progress/63a216a2-cc04-42bc-b982-df174537634d.ndjson` | Stage and diagnostic-attempt accounting; deferred stage-write times are not all network event times. |
| Frozen authorization | `.local/api-booking/precision-races/63a216a2-cc04-42bc-b982-df174537634d-phase3-freeze.json` | Authoritative target allocation, exact signed offsets and budgets. |
| Parent and child journals | `.local/api-booking/api-first-journals/<logical-key>/` | Three parent UNKNOWNs, seven child UNKNOWNs, one rejected/proven-unsent child. Parent rows are not extra POSTs. |
| Private saved responses | `fan-out/<freeze>/<child>/checkout-recovery-private.json` beneath each target | Recovery material captured before local response validation. Never upload or log tokens. |
| Critical-path rows | `.local/release-forensics/<run-id>/critical-path.ndjson` | Eight child rows; bounded renderer clock mapping and separate browser-event measurements. |
| Provider trace | `.local/release-forensics/<run-id>/provider-trace.ndjson` | One detailed passive trace plus response summaries. Coverage is incomplete. |
| Original generated report | `.local/release-forensics/<run-id>/report.txt` and `summary.json` | Historical report retained; some grouped/legacy fields require the cautions below. |
| Original observer | `.local/slot-watch/2026-11-03_311dea90-dbb3-4284-9520-be292e2673a3.ndjson` | Raw locally-refused versus network-read distinction. |
| Recovery investigation | `DiagnosticsLocal/recovery-nov1/` | Original safe 404/access/lookup results; no new checkout. |
| Installed validator repair | `DiagnosticsLocal/installed-repair-nov1/` | Backups, hotfix hashes, historical replay, preservation proof. |
| Later tests | `DiagnosticsLocal/nov3-extended-live-test/`, `shotgun-court6-rehearsal/`, `security-readiness-repair-nov1/`, `shotgun-court7-rehearsal/` | Separate experiments with separate authorization and failure modes. |

The export script is [scripts/forensics/export-nov1-evidence.mjs](../../../scripts/forensics/export-nov1-evidence.mjs). It imports no browser or booking engine, only reads original files, requires a new output path, and refuses unexpected child accounting. An authorized reviewer with the original local installation can reproduce an export without sending any provider request:

```powershell
# Run from Source; use a NEW output filename. This does not contact Onda.
node scripts/forensics/export-nov1-evidence.mjs .. C:/review/nov1-evidence-new.json
```

The destination's parent directory must already exist. The script is deliberately incident-specific, not a latest-run selector. Compare exported source hashes before interpreting a regenerated result. The machine-readable payload, prose and original journals serve different purposes; a regenerated report must never rewrite the journals to agree with a newer validator.

## 3. Runtime provenance: why “fixed in GitHub” did not mean “fixed at 08:00”

The canonical executable/runtime used base build `314f024-a0271d6795`. Before the morning release it received a targeted genuine-security helper patch, not a complete source upgrade. The checkout time-format repair had already been merged into source by PR #19, but the installed checkout validator still contained the old comparison.

| Layer | State at the morning release | Subsequent change |
|---|---|---|
| Canonical base app | `314f024-a0271d6795` | Base metadata retained; no full app installation claimed. |
| Genuine security helper | Current Onda minified aliases patched before release | Genuine A/B/C security checks passed before arming. |
| Checkout response validator | Older literal second-format comparison | Owner-authorized targeted source/JS/map replacement after incident. |
| Browser availability fingerprint helper | Installed asset lacked current alias | Source fix merged in PR #20; installed availability helper was not included in the validator-only hotfix. |
| QR order summary | Aggregate time-range expectation | Exact hourly-multiset repair added later and installed as a recorded targeted patch. |
| QR visible element | Canvas-only expectation | Source now accepts canvas or explicit `Payment QR code` image in recovery and both production handoff paths; not installed in this work. |
| Rehearsal readiness wrapper | Did not exist at 08:00 | Added later as an explicitly bounded separate CLI, then repaired to await genuine readiness before selecting a rehearsal anchor. |

Relevant source integration sequence: strict checkout time compatibility `207f6f3`; child accounting/timing/observer reporting `518e368`; PR #19 merge `eb3ba04`; current helper aliases `2a4264a`; PR #20 merge `3deed85`; bounded rehearsal `775d24f`; rehearsal documentation `8fcbbfc`; readiness-before-anchor repair `655cc43`. The QR renderer correction and publication report are subsequent changes in this publication.

This mixed installed state is intentional provenance, not a claim of an intact base-build hash. Targeted manifests document the changed assets. The application's full-source-not-installed indicator remains materially relevant. Passing source tests, pushing main or producing `Source/dist` does not install parent `dist`.

## 4. Pre-release security helper failure and repair

The pre-release panel showed `ONDA_SECURITY_HELPER_UNAVAILABLE` for A, B and C, with near-zero elapsed time. That is a local helper-resolution failure, not evidence of a provider checkout rejection.

Onda's loaded production module `709892` exported the genuine booking challenge helper under `u`, while module `139691` exported the genuine public fingerprint helper under `f`. The original integration expected descriptive export names. The repair resolves the descriptive name when present, otherwise the observed current minified alias, and requires a callable function.

The genuine challenge and fingerprint functions still execute inside the same Onda browser page. The patch does not manufacture tokens, replay proofs, borrow cookies, solve a CAPTCHA, or bypass verification. Helper failures remain explicit failures. The later readiness instrumentation records only which helper failed, duration and challenge-frame presence; no proof value or rejection content is logged.

Targeted installed security helper manifest time: `2026-10-31T23:44:27.766Z` = November 1 07:44:27.766 Manila. Genuine A/B/C verification was recorded at 07:44:42.148 Manila, with values discarded. Both installed source and compiled browser assets changed from SHA-256 `18046ceb0d6f486ae706ce1e6f1c15b783cb33df62310a85b063e19538621647` to `1b39d52c5e770b9fcfbc14972cb9e52178b40b1a975050d1e80c672921b0a853`.

The same fingerprint alias compatibility was added to the source availability reader. That reader has a separate browser asset, which is why repairing checkout security did not automatically repair installed availability observation.

## 5. Frozen release plan and exact attempt accounting

The run started at 07:49:12.102 Manila. Authorization was recorded at 07:49:14.918. Freeze time was 07:58:00.351. The release instant was fixed at 08:00:00.000.

The frozen budget was eight Wave 1 attempts, Wave 2 budget zero, Rescue budget zero, no standby workers, no concurrent Wave 2. All targets share the same 19:00–22:00 interval; the authorization warned that a time-wide unavailable block could affect every target. Allocation was 3/3/2 across Courts 7/6/5.

| Attempt | Worker / court | Fan-out index | Trigger offset (ms) | Strict deadline offset (ms) | Durable child state / result |
|---|---|---:|---:|---:|---|
| `core-A-official-1` | A / 7 | 0 of 3 | -2000 | -1950 | UNKNOWN; HTTP 200; `CHECKOUT_SESSION_INVALID` |
| `core-B-official-4` | B / 6 | 0 of 3 | -1714 | -1664 | UNKNOWN; HTTP 200; `CHECKOUT_SESSION_INVALID` |
| `core-C-official-7` | C / 5 | 0 of 2 | -1429 | -1379 | UNKNOWN; HTTP 200; `CHECKOUT_SESSION_INVALID` |
| `core-A-official-2` | A / 7 | 1 of 3 | -1143 | -1093 | UNKNOWN; HTTP 200; `CHECKOUT_SESSION_INVALID` |
| `core-B-official-5` | B / 6 | 1 of 3 | -857 | -807 | UNKNOWN; HTTP 200; `CHECKOUT_SESSION_INVALID` |
| `core-C-official-8` | C / 5 | 1 of 2 | -571 | -521 | UNKNOWN; HTTP 200; `CHECKOUT_SESSION_INVALID` |
| `core-A-official-3` | A / 7 | 2 of 3 | -286 | -236 | UNKNOWN; HTTP 200; `CHECKOUT_SESSION_INVALID` |
| `core-B-official-6` | B / 6 | 2 of 3 | 0 | +50 | Locally rejected / NOT_DISPATCHED; `SHOTGUN_TARGET_OUTCOME_UNKNOWN` |

Counts: **8 authorized, 8 armed, 8 security-ready, 7 observed sent, 7 HTTP 200, 7 UNKNOWN, 1 proven unsent, 0 bot-verified holds, 0 verified QR handoffs, 0 payments established.** The three parent UNKNOWN records summarize the same targets and must not be added to the child POST count. Wave 2 and Rescue were not available as recovery attempts.

The final B child has a scheduler wake at +0.01 ms but no worker invocation, transport entry, pre-POST, renderer/fetch or browser-request measurement. Its original journal failure is target ambiguity suppression. It is not an eighth missing response and must not be labelled UNKNOWN.

## 6. Preparation and clock evidence

The initial run configuration's `prewarmLeadMs=15000` is not the final fan-out preparation lead. The later exact-task `PREWARM_PLAN` selected **32,190 ms**, using three workers, maximum fan-out width three, 34 historical samples and measured compatible preparation duration 4,584 ms. Do not explain this incident as production having only the initial 15 seconds.

All eight preparation completions preceded the earliest -2000 ms trigger:

| Attempt | Recorded prewarm-ready offset (ms) |
|---|---:|
| A1 | -31194 |
| B4 | -31386 |
| C7 | -31284 |
| A2 | -28163 |
| B5 | -29052 |
| C8 | -29387 |
| A3 | -25148 |
| B6 | -25706 |

The run contains eight `SECURITY_PREPARATION_STARTED`, eight completed preparations and eight `SECURITY_PREWARM_READY` stages. It contains seven checkout function entries and seven pre-POST observations. The eighth child's suppression therefore does not establish failure to prepare security.

| Clock round | Adopted host correction (ms) | Samples | RTT (ms) | Spread (ms) | Uncertainty (ms) |
|---|---:|---:|---:|---:|---:|
| T-10 minutes | +617.0 | 10 | 42 | 4.5 | ±22.0 |
| T-60 seconds | +623.5 | 10 | 42 | 10.9 | ±22.8 |
| T-30 seconds | +622.3 | 10 | 41 | 1.0 | ±20.6 |

The observer used +617.3 ms, approximately 5.0 ms behind dispatch. Network-clock uncertainty, renderer calibration bounds, wall-event conversion and deferred log writes are distinct concepts. Millisecond values below preserve their original measurement definitions rather than pretending all clocks share one origin.

## 7. Child-level critical path

Offsets below are milliseconds relative to release. Renderer fetch and body completion are central estimates with bounds retained in JSON. `Response observed` is Node-side observation/bookkeeping, not provider commit time. Missing values remain missing.

| Attempt | Node worker invoked | Node pre-POST | Renderer fetch | Browser request event | Renderer body complete | Node response observed | Fetch → request-event gap |
|---|---:|---:|---:|---:|---:|---:|---:|
| A1 | -1999.64 | -1999.23 | -1996.31 | -1778.56 | -124.51 | +1005.02 | 217.75 |
| B4 | -1713.92 | -1713.83 | -1711.74 | -1390.51 | +292.66 | +1004.47 | 321.23 |
| C7 | -1428.91 | -1428.83 | -1426.84 | -1105.94 | +788.56 | +1000.16 | 320.90 |
| A2 | -1142.95 | -1142.87 | -1141.35 | -880.22 | +663.25 | +1005.56 | 261.13 |
| B5 | -856.93 | -856.85 | -855.40 | -619.15 | +1002.90 | +1010.24 | 236.25 |
| C8 | -570.89 | -570.77 | -568.89 | -345.80 | +1558.01 | +1560.19 | 223.09 |
| A3 | -285.94 | -285.83 | -283.48 | -27.46 | +92.12 | +1005.32 | 256.02 |
| B6 | — | — | — | — | — | — | — |

Eight-sample renderer calibrations report consistent mappings with approximately 0.38–0.49 ms uncertainty and minimum round trips 0.56–0.84 ms. Node pre-POST to mapped renderer entry is roughly 1.45–2.92 ms for sent children. The substantially larger 217.75–321.23 ms fetch-to-browser-request-event interval is observed, but its cause is not established here.

The strict 50 ms rule checks local permitted initiation at the scheduler/Node/renderer gates. It is not a promise of an on-wire packet, edge receipt or database action within 50 ms. The browser request event is later than those gates. Do not “fix” that observed gap by widening the strict deadline, moving saved offsets, adding shots, or claiming provider arrival from a local event.

`ResourceTiming` is retained separately, including bounded times and protocol. For example, A2 has mapped fetch approximately -1141.35 ms while its resource-timing fetch entry is approximately +535.25 ms. These surfaces do not agree on a single physical boundary. They must not be silently substituted, added, or used to manufacture a provider queue-time measurement. Establish which resource entry/request each surface represents before attributing the gap.

Provider-trace `response-fallback.responseReceivedMs` and `responseCompletedMs` are renderer durations since that checkout's fetch start, not release-relative offsets. For example, A1's fallback completion is 1871.8 ms while its mapped release-relative body completion is -124.51 ms. The detailed passive trace's `browser.requestTimeSeconds` is a CDP clock-domain value, also not a release-relative offset. These names alone are insufficient to choose a subtraction anchor.

Original grouped reporting displays the latest sent child per worker in some sections. For instance B's headline -0.619 s is B5, not B4. All seven child browser request events span -1778.56 to -27.46 ms. A worker-level row cannot be reused for all siblings. The newer source reporting improvements joined by child identity were not proof that every installed historical view used that code.

## 8. Response validation: what was wrong and what replay proves

Each saved morning response reports `success=true`, HTTP 200, three bookings, three sessions, pending booking/payment states, a pending transaction and total PHP 2,100. The intended hourly intervals are 19–20, 20–21 and 21–22, each PHP 700. Original child journals record `CHECKOUT_SESSION_INVALID`, and the caller returns `SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED`.

The older installed validator compares response times against second-formatted expectations. Both session fields and booking fields may use minute form in Onda's response. A synthetic illustration of the compatibility issue, with identifiers intentionally omitted:

```json
{
  "session": {"startTime": "19:00", "endTime": "20:00"},
  "booking": {"start_time": "19:00", "end_time": "20:00"},
  "oldComparisonExpected": "19:00:00"
}
```

The repair accepts only equivalent canonical wire times `HH:mm` and `HH:mm:ss`. It does not trim whitespace, accept nonzero seconds, normalize malformed values, roll invalid hours, weaken grouping or amount/identity checks, or change request wire boundaries. Existing internal midnight `24:00` to wire `00:00` conversion remains scoped to the request builder's boundary logic.

The installed validator hotfix occurred at 08:11:07.751 Manila. Source, compiled JS and map were replaced with backups/hashes recorded. Required installed `time-range.js` and `court-registry.js` dependencies matched the tested distribution byte-for-byte. The canonical panel was closed through normal shutdown and reopened; the safety lock remained active.

Historical replay at 08:11:18.016 Manila evaluated captures at their historical valid times, not the current time after expiry:

- All seven unchanged saved responses pass the repaired actual installed validator.
- Four mutations per capture—wrong amount, wrong court, nonzero seconds and expired hold—were rejected: 28 negative checks, plus malformed-time cases.
- Original captures and journals were not changed. Replay sent no request.
- All 909 original protected lifecycle/evidence files remained byte-identical through repair and restart; saved configuration and private-state digests matched.

This establishes a local compatibility defect and a compatible repair. It does not create or restore a reservation, prove Onda committed the response, extend expiry, validate payment, or authorize rewriting any UNKNOWN record as verified.

## 9. Recovery contradiction: HTTP 200 followed by official 404

At approximately 08:03:30 Manila, saved-record recovery for the latest worker records failed with `OFFICIAL_CHECKOUT_ACCESS_FAILED`. At 08:03:49.883, read-only provider-status checks covering all seven saved groups returned HTTP 404 with `success=false`, `error="Booking not found"`, `canResume=null`. The official booking-status lookup at 08:04:12.827 also failed for A/B/C.

Saved response expiry times ranged from 08:09:59.845 to 08:10:01.528 Manila. The 08:03 lookups were therefore earlier than the advertised expiry. Ordinary passage of the advertised ten-minute window does not explain those recorded 404s. This is an observation about captured responses and lookup times, not proof that a backend hold existed throughout that interval.

The owner additionally reports manually checking Onda at release time and seeing no created bookings. Record this as an owner observation, with no retained provider account audit proving exhaustive absence. The bot's public observer was blind to availability, so it cannot independently validate that account of the live calendar.

Possible explanations requiring evidence include a response not durably committed, early cleanup/rollback, lookup/access scoping, inconsistent backend reads, or a mismatch between apparent success semantics and the actual checkout lifecycle. None is established by the seven 404s. There is no authenticated provider database trace, provider-side request-receive timestamp, authoritative transaction history, or documented commit audit in this package.

No recovery operation in this investigation submitted a new public checkout. Access grants/official lookup requests were read-only recovery steps for existing IDs. No payment was attempted. All original UNKNOWN records remain duplicate-blocking and must be reconciled through authoritative provider/account evidence rather than a blind retry.

## 10. Availability observer failure and reporting trap

The freeze audit at about 07:58 recorded `AVAILABILITY_SITE_HELPER_UNAVAILABLE`. The three targets were recorded as `PHASE3_EVIDENCE_UNKNOWN`; frozen authorization retained the plan's venue-schedule price evidence. This is not a fresh availability confirmation.

The original watch contains:

| Record class | Count | Meaning |
|---|---:|---|
| Availability not launched: helper unavailable | 1 | Genuine page-local fingerprint helper resolution failed before network. |
| Availability not launched: manual recheck required | 194 | Existing refusal policy blocked later attempts locally. |
| Answered availability reads | 0 | No grid evidence exists to establish release/open/taken/reopen transitions. |
| Supplemental public-booking reads answered | 65 | Separate endpoint evidence; not an availability grid or exhaustive account reconciliation. |

The original derived report labels a legacy `reads.launched=195` while also reporting 195 not launched. The raw record types/refusal reasons control the network interpretation: those are scheduled/local attempts, **not 195 failed HTTP requests**. Zero observed changes or “date never seen” in that report reflects missing evidence, not proof the date failed to publish or all slots remained open.

The source availability-helper alias repair addresses the local reader failure. No policy relaxation, alternate cookie channel, authorization bypass or automatic booking retry was introduced. Whether a release should proceed when target availability evidence is UNKNOWN is a separate policy review; this report records the behavior rather than silently changing it during an incident repair.

## 11. Later live experiments, kept separate from the morning incident

### 11.1 Available Now Normal Extended test, approximately 12:04 Manila

The owner authorized one physical Mango court, November 3 08:00–12:00, maximum PHP 2,400, unpaid only. Fresh source availability showed Court 5 open at PHP 600/hour. The actual installed **Normal Extended** engine split four hours into exactly two checkouts: A 08:00–11:00 for PHP 1,800; B 11:00–12:00 for PHP 600.

Both responses passed repaired installed validation and original journal identity checks. Official access succeeded for both. Browser B completed automated handoff. A returned `OFFICIAL_CHECKOUT_STATE_MISMATCH` because the page showed three hourly rows while the checker required an aggregate 08:00–11:00 string. Later read-only exact hourly review passed for both, without another submission. Both holds expired at 12:14:44.607 Manila. No payment occurred.

This was not a Shotgun test. It demonstrated response and recovery behavior on new morning intervals after the validator repair, not the safety or correctness of the eight-shot release.

### 11.2 Exact hourly QR-summary repair

`qr-order-summary.ts` now compares an exact multiset of registered court/time rows, supporting either the complete per-hour representation or exact per-court aggregate representation. Missing hours, duplicate rows, extra rows, wrong court/date/amount and mismatched identities fail. Existing Pending/QRPH requirements remain. A legacy single-line aggregate representation remains supported.

That checker received a targeted installed source/JS/map patch at 12:19:16.664 Manila, with original backups and hashes. No dispatcher or release guard was patched. Supporting tests cover positive hourly layouts and negative missing/duplicate/extra/wrong layouts.

### 11.3 First actual-engine rehearsal: Court 6, browser B, 08:00–11:00

The separately approved bounded rehearsal imported the canonical installed freezer, armer, strict dispatcher, transport and validator. One attempt, PHP 1,800 maximum, unpaid. Its initial implementation chose a rehearsal anchor roughly 30 seconds ahead with 25 seconds of preparation time.

Security preparation began approximately 24.97 seconds before that anchor but had not completed when the strict dispatcher settled the attempt. Result: `NOT_DISPATCHED / SHOTGUN_TRIGGER_MISSED`; target journal locally rejected, zero checkout function entries, zero pre-POSTs, zero POSTs, zero holds, no payment. The lock was released by the existing proven-unsent path. That execution claim remains consumed.

This establishes a readiness failure in the first rehearsal window. It does not measure checkout latency because checkout was never called, and it does not show that morning production security was unready. The first rehearsal also did not reproduce production's measured lead, full observer or process-priority topology.

### 11.4 Genuine security-only diagnosis and rehearsal readiness repair

Security-only checks blocked booking routes and never invoked an armer/permit/dispatcher. Browser B genuine acquisition passed in one baseline at 2,168 ms and another at 2,569 ms. A later check failed after 60,067 ms with `ONDA_SECURITY_VERIFICATION_FAILED`, `failedHelper=challenge`, `challengeFrame=none`. The provider/SDK reason was not established.

The repaired rehearsal reloads a clean venue page, surfaces the browser, waits for genuine readiness before freezing/arming, then rechecks availability/rates and the trusted clock. Prepared context must remain valid and at most 15 seconds old. Its prewarm callback reuses that context and refuses stale context instead of beginning a second acquisition against the deadline. Only a rehearsal may select its explicitly labelled anchor after readiness; production's fixed 08:00 instant is unchanged.

A repaired security-only check completed in 3,214 ms overall: 2,141 ms acquisition and zero-duration prepared-context reuse. These observations reduce an avoidable rehearsal failure mode; they do not solve or guarantee the external challenge service.

### 11.5 Second actual-engine rehearsal: Court 7, browser B, 08:00–11:00

The owner authorized a new unused open three-hour November 3 slot, any available browser, maximum PHP 1,800, unpaid hold and payment QR only. Fresh read-only preflight selected Mango Court 7 08:00–11:00, browser B, with valid dedicated profile/customer binding, a clean browser and no prior target journal.

Genuine security acquired in 3,274 ms before choosing the new anchor. The clock was GOOD with 21 ms uncertainty. One production strict attempt was frozen/armed and returned HTTP 200. Response validation passed: three hourly bookings, one session, PHP 1,800. The target journal became verified; hold expiry was 15:40:07.160 Manila.

The original automated result was `HOLD_VERIFIED_QR_ATTENTION / PRECISION_DISPATCH_FAILED`. Initial handoff and automated fresh-tab flags were false. The correct official page already showed the order and a QR image; installed recovery waited for `canvas` and timed out. The later source correction accepts `canvas, img[alt="Payment QR code"]`. Using that corrected source helper, **the same saved hold** reopened in a new browser tab; exact summary validation passed and the QR image was visible, complete, and had nonzero natural width. Original journal bytes remained unchanged. No second checkout or payment occurred.

The original failure result was preserved, with the later successful read-only recovery in a separate file. One must not rewrite the original flags to imply the installed handoff passed unaided.

For this rehearsal, Node pre-POST was anchor +0.75 ms, while the HTTP-initiated observer was +138.68 ms. This does not prove an on-wire start within 50 ms. It was one attempt through the real engine, not a full multi-attempt scheduled release or a provider contention test. All 921 pre-existing lifecycle files remained unchanged; new files were only this attempt's journal/recovery/claim and its hold lock. The six pinned installed engine hashes remained unchanged.

## 12. Repair inventory and installed/source distinction

| Repair | Main source locations | Evidence / tests | Installed during November 1 work? |
|---|---|---|---|
| Current genuine helper aliases | `src/api-booking/calendar-free-security-context-browser.js`, `browser-availability-fetch.js` | Genuine helper contracts and live security-only checks | Security helper: yes, recorded patch. Availability asset: no full install. |
| Strict equivalent response times | `src/api-booking/public-checkout.ts`, `time-range.ts` | Seven historical captures pass; 28 installed mutation negatives; strict format tests | Validator source/JS/map: yes, owner-approved targeted exception. |
| Exact hourly QR summary | `src/api-booking/qr-order-summary.ts` | Positive hourly/aggregate, missing/duplicate/extra/wrong row coverage | Yes, recorded three-file patch. |
| Bounded one-attempt rehearsal | `src/shotgun-live-rehearsal.ts`, `scripts/rehearse-shotgun-live.ts` | Strict schema, one attempt, cap, exact scope, actual engine injection, write-once authorization, production journals | Source CLI invoking installed engine; not a replacement scheduled engine. |
| Security readiness before rehearsal anchor | `src/shotgun-rehearsal-readiness.ts`, rehearsal/security-check scripts | Pending/failed/missing/invalid/stale context and between-freeze/arm freshness tests | Source rehearsal wrapper only; fixed scheduled deadline unchanged. |
| QR image renderer compatibility | `checkout-recovery.ts` and both `desktop-runner.ts` handoff paths | Recovery canvas/image/missing-QR cases; 25 recovery tests; same live hold fresh-tab proof | Source only at publication. |
| Deterministic Slot Watch integrity fixture | `tests/v2-integrity.test.ts` | Existing VirtualClock drives all three reads and refusal policy | Tests only; no runtime policy change. |
| Public incident export | `scripts/forensics/export-nov1-evidence.mjs` and this directory | Eight-child accounting checked, allowlist and source hashes | Read-only offline tooling; no application installation. |

The publication additionally includes all earlier bounded-rehearsal branch commits. The normal `SHOTGUN_IMMEDIATE_BURST_BLOCKED` guard remains intact; a separate bounded CLI does not open an unrestricted UI immediate-burst path. Authorization schemas remain one attempt, one court, 1–3 hours, maximum PHP 1,800 and `payment=false`. No saved release plan, timing offset, concurrency, shot budget, request identity, ambiguity stop, duplicate suppression, lock or journal state was weakened.

## 13. Competing explanations and evidence needed

| Candidate explanation | Supporting evidence | What it cannot explain / missing proof | Present assessment |
|---|---|---|---|
| Installed time-format mismatch | Exact old comparison, saved minute-form response, seven replay positives and mutation negatives | Does not determine provider persistence or explain official 404 | Confirmed local defect; repaired. |
| Pre-release security helper rename | Near-zero helper-unavailable failures and observed current module aliases | All eight actual release preparations completed after patch | Confirmed earlier defect, not established morning checkout cause. |
| Availability fingerprint helper rename | Freeze failure and 195 local refusals, zero availability grid answers | Does not alone explain HTTP 200 pending shapes/404 | Confirmed observation blind spot. |
| Provider returned pre-release/ephemeral success without durable reservation | Some local events and advertised expiry precede release; subsequent official 404 | No provider commit/rollback audit or documented success semantics | Hypothesis; request provider-side evidence. |
| Official lookup token/identity/access mismatch | Official access/lookup failure after apparently successful capture | Later source recovery works for other intervals; no authoritative rejection reason beyond 404 | Plausible class of explanation, unproven. |
| Backend inconsistency/cleanup/replica issue | Success/404 contradiction within advertised lifetime | No server trace establishing which backend handled each request | Unproven. |
| Browser transport/network delay | 218–321 ms fetch-to-request-event gaps; divergent ResourceTiming surface | Does not itself establish wrong target, noncommit or provider receipt order | Measured local gap; root cause and effect unresolved. |
| Too-late/no security readiness at the morning release | Later first rehearsal missed its readiness window | Contradicted as a blanket explanation by eight morning ready preparations | Do not conflate separate experiments. |
| QR layout/rendering | Later correct official pages fail aggregate/canvas checks | Morning captures failed before QR and lookup returned 404 | Confirmed later handoff defects; separate repairs. |

The important causal separation is response recognition, reservation persistence/access, observation coverage, and later QR presentation. A single “Shotgun fixed” label hides those distinct questions.

## 14. Independent reviewer instructions

1. Start with `evidence.json.authorization`, `parents`, and `children`. Join by logical target and exact child identity/trigger; use diagnostic attempt ID only where its binding is present. Verify eight children, seven observed sent and one suppressed. Never count parents as additional submissions.
2. Reproduce the local validator failure against the old installed module backup and the exact private response at its capture time. Then test the repaired validator with the same immutable bytes and independent wrong identity/amount/grouping/expiry/time negatives. A compatible replay must not mutate runtime journals.
3. Compare the seven read-only provider lookups with their captured expiry windows. Request Onda's authenticated account/transaction/booking audit and any provider-side request IDs through an authorized channel. Preserve the 404 distinction; do not infer cancellation, expiry, payment or ownership from it.
4. Inspect observer raw record types, not just the old generated `launched` counter. Without an answered grid, do not invent opening/closing times or use zero transitions as positive state evidence.
5. Keep clock domains and semantic boundaries explicit. Inspect renderer calibration bounds and ResourceTiming entries separately. Browser event timing does not establish origin arrival, provider ordering or commit latency. Investigate the measured gap with offline/browser-only tooling before proposing any live timing change.
6. Review all three QR handoff locations and the exact summary checker. Wrong/extra/missing rows, wrong amount, denied access, missing QR and expiry during navigation must remain failures; visible QR branding alone is insufficient.
7. Treat the later successful Court 7 recovery as evidence for that particular new hold, with the source selector fix clearly identified. It cannot retroactively verify original UNKNOWN targets or qualify all release workers/children.
8. Do not clear UNKNOWN, reuse a consumed authorization, call checkout from a replay script, request payment, rotate private state, or delete a lock as part of forensic analysis. Obtain new explicit scope for any additional provider mutation.

## 15. Validation, publication and next-release qualification

Before this publication, 165 focused tests passed across seven suites covering strict armed dispatch, genuine helper contracts, rehearsal readiness, saved recovery, live Shotgun gating, timing compatibility and release readiness. Typecheck, clean source build and a 511-file source/distribution consistency check passed. The later deterministic observer fixture and recovery suite passed 36 tests combined. Final publication validation/CI identities are recorded in [VALIDATION.md](VALIDATION.md).

An earlier PR #21 merge-ref CI run failed one wall-clock-dependent fixture (`v2-integrity.test.ts`, expected two locally refused reads, observed one under scheduler load); the branch run passed. The fixture started the release only 10 ms ahead with reads 15 ms apart. Replacing only that fixture's clock/sleep with the existing VirtualClock preserves the exact count assertions, production late-launch threshold, refusal policy and all dispatch deadlines. This is not evidence that the production booking engine was changed to accommodate CI.

Source main, built source, installed assets, live helper readiness, exact-plan local timing, provider acceptance, validated hold, QR handoff, payment and final booking are separate qualifications. The full app updater was observed refusing replacement because processes, the recorded hold lifecycle and recent UNKNOWN records remained blockers. No updater guard was bypassed in this publication. That snapshot is time-specific; current lifecycle must be re-inspected before any maintenance.

For the next authorized release, qualification still requires a safely reconciled installation, byte-verified installed fixes, exact saved topology/plan, all assigned browser identities/tabs, genuine applicable security checks, fresh matching timing calibration, complete preparation forecast and trusted clock. The real fixed release cannot move itself while waiting for security. Failed readiness must remain visible and prevent unsafe submission. Even all local checks passing cannot guarantee Onda availability or acceptance.

The original morning noncreation/404 contradiction remains open for provider/account-level investigation. No claim in this report converts it into a solved incident merely because a later single-attempt rehearsal succeeded.
