# API-first booking experiment

## Checkout boundary update (September 18, 2026)

The currently served court checkout bundle calls `getPublicBookingTurnstileToken()`
and `getPublicFingerprintId()` together, then obtains a fresh proof for each
hourly item, then calls `createBookingTransaction`. The browser page currently
loads the same checkout, transaction-service, and challenge chunks as the saved
source trace. The site request path and the rejected direct request compare as
follows; the site values are from its live-served client code and earlier
sanitized successful checkout observation, not a second live submission here.

| Field or stage | Normal court checkout | Rejected API attempt |
| --- | --- | --- |
| Page and cookies | Onda page; fetch defaults to same-origin cookies | Verified Onda page; `credentials: same-origin` |
| Customer | Resolves customer through public customer flow when needed | Existing resolved customer ID, contact-bound locally |
| Verification | Fresh `public_booking_checkout` Turnstile and FingerprintJS visitor ID, then checkout headers | Both checkout headers absent |
| Final hourly proofs | One fresh `is-slot-available` call per hour after verification | Two fresh distinct proofs before checkout, acquired before verification stage |
| Customer names in POST | `customerFirstName: null`, `customerLastName: null` | Both sent as strings |
| Two-hour items | Per-hour amount, 60-minute duration, proof, shared `session_1` | Same observed item shape and shared `session_1` |
| Optional fields | Empty voucher omitted; add-ons omitted when empty | Both omitted |
| Transport options | `Content-Type` and conditional verification headers | Also sent `Accept`; explicit no-store and redirect error |
| Result evidence | Earlier normal flow returned pending bookings and transaction | Resource Timing reported HTTP 403; response body was lost |
| Official payment handoff | After acceptance, client stores booking IDs, numbers, checkout token, amount and sessions, then adds `bookingId` to its URL; QRPH request uses booking and checkout access | No accepted response, booking ID, checkout token or QRPH page |

The old response body was lost, so **none of these differences is a confirmed
cause of the HTTP 403**. The old journal and consumed permit remain untouched.

`calendar-free-security-context.ts` now performs the public
`public_booking_checkout` Turnstile challenge and FingerprintJS 5.2.0 in the
Onda page, without reading the calendar. The two-hour adapter obtains this
context before fresh hourly proofs and sends the corrected name fields. The
new `calendar-free-checkout.ts` entry point requires a fresh live snapshot,
exact approval, a prior-attempt reconciliation reference, a separate one-shot
gate, and a journal supplied for the new attempt. No production runner invokes
it automatically. Its use still requires authoritative reconciliation of the
September 18 02:00:05 unknown attempt and fresh, exact approval.

An isolated headless Chrome probe obtained a FingerprintJS visitor ID before
the 112-cell grid was ready. It loaded the Turnstile widget without waiting for
the grid, but the challenge did not complete in that headless session within
60 seconds. This does not establish that the token will be obtained or accepted
in the supervised normal browser. No new checkout POST or hold was created.
`checkout-diagnostics.ts` now retains only HTTP status, response format,
application versus edge hint, bounded error category, safe application code,
and a valid Cloudflare ray ID. It never stores response text or verification
values. These diagnostics apply only to future responses; the old 403 body
cannot be recovered from the journal.

The desktop booking setup now exposes three explicit methods: `browser` (the
existing normal flow), `hybrid` (same-browser API discovery intersected with the
UI flow), and `api-first` (read-only API discovery and planning). The API-first
method never implies that a reservation or payment is enabled; the UI labels the
missing current security-context and official-checkout integration explicitly.

This directory is isolated from the production Chrome coordinator. Onda's owner has authorized use of publicly available APIs for this project. A read-only live availability provider is available. Real reservation creation is disabled by default; payment automation and live checkout transfer are absent. A synthetic checkout handoff runs in tests and the demo.

## Experimental two-hour reservation boundary

The subsequently confirmed normal-site workflow checks each selected 60-minute hour with `is-slot-available`, receives a distinct `availabilityProof` bound to that court/date/hour, and submits two items in one `public-checkout` request with `sessionRef: "session_1"` on each. The observed result has two pending bookings in one `bookingSessions` entry, a shared hold expiry, and a pending transaction. This evidence applies to one court for two hours only. It does not establish a three-hour, multi-court, or Extended API submission contract.

