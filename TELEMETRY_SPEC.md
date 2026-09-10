# Telemetry specification

Events are buffered in memory as `{event, wall, monoMs, value?}`; wall is UTC ISO, monoMs is Node `performance.now()`, runID is a UUID. Numeric metadata only. No player fields, arbitrary DOM, browser URL, cookies, error stack, response body, or config is accepted. Files are ignored under `DiagnosticsLocal/<runID>.json`.

Normal completion/failure flushes asynchronously. Abort/disconnection flushes once synchronously after stopping, then exits the Playwright-owning process. No critical-path disk writes. An abrupt kill may lose buffered telemetry. CLI uses no screenshots or tracing.

Desktop phase 1 adds optional `THIRSTY_UI_EVENTS=1` stdout streaming. It emits `THIRSTY_EVENT <JSON>` for validated telemetry, inspection, release plan and error-code messages. The UI consumes this protocol and does not interpret arbitrary DOM/config output as status. Without this environment flag, existing CLI behavior and buffering are unchanged. Streaming is enabled only for the UI's safe inspect/observation commands; there is no UI live-race route.

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
| preferenceResolved | Local ordered preference lookup completed (dry mode only) |
| slotNClickStarted / slotNClicked | Immediately before / after normal Playwright click resolves, practice mode |
| practiceSelectionVerified | Full selected set checked against requested same-court hours |
| practiceCleanStateVerified | Zero selected cells; original requested slots OPEN again |
| reviewDetected / reviewValidated | Synthetic checkout adapter read completed / summary validation passed |
| playerFillStarted / playerFillCompleted | Synthetic adapter fill starts / returned field values validated |
| playerProceedClicked | Synthetic adapter player Proceed resolves |
| paymentSummaryDetected / paymentSummaryValidated | Synthetic adapter summary read resolves / validates against review |
| termsChecked | Authorized synthetic adapter reports checked terms |
| finalOndaButtonClicked | Synthetic final-action promise resolves |
| paymentBoundaryReached | Successful synthetic final action returns; interaction gate was already sealed BEFORE dispatch |
| automationStopped / failed / aborted | Terminal outcome |

Checkout events are **contract tests only**, not live timing measurements. No production adapter emits them against Onda.

Compute elapsed phases from monotonic differences within one run. Missing events mean NOT MEASURED, never zero. Consecutive combined markers must not be reported as independently measured zero-latency phases. Reload retries have repeated event names and must be paired by occurrence.

Required future metrics: trigger→reload commit; reload→new-date enablement; enablement→target navigation; navigation→strict grid; snapshot; preference; each slot click; slot pair; slot2→Proceed; Proceed→review; player fill; player Proceed→payment summary; summary→final action; trigger→final action. Instrument actual distinct boundaries when the production adapter is implemented.
