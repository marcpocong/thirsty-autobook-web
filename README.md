# Thirsty Onda booking assistant

Windows 11 / Node 24 / TypeScript / Playwright / dedicated Chrome. All files live directly in this project root.

The existing single-court booking flow has live evidence, including the [September 12 production run](RELEASE_RUN_REPORT_2026-09-12.md). Automation stops at the verified QR payment hold; payment remains manual. The current tree adds API-first booking, up to seven courts, per-checkout worker isolation, richer run/QR history, and an explicitly experimental Friday-session mode. Start with [REVIEW_GUIDE.md](REVIEW_GUIDE.md) when reviewing the current implementation; the phase reports below are historical checkpoints.


## Current booking model

The normal workflow is **configure → Reset & Prepare → authorize Terms → Run Test to QR / Arm Next Release**. Choose **Test Now** for an exact date without waiting for release, or **Release Booking** for the scheduled run. Engineering tools remain under the collapsed **Advanced / Diagnostics** section.

| Booking type | Duration | Courts | Browsers | Checkouts / QR holds |
|---|---|---|---|---|
| Standard | 1-3 consecutive hours | 1-7 | `ceil(courts / 2)` | `ceil(courts / 2)` |
| Extended | 4-6 consecutive hours | 1-7 | `2 × ceil(courts / 2)` | `2 × ceil(courts / 2)` |

Each checkout contains at most two courts. Standard uses one time block and groups requested courts in pairs. Extended uses two time blocks, ranked **3+1 -> 2+2 -> 1+3** for four hours, **3+2 -> 2+3** for five, and **3+3** for six; each time block is also grouped into at-most-two-court checkouts. Each checkout has a distinct player/browser identity. Fallback starts move the entire continuous block. Midnight is an allowed endpoint; crossing midnight and durations above six hours are rejected.

`BOOKING_TYPE` defaults to `standard`; `COURT_COUNT` defaults to 1. The current normal UI has no configurable price ceiling: it reports the observed amount and validates that exact amount again before final authorization. `MAX_PRICE` remains a compatibility field for older CLI/test paths and defaults to no ceiling.

Test Now resolves availability before a native confirmation shows the actual courts and chunks. The confirmation permits bounded pre-Proceed replanning within the requested range; exact courts are never substituted. Test settings do not require changing the saved release court count. Reset & Prepare and all relevant edits clear Terms authorization. No historical dual readiness/practice evidence is required for normal Test Now or Release Booking.

Test and Release use independent drafts. Test stays in memory and never writes `config.local.json`; Release Reset & Prepare validates, atomically saves, re-reads, fingerprints, and prepares the current Release fields. Status refreshes cannot replace the active Test draft with saved Release values. Normal Run Test to QR and Arm Next Release always mean the full visible Onda flow to the temporary QR hold boundary, regardless of the historical Advanced mode switch.

Reset & Prepare checks dedicated identities, dead owner state, current browser state and both old worker records when applicable. It resets proven pre-final state and returns to today's clean schedule. An active hold or uncertain final dispatch stays protected. Verified holds can be recovered after a conclusively inactive/expired state; a countdown elapsed on the dashboard alone is not proof. Unknown markup, missing worker identity, security challenges and wrong venue remain manual-review stops.

If a preferred local debugging port is already owned by another application or an unverifiable Chrome session, Reset & Prepare leaves that process untouched, allocates a distinct loopback-only fallback endpoint, records it for every subsequent Test and Release process, and starts the same dedicated Thirsty Bot profile there. Repeated preparation reuses the recorded endpoint. The standalone Start Chrome diagnostic remains fail-closed on conflicts.

Preparation emits sanitized per-browser evidence and the controller accepts it only when its fingerprint matches the exact current request. The required browser set is derived from booking type and court count, from A for a one- or two-court Standard plan through A-H for a seven-court Extended plan. Readiness is invalidated by meaningful configuration, workflow, browser, lock, hold, or release-window changes—not merely because 60 seconds passed. Countdown recovery is scoped to the unique visible `Slot reserved for` component, and a visible `00:00` must be stable across a bounded second read.

