# Telemetry specification

Events are buffered in memory as `{event, wall, monoMs, value?, evidence?}`; wall is UTC ISO, monoMs is Node `performance.now()`, runID is a UUID. General metadata is numeric only. Rate-limit evidence uses the explicit allowlist below. No player fields, arbitrary DOM, browser URL, cookies, error stack, response body, or config is accepted. Files are ignored under `DiagnosticsLocal/<runID>.json`.

Normal completion/failure flushes asynchronously. Abort/disconnection flushes once synchronously after stopping, then exits the Playwright-owning process. No critical-path disk writes. An abrupt kill may lose buffered telemetry. CLI uses no screenshots or tracing.

The desktop adds optional `THIRSTY_UI_EVENTS=1` stdout streaming for validated telemetry, inspection, release plan, selection result and error codes. The selection result contains only date/court/hours/amount/attempt count/Proceed readiness. The UI does not interpret arbitrary DOM/config output as status. Inspect, observation, practice, Dry Race and Selection Only share this protocol; Full Booking also uses a dedicated validated command and safe handoff result event.

| Event | Exact timestamp meaning |
|---|---|
| processStarted | After CLI startup and telemetry construction |
| chromeConnected / ondaTabResolved | Attachment, profile check, exact tab resolution and initial page validation have completed; currently consecutive markers, not separate connection measurements |
| preflightStarted / preflightCompleted | Immediately before / after the complete preflight checks |
| armed | Final timed preflight passed |
| releaseScheduled | Immediately before waiting; value is planned UTC epoch ms |
| releaseTriggerFired | After scheduler returns, before release actions; value is wall-clock firing error ms |
| reloadStarted | Immediately before ordinary page.reload |
| reloadCommitted | After reload promise resolves at navigation commit |
| releaseUrlVerified | Exact Onda booking URL verified after reload commit. |
| releaseVenueAttached / releaseVenueVisible / releaseVenueVerified | Unique venue attached / visible / text exactly matches the expected venue. |
| releasePickerAttached / releasePickerVisible / releasePickerEnabled | Exact unique picker attached / visible / enabled; no trial click, stability wait or hit-target check. |
| releaseShellReady | Structural picker checks and final URL/security/Safety guard passed. No Today grid required. |
| preopenTargetDisabled / preopenTargetEnabled | One target availability check after final preflight; unchanged booking snapshot and expanded calendar verified. Future horizon targets must be disabled. |
| releaseCalendarPreopened | Pre-open preparation completed; opt-in until live stability is verified. |
| preopenPreparationStarted / preopenTargetDetected | Before final-preflight calendar preparation / after exact unique visible target is found. |
| preopenCalendarLeftOpen | Pre-open target state, unchanged booking snapshot and expanded calendar verified; release wait follows. |
| preopenReleaseCheckStarted | Before the single immediate DOM evaluation at release; no waiting or retrying this observation. Replaces V2's preopenedTargetObservationStarted name. |
| reloadFallbackStarted | The single pre-open observation failed to prove availability; immediate bounded reload path follows. |
| targetEnabledWithoutReload | Already-rendered exact visible day enabled; normal target click follows immediately, without reload. |
| targetStillDisabledAtRelease | Immediate observation could not prove an enabled unique visible day (also includes a missing/hidden/ambiguous day); bounded reload follows immediately. |
| targetPickerOpened | Normal date-picker click returned, or picker was already expanded; calendar content may still hydrate. |
| targetDateDetected | Exact target day is visible and the security check passed. Missing/ambiguous markup is a structure failure. |
| targetDateNotReleased | Visible exact day was observed disabled; permits the single configured reload retry. |
| targetDateEnabled | Exact visible target day was observed enabled; not a measurement of the server's release instant. |
| targetDateClickStarted / targetDateClicked | Before normal target-day click (including actionability waits) / after that click returns. |
| targetHeadingDetected | First observation of the exact target heading after the calendar click returns; rows may still be stale. |
| targetGridReady | Strict target grid wait and full snapshot validation completed: target heading, 16 target-date rows, seven cells per row and no busy indicator. Caller also revalidates its returned snapshot. |
| gridSnapshotStarted | Immediately before the one-pass DOM evaluation |
| gridSnapshotCompleted | Matrix returned AND strict local validation completed |
| preferenceResolved | Initial local ordered preference lookup completed, dry or selection mode |
| selectionAttemptStarted | Candidate chosen and page guard passed; value is 1-based candidate attempt |
| slotNClickStarted / slotNSelected | Before normal Playwright click (including actionability waits) / target cell state and one-pass snapshot positively verified SELECTED |
| selectionVerified / proceedActionable | Exact selected set/count/amount/actionability verified and stronger booking lock engaged |
| selectionConflict | Incomplete/failed selection or non-actionable Proceed; never implies safe cleanup by itself |
| selectionCleanupVerified | Fresh strict snapshot confirms zero selected cells after proven-owned cleanup |
| fallbackResolved | Fresh grid yielded the next eligible untried deterministic preference |
| slotNClickStarted / slotNClicked | Immediately before / after normal Playwright click resolves, practice mode |
| practiceSelectionVerified | Full selected set checked against requested same-court hours |
| practiceCleanStateVerified | Zero selected cells; original requested slots OPEN again |
| bookingProceedStarted / bookingProceedClicked | Before guarded first Proceed / normal click resolves |
| checkoutPageDetected / holdStatusDetected | First bounded passive read proving Checkout heading / hold label; these may occur in the same read |
| qrHandoffVerified | All independent Checkout sentinels, amount and active countdown validated; observer stops |
| proceedClicked | Normal grid-summary Proceed resolves after the final selection revalidation |
| reviewDetected / reviewValidated | DOM review extraction completed / exact material summary validation passed |
| playerFillStarted / playerFillCompleted | Adapter fill begins, including guards / returned represented field values verified |
| playerFormDetected | Production adapter has actually waited for the Player Information heading |
| playerProceedStarted / playerProceedClicked | Before guarded normal player Proceed / click promise resolves |
| paymentSummaryDetected / paymentSummaryValidated | Strong Payment Summary sentinel and DOM read complete / total and material booking fields match |
| termsCheckStarted / termsChecked | Before explicit authorized check / checked state verified |
| finalOndaActionStarted / finalOndaButtonClicked | Immediately before sealing and one-use dispatch / normal click promise resolves; neither proves Checkout arrival |
| paymentBoundaryReached | Final action returns; interaction gate was already sealed BEFORE dispatch |
| automationStopped / failed / aborted | Active automation ended / failure / abort. The legacy automationStopped after final dispatch means the active gate is sealed; only qrHandoffVerified proves success. The bounded passive observer may run between them. |

