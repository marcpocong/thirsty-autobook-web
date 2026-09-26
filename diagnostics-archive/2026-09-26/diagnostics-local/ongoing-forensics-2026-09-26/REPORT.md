# Codex final forensic report — September 26 release

> **Author: OpenAI Codex. This document contains Codex's forensic analysis and conclusions. Claude's report is a separate, different report; this document is not Claude's report or a joint Codex–Claude assessment. No agreement with Claude's findings is implied.**

This replaces the earlier interim report in the active editor. The canonical final report and all referenced evidence files are in [../final-forensics-2026-09-26/](../final-forensics-2026-09-26/REPORT.md); references to "this directory" below refer to that final evidence directory. The original interim report is preserved there as PRELIMINARY_REPORT_0806.md.

Target booking date: September 28, 2026. Run: `e69098a8-b8b2-444e-b0ea-2b1170f1420f`. All displayed clock times are Manila unless stated otherwise. Runner exited at 08:15:00.120; final observer response completed at 08:15:00.520.

## Final outcome and the important new finding

The run ended with `ALL_REJECTED_WAITING_FOR_REOPEN`, followed by FAILED and process exit code 1. Six initial submissions, six HTTP 409 availability rejections, zero verified holds, zero UNKNOWN attempts, zero QR handoffs, zero adaptive submissions. It was not aborted. Despite the outcome name, the process is no longer waiting or monitoring.

The deeper logs were successfully persisted: six provider traces, all complete, plus six critical-path rows. They confirm a prompt local dispatch on reused HTTP/2 connections. The 6.8–14.0 second delays were overwhelmingly waits for response headers after sending.

Crucially, Courts 2 and 3 at 17:00–20:00 DID reopen later, from observation #128 through #135, around 08:09:57–08:10:04. G performed four rescue security refreshes, but no rescue POST followed. The evidence and installed guard identify an exact-observation sequence mismatch after every refresh. This supersedes the preliminary snapshot's observation that no authorized target had yet reopened. The earlier statement was valid only through its 08:06 cutoff.

## Evidence and method

Sources are copied into this directory as run.ndjson, watch.ndjson, freeze.json, provider.ndjson, and critical.ndjson. The existing forensic engine generated FINAL report.txt and summary.json. analysis.json combines the deep timing, final observations, and offline rescue reconstruction. The offline reproduction script is ../final-forensics-2026-09-26.mjs.

Installed desktop-runner.ts and precision-phase3.ts match their Source copies by SHA-256. The installed build identifies source 06114db and build time 2026-09-25T19:40:56.146Z. Offline reconstruction invokes only pure selection/evidence logic; it does not contact the provider or submit requests.

## Initial dispatch: where the time went

| Worker | Target | Browser network start after deadline | Playwright request observed | Header wait after send | Recorded total network duration | Outcome |
|---|---|---:|---:|---:|---:|---|
| A | C4, 19:00–22:00 | +6.21 ms | +8.60 ms | 10,018.3 ms | 10,026 ms | 409 |
| B | C5, 19:00–22:00 | +6.46 ms | +7.64 ms | 10,883.5 ms | 10,891 ms | 409 |
| C | C1, 19:00–22:00 | +6.94 ms | +7.92 ms | 6,848.7 ms | 6,862 ms | 409 |
| D | C2, 17:00–20:00 | +7.50 ms | +8.68 ms | 11,923.1 ms | 11,933 ms | 409 |
| E | C2, 20:00–23:00 | +7.30 ms | +9.61 ms | 13,988.6 ms | 13,996 ms | 409 |
| F | C3, 17:00–20:00 | +7.74 ms | +9.54 ms | 12,289.0 ms | 12,297 ms | 409 |

The critical-path recorder measured scheduler wake at +0.07 ms, worker invocation at +0.11–2.14 ms, pre-POST gates at +0.47–2.15 ms, fetch invocation at +3.58–4.94 ms, and browser network starts at +6.21–7.74 ms. Browser starts span only 1.53 ms. Node-to-renderer transit was 2.77–3.11 ms; fetch-to-browser-network-start was 2.41–2.81 ms. Renderer calibration uncertainty was approximately 0.38–0.44 ms.

