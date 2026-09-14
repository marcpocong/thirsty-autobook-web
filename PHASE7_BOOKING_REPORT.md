# Phase 7: simple UX, Standard and Extended bookings

Initial HEAD: `15cf918` (`Add one-click dual browser preparation`), `main`, clean. This matched the supplied checkpoint. The implementation continues the existing project; no live booking was authorized or executed.

## Product behavior

| | Standard | Extended |
|---|---|---|
| Duration | 1–3 consecutive hours | 4–6 consecutive hours |
| Court count | 1 or 2 | 1 or 2 |
| Dedicated browsers | A only | A and B |
| Normal Onda checkouts | 1 | 2 |
| Successful QR holds | 1 | 2 |
| Automated payment | None | None |

Standard two courts now uses one combined selection and one checkout. Its normal preparation/runtime does not attach port 9223 or create a worker-B record. Recovering a retained Extended/legacy dual run necessarily inspects both old browsers before returning to Standard.

`BOOKING_TYPE` defaults to `standard` for old configuration. Court count remains independently selectable. Durations above six hours display “Extended two-browser booking currently supports up to 6 consecutive hours.” No truncation or crossing midnight is allowed; 24:00 is a valid endpoint.

## Plans and court assignment

`BookingPlan`, `BookingChunk`, `PlanRequest` and `CheckoutSelection` separate planning from browser orchestration and renderer state.

| Requested hours | Split order |
|---|---|
| 4 | 3+1, 2+2, 1+3 |
| 5 | 3+2, 2+3 |
| 6 | 3+3 |

Each split covers the complete same-date block without gaps or overlap. Each selected court covers every hour of its chunk. The planner tries the next split when an earlier split lacks a complete solution. Availability resolution uses strict grids without experimental booking actions. A fallback start moves both chunks together.

The first chunk follows configured court priority. The second chunk prefers the same courts, then maximum overlap, then priority. This follows the prompt's explicit example: A availability 7,6,4 and B availability 7,5,4 produces A 7+6 / B 7+5, rather than sacrificing A's priority to choose 7+4 in both chunks. Court continuity is preferred, never required. Hour-by-hour switching within one checkout is not supported.

For **20:00–24:00, two courts**, the preferred plan is A 20:00–23:00 and B 23:00–24:00. A may use 7+6 and B 7+5. Alternatives are 20:00–22:00 / 22:00–24:00, then 20:00–21:00 / 21:00–24:00. Every hour still requires two distinct courts.

## Selection, price and checkout

The bundle selector checks one complete initial grid per browser, guards every click, verifies every dispatched cell and checks exact combined selected count, summary count, positive PHP amount and actionable Proceed. Each checkout maximum is `COURT_COUNT × MAX_PRICE`, independently enforced at selection, pre-Proceed, Review and Payment Summary. A larger theoretical grand total cannot excuse an over-limit checkout.

Extended uses the existing dedicated identities, isolation checks, shared release barrier, owned-selection cleanup and normal checkout modules. Both complete selections must verify before either checkout proceeds. A pre-Proceed conflict cleans only positively identified owned selections in both browsers, verifies clean state, reads fresh grids and replans within `MAX_SELECTION_ATTEMPTS`. Unknown state, foreign selection, price errors and aborts stop without cleanup. After checkout begins there is no automatic rollback or cancellation. Partial success preserves the successful hold and reports both outcomes for manual inspection.

The checkout adapter validates one or two independently identifiable reservation cards using the established reservation-date test ID and court/time text. It validates the global reservation slot count, unique courts, common date and complete time range. Card order may differ from selection order. It reads the actual Payment Summary total and requires exactly one final action. The existing passive QR observer remains unchanged and checks Checkout, active countdown, Pending, matching totals, QRPH and QR presence without reading QR payloads or interacting with payment controls.

**Evidence boundary:** a live multi-court Review page was not available for inspection in this session. The card generalization is tested against synthetic two-card markup built from the existing observed single-card fixture. If live Onda groups cards differently, the adapter stops before final action rather than inferring unproven identities. Successful fixture tests do not establish the live multi-court DOM or simultaneous same-customer holds. Extended live operation remains unverified until the user explicitly runs a test.