`two-hour-reservation.ts` now contains the isolated offline reservation boundary: exact plan and proof checks, two separate proof calls with the observed body fields, construction of the observed two-item checkout body, a durable cross-process duplicate guard, a disabled-by-default `ONDA_EXPERIMENTAL_TWO_HOUR_SUBMIT=SUPERVISED_ONE_SHOT` gate plus explicit `{ supervisedOneShot: true }` call argument, and strict pending-response checks. A lost or malformed response is classified as unknown and requires reconciliation; the journal never silently permits a retry. The journal stores no proofs or customer/session material. `durable-submission-journal.ts` uses atomic create and durable writes; retain and inspect its directory across restarts.

The observed endpoints are `POST https://app.onda.fit/api/public/is-slot-available` and `POST https://app.onda.fit/api/bookings/public-checkout`, both with JSON bodies. Normal Chrome DevTools showed cookies on both. Checkout showed `X-Turnstile-Token` and `X-Onda-Public-Fingerprint`; neither custom header was visible on slot checks, and Authorization was not visible on either request. Header presence alone does **not** establish which fields the server requires.

`browser-session-transport.ts` now wires these two requests through an existing page at the configured Onda URL. It never launches Chrome or Playwright. Browser fetch uses same-origin credentials and no cache, so it uses the page's current cookies without copying or storing them. Checkout requires a caller-provided `CurrentCheckoutHeadersProvider` to supply current Turnstile and fingerprint values immediately before dispatch. The transport neither generates nor retrieves those values, and it will not submit without them and a durable one-shot permit. No live CLI is provided; real submission remains disabled by default.

Public source trace (September 17): `445pzov5_5spg.js` module `709892` contains Onda's interactive Turnstile helper with booking action `public_booking_checkout`. `1y9e760opu2ka.js` module `139691` defines `getPublicFingerprintId`: it lazy-loads module `482561`, calls FingerprintJS `load({ monitoring: false }).get()`, validates `visitorId`, and caches that promise in the page module. The loaded `0z8ms2a5pmnd4.js` bundle identifies FingerprintJS 5.2.0. `1vw2uo7rgshl5.js` is the actual court checkout call site: it awaits `getPublicBookingTurnstileToken()` and `getPublicFingerprintId()` together, then passes both to `publicTransactionsService.createBookingTransaction`. That service is module `139289` in `1y9e760opu2ka.js` and posts to `/api/bookings/public-checkout`, conditionally adding the two headers. The distinct `publicBookingService.createBooking` in `35vw98cw658m8.js` posts to `public/bookings` and is **not** substituted for this checkout.

`normal-site-security-context.ts` models that exact helper pair with no cached values. Its Turnstile call may remain pending while a person completes Onda's normal interactive challenge. The captured modules do not expose those helper functions as documented globals, so this code does not inject a replacement challenge, reach into Turbopack internals, or claim the normal-site helper binding is established.

The experimental `NormalSiteSecurityHelpers` interface is an offline boundary. No supported binding from the existing page to these functions has been established, so a supervised live API test is not ready. Checkout handoff and payment are also unverified and are not automated here. No new reservation was made during this implementation.

### Decision after the normal Chrome global check

The normal Onda tab's `Object.getOwnPropertyNames(window).filter(name => /fingerprint|turnstile/i.test(name))` returned `[]`. This only rules out matching own properties at that moment; it does not establish that the helpers are inaccessible. A separate HTTP 429 has no identified endpoint or checkout relationship and is not used to infer a checkout limit or requirement.

### Original Chrome session check (September 17, 2026, evening Manila time)

A read-only probe used `browserIdentity('A')`, `verifyDedicatedChrome`, and `chromium.connectOverCDP` from the original bot against its recorded port 19222 and `.local/onda-chrome-profile`. Process/profile verification returned `CDP_VERIFIED`; exactly one tab matched `ONDA_URL`. The page showed the venue title and grid elements without challenge text. No new browser or profile was launched, and production Chrome code was unchanged. The normal `attach` function still requires the grid in `assertPage`; this probe attached through the same verified CDP mechanism without calling that grid assertion.

From that exact tab, a same-origin availability GET for the already-released September 19 date returned HTTP 200 and four open hourly slots. No consecutive two-hour candidate appeared in that snapshot. The page's current public client lookup returned HTTP 200 and a client identifier associated with the expected facility. Two fresh `is-slot-available` calls through `OndaBrowserSessionTransport.checkSlot` succeeded and each included a nonempty proof field (Court 1 at 13:00 and Court 3 at 23:00). These were separate available hours, not a two-hour reservation candidate. Proof values, cookies, client identifiers, and response bodies were not logged or stored. No `public-checkout` request, hold, or payment action occurred.

