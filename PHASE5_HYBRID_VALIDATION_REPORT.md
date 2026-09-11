# Current readiness: hybrid enabled for September 12 at 08:00 Manila

The user explicitly accepted the alternative live validation plan and requested hybrid activation. The September 12 Court 4 08:00-09:00 dry validation PASSED using production hybrid ranking: API+UI candidate, full grid agreement, estimated PHP 700, GET 344.9512 ms, zero slot or Proceed clicks. Together with the earlier seven-court live comparison PASS, this supports local activation. The original saved three-hour plan remains unchanged; its candidate availability at release is not guaranteed by the one-hour validation.

Local effective settings are now `AVAILABILITY_DISCOVERY_MODE=hybrid`, `RELEASE_PREOPEN_CALENDAR=true`, and `RELEASE_LEAD_MS=0`. Global defaults are unchanged and `.env.local` remains ignored. A fresh read-only readiness check confirmed dedicated Chrome/profile/tab/venue verified, clean schedule, All Courts, zero selections, no hold, lock clear, player configured and plan valid. Next target: September 14, release September 12 at 08:00 Asia/Manila. **READY TO ARM; NOT ARMED.** The user will arm the production run explicitly. This update supersedes the historical hybrid-OFF decision below.

# Phase 5 live hybrid validation - September 12, 2026

## Decision

**Hybrid rollout: NOT READY.** Keep local `AVAILABILITY_DISCOVERY_MODE=ui`. The single live API/UI comparison passed, but neither already-bookable date has a candidate matching the unchanged real booking plan. No candidate validation PASS was manufactured. No production or dry race was armed. No booking was created.

The concrete remaining blocker is a successful live API+UI candidate validation using the current plan. Both September 12 and 13 returned no candidate for the configured 17:00 primary start, three-hour duration, court order, fallback starts and maximum price. Do not change the plan merely to obtain a PASS, and do not probe the unreleased September 14 target.

## Git

Initial HEAD: `9c78b7d`, clean `main`, synchronized with origin/main. The Phase 5 commit and push are reported in the final handoff. No local configuration, profile, diagnostic JSON, raw API response or player/payment data is included in the commit.

## Chrome and lock

The original verifier failed again with `CDP_PROFILE_OR_BIND_UNVERIFIED` outside the sandbox. A separate read-only listener query established **CDP_NOT_LISTENING**. Starting dedicated Chrome through the project launcher restored verification. This establishes the cause of the reproduced failure; the historical generic error alone cannot prove the exact earlier machine state. No profile false negative was demonstrated and no browser-ownership redesign was needed.

The shared PowerShell verifier now emits only closed diagnostic codes for absent listener, unsafe bind, ambiguous owner, unavailable metadata, non-Chrome process, missing profile and wrong profile. Command lines never cross its output boundary. Attachment separately sanitizes endpoint connection failure as `CDP_ENDPOINT_UNAVAILABLE`. Windows, localhost-only port 9222, one owning process, the dedicated absolute profile and exact Onda tab requirements remain enforced. Existing verified sessions are reused; conflicting/unverifiable sessions fail closed and are never killed automatically.

Dedicated Chrome: PASS. Localhost-only: YES. Expected profile: YES. Exact tab and venue: VERIFIED. All Courts: YES. Selected slots: 0. Payment hold: NONE. Visible clean schedule: YES.

Existing Review Lock found `VERIFIED_STALE_LOCK`, old PID dead, no automation worker, clean dedicated schedule, zero selections and no hold. Existing fingerprint/PID/browser rechecks cleared it safely. Final lock: CLEAR.

## Live API comparison

Exactly one `availability:compare`, on stable bookable date **2026-09-12**:

| Metric | Result |
| --- | --- |
| Request duration | 152.4429 ms |
| Known courts | 7 |
| Hour slots parsed | 112 |
| Available slots | 6 |
| API/UI agreed | 112 |
| DOM open / API closed | 0 |
| DOM closed / API open | 0 |
| Unknown spaces | 0 |
| PASS | YES |

