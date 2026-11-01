# Provider-verified pending hold recovery

## Purpose and boundaries

HTTP 200, local response validation, provider persistence, checkout access, QR readiness and payment are separate facts. The recovery system verifies an **existing** reservation and opens its official checkout. It never submits another booking, consumes a submission permit, recycles a target, changes a customer binding, clears a booking lock, cancels a reservation or pays.

The November 1 [historical incident](incidents/2026-11-01-release/README.md) remains unresolved. The original seven UNKNOWN children are not reclassified by this feature or by offline replay. Existing submission-journal `verified` semantics remain local response validation for compatibility; independent provider/QR facts are in separate records and the Pending Holds view.

## State model

Each private capture has an append-only `hold-verification/` history beside it. Its latest record has independent `local`, `provider` and `qr` fields, response/journal hashes, a sequence, application-session correlation, diagnostic, contradiction flag, optional HTTP status and sanitized milestones.

| Fact / state | Evidence required | What it does not prove |
|---|---|---|
| `RESPONSE_CAPTURED` | Complete private recovery envelope published and flushed before subsequent validation/navigation | Local validity, persistence or payment |
| `LOCAL_RESPONSE_VALID` | Strict current response validator matches the original plan at capture time; exact original journal intent matches | Active provider hold |
| `PROVIDER_HOLD_CONFIRMED` | Official authenticated booking lookup independently returns the complete matching active pending group | QR readiness or payment |
| `QR_READY` | Provider confirmation plus exact official booking URL/order and visible, loaded canvas/image | Payment or a final paid booking |
| `PAYMENT_CONFIRMED` | Exact provider group/amount/identity match, with authoritative paid and confirmed/completed statuses at root and every row | A payment operation performed by this app; none exists in recovery |
| `UNKNOWN` | Malformed/mismatched data, denied access, timeout, provider error, missing identity or unresolved contradiction | That nothing was created |
| `EXPIRED_OR_UNAVAILABLE` | Matched provider expiry/cancellation state, official 410, or official 404 after the advertised window | Permission to clear submission history or retry its target |

A past advertised deadline alone is not a provider-confirmed terminal outcome. `HTTP 200 → LOCAL_RESPONSE_VALID → official 404 before advertised expiry` remains `UNKNOWN`, with `contradiction=true` and `PROVIDER_404_BEFORE_ADVERTISED_EXPIRY`.

Every operator recovery performs fresh reads. Application restart invalidates active confirmations from the prior session; an old `QR_READY`/confirmed snapshot is historical evidence, not an active-hold assertion. Even within the same app session, active confirmations age out after 30 seconds and the view refreshes locally. No periodic provider polling is started by discovery.

## Private capture and crash durability

`saveCheckoutRecovery` writes version 2 of `checkout-recovery-private.json` in the exact original target/child directory. Version 1 remains readable without migration or rewriting.

The envelope retains the necessary booking/session/access identities, transaction reference, pending states, amounts, expiry and exact plan. It contains hashes of the original HTTP body, projected response and plan, and, for newly integrated production captures, an original customer/contact/profile binding. The original-body digest is provenance; the stored payload is an allowlisted recovery projection, not a blind copy of unrelated contact/cookie fields. A malformed HTTP 200 still gets a capture receipt/digest but cannot claim local validity or provider success.

Publication uses a private temporary file, complete write, file flush, exclusive hard-link publication, another file flush and POSIX directory flush. Node does not expose directory fsync on Windows; the file/hard-link flush follows the existing durable armer's approach. New files use mode 0600 and new directories 0700; Windows also relies on the existing user-owned installation/private directory ACLs. No request cookies, credentials, challenge/fingerprint values or unrelated customer contact fields are copied into the recovery projection.

Canonical capture files are write-once. Disk/write/link/flush failures fail closed. A failure writing a later verification receipt cannot erase an already published response. If capture itself fails, the system does not invent a captured state or authorize another submission. Where an exact UNKNOWN journal exists but its observed-response IDs could not be written after a successful capture, recovery may verify that immutable capture against the same original intent. It never backfills IDs, rewrites the journal or recreates a permit. Any existing contradictory journal IDs still fail.

Verification snapshots are separately immutable, numbered files. Exclusive sequence publication and bounded collision retries prevent concurrent receipt overwrite. Duplicate/conflicting sequences or changed capture hashes refuse trust rather than selecting arbitrary evidence.

