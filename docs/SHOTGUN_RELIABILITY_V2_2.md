# Shotgun V2.2: release-boundary preparation

V2.1's published-slot qualification remains historical evidence for its tested installed build. This phase does not infer actual 08:00 qualification from that evidence, synthetic tests, or successful CI.

## Opt-in release timing

`STRATEGY_V2.shotgun.releaseTimingPolicy = "ZERO_BOUNDARY_V1"` deliberately limits the first release pilot to one strict attempt at nominal release. Booking Setup exposes this choice inside the existing Shotgun editor. Selecting it changes the draft; Save and exact-plan authorization remain separate operations. Old plans with the field absent retain their literal schedules and fingerprints. No stored offset is migrated.

The policy requires budget 1, window 0..0, one exact offset 0, no group shift, and no Wave 2 or Rescue. Compilation, persisted schema and production arming reject mismatches rather than rewriting them. The policy is included in the objective fingerprint, saved-plan fingerprint and frozen attempt fingerprint. It still uses `SHOTGUN_STRICT`, its trusted no-early gate, per-shot 50 ms deadline, renderer calibration and one-use permit. No second dispatcher exists.

This policy avoids depending on unqualified pre-release acceptance. It does not prove that Onda publishes at nominal 08:00, that clock uncertainty is zero, or that a zero-offset attempt will win. Grid observation may lag publication, so the policy does not add a grid polling wait to the trigger path. Positive scheduled offsets remain unsupported and rejected. Negative schedules remain available only as explicitly reviewed legacy plans; they have no new release qualification.

## Evidence from the production lifecycle

The existing critical-path record retains Node dispatch, browser command/renderer entry, calibrated fetch, observed request event, response headers and completion. The header now records trusted-clock source/uncertainty and explicitly says provider receipt time is unobserved. Existing calibration bounds remain mandatory for cross-domain conversion; missing calibration produces nulls.

Additional per-attempt Node-monotonic marks distinguish locally valid response completion handling, first provider lookup request, independently validated provider confirmation, official checkout navigation and exact usable QR. Recovery emits immediate sanitized trace events; observer exceptions cannot change recovery. `localResponseHandled` is a completion-handler observation after local validation/bookkeeping, not a claim to the exact validation instruction's execution time. `providerLookup` is the request stage before its persistence/GET, not a provider receipt timestamp. These observations preserve recovery queue delay rather than subtracting it away.

Metadata links the original private response hash, provider classification, final recovery code and remaining advertised lifetime when the QR becomes usable. Full original identities, every provider read and immutable journal checks remain in private recovery evidence. A provider 200 lookup is confirmed only after all original identity/group/hour/amount/expiry checks pass. A before-expiry 404 has no confirmation, navigation or QR trace and stays UNKNOWN. The existing narrow terminal-hour reconciliation is unchanged.

The sanitized checkout diagnostic now distinguishes Onda's explicit unavailable-date message as `date-unavailable`; generic unavailability remains separate. Payment-in-progress and verification precedence are retained. This classification neither retries nor changes the request's durable outcome.

## Publication and provider restrictions

Use the existing isolated read-only Slot Watch for publication request/response windows and first observed date/cell availability. Slot Watch observations are availability evidence, never reservation proof. Its polling schedule and provider limits were not expanded. Correlate its trusted clock and read windows with the exact release run; do not subtract unrelated host-wall timestamps.

During preparation on November 2, both the unauthenticated read-only adapter and the legitimate configured A browser's official availability GET returned HTTP 403. No retry through other identities, challenge workaround, creation request or live booking was performed. Availability remains UNKNOWN. Provider access and current publication rules must be revalidated legitimately before live readiness. The first process also printed a Windows libuv shutdown assertion after reporting the 403; this is new retained evidence, not proof of the historical native crash's cause.

## Next operational target and readiness

The owner's correction selects Mango Courts 5, 6 or 7, 19:00–22:00 for the next release, preserving the prior one-court objective. The configured verified Mango +2-day/08:00 Manila calendar computes November 3 at 08:00 for service November 5. This is a calendar calculation; the blocked live read did not independently reconfirm the provider rule today.

Prepare a separate exact draft: primary Court 5, alternatives 6/7 retained for review, one worker A, one POST, PHP2,100 maximum based on the existing PHP700/hour evening reference, `ZERO_BOUNDARY_V1`, no automatic fallback, payment or cancellation. No short-lived submission permit or future armed run is created by a draft. Revalidate the actual rate, identity, overlap, provider permissions, genuine normal-window security, current installed build, clock and strict calibration close to release. Never reuse the V2.1 exhausted budget or a historical attestation. A failed provider gate yields `RELEASE_BLOCKED`.

Historical November 4 targets/journals remain untouched. Local maintenance uses the existing fresh one-use owner-attested, source/hash-bound procedure; it never recycles an UNKNOWN target or a booking permit. Actual release qualification still requires an observed creation, independent full-interval active confirmation and exact official QR before expiry. No future execution is implied by this document.
