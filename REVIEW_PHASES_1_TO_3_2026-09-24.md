# Precision release review guide — Phases 1–3

This is the entry point for reviewing the local 2026-09-24 implementation. The source and tests are authoritative; the three phase reports are design and verification records. The 2026-09-23 `REVIEW_GUIDE.md` covers the broader desktop app but predates this release architecture.

**Follow-up:** the simplified Smart backups editor and Phase 4 Release Intelligence are described in `RELEASE_INTELLIGENCE_PHASE4.md`.

**Evidence level:** all Phase 1–3 code was checked with offline tests, a local Chrome latency harness, and a rebuilt Windows installation. None of these phases has been validated at a real 08:00 release. The 2026-09-23/24 run reports describe earlier behavior and must not be read as proof of Phase 3 success.

## Scope and change inventory

| Area | Current implementation | Primary code | Focused evidence |
| --- | --- | --- | --- |
| Release clock | Multi-host Google network-clock consensus, monotonic deadline, final no-early guard | `src/network-clock.ts`, `src/release-clock.ts` | `tests/release-clock.test.ts`, `RELEASE_LATENCY_PHASE1.md` |
| Durable Wave 1 | Prepare requests/journals/one-shot permits before T-0; synchronous independent A–G dispatch at release | `src/api-booking/armed-dispatch.ts`, `desktop-runner.ts`, `durable-submission-journal.ts`, `api-automation-lock.ts` | `tests/api-booking/armed-dispatch.test.ts`, `armed-hot-path.test.ts`, `armed-lock-recovery.test.ts` |
| Worker identity | Exact dedicated customer binding per required worker; duplicate IDs fail closed or exclude the affected Precision worker | `src/api-booking/customer-identity.ts`, `fleet-validation.ts`, `src/workers.ts` | `customer-identity.test.ts`, `fleet-validation.test.ts`, `tests/workers.test.ts` |
| Read-only release observer | Overlapping bounded public availability reads, 112-cell matrices, prices, request/response times, cache metadata, public booking records | `src/slot-watch.ts`, `src/slot-evidence.ts`, `ui/main.ts`, `ui/processes.ts` | `tests/slot-watch.test.ts`, `slot-evidence.test.ts`, `phase2-independence.test.ts` |
| Provider/network forensics | Passive CDP trace after Wave 1 initiation; normal-response allowlist fallback; one report across all waves | `src/api-booking/checkout-provider-trace.ts`, `browser-session-transport.ts`, `src/release-forensics.ts` | `checkout-provider-trace.test.ts`, `release-forensics.test.ts` |
| Candidate authorization | Up to 21 exact, prioritized candidates with stable IDs, explicit Wave 1 assignments, standby A–G, permissions, rates, budgets and fingerprint | `src/api-booking/precision-phase3.ts`, `src/config.ts`, `ui/booking.ts` | `tests/api-booking/precision-phase3.test.ts` |
| Wave 2 | One frozen adaptive wave from complete, newest, sufficiently fresh, cache-MISS public evidence with matching hourly prices | `precision-phase3.ts`, `desktop-runner.ts`, `proofless-checkout.ts` | Phase 3 tests and `npm run phase3:simulate` |
| Reopen Rescue | Explicit opt-in, all earlier attempts conclusively settled, unavailable then fresh OPEN, fresh security, journal reuse and finite budgets | Same Phase 3 modules plus `durable-submission-journal.ts` | Phase 3 simulator scenarios E–N |
| Operator UI | Candidate/rate editor, Wave 1 and standby view, evidence status, finite limits and full final confirmation | `ui/renderer/app.ts`, `index.html`, `ui/controller.ts`, `ui/types.ts` | `tests/ui-precision.test.ts`, `ui-lock-renderer.test.ts` |

The normal API-first/Proofless booking modes and the archived Special Friday experiment also remain in the repository. Phase 3 is used only when the saved release strategy is Precision and `PRECISION_PHASE3` is present. Legacy `PRECISION_TARGETS` continue through their previous path.

## Read in this order