## Independent official provider verification

The implementation follows the official Onda court-v2 client flows retained in the incident evidence:

- `GET /api/public/bookings/booking-no/{bookingNo}?checkoutToken=...&grantCheckoutAccess=1` grants original checkout access.
- `GET /api/public/bookings/{bookingId}` is the official client `getBooking` lookup and returns booking state/group data.

The first call's HTTP status alone never confirms a hold. The second call must independently establish the exact booking ID/number set, facility, registered spaces, dates, complete hourly boundaries, rates, customer identity, total, pending states, resumability and expiry. Returned session identities, when exposed, must match the saved response. Equivalent minute/second time formats and exact midnight-UTC service-date representations are accepted; no date rollover or time shifting is performed. Missing, partial, duplicate, extra or mismatched groups fail visibly. An unsupported/new provider schema fails closed and requires investigation.

Recovery follows the official court-v2 resume order: look up the original booking first. A successful lookup is fully validated before any returned checkout token can be used. A provider-issued token from that matching lookup may replace the stale captured capability in memory; it is never borrowed from another booking/customer, logged, or written over the original capture. Missing returned tokens fall back to the original captured token or the official page's existing session flow. Malformed nonempty tokens are refused.

If the initial lookup returns 401/403 and an original token exists, recovery may perform the official access grant with that token and repeat the same original-ID lookup once. If neither access path is authorized, recovery stops visibly; it never creates a replacement booking or bypasses provider authentication. A grant failure after a fully validated active lookup retains independent hold proof while marking the QR recovery failed. Verification-only actions do not grant access after a successful lookup.

Version 2 captures bind the original configured customer/contact/profile to the current configuration. Provider resolved customer IDs must also match the original response. Legacy captures lack that original binding, so the official lookup must additionally return the matching configured name, email and normalized phone. Missing legacy identity evidence is an actionable refusal, not permission to skip the check.

Reads use same-origin credentials, no-store, no redirects and a ten-second timeout. There are at most two transport attempts per read operation. The initial lookup, optional grant, and single post-grant lookup therefore have a hard maximum of six GET attempts combined. Only transient read/transport failures, 5xx and eligible 429 responses receive transport retries. Numeric Retry-After is honored; date-based Retry-After uses the server Date header plus a precision allowance. A missing/unusable throttle delay or a delay over two seconds is surfaced rather than shortened or waited out in a hidden background retry. 401/403 use only the bounded original-token access flow described above; 404/410 and identity mismatches stop without access or booking retries.

## Recovery and QR identity

`recoverPendingHold` revalidates the saved response, exact durable intent and immutable file hashes, then binds the original worker/profile/customer. It records read-start/read-result milestones around the legitimate access and lookup operations. Provider confirmation is flushed before QR navigation, so a browser or rendering failure does not erase independent hold evidence.

After confirmation, it navigates only to the original official checkout URL. The final origin/path/booking-ID query must match. The existing exact court/date/hourly/aggregate summary checker rejects missing, duplicate, extra and unrelated rows. Labelled totals must match exactly; amount matching no longer accepts a larger amount that merely contains the expected digits.

Both canvas and `img[alt="Payment QR code"]` are supported. A QR must be visible and have nonzero dimensions; an image must be fully loaded with nonzero natural dimensions. A visible QR on a wrong booking URL/order, or without independent provider confirmation, cannot reach `QR_READY`. This is official presentation readiness, not a payment confirmation or an independently decoded QR settlement result.

Booking mutations are blocked throughout recovery: public-checkout creation, legacy public-booking creation and other booking writes are aborted. Only the official client's observed read-only conflict-check POSTs are exempt, so the site's own passive checks can still run. Recovery itself calls only the supported GET/access operations and navigation. It never calls booking creation, payment completion, checkout release or cancellation. The official page may create its normal payment-QR request as part of displaying QR; no funds are paid and no payment button is clicked by this system.

## Concurrency, failures and restart

The desktop service serializes operator recovery. A separate cross-process claim set serializes recovery within each worker, while independent workers remain isolated. Every contender publishes its complete unique claim before inspecting other claims. Another live or uninspectable owner causes refusal; simultaneous contenders may both refuse, but cannot both proceed. Completed operations remove only their own claim. A crashed process's claim remains evidence and is ignored only when its PID is proven absent; reused or uninspectable PIDs remain blocking. This is not an automation/submission lock and does not release any hold.

