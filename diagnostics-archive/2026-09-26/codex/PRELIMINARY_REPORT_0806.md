# Detailed ongoing-run forensic report

Snapshot: September 26, 2026, 08:06:00.535 Manila (runner); 08:06:00.501 (availability observer). Generated from local evidence only. The run is ongoing, not final.

Run `e69098a8-b8b2-444e-b0ea-2b1170f1420f`; target September 28; installed build timestamp 2026-09-25T19:40:56.146Z, source label `06114db`. Installed and checkout copies of desktop-runner.ts and release-forensics.ts have matching hashes.

## Current result

Six Wave 1 POSTs, six conclusive application HTTP 409 availability rejections, six rejected durable journals. Zero verified holds, no QR success, no recorded UNKNOWN attempt. Worker G completed standby preparation. There are no Wave 2 or Rescue dispatches and no final PHASE3_OUTCOME in this snapshot. Evidence continues arriving; this is not a stalled checkout waiting for a response.

The authorized plan has nine candidates, six initial workers, one standby worker, one Wave 2 budget, one Rescue budget, and eight total attempts maximum. Concurrent Wave 2 and Rescue are enabled. The installed adaptive loop normally runs until release plus 15 minutes (08:15), unless an abort, verified hold, UNKNOWN attempt, or error ends it sooner. This is the configured bound, not a promise of a successful rescue.

## Dispatch and response evidence

| Worker | Court/time | Pre-POST lateness | Observed POST lateness | Recorded network duration | Response size | Outcome |
|---|---|---:|---:|---:|---:|---|
| A | C4, 19:00–22:00 | +0.5 ms | +8.6 ms | 10.026 s | 125 bytes | HTTP 409 / rejected |
| B | C5, 19:00–22:00 | +1.3 ms | +7.7 ms | 10.891 s | 125 bytes | HTTP 409 / rejected |
| C | C1, 19:00–22:00 | +1.6 ms | +7.9 ms | 6.862 s | 125 bytes | HTTP 409 / rejected |
| D | C2, 17:00–20:00 | +1.8 ms | +8.7 ms | 11.933 s | 100 bytes | HTTP 409 / rejected |
| E | C2, 20:00–23:00 | +2.0 ms | +9.6 ms | 13.996 s | 100 bytes | HTTP 409 / rejected |
| F | C3, 17:00–20:00 | +2.2 ms | +9.5 ms | 12.297 s | 100 bytes | HTTP 409 / rejected |

All six observed requests left in a 1.9 ms cluster. Use CHECKOUT_HTTP_POST_INITIATED.releaseLatenessMs: PHASE3_DISPATCH is deferred logging and exaggerates E's apparent delay. The browser request event is not a server receipt timestamp. Network duration and response-event intervals are different measurements and must not be interchanged.

All seven browsers and all seven security preparations completed. Initial workers reused prepared security contexts aged approximately 10.843–11.649 seconds at their pre-POST gates. There is no evidence here of a browser preparation failure, security-preparation failure, missing dispatch, or checkout timeout. Diagnostics classify the returned JSON as application availability rejection, not a challenge page. Response byte counts alone do not identify the exact business rule or prove different rejection causes.

Clock consensus at T-30 seconds: +373.0 ms correction, 43 ms RTT, ten samples, 6.2 ms spread, estimated uncertainty ±21.5 ms. Slot Watch used +368.1 ms, giving an observer-minus-dispatch difference of -4.9 ms. Thus +8 ms is a precise measurement against the bot's corrected deadline, not proof of provider-clock alignment to within 8 ms. Raw PC times appearing before 08:00 must not be read as proof of an early submission.

## Availability and public-record timeline

At 07:59:00.275, the pre-release public-record read already returned 14 court-hour cells: C2/C3 20:00–23:00 and C6/C7 18:00–22:00. This proves those records were visible before release, but not their owner, payment state, creation time, or mechanism.

The last availability read without the date ran from release -1991.9 to -1570.9 ms. The first published read ran from +17.1 to +1462.1 ms, with cache MISS / age zero, 75 open cells and 37 unavailable cells. This brackets observations, not the provider's exact publication instant.

| Court | Evening unavailability in first published grid |
|---|---|
| 1 | 17:00–22:00 |
| 2 | 20:00–23:00 |
| 3 | 20:00–23:00 |
| 4 | 19:00–22:00 |
| 5 | 19:00–22:00 |
| 6 | 18:00–22:00 |
| 7 | 18:00–22:00 |

