# V3 implementation record

Work began after fetching clean `origin/main` at `9c2d3319ac79df420f092dc3637c253f7aa02a43`. The canonical installation reports `9c2d331-3bc41a0dde`. Branch `feature/thirsty-v3-automatic-release` lives in an isolated worktree outside the installation. Exact final verification and version-control results are in the delivery report.

## Audit and integration

Reviewed Booking Setup/Strategy/Next Release/Live/Tools, objective serialization, execution-state and preflight, worker allocation, security/session freshness, strict prewarm/dispatch, outcome accounting, journals/recovery and the guarded updater. The October 18 incident/follow-ups already fixed deadline, preparation, generic-error and UI/controller defects; those implementations are reused. The October 22 literal target/offset serialization fix remains authoritative.

| Feature | Modules and behavior |
| --- | --- |
| Recurring next draft | `automatic-release.ts`, `daily-planning.ts`: versioned owner-reviewed preferences; dates from authoritative wing rules; deterministic draft identity/source fingerprint/timestamp; existing literal-ID remapper; launch/screen/poll/manual generation. Existing users opt in. Generated proposals never write the manual objective or executable config. |
| Smart Shotgun | `daily-budget.ts`: preferred 8/12/16/custom versus compiled count/capacity proposal/executable count; existing compiler and preparation forecast; exact calibration matching; missing provider-volume evidence explicit; owner acceptance for reductions. |
| Distribution | Existing allocator selected by focused/automatic/diversified/custom preference. Preview court/date/hours/worker/count/offsets. Ideal-target limiting keeps other courts draft-only. No new dispatch path or late alternative activation. |
| Readiness/reliability | Shared `release-preflight.ts` and extracted Booking Setup layers feed Home and Review & Run. Adds absolute preparation timestamps, full-lead duration warning and possible-hold/durable-journal context. Existing failures, clock/session/identity gates and late cutoff remain. |
| Guided preparation | Dashboard invokes existing saved-plan controller workflow and typed recovery router. Genuine preparation remains explicit. No automatic security renewal, arming, checkout or payment. |
| Reminders | Pure `release-reminders.ts`, Electron Notification and durable at-most-once IDs; nearest crossed interval after restart; destination routing. App uptime required; Windows receipt best effort. |
| Dashboard/command center | `daily-dashboard.ts`, HTML/CSS: recurring preferences, diffs, allocation/capacity previews, countdown, shared readiness/recoveries, typed primary action, existing live outcome accounting, responsive controls. Four destinations/advanced controls remain. |
| Run analysis | `post-run-report.ts`: activity-run binding; dispatch telemetry requires explicit runner binding. Counts, worker codes, security/preparation/calibration, matched metrics, neutral comparison and safe recommendations. Sanitized local artifacts; raw evidence preserved. |
| Last Known Good | Versioned validated snapshots; configuration/profile/objective/build/calibration context. Diff and owner confirmation; controller rechecks lock/hold/UNKNOWN evidence after confirmation. Clears preparation/Terms, never restores authorization, browser pages, payment or journals. |
| Updates | Worktree-aware local source identity and read-only transaction/backup metadata in Settings. Existing canonical updater checks retained. Local source refs never imply current GitHub/CI. |
| Architecture | Small pure planner/advisor/reminder/report modules, one desktop metadata service and one renderer module. Existing runtime config, compiler, scheduler, readiness and dispatcher remain authoritative. |

Metadata uses `.local/booking-objective/`; `config.local.json` remains the only executable plan store. Existing draft schemas, private profiles, journals, holds and history are not migrated. Corrupt new metadata fails closed without overwriting it.

## Verification scope

Required checks: typecheck; complete scheduled suite including sequential real-time/intercepted Chrome tests; focused V3/controller/safety tests; renderer checks at 390/1060 px and existing destinations; clean UI/runtime build; fresh-compile distribution comparison; isolated Windows Electron smoke. Synthetic tests block external checkout requests. No production timeout/lead/freshness/dispatch limit is relaxed.

New cases cover exact 08:00/month/year rollover; restart/concurrent idempotence; manual/config/journal byte preservation; opt-out and active/armed immutability; Mango/Buko distinctions; custom offsets through runtime serialization; worker/capacity/calibration evidence; persistent reminders; honest UNKNOWN/unsent/hold accounting; snapshot context and restore confirmation/rechecks; responsive layout and primary/recovery routing. Existing tests retain quotas, objective/throttle/UNKNOWN stops, browser/security/session/clock/fingerprint failures, missed-trigger accounting and updater refusal/recovery.

## Limits

Real release-time security, provider request-volume permission/acceptance, competition, final price and payment are unverified. Higher budgets have no claimed winning-probability benefit. No live checkout test is performed. Notifications require app uptime and Windows delivery settings. Missing historical timing is not invented or merged across incompatible anchors. Snapshot restoration needs fresh date/environment review. GitHub/CI is not polled in the background. Update/rollback still uses the canonical guarded procedure and separate owner authorization. Existing advanced panes remain; this is an integrated dashboard, not a replacement booking engine.
