# Checkout authentication recovery follow-up

The canonical `7bfa40b` installation passed its provenance and preservation checks on November 1. Its read-only Browser B recovery of the earlier November 3 Court 7, 08:00–11:00 capture received HTTP 401 from the original-token access-grant endpoint at approximately 23:18 Manila. The hold's advertised expiry had already elapsed. No new booking or payment was made; 401 did not establish why authentication failed or whether the provider reservation existed.

## Controller defect and repair

The first controller attempted the captured-token access grant before the independent booking lookup. A denied/stale captured capability therefore prevented the original browser profile from even trying the legitimate booking-ID read. Onda's retained court-v2 frontend instead calls its `getBooking` operation first and uses the matching lookup's checkout token for subsequent access.

The repaired controller follows that order:

1. Read the original booking ID using the original verified profile/customer context.
2. Strictly validate the complete booking/group, original resolved customer identity, legacy contacts when required, facility, court, service date, hours, amount, pending state and expiry.
3. Only after that validation, use a well-formed provider-issued checkout token from this same lookup in memory. If none is returned, use the captured token or the official page's existing session flow. Original private captures are never overwritten.
4. If the first lookup requires authentication (401/403), try the original captured-token grant and repeat the original-ID lookup once. Denied access remains visible; there is no credential guessing, alternate account, unrelated capability, or replacement booking.
5. Preserve independent provider hold evidence if a later access/QR step fails. Verify-only success does not request a grant or open a checkout.

This is a capability-refresh path supported by the official checkout flow, not a bypass of Onda authentication. If both official paths refuse authentication, the reservation remains unresolved. An expired or missing hold cannot be revived by this repair.

## Validation boundaries

The focused recovery/persistence/restart suites passed **89 tests**. Browser regression coverage additionally exercises a stale captured token with a legitimate matching lookup capability, a lookup unlocked by its original grant, access denied after independent confirmation, canvas/image/fresh-tab QR handling, mismatched identities/orders and zero booking POSTs. These browser cases use fully intercepted fixtures; they are not evidence of a fresh real Onda hold.

The final source commit, CI result, subsequent canonical installation and any read-only live result are reported with task completion and retained in workflow/local maintenance evidence. The original morning HTTP 200/early-404 contradiction is not reclassified by this follow-up. Original UNKNOWN journals and their duplicate blocks stay unchanged.
