# Phase 7.1: player routing and Reset & Prepare

Initial HEAD: `7460ff216b5ad05aed82c5531f206f849176f8d3`, main, clean. This matches the supplied checkpoint. Phase 7 planning, selection, checkout lifecycle, release scheduling, and payment boundary remain in place.

## Player routing and privacy

| Workflow | Browser A | Browser B |
|---|---|---|
| Standard, one or two courts | Primary player | Not attached |
| Extended, one or two courts per chunk | Primary player | Extended player |

The existing `PLAYER_FULL_NAME`, `PLAYER_PHONE`, and `PLAYER_EMAIL` fields keep their meaning. Optional base configuration fields `PLAYER_B_FULL_NAME`, `PLAYER_B_PHONE`, and `PLAYER_B_EMAIL` are validated at Extended preparation/runtime boundaries. Missing, partial, invalid, or duplicated contact information produces `EXTENDED_PLAYER_INFO_MISSING`; there is no fallback to A. The distinct-profile rule is a product requirement, not an independently established Onda requirement. Shared names alone are not rejected.

The checkout runtime chooses the player by browser identity before attaching either browser. This applies to Test Now and Release. Renderer state contains only configuration booleans. Player fields are excluded from plan fingerprints, confirmations, locks, structured events, telemetry, and reports. Runtime tests use synthetic identities and verify these exclusions.

Local configuration status at verification: primary **configured**, Player B **missing or invalid**. The user's `.env.local` was not changed. Extended operation requires completing the three local B fields. The example environment contains placeholders only.

## Live Onda evidence

**User-supplied live UI evidence:** the user manually reproduced two courts in one Review Booking, with two distinct court groups, six hourly reservations for two courts over three hours, `Your Reservations (6)`, one combined Payment Summary quantity and total, one Terms checkbox, and one final confirmation action. The visible facility message states: “This facility allows up to 3 hours per court in one checkout.”

**Automation evidence:** no live Review or Payment Summary DOM was independently inspected in this session. Existing adapter selectors and fixtures remain the foundation. Synthetic tests model the supplied UI evidence; they do not establish new live selectors or prove live Extended holds. No live preparation or booking was run.

## Review and Payment Summary

Review retains the strict venue/date/count/court/time checks: one or two unique expected court groups, a common complete consecutive block, exact hourly entries, and no third group. Tests cover one court over one/three hours and two courts over one/two/three hours, including six reservations.

Payment Summary now requires exactly one parseable rental quantity label within the existing summary panel's span structure. Quantity must equal courts times chunk duration. Missing, malformed, zero-price, duplicate rental labels, or mismatched quantities fail closed. The hourly price is parsed, finite, and positive; no price is hardcoded in production logic. Total amount remains independently checked against the verified selected total and per-checkout maximum, including immediately before final dispatch. Adapter tests prove quantity errors stop before Terms/final action. Unsupported live structure may require read-only investigation before operation can continue.

Standard two-court regression still uses one browser, one combined checkout, one final action, and one verified synthetic QR hold. The existing full-flow test asserts the durable lifecycle stages and excludes payment controls.

## Reset & Prepare

- Test Now carries and validates strategy, date, start, duration, court count, maximum, priority, and optional exact courts. It does not save Test Now values into release settings.
- After inspecting retained state, preparation navigates the normal calendar to the exact requested date in A for Standard or A+B for Extended. It validates the strict dated grid, venue, All Courts, visibility, zero selected cells, and absence of a hold. The optional read-only exact-court availability precheck was not added; target availability is resolved by Test Now before its confirmation.
- Release validates/saves current settings before preparation and verifies today's clean schedule. Both profiles are required before Extended readiness. Historical dual evidence is not a readiness prerequisite.
- Reset stays accessible during a UI run. A native confirmation offers to stop that run and prepare. It invokes the existing owned-process abort path and waits for confirmed completion before starting normal state inspection. `STOP_NOT_CONFIRMED` prevents reset. External processes are never killed by this recovery path.
- Stopping a process does not establish clean browser state. Active holds, uncertain `FINAL_ACTION_DISPATCHING`, legacy ambiguity, identity inconsistencies, and replacement-lock races still block cleanup. Verified expired holds and known dead pre-final state retain their existing recovery behavior. Legacy Phase 6 recovery still inspects both retained browsers.

Offline calendar preparation test: reservation slot clicks **0**; Proceed clicks **0**; Terms clicks **0**; final actions **0**. It also rejects an unavailable date. Reset orchestration tests verify exact-date propagation to both required browsers and retained state on date failure. These are offline results, not live preparation claims.

## Routing audit

Normal Start/Inspect/Prepare and the readiness CLI route by strategy. Standard two courts uses A; Extended one court uses A+B. The Standard single-court release fast path remains unchanged. The `src/index.ts` court-count check chooses the combined-checkout implementation, not a second browser; `runBooking` decides browser count by strategy.

Old Phase 6 practice controls are explicitly labeled **Legacy / Engineering Diagnostics** and remain isolated under Advanced. Their historical two-court pair constraints are retained only in that diagnostic path. Two-browser read-only inspection no longer rejects Extended one-court configuration. The legacy runtime rejects Extended plans for its old simultaneous-pair booking modes.

Extended split order remains 3+1 / 2+2 / 1+3, 3+2 / 2+3, and 3+3. Court continuity is preferred, with switching allowed only between chunks. Both selections must verify before either checkout proceeds. Partial success and independent checkout maxima are preserved. Full live two-hold flow verified: **NO**.

## Validation and delivery

- Typecheck: passed.
- Final full serial suite: **484 tests passed across 27 files** (`npm test -- --maxWorkers=1`).
- Focused checks: player config/runtime routing and privacy; exact-date preparation; active-run stop confirmation; missing-player renderer status; Payment Summary quantity; single/two-court checkout; reset lifecycle; Extended split/court-switch regression.
- UI build: passed; actual renderer screenshot visually reviewed.
- Windows EXE build: passed; `Thirsty Bot.exe` rebuilt successfully.
- Diff whitespace check: passed.
- Privacy scan: no actual locally configured player values found in changed text files. Local environment/configuration, diagnostics, and profiles remain ignored.

One serial run encountered a transient Windows `EPERM` while atomically renaming a test-owned worker lock. The affected legacy readiness suite passed immediately on rerun. The durable writer was not weakened or changed.

No real hold was created, no release was armed, and no payment was performed. No live browser preparation was executed. Final Git commit and push status are reported in the delivery response; the final commit includes this report and the rebuilt EXE.
