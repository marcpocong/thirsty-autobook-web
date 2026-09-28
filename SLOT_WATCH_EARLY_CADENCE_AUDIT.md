# Slot Watch early-rush cadence audit

Scope: T−2 seconds through T+30 seconds. No cadence change is justified for Wave 1 arbitration v2.

- Availability launches: 32 (T−2; 0, 0.25, 0.5, 1, 2, 5 seconds; then every second from +6 through +30). Each is one credential-free availability request, with at most six in flight and a 15-second timeout.
- Public-booking launches: 3 (+2, +10 and +30 seconds). Each logical read fans out to seven per-court public endpoints, so its request cost is 21 HTTP GETs in this window. Only one logical booking read may be in flight.
- Combined cost: 53 read-only HTTP GETs over 32 seconds, without cache-busting. The existing implementation records cap/late skips rather than retrying tightly.
- September 25/26 evidence shows this cadence already bounds first publication, target disappearance, slow-read overtaking/flushes and public-booking visibility. Increasing the booking cadence would multiply load by seven per added sample and is not proportionate.
- Existing provider readers retain the global Onda 429/Retry-After safety behavior; this investigation does not weaken it.

Conclusion: preserve the current schedule. The generalized analyzer extracts more discrimination from the existing reads without increasing provider load.
