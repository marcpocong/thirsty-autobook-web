# Production release report: September 12, 2026

## Result

The bot successfully completed the normal Onda booking flow through a verified QR/payment hold for **Thirsty Pickle | SM Seaside, September 14, Court 7, 18:00-21:00 (three hours), PHP 2,100**. The first slot click began at **08:00:01.624 Manila**; all three selected hours were verified at **08:00:01.911**. The final QR handoff was verified at **08:00:14.684**.

This is a confirmed automation-to-payment-hold success. The saved handoff state was **Pending**, with **09:58 remaining** when verified. It does not record subsequent manual payment or a paid booking confirmation. The user's report that the bot worked is consistent with the saved trace.

The successful route was **RELOAD FALLBACK + UI_ONLY candidate selection**. Hybrid was enabled and launched its optional request, but no API response or parsed candidate completed. The pre-opened calendar did not expose an enabled target at the immediate release check. Both fallbacks worked without stopping the booking flow.

## Evidence and scope

- Production run ID: `b52e5ded-2743-4a0a-ac12-57a17dcedbe3`.
- Source: saved production telemetry, its release/availability summaries, and the retained lock's handoff record. The lock run ID matches the production diagnostic exactly.
- Repository HEAD at report preparation: `806b687`. This commit predates the run; the diagnostic itself does not embed a Git SHA, so exact runtime binary provenance cannot be independently proved from telemetry alone.
- All displayed times are September 12, 2026, Asia/Manila (UTC+8). Elapsed durations use the process monotonic clock. Wall-clock timestamps are millisecond observations; they need not subtract to precisely the same value as monotonic durations.
- No browser interaction, new booking, reload, payment query or lock cleanup was performed to prepare this report. The retained handoff is historical evidence, not a claim that its countdown is still active now.
- Player values, cookies, tokens, QR content and payment URLs are excluded.

## Booking plan and selected result

| Item | Evidence |
| --- | --- |
| Venue | Thirsty Pickle, SM Seaside |
| Booking date | September 14, 2026 |
| Court | 7 |
| Hourly slots | 18:00-19:00; 19:00-20:00; 20:00-21:00 |
| Total duration | 3 hours |
| Verified total | PHP 2,100 |
| Selection attempts | 1 recorded |
| Slot click dispatches | 3 recorded |
| Final Onda action | 1 recorded |
| Handoff | Pending, PHP, countdown 09:58 at verification |

The current saved booking plan has primary start 18:00, duration three hours, court order 7, 6, 5, 4, 3, 2, 1, fallback starts 20:00 and 21:00, and maximum PHP 5,000. Its file modification time precedes the production process start. The result matches that primary time and first-priority court. The trace does not contain a complete immutable configuration snapshot, so these plan details are corroborating local-file evidence rather than run-embedded configuration proof. Earlier 17:00 preparation notes and the Court 4 one-hour validation were not the final selected booking.

## Preparation and release behavior

The process started at 07:47:34.704 and verified the dedicated Chrome/tab at 07:47:36.487. Initial preflight completed at 07:47:36.508. The final preflight ran from 07:59:45.012 to 07:59:45.046. The bot opened the calendar, found the target disabled, and left the calendar open by 07:59:45.152.

The scheduled release was 08:00:00.000; the trigger fired at **08:00:00.010**, a recorded **+10 ms** error. The optional availability GET started 5.314 ms after the trigger. The pre-open check began at 08:00:00.019 and found the target still disabled at 08:00:00.066. A single reload began immediately.

The reload committed at 08:00:00.331. Venue verification completed at 08:00:00.748, and the date picker became enabled at 08:00:01.271. The target date was enabled at 08:00:01.326, clicked by 08:00:01.373, and its strict grid was ready at 08:00:01.600. The snapshot completed at 08:00:01.611. Candidate ranking used UI_ONLY and resolved in 0.283 ms.

**No-refresh outcome: NO for this run's immediate release check.** This does not prove whether the calendar would have self-updated later; the bot intentionally took the immediate fallback instead of waiting.

