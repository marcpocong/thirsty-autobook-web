# Current implementation review guide

This guide records the broader desktop application at the 2026-09-23 checkpoint. For the current 2026-09-24 Precision release architecture, start with [REVIEW_PHASES_1_TO_3_2026-09-24.md](REVIEW_PHASES_1_TO_3_2026-09-24.md), then read the Phase 1–3 reports and source. `README.md` describes operator use.

## Read first: the one release win was uncontested

The bot has won exactly one release: **12 September 2026** (target Monday 14 September, Court 7 18:00–21:00), through the normal website flow, which is the proof-backed lane. **No competing bot was contesting that release.** Don't cite it as evidence that the proof-backed lane wins contested releases. Reviews that conclude "based on history, the only possible win is proof-backed" misread the record.

The evidence:

- **The bot was slow that day and still won.** Its first slot click came at +1.6 s and its final Onda action at +9.5 s. The hold followed about 3.8 s later ([RELEASE_RUN_REPORT_2026-09-12.md](RELEASE_RUN_REPORT_2026-09-12.md)). An evening block on the first-priority court was still free 9.5 s after release.
- **There was no queue.** A 3.8 s hold is close to the off-peak 1.1–2.6 s. Since then, release checkouts have waited 7–35 s for Onda's answer.
- **Later releases were contested within seconds.** Every release with grid data shows it:
  - 26 September (target Monday 28 September, the same weekday as the win). The only two winnable blocks went to someone else before Onda processed our requests, which were sent at about +7 ms. Courts 4 and 5 16:00–19:00 were gone by +13 s ([RELEASE_RUN_REPORT_2026-09-26.md](RELEASE_RUN_REPORT_2026-09-26.md)).
  - 28 September (target Wednesday 30 September). 13 evening hours had records by +2.8 s, 37 by +10.8 s and all 42 by +30.3 s ([RELEASE_RUN_REPORT_2026-09-28.md](RELEASE_RUN_REPORT_2026-09-28.md)).
  - A checkout at +9.5 s would have met a mostly taken board on either day.
- **The lane made no difference off-peak.** Proofless and proof-backed checkouts are equally fast there (p = 0.26, [SERVER_ARBITRATION_INVESTIGATION.md](SERVER_ARBITRATION_INVESTIGATION.md) §2). On an uncontested release, a proofless checkout would very likely have won as well.

What the record supports:

| Lane | Release checkouts | Contested | Won |
|---|---|---|---|
| Proof-backed (normal website flow) | 1 (12 Sep) | 0 | 1, uncontested |
| Proofless | every release checkout 23–28 Sep | all: targets blocked beforehand or taken within seconds | 0 |

Neither lane has a win on a contested release. Proof-backed at a contested release is still an open experiment (SERVER_ARBITRATION_INVESTIGATION.md §13, experiment 6), not the proven path.

Limit: Slot Watch did not exist on 12 September, and Onda's public data never shows who booked. "No competitor" rests on the timing evidence above, not on a record of who else was booking that morning.

## What changed in this snapshot

