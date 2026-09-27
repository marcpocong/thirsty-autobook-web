# Wave 1 arbitration investigation v2

This phase is offline analysis. It does not alter Wave 1 execution, add checkout requests, or change Rescue/Wave 2 behavior.

## Operator procedure

1. After Phase 3 authorization/freeze, create the sanitized experiment manifest:

   `npm run arbitration:manifest -- --freeze <phase3-freeze.json> --watch <slot-watch.ndjson> --clock <clock-round.json> --out <manifest.json>`

2. Run the legitimate release normally. Do not add measurement bookings.

3. After settlement, analyze by runner run ID:

   `npm run arbitration:analyze -- --run <run-id>`

   Default discovery checks the installed parent `.local` first, then committed diagnostic archives. Explicit `--archive`, `--runner`, `--watch`, `--provider`, and `--critical` paths are available for exported bundles.

4. Replay the contestable subset through the existing simulator:

   `npm run arbitration:replay -- --analysis arbitration-forensics/<run-id>/analysis.json --seeds 5 --search 400`

5. Re-run step 3 to fold `replay.json` family verdicts into `REPORT.md`.

The analyzer writes `analysis.json`, `timeline.json`, `timeline.md`, `hypothesis-spec.json`, `cross-release.json`, and `REPORT.md` under `arbitration-forensics/<run-id>` unless `--out` is supplied.

## Next-run evidence plan

- Local path: release deadline, scheduler fire, worker/pre-POST, renderer entry/fetch, Chrome network start and Playwright request event.
- Provider path: protocol/reuse, DNS/connect/TLS/send/wait, response timing/status, sanitized reason and safe headers. The embedded Vercel number is always `vercelEmbeddedTimestampCandidate`, `INFERENCE`, `UNDOCUMENTED`.
- Inventory path: raw matrices, analytic transitions, last full-open and first unavailable bounds, pre-release booking conflicts and first public-booking visibility.
- Analysis: all-attempt and contestable-only ordering, tie-aware Kendall/Spearman/inversions, reason groups, slow-read flush proximity, state regression/reopening classes, and successful-hold commit inference when naturally available.
- Cross-release recurrence: September 23–26 adapters plus future compatible runs.

## Scope limits

- Public visibility does not expose internal commit time or customer identity.
- External evidence cannot identify provider queue entry, database locks, instance identity or connection-pool topology.
- A single clean run can weaken a hypothesis but ordinarily cannot prove a provider mechanism. Repeated clean releases under the pre-registered specification matter more.
- Observer B is deferred. The current observer already provides the core discrimination, and an additional observer is not required for the generic analyzer.
