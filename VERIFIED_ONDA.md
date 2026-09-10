# Onda evidence — September 10, 2026 (Asia/Manila)

Status: **selection and checkout through Payment Summary verified; real release and final payment handoff unverified**. Phase-2 structural inspection was authorized separately from the original select/deselect-only practice.

## VERIFIED — grid and normal navigation
Observations made through dedicated visible Chrome 152.0.7977.83, attached with Playwright 1.63.0 over localhost CDP. No backend payloads or private endpoints were inspected. Local evidence is ignored under `DiagnosticsLocal/`.

| Item | Direct observation |
|---|---|
| URL | https://app.onda.fit/book/thirsty-pickle |
| Venue | `public-booking-hero-title` text: `Thirsty Pickle \| SM Seaside` |
| Authentication | Public schedule, selection and checkout through Payment Summary worked without manual login in this dedicated profile. |
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
| Proceed | `booking-selection-summary-proceed-button`; visible text `Proceed`. Clicked only for the authorized phase-2 noncompetitive checkout inspection. |
| Selection summary | `booking-selection-summary-sheet`, `booking-selection-summary-count`, `booking-selection-summary-amount` |
| Review Booking | Role heading, exact `Review Booking`, h1; venue h2. URL remains the exact booking URL. |
| Player Information | Role heading, exact `Player Information`, h3. Textboxes by exact accessible labels `Full Name`, `Phone Number`, `Email Address`. Types text/tel/email; no names or testids. |
| Payment Summary | `booking-review-payment-summary-sheet`, heading `Payment Summary`, h3. Still on the same URL with Review visible behind it. |
| Terms | `booking-review-terms-panel`, native checkbox accessible name `I agree to the Terms and Conditions, Privacy Policy, and Liability Waiver`; initially unchecked. Never checked live. |
| Final Onda action | Role button, accessible name `Continue to Payment`, visible text `Confirm & Proceed to Payment`; disabled with unchecked terms. Inspected, never clicked live. |

## Authorized practice proof

September 11, 2026, Court 1: Mango Wing, 10:00–12:00. Both 10:00–11:00 and 11:00–12:00 cells were OPEN. Selected both, verified same court and hours, observed `1 Court • 2 Slots` and ₱1,200, deselected both, verified zero selected cells and both OPEN. Repeated successfully using the finished `npm run practice` command. No Proceed, reservation, review, terms, or payment interaction.

The legend also has `data-slot-state="selected"`: selection counts MUST be scoped to actual booking cells.

## Measurements and limits

Five read-only local samples, roughly 05:12: one-pass snapshot plus strict local validation took 28.91, 7.93, 5.79, 6.20, 7.93 ms; median 7.93 ms. Repeated locator comparator took 415.39, 338.43, 322.09, 353.47, 317.15 ms; median 338.43 ms. Comparator performed 225 round trips (count, label and disabled for 112 cells) and collected fewer fields than the one-pass snapshot. These are sequential small-sample diagnostics, not release-time guarantees.

Phase-2 live timings and their limits are in [UI_PHASE2_REPORT.md](UI_PHASE2_REPORT.md). Scheduler error, release refresh→horizon, final-button handoff and overall release→booking performance remain unmeasured. No early trigger, private API or raw-click optimization is justified.

## VERIFIED — phase-2 checkout, approximately 15:41–15:58 Manila

The earlier Court 1 pair was no longer fully available. The explicitly identified development target was September 11, Court 7, 10:00–12:00, with several alternative courts open at both hours. The engine selected exactly two slots, verified `1 Court • 2 Slots`, ₱1,200 and actionable Proceed. A later measured pass exercised the production adapter through Payment Summary. Both inspections stopped with terms OFF before the final action. Personal inputs and test selections were subsequently cleared through normal UI controls; today's clean grid was restored and the inspection's own lock released after its owner had exited.

Review evidence: venue h2's parent contains the full date `Friday, September 11, 2026`; h3 `Your Reservations (2)` gives the count. Exactly one `booking-review-reservation-date` contains `Fri, Sep 11`. Its parent card has `Court 7: Mango Wing` and the two time spans `10:00 AM - 11:00 AM`, `11:00 AM - 12:00 PM`. No Review price is displayed. Duration is derived from the counted, consecutive hourly rows.

Phone evidence: the tel input's parent has a separate `+63` span. The input has maxlength 16; email maxlength 100. Normal fill accepts the local leading-zero form and presents ten national digits with spaces (`### ### ####`). The adapter explicitly accepts PH mobile forms starting with 09, 9, +639 or 639, fills ten national digits, then strips display formatting to verify the represented number. Unsupported/ambiguous formats fail. No real player values are stored in tracked fixtures, logs or screenshots.

After validated player fields, the exact role button `Proceed` appears. Clicking it opens the Payment Summary sheet. Its rental row read `Court rental (2 × ₱600.00)` and its exact `Total` span's sibling read `₱1,200.00`. The sheet does not duplicate court/date/time: the adapter revalidates the actual Review card behind it. `booking-review-slot-hold-notice` explicitly says the slot is not reserved yet and describes a 10-minute hold after continuing to payment. Selection alone must never be described as a secured reservation.

A same-date calendar selection was observed leaving `aria-expanded=true`; navigation now closes it through the existing picker button before selection. Initial test clicks on a non-visible tab timed out without selecting; keeping the Onda tab visible resolved this. No force click or visibility bypass was added.

## IMPLEMENTED

- Existing release scheduler, strict grid barrier and one-pass snapshot feed the selection engine.
- Consecutive same-court selection, exact summary verification, 1–5 bounded untried candidate attempts (default 3), proven-owned cleanup, retained selection lock.
- Normal DOM checkout adapter, exact summary comparisons, local player loading/normalization, explicit terms contract and one-way final-action gate.
- Offline DOM tests reproduce inspected Review/Player/Payment structures and exercise the final boundary only in a test-owned browser.
- Capability state: selectionReady=true, checkoutReady=true, paymentBoundaryReady=false. Full Booking remains blocked before browser attachment.

## UNVERIFIED

1. Actual 08:00 release timing, refresh necessity, horizon enablement and loading under release contention.
2. Live acceptance of terms and the final Onda action, its navigation/hold behavior and payment-provider handoff. These were deliberately not exercised; a separately authorized boundary test is still needed before Full Booking can be enabled.
3. Real lost-race contention. Conflict, partial-selection cleanup and bounded fallback are proven by synthetic tests, not manufactured contention against other users.