**Validation boundary:** Onda has been live-verified for at most two courts and three consecutive hours per checkout. Higher court counts are split across independent checkouts and have offline test coverage, but the complete multi-browser combinations are not all live-validated. The adapter requires independently verifiable booking identities and amounts and stops on unsupported markup or uncertain submission outcomes. See [REVIEW_GUIDE.md](REVIEW_GUIDE.md) for the current risk map and [PHASE7_BOOKING_REPORT.md](PHASE7_BOOKING_REPORT.md) for the older Phase 7 evidence.

## Special Friday session (A-H)

`SESSION_MODE=special-friday` is a release-only, fixed-envelope mode requiring Browsers/Players A through H — up to eight independent temporary QR holds across four distinct courts and nineteen court-hours. Every checkout keeps its own player/customer/browser identity; payment stays entirely manual, and a hold is never a completed booking.

| Lane | Workers | Preferred court | Blocks | Method |
|---|---|---|---|---|
| Core early | A/B | 6 | 17:00-20:00 (3h) + 20:00-22:00 (2h) | Proof-based |
| Core late | C/D | 7 | 19:00-21:00 (2h) + 21:00-23:00 (2h) | Proof-based |
| Adaptive | E/F | 5 | 17:00-20:00 (3h) + 20:00-22:00 (2h) | Proof-based on early availability; otherwise the existing proofless direct attempt exactly at release. Never both. |
| Bonus | G/H | 4 | 17:00-20:00 (3h) + 20:00-22:00 (2h) | Proof-based only; skipped when no fourth distinct court has complete availability. Never proofless. |

Court selection reserves the E/F candidate first (priority 5, 4, 3, 2, 1), then assigns A/B (priority 6, 7, 5, 4, 3, 2, 1) and C/D (priority 7, 6, 5, 4, 3, 2, 1) excluding that court, then searches for a fourth distinct G/H court (priority 4, 3, 2, 1, 5, 6, 7) excluding all three. A/B and C/D are the core session; G/H is an additional lane and never blocks an otherwise-valid A-D plan — when no fourth court exists it is skipped with a sanitized outcome. Once a lane has an assigned court and any checkout may have been dispatched, that court is never silently changed.

The pre-08:00 watcher polls availability roughly every 5 seconds (bursting to 500ms, then 2s, after an update signal) and the Onda version roughly every second, stopping new pre-release availability GETs about 11 seconds before 08:00. As soon as genuinely released availability appears before 08:00, A-D dispatch immediately — never delayed waiting on G/H or E/F. G/H and E/F are each fully independent lanes that watch and dispatch on their own: G/H starts polling for its fourth distinct court the instant A-D's court is known and dispatches whenever it finds one, whether that is before, at, or (via a short post-release burst) shortly after A-D's own dispatch; E/F upgrades to its own proof-based path immediately once its reserved court shows all five hours with fresh proofs.

E/F is implemented as a single fail-closed state machine (`src/api-booking/adaptive-direct-lane.ts`) so its proof-based and proofless attempts can never both dispatch: the first attempt to commit (proof or proofless) wins; a conclusive pre-dispatch proof failure (security/proof acquisition, before any network dispatch) reopens the proofless fallback, while any possibly-dispatched, unknown, or verified proof-based outcome permanently disables it. G/H never falls back to the proofless path; an early conclusive rejection may allow one release-boundary retry under the same safe-retry rules as A-D, and an unknown G/H result is never retried.

