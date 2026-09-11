# Next Onda release readiness — September 11, 2026

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
- Optional single-reload profiler: NOT RUN / not added. No resource blocking was added.

## Validation

- `npm run typecheck`: PASS.
- `npm test`: 234 tests PASS across 14 files.
- `npm run ui:build`: PASS.
- `git diff --check`: PASS.
- New diagnostic: fixture success and failure cases PASS; live invocation safely refused at the retained-lock guard.

Tests cover calendar closure, duplicate/changed target, unexpected availability, selection/state changes, navigation, hidden tab, security challenge, filter change, safe time window, Manila year rollover, exactly five observation checkpoints, no reload/booking clicks, both release branches, missing timing endpoints, per-attempt timing separation, immediate-stop evidence preservation, and actual renderer strategy/readiness status. Existing selection and full-booking tests remain passing.