**Availability request outcome: CANCELED_OR_FAILED.** A fallback event appeared at 08:00:00.307, between reload start and commit. The timing and implementation are consistent with navigation destroying the page-evaluate fetch, but the sanitized trace does not prove the precise transport error. There was one request start, no response-received or parsed event, and no retry/refresh request. Successful API latency and production API/UI agreement are therefore **not measured**. The prior dry comparison results must not be presented as production response measurements.

## Measured performance

| Metric | Duration |
| --- | ---: |
| Trigger to request start | 5.314 ms |
| Trigger to reload start | 56.359 ms |
| Reload start to commit | 264.539 ms |
| Commit to verified venue | 417.039 ms |
| Verified venue to enabled picker | 523.811 ms |
| Trigger to strict target grid | 1,590.840 ms |
| Grid to completed snapshot | 10.820 ms |
| Grid to first slot click | 23.391 ms |
| Trigger to first slot click | 1,614.230 ms |
| First click to verified selection | 286.683 ms |
| Trigger to verified selection | 1,900.913 ms |
| Selection to booking Proceed start | 34.568 ms |
| Booking Proceed start to Review | 864.927 ms |
| Player form fill | 36.939 ms |
| Player Proceed start to Payment Summary | 6,002.228 ms |
| Terms check | 637.596 ms |
| Final Onda action start to QR verification | 5,165.673 ms |
| Selection to QR verification | 12,773.569 ms |
| Trigger to QR verification | 14,674.483 ms |

The exact scheduled 08:00 boundary to QR verification is 14.684 seconds by wall clock; the fired trigger to QR verification is 14.674 seconds by monotonic clock. The approximately 10 ms difference is the scheduler's measured firing error.

Most elapsed time came after selection: 12.774 seconds from verified selection to verified QR handoff, versus 1.901 seconds from trigger to selection. Player Proceed to Payment Summary took 6.002 seconds; final Onda action to QR verification took 5.166 seconds. Together those two intervals account for about 76% of trigger-to-handoff time. These are observed end-to-end UI intervals, not isolated measurements of backend processing or network latency.

## Selection and checkout

1. Court 7's first hour click began at 08:00:01.624 and was verified at 08:00:01.722.
2. The second hour click began at 08:00:01.723 and was verified at 08:00:01.771.
3. The third hour click began at 08:00:01.771 and was verified at 08:00:01.857.
4. Full selection was verified at 08:00:01.911. No second selection attempt, stale-candidate refresh or cleanup sequence was recorded.
5. Booking Proceed began at 08:00:01.945. Review Booking was detected and validated at 08:00:02.810.
6. Player form filling completed at 08:00:02.847. Player Proceed was dispatched; Payment Summary was detected and validated at 08:00:08.849.
7. Terms were checked between 08:00:08.850 and 08:00:09.487. The final Onda action began at 08:00:09.518 and its button click completed at 08:00:09.538.
8. Active booking automation stopped at the payment boundary. Passive observation detected Checkout and a hold at 08:00:13.379, then verified the full QR handoff at 08:00:14.684.

The handoff verifier requires Checkout, an active hold, Pending status, one order summary, QRPH, QR presence, a positive countdown of no more than ten minutes, and an amount matching the verified selection. The recorded Pending result therefore represents more than simply seeing a checkout page.

The repeated `automationStopped` events at the boundary, verified handoff and process completion are separate milestones in the same process. They do not indicate multiple bookings or restarted workers.

## Safety and unexpected events

One third-party HTTP 429 was recorded at 08:00:02.061 during the booking Proceed transition. Its evidence says fetch, non-navigation, Retry-After present, and **not the Onda site**. The bot correctly continued. There is no recorded Onda rate-limit stop, access block, security challenge, abort or terminal failure in this run.

The flow retained strict target-grid validation, visible UI selection, Review and Payment Summary validation, the single final-action boundary, and a retained automation lock containing the matching handoff. There is no recorded selection retry or duplicate final-action event. The implemented path used Onda's normal UI for reservation creation; it did not introduce direct reservation/payment API calls. This report is based on application telemetry rather than a complete network audit.

## What this run establishes

