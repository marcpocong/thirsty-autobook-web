# API-to-normal-browser handoff investigation

Scope: source and existing-evidence audit only. No booking, hold, checkout submission, payment, release test, or production booking-code change was performed.

## Answers first

1. **Is the proposed architecture feasible?** Partly. Source code and the offline release simulation show that API discovery can identify a candidate before the browser grid is ready, and the existing normal browser flow can remain responsible for Review Booking, Player Information, Payment Summary, Terms, final confirmation, and QRPH handoff. The repository does not yet establish a safe way to inject an unreserved API selection into Oonda's normal UI.

2. **Can the visual calendar be completely skipped?** Not with the evidence available. The normal browser still has to expose the target date and reach a selectable schedule. The full 112-cell wait may be reducible, but only if the target cells become independently actionable before the complete grid; that has not been observed.

3. **What causes the current unnecessary wait?** After the target date is clicked, `src/release-navigation.ts:123-141` calls `waitForGrid()`. `src/grid.ts:63-70` waits for the correct heading, no `aria-busy`, all 16 rows for the target date, and seven cells in every row. `src/release.ts:93-97` then validates all 112 cells before returning to selection. The hybrid API request is fire-and-forget and is not awaited.

4. **Does Oonda accept a selection initialized without calendar-cell clicks?** **DIRECT NORMAL-UI SELECTION HANDOFF: NOT ESTABLISHED.** Existing evidence shows the normal URL remains unchanged through date navigation, Review Booking, and Payment Summary; no supported selection deep link or initialization interface is recorded. `src/api-booking/checkout-restoration.ts` only models validation of an already-created booking and is explicitly disabled; its URL builder is not evidence that Oonda supports unreserved selection initialization.

5. **Smallest evidence-based change worth making:** investigate Option B only: pass the API-ranked preference into a target-specific normal-UI readiness/selection boundary. That boundary must verify the venue, enabled target date, exact target date/court/hour identity, available and actionable state for both hours, no loading transition, no foreign selections, and the exact selection summary before using the existing normal checkout chain. Keep the current full-grid path as the fallback until progressive actionability is proven.

6. **What remains unknown?** Whether Oonda makes an individual target cell actionable before all 112 cells are rendered, whether target-specific reads are stable during release contention, and whether Oonda exposes any supported unreserved selection initializer outside the observed UI.

## Confirmed from source code

### Current hybrid call chain

- `src/release.ts:28-29` constructs `AvailabilityDiscovery` for hybrid mode.
- `src/release.ts:63` starts the API request after the release trigger without awaiting it.
- `src/availability-discovery.ts:88-105` parses the response and computes early API candidates when the request completes.
- `src/release.ts:66-92` still performs the preopened-date check or bounded reload, then shell verification and target-date navigation.
- `src/release-navigation.ts:60-86` verifies URL, venue, date-picker presence/visibility/enabled state, and page security. It does not require the schedule grid.
- `src/release-navigation.ts:143-160` refuses a disabled target date and only proceeds after the date is enabled.
- `src/release-navigation.ts:123-141` clicks the date, waits for the target heading, then waits for `waitForGrid()`.
- `src/grid.ts:50-57` requires the target heading/date, 16 distinct hours, 112 cells, seven courts, and known cell states. `src/grid.ts:59-61` resolves the API/UI candidate only after that validated snapshot exists.
- `src/index.ts:134-149` passes the returned grid and preferences to `selectResolvedPreference()`; `src/selection.ts:98-142` validates the full initial snapshot, clicks only the chosen cells, performs a full post-click snapshot, and verifies the selection summary.

Therefore the exact current hybrid bottleneck is the bot's post-date `waitForGrid()` plus full-snapshot barrier. The API candidate can exist first, but it cannot enter the current selection function until that barrier completes.

### Normal checkout remains browser-controlled

`src/booking-checkout.ts:12-24` revalidates the selected cells and summary, then uses `checkout()` and `ondaCheckoutAdapter()`. `src/checkout.ts:27-54` preserves the normal sequence: Review Booking, Player Information, Payment Summary, Terms authorization, and the one-way final action. `src/onda-checkout.ts:151-195` uses Oonda's observed DOM controls and its `Confirm & Proceed to Payment` action. A target-specific selection path could feed this same chain without independent API checkout.

### Release-date boundary is separate

`src/release-navigation.ts:89-120` observes a preopened target without clicking it. If the target is disabled, `src/release.ts:72-92` falls back to the bounded reload path. `navigateReleasedTargetDate()` returns `TARGET_DATE_NOT_RELEASED` for a disabled date and never force-clicks it. API availability cannot bypass this normal-browser release-date boundary.

## Confirmed from existing repository/offline evidence