The September 10 live test recorded selection, both Proceeds, Terms and one final dispatch. A resumed passive observer verified the same hold after a serialization fix. These were separate process segments: cross-segment elapsed time includes engineering interruptions and must not be reported as navigation latency. See [FULL_BOOKING_REPORT.md](FULL_BOOKING_REPORT.md).

Compute elapsed phases from monotonic differences within one run. Missing events mean NOT MEASURED, never zero. Consecutive combined markers must not be reported as independently measured zero-latency phases. Reload retries have repeated event names and must be paired by occurrence.

Rate-limit events are `ondaRateLimited`, `thirdPartyRateLimited`, and `ondaRetryAfterUnrestricted`. Their evidence contains ONLY `reason: RATE_LIMITED`, `timestamp`, `monoMs`, `hostname`, `status`, `resourceType`, `navigation`, `retryAfterPresent`, and `sameOndaSite`. Host ownership is exactly `onda.fit` or a `.onda.fit` suffix. Every Onda 429 stops; a positive Retry-After delay or future HTTP date also stops. Empty, zero, expired or malformed Retry-After values alone do not impose a wait. Third-party signals are recorded without a rate-limit hard stop. Navigation access-block checks remain in force.

The first abort reason is preserved. Response evidence is buffered before abort dispatch and the CLI's immediate synchronous diagnostic write includes `failure` and `stopEvidence`. No response/request payload is read and no full URL, path, query, header values, cookies or tokens are persisted. Historical failures without this evidence cannot be assigned an origin retrospectively.

Every diagnostic document now includes `releasePerformance` (null before a release trigger). Release summaries contain the observed branch, trigger error, monotonic phase durations and separate per-reload measurements. Missing endpoints are null, displayed as NOT MEASURED. Normal completion, handled failure and synchronous immediate-stop writes share this serializer. The UI receives a strictly validated `releasePerformance` event and shows the latest run summary for the current app session. The durable copy remains under DiagnosticsLocal. There are no cross-process or cross-attempt duration calculations.

The diagnostic-only `preopenStabilityStarted`, `preopenStabilitySample` (0/15000/30000/45000/60000 planned elapsed ms), and `preopenStabilityPassed` (actual monotonic duration) events are never part of the production release wait. A successful check writes a separate sanitized `preopen-check-<runID>.json` report. This verifies calendar UI stability only, not automatic availability changes at release.

Release phase metrics: trigger→reload commit; commit→shell ready; shell→target observed enabled; enabled→click; click→heading→strict grid; grid→snapshot complete; snapshot→preference; preference→first slot→complete selection. Pair repeated markers by reload attempt. These are client observations, not server release timestamps. Historical domReady and combined newDateSignalDetected/targetDateVerified/targetGridSentinelVerified events retain their old meaning and are no longer emitted by the release path.
