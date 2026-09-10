> Historical checkpoint at 26d5437. Full Booking status is superseded by [FULL_BOOKING_REPORT.md](FULL_BOOKING_REPORT.md).

# Selection-ready booking control panel — September 10, 2026

Selection Only is implemented and verified against live noncompetitive slots. The existing Electron app and release/CDP/grid/safety architecture were extended in place. Review, Player Information and Payment Summary now have an adapter built from inspected DOM. Full Booking stays gated because live terms/final-action handoff was deliberately not exercised.

## Git

Existing root: `C:\Users\marcp\Downloads\thirsty-bot`. Branch: `main`. Remote: private [marcpocong/thirsty-autobook-web](https://github.com/marcpocong/thirsty-autobook-web). This report belongs to the phase-2 commit after `9438cdb`; the task response records its exact hash and push outcome. No nested repository, recreation or force push.

## UI

| Feature | Result |
|---|---|
| Booking Setup | Local save with strict input validation; ignored `config.local.json` |
| Target | Same engine calendar calculation: today's configured local date + horizon; September 12 during this validation |
| Start / duration | Friendly 08:00–23:00 dropdown; 1–16 integer hours, bounded by midnight; exact hourly slots in saved preview |
| Court priority | All seven courts exactly once, accessible up/down controls |
| Fallback editor | Optional ordered times with add/remove/up/down; duplicates and overnight ranges rejected |
| Maximum / attempts | PHP numeric maximum; 1–5 candidate attempts, default 3 |
| Player | Configured indicator only; actual values stay in ignored `.env.local`, never renderer state |
| Prepare Booking | Loads/validates player and booking config, compiles preferences, launches/reuses Chrome, inspects today/All Courts/zero selections/visibility, checks lock and preflight cutoff |
| Arm Selection | Native Cancel/Arm confirmation containing exact plan; immutable worker config and public-plan fingerprint check; no confirmation at release |
| Selection Only | Enabled, selects/verifies and stops before Proceed; reports SLOTS SELECTED, amount and Proceed readiness; retains lock |
| Practice | Explicit date/court/start/duration; existing engine selects/verifies/deselects/verifies clean; no Proceed |
| Dry Race | Same existing release/date/grid/preference path, no selection; explicit confirmation |
| Observe Release | Original read-only observer retained |
| Full Booking | Disabled; no main-process/preload worker route to bypass the capability gate |
| Terms | OFF on startup/new plan/completion/abort; UI disabled while Full Booking is gated; not persisted |
| Emergency Stop | Existing owned-worker IPC/process exit; Chrome stays open; no recovery interaction |

Live Electron smoke: launch succeeded, setup save/persistence and court reorder/fallback preview verified, player reported Configured, preparation verified the clean page and correctly refused afternoon arming, and Practice UI completed the September 11 Court 7 10:00–12:00 select/deselect cycle. No renderer errors. Isolation=true, Node integration=false, sandbox=true. Screenshot reviewed locally with no player PII. Emergency Stop remains pinned while the longer setup view scrolls. Onda inspection state is invalidated when an operation navigates/selects, avoiding a stale “Verified” date after practice.

The next-release countdown is informational. After the daily cutoff, the booking target remains today+horizon and all scheduled arm buttons are disabled; nothing silently rolls into tomorrow's run.

## Selection and checkout

The release engine still compiles before waiting, uses zero release lead, performs at most two normal reloads, navigates the calendar, and validates full row dates/coverage before its one-pass snapshot. Its result now feeds `selectResolvedPreference` instead of ending at observation. Selection uses normal sequential clicks, semantic state waits and one-pass verification snapshots; no arbitrary sleeps, force clicks, parallel attempts or repeated locator scanning were introduced.

Every candidate requires consecutive same-court OPEN cells, no selected cells and a strict target grid. Each factual slot-selected event follows a confirmed state. Final verification requires the exact selected set, `1 Court • N Slots`, a known positive PHP amount within maximum, and actionable Proceed. Unknown/date/price/count/foreign-selection uncertainty fails closed. Selection Only contains no Proceed call.

A first/second-click conflict, rejected partial selection or non-actionable Proceed can trigger cleanup only for the attempt's positively identified selected subset on a still-valid grid. Cleanup is verified before a fresh snapshot resolves an untried deterministic candidate. Attempts are bounded and never repeated. Security/abort/unknown-state errors never clean up. Complete verified selection engages the stronger lock; successful Selection Only deliberately retains the filesystem lock for manual inspection.

The checkout entry revalidates selected cells and summary immediately before Proceed. Review and Payment Summary compare venue/date/court/start/end/duration/currency/amount; Payment also re-reads the actual Review card still visible behind the sheet. Review has no own displayed amount, so it carries the independently verified selection amount until the Payment total confirms it. Player fields are filled with normal locators and represented values verified. Unsupported phone formats fail; supported PH mobile forms normalize to ten national digits under the observed +63 prefix. No React injection or private API is used.

| Checkout evidence | Status |
|---|---|
| Review DOM | Inspected; production adapter read and exact booking validation passed |
| Player DOM | Inspected; production adapter fill/read-back passed using local configuration |
| Phone behavior | Separate +63; site formats ten digits as `### ### ####`; leading-zero and national input behavior observed |
| Payment Summary | Inspected; production total and booking revalidation passed at PHP 1,200 |
| Terms | Checkbox/label inspected, remained unchecked in live runs |
| Final Onda button | Accessible name `Continue to Payment`, visible text `Confirm & Proceed to Payment`; disabled with terms off; never clicked live |
| Slot hold | Site explicitly says selection is not a reservation; later payment continuation is described as a 10-minute hold |

The authorized structural target was September 11, Court 7, 10:00–12:00, with other courts also available. Court 1's earlier test pair was unavailable, so it was not selected. Both successful checkout inspections stopped at Payment Summary before terms/final action. The first selection attempts encountered a non-visible tab and safely made no selections; keeping the tab visible resolved this. The adapter and guard preserve normal actionability. The test player fields and owned selected slots were cleared afterward; today and zero selected cells were verified, Chrome remained open, and only the exited inspection owner's lock was removed.

## Capabilities and remaining blockers

| Gate | Value | Evidence / remaining work |
|---|---|---|
| selectionReady | true | Live same-court selection/summary verification and offline conflict/abort tests |
| checkoutReady | true | Live production adapter through Payment Summary and offline DOM tests |
| paymentBoundaryReady | false | Terms/final action tested only synthetically; no live handoff test authorized/performed |

Full Booking requires all three gates. `race --armed` still refuses before attachment while any gate is false. A separately authorized final Onda handoff test and its observed behavior are the precise remaining capability blocker. Payment-provider interaction remains prohibited even after that gate is verified. Actual 08:00 release behavior and real contention are additional operational evidence still outstanding; no release success is claimed.

## Performance

One noncompetitive live production pass at approximately **15:57:43 Manila**; diagnostic sample, not a release/load benchmark. Local telemetry run `484e9beb-b668-425f-9554-5376ca712033` remains ignored.

| Interval | Observed |
|---|---:|
| Grid ready → snapshot start | 0.04 ms |
| DOM snapshot | 9.71 ms (this inspection marker excludes subsequent local validation) |
| Snapshot complete → preference resolved | 2.41 ms, including strict local validation |
| Preference → first normal click start | 10.12 ms, including page guard |
| Slot 1 click start → selected verified | 47.42 ms |
| Slot 1 selected → slot 2 click start | 0.01 ms; sequential dispatch without a sleep |
| Slot 1 selected → slot 2 selected | 45.16 ms |
| Slot 2 selected → full selection verified | 24.22 ms |
| Selection verified → grid Proceed resolves | 861.12 ms, including revalidation and normal actionability |
| Proceed resolves → Review extraction complete | 20.92 ms |
| Review detected → player fill/read-back complete | 46.33 ms |
| Player fill complete → Payment Summary validated | 4,727.75 ms, including player Proceed actionability/click and summary wait/read |
| Grid ready → Payment Summary validated | 5,795.21 ms |

The measured version's player-Proceed method also waited for the Payment Summary heading. Consequently its 12.86 ms subsequent summary-read interval is **not** an independent player-click→summary transition measurement. Production telemetry now separates `playerProceedStarted`, click completion and the following strong summary wait; that corrected separation is covered offline but has not been re-benchmarked live. No invented zero-latency checkout or final handoff figures. The largest combined phase was the player-Proceed/summary transition, so no lower-level optimization was attempted without more evidence.

## Tests and safety

**113 tests passed on Windows**, preserving all earlier tests. Coverage includes same-court multi-hour selection, first/second-slot loss, partial/ambiguous click results, cleanup, deterministic fallbacks, attempt caps/no duplicates, price/count/date/unknown/foreign-selection rejection, retained booking gate, no Proceed in Selection Only, phone formats, real-selector fixture checkout, Review/Payment mismatch, terms reset, changed-plan rejection, Full Booking gating, boundary sealing and abort during selection/Review/player form. Existing real Node IPC and Windows owned-tree stop tests remain passing; an unrelated process survives. A selection-controller stop test verifies the same ownership path and duplicate-operation exclusion. Linux skips the Windows-only termination test.

Typecheck and UI build passed. Live UI, safe practice, production selection and checkout-through-summary checks passed. Real-time 08:00 scheduling was not simulated as a live release; its actual proof remains outstanding.

Real player data committed: **NO**. `.env.local` was checked with Git's ignore rules before being populated. Tracked/staged content is scanned for all supplied player values before commit. Profiles, screenshots, local settings and telemetry remain ignored. Private APIs: **NO**. Final Onda payment action performed live: **NO**. Payment-provider automation: **NO**. Chrome remains open.

Privacy audit scope: no supplied player values occur in staged files or historical file diffs. Earlier commits already contain the player's email in Git author metadata. This phase uses the GitHub no-reply author address and adds no such metadata. Existing history is preserved; no force push or history rewrite was performed.
