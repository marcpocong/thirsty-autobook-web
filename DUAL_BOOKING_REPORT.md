# Phase 6: optional dual-court booking

Baseline: `c740253` on `main`, clean at the start of implementation.

## Default and configuration

`COURT_COUNT` accepts only 1 or 2 and defaults to 1. Older local JSON remains valid. The Electron setup saves it through `BookingSetupSchema`; booking view, plan confirmation, fingerprint and readiness include the count. Switching counts invalidates the confirmed plan. Local configuration was left at **1** during development.

`MAX_PRICE` still means the maximum **per court / per checkout**. Dual preview shows that maximum and exactly twice it as the informational combined maximum. Each actual Onda selection and checkout summary independently enforces its own maximum.

## Architecture and single-path comparison

The single release CLI dynamically imports the dual runtime only for count 2. Count 1 does not initialize a coordinator, create subordinate state, wait for another worker, attach Browser B, change preference ranking or use IPC.

Two asynchronous Playwright workers live in the coordinator's local Node process. Each has a separate `Safety`, telemetry, page, connection and visible Chrome profile. This avoids extra worker entrypoints or an external service. The common PID is intentional: Stop terminates the Playwright owner for both workers. It does not close either Chrome. Subordinate records explicitly identify the coordinator run and worker A/B; they cannot be used as standalone automation locks.

| Worker | CDP | Profile |
|---|---|---|
| A / legacy single | `127.0.0.1:9222` | `.local/onda-chrome-profile` |
| B | `127.0.0.1:9223` | `.local/onda-chrome-profile-b` |

The PowerShell verifier accepts an explicit port/profile, checks localhost bindings, one owning Chrome process, one exact profile argument, and one matching debugging-port argument. One process cannot satisfy both different profile identities. The default verifier/attachment still targets A. The launchers reuse correct sessions, never terminate conflicting listeners, and leave both windows visible. Dual schedule validation requires one Onda page per browser, exact booking URL/venue, visible clean schedule, All Courts and no selections/hold.

Compared against `c740253`, **selection.ts, booking-checkout.ts, checkout.ts, onda-checkout.ts, payment-handoff.ts and safety.ts are unchanged**. Regression tests assert their normalized source equality against that baseline. Release navigation and hybrid discovery implementations are unchanged. The release wrapper adds only optional dual gates for a shared target, the pre-arm barrier and coordinator timing; the default path bypasses those gates. The existing global single lock implementation is preserved.

## Pairing and phase gates

Configuration order remains authoritative: primary start, then each configured fallback, and court priority within each exact block. A pair contains one date, one consecutive hourly block, and two distinct courts. Both assignments must be OPEN on their own strict worker snapshots. Unknown or wrong-date snapshots stop. Known API prices may veto candidates; optional discovery never reorders configured pair priority. UI remains authoritative, including after release reload cancels the optional request.

Both workers complete preflight and calendar pre-open before the dual arming barrier opens. They share the exact release epoch, target and plan fingerprint. Each retains the proven immediate target observation, no-refresh click when enabled, and immediate bounded reload fallback otherwise. There is no polling, negative lead, extra diagnostic browser, request storm, custom socket or timing spin loop. At most one normal initial optional discovery request is launched per worker; dual replanning uses fresh UI reads without new requests.

The coordinator selects the two assignments concurrently, then waits for **both** exact selection verifications, including date, court, hours, selected count, amount and actionable Proceed. Only then may either worker enter the unchanged UI checkout flow. Each checkout revalidates its own selection before Proceed.

Before Proceed, conflicts trigger cleanup of both positively identified owned selections. Cleanup is refused on unknown/foreign/changed-date/aborted state. A new pair is possible only after both clean grids are proven. Failed assignments are excluded, and `MAX_SELECTION_ATTEMPTS` bounds pair attempts (1–5). Exact practice permits only one pair and no fallback search.

After checkout starts there is no rollback or reservation cancellation. Two verified holds yield `DUAL_HOLD_VERIFIED`; one hold plus a failure yields `DUAL_PARTIAL_SUCCESS`. The successful hold remains untouched, both worker states and the global lock remain, and the UI directs manual inspection of both browsers. Payment is always manual. Same-customer simultaneous holds remain an open live validation question.

## Lock review and Stop

Only the coordinator owns `.local/automation.lock`, recording `mode: dual`, its PID/run and both worker identities. `.local/dual/worker-a.lock` and `worker-b.lock` retain sanitized clean/selection/checkout/hold/unknown state. No player information, raw responses, QR data, cookies or tokens are stored there.

Review Lock probes both browser identities without clicks and shows the coordinator, each worker PID, recorded state, current page, selected count and hold state. Clear requires a dead coordinator, dead workers, no UI-owned worker, two clean schedules, zero selections and no holds/Review/Payment/unknown state. Global and subordinate identities are fingerprinted and rechecked before removal. A missing or inconsistent worker record fails closed. The single-browser Reset Practice action explicitly refuses a dual lock.