This establishes that availability and individual proof requests work from the original verified Chrome session without using the grid as an input. It does **not** demonstrate a live request before the grid renders: the grid was already present during this run. The experimental two-hour adapter's plan and proof stages do not read the grid, but its live checkout still has no supported binding to Onda's current `getPublicBookingTurnstileToken` and `getPublicFingerprintId` calls. Same-session cookies did not supply or validate a checkout Turnstile token. The site's own checkout call invokes those helpers inside its UI flow; invoking the normal UI flow remains dependent on selection and review screens. A grid-independent API reservation has therefore not been demonstrated, and a supervised API submission is not ready. The disabled checkout gate and durable journal remain intact.

**Recommended next path: API availability and planning, then Onda's normal browser confirmation.** The existing production `AVAILABILITY_DISCOVERY_MODE=hybrid` already performs same-browser availability GET, strict UI intersection, normal Review and Payment Summary checks, Terms, and the site's own final action. Its default remains `ui`. The experimental read-only preview can also plan candidates, but passing its `BookingPlan` into the Chrome selector is not an established interface. Do not send its proofs or use the experimental `public-checkout` transport for the browser path. Before opting into hybrid locally, complete the documented read-only `availability:compare` and `race:dry` validation in `HYBRID_AVAILABILITY_REPORT.md` on a verified clean dedicated Chrome session; investigate any API/UI disagreement or access restriction rather than proceeding. Normal checkout and manual payment then remain under the existing Chrome safety gates. No production Chrome files are changed by this decision.

**Alternative: Onda Fit-supported API checkout integration.** Ask Onda Fit for a documented integration contract or partner route for the court `public-checkout` operation, including the supported authentication/security-context flow, permitted test environment, idempotency and reconciliation, rate limits, hold lifecycle, and browser checkout handoff. The observed HTTP schema, per-hour proof validation, pending-response validation, journal, and one-shot gate can be reused once that contract is supplied. The public site bundles describe the site's private checkout implementation, not an external integration contract. The similarly named `onda.me` hospitality developer portal is a different service and does not establish Onda Fit support. Until Onda Fit provides a supported route, leave live API checkout disabled.

Read-only candidate preview:

```powershell
npx tsx src/api-booking/preview-live.ts 2026-09-18 18:00 3 1 1800 7,6,5,4,3,2,1
```

Arguments are target date, start time, duration in hours, court count, maximum PHP price per court per chunk, and comma-separated court priority. This performs one public availability GET and prints a candidate or a no-candidate reason; it cannot create a booking. The provider pins `https://app.onda.fit`, omits credentials, refuses redirects and non-JSON responses, and validates the response before planning. `capturedAt` is the local receipt time, not a server-signed freshness proof.

## Fixtures

- `onda-availability-snapshot-2026-09-17.json` is a historical fixture, not current availability. It contains three dates (September 17-19, 2026), seven courts, 336 hourly records, and 13 historically available records. Court/space UUIDs remain; schedule/period identifiers are pseudonymized. No cookies, customer data, security tokens, checkout tokens, or availability proofs are retained. The file alone does not prove capture provenance.
- The pre-existing `tests/availability-fixture.ts` remains the separate synthetic all-open fixture. Tests identify historical and synthetic inputs explicitly.

The investigation report says the browser request covered September 17-23; the fixture itself contains only September 17-19. Date-level flags are never treated as proof that requested hours are open, and availability is never treated as proof of a reservation.

## Flow

`AvailabilityProvider -> AvailabilityParser -> ApiAvailabilityEngine -> BookingPlanner -> FreshSlotProofs -> PublicCheckoutBuilder -> ResponseValidator -> OfficialCheckoutState`

`availability-engine.ts` is the grid-independent discovery boundary. It makes one
exact-date provider request, parses the response, ranks bounded deterministic
candidates, and records monotonic request/response/parse/selection timings. It
does not import Playwright or wait for the visual calendar. `slot-proofs.ts`
performs bounded fresh proof acquisition and preserves the proof-to-hour
association. `public-checkout.ts` builds and validates standard one-court 1–3
hour observed-schema requests; it is a preparation boundary, not authorization
to submit them.

The live availability provider and fixture-backed mock share the parser and planner. Standard plans require 1-3 consecutive hours. Extended plans use two sequential checkout chunks, in the same split order as the Chrome planner: 3+1, 2+2, 1+3 for four hours; 3+2, 2+3 for five; and 3+3 for six. Each chunk selects its own courts, with overlap preferred. `maximumTotalPrice` is retained as a legacy field name but means a limit **per court in each chunk**. This models Chrome product behavior, not an observed Onda multi-hour API contract.