All six requests used HTTP/2 and reused connections. Send durations were 0.1–0.2 ms. Fresh DNS/connect/TLS durations were not recorded for these reused requests; there is no evidence of a new connection handshake accounting for the multi-second waits. Provider responses identified Vercel and cache MISS. No server-timing breakdown was supplied. Vercel IDs are retained in raw evidence as opaque identifiers, not treated as authoritative receipt or commit timestamps.

Court 1's browser response completed around release +6858.92 ms, while the runner observed it around +6920.37 ms: about 61.45 ms of extra observation lag. That happened after the response, so it did not delay the outgoing request or cause rejection.

Interpretation: local dispatch and connection setup do not account for the multi-second response duration. The large measured wait is on the post-send response path, which includes network transit and provider processing/queueing. These traces cannot separate those components or expose Onda's transaction ordering.

## Clock limits

The last network-clock consensus used +373.0 ms correction, 43 ms RTT, ten samples, 6.2 ms spread, and estimated uncertainty ±21.5 ms. The critical-path mapping reports +373.16 ms wall-to-trusted correction. Slot Watch used +368.1 ms, about 4.9 ms behind the dispatch correction.

Millisecond local offsets are not proof of equivalently precise agreement with Onda's release clock. Browser starts are not server receipt times. Raw PC timestamps and corrected stage timestamps must not be directly compared. Provider-summary and critical-path header offsets also use different anchoring methods and can differ slightly; no single millisecond value should be presented as provider-side truth.

## What happened to Courts 1, 4, and 5

