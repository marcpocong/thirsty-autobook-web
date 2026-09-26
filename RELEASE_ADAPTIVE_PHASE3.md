# Precision release Phase 3 — local implementation report

Date: 2026-09-24. Status: implemented and verified offline. Wave 2 and Rescue have **not** been exercised at a real release.

## Starting state

- Local HEAD: `15334cabbe7a32fd7af2ffe87a5b2b0bb61b707f`; all pre-existing uncommitted Phase 1/2 and other work was retained. No commit or push.
- Phase 1 durable armed dispatch and Phase 2 read-only Slot Watch/forensics were present. Their reports are `RELEASE_LATENCY_PHASE1.md` and `RELEASE_FORENSICS_PHASE2.md`.
- The prior installed build reported `2026-09-24T12:02:37.540Z`, source `15334ca + uncommitted changes`; key installed dist files matched the source dist before editing.
- The initial full suite had a timing-sensitive Phase 2 test failure and a trace assertion about TCP connection reuse. The trace assertion was corrected; test concurrency was bounded at four workers. The full suite subsequently passed. One later full run had a 53 ms result against the Phase 2 independence test's 50 ms local timing threshold; that test passed alone, and the next full run passed.

## Authorization and Wave 1

- `precision-phase3.ts` accepts up to 21 exact candidates for the seven A–G Precision workers. Candidate IDs and the authorization fingerprint are SHA-256 hashes of the defined plan. Exact duplicates are rejected. Same-court overlaps can coexist as alternatives, but they cannot be assigned together in Wave 1 or selected while conflicting in-flight/verified work exists.
- Each candidate has its own court, time, duration, priority, wave permissions, rate source, evidence time/date/status, and hourly amounts. Wave 1 assignments and standby workers are explicit. A common-time Wave 1 warning describes concentration without changing the mapping.
- At T-2 minutes the runner freezes the authorized pool, verifies prior journals, prices each Wave 1 plan from its authorized rate evidence, and uses the existing Phase 1 armed dispatcher. The observer and later waves do not run in its release-time hot path. The final trusted no-early-send guard remains in place.
- The final arm text states exact Wave 1 targets, standby, adaptive counts and limits, concurrency, possible extra temporary holds, manual payment, and the UNKNOWN stop rule.

## Phase 2 evidence, standby, and Wave 2

- Slot Watch forwards its existing read-only observations to the runner. The adapter requires a published target date, complete 112-cell grid and price matrix, newest answered request sequence, bounded age, and `x-vercel-cache: MISS` with no positive `Age`. Cached or unknown-age OPEN, incomplete, stale, unreleased, failed, and out-of-order observations remain forensic only. This is deliberately conservative because the actual age of a cache HIT is not bounded by the request time.
- Standby A–G workers receive their own legitimate security preparation. A standby failure is recorded without delaying Wave 1. Wave 2 can select only fully OPEN frozen candidates, using all hourly prices from the triggering actionable observation. One adaptive wave is allowed, subject to explicit wave and total budgets. An empty first grid does not consume the wave. Selection starts only after an actual Wave 1 dispatch; nonconcurrent mode waits until Wave 1 settles. A final guard checks freshness, release time, verified/UNKNOWN state, and active conflicts before POST.
- A newer Slot Watch read during security preparation does not by itself end a Wave 2 or Rescue attempt. After preparation, before reservation and immediately before POST, the attempt re-evaluates the newest read (`revalidateAdaptiveAttempt`): it must itself be actionable and fresh, and the SAME candidate must be OPEN in every required hour with valid prices and must not have been seen unavailable since selection. That read then becomes the effective evidence and its prices go into the request; once the request is bound, a price change stops the POST. Anything else stops the attempt and logs `PHASE3_ADAPTIVE_SKIPPED` with its checkpoint and reason; each adoption logs `PHASE3_EVIDENCE_REBASED` (from/to sequence). `evidenceSeq` is the effective read and `selectedEvidenceSeq` the read the candidate was selected from; `PHASE3_DISPATCH` carries the read that authorized the POST itself.
- At most seven A–G workers can be active. Worker H is excluded from Precision.

## Reopen Rescue and durability

