# Smart backups UX and Release Intelligence (Phase 3 UX + Phase 4)

Date: 2026-09-24. Status: implemented and verified offline. **Nothing here has been exercised at a real 08:00 release.** Backups (Wave 2), reopened-slot attempts (Rescue), history-based suggestions, early confirmation and network changes are not live-proven.

Baseline: local HEAD `4a9cb2c8652f13048824de308add07c1327dd37f` (clean tree at start). No commit or push.

## Part A: Smart backups, in plain language

### What changed for the operator

The Phase 3 checkbox and its dense editor (priority integers, per-row Wave 2/Rescue checkboxes, comma-separated prices, ISO timestamps, rate-status enums, seven standby checkboxes and three budgets) are replaced by one plan choice and four short sections.

| Plan choice | Meaning |
| --- | --- |
| **Fixed attempts** | Send only the exact attempts listed at 8:00 (the legacy `PRECISION_TARGETS` path, unchanged). |
| **Smart backups** | Send immediate attempts at 8:00, then use only pre-approved backup slots when fresh availability confirms they are open (`PRECISION_PHASE3`). A saved `PRECISION_PHASE3` plan loads as Smart backups. |

Smart backups sections: **Immediate attempts** (court, start, duration, read-only worker), **Backup choices** (court, start, duration; order is priority; move up/down), **Backup behavior** (one toggle: "Use backups immediately when a fresh opening appears" = `concurrentWave2`), **Try reopened slots** (one toggle plus "Maximum reopened-slot attempts", default 1 = Rescue). A **Rates** card shows the confirmed rate card and a **Review rates** action. **What will happen** is always visible before Save. Everything technical moved to a collapsed **Advanced settings** panel.

| Internal | Shown to the operator |
| --- | --- |
| Candidate pool / Wave 1 / Wave 2 | Approved slots / Immediate attempts / Backup attempts |
| Standby workers | Backup workers |
| Reopen Rescue / Concurrent Wave 2 | Try reopened slots / Use backups immediately |
| Dispatch budget / Evidence fitness | Attempt limit / Availability status |

### Automatic derivation (all in `src/precision-simple.ts`, shared by renderer, arming text and tests)