- The production flow completed through a verified hold for the desired primary court/time in one selection attempt.
- The scheduler fired within 10 ms of the intended release boundary.
- The reload fallback restored a usable target grid and reached first click in 1.614 seconds from the trigger.
- The optional availability request failed without blocking the UI path; UI candidate selection continued immediately once the strict grid was ready.
- Third-party rate limiting did not cause a false Onda-wide stop.
- Player, Review, Payment Summary, Terms, final Onda action and passive QR verification completed without a recorded failure.

## What this run does not establish

- A successful no-refresh release: the immediate target observation was disabled.
- Successful release-time API-assisted ranking: no API candidate completed; source was UI_ONLY.
- Production API response latency or API/UI agreement: neither was measured in this run.
- A guaranteed timing improvement caused by hybrid mode: there is no controlled UI-only comparison, and the successful selection itself used UI_ONLY.
- Completed manual payment: the last saved state is Pending. A payment receipt or confirmed booking record would be needed to document the later payment outcome.
- Guaranteed performance on future releases: this is one successful observed run.

## Follow-up assessment

No immediate code change is indicated by this successful run. Preserve the working fallback and nonblocking API policy. If future optimization is requested, first compare repeated release traces: examine whether no-refresh ever succeeds, whether an API response survives before the grid, and whether Payment Summary or final-action-to-QR waits remain the dominant intervals. This single run does not justify adding polling, restarting the initial request after navigation, changing release lead, or bypassing Onda's checkout UI.

## Complete sanitized event timeline

Offsets below are relative to the actual fired trigger at 08:00:00.010. Negative offsets are preparation. Event values are the numeric values recorded by telemetry; their units depend on the event (for example, scheduled epoch milliseconds, trigger error milliseconds, or attempt number).

