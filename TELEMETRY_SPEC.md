# Telemetry specification

Events are buffered in memory as `{event, wall, monoMs, value?}`; wall is UTC ISO, monoMs is Node `performance.now()`, runID is a UUID. Numeric metadata only. No player fields, arbitrary DOM, browser URL, cookies, error stack, response body, or config is accepted. Files are ignored under `DiagnosticsLocal/<runID>.json`.

Normal completion/failure flushes asynchronously. Abort/disconnection flushes once synchronously after stopping, then exits the Playwright-owning process. No critical-path disk writes. An abrupt kill may lose buffered telemetry. CLI uses no screenshots or tracing.

The desktop adds optional `THIRSTY_UI_EVENTS=1` stdout streaming for validated telemetry, inspection, release plan, selection result and error codes. The selection result contains only date/court/hours/amount/attempt count/Proceed readiness. The UI does not interpret arbitrary DOM/config output as status. Inspect, observation, practice, Dry Race and Selection Only share this protocol; there is no UI Full Booking launch route.

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
| domReady | Selected-date heading is visible; NOT equivalent to DOMContentLoaded or grid ready |
| newDateSignalDetected / targetDateVerified / targetGridSentinelVerified / targetGridReady | Currently recorded together after calendar navigation AND strict grid barrier. They do not separately measure enablement and navigation. |
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
| proceedClicked | Normal grid-summary Proceed resolves after the final selection revalidation |
| reviewDetected / reviewValidated | DOM review extraction completed / exact material summary validation passed |
| playerFillStarted / playerFillCompleted | Adapter fill begins, including guards / returned represented field values verified |
| playerFormDetected | Production adapter has actually waited for the Player Information heading |
| playerProceedStarted / playerProceedClicked | Before guarded normal player Proceed / click promise resolves |
| paymentSummaryDetected / paymentSummaryValidated | Strong Payment Summary sentinel and DOM read complete / total and material booking fields match |
| termsChecked | Explicitly authorized adapter reports checked terms (live terms not tested) |
| finalOndaButtonClicked | Final-action promise resolves (synthetic tests only so far) |
| paymentBoundaryReached | Final action returns; interaction gate was already sealed BEFORE dispatch |
| automationStopped / failed / aborted | Terminal outcome |

Selection and checkout through Payment Summary were measured on the live noncompetitive development target. Terms/final-action events remain synthetic-only. See [UI_PHASE2_REPORT.md](UI_PHASE2_REPORT.md) for the measured sample and the original combined player-Proceed/sentinel timing limitation. Production now separates player click completion from the subsequent strong summary wait.

Compute elapsed phases from monotonic differences within one run. Missing events mean NOT MEASURED, never zero. Consecutive combined markers must not be reported as independently measured zero-latency phases. Reload retries have repeated event names and must be paired by occurrence.

Required future metrics: trigger→reload commit; reload→new-date enablement; enablement→target navigation; navigation→strict grid; snapshot; preference; each slot click; slot pair; slot2→Proceed; Proceed→review; player fill; player Proceed→payment summary; summary→final action; trigger→final action. Instrument actual distinct boundaries when the production adapter is implemented.
