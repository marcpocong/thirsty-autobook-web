# Headerless checkout investigation

Status: offline construction complete. Server requirement **UNKNOWN**. No live `public-checkout` POST, reservation, checkout handoff, or payment occurred.

## 1. Existing evidence and assumptions

The normal Oonda Fit site was observed sending `POST /api/bookings/public-checkout` with `X-Turnstile-Token` and `X-Onda-Public-Fingerprint`. Its current public JavaScript obtains those values through the site's Turnstile and fingerprint helpers before its own checkout call. The captured call site conditionally attaches the headers. Those observations establish the normal site's behavior; they do **not** prove the server rejects a request with either header absent. No Oonda Fit public checkout contract documenting required or optional headers was found in the repository or Oonda Fit's public site. The accommodation API at `onda.me` is a different service and supplies no contract for `onda.fit` court booking.

Our requirement is in `src/api-booking/browser-session-transport.ts`: `publicCheckout` refuses to proceed when its caller cannot provide nonempty current Turnstile and fingerprint values, then adds both headers. `src/api-booking/normal-site-security-context.ts` models those normal-site helpers, but no supported callable binding has been established. The existing transport's same-origin browser cookies and successful availability/proof calls do not establish checkout acceptance without verification.

The observed one-hour normal-site checkout produced a pending booking and hold. A later observed two-hour checkout used two separate hourly availability proofs, two items sharing `sessionRef: 'session_1'`, and returned two pending bookings in one booking session with a common hold and pending transaction. The relevant request shape includes a current client/customer identity, facility, booking type, customer names/contact fields, and for each hour the exact space, date, start/end, rate, charged amount, duration, guest count, proof, and session reference, plus the observed null optional fields. These are observed fields, not a provider guarantee that every field is independently required. Three-hour, multi-court, and Extended API submissions remain unobserved.

## 2. Isolated code change

`src/api-booking/headerless-checkout-experiment.ts` constructs an **offline-only** request description for a standard, one-court, 1–3 hour plan. It calls the existing `buildStandardPublicCheckoutRequest`, so plan, customer, exact hourly proof association, and amount limits remain enforced. It retains the observed endpoint, POST method, same-origin credentials, redirect and cache settings, JSON content type, Accept header, and identical body. Its only intended header difference is omission of `X-Turnstile-Token` and `X-Onda-Public-Fingerprint`.

The description has `mode: OFFLINE_HEADERLESS_CONSTRUCTION` and `dispatchAllowed: false`. It has no browser, fetch, permit, or send method. It does not alter `OndaBrowserSessionTransport`, the supervised gate, durable journal, one-shot permit consumption, response validation, Chrome, hybrid, or desktop booking methods. No headerless live dispatch path was added or enabled. Fixture customer/proof values are synthetic; no real customer, proof, cookie, token, or fingerprint value is stored in this investigation.

## 3. Offline tests

Commands run:

```text
npx vitest run tests/api-booking/headerless-checkout-experiment.test.ts tests/api-booking/browser-session-transport.test.ts tests/api-booking/public-checkout.test.ts tests/api-booking/two-hour-reservation.test.ts
# 4 files passed; 22 tests passed
npm run typecheck
# passed
git diff --check
# passed for tracked changes; new files were inspected directly
```

The synthetic comparison confirms the body and normal fetch settings match the existing builder and that precisely the two observed security headers are omitted. Negative tests retain customer, proof identity, and maximum-price rejection. Existing transport and durable one-shot tests still pass. These tests do not exercise Oonda's server.

## 4. Live-test eligibility and result

The public Oonda Fit site does not establish an authorized headerless checkout test route or sandbox. Absence of public documentation is **not proof** that Oonda forbids the request or that the server requires these headers. It is insufficient to classify a verification-free reservation POST as an authorized integration. The site has also shown an interactive Cloudflare challenge during a prior payment-summary investigation; this observation does not prove how `public-checkout` validates headers.

No exact date, court, duration, price, customer details, or expected hold effect was prepared for a live attempt, because the authorization condition was not met. No attempt-specific user approval was requested. **No live POST was performed.** Actual server response: **NOT MEASURED**. Genuine pending reservation: **NOT CREATED OR VERIFIED**. Whether Oonda requires either header: **UNKNOWN**.

## 5. Official checkout handoff

No API-created reservation exists to inspect. `src/api-booking/checkout-restoration.ts` has a disabled handoff flag, URL construction, and a validator for an official checkout state; it does not prove that a booking ID is a valid payment token or navigate to a payment page. Official checkout access after an API-created hold remains **UNVERIFIED** and is a separate blocker. No checkout URL was invented or visited for this experiment.

## 6. Remaining blockers and next step

Ask [Oonda Fit](https://onda.fit/contact) for a written integration/test route covering whether either checkout header is required, approved verification or sandbox behavior, fresh proof lifetime, exact request contract, duplicate and unknown-outcome reconciliation, hold lifecycle, and supported transfer of a pending booking into official checkout. If Oonda explicitly authorizes a headerless checkout test, prepare one already-released noncompetitive slot with exact court/date/hours/price/customer source and expected booking effects, then obtain the user's approval for that specific one-shot attempt. Keep the existing durable journal and no-retry behavior. A successful HTTP status alone would still require validated pending-booking evidence and a separate official checkout handoff test before API-first production use.
