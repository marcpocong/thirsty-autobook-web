# Strict Shotgun release timing

Shotgun offsets mean **earliest target trigger + strict bounded local lateness**. The internal policy `SHOTGUN_MAX_TRIGGER_LATENESS_MS` is 50 ms. Each frozen Shotgun attempt is explicitly tagged `SHOTGUN_STRICT`, covered by the frozen fingerprint, and gets `triggerMs + 50 ms`. A negative Precision offset by itself does not select this policy. The ordinary direct dispatch recovery window remains unchanged.

A shot may send only from its trigger through its own deadline, including tier 0. Missing readiness never falls through to generic late-prewarm recovery. At expiry its in-memory permit is revoked; durable rejection is written after the protected interval with `NOT_DISPATCHED / SHOTGUN_TRIGGER_MISSED`. Late lower tiers are omitted too. Requests sharing a trigger retain the synchronous bounded pass; distinct offsets retain independent waits and expiry steps.

The Node scheduler and final `beforePost` gate check the trusted clock. A calibrated renderer monotonic check immediately before `fetch()` also refuses delayed Playwright/CDP commands. Page clocks are sampled during preparation, with bounded uncertainty and freshness checks. Missing, stale, or inconsistent calibration fails closed. No page calibration, browser/context/tab creation, navigation, security acquisition, hashing, or request serialization is added to firing. Required pages and transports exist before countdown. The experimental renderer-resident dispatcher uses the same strict deadline and remains off by default; failed renderer calibration retains the Node fallback, which still needs its preparation-time strict page calibration.

## Readiness

Enabled Shotgun requires all configured Wave 1 attempts projected READY, zero AT_RISK, and zero omitted. It also requires the exact saved schedule to match the compiled authorization, each worker's required Onda tab count, and acceptable current machine load. The runner rechecks complete pages/transports at freeze and refuses an incomplete set instead of silently dropping children. The timing-capacity acknowledgement permits saving an experimental schedule; it does not bypass these live protections.

A 20-shot single-target Dense Core plan remains `6 / 6 / 6 / 2` tabs inside four dedicated worker Chrome processes, bounded by `PRECISION_MAX_FAN_OUT = 6`. Every original offset, including −10, −5, −2, −1 and 0 ms, remains authoritative. Configured last trigger 0 ms can result in a local dispatch through +50 ms; wording such as “never after release” is no longer accurate. Dense Core remains experimental. The 105 ms meaningful-spacing reference describes machine capacity, not network arrival or provider arbitration. More attempts do not automatically give better timing.

## Exact saved topology validation

Run outside the live countdown:

```powershell
npm run bench:shotgun -- --saved-plan <saved-plan.json> --runs 10 --warmup 2 --out .local/shotgun-timing --lockdown
```

The JSON must contain `PRECISION_PHASE3` and enabled `STRATEGY_V2.shotgun.exactSchedule` from the saved configuration. A sanitized extract containing those two objects is sufficient. Do not commit private configuration. The tool validates the schedule against the compiled plan and creates exactly the saved workers and tabs, with each original offset and fan-out tier. It uses the production armed dispatcher and prebuilt transport. Its default preparation lead is 15 seconds with synthetic security; use the saved preparation lead when studying prewarm capacity. Synthetic security does not establish real security-preparation readiness.

Every Chrome has isolated temporary profiles, DNS blocked except localhost, and a dead localhost proxy. Onda-shaped pages and all checkout responses are intercepted and fulfilled locally. No Onda checkout POST leaves the machine. This tool never runs automatically in countdown. Use `--dispatcher renderer` for an explicit experimental comparison; this never changes the production flag. Exact-plan coordinator benchmarking is refused rather than silently using a different timing architecture.

Raw per-shot rows record configured offsets, scheduler wake, worker invocation, page entry/fetch when available, Chrome request-start, and omitted codes. Summary includes p50/p95/max trigger error, out-of-tolerance count, omissions, and observed compression (reversed order or adjacent starts less than half their configured separation, with a 1 ms floor). Predicted tight spacing is recorded separately. Missing starts remain unmeasured, never zero.

`latest.json` carries plan/topology fingerprint, tolerance policy, machine/OS/Node identity, Chrome version, source build, dispatcher, run count, and test time. A result applies only to the same exact plan and compatible clean build, machine and browser within 24 hours. Other-plan, dirty-build, stale, or renderer-comparison results display as NOT TESTED for the default path. Applicable FAILED or AT_RISK timing results block arming; a missing test is explicitly NOT TESTED and never replaces the mandatory forecast/tab/machine/runtime gates.

This measures **local configured-trigger → local Chrome request-start timing only**. It does not establish Onda arrival/receipt/processing order, provider arbitration, or booking success probability.

## Protected interval

Shotgun defers response evidence hashing/serialization/capture, durable settlement, QR navigation, observer callbacks, and trace activation until T+1000 ms. Cheap in-memory safety signals still suppress subsequent same-target shots on a verified hold, unknown outcome, or throttling. Dispatch marks remain synchronous numbers. Adaptive evidence evaluation, its logs and standby work also wait until the protected initial-release interval ends; the isolated Slot Watch continues collecting evidence. Nonessential dashboard polling and renderer status ticks pause during T-1000 through T+1000; Stop remains available. Ordinary unselected Precision targets in a mixed plan keep their generic timing policy while participating in the exact-topology load. HIGH process priority and the existing release lockdown are retained; REALTIME is not used. Abort cleanup and conclusive durable journaling remain mandatory.
