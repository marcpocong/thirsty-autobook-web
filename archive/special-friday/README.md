# Special Friday session (archived)

**Status:** retired on 2026-09-23. This was a one-off, release-only experiment for the Friday 2026-09-25 target. It is no longer part of the app, the saved-plan schema, or the booking runner.

## What it was

A fixed A–H session: up to eight temporary QR holds across four distinct courts on a Friday evening.

| Lane | Workers | Preferred court | Hours | Method |
|---|---|---|---|---|
| Core early | A/B | 6 | 17:00–22:00 | Proof-based |
| Core late | C/D | 7 | 19:00–23:00 | Proof-based |
| Adaptive | E/F | 5 | 17:00–22:00 | Proof-based on early availability, otherwise a proofless request exactly at 08:00 |
| Bonus | G/H | 4 | 17:00–22:00 | Proof-based only, skipped without a fourth distinct court |

The 2026-09-23 release run failed with `SPECIAL_SESSION_NOT_AVAILABLE`: 21 Friday-evening slots were unavailable, with no booking record, from the moment the date opened. See [`RELEASE_RUN_REPORT_2026-09-23.md`](../../RELEASE_RUN_REPORT_2026-09-23.md) in the repository root and [`docs/SPECIAL_FRIDAY_RELEASE_REPORT_2026-09-23.md`](docs/SPECIAL_FRIDAY_RELEASE_REPORT_2026-09-23.md).

## What is kept here

- `src/api-booking/special-session.ts` — A–H court assignment and lane plans.
- `src/api-booking/adaptive-direct-lane.ts` — the E/F one-way proof/proofless gate.
- `src/api-booking/special-direct-lane.ts` — E/F court choice and fixed-block plans, split out of the former `special-direct-checkout.ts` (the shared proofless helpers remain in `src/api-booking/proofless-checkout.ts`).
- `tests/` — the tests for the above and for the Special Friday UI/config behaviour.
- `docs/` — the Special Friday release report.

These files sit outside the TypeScript (`tsconfig.json`) and Vitest (`tests/**`) scopes, so they are neither compiled nor run. Their relative imports point at the layout they were written for, so they will not build from this folder as-is.

## Getting the full integrated version back

The runner lanes (early-availability watcher, E/F adaptive dispatch, G/H bonus lane, safe retries) were woven through `src/api-booking/desktop-runner.ts`, the controller and the renderer. The last commit containing the complete working session is **`6f891c4`**, also tagged **`archive/special-friday-session`**:

```powershell
git show archive/special-friday-session:src/api-booking/desktop-runner.ts
git switch -c special-friday-restore archive/special-friday-session
```

What replaced it for normal releases: the **release slot watch** (`src/slot-watch.ts`) now records the exact court/hour state and timing around every release, which was the useful observation part of this experiment.
