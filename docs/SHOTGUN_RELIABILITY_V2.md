# Shotgun reliability V2 engineering record

## Verdict and scope

Implementation and offline qualification are distinct from live provider qualification. This change does not establish LAB QUALIFIED, RELEASE QUALIFIED or PRODUCTION READY. The canonical November 2 retained lock and unresolved parent records prevent new live execution and installation under the owner's constraints. No lock exception, journal rewrite, new reservation, payment or cancellation is part of this repair.

## Confirmed defects and repairs

1. `armed-dispatch.ts` validated a plausible response and immediately called `recordStop(...SHOTGUN_TARGET_ALREADY_ACHIEVED)`. Under a quota this added distinct courts before independent confirmation. The signal is now `SHOTGUN_PROVISIONAL_RESPONSE_STOP`, a conservative safety-capacity reservation within the exact authorized court/wing quota. Only the provider-confirming completion callback's confirmed outcome can add a court to achieved quota accounting. Separate provisional court/wing reservations bound further submissions without asserting any hold. Later UNKNOWN retains protection. Throttle and payment safety stops cannot be downgraded by a later provisional sibling response. Already-dispatched siblings still settle and retain their results.
2. `release-telemetry.ts` treated `PHASE3_WAVE1_STARTED` as POST evidence and expanded worker-level records across children. Historical Activity could show eight dispatched instead of seven. It now uses child-specific POST events or actual browser request evidence, with worker-only fallback restricted to legacy single-attempt rows. A transport-failure completion timestamp alone is insufficient. Raw telemetry and legacy success-shaped outcomes remain unchanged; the UI labels those as recorded evidence rather than provider proof.
3. Recovery could retry a 429 when Retry-After was short. The first 429 now ends the recovery action, retains uncertainty and avoids further reads/navigation. Bounded transport/5xx handling remains separate.
4. The old rehearsal checked authorization expiry only at process entry and pinned an incomplete selection of lifecycle modules. Versioned authorization now binds the exact target/budget, actual owner directive hash, attestation, installed SHA and production lifecycle module hashes. Expiry, Stop and availability age are enforced at the final POST gate. Write-once execution claims and production permits remain required.
5. Activity's journal aggregate called locally `verified` records simply “verified.” It now explicitly calls them locally validated responses requiring provider confirmation.

## Lifecycle and authority map

| Stage | Producer / authority | Consumption and unresolved behavior |
| --- | --- | --- |
| SAVED_PLAN | Booking Setup, controller, exact-plan authorization | Scheduled readiness validates the saved date/fingerprint; Lab authority is separate |
| PREPARED | Dedicated browser/customer identity, fresh availability, genuine security, trusted clock | A failed or stale preparation never authorizes a late send |
| ARMED | `freezePrecisionRace`, `armPrecisionRace`, durable intent, write-once permit, automation lock | Claimed intent after a crash is protected; only the live owner of an unspent permit can disarm |
| DISPATCHING | `fireArmedAttempt`, browser transport and Playwright request event | Scheduler invocation is intent; observed POST is transport evidence; browser loss can be UNKNOWN |
| LOCAL_RESPONSE_VALID | `validatePublicCheckoutResponse`, immutable response capture, legacy journal `verified` | Provisional safety suppression, not quota achievement or provider confirmation |
| PROVIDER_CONFIRMATION_PENDING | Desktop runner completion, per-browser recovery queue | Failed lookup, busy claim, 404 contradiction or missing identity yields UNKNOWN, never another creation attempt |
| PROVIDER_HOLD_CONFIRMED | `recoverPendingHold` and `validateProviderHold` | Exact original customer/group/court/date/hourly identities/amount/expiry required; stale proof requires fresh verification |
| QR_READY | Official checkout access, exact order-summary validation, visible payment QR | Navigation intent or constructed URL cannot establish QR readiness; payment remains manual |
| QR attention | `VerifiedHoldQrError` only after independent active confirmation | A QR problem can retain a confirmed hold; missing provider evidence cannot |
| Rejected / unsent / stopped | Typed transport errors, current process permit state, scheduler deadlines | Confirmed rejection is distinct from UNKNOWN; emergency Stop preserves sent evidence |

The production desktop runner continues to use its shared per-browser recovery queue; independent browsers remain separate. The Lab assigns at most one target to a browser and uses the same recovery function. PendingHoldService retains original identity binding and fresh-read semantics. No second dispatcher, request builder, provider validator or QR implementation was introduced.

## November 2 reconstruction

The immutable incident is documented in [the original forensic record](incidents/2026-11-02-release/README.md). Its exact topology is A: Court 7 at -2000/-1143/-286 ms; B: Court 6 at -1714/-857/0 ms; C: Court 5 at -1429/-571 ms. Original service date: November 4; original hours: 19:00–22:00.

| Evidence | Count |
| --- | ---: |
| Authorized children | 8 |
| Observed booking POSTs | 7 |
| Definitively unsent | 1 |
| HTTP 200 apparent groups | 5 |
| HTTP 400 rejected requests | 2 |
| Independently confirmed holds | 0 |
| Official QR handoffs | 0 |