A/B/C's complete targets were unavailable in every published read. No matching public booking records for those target hours appeared in the inspected booking reads. This is unavailable inventory of unknown cause, not proof of a scalper transaction. Across the full grid, 23 of the first 37 unavailable cells had no matching record in the available public-record evidence.

D/F's 17:00–20:00 targets initially appeared fully open. Both subsequently received 409s. Read #21, requested +13.0001 s and returned +13.8601 s, first showed their 18:00 and 19:00 cells unavailable. C2's corresponding public records were seen in the +10.0101 to +12.1491 s read; C3's in the +30.0071 to +30.3751 s read. These discrepancies show why a grid read cannot guarantee checkout acceptance or establish transaction order.

By the response at 08:00:13.860, every court showed 18:00–23:00 unavailable. This remained true through the snapshot. By the last snapshot, every court also showed 17:00–23:00 unavailable.

The user's observation that other scalpers blocked 6–11 PM is retained as user-provided context. The schedule unavailability is corroborated; attribution to scalpers is not independently established by these logs.

## Why standby and rescue did not send

The three authorized Wave 2 candidates were C3 20:00–23:00, C6 17:00–20:00, and C6 20:00–23:00. None was fully open in any published observation. All overlapped cells with pre-release public records. G therefore had no eligible complete Wave 2 target in the inspected data.

No authorized target completed an observed unavailable-to-fully-open transition. D/F began open and became unavailable; that is not a reopening. Rescue's absence is consistent with its reopening requirement, not evidence that Rescue was disabled.

There were 118 availability observations: seven UNRELEASED, 108 ACTIONABLE_FRESH, and three FORENSIC_ONLY_OUTDATED_REQUEST classifications. All reads answered, with no failed or omitted reads recorded; seven public-record reads also succeeded without failed court queries. ACTIONABLE_FRESH means the evidence passed freshness rules, not that an authorized block was open.

The generated engine counts three individual cell reopen transitions elsewhere in the grid. Those were C5 afternoon cells outside the authorized targets, including a brief observation reversal around +53 seconds. They do not amount to a usable authorized three-hour rescue opening or establish a durable cancellation.

## Deeper instrumentation: implemented, but persistence is pending

Installed code initializes both provider tracing and critical-path telemetry. Provider traces can add browser protocol/connection reuse, header/body timing, DNS/connect/TLS/send/wait intervals, and allowlisted provider response headers. Critical-path rows can add scheduler, worker, renderer entry, fetch invocation, browser request start, observation lag, and response timing with calibration bounds.

Neither provider-trace.ndjson nor critical-path.ndjson exists yet for this run. The installed Phase 3 success path awaits adaptiveLoop before persistProviderTraces; error/final cleanup also attempts persistence. Consequently the files are expected later. Their absence now does not prove capture succeeded or failed. This report does not force persistence or interrupt the run.

IMPORTANT: generated report.txt uses the generic wording "No provider trace was captured" when no input file exists. For this ongoing run, read that as "not available on disk yet." The code and live status support pending persistence; capture quality must be checked once files exist. The engine's Phase 3 section supplies REJECTED states even where its older per-worker summary omits a final-state label.

## Findings worth investigating after completion

1. The authorized portfolio already overlapped pre-release public records: all of E's initial target and all three standby targets. The installed Phase 3 branch builds the frozen Wave 1 list without the legacy proofless T-30-minute block-audit step. That is a concrete planning/validation review point; whether it violates intended proofless policy requires a separate change decision.
2. D/F had initially open displayed inventory yet lost after roughly 12 seconds. The pending provider timing should help distinguish time before transmission, connection setup, and response wait, but cannot reveal provider database arbitration without server evidence.
3. A/B/C were unavailable at first publication without matching public records. Faster client dispatch alone cannot be assumed to solve this inventory class.
4. The code defers the deepest files until the adaptive phase ends, limiting real-time forensics. A future observability change could improve interim persistence, but no code or run behavior was changed here.

## Reproducible evidence

- report.txt and summary.json: existing forensic engine, explicitly PRELIMINARY.
- analysis.json: candidate-level transitions, sanitized journal outcomes, classifications, and pending-artifact inventory.
- run.ndjson, watch.ndjson, freeze.json: fixed local snapshots used for this report.
- ../analyze-ongoing-2026-09-26.mjs: offline reproduction script; rerunning replaces this directory's snapshots and generated engine outputs.

Analysis did not contact the provider, operate browsers, submit bookings, or change configuration, locks, journals, or the active run.
