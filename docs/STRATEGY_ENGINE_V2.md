# Strategy Engine V2.2

Strategy Engine V2 treats a release plan as one strategy: immediate targets, their fan-out children, Wave 2 backups and Reopen Rescue. Before V2 these were three separate booking modes.

```text
USER GOAL / STRATEGY
        │
        ├── Candidate authorization (≤ 21 exact court/time windows)
        ├── Immediate logical targets ──► independently tracked fan-out children (A0, A1, …)
        ├── Adaptive Wave 2 (standby workers, fresh released schedule only)
        └── Reopen Rescue (fresh unavailable → open only; predictions prepare, never send)
```

There is **one authority**: the saved `PRECISION_PHASE3` object, which `src/precision-simple.ts` compiles. The backend validates the same object with `authorizePrecision`, and "what will happen" is always generated from it. `STRATEGY_V2` saves the goal, preset, fan-out provenance and accepted-suggestion reset baseline so the Strategy view can reopen them. It is metadata only: it is not part of the plan fingerprint and it never authorizes a send.

Fixed Precision remains available as **legacy** (Strategy → Advanced overrides).

## Operator workflow (Strategy view)

1. **Goal**: prime window (default 17:00 → midnight), preferred durations in order (default 3, 2, 1) and court priority.
2. **Known schedule**: the read-only public-booking check for the target date. Each hour shows one of:
   - `no known public conflict`: the date is unreleased and no record exists. This is **not** "open".
   - `known public booking conflict`.
   - `unknown · public query failed`.
3. **Strategy preset**: presets decide how the ready workers are spent. None of them has fixed counts.

   | Preset | Immediate targets | Fan-out | Standby / Wave 2 | Rescue |
   |---|---|---|---|---|
   | Balanced | about 4/7 of ready workers | machine recommendation | the rest | on |
   | Release focused | every ready worker | machine recommendation | none | on, afterwards |
   | Rescue focused | about 1/3 | ≤ 2 | the rest | on, larger budget |
   | Custom | fully hand-built plan | | | |

   Fan-out defaults to this machine's measured recommendation (see [FANOUT_CAPACITY_BENCHMARK.md](FANOUT_CAPACITY_BENCHMARK.md)). Choosing a width yourself is labelled **Operator override** and saved as `OPERATOR_OVERRIDE`. Child timing (Tight / Balanced / Wide) derives its spacing from the same profile. Live anchor Auto or a manual whole-group shift is a separate control. See [Timing presets and live anchor](#timing-presets-and-live-anchor).
4. **Suggested plan**: a suggestion, not a command. `Auto` uses the same-weekday historical DTO only when at least three GOOD/FAIR real-release or clearly labelled pre-Phase-3 releases are well observed. `Preference only` runs the original V2 ordering. Both modes avoid known public conflicts and leave out unknown evidence (fail closed). Immediate targets and the backup pool are selected greedily, recomputing shared court-hour, clock-hour and observed co-unavailability risk after every pick. **Force include** remains the only way to retain a current conflict and is marked `OPERATOR_OVERRIDE_PUBLIC_CONFLICT`.
5. **Editable Smart plan**: accepting the preview copies it into an editable draft without changing its preset to Custom. Each accepted row receives a deterministic origin (`I0…` or `B0…`) stored in `STRATEGY_V2.lineage`. The origin moves with the row, so reorder or removal can never make Reset target restore a different accepted row. New manual rows have `null` origin, display **Operator added**, and have no reset action. Old Smart plans without `acceptedPhase3` display **Existing Smart plan**; the app never invents Smart-generated provenance.
6. **Review & save**: the current draft is compiled, and the review is generated from that exact about-to-be-saved `PRECISION_PHASE3` object. Every immediate child and configured timing is listed before Save.
   Every covered hour from 16:00 onward uses the venue's fixed PHP 700 hourly schedule on every day and does not require a separate rate review. If any target crosses into hours before 16:00, its daytime portion must still have a confirmed rate for the target date.
7. **Advanced overrides**: worker pinning, standby assignment, raw budgets and permissions, rates, legacy Fixed attempts and the Release Lab experiment.

The workflow is therefore: **Smart suggestion → accept → editable Smart plan → optional operator customization → compiled review → save**.

