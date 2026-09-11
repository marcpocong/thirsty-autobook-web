# Postmortem and release-path V2

Implemented against the existing thirsty-autobook-web repository. Selection, checkout and payment implementation files were not changed.

## Today's observed baseline

These are the supplied September 11, 2026 production observations, not measurements of V2.

| Measurement | Baseline |
|---|---:|
| Scheduler error | +4 ms |
| Nominal release to reload commit | ~339 ms |
| Trigger to reload commit | ~335 ms |
| Reload commit to shell ready | ~18.18 s |
| Shell ready to target enabled | ~865 ms |
| Target enabled to target click | ~32 ms |
| Target click to heading | ~18 ms |
| Failure | RATE_LIMITED at ~19.476 s after nominal release |

The old shell combined multiple waits, so the 18.18-second delay cannot yet be attributed specifically to the trial click. The old response monitor retained no triggering hostname, so today's rate-limit origin cannot be recovered from the supplied telemetry. V2 provides evidence for both questions on the next measured run. No live latency improvement is claimed yet.

## Implementation

| Requirement | Result |
|---|---|
| Trial click removed from shell | YES |
| Shell substage monotonic telemetry | YES: URL; venue attached, visible, verified; picker attached, visible, enabled; shell ready |
| Pre-open calendar | YES, implemented and fixture-tested; OFF by default pending live stability verification |
| Enabled-without-reload path | YES, when pre-opening is enabled |
| Immediate fallback reload | YES; at most two reloads, existing retry delay preserved |
| Onda-only response rate-limit hard stop | YES |
| Third-party false-positive protection | YES; records thirdPartyRateLimited |
| Sanitized immediate-stop evidence | YES; buffered before synchronous abort listeners execute |
| Strict target grid | PRESERVED; both paths also perform full snapshot validation before targetGridReady |
| Release lead | 0 ms |
| Checkout/payment behavior | Unchanged |
| Resource blocking experiment | Not implemented; no evidence yet justifies blocking resources |

`RELEASE_PREOPEN_CALENDAR=false` is the new default in the release/config schemas and `.env.example`. Explicit `true` enables preparation after final preflight: normal picker click, unique visible target, expected unavailable state for a future horizon, unchanged booking snapshot, and expanded calendar. No target day or slot is clicked during preparation. Preparation that runs past release fails before arming.

When opted in, release performs exactly one immediate DOM evaluation of the existing target. If it is unique, visible and enabled, the normal target click executes immediately and then enters the shared strict grid barrier. Otherwise, the first reload starts immediately. A missing, hidden or ambiguous pre-opened target also takes the conservative reload fallback. There are no observation retries, pre-release availability polling, additional network probes or negative release lead.

Live Onda calendar stability has not been tested in this change. Keep pre-opening disabled until a controlled live observation verifies it remains open and booking state stays unchanged across the final-preflight interval. Fixture success is not evidence of live hydration behavior.

Rate-limit host ownership is exactly `onda.fit` or a hostname ending in `.onda.fit`. Every owned 429 stops. Meaningful Retry-After means positive integer delay-seconds or a future HTTP date. Empty, zero, expired and malformed values alone do not impose a wait; their presence is still recorded. Third-party signals alone do not abort. Navigation 401/403 and existing security challenge guards remain active.

The evidence allowlist is reason, timestamp, monotonic time, hostname, status, resource type, navigation flag, Retry-After presence, and same-Onda-site flag. No request/response bodies are read. No paths, queries, full URLs, header values, credentials, cookies or tokens are persisted. The immediate-stop diagnostic now contains the first abort's failure reason and response evidence. See TELEMETRY_SPEC.md for exact event meanings.

## Validation

- Tests: **218 passed, 12 files**, including existing selection and full-booking tests.
- Typecheck: **PASS**, `npm run typecheck`.
- UI build: **PASS**, `npm run ui:build`.
- Whitespace validation: **PASS**, `git diff --check`.

Focused coverage includes shell readiness behind an overlay without any click, exact venue, missing/duplicate/hidden duplicate picker, enabled and disabled pre-open paths, one DOM evaluation without polling, pre-open booking-state changes, mandatory stale/partial/busy grid barriers, two-reload bounds, Onda and third-party rate-limit classification, hostname suffix traps, sanitized persisted evidence, and evidence availability inside synchronous abort listeners.
