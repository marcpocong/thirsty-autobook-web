# Thirsty Onda booking assistant

Windows 11 / Node 24 / TypeScript / Playwright / dedicated Chrome. All files live directly in this project root.

The existing single-court booking flow has live evidence, including the [September 12 production run](RELEASE_RUN_REPORT_2026-09-12.md). That is the only release win on record, and no competing bot was contesting that release. It does not show that the proof-backed lane wins contested releases ([why](REVIEW_GUIDE.md#read-first-the-one-release-win-was-uncontested)). Automation stops at the verified QR payment hold; payment remains manual. The current tree adds API-first booking, up to seven courts, per-checkout worker isolation, richer run/QR history, a read-only release slot watch, and a one-click close for all bot browsers. Precision Release Phases 1–3 add fast pre-armed Wave 1 dispatch, release forensics, and an explicitly authorized adaptive candidate pool; they have offline verification but no live 08:00 validation. The one-off Special Friday session experiment is archived under [archive/special-friday](archive/special-friday/README.md). Start with [the current Phase 1–3 review guide](REVIEW_PHASES_1_TO_3_2026-09-24.md) for human or AI review; [REVIEW_GUIDE.md](REVIEW_GUIDE.md) covers the broader desktop application at an earlier checkpoint.


## Operator flow

Configure:

1. Open **Strategy**, confirm the target date, and enter ideal start, earliest start, latest finish, duration order and court priority.
2. Click **BUILD TARGET PLAN**, then review **PRIMARY** and backups. Known conflicts are excluded; any uncertain public evidence is labelled.
3. Choose **NORMAL** or **SHOTGUN** and use its single save action. Quick Shotgun selects #1 and searches 20 down to 1 with the real compiler and prewarm forecast; every Wave 1 attempt must be READY, with zero at risk and zero omitted.
4. Confirm **NORMAL STRATEGY SAVED ✓** or **SHOTGUN SAVED ✓**, read **What will happen at 8:00 AM?**, then **GO TO NEXT RELEASE**. The review is read-only and requires no second save.

Run:

1. Open **Next Release** and confirm the compact **Saved strategy** card.
2. Select **Prepare for Release**. When preparation is complete, authorize Onda Terms for that exact run and select **Arm Release**.
3. Use **Live** for the human-readable result and grouped target attempts. Payment always remains manual; the bot stops at QR.

Normal operator choices are visible first. Exact timing, worker groups, preparation assumptions, compiled authorization, calibration and raw forensics remain available in collapsed technical drawers. The saved compiled plan—not the summary text—is authoritative.

## Strategy Engine V2 (current)

The normal Precision workflow is one strategy: immediate logical targets with independently tracked fan-out children, adaptive Wave 2 backups and Reopen Rescue, all compiled into the single saved authorization (`PRECISION_PHASE3`).

- **Strategy** view: Booking goal → Target plan → Release mode (**Normal** or **Shotgun**) → read-only Review & Continue. Suggestions and editable targets share the Target step. Dense Core is a bounded, independently tracked, resource-aware release-attempt schedule concentrated on selected immediate targets. Its budget, Equal / Priority weighted / Custom allocation, signed timing window and exact triggers compile into the same `PRECISION_PHASE3`; unselected immediate targets remain normal Wave 1. Matching real-release telemetry calibrates the group anchor without using HTTP response order.
- Smart plans use the venue's fixed PHP 700 hourly schedule for every covered hour from 4 PM onward, regardless of day, so an evening-only plan needs no rate review. A plan containing any hour before 4 PM still requires a confirmed daytime rate for its target date.
- **Next Release** states the saved strategy; **Live** shows attempts by logical target with children, prewarm tiers and Rescue predictions; **History & Insights** holds runs, forensics, Release Lab, fan-out capacity, offset calibration and reopen-prediction accuracy; **Tools** holds diagnostics, build information and test booking tools.
- **Release Precision V3** keeps that architecture and tightens local execution: only fresh (≤30 days) real-release timing calibrates Auto, with one vote per release; a bounded (±12 ms) worker/index de-skew learned only from each worker's own invocation → Chrome lag; a `RELEASE_CRITICAL_LOCKDOWN` window that defers nonessential runner work from T−1 s until the POSTs have left; Slot Watch in its own observer process; and a Release Readiness Gate (READY / READY WITH WARNINGS / NOT READY) on Next Release. Auto fan-out stays at the machine recommendation and renderer-resident dispatch stays experimental. See [docs/RELEASE_PRECISION_V3.md](docs/RELEASE_PRECISION_V3.md).
- Details: [docs/STRATEGY_ENGINE_V2.md](docs/STRATEGY_ENGINE_V2.md), [docs/RESCUE_V2.md](docs/RESCUE_V2.md), [docs/FANOUT_CAPACITY_BENCHMARK.md](docs/FANOUT_CAPACITY_BENCHMARK.md), [docs/BUILD_AND_RELEASE.md](docs/BUILD_AND_RELEASE.md). Historical reports are indexed in [docs/INDEX.md](docs/INDEX.md).
- Build and install with `npm run release:build` (typecheck, tests, clean build, dist verification, packaging, build metadata). The running build's SHA is shown in the app.

The sections below describe the underlying booking engine; view names were updated for the V2 layout.

## Current booking model

The normal workflow is **configure → Reset & Prepare → authorize Terms → Run Test to QR / Arm Next Release**. Choose **Test Now** for an exact date without waiting for release, or **Release Booking** for the scheduled run. Legacy browser-mode engineering tools live in the **Tools** view.

| Booking type | Duration | Courts | Browsers | Checkouts / QR holds |
|---|---|---|---|---|
| Standard | 1-3 consecutive hours | 1-7 | `ceil(courts / 2)` | `ceil(courts / 2)` |
| Extended | 4-6 consecutive hours | 1-7 | `2 × ceil(courts / 2)` | `2 × ceil(courts / 2)` |

Each checkout contains at most two courts. Standard uses one time block and groups requested courts in pairs. Extended uses two time blocks, ranked **3+1 -> 2+2 -> 1+3** for four hours, **3+2 -> 2+3** for five, and **3+3** for six; each time block is also grouped into at-most-two-court checkouts. Each checkout has a distinct player/browser identity. Fallback starts move the entire continuous block. Midnight is an allowed endpoint; crossing midnight and durations above six hours are rejected.

`BOOKING_TYPE` defaults to `standard`; `COURT_COUNT` defaults to 1. The current normal UI has no configurable price ceiling: it reports the observed amount and validates that exact amount again before final authorization. `MAX_PRICE` remains a compatibility field for older CLI/test paths and defaults to no ceiling.

Test Now resolves availability before a native confirmation shows the actual courts and chunks. The confirmation permits bounded pre-Proceed replanning within the requested range; exact courts are never substituted. Test settings do not require changing the saved release court count. Reset & Prepare and all relevant edits clear Terms authorization. No historical dual readiness/practice evidence is required for normal Test Now or Release Booking.

Test and Release use independent drafts. Test stays in memory and never writes `config.local.json`; Release Reset & Prepare validates, atomically saves, re-reads, fingerprints, and prepares the current Release fields. Status refreshes cannot replace the active Test draft with saved Release values. Normal Run Test to QR and Arm Next Release both stop at the official temporary QR hold boundary, regardless of the historical Advanced mode switch.

**Proofless Direct** is now a separate Test/Release method. The standalone read-only block checker accepts any date without a saved plan, players, browser preparation, or Terms authorization. It combines Onda date availability with `/api/public/spaces/bookings` for every court and reports all 112 court/hour states with their source. Proofless preparation uses the same evidence to resolve the first saved court/time configuration that has no confirmed block. A public booking record overrides an unreleased/missing availability cell as `BLOCKED`; `UNKNOWN` means a source failed or supplied no authoritative state and fails closed. An armed 08:00 Release refreshes that dual-source audit at 07:30, prewarms the genuine browser security context, and dispatches the resolved one-shot checkout at the release boundary without slot proofs. Daytime rates are assumed at PHP 600/hour and evening rates at PHP 700/hour; the response must match the exact requested courts, hours, amount, pending state, and hold expiry or the result remains fail-closed. Proofless Test submits the exact configured cells only after the operator manually confirms they are currently open. API-First remains the proof-based method. A confirmed rejection is never retried automatically, and an unknown outcome retains the lock for reconciliation.

Release time is driven by a persisted in-app offset from Google Public NTP (`time.google.com`), not by changing the Windows clock. Use **Sync with Google Time** before arming; stale or missing network synchronization blocks Release arming.

**Release Offset** (Strategy → Advanced overrides, Proofless Direct only) lets the operator choose any whole-millisecond lead from 0 (Normal) through 2000 ms before the official release time. In Precision Release each attempt has its own **Send early by** value (Fixed rows and Smart immediate attempts), so some attempts can go early while others stay Normal; attempts fire at their own triggers, earliest first. A General Proofless release has one plan-wide Release Offset instead. Offsets are saved with the plan, frozen with the Precision set and part of the armed plan fingerprint, so changing one after arming stops the run; the arming confirmation and Activity list each one. Everything else stays on the official release: journals, the lock, Slot Watch, forensics, Smart backups and reopened-slot attempts, and the one-second maximum-lateness window. API-First and browser modes always wait for the release.

**Fixed Precision fan-out** (legacy) remains under Advanced overrides. Each configured worker may use `1..PRECISION_MAX_FAN_OUT` (currently six) independently tracked tabs/security contexts for its own court/start/duration goal. Counts and review text are derived from the saved arrays, never a hard-coded width.

**Quick Shotgun** is the default release-day Shotgun workflow. One action configures and saves through the existing save path, verifies the saved authorization, and shows the next step. It recalculates only the Smart `advanced.total` override for the new Wave 1 allocation; explicit standby, Wave 2 and Rescue overrides are preserved and remain compile blockers if incompatible. Target, order, date, available-worker, browser/readiness, profile/history, calibration and plan changes invalidate its session forecast proof. Refresh and save again before relying on the forecast; reopening the app shows **SHOTGUN NEEDS REFRESH** and requires a fresh quick application. The persisted Quick marker describes origin only and never serves as preparation evidence. Manual edits are labelled **CUSTOM SHOTGUN** and are replaced only by an explicit quick action.

**Advanced Shotgun Settings** retains the manual controls, closed by default. The operator selects logical immediate targets by stable court/time/duration identity, chooses a total budget and a signed pre-release window (−2000 through 0 ms; positive offsets are rejected), then chooses Equal, deterministic priority-weighted, or exact Custom allocation. A logical target needing more than six shots is split across deterministic worker groups, while every worker group remains capped by `PRECISION_MAX_FAN_OUT`. Capacity warnings use local spacing evidence; Save blocks an unsafe squeeze unless the explicit override is selected. Child readiness is individual, omitted preparation is `PREWARM_TIER_OMITTED`, and a verified hold, UNKNOWN outcome, or HTTP 429/throttle suppresses later same-target shots as `NOT_DISPATCHED`. Confirmed rejection allows the schedule to continue. Wave 2 and Rescue budgets remain visible and Rescue retains its fresh-reopening rules.

Strategy Review and Next Release also forecast whether the exact saved Wave 1 authorization can be security-prepared in time. The model uses compatible local preparation p95 (or the documented fallback), the exact children and signed triggers, worker groups, tier barriers, concurrency, cutoff and 120-second freshness bound. It shares its scheduling decision core with production prewarm. Projected omissions block arming; the app never silently drops children, changes offsets or reduces the Shotgun budget. Custom coincident triggers are identified explicitly and remain unchanged.

**Release Lab** is a collapsed advanced section inside the Smart Precision editor. Its optional Duration × Offset preset changes only the duration and release offset of immediate rows the operator already configured; it never creates, moves, or reassigns a target, and the normal overlap/rate/worker validation remains authoritative. A labelled experiment is frozen as separate analysis-only metadata beside the Phase 3 freeze. After ordinary release forensics completes, a versioned derived report is written to `.local/release-lab/<run-id>/summary.json` and `report.md`, joining sanitized dispatch/provider timing, duration and offset groups, neutral movement clusters, blanket-like Slot Watch transitions, and reopen opportunities. Raw logs remain authoritative. Rebuild a report with `npm run release-lab:rebuild -- <run-id>`.

Adaptive Wave 2/Rescue accepts cached availability only when an integer HTTP `Age` provides a conservative upper bound: `(Age + 1 second)` at response time plus elapsed time since the response. That bound must fit the same adaptive freshness budget as a fresh read. Unknown age, incomplete/outdated/unreleased evidence, and evidence that ages out during security preparation remain non-actionable; final pre-POST revalidation still uses the newest observation.

Reset & Prepare checks dedicated identities, dead owner state, current browser state and both old worker records when applicable. It resets proven pre-final state and returns to today's clean schedule. An active hold or uncertain final dispatch stays protected. Verified holds can be recovered after a conclusively inactive/expired state; a countdown elapsed on the dashboard alone is not proof. Unknown markup, missing worker identity, security challenges and wrong venue remain manual-review stops.

If a preferred local debugging port is already owned by another application or an unverifiable Chrome session, Reset & Prepare leaves that process untouched, allocates a distinct loopback-only fallback endpoint, records it for every subsequent Test and Release process, and starts the same dedicated Thirsty Bot profile there. Repeated preparation reuses the recorded endpoint. The standalone Start Chrome diagnostic remains fail-closed on conflicts.

Preparation emits sanitized per-browser evidence and the controller accepts it only when its fingerprint matches the exact current request. The required browser set is derived from booking type and court count, from A for a one- or two-court Standard plan through A-H for a seven-court Extended plan. Readiness is invalidated by meaningful configuration, workflow, browser, lock, hold, or release-window changes—not merely because 60 seconds passed. Countdown recovery is scoped to the unique visible `Slot reserved for` component, and a visible `00:00` must be stable across a bounded second read.

**Validation boundary:** Onda has been live-verified for at most two courts and three consecutive hours per checkout. Higher court counts are split across independent checkouts and have offline test coverage, but the complete multi-browser combinations are not all live-validated. The adapter requires independently verifiable booking identities and amounts and stops on unsupported markup or uncertain submission outcomes. See [REVIEW_GUIDE.md](REVIEW_GUIDE.md) for the current risk map and [PHASE7_BOOKING_REPORT.md](PHASE7_BOOKING_REPORT.md) for the older Phase 7 evidence.

## Release slot watch

Every armed release (API-first, Proofless Direct, or browser mode) automatically starts a **read-only slot watch** in the desktop app. **Watch next release** in the **Live** view starts one without booking anything. It reads Onda's public availability for all 112 court/hours of the target date from 60 seconds before release until 15 minutes after: scheduled reads at T+0, +0.25, +0.5, +1, +2 and +5 s, then every 1 s to one minute, every 5 s to five minutes, and every 30 s to 15 minutes, with up to six availability reads in flight. If the target date is still absent after +2 s, a temporary 500 ms publication burst runs until it appears. Operational state uses the freshest conservatively bounded response, so a newer stale response cannot replace fresher evidence. Onda's public booking records are read every 2 s through +30 s, every 5 s through +2 min, every 15 s through +9.5 min, and every 2 s in dynamically predicted 10-minute expiry windows. Configured Precision candidates are tracked directly, safe cache/edge metadata is retained, and each completed watch writes a quality report covering latency, cache mix, contradictions, reopening confidence, candidates, and booking-read coverage. These records can show a booking exists; they cannot prove the reason for an unavailable slot. Slot Watch never touches a browser, lock, hold, or checkout. It runs in a dedicated read-only observer child process started by the app (never in the booking runner), so its reads cannot compete with release dispatch on one event loop, and it keeps observing after the booking run itself has finished or failed. If the observer crashes or disconnects, the Live view shows it as degraded; Wave 2 and Rescue then receive no new evidence and stay fail-closed.

Every timestamp uses the Google-synchronized network clock. Each read records its request and response times, latency, time since release, and the exact 112-cell matrix (`O` open, `X` taken/unavailable, `U` not yet released, `?` unknown). Each cell change records when it was first seen and the window since the previous read, which bounds when it actually happened. Files are written under `.local/slot-watch/`:

- `<date>_<id>.ndjson` — every read and every per-cell transition.
- `<date>_<id>.txt` — a plain-text report: when the date became visible, each slot taken after opening (fastest first), slots already unavailable at the first read (with or without a booking record, i.e. likely venue block), slots that reopened (for example unpaid holds expiring), and the final matrix.
- `<date>_<id>.summary.json` — the summary shown under **Previous release watches**.

The Live view shows the live matrix with the time of each cell's last change, cells held by this bot outlined, and a change timeline. Emergency Stop or cancelling an armed release before it happens also cancels that release's watch; an operator-started watch runs until its window ends or **Stop watching**. Closing the app stops the watch and writes its report. The booking runner's own availability reads also log the same matrix format (`AVAILABILITY_REQUEST_COMPLETED` / `RELEASE_AVAILABILITY_MATRIX`) in `.local/api-booking/run-progress/`.

## Closing the bot browsers

**Close all** in the header (also **Close all bot browsers** in **Tools**) closes every Chrome window the bot started and nothing else. A bot browser is a Chrome browser process whose `--user-data-dir` lives in this installation's `.local` folder (the A–H profiles, the practice profile, and investigation profiles). Your normal Chrome profile is never matched. It asks for confirmation first and warns when QR payment pages are still open: closing does not cancel those holds on Onda, but the QR page is lost. It is blocked while a run is active or a release is armed. Windows are closed gracefully first and force-closed only if they do not respond. **Reset & Prepare** reopens the browsers a run needs. The header shows browsers A–H; click an open one to bring it to the front.

## Special Friday session (archived)

The release-only A–H Special Friday session was a one-off experiment for the 2026-09-25 release and has been retired from the app, the saved-plan schema and the booking runner. Older saved plans that still contain `SESSION_MODE` load as normal plans. Its reports, the standalone modules, and their tests are preserved in [archive/special-friday](archive/special-friday/README.md), which also explains how to find the last fully integrated version in Git.

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

The offline suite (122 files, 1327 tests on 2026-09-29) runs in CI on every push together with a clean build and the source-vs-dist check. It must stay network-isolated: it uses fixtures and test-owned Chromium, never a live booking. `npm run exe:build` is a Windows packaging/deployment command; it refreshes the parent installation as well as the launcher and should be run only when that local installation update is intended.

Practice requires all four explicit target arguments. If either requested slot is unavailable, it stops; it never silently picks another target. On an uncertain selection, failure or abort, inspect and clear selection manually. Only rerun practice for an appropriate noncompetitive target.

Release observation defaults to Asia/Manila, 08:00, +2 calendar days, zero lead, 15-second final preflight, 15-second per-operation timeout, at most two reloads, and 1-second retry delay. Start before final preflight. Late starts fail rather than silently switching to tomorrow. These are configurable operational defaults, **not measured release guarantees**. The observer requires `--armed` to authorize scheduled refresh/navigation. Today's grid and All Courts must be displayed at initial and final preflight. No slot click occurs in observer or dry mode.

After the release reload commits, the engine waits only for the verified venue and actionable date picker, then selects the target date directly. It does not wait for Today's grid to render. The strict target grid barrier and full snapshot validation still precede preference selection. A visible disabled target permits one bounded retry; missing or ambiguous calendar markup stops. No extra pre-release reload or calendar warm-up is added.

## Booking configuration

Use **Strategy** (normally Booking Goal → Target Plan → Release Mode → Save → Next Release; raw engine controls under **Advanced strategy settings**) for session type, booking method, booking type, court count, start, duration, court order, fallback starts and maximum candidate attempts. Saved release settings live in ignored `config.local.json`; the CLI loads this same object. Defaults are 08:00, 2 hours, courts 7 through 1 and 3 candidate attempts. Save invalidates readiness. Confirmation and the worker compare a plan fingerprint so the authorized plan cannot silently change.

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

- [ ] Google network clock synchronized in the UI; Windows clock is not modified by the bot.
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

1. Use the five top-level views: **Next Release**, **Strategy**, **Live** (attempts by logical target and the release slot watch), **History & Insights** (runs, forensics and analysis), and **Tools** (build information, bot browsers, block audit, test booking tools and legacy diagnostics). The header always shows the network clock, bot browsers A–H with **Close all**, the automation lock, and the slot watch. Choose the booking method, booking type, court count, start and duration under Strategy → Advanced overrides. For Test Now choose an explicit date.
2. Press **Reset & Prepare**. Test Now verifies the exact requested calendar date and a clean grid in every required browser without selecting reservation slots. Release settings are saved before preparation; Test Now fields remain independent. If a UI-owned run is active, confirm stopping it first. Retained hold and uncertain final-action protections still apply.
3. Authorize Terms for this run, then press **Run Test to QR** or **Arm Next Release**. Review the native confirmation. The test resolves actual chunk courts before confirmation; release confirms priorities, fallback starts and valid splits.
4. Keep every required dedicated Chrome window visible. Successful automation stops at one QR hold per checkout; the count is derived from booking type and court count. Payment remains manual.
5. **Emergency Stop** stops only the UI-owned command and retains uncertain state. It never cancels holds or closes Chrome; use **Close all** for that.

**Dry Race** uses the same release/grid/preference path without selecting. **Observe Release** preserves the original read-only observer. **Run Safe Practice** accepts an explicit date/court/start/duration and reuses the existing select→verify→deselect→verify engine, never Proceed. Each command has the same process ownership and stop controls. Full Booking is now available because all three capability gates have recorded evidence. Select **FULL BOOKING — STOP AT QR PAYMENT**, Prepare, check the terms authorization, then **Arm Full Booking**. Its native confirmation includes the exact plan, terms YES and QR Checkout boundary. Practice and Selection Only retain their distinct stopping points.

The normal Release view always calculates the next future release in the configured timezone: before today's release it selects today; after today's release it selects tomorrow. The target date is that scheduled release calendar date plus `BOOKING_HORIZON_DAYS`. The operator may configure, Reset & Prepare, authorize Terms and **Arm Next Release** many hours in advance, including after today's cutoff for tomorrow's release.

Arming freezes the exact release timestamp, exact target date and effective configuration fingerprint, and enables Electron sleep protection. Before release the app performs its wake/reconnect phase and a fresh final preflight. It never executes late. If an already-armed timestamp is missed or the run is cancelled, that frozen run is not silently rolled to a later release; Terms and preparation are cleared and the operator must Reset & Prepare and explicitly re-arm. Relevant setting changes likewise cancel an armed run and clear Terms/preparation. This missed-armed-run rule is distinct from the normal next-future-release calculation above. Local configuration is re-read before confirmation/launch, and a worker rejects a changed plan hash. External changes cannot modify a running worker's already-loaded configuration.

The activity log streams opt-in validated `THIRSTY_EVENT` messages and sanitized child output. Periodic checks only read local CDP reachability and lock existence; outside a release slot watch they do not poll Onda. No player fields or environment editor are exposed. A reachable CDP endpoint alone does not prove the correct profile; explicit Inspect/Prepare uses the existing profile/tab validation.

Locks are deliberately retained after an aborted or failed command. The old **Reset Practice Session** diagnostic remains conservative: it refuses a recorded QR/payment hold, selected slots, or an active worker, closes and reopens only the project Chrome profile, and clears local practice page state. Use the normal **Reset & Prepare** action for current booking locks. A development abort test does not authorize silently clearing another run’s lock.

Current implementation and validation details are summarized in [REVIEW_GUIDE.md](REVIEW_GUIDE.md). Phase, investigation and performance reports are retained as dated evidence and may describe older limits or intermediate designs. The [server-side arbitration investigation](SERVER_ARBITRATION_INVESTIGATION.md) explains why the 2026-09-25 release checkouts were answered 409 after ~30 s and ranks the next safe experiments.

## QR handoff and retained holds

Payment Summary readiness uses its actual heading with a bounded `PAYMENT_SUMMARY_READY_TIMEOUT_MS` (default 60000); it never retries Player Proceed. Final payment-summary/terms/button checks precede a one-use final dispatch. The active interaction gate seals before that click. A separate passive observer has only a read method and a bounded `PAYMENT_HANDOFF_VERIFY_TIMEOUT_MS` (default 10000). It requires Checkout, Slot reserved for, a plausible active countdown, Pending, matching independent PHP totals, QRPH and QR canvas presence. It stops at the first complete proof. It never reads QR pixels, payloads or URLs, or uses payment controls.

A successful hold retains the filesystem lock and records only safe booking/status metadata. The panel displays the last observed countdown and timestamp, and switches to manual review once that observed countdown has elapsed locally. Each verified QR card also provides **Show Browser X**, which restores, maximizes, and brings that checkout's exact dedicated Chrome window to the front. It never polls Onda for payment status or claims payment succeeded. Unknown final results also retain the lock and must be checked manually; never retry the final click.

For a separately authorized noncompetitive development test only, `npm run handoff:test -- --armed --authorize-terms --noncompetitive --date YYYY-MM-DD --court N --start HH:MM --duration N` requires an explicit available target and allows one selection candidate. The one test authorized for this development phase has already been used; no additional test or payment is scheduled.
# Pre-open release diagnostic

Run `npm run release:preopen-check` after today's release from a visible, clean dedicated Onda schedule and with no automation lock. It opens the normal calendar for 60 seconds, checks tomorrow's unreleased target at five checkpoints, closes the calendar and verifies unchanged booking state. It never selects a date or slot, reloads, or clicks Proceed. Failure leaves the browser and lock for review. Successful results are saved locally under ignored `DiagnosticsLocal/preopen-check-<runID>.json`.

Keep `RELEASE_PREOPEN_CALENDAR=false` until a real check passes. After a live PASS, enable only the ignored local `.env.local` setting; the global default stays false. UI stability does not prove the target will auto-enable at 08:00. Both paths retain strict target-grid validation and the immediate bounded reload fallback. See [next-release readiness](NEXT_RELEASE_READINESS.md) for the current validation status and [telemetry specification](TELEMETRY_SPEC.md) for timing summaries.

## Hybrid availability discovery

Phase 4 adds optional `AVAILABILITY_DISCOVERY_MODE=hybrid` (default: `ui`). It uses one same-browser availability GET at release and verifies candidates against the strict target-date UI. Slow or invalid discovery falls back immediately; normal UI checkout and manual payment are preserved.

Use `npm run availability:compare -- --date YYYY-MM-DD` for a read-only comparison on a clean visible schedule. `race:dry` exercises the configured discovery mode without selection. Complete live comparison and dry validation before enabling hybrid locally. See [Phase 4 implementation and validation](HYBRID_AVAILABILITY_REPORT.md).

See [Phase 7.1 validation and evidence](PHASE7_1_REPORT.md) for player routing and Payment Summary quantity checks, and [Phase 7.2](PHASE7_2_REPORT.md) for the one-button readiness transaction, independent drafts, and hold recovery model.

Quick Shotgun does not prepare, authorize Terms, arm or send requests. Continue through the existing Next Release flow: **Prepare for Release → Authorize Terms → Arm Release**. Provider throttle/HTTP 429, UNKNOWN and target-success stops, send/fan-out limits, the arm gate, automation lock and manual payment boundary are unchanged.

The read-only known-bookings check reports completion time and availability failures, including HTTP 403/429. Confirmed public bookings remain visible; missing or failed availability stays UNKNOWN. The check makes one parallel batch without automatic retries or access-control bypasses. Its button is disabled while a check runs and its loading label clears on completion or failure.

### Strategy operator flow

Set **Ideal start**, **Earliest acceptable start**, **Latest finish**, duration preference and court priority, then press **BUILD TARGET PLAN**. This single action attempts the read-only public schedule check, loads usable same-weekday history, ranks targets and applies the plan. Ideal start is explicit; older goals migrate to their previously displayed start (or explicit preferred start). Target ranking has no worker, fan-out, preset or release-mode input.

Confirmed conflicts are excluded. Unchecked evidence is `NOT_CHECKED`; failed reads remain unverified and produce a warning while preference/history planning continues. No missing public record is called open. NONE/LIMITED history leaves preference ranking unchanged; usable history reports its comparable-release count. Manual target editing is behind **EDIT TARGETS**; conflict overrides and technical execution controls remain in the closed **Advanced strategy settings** area.

Choose **NORMAL** and **SAVE NORMAL STRATEGY**, or **SHOTGUN** and **APPLY & SAVE SHOTGUN**. Quick Shotgun concentrates Wave 1 on rank #1: all other immediate choices move to backups/rescue. Its N attempts mean N total initial sends. Expert custom Shotgun can retain extra immediate targets; inspect the total configured Wave 1 forecast in Advanced. Quick fitting still requires every configured attempt READY, with no AT_RISK or omitted attempts, and verifies the saved authorization and unchanged dependencies. Edits invalidate saved status; changed Quick dependencies require refresh.

After saving, use **GO TO NEXT RELEASE**. Prepare → Authorize Terms → Arm → Waiting remains in Next Release. Building and saving Strategy never prepares browsers, authorizes Terms, arms, books or pays.

The four Strategy steps are Booking goal, Target plan, Release mode, Review & Continue. The visible 8:00 AM review is read-only; it never asks for a second save. Target edits, evidence modes, timing, allocations and compiler details live in one collapsed Advanced area. Quick Shotgun returns only incompatible attempt-limit/reserved-browser overrides to automatic defaults and records the changed fields. Custom Shotgun uses SAVE CUSTOM SHOTGUN; REPLACE WITH QUICK SHOTGUN explicitly replaces manual settings.

Release-day sequence: open Strategy → enter booking goal → Build Target Plan → review PRIMARY and backups → choose Normal or Shotgun → save that mode → confirm the 8:00 AM review → Go to Next Release → Prepare for Release → Authorize Terms → Arm Release.

Ranking orders evidence as published open, no known conflict, unchecked, then failed public read. UNKNOWN has a negative evidence score and is never called open. Allocation preserves rank #1 and diversifies additional distinct-court targets within the same duration, evidence quality and a ten-point preference band, considering clock overlap and usable same-weekday co-unavailability. Three well-observed comparable releases are required before history affects ranking. The legacy replay adapter shares this portfolio implementation while retaining its fail-closed unknown-read policy.

When a newly built Normal target plan outgrows old attempt limits, SAVE NORMAL STRATEGY previews and resets only the incompatible Wave 2, Rescue or total limits to automatic values. The visible summary states the resulting budget before saving. Valid overrides, targets, worker reservations, rates and readiness/authorization gates stay unchanged; other compiler blockers still prevent saving.

Rebuilding targets preserves Quick Shotgun provenance and offers REFRESH & SAVE SHOTGUN for the new #1 target. It does not relabel Quick as Custom or establish readiness. Actual manual Custom edits remain Custom and are never automatically replaced.
