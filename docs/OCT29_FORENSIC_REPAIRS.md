# October 29 checkout and forensic repairs

The installed validator compared returned session and booking times literally to `HH:mm:ss`. The seven saved October 29 responses used `HH:mm` at both layers. This prevented recognition of pending checkout evidence and caused conservative UNKNOWN handling. HTTP 200 alone never established a verified hold or payment.

## Changes

| Files | Result |
|---|---|
| `src/api-booking/public-checkout.ts` | Strict canonical checkout wire times accept equivalent `HH:mm` and `HH:mm:ss` at both response layers. No trimming, rollover, malformed values or non-equivalent seconds. The request builder and `ondaCheckoutBoundary` remain unchanged: internal `24:00` is written as `00:00`. |
| `tests/api-booking/checkout-time-formats.test.ts` | Synthetic minute/second/mixed fixtures cover 1–3 hours, one/two courts, continuous/hourly sessions and midnight. Negative identity, grouping, amount, expiry and status checks remain mandatory. No private response is checked in. |
| `src/api-booking/phase3-wave1-reporting.ts`, `desktop-runner.ts`, `src/ui-events.ts` | Reconcile every frozen result once, including children with no dispatch-start event. Missing/duplicate identities fail visibly. Final counts separate sent, settled, pending, unsent, unknown, rejected and verified. Authorized/prepared counts describe Wave 1; attempt totals also include recorded adaptive attempts. Provider stops also emit final accounting. Optional event fields retain historical compatibility. |
| `src/api-booking/armed-dispatch.ts`, its tests | Conservative race-wide ambiguity/throttle/payment stops remain. Verified holds use the existing distinct-court/wing quota policy. Valid minute-format responses reach the existing hold/QR callback after the critical window. Tests cover invalid success, possible-dispatch timeout, 429, payment, rejection and pre-transport suppression. |
| `src/api-booking/critical-path.ts`, `desktop-runner.ts` | New critical-path metadata carries the diagnostic attempt ID alongside the existing child key, parent, worker and fan-out position. |
| `src/release-lab-analysis.ts` | Expand frozen fan-out offsets into child rows; join only unambiguous child identity/metadata. Keep each child's scheduler, Node, renderer, fetch, browser, headers, completion, bookkeeping, HTTP and outcome measurements separate. Preserve calibration bounds, wall mapping and ResourceTiming in JSON; unavailable measurements stay null. Legacy single-child runs remain supported. Group totals derive from children. Broad movements in both directions are reported with unknown cause. |
| `src/release-forensics.ts` | Include planned/unsent children in the Phase 3 inventory. Grouped latest-sent views bind state/response/trace/timing to that same child. Separate calibrated response completion from deferred bookkeeping; remove the mixed-clock subtraction fallback. Report observed request concurrency rather than the configured cap. |
| `src/slot-opening-cycles.ts`, `src/slot-watch.ts` | Track every sampled cycle in request order. Each prediction takes the first trustworthy opening of its own closing cycle; a transition can satisfy only one prediction. Distinct cells, all reopening transitions, subsequent openings and closing transitions remain separate. Repeated closures can schedule their own bounded observer windows within the existing watch/cap. |
| Related accounting, movement, cycle and forensic tests | Eight-child reconstruction, missing/ambiguous measurements, out-of-order sibling responses, legacy runs, repeated cycles, overlapping windows, missing/cache-uncertain observations and rendered report completeness. |
| `tests/ui-strategy-v2.test.ts` | Two synthetic calibration fixtures now remain inside the existing freshness window as time advances; stale September fixtures failed on October 30. Production calibration limits and timing assertions are unchanged. |

The existing validator's exact request totals, pending transaction reference, per-hour rates, identities, membership, uniqueness and future-expiry checks remain intact. Existing price/authorization policy is unchanged. This repair does not broaden supported response grouping or turn successful HTTP status into verification.

## Historical offline validation

Private evidence and derived outputs remain outside the source repository under `DiagnosticsLocal/oct29-source-repair` in the installation root. The separate `validate-history.mjs` reads the original snapshots, checks their manifest and installed module provenance, invokes pure validation functions, and writes only new derived files in that separate folder. The original `replay.mjs` and `offline-replay.json` are preserved.

- All 78 evidence snapshot hashes and both installed validator/request-builder hashes matched before replay.
- Installed validator: seven original captures fail `CHECKOUT_SESSION_INVALID`.
- Updated source: seven untouched original captures pass at the historical valid evaluation time; each has three bookings, three sessions and PHP 2,100.
- Frozen reconstruction: eight authorized, seven observed sent, seven UNKNOWN, one unsent, three logical workers. Court 7 offsets: -2000/-1143/-286; Court 6: -1714/-857/0; Court 5: -1429/-571 ms.
- Observer: 77 distinct reopened cells, 86 unavailable-to-open transitions, nine subsequent openings and nine open-to-unavailable transitions. All nine later predicted openings match their own cycle inside their model windows.
- The 77-cell broad opening is reported as an observed sampled movement. No actor, simultaneous backend transaction or provider-confirmed expiry is inferred.

No strategy offsets, dispatch concurrency or shot volume were increased. Browser request events, ResourceTiming, passive DevTools intervals and undocumented edge values do not establish provider arrival. The transport gap's cause remains unresolved.

## Lifecycle and recovery

Historical replay does not reclassify journals. The three parent and seven sent child records remain UNKNOWN; the suppressed child's local rejected state remains evidence of non-dispatch. No authoritative account/payment reconciliation is available offline.

Read-only installation preflight on October 30 refused eligibility: the retained `FINAL_ACTION_DISPATCHING` lock plus ten recent UNKNOWN records are active blockers. The recorded owner PID was absent at inspection. Neither PID absence nor passed expiry authorizes manual removal or resubmission.

Existing `ui/locks.ts`, `ui/practice-reset.ts`, `checkout-recovery.ts` and the canonical updater already provide guarded review, identity checks and fail-closed recovery. No duplicate recovery system or bypass was added. No recovery operation, live provider request, checkout, hold, retry, QR navigation, payment, packaging, restart or installation was performed.

The maintained report generators render tables directly; no maintained unresolved-template substitution defect was found. Regression coverage checks rendered child rows, reconciled totals and absence of unresolved placeholders. Original historical reports are preserved; regenerated historical reports were directed only to the separate private output folder.

## Validation and integration

Exact commands, final test results and integration identity are recorded in the implementation handoff beside the private validation outputs. Source validation and GitHub integration are separate from installation, authoritative transaction reconciliation and readiness for a new live release.