All three 19:00–22:00 targets were fully unavailable in the first published grid (#8, requested at +17.1 ms, response at +1462.1 ms). None appeared fully open anywhere in the complete fifteen-minute observation sequence. No matching public booking records for those target hours appeared in the nine public-record reads.

The requests nevertheless reached the browser network promptly and returned application JSON HTTP 409 with an availability diagnostic. This supports unavailability as the immediate rejection category. It does not establish whether the restrictions predated release, were created by competing requests around release, or came from another provider-side mechanism. Faster client dispatch alone cannot be assumed to solve this inventory class.

The user confirms morning open-play admin blocks on Courts 3, 4, and 5. The first grid shows 08:00–12:00 unavailable on those courts. This explanation is user-provided venue knowledge; it should not be applied automatically to the evening restrictions. Likewise, the user's observation of scalpers occupying evening inventory is retained as context, not independently proven attribution.

## First published grid and the user's observations

This is the first availability response containing the September 28 schedule: observation #8, requested on September 26 at **08:00:00.017 AM** and completed at **08:00:01.462 AM Manila** (release offsets +17.1 to +1462.1 ms). Cache: MISS, age 0 seconds. The full grid contains **75 open, 37 unavailable, and 0 unknown court-hour cells**.

Each column is a one-hour slot starting at the displayed time. **O = reported open; X = reported unavailable.** X does not by itself mean a new booking, a paid booking, or a competitor's hold. O does not guarantee checkout acceptance. The 23:00 column represents 23:00–24:00.

| Court | 08:00 | 09:00 | 10:00 | 11:00 | 12:00 | 13:00 | 14:00 | 15:00 |
|---|---|---|---|---|---|---|---|---|
| 1 | O | O | O | O | O | O | O | O |
| 2 | O | O | O | O | O | O | O | O |
| 3 | X | X | X | X | O | O | O | O |
| 4 | X | X | X | X | O | O | O | O |
| 5 | X | X | X | X | O | O | O | O |
| 6 | O | O | O | O | O | O | O | O |
| 7 | O | O | O | O | O | O | O | O |

| Court | 16:00 | 17:00 | 18:00 | 19:00 | 20:00 | 21:00 | 22:00 | 23:00 |
|---|---|---|---|---|---|---|---|---|
| 1 | O | X | X | X | X | X | O | O |
| 2 | O | O | O | O | X | X | X | O |
| 3 | O | O | O | O | X | X | X | O |
| 4 | O | O | O | X | X | X | O | O |
| 5 | O | O | O | X | X | X | O | O |
| 6 | O | O | X | X | X | X | O | O |
| 7 | O | O | X | X | X | X | O | O |

**User-provided venue context:** The user stated that the morning blocks on Courts 3, 4, and 5 were admin blocks because the facility was hosting its own open play. The grid's unavailable 08:00–12:00 cells on those courts are consistent with that explanation. The admin/open-play attribution comes from the user's venue knowledge, not from a cause field in the availability response. These morning cells should not be counted as evidence of competitor bookings.

**User observation about the evening:** The user reported that other scalpers had already blocked the 6–11 PM schedule. The logs corroborate that all seven courts showed 18:00–23:00 unavailable by the response at 08:00:13.860 AM. They do not independently establish who caused those restrictions. The first grid above, at 08:00:01.462 AM, still contained some open evening cells; the complete 6–11 PM closure was a later observation, and subsequent reopenings are documented below.

**Pre-release records discussed with the user:** The user corrected the recalled court list to Courts 2, 3, 6, and 7. The public-record read completed at 07:59:00.275 AM already covered C2/C3 20:00–23:00 and C6/C7 18:00–22:00. These are specific hour ranges, not proof that those entire courts were blocked for the day.

**Why additional unavailable cells first appeared at publication:** Before 08:00, the availability endpoint omitted the target date, while the separate public-booking endpoint already exposed some records. Publication made the full availability grid visible, including restrictions that had no matching public records. Therefore, first visible at 08:00:01.462 AM does not mean newly booked at that instant. For C1/C4/C5 at 19:00–22:00, the observations cannot distinguish pre-existing restrictions from transactions processed around release. A read reports state at an unknown point between its request and response.

Source: final evidence package watch.ndjson, availability observation #8 and bookings observation #1; summary.json, observer.firstPublishedMatrix. This section preserves the user's observations separately from log-confirmed facts.

## Availability and booking-record timeline

| Observation | Evidence |
|---|---|
| 07:59:00.275 | Public records already covered C2/C3 20:00–23:00 and C6/C7 18:00–22:00: 14 court-hour cells. |
| 07:59:58.429 | Last pre-release availability response still omitted the target date. |
| 08:00:01.462 | First published grid: 75 open, 37 unavailable, zero unknown cells. C1 17:00–22:00, C4/C5 19:00–22:00 already unavailable. |
| 08:00:13.860 | All courts showed 18:00–23:00 unavailable. D/F's 17:00–20:00 targets changed from fully open to partially unavailable. |
| 08:01:05.327 | C3 17:00–18:00 first observed unavailable. |
| 08:01:20.636 | C2 17:00–18:00 first observed unavailable. |
| 08:01:25.327 | C6/C7 17:00–18:00 first observed unavailable. |
| 08:01:55.192 | C4/C5 17:00–18:00 first observed unavailable. |
| 08:09:57.342 | C2/C3 17:00–20:00 observed fully reopened. |
| 08:10:00.294 | Public-record read no longer contained C2/C3 17:00, 18:00, or 19:00 cells, corroborating the reopening observation. |
| 08:10:04.099 | Last observation still showing both complete reopened targets. |
| 08:10:05.326 | Both targets unavailable again. |
| 08:15:00.421 | Final public-record read again contained C2/C3 17:00–20:00. |
| 08:15:00.520 | Final grid: 55 open, 57 unavailable, zero unknown cells. No complete authorized target open. |

Times above are response completions, not booking creation, payment, expiry, or cancellation timestamps. The reopening near ten minutes is consistent with hold expiry or cancellation but does not prove either. Its reappearance as unavailable does not identify who took it.

## Rescue gap: concrete reconstruction

Read #127 covered +596.0061 to +596.1191 seconds and showed the targets unavailable. Read #128 covered +597.0051 to +597.3421 seconds and showed C2/C3 17:00–20:00 open. All reads #128–135 carried cache MISS, age zero, and complete prices, and the runner classified them ACTIONABLE_FRESH.

The authorized rescue budget was one attempt, with G first in the worker list. Pure offline replay of the frozen plan and recorded matrices selects Court 2, 17:00–20:00 on G for those reads; Court 2 outranks Court 3. This is a selection reconstruction, not a claim that checkout would have succeeded.

| G preparation | Selection inferred from adjacent evidence stage | Security duration | Latest processed read on completion | Same-read guard |
|---|---:|---:|---:|---|
| 1 | #128, 08:09:57.365 | 1,481 ms | #129 | Fails |
| 2 | #130, 08:09:59.117 | 1,196 ms | #131 | Fails |
| 3 | #132, 08:10:01.162 | 1,238 ms | #133 | Fails |
| 4 | #134, 08:10:03.140 | 1,558 ms | #135 | Fails |

Installed desktop-runner.ts around lines 880–895 awaits prepareCheckoutContext(wave === 'RESCUE'), then returns if current.observation.seq !== evidenceSeq. Each security refresh took longer than the approximately one-second observer cadence. Each newer read still showed the same complete targets open, yet its different sequence invalidated the original selection. There is no reservation or POST after any preparation; no security-failed, journal-blocked, or adaptive-failed stage was recorded.

Conclusion strength: the four preparation intervals and evidence sequences are directly logged; the exact selected candidate and guard-return cause are reconstructed from matching installed code and pure selection replay. There is no explicit guard-skip event. The reconstruction provides strong evidence that sequence churn prevented rescue dispatch. It does not prove a missed successful booking, and it must not be fixed by simply removing freshness or transaction safeguards.

## Why Wave 2 did not fire

Wave 2 was enabled concurrently with one submission budget and standby G. Its authorized targets were C3 20:00–23:00, C6 17:00–20:00, and C6 20:00–23:00. None became fully open in the recorded grids. All overlapped pre-release public-record cells. Therefore the lack of a Wave 2 POST is consistent with the authorized target set, while the missing Rescue POST has the separate sequence-guard explanation above.

## Observability completeness

- 204 availability reads answered; zero failed or not launched. Nine public-record reads answered; zero failed court queries.
- Runner consumed 203 evidence observations: seven UNRELEASED, 193 ACTIONABLE_FRESH, three outdated-request observations. The final #204 response arrived after runner exit; it appears in the final observer report but was not an adaptive decision input.
- Six complete provider traces and six critical-path rows. No diagnostic-dropped event is recorded.
- Aggregate cell transitions: 25 open-to-unavailable and 24 unavailable-to-open. These are cell counts, not booking counts or 24 usable rescue opportunities.
- The generic RUN_DIAGNOSTIC_SUMMARY lists absentEvidence availability-response/core-attempt despite separate complete Slot Watch and Phase 3 attempt records. It is not evidence that the observer or six requests never ran; the specialized streams supply those records.
- The outcome label ALL_REJECTED_WAITING_FOR_REOPEN does not mean no reopening occurred. The process finished with no additional attempts, and an observed reopening was missed before it ended.

## Priorities supported by this run

1. Investigate and repair rescue revalidation across a security refresh: retain strong freshness, target, price, budget, journal, and no-UNKNOWN safeguards while allowing a newer qualifying observation of the same target. Add explicit skip-reason evidence so silent returns can be diagnosed directly. This is the clearest code-level issue exposed by the final evidence.
2. Review pre-release inventory handling: E's initial target and every standby target overlapped visible pre-release records. The Phase 3 frozen assignment path lacks the legacy T-30-minute block-audit step. This is a planning/validation issue to assess against intended proofless policy.
3. Keep the initial dispatch improvements in perspective: the network starts were already tightly clustered on warm connections. The logs do not establish that shaving another few milliseconds would have won Courts 1/4/5.
4. Consider incremental forensic persistence during long monitoring windows and clearer final outcome labels. Earlier snapshots could not see the deep timing until 08:15.

No booking behavior, code, configuration, locks, journals, browser state, or provider state was changed for this report. Only local report artifacts were written. The 08:06 preliminary report is preserved as PRELIMINARY_REPORT_0806.md.
