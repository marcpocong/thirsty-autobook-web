# Thirsty Pickle Bot — Special Friday Readiness Assessment

| | |
|---|---|
| **Prepared** | Wednesday 2026-09-23, 05:14 Manila time (UTC+8) |
| **Release under review** | **Today, 2026-09-23 at 08:00:00 Asia/Manila** |
| **Booking target** | **Friday 2026-09-25**, Special Friday session (Browsers/Players A–H) |
| **Repository state** | `Source/` on `main` at `2969311` (2026-09-23 04:23), clean working tree, no stash |
| **Installation reviewed** | `<install folder>` (the folder containing this report) |
| **Type of review** | Independent, read-only technical assessment. No code, config, lock, or booking changes. |

---

## Contents

1. [How to read this report](#1-how-to-read-this-report)
2. [Executive summary](#2-executive-summary)
3. [Scope and method](#3-scope-and-method)
4. [Current state of the installation](#4-current-state-of-the-installation)
5. [How a Special Friday run actually works](#5-how-a-special-friday-run-actually-works)
6. [The 7:50 early-release window](#6-the-750-early-release-window)
7. [The 08:00 official release](#7-the-0800-official-release)
8. [Scenario matrix: when availability appears](#8-scenario-matrix-when-availability-appears)
9. [Lane-by-lane expected behavior](#9-lane-by-lane-expected-behavior)
10. [Safety analysis: duplicates, incomplete reservations, total failure](#10-safety-analysis)
11. [Detailed findings](#11-detailed-findings)
12. [Risk ranking](#12-risk-ranking)
13. [Probability of success](#13-probability-of-success)
14. [Evidence review: tests, run history, diagnostics](#14-evidence-review)
15. [Implemented vs. proven](#15-implemented-vs-proven)
16. [Documentation vs. code discrepancies](#16-documentation-vs-code-discrepancies)
17. [Readiness verdict](#17-readiness-verdict)
18. [What to do before 08:00](#18-what-to-do-before-0800)
19. [During the run: what to watch and when to take over](#19-during-the-run)
20. [After the run](#20-after-the-run)
21. [Longer-term recommendations](#21-longer-term-recommendations)
- [Appendix A — Glossary](#appendix-a--glossary)
- [Appendix B — Key constants](#appendix-b--key-constants)
- [Appendix C — Run history](#appendix-c--run-history)
- [Appendix D — Measured timings](#appendix-d--measured-timings)
- [Appendix E — Durable journal inventory](#appendix-e--durable-journal-inventory)
- [Appendix F — Read-only checks performed](#appendix-f--read-only-checks-performed)

---

## 1. How to read this report

Every factual claim is tagged with how it is known:

| Tag | Meaning |
|---|---|
| **[LIVE]** | Proven against the real Onda site in a recorded run (trace, journal, or retained lock record). |
| **[TODAY]** | Checked by me during this review (this morning), read-only. |
| **[CODE]** | Established by reading the current source. Code behavior, not observed runtime behavior. |
| **[OFFLINE]** | Covered by the automated offline test suite (fixtures and mocks, no Onda). |
| **[ASSUMED]** | Relied on by the design but not demonstrated. |
| **[UNTESTED]** | Never executed live, and not covered by tests. |

Code references point to `Source/…` (the git repository). The installed copy under `src/`, `ui/`, and `scripts/` is byte-for-byte identical to `Source/`. **[TODAY]**

---

## 2. Executive summary

**Verdict: not ready to arm right now. After the operational fixes in [Section 18](#18-what-to-do-before-0800) it can be armed, but it should be treated as a best-effort attempt with a manual backup, not as something to depend on.**

### Estimated likelihood

| Outcome | Estimate |
|---|---|
| **Full A–D core session held and paid** (4 holds, 2 courts, 17:00–23:00) | **~40%** (plausible range 25–55%) |
| At least one hold of any kind | ~60% |
| E/F held | ~20% |
| G/H held | ~20% |
| All eight holds (A–H) | ~5% |
| No holds at all | ~40% |

Confidence in these numbers is **low**. The Special Friday run has never executed past its waiting stage, and there is exactly one API-first 08:00 release on record (it failed).

### Why

- **The Special Friday live path has never run.** All three armed Special Friday runs were aborted by the user while waiting. None reached 07:50. **[LIVE]**
- **The code that combines the lanes (`desktop-runner.ts`) has zero automated tests.** The 812 passing tests cover only helpers. **[TODAY]**
- **Real 08:00 releases: 1 success in 4 attempts.** The one API-first release attempt (Sep 22) found nothing bookable in its first 3.9 s. **[LIVE]**
- **The bot's post-08:00 availability window is short.** Five reads over about 4–6 s. If Onda opens the date later than that, A–D and G/H never dispatch. **[CODE]**
- **The A–D security check is all-or-nothing.** One browser failing stops all four, and G/H with them. **[CODE]**
- **E/F relies at 08:00 on a proofless request the bot has never sent.** **[UNTESTED]**
- **The PC clock is 330–340 ms behind** and Windows Time reports it is not synchronizing. **[TODAY]**
- **Each hold expires 10 minutes after creation**, and payment for up to eight QR codes is manual. **[LIVE]**

### What is solid

- Proof-based API checkout works: 57 verified pending holds across 17 Test Now runs, with up to 6 browsers at once. **[LIVE]**
- The 08:00 trigger fires on time: +3 ms on Sep 22, +10 ms on Sep 12. **[LIVE]**
- Duplicate-booking protection is well built. E/F's two request paths cannot both dispatch, and lanes cannot share a court. **[CODE] [OFFLINE]**
- Lock recovery through Reset & Prepare has worked 13 times. **[LIVE]**
- Typecheck and all 812 tests pass at the current commit. **[TODAY]**

### Top five risks (details in [Section 12](#12-risk-ranking))

1. Short post-08:00 availability window. A late release means zero A–D and G/H.
2. All-or-nothing A–D security check that depends on Onda's current page code, with windows hidden for hours.
3. Lane orchestration never run live, not tested, with one confirmed race condition.
4. The 7:50 early path can spend each lane's only attempt with no retry at 08:00.
5. Ten-minute holds and up to eight manual QR payments lead to incomplete reservations.

---

## 3. Scope and method

### What I reviewed

- **Documents:** `README.md`, `REVIEW_GUIDE.md`, `SPECIAL_FRIDAY_RELEASE_REPORT_2026-09-23.md`, `RELEASE_RUN_REPORT_2026-09-12.md`, `API_8AM_BOTTLENECK_REPORT.md`, `RELEASE_CRITICAL_PATH_TELEMETRY_REPORT.md`.
- **All booking, scheduling, checkout and recovery modules**, read line by line where they affect the Special Friday path:
  - `desktop-runner.ts`, `special-session.ts`, `special-direct-checkout.ts`, `adaptive-direct-lane.ts`;
  - `browser-session-transport.ts`, `calendar-free-checkout.ts`, `calendar-free-security-context*.{ts,js}`;
  - `two-hour-reservation.ts`, `slot-proofs.ts`, `public-checkout.ts`, `durable-submission-journal.ts`;
  - `api-lock-outcome.ts`, `api-automation-lock.ts`, `live-availability-provider.ts`, `availability-parser.ts`;
  - `local-customer.ts`, `config.ts`, `browser.ts`, `browser-window.ts`, `booking-prepare.ts`;
  - `ui/controller.ts`, `ui/processes.ts`, `ui/locks.ts`, `ui/main.ts`, `scripts/start-onda-chrome.ps1`.
- **Runtime state:**
  - lock files;
  - 98 run-progress traces;
  - 45 durable submission journals;
  - 13 retained-hold archives;
  - Chrome/CDP listeners;
  - clock, power, and saved configuration.
- **Test suite:** the offline suite, re-run at the current commit.

### What I did not do

- No change to the repository, installation, `config.local.json`, `.env` files, locks, journals, or browser profiles.
- No Reset & Prepare, arming, Test Now, slot selection, checkout request, or reservation.
- No clock change.

The typecheck and tests ran in an isolated copy in a temporary folder, without your private `.env.local` or `config.local.json`. All read-only network checks are listed in [Appendix F](#appendix-f--read-only-checks-performed).

---

## 4. Current state of the installation

Observed 04:45–05:15 today.

### 4.1 Release target and timing **[TODAY] [CODE]**

- `.local/private/.env.local` does not override `TIMEZONE`, `RELEASE_TIME`, or `BOOKING_HORIZON_DAYS`, so the defaults apply ([config.ts:20-22](Source/src/config.ts#L20-L22)):
  - `Asia/Manila`
  - `08:00:00`
  - booking horizon of +2 days
- `releaseCalendar` ([config.ts:164-170](Source/src/config.ts#L164-L170)) therefore picks **today 08:00** as the next release, with **target date 2026-09-25**.
- The runner enforces that the target is a Friday ([desktop-runner.ts:230](Source/src/api-booking/desktop-runner.ts#L230)). 2026-09-25 is a Friday.

### 4.2 Installed build vs. repository **[TODAY]**

| Item | State |
|---|---|
| `src/`, `ui/`, `scripts/` | Identical to `Source/` at `2969311`. |
| What actually executes | The runner runs from **TypeScript source via `tsx`** ([ui/processes.ts:30](Source/ui/processes.ts#L30)), so the reviewed source is exactly what runs. |
| `dist/ui` | Rebuilt at 04:02 from the current UI source. This includes the in-app confirmation modal committed at 04:23. |
| `Source/dist` | Older (02:35) and stale relative to the latest UI commit. The installation does not use it. |
| Launcher executable | Built 02:08 (`BUILD-INFO.txt`). |
| Most recent commit | `2969311` (04:23) replaced the native arming confirmation with an in-app modal. It has **never been used for a real arm**. **[UNTESTED]** |

### 4.3 Saved configuration and player bindings **[TODAY]**

- **Installed `config.local.json`:**
  - `SESSION_MODE: special-friday`, `BOOKING_METHOD: api-first`
  - `BOOKING_TYPE: extended`, `COURT_COUNT: 4`
  - `START_TIME: 17:00`, `DURATION_HOURS: 5`, no fallbacks
  - This is the only combination the schema allows for special mode ([config.ts:63-66](Source/src/config.ts#L63-L66)).
  - `PREFERRED_COURTS` is ignored in special mode, which uses fixed priorities, but it still feeds the plan fingerprint.
- **Change since the Special Friday report:** the report said "Special Friday A-H was not selected in the saved runtime plan". It is now selected (saved 03:59).
- **Player and customer bindings:** customer IDs and contact-hash bindings for all of A–H are present in `.local/private/.env.local`. Player contact fields for E–H are in `players-e-h.env`. Five of six 8-browser Special Friday *prepare* runs exited successfully, and prepare loads and validates every binding. **[LIVE for local validation]**
- **G/H customer IDs have never been used in a real checkout.** **[UNTESTED]**
- `RELEASE_PREOPEN_CALENDAR=true` and `AVAILABILITY_DISCOVERY_MODE=hybrid` are set, but they affect only the browser/hybrid path, not API-first special mode.
- `Source/config.local.json` holds a different, older plan (hybrid, standard, 1 court). The installation does not use it.

### 4.4 Locks **[TODAY]**

| File | Contents | Owner process |
|---|---|---|
| `.local/automation.lock` | Mode extended, workers A–D, stage `HOLD_VERIFIED` at 03:57:01. Hold expired 04:07:00. | PID 74788, **not running** |
| `.local/preparation.lock` | Prepare guard | PID 65612, **not running** |

- Arming checks for an existing lock (`noLock()`), and the runner creates its lock file only if none exists (`'wx'`, [api-automation-lock.ts](Source/src/api-booking/api-automation-lock.ts)). **Arming is impossible until this lock is cleared.**
- Reset & Prepare ([booking-prepare.ts:56-148](Source/src/booking-prepare.ts#L56-L148)) handles this case:
  - it confirms the owner process is dead;
  - it removes the stale preparation guard;
  - it inspects browsers A–D;
  - if each shows a clean Schedule page with no active hold, or the hold shows as expired ([booking-prepare.ts:33-40](Source/src/booking-prepare.ts#L33-L40)), it archives the lock to `.local/retained-holds/` and deletes it.
- This path has run 13 times before, per the 13 archives in `retained-holds/`. **[LIVE]**

### 4.5 Chrome sessions **[TODAY]**

- The API installation uses dedicated profiles `.local/api-first-chrome-profile[-b…-h]` on loopback CDP ports **19444–19451** ([browser.ts:19-21](Source/src/browser.ts#L19-L21)).
- **None of those ports is listening. No dedicated browser is running.**
- A `chrome.exe` started at 04:19 is listening on `127.0.0.1:9222`. That is the browser-mode default port and does not conflict with the API installation. Closing it would avoid confusion.
- No `.local/browser-endpoints.json` exists, so the default ports apply.

### 4.6 Clock **[TODAY]**

| Check | Result |
|---|---|
| Windows time zone | Singapore Standard Time (UTC+8, same offset as Manila) |
| `w32tm /query /status` | Leap indicator 3 (**not synchronized**), stratum 0, root dispersion 8.03 s, last successful sync 02:14:04, source time.windows.com |
| `w32time` service | Running, start type Manual |
| SNTP vs time.google.com | Local clock **behind by 332 ms** |
| SNTP vs time.windows.com | **behind by 330 ms** |
| SNTP vs time.cloudflare.com | **behind by 339 ms** |

Every release decision in the runner uses the local clock (`Date.now()`). The earlier Special Friday report recorded the Windows Time service as *stopped*. It is running now but not disciplining the clock, so the offset at 08:00 is unknown and may be larger.

### 4.7 Power **[TODAY]**

- Laptop on AC power, battery at 79%.
- Sleep and hibernate on AC: never. On battery: after 1 hour.
- No Windows Update reboot pending. Chrome version 153.0.8010.53.
- When armed through the UI, Electron requests `prevent-app-suspension` ([ui/main.ts:54](Source/ui/main.ts#L54)).
- The lid-close action could not be read. Keep the lid open.

### 4.8 Durable journals **[TODAY]**

- 45 journals in `.local/api-booking/api-first-journals`:
  - 43 `verified`;
  - 2 `unknown`, from development on 2026-09-19 for 2026-09-21 targets.
- **None exists for 2026-09-25**, so no journal will block a Friday attempt.
- No journal was ever created for evening hours or for a proofless request.
- `recycle-locks/` is empty. 67 holds are archived under `expired-holds/` and 4 attempts under `rejected-attempts/`.

### 4.9 Onda availability endpoint **[TODAY]**

One read-only GET for an already-released date returned `Server: Vercel`, `Cache-Control: public, max-age=0, must-revalidate`, `X-Vercel-Cache: MISS`, `Age: 0`. Responses are not being served from a CDN cache at off-peak times. A stale cache is therefore unlikely to explain the Sep 22 failure, though behavior under 08:00 load was not observable.

---

## 5. How a Special Friday run actually works

Traced from code.

### 5.1 Arming starts the live run immediately **[CODE]**

- For API-first, **Arm Next Release** runs `armApiRelease` ([ui/controller.ts:602-618](Source/ui/controller.ts#L602-L618)). That immediately launches the runner in `live` mode with the frozen release timestamp.
- Unlike the browser-mode scheduler ([ui/controller.ts:619-636](Source/ui/controller.ts#L619-L636)), API-first has **no wake/reconnect phase and no final preflight near release**.
- At start the runner:
  - acquires the automation lock ([desktop-runner.ts:243](Source/src/api-booking/desktop-runner.ts#L243));
  - loads all eight customers;
  - connects to all eight browsers once ([desktop-runner.ts:248-253](Source/src/api-booking/desktop-runner.ts#L248-L253)).
- It then waits inside that same process until 07:50. **Nothing re-verifies the browsers between arming and the 07:59:45 security check.**

### 5.2 Lanes and court allocation **[CODE] [OFFLINE]**

| Lane | Workers | Blocks | Court priority | Method |
|---|---|---|---|---|
| Core early | A, B | A 17:00–20:00 (3 h), B 20:00–22:00 (2 h) | 6, 7, 5, 4, 3, 2, 1 | Proof-based |
| Core late | C, D | C 19:00–21:00 (2 h), D 21:00–23:00 (2 h) | 7, 6, 5, 4, 3, 2, 1 | Proof-based |
| Adaptive | E, F | E 17:00–20:00, F 20:00–22:00 | 5, 4, 3, 2, 1 (**reserved first**) | Proof-based if early availability; otherwise **proofless** at exactly 08:00 |
| Bonus | G, H | G 17:00–20:00, H 20:00–22:00 | 4, 3, 2, 1, 5, 6, 7 | Proof-based only |

Sources: [special-session.ts:17-56](Source/src/api-booking/special-session.ts#L17-L56), [special-direct-checkout.ts:12-18](Source/src/api-booking/special-direct-checkout.ts#L12-L18).

- **Court order:** the E/F court is chosen once at 07:50 from the first snapshot and Onda's existing-bookings endpoint ([desktop-runner.ts:488-489](Source/src/api-booking/desktop-runner.ts#L488-L489)). A–D is then chosen excluding it, and G/H excluding all three.
- **A–D completeness:** A–D needs **all four blocks free on two distinct courts in the same snapshot** ([special-session.ts:161-178](Source/src/api-booking/special-session.ts#L161-L178)).
- **Assignment is permanent:** once a lane has a court, it never changes.

### 5.3 Timeline **[CODE]**

| Time (local clock) | What happens | Code |
|---|---|---|
| Arm time | Lock acquired, 8 browsers attached, `WAITING_FOR_RELEASE` | [243-253](Source/src/api-booking/desktop-runner.ts#L243-L253), [484](Source/src/api-booking/desktop-runner.ts#L484) |
| Until 07:50:00 | Sleeps in chunks of up to 30 s | [485-486](Source/src/api-booking/desktop-runner.ts#L485-L486) |
| 07:50:00 | `SPECIAL_AVAILABILITY_WATCHING`. Reads availability plus existing bookings, chooses the E/F court, starts the E/F task (`DIRECT_LANE_PREPARED`). | [487-501](Source/src/api-booking/desktop-runner.ts#L487-L501) |
| 07:50 → 07:59:49 | Watch loop. Availability every 5 s, Onda `version.json` every 1 s, "Update available" banner checked in all 8 pages. A version change or banner switches availability polling to 0.5 s for 15 s, then 2 s, and starts the A–D security check early. | [737-780](Source/src/api-booking/desktop-runner.ts#L737-L780) |
| Any time in the watch loop | If E/F's court shows all 5 hours: E/F proof-based upgrade. If A–D's four blocks are complete: A–D commits (early trigger), G/H starts. | [773-777](Source/src/api-booking/desktop-runner.ts#L773-L777) |
| 07:59:45 (T−15 s) | Security check (Turnstile token + fingerprint) for **A–D** and, separately, **E/F**. G/H gets none. | [509-510](Source/src/api-booking/desktop-runner.ts#L509-L510), [740](Source/src/api-booking/desktop-runner.ts#L740) |
| 07:59:49 (T−11 s) | Availability reads stop; waits for the release instant. | [743-748](Source/src/api-booking/desktop-runner.ts#L743-L748) |
| 08:00:00 | **E/F:** one proofless checkout request per worker, only if sent within 1 s of 08:00. **A–D:** `RELEASE_TRIGGERED`, waits for the security check, then **5 availability reads** at 0/250/500/1000/2000 ms pauses. | [512-525](Source/src/api-booking/desktop-runner.ts#L512-L525), [781-792](Source/src/api-booking/desktop-runner.ts#L781-L792) |
| On A–D availability | A–D courts assigned, G/H lane started, then A–D checkouts in parallel: fresh per-hour proofs → journal → POST → verify → QR page | [798-851](Source/src/api-booking/desktop-runner.ts#L798-L851) |
| G/H | Finds a 4th court, **then** starts its security check, then dispatches | [597-702](Source/src/api-booking/desktop-runner.ts#L597-L702) |
| End | Waits for every lane. Saves the latest hold expiry to the lock. Final status. | [907-949](Source/src/api-booking/desktop-runner.ts#L907-L949), [956-969](Source/src/api-booking/desktop-runner.ts#L956-L969) |

### 5.4 What one proof-based checkout does **[CODE] [LIVE]**

For each worker ([desktop-runner.ts:285-347](Source/src/api-booking/desktop-runner.ts#L285-L347), [calendar-free-checkout.ts](Source/src/api-booking/calendar-free-checkout.ts), [two-hour-reservation.ts:158-232](Source/src/api-booking/two-hour-reservation.ts#L158-L232)):

1. **Freshness gate:** the availability snapshot must be **≤15 s old** and still show every slot ([calendar-free-checkout.ts:35](Source/src/api-booking/calendar-free-checkout.ts#L35)).
2. **Security headers:** reused if acquired within the last **20 s** ([browser-session-transport.ts:96-97](Source/src/api-booking/browser-session-transport.ts#L96-L97)); otherwise Turnstile is solved again.
3. **Fresh availability proof for every hour** (`is-slot-available`, two at a time).
4. **Durable journal record** written, one per court/block, write-once; plus a one-time send permit.
5. **One checkout POST**, strictly validated: booking IDs, session, amounts, customer, pending status, hold expiry.
6. **Checkout-access grant** → official checkout page → waits for "QRPH", "Pending", and the exact amount → `OFFICIAL_QRPH_HANDOFF`.

---

## 6. The 7:50 early-release window

### 6.1 What "7:50" means in the code **[CODE]**

- 7:50 is not a separate release target. The watcher starts at `release − 10 minutes` ([desktop-runner.ts:485](Source/src/api-booking/desktop-runner.ts#L485)), and the local clock is 0.33 s behind.
- It covers availability that appears between 07:50:00 and 07:59:49.
- Anything already open before 07:50 is seen at the first read.
- Anything that opens between 07:59:49 and 08:00 is handled by the 08:00 path.

### 6.2 What happens if Onda opens early **[CODE]**

1. **Detection:**
   - up to ~5 s polling delay plus read time;
   - 0.5–2 s if a version change or "Update available" banner was seen first;
   - the first loop iteration also waits for a `version.json` read (up to 2.5 s timeout).
2. **E/F** switches to the proof-based path if its reserved court shows all five hours ([desktop-runner.ts:392-451](Source/src/api-booking/desktop-runner.ts#L392-L451)).
3. **A–D** commits and **starts its security check cold** ([desktop-runner.ts:795-798](Source/src/api-booking/desktop-runner.ts#L795-L798)).
   - Measured duration: 2.4–8.7 s per browser, typically 4–6 s. **[LIVE]**
   - E/F and G/H solve Turnstile at the same moment, so **8 browsers solve concurrently**. That has never been exercised; the maximum tested is 6. **[UNTESTED]**
4. **Freshness limit:** A–D's snapshot must still be ≤15 s old when checkout begins. A slow or retried security check can exceed that.
5. **G/H** starts as soon as A–D's courts are known.
6. **Expected result if Onda accepts bookings at that point:** holds about 10–20 s after Onda opens.

### 6.3 The critical weakness: early attempts rarely earn a retry **[CODE]**

- An attempt counts as "definitely not sent" only if:
  - its journal says `rejected`, or
  - the error is a `SubmissionDispatchError` explicitly marked not-dispatched ([api-lock-outcome.ts:27-30](Source/src/api-booking/api-lock-outcome.ts#L27-L30)).
- Only those attempts get the **one retry at 08:00**.
- Everything else is treated as "possibly sent". It is **not retried** and **keeps the lock**. That includes several errors thrown *before any request is sent*:
  - **Any slot-proof failure**, including "slot unavailable" and HTTP errors from `is-slot-available`. These are all rewrapped as `SlotProofError` ([slot-proofs.ts:88](Source/src/api-booking/slot-proofs.ts#L88), [slot-proofs.ts:105](Source/src/api-booking/slot-proofs.ts#L105)).
  - `CALENDAR_FREE_FRESH_AVAILABILITY_REQUIRED` (snapshot older than 15 s), `CALENDAR_FREE_APPROVAL_MISMATCH`, `CALENDAR_FREE_TRANSPORT_PAGE_MISMATCH`. These are plain errors.
- For **E/F**, the same rule means a pre-send proof failure *disables* the 08:00 proofless fallback ([desktop-runner.ts:427-442](Source/src/api-booking/desktop-runner.ts#L427-L442)).

**Consequence.** Suppose Onda makes Friday slots *visible* early but refuses them at the slot check until 08:00. Then A–D, E/F and G/H each spend their only attempt before 08:00, none is retried, and the run ends with **zero holds**, even though an ordinary 08:00 run might have succeeded.

This hinges entirely on how Onda's `is-slot-available` behaves before release, which has never been observed. **[ASSUMED]**

**Explicit early rejection.** If instead the *checkout* explicitly rejects with 409, or 400 "This booking date is not available yet." ([browser-session-transport.ts:45-53](Source/src/api-booking/browser-session-transport.ts#L45-L53)):

- A–D and G/H get their single 08:00 retry.
- E/F still loses. See Finding F-10: the proof attempt's journal permanently blocks the proofless request for the same block.

### 6.4 Confirmed race in the early-retry path **[CODE]**

This only matters when there is an early trigger, some A–D workers got holds and others were conclusively rejected, and an E/F court exists.

- The retry path clears the shared security-check state and, at T−15 s, calls `startWarmup(retryWorkers)` ([desktop-runner.ts:866-868](Source/src/api-booking/desktop-runner.ts#L866-L868)).
- The E/F task's loop, still running until 08:00, unconditionally calls `startWarmup(SPECIAL_SESSION_WORKERS)`, meaning all of A–D, at the same T−15 s ([desktop-runner.ts:509](Source/src/api-booking/desktop-runner.ts#L509)).
- Whichever call runs first wins. If the E/F task wins:
  - the security check includes workers whose pages are already on the checkout page;
  - those fail `ONDA_SESSION_PAGE_INVALID` ([browser-session-transport.ts:118-120](Source/src/api-booking/browser-session-transport.ts#L118-L120));
  - `finishWarmup(true)` throws after one retry ([desktop-runner.ts:870](Source/src/api-booking/desktop-runner.ts#L870), [479](Source/src/api-booking/desktop-runner.ts#L479));
  - the whole A–D retry is abandoned.
- Existing holds are unaffected. The retry simply never happens.

### 6.5 Evidence that early release happens at all

- **None.** No trace, diagnostic, or report in the repository shows Onda releasing a date before 08:00.
- The stage `SPECIAL_AVAILABILITY_WATCHING` has never been recorded in any trace. **[LIVE: absence]**

### 6.6 Assessment

The 7:50 window is **speculative**. If it never fires, it costs little: some polling, and the E/F court choice. If it does fire, the outcome depends on unverified server behavior, and in the worst case it turns a winnable 08:00 run into zero holds. **It should not be counted as a reliable second chance.**

---

## 7. The 08:00 official release

### 7.1 Sequence **[CODE]**

1. **07:59:45** — security check for A–D (shared) and E/F (separate), about 15 s ahead ([run-observability.ts](Source/src/api-booking/run-observability.ts)).
   - Measured single-browser release check on Sep 22: 3.6 s. **[LIVE]**
   - Typical with 4–6 browsers: 4.6–6.3 s. **[LIVE, Test Now]**
2. **08:00:00 (local) → E/F.** The E/F task wakes, checks it is within 5 s of release, waits for E/F's security check, checks it is within 1 s of release ([special-direct-checkout.ts:23-26](Source/src/api-booking/special-direct-checkout.ts#L23-L26)), and **locks E/F into the proofless path** ([desktop-runner.ts:519](Source/src/api-booking/desktop-runner.ts#L519)). It then sends one proofless request for E and one for F.
3. **08:00:00 (local) → A–D.** `RELEASE_TRIGGERED`, waits for the A–D security check, then reads availability up to **5 times** ([desktop-runner.ts:783](Source/src/api-booking/desktop-runner.ts#L783)):

   ```
   read 1 at +0.0 s → pause 250 ms → read 2 → pause 500 ms → read 3
   → pause 1 s → read 4 → pause 2 s → read 5 → give up
   ```

   With reads of about 0.4 s, the bot gives up at roughly **08:00:05.8** (local), which is **08:00:06.1 true time**. If no read shows all four A–D blocks on two courts, it throws `SPECIAL_SESSION_NOT_AVAILABLE` ([desktop-runner.ts:791](Source/src/api-booking/desktop-runner.ts#L791)). **A–D and G/H never send anything.**
4. **On success:** A–D dispatch. Expected holds about **2.5–5 s after Onda opens**, with the QR page 1–2 s later.
5. **G/H** starts its own security check only after finding a 4th court. Expected hold about **7–12 s after release**.

### 7.2 Effect of the clock **[TODAY]**

With the clock 0.33 s behind, "08:00:00" actually happens at **08:00:00.33 true time**:

- Every A–D action is 0.33 s later than intended.
- E/F's proofless request lands around 08:00:00.35–0.45 true time.
- If the clock drifts further before 08:00 (it is not being corrected), the delay grows.
- If it ends up *ahead* instead, the bot fires before Onda opens. E/F's single request is then rejected, and part of A–D's 5-read window is wasted.

### 7.3 Evidence on when Onda actually opens **[LIVE]**

| Release | What was seen |
|---|---|
| Sep 12 (browser mode) | Target date still **disabled at 08:00:00.066**. After a reload it was **enabled at 08:00:01.326**. The API read started at 08:00:00.015 and fell back with no usable response by 08:00:00.307. |
| Sep 22 (API-first, 1 worker, target Sep 24) | Trigger 08:00:00.003. A single availability read took **3.9 s** and produced **no bookable candidate** (`API_NO_AVAILABLE_CANDIDATE`). It cannot be determined whether the date was not yet open or the preferred slots were already taken. |

Together these suggest Onda opens around 08:00:00–08:00:01.5, but under load the bot's reads may be slow and may not reflect it immediately.

### 7.4 Security headers expire during late catches **[CODE]**

- The security check from 07:59:45 finishes around 07:59:50 and is reusable for 20 s, until about **08:00:10**.
- If A–D finds availability later than that, each worker solves Turnstile again inside the critical path, adding 4–6 s.
- This only matters if the read window is extended (see Section 18.3).

---

## 8. Scenario matrix: when availability appears

"T" is the true 08:00:00. Local clock is 0.33 s behind.

| When Onda opens | A–D | E/F | G/H | Overall |
|---|---|---|---|---|
| **Already open by 07:50:00** | Early trigger at the first reads (~07:50:01–03). Cold security check, then dispatch. Holds ~07:50:10–20 **if Onda accepts bookings**. If the slot check refuses: no retry, lost. | Proof-based upgrade dispatches early. If refused before send: proofless disabled, lost. | Starts with A–D, dispatches early. Same caveat. | Great if booking is really open; **zero holds** if Onda only shows slots early. Holds expire ~08:00–08:10, so payment overlaps the 08:00 activity. |
| **07:50:05–07:59:49** | Same as above, detected within ~5 s (or 0.5–2 s after a version signal). | Same | Same | Same |
| **07:59:49–T** | Not seen until the post-08:00 reads (reads pause for the last 11 s). Treated as the 08:00 case. | Proofless at T (see next row) | As below | As below |
| **Exactly T** | Read 1 or 2 finds it. Holds ~T+2.5–5 s. | Proofless lands ~T+0.4 s. Outcome depends on Onda accepting a null-proof request **[UNTESTED]**. | Holds ~T+7–12 s if a 4th court is still fully free. | Best case. A–D likely if all four security checks passed. |
| **T+1 to T+5 s** | Caught by read 3, 4, or 5. Holds ~T+3–9 s. | Proofless arrives before Onda opens → "not available yet" → recorded as rejected, **no fallback**. Any other error → recorded as **unknown**. | Starts later; more competition. | A–D probable, E/F lost. |
| **Later than ~T+6 s** (fast reads) | All 5 reads see "closed" → `SPECIAL_SESSION_NOT_AVAILABLE`. **Nothing dispatched.** | Proofless rejected as above | **Never starts** | **Zero holds.** Lock kept because the proofless request was sent. |
| **Slow reads under load** (Sep 22: 3.9 s per read) | The 5 reads stretch across ~20+ s but with big gaps. Detection may lag Onda's opening by several seconds. | As above | Starts late | Competitive position degrades. |
| **Never opens / date not listed** | `SPECIAL_SESSION_NOT_AVAILABLE` | Rejected | Never starts | Zero holds |

**If all A–D blocks are not free on two courts** (someone got there first, or courts were blocked in advance), A–D does not partially book. It fails the whole A–D lane and G/H never starts. By design, E/F's reserved court is excluded from A–D even if E/F later fails.

---

## 9. Lane-by-lane expected behavior

### 9.1 A–D (core session)

- **Most likely assignment:** A/B on court 6, C/D on court 7. Fallbacks follow the priority lists.
- **Expected behavior when things go right at 08:00:** four parallel checkouts on four browsers and four player identities. Four holds ~2.5–5 s after Onda opens, four QR pages ~1–2 s later. Each worker's browser is brought to the front when its QR is ready.
- **Proven:** the proof-based checkout path itself **[LIVE]**: 57 holds, up to 6 at once, 3-hour blocks, 1–2 courts per checkout.
- **Not proven:**
  - special-mode court assignment live;
  - evening/night-rate slots via API (all live holds were 08:00–16:00);
  - 8-browser concurrency.
- **Single point of failure:** the A–D security check is shared. If **any** of A, B, C, D fails twice (including a challenge nobody solves), none of A–D is sent ([desktop-runner.ts:468-480](Source/src/api-booking/desktop-runner.ts#L468-L480), [782](Source/src/api-booking/desktop-runner.ts#L782), [798](Source/src/api-booking/desktop-runner.ts#L798)). The in-page helper can hang for up to **90 s** before timing out ([calendar-free-security-context-browser.js:14](Source/src/api-booking/calendar-free-security-context-browser.js#L14)), and there is no shorter outer timeout.
- **Partial results:** each worker succeeds or fails independently after dispatch. A competitor taking one hour means that worker fails its proof. For example, B, C, D held but A's 17:00–20:00 missing. **There is no substitution** of another court for the missing block.

### 9.2 E/F (adaptive lane)

- **Court:** reserved at 07:50, normally **court 5** (priority 5, 4, 3, 2, 1). It skips courts that already have an existing booking between 17:00 and 22:00, per Onda's public bookings endpoint.
- **At 08:00 it is effectively always the proofless path.** The proofless request commits at ~T+0.00x, before A–D's first read returns, so the proof-based E/F path never gets a chance at 08:00 (Finding F-8).
- **The proofless request:**
  - `availabilityProof: null` for every hour;
  - price assumed **PHP 700/hour** when Friday prices aren't visible at 07:50 ([special-direct-checkout.ts:13](Source/src/api-booking/special-direct-checkout.ts#L13));
  - the assumption matches the observed Friday evening rate on 2026-09-18 and the Sep 12 hold (PHP 2,100 for 3 evening hours) **[LIVE, low price risk]**;
  - this bot has **never sent** a proofless request, and there is no record of Onda accepting one **[UNTESTED]**.
- **Possible responses:**

  | Onda response | Bot records | Consequence |
  |---|---|---|
  | Accepted and passes strict validation | Verified hold | QR shown |
  | 409, or 400 "This booking date is not available yet." | Rejected (conclusive) | E/F lost, no retry, no proof-based fallback |
  | Any other 400/403/5xx, or a response that fails validation | **Unknown** | Lock kept; you must check E's and F's Onda accounts manually for a pending booking |

- **Early upgrade:** only if E/F's court shows all 5 hours before 08:00 does E/F go proof-based. Its outcome then follows Section 6.3.
- **Duplicate safety:** the proof and proofless paths cannot both send (Section 10.1).

### 9.3 G/H (bonus lane)

- **Starts** only once A–D's courts are known. **No advance security check**, so its Turnstile solve (4–6 s) starts only after it finds a court.
- **Court:** 4, else 3, 2, 1, 5, 6, 7, excluding E/F's and A–D's courts. It requires all 5 hours free with **real observed prices**.
- **Timing:** first dispatch ~T+6–10 s, when competition is higher than for A–D.
- **Retry:** one retry at 08:00 only after an explicit early rejection. Unknown results are never retried.
- **Never run live.** G/H's customer IDs have never been used in a real checkout. A bad ID would likely produce a non-standard 400 → recorded as **unknown** → lock kept. **[UNTESTED]**
- **Interference with A–D:**
  - **Direct:** none. G/H cannot book A–D's or E/F's court (exclusion by construction, unit tested).
  - **Indirect:**
    - CPU contention from concurrent Turnstile solves;
    - shared IP and possible Onda/Cloudflare rate limits (unknown);
    - a G/H failure marks the **whole run FAILED** even when A–D succeeded ([desktop-runner.ts:929-949](Source/src/api-booking/desktop-runner.ts#L929-L949)).
  - The A–D QR cards still display; they are kept per event ([ui/controller.ts:328-329](Source/ui/controller.ts#L328-L329)).

---

## 10. Safety analysis

### 10.1 Duplicate bookings — **low risk from the bot itself**

| Possible duplicate | Protection | Assessment |
|---|---|---|
| E/F proof-based and proofless both sending | 1. In-memory one-way switch, set synchronously before any network call ([adaptive-direct-lane.ts](Source/src/api-booking/adaptive-direct-lane.ts)). 2. **Both paths compute the identical journal key** (facility, court, date, block start/end) ([two-hour-reservation.ts:98-103](Source/src/api-booking/two-hour-reservation.ts#L98-L103), [special-direct-checkout.ts:69](Source/src/api-booking/special-direct-checkout.ts#L69)). The write-once journal file and one-time send permit ([durable-submission-journal.ts:58-96](Source/src/api-booking/durable-submission-journal.ts#L58-L96)) block the second path even if the switch failed. | **Very unlikely.** Two independent barriers. **[CODE] [OFFLINE]** |
| Two lanes on the same court and time | Courts chosen with explicit exclusion; E/F first, then A–D, then G/H | **Prevented by construction.** **[CODE] [OFFLINE]** |
| Retry after an attempt that may have been sent | Retries only after `rejected` journals with no booking IDs are archived ([durable-submission-journal.ts:142-174](Source/src/api-booking/durable-submission-journal.ts#L142-L174)) | **Safe.** Unknown and possibly-sent attempts are never retried. |
| Two runs at once | Exclusive lock file; arming refuses while a lock exists | **Prevented.** |
| **You re-running after a failure** | Journals only block the *same court and block*, not the same session | **Real residual risk.** A manual re-run or Test Now after a partial failure could book the same hours on *different* courts while earlier holds are still pending or unconfirmed. |

### 10.2 Incomplete reservations — **the most likely bad outcome**

1. **Partial lanes.** Workers in a lane succeed or fail independently, with no substitution. For example, A–D may end up with three of four blocks.
2. **Unknown outcomes.** A hold may exist on Onda without a QR card in the bot. This is most likely from E/F's proofless request, a G/H customer problem, a lost response, or a validation mismatch.
3. **Hold expiry.** Every hold expires **10 minutes after creation** (retained lock records: verified 19:57:01Z → expiry 20:07:00Z). **[LIVE]** With up to eight holds created within ~10 s of each other, all eight manual QR payments must be done in about 10 minutes.
4. **Misleading final status.** If E/F or G/H fails, the run ends `FAILED` / "API run needs attention" even when A–D holds exist. Always check the QR cards.
5. **Early-trigger holds** (7:50 path) expire around 08:00–08:10, overlapping with the 08:00 activity.

### 10.3 Whole-run failure modes (zero holds)

| Cause | Mechanism | Likelihood |
|---|---|---|
| Onda opens later than the ~6 s read window | `SPECIAL_SESSION_NOT_AVAILABLE`; G/H never starts; E/F rejected | Moderate. Sep 22 evidence. |
| Any A–D security check fails twice or hangs | `finishWarmup` throws; A–D and G/H lost; only E/F proofless remains | Moderate-low |
| Onda changes its page code | The helper uses hard-coded module IDs `709892` and `139691` ([calendar-free-security-context-browser.js:18-19](Source/src/api-booking/calendar-free-security-context-browser.js#L18-L19)); a change breaks every security check. It happened once, on 09-21 (`ONDA_SECURITY_BUNDLE_CHANGED`). No prepare or readiness step tests the helper. | Low, but total impact |
| Early exposure without booking permission | Section 6.3 | Unknown |
| Browser or connection loss during the wait | Browsers attached once at arm time and not re-verified before 07:59:45 | Low-moderate |
| Not armed | Lock not cleared, browsers not prepared, arming modal problem | Avoidable. See Section 18. |

### 10.4 Lock and recovery behavior **[CODE] [LIVE]**

- **Kept** after any verified hold, any possibly-sent or unknown attempt, or any unexpected error in a side lane.
- **Released automatically** only when every lane proves nothing was sent or everything was rejected ([desktop-runner.ts:929-947](Source/src/api-booking/desktop-runner.ts#L929-L947)).
- **After success:** the lock records the latest hold expiry ([desktop-runner.ts:913](Source/src/api-booking/desktop-runner.ts#L913)).
- **After a total failure in which the proofless request was sent:** the lock is kept in stage `FINAL_ACTION_DISPATCHING`. Reset & Prepare then refuses to clear it for **11 minutes** unless the browsers show an expired hold ([booking-prepare.ts:24-31](Source/src/booking-prepare.ts#L24-L31)). The bot cannot be quickly re-used for a second attempt. Manual booking in your own browser is unaffected.
- **Minor:** in the early path, if every hold has already expired when the lanes finish, recording the expiry throws `HOLD_EXPIRY_INVALID` and the run reports `FAILED` despite verified holds (`ApiAutomationLock.held`, [desktop-runner.ts:913](Source/src/api-booking/desktop-runner.ts#L913)). This is cosmetic.

---

## 11. Detailed findings

Severity reflects impact × likelihood for **this** run.

| ID | Severity | Finding | Evidence | Location |
|---|---|---|---|---|
| F-1 | **Critical** | After 08:00, A–D reads availability only 5 times (~4–6 s with fast reads), then abandons the entire A–D session. G/H depends on A–D. | [CODE]; Sep 22 release found nothing in 3.9 s [LIVE] | [desktop-runner.ts:781-792](Source/src/api-booking/desktop-runner.ts#L781-L792) |
| F-2 | **Critical** | The Special Friday live path has never run past `WAITING_FOR_RELEASE`. `desktop-runner.ts` has **no tests**; the orchestration and the 8-browser combination are unproven. | 3 special live runs, all user-aborted [LIVE]; `grep` finds no test referencing the runner [TODAY] | Whole runner |
| F-3 | **High** | The A–D security check is all-or-nothing: one browser's failure (after one retry) or a hang (up to 90 s) stops all of A–D and G/H. | [CODE] | [desktop-runner.ts:468-480](Source/src/api-booking/desktop-runner.ts#L468-L480) |
| F-4 | **High** | The security helper relies on hard-coded Onda Turbopack module IDs. No prepare or readiness step validates it; the first test is at 07:59:45. It broke once already (09-21). Last proven working: the 03:57 Test Now today. | [CODE]; run `6495f5c3` [LIVE]; commit `970bbab` | [calendar-free-security-context-browser.js:18-19](Source/src/api-booking/calendar-free-security-context-browser.js#L18-L19) |
| F-5 | **High** | Pre-send errors (all slot-proof failures, stale snapshot, approval/page mismatch) are classified as "possibly sent". Early attempts are not retried at 08:00; the lock is kept; E/F's proofless fallback is disabled. | [CODE] | [api-lock-outcome.ts:27-30](Source/src/api-booking/api-lock-outcome.ts#L27-L30), [slot-proofs.ts:88](Source/src/api-booking/slot-proofs.ts#L88) |
| F-6 | **High** | Holds last 10 minutes; up to 8 manual QR payments must fit that window. | Retained lock records [LIVE] | — |
| F-7 | **Medium** | Race in the early-retry path: the E/F task's A–D security check can override the retry's own check, and the retry is abandoned. | [CODE] | [desktop-runner.ts:509](Source/src/api-booking/desktop-runner.ts#L509) vs [866-870](Source/src/api-booking/desktop-runner.ts#L866-L870) |
| F-8 | **Medium** | At 08:00 the proofless E/F request always locks the lane before the first availability read, so the proof-based E/F path cannot run even if court 5 is open a moment later. A premature arrival means a permanent E/F loss. | [CODE] | [desktop-runner.ts:508-525](Source/src/api-booking/desktop-runner.ts#L508-L525), [786](Source/src/api-booking/desktop-runner.ts#L786) |
| F-9 | **Medium** | The proofless request has never been sent by this bot. Any response other than "not available yet" or 409 is recorded as **unknown**, which keeps the lock and needs manual reconciliation. | Journals contain no proofless attempt [TODAY]; [CODE] | [browser-session-transport.ts:45-53](Source/src/api-booking/browser-session-transport.ts#L45-L53), [special-direct-checkout.ts:66-94](Source/src/api-booking/special-direct-checkout.ts#L66-L94) |
| F-10 | **Medium** | After an E/F proof attempt was explicitly rejected (journal created), the "reopened" proofless fallback is always blocked at 08:00 by `DUPLICATE_LOGICAL_BOOKING_BLOCKED` (same key). The documented reopen only works for security-check failures that happen before any journal exists. Safe, but E/F loses its fallback. | [CODE] | [durable-submission-journal.ts:69-72](Source/src/api-booking/durable-submission-journal.ts#L69-L72), [special-direct-checkout.ts:71](Source/src/api-booking/special-direct-checkout.ts#L71) |
| F-11 | **Medium** | For API-first, Arm launches the live run immediately and attaches to all 8 browsers once. There is no wake/reconnect or final preflight near release (the browser-mode scheduler has one). | [CODE] | [ui/controller.ts:602-618](Source/ui/controller.ts#L602-L618) |
| F-12 | **Medium** | Chrome is launched without flags that stop it throttling hidden or covered windows. `showWorkerPage` doesn't tile windows. Seven of eight windows will be covered for hours before the 07:59:45 check. Behavior after long idle is untested. | [CODE]; [UNTESTED] | [start-onda-chrome.ps1:37-42](Source/scripts/start-onda-chrome.ps1#L37-L42), [browser-window.ts](Source/src/browser-window.ts) |
| F-13 | **Medium** | Clock 330–340 ms behind; Windows Time not synchronizing. | [TODAY] | — |
| F-14 | **Medium** | G/H gets no advance security check; dispatch ~T+6–10 s. G/H never run live; G/H customer IDs never used in a checkout. | [CODE]; [UNTESTED] | [desktop-runner.ts:616-635](Source/src/api-booking/desktop-runner.ts#L616-L635) |
| F-15 | **Medium** | 8 concurrent Turnstile solves, proofs and checkouts from one machine and IP have never been exercised (max 6). | [LIVE: max 6] | — |
| F-16 | **Medium** | Early-trigger A–D starts its security check cold, while the snapshot must be ≤15 s old at checkout. A slow or retried check can exceed that (a non-conclusive error, so no retry). | [CODE]; security 2.4–8.7 s [LIVE] | [calendar-free-checkout.ts:35](Source/src/api-booking/calendar-free-checkout.ts#L35), [desktop-runner.ts:795-798](Source/src/api-booking/desktop-runner.ts#L795-L798) |
| F-17 | Low | A side-lane failure marks the whole run FAILED even when A–D succeeded. QR cards still shown. | [CODE] | [desktop-runner.ts:929-949](Source/src/api-booking/desktop-runner.ts#L929-L949) |
| F-18 | Low | After an early E/F proof success, the E/F task's 07:59:45 security check hits pages already on checkout and emits a spurious `DIRECT_LANE_FAILED`. Cosmetic, but alarming mid-run. | [CODE] | [desktop-runner.ts:513-515](Source/src/api-booking/desktop-runner.ts#L513-L515), [578-589](Source/src/api-booking/desktop-runner.ts#L578-L589) |
| F-19 | Low | The existing-bookings check for E/F's court treats a booking ending `00:00` as not overlapping 17:00–22:00 (string comparison). | [CODE] | [desktop-runner.ts:193-195](Source/src/api-booking/desktop-runner.ts#L193-L195) |
| F-20 | Low | At arm time, player readiness checks only A–D in special mode. The runner validates E–H immediately after, so a problem would still surface at arm time. | [CODE] | [ui/controller.ts:608](Source/ui/controller.ts#L608) vs [136](Source/ui/controller.ts#L136) |
| F-21 | Low | The arming confirmation was replaced by an in-app modal at 04:23 today and has never been used for a real arm. | Commit `2969311` | [ui/controller.ts:610](Source/ui/controller.ts#L610) |
| F-22 | Low | Early-path `HOLD_EXPIRY_INVALID` can mark a successful early run as FAILED (Section 10.4). | [CODE] | [desktop-runner.ts:913](Source/src/api-booking/desktop-runner.ts#L913) |
| F-23 | Info | An Onda version change is treated as a release signal, but a new Onda deployment is also what can break the security helper (F-4). The bot never reloads pages, so the old page runtime keeps working unless the backend changes incompatibly. | [CODE] / [ASSUMED] | [desktop-runner.ts:756-762](Source/src/api-booking/desktop-runner.ts#L756-L762) |

---

## 12. Risk ranking

Top five, most severe first.

### 1. Short post-08:00 availability window (F-1)

- **What:** five reads over ~4–6 s, then the A–D session is abandoned and G/H never starts.
- **Why it's first:** it is the most likely route to zero holds, and there is direct evidence. The only API-first 08:00 attempt saw nothing in 3.9 s, and Sep 12 showed the date still closed at 08:00:00.07.
- **Mitigation:** extend the window (Section 18.3, change C-1). Otherwise, accept the risk and be ready to book manually.

### 2. All-or-nothing security check on four browsers, dependent on Onda's page code (F-3, F-4, F-12)

- **What:** one failed or hung Turnstile among A–D, a challenge nobody solves, or an Onda page-code change, and A–D plus G/H are lost.
- **Aggravated by:** windows hidden for hours (Chrome throttling, untested), and nothing validating the helper before 07:59:45.
- **Mitigation:**
  - arm late;
  - keep windows visible and tiled;
  - stay at the keyboard at 07:59:40;
  - optionally re-prove the helper this morning (Section 18.2).

### 3. Untested lane orchestration (F-2, F-7, F-15)

- **What:** the code that decides when each lane fires and how outcomes combine has no automated tests and has never run live in Special Friday mode. One race condition was found by reading it; others may exist.
- **Mitigation:** none possible before 08:00 except keeping the run simple. For example, the operator watches the log and is ready to take over.

### 4. The 7:50 path spends each lane's only attempt (F-5, F-16)

- **What:** if Onda shows slots early but refuses them until 08:00, all lanes fail with errors the code treats as possibly sent. Nothing is retried, and the E/F fallback is disabled.
- **Likelihood:** unknown; early release has never been seen.
- **Mitigation:** none without code changes. Watch for `SPECIAL_EARLY_AVAILABILITY_READY`, and be ready to book manually at 08:00 if early attempts fail.

### 5. Ten-minute holds with manual payment for up to eight QR codes (F-6)

- **What:** holds expire before all are paid, leaving an incomplete session.
- **Mitigation:**
  - pay A–D first;
  - pre-assign payers and phones;
  - have e-wallets funded and unlocked;
  - use **Show Browser X** to surface each QR.

**Also significant:**

- E/F proofless is effectively a single untested shot (F-8, F-9, F-10). Plan as if E/F will not succeed.
- The clock (F-13) is easy to fix and should not be skipped.
- The lack of reconnect before release (F-11): arm late.

---

## 13. Probability of success

### 13.1 Definition

"Success" = the A–D core session (four holds, courts for 17:00–22:00 and 19:00–23:00) held **and paid**. This assumes the operational steps in Section 18 are completed. In the current state the probability is effectively **0%**, because arming is blocked by the lock and no browsers are running.

### 13.2 Factor chain

| Step | Estimate | Basis |
|---|---|---|
| Armed correctly and survives the wait to 08:00 | ~90% | 8-browser prepares succeeded 5 of 6 times [LIVE]; multi-hour attachment untested |
| Onda's security code unchanged since 03:57 | ~93% | One breaking change in ~4 days of observation |
| All four A–D security checks succeed around 07:59:45 | ~88% | Measured 2.4–8.7 s, no recorded helper failure other than the bundle change [LIVE]; long-idle hidden windows untested |
| Onda opens within the ~4–6 s read window | ~80% | Sep 12 opened ≈T+1.3 s; Sep 22 inconclusive (nothing in 3.9 s) |
| A–D gets all its hours before competitors | ~75% | Holds ~T+3–6 s; competition unknown |
| Four QR payments made within 10 minutes | ~95% | Manual; depends on preparation |
| **Product** | **≈ 0.41** | |

### 13.3 Other outcomes

| Outcome | Estimate | Main driver |
|---|---|---|
| At least one hold | ~60% | Partial A–D is more likely than full |
| E/F held | ~20% | Proofless is untested and arrives ~T+0.4 s |
| G/H held | ~20% | Needs A–D found, a 4th court still free at T+7–12 s, and untested customer IDs |
| All eight | ~5% | Every lane must succeed |
| Nothing | ~40% | F-1, F-3, F-4 |

### 13.4 Sensitivity

| Change | Effect |
|---|---|
| Extend the post-08:00 read window to ~20–30 s (C-1) | The "opens within window" factor goes ~0.80 → ~0.90–0.92. Overall **~45–50%**. |
| Skip the clock sync, or clock drifts more | Slightly lower; significantly lower if it ends up *ahead* |
| Windows minimized or fully covered for hours | Security-check factor could drop materially (untested) |
| Onda opens more than ~6 s late | **~0%**, however well everything else goes |
| Early release happens and Onda refuses slot checks before 08:00 | **~0%** |

### 13.5 Confidence

**Low (roughly ±15 points).** The estimate rests on:

- one successful 08:00 release (browser mode, one court);
- one failed API-first 08:00 release;
- Test Now runs on already-open dates;
- a Special Friday path that has never executed its release logic.

---

## 14. Evidence review

### 14.1 Automated tests **[TODAY]**

- `npx tsc --noEmit`: **passed**.
- `npx vitest run`: **69 files, 812 tests passed** (24.7 s), at commit `2969311`, in an isolated copy without private configuration.
  - The Special Friday report cites 805. The difference comes from tests added in the later commit `2969311`.
- **Coverage relevant to this run [OFFLINE]:**
  - `special-session.test.ts` (18 cases): court assignment, fallbacks, 19 distinct court-hours, G/H court selection and pricing, fingerprint.
  - `adaptive-direct-lane.test.ts` (5): the E/F one-way switch.
  - `special-direct-checkout.test.ts` (7): 1-s dispatch window, proofless request shape, E/F court choice, rejection vs unknown, amount validation.
  - Lock outcome rules, lock-write serialization, journals, transport, UI special-session rendering.
- **Gaps:**
  - **no test imports or runs `desktop-runner.ts`**;
  - nothing simulates the 07:50/08:00 timeline, lane interaction, retries, or final outcome reduction.
  - The release report acknowledges this: "complete multi-browser timing is not simulated end to end".
- **Passing tests do not show the bot will book at 08:00.** They show the helpers behave as designed against fixtures.

### 14.2 Run history **[LIVE]**

98 traces in `.local/api-booking/run-progress/` (full table in [Appendix C](#appendix-c--run-history)):

- **Special Friday:**
  - 7 prepare runs: 6 succeeded (5 with all 8 browsers), 1 failed with `API_FIRST_RUN_FAILED`;
  - 3 live runs, **all user-aborted while waiting**;
  - no trace ever reached `SPECIAL_AVAILABILITY_WATCHING`.
- **Scheduled API release (normal mode):**
  - 2 user-aborted;
  - 1 real release (Sep 22, one worker) that failed with `API_NO_AVAILABLE_CANDIDATE` at 08:00:03.951.
- **Test Now (already-open dates):**
  - 17 successful runs, 57 verified holds, up to 6 browsers;
  - failures include `ONDA_SECURITY_BUNDLE_CHANGED` (09-21), one `SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED` (09-21), and several no-candidate results.

### 14.3 Historical 08:00 releases **[LIVE]**

| Date | Mode | Result | Notes |
|---|---|---|---|
| Sep 11 | Browser | Failed | Page shell took 18 s after reload |
| Sep 12 | Browser, 1 court | **Success** | Target disabled at 00.066, enabled 01.326, selection 01.911, QR 14.684 |
| Sep 17 | Browser, 2 workers | Failed | Shell stage |
| Sep 22 | API-first, 1 worker | Failed | Trigger +3 ms; security check 3.6 s; one read took 3.9 s; no candidate |

### 14.4 Release report cross-check

- The report's operational preflight (installation NOT READY: CDP blocked, schedule not clean, lock active, Windows Time stopped) is **still largely true now**. Browsers aren't running, a lock is active, and the clock isn't synchronized.
- The one improvement since: Special Friday is now saved as the plan.

---

## 15. Implemented vs. proven

| Component | Implemented | Offline-tested | Proven live |
|---|---|---|---|
| Release trigger timing | Yes | Yes | **Yes** (+3 ms, +10 ms) |
| 07:50 watcher and early trigger | Yes | No (runner untested) | **No** — never reached |
| Availability read and parse | Yes | Yes | Yes (Test Now; one release read) |
| Security check at release | Yes | Transport only | 1 browser at a real release (3.6 s); 2–6 in Test Now; **never 8; never after long idle** |
| A–D court assignment | Yes | Yes | **No** (special mode) |
| Parallel proof-based checkout | Yes | Helpers | Yes, up to 6 |
| Evening/night-rate slots via API | Yes | Fixture | **No** (all holds 08:00–16:00) |
| QR handoff | Yes | Yes | **Yes** (57 holds) |
| E/F proof-based upgrade | Yes | Switch only | **No** |
| E/F proofless request | Yes | Request shape | **Never sent** |
| G/H lane | Yes | Planning | **No**; G/H customer IDs never used |
| Journal duplicate guard | Yes | Yes | Yes (unknowns preserved, rejections archived) |
| Lock lifecycle and Reset & Prepare recovery | Yes | Yes | **Yes** (13 archives) |
| Early-retry logic | Yes | No | **No** (race found) |
| Sleep protection | Yes | — | Used once in a real release (11-min wait) |
| Clock accuracy | Relies on Windows | — | **Currently off by 0.33 s** |
| In-app arming confirmation | Yes (04:23 today) | UI tests | **No** |

---

## 16. Documentation vs. code discrepancies

1. **README (Desktop control panel):** "Before release the app performs its wake/reconnect phase and a fresh final preflight." This is true for browser-mode scheduled releases, but **not for API-first**, which starts the live run at arm time ([ui/controller.ts:602-618](Source/ui/controller.ts#L602-L618)).
2. **README / REVIEW_GUIDE (E/F):** "a conclusive pre-dispatch proof failure (security/proof acquisition, before any network dispatch) reopens the proofless fallback."
   - In code, only **security-check** failures reopen it.
   - **Proof-acquisition** failures (`SlotProofError`) are treated as possibly sent and **disable** it ([desktop-runner.ts:427-442](Source/src/api-booking/desktop-runner.ts#L427-L442), [api-lock-outcome.ts:27-30](Source/src/api-booking/api-lock-outcome.ts#L27-L30)).
   - After an explicit checkout rejection, the "reopened" proofless request is blocked by the shared journal key (F-10).
3. **README / REVIEW_GUIDE (E/F):** "upgrades to proof-based on early availability or otherwise keeps the existing experimental proofless direct request." Accurate, but it does not say that at 08:00 the proofless request **always** pre-empts the proof-based path, even when the proof-based path would be available a moment later (F-8).
4. **Special Friday report:** "Windows Time service: stopped." It is now running but reports *not synchronized* with a 0.33 s offset.
5. **Special Friday report:** "Vitest: 69 files and 805 tests passed." Now 812, after later commits.

---

## 17. Readiness verdict

**Not ready to arm in its current state.** Blocking items as of 05:14:

1. An automation lock is still active (`HOLD_VERIFIED` from the 03:57 test; hold expired 04:07), plus a stale preparation lock. Arming refuses while a lock exists.
2. No dedicated Chrome is running (ports 19444–19451 not listening).
3. The clock is not synchronized (0.33 s behind, not being corrected).
4. Installation readiness has not been re-run since it reported NOT READY.

All four are fixable before 08:00. **After fixing them the bot can be armed, but it should not be depended on.** Have a manual booking plan ready and treat the bot as a first attempt that might fail completely.

---

## 18. What to do before 08:00

### 18.1 Required operational steps

| When | Step | How to confirm |
|---|---|---|
| Now | **Synchronize the clock.** As administrator: `w32tm /resync /force`, or Settings → Time & language → Date & time → **Sync now**. | `w32tm /stripchart /computer:time.google.com /samples:3 /dataonly` shows offsets within ±0.05 s |
| Now | **Run Reset & Prepare in Special Friday mode.** | The old lock is archived to `.local/retained-holds/` and removed. All 8 browsers launch and verify. No `PAYMENT_HOLD_MAY_BE_ACTIVE` block. |
| After prepare | **Re-run the installation readiness command.** | All 8 browsers CDP VERIFIED, lock clear, plan VALID, target 2026-09-25 |
| Anytime | Close the unrelated Chrome on port 9222, and anything heavy (downloads, updates, games, video calls). | — |
| ~07:30 | **Re-check the clock** with the stripchart command. | Within ±0.05 s |
| ~07:30 | **Arrange the 8 windows.** Restored (never minimized), ideally tiled so each is at least partly visible. Screen on. AC plugged in. Lid open. | Every window visible |
| 07:30–07:40 | **Authorize Terms, then Arm Next Release.** Arming later reduces the time the eight browsers sit attached and hidden (F-11, F-12), but leave a margin before 07:50. | `API FIRST ARMED`, then `WAITING_FOR_RELEASE` in the activity log |
| Before 07:59 | **Payment readiness.** E-wallets unlocked and funded. Decide who pays which QR. **Pay A–D first.** | — |
| Before 07:59 | **Manual backup ready.** A separate normal browser (not the bot's windows) logged into Onda on the booking page, to use only if the bot clearly fails (Section 19). | — |

### 18.2 Optional validation (your call)

- **Security helper:** the only in-app way to prove it still works after 03:57 is another **Test Now**, for one court on an uncontested open date.
  - It creates a real 10-minute pending hold, adds a retained lock, and requires another Reset & Prepare afterwards.
  - Worth it only if done early (before ~07:00), leaving time to reset.
- **Clock:** a second resync at ~07:30 if the offset is growing.

### 18.3 Code changes

Optional. Any of these would go live **without a live test**. Only the typecheck and offline suite can be re-run.

| ID | Change | Value | Risk |
|---|---|---|---|
| **C-1** | Replace the 5-read loop at [desktop-runner.ts:783](Source/src/api-booking/desktop-runner.ts#L783) with a time-bounded loop (e.g. read every 400 ms until `releaseMs + 25_000`). Optionally the same for G/H's burst at [616](Source/src/api-booking/desktop-runner.ts#L616). | **Highest.** Addresses F-1; ~+5–10 points. Late catches re-solve Turnstile automatically (+4–6 s) but still proceed. | Low complexity; loop logic change right before a live run. |
| **C-2** | In the E/F task loop at [desktop-runner.ts:509](Source/src/api-booking/desktop-runner.ts#L509), call `startWarmup(SPECIAL_SESSION_WORKERS)` only while A–D has not yet committed (`!specialPlansAtTrigger`). | Fixes F-7. Only matters on an early trigger with partial success. | Very small change. |
| **C-3** | Add `--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding` to the Chrome launch arguments ([start-onda-chrome.ps1:37-42](Source/scripts/start-onda-chrome.ps1#L37-L42)). | Reduces F-12. | All 8 browsers must be relaunched. Effect on Onda's Turnstile untested. |

**Not recommended before 08:00:**

- reclassifying pre-send errors;
- reordering E/F proofless vs proof-based;
- adding a G/H advance security check;
- adding a security-helper check to prepare.

These are worthwhile later but too invasive to add untested hours before a live run.

---

## 19. During the run

### 19.1 What you should see (activity log)

| Time | Expected events |
|---|---|
| Arm | `RUN_STARTED`, `RUN_CONFIGURATION` (special-friday, 8 workers), `BROWSER_READY` ×8, `WAITING_FOR_RELEASE` |
| 07:50:00 | `SPECIAL_AVAILABILITY_WATCHING`, `DIRECT_LANE_PREPARED` (E/F court, normally 5; `UNVERIFIED_PRIOR_RATE`) |
| 07:50–07:59 | Normally quiet. Watch for `SPECIAL_EARLY_AVAILABILITY_READY`, `ADAPTIVE_DIRECT_PROOF_AVAILABLE`, `SPECIAL_VERSION_CHANGE_OBSERVED`, `SPECIAL_UPDATE_NOTIFICATION_OBSERVED`. |
| 07:59:45–07:59:55 | `SECURITY_PREWARM_STARTED`, `SECURITY_PREWARM_READY` ×4 (A–D), `DIRECT_SECURITY_READY` ×2 (E/F) |
| 08:00:00 | `RELEASE_TRIGGERED`, `DIRECT_LANE_DISPATCHING` |
| 08:00:00–06 | `SPECIAL_RELEASE_AVAILABILITY_READY`, `SPECIAL_PROOF_LANE_READY`, `CANDIDATE_READY`, `FRESH_VERIFICATION_AND_PROOFS` |
| ~08:00:03–08 | `PENDING_HOLD` then `OFFICIAL_QRPH_HANDOFF` for A–D; `DIRECT_WORKER_OUTCOME` for E/F |
| ~08:00:07–15 | `SPECIAL_BONUS_LANE_READY` (or `SKIPPED`), G/H holds |
| End | `SPECIAL_RUN_SUMMARY`, possibly `FAILED` even with holds (F-17) |

### 19.2 Decision rules

- **`HUMAN_VERIFICATION_REQUIRED` at any time:** solve it immediately in the window that comes to the front. One unsolved challenge among A–D stops A–D and G/H.
- **`SECURITY_PREWARM_FAILED` or `SPECIAL_SESSION_NOT_AVAILABLE`, or no `PENDING_HOLD` by ~08:00:10:** switch to manual booking in your separate browser. First glance at the QR cards and log to see which holds already exist, so you don't book the same hours twice.
- **Early activity (07:50–07:59):**
  - If `PENDING_HOLD` appears, pay those QR codes (their 10 minutes run out around 08:00–08:10).
  - If early attempts fail, expect no automatic retry. Be ready to book manually at 08:00.
- **E/F shows unknown/reconciliation:** check E's and F's Onda accounts for a pending booking before doing anything else for those hours.
- **Pay in this order:** A, B, C, D, then G, H, then E, F. Use **Show Browser X** on each QR card.

---

## 20. After the run

1. **Do not re-arm, re-run, or use Test Now** until every hold is paid or expired and every unknown outcome has been checked on Onda. Journals only prevent repeats of the same court and block, not the same session (Section 10.1).
2. The lock will be kept after any hold or unknown outcome. Clear it only through **Reset & Prepare**, after holds are paid or expired. After a total failure where the proofless request was sent, Reset & Prepare may refuse for ~11 minutes.
3. Keep `.local/api-booking/run-progress/<runId>.ndjson`. It is the first real Special Friday trace and the best evidence for improving the next run.

---

## 21. Longer-term recommendations

After this Friday:

1. **Test harness for `desktop-runner.ts`:** fake clock, fake availability sequences (early, exact, late, never), fake transports. Cover the lane interactions, retries, lock outcomes, and the F-7 race.
2. **Time-bounded post-release windows** for A–D and G/H (C-1), with a configurable deadline.
3. **Prove the security helper during Reset & Prepare** (acquire a token without booking), so a changed Onda bundle is found hours before release, not at 07:59:45.
4. **Classify pre-send errors as not sent** when no journal exists and no request left the machine (stale snapshot, approval mismatch, proof acquisition). This allows safe 08:00 retries and avoids needless retained locks.
5. **E/F at 08:00:** fire the proofless request only after the first read confirms the date is open, or let the proof-based path go first when both are possible.
6. **Advance security check for G/H** at T−15 s, like A–D and E/F.
7. **Reconnect and verify browsers shortly before release** for API-first (the browser mode already does this). Or arm later automatically.
8. **Window management:** tile the eight windows automatically; add anti-throttling Chrome flags after testing them with Turnstile.
9. **Add a clock-offset check to readiness**, blocking arming beyond ±100 ms.
10. **Payment workflow:** a single payment queue view ordered by priority with live countdowns.
11. **Rehearse the full Special Friday flow** at a non-contested release (for example, a weekday 08:00 for a low-demand date) before relying on it for a contested session.
12. **Keep the documentation aligned** with the code on the points in Section 16.

---

## Appendix A — Glossary

| Term | Meaning |
|---|---|
| **Lane** | A group of workers booking together: A–D (core), E/F (adaptive), G/H (bonus). |
| **Worker / browser** | One dedicated Chrome profile plus one player/customer identity. One checkout each. |
| **Hold** | A temporary pending Onda booking with a QR payment page. **Expires 10 minutes after creation** unless paid. |
| **Proof-based checkout** | Checkout that includes a fresh `availabilityProof` for every hour, obtained from Onda's `is-slot-available` immediately before the request. |
| **Proofless checkout** | E/F's release-instant request with `availabilityProof: null`. Never sent by this bot so far. |
| **Security check / prewarm** | Obtaining Onda's Turnstile token and browser fingerprint inside the real page, ahead of checkout. Reusable for 20 s. |
| **Journal** | A write-once file per court and time block, recording each checkout attempt's state: dispatching, verified, rejected, or unknown. Prevents repeats. |
| **Automation lock** | `.local/automation.lock`. Prevents concurrent runs; kept whenever a hold or uncertain outcome may exist. |
| **Early trigger** | A–D (and possibly E/F, G/H) dispatching before 08:00 because availability appeared during the 07:50 watch. |
| **Conclusive / not sent** | The code's proof that no booking can exist for an attempt: a `rejected` journal, or an explicitly not-dispatched transport error. Required for any retry or lock release. |
| **Unknown** | An outcome where a booking may exist but couldn't be verified. Never retried; needs manual checking. |

## Appendix B — Key constants

| Constant | Value | Location |
|---|---|---|
| Watch start | release − 10 min (07:50:00) | [desktop-runner.ts:485](Source/src/api-booking/desktop-runner.ts#L485) |
| Pre-release availability poll | 5 s (0.5 s for 15 s after a signal, then 2 s) | [desktop-runner.ts:51-54](Source/src/api-booking/desktop-runner.ts#L51-L54) |
| Version poll | 1 s | [desktop-runner.ts:50](Source/src/api-booking/desktop-runner.ts#L50) |
| Pre-release read stop | T − 11 s | [desktop-runner.ts:49](Source/src/api-booking/desktop-runner.ts#L49) |
| Security check lead (A–D, E/F) | 15 s | [run-observability.ts](Source/src/api-booking/run-observability.ts) |
| Security header reuse | 20 s | [browser-session-transport.ts:96-97](Source/src/api-booking/browser-session-transport.ts#L96-L97) |
| Security header maximum age at send | 120 s | [browser-session-transport.ts:182-184](Source/src/api-booking/browser-session-transport.ts#L182-L184) |
| In-page helper timeout | 90 s | [calendar-free-security-context-browser.js:14](Source/src/api-booking/calendar-free-security-context-browser.js#L14) |
| Snapshot freshness at checkout | 15 s | [calendar-free-checkout.ts:35](Source/src/api-booking/calendar-free-checkout.ts#L35) |
| Post-release reads (A–D, G/H) | 5 reads; pauses 0/250/500/1000/2000 ms | [desktop-runner.ts:783](Source/src/api-booking/desktop-runner.ts#L783), [616](Source/src/api-booking/desktop-runner.ts#L616) |
| Release freshness | ≤ 5 s after release | [api-release.ts](Source/src/api-booking/api-release.ts) |
| Proofless send window | ≤ 1 s after release | [special-direct-checkout.ts:14](Source/src/api-booking/special-direct-checkout.ts#L14) |
| Assumed E/F rate | PHP 700/hour | [special-direct-checkout.ts:13](Source/src/api-booking/special-direct-checkout.ts#L13) |
| Availability request timeout | 10 s | [live-availability-provider.ts](Source/src/api-booking/live-availability-provider.ts) |
| Reset & Prepare wait after possible send | 11 min | [booking-prepare.ts:29](Source/src/booking-prepare.ts#L29) |
| CDP ports (API install) | 19444–19451 (A–H) | [browser.ts:19-21](Source/src/browser.ts#L19-L21) |

## Appendix C — Run history

All API run traces (times UTC; add 8 h for Manila).

**Special Friday**

| Start (UTC) | Run | Mode | Workers | Result |
|---|---|---|---|---|
| 09-22 10:00 | 126bdb81 | prepare | A–D (earlier 4-worker version) | OK |
| 09-22 17:17 | 536a791c | prepare | A–H | OK |
| 09-22 17:23 | be059ad6 | prepare | A–H | OK |
| 09-22 17:25 | 0c7c274b | **live** | A–H | **USER_ABORT while waiting** |
| 09-22 17:25 | 828fb493 | prepare | A–H | FAILED `API_FIRST_RUN_FAILED` |
| 09-22 18:18 | 7036d994 | prepare | A–H | OK |
| 09-22 18:19 | 851a9eb2 | **live** | A–H | **USER_ABORT while waiting** |
| 09-22 18:42 | bf7598c5 | prepare | A–H | OK |
| 09-22 19:11 | cdf118d4 | prepare | A–H | OK |
| 09-22 19:12 | e80b07c9 | **live** | A–H | **USER_ABORT while waiting** |

**Scheduled API releases (normal mode)**

| Start (UTC) | Run | Target | Result |
|---|---|---|---|
| 09-21 20:39 | e132b978 | 09-24 | USER_ABORT |
| 09-21 20:39 | a82bcd07 | 09-24 | USER_ABORT |
| 09-21 23:48 | 7df09f44 | 09-24 | **Real 08:00 release.** Security check 07:59:52 → 07:59:55.640; trigger 08:00:00.003; `API_NO_AVAILABLE_CANDIDATE` 08:00:03.951 |

**Test Now (live-now) — successful runs, all verified holds with QR**

| Start (UTC) | Run | Workers | Holds |
|---|---|---|---|
| 09-20 18:49 | 27907aad | A–B | 2 |
| 09-20 19:47 | fce954d7 | A | 1 |
| 09-21 07:34 | f5b8eccf | A–B | 2 |
| 09-21 08:42 | 3d52ca7a | A–B | 2 |
| 09-21 09:05 | d3e0a1d0 | A–B | 2 |
| 09-21 09:30 | 641a01e5 | A–B | 2 |
| 09-21 18:23 | 33842079 | A–B | 2 |
| 09-21 20:11 | e481a852 | A–D | 4 |
| 09-21 20:39 | 9acd2821 | A–D | 4 |
| 09-21 21:00 | 73e09eef | A–D | 4 |
| 09-22 13:48 | 18f36d19 | **A–F** | **6** |
| 09-22 14:25 | 204c1e4c | **A–F** | **6** |
| 09-22 17:51 | b78006cc | A–D | 4 |
| 09-22 18:16 | 2b95e6c9 | A–D | 4 |
| 09-22 19:13 | 2537ab8f | A–D | 4 |
| 09-22 19:30 | bba49846 | A–D | 4 |
| 09-22 19:56 | 3b4eadb5 | A–D | 4 (most recent: 03:56 Manila today) |

**Test Now failures:**

- 6495f5c3 `ONDA_SECURITY_BUNDLE_CHANGED` (09-21 07:21 UTC);
- 73b6fb0c `SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED` (09-21 18:28);
- c41a429d `API_NO_UNUSED_CANDIDATE`;
- 4b0f6906, ac6521b4, 216ef479 `API_NO_AVAILABLE_CANDIDATE`;
- dd52932b interrupted.

## Appendix D — Measured timings

From real Test Now traces. Milliseconds from each worker's start.

| Run | Workers | Security check | Proofs | Checkout POST | Hold | QR |
|---|---|---|---|---|---|---|
| 18f36d19 | 6 | 4,635–6,270 | 295–1,221 | 1,122–2,079 | 6,204–8,897 | 7,461–10,366 |
| 204c1e4c | 6 | 4,745–5,177 | 361–1,177 | 1,179–1,633 | 6,599–7,940 | 8,200–9,537 |
| b78006cc | 4 | 4,416–**8,652** | 718–1,146 | 1,126–1,293 | 6,442–**10,499** | 7,974–**11,557** |
| 2b95e6c9 | 4 | 4,333–4,751 | 768–1,163 | 1,402–1,648 | 6,605–7,483 | 7,766–8,834 |
| 2537ab8f | 4 | 4,368–5,050 | 450–853 | 806–1,380 | 6,325–6,603 | 7,713–8,732 |
| bba49846 | 4 | 4,327–4,979 | 487–878 | 957–1,244 | 6,225–6,768 | 7,393–8,279 |
| 3b4eadb5 | 4 | 3,383–3,893 | 511–875 | 877–1,191 | 4,969–5,879 | 6,119–6,916 |
| e481a852 | 4 | 2,385–3,375 | 796–1,032 | 1,059–1,425 | 4,549–5,347 | 5,989–6,380 |
| 9acd2821 | 4 | 3,624–4,174 | 817–904 | 1,030–1,785 | 5,527–6,674 | 7,129–8,083 |
| 73e09eef | 4 | 3,623–4,105 | 872–1,649 | 1,000–1,793 | 5,641–7,412 | 6,836–8,251 |
| 641a01e5 | 2 | 4,020–4,201 | 1,114–1,221 | 1,768–1,903 | 7,086–7,146 | 8,823–8,851 |
| 33842079 | 2 | 3,175–5,361 | 1,147–1,198 | 968–1,958 | 6,333–7,479 | 7,483–8,462 |
| Release 7df09f44 (Sep 22) | 1 | 3,634 (prewarm) | — | — | — | — |

**Overall ranges:**

| Step | Range |
|---|---|
| Security check | 2.4–8.7 s |
| Proofs | 0.3–1.6 s |
| Checkout POST | 0.8–2.1 s |
| Worker start to hold | 4.5–10.5 s |
| Worker start to QR | 5.7–11.6 s |

At release, the security check is done ahead of time, so the dispatch-to-hold time should be about proofs + POST (~1.1–3.7 s).

## Appendix E — Durable journal inventory

`.local/api-booking/api-first-journals/`, as of 05:00 today:

| State | Count | Notes |
|---|---|---|
| verified | 43 | Targets 2026-09-21 to 2026-09-24, hours 08:00–16:00, courts 1–7 |
| unknown | 2 | Target 2026-09-21 (dev, 2026-09-19), `CHECKOUT_BOOKING_INVALID`, courts 6 and 7 |
| For 2026-09-25 | **0** | Nothing will block Friday keys |
| Proofless / evening | **0** | Never attempted |

Also: `recycle-locks/` empty; `expired-holds/` 67 archives; `rejected-attempts/` 4 archives.

## Appendix F — Read-only checks performed

| Check | Result |
|---|---|
| `git status`, log, branches, diff stats in `Source/` | Clean tree at `2969311` |
| Directory diff, installation vs `Source/` | `src/`, `ui/`, `scripts/` identical; `dist/ui` newer in the installation |
| Lock files and owner PIDs (`Get-Process`) | Both owners dead |
| Chrome processes and listening ports | No dedicated browsers; foreign Chrome on 9222 |
| Env key names only (no values printed) | A–H IDs and contact bindings present; no timing overrides |
| Trace and journal summaries (local scripts in a temporary folder) | Appendices C–E |
| `w32tm /query /status`, `/stripchart` (query only) | Not synchronized; +0.33 s |
| SNTP queries to time.google.com, time.windows.com, time.cloudflare.com | Local behind 330–339 ms |
| One GET of Onda's public availability for an already-open date (headers only) | Not CDN-cached |
| Power and battery (`powercfg /q`, `Win32_Battery`) | AC, sleep never on AC |
| `tsc --noEmit` and `vitest run` in an isolated copy | Pass; 69 files, 812 tests |

No booking-related request, lock change, configuration change, or clock change was made.