External operator/CLI recovery refuses an active dispatcher/armed lock. A retained held lock is a valid read-only recovery context. An orphaned past-dispatch lock requires a proven absent owner and no future deadline; it is not deleted. Automatic scheduled handoff still uses the existing dispatcher's post-critical callback (strict bookkeeping/QR starts no earlier than T+1000 ms). No trigger, deadline, offset, shot count, concurrency or permit policy changes.

After restart, discovery scans only the known journal store, refuses symlink scope changes, identifies captures by opaque directory hashes and displays corrupt records as unresolved. It does not navigate, submit, clear a lock or poll Onda. Current confirmation is tied to the app session and exact capture hash. Snapshot history and original journals remain separate.

## Operator procedure

1. Open **Activity → Records & archive → Pending Holds & Recovery**.
2. Review worker/wing/court/date/hours/amount, advertised expiry, local state, provider state, QR state and latest diagnostic. An unresolved or elapsed advertisement remains visible.
3. Choose **Recover Existing Checkout** for a fresh tab in the original worker profile, or **Recover in original tab** to reuse a matching existing checkout. Ambiguous unrelated original tabs are refused; they are not discarded.
4. The app requires idle state: no armed/scheduled release, active runner, Test Lab or simultaneous recovery. Other booking/config actions are blocked during recovery.
5. Only `PROVIDER_HOLD_CONFIRMED` plus `QR_READY` is a successful unpaid recovery. If access, identity, provider or QR checks fail, review the diagnostic and original booking/account evidence. Do not create a replacement for an UNKNOWN attempt.
6. Payment remains manual. A QR, elapsed timer or local response alone is never payment confirmation.

The CLI uses the same controller:

```powershell
# From the recognized, updated canonical installation root:
npm run checkout:recover -- --list
npm run checkout:recover -- --recover <opaque-id> fresh
npm run checkout:recover -- --recover <opaque-id> original
# Original-directory compatibility remains supported:
npm run checkout:recover -- <original-journal-directory>
```

Live actions require the canonical installation detector to pass the running runtime's provenance/content checks. A source checkout or manually mixed runtime is refused; there is no alternate installation or force flag. Installation safety and read-only recovery are distinct: an existing hold/UNKNOWN does not itself authorize an update, nor does it inherently forbid legitimate recovery of its original identity. The updater's existing lifecycle restrictions remain unchanged.

## Browser rotation for authorized tests

Rotation does not release a provider hold. `eligibleRecoveryTestWorkers` requires verified profile/customer, clean browser, no active runner, and no outstanding/unresolved saved hold on that worker. It never clears a lock or resubmits another worker's ambiguous target. Test target eligibility additionally requires fresh legitimate availability, supported plan parameters, non-overlap with reservations/holds and duplicate-safe journals. The helper's result alone is not booking authorization.

Prefer sequential experiments: prove and track A's existing hold; move only to a different eligible worker and different freshly open slot; preserve A's private capture, verification history and QR. If none is eligible, perform offline/read-only checks until lifecycle and installation gates permit a safe experiment. There is no fixed owner test-count/hour cap, but no limit may be evaded by browser rotation.

## Observability and clocks

Public snapshots/IPC contain only allowlisted state, opaque correlation/hash, diagnostic codes, HTTP status and milestones. No checkout token, customer contact, raw body, private URL or profile contents are returned to the renderer, CLI logs, GitHub or CI. Browser/Node exceptions containing URLs are converted to bounded diagnostic codes.

Wall timestamps are explicitly `NODE_WALL` or `TRUSTED_NETWORK` according to the caller. Elapsed values use `NODE_MONOTONIC`. Provider expiry is retained as an advertised provider field, not a provider commit timestamp. Local timings do not establish server receive/commit order. Access 200, lookup 404 and QR failure remain individually recorded; no provider commit evidence is fabricated.

## Qualification

See the [initial implementation report](PENDING_HOLD_RECOVERY_IMPLEMENTATION.md) and [subsequent installation/authentication follow-up](PENDING_HOLD_AUTH_RECOVERY.md). Source tests and intercepted browser tests do not establish installed/live qualification. The first implementation's integrity/lifecycle blockers prevented new live testing. The owner subsequently authorized a scoped canonical installation exception; the installed old-record check returned 401 and did not establish a recoverable hold. No substituted source/runtime was used for that live check.