- `API_8AM_BOTTLENECK_REPORT.md` records API candidates becoming ready before `targetGridReady` in a simulated release, while hybrid did not resolve or select until the grid was released.
- The same report records, from prior release-boundary investigation, that the normal UI's visible booking horizon can remain memoized; ordinary schedule refresh does not reliably enable a newly released date. A reload may therefore remain necessary even if API discovery is already complete.
- `src/api-booking/README.md` explicitly recommends API availability/planning followed by normal browser confirmation, while noting that passing its `BookingPlan` into the Chrome selector is not an established interface.

## Confirmed from existing live evidence

- `VERIFIED_ONDA.md` records a real date transition where the heading changed, stale rows disappeared, `aria-busy` was observed, and new target-date rows appeared later. This supports waiting for a coherent date transition, but does not prove that every target cell must wait for all 112 cells.
- `VERIFIED_ONDA.md` records normal UI progression through Review Booking, Player Information, Payment Summary, and the site's final action/QRPH boundary. It also records that the URL did not expose a discovered date or Review Booking deep link and that the opaque checkout path was not recorded.

## Reasonable hypothesis

Option B may reduce the delay if Oonda progressively renders actionable cells. For a one-court, two-hour candidate, a safe target-specific observer would need to wait for both exact row/cell controls and verify:

- verified Oonda venue, URL, visible browser, and clean selection state;
- target heading and both row `data-schedule-grid-row-date` values equal the requested ISO date;
- exact court label, start hour, end hour, `available` state, enabled button, and no `aria-disabled` state;
- no contradictory `aria-busy`, stale-date, challenge, redirect, or disconnected-page signal;
- after each click, the exact cell changes to `selected`;
- before Proceed, no unowned selected cells exist and the summary is exactly `1 Court • 2 Slots`, the expected amount, and actionable.

The current source and fixtures do not show progressive live actionability. The synthetic schedule renders the complete fixture grid in one `render()` call, and the live evidence only captures a transition between stale and new schedules. If target cells become actionable only with the complete schedule, Option B provides little or no speed benefit.

## Three design options

| Option | Current status and evidence | Avoids full grid? | Normal Oonda final action | Smallest change / blocker |
|---|---|---:|---|---|
| **A — Current hybrid** | Implemented. API discovery runs early, then intersects with the validated UI snapshot. | No | Yes | No change. It remains conservative and retains the full-grid bottleneck. |
| **B — Target-specific normal UI** | Architecture is plausible; target-cell actionability and timing are unverified. | Maybe; only if target cells precede full-grid readiness. | Yes, through existing `checkout()` and `ondaCheckoutAdapter()`. | Add a target-specific readiness/read/selection boundary and API-plan input, preserving full-grid fallback. Main blocker is the unobserved rendering dependency. |
| **C — Supported direct UI initialization** | Not established. No documented URL, public booking-link format, or supported unreserved-selection initializer is present in repository evidence. | Potentially | Could, if Oonda supplied it | Do not implement or invent one. Blocked on concrete Oonda support/documentation. |

## Proposed implementation plan — Option B only

1. Keep release-date enablement, reload fallback, venue/security guards, locks, and the current browser/hybrid path unchanged.
2. Add a target-specific readiness result that accepts the API plan but proves the exact date/court/hours in the normal DOM before any cell click.
3. Add a target-specific selection adapter that verifies each exact cell transition and the final selection summary. It must fail closed on stale dates, loading, unknown state, foreign selections, or any mismatch.
4. Reuse the existing `proceedWithVerifiedSelection()` and normal Oonda checkout adapter after selection. Keep the full-grid selector as the fallback until a supervised comparison proves the target path is equivalent and faster.

This is a proposal only; no implementation was made in this investigation.

## One test needed to settle the main uncertainty

Perform one minimal read-only observation on an already-released date in the existing verified Oonda Chrome session, with a clean schedule and no selected cells or hold. Use an API-ranked one-court/two-hour candidate only as the observation target. Install a temporary DOM observer before date navigation and record timestamps for:

1. target heading/date becoming correct;
2. both exact target cells becoming visible, enabled, non-busy, and `available`;
3. the full 16-row/112-cell predicate becoming true.

Do not click a slot, Proceed, Terms, final confirmation, or payment. If (2) precedes (3), Option B has a measurable opportunity; if they coincide, retain Option A. This test requires separate authorization for a live read-only DOM observation in the verified session; it was not run here.

## Not established

- A direct API-selected unreserved selection handoff into Review Booking or Payment Summary.
- Target-cell actionability before complete grid readiness.
- Any claim that API discovery removes the normal browser's release-date enablement or reload requirement.
- Any need or authorization to alter the independent API checkout gate.
