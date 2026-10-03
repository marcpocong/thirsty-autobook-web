# Fan-out Capacity Benchmark

The benchmark measures what **this machine's local dispatch path** does when W workers each send F child attempts. It says nothing about how Onda arbitrates. A width that stays inside the gates is only one whose extra children do not measurably degrade local send timing.

## Running it (offline; Onda is never contacted)

```powershell
npm run bench:fanout -- --workers 7 --widths 1,2,3,4 --runs 40 --save-profile
```

**Offline guarantees**

- Each benchmark Chrome has DNS disabled and all traffic sent to a closed local proxy.
- Every `app.onda.fit` request is fulfilled locally: checkout returns a synthetic 409.
- A self-check refuses to run if a page can reach the network.
- Journals, locks and identities are synthetic, in a scratch folder.

**What it exercises**

- The real Node runtime and real installed Chrome over Playwright/CDP.
- One Chrome process per worker, with one tab per child.
- The production `freezePrecisionRace` → `armPrecisionRace` → `dispatchArmedPrecisionRace` path.

**Per child, it records**

configured trigger, scheduler wake, worker invocation, transport entry, renderer evaluate entry, fetch() call, Chrome request start (CDP wall stamp), Playwright request event and response.

**Per run, it records**

first-to-last spread, prewarm durations, last-ready margin, Node CPU and machine busy share.

**Options**

| Option | Effect |
|---|---|
| `--pattern burst \| offsets:-35,-30,-25,-10 \| spaced:<ms>` | Child offsets (default `burst`: every child at the release instant) |
| `--dispatcher central \| coordinator \| renderer` | Which dispatcher to measure |
| `--prewarm-lead <ms>` | How long before release security preparation starts |
| `--prewarm-concurrency <n>` | Use the tiered prewarm policy with at most n preparations at once |
| `--synthetic-prewarm cpu:<ms>,wait:<ms>` | Stand-in workload for security preparation (see limits below) |
| `--page-busy <ms>` | Keep each tab's main thread busy for this long every 10 ms |
| `--headed` | Real windows, with background tabs as in production |
| `--traces` | Passive CDP provider traces on every tab, as in production |

**Output**

- `.local/fanout-capacity/<time>-<label>-summary.json` and `-raw.json`.
- With `--save-profile`, `profile-<time>.json`: the **Machine Profile** (build SHA, machine identity, configuration, per-width p50/p95/p99/max, spread, per-child-index and per-worker distributions, prewarm readiness, CPU, recommendation). It contains no customer data.

The app reads the newest profile compatible with the machine and the production dispatcher, from the installation's or the `Source` folder's `.local/fanout-capacity`.

## Recommendation gates (src/fanout-capacity.ts)

A width is recommended only if it, and every narrower width, stays within these limits relative to **the same machine's width-1 run**:

| Gate | Limit |
|---|---|
| Trigger → Chrome start p50 | 1.5 × width-1 + 2 ms |
| Trigger → Chrome start p95 | 1.5 × width-1 + 3 ms |
| Trigger → Chrome start p99 | 1.5 × width-1 + 5 ms |
| Trigger → Chrome start max | 2 × width-1 + 15 ms |
| Spread p95 | 2 × width-1 + 5 ms |
| Spread p99 | 2 × width-1 + 8 ms |

The width must also pass the safety and readiness gates:

- every offline attempt settled REJECTED;
- no Chrome request before its trigger;
- every child's Chrome start recorded;
- every child prepared at least 1 s before its trigger.

There are no absolute "winning" milliseconds. The operator can override up to the authoritative `PRECISION_MAX_FAN_OUT` limit (currently six) per worker/browser group; the UI labels this an operator override.

## Results on this PC (2026-09-29, i5-13500HX, 20 threads, Chrome 154, headless, burst)

Trigger → Chrome request start in ms (p50 / p95 / p99 / max), and first-to-last spread p95 / p99:

