# Phase 4: hybrid availability discovery

Initial HEAD: `bce4056`. Existing uncommitted Phase 4 work was reviewed and completed in place.

## Architecture and rollout

`AVAILABILITY_DISCOVERY_MODE=ui` remains the global and effective local default. The only other accepted mode is `hybrid`. Local `RELEASE_PREOPEN_CALENDAR=true` is preserved; release lead remains 0 ms. Local configuration is ignored and unchanged.

Hybrid launches one same-origin browser `fetch` GET at release, alongside the existing calendar/no-refresh or bounded reload path. A reload may cancel that request; it is not restarted automatically. At the strict target grid, discovery consumes only a response already completed. It never awaits a slow request. Early API candidates are compiled using the existing preferences and reused against the current DOM snapshot. API and OPEN UI intersection retains configured time/court order. If no intersection exists, strict UI discovery remains available; fully known PHP prices above MAX_PRICE remain excluded. Optional missing prices do not exclude candidates. UI amount checks remain authoritative.

The seven explicit court UUID mappings match the supplied verified mapping; live API/UI mapping confirmation in this phase is NOT VERIFIED. Unknown spaces are ignored and counted. Malformed, duplicate, wrong-date or bookingDate-inconsistent data cannot authorize API candidates. Unrelated response fields are stripped.

After a real selection conflict and verified owned-partial cleanup, discovery may launch one refresh while the UI is read again. Attempted candidates stay excluded. Maximum three requests per run, one in flight, no polling. Pending/failed refreshes use the UI path. Rate limiting, access blocks and security challenges stop shared Safety; ordinary GET failures fall back. Header security checks also run outside browser evaluate to survive execution-context loss.

Strict heading, row dates, grid completeness, busy-state barrier, one-pass initial DOM snapshot, verified slot clicks, cleanup, Review Booking, player form, Payment Summary, Terms, normal final UI action and QR handoff are preserved. Direct `is-slot-available` calls: NONE. Direct `public-checkout` calls: NONE. Availability proof handling: NONE. Payment automation: NONE.

## Diagnostics and live validation

Run `npm run availability:compare -- --date YYYY-MM-DD` on a currently bookable date. It requires the dedicated visible Chrome session, exclusive automation lock, normal clean venue schedule, All Courts and no selection/hold. It navigates only the calendar, validates the grid, issues at most one GET, and prints sanitized counts and request duration. A second read checks that the UI did not change during the GET. It never selects or proceeds.

Live command attempted once for **2026-09-11**, with a sandbox retry after `spawn EPERM`. The actual command stopped at `CDP_PROFILE_OR_BIND_UNVERIFIED`, before a GET or date/slot interaction. The failure lock was retained under the existing policy. No reservation was performed. API latency, parsed courts/slots, agreement, disagreements and unknown-space counts: **NOT MEASURED**.

`race:dry` reports release branch, request success/fallback, API latency, candidate source and chosen court/hours without selecting. Rate limits terminate through the existing RATE_LIMITED error path. Hybrid dry release passed browser-fixture coverage for early response, pending response and reload cancellation. Live dry race: NOT RUN because the dedicated browser prerequisite failed. Hybrid production remains disabled pending successful live compare and dry validation.

## Telemetry and performance

In-memory marks cover request start/response/parse, early API candidates, final candidate resolution, fallback, agreement/disagreement, refresh and candidate source. Per-request timings remain separate. Existing release, selection and checkout telemetry is preserved; no critical-path disk I/O was introduced.

Live request duration, parse duration, candidate resolution, API candidate ready to grid, target grid to first click, release to first click, and all subsequent selection/checkout intervals: **NOT MEASURED**. Missing timing endpoints serialize as null. The API does not by itself fix the historical 18-second release load; pre-open/no-refresh remains the primary release-latency strategy.

## Open questions

- Whether exact-date availability appears at 08:00 before the calendar enables.
- GET latency during release contention.
- Whether `member-only-court-slots` affects this user's eligibility; it is not integrated.
- API/UI disagreement under contention, including potential membership restrictions.
- Stability of Onda's undocumented frontend route.

## Next 08:00 readiness

**NOT READY for hybrid rollout.** Concrete blockers: dedicated Chrome profile/bind is unverified; successful live API/UI comparison and live dry race are outstanding. Review the retained lock through the existing Review Lock workflow after restoring a verified clean schedule. Do not enable hybrid on unexpected disagreement.

Validation: typecheck PASS; 307 tests PASS across 18 files; UI build PASS; diff check PASS. UI source was unchanged, so EXE build was not required. The commit and push result are reported separately after Git verification.
