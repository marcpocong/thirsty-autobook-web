# Booking Setup v3 — one plan from goal to QR (October 15, 2026)

The application has four destinations: **Home**, **Booking Setup**, **Activity** and **Settings**. Booking Setup is the single workspace for the goal, strategy, Shotgun customization, browsers, review, testing and execution. Payment is always manual; the bot stops at the genuine QR checkout.

## Operator guide

1. **Home** shows the next release (Mango and Buko booking dates with their evidence status), the saved goal, the execution state, browser readiness, any temporary holds (always *payment pending*), and anything that needs attention. Use **Start Booking Setup**.
2. **Booking Setup → 1 Goal.** Choose **Next Release** (Shotgun by default) or **Available Now** (Normal by default). For each wing choose the date, minimum and ideal number of distinct courts, acceptable courts (click to include; order is priority; mark exact courts in Exact mode), preferred and alternative starts, duration, and optional price caps. Counting can be per wing or across both wings. **Check Availability** reads both wings once, read-only, in a small dedicated Chrome window that closes afterwards; no booking browser needs to be prepared.
3. **2 Strategy.** Pick the strategy; the checkout method is separate and lists only supported methods. Each wing shows its capability (below) with the exact reason and evidence.
4. **3 Customize.** Shotgun: suggestion (rationale + confidence), presets (Suggested, Dense Core, Balanced, Wide, Fully Custom, and your saved presets: save, rename, duplicate, restore, compare), manual timing, the literal attempt table and the timeline. Editing any row switches to Fully Custom and keeps your exact values. Precision: per-court offsets/children, backups, reopened-slot rescue. The old saved-plan editor is available in the *Advanced* drawer.
5. **4 Browsers.** One dedicated browser and customer per checkout. A browser whose customer has a pending checkout is never given another checkout.
6. **5 Review & Run.** The Strategy Inspector shows exactly what will run (dates, courts, attempts, offsets, browsers, prices, expected holds, capability, risks, fingerprint). The single primary button moves through **Prepare → Authorize and Arm** (or **Authorize and Book to QR**) **→ Emergency Stop**; the Terms checkbox is required each run. **Test This Plan** opens the Booking Test Lab.
7. **Activity** shows live progress, history/evidence, and **Records & archive** (historical UNKNOWN records).

Emergency Stop cancels unsent attempts only. Temporary holds already created stay with the provider until they expire or you pay.

## Domain model

`src/booking-objective.ts` (renderer-safe) separates: **objective** (per-wing or any-wing minimum/ideal distinct courts), **targets** (exact wing + registry UUID + date + hours), **strategy**, **checkout method**, and the **environment** (chosen per run, never part of the plan). `compileObjective` enumerates targets, groups them into release cohorts by release instant (dates are never rewritten to share a release), selects immediate targets within worker capacity (mandatory courts first, then enough distinct courts per wing for each ideal, then priority), and compiles through the existing `compileSmartPlan` → `planShotgun`. Available Now compiles to provider-supported checkouts: Mango packs up to two courts per checkout per browser; Buko is one exact court per checkout; wings never share a browser. The compiled plan has one SHA-256 fingerprint (pure implementation, identical in renderer and main process).

`evaluateObjectiveOutcome` reconciles each provider result independently: distinct courts count once per wing; the same booking reported twice is a duplicate; holds beyond the ideal are extra holds; UNKNOWN needs review; payment is confirmed only by an explicit provider record (never inferred from a hold). Old saved Mango plans and the dual-wing wrapper are interpreted in memory (`objectiveFromLegacySetup`, `objectiveFromDualWingPlan`); saved bytes and journal keys are never rewritten.

Execution states (`src/execution-state.ts`): DRAFT, SAVED, PREPARING, PREPARED, ARMED, RUNNING, RECONCILING, COMPLETED, PARTIAL, FAILED, NEEDS REVIEW. Editing a prepared plan clears preparation; editing an armed or running plan is refused.

### Live saving

The live Precision/Shotgun runner authorizes only the legacy undated Mango representation bound to the release calendar (exact dated candidates are refused live). `savedMangoReleaseSetup` converts a compiled Mango-only cohort into that format through the same compiler, keeping courts, times, worker grouping and literal offsets, and refuses instead of re-dating or dropping a wing. Prepare saves exactly this setup and records the binding between the objective fingerprint and the saved release fingerprint; a later edit in the advanced editor is surfaced for an explicit choice.

### Distinct-court quotas in dispatch

A frozen race may carry an explicit quota (`RaceQuota`). A verified hold adds its registry space to its wing; the achieved court never needs another hold; a wing stops at its ideal while other incomplete wings continue; UNKNOWN, HTTP 429 and payment-in-progress stop every unsent attempt. Races without an objective keep their exact fingerprint and the legacy one-court behaviour. A saved Booking Setup objective is part of the plan fingerprint only when present.

## Capability matrix (evidence-based, `src/capability-matrix.ts`)

