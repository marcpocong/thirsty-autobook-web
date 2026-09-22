# Current implementation review guide

This document is the entry point for human and AI review of the repository state published on 2026-09-22. `README.md` describes operator use. The other root reports are retained historical checkpoints and should not override current source, tests, or this guide when their limits differ.

## What changed in this snapshot

- The desktop UI is divided into **Next Release**, **Edit Plan**, **Tests**, and **Runs**. Test and release drafts remain independent.
- Normal plans accept one through seven courts. A checkout carries at most two courts, so workers scale from A through H according to booking type and court count.
- API-first preparation starts only the workers required by the saved plan. Test Now carries its selected booking method through preparation and execution.
- Each worker has its own player/customer binding and dedicated Chrome identity. `.env.example` documents A-H variable names; real values stay in ignored `.env.local`.
- API checkout now prewarms and reuses only a fresh, page-bound genuine security context. Navigation or a different page invalidates it.
- Confirmed application rejections can be archived and retried safely; uncertain or possibly dispatched outcomes remain blocked. Parallel outcomes are fully settled before lock disposition is decided.
- API Standard and Extended plans split more than two courts into independent at-most-two-court checkout chunks while retaining exact observed prices.
- The UI restores and displays per-checkout QR handoffs, player identity, courts, hourly slots, amount, booking reference and hold expiry. Previous runs open into a detailed timeline modal.
- A release-only `special-friday` mode now spans A-H: four proof-based holds across two core assigned courts (A/B, C/D), a fail-closed E/F adaptive lane that upgrades to proof-based on early availability or otherwise keeps the existing experimental proofless direct request on a third court, and an optional proof-based-only G/H bonus lane on a fourth distinct court that never blocks A-D. The E/F proofless path is intentionally labeled unproven and uses an assumed PHP 700/hour only when Friday pricing is not yet observable.

## Worker allocation

| Plan | 1-2 courts | 3-4 courts | 5-6 courts | 7 courts |
|---|---:|---:|---:|---:|
| Standard, 1-3 hours | A | A-B | A-C | A-D |
| Extended, 4-6 hours | A-B | A-D | A-F | A-H |

The allocation function is `src/workers.ts::requiredWorkerIds`. API checkout chunking is in `src/api-booking/extended-checkout.ts`. Browser/UI planning uses the same `CourtCount` and `WorkerId` types.

## Safety invariants to review first

1. A possibly dispatched checkout, verified hold, active worker, or ambiguous browser state must retain the automation lock.
2. Parallel checkout work uses `Promise.allSettled`; one worker's failure must not hide another worker's possible hold.
3. A durable journal in `unknown` state cannot be recycled. Only conclusively rejected attempts and fully expired verified holds are reusable.
4. Final authorization compares current courts, dates, hourly boundaries, customer identity and exact amount. The normal workflow has no hidden price ceiling.
5. Security values come from the genuine Onda page and are never fabricated, replayed across pages, or logged.
6. A pending response or HTTP success is insufficient by itself. The app requires validated booking identities and restores the official checkout page before reporting QR readiness.
7. Payment, QR scanning, OTP, PIN and payment-provider interaction remain manual.

The highest-risk current area is `src/api-booking/desktop-runner.ts`, especially special-session early triggering, the E/F adaptive proof/proofless hand-off, the G/H bonus lane's court exclusion, safe retry classification, final per-worker outcome reduction, and lock release. Review it together with `special-session.ts`, `special-direct-checkout.ts`, `adaptive-direct-lane.ts`, `api-lock-outcome.ts`, `durable-submission-journal.ts`, `browser-session-transport.ts`, and their tests.

## Special Friday session boundary

This mode is release-only and requires Browsers/Players A-H: up to eight independent temporary QR holds across four distinct courts and nineteen court-hours. Every checkout keeps its own player/customer/browser identity; payment stays entirely manual.

