# Phase 7.2: one-button readiness

Initial HEAD: `2ba961dd6c4e248096dc74ec38c540541174df1d` (`Recover clean sessions after uncertain final dispatch`), `main`, clean. The implementation preserved the existing booking planner, Standard/Extended checkout architecture, release engine, player routing, and manual-payment boundary.

## Normal workflow

The normal Test Now path is Configure → Reset & Prepare → Authorize Terms → Run Test to QR. The normal Release Booking path is Configure → Reset & Prepare → Authorize Terms → Arm Release. Reset & Prepare remains available when browsers are absent, settings changed, or retained state needs safe inspection. Start Chrome, Inspect Onda, Save, lock review, Selection Only, and legacy dual-browser controls remain under Advanced / Diagnostics and are not prerequisites for either primary path.

Primary Run Test to QR and Arm Release actions always launch the existing full visible Onda flow to temporary QR hold(s). They do not depend on the historical `mode` value. Payment remains manual.

## Independent drafts

The renderer maintains separate in-memory Test and Release drafts. Each keeps its own strategy, court count, start, duration, maximum, court priority, and workflow-specific fields. Switching workflows captures the current draft and restores the other. A status refresh can update the saved Release draft but does not replace the active Test fields. Test preparation uses a runtime configuration derived from the Test request plus environment/player settings and does not parse or apply `config.local.json`.

Release Reset & Prepare validates the current Release draft, writes it atomically, re-reads it, verifies the saved fingerprint, and then prepares that exact plan. A separate Save button is retained only as an Advanced Release convenience.

## PreparedContext and PreparationResult

The preparation worker emits a validated, sanitized `PreparationResult` containing workflow, strategy, request fingerprint, and per-browser evidence: browser ID, dedicated-profile verification, Onda verification, prepared date, strict-grid verification, zero selected cells, and no detected hold. Test preparation additionally performs read-only Standard or Extended plan resolution, including exact-court enforcement. Release preparation records the existing same-day release target and epoch without opening or selecting the future target grid.

The controller creates `PreparedContext` only after the structured result matches the exact pending fingerprint and required browser set. Test execution and Release arming both enforce the matching context in the main process, perform strategy-aware A/B health checks, and reject with `RESET_REQUIRED` before confirmation or worker launch when it is absent or stale. Terms authorization uses the same gate.

Prepared readiness has no arbitrary 60-second timeout. It is invalidated by settings/workflow changes, required-browser loss, an unexpected idle lock, saved Release fingerprint changes, or an invalid Release window.

## Browser and player readiness

Browser count is strategy-based: Standard 1/2 courts uses A; Extended 1/2 courts uses A+B. All required browsers are started before either is inspected. Both are inspected before any normalization decision, then both are normalized only when the combined assessment is safe. Per-browser health covers ports 9222 and 9223; Extended cannot remain ready with B disconnected.

Only player configuration booleans cross the renderer boundary. Standard A and Extended A use Primary; Extended B uses Player B, with no fallback. Test readiness uses a narrow PII-free status loader and is independent of saved Release-plan validity.

## Hold and lifecycle safety

`HoldState` is Active, Expired, Not detected, or Unknown, with a sanitized countdown-seconds value when available. Countdown parsing is scoped to the unique visible component containing `Slot reserved for`; arbitrary MM:SS text is ignored. Positive values are active. `00:00` requires a bounded stable second read. Missing or ambiguous association fails closed.

Lifecycle writes now atomically persist `stageAt`. Verified handoffs additionally persist `holdVerifiedAt` and calculated `holdExpiresAt`, without QR content, URLs, cookies, or personal data. A recorded hold is recoverable only from explicit stable expiry, or after recorded expiry plus a current conclusive no-hold state. A `FINAL_ACTION_DISPATCHING` record is not cleared merely because the browser was manually returned to a clean Schedule. Legacy records without timestamps fail closed.

Preparation-owned `automation.lock` and `.local/preparation.lock` records have symmetric ownership-checked cleanup on success and every failure path. Replacements are retained and reported as `LOCK_REPLACED`. Pre-existing booking evidence is removed only after conclusive safe recovery. Advanced clear/reset paths cannot bypass recorded hold/final-dispatch protections.

## Side-effect boundary

Reset & Prepare starts/reuses browsers, reads state/countdowns, navigates only after a combined safe decision, verifies calendars/grids, and resolves availability without clicking reservation slots. It does not click Proceed, fill player fields, accept Terms, dispatch the final Onda action, inspect QR payloads, or interact with payment controls.

## Tests and validation

Phase 7.2 regressions cover strategy routing for all court counts, structured fingerprints, Browser B disconnection, controller enforcement, Release auto-save/re-read, legacy-mode independence, settings invalidation, 61-second stability, stable/ambiguous countdowns, recorded expiry rules, stage timestamps, temporary-lock cleanup, command serialization, and renderer draft isolation. Existing Standard and Extended booking, checkout, release, safety, and payment-boundary regressions remain in the serial suite.

Validation results:

- Focused Phase 7.2 and renderer suites: passed.
- Typecheck: passed.
- Full serial suite: 505 tests passed across 28 files.
- UI build: passed.
- Windows EXE build: passed; `Thirsty Bot.exe` rebuilt.
- Diff whitespace check: passed.
- Renderer visual QA: passed at 1010×800 using the real built renderer harness. Native Windows app control was unavailable in this session.
- Privacy check: all six configured player fields were compared privately against the diff; zero matches.

Both dedicated browser endpoints were offline during final verification, so no live Reset & Prepare navigation was run. No live reservation hold, release arm, or payment action was performed during implementation. The delivery commit and push are recorded in the final handoff.