**Reset is not Regenerate.** Reset timing restores only that target's accepted child offsets; Reset target restores that accepted target; Reset all restores the exact suggestion originally accepted. Suggest plan generates a new preview from the latest goal, evidence and timing profile, but does not replace the accepted draft until the operator chooses Use this plan.

## Evidence-assisted ranking

History strength is deterministic: `NONE` = 0 well-observed same-weekday releases, `LIMITED` = 1–2, `USABLE` = 3–4, and `STRONG` = 5 or more. These are practical quality gates, not statistical confidence claims. NONE and LIMITED are displayed but do not alter V2 ranking. Synthetic and offline benchmark data never enter the DTO.

- Immediate targets keep duration priority strong, then use current evidence, first-usable-snapshot openness, +1 s survival and plan-aware shared risk.
- Wave 2 emphasizes +1 s and +5 s survival before first-snapshot openness.
- Rescue affinity uses factual cache-certain reopening counts. It does not claim a reopening probability.
- Every selected row carries plain-language evidence and diversification reasons. No win score or win probability is produced.

The desktop process derives the sanitized DTO from `release-intelligence.ts` / `release-advisor.ts`; the release runner never imports Phase 4 files. Historical evidence never overrides current conflicts, failed reads, the operator's goal, or the duration order.

Timing offsets remain based on the local Fan-out Capacity Profile. Sparse provider outcomes never rewrite offsets; telemetry is calibration evidence only.

## Fan-out children

An immediate target is the **parent goal**. With `fanOutOffsetsMs` (2–`PRECISION_MAX_FAN_OUT`, currently six, values), one worker sends that many **children**. Each child has its own tab and security context, attempt ID, `parentGoalId`, `fanOutIndex` / `fanOutCount`, configured trigger, journal directory, response capture, critical-path row and outcome.

## Shotgun release intensity

Shotgun is not another engine. `STRATEGY_V2.shotgun` stores versioned UX/provenance data; `compileSmartPlan()` expands it into the same authoritative `PRECISION_PHASE3` used by Normal, Wave 2 and Rescue.

- Stable logical target IDs are derived from court/start/duration, so reordering rows cannot move a selection to another target.
- The Shotgun budget counts attempts on selected targets. Unselected immediate targets remain one normal Wave 1 target (with their normal configured fan-out).
- Equal uses quotient/remainder in priority order. Priority weighted uses deterministic weights `N+1, N, ..., 2` and largest remainder; with two targets, 20 becomes 12/8. Custom persists exact non-negative integers and never rewrites them.
- A target allocation is split into worker groups of at most `PRECISION_MAX_FAN_OUT`; for example ten shots become groups of six and four. This preserves one authoritative per-browser/tab ceiling.
- One aggregate timing schedule is distributed fairly across selected targets, so targets do not create coincident hidden bursts. Auto and Custom span the full signed window. Tight, Balanced and Wide request 1x, 2x and 4x the machine's meaningful spacing and end at `windowEndMs`; when that cannot fit, the full window plus a capacity warning applies. The existing fresh learned/manual group anchor is then added uniformly; Save fails if it would move a final trigger outside the signed range. There is no learned offset per child.
- The capacity planner compares requested spacing with the local meaningful-spacing input, reports a recommended maximum and blocks Save unless an explicit capacity override is present.
- A verified hold, UNKNOWN, or recognized provider throttle suppresses remaining unsent same-target shots. Confirmed rejection permits later scheduled shots. Suppression is `NOT_DISPATCHED` with a specific `SHOTGUN_*` reason.
- Review is generated from the compiled object and lists allocation, window, exact triggers, standby workers, Wave 2, Rescue and maximum sends.

The editor reads and writes those actual `fanOutOffsetsMs` values. It never shows a competing single-parent offset for a fan-out target. UI values are positive **milliseconds early** (`25 ms early` saves as `-25`; `0` saves as the release instant). Increasing width preserves existing indices and derives only new children from the selected Tight/Balanced/Wide profile; decreasing width keeps the first N. Individual edits make timing Custom, based on the original profile, without making the whole strategy preset Custom.

A crash-safe parent guard journal per target prevents a restart from blindly repeating the logical goal. Every child consumes send budget. The Live view summarizes by parent and expands children on demand.