- A/B target one assigned court from 17:00-22:00 in 3-hour and 2-hour **proof-based** checkouts. Preferred court 6, priority 6, 7, 5, 4, 3, 2, 1 (excluding the E/F court).
- C/D target a different assigned court from 19:00-23:00 in two 2-hour **proof-based** checkouts. Preferred court 7, priority 7, 6, 5, 4, 3, 2, 1 (excluding the E/F court).
- Court assignment for A-D chooses the first two distinct courts (searched in priority order) that satisfy the complete proof-based blocks. A/B and C/D are the core session; G/H must never block them.
- **E/F is an adaptive lane** (`src/api-booking/adaptive-direct-lane.ts`): its court is reserved *first*, before A-D/G-H, with priority 5, 4, 3, 2, 1 (`chooseDirectCourt` in `special-direct-checkout.ts`). If that court shows all five hours available before 08:00, E/F upgrades to the normal proof-based path (fresh proofs, same mechanism as A-D/G-H) and dispatches immediately. Otherwise it retains the existing **proofless** direct request exactly at the release boundary. A fail-closed one-way gate (`AdaptiveDirectLaneGate`) guarantees the two paths can never both dispatch for the same block: whichever commits first wins; a conclusive pre-dispatch proof failure (security/proof-acquisition, before any network call) reopens the proofless fallback; any possibly-dispatched, unknown, or verified proof-based outcome disables it permanently. If pricing is hidden before release, the proofless path uses an explicitly surfaced, unverified PHP 700/hour prior-rate assumption.
- **G/H is a proof-based-only bonus lane, fully independent of A-D** (`runBonusLane` in `desktop-runner.ts`, using `special-session.ts::specialBonusLanePlans`, preferred court 4, priority 4, 3, 2, 1, 5, 6, 7). A-D commits and dispatches the instant its own court is known and is never delayed waiting for G/H; G/H starts watching on its own poll cadence the moment A-D's court assignment is known (so it can correctly exclude it) and continues independently — through a short post-release burst — up to release, dispatching the moment a fourth distinct court is complete, whenever that happens relative to A-D. It requires all five hourly slots actually available and uses actual observed pricing; it never falls back to the proofless transport. When no fourth distinct court exists it is skipped with a sanitized `SPECIAL_BONUS_LANE_SKIPPED` outcome and never blocks A-D. An early conclusive rejection may allow exactly one release-boundary retry under the same safe-retry rules as A-D (fresh complete availability, every prior journal conclusively reusable, no unknown/possibly-dispatched prior request); an unknown G/H result is never retried. G/H's own success/failure is folded into the run's overall summary and exit code, and its durable-journal-proven conclusive safety (not mere task existence) gates automatic lock release alongside A-D's and E/F's.
- Any uncertain direct or proof-based result (for any lane) remains journaled and locked. No automatic retry follows an uncertain dispatch. A-D, E/F and G/H use lane-scoped security preparation, so a side-lane preparation failure cannot veto the core. `Promise.allSettled` observes every A-H branch so one worker's failure never hides another's possible hold. Lock lifecycle writes are serialized across concurrent lanes; after all lanes settle, the newest verified hold expiry is persisted. The lock is released automatically only when every relevant branch conclusively proves no request was dispatched or was definitively rejected.

This mode should not be treated as production-proven merely because offline tests pass. The E/F proofless fallback in particular remains an unproven, previously-observed-only mechanism; the E/F proof-based upgrade and the G/H bonus lane reuse the same live-verified proof-based checkout path as A-D but have not themselves been live-validated as an eight-worker combination.

## Verification

Run from the repository root:

```powershell
npm ci
npm run typecheck
npm test
npm run ui:build
git diff --check
```

At publication time, typecheck passed and Vitest reported 67 test files and 798 tests passed. These are offline checks and did not arm a run, select a slot, create a hold, or interact with payment.

CI is defined in `.github/workflows/ci.yml` and performs dependency installation, Playwright Chromium setup, typecheck and the offline suite on every push and pull request.

## Repository and privacy boundaries

The source tree intentionally includes TypeScript, UI sources, tests, fixtures, generated `dist`, the Windows launcher, build metadata and historical reports. The following remain local and must not be committed:

- `.env.local` and other `.env.*` files except `.env.example`
- `config.local.json`
- `.local/`, browser profiles, cookies and session state
- current `DiagnosticsLocal/`, Playwright results and logs

The repository contains an older tracked sanitized diagnostics corpus and `diagnostics-archive/README.md`; treat those as historical evidence. Do not add new runtime diagnostics without passing them through the sanitizing export process and reviewing the result.

## Documentation map

- `README.md`: current operator setup, workflows and safety rules.
- `API_FIRST_COMPLETION_REPORT.md` and `API_FIRST_IMPLEMENTATION_REPORT.md`: API-first architecture checkpoint.
- `API_8AM_BOTTLENECK_REPORT.md` and `API_8AM_PERFORMANCE_PLAN.md`: measured latency evidence and proposed optimization work.
- `API_CALENDAR_FREE_CHECKOUT_REPORT.md`, `API_CHECKOUT_403_RESOLUTION.md`, `API_TO_BROWSER_HANDOFF_INVESTIGATION.md`, and `API_VERIFICATION_INTEGRATION.md`: checkout/security investigations.
- `RELEASE_CRITICAL_PATH_TELEMETRY_REPORT.md` and `TELEMETRY_SPEC.md`: event and timing interpretation.
- `PHASE7_BOOKING_REPORT.md`, `PHASE7_1_REPORT.md`, and `PHASE7_2_REPORT.md`: older Standard/Extended rollout evidence.
- `NEXT_RELEASE_READINESS.md` and `RELEASE_RUN_REPORT_2026-09-12.md`: dated operational evidence, not a guarantee of current live readiness.
