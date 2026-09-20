# Onda checkout verification integration

Status at **2026-09-18 02:12 Asia/Manila**: The normal site's checkout verification path is traced, but a supported binding from the independent API runner to Onda's live verification helpers is **not established**. The prior 403's exact cause is unknown. The 02:00:05 intent remains blocked. No new checkout, hold, QRPH handoff, or payment occurred.

## 1. Established normal-site checkout path

The four relevant live public bundles were fetched on September 18 and their SHA-256 hashes matched the repository's copies byte for byte: [Turnstile helper](https://app.onda.fit/_next/static/immutable/chunks/445pzov5_5spg.js), [court checkout call site](https://app.onda.fit/_next/static/immutable/chunks/1vw2uo7rgshl5.js), [transaction service and fingerprint helper](https://app.onda.fit/_next/static/immutable/chunks/1y9e760opu2ka.js), and [public booking service](https://app.onda.fit/_next/static/immutable/chunks/35vw98cw658m8.js).

From the court Payment Summary, the normal UI's final reservation handler resolves a customer ID if needed, then awaits `getPublicBookingTurnstileToken()` and `getPublicFingerprintId()` concurrently. It builds hourly checkout items, calls `checkSlotAvailability` for each non-class item to attach a fresh `availabilityProof`, and passes the request and both verification values to `publicTransactionsService.createBookingTransaction`. The service posts to `/api/bookings/public-checkout` and conditionally attaches `X-Turnstile-Token` and `X-Onda-Public-Fingerprint`. A successful result is checked for bookings, then the UI collects booking IDs, a possible checkout token, session/pricing data, and enters its checkout state.

The Turnstile helper is module `709892` in `445pzov5_5spg.js`. It uses Onda's configured site key and the `public_booking_checkout` action, loads Cloudflare's official Turnstile script if needed, renders and executes its widget, and waits for callback or failure/expiry/timeout. It can place the widget near the recent submit control or in a fixed overlay. This is Onda's own interactive verification; it may require a person's participation. The fingerprint helper is module `139691` in `1y9e760opu2ka.js`. It lazy-loads FingerprintJS, calls `load({ monitoring: false }).get()`, validates a bounded visitor ID, and caches the promise in the module. Neither helper reads the selected calendar cells. The checkout call site itself does depend on the selected-item and review state.

**Scope of the contract:** Every observed call through this normal court checkout handler asks both helpers for values. The service adds each header only when the corresponding value is present. The public frontend does not prove whether the server requires both on every checkout, whether either is bound to a cookie or customer, or which missing condition produced the previous 403. The server's validation rules and an external integration contract were not available. Successful normal-browser traffic showed both headers and same-origin cookies; the rejected experimental request omitted both headers while using same-origin browser credentials. Their exact cookie contents or equivalence at the two attempt times were not established.

## 2. Successful normal checkout compared with the rejected request

| Aspect | Successful normal flow | 02:00 experimental request | Conclusion |
| --- | --- | --- | --- |
| Verification | Fresh checkout Turnstile helper and public fingerprint helper invoked; both headers observed. | Both headers absent. | Established request difference; server requirement and 403 cause unproven. |
| Customer | Normal flow resolves a customer ID before checkout when needed. | Configured ID was resolved through Onda's official customer flow and validated against the user's contact. | No established wrong-customer evidence. |
| Session | Browser sends same-origin cookies. | Same-origin browser fetch used `credentials: same-origin`. | Cookie values and server-side session state were not compared. |
| Items and proofs | Two hourly items with distinct fresh proofs and shared `sessionRef: "session_1"` were observed in successful two-hour traffic. | Same validated two-item arrangement and fresh distinct proofs were used. | Proof freshness and shape are supported locally; server acceptance was not shown. |
| Payload details | Current UI sets first/last name to null in this handler and includes `voucherCode: null` when no voucher applies. | Builder sends configured first/last name and omits `voucherCode`. | Additional differences, not known 403 causes. No speculative payload edit was made. |
| Result | Two pending bookings, one booking session, common hold expiry, pending transaction in historical observation. | HTTP 403; response body and booking IDs were not retained. | No pending result was verified from the experimental request. |

The current UI also derives guest count, promotion, activity, surcharge, optional add-ons, and session references from its review state. Historical successful two-hour evidence covers the ordinary single-court, two-hour case. It does not establish that every optional field is mandatory or that the experimental request was otherwise identical at the server boundary.

## 3. Verification bridge finding

The helpers are exports inside Onda's bundled module system, called by its own checkout component. The inspected page and repository expose no documented public browser function, endpoint, callback, or deep link for an outside caller to request Onda's `public_booking_checkout` verification independently. The prior verified-tab check found no matching Turnstile/fingerprint own properties on `window`; this limited observation does not prove no internal path exists. `window.turnstile` is Cloudflare's widget API, not an Onda-supported checkout context bridge. Calling module internals, reproducing the widget, or harvesting values from the site's final action would not establish a supported integration and was not implemented.

At the helper level, the Turnstile widget and fingerprint calculation appear independent of calendar rendering. At the application level, the only established invocation is inside the normal checkout handler after UI selection and review. Thus **calendar-independent verification is plausible in Onda's implementation, but unavailable to this runner through a verified supported interface**. `normal-site-security-context.ts` already accepts legitimate caller-supplied helper functions; there is no callable source to pass it. No integration code was changed or live submission enabled. The production browser and hybrid paths remain as they were.

The exact missing contract is an Onda-supported way to request a fresh `public_booking_checkout` token and public fingerprint in the verified browser session, including allowed origin/session binding, challenge UI, expiry, one-time use, and whether the result may be supplied to an independently constructed checkout POST. Onda also needs to specify the checkout payload, idempotency/reconciliation, and supported pending-booking handoff.

## 4. Prior intent and first-party lookup

The 02:00:05 journal is still `unknown`, and its one-shot permit remains consumed. The private runner has no sanitized response file or verified-hold file from that attempt. Public Resource Timing recorded HTTP 403, but the response body was lost. The observed first-party public booking service supports `GET public/bookings/{bookingId}` and the page's restoration checks `canResumeCheckout`; it needs a booking ID that this attempt did not return. The observed booking-number grant route likewise needs a booking number and checkout token. No authenticated first-party history or provider search by facility/customer/date/time was available in this session. Public availability cannot reconcile the unknown intent.

An Onda/Thirsty Pickle operator or provider-supported query must identify bookings and linked transactions for the exact customer, Court 6, September 18, 12:00–14:00, PHP 1,200, near 02:00:05 Manila, including expired or cancelled records. A dated authoritative result is required before closing the unknown outcome. The journal was not reset, and the previous checkout was not repeated.

## 5. Result and next executable step

No new availability snapshot was taken for a prospective submission: the requested sequence places that refresh after verification integration and journal reconciliation. The 02:08:31 Court 6 availability in `API_CHECKOUT_403_RESOLUTION.md` is historical. No new exact booking approval was requested because the checkout verification bridge and reconciliation are unresolved. No request was submitted, so there is no new reservation or official QRPH page. Payment remains manual.

The next executable step is to obtain from Onda an authoritative lookup result for the prior attempt and a supported checkout verification interface or integration contract. Once those are available, bind the existing isolated transport to the legitimate fresh helper results, verify it offline, refresh availability and proofs, then present the exact court, date, hours, price, and hold effect for a new one-shot approval. A successful POST would still need strict pending booking, session, transaction, expiry, official restoration, and QRPH page validation before the user pays.

No code change was made in this phase, so no new test run was needed. The earlier diagnostic changes remain on the experimental branch and were not merged into main.
