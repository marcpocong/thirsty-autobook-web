# Full Booking to QR — phase results

Full Booking now continues through the normal Onda booking controls to a passively verified QR Checkout hold, then stops. Payment remains entirely manual. The existing release, strict grid, selection, fallback, CDP and desktop architecture is preserved.

## Git and capabilities

Previous checkpoint: `26d5437e170bbdb6d5ff60ebd25b9743a499fc0e`. This report belongs to the subsequent **Complete Onda full booking handoff to QR checkout** commit on main in `marcpocong/thirsty-autobook-web`; the final delivery records its hash and push status. No force push or history rewrite is used.

| Capability | State | Basis |
|---|---|---|
| selectionReady | true | Existing verified selection evidence preserved |
| checkoutReady | true | Live Review/player/Payment Summary evidence preserved |
| paymentBoundaryReady | true | One bot final dispatch and verified live Checkout/hold/QR evidence, recorded in `src/handoff-evidence.ts` |

## Modes and full flow

- **PRACTICE — SELECT THEN DESELECT:** explicit target; select, verify, deselect, verify clean; never Proceed.
- **SELECTION ONLY — STOP BEFORE PROCEED:** leave the complete verified selected set and retain the lock; selection is not a reservation.
- **FULL BOOKING — STOP AT QR PAYMENT:** default when all gates pass; requires fresh terms authorization and native confirmation of the exact plan before the release worker starts.

Full Booking validates exact date, court, consecutive hours, count and price; clicks grid Proceed; validates Review against that selection; fills and reads back the local player fields, preserving separate +63 phone normalization; clicks player Proceed; waits for the actual Payment Summary and validates booking/PHP total/maximum; checks and verifies authorized Terms; rechecks the summary, Terms and final control; seals the gate; consumes its single dispatch permit; clicks the final control once; and reads only bounded Checkout evidence. Success requires Checkout, hold label, active countdown, Pending, matching independent PHP amounts, QRPH and QR canvas presence. It then emits the safe handoff result and exits with the lock retained.

Terms default OFF and reset on startup, plan/mode changes, cancellation, completion and abort. Full Booking cannot arm without them. The final confirmation states Terms YES and the QR Checkout boundary. The UI differentiates selected, reviewed, ready-to-create-hold, verified hold, stage failures and unknown handoff. Unknown results instruct manual Chrome review and never retry. Retained evidence includes its observation timestamp; the panel stops presenting an elapsed countdown as a current active hold. There are no payment controls in the panel.

## Single live test

**Performed: YES, with development interruptions and recovery of the same attempt.** September 10, 2026 Manila; booking target September 11, Court 7, 12:00–13:00, PHP 600. All seven courts were available at the selected noncompetitive hour when inspected. Selection, first Proceed, Review validation, player fill/read-back and second Proceed succeeded. The initial summary wait timed out after 15 seconds. After the same Payment Summary became visible, its exact booking and local player values were revalidated without repeating either Proceed. Terms were checked and the final button was dispatched once at 21:02:41.

Visible final text: **Confirm & Proceed to Payment**. Exact accessible selector: `getByRole('button', {name:'Continue to Payment', exact:true})`; no final-button test ID was observed. Checkout was reached. The initial passive observer failed on a Node/tsx serialization helper; it made no recovery interaction. The corrected passive-only reader verified the same existing hold at **21:05:22.928 Manila**: **Checkout YES, Pending YES, countdown 07:24, QR presence YES, amount PHP 600**. All browser inspection then stopped.

Payment performed: **NO**. Final dispatches: **1**. Final retries: **0**. Payment interactions: **0**. QR content extracted: **0**. Save QR clicked: **NO**. Check payment status clicked: **NO**. Payment method clicked after handoff: **NO**. Automatic cancellation: **NO**. Chrome remained open; filesystem lock retained. The recorded countdown has elapsed by delivery; current browser/hold/payment state has not been re-read and must be reviewed manually before clearing the exact lock. No further live test is scheduled or authorized by this report.

## Performance evidence

These are a single sample, not guarantees. Monotonic differences below use one process segment only. Independent process restarts and engineering pauses invalidate an uninterrupted live total.

| Phase | Measurement |
|---|---|
| Selection verified → first Proceed starts | 39.7 ms |
| Selection verified → first Proceed resolves | 945.1 ms, including click/actionability/navigation |
| First Proceed resolves → Review detected | 15.8 ms |
| Review validated → player fill/read-back completed | 67.4 ms |
| Player Proceed starts → resolves | 840.6 ms |
| Player Proceed resolves → Payment Summary | Exact arrival NOT MEASURED; original sentinel wait exceeded 15 seconds; summary later observed during recovery |
| Terms check | 33.6 ms |
| Terms checked → final action starts | 29.9 ms |
| Final action starts → click resolves | 38.2 ms |
| Final action → Checkout arrival | NOT MEASURED as navigation latency; passive observer required a serialization fix |
| Selection → verified QR evidence | 330.1 seconds wall time including both development interruptions; NOT an end-to-end performance benchmark |

Payment Summary now waits on its actual heading, bounded by `PAYMENT_SUMMARY_READY_TIMEOUT_MS` (default 60000, configurable 3000–120000). It does not retry Proceed or add a fixed sleep. Post-dispatch verification is separately bounded by `PAYMENT_HANDOFF_VERIFY_TIMEOUT_MS` (default 10000, configurable 1000–30000). Its 100-ms interval only checks DOM success state within that bounded window; it never triggers network payment-status checks. Production telemetry separates the requested stage boundaries for the next authorized normal run.

## Validation and privacy

- `npm run typecheck`: passed.
- `npm test`: **143 passed**, including the original 113 and new full-pipeline, boundary, observer, amount, abort, capability, UI authorization/result and retained-cache tests.
- `npm run ui:build`: passed.
- Actual Electron launch: passed; all mode wording verified, Full Booking selected, terms OFF, all capabilities true, retained lock blocks commands, expired evidence prompts manual review. UI-only screenshot stayed ignored locally.
- Production Node `--import tsx` passive observer against an offline Checkout fixture: passed, specifically checking the serialization failure encountered live.
- Offline full-flow integration uses the real adapters and rejects external requests. It verifies both Proceeds, normal field filling, Terms, exactly one final click, passive QR proof and no payment-control clicks.
- Real player data remain in ignored local configuration; tracked code uses fixture identities only. Diagnostics, screenshots, QR artifacts, browser profiles and local configuration are excluded from the commit. A staged-file and historical-file privacy scan runs before commit; existing historical author metadata is not rewritten.

The successful live test needed two engineering recoveries, so an uninterrupted corrected live end-to-end run remains unmeasured. The normal corrected pipeline is integrated and offline-tested; the real bot handoff itself is verified. Actual 08:00 release behavior remains unobserved, independently of the completed post-selection handoff. Zero lead, bounded ordinary reloads, strict date barrier, one-pass grid snapshots and deterministic preferences remain unchanged.
