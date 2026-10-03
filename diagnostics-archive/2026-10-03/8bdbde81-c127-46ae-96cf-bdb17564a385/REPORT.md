# October 3 live release: run-matched, sanitized evidence

Run `8bdbde81-c127-46ae-96cf-bdb17564a385` targeted October 5, 2026. The release instant was October 3 at 08:00 Manila (`2026-10-03T00:00:00Z`). This directory is a publication copy, not the live runtime. It contains the run progress, matching Slot Watch, provider and critical-path traces, Phase 3 freeze, booking activity, three clock checkpoints, and regenerated final forensics. SHA-256 hashes are in `manifest.json`. Opaque booking, candidate, session, and provider references have consistent `REF_###` pseudonyms; the run and observer IDs are retained for association.

## Observed result

- Four immediate targets were configured: A Court 6 22:00–24:00, B Court 7 22:00–24:00, C Court 1 20:00–23:00, D Court 2 21:00–24:00. The saved run used two children per target. Six immediate children sent POSTs between −46.2 and +6.0 ms; all six received HTTP 409 after roughly 14–18 seconds. B's and D's second children were omitted by prewarm and never sent. The Phase 3 ceiling was 14 (eight configured immediate opportunities plus three Wave 2 and three Rescue), not 20 or 26; the proposed shotgun ladder was not used for this run.
- Slot Watch's first answer containing the target date completed at +6.580 seconds. That represented 82 open and 30 unavailable court-hours. A later read at +608.196 seconds showed Court 6's 22:00–24:00 window reopening. This is observed grid state, not proof of why it changed.
- Rescue Worker E sent the Court 6 22:00–24:00 POST at +608.313 seconds. It received HTTP 200 in about 746 ms. The run recorded both a verified pending hold and a QR handoff. The regenerated forensic row now says `VERIFIED_PENDING_HOLD_QR_HANDOFF`; the previous `unsettled` text reflected a missing `PHASE3_SETTLED` event for this Rescue path, not a lack of hold verification.
- The final run outcome was `OBJECTIVE_ACHIEVED`. Payment was manual; this archive does not establish that the hold was paid or converted to a completed booking.

## Timing and interpretation limits

Offsets are relative to the trusted release clock. At T−30 seconds its network-clock estimate was +941.4 ms with ±22.3 ms uncertainty; Slot Watch's clock differed from dispatch by −5.1 ms. The six early POSTs establish browser request-event timing, while browser Network and runner events establish response timing. They do not establish provider receipt order, server queueing, an advantageous early-send cutoff, or why the provider returned 409. The first published grid was requested more than six seconds after those POSTs, so it is not the grid state at their dispatch. Reopening is bounded by observer reads and may have occurred between them. A verified pending hold plus QR handoff is not payment.

## Publication boundary

This copy intentionally omits checkout response bodies, customer identities/contact details, credentials, profiles, browser storage, private configuration, payment URLs, QR payloads, locks, and live journals. Scalar timing, court/hour, status, and event fields remain. `REF_###` aliases are deterministic within this one export only; do not join them to aliases from another archive. Raw runtime evidence remains outside Git. The exporter refuses mismatched run/observer identifiers and checks the booking activity's start/end timestamps. Re-run `node scripts/publish-oct3-run.mjs` from `Source` to regenerate the sanitized files and manifest.
