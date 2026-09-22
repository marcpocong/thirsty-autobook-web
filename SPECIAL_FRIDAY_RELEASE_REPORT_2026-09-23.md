# Special Friday Release Verification — 2026-09-23

This report records the reviewable verification state for the A-H special Friday implementation. It contains no credentials, customer identifiers, cookies, browser profiles, durable submission journals, active-lock contents, or raw local diagnostics.

## Implemented release shape

- A-D remain the core proof-based lane and dispatch as soon as their two distinct courts are known.
- E/F run as an independent adaptive lane: fresh proof-based availability wins when available; otherwise the existing proofless release-boundary attempt remains eligible. The two paths share a fail-closed one-way gate and cannot both dispatch.
- G/H run as an independent proof-based-only bonus lane on a fourth distinct court. They do not delay A-D and never use the proofless fallback.
- Browser-security preparation is scoped per lane, concurrent automation-lock writes are serialized, every worker outcome is settled, and the final lock expiry reflects the latest verified hold across all lanes.
- Unknown or possibly dispatched outcomes retain the lock and are not automatically retried. QR/payment completion remains manual.

See `README.md` and `REVIEW_GUIDE.md` for the detailed allocation, timing, retry, and safety boundaries.

## Offline verification

The following checks completed successfully against the publication candidate without selecting slots, creating holds, arming a run, or interacting with payment:

- TypeScript typecheck: passed.
- Vitest: 69 files and 805 tests passed.
- Renderer build (`npm run ui:build`): passed.
- Windows application build/install refresh (`npm run exe:build`): passed.
- Critical generated/installed artifacts were hash-compared after the refresh and matched their source build counterparts.

The orchestration code in `desktop-runner.ts` still has a higher residual risk than the extracted/tested helpers because its complete multi-browser timing is not simulated end to end. The adaptive-lane gate, special-session planning, lock outcome rules, lock-write serialization, browser-security prewarm behavior, and UI status behavior have direct offline coverage. The full eight-worker combination is not live-proven.

## Operational preflight result

The installed read-only readiness command was run on 2026-09-23 with the installation flag. It exited successfully as a diagnostic command but reported that the installation was **not operationally ready**:

- CDP: `BLOCKED` (`CDP_NOT_LISTENING`).
- Dedicated profile, exact tab, and venue: `NOT VERIFIED`.
- Schedule: `NOT CLEAN`; selected slots and payment hold: `UNKNOWN`.
- Automation lock: `ACTIVE`.
- Player configuration: `CONFIGURED`.
- Booking plan: `VALID`.
- API customer bindings: `VERIFIED`.
- Configured target: 2026-09-25 at 08:00 Asia/Manila, API-first, normal Extended four-court mode, workers A-D required by the currently saved plan. Special Friday A-H was not selected in the saved runtime plan.
- Windows Time service: stopped; the clock must be synchronized before arming.

The existing automation lock was deliberately preserved. No Reset & Prepare, slot selection, Terms/payment authorization, hold creation, lock clearing, or live submission was performed during this verification.

After publication, an eight-browser preparation exposed a slow first-render edge case: an empty Onda grid was incorrectly surfaced as `INVALID_TARGET_DATE`, and a ten-second Playwright deadline could expire before a newly launched Chrome finished rendering. The preparation path now waits up to 30 seconds for each initial Onda render, retries incomplete grid snapshots, reports a persistent incomplete render as `STALE_OR_INCOMPLETE_GRID`, and includes the exact browser ID in inspection/normalization failures. Three regression tests cover the corrected classification and browser-specific errors.

The current publication also adds browser-specific **Show Browser X** controls to verified QR cards, records sanitized preparation and security-prewarm outcomes for each worker, and moves core/direct security prewarming to 15 seconds before release. The timing change is a projected improvement only; it has not been measured at a real 08:00 Special Friday boundary.

Before the release, the active lock must be authoritatively reconciled and the normal panel **Reset & Prepare** flow must establish the dedicated Chrome/CDP session, exact Onda tab, correct venue, clean schedule, and required browsers. Then rerun the installation readiness command. Do not treat the source/test/build pass by itself as approval to arm the release.

## Publication boundary

The Git publication includes source, tests, documentation, plans/reports, and required generated `dist` artifacts. It intentionally excludes ignored private runtime state, including `.env.local`, `config.local.json`, `.local/`, `DiagnosticsLocal/`, Chrome profiles, cookies, lock/journal payloads, and unsanitized logs.
