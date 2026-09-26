# Latest run interim report — September 26, 2026

Evidence cutoff: September 26, 2026, 08:02:50 Manila. Target booking date: September 28, 2026.
Run: e69098a8-b8b2-444e-b0ea-2b1170f1420f. Proofless Precision Phase 3 was active.

Six Wave 1 attempts were sent; all received application HTTP 409 availability rejections and settled REJECTED. The six latest durable journals also show rejected / ONDA_HTTP_STATUS_INVALID. No verified hold or QR success is recorded. Worker G prepared successfully as standby; no Wave 2 or Rescue dispatch is recorded through the cutoff. Monitoring is ongoing; there is no final run outcome yet.

| Worker | Court | Requested time | Observed POST lateness | Response duration |
|---|---:|---|---:|---:|
| A | 4 | 7–10 PM | +8.6 ms | 10.026 s |
| B | 5 | 7–10 PM | +7.7 ms | 10.891 s |
| C | 1 | 7–10 PM | +7.9 ms | 6.862 s |
| D | 2 | 5–8 PM | +8.7 ms | 11.933 s |
| E | 2 | 8–11 PM | +9.6 ms | 13.996 s |
| F | 3 | 5–8 PM | +9.5 ms | 12.297 s |

Timing uses CHECKOUT_HTTP_POST_INITIATED.releaseLatenessMs, not delayed PHASE3_DISPATCH logging. Last recorded clock consensus: +373 ms correction, 43 ms round trip, 21.5 ms uncertainty. Browser request events do not establish server arrival order. Raw PC timestamps and corrected timestamps must not be compared without correction.

User observation: other scalpers had already blocked the 6–11 PM schedule. This report preserves that as user-provided context; the traces confirm unavailability but cannot identify the responsible parties or distinguish all holds, paid bookings, and venue blocks.

At 07:59:00.275, before release, public booking records already covered Courts 2 and 3 at 8–11 PM, and Courts 6 and 7 at 6–10 PM. Thus Worker E's full target overlapped pre-release public records. That deserves a separate review of how Phase 3 incorporates pre-release booking evidence; this report does not establish a code defect.

The first published grid was requested at release +17.1 ms and returned +1462.1 ms. Evening unavailable ranges were Court 1: 5–10 PM; Courts 2/3: 8–11 PM; Courts 4/5: 7–10 PM; Courts 6/7: 6–10 PM. D/F's 5–8 PM targets still appeared open in that early grid, but their checkout requests were subsequently rejected. An OPEN read did not guarantee checkout acceptance.

The grid requested at +13.0001 s and returned at +13.8601 s showed 6–11 PM unavailable across all seven courts. This remained true through the cutoff. These are observation intervals, not exact booking transaction times.

The three unattempted authorized candidates were Court 3 at 8–11 PM and Court 6 at 5–8 PM / 8–11 PM. Each overlapped unavailable cells in the published grids. No complete authorized target reopened in the inspected observations, consistent with no Wave 2 or Rescue dispatch. ACTIONABLE_FRESH describes evidence freshness, not a claim that a target is open.

Sources:
- .local/api-booking/run-progress/e69098a8-b8b2-444e-b0ea-2b1170f1420f.ndjson
- .local/slot-watch/2026-09-28_3ca6d99a-c914-4d25-ac93-7ccd75bda270.ndjson
- Latest six durable journal states in .local/api-booking/api-first-journals/ (private identifiers omitted)

Analysis was read-only with respect to the running bot, provider, configuration, and booking state.
