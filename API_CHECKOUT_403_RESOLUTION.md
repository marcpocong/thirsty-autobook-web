# API checkout 403 resolution

Status at **2026-09-18 02:09 Asia/Manila**: The prior checkout was rejected with HTTP 403, but the exact server rule is **not established**. The 02:00:05 attempt remains `unknown` in the durable journal. The user's confirmation that no reservation was created is based only on public availability, which cannot authoritatively identify that customer's bookings or transaction. No new checkout POST, hold, official QRPH page, or payment occurred in this investigation.

## Previous attempt and reconciliation

The journal record `.local/api-booking/submission-journal/ca3d4b28720677734aeec133f295ab191c4101560c14e54a5e6502383b9560ab.json` records Court 6, September 18, 12:00–14:00, two hourly bookings, PHP 1,200 maximum, created at 02:00:05.615 Manila and marked `unknown` at 02:00:05.804. The `supervised-one-shot.json` permit was consumed. Browser Resource Timing recorded HTTP 403 for the single POST, but neither the response body nor a booking ID was retained. A later open slot does not prove there was no booking or transient hold. The journal has no implemented reconciliation operation; `mark` only transitions from `dispatching`, and `begin` rejects an existing logical key. Neither file was deleted or changed. There is no authorized basis to close this record as a confirmed failure.

To reconcile, an Onda/Thirsty Pickle operator or provider-supported lookup must search the exact facility, customer, Court 6, date, both hours, PHP 1,200, and 02:00:05 attempt time, including pending, expired, cancelled, and failed records and linked transactions. A dated result identifying zero matching bookings/transactions, or the exact matching booking outcomes, must be retained as evidence. Public availability alone does not satisfy this requirement. Any later booking requires a fresh exact approval and a separately journaled intent; the prior logical key and consumed permit remain blocked.

## 403 investigation

Confirmed: The experimental request omitted `X-Turnstile-Token` and `X-Onda-Public-Fingerprint`. The current public checkout call site invokes `getPublicBookingTurnstileToken()` and `getPublicFingerprintId()` together and passes their results to `createBookingTransaction`; the service conditionally emits those headers. The failed request used the same-origin browser tab with `credentials: same-origin`, a resolved customer ID, a two-item request, and two fresh distinct hourly proofs. The normal browser flow also performs facility membership/customer preparation and holds additional UI state. Its current payload can use null first/last name and a null `voucherCode`; the experimental builder sends configured names and omits that voucher field. These are observed differences, not proven causes of a 403. The server did not provide a retained error body, and no accessible staff/server diagnostic identified the rejected condition. Missing verification headers are a plausible explanation only.

The Onda helpers are module-local in the public frontend, with no documented global or supported independent binding. The existing `normal-site-security-context.ts` accepts caller-supplied helper functions, but no legitimate callable source for those functions has been established. An interactive challenge could be completed by the user in Onda's normal flow, but the independent runner cannot currently obtain that flow's fresh checkout context without entering the site's selection and review path. The production transport was preserved. No token was fabricated, captured, replayed, or sent by this work.

## Experimental diagnostics change

The experimental headerless transport now carries the observed HTTP status, a coarse `http-rejection` or `invalid-response` category, and a strictly allowlisted application code when the response supplies one. The two-hour adapter persists those fields with an `unknown` journal outcome after dispatch. The existing browser-session transport can carry the same sanitized HTTP rejection detail. The journal rejects malformed diagnostic fields and continues to exclude response text, contact data, cookies, fingerprint, Turnstile token, and availability proofs. A 403 is kept `unknown` until provider-state reconciliation; a transport timeout has no status diagnostic. The prior attempt cannot be retroactively given an application code or body.

This diagnostic change does not make the independent checkout transport ready for submission. There is no supported helper binding, authoritative reconciliation, or fresh exact approval for another attempt. The one-shot runner is still pinned to the prior Court 6 tuple and refuses the existing journal and consumed permit. It must not be used again for that tuple.

## Fresh candidate and result

At **02:08:31 Manila**, the read-only availability API still listed Court 6 on September 18 from 12:00–13:00 and 13:00–14:00 at PHP 600 per hour, PHP 1,200 total. Two read-only slot checks returned distinct valid proofs; values were discarded. Availability and proof stages measured **578 ms** and **428 ms**, **1,006 ms** total within the process. This is a time-specific candidate, not a reservation. The historical exact approval covered the 02:00 one-shot headerless assessment; another checkout POST needs new approval after the blockers are resolved.

No new checkout was submitted, so there is no new server response, pending booking, booking/session/transaction ID, hold expiry, or official QRPH page to validate. Payment remains manual and was not attempted. The challenge is incomplete; completion requires Onda's final confirmed booking after manual payment.

## Verification

`npm run typecheck`, `git diff --check`, and four relevant offline test files passed (**16 tests**). The tests cover the 403 diagnostic being persisted as sanitized metadata while the journal remains `unknown`, as well as the one-shot guard, normal transport and response validation. No experimental changes were merged into main.
