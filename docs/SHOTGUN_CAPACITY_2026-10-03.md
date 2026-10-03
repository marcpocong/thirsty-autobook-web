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

## Unified Strategy integration

Shotgun is now a release intensity inside the Smart Strategy Engine, not a separate Fixed Precision path. The operator selects stable logical targets, a total budget, Equal / Priority weighted / Custom allocation, and a signed release-relative window. The compiler creates one aggregate deterministic schedule, distributes its positions fairly across selected targets, and splits any target above six attempts into worker groups capped by `PRECISION_MAX_FAN_OUT`. Unselected immediate targets remain normal Wave 1; the same saved `PRECISION_PHASE3` remains the authorization authority.

The 105 ms result above is the installation's minimum Shotgun planning floor. A fresh compatible machine profile may raise that floor, but a burst profile cannot lower it. The UI reports the resulting spacing and recommended maximum; tighter plans require an explicit capacity override. This is local scheduling evidence only, not evidence of provider acceptance or queue order.

Implementation validation on October 3 used a separate four-worker intercepted run across widths 1–6. With 105 ms spacing, per-trigger Chrome-start p95 was 3.61–5.62 ms; the old burst-spread recommendation formula correctly remains unsuitable for deliberately spaced schedules. A two-iteration burst comparison recommended width five under the existing local gates and rejected width six (24 simultaneous children) at p95 14.55 ms. These low-sample validation runs did not replace the saved authoritative profile and do not establish a booking advantage.
