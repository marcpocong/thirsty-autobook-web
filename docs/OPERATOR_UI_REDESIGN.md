# Operator experience redesign

## Audit and boundaries

The old four-destination shell mapped `live` into Activity. Booking Setup placed every unarchived possible hold above the plan, while its execution console repeated the clock, status, readiness and saved authorization. Home combined a daily planning dashboard with another status and warning report. The Live badge inferred activity from attempt records, so an armed release without children could appear idle. Run-stage hold accounting was also easily mistaken for fresh independent provider verification.

The renderer audit covered `index.html`, styles, app/navigation, Home, Booking Setup, Live, Activity, pending holds, Next Release, operator status, Slot Watch, preflight and Shotgun editor. The Dashboard, scheduled authorization, pending-hold row, clock sample, run accounting and relevant controller publication interfaces remain authoritative. The canonical pre-update interface was inspected through Windows accessibility and a screenshot: repeated historical warnings filled the visible Setup window.

This change is renderer-only. It changes no booking engine, IPC contract, dispatch timing, permit, customer binding, journal format, authorization, lock or recovery validation. Mocked browser fixtures block every external network destination. No live arm, booking submission, payment or cancellation is part of qualification.

## Information architecture

| Destination | Responsibility |
| --- | --- |
| Home | One immediate operational headline and next action; release, saved goal, browser and hold overview; secondary recurring planning disclosure |
| Booking Setup | Goal → Strategy → Customize → Browsers → Review & Run; explicit draft/save/preparation/authorization boundaries |
| Live Monitor | Current authorization, trusted countdown, participating browsers, attempt accounting, provider confirmation, recovery, timeline and stop |
| Activity | Completed runs, original browser handoff evidence, pending-hold recovery, UNKNOWN records, archive/restore/verification and diagnostics |
| Settings | Browser management, application build, release policy, network tools and clock/advanced diagnostics |

Legacy `live` links now resolve to the primary monitor. `history` and `records` remain Activity panes; release, tests and strategy remain Setup panes. Legacy clock controls move to a Settings disclosure. The private local-handoff detail cards move to an Activity disclosure. The unique action handlers and recovery paths remain in place.

## Operational state and evidence

`operational-state.ts` is a side-effect-free renderer selector. Scheduled/active releases take precedence over retained historical warnings. An armed release requires no child records to appear ARMED. Sent requests, provider waiting, preparation, stopping, retained locks, stale plans and completed accounting are distinct. An old completed run does not establish an active session.

The monitor's independent hold/QR counters use the existing PendingHoldService rows, requiring provider confirmation, a fresh observation and a future advertised expiry. Local run results are labeled separately. An elapsed advertised deadline never reclassifies UNKNOWN as an expired provider outcome. Payment is always manual.

Explicit official QR handoffs from the current API run can also be shown while their observation is fresh. A locally valid `hold-created` response, a missing legacy status or previous-run history cannot establish this state. Current official handoffs and recovery confirmations have separately labeled counters: target/date/amount similarity cannot join private reservation identities or justify adding the sources together. Saved recovery rows are never upgraded from a handoff, and newer contradictory evidence remains visible.

Arming causes one navigation on the authoritative release identity transition. Repeated publications do not take the operator away from a manually chosen page. A global indicator returns to the monitor. Restoring presentation never calls arm or recreates an operation.

The countdown anchors to `clock.releaseMs - clock.remainingMs`, from a synchronized controller sample, and advances with `performance.now()`. After five seconds without a sample it requests fresh evidence in its label. It makes no bridge calls. A clamped boundary sample is not treated as a valid "now" value.

Renderer-only redraws do not renew that sample's age. Automatic navigation is suppressed in the final second and while dispatch/provider waiting is already underway. Hold-deadline countdowns are explicitly labeled local estimates when the network clock is not trusted.

## Historical records

Setup displays one neutral summary with the actual unarchived count and an Activity link. Archived records still participate in target-overlap presentation. The relevant court/date/time warning remains explicit. Possible unexpired checkouts link to the monitor, where their UNKNOWN status and advertised deadlines remain visible.

The summary performs no archive operation. Activity retains explicit individual/bulk archival, cancellation, restoration and byte verification. A separate search input filters historical records without losing input focus. Archiving affects the index only; backend duplicate protection remains unchanged.

## Layout, accessibility and rendering

The design retains dark green surfaces and lime actions, consolidates contrast/spacing tokens and removes obsolete historical warning styles. Neutral history, amber caution and verified green evidence have different visual priority. Preparation and arming remain in Setup; runtime observation has one destination. Advanced engine details stay disclosed.

Keyboard focus is visible. The persistent monitor link is a native button; dialogs trap Tab/Shift+Tab and restore focus after dismissal. Status text accompanies color. Countdown updates avoid screen-reader announcements every quarter second. Reduced-motion preferences suppress transitions. Existing CSP remains unchanged.

The new quarter-second timer updates text only, with no IPC/provider work. Attempt/worker trees use content signatures; child disclosure state and timeline scroll are retained. Timeline entries deduplicate by timestamp and text and are bounded to 80 records. Primary timeline text removes known contact values, provider links and labeled capabilities/private recovery identifiers. Hold countdown ticks preserve action buttons and focus.

## Qualification

`ui-monitor.test.ts` covers idle history, saved/prepared, armed five minutes and seconds before release, Shotgun dispatch, mixed local/UNKNOWN/rejected/unsent outcomes, historical expiry, stale plans, retained locks and stopping at 1060, 1280, 1440 and 1920 pixels. Existing destination tests exercise every Setup step and all destinations at desktop and 390-pixel widths. `ui-monitor-holds.test.ts` covers independent QR evidence, freshness, expiry, existing recovery, archived target overlap and keyboard focus.

Unit transition tests cover authoritative precedence, clock interpolation/staleness and distinct attempt buckets. Existing navigation, archival, browser-focus, authorization and recovery assertions are retained at their new destinations. Visual artifacts and exact local/CI/install results are recorded in the local qualification report, outside Git, to keep private runtime evidence out of the repository.

Offline renderer qualification does not prove a live booking, payment, contested release timing or future provider reliability. Timing calibration and security evidence remain subject to the installed build's existing compatibility gates.