Every lane owns only its own browser security preparation: an E/F or G/H preparation failure cannot prevent A-D from dispatching. Every relevant checkout is observed with `Promise.allSettled`; one worker's failure never hides another's possible hold. Lock lifecycle writes are serialized across the concurrent lanes, and after all lanes settle the newest verified hold expiry is persisted. A possibly-dispatched or unknown outcome retains the automation lock; it is released automatically only when every relevant branch conclusively proves no request was dispatched or was definitively rejected. This mode should not be treated as production-proven merely because offline tests pass — see [REVIEW_GUIDE.md](REVIEW_GUIDE.md#special-friday-session-boundary).

## Setup

Install Node.js 24 LTS, Google Chrome, Git and optionally GitHub CLI. From this folder:

```powershell
npm ci
npm run chrome
npm run inspect
```

The PowerShell launcher opens a visible dedicated Chrome with profile `.local/onda-chrome-profile/`, localhost CDP `127.0.0.1:9222`, and https://app.onda.fit/book/thirsty-pickle. It verifies the listener is loopback-only and avoids launching another instance when the port exists. Attachment independently verifies Chrome's actual profile path, exact URL, venue and grid. Never use the everyday Chrome profile or expose CDP on the LAN. Keep Chrome visible, active and open; log in manually if Onda requires it.

This uses [Playwright CDP attachment](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp) and a non-default profile as required by [Chrome's remote-debugging behavior](https://developer.chrome.com/blog/remote-debugging-port).

## Commands

```powershell
# Sanitized local schedule DOM inspection; no selection/navigation
npm run inspect

# Explicit noncompetitive select/verify/deselect practice; never Proceed
# Example only: first check current availability.
npm run practice -- --date 2026-09-11 --court 7 --start 10:00 --duration 2

# Wait for configured release, at most two normal refreshes, read only
# Put page on TODAY before starting. No player config required.
npm run release:observe -- --armed

# Same release path plus configured preference lookup; no selection
# Requires valid .env.local booking/player settings.
npm run race:dry -- --armed

# Same release path, selects and verifies, stops BEFORE Proceed; retains lock
npm run selection:armed -- --armed

# Full Booking requires all three capabilities and explicit per-run terms
npm run race -- --armed --authorize-terms

npm run typecheck
npm test
npm run ui:build
```

The checked-in offline suite currently contains 67 files and 798 tests. It must stay network-isolated: it uses fixtures and test-owned Chromium, never a live booking. `npm run exe:build` is a Windows packaging/deployment command; it refreshes the parent installation as well as the launcher and should be run only when that local installation update is intended.

Practice requires all four explicit target arguments. If either requested slot is unavailable, it stops; it never silently picks another target. On an uncertain selection, failure or abort, inspect and clear selection manually. Only rerun practice for an appropriate noncompetitive target.

Release observation defaults to Asia/Manila, 08:00, +2 calendar days, zero lead, 15-second final preflight, 15-second per-operation timeout, at most two reloads, and 1-second retry delay. Start before final preflight. Late starts fail rather than silently switching to tomorrow. These are configurable operational defaults, **not measured release guarantees**. The observer requires `--armed` to authorize scheduled refresh/navigation. Today's grid and All Courts must be displayed at initial and final preflight. No slot click occurs in observer or dry mode.

After the release reload commits, the engine waits only for the verified venue and actionable date picker, then selects the target date directly. It does not wait for Today's grid to render. The strict target grid barrier and full snapshot validation still precede preference selection. A visible disabled target permits one bounded retry; missing or ambiguous calendar markup stops. No extra pre-release reload or calendar warm-up is added.

## Booking configuration

Use **Edit Plan** for session type, booking method, booking type, court count, start, duration, court order, fallback starts and maximum candidate attempts. Saved release settings live in ignored `config.local.json`; the CLI loads this same object. Defaults are 08:00, 2 hours, courts 7 through 1 and 3 candidate attempts. Save invalidates readiness. Confirmation and the worker compare a plan fingerprint so the authorized plan cannot silently change.

Choose Standard or Extended independently of the court count. Use Reset & Prepare in the normal workflow. The `dual:*` commands below are retained Phase 6 diagnostics; they are not prerequisites for normal bookings.

Store real player and customer fields only in ignored `.env.local`. Copy the variable names from `.env.example`; workers A-H use `PLAYER_*` through `PLAYER_H_*` and matching `ONDA_CUSTOMER_*` bindings. Every required checkout must have a distinct validated identity; no worker falls back to another worker's profile. Only configured/missing status and the identity fields needed for the operator's QR review reach the dashboard; phone numbers and customer IDs remain private. Primary and fallback starts use the configured court priority. Starts range from 08:00 through 23:00, with Standard supporting 1-3 consecutive hours and Extended supporting 4-6, ending no later than midnight.

The horizon uses timezone calendar arithmetic, not `now + 48 hours`. Nonzero release lead is rejected until justified by measurements. Observation reads only release settings and ignores player data. Example values are illustrations, not live booking authorization.

## Stop controls and safeguards

Press **Q** or **Ctrl+C** in the terminal. Output: `AUTOMATION ABORTED — USER CONTROL RESTORED`. The Playwright-owning process exits; Chrome remains open. An event already sent to Chrome cannot be undone. No further recovery clicks, refreshes or deselection occur.

Exact row ISO dates, matching visible heading, complete seven-court hourly coverage, and no busy indicator are required before availability is trusted. A changed date heading alone is insufficient. Missing/contradictory slot states are UNKNOWN, never OPEN. Read [telemetry definitions](TELEMETRY_SPEC.md) before interpreting timings.

An atomic process lock prevents concurrent project commands. Failures, abrupt termination and successful booking holds retain `.local/automation.lock`. A verified complete selection also blocks fallback until safe owned cleanup. Use the verified recovery flow below.

Use **Reset & Prepare** for retained Standard, Extended and legacy dual locks. It verifies the recorded process, browser state and durable final-action stage before clearing safe stale state. Do not delete lock files manually to bypass an uncertain payment hold.

Selection verifies exact date/court/hours/count, summary count, PHP amount and actionable Proceed. A failed candidate may be cleaned up only if the current complete grid proves every selected cell belongs to that attempt. A fresh snapshot resolves an untried candidate, up to `MAX_SELECTION_ATTEMPTS` (default 3, allowed 1–5). Unknown state, changed date, foreign selections, security errors and aborts stop without cleanup. Price/count ambiguity never reaches Proceed.

The evidence-based checkout adapter validates Review, normalizes the local PH mobile number to ten national digits for Onda's separate +63 prefix, fills through normal Playwright controls, and validates the Payment Summary total and still-displayed booking details. Review itself has no price; its amount comes from the verified selection summary until Payment Summary independently confirms it. Terms are explicit per run: the UI checkbox defaults OFF and resets on plan changes, completion, cancellation and abort. Full Booking requires this authorization plus a native confirmation of the exact plan. The final action closes the interaction gate before dispatch, including ambiguous failures. GCash, Maya, cards, OTP, PIN and all payment-provider actions remain manual.

## Pre-release checklist

- [ ] Windows automatic clock synchronization checked; clock not modified by bot.
- [ ] Plugged in; sleep prevented; stable network; no heavy downloads or updates.
- [ ] Dedicated Chrome visible, correct venue/tab, logged in if necessary.
- [ ] Today selected, All Courts shown, no selections or checkout in progress.
- [ ] Target/preferences/price/player config reviewed for dry or Full Booking mode.
- [ ] Grid selectors verified; release defaults and zero lead reviewed.
- [ ] Q/Ctrl+C available in the terminal; user present.
- [ ] `--armed` supplied for scheduled refresh; terms authorization reviewed per run.

## Troubleshooting and limitations

`CDP_PROFILE_OR_BIND_UNVERIFIED` / `WRONG_CHROME_PROFILE`: use the launcher from this root; check port 9222 belongs to this project's Chrome. `ONDA_TAB_AMBIGUOUS_OR_MISSING`: leave exactly one exact booking URL tab. `STALE_OR_INCOMPLETE_GRID`: allow loading to finish, check today/All Courts, then inspect again. `TARGET_DATE_UNAVAILABLE`: normal calendar disables it; do not force it. `CHROME_DISCONNECTED`: no relaunch/retry; user must prepare a new run. `TOO_LATE_FOR_PREFLIGHT`: prepare before the next intended release. Security challenges, access blocks, rate limits or Retry-After stop automation; solve permitted human steps manually and begin a separate run only when appropriate.

Respect Onda's applicable terms and venue rules. Do not defeat restrictions. API-first uses Onda requests from genuine dedicated Chrome sessions and preserves current same-origin security context, but it does not bypass Cloudflare, fabricate security values, automate payment, or treat an HTTP response alone as booking confirmation. Unknown dispatch outcomes remain locked for manual reconciliation and must not be retried.

Tests use test-owned Chrome/Chromium and minimal synthetic HTML with all external requests blocked. `browser.close()` exists only for that test-owned browser, never the user's Chrome. CI runs install/typecheck/offline tests, never the CLI against Onda. On Linux test hosts run `npx playwright install --with-deps chromium` first.

The repository is private at [marcpocong/thirsty-autobook-web](https://github.com/marcpocong/thirsty-autobook-web), on main. Diagnostics, profile, env files and logs are ignored.

## Desktop control panel

On Windows, double-click **Thirsty Bot.exe** in the project root to open the panel without a terminal. Build or refresh it with `npm run exe:build` after installing dependencies with `npm ci`. This is a local launcher, not a standalone installer: keep it with the project, installed dependencies and built `dist` folder. It uses the Node.js runtime recorded locally during the build, with PATH as a fallback. It preserves the same local configuration, browser profile, process ownership and retained automation lock. No booking is armed by launching it. The executable is included in Git; the machine-specific runtime path remains ignored. The executable is unsigned.

```powershell
npm run ui
```

The Electron desktop window uses the existing CLI engine. The first launch may download the Electron runtime; subsequent launches build the small TypeScript UI and open it directly. No installer or additional terminal is needed.

1. Use the four top-level views: **Next Release**, **Edit Plan**, **Tests**, and **Runs**. Choose the session type, booking method, booking type, court count, start and duration in Edit Plan. For Test Now choose an explicit date.
2. Press **Reset & Prepare**. Test Now verifies the exact requested calendar date and a clean grid in every required browser without selecting reservation slots. Release settings are saved before preparation; Test Now fields remain independent. If a UI-owned run is active, confirm stopping it first. Retained hold and uncertain final-action protections still apply.
3. Authorize Terms for this run, then press **Run Test to QR** or **Arm Next Release**. Review the native confirmation. The test resolves actual chunk courts before confirmation; release confirms priorities, fallback starts and valid splits.
4. Keep every required dedicated Chrome window visible. Successful automation stops at one QR hold per checkout; the count is derived from booking type and court count. Payment remains manual.
5. **Emergency Stop** stops only the UI-owned command and retains uncertain state. It never cancels holds or closes Chrome.

**Dry Race** uses the same release/grid/preference path without selecting. **Observe Release** preserves the original read-only observer. **Run Safe Practice** accepts an explicit date/court/start/duration and reuses the existing select→verify→deselect→verify engine, never Proceed. Each command has the same process ownership and stop controls. Full Booking is now available because all three capability gates have recorded evidence. Select **FULL BOOKING — STOP AT QR PAYMENT**, Prepare, check the terms authorization, then **Arm Full Booking**. Its native confirmation includes the exact plan, terms YES and QR Checkout boundary. Practice and Selection Only retain their distinct stopping points.

The normal Release view always calculates the next future release in the configured timezone: before today's release it selects today; after today's release it selects tomorrow. The target date is that scheduled release calendar date plus `BOOKING_HORIZON_DAYS`. The operator may configure, Reset & Prepare, authorize Terms and **Arm Next Release** many hours in advance, including after today's cutoff for tomorrow's release.

Arming freezes the exact release timestamp, exact target date and effective configuration fingerprint, and enables Electron sleep protection. Before release the app performs its wake/reconnect phase and a fresh final preflight. It never executes late. If an already-armed timestamp is missed or the run is cancelled, that frozen run is not silently rolled to a later release; Terms and preparation are cleared and the operator must Reset & Prepare and explicitly re-arm. Relevant setting changes likewise cancel an armed run and clear Terms/preparation. This missed-armed-run rule is distinct from the normal next-future-release calculation above. Local configuration is re-read before confirmation/launch, and a worker rejects a changed plan hash. External changes cannot modify a running worker's already-loaded configuration.

The activity log streams opt-in validated `THIRSTY_EVENT` messages and sanitized child output. Periodic checks only read local CDP reachability and lock existence; they do not poll Onda. No player fields or environment editor are exposed. A reachable CDP endpoint alone does not prove the correct profile; explicit Inspect/Prepare uses the existing profile/tab validation.

Locks are deliberately retained after an aborted or failed command. The old **Reset Practice Session** diagnostic remains conservative: it refuses a recorded QR/payment hold, selected slots, or an active worker, closes and reopens only the project Chrome profile, and clears local practice page state. Use the normal **Reset & Prepare** action for current booking locks. A development abort test does not authorize silently clearing another run’s lock.

Current implementation and validation details are summarized in [REVIEW_GUIDE.md](REVIEW_GUIDE.md). Phase, investigation and performance reports are retained as dated evidence and may describe older limits or intermediate designs.

## QR handoff and retained holds

Payment Summary readiness uses its actual heading with a bounded `PAYMENT_SUMMARY_READY_TIMEOUT_MS` (default 60000); it never retries Player Proceed. Final payment-summary/terms/button checks precede a one-use final dispatch. The active interaction gate seals before that click. A separate passive observer has only a read method and a bounded `PAYMENT_HANDOFF_VERIFY_TIMEOUT_MS` (default 10000). It requires Checkout, Slot reserved for, a plausible active countdown, Pending, matching independent PHP totals, QRPH and QR canvas presence. It stops at the first complete proof. It never reads QR pixels, payloads or URLs, or uses payment controls.

A successful hold retains the filesystem lock and records only safe booking/status metadata. The panel displays the last observed countdown and timestamp, and switches to manual review once that observed countdown has elapsed locally. It never polls Onda for payment status or claims payment succeeded. Unknown final results also retain the lock and must be checked manually; never retry the final click.

For a separately authorized noncompetitive development test only, `npm run handoff:test -- --armed --authorize-terms --noncompetitive --date YYYY-MM-DD --court N --start HH:MM --duration N` requires an explicit available target and allows one selection candidate. The one test authorized for this development phase has already been used; no additional test or payment is scheduled.
# Pre-open release diagnostic

Run `npm run release:preopen-check` after today's release from a visible, clean dedicated Onda schedule and with no automation lock. It opens the normal calendar for 60 seconds, checks tomorrow's unreleased target at five checkpoints, closes the calendar and verifies unchanged booking state. It never selects a date or slot, reloads, or clicks Proceed. Failure leaves the browser and lock for review. Successful results are saved locally under ignored `DiagnosticsLocal/preopen-check-<runID>.json`.

Keep `RELEASE_PREOPEN_CALENDAR=false` until a real check passes. After a live PASS, enable only the ignored local `.env.local` setting; the global default stays false. UI stability does not prove the target will auto-enable at 08:00. Both paths retain strict target-grid validation and the immediate bounded reload fallback. See [next-release readiness](NEXT_RELEASE_READINESS.md) for the current validation status and [telemetry specification](TELEMETRY_SPEC.md) for timing summaries.

## Hybrid availability discovery

Phase 4 adds optional `AVAILABILITY_DISCOVERY_MODE=hybrid` (default: `ui`). It uses one same-browser availability GET at release and verifies candidates against the strict target-date UI. Slow or invalid discovery falls back immediately; normal UI checkout and manual payment are preserved.

Use `npm run availability:compare -- --date YYYY-MM-DD` for a read-only comparison on a clean visible schedule. `race:dry` exercises the configured discovery mode without selection. Complete live comparison and dry validation before enabling hybrid locally. See [Phase 4 implementation and validation](HYBRID_AVAILABILITY_REPORT.md).

See [Phase 7.1 validation and evidence](PHASE7_1_REPORT.md) for player routing and Payment Summary quantity checks, and [Phase 7.2](PHASE7_2_REPORT.md) for the one-button readiness transaction, independent drafts, and hold recovery model.