| Mode · strategy | Checkout | Mango | Buko |
|---|---|---|---|
| Available Now · Normal | API with fresh proofs | LIVE VERIFIED (1–7 courts; ≤2 per checkout) | LIVE VERIFIED for 1 exact court; 2+ courts LIVE PILOT (separate one-court checkouts, separate browsers) |
| Available Now · Normal | Proofless | LIVE VERIFIED (off-peak holds 2026-09-23, up to 6 parallel workers) | BLOCKED — `BUKO_PROOFLESS_NOT_ENABLED` |
| Available Now · Normal | Browser / Hybrid (legacy) | LIVE VERIFIED, ≤2 courts | BLOCKED — browser planner is Mango-only |
| Next Release · Normal | API / Proofless / Browser / Hybrid | LIVE SUPPORTED (existing gated path; no release-boundary win recorded) | OFFLINE ONLY — Buko release PROVISIONAL (08:00 not observed); Normal release planner Mango-only |
| Next Release · Precision | Proofless | LIVE SUPPORTED (used at releases; 08:00 proofless acceptance unproven) | OFFLINE ONLY |
| Next Release · Shotgun | Proofless | **LIVE PILOT** — same armed dispatch path as Precision fan-out; arming needs an owner attestation for the exact plan | OFFLINE ONLY |

Shotgun and Precision cannot use methods that read availability at send time. Live Shotgun is no longer a blanket block: the controller requires a separate owner attestation dialog for the exact plan fingerprint (recorded in `.local/shotgun-live/attestations.ndjson`), every existing topology, tab, machine-health, prewarm and timing gate still applies, and the runner independently re-checks the attestation, refuses an immediate current-slot burst (`SHOTGUN_IMMEDIATE_BURST_BLOCKED`) and any Buko scheduled target (`BUKO_SCHEDULED_LIVE_BLOCKED`).

Unchanged audited limits: offsets −2000…0 ms (positive offsets invalid, never clamped); strict 50 ms local lateness; 105 ms meaningful-spacing reference; up to 6 tabs per worker; 7 Precision workers (42 immediate attempts, 56 total sends with backups/Rescue). No limit was raised.

## Availability

`src/api-booking/availability-observer.ts` + `src/observer-chrome.ts`. Live finding (2026-10-14): in headless Chrome and in automation-launched browsers the site refuses the availability read (HTTP 403) — even the official page's own requests; a normally launched Chrome window on its own profile receives HTTP 200. The checker therefore launches the installed Chrome on a dedicated observer profile with a localhost-only debugging port (the same mechanism as worker browsers), attaches read-only, blocks every non-GET request, reads Mango and Buko, and closes it with `Browser.close`. Every registered court/hour becomes OPEN, BLOCKED, UNRELEASED or UNKNOWN with the observed price; freshness is the oldest wing read (15 s). It never clears preparation or Terms and is refused while a release is armed or automation runs. Live read-only verification: 2026-10-14 and 10-16 both wings read; 10-21 and 10-25 UNRELEASED. Slot Watch's guest observer now uses the same launcher. The block audit, CLI previews and network check still attach to a prepared Worker A (unchanged).

## Booking Test Lab

The lab runs the exact compiled Booking Setup objective — no second editor. **Offline simulation**: Shotgun and Precision run in isolated Chrome workers through the production freeze, arm and dispatch modules with every checkout intercepted (Shotgun strict timing, Precision non-strict; Precision backups/Rescue are not exercised offline). Normal runs offline on the real availability parser and freshness check, candidate planner, durable candidate journal, checkout chunking, request builder, response validator and journal settlement; only availability and checkout responses are fixtures. Scenarios include success, partial completion, per-wing quota, two concurrent holds, wrong wing, duplicate, missing/stale availability, unsupported release policy, preparation failure, missed deadline, 409 payment-in-progress, 429, unknown outcome, browser closure and restart with a retained UNKNOWN. Strategies can be compared on the same goal. Timing is configured trigger → local Chrome request initiation, never provider receipt. **Authorized live test** and **production** use the action bar's normal flow.

## Historical UNKNOWN archive

`src/journal-archive.ts`. Archiving never moves, rewrites, retries or reclassifies a journal: the original file stays in place (the write-once guard keeps refusing that target and the record stays UNKNOWN). The archive is a SHA-256 index plus append-only audit log in `.local/journal-archive/` (outside the lifecycle stores, so update safety is unchanged), with verify and restore. Eligibility mirrors the installer's historical rule (well-formed UNKNOWN, 24 h quiet, deadlines passed, holds expired). Armed/dispatching records, verified holds, locks and `.arming` files are never archived.

## Remaining provider limitations

- Buko scheduled release: PROVISIONAL (08:00 / +6 days). The +6 date rule was observed on consecutive days (banner Oct 14 → Oct 20; Oct 15 → Oct 21, confirmed read-only with Oct 22 unreleased); the 08:00 instant has not been observed; Buko proofless checkout unverified and refused by the builder and journal.
- No live Shotgun has reached a provider hold; provider acceptance of a proofless checkout exactly at 08:00 is unproven.
- Multi-checkout Available Now sequences (e.g. Mango 2 + Buko 1) run each checkout through the verified one-checkout path but the sequence itself has not been run live.
- Provider request-volume limits are not documented; 429 stops all unsent attempts and nothing is retried.