No raw response was logged. No member-only endpoint integration was necessary.

## Live hybrid dry validation

`availability:dry` uses loaded local booking configuration, `compilePreferences`, the existing parser, `hybridPreferences` (including production API candidates and price filtering), strict DOM validation and `resolvePreference`. One bounded same-origin GET per invocation; only normal calendar navigation is allowed. Before/after safety reads reject changes or dirty state. It never enters selection or checkout code.

| Date | GET latency | Source | Chosen court/hours | API/UI agreement | Candidate PASS |
| --- | --- | --- | --- | --- | --- |
| 2026-09-12 | 1278.9388 ms | UI_ONLY | None | YES | NO |
| 2026-09-13 | 486.1815 ms | UI_ONLY | None | YES | NO |

The second already-bookable date was checked because the first had no matching candidate. Primary start: 17:00. Duration: 3 hours. Estimated candidate API price: unavailable. Slot clicks: **0**. Proceed clicks: **0**. Reservations/payment interactions: **0**. No API request was made for September 14. Today's September 12 schedule was restored through the normal calendar under an exclusive lock after these diagnostics.

## Local config and readiness

`.env.local`, `config.local.json`, `DiagnosticsLocal` and the dedicated profile are gitignored. Local configuration was left unchanged:

- `RELEASE_PREOPEN_CALENDAR=true`
- `AVAILABILITY_DISCOVERY_MODE=ui`
- `RELEASE_LEAD_MS=0`
- Global availability default remains `ui`.

Final `release:readiness`: CDP READY; dedicated profile/exact tab/venue VERIFIED; schedule CLEAN; All Courts YES; selected slots 0; payment hold NONE; lock CLEAR; player CONFIGURED; booking plan VALID; pre-open ON; availability UI; lead 0 ms. Target September 14, release September 12 at 08:00 Asia/Manila. This read-only command does not acquire a lock, navigate, reload or click, and prints no player values.

Dedicated Chrome, schedule, booking plan, player and pre-open: READY at the final observation. Hybrid: BLOCKED. **Overall next 08:00 hybrid rollout: NOT READY.** The UI-only path remains available, subject to the user's later explicit arming and ordinary fresh preflight.

## Release behavior and telemetry

Production timing is unchanged: launch one initial GET at release alongside the existing UI path; no-refresh may allow it to complete. Reload may destroy the fetch and does not restart it. A ready strict target grid never waits for pending API discovery. No pre-release polling, release-lead change, direct checkout POST, proof handling, QR automation or payment polling was added.

Existing event traces retain release trigger, pre-open decision, request/response/parser, reload fallback, strict grid, snapshot, candidate resolution/source, slot click, verified selection, booking Proceed, Review, player Proceed, Payment Summary, final Onda action and QR handoff. The numeric summary now adds request outcome, no-refresh observation, whether API candidates existed before grid, candidate source and selection-to-QR-hold duration. Missing durations remain null. Canceled or failed optional requests are reported together rather than pretending a precise network failure cause was measured.

No Electron UI redesign or status persistence was added. The launcher and CLI provide the new diagnostics; existing UI controls continue to use the same launcher.

## Verification

Typecheck: PASS. UI build: PASS. Diff check: PASS. Full serial regression suite (`npm test -- --maxWorkers=1`): 316 tests across 20 files PASS. The default parallel run passed all 316 assertions but failed an existing grid-test browser-close hook at its 15-second timeout; the focused rerun and complete serial suite passed. No timeout or production behavior was weakened. Focused tests cover sanitized CDP classification, launcher reuse/refusal policy, real-config hybrid ranking and maximum, wrong-date/missing API fallback, no-candidate results, zero booking clicks, read-only readiness, and new telemetry. Existing pending-API, reload-destroyed request, strict-grid and checkout safety regressions remain in the suite. No material Electron UI source change, so an EXE rebuild is not required.
