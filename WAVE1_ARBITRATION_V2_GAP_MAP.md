# Wave 1 arbitration investigation v2: implementation gap map

This plan was written before implementation. Wave 1 remains the unchanged experimental control; all new computation is offline or post-settlement.

## Already solved on current main

- Sanitized runner, critical-path, provider-trace, response-evidence, journal, clock, Slot Watch, release-forensics and release-intelligence evidence already exists.
- The canonical v1 timeline already aligns scheduler, worker, pre-POST, renderer/fetch, Chrome request, Playwright request, transport timing, response, inventory, booking and hold-expiry observations across clock domains.
- Provider evidence already records protocol/reuse/DNS/TCP/TLS/send/wait, status, sanitized 409 evidence and safe response headers.
- `x-vercel-id` parsing already treats its embedded value as undocumented inference rather than provider queue-entry fact.
- Existing analysis detects provably stale reads, read overtaking/flushes, ordering, hold-expiry reopenings and approximate successful-hold commit position.
- The existing contention simulator and release replay cover the required provider-model families and expose compatibility, not probabilities.
- Critical-path benchmarks and privacy sanitizers already provide non-regression and output-safety foundations.

## Missing or insufficient for the next live run

- The analyzer CLI is hard-coded to the September 25 archive, run ID, target date, watch filename and output layout; it cannot discover an arbitrary compatible run.
- There is no pre-registered machine-readable H1-H5 hypothesis specification consumed by analysis.
- Wave 1 attempts are not classified for contest-sample quality, so known-impossible/event-blocked attempts can contaminate ordering conclusions.
- All-attempt and contestable-only order statistics do not include tie-aware inversion counts, Spearman, explicit small-N quality or the undocumented Vercel candidate separately.
- Target-specific disappearance and first-public-booking visibility windows are not assembled into one attempt record with unresolved-request overlap.
- Read-state analysis does not explicitly preserve raw provider state beside analytic advancement/regression/reopening classifications.
- Slow-read flush proximity to each checkout decision, rejection-reason grouping and cross-release recurrence are not first-class outputs.
- The simulator input is September-specific and does not consume richer future-run signatures.
- There is no generic `timeline.json`, `timeline.md`, `REPORT.md`, analysis manifest or compact cross-release output under `arbitration-forensics/<run-id>`.
- Missing/partial evidence is not summarized consistently as `UNKNOWN`; privacy validation does not cover the proposed aggregate outputs.

## Deliberately out of scope

- Wave 1 scheduler, ordering, concurrency, payload, transport, security preparation and retry behavior.
- Rescue, Wave 2, reopening exploitation, standby behavior, candidate strategy and UI work.
- Additional checkout probes or a second observer. The current read cadence is analyzed first; Observer B remains deferred unless the core analyzer proves insufficient.
