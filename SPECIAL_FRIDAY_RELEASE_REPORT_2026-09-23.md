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
- Vitest: 67 files and 798 tests passed.
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
- Configured target: 2026-09-25 at 08:00 Asia/Manila, API-first, five courts, workers A-F required by the currently saved plan.

The existing automation lock was deliberately preserved. No Reset & Prepare, slot selection, Terms/payment authorization, hold creation, lock clearing, or live submission was performed during this verification.

Before the release, the active lock must be authoritatively reconciled and the normal panel **Reset & Prepare** flow must establish the dedicated Chrome/CDP session, exact Onda tab, correct venue, clean schedule, and required browsers. Then rerun the installation readiness command. Do not treat the source/test/build pass by itself as approval to arm the release.

## Publication boundary

The Git publication includes source, tests, documentation, plans/reports, and required generated `dist` artifacts. It intentionally excludes ignored private runtime state, including `.env.local`, `config.local.json`, `.local/`, `DiagnosticsLocal/`, Chrome profiles, cookies, lock/journal payloads, and unsanitized logs.
