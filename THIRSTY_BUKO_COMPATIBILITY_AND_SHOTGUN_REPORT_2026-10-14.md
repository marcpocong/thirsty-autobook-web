# Thirsty Pickle Buko Compatibility and Shotgun Report — 2026-10-14

## A. Repository, installation and validation

- Git root: `C:\Users\marcp\Downloads\Thirsty Pickle Bot\Source`; repository `marcpocong/thirsty-autobook-web`, branch `main`.
- Initial clean source and fetched remote: `cd4fe9e39a26190c5700e28d5ea06e2812fc5319`, `fix: enforce strict shotgun trigger timing`. No preexisting uncommitted or unpushed changes. Its [CI run](https://github.com/marcpocong/thirsty-autobook-web/actions/runs/37499468532) succeeded.
- Implementation commit: `756c6bb81f68405580c40bbe715a006b860ba9e0`. A documentation-only commit containing this report follows it. Resolve the publication tip with `git log -1`.
- Existing installed build: version `0.1.0`, source SHA `c2d365d564116b207f7ea60baa45f460befa00c4`, built October 6. It predates the strict Shotgun fix and this compatibility work. It was **not replaced or launched**.
- Existing architecture: Electron dashboard, shared Strategy compiler, one authoritative `PRECISION_PHASE3`, dedicated worker Chrome processes/tabs, prebuilt armed transport, durable submission journals and booking locks; observer isolated from dispatch. There is no second bot or booking authorization model.
- Baseline: **139 files / 1,568 tests passed** before changes. Final source: **140 files / 1,581 tests passed**, including the existing checkout/QR/lock/recovery/Stop suites and 13 new wing tests. Typecheck, UI/runtime build and dist verification passed. A first post-change full run exposed one remaining expected-URL assertion; it was updated to the observed date mode, followed by a passing complete suite. No tolerances were loosened.
- Official clean release build on implementation commit: `npm run release:build -- --output .local/build/buko-compatibility-2026-10-14` passed typecheck, all 1,581 tests, clean build, verification and Windows packaging. Source verification checked 392 compiled files; packaged installation verification checked 198 files, zero problems.
- Package: `Source/.local/build/buko-compatibility-2026-10-14/Thirsty Pickle Bot.exe`. Clean build ID `756c6bb-6ec85276f3`; dist content ID `6ec85276f3a93bd2b12370b8ba5af69b6b0671d34b3d62c389a8a518f09c8c18`; launcher SHA256 `FABABE6F6F0B57FFAC230787024F48B6C007BCC1502E2AAF07D7B8C4512F4B2C`. This local package has no authenticated worker profile fleet. Packaging is verified; an installed-app booking pass is not claimed.
- Source and installed saved configurations passed the actual `reconcileBookingSetupFallbacks` → `BookingSetupSchema` load boundary. Both retain seven-entry Mango priorities. The installed configuration includes an existing 20-shot strategy; source configuration does not. Private configuration digests remained unchanged. The reconciliation of retired keys already existed; this change introduces no data migration.

## B. Live Onda investigation

Observed October 14, 2026, approximately **02:07–02:25 Asia/Manila**, through the available Chrome extension browser (`Carlo` profile). No usable existing CDP connection was found: loopback port 9222 returned HTTP 404 for `/json/version` and `/json/list`; it was not assumed to be Chrome. No browser profiles, credentials or cookies were extracted.

Inspected [the public booking page](https://app.onda.fit/book/thirsty-pickle): initial October 14 grid, calendar, court filter, October 19 grid immediately after date selection, and subsequently hydrated October 15 grid. The October 19 view was transient; later state showed October 15, so it is not treated as a stable continuing selection. The public horizon banner independently remained Mango through October 15 / Buko through October 19. Calendar dates 14–19 were enabled and 20 onward disabled at observation. No slots, Proceed, Terms, checkout or payment were selected. Final scoped verification found **zero selected booking cells and no booking selection summary**.

The live DOM had 16 hourly rows and 224 cells in All Courts, with Buko columns before Mango. Filtering Buko reduces visible columns and can omit closed morning rows; a bot must not mistake that for the complete Mango grid. The court menu lists the fourteen exact names individually; overlapping display numbers require wing identity. Mango labels now include `🥭`; Buko labels begin `🥥`.

Public rendered Next.js metadata (`initialFacilityData`, `initialSpacesWithMemberships`) confirmed facility and space IDs, names, operating schedules, rate metadata, maintenance entries and public checkout limits. Only public fields were used. Observed resource inventory confirmed these public GET patterns:

```text
/api/public/facilities/5f8786bd-dc61-4509-b893-74cda8f783f7/date-availability
?startDate=2026-10-14&endDate=2026-10-19&duration=60&slotDateMode=web-operating-day

Same endpoint for the single-date grid:
?startDate=<date>&endDate=<date>&duration=60&includeSchedule=true
&includeMemberOnlyAccess=true&slotDateMode=web-operating-day
```

The UI also issued `fresh=true` variants and prefetched nearby dates. The bot now includes the observed operating-day mode, but does not add membership authorization, a freshness polling burst, or higher request volume.

**Response-body blocker:** normal PowerShell GETs returned HTTP 403 on both the historical URL and current observed query. A read through the production `OndaLiveAvailabilityProvider` also returned `AVAILABILITY_HTTP_FAILED`, HTTP 403. A normal Chrome navigation to the observed public API URL was blocked by the client (`ERR_BLOCKED_BY_CLIENT`). No access-control bypass was attempted. Thus successful availability response bodies, response/cache headers, proof schema, server receipt time and actual Buko checkout behavior remain **unverified**. The browser's functional UI is not evidence that Node's unauthenticated provider currently works.

The [October 13 news lead](https://homes.ph/cebu/news/thirsty-pickle-opens-buko-wing-at-sm-seaside-city-cebu-with-seven-international-standard-courts) was inaccessible to the research tool. Its claimed three/five-day rules were not adopted as runtime configuration.

## C. Confirmed Mango versus Buko inventory

All fourteen share facility **`5f8786bd-dc61-4509-b893-74cda8f783f7`**. Public display numbers remain 1–7 within each wing. Internal stable identities are namespaced; Buko is not assigned provider courts 8–14.

| Internal identity | Official public name | Verified Onda space ID |
|---|---|---|
| MANGO:1 | Court 1: Mango Wing 🥭 | c8c8fb0a-518e-4838-b006-8f200e477788 |
| MANGO:2 | Court 2: Mango Wing 🥭 | df1a98c3-deb2-4721-949a-d5a1e54fdce0 |
| MANGO:3 | Court 3: Mango Wing 🥭 | 0e853a91-33b6-4de2-9237-778007a9313b |
| MANGO:4 | Court 4: Mango Wing 🥭 | 2166184c-db40-4a04-9a80-656878f7327b |
| MANGO:5 | Court 5: Mango Wing 🥭 | 1cdcd209-71ce-4a72-a2f6-9252c4d06a01 |
| MANGO:6 | Court 6: Mango Wing 🥭 | 7aa7d361-9e60-433f-85ed-9e8eeaef8f96 |
| MANGO:7 | Court 7: Mango Wing 🥭 | 648d72bb-0789-40c6-9557-66709da121ba |
| BUKO:1 | 🥥 Buko Wing: Court 1 | bea300b2-34ef-4f9c-a465-4cabcb945c44 |
| BUKO:2 | 🥥 Buko Wing: Court 2 | 2b9c19e6-99fc-47de-b853-03f9234dc456 |
| BUKO:3 | 🥥 Buko Wing: Court 3 | 6631032a-3d90-452c-8aa5-d7de9b01ae0e |
| BUKO:4 | 🥥 Buko Wing: Court 4 | a49b62f8-5713-4e08-a69d-de9072ecc914 |
| BUKO:5 | 🥥 Buko Wing: Court 5 | 3260ae72-61ad-45b8-8d4e-840eb9ac8ebe |
| BUKO:6 | 🥥 Buko Wing: Court 6 | 778c8116-1b51-43f0-a0ce-1945df16c0ef |
| BUKO:7 | 🥥 Buko Wing: Court 7 | ca22630b-5550-41b2-a818-99928fa3074a |

| Field | Mango | Buko | Evidence limit |
|---|---|---|---|
| Court count | 7 | 7 | Live names and public space metadata |
| Facility | Original facility | Same original facility | Each space's facility_id verified |
| Availability endpoint | Facility endpoint above | Same public page facility endpoint | Successful body/schema comparison blocked |
| Weekly hours | Daily 08:00–24:00 | Mon–Thu 16:00–24:00; Fri–Sun 08:00–24:00 | Metadata, plus closed morning UI on Thursday |
| Weekday daytime metadata | PHP 600 | PHP 600 | Informational; per-slot amounts remain authoritative |
| Weekend daytime metadata | PHP 700 | PHP 600 | Mango has a per-space price override; maintenance can remove hours |
| Evening metadata, 16:00 onward | PHP 700 | PHP 700 | Exact total still needs response validation |
| Public checkout limits | At most 2 courts / 3 hours per court | Same facility publishes these limits | Buko transaction enforcement unverified |
| Banner's open-through date at observation | October 15 | October 19 | Snapshot of UI, not a perpetual horizon promise |
| Release policy | Existing offset 2 / 08:00 Manila retained | Unknown; disabled | Facility's 3 days / 08:00 metadata does not prove a Buko override |

Inclusive counting matters: before 08:00 on October 14, the prior Mango release's latest target is October 15; today's next release targets October 16 (today + 2). The public label “3 days” includes the release day. The observed Buko October 19 boundary cannot establish whether its policy is rolling, inclusive, fixed, or released at another time. **No automatic change to horizon 3 or 5 was made.**

Publication is not guaranteed uniform: courts have different maintenance counts (Buko 6/7/8/9/8/8/7 at observation) and date/time blocks. A missing slot can mean a closed hour, maintenance, incomplete publication or unknown evidence. It is never treated as open. The October 19 transient grid showed Buko bookable evening cells while Mango explicitly said “not released yet”; a facility-wide date flag cannot be assumed to cover both wings.

## D. Original bot compatibility and audit

| Area audited | Finding / action |
|---|---|
| Strict API availability parser | Previously fatal on every unknown space. If current responses include the verified Buko UUIDs, it would reject the whole response with AVAILABILITY_UNKNOWN_COURT. Actual body was unavailable, so this is conditional rather than a claimed capture. Fixed: exclude only explicitly verified out-of-scope spaces, retain all Mango slot/pricing validation, report excludedSpaceIds. Truly unknown UUIDs still fail closed. |
| Browser grid / date navigation | Actual All Courts DOM has 224 cells; old validation requires 112 and old Mango regex excludes the emoji. Fixed: validate names against registry, then the complete original Mango subset; wait for seven Mango cells per row; accept old/new names. Unknown columns or a preselected Buko cell stop selection. |
| Selection / review / practice | Existing Mango prefix selectors still match the new names. Review identity accepts the verified optional mango emoji. No Buko name can become a Mango number. No live review/QR action was attempted. |
| Config / setup / Smart / Strategy | Integer 1–7, seven-entry priority and seven-court maxima stay deliberate Mango contracts. No saved plan, target, budget, worker or offset is rewritten. Strategy and Next Release explicitly identify Mango. Buko selection is disabled with a reason. |
| Court-hour matrix / Slot Watch | 112 cells remain a Mango observation scope, not a claimed venue total. Scoped parsing no longer rejects verified Buko spaces. Missing Mango cells remain unknown rather than available. Existing date flags are not expanded into Buko authority. |
| Planner / preparation / workers | Legacy Mango ordering, grouping, assignment and preparation unchanged. Inspection-only Buko snapshots are explicitly refused by planBooking. |
| Checkout / amount / QR / locks / recovery / Stop | Existing exact Mango space mappings, per-hour proofs, strict body/response validation, QR handoff, journal and safety gates unchanged; full regression suites passed. No new live transaction evidence. |
| Historical diagnostics | Existing append-only logs untouched. Public observations and benchmark raw data are local; no private configuration/profile/network secret was committed. |

## E. Shotgun validation

Production code reviewed: shotgun / quick-shotgun / shotgun-timing, fanout-capacity, armed-dispatch, dispatch-coordinator, benchmark and offline isolation support. The default central armed dispatcher remains authoritative; renderer and per-browser coordinator experiments were not enabled.

Exact schedule, unchanged:

```text
[-1000,-700,-500,-300,-250,-200,-175,-150,-125,-100,-80,-60,-45,-30,-20,-10,-5,-2,-1,0]
```

A compiler-generated representative Mango plan was benchmarked, then an authorized sanitized extract of the installed saved plan was made. Their exact timing/topology fingerprints are identical: `29e1942784afd213e086bd93ab4b59f20bf629b37f72a581e5a10a3ff04633be`. Both use A/B/C/D with **6/6/6/2 tabs**. The saved extract contains only Phase 3 and Shotgun settings; customer/profile data is excluded and rate-source free text is sanitized.

```powershell
npm run bench:shotgun -- --saved-plan .local/buko-investigation/synthetic-dense-core-plan.json --runs 10 --warmup 2 --out .local/shotgun-timing --lockdown
```

Configuration: 10 measured runs, 2 warmups, 20 shots each; central dispatcher; 15-second preparation lead; preparation concurrency 4; synthetic security cpu:0,wait:0; headless real local Chrome; HIGH priority lockdown; no artificial page busy work. Four isolated Chrome processes, dead localhost proxy and blocked external DNS; Onda-shaped page and checkout responses intercepted locally. Every measured checkout returned a synthetic 409. No Onda checkout POST left the machine.

Machine: Intel Core i5-13500HX, 20 logical cores, 32 GB RAM, Windows 10.0.26300 (Windows 11 build), Node v24.15.0, Chrome/154.0.8037.99. Chrome request-start is a local timestamp, not provider receipt.

Clean build 756c6bb81f68405580c40bbe715a006b860ba9e0, tested October 14 at 02:29:59 Manila. Verdict: **AT_RISK**.

| Measurement | Clean result |
|---|---|
| Local trigger → Chrome median / p95 / max | 3.43 / 4.31 / 5.01 ms |
| Scheduler wake error median / p95 / max | 0.01 / 0.34 / 0.94 ms |
| Worker invocation error median / p95 / max | 0.05 / 0.35 / 0.96 ms |
| Measured shots / locally intercepted 409 outcomes | 200 / 200 |
| Outside 50 ms trigger tolerance / omitted shots | 0 / 0 |
| Observed compressed adjacent pairs | 6 across ten runs |
| Ready before own trigger | 200/200 (synthetic security only) |
| Synthetic preparation median / p95 / max | 30.30 / 38.40 / 58.00 ms |
| Smallest preparation-ready margin to trigger | 14961.35 ms |
| System busy median / p95 | 18% / 34.5% |

All ten configured **0 ms** shots reached local Chrome; observed starts ranged 2.12–4.48 ms after release. None was omitted at the boundary. All twenty configured triggers and four workers retained their literal authorization topology.

Raw: `.local/shotgun-timing/2026-10-13T18-29-59-635Z-central-exact-saved-shotgun-raw.json`; summary and `latest.json` retain exact fingerprint/build/machine identity. This result matches the separately packaged implementation commit. The subsequent report-only publication commit has a different Git SHA, so a new build at that documentation tip requires a fresh matching applicability check rather than treating the earlier profile as automatically current.

Initial implementation-tree comparison at 02:18:38 Manila (`cd4fe9e+dirty`) recorded median 3.70 ms / p95 5.17 ms / max 19.15 ms trigger-to-Chrome error, zero outside tolerance, zero omitted, 12 compressed pairs, AT_RISK. Its system-busy p95 was 70.6% because development checks overlapped. It is retained as evidence, not used as a clean-build result.

No scheduling defect was established that justifies rewriting offsets or increasing concurrency. Compression/reordering at near-zero spacing is reported by the capacity gate; it is not hidden to obtain a pass. An applicable AT_RISK result blocks arming. The strict 50 ms deadline, independent trigger waits, expiration of permits, final beforePost timing check and preparation-time renderer calibration remain unchanged.

Existing intercepted tests verify: -500 and 0 ms shots inside tolerance; late tier 0/tier 1 never recover as late sends; a delay before POST is rechecked; missed permits are revoked; journals/callbacks wait until T+1000; pre-release Stop sends nothing; in-flight unknown outcomes retain reconciliation; a verified hold, unknown result or throttle suppresses later same-target attempts. The synthetic-409 benchmark itself does **not** exercise every hold/throttle/unknown branch; those are regression-test evidence. Real security readiness, Onda acceptance/arbitration, provider timing and booking success remain **unmeasured**.

## F. Code, tests and migration

- New `src/court-registry.ts`: immutable explicit inventory, wing identity, names, facility IDs, preserved Mango UUIDs, verified Buko UUIDs, observed pricing/schedule metadata and disabled booking methods/reason.
- New `src/wing-release-policy.ts`: independent evidenced policy input, Manila calendar-day release calculation, freshness-checked target workflow classification. Mango defaults preserved; Buko policy is null. A synthetic different horizon/time is tested independently; this does not configure or authorize a Buko live scheduler.
- API parser/types/planner: scoped snapshots, excluded-space diagnostics, wrong-facility checks and Buko planner refusal.
- Live/hybrid availability adapters: one shared Mango mapping and observed operating-day query mode.
- Grid/review: current labels and mixed-wing DOM compatibility while retaining exact Mango structure and selected-cell safety.
- Strategy/Next Release: explicit Mango identity; disabled Buko option and clear reason. No duplicate screen or mandatory dialog.
- Tests: `wing-compatibility.test.ts` plus current-URL assertions and real-renderer disabled-wing checks. Fixtures containing Buko slots are **synthetic**. Registry UUID/name evidence is live metadata; those facts are not mislabeled as a captured availability response.
- No dependencies, concurrency limits, release offsets, customer bindings, terms authorization, stop semantics or saved configuration were changed. Existing configuration reconciliation is read-only unless the operator explicitly saves via the existing UI.

Coverage of requested regression areas: original mapping/availability, synthetic Buko mappings, verified extra versus unknown UUIDs, wrong facilities, independently configured horizons/times, already-published targets, empty future targets, partial/mixed publication, missing slots, unknown-policy fail-closed, and old/new Mango labels are covered by new tests. Existing full suites cover saved strategy compilation/loading, payload worker/court identity, QR response/expiry validation, locks/journal recovery, emergency stop and old Mango Shotgun authorization. Actual Buko booking compilation and checkout/QR integration remain blocked, rather than claimed tested.

## G. Production readiness

| Capability | Verdict | Supporting evidence / remaining limit |
|---|---|---|
| Mango Normal booking | OFFLINE TESTED ONLY | All regressions pass; mixed-wing DOM repaired. Current API-first availability read is BLOCKED by HTTP 403. No current checkout-to-QR live verification. |
| Mango Shotgun, exact 20-shot Dense Core | BLOCKED | Clean local benchmark verdict below governs this topology; strict timing remains bounded but compressed pairs cause AT_RISK. Other schedules need their own compatible benchmark; no production success claim. |
| Buko Normal booking | BLOCKED | Courts and facility verified; Buko availability body, proofs, checkout and QR adapter unverified. Disabled in registry/UI. |
| Buko scheduled-release booking | BLOCKED | Recurring wing release policy unknown; no horizon/time inferred. |
| Buko Shotgun | BLOCKED | Neither Buko booking adapter nor release policy is enabled; it is never added to Mango authorization. |
| Windows desktop build | VERIFIED (build/package only) | Official clean Windows packaging and packaged-dist verification passed. Existing installed desktop remains old; installed-app/UI-to-booking verification is UNVERIFIED. |

This assignment delivered tested compatibility fixes and a safe registry/policy foundation. It did **not** establish complete automated Buko booking support or current live Mango transaction functionality. Those boundaries are explicit rather than inferred from public UI or synthetic tests.

## H. Operator instructions

1. Your current installed app is unchanged. Review the separate local package and this report; it is not a silent installation update. Its build ID is listed above, and it does not contain your authenticated worker profiles.
2. Existing saved numbered courts are **Mango Wing**. The updated Strategy view states the wing, and Next Release repeats it. Use the normal existing target → Normal/Shotgun → Save workflow. Do not reinterpret Mango Court 1 as Buko Court 1.
3. For already-open Mango dates use the existing **Test Now / exact-date** workflow only when you intentionally authorize a real booking. For a verified future Mango release use **Prepare for Release**. No live attempt was run during this investigation.
4. The 20-shot schedule's AT_RISK capacity result is a stop condition, not permission to arm. Do not disable the timing/capacity gate to use it. A different schedule is an operator decision and requires its own readiness evidence.
5. Buko selection remains disabled in the bot with an explanation. Use the official Onda page for currently available Buko dates. Buko 1–7 are separate courts; inspect its operating hours and maintenance for the chosen date.
6. Before enabling Buko automation, obtain sanitized successful availability/proof responses from the normal authorized session and establish its recurring release rule. Then implement wing identity through compiled authorization, payloads, response validation, QR handoff and recovery; validate locally intercepted checkouts first. Any actual booking/hold experiment still requires separate explicit authorization.
7. Resolve the HTTP 403 live-provider blocker before treating Mango API-first as ready. A functional Chrome schedule alone does not prove the Node read adapter is admitted. No security bypass is proposed.

Local evidence: `.local/buko-investigation/` (baseline/final logs, sanitized plan, compatibility checks, audit and package log); `.local/shotgun-timing/` (timestamped raw/summary runs and `latest.json`). These local evidence directories and the package are excluded from Git. The report and source contain no credentials, browser profiles, customer details or signing/payment links.
