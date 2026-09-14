# Thirsty Onda booking assistant

Windows 11 / Node 24 / TypeScript / Playwright / dedicated Chrome. All files live directly in this project root.

The existing single-court booking flow has live evidence, including the [September 12 production run](RELEASE_RUN_REPORT_2026-09-12.md). Automation stops at the verified QR payment hold; payment remains manual. Phase 7 extends that flow with the validation boundaries documented below.


## Phase 7: Standard and Extended

The normal workflow is **configure -> Reset & Prepare -> authorize Terms -> Run Test to QR / Arm Release**. Choose **Test Now** for an exact date without waiting for release, or **Release Booking** for the scheduled run. Engineering tools remain under the collapsed **Advanced / Diagnostics** section.

| Booking type | Duration | Courts | Browsers | Checkouts / QR holds |
|---|---|---|---|---|
| Standard | 1-3 consecutive hours | 1 or 2 | A only | 1 |
| Extended | 4-6 consecutive hours | 1 or 2 | A + B | 2 |

Standard two-court bookings select both courts in one checkout. Extended splits are ranked **3+1 -> 2+2 -> 1+3** for four hours, **3+2 -> 2+3** for five, and **3+3** for six. Each court covers its entire chunk. The second chunk prefers continuity but may switch one or both courts. Fallback starts move the entire continuous block. Midnight is an allowed endpoint; crossing midnight and durations above six hours are rejected.

`BOOKING_TYPE` defaults to `standard`; `COURT_COUNT` still defaults to 1. `MAX_PRICE` is the maximum for one court in one checkout chunk. Each checkout independently enforces `COURT_COUNT * MAX_PRICE`.

Test Now resolves availability before a native confirmation shows the actual courts and chunks. The confirmation permits bounded pre-Proceed replanning within the requested range; exact courts are never substituted. Test settings do not require changing the saved release court count. Reset & Prepare and all relevant edits clear Terms authorization. No historical dual readiness/practice evidence is required for normal Test Now or Release Booking.

Test and Release use independent drafts. Test stays in memory and never writes `config.local.json`; Release Reset & Prepare validates, atomically saves, re-reads, fingerprints, and prepares the current Release fields. Status refreshes cannot replace the active Test draft with saved Release values. Normal Run Test to QR and Arm Release always mean the full visible Onda flow to the temporary QR hold boundary, regardless of the historical Advanced mode switch.

Reset & Prepare checks dedicated identities, dead owner state, current browser state and both old worker records when applicable. It resets proven pre-final state and returns to today's clean schedule. An active hold or uncertain final dispatch stays protected. Verified holds can be recovered after a conclusively inactive/expired state; a countdown elapsed on the dashboard alone is not proof. Unknown markup, missing worker identity, security challenges and wrong venue remain manual-review stops.

Preparation emits sanitized per-browser evidence and the controller accepts it only when its fingerprint matches the exact current request. Standard requires Browser A; Extended requires A+B health. Readiness is invalidated by meaningful configuration, workflow, browser, lock, hold, or release-window changes—not merely because 60 seconds passed. Countdown recovery is scoped to the unique visible `Slot reserved for` component, and a visible `00:00` must be stable across a bounded second read.