1. `RELEASE_LATENCY_PHASE1.md` for the measured problem, clock and armed-dispatch changes, crash semantics, and baseline benchmark.
2. `RELEASE_FORENSICS_PHASE2.md` for Slot Watch cadence, out-of-order handling, cache provenance, provider trace timing, and the observed limits of public evidence.
3. `RELEASE_ADAPTIVE_PHASE3.md` for candidate authorization, adaptation/rescue gates, pricing, and the 1/3/7-worker comparison.
4. `src/api-booking/desktop-runner.ts` in four passes: initial command/config/worker resolution; transport and response capture; `runPrecision` legacy branch; `runPhase3` branch. The Phase 3 branch should be reviewed together with `precision-phase3.ts` and `proofless-checkout.ts`.
5. `src/slot-watch.ts` and `src/slot-evidence.ts` for exactly what each grid observation proves. Then inspect `checkout-provider-trace.ts` and `release-forensics.ts` for telemetry independence and redaction.
6. Run the checks below. The simulator uses the production pure selector where practical; it does not prove live browser/provider behavior.

## State and authorization flow

```text
saved Precision plan + operator confirmation
  -> exact required worker set and identity/browser checks
  -> T-2 min authorization freeze and journal scan
  -> Wave 1 pre-arm (durable journal + one-shot permit)
  -> T-0 trusted-clock guard and explicit Wave 1 POSTs
  -> Phase 2 read-only grid observations
  -> at most one authorized Wave 2, if fresh complete evidence permits
  -> optional Rescue after all attempts settle and a fresh reopen is proven
  -> one race outcome, durable journal/lock disposition, forensic report
```

The candidate pool is broader than the dispatch set. A candidate has a stable hash ID, logical journal key, court/start/end/duration, priority, permissions and rate evidence. Up to 21 candidates are allowed, while A–G remain the only seven Precision workers. Exact duplicates are rejected. Overlapping same-court candidates may be alternatives in the pool but cannot be concurrent in-flight or verified assignments. The frozen fingerprint covers targets, permissions, assignments, rates and budgets. Any plan edit changes the saved plan fingerprint and invalidates preparation.

Wave 1 is chosen before release by the operator. A warning calls out identical time windows but does not silently diversify them. A standby worker has no target until an eligible frozen candidate is selected. Rescue is off unless enabled in the saved plan. All wave and total budgets are finite, and the confirmation warns that multiple temporary holds can result from concurrent sends. Payment and cancellation remain manual.

## Evidence rule for adaptive sends

Slot Watch is in the desktop main process and uses public GET requests only. The runner receives its observations over IPC. Selection requires a target-date-published observation with the full 7 × 16 grid, complete matching price matrix, newest answered request sequence, acceptable age and `x-vercel-cache: MISS` without positive `Age`. A cache HIT, missing/uncertain cache provenance, incomplete grid, unreleased date, failed read, stale read, or older request that returned late is retained for forensics but cannot trigger checkout. No price from another snapshot is mixed with the OPEN cells.

Wave 2 is evaluated only after Wave 1 actually fires. Without explicit concurrent authorization it waits for Wave 1 to settle. A fresh observation with no eligible candidate leaves the one Wave 2 opportunity available. UNKNOWN or a verified hold blocks any new adaptive send. The last transport gate checks release time, freshness and race state again before the POST.

Rescue requires a trustworthy unavailable observation followed by a distinct later trustworthy fully OPEN observation for the complete candidate range. The earlier unavailable response must precede the reopen request. All earlier dispatches must have conclusively settled; a timeout or possibly dispatched request is UNKNOWN and ends automation. Rescue refreshes a genuine browser security context. Its evidence age is bounded by observed read latency plus measured security preparation, with a 6–15 s cap. A rejected journal is archived through the explicit reusable path; an UNKNOWN or nonexpired verified journal blocks. A candidate is limited to one Rescue per distinct unavailable epoch, subject to the wave and total budgets.

## Pricing and response validation

Wave 1 uses entered, dated rate evidence and per-hour amounts. It distinguishes a current venue schedule and operator-confirmed evidence from historical/reference evidence. Reference-only evidence cannot authorize Wave 1. Wave 2 and Rescue use the per-hour prices in the same actionable grid that selected the candidate, replacing every hourly rate in the checkout request. The existing response validator still requires matching target, amount, pending state, booking identity and hold expiry. A response that cannot be conclusively classified is UNKNOWN.

## Durability and forensic boundaries

