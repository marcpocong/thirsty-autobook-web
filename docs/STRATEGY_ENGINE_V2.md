# Strategy Engine V2

Strategy Engine V2 treats a release plan as one strategy: immediate targets, their fan-out children, Wave 2 backups and Reopen Rescue. Before V2 these were three separate booking modes.

```text
USER GOAL / STRATEGY
        │
        ├── Candidate authorization (≤ 21 exact court/time windows)
        ├── Immediate logical targets ──► independently tracked fan-out children (A0, A1, …)
        ├── Adaptive Wave 2 (standby workers, fresh released schedule only)
        └── Reopen Rescue (fresh unavailable → open only; predictions prepare, never send)
```

There is **one authority**: the saved `PRECISION_PHASE3` object, which `src/precision-simple.ts` compiles. The backend validates the same object with `authorizePrecision`, and "what will happen" is always generated from it. `STRATEGY_V2` saves the goal, preset and fan-out choice so the Strategy view can reopen them. It is metadata only: it is not part of the plan fingerprint and it never authorizes a send.

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
   | Custom | you edit everything under Advanced overrides | | | |

   Fan-out defaults to this machine's measured recommendation (see [FANOUT_CAPACITY_BENCHMARK.md](FANOUT_CAPACITY_BENCHMARK.md)). Choosing a width yourself is labelled **Operator override** and saved as `OPERATOR_OVERRIDE`. Child timing (Tight / Balanced / Wide) derives its spacing from the same profile. See [Timing presets](#timing-presets).
4. **Suggested plan**: a suggestion, not a command. It avoids known public conflicts and leaves out unknown evidence (fail closed). Immediate targets use distinct courts and are **diversified across start times**, so one time-wide unavailable block cannot hit every attempt. For example: C7 19–22, C6 20–23, C5 18–21, C4 21–24. Remaining windows fill the Wave 2 / Rescue pool up to the 21-candidate authorization. **Force include** keeps a conflicting window deliberately. It is marked `OPERATOR_OVERRIDE_PUBLIC_CONFLICT` on the candidate and warned again at review. **Remove** drops a window.
5. **Review & save**: the compiled authorization in plain language, override warnings repeated, then Save.
6. **Advanced overrides**: every raw setting, the Smart attempt editor, rates, legacy Fixed attempts and the Release Lab experiment.

Scores rank the operator's own preferences (duration order, prime fit, court order) and the evidence quality. They never predict who wins Onda's arbitration.

## Fan-out children

An immediate target is the **parent goal**. With `fanOutOffsetsMs` (2–4 values), it is sent as that many **children**. Each child has its own tab and security context, attempt ID, `parentGoalId`, `fanOutIndex` / `fanOutCount`, configured trigger, journal directory, response capture, critical-path row and outcome.

A crash-safe parent guard journal per target prevents a restart from blindly repeating the logical goal. Every child consumes send budget. The Live view summarizes by parent and expands children on demand.

A verified hold or an UNKNOWN child stops later adaptive activity exactly as before. A child refused before its transport sent anything is `NOT_DISPATCHED`: it consumes no budget and never reads as UNKNOWN.

At the T−2 min freeze, an immediate target that now shows a known public booking is left out visibly. The exception is a target the operator force-included: it is kept, with a warning. A failed read never removes an operator-authorized target.

## Priority-aware prewarm

Fan-out children prepare security by tier: A0…G0 first, then A1…G1, and so on. Concurrency is bounded (one preparation per browser at a time) and a tier barrier holds lower tiers back. The barrier is bounded, so one stuck challenge cannot starve everything.

No preparation starts in the last 3 s. A lower-tier child not ready at its trigger is **omitted**: provably unsent, and never fired late. The lead grows with the number of tiers and this installation's measured p95 preparation time (`security-prep-history.ts`). It is capped at 75 s, well inside the 120 s prepared-context limit. Without fan-out the old behavior is unchanged: everything prepares 15 s before release.

## Timing presets

Timing presets are **local dispatch profiles**, not claims about Onda. Spacing comes from the machine's loaded trigger→Chrome jitter, child-index step and spread, and is never smaller than the machine can keep apart. The UI keeps three times distinct:

- **configured trigger**: the Release Offset;
- **predicted local Chrome start**: configured trigger plus the measured lag of that child position;
- **observed Chrome start**: from critical-path telemetry.

None of these is a network arrival time.

**Signed offsets.** Stored offsets are already signed: negative means before the release instant, 0 means at it. Positive (after-release) triggers would fit the trusted-clock and 1 s dispatch-window model, but they are not enabled. There is no measured benefit yet and no UI to set them, and widening a validated range without evidence was out of scope. Existing configurations need no migration.

## Rescue V2 and Slot Watch

See [RESCUE_V2.md](RESCUE_V2.md).

## Telemetry (History & Insights)

Every critical-path row (`.local/release-forensics/<run>/critical-path.ndjson`) records one attempt:

- identity: parent goal, worker, fan-out index/count, configured offset, wave;
- timing: scheduler wake, worker invocation, transport entry, renderer entry, fetch(), Chrome request start, Playwright request event, response;
- outcome: final state and prewarm-ready time.

`release-telemetry.ts` summarizes recent runs:

- configured → Chrome error, per child index and per worker;
- first-to-last spread;
- compression (actual spread ÷ configured spread);
- prewarm headroom;
- Wave 2 / Rescue selection → POST;
- predicted → observed reopen error.

No tokens, cookies or customer data are stored.

## Replay

`npm run replay:strategy -- <slot-watch.ndjson…>` runs the proposed strategy against a recorded release (`strategy-replay-v2.ts`). The known schedule is the newest public-booking read before release. The plan is suggested and compiled as in the UI, then replayed through the production Phase 3 rules twice: immediate attempts rejected, and immediate attempts UNKNOWN.

The replay answers which candidates would have been authorized, which immediate targets and fan-out would have been used, which Wave 2 and Rescue opportunities were actionable, what was visible only in stale evidence, and whether UNKNOWN blocked later sends.

It is labelled counterfactual and never claims a booking would have succeeded.

## Safety invariants (unchanged)

- durable journals and one-shot permits;
- UNKNOWN is never retried;
- a verified hold stops conflicting sends;
- trusted release clock and the no-early / maximum-lateness gates;
- fresh evidence plus a final pre-POST revalidation for every adaptive send;
- price rebinding rules;
- fail closed on unknown evidence.

Arming now also validates the exact wire body of every checkout it could send (`wire-payload-check.ts`).
