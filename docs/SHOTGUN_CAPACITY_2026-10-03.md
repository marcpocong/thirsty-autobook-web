# Offline shotgun capacity check — October 3, 2026

This installation was benchmarked with seven local Chrome workers and widths 1–6. Every checkout was intercepted locally and answered with a synthetic 409; none went to Onda. Results measure local trigger-to-Chrome timing, not provider arrival or booking advantage. The raw and machine-profile JSON stays in `.local/fanout-capacity/` outside Git.

| Children per target | Immediate sends, 7 workers | Burst trigger→Chrome p95 | Burst spread p95 | 105 ms-spaced trigger→Chrome p95 |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 7 | 6.28 ms | 2.78 ms | 6.67 ms |
| 2 | 14 | 11.15 ms | 7.35 ms | 7.92 ms |
| 3 | 21 | 26.24 ms | 13.98 ms | 6.95 ms |
| 4 | 28 | 17.92 ms | 10.96 ms | 6.40 ms |
| 5 | 35 | 21.18 ms | 11.53 ms | 6.88 ms |
| 6 | 42 | 22.34 ms | 13.06 ms | 6.68 ms |

The burst run used eight measured iterations per width and recommended **two children per target** under the existing local regression gates. The 105 ms-spaced run used five measured iterations per width; its reported recommendation of one is an artifact of applying a burst-spread gate to deliberately spaced triggers, so it is not used as the recommendation. Widths 3–6 remain operator-selectable overrides; the UI must show that they exceed the compatible burst recommendation and show their actual timing/readiness limits. A five-child, four-target plan sends 20 immediate attempts; with the existing three Wave 2 and three Rescue allowances its ceiling is 26. These offline runs do not establish that 20 requests are accepted, useful, or safe to arm at a live release.

The preparation lead now scales by tier and measured preparation p95, with a conservative 12-second round used when no compatible history exists. It is capped at 105 seconds before release, leaving 15 seconds under the 120-second prepared-context freshness bound at the release instant. A child not ready by its trigger remains unsent with a specific reason; the scheduler does not delay ready children.

The October 3 topology is retained as a structural regression fixture: four parent targets, two children each, primaries preserved, six projected ready and two projected lower-tier omissions under matching constrained assumptions. This demonstrates that the model can expose the same class of capacity failure before dispatch; it does not claim the historical run was predictably identical without the exact compatible preparation history available at that time.

## Unified Strategy integration

Shotgun is now a release intensity inside the Smart Strategy Engine, not a separate Fixed Precision path. The operator selects stable logical targets, a total budget, Equal / Priority weighted / Custom allocation, and a signed release-relative window. The compiler creates one aggregate deterministic schedule, distributes its positions fairly across selected targets, and splits any target above six attempts into worker groups capped by `PRECISION_MAX_FAN_OUT`. Unselected immediate targets remain normal Wave 1; the same saved `PRECISION_PHASE3` remains the authorization authority.

The 105 ms result above is **machine-capacity evidence**, not a competitive timing floor. Dense Core may deliberately request tighter spacing; the UI warns and requires the existing explicit timing-capacity override, but it never widens or rewrites the exact authorized offsets. This is local scheduling evidence only, not evidence of provider acceptance, receipt order or queue order.

## Experimental Dense Core

Shotgun is now pre-release-only: every configured offset must be a whole millisecond from `-2000` through `0`, and a positive value is rejected rather than clamped. Normal non-Shotgun timing remains unchanged.

The initial 20-shot experiment is exactly:

```text
-1000, -700, -500, -300, -250, -200, -175, -150, -125, -100,
-80, -60, -45, -30, -20, -10, -5, -2, -1, 0
```

Reduced budgets deterministically sample the same early-to-near-zero shape while retaining `0`; larger budgets keep all 20 positions and add unique positions inside the final 250 ms. A 20-shot single target remains four worker groups of `6 / 6 / 6 / 2`. The schedule is deterministic, visible before Save/Arm and copied literally into `STRATEGY_V2.shotgun.exactSchedule` and `PRECISION_PHASE3`.

This is a release hypothesis, not a proven advantage. October 3 showed independent local child dispatch and roughly 14–18 second 409 responses, so the runtime remains trigger-driven and does not wait for an earlier response before a later trigger. The evidence does **not** reveal provider receipt order, arbitration, independent server treatment, or whether Dense Core improves booking probability.

Implementation validation on October 3 used a separate four-worker intercepted run across widths 1–6. With 105 ms spacing, per-trigger Chrome-start p95 was 3.61–5.62 ms; the old burst-spread recommendation formula correctly remains unsuitable for deliberately spaced schedules. A two-iteration burst comparison recommended width five under the existing local gates and rejected width six (24 simultaneous children) at p95 14.55 ms. These low-sample validation runs did not replace the saved authoritative profile and do not establish a booking advantage.