## Test Now and Release Booking

The main screen presents status, Test Now / Release Booking, Standard / Extended, court count, booking fields, Reset & Prepare, Terms, Run Test to QR / Arm Release, and Emergency Stop. The old inspection, lock review, dry/observe, selection-only practice and legacy dual tools are collapsed under Advanced / Diagnostics.

Test Now is immediate and exact-date. It does not require saving production court count or historical dual evidence. Test fields do not overwrite saved release settings. The same process owns the lock while it resolves the plan and waits for the native confirmation over IPC. The confirmation shows actual chunk courts, times, price limits and the number of temporary holds. It authorizes bounded pre-Proceed replanning within the requested block; optional exact courts are never substituted. Cancel creates no selections or holds. Parent loss, Stop and a confirmation timeout stop the worker.

Advanced optional exact court fields accept one or two court numbers for each required checkout. Terms authorization resets on editing, reset, workflow changes, cancellation and completion. No payment acceptance is persistent.

Release uses the saved plan fingerprint and existing preflight, pre-open, release trigger, strict target-grid and bounded reload logic. The proven Standard single-court release route retains optional nonblocking hybrid discovery. Standard two-court and Extended use strict UI discovery. Extended workers share the same release epoch and target date; fallback starts apply to the whole plan. Normal release has no historical dual-evidence requirement.

## Reset and durable lifecycle

Sanitized lifecycle records are written to a temporary file, synced and atomically renamed. Every checkout records:

`SELECTION → SELECTION_VERIFIED → REVIEW → PAYMENT_SUMMARY → FINAL_ACTION_DISPATCHING → HOLD_VERIFIED`

The final-dispatch record must succeed **before** the final action. A failure leaves the action undispatched; a recorded dispatch followed by an uncertain result always blocks reset. Extended tracks A and B independently. The old dual runtime also preserves durable stages through its worker-state updates. Legacy diagnostic clear/reset paths cannot bypass the new final-action protection.

Reset & Prepare starts/reuses only the required dedicated profiles, checks owner PIDs and exact record identity, inspects all relevant browsers before normalizing any, returns to today's clean visible All Courts schedule, and only then removes the verified stale records. It protects against replacement during inspection/normalization. A separate preparation guard prevents two preparation operations; a dead interrupted guard is recoverable.

Dead pre-final Standard selections, Review and Payment Summary can be recovered. Safe Extended and legacy dual selection records can be recovered together. Active automation, missing/inconsistent worker identities, active holds, and uncertain final dispatch block recovery. Legacy `checkout`/`unknown` records without durable pre-final proof are conservatively refused. An old clean or selected schedule with no ambiguous dispatch can recover.

A recorded verified hold may recover when the browser is conclusively back on a clean schedule or the reserved-slot countdown explicitly reads zero. A dashboard timer alone is insufficient. `FINAL_ACTION_DISPATCHING` remains blocked even if a countdown reads zero because no conclusive successful handoff was recorded. Unsupported markup, wrong venue, filter/visibility failures or security challenges remain manual-review stops; READY is never inferred from CDP reachability alone.

## Validation and delivery

- Typecheck: passed.
- Full serial suite: 456 tests passed across 25 files.
- Focused tests include strategy ranges, midnight, split order/fallback, continuity and switching, exact targets, one/two-court selection, selection barrier, owned cleanup/replan, foreign selection, price, multi-court Review, the full single-checkout two-court QR flow, durable final dispatch, reset/process/record races, expiry, and the actual renderer.
- UI build: passed. Actual renderer screenshots were visually inspected; diagnostics are collapsed and primary Standard controls fit the 1010×800 layout.
- EXE build: attempted, blocked by Windows CS0016 because the running `Thirsty Bot.exe` holds the output file open. No application was killed. Close the EXE, then run `npm run exe:build`. The UI assets were built successfully before the launcher failure.
- Live structure inspection: read-only attempt only; both dedicated browser identities were unavailable. No browser preparation or booking was run live in this session.
- Real holds created: **NO**. Release armed: **NO**. Payment performed: **NONE**.

No player values, local configuration, Chrome profile data, cookies, tokens, raw diagnostics, locks, QR content or payment URLs are included in the commit.