| Dispatcher | 7×1 (7) | 7×2 (14) | 7×3 (21) | 7×4 (28) |
|---|---|---|---|---|
| Central, run 1 | 4.8 / 6.4 / 7.3 / 8.1 · 2.9 / 3.0 | 7.2 / 9.9 / 12.6 / 15.1 · 5.7 / 6.6 | 9.4 / 13.3 / 15.2 / 16.7 · 8.1 / 9.1 | 11.8 / 16.0 / 17.2 / 18.5 · 9.2 / 9.7 |
| Central, run 2 | 4.8 / 6.5 / 7.1 / 8.1 · 2.5 / 2.6 | 7.3 / 9.8 / 10.6 / 11.3 · 5.4 / 5.4 | 9.7 / 13.7 / 24.0 / 25.6 · 7.9 / 8.2 | 11.4 / 15.9 / 17.7 / 19.1 · 9.7 / 11.0 |
| Per-browser coordinator, run 1 | 3.3 / 4.2 / 5.1 / 6.6 · 1.9 / 2.7 | 4.0 / 5.5 / 6.3 / 6.9 · 3.1 / 3.5 | 5.4 / 8.1 / **31.0 / 60.5** · 6.8 / **54.9** | 6.6 / 10.2 / 14.2 / 22.1 · 9.5 / 18.4 |
| Per-browser coordinator, run 2 | 3.3 / 4.1 / 4.3 / 5.1 · 1.9 / 1.9 | 4.2 / 5.7 / 6.1 / 6.6 · 3.0 / 3.0 | 4.9 / 7.1 / 9.9 / 13.0 · 4.7 / 8.7 | 6.4 / 11.4 / **38.6 / 107.9** · 16.2 / **100.8** |
| Renderer-resident, run 1 | 1.9 / 3.0 / 3.2 / 3.7 · 1.6 / 2.0 | 3.1 / 5.3 / 7.3 / 9.9 · 5.2 / 6.9 | 3.0 / 5.9 / 7.1 / 8.6 · 5.6 / 6.8 | 3.8 / 10.8 / 11.8 / 12.8 · 9.9 / 10.6 |
| Renderer-resident, run 2 | 2.4 / 2.9 / 3.6 / 3.7 · 1.1 / 1.5 | 2.6 / 4.6 / 5.8 / 6.6 · 4.0 / 4.5 | 2.8 / 5.6 / 6.3 / 7.4 · 5.5 / 5.5 | 4.3 / 11.0 / 12.3 / 13.4 · 10.2 / 10.7 |

Central and coordinator runs 1 and 2 used 40 and 30 runs per width respectively; the renderer runs used 30. Every run came after two warm-up runs.

**Machine recommendation: 2 attempts per target.**

- 14-way fan-out stays inside the gates: Chrome-start p95 9.9 ms against 6.4 ms at width 1.
- 21-way fan-out exceeds the p50 and p95 gates: p95 13.3 ms against a 12.6 ms limit.

The central dispatcher's delay grows linearly with each attempt's position in the single synchronous fire pass: per-worker p95 at 7×4 runs from A 9.9 ms to G 17.4 ms. Most of that delay is between the transport call and the renderer's fetch(). This is Node-side serialization of CDP commands.

### Release Precision V3 re-runs (2026-09-30, central dispatcher, 7 workers, 40 runs per width)

| Build | 7×1 Chrome p50 / p95 / p99 / max | 7×2 Chrome p50 / p95 / p99 / max | 7×2 spread p95 |
|---|---|---|---|
| 2026-09-29 baseline above (f16f80b, dirty) | 4.84 / 6.40 / 7.27 / 8.06 | 7.21 / 9.92 / 12.62 / 15.08 | 5.69 |
| 692fc8f + V3 work in progress | 6.06 / 8.10 / 8.86 / 9.53 | 8.92 / 13.12 / 14.96 / 17.21 | 6.24 |
| 9534d4f (V3 controls) | 5.73 / 9.22 / 10.95 / 11.94 | 8.87 / 14.49 / 19.59 / 22.15 | 6.37 |
| 29d6aab (V3 + worker probes) | 6.48 / 10.30 / 11.69 / 12.74 | 8.70 / 14.11 / 16.39 / 17.24 | 6.12 |

These are **not** an apples-to-apples before/after. The three 09-30 runs came a day later under different machine load, and none is slower or faster in a way that can be attributed to V3. | 29d6aab with `--lockdown`, 16 min after the row above | 5.77 / 9.32 / 12.31 / 14.11 | 8.82 / 13.77 / 15.67 / 17.95 | 5.94 |

The first four rows used the default harness. The last row used `--lockdown`, which adds final-second HIGH priority plus the Lockdown lifecycle; an earlier attempt at it exited during Chrome startup. Compared with the run 16 minutes before it on the same build, Lockdown is within noise: p50/p95 are slightly lower, and p99/max slightly higher at width 1. The harness has no deferrable runner work to remove, so this measures only the priority and lifecycle cost. It shows that cost does no harm; it does not show a gain. The recommendation remained **2 per target** in every run.

Splitting each child's lag shows where the per-worker slope comes from (29d6aab run, p50 in ms):

| Worker | A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|---|
| 7×1 scheduler → worker invoked | 0.02 | 0.73 | 1.13 | 1.54 | 1.91 | 2.29 | 2.66 |
| 7×1 worker invoked → Chrome start | 5.36 | 5.19 | 4.98 | 5.07 | 5.34 | 5.38 | 5.09 |
| 7×2 scheduler → worker invoked | 0.06 | 1.08 | 1.52 | 1.95 | 2.45 | 2.83 | 3.31 |
| 7×2 worker invoked → Chrome start | 6.35 | 6.28 | 6.31 | 6.44 | 6.55 | 6.69 | 6.71 |

The whole A→G slope is queue position in the single synchronous fire pass. Each worker's own invoke → Chrome time is flat. Retiming one worker cannot remove serialization: moving G earlier only makes it fire alone, and the next calibration would undo the move. Release Precision V3 de-skew therefore learns only from invoke → Chrome time, and on this machine it should stay near zero unless a live release shows a genuinely slow browser.