A verified hold or an UNKNOWN child stops later adaptive activity exactly as before. A child refused before its transport sent anything is `NOT_DISPATCHED`: it consumes no budget and never reads as UNKNOWN.

At the T−2 min freeze, an immediate target that now shows a known public booking is left out visibly. The exception is a target the operator force-included: it is kept, with a warning. A failed read never removes an operator-authorized target.

## Priority-aware prewarm

Fan-out children prepare security by tier: A0…G0 first, then A1…G1, and so on. Concurrency is bounded (one preparation per browser at a time) and a tier barrier holds lower tiers back. The barrier is bounded, so one stuck challenge cannot starve everything.

No preparation starts in the last 3 s. A lower-tier child not ready at its trigger is **omitted**: provably unsent, and never fired late. The lead grows from the exact saved Wave 1 task topology and this installation's compatible measured p95 preparation time (`security-prep-history.ts`), with a conservative 12-second fallback. It is capped at 105 s, leaving 15 s under the 120 s prepared-context limit at the release instant. Without fan-out the old behavior is unchanged: everything prepares 15 s before release.

Before arming, the same task-order, tier-barrier and global/per-browser concurrency policy is run as a deterministic feasibility simulation against the exact compiled `PRECISION_PHASE3` plan. Strategy Review shows projected per-child start, ready, trigger and freshness state. Release Readiness reports `GOOD`, `DEGRADED` or `UNAVAILABLE`; projected omissions make the saved authorization `NOT READY` and require the operator to save a different plan. The forecast never edits targets, offsets or Shotgun budget.

## Timing presets and live anchor

Timing presets are **local dispatch profiles**, not claims about Onda. Spacing comes from the machine's loaded trigger→Chrome jitter, child-index step and spread, and is never smaller than the machine can keep apart. The UI keeps three times distinct:

- **configured trigger**: the Release Offset;
- **predicted local Chrome start**: configured trigger plus the measured lag of that child position;
- **observed Chrome start**: from critical-path telemetry.

None of these is a network arrival time.

V2.2 deliberately separates two timing questions:

```text
machine capacity profile -> child spacing
real-release critical path -> whole-group anchor
spacing + groupShiftMs     -> literal final child offsets
```

Release Precision V3 adds a third, bounded term: a local worker/fan-out-index de-skew (`±12 ms`, zero below two matching releases), learned only from worker invocation → Chrome start so that central-dispatcher queue position is not mistaken for a slow worker. The final literal is `base spacing + groupShiftMs + de-skew`, and that literal is what Review shows and Save writes. See [RELEASE_PRECISION_V3.md](RELEASE_PRECISION_V3.md).

`groupShiftMs` is the signed release-relative shift applied equally to every configured child offset produced by the spacing generator. For example, base `[-10, 0]` plus `groupShiftMs = -7` becomes `[-17, -7]`; the 10 ms spacing is unchanged. The Review screen shows `-17` and `-7` as the actual compiled truth, so the operator never has to add the two components mentally.

The live model measures only `triggerToChromeLagMs = observedChromeStartMs - configuredOffsetMs`. A sample is eligible only when it is from a real live release, the release/trusted-clock mapping and configured offset are valid, and dispatch actually occurred. It is grouped by dispatch mode and fan-out width; machine and Chrome/runtime identity are also matched when both the sample and current installation expose them. Synthetic fixtures and offline benchmarks never calibrate Auto. Provider outcome, response duration/order and the timestamp-like part of `x-vercel-id` are retained only for forensics. The latter remains **UNDOCUMENTED** and is not a confirmed edge-receipt timestamp.

Evidence levels are operational gates, not statistical confidence: `NONE` = 0 matching releases, `LIMITED` = 1, `USABLE` = 2–3, and `STRONG` = 4+. Multi-child Auto requires USABLE/STRONG matching evidence; one width-1 release may directly calibrate a width-1 attempt. Freshness is an input filter (V3): rows older than 30 days are removed before any Auto calculation, so one recent release can never bring older rows back into the median; they remain visible in History & Insights. The anchor takes a median per release, then the median across releases, so a wide release with many children still casts one vote. With no fresh matching release, Auto falls back to no group shift. Missing, inconsistent, impossible or `NOT_DISPATCHED` timing never becomes zero.

