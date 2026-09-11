# Current readiness: hybrid enabled for September 12 at 08:00 Manila

The user explicitly accepted the alternative live validation plan and requested hybrid activation. The September 12 Court 4 08:00-09:00 dry validation PASSED using production hybrid ranking: API+UI candidate, full grid agreement, estimated PHP 700, GET 344.9512 ms, zero slot or Proceed clicks. Together with the earlier seven-court live comparison PASS, this supports local activation. The original saved three-hour plan remains unchanged; its candidate availability at release is not guaranteed by the one-hour validation.

Local effective settings are now `AVAILABILITY_DISCOVERY_MODE=hybrid`, `RELEASE_PREOPEN_CALENDAR=true`, and `RELEASE_LEAD_MS=0`. Global defaults are unchanged and `.env.local` remains ignored. A fresh read-only readiness check confirmed dedicated Chrome/profile/tab/venue verified, clean schedule, All Courts, zero selections, no hold, lock clear, player configured and plan valid. Next target: September 14, release September 12 at 08:00 Asia/Manila. **READY TO ARM; NOT ARMED.** The user will arm the production run explicitly. This update supersedes the historical hybrid-OFF decision below.

# Phase 5 current readiness - September 12, 2026

Dedicated Chrome, exact Onda tab, clean today schedule and retained lock are resolved. The single live API/UI comparison passed: 7 courts, 112 slots, 112 agreements, zero discrepancies or unknown spaces; GET 152.4429 ms. Safe hybrid dry checks on September 12 and 13 found no candidate for the unchanged current booking plan. **Hybrid remains OFF locally (`ui`), pre-open ON, lead 0 ms.** No booking or race was armed. Next target: September 14 at the September 12 08:00 Manila release.

**NEXT 08:00 HYBRID ROLLOUT: NOT READY** until a real configured candidate passes live API+UI dry validation. Browser/schedule/lock/player/plan readiness now passes; the UI-only production path remains available for the user's later explicit arming. Today's schedule was restored for normal preflight. See [Phase 5 report](PHASE5_HYBRID_VALIDATION_REPORT.md). Historical entries below are superseded by this update.

# Phase 4 readiness update

Hybrid implementation is complete; rollout remains **UI ONLY** pending live validation. Local pre-open is currently **ON**, verified without exposing other local settings; lead is **0 ms**. This supersedes the historical local-OFF entries below.

The availability comparison for 2026-09-11 stopped at `CDP_PROFILE_OR_BIND_UNVERIFIED` before any availability GET or booking interaction. The existing failure-lock policy retained the lock. Restore the dedicated Chrome session and use Review Lock before repeating live validation. Live API agreement and live dry race remain unverified; **NEXT 08:00 HYBRID READINESS: NOT READY**. See [Phase 4 report](HYBRID_AVAILABILITY_REPORT.md) for implementation, tests, missing measurements and concrete blockers.

# Next Onda release readiness — September 11, 2026

## Phase 3 latency hardening update

Initial HEAD: `d4e0896` on clean `main`. Phase 3A's existing Review Lock logic was run read-only, including outside the sandbox to rule out process-access restrictions. Result: `LOCK_BROWSER_STATE_UNKNOWN`; recorded PID dead, browser page/selection/hold unknown, `canClear=false`. The retained lock was preserved. Per the requested safety gate, live testing stopped without calendar interaction or reload. No new 60-second pre-open run or normal reload profile occurred in this phase.

- PREOPEN UI STABILITY: NOT RUN / NOT VERIFIED. Duration and calendar-open, unique-target, represented-target and unchanged-booking observations: NOT MEASURED.
- Local `RELEASE_PREOPEN_CALENDAR`: OFF, verified from loaded settings. Global default false. `.env.local` remains ignored and unchanged.
- AUTO-ENABLE AT 08:00: UNVERIFIED. Fallback: NORMAL RELOAD. Lead: 0 ms.
- New command: `npm run release:reload-profile`. Exactly one commit reload after clean schedule, local dedicated CDP, exclusive automation lock, unique Onda tab, visibility and closed-picker checks. No target, slot or Proceed clicks. Reuses production structural shell readiness without trial clicks or document-complete waits.
- Live reload start→commit, commit→venue attached/visible, commit→picker attached/visible/enabled, commit→shell and total reload→shell: all NOT MEASURED. Classification: NOT MEASURED.
- LEAN_RELOAD_JUSTIFIED: NO. No successful live profile exists; the historical release congestion observation alone does not justify interception. Phase 3C not implemented; no lean flag or routing added.
- Phase 3D: not run. All new selection subphase measurements NOT MEASURED; selection code unchanged because 3A/3B live prerequisites are incomplete.

Precomputation audit: release date, day selector, heading and ordered court/time/hour matrix are constructed before the wait. Configuration, maximum price, player validation and mode/capability checks happen before attachment; UI plan fingerprint is verified before the wait when supplied. CLI runs without a plan hash do not consume a fingerprint. Selection retains its existing defensive preference validation; no compilation was moved into the release interval.

Critical-path audit: successful release/selection has no diagnostic flush, screenshots, Git operations or configuration disk reads. Telemetry marks remain buffered, with the existing optional UI stdout streaming; its renderer overhead is unmeasured and was not changed speculatively. Failure/abort diagnostics remain immediate. Strict target grids on both branches, maximum two production reloads, Onda rate-limit stops, third-party false-positive protection, and full booking-to-QR behavior remain unchanged.