The existing mock coordinator creates a stable logical booking identity independent of run ID and records intent states: submitting, confirmed failure, unknown, partial, held, checkout failure, and handoff ready. Confirmed mock hold evidence is retained before checkout preparation. Unknown, partial, expired, and checkout-failed outcomes remain blocked for reconciliation within its intent store. That coordinator's default store is **in memory only**; passing the same store to multiple coordinators only shares protection inside one process. The separate two-hour adapter now has a durable journal, but it is not wired into the mock coordinator. There is no provider idempotency or authoritative reconciliation implementation. The mock response fields and expiration checks are offline contracts, not proof of Onda's live behavior.

The historical report confirms a browser-observed one-hour `public-checkout` POST producing a pending booking, hold expiration, and checkout token. The later two-hour observation is described above. Neither establishes provider idempotency, atomic multi-court submission, safe replay, or independent checkout transfer. The parser accepts missing unavailable slots and extra harmless metadata because the capture does not establish a fixed grid or rigid envelope contract; contradictory dates, slots, and prices still fail closed. A false date-level flag paired with an available slot fails closed because its meaning is unknown.

### Two-hour browser observation (September 17, 2026)

In a separate normal Chrome session, selecting Court 3 on September 18 from 08:00 to 10:00 and clicking the **first Proceed** reached Review Booking. The page displayed one reservation card with two hourly rows: 08:00–09:00 and 09:00–10:00. A fresh read-only API availability preview selected the same court and interval at PHP 1,200. This is a browser observation of selection behavior, not evidence of a submitted two-hour reservation payload.

Between selection and Review Booking, the captured same-origin Fetch/XHR traffic contained a `POST /api/public/facilities/{facilityId}/member-only-court-slots` request shaped as `{ clientId: string, customerId: null, slots: [{ spaceId, date, startTime, endTime }] }`. Its `slots` array contained 112 entries (the calendar grid), not just the selected two hours. The response had `{ success: boolean, data: object }`. A `GET /version.json` returned version metadata. Neither observed request or response contained an `availabilityProof` field. No `public-checkout` request occurred and final confirmation was not clicked. This does not rule out proof data held elsewhere in browser state or created at final confirmation.

This section records the earlier incomplete browser observation. The later two-hour proof and checkout structures are documented above. Three-hour submission and checkout handoff remain unobserved.

### Supervised two-hour investigation stopped before submission

An authorized normal-browser test attempted to advance the same two-hour selection through Player Information. The player-to-summary step made `POST /api/public/check-facility-member` requests shaped as `{ email: string, clientId: string, facilityId: string }`; responses were HTTP 200 with `{ success: boolean, isMember: boolean }`. No `availabilityProof` field appeared in those observed bodies. The site then displayed “We could not prepare your payment summary. Check your connection and try again.” A Cloudflare challenge request failed and a challenge response returned HTTP 401 during this step. These observations correlate with the failure; they do not establish its definitive cause or the site's required challenge mechanism. No challenge was bypassed.

The Payment Summary and final confirmation were never reached **in that investigation**. There was no `public-checkout` POST, pending hold, checkout page, or payment action in that run. Later normal-site evidence supplied the two-hour request and response schemas documented above. No raw customer fields, cookies, proof values, or security tokens are retained here. The live transport remains disabled pending endpoint and session verification.

Reservation conflicts stop the offline flow. Chrome's bounded conflict replan depends on verified cleanup and a fresh availability read; the mock reservation interface has no authoritative cleanup or reconciliation operation, so automatic resubmission is not modeled.

Run the offline demonstration with:

```powershell
npx tsx src/api-booking/demo.ts
```

All output and timing are labeled synthetic or `MOCK timing`. They do not demonstrate release-time performance.

## Reservation and checkout gate

Authorization is established. Before enabling reservation submission, establish through Onda's normal workflow or documentation:

- Exact authentication and session requirements for `public-checkout`.
- Legitimate source and lifetime of `availabilityProof` without fabrication or bypass.
- Multi-hour and multi-court request/atomicity semantics.
- Conflict, reconciliation, duplicate-submission, and idempotency rules.
- Rate limits and release-time operating constraints.
- Checkout-session handoff and browser/process portability requirements.
- Hold expiration, cancellation, renewal, and payment-status semantics.
- An explicit supervised-test control for the first real submission.
- Durable intent records, transactional uniqueness and locking across processes, restart recovery, and authoritative reconciliation before any retry.

Do not derive these contracts from captured browser traffic. Turnstile, cookies, customer identifiers, proofs, and checkout tokens must never be fabricated, replayed, logged, or committed.
