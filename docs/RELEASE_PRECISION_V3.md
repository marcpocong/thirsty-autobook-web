# Release Precision V3

Release Precision V3 improves local execution consistency without changing Strategy Engine V2.2:

```text
Smart Strategy
  -> immediate logical targets (independently tracked fan-out children)
  -> Wave 2 (fresh evidence required)
  -> Reopen Rescue (fresh reopening required)
```

It does not infer provider receipt time, change timing from wins/losses, or use HTTP response order or undocumented provider headers as timing evidence. Renderer-resident dispatch remains experimental; production Auto continues to use the central dispatcher and its compatible machine profile.

## Timing hierarchy

```text
compatible machine profile -> base child spacing
fresh real-release releases -> whole-group anchor
fresh worker/index releases -> bounded local de-skew
base + anchor + de-skew     -> final literal offset saved in PRECISION_PHASE3
```

Normal/legacy final offsets remain `-2000..0 ms`; Shotgun's explicit signed window may extend through `+2000 ms`. Auto de-skew is capped at `+/-12 ms`, requires two matching real releases, and is zero for insufficient evidence.

De-skew learns only from **worker invocation → Chrome request start** (`chromeStartMs - workerInvokedMs` in critical-path telemetry), never from configured trigger → Chrome. The latter also contains the time a child waited behind earlier children in the central dispatcher's single synchronous fire pass. In offline 7×1/7×2 runs that queue wait is the entire A→G slope (0 → 2.7/3.3 ms), while each worker's own invoke → Chrome time is flat (see [FANOUT_CAPACITY_BENCHMARK.md](FANOUT_CAPACITY_BENCHMARK.md)). Retiming cannot remove serialization. Moving G earlier just makes it fire alone, and the next calibration would move it back. The whole-group anchor absorbs serialization instead. Rows without `workerInvokedMs` are never used for de-skew, though they still count toward the anchor. Correction = release-level baseline median − the worker's (or index's) median of per-release medians.

Worked example (the `ui-strategy-v2` regression case): width 2 with base spacing `[-5, 0]`, a −5 ms group shift, and two fresh matching releases in which worker A's invoke → Chrome is 10 ms and every other worker's is 4 ms (baseline 4 ms):

```text
child  base  + group anchor  + worker  + index  = final (Review and PRECISION_PHASE3)
A0      -5        -5            -6         0       -16
A1       0        -5            -6         0       -11
B0      -5        -5             0         0       -10
B1       0        -5             0         0        -5
``` Evidence must be a confirmed dispatch with a valid trusted-clock mapping and the same fan-out width and dispatch mode; machine/runtime identifiers must match when both sides provide them. Synthetic tests, offline benchmarks, invalid clocks and `NOT_DISPATCHED` rows are excluded.

Freshness is an input filter. Rows older than 30 days remain visible in History & Insights but never enter an Auto calculation. The group anchor first computes a median for each release and then a median across releases, so a high-width run has one main vote. Worker and index de-skew similarly uses release-level medians. Operational labels are `NONE`, `LIMITED`, `USABLE` and `STRONG`; they are not formal statistical confidence.

The Strategy view shows base/anchor timing and any non-zero worker/index correction. Applying a suggestion writes the composed final values into the editable draft. Review compiles those same literals, and Save writes them to `PRECISION_PHASE3`, which remains the sole backend authorization. Later manual edits are authoritative and are never silently recalibrated.

## Critical path and Lockdown

Before the final second, the runner freezes authorization, constructs immutable plans and request bodies, creates durable journal scaffolding and one-shot permits, maps workers/tabs/transports, prepares security context, warms V8 telemetry methods and calculates every trigger.

At `T-1000 ms`, `RELEASE_CRITICAL_LOCKDOWN` begins and the runner temporarily requests Windows `HIGH` priority (never `REALTIME`). The hot path is:

```text
monotonic timer wakes
  -> frozen-set / final permit gates already satisfied
  -> select prebuilt transport and request
  -> renderer entry
  -> fetch()
  -> Chrome request start
```

What happens from T−60 s through T+1 s:

```text
T-60 s   observer child starts reading availability/public bookings (its own process)
T-10 min..T-2 s  trusted clock refreshed; plans, bodies, journals, permits, tabs, transports ready
T-~1.5 s tiered security prewarm (adaptive lead, index 0 first); readiness recorded in memory
T-1 s    RELEASE_CRITICAL_LOCKDOWN + HIGH priority
         prewarm progress lines (SECURITY_PREWARM_READY / _FAILED / _RETRY) are queued, not written
T+offset timer wakes -> prebuilt transport -> renderer fetch() -> Chrome request start (per child)
after the last POST has left:
         Lockdown exits, priority restored, queued lines flushed (each tagged lockdownDeferredMs),
         RELEASE_LOCKDOWN_COMPLETE written; FINAL_ACTION_DISPATCHING / dispatch-start / settled
         proceed exactly as before
T+1 s    dispatch window ends; Wave 2 / Rescue only on new validated observer evidence
```