Readiness: NO-REFRESH PATH NOT READY (local OFF, live stability unverified). RELOAD FALLBACK code READY; operator session NOT READY. OVERALL READY FOR NEXT 08:00: NO. Concrete blocker: restore and verify a clean dedicated Onda schedule and safely clear the retained lock through Review Lock. Then complete the two authorized diagnostics; enable pre-open locally only after the real stability PASS.

The earlier validation history below is retained for context; this Phase 3 update supersedes its statement that no profiler exists.

Phase 3 validation: typecheck PASS; all 260 tests across 15 files PASS; UI build PASS; diff check PASS. No UI source or launcher semantics changed, so no EXE rebuild was needed. Fixture coverage includes unsafe Manila boundaries, dirty/hidden/ambiguous/hold states, exactly one reload, zero profiler clicks, partial failure milestones, descriptive thresholds, sanitized missing measurements, readiness before document completion, pre-wait preference compilation and no release diagnostic flush. Existing selection and full-booking tests passed unchanged.

V2 was validated first (218 tests, typecheck, UI build, diff check), then committed and pushed to origin/main as `db3e412` — Harden Onda release fallback and rate-limit diagnostics.

## Calculated release

- Release: September 12, 2026 at 08:00:00.000 Asia/Manila.
- Target: September 14, 2026, derived from the existing releaseCalendar engine with tomorrow's Manila date and the configured +2 horizon.
- Release lead: 0 ms.
- Local pre-open configuration: OFF; global default remains false.
- `.env.local` is gitignored, was not changed, and is not included in either commit.
- Player and booking configuration: valid. No player values were printed or persisted in the report.

## Live validation outcome

PREOPEN UI STABILITY: NOT VERIFIED.

AUTO-ENABLE AT 08:00: STILL UNVERIFIED.

The dedicated Chrome/CDP endpoint was reachable and the dedicated profile check passed. However, the browser had no exact Onda booking tab, and the existing retained automation lock could not be cleared safely. Read-only lock reviews returned `LOCK_BROWSER_STATE_UNKNOWN`, with the old process exited but schedule, existing selections and payment hold state unknown. The lock was left intact.

`npm run release:preopen-check` was attempted once. It refused with `AUTOMATION_LOCK_EXISTS` before attaching or clicking anything. Observation duration: 0 seconds. Calendar remaining open, target representation and booking-state stability were NOT MEASURED. Slots selected by this work: 0; existing browser selections remain unknown. No reloads, date clicks, slot clicks, Proceed clicks, reservations, private API calls or booking network probes were performed.

READY FOR TOMORROW 08:00: NO, pending restoration and verification of the browser session and safe lock clearance. The improved V2 reload path remains available once those ordinary readiness requirements are met.

## Diagnostic and operator workflow

The new `npm run release:preopen-check` diagnostic uses the normal visible calendar. It requires a clean, strictly validated schedule, All Courts, a visible tab, zero selected slots and a closed date picker. It computes tomorrow's unreleased target, opens only the picker, verifies the unique visible disabled day and unchanged booking snapshot, then checks at start and approximately 15, 30, 45 and 60 seconds. On success it closes the picker and verifies the original schedule again. It never clicks the target date, selects a slot, proceeds, reloads or requests a private API. On failure it leaves the browser untouched for review and retains the automation lock.

To complete live validation, return the dedicated Chrome session to the normal Thirsty Pickle schedule with All Courts and no selections or hold. Use the existing Review Lock workflow; only a verified stale lock may be cleared. Keep the tab visible, then run the diagnostic once. A successful result is saved under ignored `DiagnosticsLocal/preopen-check-<runID>.json`. Only after a real 60-second PASS should this user's ignored `.env.local` set `RELEASE_PREOPEN_CALENDAR=true`. The fixture tests do not authorize local activation. A stability PASS still does not prove automatic enablement at release.

## Implemented for the next run

- Explicit preparation, target detection, calendar-left-open, release-check and reload-fallback telemetry. Exactly one branch decision follows the one immediate DOM observation.
- Read-only UI strategy status from the actual loaded local configuration, precise release time/lead, and immediate fallback explanation.
- Next-release readiness display for CDP, Onda inspection freshness, plan, player, pre-open state, selected-slot evidence, lock, per-run terms and calculated next target. Missing/stale inspection data is not labeled ready.
- Sanitized `releasePerformance` summary in every release diagnostic, including handled failures and immediate aborts. It uses monotonic phase differences and separately reports the scheduler's wall-clock firing error. Reload attempts remain separate; missing endpoints stay null/NOT MEASURED.
- Validated UI release-performance event and read-only summary for the current app session. Durable summaries remain in ignored DiagnosticsLocal files.
- Existing strict target grid, selection, checkout/payment logic, Onda rate-limit protection, no automatic retry after an Onda rate limit, maximum two reloads and zero lead remain preserved.
- Single-reload profiler: now implemented in Phase 3; live NOT RUN. No resource blocking was added.

## Validation

- `npm run typecheck`: PASS.
- `npm test`: 234 tests PASS across 14 files.
- `npm run ui:build`: PASS.
- `git diff --check`: PASS.
- New diagnostic: fixture success and failure cases PASS; live invocation safely refused at the retained-lock guard.

Tests cover calendar closure, duplicate/changed target, unexpected availability, selection/state changes, navigation, hidden tab, security challenge, filter change, safe time window, Manila year rollover, exactly five observation checkpoints, no reload/booking clicks, both release branches, missing timing endpoints, per-attempt timing separation, immediate-stop evidence preservation, and actual renderer strategy/readiness status. Existing selection and full-booking tests remain passing.
