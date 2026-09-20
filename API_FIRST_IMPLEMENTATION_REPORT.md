# API-First Experimental Implementation Report

Status: implementation complete for the safe, offline-testable and read-only boundaries. Independent live reservation submission remains disabled.

## Repository state

- Branch: `feature/api-booking-experimental`
- Implementation commit: recorded in Git history; see `git log -1`.
- Target venue: Thirsty Pickle through Oonda Fit
- Working tree: clean after the implementation commit and remote push.
- Payment: manual only; no QR extraction, payment request, confirmation, OTP, PIN, or provider client was added.

## Architecture

The API-first path is:

`AvailabilityProvider -> AvailabilityParser -> ApiAvailabilityEngine -> BookingPlanner -> FreshSlotProofs -> PublicCheckoutBuilder -> ResponseValidator -> OfficialCheckoutState`

The availability engine makes one exact-date request, validates the response and configured court/space mapping, ranks bounded deterministic candidates, and records monotonic timing stages. It has no Playwright or visual-grid dependency. The existing browser and hybrid engines remain separate and available.

The desktop setup now has an explicit booking method:

- `browser`: existing normal browser flow.
- `hybrid`: existing same-browser API discovery plus strict UI intersection.
- `api-first`: read-only API availability/planning preview. The UI does not arm live API checkout.

## Implementation status

### IMPLEMENTED

- Exact-date API availability discovery with strict envelope, slot, date, price, boundary, freshness, and known-court validation.
- Deterministic candidate ranking for standard 1–3 hour and existing Extended planning shapes, with bounded enumeration.
- Fresh per-hour proof acquisition with bounded concurrency, exact proof association, optional response identity checks, freshness checks, and duplicate-proof rejection.
- Standard one-court 1–3 hour observed-schema checkout request construction, including resolved customer names and exact hourly items.
- Strict pending-response validation for booking count, courts, date, hours, duration, session grouping, pending statuses, common future hold, trusted total, transaction, and maximum amount.
- Durable sanitized submission attempt metadata and one-shot permit consumption.
- Distinction between conclusive pre-dispatch failure and uncertain post-dispatch failure in the browser transport. Uncertain outcomes are journaled and cannot be automatically retried.
- Explicit API-first booking method in the Electron setup and a read-only API preview action.
- Official-checkout URL construction and state validator. No unsupported navigation or payment automation is enabled.

### OFFLINE TESTED

- Availability parsing, court mapping, malformed/unknown/duplicate data, date and freshness checks.
- Candidate ranking, fallback starts, court priority, consecutive-hour planning, price limits, one/two/three-hour and two-court planning.
- Fresh proof success, bounded concurrency, failure, unavailable slot, identity mismatch, stale/duplicate/missing proof.
- Checkout serialization, customer validation, wrong court/date/duration/amount, duplicate booking, expired hold, transaction and grouping mismatch.
- Durable locking, supervised one-shot gate, pre-dispatch rejection, uncertain outcome retention, and no-repeat behavior.
- API-first Electron preparation/preview boundary, browser disconnection safeguards, and official checkout state validation.

### LIVE READ-ONLY VERIFIED

The repository contains prior evidence for same-session availability and individual slot-proof requests through the verified dedicated Chrome session. That evidence is time-specific and does not establish release-time performance or a grid-independent live reservation.

### LIVE RESERVATION VERIFIED

Not verified. No API-first reservation was submitted during this implementation.

### LIVE PAYMENT HANDOFF VERIFIED

Not verified. No API-created reservation was restored in official Oonda checkout.

### BLOCKED

The current normal-site Turnstile and public-fingerprint helper binding is not a supported external integration in this repository. The browser transport accepts only fresh caller-supplied values and never fabricates, persists, replays, or harvests them. Oonda has also not supplied a documented independent `public-checkout` contract, idempotency/reconciliation rules, or a supported transfer of an API-created pending booking into the dedicated browser checkout context.

To remove this blocker, Oonda Fit must provide an authorized integration route for current verification, proof lifetime and use, checkout submission, duplicate/reconciliation behavior, hold lifecycle, and official checkout restoration.

### NOT TESTED

- A real API-first checkout POST.
- Multi-hour or multi-court independent API checkout beyond the isolated builder/validator boundaries.
- API-created official checkout restoration.
- Any payment action.

## Configuration and read-only test

In the desktop control panel, choose `API-FIRST EXPERIMENTAL`, save the booking plan, press `Reset & Prepare`, then use `API-First Read-only Preview`. This performs availability discovery only and reports candidates/timings in sanitized Activity output. It does not create a hold.

The equivalent CLI is:

```powershell
npm run api:preview -- 2026-09-19
```

Use an exact already-released test date. Do not use this command as evidence that checkout or payment is ready.

## Performance

The new engine records `requestDispatchedMs`, `responseReceivedMs`, `parsedMs`, `candidateSelectionMs`, and `totalMs` using monotonic timestamps. Offline tests validate ordering and bounded proof concurrency. No uninterrupted 08:00 live performance claim is made. Human verification, server delay, browser navigation, and local processing must be measured separately in any future supervised run.

## Safety controls

- Live API checkout remains disabled unless the existing supervised one-shot environment gate and per-call authorization are both present.
- Current verification values are never written to the journal, diagnostics, UI, fixtures, or logs.
- A dispatched-but-uncertain checkout is recorded as `unknown`; the lock/journal is retained and no fallback or retry is automatic.
- The existing normal browser flow, hybrid flow, release scheduler, locks, retained-hold protection, terms authorization, and manual payment boundary remain in place.