| Manila time | Offset from trigger (ms) | Event | Recorded value |
| --- | ---: | --- | ---: |
| 07:47:34.704 | -745,306.124 | `processStarted` |  |
| 07:47:36.487 | -743,523.028 | `chromeConnected` |  |
| 07:47:36.487 | -743,522.980 | `ondaTabResolved` |  |
| 07:47:36.489 | -743,520.999 | `preflightStarted` |  |
| 07:47:36.508 | -743,501.763 | `preflightCompleted` |  |
| 07:59:45.012 | -14,997.166 | `preflightStarted` |  |
| 07:59:45.046 | -14,963.717 | `preflightCompleted` |  |
| 07:59:45.046 | -14,963.553 | `preopenPreparationStarted` |  |
| 07:59:45.132 | -14,877.888 | `preopenTargetDetected` |  |
| 07:59:45.152 | -14,857.444 | `preopenTargetDisabled` |  |
| 07:59:45.152 | -14,857.359 | `releaseCalendarPreopened` |  |
| 07:59:45.152 | -14,857.346 | `preopenCalendarLeftOpen` |  |
| 07:59:45.152 | -14,857.334 | `armed` |  |
| 07:59:45.152 | -14,857.327 | `releaseScheduled` | 1789171200000 |
| 08:00:00.010 | 0.000 | `releaseTriggerFired` | 10 |
| 08:00:00.015 | 5.314 | `availabilityRequestStarted` |  |
| 08:00:00.019 | 9.002 | `preopenReleaseCheckStarted` |  |
| 08:00:00.066 | 56.118 | `targetStillDisabledAtRelease` |  |
| 08:00:00.066 | 56.176 | `reloadFallbackStarted` |  |
| 08:00:00.066 | 56.359 | `reloadStarted` |  |
| 08:00:00.307 | 296.948 | `availabilityFallbackToUi` |  |
| 08:00:00.331 | 320.898 | `reloadCommitted` |  |
| 08:00:00.331 | 321.347 | `releaseUrlVerified` |  |
| 08:00:00.727 | 717.101 | `releaseVenueAttached` |  |
| 08:00:00.745 | 735.040 | `releaseVenueVisible` |  |
| 08:00:00.748 | 737.937 | `releaseVenueVerified` |  |
| 08:00:00.758 | 748.174 | `releasePickerAttached` |  |
| 08:00:00.766 | 756.650 | `releasePickerVisible` |  |
| 08:00:01.271 | 1,261.748 | `releasePickerEnabled` |  |
| 08:00:01.273 | 1,263.682 | `releaseShellReady` |  |
| 08:00:01.319 | 1,309.461 | `targetPickerOpened` |  |
| 08:00:01.324 | 1,314.430 | `targetDateDetected` |  |
| 08:00:01.326 | 1,316.454 | `targetDateEnabled` |  |
| 08:00:01.326 | 1,316.489 | `targetDateClickStarted` |  |
| 08:00:01.373 | 1,363.699 | `targetDateClicked` |  |
| 08:00:01.376 | 1,366.697 | `targetHeadingDetected` |  |
| 08:00:01.600 | 1,590.840 | `targetGridReady` |  |
| 08:00:01.604 | 1,594.814 | `gridSnapshotStarted` |  |
| 08:00:01.611 | 1,601.659 | `gridSnapshotCompleted` |  |
| 08:00:01.612 | 1,602.854 | `candidateSourceUiOnly` |  |
| 08:00:01.613 | 1,602.899 | `availabilityFallbackToUi` |  |
| 08:00:01.613 | 1,602.912 | `availabilityCandidateResolved` | 0.2831000000005588 |
| 08:00:01.613 | 1,603.009 | `preferenceResolved` |  |
| 08:00:01.624 | 1,614.185 | `selectionAttemptStarted` | 1 |
| 08:00:01.624 | 1,614.230 | `slot1ClickStarted` |  |
| 08:00:01.722 | 1,712.852 | `slot1Selected` |  |
| 08:00:01.723 | 1,712.903 | `slot2ClickStarted` |  |
| 08:00:01.771 | 1,760.950 | `slot2Selected` |  |
| 08:00:01.771 | 1,761.002 | `slot3ClickStarted` |  |
| 08:00:01.857 | 1,847.364 | `slot3Selected` |  |
| 08:00:01.911 | 1,900.913 | `selectionVerified` |  |
| 08:00:01.911 | 1,900.956 | `proceedActionable` |  |
| 08:00:01.945 | 1,935.481 | `bookingProceedStarted` |  |
| 08:00:02.061 | 2,051.552 | `thirdPartyRateLimited` |  |
| 08:00:02.783 | 2,773.882 | `bookingProceedClicked` |  |
| 08:00:02.784 | 2,773.944 | `proceedClicked` |  |
| 08:00:02.810 | 2,800.408 | `reviewDetected` |  |
| 08:00:02.810 | 2,800.491 | `reviewValidated` |  |
| 08:00:02.810 | 2,800.502 | `playerFillStarted` |  |
| 08:00:02.815 | 2,805.225 | `playerFormDetected` |  |
| 08:00:02.847 | 2,837.441 | `playerFillCompleted` |  |
| 08:00:02.847 | 2,837.481 | `playerProceedStarted` |  |
| 08:00:03.672 | 3,662.757 | `playerProceedClicked` |  |
| 08:00:08.849 | 8,839.709 | `paymentSummaryDetected` |  |
| 08:00:08.849 | 8,839.760 | `paymentSummaryValidated` |  |
| 08:00:08.850 | 8,839.910 | `termsCheckStarted` |  |
| 08:00:09.487 | 9,477.506 | `termsChecked` |  |
| 08:00:09.518 | 9,508.810 | `finalOndaActionStarted` |  |
| 08:00:09.538 | 9,528.291 | `finalOndaButtonClicked` |  |
| 08:00:09.538 | 9,528.332 | `paymentBoundaryReached` |  |
| 08:00:09.538 | 9,528.340 | `automationStopped` |  |
| 08:00:13.379 | 13,369.769 | `checkoutPageDetected` |  |
| 08:00:13.379 | 13,369.822 | `holdStatusDetected` |  |
| 08:00:14.684 | 14,674.483 | `qrHandoffVerified` |  |
| 08:00:14.684 | 14,674.529 | `automationStopped` |  |
| 08:00:14.685 | 14,675.424 | `automationStopped` |  |