- `src/api-booking/durable-submission-journal.ts` and `api-automation-lock.ts` are the dispatch safety boundary. Review armed, fired, rejected, unknown, verified and reusable transitions, plus the lock release conditions.
- The Phase 3 freeze file and per-adaptive-attempt intent files are written under ignored `.local/api-booking/precision-races/`; progress events and journal history remain local. Runtime files are intentionally absent from GitHub.
- `ProviderTraceSet` spans the full race. It delays passive Network enablement until after the Wave 1 POST burst, then updates attempt context for later waves. The normal response fallback is captured after dispatch with only allowlisted metadata. It does not persist cookies, customer details, security tokens, request bodies, QR/payment values or raw provider payloads in the public forensic artifact.
- The forensic report distinguishes request and response timing from inferred provider-side events. An OPEN grid does not prove who booked, whether a checkout was accepted, or what the provider did between two reads.

## Reproduction without a live booking

From the repository root:

```powershell
npm ci
npm run typecheck
npm test
npm run ui:build
npm run phase3:simulate
git diff --check
```

The local Chrome benchmark is offline: DNS is disabled and Onda requests are fulfilled by local fixtures. Reproduce both sides under similar machine load:

```powershell
npm run bench:release -- --mode armed --workers 1,3,7 --runs 10 --priority window --phase2 on --response-delay 50 --label review-baseline
npm run bench:release -- --mode armed --workers 1,3,7 --runs 10 --priority window --phase3 on --response-delay 50 --label review-phase3
```

The 2026-09-24 final local checks passed typecheck, UI build, simulator, `git diff --check`, and 85 Vitest files / 983 tests. A timing-sensitive Phase 2 independence test crossed its 50 ms threshold once under full-suite load (53 ms); it passed alone and in the final full run. The comparison tables and paths to raw local benchmark data are in `RELEASE_ADAPTIVE_PHASE3.md`. The synthetic three-wave forensic report is under ignored `.local/release-forensics/00000000-0000-4000-8000-000000000003/` and is not a real release artifact.

The installed Windows build was rebuilt from this worktree. `BUILD-INFO.txt` in the parent installation identifies source `15334ca + uncommitted changes` and launcher SHA-256 `7C7ACD9E598DD0DC3F1FE4A59ADAA90B311D6C343A136DC46A762D9BC0603952`; key installed dist hashes matched the source dist after that build. The EXE and private installation runtime are outside this Git repository.

## Review questions and limits

1. Could any path send before its scheduled trigger or send a target absent from the frozen authorization? Inspect the monotonic release clock, armed-dispatch gate, adaptive final guard, and fingerprint comparisons. The trigger is the official release unless the operator saved a Release Offset (`src/release-offset.ts`, added 2026-09-28): a whole-millisecond value from -2000 through 0, Proofless Direct only, covered by the plan fingerprint. It moves only the pre-armed Proofless dispatch.
2. Could overlapping same-court candidates or more than seven workers be active at once? Inspect `PrecisionSession.select`, worker resolution, and the timing between selection and durable reservation.
3. Can a cached, incomplete, stale or out-of-order OPEN observation become actionable? Inspect the full evidence classifier and IPC routing, including evidence rechecks after security preparation.
4. Can UNKNOWN, a verified hold, or a possibly dispatched journal be reclassified as rejected or recycled? Inspect the journal, error classifier, session reduction and retained lock.
5. Can telemetry errors or observer load delay Wave 1 or change checkout outcome? Inspect process separation and `phase2-independence.test.ts`, then compare the offline latency distributions.
6. Can response fallback or generated artifacts expose customer IDs, contact data, security context, cookies, request body, QR/payment data or private runtime paths? Review allowlists, source maps and the staged Git diff.

**Unproven:** actual provider cache semantics beyond the recorded headers; real release Wave 2/Rescue timing and acceptance; all browser/security challenges under live load; complete end-to-end crash/restart behavior. A future Phase 4 can investigate those separately. No live checkout, hold, payment, automatic cancellation or security bypass was performed for Phases 1–3 verification.

## Publication boundary

Publish source, tests, reports, fixture-safe scripts and the selected generated `dist` outputs needed to match the existing tracked build layout. Exclude `.env.local`, `config.local.json`, `.local/`, profiles, cookies, journals, locks, raw runtime traces, and the parent installation/EXE. Private worker identities must never be invented or copied into repository documentation.
