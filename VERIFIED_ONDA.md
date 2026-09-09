# Onda evidence — September 10, 2026 (Asia/Manila)

Status: **booking-grid proof complete; production checkout and release proof incomplete**.
Observations made through dedicated visible Chrome 152.0.7977.83, attached with Playwright 1.63.0 over localhost CDP. No backend payloads or private endpoints were inspected. Local evidence is ignored under `DiagnosticsLocal/`.

| Item | Direct observation |
|---|---|
| URL | https://app.onda.fit/book/thirsty-pickle |
| Venue | `public-booking-hero-title` text: `Thirsty Pickle \| SM Seaside` |
| Authentication | Public schedule and select/deselect worked without manual login in this dedicated profile. Checkout authentication is unknown. |
| Initial date | Thu, September 10, matching Manila calendar date |
| Pre-release horizon | At about 05:01, September 10 and 11 were enabled; September 12 was disabled. Consistent with the user-reported rule, but does not prove the release time. |
| Release time / +2 rule | User-reported 08:00 / +2 days. Not yet witnessed across an actual release. |
| Refresh required | Unknown until actual release observation |
| Pre-navigation | September 12 could not be selected before release; its normal calendar button was disabled. No attempt to force it. |
| Next day | Role button, exact name `Next day`; enabled on September 10, disabled on September 11. One enabled click advances one day. |
| Previous day | Role button, exact name `Previous day`; disabled on September 10 |
| Calendar | Role button `Select booking date`; `aria-expanded`; day buttons have `data-day="9/11/2026"`, disabled state, and accessible full date including year. |
| Date URL | Both arrow and calendar navigation left URL unchanged. No date URL discovered or invented. |
| Reload persistence | Reload from September 11 reset to September 10. Post-refresh navigation is necessary in the observed UI. |
| Selected date heading | `booking-selected-date-label`: `Fri, September 11` (no year) |
| Grid | `booking-grid-body`; header `court-schedule-sticky-header`; content `court-schedule-grid-content` |
| Court headings | Seven headings `Court 1: Mango Wing` through `Court 7: Mango Wing` inside sticky header |
| Hour rows | `data-schedule-grid-row-time="08:00"` etc., 16 rows from 08:00 through 23:00 |
| Row date | `data-schedule-grid-row-date="2026-09-11"`, on each actual cell's parent row |
| Cells | `button[data-testid="court-schedule-slot-cell"]`, seven per row, 112 total |
| OPEN | Enabled button, aria-label ending `available`, descendant `data-slot-state="available"` |
| TAKEN | Disabled button, aria-label ending `unavailable`, descendant `data-slot-state="unavailable"` |
| SELECTED | Enabled button, aria-label ending `selected`, descendant `data-slot-state="selected"` |
| UNKNOWN | Any missing/conflicting/unrecognized state; never selectable |
| Strict grid barrier | Matching heading + all 16 actual row dates equal full ISO target date + seven cells per row + no `aria-busy="true"`; full snapshot also validates unique court/hour coverage. |
| Transition evidence | September 11→10: heading changed, rows disappeared, `aria-busy=true`; roughly 385.2 ms later new rows appeared with September 10 dates. Single ordinary transition, not a release benchmark. |
| Proceed | `booking-selection-summary-proceed-button`; visible text `Proceed`. Observed, **never clicked**. |
| Selection summary | `booking-selection-summary-sheet`, `booking-selection-summary-count`, `booking-selection-summary-amount` |
| Review Booking | Not inspected; no production selector |
| Player Information | Not inspected; no production selectors |
| Payment Summary | Not inspected; no production selector |
| Terms | Not inspected; no production selector |
| Final Onda action | User reports `Confirm & Proceed to Payment`; not independently inspected or clicked |

## Authorized practice proof

September 11, 2026, Court 1: Mango Wing, 10:00–12:00. Both 10:00–11:00 and 11:00–12:00 cells were OPEN. Selected both, verified same court and hours, observed `1 Court • 2 Slots` and ₱1,200, deselected both, verified zero selected cells and both OPEN. Repeated successfully using the finished `npm run practice` command. No Proceed, reservation, review, terms, or payment interaction.

The legend also has `data-slot-state="selected"`: selection counts MUST be scoped to actual booking cells.

## Measurements and limits

Five read-only local samples, roughly 05:12: one-pass snapshot plus strict local validation took 28.91, 7.93, 5.79, 6.20, 7.93 ms; median 7.93 ms. Repeated locator comparator took 415.39, 338.43, 322.09, 353.47, 317.15 ms; median 338.43 ms. Comparator performed 225 round trips (count, label and disabled for 112 cells) and collected fewer fields than the one-pass snapshot. These are sequential small-sample diagnostics, not release-time guarantees.

Not measured: scheduler error at an actual release, release refresh→horizon, release date navigation, release strict-grid readiness, checkout timings, final-button handoff, overall booking speed. No observer or raw-click optimization justified yet.

## Remaining proof

1. Observe real 08:00 boundary, reload requirement, enablement and grid loading. The session started around 05:00, several hours before release; no observation has been claimed.
2. Separately authorize and inspect checkout, using an appropriate target and player data. The latest user instruction explicitly forbids Proceed/Review during this practice.
3. Implement production checkout adapter only from that DOM, including any public UI URL changes and summary/amount validation. Current navigation guard intentionally only allows the inspected schedule URL.
4. Add real checkout semantics to synthetic fixtures and run a complete fixture E2E before unlocking live race.