The derived verdict remains MANUAL_RECONCILIATION_REQUIRED. `nov2-shotgun-accounting.test.ts` uses the committed original eight-child evidence. `armed-dispatch.test.ts` also exercises the same eight-child offset/court/worker topology through the real strict dispatcher with offline responses: seven sends, five locally valid groups followed by failed provider confirmation, two confirmed rejections, one suppressed zero-offset child, no objective achievement, no recyclable lock. Its synthetic service date/hours/customer are deliberately separate from live runtime evidence. The test does not replay a booking POST to Onda.

Owner observation and Slot Watch independently support the lack of demonstrated enforceable Court 7 hold before advertised expiry. They do not identify another customer or establish Onda's internal failure mechanism.

## Persistence and timing investigation

Normal `buildStandardPublicCheckoutRequest` and Shotgun `prooflessRequest` use the same endpoint/business identity, facility, session references, hourly duration=60, dates, midnight representation, customer binding, prices and currency for these standard Mango plans. The supported Normal path supplies fresh per-hour availability proofs; Shotgun deliberately sends `availabilityProof:null`. Offline parity tests compare complete business payloads for one, two and three hours, including midnight. Both use genuine page-bound security. This comparison does not prove either mode's provider persistence at the publication boundary.

The incident includes two explicit not-yet-available HTTP 400 responses, six observed browser request events before nominal 08:00 and one after, five plausible responses and contradictory original-ID lookups before advertised expiry. These establish publication uncertainty and insufficient local success evidence. They do not establish a backend root cause or prove that null proofs, identity, early timing or provider persistence caused it. No timing offset or checkout method was changed on that hypothesis. Distinguishing those explanations needs eligible same-engine live comparisons, publication observations and/or provider-side correlation records.

Node wake, page fetch, Playwright request event, ResourceTiming and provider receipt are separate measurements. The original captures expose material Node-to-observed-browser differences; they cannot establish provider receive order. No speculative latency optimization or offset shift is claimed. Existing strict deadlines, preparation safeguards and telemetry deferral remain intact.

## Regression coverage and outstanding evidence

| Failure / requirement | Coverage |
| --- | --- |
| Provisional 200 then provider 404; valid provider confirmation; conservative later suppression | `armed-dispatch.test.ts`, `pending-hold-recovery.test.ts` |
| Eight-child history and transport failures mistaken for sends | `nov2-shotgun-accounting.test.ts`, `live-telemetry.test.ts` |
| Wrong group/customer/court/date/amount, delayed lookup, expiry, auth capability loss, original identity | `pending-hold-recovery.test.ts`, `checkout-recovery.test.ts`, `pending-hold-browser.test.ts` |
| Busy same-browser recovery versus independent browsers | Existing recovery-queue regressions in `pending-hold-recovery.test.ts` |
| QR canvas/image, exact summary, original/fresh recovery | Existing checkout/pending-hold recovery suites and `shotgun-live-rehearsal.test.ts` |
| Stop, throttle, payment-in-progress, browser loss, prewarm, strict permit/deadline behavior | `armed-dispatch.test.ts`, `fanout-dispatch.test.ts`, existing intercepted Shotgun Lab scenarios |
| Multi-target finite budget, unique workers/courts, original UNKNOWN overlap, stale evidence, live-only promotion | `shotgun-live-lab.test.ts`, `shotgun-live-authorization.test.ts` |
| Normal / proofless business-field parity | `checkout-method-parity.test.ts` |
| Live Monitor and original evidence presentation | Existing `ui-monitor-holds.test.ts`, `ui-pending-holds.test.ts`, `ui-activity-journal.test.ts` |
| Actual durable provider persistence and release-boundary acceptance | Cannot be reconstructed offline; requires eligible live provider evidence |

See [Lab operator instructions](SHOTGUN_LIVE_REHEARSAL.md). The Lab is a command-line workflow; an in-app Live Lab form has not been added. Larger live or overlapping schedules remain outside its bounded authority. One prior single-shot result permits progressive testing, not a reliability claim. Repeated eligible reservations with independently confirmed active groups and exact QR are required for Level 1. A genuine newly published 08:00 release with the same evidence is separately required for Level 2. The exact installed build and current plan/readiness are separately required for Level 3.

Full local validation, exact-commit CI, canonical update preflight and immutable preservation results are recorded in the local task report. Local synthetic results must never be counted as real reservations or installed-runtime qualification.

## Native Windows fixture limitation

During this task two isolated intercepted FIRST_SUCCESS children exited 3221226505 (`0xC0000409`) with empty stderr. Their last synchronous traces were isolated Chrome spawning for workers 0 and 3, before booking dispatch. The traces recorded Node v24.15.0 and approximately 13.2 GB and 11.9 GB free memory; these facts do not establish a cause. The same scenario subsequently passed alone. No Node fatal report or matching Windows Application Error event was found. Original input, exit record, trace and profile fixture are retained locally. This native failure remains unproven even if a later complete run passes; no assertion, retry loop or production deadline was relaxed to hide it.