- Workers: each immediate attempt gets the next ready worker in A–G order. "Ready" excludes a worker whose player is not configured or who has an identity issue from the latest preparation (by letter only). A saved mapping that the automatic rule would change is kept as an explicit Advanced pin and flagged "Worker B is not ready and will not be used." Worker H is never used.
- Backup workers: ready A–G workers not used by immediate attempts, limited to the number of backup choices.
- Priorities: visible order (immediate attempts first, then backups).
- Permissions: immediate = Wave 1 only; backups = Wave 2 only; when "Try reopened slots" is on, **every** visible slot is Rescue-eligible (the simpler safe design; per-slot overrides remain in Advanced).
- Limits: backups = min(backup choices, backup workers); reopened = 0 when off, else the chosen maximum (1–7); total = immediate + backups + reopened. Shown as "4 immediate + up to 2 backups + up to 1 reopened-slot attempt · Maximum possible sends: 7".
- Rates: the operator confirms a daytime (before 4 PM) and evening (from 4 PM) hourly rate and where it came from ("the venue's current schedule" or "I confirmed with the venue"). Capture time and applicable date (the next release's target date) are recorded automatically. Nothing is guessed: a slot without a confirmed rate, or with rates confirmed for another date, shows "Rate needs review" and Save is blocked. Backups and reopened slots still use the prices in the fresh released grid.
- "What will happen" and the arming confirmation are generated from the compiled `PRECISION_PHASE3` object that is saved, so they cannot disagree with the authorization.

**UI simplified; safety model unchanged.** The simple editor only produces `PRECISION_PHASE3` objects; the config schema and `authorizePrecision` validate them exactly as before (tested with 120 generated drafts). Immutable authorization, explicit targets, A–G only, cache-aware Wave 2 gating, the UNKNOWN hard stop, overlap protection, pricing validation, Rescue rules, attempt limits, no-early dispatch and journal safety are untouched. The only runner change is extracting the existing freshness formula into `adaptiveMaxAgeMs()` (identical expression) so replay can share it.

## Part B: Release Intelligence

### Data layer (`src/release-intelligence.ts`)

Derived, versioned files in `.local/release-intelligence/` (`index.json`, `metrics.json`, `releases/<target>@<release>.json`, `summary.txt`), rebuilt from raw Slot Watch logs, runner traces, forensic summaries, UI run journals (run-start/run-end lines only) and benchmark summaries (listed only). Raw artifacts are read, never written. Rebuild is deterministic; corrupt or empty artifacts are listed under `skipped`. Only whitelisted non-identifying fields are copied (worker letters, courts, times, offsets, status codes, enum outcomes, prices); source files are referenced by name, not path.

Origins: `REAL_RELEASE`, `HISTORICAL_PRE_PHASE3` (old observer, or released before 2026-09-25 08:00), `SYNTHETIC` (fixture names/run IDs; always a separate record even with a real timestamp), `OFFLINE_BENCHMARK` (listed only). Statistics use real and historical records only. Runs stopped before 08:00 contribute no attempts or outcome.

Observation quality, from the first published grid: **GOOD** = answered by +3 s, complete, cache MISS without Age; **FAIR** = by +10 s and complete (uncertain cache caps here); **POOR** = later, incomplete, or counts only; **NONE** = not observed. The metrics behind each label are stored with its reasons. A first useful grid at +11 s is POOR and never treated as T+0 evidence.

Metrics per weekday × court × hour and per 1–3 hour range: well-observed releases, first-published open/unavailable, censored, "still observed open" at +0.5/+1/+2/+5/+10 s (the first published read *requested* in [x, next milestone)), reopen counts (cache-uncertain reopens counted separately), public-record presence, unavailable-without-record, price distribution. Shared risk between two ranges: shared court-hours, Jaccard overlap, overlapping clock hours, co-unavailability and same-read-window losses, with a plain explanation. No probabilities.

Local data indexed now (installed app): 3 real releases, all historical and none well observed:

| Release (target) | Quality | Evidence | Attempts / outcome |
| --- | --- | --- | --- |
| 09-22 (Thu 09-24) | NONE | no observation | none sent · `API_NO_AVAILABLE_CANDIDATE` |
| 09-23 (Fri 09-25) | POOR | runner counts only; first published answer +6.0 s | E, F rejected · `SPECIAL_SESSION_NOT_AVAILABLE` |
| 09-24 (Sat 09-26) | POOR | old observer; first published read requested +11.3 s, answered +15.7 s; no prices or cache status | A/C/D POST +100–104 ms, HTTP 409 after 17.5–28.3 s; B not sent (identity at the time) · `OBJECTIVE_NOT_ACHIEVED_ALL_REJECTED` |

The 09-23 and 09-24 records carry short historical notes from the run reports (no grid is reconstructed from screenshots; unavailable cells without public records are "cause unknown").

### Historical Advisor (`src/release-advisor.ts`)

Inputs: courts, earliest/latest start, duration, number of immediate attempts and backup choices, exclusions (`3@19:00`). Candidates never leave those constraints. Ranking is a stated lexicographic order: fully open in the first well-observed snapshot → still open at +1 s → more well-observed releases → fewer shared hours with earlier picks → court order and start. Each card shows its evidence lines, sample size and quality. With today's history it says plainly that there is no well-observed release for that weekday. **Add to draft** only edits the in-memory draft (tested: no save, prepare or arm call).

### Offline Strategy Replay (`src/strategy-replay.ts`)

Replays recorded observations in response order through `authorizePrecision`, `PrecisionSession`, `classifyActionableObservation`, `candidatePriceFromObservation` and `adaptiveMaxAgeMs`. Assumptions are printed with every result (immediate attempts in flight until the recorded provider answers, then rejected; each replayed send treated as rejected). Output: immediate target observations, first actionable backup opportunity with grid prices, reopened-slot opportunities, conflicts, non-actionable openings with their evidence class, censoring. Statements are limited to "This release contained an observed authorized opportunity." and more cautious variants. Sources: saved plan (Tools), current draft (Smart summary), or a hypothetical plan (`npm run phase4:replay -- --root ..`).

The saved Fixed plan against local data: 09-24 is replayable but censored (first grid +15.7 s; its 102 published reads lack prices and cache status, so none is actionable under the current rules); 09-22 and 09-23 have no court/hour grid.

### Network Readiness (`src/network-readiness.ts`, Tools)

Five (maximum ten) sequential GETs to the public availability endpoint, one DNS lookup and one Google NTP consensus round. Reports success, median/p90 (≥10 reads)/p95 (≥20 reads)/max, completeness, new vs reused connections and setup time (Node fetch, HTTP/1.1; the browser's checkout connection may differ), clock samples/offset/RTT/spread/quality, and interface names (no addresses). Verdict: Ready / Needs attention / Insufficient data by fixed rules. Sanitized history in `.local/network-readiness/` (not part of the derived-intelligence clear). No clock or network setting is changed; no browser or checkout security is involved. It was not run live during this work.

### Research results

- **Early confirmation: NO AUTHORITATIVE INDEPENDENT ENDPOINT DEMONSTRATED.** The only booking read in use (`/api/public/bookings/booking-no/{bookingNo}`) depends on the booking number and token returned by our own successful checkout; `/api/public/spaces/bookings` is public occupancy without ownership; checkout is a guest flow with no customer booking list in repository evidence. Nothing was probed or implemented.
- **Proofless vs proof-based** (`src/checkout-path-research.ts`, `npm run phase4:research -- --root ..`), from recorded traces only: off-peak proofless decision→response p50 1,252 ms (n=11); proof-based candidate→response p50 6,360 ms (n=13), 1,433 ms without in-path security preparation. At recorded releases a published availability read took p50 1,975 ms, max 6,004 ms (n=5), which a proof-based path must wait for; POST→response took 17.5–28.3 s (n=3) for both. Slot-proof latency at a real release is unmeasured. No live comparison; the live strategy is unchanged.
- **Connection warmth: INSUFFICIENT EVIDENCE.** No real release has a provider trace yet (all indexed releases predate it). No warm-up traffic was added. The rule is in `connectionWarmth()` and is re-evaluated after each rebuild.

### UI

Runs → **Release insights**: first useful grid timing and quality, attempts by kind, result, reopened slots, comparison with earlier releases; reasons and notes under Details. Tools → **Network readiness** (Run network check), **Release intelligence** (Rebuild, Clear derived intelligence, View history, connection-warmth line), **Strategy replay** (Replay current plan). Edit Plan → **Suggest from history** and **Replay this draft**. No raw JSON outside Advanced settings.

### Isolation and performance

Phase 4 modules run only in the desktop main process; the runner, armed dispatch, precision modules, checkout transport and Slot Watch import none of them (test-enforced). Every Phase 4 tool is refused while a run or armed/scheduled release is active, while a slot watch is running, and from 10 minutes before release (the release watch covers the following 15 minutes). The post-run rebuild happens only after the final forensic report, i.e. after the runner exited and the watch ended.

Benchmark (`npm run bench:release -- --mode armed --workers 1,3,7 --priority window --phase3 on --response-delay 50 [--phase4 on]`): offline headless Chrome, synthetic 409, nothing leaves the machine. **ON** runs `scripts/phase4-load.ts` in a separate process for the whole pass: intelligence rebuild + replay + advisor over eight full-size releases in a tight loop (529 iterations in the first pass, 391 in the second). That is deliberately pessimistic; production refuses Phase 4 work in that window. Milliseconds after the release deadline, p50 / p95 / p99 / max. Every attempt in every pass was sent and received the synthetic 409.

40 measured runs per worker count:

| Workers | Metric | Phase 4 OFF | Phase 4 ON (continuous load) |
| --- | --- | --- | --- |
| 1 | first = last POST | 3.8 / 5.4 / 6.1 / 6.1 | 3.6 / 4.6 / 4.9 / 4.9 |
| 3 | first POST | 5.4 / 6.2 / 6.7 / 6.7 | 4.8 / 5.8 / 6.6 / 6.6 |
| 3 | last POST | 6.1 / 7.6 / 8.8 / 8.8 | 5.7 / 7.0 / 7.4 / 7.4 |
| 3 | spread | 0.9 / 1.7 / 2.6 / 2.6 | 0.9 / 1.4 / 1.9 / 1.9 |
| 7 | first POST | 7.2 / 10.4 / 10.6 / 10.6 | 5.8 / 11.0 / 16.4 / 16.4 |
| 7 | last POST | 8.2 / 11.3 / 11.8 / 11.8 | 7.1 / 12.9 / 18.0 / 18.0 |
| 7 | spread | 1.0 / 1.7 / 2.5 / 2.5 | 1.0 / 2.3 / 2.4 / 2.4 |

Seven workers repeated with 100 runs, interleaved OFF → ON → OFF:

| 7 workers | OFF (before) | ON | OFF (after) |
| --- | --- | --- | --- |
| first POST | 6.7 / 11.2 / 12.5 / 16.4 | 9.0 / 11.6 / 12.7 / 13.6 | 6.8 / 10.9 / 12.4 / 15.9 |
| last POST | 8.0 / 12.6 / 14.3 / 17.9 | 10.1 / 13.5 / 16.3 / 17.9 | 8.0 / 11.9 / 13.7 / 16.8 |
| spread | 1.0 / 2.4 / 3.3 / 3.7 | 1.3 / 2.5 / 4.2 / 10.2 | 1.0 / 2.1 / 3.2 / 3.3 |

Reading: with a saturating Phase 4 loop running in another process, the 7-worker median moved by +2.2 ms in the interleaved pass (and −1.4 ms in the first pass); p95/p99 stayed within OFF-to-OFF variation; one ON spread sample was 10.2 ms. This is CPU contention from a load the app never allows near a release (every Phase 4 tool is refused while a release is armed or running, during a slot watch, and from T−10 min), and no Phase 4 code is imported by the release path. No architecture change was needed. Raw and summary files: `.local/benchmarks/*phase4*` (ignored by git).

## Verification

- Baseline before editing: typechecks passed; full Vitest 85 files / 983 tests with one failure: the Phase 2 independence test's 50 ms lateness bound (74 ms) under full-suite load. Its outcome-equality assertion passed in that run and it passed 3 of 3 times alone, so it was classified as load-sensitive timing, not a broken invariant. No threshold was changed.
- Final: `tsc --noEmit` and the UI typecheck pass; full Vitest **93 files / 1,041 tests passed**; focused Part A 5 files / 51 tests and Part B 6 files / 39 tests pass; `npm run ui:build` passes; `npm run phase3:simulate` A–Q pass; `npm run phase4:replay` (7 fixture scenarios) pass; `git diff --check` is clean.
- Fleet (read-only, letters and codes only): A–G identity VALID, 7/7 unique customer IDs, at the start and at the end. Bot browsers were closed, so no worker was browser-ready at check time.
- Windows installation rebuilt from the final working tree: `BUILD-INFO.txt` says `Source: 4a9cb2c + uncommitted changes`; `src`, `ui` and `scripts` match the working tree (three stale archived files in the installed `src` predate this work); every compiled file in the installed `dist` is byte-identical apart from source maps (which embed the build folder path); `config.local.json` is byte-identical (Fixed attempts, Proofless Direct).
- Release intelligence was built once in the installed app from its real logs (3 releases, all historical, none well observed).
- Privacy scan: 47 identity/credential values from the private env files compared against 51 new or changed files and all derived outputs: 0 matches. Derived files contain no local paths.
- No live release was armed, no checkout was sent, no hold or payment was created, and no network check was run against Onda during this work.
