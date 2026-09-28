# Wave 1 arbitration investigation v2

This phase is offline analysis. It does not alter Wave 1 execution, add checkout requests, or change Rescue/Wave 2 behavior.

## Operator procedure

1. Open Thirsty Pickle Bot.
2. Prepare the normal release (Reset & Prepare).
3. Check **Release readiness**. Before arming, *Investigation manifest* reads `Automatic when you arm`.
4. Click the arm button (**Arm Booking Selection** / **ARM NEXT RELEASE**).
5. The app preregisters the investigation automatically, before the release runner starts. The row then reads `READY · preregistered before run`, or `READY · existing preregistration verified` if this release was already preregistered. If it reads `BLOCKED`, nothing was armed; the reason is shown under the row and the details are in Activity.
6. Leave the app running through the release. Do not add measurement bookings.
7. After settlement, analyze the evidence by runner run ID:

   `npm run arbitration:analyze -- --run <run-id>`

   Default discovery checks the installed parent `.local` first, then committed diagnostic archives. Explicit `--archive`, `--runner`, `--watch`, `--provider`, `--critical`, and `--manifest` paths are available for exported bundles. Every explicit file is validated against the requested run and fails with `*_EVIDENCE_INCOMPATIBLE` rather than being analyzed.

8. Optionally replay the contestable subset through the existing simulator:

   `npm run arbitration:replay -- --analysis arbitration-forensics/<run-id>/analysis.json --seeds 5 --search 400`

9. Re-run step 7 to fold `replay.json` family verdicts into `REPORT.md`.

The analyzer writes `analysis.json`, `timeline.json`, `timeline.md`, `hypothesis-spec.json`, `cross-release.json`, and `REPORT.md` under `arbitration-forensics/<run-id>` unless `--out` is supplied.

## Preregistration manifest

Arming an API/Proofless release creates or verifies the manifest in the desktop main process after the arm confirmation and before the slot watch, sleep protection or release runner start. It uses the same target date and release instant that are passed to the runner. Nothing new runs after the runner starts. Browser-method releases have no Wave 1 runner and get no manifest.

- Location: `<install>/.local/arbitration-manifests/<target-date>_<release-ms>/experiment-manifest.json`, next to the runner's evidence, where `arbitration:analyze` finds it without copying.
- Content: the manifest schema, analysis schema, hypothesis-specification version, target date, release instant, creation time and origin. No names, contacts, customer IDs, cookies, tokens, fingerprints or payment data. Wave 1 targets come from the runner's own Phase 3 freeze, written at T-2 min, still before release.
- Idempotent: a matching manifest is verified and reused, never rewritten. A mismatching or damaged one is kept as it is, and arming is blocked. So is a missing or unwritable data folder, or an arm at or after the release. In every case the runner does not start and the reason appears in Release readiness and Activity (`ARBITRATION_MANIFEST_CREATED`, `_VERIFIED` or `_BLOCKED`).
- The analyzer accepts it only if it was created before the runner started; otherwise the report says `NO_PREREGISTERED_MANIFEST`. A manifest made after the run is reconstruction, not preregistration.

Normal desktop use creates this automatically when the release is armed. The CLI is only for development and manual diagnostics, and uses the same implementation (create or verify, never overwrite):

`npm run arbitration:manifest -- --date <target-date> --release-at <YYYY-MM-DDT08:00:00+08:00>`

## Evidence association

`REPORT.md` has an `Evidence Association` section; `analysis.json` lists every selected, rejected and ambiguous candidate with its reason. Missing evidence is always preferred to evidence from another release.

- Run progress: the file holding the requested run's `RUN_CONFIGURATION`; only that run's lines are used.
- Slot Watch: eligible only with the exact target date and release instant. A watch started within 10 s of the runner is `MATCH` (HIGH). Otherwise, exactly one eligible watch that recorded observations is `MATCH` (MEDIUM), e.g. an operator-started watch kept for the release. Several give `AMBIGUOUS` and none is used. Header-only leftovers from other launches give `NO_MATCH`, and the analysis continues without Slot Watch.
- Clock evidence: checkpoint files (`T-10M`, `T-5M`, `T-60S`, `T-30S`) are read by `capturedAt` and must fall between their nominal checkpoint and the release. A file that matches a clock event in this run's progress log is HIGH. An unlinked file is MEDIUM, and only when the run logged nothing for that checkpoint. Duplicates give `CLOCK_EVIDENCE_AMBIGUOUS` and are excluded.
- Provider trace, critical path, release forensics: embedded or directory run ID. Journals: exact `attempt.releaseMs`.
- Experiment manifest: validated by the same code the app uses when arming (schema, hypothesis specification, release, target date), and created before the runner started; otherwise `NO_PREREGISTERED_MANIFEST`.

## Abnormal-exit limitations

This phase deliberately keeps the Wave 1 path unperturbed: no `fsync`, no persistence moved before the POST, no change to provider-trace or critical-path timing, and no new network activity. After a hard exit the analyzer still reports on whatever survived, but:

- Provider trace, critical path and response evidence (inside the provider trace) exist only in memory until the run settles, so they can be missing.
- Buffered diagnostic progress events can be lost; core stages are written synchronously but not `fsync`ed.
- Slot Watch rows written so far survive; its summary and report need a graceful finish.
- A journal state rewrite interrupted mid-write can leave unreadable JSON, which discovery rejects.
- Clock evidence is best-effort and absent if the process exits before a round completes.
- Release forensics is built by the UI after the runner exits and is missing if the desktop app is killed first.
- Analysis, replay and copying `.local` evidence into a permanent archive remain manual post-run steps.

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