Q, Ctrl+C, IPC Stop and Emergency Stop stop both active workers. A worker whose final payment boundary is sealed is never reactivated or cleaned. Already-dispatched clicks cannot be undone. Abrupt termination retains lock state for review.

## Commands and UI

```powershell
npm run chrome          # existing A launcher
npm run chrome:b
npm run chrome:dual
npm run dual:readiness
npm run dual:practice:dry -- --date YYYY-MM-DD
npm run dual:practice:selection -- --date YYYY-MM-DD --court-a 7 --court-b 6 --start 10:00 --duration 1
```

Explicit `dual:*` commands opt into count 2 for that run without editing saved settings. Selection practice uses the configured maximum unless `--maximum-per-court` is supplied. Its successful terminal state is zero selections in both browsers and zero Proceed clicks.

Advanced full practice requires **all** explicit flags and exact targets:

```powershell
npm run dual:practice:full -- --armed --authorize-terms --noncompetitive --date YYYY-MM-DD --court-a 7 --court-b 6 --start 10:00 --duration 1 --maximum-per-court 600
```

**THIS TEST CAN CREATE TWO REAL TEMPORARY RESERVATION HOLDS. PAYMENT WILL NOT BE AUTOMATED.** The command prints this before attachment/selection. This example is documentation, not authorization to execute it.

`npm run dual:race:dry -- --armed` schedules both normal release flows but performs no selection or Proceed. It shares the same global exclusion lock as all other commands. No scheduled release diagnostic was run during implementation.

With count 2 saved, the UI launches/verifies both browsers and exposes Dual Dry Pair, Dual Selection Practice and Dual Full Flow Practice. Exact practice fields are separate from the saved production plan. Noncompetitive slots require explicit acknowledgment. Full practice additionally requires per-run Terms authorization and a native confirmation listing both courts, time, duration and maximum. Editing practice fields resets Terms authorization. Existing single practice controls remain available.

The normal `race`, `race:dry` and `selection:armed` commands dispatch by saved count. Dual production selection requires local readiness + dry + selection-practice evidence. Dual full production additionally requires an explicitly authorized full practice yielding two legitimate holds. Evidence is local, scoped to the relevant saved booking semantics, and never written by unit tests to the real workspace's evidence file. Passing tests alone never marks dual production ready.

## Telemetry

Coordinator events cover preflight, both ready, armed, release, each/both grids, pair/assignments, selection start, each/both verified selections, Proceed release, each/both holds, partial success and failure. Each worker retains existing detailed telemetry. The local dual diagnostic links both worker traces and records release-to-each/both-grid, grid-to-pair, pair-to-each-first-click, release-to-both-selections, both-selections-to-both-Proceed, each-selection-to-hold, release-to-first/second/both-hold. Missing observations remain null. No PII is logged.

## Live validation: September 14, 2026 (Manila)

| Check | Result |
|---|---|
| Two visible dedicated Chrome windows | PASS |
| A identity / B identity | PASS / PASS |
| Dual readiness | PASS; both visible, clean, zero selections, no hold |
| Saved-plan dry on September 14 | `NO_DUAL_PAIR_AVAILABLE`; zero slot/Proceed clicks |
| Failed-dry lock review | PASS; dead owner, both clean; verified safe clear used |
| Saved-plan dry on September 15 | PASS; A Court 6 + B Court 5, 21:00–24:00, `UI_ONLY` |
| Exact read-only practice-target check | PASS; September 14, A Court 7 + B Court 6, 10:00–11:00, `UI_ONLY`; zero slot/Proceed clicks |
| Live dual selection practice | NOT RUN; awaiting the user's choice of non-prime test slots |
| Live dual full-flow practice | NOT RUN — REQUIRES USER AUTHORIZATION |
| Real production release | NOT ARMED |
| Final single live readiness | PASS; count 1, correct A profile, clean schedule, All Courts, zero selections, no hold, global lock clear |

Both browsers were returned to today's clean schedule by the exact read-only check. No live slot selection or checkout occurred in this implementation session. The current status is **single production READY (nothing armed), dual selection NOT READY, dual full flow NOT VERIFIED**. Run the explicitly selected non-prime selection test next; optional full practice remains separately authorized.

## Verification

Typecheck, the full serial suite (396 tests), UI build, EXE build and diff whitespace checks passed. The default parallel run hit the known existing test-owned browser-close timeout; an earlier verifier fixture was updated for the now-explicit debugging port and passes. The actual renderer was tested with dual readiness/price/authorization states and visually inspected. The tracked EXE launcher was rebuilt.

Direct public-checkout calls: **NONE**. Direct is-slot-available calls: **NONE**. Availability-proof handling: **NONE**. Payment automation: **NONE**. Cloudflare/Turnstile/CAPTCHA bypass: **NONE**.