### Per-browser coordinator: not promoted

One Node process per browser removes most of that serialization. Its median and p95 are 30–45 % lower at every width.

Both coordinator runs, however, produced large **tail outliers** at a wide width:

- 7×3: p99 31 ms, max 60 ms;
- 7×4: p99 39 ms, max 108 ms, with spread p99 up to 101 ms.

The central dispatcher's worst case in the same conditions was 25.6 ms. With 7 extra Node processes all spinning in the last 50 ms, one process descheduled at the trigger delays its whole browser.

Median improvements do not justify promotion. The production path stays **central**. The coordinator remains behind `ONDA_EXPERIMENTAL_DISPATCH_COORDINATOR=PER_BROWSER_V1` (and `--dispatcher coordinator`) for further study.

Its safety semantics are tested with a stand-in coordinator process:

- the parent consumes its own permit before delegating;
- only a coordinator report can prove an attempt unsent;
- a coordinator that dies leaves every delegated attempt UNKNOWN.

### Renderer-resident dispatch: fastest offline, still not enabled

This path already existed behind `ONDA_EXPERIMENTAL_RENDERER_DISPATCH=RENDERER_RESIDENT_V1` (see `SERVER_ARBITRATION_INVESTIGATION.md` §10). Node sends the pre-serialized request to each tab 40 ms ahead, and the page calls `fetch()` itself, never before the lower bound of its calibrated clock. `SERVER_ARBITRATION_INVESTIGATION.md` §13 rank 8 asked for a benchmark on the release PC; these runs are that benchmark.

- In both runs it was the fastest dispatcher at every width, with no tail outliers. Its worst case at 7×3 and 7×4 was 8.6 and 13.4 ms, against 16.7–25.6 ms for central and 60–108 ms for the coordinator.
- The recommendation logic gives it **3 per target** on this machine in both runs. 7×4 fails the p95, p99 and spread p95 gates.
- All 4,200 offline attempts (2,100 per run) settled REJECTED. None reached Chrome before its trigger; the earliest Chrome start was 1.2 ms after it.

It remains **off**, and the production path stays central, for three reasons:

- It has never run in a live release (every live run so far logged `dispatchMode: node`).
- Its correctness depends on a per-page clock calibration that only production conditions exercise. That includes the 09-29 case where the PC clock was 750 ms fast.
- The gain is a few milliseconds. The provider's wait for release-time checkouts was about 30 s (§13).

Enabling it is a separate, supervised operator decision. A profile saved from a renderer run is not used by the app, because the app only reads profiles measured with the production dispatcher.

### The 2026-09-29 compression was not reproduced offline

On 09-29 the index-0 children, configured at −35 ms, reached Chrome at about −4 ms. Later children collapsed to +9…+12 ms regardless of their configured offsets.

Offline, with the same offsets (−35, −30, −25, −10) at 7×4, the children kept their spacing: Chrome-start error p95 7.4 ms, spread about 29 ms, and index 0 at about −30 ms. The same held with each of these added:

| Variant | Index-0 Chrome start (p50) | Error p95 |
|---|---|---|
| 50 % busy page main threads (`--page-busy 5`) | −28 ms | 12 ms |
| Headed Chrome with background tabs (`--headed`) | −30 ms | 8.5 ms |
| Passive provider traces on every tab (`--traces`) | −30 ms | 7.6 ms |

So the local Node/Playwright/CDP/Chrome path is not what compressed 09-29. The remaining suspects are production-only:

- the real Onda page with its security widgets;
- the desktop app's concurrent work;
- the mapping of CDP wall stamps to the trusted clock while the PC clock was 750 ms fast.

Before this release, Fixed fan-out split each child's marks and transport observations across two critical-path rows. That is now fixed: every child is one row with its configured offset. The next live release will show where the time goes, in History & Insights → Offset calibration.

### Prewarm policy

The synthetic preparation (400 ms of page CPU plus 2 s of waiting) does not reproduce production contention: 28 genuine preparations took 7.6–11.8 s on 09-29. It verifies the mechanics and the cost of the tiered policy:

- **all at once**: 28 parallel preparations, last child ready 9.6 s before the trigger;
- **tiered** (7 at a time, one per browser, tier barrier): four sequential tiers, last child ready 2.3 s before the trigger at a 12 s lead.

The tiered policy gives Tier 1 the full machine and omits late lower-tier children. The runner sizes the lead from the exact authorized task topology and the measured compatible production p95. The pre-arm feasibility forecast and production executor share the scheduling decision core, including tier ordering, group/global concurrency and barriers; the forecast substitutes the p95 for each task while production uses observed completions.

## Timing presets derived from the profile

Tight, Balanced and Wide spacing come from the loaded trigger→Chrome jitter (p95 − p50), the per-child-index step and a quarter of the spread p95. Spacing is never below the machine's minimum meaningful spacing. Every child shows its configured offset and a predicted local Chrome start range. Neither is a network arrival time.