- The desktop UI is divided into **Next Release**, **Edit Plan**, **Tests**, **Slots**, **Runs**, and **Tools**, with a persistent header for the network clock, bot browsers A–H, the automation lock and the slot watch. The layout is static HTML; `ui/renderer/app.ts` no longer re-parents panels at startup. Test and release drafts remain independent.
- A read-only **release slot watch** (`src/slot-watch.ts`) runs in the Electron main process for every armed release, or on demand. It reads public availability for all 112 court/hours from T−60 s to T+15 min (0.5 s cadence right after release) plus public booking records at key moments, and writes a read-by-read NDJSON log, a plain-text report and a summary under `.local/slot-watch/`. The runner's own availability reads now log the same whole-day matrix (`court-hour-matrix.ts`).
- **Close all bot browsers** (`scripts/close-bot-chrome.ps1`, `ui/browser-cleanup.ts`) closes only Chrome browser processes whose `--user-data-dir` is inside the installation's `.local` folder, gracefully first. The controller refuses it while a run is active or a release is armed and asks for confirmation, warning about open QR pages.
- The one-off **Special Friday** A–H session is archived in `archive/special-friday/` (outside the TypeScript and Vitest scopes). `SESSION_MODE` is gone from the config schemas; a saved plan that still carries it loads as a normal plan. Shared proofless helpers moved from `special-direct-checkout.ts` to `proofless-checkout.ts`, and public booking-record reads are shared in `public-bookings.ts`.
- Normal plans accept one through seven courts. A checkout carries at most two courts, so workers scale from A through H according to booking type and court count.
- API-first preparation starts only the workers required by the saved plan. Test Now carries its selected booking method through preparation and execution.
- Each worker has its own player/customer binding and dedicated Chrome identity. `.env.example` documents A-H variable names; real values stay in ignored `.env.local`.
- API checkout now prewarms and reuses only a fresh, page-bound genuine security context. Navigation or a different page invalidates it.
- Confirmed application rejections can be archived and retried safely; uncertain or possibly dispatched outcomes remain blocked. Parallel outcomes are fully settled before lock disposition is decided.
- API Standard and Extended plans split more than two courts into independent at-most-two-court checkout chunks while retaining exact observed prices.
- The UI restores and displays per-checkout QR handoffs, player identity, courts, hourly slots, amount, booking reference and hold expiry. Each QR card can maximize and foreground its exact dedicated browser. Previous runs open into a detailed timeline modal.
- Release traces record sanitized browser-specific preparation and security-prewarm outcomes. Security preparation starts 15 seconds before the boundary; any latency improvement remains projected until a new live trace measures it.

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

The highest-risk current area is `src/api-booking/desktop-runner.ts`, especially safe retry classification, final per-worker outcome reduction, and lock release. Review it together with `proofless-checkout.ts`, `api-lock-outcome.ts`, `durable-submission-journal.ts`, `browser-session-transport.ts`, and their tests.

## Release slot watch boundary

`src/slot-watch.ts` is observation only: it uses the same credential-free public GET endpoints as the block audit (`live-availability-provider.ts`, `public-bookings.ts`) and never imports browser, checkout, lock or journal code. It is owned by the controller, not the booking runner, so it cannot delay dispatch and keeps observing after a run ends. Reads are sequential (never overlapping), skip slots already in the past after a slow read or PC sleep, and re-check the network clock after each wait. A failed read is logged and leaves the last known matrix unchanged. The first 60 s before release read at a 10 s cadence to avoid adding load before the boundary. Release publication (unreleased → open/taken for all cells) is logged per cell but summarized as one timeline entry in the UI.

## Bot browser cleanup boundary

`scripts/close-bot-chrome.ps1` selects only `chrome.exe` browser processes (no `--type=`) whose resolved `--user-data-dir` starts with the installation's `.local\` folder, and kills each process tree with `taskkill /T`, forcing only after a 6 s graceful wait. Only counts cross the process boundary. The controller operation is `closingBrowsers`; it is excluded from run history, blocked by any active or scheduled operation, and clears preparation afterwards because the prepared browsers no longer exist.

## Verification

Run from the repository root:

```powershell
npm ci
npm run typecheck
npm test
npm run ui:build
git diff --check
```

At publication time, typecheck passed and Vitest reported 70 test files and 814 tests passed. These are offline checks and did not arm a run, select a slot, create a hold, or interact with payment.

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
- `NEXT_RELEASE_READINESS.md`, `RELEASE_RUN_REPORT_2026-09-12.md` and `RELEASE_RUN_REPORT_2026-09-23.md`: dated operational evidence, not a guarantee of current live readiness.
- `SERVER_ARBITRATION_INVESTIGATION.md`: provider-side arbitration after the 2026-09-25 release (why release-time checkouts waited ~30 s and got 409), the evidence-derived timeline and replay under `diagnostics-archive/2026-09-25/arbitration/`, the sanitized 409 capture, critical-path telemetry, and the experimental renderer-resident dispatch (off unless `ONDA_EXPERIMENTAL_RENDERER_DISPATCH=RENDERER_RESIDENT_V1`).
- `archive/special-friday/`: the retired Special Friday A–H session — its report, standalone modules and tests, kept for reference only.