Auto uses the robust median local lag and centers the predicted local Chrome-start group on the official release boundary, rounded to whole milliseconds and clamped to the existing `-2000..0` configured-offset range. It does not learn a provider "winning time." If the base spacing already straddles release, zero additional shift is valid. Manual lets the operator specify the group shift without changing the Strategy preset to Custom; provenance is saved as `OPERATOR_OVERRIDE`. The anchor is applied only when generating a suggestion. Once accepted, child-level edits remain authoritative and are never silently rewritten; Suggest/Regenerate may compute a new preview, while Reset restores the accepted suggestion.

September 28 is the regression case: configured offsets `[-50, -25, -10, -5, 0, 0, 0]` mapped to Chrome starts `[-45.59, -20.92, -5.98, -0.78, 4.23, 4.29, 4.83]`, a median local lag of about `+4.23 ms` and range `+4.02..+4.83 ms`. That supports roughly `-4 ms` for a width-1 release-centered attempt. It does **not** justify `-25 ms` as a default: Worker B's HTTP 409 happened to return first, but response order did not follow send order. For a width-2 base `[-10, 0]`, the same lag already approximately straddles release and implies no material extra shift; in any event, width-1 history is not matching width-2 evidence, so current width-2 Auto uses the deterministic release-centered fallback until enough width-2 releases exist.

**Signed offsets.** Legacy Normal/Fixed controls remain `-2000..0`. Shotgun windows use `-2000..+2000`: negative means before release, 0 at release, positive after release. The UI never converts this to the legacy positive “send early by” convention. Existing saved plans need no migration.

## Rescue V2 and Slot Watch

See [RESCUE_V2.md](RESCUE_V2.md).

## Telemetry (History & Insights)

Every critical-path row (`.local/release-forensics/<run>/critical-path.ndjson`) records one attempt:

- identity: parent goal, worker, fan-out index/count, Shotgun shot index/count, configured offset, timing bucket, wave;
- timing: scheduler wake, worker invocation, transport entry, renderer entry, fetch(), Chrome request start, Playwright request event, response;
- outcome: final state and prewarm-ready time.

`release-telemetry.ts` summarizes recent runs and retains up to 64 for live calibration:

- configured → Chrome error, per child index and per worker;
- first-to-last spread;
- compression (actual spread ÷ configured spread);
- prewarm headroom;
- Wave 2 / Rescue selection → POST;
- predicted → observed reopen error.

History & Insights shows a separate Live Timing Calibration table by width, with samples, distinct releases, median/p95/range, evidence level, freshness and a secondary run-by-run table. The warning that HTTP response order is not arrival order is part of that panel.

No tokens, cookies or customer data are stored.

## Replay

`npm run replay:strategy -- <slot-watch.ndjson…>` runs the proposed strategy against a recorded release (`strategy-replay-v2.ts`). The known schedule is the newest public-booking read before release. The plan is suggested and compiled as in the UI, then replayed through the production Phase 3 rules twice: immediate attempts rejected, and immediate attempts UNKNOWN.

The replay answers which candidates would have been authorized, which immediate targets and fan-out would have been used, which Wave 2 and Rescue opportunities were actionable, what was visible only in stale evidence, and whether UNKNOWN blocked later sends.

It is labelled counterfactual and never claims a booking would have succeeded.

`npm run replay:live-anchor -- --root "<installation root>"` replays Smart Timing V2.2 against archived critical-path rows. For each historical topology it compares actual configured offsets/Chrome starts with the spacing, group shift and predicted local Chrome-start range that V2.2 would have produced using only earlier matching real releases. It reports measurable local timing only and never claims the counterfactual would have won.

## Safety invariants (unchanged)

- durable journals and one-shot permits;
- UNKNOWN is never retried;
- a verified hold stops conflicting sends;
- trusted release clock and the no-early / maximum-lateness gates;
- fresh evidence plus a final pre-POST revalidation for every adaptive send;
- price rebinding rules;
- fail closed on unknown evidence.

Arming now also validates the exact wire body of every checkout it could send (`wire-payload-check.ts`).
