# Offline API-booking prototype

This directory is an isolated, offline architecture experiment. It does not invoke or replace the production Chrome coordinator. Live availability, reservation creation, availability-proof generation, live checkout transfer, and payment automation are disabled. A synthetic checkout handoff runs in tests and the demo.

## Fixtures

- `onda-availability-snapshot-2026-09-17.json` is a historical fixture, not current availability. It contains three dates (September 17-19, 2026), seven courts, 336 hourly records, and 13 historically available records. Court/space UUIDs remain; schedule/period identifiers are pseudonymized. No cookies, customer data, security tokens, checkout tokens, or availability proofs are retained. The file alone does not prove capture provenance.
- The pre-existing `tests/availability-fixture.ts` remains the separate synthetic all-open fixture. Tests identify historical and synthetic inputs explicitly.

The investigation report says the browser request covered September 17-23; the fixture itself contains only September 17-19. Date-level flags are never treated as proof that requested hours are open, and availability is never treated as proof of a reservation.

## Flow

`AvailabilityProvider -> AvailabilityParser -> BookingPlanner -> ReservationProvider -> CheckoutHandoff`

Only fixture-backed/mock providers exist. Standard plans require 1-3 consecutive hours. Extended plans use two sequential checkout chunks, in the same split order as the Chrome planner: 3+1, 2+2, 1+3 for four hours; 3+2, 2+3 for five; and 3+3 for six. Each chunk selects its own courts, with overlap preferred. `maximumTotalPrice` is retained as a legacy field name but means a limit **per court in each chunk**. This models Chrome product behavior, not an observed Onda multi-hour API contract.

The coordinator creates a stable logical booking identity independent of run ID and records intent states: submitting, confirmed failure, unknown, partial, held, checkout failure, and handoff ready. Confirmed mock hold evidence is retained before checkout preparation. Unknown, partial, expired, and checkout-failed outcomes remain blocked for reconciliation within the intent store. The default store is **in memory only**; passing the same store to multiple coordinators only shares protection inside one process. There is no cross-process lock, durable journal, restart recovery, provider idempotency, or authoritative reconciliation implementation. The mock response fields and expiration checks are offline contracts, not proof of Onda's live behavior.

The report confirms a browser-observed one-hour `public-checkout` POST producing a pending booking, hold expiration, and checkout token. It does not establish multi-hour payloads, provider idempotency, atomic multi-court submission, safe replay, or independent checkout transfer. The parser accepts missing unavailable slots and extra harmless metadata because the capture does not establish a fixed grid or rigid envelope contract; contradictory dates, slots, and prices still fail closed. A false date-level flag paired with an available slot fails closed because its meaning is unknown.

Reservation conflicts stop the offline flow. Chrome's bounded conflict replan depends on verified cleanup and a fresh availability read; the mock reservation interface has no authoritative cleanup or reconciliation operation, so automatic resubmission is not modeled.

Run the offline demonstration with:

```powershell
npx tsx src/api-booking/demo.ts
```

All output and timing are labeled synthetic or `MOCK timing`. They do not demonstrate release-time performance.

## Live integration gate

Before adding any live provider, obtain from Onda:

- Written permission and automated-access scope.
- Supported availability and reservation interfaces.
- Approved authentication and credential-storage requirements.
- Approved availability-proof workflow, if applicable.
- Multi-hour and multi-court request/atomicity semantics.
- Conflict, reconciliation, duplicate-submission, and idempotency rules.
- Rate limits and release-time operating constraints.
- Checkout-session handoff and browser/process portability requirements.
- Hold expiration, cancellation, renewal, and payment-status semantics.
- A sandbox or an explicitly supervised test plan.
- Durable intent records, transactional uniqueness and locking across processes, restart recovery, and authoritative reconciliation before any retry.

Do not derive these contracts from captured browser traffic. Turnstile, cookies, customer identifiers, proofs, and checkout tokens must never be fabricated, replayed, logged, or committed.
