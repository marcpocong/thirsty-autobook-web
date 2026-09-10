# Desktop control panel — phase 1

Implemented as a thin layer over the existing automation. No live-race, booking-selection, checkout or payment controls were added.

## UI and commands

| Item | Result |
|---|---|
| Framework | Electron 44.3.0 + HTML/CSS/TypeScript; no frontend framework |
| Launch | `npm run ui` |
| Build | `npm run ui:build`; compiler output under ignored `dist/` |
| Window | 1010×800, resizable, minimum 820×690; dark styling; Emergency Stop pinned to bottom |
| Manila clock | Updates every second; Luxon builds safe clock/config state in main |
| Countdown | Informational next release; active observer plan comes from CLI |
| Target | Existing `releaseCalendar` and configured horizon; next-release target after today’s cutoff |
| Start / Attach | Existing `scripts/start-onda-chrome.ps1`; local CDP reachability check afterward |
| Inspect | Existing CLI `inspect`, with opt-in structured inspection status |
| Prepare | Sequential Chrome launcher→inspection→read-only readiness checks; never launches observer |
| Arm | Native per-run Cancel/Arm dialog, then existing `release:observe --armed` |
| Live log | Validated structured CLI events plus sanitized stdout/stderr; bounded to 400 entries |
| Emergency Stop | Shared CLI abort path via IPC, bounded Windows termination fallback |
| Lock | Reads existence only; no deletion or recovery action |
| Live Race | Disabled, not in command map, not in preload bridge |

## Process and renderer safety

Electron main owns the process handles and a single operation slot; the application also uses Electron’s single-instance lock. Concurrent observer requests and other conflicting actions are rejected in main, even if invoked outside the disabled button. The existing filesystem automation lock remains authoritative across CLI/UI runs.

Automation is launched directly as `node --import tsx src/index.ts <known mode>`. There is no npm/tsx CLI wrapper process. The existing Node process owns Playwright and receives `{type:"abort"}` over its parent IPC channel. This invokes the same `Safety.stop('USER_ABORT')` path as Q/Ctrl+C. Losing the parent IPC connection stops it too.

If it has not exited within 350 ms, Windows `taskkill /PID <owned automation PID> /T /F` terminates that automation tree. The attach-only automation does not launch Chrome. **The tree-kill path is never used for the Chrome-launcher process**; stopping the launcher targets its own process only. Exit must be confirmed before reporting restored control. Locks remain untouched by UI cleanup. Already-dispatched browser events cannot be undone.

Renderer settings: contextIsolation=true, nodeIntegration=false, sandbox=true, webSecurity=true. Local content only, restrictive CSP, permissions denied, navigation/new windows/webviews denied. IPC validates sender, main frame, exact local page URL and zero arguments. The preload exposes six fixed operations plus status subscription, no shell/Node/filesystem primitives. Unknown commands—including race—are rejected by the main process command mapping.

Security choices follow [Electron’s security guidance](https://www.electronjs.org/docs/latest/tutorial/security). No session or player data is placed in renderer state. The control-panel Electron profile is ignored under `.local/control-panel/`.

## Small CLI extensions

Only when `THIRSTY_UI_EVENTS=1`, the CLI emits a validated, prefixed JSON-line protocol containing telemetry event names/timestamps, safe release plan, inspection facts or error codes. Existing human-readable output and buffered telemetry remain available. Inspection’s extra reads occur only with that opt-in. The release scheduler, Chrome/profile logic, grid parser, practice implementation, locks and payment boundary were not replaced.

## Validation

The original 53 tests are preserved. Eleven focused UI/process tests bring the total to **64 passing on Windows**, including actual direct-Node IPC abort and Windows tree termination of a deliberately blocked worker plus descendant. An unrelated test process survives. Linux CI skips only the Windows-specific tree test.

Live Electron smoke checks performed around 05:44–05:46 Manila on September 10:

- Window launched, renderer bridge exposed only intended methods; `window.require` was undefined.
- Chrome button reused dedicated Chrome; Inspect returned September 10 and zero selected cells.
- Prepare verified today/All Courts/visibility/clear lock and displayed Ready without arming.
- Native dialog options were inspected; automated smoke tests simulated Cancel and Arm responses. Cancel launched no observer; Arm launched the real existing observer and streamed its initial preflight output. No unattended live release was run.
- Observer output changed UI to Observation scheduled. Countdown ticked; conflicting buttons were disabled; a second IPC launch was rejected.
- Emergency Stop ended the actual recorded worker PID, retained its lock, and left the dedicated Chrome tab open with zero selected cells. Closing the UI also left Chrome open.
- Screenshots were visually reviewed locally; Emergency Stop stays visible at the bottom. Diagnostic images and smoke outputs remain ignored.

TypeScript checks, unit/fixture tests and UI build passed. The CLI’s live-race refusal is unchanged. The observer was exercised only through initial preflight and early abort, not across the real 08:00 release. Ordinary CLI inspection had already succeeded. At the final 15:20 regression check, both CLI inspection and observer correctly refused the existing lock without modifying it. No lock was bypassed to manufacture a passing live check.

## Git and remaining limits

Branch: main. Remote: private `marcpocong/thirsty-autobook-web`. This report is included in the phase-1 commit; exact commit/push result is reported in the task response.

Deferred: Practice UI, Dry Race UI, booking-preference editor, player/checkout UI and production live race. No packaging, signing, installer, auto-update, real release proof or checkout proof is claimed. Restart the app after external config edits. Onda facts remain timestamped snapshots; lightweight status polling is local only.

On resuming development later that day, an existing lock belonged to a separate aborted run (its telemetry records abort around 06:05). That lock is preserved rather than silently cleared. The UI will show it as requiring manual review.
