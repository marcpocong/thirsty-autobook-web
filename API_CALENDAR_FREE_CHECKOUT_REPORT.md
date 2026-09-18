# Calendar-free checkout experiment, September 18–19, 2026

## September 19 live result

One newly authorized, calendar-independent reservation POST was sent for
Thirsty Pickle Court 2, September 20, 12:00–13:00 Asia/Manila, PHP 700.
Fresh live availability and an exact-hour slot proof preceded the POST.
Onda returned HTTP 200 with one pending booking, booking number `BK-B99B5BE8`,
booking ID `b99b5be8-f927-4ff8-a5e7-864b33ae5e8a`, a pending PHP 700
transaction, and a hold expiry of September 19, 05:41:33 Asia/Manila.

The initial one-hour validator rejected the response because the booking object
omitted `facility_id`. The response did include the correct facility ID in its
booking session. The transport had already saved the raw HTTP result in the
ignored, private one-shot journal, so the ID and checkout token were recovered
without another POST. The validator now accepts an omitted booking-level
`facility_id` while checking any supplied value and the required session value.
The one-hour offline test covers this observed response shape.

The saved checkout token granted official booking access via HTTP 200. The
verified Chrome profile opened Onda's booking-ID route and displayed Pending,
a live hold countdown, a PHP 700 order summary, and its QRPH payment panel.
No payment was made. The screenshot and raw checkout response are in the ignored
`.local/api-booking/submission-journal-session-20260919-second/` directory;
the raw file contains private checkout data and must not be published. The
original Court 5 and Court 6 journals remain separate and unresolved.

The following sections describe the earlier September 18 state and remain as
historical context.

## Outcome

No new reservation POST, pending booking, QRPH handoff, or payment occurred.
The September 18, 02:00:05 Asia/Manila Court 6 attempt remains `unknown` in
the ignored durable journal; its original one-shot permit remains consumed.
The prior HTTP 403 response body is unavailable, so its exact cause is unknown.

## Current checkout path and rejected-request differences

The current Thirsty Pickle page loaded the same court checkout, transaction
service, and challenge chunks as the saved local copies. Fresh GETs of those
chunks returned byte-identical content. The court handler resolves a customer,
requests its `public_booking_checkout` Turnstile token and FingerprintJS visitor
ID concurrently, builds hourly items, obtains fresh `is-slot-available` proofs
for each hour, then calls `createBookingTransaction`. The service posts to
`/api/bookings/public-checkout`. On acceptance, the UI stores returned booking
IDs, numbers, checkout token if present, sessions, and pricing before entering
checkout state. QRPH payment request creation occurs later in that official UI.

The rejected experiment used the verified Onda tab, same-origin cookies, a
resolved customer, and two distinct fresh proofs. It omitted the Turnstile and
fingerprint headers, acquired proofs before any checkout verification, and sent
first and last names as strings. The current normal court handler sends both
names as `null`. It omits an empty voucher and empty add-ons; the experiment
also omitted those optional fields. The experiment explicitly sent `Accept:
application/json`, used no-store and redirect rejection. None of these
differences proves which server rule caused the 403. Cookie values and
server-side session state at the successful and failed attempt times were not
captured or compared.

## Concrete calendar-free probes

An isolated, read-only headless Chrome tab loaded the Onda venue. FingerprintJS
5.2.0 returned a nonempty visitor ID before the 112-cell grid was ready. A
separate challenge probe loaded Cloudflare Turnstile in the same origin without
waiting for the grid, but the interactive challenge did not complete within
60 seconds in that headless tab. Neither probe called `public-checkout`, created
a hold, or logged a token or visitor ID. The original dedicated Chrome debug
endpoint was closed, so the normal interactive session was not tested.

## Code and diagnostic changes

- The two-hour adapter now obtains checkout context before final hourly proofs.
- Both checkout builders send the observed `null` name fields for the resolved
  customer. The configured name remains validated locally for customer binding.
- `calendar-free-security-context.ts` runs the public booking challenge and
  pinned FingerprintJS 5.2.0 in the Onda page, without a calendar read.
- `calendar-free-checkout.ts` provides a gated supervised entry point requiring
  a fresh live snapshot, exact approval, prior-attempt reconciliation reference,
  and caller-supplied durable journal. It has no automatic production runner.
- Future checkout rejections retain only status, response format, application
  versus edge hint, bounded error hint, safe application code, and valid
  Cloudflare ray ID. Raw response text and verification values are excluded.
  The previous 403 cannot be retroactively diagnosed from these fields.
- `diagnostics-archive/2026-09-18/` contains a sanitized export of all 294
  current `DiagnosticsLocal` files, with a manifest. The ignored originals and
  private API submission journal were not changed.

## Validation and next gate

Typecheck and 103 API-booking offline tests passed. The submission gate is
closed by default. Before another live POST, an authoritative Onda result must
resolve the previous unknown attempt, an interactive session must produce a
fresh checkout challenge result, and a fresh exact court/date/hours/price and
possible hold effect must be presented for user approval. One approved POST
would then need pending booking/session/transaction/expiry validation and an
official QRPH page check. Payment remains manual.