- Rescue defaults off and must be authorized before arming. It requires all prior dispatched attempts settled as rejected, no hold, no UNKNOWN, no in-flight checkout, and a complete fresh unavailable-to-OPEN transition for the same range. The earlier unavailable response must precede the reopen request. Each candidate is limited to one Rescue per distinct unavailable epoch, and wave/total budgets apply.
- A reservation counts against those budgets and its reopen epoch from the moment it is recorded (in flight, so a pending final gate still blocks a concurrent Rescue). When its request provably never left, it settles as `NOT_DISPATCHED` and stops counting: the evidence is a `SubmissionDispatchError` with `dispatched=false` raised before `fetch()` (the pre-POST gate, or a transport refusal such as stale security headers), the same evidence under which the durable journal records the attempt as unsent and reusable. Its telemetry (`PHASE3_SETTLED` with `budgetReleased: true`), intent file and archived rejected journal remain. HTTP rejections, UNKNOWN outcomes, verified holds and `NOT_DISPATCHED` inferred only from journal state keep consuming.
- The freshness window is `max(6 s, 2 × observed read latency + measured security refresh + 1 s)`, capped at 15 s. This accounts for the 3.7–6+ s release reads in the Phase 2 report while rechecking age immediately before POST. Rescue forces fresh legitimate security preparation and skips the opportunity if that or the journal is unsafe.
- Existing journals archive conclusively rejected or unsent attempts through their explicit reusable path; UNKNOWN and nonexpired verified holds block reuse. The global lock is retained for holds/UNKNOWN. Frozen authorization and per-adaptive-attempt intent files are durable, and the run trace records the attempt history. No timeout is treated as a rejection.

## Forensics and pricing

- One provider trace set remains active through Wave 1, Wave 2, and Rescue. Later attempts update worker/attempt context. A normal response fallback records only allowlisted status, content type, provider IDs and sanitized timing headers after POST; CDP remains optional enrichment. The report includes wave, worker, candidate, attempt, evidence, price, outcome and fallback.
- Synthetic offline report: `.local/release-forensics/00000000-0000-4000-8000-000000000003/report.txt`. It contains all three waves and is fixture data, not a live run.
- Wave 1 uses explicitly entered pre-release evidence. Historical/reference status cannot authorize Wave 1. Wave 2 and Rescue replace every hourly request rate with the triggering actionable grid's per-hour price. Response amount validation remains in the existing checkout path.

## UI and limits

- The editor shows up to 21 candidates, each one's priority, court, start, duration, Wave 1 worker, Wave 2/Rescue permissions, hourly prices, and optional per-candidate rate evidence overrides. The global rate fields provide defaults; the evidence timestamp is editable and preserved when saved. Wave 1 and standby workers are displayed separately, as are current evidence status and price. The saved plan includes finite Wave 2, Rescue, total, and concurrency limits.

## Offline Wave 1 latency

Local Chrome harness, armed mode, Phase 2 observer on in both configurations, 50 ms synthetic response, 10 measured runs per worker count after warmups. Numbers are milliseconds after the synthetic release. Each quartet is p50 / p95 / p99 / max. These short samples are a regression check, not a claim of release timing or provider acceptance.

| Workers | Mode | First POST | Last POST | First-to-last spread |
| --- | --- | --- | --- | --- |
| 1 | Phase 1/2 baseline | 4.283 / 6.365 / 6.365 / 6.365 | 4.283 / 6.365 / 6.365 / 6.365 | 0 / 0 / 0 / 0 |
| 1 | Phase 3 | 4.534 / 5.269 / 5.269 / 5.269 | 4.534 / 5.269 / 5.269 / 5.269 | 0 / 0 / 0 / 0 |
| 3 | Phase 1/2 baseline | 6.031 / 6.997 / 6.997 / 6.997 | 7.052 / 8.878 / 8.878 / 8.878 | 1.336 / 1.898 / 1.898 / 1.898 |
| 3 | Phase 3 | 5.784 / 8.483 / 8.483 / 8.483 | 7.260 / 10.021 / 10.021 / 10.021 | 1.159 / 1.539 / 1.539 / 1.539 |
| 7 | Phase 1/2 baseline | 11.817 / 14.487 / 14.487 / 14.487 | 14.287 / 16.464 / 16.464 / 16.464 | 2.103 / 2.803 / 2.803 / 2.803 |
| 7 | Phase 3 | 6.307 / 8.437 / 8.437 / 8.437 | 7.420 / 10.793 / 10.793 / 10.793 | 1.092 / 2.356 / 2.356 / 2.356 |

Raw and summary files are under `.local/benchmarks/` with labels `phase3-comparison-baseline` and `phase3-comparison-enabled`.

## Verification and limits

- Focused Phase 3/proofless tests: 19 passed. Full Vitest: 85 files, 983 tests passed on the final run. Typecheck, UI build, offline A–Q simulator, and `git diff --check` passed. The one timing-sensitive retry is described above.
- The Windows EXE and installed dist were rebuilt from the working tree; `BUILD-INFO.txt` and the launcher/file hashes document the match. No live release was armed, no checkout was sent, no hold or payment was created, and no automatic cancellation or security bypass was added.
- A comparison of 56 private identity/credential values against eight Phase 3 source/report files found no match. Private journals, profiles, locks and `.env.local` remain outside publication scope.
- Real cache semantics, Wave 2/Rescue provider behavior, browser readiness under a busy real release, and end-to-end crash/restart behavior remain unproven until a supervised release. The offline journal tests cover fail-closed dispositions; no live recovery was attempted.
