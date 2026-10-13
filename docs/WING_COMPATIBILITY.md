# Wing compatibility (October 14, 2026)

The public Onda page now contains fourteen courts. `court-registry.ts` records their verified facility/space identities as `MANGO:1` through `MANGO:7` and `BUKO:1` through `BUKO:7`. A display number is not a provider ID. Every historical numeric booking court remains Mango; no saved configuration or strategy is rewritten.

Mango automation remains the supported adapter. Buko identities are verified, but automated Buko booking is **disabled**: its actual availability response body and checkout compatibility could not be verified, and its recurring release policy is unknown. The Strategy view states this and disables Buko selection. Buko is not automatically added to a Normal or Shotgun authorization.

## Public observations

On [Onda's public booking page](https://app.onda.fit/book/thirsty-pickle), both wings share facility `5f8786bd-dc61-4509-b893-74cda8f783f7`. Mango court names gained a mango emoji. Buko has overlapping court numbers and seven separate UUIDs; see the registry and investigation report for the full inventory.

Observed metadata: Mango daily 08:00–24:00; Buko Monday–Thursday 16:00–24:00 and Friday–Sunday 08:00–24:00. Maintenance varies by court/date, so these hours never establish availability. Mango weekend daytime metadata is PHP 700; Buko weekend daytime metadata is PHP 600; both show PHP 700 evening pricing. The registry's metadata is informational. Existing per-slot/checkout amount validation remains authoritative.

At approximately 02:07 Manila on October 14, the page said Mango bookings open through October 15 and Buko through October 19. Facility metadata says `3 days` / `08:00:00`. This agrees with Mango's existing two-calendar-day target offset: before today's 08:00 release, yesterday's target is today + 1; today's next target is today + 2. It does not prove Buko's recurring release instant or inclusive counting. Buko stays unknown rather than assigning it five days or inheriting 08:00.

## Boundaries

- The strict API parser defaults to Mango and excludes only registry-verified Buko spaces. It reports `excludedSpaceIds`. Any truly unknown UUID still raises `AVAILABILITY_UNKNOWN_COURT`; malformed Mango records still fail closed.
- `parseAvailability(..., { wing: 'BUKO' })` supports read-only, explicitly scoped inspection with overlapping display numbers. `planBooking` rejects a Buko snapshot as `BOOKING_WING_NOT_ENABLED`. Checkout mappings, worker topology and journals stay Mango-only.
- Browser grid validation checks all column identities, then validates the original complete 112-cell Mango subset. It accepts old and new Mango names, rejects unknown columns, and rejects any preselected Buko cell. Missing/ambiguous Mango state remains unknown.
- Read-only availability URLs now include the observed `slotDateMode=web-operating-day`. This does not bypass access controls; direct GETs returned HTTP 403 in this investigation. No successful live API response is claimed.
- `wing-release-policy.ts` provides independent, explicitly evidenced policies, Manila target-date calculation and fresh cell-based workflow classification. Only an exact empty response before a verified release permits `PREPARE_FOR_RELEASE`. Already-open cells select `BOOK_AVAILABLE_NOW`; partial/missing cells remain unknown; fully booked requires explicit records for every requested cell. This foundation does not enable Buko or replace existing Mango scheduling.
- Existing Mango defaults, operator-configured release settings, saved `PRECISION_PHASE3`, court priorities, prices, customer profiles and emergency controls remain unchanged. There is no data migration or private configuration write.

## Before Buko automation can be enabled

Capture sanitized successful responses from the authorized normal Chrome session, compare per-space publication/pricing/slot proofs, verify an independently evidenced release policy, and implement the wing identity throughout setup, compiled authorization, proofs, frozen payloads, response validation, QR summary, locks and recovery. Use intercepted checkout fixtures to verify the exact Buko UUIDs. A real transaction requires separate owner authorization. Registry discovery alone is insufficient.

Do not widen the Mango numeric mapping to 1–14 or insert Buko at the front of a saved seven-court priority array. Do not interpret a facility-wide available date as proof that both wings have published every court.
