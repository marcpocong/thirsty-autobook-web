# Thirsty Onda booking assistant

Windows 11 / Node 24 / TypeScript / Playwright / dedicated Chrome. All files live directly in this project root.

**Current status: inspection and practice work against live Onda. Live booking is blocked because checkout DOM and the 08:00 release have not yet been verified.** The user-authorized September 11 Court 1, 10:00–12:00 practice succeeded with zero selected cells afterward and no Proceed click. See [verified observations](VERIFIED_ONDA.md) and [engineering handoff](ONDA_AUTOMATION.md).

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

# Explicit noncompetitive selection only; never Proceed
npm run practice -- --date 2026-09-11 --court 1 --start 10:00 --duration 2

# Wait for configured release, at most two normal refreshes, read only
# Put page on TODAY before starting. No player config required.
npm run release:observe -- --armed

# Same release path plus configured preference lookup; no selection
# Requires valid .env.local booking/player settings.
npm run race:dry -- --armed

# Currently refuses before attaching: checkout evidence incomplete
npm run race -- --armed
npm run race -- --armed --authorize-terms

npm run typecheck
npm test
```

Practice requires all four explicit target arguments. If either requested slot is unavailable, it stops; it never silently picks another target. On an uncertain selection, failure or abort, inspect and clear selection manually. Only rerun practice for an appropriate noncompetitive target.

Release observation defaults to Asia/Manila, 08:00, +2 calendar days, zero lead, 15-second final preflight, 15-second per-operation timeout, at most two reloads, and 1-second retry delay. Start before final preflight. Late starts fail rather than silently switching to tomorrow. These are configurable operational defaults, **not measured release guarantees**. The observer requires `--armed` to authorize scheduled refresh/navigation. Today's grid and All Courts must be displayed at initial and final preflight. No slot click occurs in observer or dry mode.

## Booking configuration

Copy `.env.example` to `.env.local`, replace all placeholders locally, and edit exact court/time preference order and PHP maximum. Real player fields must not be committed. Zod rejects missing/invalid data before browser attachment in dry mode. Preferences are time-first, preferred courts then fallback courts, preserving configured order. Multi-hour bookings always use consecutive hours on one court. Midnight is allowed as an end boundary; crossing into a further day is rejected.

The horizon uses timezone calendar arithmetic, not `now + 48 hours`. Nonzero release lead is rejected until justified by measurements. Observation reads only release settings and ignores player data. Example values are illustrations, not live booking authorization.

## Stop controls and safeguards

Press **Q** or **Ctrl+C** in the terminal. Output: `AUTOMATION ABORTED — USER CONTROL RESTORED`. The Playwright-owning process exits; Chrome remains open. An event already sent to Chrome cannot be undone. No further recovery clicks, refreshes or deselection occur.

Exact row ISO dates, matching visible heading, complete seven-court hourly coverage, and no busy indicator are required before availability is trusted. A changed date heading alone is insufficient. Missing/contradictory slot states are UNKNOWN, never OPEN. Read [telemetry definitions](TELEMETRY_SPEC.md) before interpreting timings.

Atomic process lock prevents concurrent project commands. Failures and abrupt termination preserve `.local/automation.lock`. **Only after verifying the recorded PID is no longer running and the browser has no active selection/checkout**, remove that exact lock file:

```powershell
Get-Content .local/automation.lock
# Check the recorded PID and browser manually first.
Remove-Item -LiteralPath .local/automation.lock
```

The checkout contract tests lock after selection, validate every material summary field and PHP price, verify filled player values, and require per-run terms authorization. The final Onda action seals all future interaction before dispatch, including when the click outcome is ambiguous. Future production flow must stop at Payment Summary without `--authorize-terms`; with it, stop immediately after `Confirm & Proceed to Payment`. GCash, Maya, card entry, OTP, PIN, authentication and all payment-provider actions remain manual. There is currently no live checkout adapter.

## Pre-release checklist

- [ ] Windows automatic clock synchronization checked; clock not modified by bot.
- [ ] Plugged in; sleep prevented; stable network; no heavy downloads or updates.
- [ ] Dedicated Chrome visible, correct venue/tab, logged in if necessary.
- [ ] Today selected, All Courts shown, no selections or checkout in progress.
- [ ] Target/preferences/price/player config reviewed for dry or future live mode.
- [ ] Grid selectors verified; release defaults and zero lead reviewed.
- [ ] Q/Ctrl+C available in the terminal; user present.
- [ ] `--armed` supplied for scheduled refresh; future terms authorization reviewed per run.

## Troubleshooting and limitations

`CDP_PROFILE_OR_BIND_UNVERIFIED` / `WRONG_CHROME_PROFILE`: use the launcher from this root; check port 9222 belongs to this project's Chrome. `ONDA_TAB_AMBIGUOUS_OR_MISSING`: leave exactly one exact booking URL tab. `STALE_OR_INCOMPLETE_GRID`: allow loading to finish, check today/All Courts, then inspect again. `TARGET_DATE_UNAVAILABLE`: normal calendar disables it; do not force it. `CHROME_DISCONNECTED`: no relaunch/retry; user must prepare a new run. `TOO_LATE_FOR_PREFLIGHT`: prepare before the next intended release. Security challenges, access blocks, rate limits or Retry-After stop automation; solve permitted human steps manually and begin a separate run only when appropriate.

Respect Onda's applicable terms and venue rules. Do not defeat restrictions. No private booking APIs, backend availability payload parsing, stealth, fingerprint spoofing, proxies, floods, extra accounts, parallel booking tabs, or payment automation are used.

Tests use test-owned Chrome/Chromium and minimal synthetic HTML with all external requests blocked. `browser.close()` exists only for that test-owned browser, never the user's Chrome. CI runs install/typecheck/offline tests, never the CLI against Onda. On Linux test hosts run `npx playwright install --with-deps chromium` first.

GitHub CLI was not authenticated during setup; private repository creation/push remains pending. After `gh auth login`, inspect tracked files for secrets, then create/use PRIVATE `thirsty-autobook-web` on main. Diagnostics, profile, env files and logs are ignored.