The runner's `dispatch-start` and `settled` handlers already ran only after the fire pass, so they were not moved. Lockdown takes only the informational prewarm lines that could land inside the last second: each one is a progress-log append plus a UI IPC message. A failing deferred callback is swallowed at flush and never escapes `setImmediate`.

The Lockdown object only accepts explicitly nonessential callbacks for deferral. Required pre-POST journal writes, one-shot permits, trusted-clock gates, `UNKNOWN` guards, price binding and adaptive revalidation must never be deferred. Hot-path instrumentation is in-memory. After the last POST has left, priority is restored, deferred callbacks flush on `setImmediate`, and aggregate Lockdown telemetry is written.

Critical-path rows contain scheduler wake, worker invocation, transport entry, renderer entry, `fetch()`, Chrome start, request observation and response timing. History derives p50/p95/p99/max, per-worker and per-index timing. Lockdown additionally counts marked work in the final 50/20/10 ms windows. Chrome start is local evidence, not provider arrival.

## Dedicated Slot Watch observer

Slot Watch now runs in a separate Node child process. Availability reads, public-booking reads, publication/reopen detection, matrix aggregation and report writes therefore do not share the release runner or Electron main-process event loop.

The IPC protocol is `slot-watch-observer/v1`. Events contain a proxy watch ID, a strictly increasing sequence, sanitized view or observation data, and no booking authorization, permit, cookie or customer identity. The parent rejects malformed, duplicate and out-of-order messages. The Release Engine continues to validate evidence sequence, freshness, completeness, cache state and Age; child-process origin is not trust.

If the observer crashes or disconnects, its promise fails and UI health becomes degraded. An already-authorized Wave 1 remains independent. Wave 2 and Rescue receive no invented observation, so their existing fresh-evidence guards remain fail-closed. The observer is read-only and has no checkout imports or permit path.

## Release Readiness Gate

The gate reports `READY`, `READY WITH WARNINGS`, or `NOT READY`, with individual checks:

- Build: running metadata versus the last tested packaged release-build record, including dirty state.
- Configuration and exact saved Phase 3 compilation (hard block when invalid).
- Trusted clock: synchronization, age, offset and round-trip-derived uncertainty (missing trusted time is a hard block).
- Machine: cheap memory, process RSS and event-loop p95 sampling.
- Workers: connected browser, identity/profile result, security preparation and optional command latency.
- Observer: online state, newest successful read and availability latency.
- Fan-out profile: compatible machine/dispatcher profile and staleness. Missing/incompatible evidence falls Auto back to width 1.
- Prewarm state.

Performance degradation is normally a warning and visible Auto-allocation input, not a booking-safety hard block. A degraded worker is never silently removed: the state and reason remain operator-visible. Automatic width is not increased beyond the compatible machine recommendation (currently two attempts per target on the recorded central-dispatch profile).

## Safety invariants

- `UNKNOWN` still blocks unsafe adaptive retries.
- `NOT_DISPATCHED` is emitted only when the request is proven not to have left; lack of response is never enough.
- Fan-out budgets count actual child sends.
- `PRECISION_PHASE3` remains the single authorization source.
- Wave 2 and Rescue still require new validated observer evidence and final revalidation.
- Verified holds stop conflicting sends; durable journals, crash safety, parent guards and one-shot permits remain unchanged.
- Shotgun checks settled same-target outcomes between triggers: verified hold, UNKNOWN and provider throttle suppress later unsent children; rejection continues. A late-ready omitted child is never fired.
- Price re-binding, public-conflict freeze markers and visible operator overrides remain unchanged.
- Official release remains the forensic reference. Early offsets move only authorized Wave 1 trigger times.

## What this can learn

It can measure local scheduler-to-Chrome consistency, per-worker/index local lag, prewarm headroom, observer read latency, release-level sample freshness and Lockdown work. It cannot establish provider arrival, arbitration order, a timing “sweet spot”, or win probability. Those remain unknown without documented provider receipt evidence and enough compatible real releases.

## Verification

Focused tests cover freshness filtering, stale-only fallback, release weighting, topology/mode/clock/dispatch filters, bounded de-skew, legal final offsets, Lockdown deferral/flush, readiness verdicts and observer protocol validation. Run:

```text
npm run typecheck
npm test
npm run ui:build
npm run verify:dist
npm run bench:fanout -- --workers 7 --widths 1,2 --runs 40
npx tsx scripts/benchmark-critical-path-overhead.ts
```

Only the fan-out benchmark measures the production-shaped local Chrome path. The Lockdown microbenchmark measures instrumentation overhead, not provider behavior or release success. The 2026-09-30 runs and the queue-position analysis are in [FANOUT_CAPACITY_BENCHMARK.md](FANOUT_CAPACITY_BENCHMARK.md). They show no measurable improvement or regression attributable to V3, and no apples-to-apples baseline exists. Offline results never calibrate Auto.
