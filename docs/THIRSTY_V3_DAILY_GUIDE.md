# Daily release assistant

This guide describes the V3 **source candidate**. A build does not install it. The working installation changes only through a separately authorized canonical updater run. No startup/background service is added.

## Configure once

1. In **Booking Setup → Goal**, select **Next Release**, wing, court priorities, minimum/ideal distinct courts, preferred/fallback times, duration and price preferences. Choose the strategy. Intentional literal assignments/offsets remain in Advanced Shotgun.
2. On **Home**, expand **Recurring preferences**. Select **Use the current Booking Setup goal** to copy that goal into the profile. Existing users must review/enable this feature; their saved choices are not silently migrated.
3. Enable **Automatically prepare my next release draft**, choose the preferred budget and workers, and select **Save recurring preferences**. This saves preferences only; it does not prepare, authorize or arm.

New automatic profiles prefer **Balanced Shotgun, 8 attempts**. Expanded prefers 12; high-density prefers 16 and remains experimental. Custom budgets are editable here. Changing a built-in budget selects Custom. Focused allocation weights priority courts; diversified shares attempts equally; automatic diversifies across the distinct-court objective. Fully custom preserves reviewed assignments/offsets.

Preferred count, compiled draft count, preparation proposal and executable count are separate. Missing workers, compatible measured preparation, exact calibration or provider permission cannot establish a supported executable count. The profile does not establish provider-volume permission; the existing exact-plan owner attestation remains required. No winning probability is calculated.

## Review the next draft

Enabled planning runs locally on launch, opening Home/planning, and the app's periodic poll after rollover. **Plan Next Release** also works manually when regeneration is disabled. Identical preferences/dates reuse a deterministic draft identity across calls/restarts.

Mango uses the authoritative +2 calendar-day / 08:00 Manila rule. At exactly 08:00, the next draft targets the following release. Buko +6 stays **PROVISIONAL**, suitable for planning/offline rehearsal; live capability is not promoted.

1. Review **Previous/manual draft → proposed draft**, allocation and capacity evidence.
2. If needed, open the lower-count proposal and review its exact changes. Accepting it does not change the recurring preferred count.
3. Select **Review proposed draft** or **Accept capacity proposal into draft**. Replacing an unsaved manual draft requires confirmation. Active/armed runs cannot accept replacements.
4. In **Review & Run**, validate dates, courts, hours, counts and offsets, then **Save release plan** and confirm the replacement differences.

Generated proposal, editable objective, saved runtime plan and armed authorization remain distinct. Regeneration never writes the manual draft or runtime plan. Old saved plans are not re-dated. An alternative court has no live permission unless included in the reviewed/saved dispatch plan; late rejection cannot activate it.

## Prepare and authorize

**Home → Check & Prepare for release** invokes the existing saved-plan workflow. It opens required dedicated bot browsers, checks ownership and plan binding, and runs genuine security preparation through the existing permitted path. It can contact Onda; it does not submit checkout, arm or pay.

Home and Review & Run share readiness rules and recovery routing. Local/passive inspection does not renew security in the background. **Check Availability** is a separate explicit provider read-only action. **Run security check** is explicit and never repeated automatically to keep a badge green.

Preparation shows actual engine lead, measured/fallback p95, preparation time and first-trigger time. Slow genuine checks warn against p95 and the full lead. Changed browser sessions and stale checks invalidate applicability. Production timing constants, freshness policy, strict late cutoff and bounded deadlines are unchanged.

After preparation, complete exact-plan local calibration if required, refresh the application clock, confirm legitimate request-volume permission and the approved payment cap/method, then review **Terms → Authorize and Arm**. The dashboard opens that review; existing controller confirmations and owner attestation apply. Nothing arms automatically. **Emergency Stop** revokes unsent work; it cannot undo a request already sent.

## Reminders and outcomes

While Thirsty runs, local Windows notices cover configured intervals (default 60/30/10 minutes), approaching unarmed releases, preparation/calibration/browser problems, armed/missed/completed runs, new drafts, temporary holds and UNKNOWN outcomes. Clicking opens the appropriate view.

Delivery IDs are persisted before calling Windows. Reloads/restarts do not duplicate notices; only the nearest crossed interval is sent on restart. Delivery is **at most once / best effort**: Windows settings, Focus Assist or a crash after reservation can prevent receipt. Closing Thirsty prevents reminders. There is no always-on service. Disable notifications in recurring preferences.

The Live command center retains authoritative planned/prepared/initiated/in-flight/rejected/unsent/UNKNOWN/hold accounting and distinct-court progress. Prepared is not sent; initiated is not verified; a hold is not paid. Handle QR/payment manually. UNKNOWN requires provider/account reconciliation and retains duplicate blocking; elapsed time never authorizes a retry.

## Analysis and configuration recovery

Home's automatic run analysis shows counts, worker issues, security duration, calibration context, evidence-supported recommendations and a neutral previous-run comparison. Dispatch metrics require an explicitly matched runner ID; missing/mismatched evidence stays unavailable. Sanitized JSON files are under `.local/booking-objective/run-reports/`. Private raw diagnostics/journals stay authoritative and are not copied wholesale into summaries.

Validated configuration snapshots are captured after a bound saved-plan action on a clean build, or with **Snapshot validated saved configuration**. **CONFIGURATION VALIDATED** is distinct from offline calibration, successful live dispatch, a verified hold and payment. Snapshots include configuration, preference/objective context, build and available calibration verdict/context.

To restore: open **Last Known Good → Review restoration**, inspect before/after fields, then **Restore Last Known Good** and confirm. Active runs, locks, possible/current holds and UNKNOWN results block restoration. The controller rechecks after confirmation. Preparation and Terms clear; old dates need review. Profile regeneration is disabled pending review. Historical calibration is context, not a new qualification. Journals, holds, profiles and QR pages stay intact.

## Updates

Settings/build details show running SHA/build ID, local source identity, recorded eligibility/blocker counts, successful update transaction time and rollback backup availability. Local refs are not fresh GitHub/CI verification. Eligibility is an observation, not permission or an executed update.

Use the canonical procedure in [BUILD_AND_RELEASE.md](BUILD_AND_RELEASE.md), with owner installation authorization and no active/armed release. Never remove UNKNOWN records to permit installation. Rollback still needs lifecycle/provenance checks. This implementation assignment does not run `app:update`, replace the installed EXE or alter the owner's saved plan.