**Live validation limit:** the user verified that Onda supports two courts in one checkout, up to three hours per court. The new multi-court Review DOM adapter and simultaneous same-customer Extended holds have only offline validation in this phase. The adapter requires independently verifiable court cards and stops on unsupported markup. No real hold or release was created during implementation. See [Phase 7 details and test results](PHASE7_BOOKING_REPORT.md).

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
```

Practice requires all four explicit target arguments. If either requested slot is unavailable, it stops; it never silently picks another target. On an uncertain selection, failure or abort, inspect and clear selection manually. Only rerun practice for an appropriate noncompetitive target.

Release observation defaults to Asia/Manila, 08:00, +2 calendar days, zero lead, 15-second final preflight, 15-second per-operation timeout, at most two reloads, and 1-second retry delay. Start before final preflight. Late starts fail rather than silently switching to tomorrow. These are configurable operational defaults, **not measured release guarantees**. The observer requires `--armed` to authorize scheduled refresh/navigation. Today's grid and All Courts must be displayed at initial and final preflight. No slot click occurs in observer or dry mode.

After the release reload commits, the engine waits only for the verified venue and actionable date picker, then selects the target date directly. It does not wait for Today's grid to render. The strict target grid barrier and full snapshot validation still precede preference selection. A visible disabled target permits one bounded retry; missing or ambiguous calendar markup stops. No extra pre-release reload or calendar warm-up is added.

## Booking configuration

Use **Booking Setup** for start, duration, court order, fallback starts, PHP maximum and maximum candidate attempts. Saved release settings live in ignored `config.local.json`; the CLI loads this same object. Defaults are 08:00, 2 hours, courts 7 through 1, PHP 1,200 and 3 candidate attempts. Save invalidates readiness. Confirmation and the worker compare a plan fingerprint so the authorized plan cannot silently change.

Choose Standard or Extended independently of the court count. Use Reset & Prepare in the normal workflow. The `dual:*` commands below are retained Phase 6 diagnostics; they are not prerequisites for normal bookings.

Store real player fields only in ignored `.env.local`: `PLAYER_FULL_NAME`, `PLAYER_PHONE`, `PLAYER_EMAIL`. Extended additionally requires valid `PLAYER_B_FULL_NAME`, `PLAYER_B_PHONE`, and `PLAYER_B_EMAIL` for Checkout B. Standard uses only the primary profile. Two different profiles are a product requirement; B never falls back to A. Only configured/missing status reaches the dashboard. The dashboard reports **Configured** without sending player values to the renderer. Zod validates configuration before attachment. Primary and fallback starts use the configured court priority. Starts range from 08:00 through 23:00, with Standard supporting 1-3 consecutive hours and Extended supporting 4-6, ending no later than midnight.

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

Respect Onda's applicable terms and venue rules. Do not defeat restrictions. No private booking APIs, backend availability payload parsing, stealth, fingerprint spoofing, proxies, floods, extra accounts, parallel booking tabs, or payment automation are used.

Tests use test-owned Chrome/Chromium and minimal synthetic HTML with all external requests blocked. `browser.close()` exists only for that test-owned browser, never the user's Chrome. CI runs install/typecheck/offline tests, never the CLI against Onda. On Linux test hosts run `npx playwright install --with-deps chromium` first.

The repository is private at [marcpocong/thirsty-autobook-web](https://github.com/marcpocong/thirsty-autobook-web), on main. Diagnostics, profile, env files and logs are ignored.

## Desktop control panel

On Windows, double-click **Thirsty Bot.exe** in the project root to open the panel without a terminal. Build or refresh it with `npm run exe:build` after installing dependencies with `npm ci`. This is a local launcher, not a standalone installer: keep it with the project, installed dependencies and built `dist` folder. It uses the Node.js runtime recorded locally during the build, with PATH as a fallback. It preserves the same local configuration, browser profile, process ownership and retained automation lock. No booking is armed by launching it. The executable is included in Git; the machine-specific runtime path remains ignored. The executable is unsigned.

```powershell
npm run ui
```

The Electron desktop window uses the existing CLI engine. The first launch may download the Electron runtime; subsequent launches build the small TypeScript UI and open it directly. No installer or additional terminal is needed.

1. Choose **Test Now** or **Release Booking**, booking type, court count, start, duration and per-court maximum. For Test Now choose an explicit date.
2. Press **Reset & Prepare**. Test Now verifies the exact requested calendar date and a clean grid in every required browser without selecting reservation slots. Release settings are saved before preparation; Test Now fields remain independent. If a UI-owned run is active, confirm stopping it first. Retained hold and uncertain final-action protections still apply.
3. Authorize Terms for this run, then press **Run Test to QR** or **Arm Release**. Review the native confirmation. The test resolves actual chunk courts before confirmation; release confirms priorities, fallback starts and valid splits.
4. Keep the dedicated Chrome window(s) visible. Successful automation stops at one Standard QR hold or two Extended QR holds. Payment remains manual.
5. **Emergency Stop** stops only the UI-owned command and retains uncertain state. It never cancels holds or closes Chrome.

**Dry Race** uses the same release/grid/preference path without selecting. **Observe Release** preserves the original read-only observer. **Run Safe Practice** accepts an explicit date/court/start/duration and reuses the existing select→verify→deselect→verify engine, never Proceed. Each command has the same process ownership and stop controls. Full Booking is now available because all three capability gates have recorded evidence. Select **FULL BOOKING — STOP AT QR PAYMENT**, Prepare, check the terms authorization, then **Arm Full Booking**. Its native confirmation includes the exact plan, terms YES and QR Checkout boundary. Practice and Selection Only retain their distinct stopping points.

The countdown is informational and shows the next release after today's cutoff. The booking target remains **today in the configured timezone + horizon**; it is never silently shifted to tomorrow's plan. Arming is disabled after today's preflight cutoff. Prepare again on the intended release day. Local configuration is re-read before confirmation/launch, and a worker rejects a changed plan hash. External changes cannot modify a running worker's already-loaded configuration.

The activity log streams opt-in validated `THIRSTY_EVENT` messages and sanitized child output. Periodic checks only read local CDP reachability and lock existence; they do not poll Onda. No player fields or environment editor are exposed. A reachable CDP endpoint alone does not prove the correct profile; explicit Inspect/Prepare uses the existing profile/tab validation.

Locks are deliberately retained after an aborted or failed command. The old **Reset Practice Session** diagnostic remains conservative: it refuses a recorded QR/payment hold, selected slots, or an active worker, closes and reopens only the project Chrome profile, and clears local practice page state. Use the normal **Reset & Prepare** action for current booking locks. A development abort test does not authorize silently clearing another run’s lock.

Current implementation and validation details are in [PHASE7_BOOKING_REPORT.md](PHASE7_BOOKING_REPORT.md). Earlier reports are historical checkpoints.

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
