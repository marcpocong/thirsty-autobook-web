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

The legal final range remains `-2000..0 ms`. Auto de-skew is capped at `+/-12 ms`, requires two matching real releases, and is zero for insufficient evidence. Evidence must be a confirmed dispatch with a valid trusted-clock mapping and the same fan-out width and dispatch mode; machine/runtime identifiers must match when both sides provide them. Synthetic tests, offline benchmarks, invalid clocks and `NOT_DISPATCHED` rows are excluded.

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

Only the fan-out benchmark measures the production-shaped local Chrome path. The Lockdown microbenchmark measures instrumentation overhead, not provider behavior or release success.
