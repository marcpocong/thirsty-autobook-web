# Production release report: September 28, 2026 (target Wednesday September 30)

Prepared by Claude on 2026-09-28 from the installed app's local evidence. The analysis read files and ran the offline Wave 1 arbitration analyzer, with its output kept outside the repo. Nothing was sent to Onda, and no booking, lock, journal or configuration was changed.

**This version** answers why Court 7 (Worker A) was not won, and reconstructs what the app showed for it at 08:00. It pastes the exact log lines throughout the text. Every log is also reproduced in full in the appendices, and the complete Slot Watch log is in the companion file [RELEASE_RUN_REPORT_2026-09-28_RAW_LOGS.md](RELEASE_RUN_REPORT_2026-09-28_RAW_LOGS.md). It also corrects the first version, which read every runner timestamp as PC-clock time; section 14 explains the correction.

**Conventions.**
- **Times.** All times are Manila. "+x s" means seconds after 08:00:00.000 on the bot's corrected (NTP consensus) clock, called the "trusted clock".
- **Cells.** "Cell" is one court for one hour, and "C7 19:00" means Court 7, 19:00–20:00. A list such as "C7 17–22" gives start hours, so 17:00–23:00. Ranges written with minutes, such as "19:00–22:00", are booking times.
- **Edge copy.** A cached copy of Onda's availability feed served by Vercel. Its `age` header says how many seconds old the copy was when it was served.
- **Evidence standards.** **(inference)** marks conclusions that rest on a stated assumption; everything else is directly recorded. Unavailable cells without a public booking record have no known cause. Where Onda gave a reason, it is quoted exactly as sent.

**How to read the timestamps in the pasted logs.** Four kinds of timestamp appear:
- **Runner stage lines** (`RUN_*`, `PHASE3_*`, `RELEASE_OFFSET_SCHEDULED`, `NETWORK_CLOCK_*`, `CRITICAL_PATH_SAVED`, `PHASE3_OUTCOME`) carry `at` on the **trusted clock**.
- **Runner diagnostic lines**, the ones that carry `timingKind` and `eventAt` (`SECURITY_*`, `CHECKOUT_*`, `DIAGNOSTIC_ATTEMPT_ARMED`, `RUN_DIAGNOSTIC_SUMMARY`), carry the **PC clock**. The PC clock was 39.07 ms behind the trusted clock. Their `releaseLatenessMs` values are already on the trusted clock.
- **App activity lines** (`booking-runs`) carry the runner's `at` when they relay a runner stage, and the PC time of arrival otherwise.
- **Slot Watch offsets** are on the observer clock, which is 4.2 ms behind the dispatch clock.

**How the pasted logs were cleaned.** Every pasted line went through the same rules as `scripts/export-sanitized-diagnostics.mjs`:
- Keys that name identities, tokens, cookies, fingerprints, `authorization`, `pid` or `hostname` become `[REDACTED]`.
- Email addresses, phone numbers and local `C:\Users\…` paths are replaced.
- A line that needed no change is copied exactly. A line that did is re-serialized with the same key order.
- The private raw checkout responses (`checkout-response-private.json`) are not reproduced. The same evidence (status, headers, message) is in the provider trace.

## 1. Executive result

- **Court 7 (your priority-1 target, Worker A) was lost twice.**
  1. **At 08:00 your setting worked exactly as saved.** Worker A was set to send 10 ms early. Its request started in Chrome at −6.0 ms and reached Onda's edge about +17 ms. Onda held it for 10.58 s, then refused with *"This booking slot is no longer available (overlaps an existing booking)."* The edge copy made around +5 s still showed C7 19:00–22:00 open. So someone else's Court 7 booking was processed first, while ours waited. Nothing on our side failed.
  2. **At 08:10:06 Court 7 19:00–22:00 came back fully open,** and stayed open in every read until 08:12:30 (at least 2 min 25 s). The bot sent nothing: Rescue ignores every read that Onda serves from its edge cache, and since this morning every read is one.
- **The "error" on Court 7 at 08:00.** The app does not save what its screen shows, so this is reconstructed from the renderer code and the logs (section 2.7). From 08:00:06.1 to 08:00:16.1, Worker A's Court 7 line was the only line in the Precision panel not reading "Unavailable". It read **"Cached or age unknown · not used"**, which is the app saying it would not act on that read. From 08:00:10.6 the attempt line read "Immediate attempt · Worker A · REJECTED". The same Court 7 text returned from 08:10:06 to 08:13:00, with a one-second "Read failed" at 08:10:55. The app's activity log recorded no error at 08:00. Its only error lines are at 08:15:00, and none is specific to Worker A (section 2.8).
- **Every other target was also rejected.** All seven Wave 1 checkouts got HTTP 409 after 8.1–12.1 s, all with the same text. All seven journals are closed as `rejected`, and nothing is armed or left to reconcile.
- **First live use of per-attempt Release Offsets.** The settings were C −50, B −25, A −10, D −5, and E/F/G 0 ms. Chrome started the requests between −45.6 and +4.8 ms. Onda's answer order showed no link to send order.
- **New this morning: Onda's availability feed comes from Vercel's edge cache.** On 25 and 26 September every read was a fresh `MISS`. Today only the −60 s read was. The other 201 answered reads were `HIT`/`STALE` copies up to 15 s old. As a result:
  - Wednesday did not appear in the feed until +6.0 s.
  - No read after 08:00 was usable by the runner's rule, so Rescue could never start.
- **The target existed at 08:00.** No Wednesday booking records existed at −60 s. After that:
  - 13 evening hours had records by +2.8 s.
  - All 36 cells of 17:00–23:00 on Courts 1–6 had records by +10.8 s.
  - All 42 evening cells on all seven courts had records by +30.3 s.
- **Ratings.** Release Intelligence: **FAIR**. Arbitration analyzer: **POOR**, with only 1 of 7 attempts (C7) a usable race sample.

## 2. Court 7 (Worker A): why we did not get it

### 2.1 Your setting

The saved plan in `config.local.json` puts Court 7 19:00–22:00 at candidate index 0 (priority 1) and assigns it to Worker A with `releaseOffsetMs: -10`, which is "Send early by (ms)" = 10 in the app. The plan-wide offset stayed at 0, because offsets are set per attempt.

```json
{"BOOKING_METHOD": "proofless", "RELEASE_STRATEGY": "precision", "RELEASE_OFFSET_MS": 0, "PRECISION_TARGETS": []}
```

```json
// config.local.json → PRECISION_PHASE3.candidates[0]
{"court":7,"start":"19:00","durationHours":3,"priority":1,"permissions":{"wave1":true,"wave2":false,"rescue":true},"rateEvidence":{"source":"current venue schedule","capturedAt":"2026-09-27T23:34:41.481Z","status":"VENUE_SCHEDULE","date":"2026-09-30","perHour":[700,700,700],"actionable":true}}
// config.local.json → PRECISION_PHASE3.wave1
[{"workerId":"A","candidateIndex":0,"releaseOffsetMs":-10},{"workerId":"B","candidateIndex":1,"releaseOffsetMs":-25},{"workerId":"C","candidateIndex":2,"releaseOffsetMs":-50},{"workerId":"D","candidateIndex":3,"releaseOffsetMs":-5},{"workerId":"E","candidateIndex":4},{"workerId":"F","candidateIndex":5},{"workerId":"G","candidateIndex":6}]
// config.local.json → PRECISION_PHASE3 (other keys)
{"standby":[],"budgets":{"wave2":0,"rescue":1,"total":8},"concurrentWave2":true,"rescueEnabled":true}
```

The full saved plan is in Appendix M.

The runner read it back exactly like that. These are the authorization, Court 7 candidate, warning and freeze lines from the runner trace (`fingerprint` is redacted by the sanitizer):

```json
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_AUTHORIZATION","at":"2026-09-27T23:35:28.083Z","elapsedMs":2157,"sincePreviousMs":1,"candidateCount":10,"wave1Count":7,"standbyCount":0,"maxWave2":0,"maxRescue":1,"maxTotal":8,"fingerprint":"[REDACTED]"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_CANDIDATE","at":"2026-09-27T23:35:28.083Z","elapsedMs":2158,"sincePreviousMs":1,"candidateId":"85746ed1a88a159960b11e0d2c8b10c708b9f33cd500ea5a2bb0850aa481b032","court":7,"startTime":"19:00","endTime":"22:00","durationHours":3,"priority":1,"amount":2100,"rateStatus":"VENUE_SCHEDULE","source":"current venue schedule"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_DIVERSIFICATION_WARNING","at":"2026-09-27T23:35:28.083Z","elapsedMs":2158,"sincePreviousMs":0,"message":"All 7 Wave 1 attempts share 19:00–22:00. A time-wide unavailable block would affect every attempt."}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_FROZEN","at":"2026-09-27T23:58:00.061Z","elapsedMs":1354123,"sincePreviousMs":49,"candidateCount":10,"wave1Count":7,"fingerprint":"[REDACTED]"}
```

The app's activity log announced the offsets at 07:58:00.090:

```json
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:58:00.090Z","text":"Release offset scheduled · Worker A · Trigger −10 ms: checkout may be sent up to 10 ms before the official release time · 1354152 ms total · +29 ms since prior stage","level":"info","elapsedMs":1354759,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:58:00.090Z","text":"Release offset scheduled · Worker B · Trigger −25 ms: checkout may be sent up to 25 ms before the official release time · 1354152 ms total · +0 ms since prior stage","level":"info","elapsedMs":1354775,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:58:00.090Z","text":"Release offset scheduled · Worker C · Trigger −50 ms: checkout may be sent up to 50 ms before the official release time · 1354152 ms total · +0 ms since prior stage","level":"info","elapsedMs":1354791,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:58:00.090Z","text":"Release offset scheduled · Worker D · Trigger −5 ms: checkout may be sent up to 5 ms before the official release time · 1354152 ms total · +0 ms since prior stage","level":"info","elapsedMs":1354807,"deltaMs":16}
```

### 2.2 Every runner line for Worker A, in file order

These are all the lines in `.local/api-booking/run-progress/e3f7de87-d1d5-4949-9ddc-4cc49529cfa7.ndjson` that name Worker A or its Court 7 candidate. Note the clock basis described at the top: `SECURITY_*` and `CHECKOUT_*` lines are PC-clock.

```json
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PREPARING_BROWSER","at":"2026-09-27T23:35:26.009Z","elapsedMs":83,"sincePreviousMs":74,"workerId":"A"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"BROWSER_READY","at":"2026-09-27T23:35:28.049Z","elapsedMs":2124,"sincePreviousMs":1962,"workerId":"A","port":19444}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"BROWSER_PREPARATION_OUTCOME","at":"2026-09-27T23:35:28.081Z","elapsedMs":2156,"sincePreviousMs":1,"workerId":"A","status":"fulfilled","code":"COMPLETED"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_CANDIDATE","at":"2026-09-27T23:35:28.083Z","elapsedMs":2158,"sincePreviousMs":1,"candidateId":"85746ed1a88a159960b11e0d2c8b10c708b9f33cd500ea5a2bb0850aa481b032","court":7,"startTime":"19:00","endTime":"22:00","durationHours":3,"priority":1,"amount":2100,"rateStatus":"VENUE_SCHEDULE","source":"current venue schedule"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_WAVE1_PRICE","at":"2026-09-27T23:58:00.006Z","elapsedMs":1354068,"sincePreviousMs":479726,"workerId":"A","candidateId":"85746ed1a88a159960b11e0d2c8b10c708b9f33cd500ea5a2bb0850aa481b032","amount":2100,"source":"current venue schedule","rateStatus":"VENUE_SCHEDULE","capturedAt":"2026-09-27T23:34:41.481Z"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"DIAGNOSTIC_ATTEMPT_ARMED","at":"2026-09-27T23:58:00.028Z","elapsedMs":1354124,"sincePreviousMs":1354124,"workerId":"A","lane":"core","attemptType":"official","attemptId":"core-A-official-1","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:58:00.028Z","court":7,"startTime":"19:00","durationHours":3,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"RELEASE_OFFSET_SCHEDULED","at":"2026-09-27T23:58:00.090Z","elapsedMs":1354152,"sincePreviousMs":29,"releaseMs":1790553600000,"triggerMs":1790553599990,"releaseOffsetMs":-10,"workerId":"A"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"SECURITY_PREPARATION_STARTED","at":"2026-09-27T23:59:44.912Z","elapsedMs":1459008,"sincePreviousMs":104883,"workerId":"A","lane":"core","attemptType":"official","attemptId":"core-A-official-1","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:44.912Z","securitySource":"FRESH_ACQUISITION","operation":"security","activeAvailability":0,"activeSecurity":1,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"SECURITY_PREPARATION_COMPLETED","at":"2026-09-27T23:59:49.438Z","elapsedMs":1463534,"sincePreviousMs":190,"workerId":"A","lane":"core","attemptType":"official","attemptId":"core-A-official-1","timingKind":"MEASURED_DURATION","eventAt":"2026-09-27T23:59:49.438Z","securitySource":"FRESH_ACQUISITION","durationMs":4526,"operation":"security","activeAvailability":0,"activeSecurity":1,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_FUNCTION_ENTERED","at":"2026-09-27T23:59:59.951Z","elapsedMs":1474047,"sincePreviousMs":11,"workerId":"A","lane":"core","attemptType":"official","attemptId":"core-A-official-1","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.951Z","preparedContextAgeMs":10513,"securitySource":"PREPARED_CONTEXT","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":2}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_PRE_POST","at":"2026-09-27T23:59:59.951Z","elapsedMs":1474047,"sincePreviousMs":0,"workerId":"A","lane":"core","attemptType":"official","attemptId":"core-A-official-1","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.951Z","preparedContextAgeMs":10513,"securitySource":"PREPARED_CONTEXT","releaseLatenessMs":-9.9,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":2}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_DISPATCH","at":"2026-09-27T23:59:59.994Z","elapsedMs":1474051,"sincePreviousMs":15,"workerId":"A","candidateId":"85746ed1a88a159960b11e0d2c8b10c708b9f33cd500ea5a2bb0850aa481b032","wave":"WAVE_1","attemptId":"core-A-official-1"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_HTTP_POST_INITIATED","at":"2026-09-27T23:59:59.955Z","elapsedMs":1474051,"sincePreviousMs":4,"workerId":"A","lane":"core","attemptType":"official","attemptId":"core-A-official-1","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.955Z","initiationEvidence":"PLAYWRIGHT_REQUEST_EVENT","releaseLatenessMs":-6.2,"operation":"checkout","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":3}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_WAVE1_STARTED","at":"2026-09-28T00:00:00.003Z","elapsedMs":1474060,"sincePreviousMs":4,"workerId":"A","candidateId":"85746ed1a88a159960b11e0d2c8b10c708b9f33cd500ea5a2bb0850aa481b032","wave":"WAVE_1","attemptId":"core-A-official-1","court":7,"startTime":"19:00","endTime":"22:00","amount":2100}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_RESPONSE_COMPLETED","at":"2026-09-28T00:00:10.540Z","elapsedMs":1484636,"sincePreviousMs":153,"workerId":"A","lane":"core","attemptType":"official","attemptId":"core-A-official-1","timingKind":"MEASURED_DURATION","eventAt":"2026-09-28T00:00:10.540Z","networkDurationMs":10588,"statusCode":409,"dispatchState":"RESPONSE_CAPTURED","failureCategory":"ONDA_HTTP_STATUS_INVALID","errorHint":"availability","responseSource":"application","responseBytes":100,"bodyShape":"80651c57074d","operation":"checkout","durationMs":10585,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":2}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_SETTLED","at":"2026-09-28T00:00:10.638Z","elapsedMs":1484695,"sincePreviousMs":195,"workerId":"A","candidateId":"85746ed1a88a159960b11e0d2c8b10c708b9f33cd500ea5a2bb0850aa481b032","wave":"WAVE_1","attemptId":"core-A-official-1","state":"REJECTED"}
```

What those lines say, converted to the trusted clock:

| Trusted time | Line | Meaning |
|---|---|---|
| 07:35:28.08 | `PHASE3_CANDIDATE` priority 1 | Court 7 19:00–22:00, PHP 2,100, rate "current venue schedule" |
| 07:58:00.006 | `PHASE3_WAVE1_PRICE` | Price confirmed 2,100 (rates captured 07:34:41.481) |
| 07:58:00.067 | `DIAGNOSTIC_ATTEMPT_ARMED` | Attempt `core-A-official-1` armed (PC 07:58:00.028) |
| 07:58:00.090 | `RELEASE_OFFSET_SCHEDULED` | `triggerMs` 1790553599990 = 07:59:59.990 |
| 07:59:44.951 | `SECURITY_PREPARATION_STARTED` | Fresh security acquisition (PC 07:59:44.912) |
| 07:59:49.477 | `SECURITY_PREPARATION_COMPLETED` | Took 4,526 ms |
| 07:59:59.990 | `CHECKOUT_FUNCTION_ENTERED` | Prepared context 10,513 ms old (PC 07:59:59.951) |
| 07:59:59.990 | `CHECKOUT_PRE_POST` | `releaseLatenessMs` −9.9 |
| 07:59:59.994 | `CHECKOUT_HTTP_POST_INITIATED` | `releaseLatenessMs` −6.2 (Playwright request event) |
| 07:59:59.994 | `PHASE3_DISPATCH` | Logged at −0.006 s |
| 08:00:00.003 | `PHASE3_WAVE1_STARTED` | |
| 08:00:10.579 | `CHECKOUT_RESPONSE_COMPLETED` | 409, `errorHint` availability, 100 bytes, network 10,588 ms (PC 08:00:10.540) |
| 08:00:10.638 | `PHASE3_SETTLED` | `REJECTED` |

### 2.3 The send, as measured by the critical-path logger

```json
{"schema":"critical-path/v1","type":"header","releaseMs":1790553600000,"wallToTrustedMs":39.07,"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","note":"All *Ms values are milliseconds after the release instant on the trusted clock. Renderer values are mapped through a round-trip calibration and carry [lowMs, highMs]."}
{"schema":"critical-path/v1","workerId":"A","dispatchMode":"node","schedulerFiredMs":-49.95,"workerInvokedMs":-9.96,"transportEnteredMs":-9.89,"prePostMs":-9.86,"rendererArmSentMs":null,"rendererArmedMs":null,"evaluateEnteredMs":{"ms":1665243.78,"lowMs":1665242.89,"highMs":1665244.68},"fetchInvokedMs":{"ms":1665243.78,"lowMs":1665242.89,"highMs":1665244.68},"browserRequestStartMs":-5.98,"requestObservedMs":-6.21,"responseHeadersMs":{"ms":1675828.88,"lowMs":1675827.99,"highMs":1675829.78},"responseCompleteMs":{"ms":1675829.08,"lowMs":1675828.19,"highMs":1675829.98},"responseObservedMs":10578.87,"segments":{"nodeToRendererMs":1665253.64,"rendererToFetchMs":0,"fetchToRequestStartMs":-1665249.76,"requestEventLagMs":-0.23},"calibration":{"samples":8,"uncertaintyMs":0.9,"minRoundTripMs":1.59,"consistent":true}}
```

- **Node side.** The worker was called at −9.96 ms and entered the transport at −9.89 ms. Pre-POST was at −9.86 ms.
- **Chrome side.** Chrome's network request started at **−5.98 ms**, and Playwright's request event fired at −6.21 ms.
- **Response.** Node saw the answer at +10,578.87 ms.
- **Bad renderer fields.** Worker A's page-calibrated fields (`evaluateEnteredMs`, `fetchInvokedMs`, `responseHeadersMs`, `responseCompleteMs` and the segments built from them) read about +1,665,244 ms and +1,675,829 ms. That is impossible, and it is a logger bug (section 14). Dispatch ran in Node (`dispatchMode: node`), so this did not affect the send.

### 2.4 Onda's answer

```json
{"type":"header","version":2,"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","reference":"release","referenceMs":1790553600000,"traces":[{"workerId":"A","status":"active"},{"workerId":"B","status":"active"},{"workerId":"C","status":"active"},{"workerId":"D","status":"active"},{"workerId":"E","status":"active"},{"workerId":"F","status":"active"},{"workerId":"G","status":"active"}],"note":"Passive DevTools Network events, enabled only after each POST had left. browser.* are browser-monotonic ms after Chrome's network request start; nodeObserved.* are ms after the reference on the runner trusted clock when Node received the event."}
{"type":"provider-trace","workerId":"A","attemptId":"core-A-official-1","method":"POST","path":"/api/bookings/public-checkout","nodeObserved":{"enabledOffsetMs":4.2,"headersOffsetMs":10577.7,"finishedOffsetMs":10578},"browser":{"dnsMs":null,"connectMs":null,"tlsMs":null,"sendMs":0.2,"waitMs":10581.9,"headersStartMs":10582.7,"headersEndMs":10582.7,"bodyCompleteMs":10583.1,"failedMs":null},"connection":{"protocol":"h2","reused":true},"response":{"status":409,"contentType":"application/json","server":"Vercel","cfRay":null,"cfMitigated":null,"vercelId":"sin1::sin1::xmblb-1790553600017-a8cface69893","requestId":null,"vercelCache":"MISS","ageS":null,"serverTiming":null,"encodedBytes":424},"failure":null,"complete":true}
{"type":"response-fallback","workerId":"A","attemptId":"core-A-official-1","candidateId":"85746ed1a88a159960b11e0d2c8b10c708b9f33cd500ea5a2bb0850aa481b032","wave":"WAVE_1","status":409,"contentType":"application/json","server":"Vercel","cfRay":null,"vercelId":"sin1::sin1::xmblb-1790553600017-a8cface69893","requestId":null,"serverTiming":null,"responseReceivedMs":10585.1,"responseCompletedMs":10585.3,"evidence":{"version":1,"status":409,"headers":{"content-type":"application/json","server":"Vercel","date":"Mon, 28 Sep 2026 00:00:10 GMT","cache-control":"public, max-age=0, must-revalidate","x-vercel-id":"sin1::sin1::xmblb-1790553600017-a8cface69893","x-vercel-cache":"MISS","x-matched-path":"/api/bookings/public-checkout"},"vercel":{"regions":["sin1","sin1"],"edgeRegion":"sin1","functionRegion":"sin1","embeddedMs":1790553600017,"embeddedInterpretation":"UNDOCUMENTED"},"serverDateMs":1790553610000,"serverTiming":null,"body":{"version":1,"byteLength":100,"contentKind":"json","jsonType":"object","shape":[{"path":"$","type":"object"},{"path":"error","type":"string","length":72},{"path":"success","type":"boolean"}],"fields":{"success":false,"error":"This booking slot is no longer available (overlaps an existing booking)."},"shapeFingerprint":"[REDACTED]","sanitizedFingerprint":"[REDACTED]"}}}
```

| Fact | Value |
|---|---|
| Connection | HTTP/2, reused, no DNS/connect/TLS |
| Timing | send 0.2 ms, then wait 10,581.9 ms |
| `x-vercel-id` | `sin1::sin1::xmblb-1790553600017-a8cface69893`. The middle number, 1790553600017, reads as 08:00:00.017. That it is an arrival time is **undocumented** |
| `Date` | `Mon, 28 Sep 2026 00:00:10 GMT` |
| Message | *"This booking slot is no longer available (overlaps an existing booking)."* |

The journal closed as `rejected`. It also shows the armed plan: court 7, the three hourly boundaries, a maximum of PHP 2,100, and a dispatch deadline of release + 1,000 ms (`planFingerprint` redacted):

```json
{"key":"46dbfff25881e6d4a55957d492ba73da6d2df719f5f5e695178cd6b84973ce45","state":"rejected","createdAt":"2026-09-27T23:58:00.066Z","updatedAt":"2026-09-28T00:00:10.624Z","attempt":{"attemptId":"46dbfff25881e6d4a55957d492ba73da6d2df719f5f5e695178cd6b84973ce45","planFingerprint":"[REDACTED]","targetDate":"2026-09-30","courtIds":[7],"hourlyBoundaries":[{"startTime":"19:00","endTime":"20:00"},{"startTime":"20:00","endTime":"21:00"},{"startTime":"21:00","endTime":"22:00"}],"expectedBookingCount":3,"maximumAmount":2100,"stage":"armed","releaseMs":1790553600000,"dispatchDeadlineMs":1790553601000},"diagnostic":{"status":409,"category":"http-rejection","contentKind":"json","responseSource":"application","errorHint":"availability"},"failureCode":"ONDA_HTTP_STATUS_INVALID"}
{"claimedAt":"2026-09-27T23:58:00.070Z","mode":"armed"}
```

### 2.5 What Court 7 looked like while our request waited

Grid reads #13, #14, #23 and #24, and booking-record reads b1–b4, exactly as logged. C7 is the seventh court in `matrix`; the columns are hours 08–23.

```json
{"type":"availability","seq":13,"scheduledOffsetMs":5000,"requestOffsetMs":5002.8,"responseOffsetMs":5082.8,"outcome":"ok","targetDatePresent":false,"matrix":"1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????","cache":{"status":"STALE","ageS":15},"durationMs":80,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:05.002Z","respondedAt":"2026-09-28T00:00:05.082Z","requestedManila":"2026-09-28 08:00:05.002","respondedManila":"2026-09-28 08:00:05.082","dateFlag":"absent","responseComplete":false,"counts":{"OPEN":0,"TAKEN":0,"UNRELEASED":0,"UNKNOWN":112}}
{"type":"availability","seq":14,"scheduledOffsetMs":6000,"requestOffsetMs":6013.8,"responseOffsetMs":6093.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXOXOO,2:OOOOOOOOOOXOXXOO,3:XXXXOOOOOXXXOXXO,4:XXXXOOOOOXXOXOXO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOXO,7:OOOOOOOOOOXOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":1},"durationMs":80,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:06.013Z","respondedAt":"2026-09-28T00:00:06.093Z","requestedManila":"2026-09-28 08:00:06.013","respondedManila":"2026-09-28 08:00:06.093","dateFlag":"published","responseComplete":true,"counts":{"OPEN":77,"TAKEN":35,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":23,"scheduledOffsetMs":15000,"requestOffsetMs":15014.8,"responseOffsetMs":15097.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXOXOO,2:OOOOOOOOOOXOXXOO,3:XXXXOOOOOXXXOXXO,4:XXXXOOOOOXXOXOXO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOXO,7:OOOOOOOOOOXOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":83,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:15.014Z","respondedAt":"2026-09-28T00:00:15.097Z","requestedManila":"2026-09-28 08:00:15.014","respondedManila":"2026-09-28 08:00:15.097","dateFlag":"published","responseComplete":true,"counts":{"OPEN":77,"TAKEN":35,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":24,"scheduledOffsetMs":16000,"requestOffsetMs":16009.8,"responseOffsetMs":16098.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":1},"durationMs":89,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:16.009Z","respondedAt":"2026-09-28T00:00:16.098Z","requestedManila":"2026-09-28 08:00:16.009","respondedManila":"2026-09-28 08:00:16.098","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
```

```json
{"type":"bookings","seq":1,"scheduledOffsetMs":-60000,"requestOffsetMs":-59982.2,"responseOffsetMs":-59602.2,"outcome":"ok","failedCourts":[],"cells":[],"durationMs":380,"requestedAt":"2026-09-27T23:59:00.017Z","respondedAt":"2026-09-27T23:59:00.397Z"}
{"type":"bookings","seq":2,"scheduledOffsetMs":2000,"requestOffsetMs":2013.8,"responseOffsetMs":2844.8,"outcome":"ok","failedCourts":[],"cells":["1/17:00","1/19:00","1/21:00","2/20:00","3/19:00","3/21:00","3/22:00","4/18:00","4/22:00","5/20:00","6/19:00","6/20:00","7/18:00"],"durationMs":831,"requestedAt":"2026-09-28T00:00:02.013Z","respondedAt":"2026-09-28T00:00:02.844Z"}
{"type":"bookings","seq":3,"scheduledOffsetMs":10000,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8,"outcome":"ok","failedCourts":[],"cells":["1/17:00","1/18:00","1/19:00","1/20:00","1/21:00","1/22:00","2/17:00","2/18:00","2/19:00","2/20:00","2/21:00","2/22:00","3/17:00","3/18:00","3/19:00","3/20:00","3/21:00","3/22:00","4/17:00","4/18:00","4/19:00","4/20:00","4/21:00","4/22:00","5/17:00","5/18:00","5/19:00","5/20:00","5/21:00","5/22:00","6/17:00","6/18:00","6/19:00","6/20:00","6/21:00","6/22:00","7/18:00"],"durationMs":737,"requestedAt":"2026-09-28T00:00:10.015Z","respondedAt":"2026-09-28T00:00:10.752Z"}
{"type":"bookings","seq":4,"scheduledOffsetMs":30000,"requestOffsetMs":30012.8,"responseOffsetMs":30296.8,"outcome":"ok","failedCourts":[],"cells":["1/17:00","1/18:00","1/19:00","1/20:00","1/21:00","1/22:00","2/17:00","2/18:00","2/19:00","2/20:00","2/21:00","2/22:00","3/17:00","3/18:00","3/19:00","3/20:00","3/21:00","3/22:00","4/17:00","4/18:00","4/19:00","4/20:00","4/21:00","4/22:00","5/17:00","5/18:00","5/19:00","5/20:00","5/21:00","5/22:00","6/17:00","6/18:00","6/19:00","6/20:00","6/21:00","6/22:00","7/17:00","7/18:00","7/19:00","7/20:00","7/21:00","7/22:00"],"durationMs":284,"requestedAt":"2026-09-28T00:00:30.012Z","respondedAt":"2026-09-28T00:00:30.296Z"}
```

| Moment | Source | Court 7 |
|---|---|---|
| −59.6 s | b1 | No Wednesday records on any court |
| −6 ms / +17 ms | Worker A | Request starts in Chrome / edge stamp |
| +2.845 s | b2 | Only `7/18:00` |
| +5.08 s | #13 (`STALE`, age 15) | Date still not shown |
| +6.09 s | #14 (`HIT`, age 1: copy made about +5 s) | `OOOOOOOOOOXOOOOO`: 19, 20, 21 **open** |
| +10.02–10.75 s | b3 | Still only `7/18:00` |
| +10.579 s | Worker A | **409 "overlaps an existing booking"** |
| +15.10 s | #23 (`STALE`, age 10: the same copy as #14) | Still shows 19–21 open |
| +16.10 s | #24 (`HIT`, age 1: copy made about +15 s) | `OOOOOOOOOXXXXXXO`: 17–22 all unavailable |
| +30.30 s | b4 | `7/17:00` through `7/22:00` |

**Reading.** An overlapping Court 7 booking existed when Onda checked our request, some time before +10.58 s. It was not in the copy made around +5 s. It was not yet in the public records at +10.0–10.75 s. It was in the copy made around +15 s, and in the records by +30.3 s.

So a booking that was probably not there at +5 s was processed before a request that had been at Onda's edge since about +17 ms **(inference: assumes the age-1 copy reflected Onda at about +5 s, and that the public records endpoint was current)**. One sample cannot say why. Onda's ordering is not observable, and its public records name no customer.

### 2.6 The second chance at +606 s, and why the bot did not take it

Reads #126, #136, #137, #199, #200 and #201, and booking records b7–b9, exactly as logged:

```json
{"type":"availability","seq":126,"scheduledOffsetMs":595000,"requestOffsetMs":595007.8,"responseOffsetMs":595177.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXOOO,7:OOOOOOOOOXXXXXOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":170,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:09:55.007Z","respondedAt":"2026-09-28T00:09:55.177Z","requestedManila":"2026-09-28 08:09:55.007","respondedManila":"2026-09-28 08:09:55.177","dateFlag":"published","responseComplete":true,"counts":{"OPEN":63,"TAKEN":49,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":136,"scheduledOffsetMs":605000,"requestOffsetMs":605002.8,"responseOffsetMs":605089.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXOOO,7:OOOOOOOOOXXXXXOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":87,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:05.002Z","respondedAt":"2026-09-28T00:10:05.089Z","requestedManila":"2026-09-28 08:10:05.002","respondedManila":"2026-09-28 08:10:05.089","dateFlag":"published","responseComplete":true,"counts":{"OPEN":63,"TAKEN":49,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":137,"scheduledOffsetMs":606000,"requestOffsetMs":606014.8,"responseOffsetMs":606090.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOOXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOXXXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":1},"durationMs":76,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:10:06.014Z","respondedAt":"2026-09-28T00:10:06.090Z","requestedManila":"2026-09-28 08:10:06.014","respondedManila":"2026-09-28 08:10:06.090","dateFlag":"published","responseComplete":true,"counts":{"OPEN":78,"TAKEN":34,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":199,"scheduledOffsetMs":750000,"requestOffsetMs":750011.8,"responseOffsetMs":750179.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":168,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:12:30.011Z","respondedAt":"2026-09-28T00:12:30.179Z","requestedManila":"2026-09-28 08:12:30.011","respondedManila":"2026-09-28 08:12:30.179","dateFlag":"published","responseComplete":true,"counts":{"OPEN":79,"TAKEN":33,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":200,"scheduledOffsetMs":780000,"requestOffsetMs":780014.8,"responseOffsetMs":780178.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOOXOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":164,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:13:00.014Z","respondedAt":"2026-09-28T00:13:00.178Z","requestedManila":"2026-09-28 08:13:00.014","respondedManila":"2026-09-28 08:13:00.178","dateFlag":"published","responseComplete":true,"counts":{"OPEN":78,"TAKEN":34,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":201,"scheduledOffsetMs":810000,"requestOffsetMs":810005.8,"responseOffsetMs":810155.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOOOXXXXX,2:OOOOOOOOOOOXXXXX,3:XXXXOOOOOOOXXXOO,4:XXXXOOOOOOOXXXOO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOOO,7:OOOOOOOOOOXXOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":150,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:13:30.005Z","respondedAt":"2026-09-28T00:13:30.155Z","requestedManila":"2026-09-28 08:13:30.005","respondedManila":"2026-09-28 08:13:30.155","dateFlag":"published","responseComplete":true,"counts":{"OPEN":77,"TAKEN":35,"UNRELEASED":0,"UNKNOWN":0}}
```

```json
{"type":"bookings","seq":7,"scheduledOffsetMs":300000,"requestOffsetMs":300008.8,"responseOffsetMs":300232.8,"outcome":"ok","failedCourts":[],"cells":["1/17:00","1/18:00","1/19:00","1/20:00","1/21:00","1/22:00","2/17:00","2/18:00","2/19:00","2/20:00","2/21:00","2/22:00","3/17:00","3/18:00","3/22:00","4/17:00","4/18:00","4/19:00","4/20:00","4/21:00","4/22:00","5/17:00","5/18:00","5/19:00","5/20:00","5/21:00","5/22:00","6/17:00","6/18:00","6/19:00","6/20:00","6/21:00","6/22:00","7/17:00","7/18:00","7/19:00","7/20:00","7/21:00","7/22:00"],"durationMs":224,"requestedAt":"2026-09-28T00:05:00.008Z","respondedAt":"2026-09-28T00:05:00.232Z"}
{"type":"bookings","seq":8,"scheduledOffsetMs":600000,"requestOffsetMs":600007.8,"responseOffsetMs":600366.8,"outcome":"ok","failedCourts":[],"cells":["1/19:00","1/20:00","1/21:00","1/22:00","2/19:00","2/20:00","2/21:00","2/22:00","3/17:00","3/18:00","3/19:00","3/20:00","3/21:00","3/22:00","4/17:00","4/18:00","4/19:00","4/20:00","4/21:00","4/22:00","5/17:00","5/18:00","5/19:00","5/20:00","5/21:00","5/22:00","6/17:00","6/18:00","6/19:00","6/20:00","7/17:00","7/18:00","7/19:00","7/20:00","7/21:00"],"durationMs":359,"requestedAt":"2026-09-28T00:10:00.007Z","respondedAt":"2026-09-28T00:10:00.366Z"}
{"type":"bookings","seq":9,"scheduledOffsetMs":900000,"requestOffsetMs":900004.8,"responseOffsetMs":900448.8,"outcome":"ok","failedCourts":[],"cells":["1/19:00","1/20:00","1/21:00","1/22:00","2/19:00","2/20:00","2/21:00","2/22:00","3/19:00","3/20:00","3/21:00","4/19:00","4/20:00","4/21:00","5/19:00","5/20:00","5/21:00","6/19:00","6/20:00","7/18:00","7/19:00"],"durationMs":444,"requestedAt":"2026-09-28T00:15:00.004Z","respondedAt":"2026-09-28T00:15:00.448Z"}
```

C7 19:00–22:00 was open in every dated read from #137 (+606.0 s) to #199 (+750.0 s); read #186 failed. It was taken again in #200 (+780.0 s). Because of the copy ages, Onda had it open from some moment between about +595 and +605 s until some moment between about +745 and +775 s: **at least 140 s**. Appendix B lists C7 in every one of the 204 reads.

The runner classified each of those reads. These are its lines for reads 134–140:

```json
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:03.099Z","elapsedMs":2077156,"sincePreviousMs":1004,"seq":134,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:04.100Z","elapsedMs":2078158,"sincePreviousMs":1002,"seq":135,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:05.096Z","elapsedMs":2079154,"sincePreviousMs":996,"seq":136,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:06.128Z","elapsedMs":2080185,"sincePreviousMs":1031,"seq":137,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:07.096Z","elapsedMs":2081153,"sincePreviousMs":968,"seq":138,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:08.128Z","elapsedMs":2082185,"sincePreviousMs":1032,"seq":139,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:09.098Z","elapsedMs":2083155,"sincePreviousMs":970,"seq":140,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
```

The rule that produced `FORENSIC_ONLY_CACHE_AGE_UNKNOWN` (`src/api-booking/precision-phase3.ts`):

```ts
 109  export type EvidenceFitness = 'ACTIONABLE_FRESH' | 'FORENSIC_ONLY_CACHE_AGE_UNKNOWN' | 'FORENSIC_ONLY_STALE' |
 110    'FORENSIC_ONLY_INCOMPLETE' | 'FORENSIC_ONLY_OUTDATED_REQUEST' | 'UNRELEASED' | 'FAILED';
 111  export interface ActionableObservation { observation: AvailabilityObservation; fitness: EvidenceFitness; ageMs: number }
 112  /** MISS is the only currently documented cache status accepted for action. HIT, STALE,
 113   * absent metadata, and AGE alone cannot bound the represented state. */
 114  export function classifyActionableObservation(observation: AvailabilityObservation, newestAnsweredSeq: number,
 115    releaseMs: number, evaluatedMs: number, maxAgeMs: number): ActionableObservation {
 116    const ageMs = evaluatedMs - (releaseMs + observation.requestOffsetMs);
 117    let fitness: EvidenceFitness;
 118    if (observation.outcome !== 'ok') fitness = 'FAILED';
 119    else if (!observation.targetDatePresent || observation.requestOffsetMs < 0) fitness = 'UNRELEASED';
 120    else if (observation.seq < newestAnsweredSeq) fitness = 'FORENSIC_ONLY_OUTDATED_REQUEST';
 121    else if (decodeMatrix(observation.matrix).size !== 112 || !observation.prices ||
 122      observation.prices.length !== 7 || observation.prices.some(row => row.length !== MATRIX_HOURS.length))
 123      fitness = 'FORENSIC_ONLY_INCOMPLETE';
 124    else if (observation.cache?.status !== 'MISS' || (observation.cache.ageS ?? 0) > 0)
 125      fitness = 'FORENSIC_ONLY_CACHE_AGE_UNKNOWN';
 126    else if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeMs) fitness = 'FORENSIC_ONLY_STALE';
 127    else fitness = 'ACTIONABLE_FRESH';
 128    return { observation, fitness, ageMs };
```

The adaptive loop that drops such reads before Rescue selection (`src/api-booking/desktop-runner.ts`):

```ts
 924        const adaptiveLoop=(async()=>{
 925          while(!abort.signal.aborted&&nowMs()<releaseMs+15*60_000){
 926            for(const observation of phase3Observations.splice(0)){
 927              newestSeq=Math.max(newestSeq,observation.seq);
 928              const latency=Math.max(0,observation.responseOffsetMs-observation.requestOffsetMs);
 929              const maxAge=adaptiveMaxAgeMs(latency,securityRefreshMs);
 930              const evidence=classifyActionableObservation(observation,newestSeq,releaseMs,nowMs(),maxAge);
 931              session.observe(evidence);
 932              stage('PHASE3_EVIDENCE',{seq:observation.seq,fitness:evidence.fitness,cache:observation.cache?.status??'UNKNOWN'});
 933              if(evidence.fitness!=='ACTIONABLE_FRESH')continue;
 934              const fresh=adaptiveFitness(evidence.observation,newestSeq,releaseMs,nowMs(),securityRefreshMs);
 935              if(fresh.fitness!=='ACTIONABLE_FRESH')continue;
 936              if(authorization.rescueEnabled&&pending.size===0)
 937                for(const choice of session.select('RESCUE',nowMs(),maxAge))dispatchAdaptive(choice,'RESCUE');
 938            }
```

The session's own bookkeeping, which is also fed only by fresh reads (`precision-phase3.ts`):

```ts
 253    observe(evidence: ActionableObservation): void {
 254      if (this.latest && evidence.observation.seq <= this.latest.observation.seq) return;
 255      this.latest = evidence;
 256      if (evidence.fitness !== 'ACTIONABLE_FRESH') return;
 257      for (const candidate of this.authorization.candidates) {
 258        const cells = decodeMatrix(evidence.observation.matrix);
 259        const hours = Number(candidate.start.slice(0, 2));
 260        const codes = Array.from({ length: candidate.durationHours }, (_, offset) =>
 261          cells.get(`${candidate.court}/${String(hours + offset).padStart(2, '0')}:00`));
 262        if (codes.some(value => value !== 'O' && value !== 'X')) continue;
 263        const unavailable = codes.some(value => value === 'X');
 264        if (unavailable && !this.rangeWasUnavailable.get(candidate.id)) this.unavailableAt.set(candidate.id,
 265          {seq:evidence.observation.seq,responseOffsetMs:evidence.observation.responseOffsetMs});
 266        this.rangeWasUnavailable.set(candidate.id, unavailable);
 267      }
 268    }
 269    /** Pure selection; caller must durably reserve and recheck before each dispatch. */
 270    select(wave: 'WAVE_2' | 'RESCUE', nowMs: number, maxAgeMs: number): Array<{ candidate: AuthorizedCandidate; workerId: WorkerId; prices: number[]; evidenceSeq: number; reopenEpoch?: number }> {
 271      if (wave === 'WAVE_2' && this.wave2Selected || wave === 'RESCUE' && !this.authorization.rescueEnabled) return [];
 272      if (this.attempts.some(value => value.state === 'UNKNOWN' || value.state === 'VERIFIED')) return [];
 273      if (wave === 'WAVE_2' && !this.authorization.concurrentWave2 && this.attempts.some(value => value.state === 'IN_FLIGHT')) return [];
 274      if (wave === 'RESCUE' && this.attempts.some(value => value.state === 'IN_FLIGHT')) return [];
 275      if (wave === 'RESCUE' && !this.attempts.some(value => value.state === 'REJECTED')) return [];
 276      const evidence = this.latest;
 277      if (!evidence || classifyActionableObservation(evidence.observation, evidence.observation.seq,
 278        this.authorization.releaseMs, nowMs, maxAgeMs).fitness !== 'ACTIONABLE_FRESH') return [];
 279      const consuming = this.consuming();
 280      const budget = Math.min(this.authorization.budgets.total - consuming.length,
 281        this.authorization.budgets[wave === 'WAVE_2' ? 'wave2' : 'rescue'] - consuming.filter(value => value.wave === wave).length);
 282      if (budget <= 0) return [];
 283      const byId = new Map(this.authorization.candidates.map(value => [value.id, value]));
 284      const active = this.attempts.filter(value => value.state === 'IN_FLIGHT' || value.state === 'VERIFIED').map(value => byId.get(value.candidateId)!);
 285      const workers = (wave === 'WAVE_2' ? this.authorization.standby :
 286        [...this.authorization.standby, ...this.authorization.wave1.map(value => value.workerId)])
 287        .filter(worker => wave === 'WAVE_2'
 288          ? !this.attempts.some(value => value.workerId === worker)
 289          : !this.attempts.some(value => value.workerId === worker && value.state === 'IN_FLIGHT'));
 290      const selected: Array<{ candidate: AuthorizedCandidate; workerId: WorkerId; prices: number[]; evidenceSeq: number; reopenEpoch?: number }> = [];
 291      for (const candidate of [...this.authorization.candidates].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))) {
 292        if (selected.length >= budget || selected.length >= workers.length) break;
 293        if (!(wave === 'WAVE_2' ? candidate.permissions.wave2 : candidate.permissions.rescue)) continue;
 294        if (wave === 'WAVE_2' && this.attempts.some(value => value.candidateId === candidate.id)) continue;
 295        const unavailable=this.unavailableAt.get(candidate.id);
 296        if (wave === 'RESCUE' && (!unavailable || unavailable.seq >= evidence.observation.seq ||
 297          unavailable.responseOffsetMs > evidence.observation.requestOffsetMs ||
 298          consuming.some(value => value.wave === 'RESCUE' && value.candidateId === candidate.id && value.reopenEpoch === unavailable.seq))) continue;
 299        if ([...active, ...selected.map(value => value.candidate)].some(value => candidatesConflict(value, candidate))) continue;
 300        const prices = candidatePriceFromObservation(candidate, evidence);
 301        if (!prices) continue;
 302        selected.push({ candidate, workerId: workers[selected.length]!, prices, evidenceSeq: evidence.observation.seq,
 303          ...(wave === 'RESCUE' ? { reopenEpoch: unavailable!.seq } : {}) });
```

**What this means, step by step:**
1. `observe()` returns at line 256 for any read that is not `ACTIONABLE_FRESH`. So the runner never recorded that C7 had been unavailable (`unavailableAt`), and never saw it reopen.
2. The loop skips at line 933 before `session.select('RESCUE', …)`, so Rescue selection was never called.
3. Nothing else was in the way:
   - Rescue was enabled with budget 1.
   - All Wave 1 attempts had settled as `REJECTED` by +12.1 s.
   - Rescue can reuse a settled Wave 1 worker (lines 285–289).
   - The 26 September same-read guard is fixed in this build (`97452c3`, `488552a`).
4. **Would it have won?** Unknown. The window was at least 140 s. Today's security preparation took 3.5–7.9 s, and Onda answered checkouts in 8–12 s. C7 19:00 was taken again in the copy made about +775 s, and C7 18:00 in the copy made about +805 s.

### 2.7 What the app showed for Court 7 at 08:00

The app does not store what its screen shows. This reconstruction applies the Precision panel's own code to the reads and runner lines it received. Here is the code that writes each target line (`ui/renderer/app.ts`):

```ts
1201  const AVAILABILITY_STATUS:Record<string,string>={ACTIONABLE_FRESH:'Fresh · usable for backups',FORENSIC_ONLY_CACHE_AGE_UNKNOWN:'Cached or age unknown · not used',
1202    FORENSIC_ONLY_STALE:'Too old · not used',FORENSIC_ONLY_INCOMPLETE:'Incomplete · not used',FORENSIC_ONLY_OUTDATED_REQUEST:'Older read answered late · not used',
1203    UNRELEASED:'Not released yet',FAILED:'Read failed'};
1204  const ATTEMPT_LABEL:Record<string,string>={WAVE_1:'Immediate attempt',WAVE_2:'Backup attempt',RESCUE:'Reopened-slot attempt'};
1205  function renderPrecision(state:Dashboard){
1206    const setup=state.booking?.setup,live=state.precision;
1207    if(setup?.RELEASE_STRATEGY==='precision'&&setup.PRECISION_PHASE3){
1208      const p=setup.PRECISION_PHASE3 as SmartPhase3,phase=state.phase3,panel=byId('precision-panel');panel.hidden=false;
1209      const current=state.slotWatch?.current?.seq===phase?.seq&&phase?.fitness==='ACTIONABLE_FRESH';
1210      const description=describeSmartPlan(p,{unavailable:unreadyWorkers()});
1211      byId('precision-summary').textContent=[`Smart backups · ${SMART_OUTCOME[phase?.outcome??'']??(phase?.frozen?'Plan frozen for release':'Configured')}`,
1212        `${description.summary} · maximum ${description.maxSends} sends`,
1213        `Availability status: ${AVAILABILITY_STATUS[phase?.fitness??'']??'Waiting for the released schedule'}`].join('\n');
1214      const assigned=new Map(p.wave1.map(value=>[value.candidateIndex,value.workerId] as const));
1215      const backups=p.candidates.map((_,index)=>index).filter(index=>!assigned.has(index)).sort((a,b)=>p.candidates[a]!.priority-p.candidates[b]!.priority||a-b);
1216      const lines=[...p.wave1.map(value=>value.candidateIndex),...backups].map((index,position)=>{
1217        const c=p.candidates[index]!,worker=assigned.get(index),line=document.createElement('div');line.className='precision-line';
1218        const title=document.createElement('strong');title.textContent=worker?`Immediate · Worker ${worker} · Court ${c.court} · ${smartRange(c.start,c.durationHours)}`
1219          :`Backup ${position-p.wave1.length+1} · Court ${c.court} · ${smartRange(c.start,c.durationHours)}`;
1220        const slotHours=Array.from({length:c.durationHours},(_,offset)=>`${String(Number(c.start.slice(0,2))+offset).padStart(2,'0')}:00`);
1221        const cells=slotHours.map(hour=>state.slotWatch?.cells.find(value=>value.court===c.court&&value.hour===hour));
1222        const freshOpen=current&&cells.every(cell=>cell?.state==='OPEN'&&typeof cell.currentPrice==='number'&&cell.currentPrice>0);
1223        const evidence=document.createElement('span');evidence.textContent=freshOpen?`Fresh open · released price ${smartPeso(cells.reduce((total,cell)=>total+cell!.currentPrice!,0))}`:
1224          cells.some(cell=>cell?.state==='TAKEN')?'Unavailable':AVAILABILITY_STATUS[phase?.fitness??'']??'Waiting for the released schedule';
1225        const price=document.createElement('span');price.textContent=worker?`Expected ${smartPeso(c.rateEvidence.perHour.reduce((a,b)=>a+b,0))}`:'Uses the released price';
1226        line.append(title,evidence,price);return line;
1227      });
1228      for(const worker of p.standby){const line=document.createElement('div');line.className='precision-line';line.textContent=`Backup worker ${worker} · waits for a fresh opening`;lines.push(line);}
1229      for(const attempt of phase?.attempts??[]){const line=document.createElement('div');line.className='precision-line';
1230        line.textContent=`${ATTEMPT_LABEL[attempt.wave]??attempt.wave} · Worker ${attempt.workerId} · ${attempt.state}`;lines.push(line);}
1231      byId('precision-table').replaceChildren(...lines);
```

- **When a line reads what.** A line reads "Unavailable" if any of its hours is unavailable in the newest grid. Otherwise it shows the status text for the runner's latest classification. It would show "Fresh open · released price …" only for a fresh read, and there were none after 08:00.
- **The line titles on screen** (from `smartRange`):

```
Immediate · Worker A · Court 7 · 7:00 PM–10:00 PM
Immediate · Worker B · Court 6 · 7:00 PM–10:00 PM
Immediate · Worker C · Court 5 · 7:00 PM–10:00 PM
Immediate · Worker D · Court 4 · 7:00 PM–10:00 PM
Immediate · Worker E · Court 3 · 7:00 PM–10:00 PM
Immediate · Worker F · Court 2 · 7:00 PM–10:00 PM
Immediate · Worker G · Court 1 · 7:00 PM–10:00 PM
Backup 1 · Court 3 · 8:00 PM–11:00 PM
Backup 2 · Court 6 · 5:00 PM–8:00 PM
Backup 3 · Court 6 · 8:00 PM–11:00 PM
```

The table below gives every moment any of those ten lines changed text, in the order the reads were answered. Bold marks the lines that changed.

| Read answered | Read # (grid shown) | "Availability status:" | A · C7 | B · C6 | C · C5 | D · C4 | E · C3 | F · C2 | G · C1 | Backup 1 | Backup 2 | Backup 3 |
|---:|---|---|---|---|---|---|---|---|---|---|---|---|
| −59.715 s | #1 (#1) | Not released yet | **Not released yet** | **Not released yet** | **Not released yet** | **Not released yet** | **Not released yet** | **Not released yet** | **Not released yet** | **Not released yet** | **Not released yet** | **Not released yet** |
| +6.094 s | #14 (#14) | Cached or age unknown · not used | **Cached or age unknown · not used** | **Unavailable** | **Unavailable** | **Unavailable** | **Unavailable** | **Unavailable** | **Unavailable** | **Unavailable** | **Unavailable** | **Unavailable** |
| +16.099 s | #24 (#24) | Cached or age unknown · not used | **Unavailable** | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable |
| +90.170 s | #74 (#74) | Cached or age unknown · not used | Unavailable | Unavailable | **Cached or age unknown · not used** | **Cached or age unknown · not used** | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable |
| +100.174 s | #76 (#76) | Cached or age unknown · not used | Unavailable | Unavailable | **Unavailable** | **Unavailable** | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable |
| +606.091 s | #137 (#137) | Cached or age unknown · not used | **Cached or age unknown · not used** | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable |
| +655.085 s | #186 (#185) | Read failed | **Read failed** | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable |
| +656.094 s | #187 (#187) | Cached or age unknown · not used | **Cached or age unknown · not used** | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable |
| +780.179 s | #200 (#200) | Cached or age unknown · not used | **Unavailable** | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable |

- **Why the Court 7 line looked like an error.** At 08:00:06.094 every other target turned "Unavailable", while Court 7 alone showed "Cached or age unknown · not used". That was the app saying it would not use that read, and it held for 10 s, until 08:00:16.099.
- **The attempt line.** It read `Immediate attempt · Worker A · IN_FLIGHT` from the dispatch (−0.006 s) until `PHASE3_SETTLED` at +10.638 s, then `Immediate attempt · Worker A · REJECTED`.
- **The same text during the reopening.** From 08:10:06 to 08:13:00, while Court 7 was really open, the line read "Cached or age unknown · not used" again.
- **If you saw something else.** If the message you remember was worded differently, or appeared in a Chrome window rather than the app, it is not in any log. A screenshot or the exact wording would let it be traced.

The app's activity log around 08:00 contains only progress lines, no error or warning (all lines from 07:59:50 to 08:00:19):

```json
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:59:50.183Z","text":"PHASE3 EVIDENCE · Progress recorded · 1464240 ms total · +9963 ms since prior stage","level":"info","elapsedMs":1464786,"deltaMs":9963}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:59:58.165Z","text":"PHASE3 EVIDENCE · Progress recorded · 1472222 ms total · +7982 ms since prior stage","level":"info","elapsedMs":1472776,"deltaMs":7990}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:59:59.954Z","text":"PHASE3 DISPATCH · Progress recorded · 1474012 ms total · +1790 ms since prior stage","level":"info","elapsedMs":1474557,"deltaMs":1782}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:59:59.979Z","text":"PHASE3 DISPATCH · Progress recorded · 1474036 ms total · +24 ms since prior stage","level":"info","elapsedMs":1474582,"deltaMs":24}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:59:59.994Z","text":"PHASE3 DISPATCH · Progress recorded · 1474051 ms total · +15 ms since prior stage","level":"info","elapsedMs":1474599,"deltaMs":17}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:59:59.999Z","text":"PHASE3 DISPATCH · Progress recorded · 1474056 ms total · +5 ms since prior stage","level":"info","elapsedMs":1474618,"deltaMs":18}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.003Z","text":"PHASE3 WAVE1 STARTED · Progress recorded · 1474060 ms total · +4 ms since prior stage","level":"info","elapsedMs":1474633,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.003Z","text":"PHASE3 WAVE1 STARTED · Progress recorded · 1474060 ms total · +0 ms since prior stage","level":"info","elapsedMs":1474650,"deltaMs":17}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.004Z","text":"PHASE3 WAVE1 STARTED · Progress recorded · 1474061 ms total · +1 ms since prior stage","level":"info","elapsedMs":1474667,"deltaMs":17}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.004Z","text":"PHASE3 WAVE1 STARTED · Progress recorded · 1474061 ms total · +0 ms since prior stage","level":"info","elapsedMs":1474682,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.004Z","text":"PHASE3 WAVE1 STARTED · Progress recorded · 1474061 ms total · +0 ms since prior stage","level":"info","elapsedMs":1474700,"deltaMs":17}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.004Z","text":"PHASE3 WAVE1 STARTED · Progress recorded · 1474061 ms total · +0 ms since prior stage","level":"info","elapsedMs":1474716,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.004Z","text":"PHASE3 WAVE1 STARTED · Progress recorded · 1474061 ms total · +0 ms since prior stage","level":"info","elapsedMs":1474732,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.008Z","text":"PHASE3 DISPATCH · Progress recorded · 1474066 ms total · +5 ms since prior stage","level":"info","elapsedMs":1474749,"deltaMs":17}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.009Z","text":"PHASE3 DISPATCH · Progress recorded · 1474066 ms total · +0 ms since prior stage","level":"info","elapsedMs":1474765,"deltaMs":17}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.009Z","text":"PHASE3 DISPATCH · Progress recorded · 1474066 ms total · +0 ms since prior stage","level":"info","elapsedMs":1474782,"deltaMs":17}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.294Z","text":"PHASE3 EVIDENCE · Progress recorded · 1474351 ms total · +285 ms since prior stage","level":"info","elapsedMs":1474897,"deltaMs":115}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.417Z","text":"PHASE3 EVIDENCE · Progress recorded · 1474475 ms total · +124 ms since prior stage","level":"info","elapsedMs":1475028,"deltaMs":131}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.611Z","text":"PHASE3 EVIDENCE · Progress recorded · 1474668 ms total · +193 ms since prior stage","level":"info","elapsedMs":1475214,"deltaMs":186}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:01.114Z","text":"PHASE3 EVIDENCE · Progress recorded · 1475171 ms total · +503 ms since prior stage","level":"info","elapsedMs":1475717,"deltaMs":503}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:02.111Z","text":"PHASE3 EVIDENCE · Progress recorded · 1476168 ms total · +997 ms since prior stage","level":"info","elapsedMs":1476714,"deltaMs":997}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:05.100Z","text":"PHASE3 EVIDENCE · Progress recorded · 1479158 ms total · +2990 ms since prior stage","level":"info","elapsedMs":1479703,"deltaMs":2990}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:06.128Z","text":"PHASE3 EVIDENCE · Progress recorded · 1480185 ms total · +1027 ms since prior stage","level":"info","elapsedMs":1480731,"deltaMs":1028}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:07.130Z","text":"PHASE3 EVIDENCE · Progress recorded · 1481187 ms total · +1002 ms since prior stage","level":"info","elapsedMs":1481733,"deltaMs":1002}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:08.079Z","text":"PHASE3 SETTLED · Progress recorded · 1482136 ms total · +949 ms since prior stage","level":"info","elapsedMs":1482682,"deltaMs":949}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:08.132Z","text":"PHASE3 EVIDENCE · Progress recorded · 1482189 ms total · +53 ms since prior stage","level":"info","elapsedMs":1482735,"deltaMs":52}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:09.101Z","text":"PHASE3 EVIDENCE · Progress recorded · 1483158 ms total · +969 ms since prior stage","level":"info","elapsedMs":1483704,"deltaMs":969}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:09.901Z","text":"PHASE3 SETTLED · Progress recorded · 1483958 ms total · +800 ms since prior stage","level":"info","elapsedMs":1484504,"deltaMs":800}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:10.097Z","text":"PHASE3 EVIDENCE · Progress recorded · 1484154 ms total · +196 ms since prior stage","level":"info","elapsedMs":1484700,"deltaMs":196}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:10.381Z","text":"PHASE3 SETTLED · Progress recorded · 1484438 ms total · +284 ms since prior stage","level":"info","elapsedMs":1484984,"deltaMs":284}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:10.443Z","text":"PHASE3 SETTLED · Progress recorded · 1484500 ms total · +62 ms since prior stage","level":"info","elapsedMs":1485046,"deltaMs":61}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:10.638Z","text":"PHASE3 SETTLED · Progress recorded · 1484695 ms total · +195 ms since prior stage","level":"info","elapsedMs":1485241,"deltaMs":196}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:11.098Z","text":"PHASE3 EVIDENCE · Progress recorded · 1485155 ms total · +460 ms since prior stage","level":"info","elapsedMs":1485701,"deltaMs":460}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:12.117Z","text":"PHASE3 SETTLED · Progress recorded · 1486174 ms total · +1019 ms since prior stage","level":"info","elapsedMs":1486720,"deltaMs":1019}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:12.123Z","text":"PHASE3 EVIDENCE · Progress recorded · 1486180 ms total · +6 ms since prior stage","level":"info","elapsedMs":1486737,"deltaMs":17}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:12.123Z","text":"PHASE3 SETTLED · Progress recorded · 1486180 ms total · +0 ms since prior stage","level":"info","elapsedMs":1486753,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:13.091Z","text":"PHASE3 EVIDENCE · Progress recorded · 1487148 ms total · +968 ms since prior stage","level":"info","elapsedMs":1487702,"deltaMs":949}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:14.096Z","text":"PHASE3 EVIDENCE · Progress recorded · 1488153 ms total · +1005 ms since prior stage","level":"info","elapsedMs":1488707,"deltaMs":1004}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:15.129Z","text":"PHASE3 EVIDENCE · Progress recorded · 1489186 ms total · +1033 ms since prior stage","level":"info","elapsedMs":1489732,"deltaMs":1025}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:16.123Z","text":"PHASE3 EVIDENCE · Progress recorded · 1490180 ms total · +994 ms since prior stage","level":"info","elapsedMs":1490726,"deltaMs":994}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:17.119Z","text":"PHASE3 EVIDENCE · Progress recorded · 1491176 ms total · +996 ms since prior stage","level":"info","elapsedMs":1491722,"deltaMs":996}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:18.077Z","text":"PHASE3 EVIDENCE · Progress recorded · 1492134 ms total · +958 ms since prior stage","level":"info","elapsedMs":1492690,"deltaMs":968}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:19.082Z","text":"PHASE3 EVIDENCE · Progress recorded · 1493139 ms total · +1005 ms since prior stage","level":"info","elapsedMs":1493687,"deltaMs":997}
```

### 2.8 The only error lines the app logged (08:15:00)

```json
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:15:00.077Z","text":"Unrecognized structured event omitted.","level":"error","elapsedMs":2374719,"deltaMs":29918}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:15:00.127Z","text":"API run needs attention · ALL_REJECTED_WAITING_FOR_REOPEN · 2374184 ms total · +1 ms since prior stage","level":"error","elapsedMs":2374772,"deltaMs":34}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:15:00.166Z","text":"COMMAND_FAILED","level":"error","elapsedMs":2374808,"deltaMs":35}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:15:00.182Z","text":"Run finished: failed","level":"error","elapsedMs":2374823,"deltaMs":16}
```

- **"Unrecognized structured event omitted." (08:15:00.077).** This is the app dropping the runner's `CRITICAL_PATH_SAVED` message.
  - The runner sends every stage to the app with all its extra fields (`desktop-runner.ts` lines 82–86).
  - `CRITICAL_PATH_SAVED` carries `maxPrePostMs`, `maxFetchInvokedMs`, `maxBrowserRequestStartMs` and `maxRequestObservedMs` (lines 164–166).
  - The app's `apiStage` event schema is `.strict()` and lists none of those fields (`src/ui-events.ts` lines 18–22), so parsing fails and the app logs the line (`ui/processes.ts` lines 109–113).
  - Timing: the runner stamped `CRITICAL_PATH_SAVED` at 00:15:00.112 trusted. The app logged the omission at 00:15:00.077 PC-clock, which is 00:15:00.116 trusted.
  - **It happens on every live run:** 26 September had exactly one, also at 08:15:00. It has nothing to do with Worker A. It only hides a summary line; the file `critical-path.ndjson` was saved.
- **The other three lines** ("API run needs attention · ALL_REJECTED_WAITING_FOR_REOPEN", "COMMAND_FAILED", "Run finished: failed") are the normal ending of a run where every attempt was rejected.

```ts
  82  const stage = (name: string, extra: Record<string, string | number | boolean> = {}) => {
  83    const entry = progressLog.record(name, new Date(nowMs()).toISOString(), stamp(), extra);
  84    emitUiEvent({ type: 'apiStage', stage: name, at: entry.at, elapsedMs: entry.elapsedMs,
  85      sincePreviousMs: entry.sincePreviousMs, ...(name === 'RUN_STARTED' ? { runId: progressLog.runId } : {}), ...extra });
  86  };
```

```ts
 164      stage('CRITICAL_PATH_SAVED',{workerCount:rows.length,maxPrePostMs:worst(row=>row.prePostMs),maxFetchInvokedMs:worst(row=>row.fetchInvokedMs?.ms??null),
 165        maxBrowserRequestStartMs:worst(row=>row.browserRequestStartMs),maxRequestObservedMs:worst(row=>row.requestObservedMs)});
 166    }catch{stage('CRITICAL_PATH_SAVED',{outcome:'FAILED'});}
```

```ts
  18  export const UiEventSchema = z.discriminatedUnion('type', [
  19    z.object({type:z.literal('apiStage'),stage:z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),elapsedMs:z.number().int().nonnegative(),
  20      at:z.iso.datetime().optional(),sincePreviousMs:z.number().int().nonnegative().optional(),runId:z.uuid().optional(),
  21      code:z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional(),workerId:WorkerIdSchema.optional(),workerElapsedMs:z.number().int().nonnegative().optional(),port:z.number().int().optional(),releaseMs:z.number().int().optional(),
  22      releaseOffsetMs:z.number().int().max(0).optional(),triggerMs:z.number().int().optional(),
```

```ts
 109        const consume = (line: string) => {
 110          if (line.startsWith('THIRSTY_EVENT ')) {
 111            try { const event = UiEventSchema.safeParse(JSON.parse(line.slice(14))); if (event.success) { onEvent(event.data); return; } } catch {}
 112            onLine('Unrecognized structured event omitted.', true); return;
 113          }
```

The same error on 26 September, and that run's `CRITICAL_PATH_SAVED` line:

```json
{"type":"activity","runId":"515b2975-e312-44c9-bcda-1ba760f838b6","at":"2026-09-26T00:14:59.687Z","text":"Unrecognized structured event omitted.","level":"error","elapsedMs":2675834,"deltaMs":29690}
{"runId":"e69098a8-b8b2-444e-b0ea-2b1170f1420f","mode":"live","targetDate":"2026-09-28","stage":"CRITICAL_PATH_SAVED","at":"2026-09-26T00:15:00.060Z","elapsedMs":2675249,"sincePreviousMs":29691,"workerCount":6,"maxPrePostMs":2.15,"maxFetchInvokedMs":4.94,"maxBrowserRequestStartMs":7.74,"maxRequestObservedMs":9.61}
```

Today's `CRITICAL_PATH_SAVED` line:

```json
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CRITICAL_PATH_SAVED","at":"2026-09-28T00:15:00.112Z","elapsedMs":2374170,"sincePreviousMs":29915,"workerCount":7,"maxPrePostMs":0.93,"maxFetchInvokedMs":1665243.78,"maxBrowserRequestStartMs":4.83,"maxRequestObservedMs":8.55}
```

### 2.9 Bottom line for Court 7

1. **08:00.** The setting fired correctly and early, but Onda processed another Court 7 booking first. This is the same unobservable ordering inside Onda that decided 26 September.
2. **08:10.** The bot had a real 2½-minute second chance and did not use it, because the new edge cache makes every read unusable under the runner's rule. This part is fixable on our side (section 19, item 1).

## 3. Why the other six lost

| Worker | Court | Sent (Chrome) | Records on this court's 19–21 hours by +2.845 s | Shown in the copy made about +5 s | Answered | Message |
|---|---:|---:|---|---|---:|---|
| B | 6 | −20.9 ms | 19, 20 | 19 X, 20 X, 21 O | +8.066 s | overlaps |
| C | 5 | −45.6 ms | 20 | 19 X, 20 X, 21 X | +10.328 s | overlaps |
| D | 4 | −0.8 ms | none (19–21 by +10.75 s) | 19 O, 20 X, 21 O | +12.088 s | overlaps |
| E | 3 | +4.2 ms | 19, 21 | 19 X, 20 O, 21 X | +9.847 s | overlaps |
| F | 2 | +4.3 ms | 20 | 19 O, 20 X, 21 X | +10.426 s | overlaps |
| G | 1 | +4.8 ms | 19, 21 | 19 X, 20 O, 21 X | +12.109 s | overlaps |

- **Five of the six already had a record in a target hour at +2.845 s,** while our requests were still pending. D's court had records by +10.75 s. The analyzer therefore classes these six as `UNKNOWN_AT_RELEASE`. The first grid anyone could see (+6 s) already showed them partly taken, so they cannot say anything about the race at 08:00:00.
- **Sending earlier changed nothing visible.** Sent order was C, B, A, D, G, E, F. Answered order was B, E, C, F, A, D, G. The biggest lead, 50 ms, is 0.6% of the shortest wait inside Onda (8.1 s).

Every dispatch line and every response line from the runner trace:

```json
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"RELEASE_OFFSET_SCHEDULED","at":"2026-09-27T23:58:00.090Z","elapsedMs":1354152,"sincePreviousMs":29,"releaseMs":1790553600000,"triggerMs":1790553599990,"releaseOffsetMs":-10,"workerId":"A"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"RELEASE_OFFSET_SCHEDULED","at":"2026-09-27T23:58:00.090Z","elapsedMs":1354152,"sincePreviousMs":0,"releaseMs":1790553600000,"triggerMs":1790553599975,"releaseOffsetMs":-25,"workerId":"B"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"RELEASE_OFFSET_SCHEDULED","at":"2026-09-27T23:58:00.090Z","elapsedMs":1354152,"sincePreviousMs":0,"releaseMs":1790553600000,"triggerMs":1790553599950,"releaseOffsetMs":-50,"workerId":"C"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"RELEASE_OFFSET_SCHEDULED","at":"2026-09-27T23:58:00.090Z","elapsedMs":1354152,"sincePreviousMs":0,"releaseMs":1790553600000,"triggerMs":1790553599995,"releaseOffsetMs":-5,"workerId":"D"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_FUNCTION_ENTERED","at":"2026-09-27T23:59:59.911Z","elapsedMs":1474008,"sincePreviousMs":7142,"workerId":"C","lane":"core","attemptType":"official","attemptId":"core-C-official-3","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.911Z","preparedContextAgeMs":10953,"securitySource":"PREPARED_CONTEXT","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_PRE_POST","at":"2026-09-27T23:59:59.912Z","elapsedMs":1474008,"sincePreviousMs":0,"workerId":"C","lane":"core","attemptType":"official","attemptId":"core-C-official-3","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.912Z","preparedContextAgeMs":10954,"securitySource":"PREPARED_CONTEXT","releaseLatenessMs":-49.5,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_DISPATCH","at":"2026-09-27T23:59:59.954Z","elapsedMs":1474012,"sincePreviousMs":1790,"workerId":"C","candidateId":"0aafa30e010464e6b8a17e61980df60fbbbfb769640964ed4af67b15f6b6a09d","wave":"WAVE_1","attemptId":"core-C-official-3"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_HTTP_POST_INITIATED","at":"2026-09-27T23:59:59.915Z","elapsedMs":1474011,"sincePreviousMs":3,"workerId":"C","lane":"core","attemptType":"official","attemptId":"core-C-official-3","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.915Z","initiationEvidence":"PLAYWRIGHT_REQUEST_EVENT","releaseLatenessMs":-45.8,"operation":"checkout","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":1}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_FUNCTION_ENTERED","at":"2026-09-27T23:59:59.936Z","elapsedMs":1474032,"sincePreviousMs":21,"workerId":"B","lane":"core","attemptType":"official","attemptId":"core-B-official-2","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.936Z","preparedContextAgeMs":11520,"securitySource":"PREPARED_CONTEXT","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":1}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_PRE_POST","at":"2026-09-27T23:59:59.936Z","elapsedMs":1474032,"sincePreviousMs":0,"workerId":"B","lane":"core","attemptType":"official","attemptId":"core-B-official-2","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.936Z","preparedContextAgeMs":11520,"securitySource":"PREPARED_CONTEXT","releaseLatenessMs":-24.9,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":1}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_DISPATCH","at":"2026-09-27T23:59:59.979Z","elapsedMs":1474036,"sincePreviousMs":24,"workerId":"B","candidateId":"9cf2c3872f8c8c5e6867a9211f3fc9e91f9903a7451380bb72b0b187da0f0fcf","wave":"WAVE_1","attemptId":"core-B-official-2"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_HTTP_POST_INITIATED","at":"2026-09-27T23:59:59.940Z","elapsedMs":1474036,"sincePreviousMs":4,"workerId":"B","lane":"core","attemptType":"official","attemptId":"core-B-official-2","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.940Z","initiationEvidence":"PLAYWRIGHT_REQUEST_EVENT","releaseLatenessMs":-21.2,"operation":"checkout","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":2}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_FUNCTION_ENTERED","at":"2026-09-27T23:59:59.951Z","elapsedMs":1474047,"sincePreviousMs":11,"workerId":"A","lane":"core","attemptType":"official","attemptId":"core-A-official-1","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.951Z","preparedContextAgeMs":10513,"securitySource":"PREPARED_CONTEXT","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":2}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_PRE_POST","at":"2026-09-27T23:59:59.951Z","elapsedMs":1474047,"sincePreviousMs":0,"workerId":"A","lane":"core","attemptType":"official","attemptId":"core-A-official-1","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.951Z","preparedContextAgeMs":10513,"securitySource":"PREPARED_CONTEXT","releaseLatenessMs":-9.9,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":2}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_DISPATCH","at":"2026-09-27T23:59:59.994Z","elapsedMs":1474051,"sincePreviousMs":15,"workerId":"A","candidateId":"85746ed1a88a159960b11e0d2c8b10c708b9f33cd500ea5a2bb0850aa481b032","wave":"WAVE_1","attemptId":"core-A-official-1"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_HTTP_POST_INITIATED","at":"2026-09-27T23:59:59.955Z","elapsedMs":1474051,"sincePreviousMs":4,"workerId":"A","lane":"core","attemptType":"official","attemptId":"core-A-official-1","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.955Z","initiationEvidence":"PLAYWRIGHT_REQUEST_EVENT","releaseLatenessMs":-6.2,"operation":"checkout","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":3}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_FUNCTION_ENTERED","at":"2026-09-27T23:59:59.956Z","elapsedMs":1474052,"sincePreviousMs":1,"workerId":"D","lane":"core","attemptType":"official","attemptId":"core-D-official-4","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.956Z","preparedContextAgeMs":7186,"securitySource":"PREPARED_CONTEXT","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":3}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_PRE_POST","at":"2026-09-27T23:59:59.956Z","elapsedMs":1474052,"sincePreviousMs":0,"workerId":"D","lane":"core","attemptType":"official","attemptId":"core-D-official-4","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.956Z","preparedContextAgeMs":7186,"securitySource":"PREPARED_CONTEXT","releaseLatenessMs":-4.9,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":3}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_DISPATCH","at":"2026-09-27T23:59:59.999Z","elapsedMs":1474056,"sincePreviousMs":5,"workerId":"D","candidateId":"5dfb38082fe0d4977a10e38c4c9206b64a97e97ea8034aa93f6a7fd699d6b59a","wave":"WAVE_1","attemptId":"core-D-official-4"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_HTTP_POST_INITIATED","at":"2026-09-27T23:59:59.960Z","elapsedMs":1474056,"sincePreviousMs":4,"workerId":"D","lane":"core","attemptType":"official","attemptId":"core-D-official-4","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.960Z","initiationEvidence":"PLAYWRIGHT_REQUEST_EVENT","releaseLatenessMs":-1,"operation":"checkout","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":4}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_WAVE1_STARTED","at":"2026-09-28T00:00:00.003Z","elapsedMs":1474060,"sincePreviousMs":4,"workerId":"A","candidateId":"85746ed1a88a159960b11e0d2c8b10c708b9f33cd500ea5a2bb0850aa481b032","wave":"WAVE_1","attemptId":"core-A-official-1","court":7,"startTime":"19:00","endTime":"22:00","amount":2100}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_WAVE1_STARTED","at":"2026-09-28T00:00:00.003Z","elapsedMs":1474060,"sincePreviousMs":0,"workerId":"B","candidateId":"9cf2c3872f8c8c5e6867a9211f3fc9e91f9903a7451380bb72b0b187da0f0fcf","wave":"WAVE_1","attemptId":"core-B-official-2","court":6,"startTime":"19:00","endTime":"22:00","amount":2100}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_WAVE1_STARTED","at":"2026-09-28T00:00:00.004Z","elapsedMs":1474061,"sincePreviousMs":1,"workerId":"C","candidateId":"0aafa30e010464e6b8a17e61980df60fbbbfb769640964ed4af67b15f6b6a09d","wave":"WAVE_1","attemptId":"core-C-official-3","court":5,"startTime":"19:00","endTime":"22:00","amount":2100}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_WAVE1_STARTED","at":"2026-09-28T00:00:00.004Z","elapsedMs":1474061,"sincePreviousMs":0,"workerId":"D","candidateId":"5dfb38082fe0d4977a10e38c4c9206b64a97e97ea8034aa93f6a7fd699d6b59a","wave":"WAVE_1","attemptId":"core-D-official-4","court":4,"startTime":"19:00","endTime":"22:00","amount":2100}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_WAVE1_STARTED","at":"2026-09-28T00:00:00.004Z","elapsedMs":1474061,"sincePreviousMs":0,"workerId":"E","candidateId":"5589eb0cb6e51ddb891ffe17f5b7b8d0a3acbbd46ee68a9d8fe68832504154c3","wave":"WAVE_1","attemptId":"core-E-official-5","court":3,"startTime":"19:00","endTime":"22:00","amount":2100}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_WAVE1_STARTED","at":"2026-09-28T00:00:00.004Z","elapsedMs":1474061,"sincePreviousMs":0,"workerId":"F","candidateId":"9a0e7b37cb7df37170afa84d5efeb1706016659f468b2baa5f237296291e991c","wave":"WAVE_1","attemptId":"core-F-official-6","court":2,"startTime":"19:00","endTime":"22:00","amount":2100}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_WAVE1_STARTED","at":"2026-09-28T00:00:00.004Z","elapsedMs":1474061,"sincePreviousMs":0,"workerId":"G","candidateId":"5caf181e63715dbd31129a673fe1b463ba7602d79cf8d96902831f4196b3baeb","wave":"WAVE_1","attemptId":"core-G-official-7","court":1,"startTime":"19:00","endTime":"22:00","amount":2100}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_FUNCTION_ENTERED","at":"2026-09-27T23:59:59.961Z","elapsedMs":1474057,"sincePreviousMs":1,"workerId":"E","lane":"core","attemptType":"official","attemptId":"core-E-official-5","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.961Z","preparedContextAgeMs":10814,"securitySource":"PREPARED_CONTEXT","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":4}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_PRE_POST","at":"2026-09-27T23:59:59.961Z","elapsedMs":1474057,"sincePreviousMs":0,"workerId":"E","lane":"core","attemptType":"official","attemptId":"core-E-official-5","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.961Z","preparedContextAgeMs":10814,"securitySource":"PREPARED_CONTEXT","releaseLatenessMs":0.1,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":4}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_FUNCTION_ENTERED","at":"2026-09-27T23:59:59.962Z","elapsedMs":1474058,"sincePreviousMs":1,"workerId":"F","lane":"core","attemptType":"official","attemptId":"core-F-official-6","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.962Z","preparedContextAgeMs":10714,"securitySource":"PREPARED_CONTEXT","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":4}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_PRE_POST","at":"2026-09-27T23:59:59.962Z","elapsedMs":1474058,"sincePreviousMs":0,"workerId":"F","lane":"core","attemptType":"official","attemptId":"core-F-official-6","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.962Z","preparedContextAgeMs":10714,"securitySource":"PREPARED_CONTEXT","releaseLatenessMs":0.6,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":4}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_FUNCTION_ENTERED","at":"2026-09-27T23:59:59.962Z","elapsedMs":1474058,"sincePreviousMs":0,"workerId":"G","lane":"core","attemptType":"official","attemptId":"core-G-official-7","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.962Z","preparedContextAgeMs":10931,"securitySource":"PREPARED_CONTEXT","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":4}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_PRE_POST","at":"2026-09-27T23:59:59.962Z","elapsedMs":1474058,"sincePreviousMs":0,"workerId":"G","lane":"core","attemptType":"official","attemptId":"core-G-official-7","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.962Z","preparedContextAgeMs":10931,"securitySource":"PREPARED_CONTEXT","releaseLatenessMs":0.9,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":4}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_DISPATCH","at":"2026-09-28T00:00:00.008Z","elapsedMs":1474066,"sincePreviousMs":5,"workerId":"G","candidateId":"5caf181e63715dbd31129a673fe1b463ba7602d79cf8d96902831f4196b3baeb","wave":"WAVE_1","attemptId":"core-G-official-7"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_DISPATCH","at":"2026-09-28T00:00:00.009Z","elapsedMs":1474066,"sincePreviousMs":0,"workerId":"E","candidateId":"5589eb0cb6e51ddb891ffe17f5b7b8d0a3acbbd46ee68a9d8fe68832504154c3","wave":"WAVE_1","attemptId":"core-E-official-5"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_HTTP_POST_INITIATED","at":"2026-09-27T23:59:59.969Z","elapsedMs":1474065,"sincePreviousMs":7,"workerId":"G","lane":"core","attemptType":"official","attemptId":"core-G-official-7","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.969Z","initiationEvidence":"PLAYWRIGHT_REQUEST_EVENT","releaseLatenessMs":8,"operation":"checkout","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":5}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_DISPATCH","at":"2026-09-28T00:00:00.009Z","elapsedMs":1474066,"sincePreviousMs":0,"workerId":"F","candidateId":"9a0e7b37cb7df37170afa84d5efeb1706016659f468b2baa5f237296291e991c","wave":"WAVE_1","attemptId":"core-F-official-6"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_HTTP_POST_INITIATED","at":"2026-09-27T23:59:59.970Z","elapsedMs":1474066,"sincePreviousMs":1,"workerId":"E","lane":"core","attemptType":"official","attemptId":"core-E-official-5","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.970Z","initiationEvidence":"PLAYWRIGHT_REQUEST_EVENT","releaseLatenessMs":8.5,"operation":"checkout","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":6}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_HTTP_POST_INITIATED","at":"2026-09-27T23:59:59.970Z","elapsedMs":1474066,"sincePreviousMs":0,"workerId":"F","lane":"core","attemptType":"official","attemptId":"core-F-official-6","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.970Z","initiationEvidence":"PLAYWRIGHT_REQUEST_EVENT","releaseLatenessMs":8.6,"operation":"checkout","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":7}
```

```json
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_RESPONSE_COMPLETED","at":"2026-09-28T00:00:08.027Z","elapsedMs":1482123,"sincePreviousMs":8057,"workerId":"B","lane":"core","attemptType":"official","attemptId":"core-B-official-2","timingKind":"MEASURED_DURATION","eventAt":"2026-09-28T00:00:08.027Z","networkDurationMs":8089,"statusCode":409,"dispatchState":"RESPONSE_CAPTURED","failureCategory":"ONDA_HTTP_STATUS_INVALID","errorHint":"availability","responseSource":"application","responseBytes":100,"bodyShape":"80651c57074d","operation":"checkout","durationMs":8087,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":6}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_SETTLED","at":"2026-09-28T00:00:08.079Z","elapsedMs":1482136,"sincePreviousMs":949,"workerId":"B","candidateId":"9cf2c3872f8c8c5e6867a9211f3fc9e91f9903a7451380bb72b0b187da0f0fcf","wave":"WAVE_1","attemptId":"core-B-official-2","state":"REJECTED"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_RESPONSE_COMPLETED","at":"2026-09-28T00:00:09.808Z","elapsedMs":1483904,"sincePreviousMs":1781,"workerId":"E","lane":"core","attemptType":"official","attemptId":"core-E-official-5","timingKind":"MEASURED_DURATION","eventAt":"2026-09-28T00:00:09.808Z","networkDurationMs":9846,"statusCode":409,"dispatchState":"RESPONSE_CAPTURED","failureCategory":"ONDA_HTTP_STATUS_INVALID","errorHint":"availability","responseSource":"application","responseBytes":100,"bodyShape":"80651c57074d","operation":"checkout","durationMs":9839,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":5}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_SETTLED","at":"2026-09-28T00:00:09.901Z","elapsedMs":1483958,"sincePreviousMs":800,"workerId":"E","candidateId":"5589eb0cb6e51ddb891ffe17f5b7b8d0a3acbbd46ee68a9d8fe68832504154c3","wave":"WAVE_1","attemptId":"core-E-official-5","state":"REJECTED"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_RESPONSE_COMPLETED","at":"2026-09-28T00:00:10.289Z","elapsedMs":1484385,"sincePreviousMs":481,"workerId":"C","lane":"core","attemptType":"official","attemptId":"core-C-official-3","timingKind":"MEASURED_DURATION","eventAt":"2026-09-28T00:00:10.289Z","networkDurationMs":10377,"statusCode":409,"dispatchState":"RESPONSE_CAPTURED","failureCategory":"ONDA_HTTP_STATUS_INVALID","errorHint":"availability","responseSource":"application","responseBytes":100,"bodyShape":"80651c57074d","operation":"checkout","durationMs":10373,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":4}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_SETTLED","at":"2026-09-28T00:00:10.381Z","elapsedMs":1484438,"sincePreviousMs":284,"workerId":"C","candidateId":"0aafa30e010464e6b8a17e61980df60fbbbfb769640964ed4af67b15f6b6a09d","wave":"WAVE_1","attemptId":"core-C-official-3","state":"REJECTED"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_RESPONSE_COMPLETED","at":"2026-09-28T00:00:10.387Z","elapsedMs":1484483,"sincePreviousMs":98,"workerId":"F","lane":"core","attemptType":"official","attemptId":"core-F-official-6","timingKind":"MEASURED_DURATION","eventAt":"2026-09-28T00:00:10.387Z","networkDurationMs":10425,"statusCode":409,"dispatchState":"RESPONSE_CAPTURED","failureCategory":"ONDA_HTTP_STATUS_INVALID","errorHint":"availability","responseSource":"application","responseBytes":100,"bodyShape":"80651c57074d","operation":"checkout","durationMs":10418,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":3}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_SETTLED","at":"2026-09-28T00:00:10.443Z","elapsedMs":1484500,"sincePreviousMs":62,"workerId":"F","candidateId":"9a0e7b37cb7df37170afa84d5efeb1706016659f468b2baa5f237296291e991c","wave":"WAVE_1","attemptId":"core-F-official-6","state":"REJECTED"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_RESPONSE_COMPLETED","at":"2026-09-28T00:00:10.540Z","elapsedMs":1484636,"sincePreviousMs":153,"workerId":"A","lane":"core","attemptType":"official","attemptId":"core-A-official-1","timingKind":"MEASURED_DURATION","eventAt":"2026-09-28T00:00:10.540Z","networkDurationMs":10588,"statusCode":409,"dispatchState":"RESPONSE_CAPTURED","failureCategory":"ONDA_HTTP_STATUS_INVALID","errorHint":"availability","responseSource":"application","responseBytes":100,"bodyShape":"80651c57074d","operation":"checkout","durationMs":10585,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":2}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_SETTLED","at":"2026-09-28T00:00:10.638Z","elapsedMs":1484695,"sincePreviousMs":195,"workerId":"A","candidateId":"85746ed1a88a159960b11e0d2c8b10c708b9f33cd500ea5a2bb0850aa481b032","wave":"WAVE_1","attemptId":"core-A-official-1","state":"REJECTED"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_RESPONSE_COMPLETED","at":"2026-09-28T00:00:12.049Z","elapsedMs":1486145,"sincePreviousMs":1509,"workerId":"D","lane":"core","attemptType":"official","attemptId":"core-D-official-4","timingKind":"MEASURED_DURATION","eventAt":"2026-09-28T00:00:12.049Z","networkDurationMs":12093,"statusCode":409,"dispatchState":"RESPONSE_CAPTURED","failureCategory":"ONDA_HTTP_STATUS_INVALID","errorHint":"availability","responseSource":"application","responseBytes":100,"bodyShape":"80651c57074d","operation":"checkout","durationMs":12089,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":1}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_RESPONSE_COMPLETED","at":"2026-09-28T00:00:12.070Z","elapsedMs":1486166,"sincePreviousMs":21,"workerId":"G","lane":"core","attemptType":"official","attemptId":"core-G-official-7","timingKind":"MEASURED_DURATION","eventAt":"2026-09-28T00:00:12.070Z","networkDurationMs":12108,"statusCode":409,"dispatchState":"RESPONSE_CAPTURED","failureCategory":"ONDA_HTTP_STATUS_INVALID","errorHint":"availability","responseSource":"application","responseBytes":100,"bodyShape":"80651c57074d","operation":"checkout","durationMs":12101,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_SETTLED","at":"2026-09-28T00:00:12.117Z","elapsedMs":1486174,"sincePreviousMs":1019,"workerId":"D","candidateId":"5dfb38082fe0d4977a10e38c4c9206b64a97e97ea8034aa93f6a7fd699d6b59a","wave":"WAVE_1","attemptId":"core-D-official-4","state":"REJECTED"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_SETTLED","at":"2026-09-28T00:00:12.123Z","elapsedMs":1486180,"sincePreviousMs":0,"workerId":"G","candidateId":"5caf181e63715dbd31129a673fe1b463ba7602d79cf8d96902831f4196b3baeb","wave":"WAVE_1","attemptId":"core-G-official-7","state":"REJECTED"}
```

## 4. The edge-cache change (new since 26 September)

The Slot Watch sent the same request as on every earlier morning (`src/api-booking/live-availability-provider.ts`):

```ts
  49      const params = new URLSearchParams({ startDate: query.startDate, endDate: query.endDate, duration: '60', includeSchedule: 'true' });
  50      const url = `${ORIGIN}/api/public/facilities/${THIRSTY_PICKLE_FACILITY_ID}/date-availability?${params}`;
  51      let response: Response;
  52      try {
  53        response = await this.fetcher(url, { method: 'GET', redirect: 'error', credentials: 'omit',
  54          headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs) });
```

| Release (target) | Availability reads answered | `MISS` | `HIT` | `STALE` |
|---|---:|---:|---:|---:|
| 25 Sep (Sun 27) | 127 | 127 | 0 | 0 |
| 26 Sep (Mon 28) | 204 | 204 | 0 | 0 |
| **28 Sep (Wed 30)** | **202** | **1** | **157** | **44** |

Reads #1, #2, #7, #8, #12, #13 and #14, exactly as logged:

```json
{"type":"availability","seq":1,"scheduledOffsetMs":-60000,"requestOffsetMs":-59987.2,"responseOffsetMs":-59715.2,"outcome":"ok","targetDatePresent":false,"matrix":"1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????","cache":{"status":"MISS","ageS":0},"durationMs":272,"inFlightAtLaunch":1,"requestedAt":"2026-09-27T23:59:00.012Z","respondedAt":"2026-09-27T23:59:00.284Z","requestedManila":"2026-09-28 07:59:00.012","respondedManila":"2026-09-28 07:59:00.284","dateFlag":"absent","responseComplete":false,"counts":{"OPEN":0,"TAKEN":0,"UNRELEASED":0,"UNKNOWN":112}}
{"type":"availability","seq":2,"scheduledOffsetMs":-50000,"requestOffsetMs":-49994.2,"responseOffsetMs":-49839.2,"outcome":"ok","targetDatePresent":false,"matrix":"1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????","cache":{"status":"STALE","ageS":10},"durationMs":155,"inFlightAtLaunch":1,"requestedAt":"2026-09-27T23:59:10.005Z","respondedAt":"2026-09-27T23:59:10.160Z","requestedManila":"2026-09-28 07:59:10.005","respondedManila":"2026-09-28 07:59:10.160","dateFlag":"absent","responseComplete":false,"counts":{"OPEN":0,"TAKEN":0,"UNRELEASED":0,"UNKNOWN":112}}
{"type":"availability","seq":7,"scheduledOffsetMs":-2000,"requestOffsetMs":-1991.2,"responseOffsetMs":-1840.2,"outcome":"ok","targetDatePresent":false,"matrix":"1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????","cache":{"status":"HIT","ageS":8},"durationMs":151,"inFlightAtLaunch":1,"requestedAt":"2026-09-27T23:59:58.008Z","respondedAt":"2026-09-27T23:59:58.159Z","requestedManila":"2026-09-28 07:59:58.008","respondedManila":"2026-09-28 07:59:58.159","dateFlag":"absent","responseComplete":false,"counts":{"OPEN":0,"TAKEN":0,"UNRELEASED":0,"UNKNOWN":112}}
{"type":"availability","seq":8,"scheduledOffsetMs":0,"requestOffsetMs":9.8,"responseOffsetMs":261.8,"outcome":"ok","targetDatePresent":false,"matrix":"1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????","cache":{"status":"STALE","ageS":10},"durationMs":252,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:00.009Z","respondedAt":"2026-09-28T00:00:00.261Z","requestedManila":"2026-09-28 08:00:00.009","respondedManila":"2026-09-28 08:00:00.261","dateFlag":"absent","responseComplete":false,"counts":{"OPEN":0,"TAKEN":0,"UNRELEASED":0,"UNKNOWN":112}}
{"type":"availability","seq":12,"scheduledOffsetMs":2000,"requestOffsetMs":2013.8,"responseOffsetMs":2076.8,"outcome":"ok","targetDatePresent":false,"matrix":"1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????","cache":{"status":"STALE","ageS":12},"durationMs":63,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:02.013Z","respondedAt":"2026-09-28T00:00:02.076Z","requestedManila":"2026-09-28 08:00:02.013","respondedManila":"2026-09-28 08:00:02.076","dateFlag":"absent","responseComplete":false,"counts":{"OPEN":0,"TAKEN":0,"UNRELEASED":0,"UNKNOWN":112}}
{"type":"availability","seq":13,"scheduledOffsetMs":5000,"requestOffsetMs":5002.8,"responseOffsetMs":5082.8,"outcome":"ok","targetDatePresent":false,"matrix":"1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????","cache":{"status":"STALE","ageS":15},"durationMs":80,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:05.002Z","respondedAt":"2026-09-28T00:00:05.082Z","requestedManila":"2026-09-28 08:00:05.002","respondedManila":"2026-09-28 08:00:05.082","dateFlag":"absent","responseComplete":false,"counts":{"OPEN":0,"TAKEN":0,"UNRELEASED":0,"UNKNOWN":112}}
{"type":"availability","seq":14,"scheduledOffsetMs":6000,"requestOffsetMs":6013.8,"responseOffsetMs":6093.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXOXOO,2:OOOOOOOOOOXOXXOO,3:XXXXOOOOOXXXOXXO,4:XXXXOOOOOXXOXOXO,5:XXXXOOOOOOOXXXOO,6:OOOOOOOOOOOXXOXO,7:OOOOOOOOOOXOOOOO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":1},"durationMs":80,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:00:06.013Z","respondedAt":"2026-09-28T00:00:06.093Z","requestedManila":"2026-09-28 08:00:06.013","respondedManila":"2026-09-28 08:00:06.093","dateFlag":"published","responseComplete":true,"counts":{"OPEN":77,"TAKEN":35,"UNRELEASED":0,"UNKNOWN":0}}
```

- **Before release.** Read #1 at −60 s was `MISS`. From −50 s every read was a copy: `STALE` with age 10 s, and at −2 s `HIT` with age 8 s.
- **Across 08:00.** Reads #8–#13 (+0.01 to +5.08 s) were `STALE` copies aged 10–15 s, still without Wednesday. The first copy with Wednesday was served at +6.09 s with age 1 s, so it was made around +5 s.
- **After release.** Copies were replaced about every 10 s: `HIT` at ages 0–9, `STALE` at 10 or more. That looks like a 10-second edge lifetime, with stale copies served while they refresh **(inference: the Slot Watch does not record the feed's `Cache-Control` header)**.
- **Checkout was not affected.** The checkout endpoint still answered `public, max-age=0, must-revalidate` with `MISS`.

The runner's classification of every read from −60 s to +7 s (all 203 rows are in Appendix E):

```json
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-27T23:59:00.299Z","elapsedMs":1414356,"sincePreviousMs":106,"seq":1,"fitness":"UNRELEASED","cache":"MISS"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-27T23:59:10.196Z","elapsedMs":1424253,"sincePreviousMs":9897,"seq":2,"fitness":"UNRELEASED","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-27T23:59:20.203Z","elapsedMs":1434260,"sincePreviousMs":10007,"seq":3,"fitness":"UNRELEASED","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-27T23:59:30.194Z","elapsedMs":1444251,"sincePreviousMs":5,"seq":4,"fitness":"UNRELEASED","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-27T23:59:40.220Z","elapsedMs":1454277,"sincePreviousMs":10026,"seq":5,"fitness":"UNRELEASED","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-27T23:59:50.183Z","elapsedMs":1464240,"sincePreviousMs":9963,"seq":6,"fitness":"UNRELEASED","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-27T23:59:58.165Z","elapsedMs":1472222,"sincePreviousMs":7982,"seq":7,"fitness":"UNRELEASED","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:00.294Z","elapsedMs":1474351,"sincePreviousMs":285,"seq":8,"fitness":"UNRELEASED","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:00.417Z","elapsedMs":1474475,"sincePreviousMs":124,"seq":9,"fitness":"UNRELEASED","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:00.611Z","elapsedMs":1474668,"sincePreviousMs":193,"seq":10,"fitness":"UNRELEASED","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:01.114Z","elapsedMs":1475171,"sincePreviousMs":503,"seq":11,"fitness":"UNRELEASED","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:02.111Z","elapsedMs":1476168,"sincePreviousMs":997,"seq":12,"fitness":"UNRELEASED","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:05.100Z","elapsedMs":1479158,"sincePreviousMs":2990,"seq":13,"fitness":"UNRELEASED","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:06.128Z","elapsedMs":1480185,"sincePreviousMs":1027,"seq":14,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:07.130Z","elapsedMs":1481187,"sincePreviousMs":1002,"seq":15,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:08.132Z","elapsedMs":1482189,"sincePreviousMs":53,"seq":16,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
```

| Classification of the 203 runner evidence rows | Rows |
|---|---:|
| Forensic only (155 `HIT`, 33 `STALE`) | 188 |
| Not yet released | 13 |
| Failed | 2 |
| **Actionable** | **0** |

The public booking site reads the same feed. Anyone watching the grid saw Wednesday unpublished until about +6 s, and then a copy up to 10 s old. Thirteen records were already visible at +2.8 s, so at least some bookers did not wait for the grid **(inference)**.

## 5. Courts 4 and 5 at +90 s

```json
{"type":"availability","seq":73,"scheduledOffsetMs":85000,"requestOffsetMs":85016.8,"responseOffsetMs":85185.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":169,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:01:25.016Z","respondedAt":"2026-09-28T00:01:25.185Z","requestedManila":"2026-09-28 08:01:25.016","respondedManila":"2026-09-28 08:01:25.185","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":74,"scheduledOffsetMs":90000,"requestOffsetMs":90008.8,"responseOffsetMs":90169.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXOOOXO,5:XXXXOOOOOXXOOOXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":161,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:01:30.008Z","respondedAt":"2026-09-28T00:01:30.169Z","requestedManila":"2026-09-28 08:01:30.008","respondedManila":"2026-09-28 08:01:30.169","dateFlag":"published","responseComplete":true,"counts":{"OPEN":64,"TAKEN":48,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":75,"scheduledOffsetMs":95000,"requestOffsetMs":95003.8,"responseOffsetMs":95174.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXOOOXO,5:XXXXOOOOOXXOOOXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"STALE","ageS":10},"durationMs":171,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:01:35.003Z","respondedAt":"2026-09-28T00:01:35.174Z","requestedManila":"2026-09-28 08:01:35.003","respondedManila":"2026-09-28 08:01:35.174","dateFlag":"published","responseComplete":true,"counts":{"OPEN":64,"TAKEN":48,"UNRELEASED":0,"UNKNOWN":0}}
{"type":"availability","seq":76,"scheduledOffsetMs":100000,"requestOffsetMs":100004.8,"responseOffsetMs":100173.8,"outcome":"ok","targetDatePresent":true,"matrix":"1:OOOOOOOOOXXXXXXO,2:OOOOOOOOOXXXXXXO,3:XXXXOOOOOXXXXXXO,4:XXXXOOOOOXXXXXXO,5:XXXXOOOOOXXXXXXO,6:OOOOOOOOOXXXXXXO,7:OOOOOOOOOXXXXXXO","prices":[[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700],[600,600,600,600,600,600,600,600,700,700,700,700,700,700,700,700]],"cache":{"status":"HIT","ageS":5},"durationMs":169,"inFlightAtLaunch":1,"requestedAt":"2026-09-28T00:01:40.004Z","respondedAt":"2026-09-28T00:01:40.173Z","requestedManila":"2026-09-28 08:01:40.004","respondedManila":"2026-09-28 08:01:40.173","dateFlag":"published","responseComplete":true,"counts":{"OPEN":58,"TAKEN":54,"UNRELEASED":0,"UNKNOWN":0}}
```

```json
{"type":"bookings","seq":5,"scheduledOffsetMs":60000,"requestOffsetMs":60009.8,"responseOffsetMs":60264.8,"outcome":"ok","failedCourts":[],"cells":["1/17:00","1/18:00","1/19:00","1/20:00","1/21:00","1/22:00","2/17:00","2/18:00","2/19:00","2/20:00","2/21:00","2/22:00","3/17:00","3/18:00","3/19:00","3/20:00","3/21:00","3/22:00","4/17:00","4/18:00","4/19:00","4/20:00","4/21:00","4/22:00","5/17:00","5/18:00","5/19:00","5/20:00","5/21:00","5/22:00","6/17:00","6/18:00","6/19:00","6/20:00","6/21:00","6/22:00","7/17:00","7/18:00","7/19:00","7/20:00","7/21:00","7/22:00"],"durationMs":255,"requestedAt":"2026-09-28T00:01:00.009Z","respondedAt":"2026-09-28T00:01:00.264Z"}
{"type":"bookings","seq":6,"scheduledOffsetMs":120000,"requestOffsetMs":120012.8,"responseOffsetMs":120239.8,"outcome":"ok","failedCourts":[],"cells":["1/17:00","1/18:00","1/19:00","1/20:00","1/21:00","1/22:00","2/17:00","2/18:00","2/19:00","2/20:00","2/21:00","2/22:00","3/17:00","3/18:00","3/19:00","3/20:00","3/21:00","3/22:00","4/17:00","4/18:00","4/19:00","4/20:00","4/21:00","4/22:00","5/17:00","5/18:00","5/19:00","5/20:00","5/21:00","5/22:00","6/17:00","6/18:00","6/19:00","6/20:00","6/21:00","6/22:00","7/17:00","7/18:00","7/19:00","7/20:00","7/21:00","7/22:00"],"durationMs":227,"requestedAt":"2026-09-28T00:02:00.012Z","respondedAt":"2026-09-28T00:02:00.239Z"}
```

- **What the grid showed.** C4 and C5 19:00–22:00 were open in reads #74 and #75, which served the same copy, made about +85 s. The copies made about +75 s (#73) and about +95 s (#76) showed them taken.
- **What the records showed.** The booking records at +60 s and +120 s both list C4 19–21 and C5 19–21. So either a new booking replaced an old one within about 10 s, or the two feeds disagreed.
- **On screen.** Worker C's (Court 5) and Worker D's (Court 4) lines read "Cached or age unknown · not used" from 08:01:30.17 to 08:01:40.17 (section 2.7). Rescue did not act, for the same reason as Court 7.

## 6. Run identity and evidence scope

| Item | Value |
|---|---|
| Live run | runner `e3f7de87-d1d5-4949-9ddc-4cc49529cfa7` · app run `cc84c34b-50a6-4da6-be51-7728ffc98262` (label "full", API LIVE) |
| Slot Watch | `ffe896ed-9c1f-43c7-9ce9-7767b6d12d49` (v2), reads 07:59:00–08:15:00.5 |
| Build | installed 07:29:49 (`BUILD-INFO`: `b0db635 + uncommitted changes`, launcher SHA-256 `141BE372AEF8109B951D22BFEFBF4B535963A38FAE300FA5CE123D8471204D7F`). The uncommitted part is the Release Offset work, including per-attempt offsets, on branch `feature/wave1-arbitration-investigation-v2` |
| Method | proofless Precision Phase 3 (Smart backups), 7 workers (A–G all in Wave 1, no standby), prewarm lead 15 s, `dispatchMode: node` for every worker |
| Plan | 10 candidates, all 3 hours at PHP 2,100 (700 per hour, "current venue schedule" rates captured 07:34:41.481). Budgets: Wave 2 = 0, Rescue = 1, total 8. Concurrent Wave 2 on, Rescue on |
| Frozen | 07:58:00.012 |
| Arbitration manifest | created automatically at arm (`ARBITRATION_MANIFEST_CREATED`, 07:35:25.366), before "Process started: apiRun · live" |
| Outcome | `ALL_REJECTED_WAITING_FOR_REOPEN`, exit code 1. The process had stopped; the label does not mean it was still waiting |

## 7. The morning, in order

Times are on the trusted clock unless marked PC.

| Time | Event | Log |
|---|---|---|
| 07:29:49 | Build installed | `BUILD-INFO.txt` |
| 07:33:11 | Block audit: "2026-09-30 · Open 0 · Blocked 0 · Unreleased 112 · Unknown 0" | app `21766397` |
| 07:34:41.481 | Venue-schedule rates captured (700 per hour) | plan |
| 07:34:44 | Settings saved | app `918e4f09` |
| 07:34:52–07:35:05 | Prepare (`66830faa`) and dry run (`8508e622`), both exit 0; dry run `PHASE3_DRY_COMPLETE` with 10 candidates | Appendix H |
| 07:35:25.305 | Manifest preregistered; `ARBITRATION_MANIFEST_CREATED` at 07:35:25.366 | app `cc84c34b` |
| 07:35:25.382 | "Process started: apiRun · live" | app |
| 07:35:28.05 | All 7 isolated Chromes ready (ports 19444–19450) | runner |
| 07:35:28.08 | Authorization: 10 candidates, 7 in Wave 1, Rescue 1, diversification warning | runner |
| 07:50:00.279 | Clock T−10 min: PC 35.0 ms behind (±21.9 ms) | runner |
| 07:58:00.006–.011 | `PHASE3_WAVE1_PRICE` ×7 | runner |
| 07:58:00.012 | Plan frozen (`PHASE3_FROZEN` logged at 07:58:00.061) | freeze file |
| 07:58:00.066 | 7 journals created; one-shots claimed at 07:58:00.070 | journals |
| 07:58:00.090 | `RELEASE_OFFSET_SCHEDULED`: A −10, B −25, C −50, D −5 ms | runner, app |
| 07:59:00.013 | Slot Watch read #1 (`MISS`); booking records b1: 0 for Wednesday | Slot Watch |
| 07:59:00.192 | Clock T−60 s: +39.8 ms | runner |
| 07:59:10.006 | Read #2: `STALE`, age 10, the first sign of the edge cache | Slot Watch |
| 07:59:30.189 | Clock T−30 s: +39.0 ms (spread 3.5 ms, GOOD) | runner |
| 07:59:44.951 | Fresh security preparation starts on all 7 workers | runner (PC 07:59:44.912) |
| 07:59:48.454–49.477 | Security ready: B, C, G, E, F, A (3.5–4.5 s) | runner |
| 07:59:52.808 | Security ready: D (7.9 s) | runner |
| 07:59:59.950 | Scheduler fires (−49.95 ms) | critical path |
| 07:59:59.954 | C's request starts in Chrome (−45.6 ms) | critical path |
| 07:59:59.979 | B (−20.9 ms) | critical path |
| 07:59:59.994 | **A, Court 7 (−6.0 ms)** | critical path |
| 07:59:59.999 | D (−0.8 ms) | critical path |
| 08:00:00.004–.005 | E, F, G (+4.2 to +4.8 ms) | critical path |
| +0.01 to +5.08 s | Reads #8–#13: `STALE` copies aged 10–15, date not shown | Slot Watch |
| +2.845 s | b2: 13 evening records (C7 only 18:00) | Slot Watch |
| +6.094 s | #14: first dated copy (about +5 s). **Court 7 line reads "Cached or age unknown · not used"; every other line "Unavailable"** | Slot Watch, reconstruction |
| +8.066 s | B rejected (409) | runner |
| +9.847 s | E rejected | runner |
| +10.328 s | C rejected | runner |
| +10.426 s | F rejected | runner |
| **+10.579 s** | **A (Court 7) rejected: "overlaps an existing booking"** | runner, provider trace |
| +10.753 s | b3: 37 records; C7 still only 18:00 | Slot Watch |
| +12.088 / +12.109 s | D, G rejected | runner |
| +16.099 s | #24: next copy, all 42 evening cells unavailable; Court 7 line becomes "Unavailable" | Slot Watch |
| +30.297 s | b4: 42 records (every court 17:00–23:00) | Slot Watch |
| +90.17 to +100.17 s | C4/C5 19:00–22:00 open in one copy | Slot Watch |
| +300.233 s | b7: 39 records (C3 19–21 not listed) | Slot Watch |
| +360.16 s | C1, C2, C6 21–22 and C7 22 reopen | Slot Watch |
| +510.21 s | C1, C2 17–18 reopen | Slot Watch |
| +600.367 s | b8: 35 records (C7 17–21 still listed) | Slot Watch |
| **+606.091 s** | **#137: 15 cells reopen in one copy; C7 17:00–23:00 fully open; Court 7 line again "Cached or age unknown · not used"** | Slot Watch |
| +616.07 s | C5 17–18 reopen | Slot Watch |
| +655.085 s | #186 read failed; Court 7 line shows "Read failed" for 1 s | Slot Watch |
| +750.180 s | #199: last read with C7 19:00–22:00 open | Slot Watch |
| +780.179 / +810.156 s | C7 19:00, then 18:00, taken again | Slot Watch |
| +900.112 s | `CRITICAL_PATH_SAVED`, which the app drops with "Unrecognized structured event omitted." | runner, app |
| +900.125 s | `PHASE3_OUTCOME` `ALL_REJECTED_WAITING_FOR_REOPEN`; `PROCESS_EXIT` 1 at +900.156 s | runner |
| +900.449 s | b9: 21 records | Slot Watch |
| 08:15:00.56 / 08:15:00.91 | Forensic report FINAL; Release Intelligence rebuilt | files |
| 08:21:00–08:21:12 (PC) | "Closed 7 bot Chrome browsers (7 force-closed after not responding)" | app `f486deaa` |

## 8. The authorized plan

Frozen 2026-09-27T23:58:00.012Z (07:58:00.012 Manila), authorized 2026-09-27T23:35:28.082Z. Budgets: Wave 2 0, Rescue 1, total 8. Concurrent Wave 2: true. Rescue enabled: true. Standby workers: none. Fingerprint e8c15a9d69d902f7…

| Priority | Court | Time | Amount | Wave 1 | Wave 2 | Rescue | Assigned | Release offset |
|---:|---:|---|---:|---|---|---|---|---:|
| 1 | 7 | 19:00–22:00 | PHP 2100 | yes | no | yes | Wave 1 worker A | −10 ms |
| 2 | 6 | 19:00–22:00 | PHP 2100 | yes | no | yes | Wave 1 worker B | −25 ms |
| 3 | 5 | 19:00–22:00 | PHP 2100 | yes | no | yes | Wave 1 worker C | −50 ms |
| 4 | 4 | 19:00–22:00 | PHP 2100 | yes | no | yes | Wave 1 worker D | −5 ms |
| 5 | 3 | 19:00–22:00 | PHP 2100 | yes | no | yes | Wave 1 worker E | 0 ms |
| 6 | 2 | 19:00–22:00 | PHP 2100 | yes | no | yes | Wave 1 worker F | 0 ms |
| 7 | 1 | 19:00–22:00 | PHP 2100 | yes | no | yes | Wave 1 worker G | 0 ms |
| 8 | 3 | 20:00–23:00 | PHP 2100 | no | yes | yes | Wave 2 / Rescue only | — |
| 9 | 6 | 17:00–20:00 | PHP 2100 | no | yes | yes | Wave 2 / Rescue only | — |
| 10 | 6 | 20:00–23:00 | PHP 2100 | no | yes | yes | Wave 2 / Rescue only | — |

Rates: "current venue schedule", 700 per hour for every candidate hour, captured 2026-09-27T23:34:41.481Z. Warning recorded with the authorization: "All 7 Wave 1 attempts share 19:00–22:00. A time-wide unavailable block would affect every attempt."

Putting every Wave 1 shot on 19:00–22:00 made no difference today, because every evening cell from 17:00 to 23:00 on every court had a record by +30 s.

## 9. Clock

| Checkpoint | Captured (UTC) | Offset | Samples kept | RTT min/median/max | Spread | ± | Quality | Best host |
|---|---|---:|---:|---|---:|---:|---|---|
| T-10M | 2026-09-27T23:50:00.278Z | +34.8 ms | 10/10 | 43/51/76 ms | 17.3 ms | 21.9 ms | GOOD | time4.google.com |
| T-60S | 2026-09-27T23:59:00.191Z | +39.8 ms | 10/10 | 42/48/65 ms | 8.9 ms | 21.3 ms | GOOD | time.google.com |
| T-30S | 2026-09-27T23:59:30.188Z | +39.0 ms | 10/10 | 43/48/52 ms | 3.5 ms | 21.9 ms | GOOD | time.google.com |

Positive offset means the PC clock was behind true time. Samples per checkpoint:

- T-10M: time.google.com +49.2 ms / 76 ms, time1.google.com +36.9 ms / 54 ms, time2.google.com +35.1 ms / 57 ms, time3.google.com +35.0 ms / 59 ms, time4.google.com +36.0 ms / 57 ms, time.google.com +31.9 ms / 48 ms, time1.google.com +34.6 ms / 44 ms, time2.google.com +34.5 ms / 44 ms, time3.google.com +33.9 ms / 44 ms, time4.google.com +34.4 ms / 43 ms
- T-60S: time.google.com +40.5 ms / 47 ms, time1.google.com +40.1 ms / 48 ms, time2.google.com +41.4 ms / 47 ms, time3.google.com +45.1 ms / 65 ms, time4.google.com +41.3 ms / 47 ms, time.google.com +39.5 ms / 42 ms, time1.google.com +36.2 ms / 50 ms, time2.google.com +37.0 ms / 48 ms, time3.google.com +37.2 ms / 48 ms, time4.google.com +37.1 ms / 48 ms
- T-30S: time.google.com +39.4 ms / 43 ms, time1.google.com +38.9 ms / 46 ms, time2.google.com +39.8 ms / 43 ms, time3.google.com +36.9 ms / 49 ms, time4.google.com +39.7 ms / 44 ms, time.google.com +37.8 ms / 51 ms, time1.google.com +38.6 ms / 50 ms, time2.google.com +40.4 ms / 47 ms, time3.google.com +39.1 ms / 50 ms, time4.google.com +38.4 ms / 52 ms

- **Offsets used.** Dispatch used the corrected clock (`wallToTrustedMs` 39.07). The Slot Watch used 34.8 ms, so observer minus dispatch is −4.2 ms.
- **Compared with 26 September.** The PC error was far smaller today (then: 373 ms).
- **Onda's clock.** The second-resolution `Date` headers on the seven 409s put Onda's clock between about 0.07 s behind and 0.17 s ahead of ours. The tightest bounds come from B (answered +8.066 s, `Date` :08) and E (answered +9.847 s, `Date` :09).

## 10. Dispatch and the Release Offset

| Worker | Offset | Scheduler | Worker call | Transport | Pre-POST | Chrome request start | Playwright request event | Node saw response | Call → Chrome | Event lag |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A | −10 ms | −49.95 | −9.96 | −9.89 | −9.86 | −5.98 | −6.21 | 10578.87 | 3.98 | −0.23 |
| B | −25 ms | −49.95 | −24.96 | −24.90 | −24.87 | −20.92 | −21.19 | 8065.99 | 4.04 | −0.27 |
| C | −50 ms | −49.95 | −49.84 | −49.62 | −49.53 | −45.59 | −45.80 | 10327.71 | 4.25 | −0.21 |
| D | −5 ms | −49.95 | −4.98 | −4.94 | −4.91 | −0.78 | −1.05 | 12088.05 | 4.20 | −0.27 |
| E | 0 ms | −49.95 | 0.02 | 0.06 | 0.09 | 4.23 | 8.47 | 9847.06 | 4.21 | 4.24 |
| F | 0 ms | −49.95 | 0.54 | 0.57 | 0.58 | 4.29 | 8.55 | 10426.12 | 3.75 | 4.26 |
| G | 0 ms | −49.95 | 0.90 | 0.92 | 0.93 | 4.83 | 8.00 | 12109.16 | 3.93 | 3.17 |

Header: wallToTrustedMs 39.07. Dispatch mode `node` for all seven. The renderer-calibrated columns (page evaluate, fetch(), response headers) are left out: for worker A they map to about +1,665,244 ms and +1,675,829 ms, which is impossible, while B–G look normal. See section 13.

- **Every trigger fired on time.** The scheduler woke once at −49.95 ms, and each worker was called within 0.1 ms of its own trigger.
- **Handoff to Chrome** took 3.8–4.3 ms for every worker. For E, F and G, which fired together, the Playwright request event lagged a further 3.2–4.3 ms.
- **Network.** Chrome start to the edge stamp was 22.6–26.2 ms.

All critical-path lines, exactly as logged:

```json
{"schema":"critical-path/v1","type":"header","releaseMs":1790553600000,"wallToTrustedMs":39.07,"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","note":"All *Ms values are milliseconds after the release instant on the trusted clock. Renderer values are mapped through a round-trip calibration and carry [lowMs, highMs]."}
{"schema":"critical-path/v1","workerId":"A","dispatchMode":"node","schedulerFiredMs":-49.95,"workerInvokedMs":-9.96,"transportEnteredMs":-9.89,"prePostMs":-9.86,"rendererArmSentMs":null,"rendererArmedMs":null,"evaluateEnteredMs":{"ms":1665243.78,"lowMs":1665242.89,"highMs":1665244.68},"fetchInvokedMs":{"ms":1665243.78,"lowMs":1665242.89,"highMs":1665244.68},"browserRequestStartMs":-5.98,"requestObservedMs":-6.21,"responseHeadersMs":{"ms":1675828.88,"lowMs":1675827.99,"highMs":1675829.78},"responseCompleteMs":{"ms":1675829.08,"lowMs":1675828.19,"highMs":1675829.98},"responseObservedMs":10578.87,"segments":{"nodeToRendererMs":1665253.64,"rendererToFetchMs":0,"fetchToRequestStartMs":-1665249.76,"requestEventLagMs":-0.23},"calibration":{"samples":8,"uncertaintyMs":0.9,"minRoundTripMs":1.59,"consistent":true}}
{"schema":"critical-path/v1","workerId":"B","dispatchMode":"node","schedulerFiredMs":-49.95,"workerInvokedMs":-24.96,"transportEnteredMs":-24.9,"prePostMs":-24.87,"rendererArmSentMs":null,"rendererArmedMs":null,"evaluateEnteredMs":{"ms":-23.23,"lowMs":-23.97,"highMs":-22.49},"fetchInvokedMs":{"ms":-23.23,"lowMs":-23.97,"highMs":-22.49},"browserRequestStartMs":-20.92,"requestObservedMs":-21.19,"responseHeadersMs":{"ms":8060.07,"lowMs":8059.33,"highMs":8060.81},"responseCompleteMs":{"ms":8060.47,"lowMs":8059.73,"highMs":8061.21},"responseObservedMs":8065.99,"segments":{"nodeToRendererMs":1.64,"rendererToFetchMs":0,"fetchToRequestStartMs":2.31,"requestEventLagMs":-0.27},"calibration":{"samples":8,"uncertaintyMs":0.74,"minRoundTripMs":1.27,"consistent":true}}
{"schema":"critical-path/v1","workerId":"C","dispatchMode":"node","schedulerFiredMs":-49.95,"workerInvokedMs":-49.84,"transportEnteredMs":-49.62,"prePostMs":-49.53,"rendererArmSentMs":null,"rendererArmedMs":null,"evaluateEnteredMs":{"ms":-47.65,"lowMs":-48.39,"highMs":-46.9},"fetchInvokedMs":{"ms":-47.65,"lowMs":-48.39,"highMs":-46.9},"browserRequestStartMs":-45.59,"requestObservedMs":-45.8,"responseHeadersMs":{"ms":10325.85,"lowMs":10325.11,"highMs":10326.6},"responseCompleteMs":{"ms":10326.05,"lowMs":10325.31,"highMs":10326.8},"responseObservedMs":10327.71,"segments":{"nodeToRendererMs":1.88,"rendererToFetchMs":0,"fetchToRequestStartMs":2.06,"requestEventLagMs":-0.21},"calibration":{"samples":8,"uncertaintyMs":0.75,"minRoundTripMs":1.54,"consistent":true}}
{"schema":"critical-path/v1","workerId":"D","dispatchMode":"node","schedulerFiredMs":-49.95,"workerInvokedMs":-4.98,"transportEnteredMs":-4.94,"prePostMs":-4.91,"rendererArmSentMs":null,"rendererArmedMs":null,"evaluateEnteredMs":{"ms":-3.27,"lowMs":-3.82,"highMs":-2.72},"fetchInvokedMs":{"ms":-3.17,"lowMs":-3.72,"highMs":-2.62},"browserRequestStartMs":-0.78,"requestObservedMs":-1.05,"responseHeadersMs":{"ms":12086.43,"lowMs":12085.88,"highMs":12086.98},"responseCompleteMs":{"ms":12086.63,"lowMs":12086.08,"highMs":12087.18},"responseObservedMs":12088.05,"segments":{"nodeToRendererMs":1.64,"rendererToFetchMs":0.1,"fetchToRequestStartMs":2.39,"requestEventLagMs":-0.27},"calibration":{"samples":8,"uncertaintyMs":0.55,"minRoundTripMs":1.02,"consistent":true}}
{"schema":"critical-path/v1","workerId":"E","dispatchMode":"node","schedulerFiredMs":-49.95,"workerInvokedMs":0.02,"transportEnteredMs":0.06,"prePostMs":0.09,"rendererArmSentMs":null,"rendererArmedMs":null,"evaluateEnteredMs":{"ms":2.11,"lowMs":1.51,"highMs":2.71},"fetchInvokedMs":{"ms":2.11,"lowMs":1.51,"highMs":2.71},"browserRequestStartMs":4.23,"requestObservedMs":8.47,"responseHeadersMs":{"ms":9843.21,"lowMs":9842.61,"highMs":9843.81},"responseCompleteMs":{"ms":9843.61,"lowMs":9843.01,"highMs":9844.21},"responseObservedMs":9847.06,"segments":{"nodeToRendererMs":2.02,"rendererToFetchMs":0,"fetchToRequestStartMs":2.12,"requestEventLagMs":4.24},"calibration":{"samples":8,"uncertaintyMs":0.6,"minRoundTripMs":1,"consistent":true}}
{"schema":"critical-path/v1","workerId":"F","dispatchMode":"node","schedulerFiredMs":-49.95,"workerInvokedMs":0.54,"transportEnteredMs":0.57,"prePostMs":0.58,"rendererArmSentMs":null,"rendererArmedMs":null,"evaluateEnteredMs":{"ms":2.39,"lowMs":1.65,"highMs":3.13},"fetchInvokedMs":{"ms":2.39,"lowMs":1.65,"highMs":3.13},"browserRequestStartMs":4.29,"requestObservedMs":8.55,"responseHeadersMs":{"ms":10424.09,"lowMs":10423.35,"highMs":10424.83},"responseCompleteMs":{"ms":10424.19,"lowMs":10423.45,"highMs":10424.93},"responseObservedMs":10426.12,"segments":{"nodeToRendererMs":1.81,"rendererToFetchMs":0,"fetchToRequestStartMs":1.9,"requestEventLagMs":4.26},"calibration":{"samples":8,"uncertaintyMs":0.74,"minRoundTripMs":1.37,"consistent":true}}
{"schema":"critical-path/v1","workerId":"G","dispatchMode":"node","schedulerFiredMs":-49.95,"workerInvokedMs":0.9,"transportEnteredMs":0.92,"prePostMs":0.93,"rendererArmSentMs":null,"rendererArmedMs":null,"evaluateEnteredMs":{"ms":2.72,"lowMs":2.07,"highMs":3.37},"fetchInvokedMs":{"ms":2.72,"lowMs":2.07,"highMs":3.37},"browserRequestStartMs":4.83,"requestObservedMs":8,"responseHeadersMs":{"ms":12106.42,"lowMs":12105.77,"highMs":12107.07},"responseCompleteMs":{"ms":12106.62,"lowMs":12105.97,"highMs":12107.27},"responseObservedMs":12109.16,"segments":{"nodeToRendererMs":1.79,"rendererToFetchMs":0,"fetchToRequestStartMs":2.11,"requestEventLagMs":3.17},"calibration":{"samples":8,"uncertaintyMs":0.65,"minRoundTripMs":1.21,"consistent":true}}
```

## 11. Onda's answers

| Worker | Court | Status | Protocol | Reused | Send | Wait (browser) | Headers (Node) | Encoded bytes | Body bytes | x-vercel-id | Embedded ms (undocumented) | `Date` header | Cache | Message |
|---|---:|---:|---|---|---:|---:|---:|---:|---:|---|---:|---|---|---|
| A | 7 | 409 | h2 | yes | 0.2 ms | 10581.9 ms | +10.578 s | 424 | 100 | `sin1::sin1::xmblb-1790553600017-a8cface69893` | +17 | Mon, 28 Sep 2026 00:00:10 GMT | MISS | "This booking slot is no longer available (overlaps an existing booking)." |
| B | 6 | 409 | h2 | yes | 0.2 ms | 8078.2 ms | +8.062 s | 399 | 100 | `sin1::sin1::4vphp-1790553600005-eea3d5a81e4f` | +5 | Mon, 28 Sep 2026 00:00:08 GMT | MISS | "This booking slot is no longer available (overlaps an existing booking)." |
| C | 5 | 409 | h2 | yes | 0.2 ms | 10370.9 ms | +10.327 s | 399 | 100 | `sin1::sin1::5hqz4-1790553599977-373e7e3a40f2` | -23 | Mon, 28 Sep 2026 00:00:10 GMT | MISS | "This booking slot is no longer available (overlaps an existing booking)." |
| D | 4 | 409 | h2 | yes | 0.3 ms | 12086 ms | +12.087 s | 425 | 100 | `sin1::sin1::t7sc7-1790553600025-c8c3f7635381` | +25 | Mon, 28 Sep 2026 00:00:12 GMT | MISS | "This booking slot is no longer available (overlaps an existing booking)." |
| E | 3 | 409 | h2 | yes | 0.1 ms | 9836.4 ms | +9.845 s | 398 | 100 | `sin1::sin1::gsvmw-1790553600027-aa378ac9fbd4` | +27 | Mon, 28 Sep 2026 00:00:09 GMT | MISS | "This booking slot is no longer available (overlaps an existing booking)." |
| F | 2 | 409 | h2 | yes | 0.3 ms | 10419.2 ms | +10.425 s | 409 | 100 | `sin1::sin1::vwkmg-1790553600030-e06a61aa6615` | +30 | Mon, 28 Sep 2026 00:00:10 GMT | MISS | "This booking slot is no longer available (overlaps an existing booking)." |
| G | 1 | 409 | h2 | yes | 0.1 ms | 12100.7 ms | +12.108 s | 398 | 100 | `sin1::sin1::r6dd5-1790553600031-5bbbebb72c64` | +31 | Mon, 28 Sep 2026 00:00:12 GMT | MISS | "This booking slot is no longer available (overlaps an existing booking)." |

All seven: content-type application/json, server Vercel, cache-control "public, max-age=0, must-revalidate", x-matched-path /api/bookings/public-checkout, edge and function region sin1, no x-request-id, no server-timing, no cf-ray. Body shape `{ success: boolean, error: string }` (one message, 72 characters), shape fingerprint 80651c57074d…. DevTools Network was enabled at +4.2–5.3 ms after release, after every POST had left.

The wait inside Onda (8.1–12.1 s) was about the same as on 26 September (6.8–14.0 s) and far shorter than on 25 September (29.1–34.6 s).

## 12. What the grid and booking records showed

`O` open, `X` unavailable. Columns are start hours 08–23.

**#14** requested +6.014 s, answered +6.094 s, HIT age 1 s, open 77, unavailable 35 (first dated read)

```
     08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1  O  O  O  O  O  O  O  O  O  X  X  X  O  X  O  O
  C2  O  O  O  O  O  O  O  O  O  O  X  O  X  X  O  O
  C3  X  X  X  X  O  O  O  O  O  X  X  X  O  X  X  O
  C4  X  X  X  X  O  O  O  O  O  X  X  O  X  O  X  O
  C5  X  X  X  X  O  O  O  O  O  O  O  X  X  X  O  O
  C6  O  O  O  O  O  O  O  O  O  O  O  X  X  O  X  O
  C7  O  O  O  O  O  O  O  O  O  O  X  O  O  O  O  O
```

**#23** requested +15.015 s, answered +15.098 s, STALE age 10 s, open 77, unavailable 35 (last read of the first edge copy)

```
     08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1  O  O  O  O  O  O  O  O  O  X  X  X  O  X  O  O
  C2  O  O  O  O  O  O  O  O  O  O  X  O  X  X  O  O
  C3  X  X  X  X  O  O  O  O  O  X  X  X  O  X  X  O
  C4  X  X  X  X  O  O  O  O  O  X  X  O  X  O  X  O
  C5  X  X  X  X  O  O  O  O  O  O  O  X  X  X  O  O
  C6  O  O  O  O  O  O  O  O  O  O  O  X  X  O  X  O
  C7  O  O  O  O  O  O  O  O  O  O  X  O  O  O  O  O
```

**#24** requested +16.010 s, answered +16.099 s, HIT age 1 s, open 58, unavailable 54 (first read of the next edge copy)

```
     08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1  O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C2  O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C3  X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C4  X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C5  X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C6  O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C7  O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
```

**#73** requested +85.017 s, answered +85.186 s, STALE age 10 s, open 58, unavailable 54 (before the +90 s reopening)

```
     08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1  O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C2  O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C3  X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C4  X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C5  X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C6  O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C7  O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
```

**#74** requested +90.009 s, answered +90.170 s, HIT age 5 s, open 64, unavailable 48 (C4 and C5 19:00–22:00 open)

```
     08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1  O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C2  O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C3  X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C4  X  X  X  X  O  O  O  O  O  X  X  O  O  O  X  O
  C5  X  X  X  X  O  O  O  O  O  X  X  O  O  O  X  O
  C6  O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C7  O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
```

**#76** requested +100.005 s, answered +100.174 s, HIT age 5 s, open 58, unavailable 54 (closed again)

```
     08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1  O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C2  O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C3  X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C4  X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C5  X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C6  O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C7  O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
```

**#136** requested +605.003 s, answered +605.090 s, STALE age 10 s, open 63, unavailable 49 (before the +606 s reopening)

```
     08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1  O  O  O  O  O  O  O  O  O  O  O  X  X  X  X  X
  C2  O  O  O  O  O  O  O  O  O  O  O  X  X  X  X  X
  C3  X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C4  X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C5  X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C6  O  O  O  O  O  O  O  O  O  X  X  X  X  O  O  O
  C7  O  O  O  O  O  O  O  O  O  X  X  X  X  X  O  O
```

**#137** requested +606.015 s, answered +606.091 s, HIT age 1 s, open 78, unavailable 34 (mass reopening; C7 17:00–23:00 open)

```
     08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1  O  O  O  O  O  O  O  O  O  O  O  X  X  X  X  X
  C2  O  O  O  O  O  O  O  O  O  O  O  O  X  X  X  X
  C3  X  X  X  X  O  O  O  O  O  O  O  X  X  X  O  O
  C4  X  X  X  X  O  O  O  O  O  O  O  X  X  X  O  O
  C5  X  X  X  X  O  O  O  O  O  X  X  X  X  X  O  O
  C6  O  O  O  O  O  O  O  O  O  O  O  X  X  O  O  O
  C7  O  O  O  O  O  O  O  O  O  O  O  O  O  O  O  O
```

**#199** requested +750.012 s, answered +750.180 s, HIT age 5 s, open 79, unavailable 33 (last read with C7 19:00–22:00 open)

```
     08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1  O  O  O  O  O  O  O  O  O  O  O  X  X  X  X  X
  C2  O  O  O  O  O  O  O  O  O  O  O  X  X  X  X  X
  C3  X  X  X  X  O  O  O  O  O  O  O  X  X  X  O  O
  C4  X  X  X  X  O  O  O  O  O  O  O  X  X  X  O  O
  C5  X  X  X  X  O  O  O  O  O  O  O  X  X  X  O  O
  C6  O  O  O  O  O  O  O  O  O  O  O  X  X  O  O  O
  C7  O  O  O  O  O  O  O  O  O  O  O  O  O  O  O  O
```

**#200** requested +780.015 s, answered +780.179 s, HIT age 5 s, open 78, unavailable 34 (C7 19:00 taken again)

```
     08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1  O  O  O  O  O  O  O  O  O  O  O  X  X  X  X  X
  C2  O  O  O  O  O  O  O  O  O  O  O  X  X  X  X  X
  C3  X  X  X  X  O  O  O  O  O  O  O  X  X  X  O  O
  C4  X  X  X  X  O  O  O  O  O  O  O  X  X  X  O  O
  C5  X  X  X  X  O  O  O  O  O  O  O  X  X  X  O  O
  C6  O  O  O  O  O  O  O  O  O  O  O  X  X  O  O  O
  C7  O  O  O  O  O  O  O  O  O  O  O  X  O  O  O  O
```

**#204** requested +900.004 s, answered +900.485 s, HIT age 5 s, open 77, unavailable 35 (final read)

```
     08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1  O  O  O  O  O  O  O  O  O  O  O  X  X  X  X  X
  C2  O  O  O  O  O  O  O  O  O  O  O  X  X  X  X  X
  C3  X  X  X  X  O  O  O  O  O  O  O  X  X  X  O  O
  C4  X  X  X  X  O  O  O  O  O  O  O  X  X  X  O  O
  C5  X  X  X  X  O  O  O  O  O  O  O  X  X  X  O  O
  C6  O  O  O  O  O  O  O  O  O  O  O  X  X  O  O  O
  C7  O  O  O  O  O  O  O  O  O  O  X  X  O  O  O  O
```

- **Mornings.** C3, C4 and C5 08:00–12:00 (12 cells) were unavailable from publication, with no matching public booking record. The cause is unknown. It is the same shape as 26 September.
- **Evening, 17:00–23:00 (42 cells).**

  | When | Evening cells gone | Source |
  |---|---:|---|
  | Grid copy made about +5 s | 23 | grid |
  | Records at +2.8 s | 13 | booking records |
  | Records at +10.8 s | 37 | booking records |
  | Grid copy made about +15 s | 42 (all) | grid |
  | Records at +30.3 s | 42 | booking records |
- **Final records (+900 s).** C1 and C2 19:00–23:00, C3, C4 and C5 19:00–22:00, C6 19:00–21:00 and C7 18:00–20:00. In the grid, C1 and C2 23:00 were also unavailable with no record (cause unknown).
- **Mornings and afternoons stayed open.** 08:00–17:00 on C1, C2, C6 and C7, and 12:00–17:00 on C3–C5, were open for the whole watch.

Onda's public bookings endpoint returns one record per booked hour (date, start, end, status). A list such as "C1 17–22" gives start hours, so 17:00–23:00. The Slot Watch did not record cache headers for this endpoint.

| # | Requested | Answered | Took | Hours with a record | Records |
|---:|---:|---:|---:|---:|---|
| b1 | −59.982 s | −59.602 s | 380 ms | 0 | none |
| b2 | +2.014 s | +2.845 s | 831 ms | 13 | C1 17, 19, 21; C2 20; C3 19, 21–22; C4 18, 22; C5 20; C6 19–20; C7 18 |
| b3 | +10.016 s | +10.753 s | 737 ms | 37 | C1 17–22; C2 17–22; C3 17–22; C4 17–22; C5 17–22; C6 17–22; C7 18 |
| b4 | +30.013 s | +30.297 s | 284 ms | 42 | C1 17–22; C2 17–22; C3 17–22; C4 17–22; C5 17–22; C6 17–22; C7 17–22 |
| b5 | +60.010 s | +60.265 s | 255 ms | 42 | C1 17–22; C2 17–22; C3 17–22; C4 17–22; C5 17–22; C6 17–22; C7 17–22 |
| b6 | +120.013 s | +120.240 s | 227 ms | 42 | C1 17–22; C2 17–22; C3 17–22; C4 17–22; C5 17–22; C6 17–22; C7 17–22 |
| b7 | +300.009 s | +300.233 s | 224 ms | 39 | C1 17–22; C2 17–22; C3 17–18, 22; C4 17–22; C5 17–22; C6 17–22; C7 17–22 |
| b8 | +600.008 s | +600.367 s | 359 ms | 35 | C1 19–22; C2 19–22; C3 17–22; C4 17–22; C5 17–22; C6 17–20; C7 17–21 |
| b9 | +900.005 s | +900.449 s | 444 ms | 21 | C1 19–22; C2 19–22; C3 19–21; C4 19–21; C5 19–21; C6 19–20; C7 18–19 |

## 13. Reopenings

The grid went from unavailable to open for 34 cells in total. Because of the edge cache, each change can only be placed within about a 10-second copy interval.

| Copy made about | Cells reopened | Includes a full 3-hour candidate? |
|---|---|---|
| +85 s | C4 19–21, C5 19–21 | Yes: C4 and C5 19:00–22:00, taken again about +95 s |
| +355 s | C1, C2, C6 21–22; C7 22 | No |
| +505 s | C1 17–18, C2 17–18 | No |
| +595 to +605 s | C2 19; C3 17–18, 22; C4 17–18, 22; C5 22; C6 17–18; C7 17–21 | Yes: C7 19:00–22:00, open until about +745 to +775 s |
| +615 s | C5 17–18 | No |

The cluster near +600 s is the third release in a row with a mass reopening near 10 minutes (25 Sep +630 s, 26 Sep +597 s). That fits Onda releasing unpaid holds 10 minutes after they are made **(inference)**.

## 14. Defects and telemetry problems found

1. **Rescue can never act on edge-cached reads** (sections 2.6 and 4). This is the one that cost Court 7 at +606 s.
2. **The app drops `CRITICAL_PATH_SAVED` on every live run.** It logs "Unrecognized structured event omitted." as an error (section 2.8). The fix is to add the four `max*Ms` fields to `UiEventSchema`, or to send that stage with `trace()` instead of `stage()`.
3. **Worker A's page-clock mapping is wrong** in `critical-path.ndjson` (about +1,665,244 ms). It carries into `CRITICAL_PATH_SAVED maxFetchInvokedMs 1665243.78`. B–G are normal.
4. **The status text looks like a fault.** "Cached or age unknown · not used" appears on exactly the target that is still open (section 2.7). It would be clearer to say that the bot is not acting on cached data.
5. **Booking-record reads do not record cache headers.** If that endpoint is also cached, first-seen times could be late.
6. **The runner trace mixes two clocks.** Stage lines are trusted-clock and diagnostic lines are PC-clock, 39 ms apart. The first version of this report read them all as PC-clock; this version corrects that.
7. **Closing the bot Chromes at 08:21 needed a force-close for all 7** ("7 force-closed after not responding"). This happened after the run and did not affect it.
8. The runner logged 203 evidence rows while the Slot Watch launched 204 reads. The last read was answered at +900.5 s, after the runner's loop ended.

## 15. Compared with earlier releases

| Release (target) | Request start | Wait inside Onda | 409 text | First dated read | Read cache | PC clock error | Target evening before 08:00 | Quality | Result |
|---|---|---|---|---|---|---:|---|---|---|
| 24 Sep (Sat 26) | about +100 ms | 17.5–28.3 s | not captured | +15.7 s | not recorded | — | — | POOR | 3 × 409, 1 identity failure |
| 25 Sep (Sun 27) | +9.8–11.7 ms | 29.1–34.6 s | not captured | +4.1 s | all `MISS` | 23 ms | mostly open (5 of 112 cells unavailable at +4 s) | FAIR | 7 × 409; +630 s reopening unused (Rescue 0) |
| 26 Sep (Mon 28) | +6.2–7.7 ms | 6.8–14.0 s | 3 "event", 3 "overlaps" | +1.5 s | all `MISS` | 373 ms | 24 of 35 cells gone | GOOD | 6 × 409; Rescue starved at +597 s |
| **28 Sep (Wed 30)** | **−45.6 to +4.8 ms** | **8.1–12.1 s** | **7 "overlaps"** | **+6.1 s** | **`HIT`/`STALE`** | **39 ms** | **all open, 0 records** | **FAIR** | **7 × 409; Rescue blocked by the cache rule at +606 s** |

Arbitration analyzer: 25 Sep CLEAN (7 of 7 contestable), 26 Sep POOR (2 of 6), 28 Sep POOR (1 of 7). No release run is recorded for 27 September.

## 16. What worked

- **Release Offset.** Per-attempt offsets fired each attempt on its own trigger, within 0.1 ms of the call and about 4 ms to Chrome.
- **Automation.** The arbitration manifest was created automatically at arm, and the analyzer matched every evidence source.
- **Clock.** NTP consensus was GOOD at all three checkpoints.
- **Evidence capture.** 409 text capture, the provider trace (7 of 7), Slot Watch (202 of 204 reads, 9 of 9 booking reads), forensics FINAL and Release Intelligence all ran.
- **Security preparation.** All seven completed before release, the slowest (D) at −7.2 s.

## 17. What limited this run

1. **Rescue was disabled in practice** by the fresh-read rule meeting a cached feed. The one clear second chance (Court 7 19:00–22:00, open for at least 140 s) went unused.
2. **The release instant was not observed.** No grid showed Wednesday until +6.0 s, and every grid after that was a copy up to 10 s old.
3. **All seven shots were on one time window.** It made no difference today.

## 18. What this data cannot tell us

- Who made any booking, or whether the evening records belong to one party.
- How Onda orders or queues checkout requests, or why the Court 7 request that reached the edge at +17 ms lost to a booking not visible at +5 s.
- Whether Onda would accept a request that arrives before 08:00:00 on its own clock. C arrived around −23 ms, but was answered after 10 s.
- Why cells reopen, and why the grid and the booking records sometimes disagree.
- Whether the new edge caching is permanent, or its exact settings.
- What the app's screen actually showed. Section 2.7 is a reconstruction from code and logs.

## 19. What to change before the next live release

These are suggestions only. None has been implemented.

1. **Make Rescue work with edge-cached reads (highest value).**
   - Treat a `HIT`/`STALE` read's `age` as part of its evidence age, and accept it for Rescue when age plus response time is within the freshness window.
   - Apply the same rule in `observe()` (line 256) and in the loop's gate (`desktop-runner.ts` line 933).
   - A Rescue POST is still checked by Onda, so the risk is at most one wasted request out of a budget of 1.
   - Replay today's Slot Watch log offline first: the change should select C7 19:00–22:00 at about +606 s.
2. **Or fetch reads past the cache,** for example with a unique query parameter per read. This sends every read to Onda's origin at its busiest moment, so option 1 is the lighter change.
3. **Add a readiness warning** when pre-release reads come back `HIT`/`STALE`. Today that was visible from −50 s.
4. **Fix the app defects in section 14:** the dropped `CRITICAL_PATH_SAVED` event, Worker A's calibration, the wording of the cached-read status, and cache headers on booking-record reads.
5. **Release Offset:** no measurable benefit so far. Keep it as an operator choice.
6. **The proof-backed checkout lane remains untested at a contested release.** Its one release checkout (12 September) won a release that no competing bot was contesting, so that win says nothing about which lane wins a contested release ([REVIEW_GUIDE.md](REVIEW_GUIDE.md#read-first-the-one-release-win-was-uncontested)).

## 20. Safety state now

- All seven journals for 30 September are `rejected` (`ONDA_HTTP_STATUS_INVALID`, 409, application, hint `availability`). None is armed, and no one-shot needs manual reconciliation.
- No hold, booking or QR exists for this run. There is nothing to cancel or pay.
- The installed build contains uncommitted source (Release Offset). Commit it before the next rebuild.

## 21. Sources (install folder)

- **Runner:** `.local/api-booking/run-progress/e3f7de87-d1d5-4949-9ddc-4cc49529cfa7.ndjson` (329 lines, Appendix E). Prepare and dry run: `66830faa…` and `8508e622…` (Appendix H).
- **App:** `.local/booking-runs/cc84c34b-50a6-4da6-be51-7728ffc98262.ndjson` (Appendix F), plus `21766397…`, `918e4f09…`, `aa684e5c…` and `f486deaa…` (Appendix G).
- **Slot Watch:** `.local/slot-watch/2026-09-30_ffe896ed-9c1f-43c7-9ce9-7767b6d12d49.{ndjson,summary.json,txt}` (Appendices J and K, and every line in [RELEASE_RUN_REPORT_2026-09-28_RAW_LOGS.md](RELEASE_RUN_REPORT_2026-09-28_RAW_LOGS.md)).
- **Forensics:** `.local/release-forensics/e3f7de87-d1d5-4949-9ddc-4cc49529cfa7/{report.txt,summary.json,provider-trace.ndjson,critical-path.ndjson}` (Appendices I and L, critical path in section 10; summary.json in the raw-log file).
- **Plan:** `.local/api-booking/precision-races/e3f7de87-d1d5-4949-9ddc-4cc49529cfa7-phase3-freeze.json` and `config.local.json` → `PRECISION_PHASE3` (Appendix M).
- **Journals:** `.local/api-booking/api-first-journals/<key>/` (seven, Appendix N).
- **Clock:** `.local/network-clock-evidence/2026-09-27T23-*.json`, `.local/network-clock.json` (Appendix O).
- **Arbitration:** manifest `.local/arbitration-manifests/2026-09-30_1790553600000/experiment-manifest.json` and the analyzer's report (Appendix P).
- **Intelligence:** `.local/release-intelligence/summary.txt` (Appendix Q).
- **Code quoted:**
  - `src/api-booking/precision-phase3.ts` (109–128, 253–303)
  - `src/api-booking/desktop-runner.ts` (82–86, 164–166, 924–938)
  - `src/api-booking/live-availability-provider.ts` (49–54)
  - `src/ui-events.ts` (18–22)
  - `ui/processes.ts` (109–113)
  - `ui/renderer/app.ts` (1201–1231)

## Appendices

### Appendix A — Every availability read (all 204)

Times are release offsets on the Slot Watch clock (observer − dispatch = −4.2 ms). `Open/Unav` are cell counts out of 112. `Cache` and `Age` are Vercel's `x-vercel-cache` and `age` headers. An `Age` of *n* s means the edge copy was made about *n* s before the answer, so the grid in that read can be that much older than the request. "Changes" compares each read with the previous dated read by sequence number, so a change can be undone by a later read that saw an older copy.

| # | Scheduled | Requested | Answered | Took | Date shown | Open | Unav | Cache | Age | Changes vs previous read |
|---:|---:|---:|---:|---:|---|---:|---:|---|---:|---|
| 1 | −60.000 s | −59.987 s | −59.715 s | 272 ms | no | — | — | MISS | 0 |  |
| 2 | −50.000 s | −49.994 s | −49.839 s | 155 ms | no | — | — | STALE | 10 |  |
| 3 | −40.000 s | −39.986 s | −39.828 s | 158 ms | no | — | — | STALE | 10 |  |
| 4 | −30.000 s | −29.993 s | −29.828 s | 165 ms | no | — | — | STALE | 10 |  |
| 5 | −20.000 s | −19.985 s | −19.810 s | 175 ms | no | — | — | STALE | 10 |  |
| 6 | −10.000 s | −9.991 s | −9.835 s | 156 ms | no | — | — | STALE | 10 |  |
| 7 | −2.000 s | −1.991 s | −1.840 s | 151 ms | no | — | — | HIT | 8 |  |
| 8 | +0.000 s | +0.010 s | +0.262 s | 252 ms | no | — | — | STALE | 10 |  |
| 9 | +0.250 s | +0.259 s | +0.413 s | 154 ms | no | — | — | STALE | 10 |  |
| 10 | +0.500 s | +0.511 s | +0.586 s | 75 ms | no | — | — | STALE | 10 |  |
| 11 | +1.000 s | +1.002 s | +1.080 s | 78 ms | no | — | — | STALE | 11 |  |
| 12 | +2.000 s | +2.014 s | +2.077 s | 63 ms | no | — | — | STALE | 12 |  |
| 13 | +5.000 s | +5.003 s | +5.083 s | 80 ms | no | — | — | STALE | 15 |  |
| 14 | +6.000 s | +6.014 s | +6.094 s | 80 ms | yes | 77 | 35 | HIT | 1 |  |
| 15 | +7.000 s | +7.017 s | +7.104 s | 87 ms | yes | 77 | 35 | HIT | 2 |  |
| 16 | +8.000 s | +8.002 s | +8.095 s | 93 ms | yes | 77 | 35 | HIT | 3 |  |
| 17 | +9.000 s | +9.003 s | +9.079 s | 76 ms | yes | 77 | 35 | HIT | 4 |  |
| 18 | +10.000 s | +10.016 s | +10.082 s | 66 ms | yes | 77 | 35 | HIT | 5 |  |
| 19 | +11.000 s | +11.016 s | +11.080 s | 64 ms | yes | 77 | 35 | HIT | 6 |  |
| 20 | +12.000 s | +12.016 s | +12.091 s | 75 ms | yes | 77 | 35 | HIT | 7 |  |
| 21 | +13.000 s | +13.014 s | +13.086 s | 72 ms | yes | 77 | 35 | HIT | 8 |  |
| 22 | +14.000 s | +14.016 s | +14.091 s | 75 ms | yes | 77 | 35 | HIT | 9 |  |
| 23 | +15.000 s | +15.015 s | +15.098 s | 83 ms | yes | 77 | 35 | STALE | 10 |  |
| 24 | +16.000 s | +16.010 s | +16.099 s | 89 ms | yes | 58 | 54 | HIT | 1 | C1 20 O→X, C1 22 O→X, C2 17 O→X, C2 19 O→X, C2 22 O→X, C3 20 O→X, C4 19 O→X, C4 21 O→X, C5 17 O→X, C5 18 O→X, C5 22 O→X, C6 17 O→X, C6 18 O→X, C6 21 O→X, C7 17 O→X, C7 19 O→X, C7 20 O→X, C7 21 O→X, C7 22 O→X |
| 25 | +17.000 s | +17.006 s | +17.093 s | 87 ms | yes | 58 | 54 | HIT | 2 |  |
| 26 | +18.000 s | +18.016 s | +18.072 s | 56 ms | yes | 58 | 54 | HIT | 3 |  |
| 27 | +19.000 s | +19.002 s | +19.069 s | 67 ms | yes | 58 | 54 | HIT | 4 |  |
| 28 | +20.000 s | +20.014 s | +20.093 s | 79 ms | yes | 58 | 54 | HIT | 5 |  |
| 29 | +21.000 s | +21.014 s | +21.149 s | 135 ms | yes | 58 | 54 | HIT | 6 |  |
| 30 | +22.000 s | +22.011 s | +22.087 s | 76 ms | yes | 58 | 54 | HIT | 7 |  |
| 31 | +23.000 s | +23.014 s | +23.097 s | 83 ms | yes | 58 | 54 | HIT | 8 |  |
| 32 | +24.000 s | +24.012 s | +24.097 s | 85 ms | yes | 58 | 54 | HIT | 9 |  |
| 33 | +25.000 s | +25.010 s | +25.074 s | 64 ms | yes | 58 | 54 | STALE | 10 |  |
| 34 | +26.000 s | +26.011 s | +26.085 s | 74 ms | yes | 58 | 54 | HIT | 1 |  |
| 35 | +27.000 s | +27.007 s | +27.091 s | 84 ms | yes | 58 | 54 | HIT | 2 |  |
| 36 | +28.000 s | +28.005 s | +28.087 s | 82 ms | yes | 58 | 54 | HIT | 3 |  |
| 37 | +29.000 s | +29.001 s | +29.082 s | 81 ms | yes | 58 | 54 | HIT | 4 |  |
| 38 | +30.000 s | +30.012 s | +30.092 s | 80 ms | yes | 58 | 54 | HIT | 5 |  |
| 39 | +31.000 s | +31.012 s | +31.086 s | 74 ms | yes | 58 | 54 | HIT | 6 |  |
| 40 | +32.000 s | +32.006 s | +32.092 s | 86 ms | yes | 58 | 54 | HIT | 7 |  |
| 41 | +33.000 s | +33.006 s | +33.200 s | 194 ms | yes | 58 | 54 | HIT | 8 |  |
| 42 | +34.000 s | +34.003 s | +34.077 s | 74 ms | yes | 58 | 54 | HIT | 9 |  |
| 43 | +35.000 s | +35.001 s | +35.065 s | 64 ms | yes | 58 | 54 | STALE | 10 |  |
| 44 | +36.000 s | +36.015 s | +36.108 s | 93 ms | yes | 58 | 54 | HIT | 1 |  |
| 45 | +37.000 s | +37.002 s | +37.079 s | 77 ms | yes | 58 | 54 | HIT | 2 |  |
| 46 | +38.000 s | +38.004 s | +38.063 s | 59 ms | yes | 58 | 54 | HIT | 3 |  |
| 47 | +39.000 s | +39.001 s | +39.078 s | 77 ms | yes | 58 | 54 | HIT | 4 |  |
| 48 | +40.000 s | +40.015 s | +40.093 s | 78 ms | yes | 58 | 54 | HIT | 5 |  |
| 49 | +41.000 s | +41.009 s | +41.095 s | 86 ms | yes | 58 | 54 | HIT | 6 |  |
| 50 | +42.000 s | +42.008 s | +42.084 s | 76 ms | yes | 58 | 54 | HIT | 7 |  |
| 51 | +43.000 s | +43.009 s | +43.102 s | 93 ms | yes | 58 | 54 | HIT | 8 |  |
| 52 | +44.000 s | +44.010 s | +44.088 s | 78 ms | yes | 58 | 54 | HIT | 9 |  |
| 53 | +45.000 s | +45.012 s | +45.075 s | 63 ms | yes | 58 | 54 | STALE | 10 |  |
| 54 | +46.000 s | +46.010 s | +46.091 s | 81 ms | yes | 58 | 54 | HIT | 1 |  |
| 55 | +47.000 s | +47.014 s | +47.095 s | 81 ms | yes | 58 | 54 | HIT | 2 |  |
| 56 | +48.000 s | +48.016 s | +48.085 s | 69 ms | yes | 58 | 54 | HIT | 3 |  |
| 57 | +49.000 s | +49.004 s | +49.085 s | 81 ms | yes | 58 | 54 | HIT | 4 |  |
| 58 | +50.000 s | +50.002 s | +50.072 s | 70 ms | yes | 58 | 54 | HIT | 5 |  |
| 59 | +51.000 s | +51.016 s | +51.092 s | 76 ms | yes | 58 | 54 | HIT | 6 |  |
| 60 | +52.000 s | +52.016 s | +52.082 s | 66 ms | yes | 58 | 54 | HIT | 7 |  |
| 61 | +53.000 s | +53.017 s | +53.091 s | 74 ms | yes | 58 | 54 | HIT | 8 |  |
| 62 | +54.000 s | +54.014 s | +54.079 s | 65 ms | yes | 58 | 54 | HIT | 9 |  |
| 63 | +55.000 s | +55.001 s | +55.092 s | 91 ms | yes | 58 | 54 | STALE | 10 |  |
| 64 | +56.000 s | +56.016 s | +56.108 s | 92 ms | yes | 58 | 54 | HIT | 1 |  |
| 65 | +57.000 s | +57.004 s | +57.083 s | 79 ms | yes | 58 | 54 | HIT | 2 |  |
| 66 | +58.000 s | +58.016 s | +58.111 s | 95 ms | yes | 58 | 54 | HIT | 3 |  |
| 67 | +59.000 s | +59.013 s | +59.091 s | 78 ms | yes | 58 | 54 | HIT | 4 |  |
| 68 | +60.000 s | +60.009 s | +60.081 s | 72 ms | read failed | — | — | — | — |  |
| 69 | +65.000 s | +65.004 s | +65.166 s | 162 ms | yes | 58 | 54 | STALE | 10 |  |
| 70 | +70.000 s | +70.008 s | +70.164 s | 156 ms | yes | 58 | 54 | HIT | 5 |  |
| 71 | +75.000 s | +75.010 s | +75.169 s | 159 ms | yes | 58 | 54 | STALE | 10 |  |
| 72 | +80.000 s | +80.015 s | +80.188 s | 173 ms | yes | 58 | 54 | HIT | 5 |  |
| 73 | +85.000 s | +85.017 s | +85.186 s | 169 ms | yes | 58 | 54 | STALE | 10 |  |
| 74 | +90.000 s | +90.009 s | +90.170 s | 161 ms | yes | 64 | 48 | HIT | 5 | C4 19 X→O, C4 20 X→O, C4 21 X→O, C5 19 X→O, C5 20 X→O, C5 21 X→O |
| 75 | +95.000 s | +95.004 s | +95.175 s | 171 ms | yes | 64 | 48 | STALE | 10 |  |
| 76 | +100.000 s | +100.005 s | +100.174 s | 169 ms | yes | 58 | 54 | HIT | 5 | C4 19 O→X, C4 20 O→X, C4 21 O→X, C5 19 O→X, C5 20 O→X, C5 21 O→X |
| 77 | +105.000 s | +105.004 s | +105.173 s | 169 ms | yes | 58 | 54 | HIT | 0 |  |
| 78 | +110.000 s | +110.015 s | +110.187 s | 172 ms | yes | 58 | 54 | HIT | 5 |  |
| 79 | +115.000 s | +115.004 s | +115.168 s | 164 ms | yes | 58 | 54 | STALE | 10 |  |
| 80 | +120.000 s | +120.012 s | +120.168 s | 156 ms | yes | 58 | 54 | HIT | 5 |  |
| 81 | +125.000 s | +125.007 s | +125.169 s | 162 ms | yes | 58 | 54 | STALE | 10 |  |
| 82 | +130.000 s | +130.014 s | +130.168 s | 154 ms | yes | 58 | 54 | HIT | 5 |  |
| 83 | +135.000 s | +135.002 s | +135.154 s | 152 ms | yes | 58 | 54 | STALE | 10 |  |
| 84 | +140.000 s | +140.003 s | +140.191 s | 188 ms | yes | 58 | 54 | HIT | 5 |  |
| 85 | +145.000 s | +145.014 s | +145.181 s | 167 ms | yes | 58 | 54 | STALE | 10 |  |
| 86 | +150.000 s | +150.002 s | +150.166 s | 164 ms | yes | 58 | 54 | HIT | 5 |  |
| 87 | +155.000 s | +155.003 s | +155.168 s | 165 ms | yes | 58 | 54 | HIT | 0 |  |
| 88 | +160.000 s | +160.011 s | +160.218 s | 207 ms | yes | 58 | 54 | HIT | 5 |  |
| 89 | +165.000 s | +165.004 s | +165.169 s | 165 ms | yes | 58 | 54 | STALE | 10 |  |
| 90 | +170.000 s | +170.001 s | +170.179 s | 178 ms | yes | 58 | 54 | HIT | 5 |  |
| 91 | +175.000 s | +175.004 s | +175.176 s | 172 ms | yes | 58 | 54 | STALE | 10 |  |
| 92 | +180.000 s | +180.007 s | +180.179 s | 172 ms | yes | 58 | 54 | HIT | 5 |  |
| 93 | +185.000 s | +185.012 s | +185.206 s | 194 ms | yes | 58 | 54 | STALE | 10 |  |
| 94 | +190.000 s | +190.009 s | +190.186 s | 177 ms | yes | 58 | 54 | HIT | 5 |  |
| 95 | +195.000 s | +195.013 s | +195.171 s | 158 ms | yes | 58 | 54 | STALE | 10 |  |
| 96 | +200.000 s | +200.015 s | +200.178 s | 163 ms | yes | 58 | 54 | HIT | 5 |  |
| 97 | +205.000 s | +205.011 s | +205.173 s | 162 ms | yes | 58 | 54 | STALE | 10 |  |
| 98 | +210.000 s | +210.013 s | +210.168 s | 155 ms | yes | 58 | 54 | HIT | 5 |  |
| 99 | +215.000 s | +215.017 s | +215.175 s | 158 ms | yes | 58 | 54 | STALE | 10 |  |
| 100 | +220.000 s | +220.010 s | +220.169 s | 159 ms | yes | 58 | 54 | HIT | 5 |  |
| 101 | +225.000 s | +225.002 s | +225.181 s | 179 ms | yes | 58 | 54 | STALE | 10 |  |
| 102 | +230.000 s | +230.009 s | +230.168 s | 159 ms | yes | 58 | 54 | HIT | 5 |  |
| 103 | +235.000 s | +235.006 s | +235.175 s | 169 ms | yes | 58 | 54 | STALE | 10 |  |
| 104 | +240.000 s | +240.002 s | +240.195 s | 193 ms | yes | 58 | 54 | HIT | 5 |  |
| 105 | +245.000 s | +245.012 s | +245.197 s | 185 ms | yes | 58 | 54 | HIT | 0 |  |
| 106 | +250.000 s | +250.014 s | +250.182 s | 168 ms | yes | 58 | 54 | HIT | 5 |  |
| 107 | +255.000 s | +255.010 s | +255.169 s | 159 ms | yes | 58 | 54 | STALE | 10 |  |
| 108 | +260.000 s | +260.008 s | +260.163 s | 155 ms | yes | 58 | 54 | HIT | 5 |  |
| 109 | +265.000 s | +265.012 s | +265.186 s | 174 ms | yes | 58 | 54 | STALE | 10 |  |
| 110 | +270.000 s | +270.005 s | +270.188 s | 183 ms | yes | 58 | 54 | HIT | 5 |  |
| 111 | +275.000 s | +275.012 s | +275.178 s | 166 ms | yes | 58 | 54 | STALE | 10 |  |
| 112 | +280.000 s | +280.016 s | +280.175 s | 159 ms | yes | 58 | 54 | HIT | 5 |  |
| 113 | +285.000 s | +285.002 s | +285.162 s | 160 ms | yes | 58 | 54 | STALE | 10 |  |
| 114 | +290.000 s | +290.007 s | +290.168 s | 161 ms | yes | 58 | 54 | HIT | 5 |  |
| 115 | +295.000 s | +295.009 s | +295.192 s | 183 ms | yes | 58 | 54 | STALE | 10 |  |
| 116 | +300.000 s | +300.008 s | +300.175 s | 167 ms | yes | 58 | 54 | HIT | 5 |  |
| 117 | +330.000 s | +330.016 s | +330.185 s | 169 ms | yes | 58 | 54 | HIT | 5 |  |
| 118 | +360.000 s | +360.007 s | +360.163 s | 156 ms | yes | 65 | 47 | HIT | 5 | C1 21 X→O, C1 22 X→O, C2 21 X→O, C2 22 X→O, C6 21 X→O, C6 22 X→O, C7 22 X→O |
| 119 | +390.000 s | +390.015 s | +390.183 s | 168 ms | yes | 65 | 47 | HIT | 5 |  |
| 120 | +420.000 s | +420.009 s | +420.187 s | 178 ms | yes | 65 | 47 | HIT | 5 |  |
| 121 | +450.000 s | +450.007 s | +450.164 s | 157 ms | yes | 65 | 47 | HIT | 5 |  |
| 122 | +480.000 s | +480.003 s | +480.180 s | 177 ms | yes | 65 | 47 | HIT | 5 |  |
| 123 | +510.000 s | +510.014 s | +510.207 s | 193 ms | yes | 69 | 43 | HIT | 5 | C1 17 X→O, C1 18 X→O, C2 17 X→O, C2 18 X→O |
| 124 | +540.000 s | +540.012 s | +540.179 s | 167 ms | yes | 69 | 43 | HIT | 5 |  |
| 125 | +570.000 s | +570.003 s | +570.198 s | 195 ms | yes | 69 | 43 | HIT | 5 |  |
| 126 | +595.000 s | +595.008 s | +595.178 s | 170 ms | yes | 63 | 49 | STALE | 10 | C1 21 O→X, C1 22 O→X, C1 23 O→X, C2 21 O→X, C2 22 O→X, C2 23 O→X |
| 127 | +596.000 s | +596.003 s | +596.104 s | 101 ms | yes | 63 | 49 | HIT | 1 |  |
| 128 | +597.000 s | +597.002 s | +597.070 s | 68 ms | yes | 63 | 49 | HIT | 2 |  |
| 129 | +598.000 s | +598.004 s | +598.085 s | 81 ms | yes | 63 | 49 | HIT | 3 |  |
| 130 | +599.000 s | +599.006 s | +599.100 s | 94 ms | yes | 63 | 49 | HIT | 4 |  |
| 131 | +600.000 s | +600.007 s | +600.087 s | 80 ms | yes | 63 | 49 | HIT | 5 |  |
| 132 | +601.000 s | +601.002 s | +601.082 s | 80 ms | yes | 63 | 49 | HIT | 6 |  |
| 133 | +602.000 s | +602.002 s | +602.089 s | 87 ms | yes | 63 | 49 | HIT | 7 |  |
| 134 | +603.000 s | +603.001 s | +603.068 s | 67 ms | yes | 63 | 49 | HIT | 8 |  |
| 135 | +604.000 s | +604.003 s | +604.084 s | 81 ms | yes | 63 | 49 | HIT | 9 |  |
| 136 | +605.000 s | +605.003 s | +605.090 s | 87 ms | yes | 63 | 49 | STALE | 10 |  |
| 137 | +606.000 s | +606.015 s | +606.091 s | 76 ms | yes | 78 | 34 | HIT | 1 | C2 19 X→O, C3 17 X→O, C3 18 X→O, C3 22 X→O, C4 17 X→O, C4 18 X→O, C4 22 X→O, C5 22 X→O, C6 17 X→O, C6 18 X→O, C7 17 X→O, C7 18 X→O, C7 19 X→O, C7 20 X→O, C7 21 X→O |
| 138 | +607.000 s | +607.015 s | +607.085 s | 70 ms | yes | 78 | 34 | HIT | 2 |  |
| 139 | +608.000 s | +608.014 s | +608.097 s | 83 ms | yes | 78 | 34 | HIT | 3 |  |
| 140 | +609.000 s | +609.001 s | +609.081 s | 80 ms | yes | 78 | 34 | HIT | 4 |  |
| 141 | +610.000 s | +610.016 s | +610.110 s | 94 ms | yes | 78 | 34 | HIT | 5 |  |
| 142 | +611.000 s | +611.015 s | +611.091 s | 76 ms | yes | 78 | 34 | HIT | 6 |  |
| 143 | +612.000 s | +612.014 s | +612.101 s | 87 ms | yes | 78 | 34 | HIT | 7 |  |
| 144 | +613.000 s | +613.009 s | +613.090 s | 81 ms | yes | 78 | 34 | HIT | 8 |  |
| 145 | +614.000 s | +614.005 s | +614.112 s | 107 ms | yes | 78 | 34 | HIT | 9 |  |
| 146 | +615.000 s | +615.001 s | +615.066 s | 65 ms | yes | 78 | 34 | STALE | 10 |  |
| 147 | +616.000 s | +616.003 s | +616.068 s | 65 ms | yes | 79 | 33 | HIT | 1 | C2 19 O→X, C5 17 X→O, C5 18 X→O |
| 148 | +617.000 s | +617.001 s | +617.081 s | 80 ms | yes | 79 | 33 | HIT | 2 |  |
| 149 | +618.000 s | +618.007 s | +618.106 s | 99 ms | yes | 79 | 33 | HIT | 3 |  |
| 150 | +619.000 s | +619.007 s | +619.085 s | 78 ms | yes | 79 | 33 | HIT | 4 |  |
| 151 | +620.000 s | +620.003 s | +620.077 s | 74 ms | yes | 79 | 33 | HIT | 5 |  |
| 152 | +621.000 s | +621.002 s | +621.070 s | 68 ms | yes | 79 | 33 | HIT | 6 |  |
| 153 | +622.000 s | +622.015 s | +622.098 s | 83 ms | yes | 79 | 33 | HIT | 7 |  |
| 154 | +623.000 s | +623.015 s | +623.095 s | 80 ms | yes | 79 | 33 | HIT | 8 |  |
| 155 | +624.000 s | +624.009 s | +624.089 s | 80 ms | yes | 79 | 33 | HIT | 9 |  |
| 156 | +625.000 s | +625.006 s | +625.084 s | 78 ms | yes | 79 | 33 | STALE | 10 |  |
| 157 | +626.000 s | +626.007 s | +626.079 s | 72 ms | yes | 79 | 33 | HIT | 1 |  |
| 158 | +627.000 s | +627.009 s | +627.096 s | 87 ms | yes | 79 | 33 | HIT | 2 |  |
| 159 | +628.000 s | +628.007 s | +628.092 s | 85 ms | yes | 79 | 33 | HIT | 3 |  |
| 160 | +629.000 s | +629.001 s | +629.081 s | 80 ms | yes | 79 | 33 | HIT | 4 |  |
| 161 | +630.000 s | +630.005 s | +630.091 s | 86 ms | yes | 79 | 33 | HIT | 5 |  |
| 162 | +631.000 s | +631.004 s | +631.099 s | 95 ms | yes | 79 | 33 | HIT | 6 |  |
| 163 | +632.000 s | +632.005 s | +632.084 s | 79 ms | yes | 79 | 33 | HIT | 7 |  |
| 164 | +633.000 s | +633.015 s | +633.095 s | 80 ms | yes | 79 | 33 | HIT | 8 |  |
| 165 | +634.000 s | +634.002 s | +634.084 s | 82 ms | yes | 79 | 33 | HIT | 9 |  |
| 166 | +635.000 s | +635.016 s | +635.110 s | 94 ms | yes | 79 | 33 | STALE | 10 |  |
| 167 | +636.000 s | +636.013 s | +636.095 s | 82 ms | yes | 79 | 33 | HIT | 1 |  |
| 168 | +637.000 s | +637.002 s | +637.096 s | 94 ms | yes | 79 | 33 | HIT | 2 |  |
| 169 | +638.000 s | +638.007 s | +638.085 s | 78 ms | yes | 79 | 33 | HIT | 3 |  |
| 170 | +639.000 s | +639.004 s | +639.084 s | 80 ms | yes | 79 | 33 | HIT | 4 |  |
| 171 | +640.000 s | +640.005 s | +640.074 s | 69 ms | yes | 79 | 33 | HIT | 5 |  |
| 172 | +641.000 s | +641.003 s | +641.096 s | 93 ms | yes | 79 | 33 | HIT | 6 |  |
| 173 | +642.000 s | +642.001 s | +642.080 s | 79 ms | yes | 79 | 33 | HIT | 7 |  |
| 174 | +643.000 s | +643.007 s | +643.113 s | 106 ms | yes | 79 | 33 | HIT | 8 |  |
| 175 | +644.000 s | +644.005 s | +644.087 s | 82 ms | yes | 79 | 33 | HIT | 9 |  |
| 176 | +645.000 s | +645.005 s | +645.081 s | 76 ms | yes | 79 | 33 | STALE | 10 |  |
| 177 | +646.000 s | +646.004 s | +646.073 s | 69 ms | yes | 79 | 33 | HIT | 1 |  |
| 178 | +647.000 s | +647.003 s | +647.071 s | 68 ms | yes | 79 | 33 | HIT | 2 |  |
| 179 | +648.000 s | +648.010 s | +648.095 s | 85 ms | yes | 79 | 33 | HIT | 3 |  |
| 180 | +649.000 s | +649.002 s | +649.109 s | 107 ms | yes | 79 | 33 | HIT | 4 |  |
| 181 | +650.000 s | +650.014 s | +650.097 s | 83 ms | yes | 79 | 33 | HIT | 5 |  |
| 182 | +651.000 s | +651.002 s | +651.069 s | 67 ms | yes | 79 | 33 | HIT | 6 |  |
| 183 | +652.000 s | +652.014 s | +652.094 s | 80 ms | yes | 79 | 33 | HIT | 7 |  |
| 184 | +653.000 s | +653.013 s | +653.088 s | 75 ms | yes | 79 | 33 | HIT | 8 |  |
| 185 | +654.000 s | +654.010 s | +654.091 s | 81 ms | yes | 79 | 33 | HIT | 9 |  |
| 186 | +655.000 s | +655.010 s | +655.085 s | 75 ms | read failed | — | — | — | — |  |
| 187 | +656.000 s | +656.006 s | +656.094 s | 88 ms | yes | 79 | 33 | HIT | 1 |  |
| 188 | +657.000 s | +657.016 s | +657.124 s | 108 ms | yes | 79 | 33 | HIT | 2 |  |
| 189 | +658.000 s | +658.012 s | +658.101 s | 89 ms | yes | 79 | 33 | HIT | 3 |  |
| 190 | +659.000 s | +659.008 s | +659.080 s | 72 ms | yes | 79 | 33 | HIT | 4 |  |
| 191 | +660.000 s | +660.007 s | +660.088 s | 81 ms | yes | 79 | 33 | HIT | 5 |  |
| 192 | +661.000 s | +661.001 s | +661.074 s | 73 ms | yes | 79 | 33 | HIT | 6 |  |
| 193 | +662.000 s | +662.008 s | +662.089 s | 81 ms | yes | 79 | 33 | HIT | 7 |  |
| 194 | +663.000 s | +663.004 s | +663.104 s | 100 ms | yes | 79 | 33 | HIT | 8 |  |
| 195 | +664.000 s | +664.002 s | +664.104 s | 102 ms | yes | 79 | 33 | HIT | 9 |  |
| 196 | +665.000 s | +665.005 s | +665.074 s | 69 ms | yes | 79 | 33 | STALE | 10 |  |
| 197 | +690.000 s | +690.011 s | +690.199 s | 188 ms | yes | 79 | 33 | HIT | 5 |  |
| 198 | +720.000 s | +720.015 s | +720.185 s | 170 ms | yes | 79 | 33 | HIT | 5 |  |
| 199 | +750.000 s | +750.012 s | +750.180 s | 168 ms | yes | 79 | 33 | HIT | 5 |  |
| 200 | +780.000 s | +780.015 s | +780.179 s | 164 ms | yes | 78 | 34 | HIT | 5 | C7 19 O→X |
| 201 | +810.000 s | +810.006 s | +810.156 s | 150 ms | yes | 77 | 35 | HIT | 5 | C7 18 O→X |
| 202 | +840.000 s | +840.012 s | +840.177 s | 165 ms | yes | 77 | 35 | HIT | 5 |  |
| 203 | +870.000 s | +870.009 s | +870.165 s | 156 ms | yes | 77 | 35 | HIT | 5 |  |
| 204 | +900.000 s | +900.004 s | +900.485 s | 481 ms | yes | 77 | 35 | HIT | 5 |  |

### Appendix B — Court 7 in every read

`C7 17 … 22` shows hours 17:00–22:00 from each read's matrix. "Runner classification" is the runner's `PHASE3_EVIDENCE` fitness for that read.

| # | Requested | Answered | Cache | Age | C7 17 18 19 20 21 22 | 19:00–22:00 | Runner classification |
|---:|---:|---:|---|---:|---|---|---|
| 1 | −59.987 s | −59.715 s | MISS | 0 | date not shown | — | UNRELEASED |
| 2 | −49.994 s | −49.839 s | STALE | 10 | date not shown | — | UNRELEASED |
| 3 | −39.986 s | −39.828 s | STALE | 10 | date not shown | — | UNRELEASED |
| 4 | −29.993 s | −29.828 s | STALE | 10 | date not shown | — | UNRELEASED |
| 5 | −19.985 s | −19.810 s | STALE | 10 | date not shown | — | UNRELEASED |
| 6 | −9.991 s | −9.835 s | STALE | 10 | date not shown | — | UNRELEASED |
| 7 | −1.991 s | −1.840 s | HIT | 8 | date not shown | — | UNRELEASED |
| 8 | +0.010 s | +0.262 s | STALE | 10 | date not shown | — | UNRELEASED |
| 9 | +0.259 s | +0.413 s | STALE | 10 | date not shown | — | UNRELEASED |
| 10 | +0.511 s | +0.586 s | STALE | 10 | date not shown | — | UNRELEASED |
| 11 | +1.002 s | +1.080 s | STALE | 11 | date not shown | — | UNRELEASED |
| 12 | +2.014 s | +2.077 s | STALE | 12 | date not shown | — | UNRELEASED |
| 13 | +5.003 s | +5.083 s | STALE | 15 | date not shown | — | UNRELEASED |
| 14 | +6.014 s | +6.094 s | HIT | 1 | O X O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 15 | +7.017 s | +7.104 s | HIT | 2 | O X O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 16 | +8.002 s | +8.095 s | HIT | 3 | O X O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 17 | +9.003 s | +9.079 s | HIT | 4 | O X O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 18 | +10.016 s | +10.082 s | HIT | 5 | O X O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 19 | +11.016 s | +11.080 s | HIT | 6 | O X O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 20 | +12.016 s | +12.091 s | HIT | 7 | O X O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 21 | +13.014 s | +13.086 s | HIT | 8 | O X O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 22 | +14.016 s | +14.091 s | HIT | 9 | O X O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 23 | +15.015 s | +15.098 s | STALE | 10 | O X O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 24 | +16.010 s | +16.099 s | HIT | 1 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 25 | +17.006 s | +17.093 s | HIT | 2 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 26 | +18.016 s | +18.072 s | HIT | 3 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 27 | +19.002 s | +19.069 s | HIT | 4 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 28 | +20.014 s | +20.093 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 29 | +21.014 s | +21.149 s | HIT | 6 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 30 | +22.011 s | +22.087 s | HIT | 7 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 31 | +23.014 s | +23.097 s | HIT | 8 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 32 | +24.012 s | +24.097 s | HIT | 9 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 33 | +25.010 s | +25.074 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 34 | +26.011 s | +26.085 s | HIT | 1 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 35 | +27.007 s | +27.091 s | HIT | 2 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 36 | +28.005 s | +28.087 s | HIT | 3 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 37 | +29.001 s | +29.082 s | HIT | 4 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 38 | +30.012 s | +30.092 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 39 | +31.012 s | +31.086 s | HIT | 6 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 40 | +32.006 s | +32.092 s | HIT | 7 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 41 | +33.006 s | +33.200 s | HIT | 8 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 42 | +34.003 s | +34.077 s | HIT | 9 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 43 | +35.001 s | +35.065 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 44 | +36.015 s | +36.108 s | HIT | 1 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 45 | +37.002 s | +37.079 s | HIT | 2 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 46 | +38.004 s | +38.063 s | HIT | 3 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 47 | +39.001 s | +39.078 s | HIT | 4 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 48 | +40.015 s | +40.093 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 49 | +41.009 s | +41.095 s | HIT | 6 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 50 | +42.008 s | +42.084 s | HIT | 7 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 51 | +43.009 s | +43.102 s | HIT | 8 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 52 | +44.010 s | +44.088 s | HIT | 9 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 53 | +45.012 s | +45.075 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 54 | +46.010 s | +46.091 s | HIT | 1 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 55 | +47.014 s | +47.095 s | HIT | 2 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 56 | +48.016 s | +48.085 s | HIT | 3 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 57 | +49.004 s | +49.085 s | HIT | 4 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 58 | +50.002 s | +50.072 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 59 | +51.016 s | +51.092 s | HIT | 6 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 60 | +52.016 s | +52.082 s | HIT | 7 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 61 | +53.017 s | +53.091 s | HIT | 8 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 62 | +54.014 s | +54.079 s | HIT | 9 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 63 | +55.001 s | +55.092 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 64 | +56.016 s | +56.108 s | HIT | 1 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 65 | +57.004 s | +57.083 s | HIT | 2 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 66 | +58.016 s | +58.111 s | HIT | 3 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 67 | +59.013 s | +59.091 s | HIT | 4 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 68 | +60.009 s | +60.081 s | — | — | read failed | — | FAILED |
| 69 | +65.004 s | +65.166 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 70 | +70.008 s | +70.164 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 71 | +75.010 s | +75.169 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 72 | +80.015 s | +80.188 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 73 | +85.017 s | +85.186 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 74 | +90.009 s | +90.170 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 75 | +95.004 s | +95.175 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 76 | +100.005 s | +100.174 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 77 | +105.004 s | +105.173 s | HIT | 0 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 78 | +110.015 s | +110.187 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 79 | +115.004 s | +115.168 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 80 | +120.012 s | +120.168 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 81 | +125.007 s | +125.169 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 82 | +130.014 s | +130.168 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 83 | +135.002 s | +135.154 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 84 | +140.003 s | +140.191 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 85 | +145.014 s | +145.181 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 86 | +150.002 s | +150.166 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 87 | +155.003 s | +155.168 s | HIT | 0 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 88 | +160.011 s | +160.218 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 89 | +165.004 s | +165.169 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 90 | +170.001 s | +170.179 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 91 | +175.004 s | +175.176 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 92 | +180.007 s | +180.179 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 93 | +185.012 s | +185.206 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 94 | +190.009 s | +190.186 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 95 | +195.013 s | +195.171 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 96 | +200.015 s | +200.178 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 97 | +205.011 s | +205.173 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 98 | +210.013 s | +210.168 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 99 | +215.017 s | +215.175 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 100 | +220.010 s | +220.169 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 101 | +225.002 s | +225.181 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 102 | +230.009 s | +230.168 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 103 | +235.006 s | +235.175 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 104 | +240.002 s | +240.195 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 105 | +245.012 s | +245.197 s | HIT | 0 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 106 | +250.014 s | +250.182 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 107 | +255.010 s | +255.169 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 108 | +260.008 s | +260.163 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 109 | +265.012 s | +265.186 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 110 | +270.005 s | +270.188 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 111 | +275.012 s | +275.178 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 112 | +280.016 s | +280.175 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 113 | +285.002 s | +285.162 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 114 | +290.007 s | +290.168 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 115 | +295.009 s | +295.192 s | STALE | 10 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 116 | +300.008 s | +300.175 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 117 | +330.016 s | +330.185 s | HIT | 5 | X X X X X X | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 118 | +360.007 s | +360.163 s | HIT | 5 | X X X X X O | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 119 | +390.015 s | +390.183 s | HIT | 5 | X X X X X O | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 120 | +420.009 s | +420.187 s | HIT | 5 | X X X X X O | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 121 | +450.007 s | +450.164 s | HIT | 5 | X X X X X O | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 122 | +480.003 s | +480.180 s | HIT | 5 | X X X X X O | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 123 | +510.014 s | +510.207 s | HIT | 5 | X X X X X O | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 124 | +540.012 s | +540.179 s | HIT | 5 | X X X X X O | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 125 | +570.003 s | +570.198 s | HIT | 5 | X X X X X O | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 126 | +595.008 s | +595.178 s | STALE | 10 | X X X X X O | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 127 | +596.003 s | +596.104 s | HIT | 1 | X X X X X O | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 128 | +597.002 s | +597.070 s | HIT | 2 | X X X X X O | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 129 | +598.004 s | +598.085 s | HIT | 3 | X X X X X O | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 130 | +599.006 s | +599.100 s | HIT | 4 | X X X X X O | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 131 | +600.007 s | +600.087 s | HIT | 5 | X X X X X O | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 132 | +601.002 s | +601.082 s | HIT | 6 | X X X X X O | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 133 | +602.002 s | +602.089 s | HIT | 7 | X X X X X O | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 134 | +603.001 s | +603.068 s | HIT | 8 | X X X X X O | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 135 | +604.003 s | +604.084 s | HIT | 9 | X X X X X O | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 136 | +605.003 s | +605.090 s | STALE | 10 | X X X X X O | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 137 | +606.015 s | +606.091 s | HIT | 1 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 138 | +607.015 s | +607.085 s | HIT | 2 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 139 | +608.014 s | +608.097 s | HIT | 3 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 140 | +609.001 s | +609.081 s | HIT | 4 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 141 | +610.016 s | +610.110 s | HIT | 5 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 142 | +611.015 s | +611.091 s | HIT | 6 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 143 | +612.014 s | +612.101 s | HIT | 7 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 144 | +613.009 s | +613.090 s | HIT | 8 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 145 | +614.005 s | +614.112 s | HIT | 9 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 146 | +615.001 s | +615.066 s | STALE | 10 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 147 | +616.003 s | +616.068 s | HIT | 1 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 148 | +617.001 s | +617.081 s | HIT | 2 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 149 | +618.007 s | +618.106 s | HIT | 3 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 150 | +619.007 s | +619.085 s | HIT | 4 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 151 | +620.003 s | +620.077 s | HIT | 5 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 152 | +621.002 s | +621.070 s | HIT | 6 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 153 | +622.015 s | +622.098 s | HIT | 7 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 154 | +623.015 s | +623.095 s | HIT | 8 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 155 | +624.009 s | +624.089 s | HIT | 9 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 156 | +625.006 s | +625.084 s | STALE | 10 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 157 | +626.007 s | +626.079 s | HIT | 1 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 158 | +627.009 s | +627.096 s | HIT | 2 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 159 | +628.007 s | +628.092 s | HIT | 3 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 160 | +629.001 s | +629.081 s | HIT | 4 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 161 | +630.005 s | +630.091 s | HIT | 5 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 162 | +631.004 s | +631.099 s | HIT | 6 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 163 | +632.005 s | +632.084 s | HIT | 7 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 164 | +633.015 s | +633.095 s | HIT | 8 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 165 | +634.002 s | +634.084 s | HIT | 9 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 166 | +635.016 s | +635.110 s | STALE | 10 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 167 | +636.013 s | +636.095 s | HIT | 1 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 168 | +637.002 s | +637.096 s | HIT | 2 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 169 | +638.007 s | +638.085 s | HIT | 3 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 170 | +639.004 s | +639.084 s | HIT | 4 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 171 | +640.005 s | +640.074 s | HIT | 5 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 172 | +641.003 s | +641.096 s | HIT | 6 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 173 | +642.001 s | +642.080 s | HIT | 7 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 174 | +643.007 s | +643.113 s | HIT | 8 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 175 | +644.005 s | +644.087 s | HIT | 9 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 176 | +645.005 s | +645.081 s | STALE | 10 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 177 | +646.004 s | +646.073 s | HIT | 1 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 178 | +647.003 s | +647.071 s | HIT | 2 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 179 | +648.010 s | +648.095 s | HIT | 3 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 180 | +649.002 s | +649.109 s | HIT | 4 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 181 | +650.014 s | +650.097 s | HIT | 5 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 182 | +651.002 s | +651.069 s | HIT | 6 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 183 | +652.014 s | +652.094 s | HIT | 7 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 184 | +653.013 s | +653.088 s | HIT | 8 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 185 | +654.010 s | +654.091 s | HIT | 9 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 186 | +655.010 s | +655.085 s | — | — | read failed | — | FAILED |
| 187 | +656.006 s | +656.094 s | HIT | 1 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 188 | +657.016 s | +657.124 s | HIT | 2 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 189 | +658.012 s | +658.101 s | HIT | 3 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 190 | +659.008 s | +659.080 s | HIT | 4 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 191 | +660.007 s | +660.088 s | HIT | 5 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 192 | +661.001 s | +661.074 s | HIT | 6 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 193 | +662.008 s | +662.089 s | HIT | 7 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 194 | +663.004 s | +663.104 s | HIT | 8 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 195 | +664.002 s | +664.104 s | HIT | 9 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 196 | +665.005 s | +665.074 s | STALE | 10 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 197 | +690.011 s | +690.199 s | HIT | 5 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 198 | +720.015 s | +720.185 s | HIT | 5 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 199 | +750.012 s | +750.180 s | HIT | 5 | O O O O O O | OPEN | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 200 | +780.015 s | +780.179 s | HIT | 5 | O O X O O O | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 201 | +810.006 s | +810.156 s | HIT | 5 | O X X O O O | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 202 | +840.012 s | +840.177 s | HIT | 5 | O X X O O O | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 203 | +870.009 s | +870.165 s | HIT | 5 | O X X O O O | taken | FORENSIC_ONLY_CACHE_AGE_UNKNOWN |
| 204 | +900.004 s | +900.485 s | HIT | 5 | O X X O O O | taken | — |

### Appendix C — Durable journals (summary)

| Worker | Court | Journal key | State | Failure code | Created (UTC) | Updated (UTC) |
|---|---:|---|---|---|---|---|
| A | 7 | `46dbfff25881…` | `rejected` | ONDA_HTTP_STATUS_INVALID | 2026-09-27T23:58:00.066Z | 2026-09-28T00:00:10.624Z |
| B | 6 | `d1b1010ccf67…` | `rejected` | ONDA_HTTP_STATUS_INVALID | 2026-09-27T23:58:00.066Z | 2026-09-28T00:00:08.068Z |
| C | 5 | `1fda8bc07fa6…` | `rejected` | ONDA_HTTP_STATUS_INVALID | 2026-09-27T23:58:00.066Z | 2026-09-28T00:00:10.366Z |
| D | 4 | `6fe7e449f1c9…` | `rejected` | ONDA_HTTP_STATUS_INVALID | 2026-09-27T23:58:00.066Z | 2026-09-28T00:00:12.105Z |
| E | 3 | `19f00779166b…` | `rejected` | ONDA_HTTP_STATUS_INVALID | 2026-09-27T23:58:00.066Z | 2026-09-28T00:00:09.887Z |
| F | 2 | `2743d5629aaf…` | `rejected` | ONDA_HTTP_STATUS_INVALID | 2026-09-27T23:58:00.066Z | 2026-09-28T00:00:10.428Z |
| G | 1 | `9c2763657e2a…` | `rejected` | ONDA_HTTP_STATUS_INVALID | 2026-09-27T23:58:00.066Z | 2026-09-28T00:00:12.110Z |

### Appendix D — Every app command on 28 September (summary)

| Run | Label | Started (Manila) | Result |
|---|---|---|---|
| `21766397` | blockAudit | 07:33:11 | 2026-09-30 · Open 0 · Blocked 0 · Unreleased 112 · Unknown 0. No hold or booking was created.; Process completed: blockAudit · exit code 0; Run finished: complete |
| `918e4f09` | saving | 07:34:44 | Run finished: complete |
| `aa684e5c` | prepare | 07:34:52 | Process completed: apiRun · prepare · exit code 0; Process completed: apiRun · dry · exit code 0; Run finished: complete |
| `cc84c34b` | full | 07:35:25 | Run finished: failed |

### Appendix E — Runner trace, every line (329)

`.local/api-booking/run-progress/e3f7de87-d1d5-4949-9ddc-4cc49529cfa7.ndjson`. Clock basis: stage lines use the trusted clock, and lines with `timingKind`/`eventAt` use the PC clock (39.07 ms behind).

```json
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"RUN_STARTED","at":"2026-09-27T23:35:25.927Z","elapsedMs":2,"sincePreviousMs":2}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"RUN_CONFIGURATION","at":"2026-09-27T23:35:25.935Z","elapsedMs":9,"sincePreviousMs":7,"bookingMethod":"proofless","workerCount":7,"prewarmLeadMs":15000,"releaseMs":1790553600000}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PREPARING_BROWSER","at":"2026-09-27T23:35:26.009Z","elapsedMs":83,"sincePreviousMs":74,"workerId":"A"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PREPARING_BROWSER","at":"2026-09-27T23:35:26.024Z","elapsedMs":99,"sincePreviousMs":16,"workerId":"B"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PREPARING_BROWSER","at":"2026-09-27T23:35:26.039Z","elapsedMs":114,"sincePreviousMs":15,"workerId":"C"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PREPARING_BROWSER","at":"2026-09-27T23:35:26.053Z","elapsedMs":127,"sincePreviousMs":13,"workerId":"D"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PREPARING_BROWSER","at":"2026-09-27T23:35:26.065Z","elapsedMs":140,"sincePreviousMs":13,"workerId":"E"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PREPARING_BROWSER","at":"2026-09-27T23:35:26.076Z","elapsedMs":151,"sincePreviousMs":11,"workerId":"F"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PREPARING_BROWSER","at":"2026-09-27T23:35:26.088Z","elapsedMs":162,"sincePreviousMs":11,"workerId":"G"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"BROWSER_READY","at":"2026-09-27T23:35:28.049Z","elapsedMs":2124,"sincePreviousMs":1962,"workerId":"A","port":19444}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"BROWSER_READY","at":"2026-09-27T23:35:28.049Z","elapsedMs":2124,"sincePreviousMs":0,"workerId":"B","port":19445}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"BROWSER_READY","at":"2026-09-27T23:35:28.069Z","elapsedMs":2143,"sincePreviousMs":19,"workerId":"C","port":19446}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"BROWSER_READY","at":"2026-09-27T23:35:28.078Z","elapsedMs":2152,"sincePreviousMs":9,"workerId":"F","port":19449}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"BROWSER_READY","at":"2026-09-27T23:35:28.078Z","elapsedMs":2153,"sincePreviousMs":1,"workerId":"G","port":19450}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"BROWSER_READY","at":"2026-09-27T23:35:28.080Z","elapsedMs":2155,"sincePreviousMs":2,"workerId":"D","port":19447}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"BROWSER_READY","at":"2026-09-27T23:35:28.081Z","elapsedMs":2155,"sincePreviousMs":0,"workerId":"E","port":19448}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"BROWSER_PREPARATION_OUTCOME","at":"2026-09-27T23:35:28.081Z","elapsedMs":2156,"sincePreviousMs":1,"workerId":"A","status":"fulfilled","code":"COMPLETED"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"BROWSER_PREPARATION_OUTCOME","at":"2026-09-27T23:35:28.081Z","elapsedMs":2156,"sincePreviousMs":0,"workerId":"B","status":"fulfilled","code":"COMPLETED"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"BROWSER_PREPARATION_OUTCOME","at":"2026-09-27T23:35:28.081Z","elapsedMs":2156,"sincePreviousMs":0,"workerId":"C","status":"fulfilled","code":"COMPLETED"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"BROWSER_PREPARATION_OUTCOME","at":"2026-09-27T23:35:28.081Z","elapsedMs":2156,"sincePreviousMs":0,"workerId":"D","status":"fulfilled","code":"COMPLETED"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"BROWSER_PREPARATION_OUTCOME","at":"2026-09-27T23:35:28.081Z","elapsedMs":2156,"sincePreviousMs":0,"workerId":"E","status":"fulfilled","code":"COMPLETED"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"BROWSER_PREPARATION_OUTCOME","at":"2026-09-27T23:35:28.081Z","elapsedMs":2156,"sincePreviousMs":0,"workerId":"F","status":"fulfilled","code":"COMPLETED"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"BROWSER_PREPARATION_OUTCOME","at":"2026-09-27T23:35:28.081Z","elapsedMs":2156,"sincePreviousMs":0,"workerId":"G","status":"fulfilled","code":"COMPLETED"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_AUTHORIZATION","at":"2026-09-27T23:35:28.083Z","elapsedMs":2157,"sincePreviousMs":1,"candidateCount":10,"wave1Count":7,"standbyCount":0,"maxWave2":0,"maxRescue":1,"maxTotal":8,"fingerprint":"[REDACTED]"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_CANDIDATE","at":"2026-09-27T23:35:28.083Z","elapsedMs":2158,"sincePreviousMs":1,"candidateId":"85746ed1a88a159960b11e0d2c8b10c708b9f33cd500ea5a2bb0850aa481b032","court":7,"startTime":"19:00","endTime":"22:00","durationHours":3,"priority":1,"amount":2100,"rateStatus":"VENUE_SCHEDULE","source":"current venue schedule"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_CANDIDATE","at":"2026-09-27T23:35:28.083Z","elapsedMs":2158,"sincePreviousMs":0,"candidateId":"9cf2c3872f8c8c5e6867a9211f3fc9e91f9903a7451380bb72b0b187da0f0fcf","court":6,"startTime":"19:00","endTime":"22:00","durationHours":3,"priority":2,"amount":2100,"rateStatus":"VENUE_SCHEDULE","source":"current venue schedule"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_CANDIDATE","at":"2026-09-27T23:35:28.083Z","elapsedMs":2158,"sincePreviousMs":0,"candidateId":"0aafa30e010464e6b8a17e61980df60fbbbfb769640964ed4af67b15f6b6a09d","court":5,"startTime":"19:00","endTime":"22:00","durationHours":3,"priority":3,"amount":2100,"rateStatus":"VENUE_SCHEDULE","source":"current venue schedule"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_CANDIDATE","at":"2026-09-27T23:35:28.083Z","elapsedMs":2158,"sincePreviousMs":0,"candidateId":"5dfb38082fe0d4977a10e38c4c9206b64a97e97ea8034aa93f6a7fd699d6b59a","court":4,"startTime":"19:00","endTime":"22:00","durationHours":3,"priority":4,"amount":2100,"rateStatus":"VENUE_SCHEDULE","source":"current venue schedule"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_CANDIDATE","at":"2026-09-27T23:35:28.083Z","elapsedMs":2158,"sincePreviousMs":0,"candidateId":"5589eb0cb6e51ddb891ffe17f5b7b8d0a3acbbd46ee68a9d8fe68832504154c3","court":3,"startTime":"19:00","endTime":"22:00","durationHours":3,"priority":5,"amount":2100,"rateStatus":"VENUE_SCHEDULE","source":"current venue schedule"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_CANDIDATE","at":"2026-09-27T23:35:28.083Z","elapsedMs":2158,"sincePreviousMs":0,"candidateId":"9a0e7b37cb7df37170afa84d5efeb1706016659f468b2baa5f237296291e991c","court":2,"startTime":"19:00","endTime":"22:00","durationHours":3,"priority":6,"amount":2100,"rateStatus":"VENUE_SCHEDULE","source":"current venue schedule"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_CANDIDATE","at":"2026-09-27T23:35:28.083Z","elapsedMs":2158,"sincePreviousMs":0,"candidateId":"5caf181e63715dbd31129a673fe1b463ba7602d79cf8d96902831f4196b3baeb","court":1,"startTime":"19:00","endTime":"22:00","durationHours":3,"priority":7,"amount":2100,"rateStatus":"VENUE_SCHEDULE","source":"current venue schedule"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_CANDIDATE","at":"2026-09-27T23:35:28.083Z","elapsedMs":2158,"sincePreviousMs":0,"candidateId":"1fb999448ad5d37123c239003c9bf868a815f0155a993fe5a513f4cb490496ce","court":3,"startTime":"20:00","endTime":"23:00","durationHours":3,"priority":8,"amount":2100,"rateStatus":"VENUE_SCHEDULE","source":"current venue schedule"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_CANDIDATE","at":"2026-09-27T23:35:28.083Z","elapsedMs":2158,"sincePreviousMs":0,"candidateId":"6313348273e5a5a7a8414749530e14b59d93fd784cb083ca4b582cafc0240507","court":6,"startTime":"17:00","endTime":"20:00","durationHours":3,"priority":9,"amount":2100,"rateStatus":"VENUE_SCHEDULE","source":"current venue schedule"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_CANDIDATE","at":"2026-09-27T23:35:28.083Z","elapsedMs":2158,"sincePreviousMs":0,"candidateId":"9e0bd2eb82da5da0f4f120d5344c535bdb77338a6ab1a03330576343969cabe2","court":6,"startTime":"20:00","endTime":"23:00","durationHours":3,"priority":10,"amount":2100,"rateStatus":"VENUE_SCHEDULE","source":"current venue schedule"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_DIVERSIFICATION_WARNING","at":"2026-09-27T23:35:28.083Z","elapsedMs":2158,"sincePreviousMs":0,"message":"All 7 Wave 1 attempts share 19:00–22:00. A time-wide unavailable block would affect every attempt."}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"NETWORK_CLOCK_REFRESHED","at":"2026-09-27T23:50:00.279Z","elapsedMs":874342,"sincePreviousMs":872184,"checkpoint":"T-10M","offsetMs":35,"roundTripMs":43,"deltaMs":12,"sampleCount":10,"spreadMs":17.3,"uncertaintyMs":21.9}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_WAVE1_PRICE","at":"2026-09-27T23:58:00.006Z","elapsedMs":1354068,"sincePreviousMs":479726,"workerId":"A","candidateId":"85746ed1a88a159960b11e0d2c8b10c708b9f33cd500ea5a2bb0850aa481b032","amount":2100,"source":"current venue schedule","rateStatus":"VENUE_SCHEDULE","capturedAt":"2026-09-27T23:34:41.481Z"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_WAVE1_PRICE","at":"2026-09-27T23:58:00.007Z","elapsedMs":1354069,"sincePreviousMs":1,"workerId":"B","candidateId":"9cf2c3872f8c8c5e6867a9211f3fc9e91f9903a7451380bb72b0b187da0f0fcf","amount":2100,"source":"current venue schedule","rateStatus":"VENUE_SCHEDULE","capturedAt":"2026-09-27T23:34:41.481Z"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_WAVE1_PRICE","at":"2026-09-27T23:58:00.008Z","elapsedMs":1354070,"sincePreviousMs":1,"workerId":"C","candidateId":"0aafa30e010464e6b8a17e61980df60fbbbfb769640964ed4af67b15f6b6a09d","amount":2100,"source":"current venue schedule","rateStatus":"VENUE_SCHEDULE","capturedAt":"2026-09-27T23:34:41.481Z"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_WAVE1_PRICE","at":"2026-09-27T23:58:00.009Z","elapsedMs":1354071,"sincePreviousMs":1,"workerId":"D","candidateId":"5dfb38082fe0d4977a10e38c4c9206b64a97e97ea8034aa93f6a7fd699d6b59a","amount":2100,"source":"current venue schedule","rateStatus":"VENUE_SCHEDULE","capturedAt":"2026-09-27T23:34:41.481Z"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_WAVE1_PRICE","at":"2026-09-27T23:58:00.010Z","elapsedMs":1354072,"sincePreviousMs":1,"workerId":"E","candidateId":"5589eb0cb6e51ddb891ffe17f5b7b8d0a3acbbd46ee68a9d8fe68832504154c3","amount":2100,"source":"current venue schedule","rateStatus":"VENUE_SCHEDULE","capturedAt":"2026-09-27T23:34:41.481Z"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_WAVE1_PRICE","at":"2026-09-27T23:58:00.011Z","elapsedMs":1354073,"sincePreviousMs":1,"workerId":"F","candidateId":"9a0e7b37cb7df37170afa84d5efeb1706016659f468b2baa5f237296291e991c","amount":2100,"source":"current venue schedule","rateStatus":"VENUE_SCHEDULE","capturedAt":"2026-09-27T23:34:41.481Z"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_WAVE1_PRICE","at":"2026-09-27T23:58:00.011Z","elapsedMs":1354074,"sincePreviousMs":1,"workerId":"G","candidateId":"5caf181e63715dbd31129a673fe1b463ba7602d79cf8d96902831f4196b3baeb","amount":2100,"source":"current venue schedule","rateStatus":"VENUE_SCHEDULE","capturedAt":"2026-09-27T23:34:41.481Z"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_FROZEN","at":"2026-09-27T23:58:00.061Z","elapsedMs":1354123,"sincePreviousMs":49,"candidateCount":10,"wave1Count":7,"fingerprint":"[REDACTED]"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"DIAGNOSTIC_ATTEMPT_ARMED","at":"2026-09-27T23:58:00.028Z","elapsedMs":1354124,"sincePreviousMs":1354124,"workerId":"A","lane":"core","attemptType":"official","attemptId":"core-A-official-1","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:58:00.028Z","court":7,"startTime":"19:00","durationHours":3,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"DIAGNOSTIC_ATTEMPT_ARMED","at":"2026-09-27T23:58:00.028Z","elapsedMs":1354124,"sincePreviousMs":0,"workerId":"B","lane":"core","attemptType":"official","attemptId":"core-B-official-2","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:58:00.028Z","court":6,"startTime":"19:00","durationHours":3,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"DIAGNOSTIC_ATTEMPT_ARMED","at":"2026-09-27T23:58:00.028Z","elapsedMs":1354124,"sincePreviousMs":0,"workerId":"C","lane":"core","attemptType":"official","attemptId":"core-C-official-3","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:58:00.028Z","court":5,"startTime":"19:00","durationHours":3,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"DIAGNOSTIC_ATTEMPT_ARMED","at":"2026-09-27T23:58:00.028Z","elapsedMs":1354124,"sincePreviousMs":0,"workerId":"D","lane":"core","attemptType":"official","attemptId":"core-D-official-4","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:58:00.028Z","court":4,"startTime":"19:00","durationHours":3,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"DIAGNOSTIC_ATTEMPT_ARMED","at":"2026-09-27T23:58:00.028Z","elapsedMs":1354125,"sincePreviousMs":1,"workerId":"E","lane":"core","attemptType":"official","attemptId":"core-E-official-5","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:58:00.028Z","court":3,"startTime":"19:00","durationHours":3,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"DIAGNOSTIC_ATTEMPT_ARMED","at":"2026-09-27T23:58:00.028Z","elapsedMs":1354125,"sincePreviousMs":0,"workerId":"F","lane":"core","attemptType":"official","attemptId":"core-F-official-6","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:58:00.028Z","court":2,"startTime":"19:00","durationHours":3,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"DIAGNOSTIC_ATTEMPT_ARMED","at":"2026-09-27T23:58:00.028Z","elapsedMs":1354125,"sincePreviousMs":0,"workerId":"G","lane":"core","attemptType":"official","attemptId":"core-G-official-7","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:58:00.028Z","court":1,"startTime":"19:00","durationHours":3,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"RELEASE_OFFSET_SCHEDULED","at":"2026-09-27T23:58:00.090Z","elapsedMs":1354152,"sincePreviousMs":29,"releaseMs":1790553600000,"triggerMs":1790553599990,"releaseOffsetMs":-10,"workerId":"A"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"RELEASE_OFFSET_SCHEDULED","at":"2026-09-27T23:58:00.090Z","elapsedMs":1354152,"sincePreviousMs":0,"releaseMs":1790553600000,"triggerMs":1790553599975,"releaseOffsetMs":-25,"workerId":"B"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"RELEASE_OFFSET_SCHEDULED","at":"2026-09-27T23:58:00.090Z","elapsedMs":1354152,"sincePreviousMs":0,"releaseMs":1790553600000,"triggerMs":1790553599950,"releaseOffsetMs":-50,"workerId":"C"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"RELEASE_OFFSET_SCHEDULED","at":"2026-09-27T23:58:00.090Z","elapsedMs":1354152,"sincePreviousMs":0,"releaseMs":1790553600000,"triggerMs":1790553599995,"releaseOffsetMs":-5,"workerId":"D"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"NETWORK_CLOCK_CONSENSUS","at":"2026-09-27T23:59:00.192Z","elapsedMs":1414250,"sincePreviousMs":60098,"checkpoint":"T-60S","offsetMs":39.8,"roundTripMs":42,"deltaMs":5,"sampleCount":10,"spreadMs":8.9,"uncertaintyMs":21.3}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-27T23:59:00.299Z","elapsedMs":1414356,"sincePreviousMs":106,"seq":1,"fitness":"UNRELEASED","cache":"MISS"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-27T23:59:10.196Z","elapsedMs":1424253,"sincePreviousMs":9897,"seq":2,"fitness":"UNRELEASED","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-27T23:59:20.203Z","elapsedMs":1434260,"sincePreviousMs":10007,"seq":3,"fitness":"UNRELEASED","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"NETWORK_CLOCK_CONSENSUS","at":"2026-09-27T23:59:30.189Z","elapsedMs":1444246,"sincePreviousMs":9986,"checkpoint":"T-30S","offsetMs":39,"roundTripMs":43,"deltaMs":-0.8,"sampleCount":10,"spreadMs":3.5,"uncertaintyMs":21.9}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-27T23:59:30.194Z","elapsedMs":1444251,"sincePreviousMs":5,"seq":4,"fitness":"UNRELEASED","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-27T23:59:40.220Z","elapsedMs":1454277,"sincePreviousMs":10026,"seq":5,"fitness":"UNRELEASED","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"SECURITY_PREPARATION_STARTED","at":"2026-09-27T23:59:44.912Z","elapsedMs":1459008,"sincePreviousMs":104883,"workerId":"A","lane":"core","attemptType":"official","attemptId":"core-A-official-1","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:44.912Z","securitySource":"FRESH_ACQUISITION","operation":"security","activeAvailability":0,"activeSecurity":1,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"SECURITY_PREPARATION_STARTED","at":"2026-09-27T23:59:44.914Z","elapsedMs":1459010,"sincePreviousMs":2,"workerId":"B","lane":"core","attemptType":"official","attemptId":"core-B-official-2","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:44.914Z","securitySource":"FRESH_ACQUISITION","operation":"security","activeAvailability":0,"activeSecurity":2,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"SECURITY_PREPARATION_STARTED","at":"2026-09-27T23:59:44.914Z","elapsedMs":1459010,"sincePreviousMs":0,"workerId":"C","lane":"core","attemptType":"official","attemptId":"core-C-official-3","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:44.914Z","securitySource":"FRESH_ACQUISITION","operation":"security","activeAvailability":0,"activeSecurity":3,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"SECURITY_PREPARATION_STARTED","at":"2026-09-27T23:59:44.914Z","elapsedMs":1459010,"sincePreviousMs":0,"workerId":"D","lane":"core","attemptType":"official","attemptId":"core-D-official-4","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:44.914Z","securitySource":"FRESH_ACQUISITION","operation":"security","activeAvailability":0,"activeSecurity":4,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"SECURITY_PREPARATION_STARTED","at":"2026-09-27T23:59:44.914Z","elapsedMs":1459010,"sincePreviousMs":0,"workerId":"E","lane":"core","attemptType":"official","attemptId":"core-E-official-5","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:44.914Z","securitySource":"FRESH_ACQUISITION","operation":"security","activeAvailability":0,"activeSecurity":5,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"SECURITY_PREPARATION_STARTED","at":"2026-09-27T23:59:44.914Z","elapsedMs":1459011,"sincePreviousMs":1,"workerId":"F","lane":"core","attemptType":"official","attemptId":"core-F-official-6","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:44.914Z","securitySource":"FRESH_ACQUISITION","operation":"security","activeAvailability":0,"activeSecurity":6,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"SECURITY_PREPARATION_STARTED","at":"2026-09-27T23:59:44.915Z","elapsedMs":1459011,"sincePreviousMs":0,"workerId":"G","lane":"core","attemptType":"official","attemptId":"core-G-official-7","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:44.915Z","securitySource":"FRESH_ACQUISITION","operation":"security","activeAvailability":0,"activeSecurity":7,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"SECURITY_PREPARATION_COMPLETED","at":"2026-09-27T23:59:48.415Z","elapsedMs":1462512,"sincePreviousMs":3501,"workerId":"B","lane":"core","attemptType":"official","attemptId":"core-B-official-2","timingKind":"MEASURED_DURATION","eventAt":"2026-09-27T23:59:48.415Z","securitySource":"FRESH_ACQUISITION","durationMs":3502,"operation":"security","activeAvailability":0,"activeSecurity":6,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"SECURITY_PREPARATION_COMPLETED","at":"2026-09-27T23:59:48.957Z","elapsedMs":1463054,"sincePreviousMs":542,"workerId":"C","lane":"core","attemptType":"official","attemptId":"core-C-official-3","timingKind":"MEASURED_DURATION","eventAt":"2026-09-27T23:59:48.957Z","securitySource":"FRESH_ACQUISITION","durationMs":4044,"operation":"security","activeAvailability":0,"activeSecurity":5,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"SECURITY_PREPARATION_COMPLETED","at":"2026-09-27T23:59:49.031Z","elapsedMs":1463127,"sincePreviousMs":73,"workerId":"G","lane":"core","attemptType":"official","attemptId":"core-G-official-7","timingKind":"MEASURED_DURATION","eventAt":"2026-09-27T23:59:49.031Z","securitySource":"FRESH_ACQUISITION","durationMs":4116,"operation":"security","activeAvailability":0,"activeSecurity":4,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"SECURITY_PREPARATION_COMPLETED","at":"2026-09-27T23:59:49.147Z","elapsedMs":1463243,"sincePreviousMs":116,"workerId":"E","lane":"core","attemptType":"official","attemptId":"core-E-official-5","timingKind":"MEASURED_DURATION","eventAt":"2026-09-27T23:59:49.147Z","securitySource":"FRESH_ACQUISITION","durationMs":4232,"operation":"security","activeAvailability":0,"activeSecurity":3,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"SECURITY_PREPARATION_COMPLETED","at":"2026-09-27T23:59:49.248Z","elapsedMs":1463344,"sincePreviousMs":101,"workerId":"F","lane":"core","attemptType":"official","attemptId":"core-F-official-6","timingKind":"MEASURED_DURATION","eventAt":"2026-09-27T23:59:49.248Z","securitySource":"FRESH_ACQUISITION","durationMs":4333,"operation":"security","activeAvailability":0,"activeSecurity":2,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"SECURITY_PREPARATION_COMPLETED","at":"2026-09-27T23:59:49.438Z","elapsedMs":1463534,"sincePreviousMs":190,"workerId":"A","lane":"core","attemptType":"official","attemptId":"core-A-official-1","timingKind":"MEASURED_DURATION","eventAt":"2026-09-27T23:59:49.438Z","securitySource":"FRESH_ACQUISITION","durationMs":4526,"operation":"security","activeAvailability":0,"activeSecurity":1,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-27T23:59:50.183Z","elapsedMs":1464240,"sincePreviousMs":9963,"seq":6,"fitness":"UNRELEASED","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"SECURITY_PREPARATION_COMPLETED","at":"2026-09-27T23:59:52.769Z","elapsedMs":1466866,"sincePreviousMs":3332,"workerId":"D","lane":"core","attemptType":"official","attemptId":"core-D-official-4","timingKind":"MEASURED_DURATION","eventAt":"2026-09-27T23:59:52.769Z","securitySource":"FRESH_ACQUISITION","durationMs":7855,"operation":"security","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-27T23:59:58.165Z","elapsedMs":1472222,"sincePreviousMs":7982,"seq":7,"fitness":"UNRELEASED","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_FUNCTION_ENTERED","at":"2026-09-27T23:59:59.911Z","elapsedMs":1474008,"sincePreviousMs":7142,"workerId":"C","lane":"core","attemptType":"official","attemptId":"core-C-official-3","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.911Z","preparedContextAgeMs":10953,"securitySource":"PREPARED_CONTEXT","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_PRE_POST","at":"2026-09-27T23:59:59.912Z","elapsedMs":1474008,"sincePreviousMs":0,"workerId":"C","lane":"core","attemptType":"official","attemptId":"core-C-official-3","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.912Z","preparedContextAgeMs":10954,"securitySource":"PREPARED_CONTEXT","releaseLatenessMs":-49.5,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_DISPATCH","at":"2026-09-27T23:59:59.954Z","elapsedMs":1474012,"sincePreviousMs":1790,"workerId":"C","candidateId":"0aafa30e010464e6b8a17e61980df60fbbbfb769640964ed4af67b15f6b6a09d","wave":"WAVE_1","attemptId":"core-C-official-3"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_HTTP_POST_INITIATED","at":"2026-09-27T23:59:59.915Z","elapsedMs":1474011,"sincePreviousMs":3,"workerId":"C","lane":"core","attemptType":"official","attemptId":"core-C-official-3","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.915Z","initiationEvidence":"PLAYWRIGHT_REQUEST_EVENT","releaseLatenessMs":-45.8,"operation":"checkout","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":1}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_FUNCTION_ENTERED","at":"2026-09-27T23:59:59.936Z","elapsedMs":1474032,"sincePreviousMs":21,"workerId":"B","lane":"core","attemptType":"official","attemptId":"core-B-official-2","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.936Z","preparedContextAgeMs":11520,"securitySource":"PREPARED_CONTEXT","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":1}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_PRE_POST","at":"2026-09-27T23:59:59.936Z","elapsedMs":1474032,"sincePreviousMs":0,"workerId":"B","lane":"core","attemptType":"official","attemptId":"core-B-official-2","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.936Z","preparedContextAgeMs":11520,"securitySource":"PREPARED_CONTEXT","releaseLatenessMs":-24.9,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":1}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_DISPATCH","at":"2026-09-27T23:59:59.979Z","elapsedMs":1474036,"sincePreviousMs":24,"workerId":"B","candidateId":"9cf2c3872f8c8c5e6867a9211f3fc9e91f9903a7451380bb72b0b187da0f0fcf","wave":"WAVE_1","attemptId":"core-B-official-2"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_HTTP_POST_INITIATED","at":"2026-09-27T23:59:59.940Z","elapsedMs":1474036,"sincePreviousMs":4,"workerId":"B","lane":"core","attemptType":"official","attemptId":"core-B-official-2","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.940Z","initiationEvidence":"PLAYWRIGHT_REQUEST_EVENT","releaseLatenessMs":-21.2,"operation":"checkout","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":2}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_FUNCTION_ENTERED","at":"2026-09-27T23:59:59.951Z","elapsedMs":1474047,"sincePreviousMs":11,"workerId":"A","lane":"core","attemptType":"official","attemptId":"core-A-official-1","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.951Z","preparedContextAgeMs":10513,"securitySource":"PREPARED_CONTEXT","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":2}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_PRE_POST","at":"2026-09-27T23:59:59.951Z","elapsedMs":1474047,"sincePreviousMs":0,"workerId":"A","lane":"core","attemptType":"official","attemptId":"core-A-official-1","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.951Z","preparedContextAgeMs":10513,"securitySource":"PREPARED_CONTEXT","releaseLatenessMs":-9.9,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":2}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_DISPATCH","at":"2026-09-27T23:59:59.994Z","elapsedMs":1474051,"sincePreviousMs":15,"workerId":"A","candidateId":"85746ed1a88a159960b11e0d2c8b10c708b9f33cd500ea5a2bb0850aa481b032","wave":"WAVE_1","attemptId":"core-A-official-1"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_HTTP_POST_INITIATED","at":"2026-09-27T23:59:59.955Z","elapsedMs":1474051,"sincePreviousMs":4,"workerId":"A","lane":"core","attemptType":"official","attemptId":"core-A-official-1","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.955Z","initiationEvidence":"PLAYWRIGHT_REQUEST_EVENT","releaseLatenessMs":-6.2,"operation":"checkout","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":3}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_FUNCTION_ENTERED","at":"2026-09-27T23:59:59.956Z","elapsedMs":1474052,"sincePreviousMs":1,"workerId":"D","lane":"core","attemptType":"official","attemptId":"core-D-official-4","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.956Z","preparedContextAgeMs":7186,"securitySource":"PREPARED_CONTEXT","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":3}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_PRE_POST","at":"2026-09-27T23:59:59.956Z","elapsedMs":1474052,"sincePreviousMs":0,"workerId":"D","lane":"core","attemptType":"official","attemptId":"core-D-official-4","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.956Z","preparedContextAgeMs":7186,"securitySource":"PREPARED_CONTEXT","releaseLatenessMs":-4.9,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":3}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_DISPATCH","at":"2026-09-27T23:59:59.999Z","elapsedMs":1474056,"sincePreviousMs":5,"workerId":"D","candidateId":"5dfb38082fe0d4977a10e38c4c9206b64a97e97ea8034aa93f6a7fd699d6b59a","wave":"WAVE_1","attemptId":"core-D-official-4"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_HTTP_POST_INITIATED","at":"2026-09-27T23:59:59.960Z","elapsedMs":1474056,"sincePreviousMs":4,"workerId":"D","lane":"core","attemptType":"official","attemptId":"core-D-official-4","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.960Z","initiationEvidence":"PLAYWRIGHT_REQUEST_EVENT","releaseLatenessMs":-1,"operation":"checkout","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":4}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_WAVE1_STARTED","at":"2026-09-28T00:00:00.003Z","elapsedMs":1474060,"sincePreviousMs":4,"workerId":"A","candidateId":"85746ed1a88a159960b11e0d2c8b10c708b9f33cd500ea5a2bb0850aa481b032","wave":"WAVE_1","attemptId":"core-A-official-1","court":7,"startTime":"19:00","endTime":"22:00","amount":2100}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_WAVE1_STARTED","at":"2026-09-28T00:00:00.003Z","elapsedMs":1474060,"sincePreviousMs":0,"workerId":"B","candidateId":"9cf2c3872f8c8c5e6867a9211f3fc9e91f9903a7451380bb72b0b187da0f0fcf","wave":"WAVE_1","attemptId":"core-B-official-2","court":6,"startTime":"19:00","endTime":"22:00","amount":2100}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_WAVE1_STARTED","at":"2026-09-28T00:00:00.004Z","elapsedMs":1474061,"sincePreviousMs":1,"workerId":"C","candidateId":"0aafa30e010464e6b8a17e61980df60fbbbfb769640964ed4af67b15f6b6a09d","wave":"WAVE_1","attemptId":"core-C-official-3","court":5,"startTime":"19:00","endTime":"22:00","amount":2100}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_WAVE1_STARTED","at":"2026-09-28T00:00:00.004Z","elapsedMs":1474061,"sincePreviousMs":0,"workerId":"D","candidateId":"5dfb38082fe0d4977a10e38c4c9206b64a97e97ea8034aa93f6a7fd699d6b59a","wave":"WAVE_1","attemptId":"core-D-official-4","court":4,"startTime":"19:00","endTime":"22:00","amount":2100}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_WAVE1_STARTED","at":"2026-09-28T00:00:00.004Z","elapsedMs":1474061,"sincePreviousMs":0,"workerId":"E","candidateId":"5589eb0cb6e51ddb891ffe17f5b7b8d0a3acbbd46ee68a9d8fe68832504154c3","wave":"WAVE_1","attemptId":"core-E-official-5","court":3,"startTime":"19:00","endTime":"22:00","amount":2100}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_WAVE1_STARTED","at":"2026-09-28T00:00:00.004Z","elapsedMs":1474061,"sincePreviousMs":0,"workerId":"F","candidateId":"9a0e7b37cb7df37170afa84d5efeb1706016659f468b2baa5f237296291e991c","wave":"WAVE_1","attemptId":"core-F-official-6","court":2,"startTime":"19:00","endTime":"22:00","amount":2100}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_WAVE1_STARTED","at":"2026-09-28T00:00:00.004Z","elapsedMs":1474061,"sincePreviousMs":0,"workerId":"G","candidateId":"5caf181e63715dbd31129a673fe1b463ba7602d79cf8d96902831f4196b3baeb","wave":"WAVE_1","attemptId":"core-G-official-7","court":1,"startTime":"19:00","endTime":"22:00","amount":2100}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_FUNCTION_ENTERED","at":"2026-09-27T23:59:59.961Z","elapsedMs":1474057,"sincePreviousMs":1,"workerId":"E","lane":"core","attemptType":"official","attemptId":"core-E-official-5","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.961Z","preparedContextAgeMs":10814,"securitySource":"PREPARED_CONTEXT","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":4}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_PRE_POST","at":"2026-09-27T23:59:59.961Z","elapsedMs":1474057,"sincePreviousMs":0,"workerId":"E","lane":"core","attemptType":"official","attemptId":"core-E-official-5","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.961Z","preparedContextAgeMs":10814,"securitySource":"PREPARED_CONTEXT","releaseLatenessMs":0.1,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":4}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_FUNCTION_ENTERED","at":"2026-09-27T23:59:59.962Z","elapsedMs":1474058,"sincePreviousMs":1,"workerId":"F","lane":"core","attemptType":"official","attemptId":"core-F-official-6","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.962Z","preparedContextAgeMs":10714,"securitySource":"PREPARED_CONTEXT","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":4}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_PRE_POST","at":"2026-09-27T23:59:59.962Z","elapsedMs":1474058,"sincePreviousMs":0,"workerId":"F","lane":"core","attemptType":"official","attemptId":"core-F-official-6","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.962Z","preparedContextAgeMs":10714,"securitySource":"PREPARED_CONTEXT","releaseLatenessMs":0.6,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":4}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_FUNCTION_ENTERED","at":"2026-09-27T23:59:59.962Z","elapsedMs":1474058,"sincePreviousMs":0,"workerId":"G","lane":"core","attemptType":"official","attemptId":"core-G-official-7","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.962Z","preparedContextAgeMs":10931,"securitySource":"PREPARED_CONTEXT","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":4}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_PRE_POST","at":"2026-09-27T23:59:59.962Z","elapsedMs":1474058,"sincePreviousMs":0,"workerId":"G","lane":"core","attemptType":"official","attemptId":"core-G-official-7","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.962Z","preparedContextAgeMs":10931,"securitySource":"PREPARED_CONTEXT","releaseLatenessMs":0.9,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":4}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_DISPATCH","at":"2026-09-28T00:00:00.008Z","elapsedMs":1474066,"sincePreviousMs":5,"workerId":"G","candidateId":"5caf181e63715dbd31129a673fe1b463ba7602d79cf8d96902831f4196b3baeb","wave":"WAVE_1","attemptId":"core-G-official-7"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_DISPATCH","at":"2026-09-28T00:00:00.009Z","elapsedMs":1474066,"sincePreviousMs":0,"workerId":"E","candidateId":"5589eb0cb6e51ddb891ffe17f5b7b8d0a3acbbd46ee68a9d8fe68832504154c3","wave":"WAVE_1","attemptId":"core-E-official-5"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_HTTP_POST_INITIATED","at":"2026-09-27T23:59:59.969Z","elapsedMs":1474065,"sincePreviousMs":7,"workerId":"G","lane":"core","attemptType":"official","attemptId":"core-G-official-7","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.969Z","initiationEvidence":"PLAYWRIGHT_REQUEST_EVENT","releaseLatenessMs":8,"operation":"checkout","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":5}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_DISPATCH","at":"2026-09-28T00:00:00.009Z","elapsedMs":1474066,"sincePreviousMs":0,"workerId":"F","candidateId":"9a0e7b37cb7df37170afa84d5efeb1706016659f468b2baa5f237296291e991c","wave":"WAVE_1","attemptId":"core-F-official-6"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_HTTP_POST_INITIATED","at":"2026-09-27T23:59:59.970Z","elapsedMs":1474066,"sincePreviousMs":1,"workerId":"E","lane":"core","attemptType":"official","attemptId":"core-E-official-5","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.970Z","initiationEvidence":"PLAYWRIGHT_REQUEST_EVENT","releaseLatenessMs":8.5,"operation":"checkout","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":6}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_HTTP_POST_INITIATED","at":"2026-09-27T23:59:59.970Z","elapsedMs":1474066,"sincePreviousMs":0,"workerId":"F","lane":"core","attemptType":"official","attemptId":"core-F-official-6","timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:59:59.970Z","initiationEvidence":"PLAYWRIGHT_REQUEST_EVENT","releaseLatenessMs":8.6,"operation":"checkout","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":7}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:00.294Z","elapsedMs":1474351,"sincePreviousMs":285,"seq":8,"fitness":"UNRELEASED","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:00.417Z","elapsedMs":1474475,"sincePreviousMs":124,"seq":9,"fitness":"UNRELEASED","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:00.611Z","elapsedMs":1474668,"sincePreviousMs":193,"seq":10,"fitness":"UNRELEASED","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:01.114Z","elapsedMs":1475171,"sincePreviousMs":503,"seq":11,"fitness":"UNRELEASED","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:02.111Z","elapsedMs":1476168,"sincePreviousMs":997,"seq":12,"fitness":"UNRELEASED","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:05.100Z","elapsedMs":1479158,"sincePreviousMs":2990,"seq":13,"fitness":"UNRELEASED","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:06.128Z","elapsedMs":1480185,"sincePreviousMs":1027,"seq":14,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:07.130Z","elapsedMs":1481187,"sincePreviousMs":1002,"seq":15,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_RESPONSE_COMPLETED","at":"2026-09-28T00:00:08.027Z","elapsedMs":1482123,"sincePreviousMs":8057,"workerId":"B","lane":"core","attemptType":"official","attemptId":"core-B-official-2","timingKind":"MEASURED_DURATION","eventAt":"2026-09-28T00:00:08.027Z","networkDurationMs":8089,"statusCode":409,"dispatchState":"RESPONSE_CAPTURED","failureCategory":"ONDA_HTTP_STATUS_INVALID","errorHint":"availability","responseSource":"application","responseBytes":100,"bodyShape":"80651c57074d","operation":"checkout","durationMs":8087,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":6}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_SETTLED","at":"2026-09-28T00:00:08.079Z","elapsedMs":1482136,"sincePreviousMs":949,"workerId":"B","candidateId":"9cf2c3872f8c8c5e6867a9211f3fc9e91f9903a7451380bb72b0b187da0f0fcf","wave":"WAVE_1","attemptId":"core-B-official-2","state":"REJECTED"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:08.132Z","elapsedMs":1482189,"sincePreviousMs":53,"seq":16,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:09.101Z","elapsedMs":1483158,"sincePreviousMs":969,"seq":17,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_RESPONSE_COMPLETED","at":"2026-09-28T00:00:09.808Z","elapsedMs":1483904,"sincePreviousMs":1781,"workerId":"E","lane":"core","attemptType":"official","attemptId":"core-E-official-5","timingKind":"MEASURED_DURATION","eventAt":"2026-09-28T00:00:09.808Z","networkDurationMs":9846,"statusCode":409,"dispatchState":"RESPONSE_CAPTURED","failureCategory":"ONDA_HTTP_STATUS_INVALID","errorHint":"availability","responseSource":"application","responseBytes":100,"bodyShape":"80651c57074d","operation":"checkout","durationMs":9839,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":5}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_SETTLED","at":"2026-09-28T00:00:09.901Z","elapsedMs":1483958,"sincePreviousMs":800,"workerId":"E","candidateId":"5589eb0cb6e51ddb891ffe17f5b7b8d0a3acbbd46ee68a9d8fe68832504154c3","wave":"WAVE_1","attemptId":"core-E-official-5","state":"REJECTED"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:10.097Z","elapsedMs":1484154,"sincePreviousMs":196,"seq":18,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_RESPONSE_COMPLETED","at":"2026-09-28T00:00:10.289Z","elapsedMs":1484385,"sincePreviousMs":481,"workerId":"C","lane":"core","attemptType":"official","attemptId":"core-C-official-3","timingKind":"MEASURED_DURATION","eventAt":"2026-09-28T00:00:10.289Z","networkDurationMs":10377,"statusCode":409,"dispatchState":"RESPONSE_CAPTURED","failureCategory":"ONDA_HTTP_STATUS_INVALID","errorHint":"availability","responseSource":"application","responseBytes":100,"bodyShape":"80651c57074d","operation":"checkout","durationMs":10373,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":4}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_SETTLED","at":"2026-09-28T00:00:10.381Z","elapsedMs":1484438,"sincePreviousMs":284,"workerId":"C","candidateId":"0aafa30e010464e6b8a17e61980df60fbbbfb769640964ed4af67b15f6b6a09d","wave":"WAVE_1","attemptId":"core-C-official-3","state":"REJECTED"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_RESPONSE_COMPLETED","at":"2026-09-28T00:00:10.387Z","elapsedMs":1484483,"sincePreviousMs":98,"workerId":"F","lane":"core","attemptType":"official","attemptId":"core-F-official-6","timingKind":"MEASURED_DURATION","eventAt":"2026-09-28T00:00:10.387Z","networkDurationMs":10425,"statusCode":409,"dispatchState":"RESPONSE_CAPTURED","failureCategory":"ONDA_HTTP_STATUS_INVALID","errorHint":"availability","responseSource":"application","responseBytes":100,"bodyShape":"80651c57074d","operation":"checkout","durationMs":10418,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":3}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_SETTLED","at":"2026-09-28T00:00:10.443Z","elapsedMs":1484500,"sincePreviousMs":62,"workerId":"F","candidateId":"9a0e7b37cb7df37170afa84d5efeb1706016659f468b2baa5f237296291e991c","wave":"WAVE_1","attemptId":"core-F-official-6","state":"REJECTED"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_RESPONSE_COMPLETED","at":"2026-09-28T00:00:10.540Z","elapsedMs":1484636,"sincePreviousMs":153,"workerId":"A","lane":"core","attemptType":"official","attemptId":"core-A-official-1","timingKind":"MEASURED_DURATION","eventAt":"2026-09-28T00:00:10.540Z","networkDurationMs":10588,"statusCode":409,"dispatchState":"RESPONSE_CAPTURED","failureCategory":"ONDA_HTTP_STATUS_INVALID","errorHint":"availability","responseSource":"application","responseBytes":100,"bodyShape":"80651c57074d","operation":"checkout","durationMs":10585,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":2}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_SETTLED","at":"2026-09-28T00:00:10.638Z","elapsedMs":1484695,"sincePreviousMs":195,"workerId":"A","candidateId":"85746ed1a88a159960b11e0d2c8b10c708b9f33cd500ea5a2bb0850aa481b032","wave":"WAVE_1","attemptId":"core-A-official-1","state":"REJECTED"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:11.098Z","elapsedMs":1485155,"sincePreviousMs":460,"seq":19,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_RESPONSE_COMPLETED","at":"2026-09-28T00:00:12.049Z","elapsedMs":1486145,"sincePreviousMs":1509,"workerId":"D","lane":"core","attemptType":"official","attemptId":"core-D-official-4","timingKind":"MEASURED_DURATION","eventAt":"2026-09-28T00:00:12.049Z","networkDurationMs":12093,"statusCode":409,"dispatchState":"RESPONSE_CAPTURED","failureCategory":"ONDA_HTTP_STATUS_INVALID","errorHint":"availability","responseSource":"application","responseBytes":100,"bodyShape":"80651c57074d","operation":"checkout","durationMs":12089,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":1}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CHECKOUT_RESPONSE_COMPLETED","at":"2026-09-28T00:00:12.070Z","elapsedMs":1486166,"sincePreviousMs":21,"workerId":"G","lane":"core","attemptType":"official","attemptId":"core-G-official-7","timingKind":"MEASURED_DURATION","eventAt":"2026-09-28T00:00:12.070Z","networkDurationMs":12108,"statusCode":409,"dispatchState":"RESPONSE_CAPTURED","failureCategory":"ONDA_HTTP_STATUS_INVALID","errorHint":"availability","responseSource":"application","responseBytes":100,"bodyShape":"80651c57074d","operation":"checkout","durationMs":12101,"activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_SETTLED","at":"2026-09-28T00:00:12.117Z","elapsedMs":1486174,"sincePreviousMs":1019,"workerId":"D","candidateId":"5dfb38082fe0d4977a10e38c4c9206b64a97e97ea8034aa93f6a7fd699d6b59a","wave":"WAVE_1","attemptId":"core-D-official-4","state":"REJECTED"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:12.123Z","elapsedMs":1486180,"sincePreviousMs":6,"seq":20,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_SETTLED","at":"2026-09-28T00:00:12.123Z","elapsedMs":1486180,"sincePreviousMs":0,"workerId":"G","candidateId":"5caf181e63715dbd31129a673fe1b463ba7602d79cf8d96902831f4196b3baeb","wave":"WAVE_1","attemptId":"core-G-official-7","state":"REJECTED"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:13.091Z","elapsedMs":1487148,"sincePreviousMs":968,"seq":21,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:14.096Z","elapsedMs":1488153,"sincePreviousMs":1005,"seq":22,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:15.129Z","elapsedMs":1489186,"sincePreviousMs":1033,"seq":23,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:16.123Z","elapsedMs":1490180,"sincePreviousMs":994,"seq":24,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:17.119Z","elapsedMs":1491176,"sincePreviousMs":996,"seq":25,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:18.077Z","elapsedMs":1492134,"sincePreviousMs":958,"seq":26,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:19.082Z","elapsedMs":1493139,"sincePreviousMs":1005,"seq":27,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:20.110Z","elapsedMs":1494167,"sincePreviousMs":1028,"seq":28,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:21.170Z","elapsedMs":1495228,"sincePreviousMs":1061,"seq":29,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:22.106Z","elapsedMs":1496164,"sincePreviousMs":936,"seq":30,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:23.111Z","elapsedMs":1497169,"sincePreviousMs":1005,"seq":31,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:24.109Z","elapsedMs":1498166,"sincePreviousMs":997,"seq":32,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:25.107Z","elapsedMs":1499164,"sincePreviousMs":998,"seq":33,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:26.108Z","elapsedMs":1500166,"sincePreviousMs":1002,"seq":34,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:27.104Z","elapsedMs":1501162,"sincePreviousMs":996,"seq":35,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:28.101Z","elapsedMs":1502158,"sincePreviousMs":996,"seq":36,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:29.099Z","elapsedMs":1503156,"sincePreviousMs":998,"seq":37,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:30.125Z","elapsedMs":1504182,"sincePreviousMs":1026,"seq":38,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:31.091Z","elapsedMs":1505148,"sincePreviousMs":966,"seq":39,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:32.118Z","elapsedMs":1506175,"sincePreviousMs":1027,"seq":40,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:33.205Z","elapsedMs":1507262,"sincePreviousMs":1087,"seq":41,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:34.082Z","elapsedMs":1508139,"sincePreviousMs":877,"seq":42,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:35.084Z","elapsedMs":1509141,"sincePreviousMs":1002,"seq":43,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:36.143Z","elapsedMs":1510200,"sincePreviousMs":1059,"seq":44,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:37.114Z","elapsedMs":1511171,"sincePreviousMs":971,"seq":45,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:38.083Z","elapsedMs":1512140,"sincePreviousMs":969,"seq":46,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:39.114Z","elapsedMs":1513171,"sincePreviousMs":1031,"seq":47,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:40.110Z","elapsedMs":1514168,"sincePreviousMs":997,"seq":48,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:41.100Z","elapsedMs":1515158,"sincePreviousMs":990,"seq":49,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:42.104Z","elapsedMs":1516161,"sincePreviousMs":1003,"seq":50,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:43.136Z","elapsedMs":1517193,"sincePreviousMs":1032,"seq":51,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:44.107Z","elapsedMs":1518164,"sincePreviousMs":971,"seq":52,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:45.110Z","elapsedMs":1519167,"sincePreviousMs":1003,"seq":53,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:46.106Z","elapsedMs":1520163,"sincePreviousMs":996,"seq":54,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:47.109Z","elapsedMs":1521167,"sincePreviousMs":1004,"seq":55,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:48.113Z","elapsedMs":1522171,"sincePreviousMs":1004,"seq":56,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:49.117Z","elapsedMs":1523174,"sincePreviousMs":1003,"seq":57,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:50.083Z","elapsedMs":1524140,"sincePreviousMs":966,"seq":58,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:51.112Z","elapsedMs":1525170,"sincePreviousMs":1030,"seq":59,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:52.112Z","elapsedMs":1526169,"sincePreviousMs":999,"seq":60,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:53.113Z","elapsedMs":1527170,"sincePreviousMs":1001,"seq":61,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:54.112Z","elapsedMs":1528169,"sincePreviousMs":999,"seq":62,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:55.113Z","elapsedMs":1529170,"sincePreviousMs":1001,"seq":63,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:56.113Z","elapsedMs":1530170,"sincePreviousMs":1000,"seq":64,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:57.116Z","elapsedMs":1531173,"sincePreviousMs":1003,"seq":65,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:58.144Z","elapsedMs":1532202,"sincePreviousMs":1029,"seq":66,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:00:59.110Z","elapsedMs":1533167,"sincePreviousMs":965,"seq":67,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:01:00.105Z","elapsedMs":1534162,"sincePreviousMs":995,"seq":68,"fitness":"FAILED","cache":"UNKNOWN"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:01:05.179Z","elapsedMs":1539236,"sincePreviousMs":5074,"seq":69,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:01:10.199Z","elapsedMs":1544257,"sincePreviousMs":5021,"seq":70,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:01:15.187Z","elapsedMs":1549245,"sincePreviousMs":4988,"seq":71,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:01:20.221Z","elapsedMs":1554278,"sincePreviousMs":5033,"seq":72,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:01:25.206Z","elapsedMs":1559263,"sincePreviousMs":4985,"seq":73,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:01:30.199Z","elapsedMs":1564256,"sincePreviousMs":4993,"seq":74,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:01:35.194Z","elapsedMs":1569251,"sincePreviousMs":4995,"seq":75,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:01:40.209Z","elapsedMs":1574266,"sincePreviousMs":5015,"seq":76,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:01:45.196Z","elapsedMs":1579254,"sincePreviousMs":4988,"seq":77,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:01:50.223Z","elapsedMs":1584280,"sincePreviousMs":5026,"seq":78,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:01:55.173Z","elapsedMs":1589230,"sincePreviousMs":4950,"seq":79,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:02:00.205Z","elapsedMs":1594262,"sincePreviousMs":5032,"seq":80,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:02:05.199Z","elapsedMs":1599256,"sincePreviousMs":4994,"seq":81,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:02:10.204Z","elapsedMs":1604261,"sincePreviousMs":5005,"seq":82,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:02:15.159Z","elapsedMs":1609216,"sincePreviousMs":4955,"seq":83,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:02:20.210Z","elapsedMs":1614267,"sincePreviousMs":5051,"seq":84,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:02:25.203Z","elapsedMs":1619260,"sincePreviousMs":4993,"seq":85,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:02:30.188Z","elapsedMs":1624245,"sincePreviousMs":4985,"seq":86,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:02:35.192Z","elapsedMs":1629249,"sincePreviousMs":5004,"seq":87,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:02:40.232Z","elapsedMs":1634289,"sincePreviousMs":5040,"seq":88,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:02:45.174Z","elapsedMs":1639231,"sincePreviousMs":4942,"seq":89,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:02:50.207Z","elapsedMs":1644264,"sincePreviousMs":5033,"seq":90,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:02:55.208Z","elapsedMs":1649266,"sincePreviousMs":5002,"seq":91,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:03:00.198Z","elapsedMs":1654255,"sincePreviousMs":4989,"seq":92,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:03:05.220Z","elapsedMs":1659277,"sincePreviousMs":5022,"seq":93,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:03:10.217Z","elapsedMs":1664274,"sincePreviousMs":4997,"seq":94,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:03:15.188Z","elapsedMs":1669245,"sincePreviousMs":4971,"seq":95,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:03:20.205Z","elapsedMs":1674263,"sincePreviousMs":5018,"seq":96,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:03:25.187Z","elapsedMs":1679244,"sincePreviousMs":4981,"seq":97,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:03:30.204Z","elapsedMs":1684262,"sincePreviousMs":5018,"seq":98,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:03:35.192Z","elapsedMs":1689249,"sincePreviousMs":4987,"seq":99,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:03:40.202Z","elapsedMs":1694259,"sincePreviousMs":5010,"seq":100,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:03:45.191Z","elapsedMs":1699249,"sincePreviousMs":4990,"seq":101,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:03:50.198Z","elapsedMs":1704255,"sincePreviousMs":5006,"seq":102,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:03:55.209Z","elapsedMs":1709266,"sincePreviousMs":5011,"seq":103,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:04:00.223Z","elapsedMs":1714280,"sincePreviousMs":5014,"seq":104,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:04:05.203Z","elapsedMs":1719260,"sincePreviousMs":4980,"seq":105,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:04:10.187Z","elapsedMs":1724244,"sincePreviousMs":4984,"seq":106,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:04:15.187Z","elapsedMs":1729244,"sincePreviousMs":5000,"seq":107,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:04:20.200Z","elapsedMs":1734257,"sincePreviousMs":5013,"seq":108,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:04:25.219Z","elapsedMs":1739276,"sincePreviousMs":5019,"seq":109,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:04:30.210Z","elapsedMs":1744267,"sincePreviousMs":4991,"seq":110,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:04:35.202Z","elapsedMs":1749260,"sincePreviousMs":4993,"seq":111,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:04:40.191Z","elapsedMs":1754248,"sincePreviousMs":4988,"seq":112,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:04:45.194Z","elapsedMs":1759251,"sincePreviousMs":5003,"seq":113,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:04:50.183Z","elapsedMs":1764240,"sincePreviousMs":4989,"seq":114,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:04:55.198Z","elapsedMs":1769255,"sincePreviousMs":5015,"seq":115,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:05:00.180Z","elapsedMs":1774237,"sincePreviousMs":4982,"seq":116,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:05:30.206Z","elapsedMs":1804263,"sincePreviousMs":30026,"seq":117,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:06:00.197Z","elapsedMs":1834254,"sincePreviousMs":29991,"seq":118,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:06:30.187Z","elapsedMs":1864245,"sincePreviousMs":29991,"seq":119,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:07:00.200Z","elapsedMs":1894258,"sincePreviousMs":30013,"seq":120,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:07:30.198Z","elapsedMs":1924255,"sincePreviousMs":29997,"seq":121,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:08:00.187Z","elapsedMs":1954244,"sincePreviousMs":29989,"seq":122,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:08:30.214Z","elapsedMs":1984271,"sincePreviousMs":30027,"seq":123,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:09:00.203Z","elapsedMs":2014260,"sincePreviousMs":29989,"seq":124,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:09:30.225Z","elapsedMs":2044282,"sincePreviousMs":30022,"seq":125,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:09:55.197Z","elapsedMs":2069254,"sincePreviousMs":24972,"seq":126,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:09:56.129Z","elapsedMs":2070186,"sincePreviousMs":932,"seq":127,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:09:57.098Z","elapsedMs":2071155,"sincePreviousMs":969,"seq":128,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:09:58.101Z","elapsedMs":2072159,"sincePreviousMs":1004,"seq":129,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:09:59.134Z","elapsedMs":2073191,"sincePreviousMs":1032,"seq":130,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:00.103Z","elapsedMs":2074160,"sincePreviousMs":969,"seq":131,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:01.099Z","elapsedMs":2075156,"sincePreviousMs":996,"seq":132,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:02.095Z","elapsedMs":2076152,"sincePreviousMs":996,"seq":133,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:03.099Z","elapsedMs":2077156,"sincePreviousMs":1004,"seq":134,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:04.100Z","elapsedMs":2078158,"sincePreviousMs":1002,"seq":135,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:05.096Z","elapsedMs":2079154,"sincePreviousMs":996,"seq":136,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:06.128Z","elapsedMs":2080185,"sincePreviousMs":1031,"seq":137,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:07.096Z","elapsedMs":2081153,"sincePreviousMs":968,"seq":138,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:08.128Z","elapsedMs":2082185,"sincePreviousMs":1032,"seq":139,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:09.098Z","elapsedMs":2083155,"sincePreviousMs":970,"seq":140,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:10.127Z","elapsedMs":2084185,"sincePreviousMs":1030,"seq":141,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:11.096Z","elapsedMs":2085153,"sincePreviousMs":968,"seq":142,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:12.128Z","elapsedMs":2086185,"sincePreviousMs":1032,"seq":143,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:13.124Z","elapsedMs":2087181,"sincePreviousMs":996,"seq":144,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:14.148Z","elapsedMs":2088205,"sincePreviousMs":1024,"seq":145,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:15.083Z","elapsedMs":2089140,"sincePreviousMs":935,"seq":146,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:16.084Z","elapsedMs":2090142,"sincePreviousMs":1002,"seq":147,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:17.114Z","elapsedMs":2091171,"sincePreviousMs":1029,"seq":148,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:18.120Z","elapsedMs":2092177,"sincePreviousMs":1006,"seq":149,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:19.120Z","elapsedMs":2093177,"sincePreviousMs":1000,"seq":150,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:20.084Z","elapsedMs":2094141,"sincePreviousMs":964,"seq":151,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:21.083Z","elapsedMs":2095140,"sincePreviousMs":999,"seq":152,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:22.112Z","elapsedMs":2096169,"sincePreviousMs":1029,"seq":153,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:23.112Z","elapsedMs":2097169,"sincePreviousMs":1000,"seq":154,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:24.106Z","elapsedMs":2098163,"sincePreviousMs":994,"seq":155,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:25.103Z","elapsedMs":2099160,"sincePreviousMs":997,"seq":156,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:26.104Z","elapsedMs":2100161,"sincePreviousMs":1001,"seq":157,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:27.103Z","elapsedMs":2101160,"sincePreviousMs":999,"seq":158,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:28.104Z","elapsedMs":2102162,"sincePreviousMs":1002,"seq":159,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:29.099Z","elapsedMs":2103156,"sincePreviousMs":994,"seq":160,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:30.097Z","elapsedMs":2104154,"sincePreviousMs":998,"seq":161,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:31.133Z","elapsedMs":2105190,"sincePreviousMs":1036,"seq":162,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:32.102Z","elapsedMs":2106159,"sincePreviousMs":969,"seq":163,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:33.129Z","elapsedMs":2107186,"sincePreviousMs":1027,"seq":164,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:34.098Z","elapsedMs":2108156,"sincePreviousMs":970,"seq":165,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:35.128Z","elapsedMs":2109185,"sincePreviousMs":1029,"seq":166,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:36.127Z","elapsedMs":2110185,"sincePreviousMs":1000,"seq":167,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:37.133Z","elapsedMs":2111190,"sincePreviousMs":1005,"seq":168,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:38.104Z","elapsedMs":2112161,"sincePreviousMs":971,"seq":169,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:39.102Z","elapsedMs":2113159,"sincePreviousMs":998,"seq":170,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:40.101Z","elapsedMs":2114158,"sincePreviousMs":999,"seq":171,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:41.133Z","elapsedMs":2115190,"sincePreviousMs":1032,"seq":172,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:42.099Z","elapsedMs":2116156,"sincePreviousMs":966,"seq":173,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:43.131Z","elapsedMs":2117188,"sincePreviousMs":1032,"seq":174,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:44.102Z","elapsedMs":2118159,"sincePreviousMs":971,"seq":175,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:45.101Z","elapsedMs":2119159,"sincePreviousMs":1000,"seq":176,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:46.101Z","elapsedMs":2120158,"sincePreviousMs":999,"seq":177,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:47.104Z","elapsedMs":2121162,"sincePreviousMs":1004,"seq":178,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:48.109Z","elapsedMs":2122166,"sincePreviousMs":1004,"seq":179,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:49.145Z","elapsedMs":2123202,"sincePreviousMs":1036,"seq":180,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:50.110Z","elapsedMs":2124167,"sincePreviousMs":965,"seq":181,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:51.083Z","elapsedMs":2125141,"sincePreviousMs":974,"seq":182,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:52.112Z","elapsedMs":2126169,"sincePreviousMs":1028,"seq":183,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:53.108Z","elapsedMs":2127165,"sincePreviousMs":996,"seq":184,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:54.108Z","elapsedMs":2128165,"sincePreviousMs":1000,"seq":185,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:55.107Z","elapsedMs":2129164,"sincePreviousMs":999,"seq":186,"fitness":"FAILED","cache":"UNKNOWN"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:56.099Z","elapsedMs":2130156,"sincePreviousMs":992,"seq":187,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:57.129Z","elapsedMs":2131187,"sincePreviousMs":1031,"seq":188,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:58.124Z","elapsedMs":2132181,"sincePreviousMs":994,"seq":189,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:10:59.086Z","elapsedMs":2133143,"sincePreviousMs":962,"seq":190,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:11:00.120Z","elapsedMs":2134177,"sincePreviousMs":1034,"seq":191,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:11:01.080Z","elapsedMs":2135137,"sincePreviousMs":960,"seq":192,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:11:02.120Z","elapsedMs":2136177,"sincePreviousMs":1040,"seq":193,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:11:03.119Z","elapsedMs":2137176,"sincePreviousMs":999,"seq":194,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:11:04.111Z","elapsedMs":2138168,"sincePreviousMs":992,"seq":195,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:11:05.087Z","elapsedMs":2139145,"sincePreviousMs":977,"seq":196,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"STALE"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:11:30.233Z","elapsedMs":2164290,"sincePreviousMs":25145,"seq":197,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:12:00.206Z","elapsedMs":2194263,"sincePreviousMs":29973,"seq":198,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:12:30.186Z","elapsedMs":2224243,"sincePreviousMs":29980,"seq":199,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:13:00.204Z","elapsedMs":2254261,"sincePreviousMs":30018,"seq":200,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:13:30.161Z","elapsedMs":2284218,"sincePreviousMs":29957,"seq":201,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:14:00.182Z","elapsedMs":2314239,"sincePreviousMs":30021,"seq":202,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_EVIDENCE","at":"2026-09-28T00:14:30.198Z","elapsedMs":2344255,"sincePreviousMs":30016,"seq":203,"fitness":"FORENSIC_ONLY_CACHE_AGE_UNKNOWN","cache":"HIT"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"CRITICAL_PATH_SAVED","at":"2026-09-28T00:15:00.112Z","elapsedMs":2374170,"sincePreviousMs":29915,"workerCount":7,"maxPrePostMs":0.93,"maxFetchInvokedMs":1665243.78,"maxBrowserRequestStartMs":4.83,"maxRequestObservedMs":8.55}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PHASE3_OUTCOME","at":"2026-09-28T00:15:00.125Z","elapsedMs":2374183,"sincePreviousMs":13,"outcome":"ALL_REJECTED_WAITING_FOR_REOPEN","verifiedCount":0,"unknownCount":0,"attemptCount":7,"unsentCount":0}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PROVIDER_TRACE_SAVED","at":"2026-09-28T00:15:00.125Z","elapsedMs":2374182,"sincePreviousMs":888016,"status":"SUCCESS","traceCount":7,"traceComplete":7}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"FAILED","at":"2026-09-28T00:15:00.127Z","elapsedMs":2374184,"sincePreviousMs":1,"code":"ALL_REJECTED_WAITING_FOR_REOPEN"}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"PROCESS_EXIT","at":"2026-09-28T00:15:00.156Z","elapsedMs":2374213,"sincePreviousMs":29,"exitCode":1}
{"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","mode":"live","targetDate":"2026-09-30","stage":"RUN_DIAGNOSTIC_SUMMARY","at":"2026-09-28T00:15:00.117Z","elapsedMs":2374213,"sincePreviousMs":31,"timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-28T00:15:00.117Z","finalCode":"ALL_REJECTED_WAITING_FOR_REOPEN","aborted":false,"retryCount":0,"verifiedHoldCount":0,"qrHandoffCount":0,"partialHolds":false,"coreElapsedMs":132042,"slowestStages":"CHECKOUT_RESPONSE_COMPLETED:12108,CHECKOUT_RESPONSE_COMPLETED:12093,CHECKOUT_RESPONSE_COMPLETED:10588,CHECKOUT_RESPONSE_COMPLETED:10425,CHECKOUT_RESPONSE_COMPLETED:10377","absentEvidence":"availability-response,core-attempt","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":0}
```

### Appendix F — App activity log for the live run, every line

`.local/booking-runs/cc84c34b-50a6-4da6-be51-7728ffc98262.ndjson`

```json
{"type":"run-start","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","label":"full","at":"2026-09-27T23:35:25.358Z","elapsedMs":0,"deltaMs":0}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:25.358Z","text":"Run started: full · Timing log: [REDACTED_LOCAL_PATH]\\Downloads\\Thirsty Pickle Bot\\.local\\booking-runs\\cc84c34b-50a6-4da6-be51-7728ffc98262.ndjson","level":"info","elapsedMs":0,"deltaMs":0}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:25.366Z","text":"ARBITRATION_MANIFEST_CREATED · target 2026-09-30 · release 2026-09-28T00:00:00.000Z · preregistered 2026-09-27T23:35:25.305Z","level":"info","elapsedMs":8,"deltaMs":8}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:25.382Z","text":"Process started: apiRun · live","level":"info","elapsedMs":24,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:25.927Z","text":"API run started · Timing log: .local/api-booking/run-progress/e3f7de87-d1d5-4949-9ddc-4cc49529cfa7.ndjson · 2 ms total · +2 ms since prior stage","level":"info","elapsedMs":548,"deltaMs":524}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:25.935Z","text":"RUN CONFIGURATION · Progress recorded · 9 ms total · +7 ms since prior stage","level":"info","elapsedMs":564,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:26.009Z","text":"Preparing isolated Chrome · Progress recorded · 83 ms total · +74 ms since prior stage","level":"info","elapsedMs":629,"deltaMs":65}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:26.024Z","text":"Preparing isolated Chrome · Progress recorded · 99 ms total · +16 ms since prior stage","level":"info","elapsedMs":646,"deltaMs":17}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:26.039Z","text":"Preparing isolated Chrome · Progress recorded · 114 ms total · +15 ms since prior stage","level":"info","elapsedMs":663,"deltaMs":17}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:26.053Z","text":"Preparing isolated Chrome · Progress recorded · 127 ms total · +13 ms since prior stage","level":"info","elapsedMs":685,"deltaMs":22}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:26.065Z","text":"Preparing isolated Chrome · Progress recorded · 140 ms total · +13 ms since prior stage","level":"info","elapsedMs":709,"deltaMs":24}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:26.076Z","text":"Preparing isolated Chrome · Progress recorded · 151 ms total · +11 ms since prior stage","level":"info","elapsedMs":734,"deltaMs":25}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:26.088Z","text":"Preparing isolated Chrome · Progress recorded · 162 ms total · +11 ms since prior stage","level":"info","elapsedMs":760,"deltaMs":26}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.049Z","text":"API browser ready · Progress recorded · 2124 ms total · +1962 ms since prior stage","level":"info","elapsedMs":2669,"deltaMs":1910}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.049Z","text":"API browser ready · Progress recorded · 2124 ms total · +0 ms since prior stage","level":"info","elapsedMs":2693,"deltaMs":24}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.069Z","text":"API browser ready · Progress recorded · 2143 ms total · +19 ms since prior stage","level":"info","elapsedMs":2716,"deltaMs":22}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.078Z","text":"API browser ready · Progress recorded · 2152 ms total · +9 ms since prior stage","level":"info","elapsedMs":2745,"deltaMs":29}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.078Z","text":"API browser ready · Progress recorded · 2153 ms total · +1 ms since prior stage","level":"info","elapsedMs":2769,"deltaMs":25}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.080Z","text":"API browser ready · Progress recorded · 2155 ms total · +2 ms since prior stage","level":"info","elapsedMs":2794,"deltaMs":24}
{"type":"browser-ready","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.081Z","elapsedMs":2810}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.081Z","text":"API browser ready · Progress recorded · 2155 ms total · +0 ms since prior stage","level":"info","elapsedMs":2810,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.081Z","text":"BROWSER PREPARATION OUTCOME · Progress recorded · 2156 ms total · +1 ms since prior stage","level":"info","elapsedMs":2827,"deltaMs":17}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.081Z","text":"BROWSER PREPARATION OUTCOME · Progress recorded · 2156 ms total · +0 ms since prior stage","level":"info","elapsedMs":2843,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.081Z","text":"BROWSER PREPARATION OUTCOME · Progress recorded · 2156 ms total · +0 ms since prior stage","level":"info","elapsedMs":2859,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.081Z","text":"BROWSER PREPARATION OUTCOME · Progress recorded · 2156 ms total · +0 ms since prior stage","level":"info","elapsedMs":2875,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.081Z","text":"BROWSER PREPARATION OUTCOME · Progress recorded · 2156 ms total · +0 ms since prior stage","level":"info","elapsedMs":2891,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.081Z","text":"BROWSER PREPARATION OUTCOME · Progress recorded · 2156 ms total · +0 ms since prior stage","level":"info","elapsedMs":2907,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.081Z","text":"BROWSER PREPARATION OUTCOME · Progress recorded · 2156 ms total · +0 ms since prior stage","level":"info","elapsedMs":2922,"deltaMs":15}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.083Z","text":"PHASE3 AUTHORIZATION · Progress recorded · 2157 ms total · +1 ms since prior stage","level":"info","elapsedMs":2938,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.083Z","text":"PHASE3 CANDIDATE · Progress recorded · 2158 ms total · +1 ms since prior stage","level":"info","elapsedMs":2953,"deltaMs":15}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.083Z","text":"PHASE3 CANDIDATE · Progress recorded · 2158 ms total · +0 ms since prior stage","level":"info","elapsedMs":2969,"deltaMs":15}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.083Z","text":"PHASE3 CANDIDATE · Progress recorded · 2158 ms total · +0 ms since prior stage","level":"info","elapsedMs":2984,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.083Z","text":"PHASE3 CANDIDATE · Progress recorded · 2158 ms total · +0 ms since prior stage","level":"info","elapsedMs":3001,"deltaMs":17}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.083Z","text":"PHASE3 CANDIDATE · Progress recorded · 2158 ms total · +0 ms since prior stage","level":"info","elapsedMs":3017,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.083Z","text":"PHASE3 CANDIDATE · Progress recorded · 2158 ms total · +0 ms since prior stage","level":"info","elapsedMs":3033,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.083Z","text":"PHASE3 CANDIDATE · Progress recorded · 2158 ms total · +0 ms since prior stage","level":"info","elapsedMs":3049,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.083Z","text":"PHASE3 CANDIDATE · Progress recorded · 2158 ms total · +0 ms since prior stage","level":"info","elapsedMs":3064,"deltaMs":15}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.083Z","text":"PHASE3 CANDIDATE · Progress recorded · 2158 ms total · +0 ms since prior stage","level":"info","elapsedMs":3080,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.083Z","text":"PHASE3 CANDIDATE · Progress recorded · 2158 ms total · +0 ms since prior stage","level":"info","elapsedMs":3096,"deltaMs":15}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:35:28.083Z","text":"PHASE3 DIVERSIFICATION WARNING · Progress recorded · 2158 ms total · +0 ms since prior stage","level":"info","elapsedMs":3111,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:50:00.279Z","text":"Network clock refreshed · T-10M · offset 35 ms · round trip 43 ms · change 12 ms · 10 samples · spread 17.3 ms · ±21.9 ms · 874342 ms total · +872184 ms since prior stage","level":"info","elapsedMs":874888,"deltaMs":871776}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:58:00.006Z","text":"PHASE3 WAVE1 PRICE · Progress recorded · 1354068 ms total · +479726 ms since prior stage","level":"info","elapsedMs":1354614,"deltaMs":479726}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:58:00.007Z","text":"PHASE3 WAVE1 PRICE · Progress recorded · 1354069 ms total · +1 ms since prior stage","level":"info","elapsedMs":1354632,"deltaMs":18}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:58:00.008Z","text":"PHASE3 WAVE1 PRICE · Progress recorded · 1354070 ms total · +1 ms since prior stage","level":"info","elapsedMs":1354651,"deltaMs":18}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:58:00.009Z","text":"PHASE3 WAVE1 PRICE · Progress recorded · 1354071 ms total · +1 ms since prior stage","level":"info","elapsedMs":1354667,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:58:00.010Z","text":"PHASE3 WAVE1 PRICE · Progress recorded · 1354072 ms total · +1 ms since prior stage","level":"info","elapsedMs":1354688,"deltaMs":21}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:58:00.011Z","text":"PHASE3 WAVE1 PRICE · Progress recorded · 1354073 ms total · +1 ms since prior stage","level":"info","elapsedMs":1354709,"deltaMs":21}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:58:00.011Z","text":"PHASE3 WAVE1 PRICE · Progress recorded · 1354074 ms total · +1 ms since prior stage","level":"info","elapsedMs":1354726,"deltaMs":17}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:58:00.061Z","text":"PHASE3 FROZEN · Progress recorded · 1354123 ms total · +49 ms since prior stage","level":"info","elapsedMs":1354742,"deltaMs":17}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:58:00.090Z","text":"Release offset scheduled · Worker A · Trigger −10 ms: checkout may be sent up to 10 ms before the official release time · 1354152 ms total · +29 ms since prior stage","level":"info","elapsedMs":1354759,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:58:00.090Z","text":"Release offset scheduled · Worker B · Trigger −25 ms: checkout may be sent up to 25 ms before the official release time · 1354152 ms total · +0 ms since prior stage","level":"info","elapsedMs":1354775,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:58:00.090Z","text":"Release offset scheduled · Worker C · Trigger −50 ms: checkout may be sent up to 50 ms before the official release time · 1354152 ms total · +0 ms since prior stage","level":"info","elapsedMs":1354791,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:58:00.090Z","text":"Release offset scheduled · Worker D · Trigger −5 ms: checkout may be sent up to 5 ms before the official release time · 1354152 ms total · +0 ms since prior stage","level":"info","elapsedMs":1354807,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:59:00.192Z","text":"Release clock consensus · T-60S · offset 39.8 ms · 10 samples · fastest round trip 42 ms · spread 8.9 ms · ±21.3 ms · change 5 ms · 1414250 ms total · +60098 ms since prior stage","level":"info","elapsedMs":1414796,"deltaMs":59989}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:59:00.299Z","text":"PHASE3 EVIDENCE · Progress recorded · 1414356 ms total · +106 ms since prior stage","level":"info","elapsedMs":1414902,"deltaMs":107}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:59:10.196Z","text":"PHASE3 EVIDENCE · Progress recorded · 1424253 ms total · +9897 ms since prior stage","level":"info","elapsedMs":1424799,"deltaMs":9896}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:59:20.203Z","text":"PHASE3 EVIDENCE · Progress recorded · 1434260 ms total · +10007 ms since prior stage","level":"info","elapsedMs":1434806,"deltaMs":10007}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:59:30.189Z","text":"Release clock consensus · T-30S · offset 39 ms · 10 samples · fastest round trip 43 ms · spread 3.5 ms · ±21.9 ms · change -0.8 ms · 1444246 ms total · +9986 ms since prior stage","level":"info","elapsedMs":1444792,"deltaMs":9986}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:59:30.194Z","text":"PHASE3 EVIDENCE · Progress recorded · 1444251 ms total · +5 ms since prior stage","level":"info","elapsedMs":1444809,"deltaMs":17}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:59:40.220Z","text":"PHASE3 EVIDENCE · Progress recorded · 1454277 ms total · +10026 ms since prior stage","level":"info","elapsedMs":1454823,"deltaMs":10014}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:59:50.183Z","text":"PHASE3 EVIDENCE · Progress recorded · 1464240 ms total · +9963 ms since prior stage","level":"info","elapsedMs":1464786,"deltaMs":9963}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:59:58.165Z","text":"PHASE3 EVIDENCE · Progress recorded · 1472222 ms total · +7982 ms since prior stage","level":"info","elapsedMs":1472776,"deltaMs":7990}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:59:59.954Z","text":"PHASE3 DISPATCH · Progress recorded · 1474012 ms total · +1790 ms since prior stage","level":"info","elapsedMs":1474557,"deltaMs":1782}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:59:59.979Z","text":"PHASE3 DISPATCH · Progress recorded · 1474036 ms total · +24 ms since prior stage","level":"info","elapsedMs":1474582,"deltaMs":24}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:59:59.994Z","text":"PHASE3 DISPATCH · Progress recorded · 1474051 ms total · +15 ms since prior stage","level":"info","elapsedMs":1474599,"deltaMs":17}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-27T23:59:59.999Z","text":"PHASE3 DISPATCH · Progress recorded · 1474056 ms total · +5 ms since prior stage","level":"info","elapsedMs":1474618,"deltaMs":18}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.003Z","text":"PHASE3 WAVE1 STARTED · Progress recorded · 1474060 ms total · +4 ms since prior stage","level":"info","elapsedMs":1474633,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.003Z","text":"PHASE3 WAVE1 STARTED · Progress recorded · 1474060 ms total · +0 ms since prior stage","level":"info","elapsedMs":1474650,"deltaMs":17}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.004Z","text":"PHASE3 WAVE1 STARTED · Progress recorded · 1474061 ms total · +1 ms since prior stage","level":"info","elapsedMs":1474667,"deltaMs":17}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.004Z","text":"PHASE3 WAVE1 STARTED · Progress recorded · 1474061 ms total · +0 ms since prior stage","level":"info","elapsedMs":1474682,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.004Z","text":"PHASE3 WAVE1 STARTED · Progress recorded · 1474061 ms total · +0 ms since prior stage","level":"info","elapsedMs":1474700,"deltaMs":17}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.004Z","text":"PHASE3 WAVE1 STARTED · Progress recorded · 1474061 ms total · +0 ms since prior stage","level":"info","elapsedMs":1474716,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.004Z","text":"PHASE3 WAVE1 STARTED · Progress recorded · 1474061 ms total · +0 ms since prior stage","level":"info","elapsedMs":1474732,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.008Z","text":"PHASE3 DISPATCH · Progress recorded · 1474066 ms total · +5 ms since prior stage","level":"info","elapsedMs":1474749,"deltaMs":17}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.009Z","text":"PHASE3 DISPATCH · Progress recorded · 1474066 ms total · +0 ms since prior stage","level":"info","elapsedMs":1474765,"deltaMs":17}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.009Z","text":"PHASE3 DISPATCH · Progress recorded · 1474066 ms total · +0 ms since prior stage","level":"info","elapsedMs":1474782,"deltaMs":17}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.294Z","text":"PHASE3 EVIDENCE · Progress recorded · 1474351 ms total · +285 ms since prior stage","level":"info","elapsedMs":1474897,"deltaMs":115}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.417Z","text":"PHASE3 EVIDENCE · Progress recorded · 1474475 ms total · +124 ms since prior stage","level":"info","elapsedMs":1475028,"deltaMs":131}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:00.611Z","text":"PHASE3 EVIDENCE · Progress recorded · 1474668 ms total · +193 ms since prior stage","level":"info","elapsedMs":1475214,"deltaMs":186}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:01.114Z","text":"PHASE3 EVIDENCE · Progress recorded · 1475171 ms total · +503 ms since prior stage","level":"info","elapsedMs":1475717,"deltaMs":503}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:02.111Z","text":"PHASE3 EVIDENCE · Progress recorded · 1476168 ms total · +997 ms since prior stage","level":"info","elapsedMs":1476714,"deltaMs":997}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:05.100Z","text":"PHASE3 EVIDENCE · Progress recorded · 1479158 ms total · +2990 ms since prior stage","level":"info","elapsedMs":1479703,"deltaMs":2990}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:06.128Z","text":"PHASE3 EVIDENCE · Progress recorded · 1480185 ms total · +1027 ms since prior stage","level":"info","elapsedMs":1480731,"deltaMs":1028}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:07.130Z","text":"PHASE3 EVIDENCE · Progress recorded · 1481187 ms total · +1002 ms since prior stage","level":"info","elapsedMs":1481733,"deltaMs":1002}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:08.079Z","text":"PHASE3 SETTLED · Progress recorded · 1482136 ms total · +949 ms since prior stage","level":"info","elapsedMs":1482682,"deltaMs":949}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:08.132Z","text":"PHASE3 EVIDENCE · Progress recorded · 1482189 ms total · +53 ms since prior stage","level":"info","elapsedMs":1482735,"deltaMs":52}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:09.101Z","text":"PHASE3 EVIDENCE · Progress recorded · 1483158 ms total · +969 ms since prior stage","level":"info","elapsedMs":1483704,"deltaMs":969}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:09.901Z","text":"PHASE3 SETTLED · Progress recorded · 1483958 ms total · +800 ms since prior stage","level":"info","elapsedMs":1484504,"deltaMs":800}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:10.097Z","text":"PHASE3 EVIDENCE · Progress recorded · 1484154 ms total · +196 ms since prior stage","level":"info","elapsedMs":1484700,"deltaMs":196}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:10.381Z","text":"PHASE3 SETTLED · Progress recorded · 1484438 ms total · +284 ms since prior stage","level":"info","elapsedMs":1484984,"deltaMs":284}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:10.443Z","text":"PHASE3 SETTLED · Progress recorded · 1484500 ms total · +62 ms since prior stage","level":"info","elapsedMs":1485046,"deltaMs":61}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:10.638Z","text":"PHASE3 SETTLED · Progress recorded · 1484695 ms total · +195 ms since prior stage","level":"info","elapsedMs":1485241,"deltaMs":196}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:11.098Z","text":"PHASE3 EVIDENCE · Progress recorded · 1485155 ms total · +460 ms since prior stage","level":"info","elapsedMs":1485701,"deltaMs":460}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:12.117Z","text":"PHASE3 SETTLED · Progress recorded · 1486174 ms total · +1019 ms since prior stage","level":"info","elapsedMs":1486720,"deltaMs":1019}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:12.123Z","text":"PHASE3 EVIDENCE · Progress recorded · 1486180 ms total · +6 ms since prior stage","level":"info","elapsedMs":1486737,"deltaMs":17}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:12.123Z","text":"PHASE3 SETTLED · Progress recorded · 1486180 ms total · +0 ms since prior stage","level":"info","elapsedMs":1486753,"deltaMs":16}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:13.091Z","text":"PHASE3 EVIDENCE · Progress recorded · 1487148 ms total · +968 ms since prior stage","level":"info","elapsedMs":1487702,"deltaMs":949}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:14.096Z","text":"PHASE3 EVIDENCE · Progress recorded · 1488153 ms total · +1005 ms since prior stage","level":"info","elapsedMs":1488707,"deltaMs":1004}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:15.129Z","text":"PHASE3 EVIDENCE · Progress recorded · 1489186 ms total · +1033 ms since prior stage","level":"info","elapsedMs":1489732,"deltaMs":1025}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:16.123Z","text":"PHASE3 EVIDENCE · Progress recorded · 1490180 ms total · +994 ms since prior stage","level":"info","elapsedMs":1490726,"deltaMs":994}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:17.119Z","text":"PHASE3 EVIDENCE · Progress recorded · 1491176 ms total · +996 ms since prior stage","level":"info","elapsedMs":1491722,"deltaMs":996}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:18.077Z","text":"PHASE3 EVIDENCE · Progress recorded · 1492134 ms total · +958 ms since prior stage","level":"info","elapsedMs":1492690,"deltaMs":968}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:19.082Z","text":"PHASE3 EVIDENCE · Progress recorded · 1493139 ms total · +1005 ms since prior stage","level":"info","elapsedMs":1493687,"deltaMs":997}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:20.110Z","text":"PHASE3 EVIDENCE · Progress recorded · 1494167 ms total · +1028 ms since prior stage","level":"info","elapsedMs":1494713,"deltaMs":1026}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:21.170Z","text":"PHASE3 EVIDENCE · Progress recorded · 1495228 ms total · +1061 ms since prior stage","level":"info","elapsedMs":1495773,"deltaMs":1061}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:22.106Z","text":"PHASE3 EVIDENCE · Progress recorded · 1496164 ms total · +936 ms since prior stage","level":"info","elapsedMs":1496709,"deltaMs":936}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:23.111Z","text":"PHASE3 EVIDENCE · Progress recorded · 1497169 ms total · +1005 ms since prior stage","level":"info","elapsedMs":1497714,"deltaMs":1005}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:24.109Z","text":"PHASE3 EVIDENCE · Progress recorded · 1498166 ms total · +997 ms since prior stage","level":"info","elapsedMs":1498714,"deltaMs":1000}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:25.107Z","text":"PHASE3 EVIDENCE · Progress recorded · 1499164 ms total · +998 ms since prior stage","level":"info","elapsedMs":1499710,"deltaMs":996}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:26.108Z","text":"PHASE3 EVIDENCE · Progress recorded · 1500166 ms total · +1002 ms since prior stage","level":"info","elapsedMs":1500711,"deltaMs":1001}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:27.104Z","text":"PHASE3 EVIDENCE · Progress recorded · 1501162 ms total · +996 ms since prior stage","level":"info","elapsedMs":1501708,"deltaMs":997}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:28.101Z","text":"PHASE3 EVIDENCE · Progress recorded · 1502158 ms total · +996 ms since prior stage","level":"info","elapsedMs":1502704,"deltaMs":996}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:29.099Z","text":"PHASE3 EVIDENCE · Progress recorded · 1503156 ms total · +998 ms since prior stage","level":"info","elapsedMs":1503702,"deltaMs":997}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:30.125Z","text":"PHASE3 EVIDENCE · Progress recorded · 1504182 ms total · +1026 ms since prior stage","level":"info","elapsedMs":1504728,"deltaMs":1026}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:31.091Z","text":"PHASE3 EVIDENCE · Progress recorded · 1505148 ms total · +966 ms since prior stage","level":"info","elapsedMs":1505704,"deltaMs":977}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:32.118Z","text":"PHASE3 EVIDENCE · Progress recorded · 1506175 ms total · +1027 ms since prior stage","level":"info","elapsedMs":1506721,"deltaMs":1016}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:33.205Z","text":"PHASE3 EVIDENCE · Progress recorded · 1507262 ms total · +1087 ms since prior stage","level":"info","elapsedMs":1507817,"deltaMs":1097}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:34.082Z","text":"PHASE3 EVIDENCE · Progress recorded · 1508139 ms total · +877 ms since prior stage","level":"info","elapsedMs":1508694,"deltaMs":877}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:35.084Z","text":"PHASE3 EVIDENCE · Progress recorded · 1509141 ms total · +1002 ms since prior stage","level":"info","elapsedMs":1509691,"deltaMs":996}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:36.143Z","text":"PHASE3 EVIDENCE · Progress recorded · 1510200 ms total · +1059 ms since prior stage","level":"info","elapsedMs":1510746,"deltaMs":1056}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:37.114Z","text":"PHASE3 EVIDENCE · Progress recorded · 1511171 ms total · +971 ms since prior stage","level":"info","elapsedMs":1511717,"deltaMs":971}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:38.083Z","text":"PHASE3 EVIDENCE · Progress recorded · 1512140 ms total · +969 ms since prior stage","level":"info","elapsedMs":1512694,"deltaMs":977}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:39.114Z","text":"PHASE3 EVIDENCE · Progress recorded · 1513171 ms total · +1031 ms since prior stage","level":"info","elapsedMs":1513717,"deltaMs":1023}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:40.110Z","text":"PHASE3 EVIDENCE · Progress recorded · 1514168 ms total · +997 ms since prior stage","level":"info","elapsedMs":1514715,"deltaMs":998}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:41.100Z","text":"PHASE3 EVIDENCE · Progress recorded · 1515158 ms total · +990 ms since prior stage","level":"info","elapsedMs":1515716,"deltaMs":1001}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:42.104Z","text":"PHASE3 EVIDENCE · Progress recorded · 1516161 ms total · +1003 ms since prior stage","level":"info","elapsedMs":1516715,"deltaMs":1000}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:43.136Z","text":"PHASE3 EVIDENCE · Progress recorded · 1517193 ms total · +1032 ms since prior stage","level":"info","elapsedMs":1517739,"deltaMs":1024}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:44.107Z","text":"PHASE3 EVIDENCE · Progress recorded · 1518164 ms total · +971 ms since prior stage","level":"info","elapsedMs":1518710,"deltaMs":971}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:45.110Z","text":"PHASE3 EVIDENCE · Progress recorded · 1519167 ms total · +1003 ms since prior stage","level":"info","elapsedMs":1519713,"deltaMs":1003}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:46.106Z","text":"PHASE3 EVIDENCE · Progress recorded · 1520163 ms total · +996 ms since prior stage","level":"info","elapsedMs":1520720,"deltaMs":1007}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:47.109Z","text":"PHASE3 EVIDENCE · Progress recorded · 1521167 ms total · +1004 ms since prior stage","level":"info","elapsedMs":1521721,"deltaMs":1000}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:48.113Z","text":"PHASE3 EVIDENCE · Progress recorded · 1522171 ms total · +1004 ms since prior stage","level":"info","elapsedMs":1522717,"deltaMs":996}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:49.117Z","text":"PHASE3 EVIDENCE · Progress recorded · 1523174 ms total · +1003 ms since prior stage","level":"info","elapsedMs":1523720,"deltaMs":1003}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:50.083Z","text":"PHASE3 EVIDENCE · Progress recorded · 1524140 ms total · +966 ms since prior stage","level":"info","elapsedMs":1524689,"deltaMs":969}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:51.112Z","text":"PHASE3 EVIDENCE · Progress recorded · 1525170 ms total · +1030 ms since prior stage","level":"info","elapsedMs":1525715,"deltaMs":1026}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:52.112Z","text":"PHASE3 EVIDENCE · Progress recorded · 1526169 ms total · +999 ms since prior stage","level":"info","elapsedMs":1526715,"deltaMs":999}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:53.113Z","text":"PHASE3 EVIDENCE · Progress recorded · 1527170 ms total · +1001 ms since prior stage","level":"info","elapsedMs":1527718,"deltaMs":1003}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:54.112Z","text":"PHASE3 EVIDENCE · Progress recorded · 1528169 ms total · +999 ms since prior stage","level":"info","elapsedMs":1528715,"deltaMs":997}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:55.113Z","text":"PHASE3 EVIDENCE · Progress recorded · 1529170 ms total · +1001 ms since prior stage","level":"info","elapsedMs":1529716,"deltaMs":1001}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:56.113Z","text":"PHASE3 EVIDENCE · Progress recorded · 1530170 ms total · +1000 ms since prior stage","level":"info","elapsedMs":1530725,"deltaMs":1009}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:57.116Z","text":"PHASE3 EVIDENCE · Progress recorded · 1531173 ms total · +1003 ms since prior stage","level":"info","elapsedMs":1531719,"deltaMs":994}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:58.144Z","text":"PHASE3 EVIDENCE · Progress recorded · 1532202 ms total · +1029 ms since prior stage","level":"info","elapsedMs":1532748,"deltaMs":1029}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:00:59.110Z","text":"PHASE3 EVIDENCE · Progress recorded · 1533167 ms total · +965 ms since prior stage","level":"info","elapsedMs":1533713,"deltaMs":965}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:01:00.105Z","text":"PHASE3 EVIDENCE · Progress recorded · 1534162 ms total · +995 ms since prior stage","level":"info","elapsedMs":1534708,"deltaMs":995}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:01:05.179Z","text":"PHASE3 EVIDENCE · Progress recorded · 1539236 ms total · +5074 ms since prior stage","level":"info","elapsedMs":1539786,"deltaMs":5079}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:01:10.199Z","text":"PHASE3 EVIDENCE · Progress recorded · 1544257 ms total · +5021 ms since prior stage","level":"info","elapsedMs":1544802,"deltaMs":5016}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:01:15.187Z","text":"PHASE3 EVIDENCE · Progress recorded · 1549245 ms total · +4988 ms since prior stage","level":"info","elapsedMs":1549790,"deltaMs":4988}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:01:20.221Z","text":"PHASE3 EVIDENCE · Progress recorded · 1554278 ms total · +5033 ms since prior stage","level":"info","elapsedMs":1554824,"deltaMs":5033}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:01:25.206Z","text":"PHASE3 EVIDENCE · Progress recorded · 1559263 ms total · +4985 ms since prior stage","level":"info","elapsedMs":1559810,"deltaMs":4986}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:01:30.199Z","text":"PHASE3 EVIDENCE · Progress recorded · 1564256 ms total · +4993 ms since prior stage","level":"info","elapsedMs":1564802,"deltaMs":4992}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:01:35.194Z","text":"PHASE3 EVIDENCE · Progress recorded · 1569251 ms total · +4995 ms since prior stage","level":"info","elapsedMs":1569797,"deltaMs":4996}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:01:40.209Z","text":"PHASE3 EVIDENCE · Progress recorded · 1574266 ms total · +5015 ms since prior stage","level":"info","elapsedMs":1574812,"deltaMs":5015}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:01:45.196Z","text":"PHASE3 EVIDENCE · Progress recorded · 1579254 ms total · +4988 ms since prior stage","level":"info","elapsedMs":1579799,"deltaMs":4987}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:01:50.223Z","text":"PHASE3 EVIDENCE · Progress recorded · 1584280 ms total · +5026 ms since prior stage","level":"info","elapsedMs":1584826,"deltaMs":5026}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:01:55.173Z","text":"PHASE3 EVIDENCE · Progress recorded · 1589230 ms total · +4950 ms since prior stage","level":"info","elapsedMs":1589787,"deltaMs":4962}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:02:00.205Z","text":"PHASE3 EVIDENCE · Progress recorded · 1594262 ms total · +5032 ms since prior stage","level":"info","elapsedMs":1594808,"deltaMs":5020}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:02:05.199Z","text":"PHASE3 EVIDENCE · Progress recorded · 1599256 ms total · +4994 ms since prior stage","level":"info","elapsedMs":1599802,"deltaMs":4994}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:02:10.204Z","text":"PHASE3 EVIDENCE · Progress recorded · 1604261 ms total · +5005 ms since prior stage","level":"info","elapsedMs":1604807,"deltaMs":5005}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:02:15.159Z","text":"PHASE3 EVIDENCE · Progress recorded · 1609216 ms total · +4955 ms since prior stage","level":"info","elapsedMs":1609779,"deltaMs":4972}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:02:20.210Z","text":"PHASE3 EVIDENCE · Progress recorded · 1614267 ms total · +5051 ms since prior stage","level":"info","elapsedMs":1614813,"deltaMs":5034}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:02:25.203Z","text":"PHASE3 EVIDENCE · Progress recorded · 1619260 ms total · +4993 ms since prior stage","level":"info","elapsedMs":1619806,"deltaMs":4993}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:02:30.188Z","text":"PHASE3 EVIDENCE · Progress recorded · 1624245 ms total · +4985 ms since prior stage","level":"info","elapsedMs":1624791,"deltaMs":4986}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:02:35.192Z","text":"PHASE3 EVIDENCE · Progress recorded · 1629249 ms total · +5004 ms since prior stage","level":"info","elapsedMs":1629795,"deltaMs":5004}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:02:40.232Z","text":"PHASE3 EVIDENCE · Progress recorded · 1634289 ms total · +5040 ms since prior stage","level":"info","elapsedMs":1634839,"deltaMs":5044}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:02:45.174Z","text":"PHASE3 EVIDENCE · Progress recorded · 1639231 ms total · +4942 ms since prior stage","level":"info","elapsedMs":1639796,"deltaMs":4957}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:02:50.207Z","text":"PHASE3 EVIDENCE · Progress recorded · 1644264 ms total · +5033 ms since prior stage","level":"info","elapsedMs":1644810,"deltaMs":5014}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:02:55.208Z","text":"PHASE3 EVIDENCE · Progress recorded · 1649266 ms total · +5002 ms since prior stage","level":"info","elapsedMs":1649811,"deltaMs":5001}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:03:00.198Z","text":"PHASE3 EVIDENCE · Progress recorded · 1654255 ms total · +4989 ms since prior stage","level":"info","elapsedMs":1654802,"deltaMs":4991}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:03:05.220Z","text":"PHASE3 EVIDENCE · Progress recorded · 1659277 ms total · +5022 ms since prior stage","level":"info","elapsedMs":1659826,"deltaMs":5024}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:03:10.217Z","text":"PHASE3 EVIDENCE · Progress recorded · 1664274 ms total · +4997 ms since prior stage","level":"info","elapsedMs":1664820,"deltaMs":4994}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:03:15.188Z","text":"PHASE3 EVIDENCE · Progress recorded · 1669245 ms total · +4971 ms since prior stage","level":"info","elapsedMs":1669796,"deltaMs":4976}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:03:20.205Z","text":"PHASE3 EVIDENCE · Progress recorded · 1674263 ms total · +5018 ms since prior stage","level":"info","elapsedMs":1674809,"deltaMs":5012}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:03:25.187Z","text":"PHASE3 EVIDENCE · Progress recorded · 1679244 ms total · +4981 ms since prior stage","level":"info","elapsedMs":1679795,"deltaMs":4987}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:03:30.204Z","text":"PHASE3 EVIDENCE · Progress recorded · 1684262 ms total · +5018 ms since prior stage","level":"info","elapsedMs":1684808,"deltaMs":5012}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:03:35.192Z","text":"PHASE3 EVIDENCE · Progress recorded · 1689249 ms total · +4987 ms since prior stage","level":"info","elapsedMs":1689797,"deltaMs":4990}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:03:40.202Z","text":"PHASE3 EVIDENCE · Progress recorded · 1694259 ms total · +5010 ms since prior stage","level":"info","elapsedMs":1694805,"deltaMs":5008}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:03:45.191Z","text":"PHASE3 EVIDENCE · Progress recorded · 1699249 ms total · +4990 ms since prior stage","level":"info","elapsedMs":1699799,"deltaMs":4994}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:03:50.198Z","text":"PHASE3 EVIDENCE · Progress recorded · 1704255 ms total · +5006 ms since prior stage","level":"info","elapsedMs":1704801,"deltaMs":5002}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:03:55.209Z","text":"PHASE3 EVIDENCE · Progress recorded · 1709266 ms total · +5011 ms since prior stage","level":"info","elapsedMs":1709812,"deltaMs":5011}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:04:00.223Z","text":"PHASE3 EVIDENCE · Progress recorded · 1714280 ms total · +5014 ms since prior stage","level":"info","elapsedMs":1714826,"deltaMs":5014}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:04:05.203Z","text":"PHASE3 EVIDENCE · Progress recorded · 1719260 ms total · +4980 ms since prior stage","level":"info","elapsedMs":1719818,"deltaMs":4992}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:04:10.187Z","text":"PHASE3 EVIDENCE · Progress recorded · 1724244 ms total · +4984 ms since prior stage","level":"info","elapsedMs":1724801,"deltaMs":4984}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:04:15.187Z","text":"PHASE3 EVIDENCE · Progress recorded · 1729244 ms total · +5000 ms since prior stage","level":"info","elapsedMs":1729795,"deltaMs":4994}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:04:20.200Z","text":"PHASE3 EVIDENCE · Progress recorded · 1734257 ms total · +5013 ms since prior stage","level":"info","elapsedMs":1734803,"deltaMs":5008}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:04:25.219Z","text":"PHASE3 EVIDENCE · Progress recorded · 1739276 ms total · +5019 ms since prior stage","level":"info","elapsedMs":1739822,"deltaMs":5019}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:04:30.210Z","text":"PHASE3 EVIDENCE · Progress recorded · 1744267 ms total · +4991 ms since prior stage","level":"info","elapsedMs":1744813,"deltaMs":4990}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:04:35.202Z","text":"PHASE3 EVIDENCE · Progress recorded · 1749260 ms total · +4993 ms since prior stage","level":"info","elapsedMs":1749805,"deltaMs":4993}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:04:40.191Z","text":"PHASE3 EVIDENCE · Progress recorded · 1754248 ms total · +4988 ms since prior stage","level":"info","elapsedMs":1754798,"deltaMs":4993}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:04:45.194Z","text":"PHASE3 EVIDENCE · Progress recorded · 1759251 ms total · +5003 ms since prior stage","level":"info","elapsedMs":1759797,"deltaMs":4998}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:04:50.183Z","text":"PHASE3 EVIDENCE · Progress recorded · 1764240 ms total · +4989 ms since prior stage","level":"info","elapsedMs":1764790,"deltaMs":4994}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:04:55.198Z","text":"PHASE3 EVIDENCE · Progress recorded · 1769255 ms total · +5015 ms since prior stage","level":"info","elapsedMs":1769812,"deltaMs":5022}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:05:00.180Z","text":"PHASE3 EVIDENCE · Progress recorded · 1774237 ms total · +4982 ms since prior stage","level":"info","elapsedMs":1774794,"deltaMs":4982}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:05:30.206Z","text":"PHASE3 EVIDENCE · Progress recorded · 1804263 ms total · +30026 ms since prior stage","level":"info","elapsedMs":1804809,"deltaMs":30015}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:06:00.197Z","text":"PHASE3 EVIDENCE · Progress recorded · 1834254 ms total · +29991 ms since prior stage","level":"info","elapsedMs":1834800,"deltaMs":29991}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:06:30.187Z","text":"PHASE3 EVIDENCE · Progress recorded · 1864245 ms total · +29991 ms since prior stage","level":"info","elapsedMs":1864809,"deltaMs":30009}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:07:00.200Z","text":"PHASE3 EVIDENCE · Progress recorded · 1894258 ms total · +30013 ms since prior stage","level":"info","elapsedMs":1894811,"deltaMs":30003}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:07:30.198Z","text":"PHASE3 EVIDENCE · Progress recorded · 1924255 ms total · +29997 ms since prior stage","level":"info","elapsedMs":1924801,"deltaMs":29990}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:08:00.187Z","text":"PHASE3 EVIDENCE · Progress recorded · 1954244 ms total · +29989 ms since prior stage","level":"info","elapsedMs":1954810,"deltaMs":30009}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:08:30.214Z","text":"PHASE3 EVIDENCE · Progress recorded · 1984271 ms total · +30027 ms since prior stage","level":"info","elapsedMs":1984828,"deltaMs":30018}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:09:00.203Z","text":"PHASE3 EVIDENCE · Progress recorded · 2014260 ms total · +29989 ms since prior stage","level":"info","elapsedMs":2014806,"deltaMs":29978}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:09:30.225Z","text":"PHASE3 EVIDENCE · Progress recorded · 2044282 ms total · +30022 ms since prior stage","level":"info","elapsedMs":2044828,"deltaMs":30022}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:09:55.197Z","text":"PHASE3 EVIDENCE · Progress recorded · 2069254 ms total · +24972 ms since prior stage","level":"info","elapsedMs":2069800,"deltaMs":24972}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:09:56.129Z","text":"PHASE3 EVIDENCE · Progress recorded · 2070186 ms total · +932 ms since prior stage","level":"info","elapsedMs":2070732,"deltaMs":932}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:09:57.098Z","text":"PHASE3 EVIDENCE · Progress recorded · 2071155 ms total · +969 ms since prior stage","level":"info","elapsedMs":2071701,"deltaMs":969}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:09:58.101Z","text":"PHASE3 EVIDENCE · Progress recorded · 2072159 ms total · +1004 ms since prior stage","level":"info","elapsedMs":2072709,"deltaMs":1008}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:09:59.134Z","text":"PHASE3 EVIDENCE · Progress recorded · 2073191 ms total · +1032 ms since prior stage","level":"info","elapsedMs":2073737,"deltaMs":1028}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:00.103Z","text":"PHASE3 EVIDENCE · Progress recorded · 2074160 ms total · +969 ms since prior stage","level":"info","elapsedMs":2074715,"deltaMs":978}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:01.099Z","text":"PHASE3 EVIDENCE · Progress recorded · 2075156 ms total · +996 ms since prior stage","level":"info","elapsedMs":2075709,"deltaMs":994}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:02.095Z","text":"PHASE3 EVIDENCE · Progress recorded · 2076152 ms total · +996 ms since prior stage","level":"info","elapsedMs":2076719,"deltaMs":1010}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:03.099Z","text":"PHASE3 EVIDENCE · Progress recorded · 2077156 ms total · +1004 ms since prior stage","level":"info","elapsedMs":2077702,"deltaMs":983}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:04.100Z","text":"PHASE3 EVIDENCE · Progress recorded · 2078158 ms total · +1002 ms since prior stage","level":"info","elapsedMs":2078713,"deltaMs":1011}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:05.096Z","text":"PHASE3 EVIDENCE · Progress recorded · 2079154 ms total · +996 ms since prior stage","level":"info","elapsedMs":2079714,"deltaMs":1001}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:06.128Z","text":"PHASE3 EVIDENCE · Progress recorded · 2080185 ms total · +1031 ms since prior stage","level":"info","elapsedMs":2080731,"deltaMs":1017}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:07.096Z","text":"PHASE3 EVIDENCE · Progress recorded · 2081153 ms total · +968 ms since prior stage","level":"info","elapsedMs":2081708,"deltaMs":977}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:08.128Z","text":"PHASE3 EVIDENCE · Progress recorded · 2082185 ms total · +1032 ms since prior stage","level":"info","elapsedMs":2082731,"deltaMs":1023}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:09.098Z","text":"PHASE3 EVIDENCE · Progress recorded · 2083155 ms total · +970 ms since prior stage","level":"info","elapsedMs":2083708,"deltaMs":978}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:10.127Z","text":"PHASE3 EVIDENCE · Progress recorded · 2084185 ms total · +1030 ms since prior stage","level":"info","elapsedMs":2084731,"deltaMs":1022}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:11.096Z","text":"PHASE3 EVIDENCE · Progress recorded · 2085153 ms total · +968 ms since prior stage","level":"info","elapsedMs":2085714,"deltaMs":983}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:12.128Z","text":"PHASE3 EVIDENCE · Progress recorded · 2086185 ms total · +1032 ms since prior stage","level":"info","elapsedMs":2086735,"deltaMs":1021}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:13.124Z","text":"PHASE3 EVIDENCE · Progress recorded · 2087181 ms total · +996 ms since prior stage","level":"info","elapsedMs":2087727,"deltaMs":992}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:14.148Z","text":"PHASE3 EVIDENCE · Progress recorded · 2088205 ms total · +1024 ms since prior stage","level":"info","elapsedMs":2088751,"deltaMs":1024}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:15.083Z","text":"PHASE3 EVIDENCE · Progress recorded · 2089140 ms total · +935 ms since prior stage","level":"info","elapsedMs":2089687,"deltaMs":936}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:16.084Z","text":"PHASE3 EVIDENCE · Progress recorded · 2090142 ms total · +1002 ms since prior stage","level":"info","elapsedMs":2090689,"deltaMs":1003}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:17.114Z","text":"PHASE3 EVIDENCE · Progress recorded · 2091171 ms total · +1029 ms since prior stage","level":"info","elapsedMs":2091717,"deltaMs":1028}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:18.120Z","text":"PHASE3 EVIDENCE · Progress recorded · 2092177 ms total · +1006 ms since prior stage","level":"info","elapsedMs":2092731,"deltaMs":1014}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:19.120Z","text":"PHASE3 EVIDENCE · Progress recorded · 2093177 ms total · +1000 ms since prior stage","level":"info","elapsedMs":2093723,"deltaMs":992}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:20.084Z","text":"PHASE3 EVIDENCE · Progress recorded · 2094141 ms total · +964 ms since prior stage","level":"info","elapsedMs":2094708,"deltaMs":985}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:21.083Z","text":"PHASE3 EVIDENCE · Progress recorded · 2095140 ms total · +999 ms since prior stage","level":"info","elapsedMs":2095698,"deltaMs":990}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:22.112Z","text":"PHASE3 EVIDENCE · Progress recorded · 2096169 ms total · +1029 ms since prior stage","level":"info","elapsedMs":2096724,"deltaMs":1026}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:23.112Z","text":"PHASE3 EVIDENCE · Progress recorded · 2097169 ms total · +1000 ms since prior stage","level":"info","elapsedMs":2097718,"deltaMs":993}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:24.106Z","text":"PHASE3 EVIDENCE · Progress recorded · 2098163 ms total · +994 ms since prior stage","level":"info","elapsedMs":2098711,"deltaMs":994}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:25.103Z","text":"PHASE3 EVIDENCE · Progress recorded · 2099160 ms total · +997 ms since prior stage","level":"info","elapsedMs":2099718,"deltaMs":1007}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:26.104Z","text":"PHASE3 EVIDENCE · Progress recorded · 2100161 ms total · +1001 ms since prior stage","level":"info","elapsedMs":2100708,"deltaMs":990}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:27.103Z","text":"PHASE3 EVIDENCE · Progress recorded · 2101160 ms total · +999 ms since prior stage","level":"info","elapsedMs":2101725,"deltaMs":1017}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:28.104Z","text":"PHASE3 EVIDENCE · Progress recorded · 2102162 ms total · +1002 ms since prior stage","level":"info","elapsedMs":2102720,"deltaMs":995}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:29.099Z","text":"PHASE3 EVIDENCE · Progress recorded · 2103156 ms total · +994 ms since prior stage","level":"info","elapsedMs":2103703,"deltaMs":982}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:30.097Z","text":"PHASE3 EVIDENCE · Progress recorded · 2104154 ms total · +998 ms since prior stage","level":"info","elapsedMs":2104719,"deltaMs":1017}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:31.133Z","text":"PHASE3 EVIDENCE · Progress recorded · 2105190 ms total · +1036 ms since prior stage","level":"info","elapsedMs":2105736,"deltaMs":1017}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:32.102Z","text":"PHASE3 EVIDENCE · Progress recorded · 2106159 ms total · +969 ms since prior stage","level":"info","elapsedMs":2106706,"deltaMs":970}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:33.129Z","text":"PHASE3 EVIDENCE · Progress recorded · 2107186 ms total · +1027 ms since prior stage","level":"info","elapsedMs":2107732,"deltaMs":1025}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:34.098Z","text":"PHASE3 EVIDENCE · Progress recorded · 2108156 ms total · +970 ms since prior stage","level":"info","elapsedMs":2108707,"deltaMs":976}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:35.128Z","text":"PHASE3 EVIDENCE · Progress recorded · 2109185 ms total · +1029 ms since prior stage","level":"info","elapsedMs":2109743,"deltaMs":1036}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:36.127Z","text":"PHASE3 EVIDENCE · Progress recorded · 2110185 ms total · +1000 ms since prior stage","level":"info","elapsedMs":2110730,"deltaMs":987}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:37.133Z","text":"PHASE3 EVIDENCE · Progress recorded · 2111190 ms total · +1005 ms since prior stage","level":"info","elapsedMs":2111736,"deltaMs":1005}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:38.104Z","text":"PHASE3 EVIDENCE · Progress recorded · 2112161 ms total · +971 ms since prior stage","level":"info","elapsedMs":2112718,"deltaMs":982}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:39.102Z","text":"PHASE3 EVIDENCE · Progress recorded · 2113159 ms total · +998 ms since prior stage","level":"info","elapsedMs":2113706,"deltaMs":988}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:40.101Z","text":"PHASE3 EVIDENCE · Progress recorded · 2114158 ms total · +999 ms since prior stage","level":"info","elapsedMs":2114709,"deltaMs":1003}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:41.133Z","text":"PHASE3 EVIDENCE · Progress recorded · 2115190 ms total · +1032 ms since prior stage","level":"info","elapsedMs":2115736,"deltaMs":1027}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:42.099Z","text":"PHASE3 EVIDENCE · Progress recorded · 2116156 ms total · +966 ms since prior stage","level":"info","elapsedMs":2116702,"deltaMs":966}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:43.131Z","text":"PHASE3 EVIDENCE · Progress recorded · 2117188 ms total · +1032 ms since prior stage","level":"info","elapsedMs":2117735,"deltaMs":1033}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:44.102Z","text":"PHASE3 EVIDENCE · Progress recorded · 2118159 ms total · +971 ms since prior stage","level":"info","elapsedMs":2118721,"deltaMs":986}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:45.101Z","text":"PHASE3 EVIDENCE · Progress recorded · 2119159 ms total · +1000 ms since prior stage","level":"info","elapsedMs":2119705,"deltaMs":984}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:46.101Z","text":"PHASE3 EVIDENCE · Progress recorded · 2120158 ms total · +999 ms since prior stage","level":"info","elapsedMs":2120704,"deltaMs":999}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:47.104Z","text":"PHASE3 EVIDENCE · Progress recorded · 2121162 ms total · +1004 ms since prior stage","level":"info","elapsedMs":2121707,"deltaMs":1003}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:48.109Z","text":"PHASE3 EVIDENCE · Progress recorded · 2122166 ms total · +1004 ms since prior stage","level":"info","elapsedMs":2122724,"deltaMs":1017}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:49.145Z","text":"PHASE3 EVIDENCE · Progress recorded · 2123202 ms total · +1036 ms since prior stage","level":"info","elapsedMs":2123748,"deltaMs":1024}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:50.110Z","text":"PHASE3 EVIDENCE · Progress recorded · 2124167 ms total · +965 ms since prior stage","level":"info","elapsedMs":2124721,"deltaMs":974}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:51.083Z","text":"PHASE3 EVIDENCE · Progress recorded · 2125141 ms total · +974 ms since prior stage","level":"info","elapsedMs":2125700,"deltaMs":979}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:52.112Z","text":"PHASE3 EVIDENCE · Progress recorded · 2126169 ms total · +1028 ms since prior stage","level":"info","elapsedMs":2126722,"deltaMs":1021}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:53.108Z","text":"PHASE3 EVIDENCE · Progress recorded · 2127165 ms total · +996 ms since prior stage","level":"info","elapsedMs":2127721,"deltaMs":999}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:54.108Z","text":"PHASE3 EVIDENCE · Progress recorded · 2128165 ms total · +1000 ms since prior stage","level":"info","elapsedMs":2128714,"deltaMs":994}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:55.107Z","text":"PHASE3 EVIDENCE · Progress recorded · 2129164 ms total · +999 ms since prior stage","level":"info","elapsedMs":2129711,"deltaMs":996}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:56.099Z","text":"PHASE3 EVIDENCE · Progress recorded · 2130156 ms total · +992 ms since prior stage","level":"info","elapsedMs":2130715,"deltaMs":1004}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:57.129Z","text":"PHASE3 EVIDENCE · Progress recorded · 2131187 ms total · +1031 ms since prior stage","level":"info","elapsedMs":2131757,"deltaMs":1042}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:58.124Z","text":"PHASE3 EVIDENCE · Progress recorded · 2132181 ms total · +994 ms since prior stage","level":"info","elapsedMs":2132728,"deltaMs":970}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:10:59.086Z","text":"PHASE3 EVIDENCE · Progress recorded · 2133143 ms total · +962 ms since prior stage","level":"info","elapsedMs":2133704,"deltaMs":976}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:11:00.120Z","text":"PHASE3 EVIDENCE · Progress recorded · 2134177 ms total · +1034 ms since prior stage","level":"info","elapsedMs":2134723,"deltaMs":1019}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:11:01.080Z","text":"PHASE3 EVIDENCE · Progress recorded · 2135137 ms total · +960 ms since prior stage","level":"info","elapsedMs":2135703,"deltaMs":979}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:11:02.120Z","text":"PHASE3 EVIDENCE · Progress recorded · 2136177 ms total · +1040 ms since prior stage","level":"info","elapsedMs":2136723,"deltaMs":1020}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:11:03.119Z","text":"PHASE3 EVIDENCE · Progress recorded · 2137176 ms total · +999 ms since prior stage","level":"info","elapsedMs":2137730,"deltaMs":1007}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:11:04.111Z","text":"PHASE3 EVIDENCE · Progress recorded · 2138168 ms total · +992 ms since prior stage","level":"info","elapsedMs":2138748,"deltaMs":1018}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:11:05.087Z","text":"PHASE3 EVIDENCE · Progress recorded · 2139145 ms total · +977 ms since prior stage","level":"info","elapsedMs":2139698,"deltaMs":951}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:11:30.233Z","text":"PHASE3 EVIDENCE · Progress recorded · 2164290 ms total · +25145 ms since prior stage","level":"info","elapsedMs":2164838,"deltaMs":25140}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:12:00.206Z","text":"PHASE3 EVIDENCE · Progress recorded · 2194263 ms total · +29973 ms since prior stage","level":"info","elapsedMs":2194811,"deltaMs":29973}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:12:30.186Z","text":"PHASE3 EVIDENCE · Progress recorded · 2224243 ms total · +29980 ms since prior stage","level":"info","elapsedMs":2224806,"deltaMs":29995}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:13:00.204Z","text":"PHASE3 EVIDENCE · Progress recorded · 2254261 ms total · +30018 ms since prior stage","level":"info","elapsedMs":2254807,"deltaMs":30001}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:13:30.161Z","text":"PHASE3 EVIDENCE · Progress recorded · 2284218 ms total · +29957 ms since prior stage","level":"info","elapsedMs":2284777,"deltaMs":29970}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:14:00.182Z","text":"PHASE3 EVIDENCE · Progress recorded · 2314239 ms total · +30021 ms since prior stage","level":"info","elapsedMs":2314800,"deltaMs":30023}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:14:30.198Z","text":"PHASE3 EVIDENCE · Progress recorded · 2344255 ms total · +30016 ms since prior stage","level":"info","elapsedMs":2344801,"deltaMs":30001}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:15:00.077Z","text":"Unrecognized structured event omitted.","level":"error","elapsedMs":2374719,"deltaMs":29918}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:15:00.125Z","text":"PHASE3 OUTCOME · Progress recorded · 2374183 ms total · +13 ms since prior stage","level":"info","elapsedMs":2374738,"deltaMs":20}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:15:00.127Z","text":"API run needs attention · ALL_REJECTED_WAITING_FOR_REOPEN · 2374184 ms total · +1 ms since prior stage","level":"error","elapsedMs":2374772,"deltaMs":34}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:15:00.166Z","text":"COMMAND_FAILED","level":"error","elapsedMs":2374808,"deltaMs":35}
{"type":"activity","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:15:00.182Z","text":"Run finished: failed","level":"error","elapsedMs":2374823,"deltaMs":16}
{"type":"run-end","runId":"cc84c34b-50a6-4da6-be51-7728ffc98262","at":"2026-09-28T00:15:00.198Z","elapsedMs":2374839,"outcome":"failed","readyElapsedMs":2372029,"label":"API LIVE"}
```

### Appendix G — The other app commands this morning, every line

```json
# .local/booking-runs/21766397-9df8-4803-89dd-be6b6d964355.ndjson
{"type":"run-start","runId":"21766397-9df8-4803-89dd-be6b6d964355","label":"blockAudit","at":"2026-09-27T23:33:11.166Z","elapsedMs":0,"deltaMs":0}
{"type":"activity","runId":"21766397-9df8-4803-89dd-be6b6d964355","at":"2026-09-27T23:33:11.167Z","text":"Run started: blockAudit · Timing log: [REDACTED_LOCAL_PATH]\\Downloads\\Thirsty Pickle Bot\\.local\\booking-runs\\21766397-9df8-4803-89dd-be6b6d964355.ndjson","level":"info","elapsedMs":0,"deltaMs":0}
{"type":"activity","runId":"21766397-9df8-4803-89dd-be6b6d964355","at":"2026-09-27T23:33:11.184Z","text":"Process started: blockAudit","level":"info","elapsedMs":17,"deltaMs":16}
{"type":"activity","runId":"21766397-9df8-4803-89dd-be6b6d964355","at":"2026-09-27T23:33:13.321Z","text":"2026-09-30 · Open 0 · Blocked 0 · Unreleased 112 · Unknown 0. No hold or booking was created.","level":"info","elapsedMs":2154,"deltaMs":2137}
{"type":"activity","runId":"21766397-9df8-4803-89dd-be6b6d964355","at":"2026-09-27T23:33:13.338Z","text":"Process completed: blockAudit · exit code 0","level":"info","elapsedMs":2170,"deltaMs":17}
{"type":"activity","runId":"21766397-9df8-4803-89dd-be6b6d964355","at":"2026-09-27T23:33:13.346Z","text":"Run finished: complete","level":"info","elapsedMs":2179,"deltaMs":8}
{"type":"run-end","runId":"21766397-9df8-4803-89dd-be6b6d964355","at":"2026-09-27T23:33:13.354Z","elapsedMs":2187,"outcome":"complete","label":"blockAudit"}
# .local/booking-runs/918e4f09-1945-4936-b80d-ee79efec275e.ndjson
{"type":"run-start","runId":"918e4f09-1945-4936-b80d-ee79efec275e","label":"saving","at":"2026-09-27T23:34:44.602Z","elapsedMs":0,"deltaMs":0}
{"type":"activity","runId":"918e4f09-1945-4936-b80d-ee79efec275e","at":"2026-09-27T23:34:44.602Z","text":"Run started: saving · Timing log: [REDACTED_LOCAL_PATH]\\Downloads\\Thirsty Pickle Bot\\.local\\booking-runs\\918e4f09-1945-4936-b80d-ee79efec275e.ndjson","level":"info","elapsedMs":0,"deltaMs":0}
{"type":"activity","runId":"918e4f09-1945-4936-b80d-ee79efec275e","at":"2026-09-27T23:34:44.620Z","text":"Run finished: complete","level":"info","elapsedMs":18,"deltaMs":18}
{"type":"run-end","runId":"918e4f09-1945-4936-b80d-ee79efec275e","at":"2026-09-27T23:34:44.664Z","elapsedMs":61,"outcome":"complete","label":"saving"}
# .local/booking-runs/aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f.ndjson
{"type":"run-start","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","label":"prepare","at":"2026-09-27T23:34:52.535Z","elapsedMs":0,"deltaMs":0}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:34:52.536Z","text":"Run started: prepare · Timing log: [REDACTED_LOCAL_PATH]\\Downloads\\Thirsty Pickle Bot\\.local\\booking-runs\\aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f.ndjson","level":"info","elapsedMs":0,"deltaMs":0}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:34:52.561Z","text":"Process started: apiRun · prepare","level":"info","elapsedMs":25,"deltaMs":25}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:34:54.530Z","text":"API run started · Timing log: .local/api-booking/run-progress/66830faa-f378-4e5d-bb82-03ed7024ab0b.ndjson · 2 ms total · +2 ms since prior stage","level":"info","elapsedMs":1998,"deltaMs":1972}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:34:54.538Z","text":"RUN CONFIGURATION · Progress recorded · 10 ms total · +8 ms since prior stage","level":"info","elapsedMs":2014,"deltaMs":16}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:34:54.565Z","text":"Preparing isolated Chrome · Progress recorded · 37 ms total · +27 ms since prior stage","level":"info","elapsedMs":2031,"deltaMs":17}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:34:54.591Z","text":"Preparing isolated Chrome · Progress recorded · 62 ms total · +25 ms since prior stage","level":"info","elapsedMs":2055,"deltaMs":24}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:34:54.602Z","text":"Preparing isolated Chrome · Progress recorded · 73 ms total · +11 ms since prior stage","level":"info","elapsedMs":2072,"deltaMs":18}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:34:54.613Z","text":"Preparing isolated Chrome · Progress recorded · 84 ms total · +11 ms since prior stage","level":"info","elapsedMs":2092,"deltaMs":19}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:34:54.623Z","text":"Preparing isolated Chrome · Progress recorded · 95 ms total · +11 ms since prior stage","level":"info","elapsedMs":2110,"deltaMs":19}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:34:54.635Z","text":"Preparing isolated Chrome · Progress recorded · 107 ms total · +12 ms since prior stage","level":"info","elapsedMs":2138,"deltaMs":27}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:34:54.647Z","text":"Preparing isolated Chrome · Progress recorded · 119 ms total · +12 ms since prior stage","level":"info","elapsedMs":2166,"deltaMs":28}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:01.060Z","text":"API browser ready · Progress recorded · 6531 ms total · +6412 ms since prior stage","level":"info","elapsedMs":8524,"deltaMs":6358}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:01.165Z","text":"API browser ready · Progress recorded · 6636 ms total · +105 ms since prior stage","level":"info","elapsedMs":8629,"deltaMs":105}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:01.165Z","text":"API browser ready · Progress recorded · 6637 ms total · +1 ms since prior stage","level":"info","elapsedMs":8661,"deltaMs":33}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:01.599Z","text":"API browser ready · Progress recorded · 7071 ms total · +434 ms since prior stage","level":"info","elapsedMs":9063,"deltaMs":402}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:01.738Z","text":"API browser ready · Progress recorded · 7210 ms total · +139 ms since prior stage","level":"info","elapsedMs":9202,"deltaMs":139}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:01.827Z","text":"API browser ready · Progress recorded · 7298 ms total · +88 ms since prior stage","level":"info","elapsedMs":9294,"deltaMs":91}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:02.158Z","text":"API browser ready · Progress recorded · 7630 ms total · +332 ms since prior stage","level":"info","elapsedMs":9622,"deltaMs":328}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:02.158Z","text":"BROWSER PREPARATION OUTCOME · Progress recorded · 7630 ms total · +0 ms since prior stage","level":"info","elapsedMs":9654,"deltaMs":32}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:02.158Z","text":"BROWSER PREPARATION OUTCOME · Progress recorded · 7630 ms total · +0 ms since prior stage","level":"info","elapsedMs":9684,"deltaMs":30}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:02.158Z","text":"BROWSER PREPARATION OUTCOME · Progress recorded · 7630 ms total · +0 ms since prior stage","level":"info","elapsedMs":9716,"deltaMs":33}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:02.158Z","text":"BROWSER PREPARATION OUTCOME · Progress recorded · 7630 ms total · +0 ms since prior stage","level":"info","elapsedMs":9743,"deltaMs":27}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:02.158Z","text":"BROWSER PREPARATION OUTCOME · Progress recorded · 7630 ms total · +0 ms since prior stage","level":"info","elapsedMs":9765,"deltaMs":22}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:02.158Z","text":"BROWSER PREPARATION OUTCOME · Progress recorded · 7630 ms total · +0 ms since prior stage","level":"info","elapsedMs":9786,"deltaMs":21}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:02.158Z","text":"BROWSER PREPARATION OUTCOME · Progress recorded · 7630 ms total · +0 ms since prior stage","level":"info","elapsedMs":9811,"deltaMs":24}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:02.374Z","text":"Process completed: apiRun · prepare · exit code 0","level":"info","elapsedMs":9838,"deltaMs":27}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:02.388Z","text":"Process started: apiRun · dry","level":"info","elapsedMs":9852,"deltaMs":14}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:03.034Z","text":"API run started · Timing log: .local/api-booking/run-progress/8508e622-2219-4ed9-970c-6a2b791d73a0.ndjson · 3 ms total · +3 ms since prior stage","level":"info","elapsedMs":10499,"deltaMs":647}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:03.045Z","text":"RUN CONFIGURATION · Progress recorded · 13 ms total · +10 ms since prior stage","level":"info","elapsedMs":10521,"deltaMs":22}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:03.081Z","text":"Preparing isolated Chrome · Progress recorded · 49 ms total · +36 ms since prior stage","level":"info","elapsedMs":10546,"deltaMs":25}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:03.096Z","text":"Preparing isolated Chrome · Progress recorded · 64 ms total · +15 ms since prior stage","level":"info","elapsedMs":10565,"deltaMs":19}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:03.108Z","text":"Preparing isolated Chrome · Progress recorded · 76 ms total · +12 ms since prior stage","level":"info","elapsedMs":10588,"deltaMs":23}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:03.118Z","text":"Preparing isolated Chrome · Progress recorded · 87 ms total · +11 ms since prior stage","level":"info","elapsedMs":10618,"deltaMs":29}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:03.131Z","text":"Preparing isolated Chrome · Progress recorded · 99 ms total · +12 ms since prior stage","level":"info","elapsedMs":10647,"deltaMs":29}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:03.143Z","text":"Preparing isolated Chrome · Progress recorded · 112 ms total · +13 ms since prior stage","level":"info","elapsedMs":10676,"deltaMs":29}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:03.158Z","text":"Preparing isolated Chrome · Progress recorded · 126 ms total · +14 ms since prior stage","level":"info","elapsedMs":10707,"deltaMs":31}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.079Z","text":"API browser ready · Progress recorded · 2047 ms total · +1921 ms since prior stage","level":"info","elapsedMs":12544,"deltaMs":1837}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.081Z","text":"API browser ready · Progress recorded · 2050 ms total · +3 ms since prior stage","level":"info","elapsedMs":12569,"deltaMs":25}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.143Z","text":"API browser ready · Progress recorded · 2112 ms total · +62 ms since prior stage","level":"info","elapsedMs":12608,"deltaMs":39}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.146Z","text":"API browser ready · Progress recorded · 2115 ms total · +3 ms since prior stage","level":"info","elapsedMs":12631,"deltaMs":23}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.147Z","text":"API browser ready · Progress recorded · 2115 ms total · +0 ms since prior stage","level":"info","elapsedMs":12656,"deltaMs":25}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.166Z","text":"API browser ready · Progress recorded · 2134 ms total · +19 ms since prior stage","level":"info","elapsedMs":12674,"deltaMs":18}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.167Z","text":"API browser ready · Progress recorded · 2135 ms total · +1 ms since prior stage","level":"info","elapsedMs":12692,"deltaMs":18}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.167Z","text":"BROWSER PREPARATION OUTCOME · Progress recorded · 2135 ms total · +0 ms since prior stage","level":"info","elapsedMs":12710,"deltaMs":18}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.167Z","text":"BROWSER PREPARATION OUTCOME · Progress recorded · 2135 ms total · +0 ms since prior stage","level":"info","elapsedMs":12727,"deltaMs":18}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.167Z","text":"BROWSER PREPARATION OUTCOME · Progress recorded · 2135 ms total · +0 ms since prior stage","level":"info","elapsedMs":12744,"deltaMs":17}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.167Z","text":"BROWSER PREPARATION OUTCOME · Progress recorded · 2135 ms total · +0 ms since prior stage","level":"info","elapsedMs":12763,"deltaMs":18}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.167Z","text":"BROWSER PREPARATION OUTCOME · Progress recorded · 2135 ms total · +0 ms since prior stage","level":"info","elapsedMs":12780,"deltaMs":17}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.167Z","text":"BROWSER PREPARATION OUTCOME · Progress recorded · 2135 ms total · +0 ms since prior stage","level":"info","elapsedMs":12797,"deltaMs":18}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.167Z","text":"BROWSER PREPARATION OUTCOME · Progress recorded · 2135 ms total · +0 ms since prior stage","level":"info","elapsedMs":12815,"deltaMs":17}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.169Z","text":"PHASE3 AUTHORIZATION · Progress recorded · 2137 ms total · +2 ms since prior stage","level":"info","elapsedMs":12833,"deltaMs":18}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.169Z","text":"PHASE3 CANDIDATE · Progress recorded · 2137 ms total · +0 ms since prior stage","level":"info","elapsedMs":12851,"deltaMs":19}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.169Z","text":"PHASE3 CANDIDATE · Progress recorded · 2137 ms total · +0 ms since prior stage","level":"info","elapsedMs":12868,"deltaMs":17}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.169Z","text":"PHASE3 CANDIDATE · Progress recorded · 2137 ms total · +0 ms since prior stage","level":"info","elapsedMs":12884,"deltaMs":16}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.169Z","text":"PHASE3 CANDIDATE · Progress recorded · 2137 ms total · +0 ms since prior stage","level":"info","elapsedMs":12900,"deltaMs":16}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.169Z","text":"PHASE3 CANDIDATE · Progress recorded · 2138 ms total · +1 ms since prior stage","level":"info","elapsedMs":12916,"deltaMs":16}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.169Z","text":"PHASE3 CANDIDATE · Progress recorded · 2138 ms total · +0 ms since prior stage","level":"info","elapsedMs":12932,"deltaMs":17}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.169Z","text":"PHASE3 CANDIDATE · Progress recorded · 2138 ms total · +0 ms since prior stage","level":"info","elapsedMs":12948,"deltaMs":15}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.169Z","text":"PHASE3 CANDIDATE · Progress recorded · 2138 ms total · +0 ms since prior stage","level":"info","elapsedMs":12965,"deltaMs":17}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.169Z","text":"PHASE3 CANDIDATE · Progress recorded · 2138 ms total · +0 ms since prior stage","level":"info","elapsedMs":12982,"deltaMs":17}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.169Z","text":"PHASE3 CANDIDATE · Progress recorded · 2138 ms total · +0 ms since prior stage","level":"info","elapsedMs":12998,"deltaMs":16}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.169Z","text":"PHASE3 DIVERSIFICATION WARNING · Progress recorded · 2138 ms total · +0 ms since prior stage","level":"info","elapsedMs":13018,"deltaMs":20}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.169Z","text":"PHASE3 DRY COMPLETE · Progress recorded · 2138 ms total · +0 ms since prior stage","level":"info","elapsedMs":13035,"deltaMs":17}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.591Z","text":"Process completed: apiRun · dry · exit code 0","level":"info","elapsedMs":13055,"deltaMs":20}
{"type":"activity","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.599Z","text":"Run finished: complete","level":"info","elapsedMs":13063,"deltaMs":8}
{"type":"run-end","runId":"aa684e5c-fb28-4a7a-bdcf-3f84c2c2fd4f","at":"2026-09-27T23:35:05.613Z","elapsedMs":13077,"outcome":"complete","label":"API DRY"}
# .local/booking-runs/f486deaa-f8be-4a33-b40f-bb50fd194fb7.ndjson
{"type":"run-start","runId":"f486deaa-f8be-4a33-b40f-bb50fd194fb7","label":"closingBrowsers","at":"2026-09-28T00:21:00.381Z","elapsedMs":0,"deltaMs":0}
{"type":"activity","runId":"f486deaa-f8be-4a33-b40f-bb50fd194fb7","at":"2026-09-28T00:21:00.382Z","text":"Run started: closingBrowsers · Timing log: [REDACTED_LOCAL_PATH]\\Downloads\\Thirsty Pickle Bot\\.local\\booking-runs\\f486deaa-f8be-4a33-b40f-bb50fd194fb7.ndjson","level":"info","elapsedMs":0,"deltaMs":0}
{"type":"activity","runId":"f486deaa-f8be-4a33-b40f-bb50fd194fb7","at":"2026-09-28T00:21:12.181Z","text":"Closed 7 bot Chrome browsers (7 force-closed after not responding). Your own Chrome windows were not touched.","level":"info","elapsedMs":11800,"deltaMs":11800}
{"type":"activity","runId":"f486deaa-f8be-4a33-b40f-bb50fd194fb7","at":"2026-09-28T00:21:12.230Z","text":"Run finished: complete","level":"info","elapsedMs":11848,"deltaMs":49}
{"type":"run-end","runId":"f486deaa-f8be-4a33-b40f-bb50fd194fb7","at":"2026-09-28T00:21:12.239Z","elapsedMs":11857,"outcome":"complete","label":"closingBrowsers"}
```

### Appendix H — Prepare and dry-run runner traces, every line

```json
# .local/api-booking/run-progress/66830faa-f378-4e5d-bb82-03ed7024ab0b.ndjson
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"RUN_STARTED","at":"2026-09-27T23:34:54.530Z","elapsedMs":2,"sincePreviousMs":2}
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"RUN_CONFIGURATION","at":"2026-09-27T23:34:54.538Z","elapsedMs":10,"sincePreviousMs":8,"bookingMethod":"proofless","workerCount":7,"prewarmLeadMs":15000}
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"PREPARING_BROWSER","at":"2026-09-27T23:34:54.565Z","elapsedMs":37,"sincePreviousMs":27,"workerId":"A"}
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"PREPARING_BROWSER","at":"2026-09-27T23:34:54.591Z","elapsedMs":62,"sincePreviousMs":25,"workerId":"B"}
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"PREPARING_BROWSER","at":"2026-09-27T23:34:54.602Z","elapsedMs":73,"sincePreviousMs":11,"workerId":"C"}
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"PREPARING_BROWSER","at":"2026-09-27T23:34:54.613Z","elapsedMs":84,"sincePreviousMs":11,"workerId":"D"}
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"PREPARING_BROWSER","at":"2026-09-27T23:34:54.623Z","elapsedMs":95,"sincePreviousMs":11,"workerId":"E"}
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"PREPARING_BROWSER","at":"2026-09-27T23:34:54.635Z","elapsedMs":107,"sincePreviousMs":12,"workerId":"F"}
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"PREPARING_BROWSER","at":"2026-09-27T23:34:54.647Z","elapsedMs":119,"sincePreviousMs":12,"workerId":"G"}
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"BROWSER_READY","at":"2026-09-27T23:35:01.060Z","elapsedMs":6531,"sincePreviousMs":6412,"workerId":"D","port":19447}
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"BROWSER_READY","at":"2026-09-27T23:35:01.165Z","elapsedMs":6636,"sincePreviousMs":105,"workerId":"G","port":19450}
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"BROWSER_READY","at":"2026-09-27T23:35:01.165Z","elapsedMs":6637,"sincePreviousMs":1,"workerId":"B","port":19445}
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"BROWSER_READY","at":"2026-09-27T23:35:01.599Z","elapsedMs":7071,"sincePreviousMs":434,"workerId":"E","port":19448}
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"BROWSER_READY","at":"2026-09-27T23:35:01.738Z","elapsedMs":7210,"sincePreviousMs":139,"workerId":"A","port":19444}
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"BROWSER_READY","at":"2026-09-27T23:35:01.827Z","elapsedMs":7298,"sincePreviousMs":88,"workerId":"F","port":19449}
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"BROWSER_READY","at":"2026-09-27T23:35:02.158Z","elapsedMs":7630,"sincePreviousMs":332,"workerId":"C","port":19446}
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"BROWSER_PREPARATION_OUTCOME","at":"2026-09-27T23:35:02.158Z","elapsedMs":7630,"sincePreviousMs":0,"workerId":"A","status":"fulfilled","code":"COMPLETED"}
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"BROWSER_PREPARATION_OUTCOME","at":"2026-09-27T23:35:02.158Z","elapsedMs":7630,"sincePreviousMs":0,"workerId":"B","status":"fulfilled","code":"COMPLETED"}
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"BROWSER_PREPARATION_OUTCOME","at":"2026-09-27T23:35:02.158Z","elapsedMs":7630,"sincePreviousMs":0,"workerId":"C","status":"fulfilled","code":"COMPLETED"}
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"BROWSER_PREPARATION_OUTCOME","at":"2026-09-27T23:35:02.158Z","elapsedMs":7630,"sincePreviousMs":0,"workerId":"D","status":"fulfilled","code":"COMPLETED"}
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"BROWSER_PREPARATION_OUTCOME","at":"2026-09-27T23:35:02.158Z","elapsedMs":7630,"sincePreviousMs":0,"workerId":"E","status":"fulfilled","code":"COMPLETED"}
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"BROWSER_PREPARATION_OUTCOME","at":"2026-09-27T23:35:02.158Z","elapsedMs":7630,"sincePreviousMs":0,"workerId":"F","status":"fulfilled","code":"COMPLETED"}
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"BROWSER_PREPARATION_OUTCOME","at":"2026-09-27T23:35:02.158Z","elapsedMs":7630,"sincePreviousMs":0,"workerId":"G","status":"fulfilled","code":"COMPLETED"}
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"PROCESS_EXIT","at":"2026-09-27T23:35:02.215Z","elapsedMs":7686,"sincePreviousMs":56,"exitCode":0}
{"runId":"66830faa-f378-4e5d-bb82-03ed7024ab0b","mode":"prepare","targetDate":"2026-09-30","stage":"RUN_DIAGNOSTIC_SUMMARY","at":"2026-09-27T23:35:02.214Z","elapsedMs":7686,"sincePreviousMs":7686,"timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:35:02.214Z","finalCode":"COMPLETED","aborted":false,"retryCount":0,"verifiedHoldCount":0,"qrHandoffCount":0,"partialHolds":false,"coreElapsedMs":0,"slowestStages":"","absentEvidence":"availability-response,core-attempt","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":0}
# .local/api-booking/run-progress/8508e622-2219-4ed9-970c-6a2b791d73a0.ndjson
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"RUN_STARTED","at":"2026-09-27T23:35:03.034Z","elapsedMs":3,"sincePreviousMs":3}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"RUN_CONFIGURATION","at":"2026-09-27T23:35:03.045Z","elapsedMs":13,"sincePreviousMs":10,"bookingMethod":"proofless","workerCount":7,"prewarmLeadMs":15000}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"PREPARING_BROWSER","at":"2026-09-27T23:35:03.081Z","elapsedMs":49,"sincePreviousMs":36,"workerId":"A"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"PREPARING_BROWSER","at":"2026-09-27T23:35:03.096Z","elapsedMs":64,"sincePreviousMs":15,"workerId":"B"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"PREPARING_BROWSER","at":"2026-09-27T23:35:03.108Z","elapsedMs":76,"sincePreviousMs":12,"workerId":"C"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"PREPARING_BROWSER","at":"2026-09-27T23:35:03.118Z","elapsedMs":87,"sincePreviousMs":11,"workerId":"D"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"PREPARING_BROWSER","at":"2026-09-27T23:35:03.131Z","elapsedMs":99,"sincePreviousMs":12,"workerId":"E"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"PREPARING_BROWSER","at":"2026-09-27T23:35:03.143Z","elapsedMs":112,"sincePreviousMs":13,"workerId":"F"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"PREPARING_BROWSER","at":"2026-09-27T23:35:03.158Z","elapsedMs":126,"sincePreviousMs":14,"workerId":"G"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"BROWSER_READY","at":"2026-09-27T23:35:05.079Z","elapsedMs":2047,"sincePreviousMs":1921,"workerId":"B","port":19445}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"BROWSER_READY","at":"2026-09-27T23:35:05.081Z","elapsedMs":2050,"sincePreviousMs":3,"workerId":"A","port":19444}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"BROWSER_READY","at":"2026-09-27T23:35:05.143Z","elapsedMs":2112,"sincePreviousMs":62,"workerId":"C","port":19446}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"BROWSER_READY","at":"2026-09-27T23:35:05.146Z","elapsedMs":2115,"sincePreviousMs":3,"workerId":"F","port":19449}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"BROWSER_READY","at":"2026-09-27T23:35:05.147Z","elapsedMs":2115,"sincePreviousMs":0,"workerId":"D","port":19447}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"BROWSER_READY","at":"2026-09-27T23:35:05.166Z","elapsedMs":2134,"sincePreviousMs":19,"workerId":"G","port":19450}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"BROWSER_READY","at":"2026-09-27T23:35:05.167Z","elapsedMs":2135,"sincePreviousMs":1,"workerId":"E","port":19448}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"BROWSER_PREPARATION_OUTCOME","at":"2026-09-27T23:35:05.167Z","elapsedMs":2135,"sincePreviousMs":0,"workerId":"A","status":"fulfilled","code":"COMPLETED"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"BROWSER_PREPARATION_OUTCOME","at":"2026-09-27T23:35:05.167Z","elapsedMs":2135,"sincePreviousMs":0,"workerId":"B","status":"fulfilled","code":"COMPLETED"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"BROWSER_PREPARATION_OUTCOME","at":"2026-09-27T23:35:05.167Z","elapsedMs":2135,"sincePreviousMs":0,"workerId":"C","status":"fulfilled","code":"COMPLETED"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"BROWSER_PREPARATION_OUTCOME","at":"2026-09-27T23:35:05.167Z","elapsedMs":2135,"sincePreviousMs":0,"workerId":"D","status":"fulfilled","code":"COMPLETED"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"BROWSER_PREPARATION_OUTCOME","at":"2026-09-27T23:35:05.167Z","elapsedMs":2135,"sincePreviousMs":0,"workerId":"E","status":"fulfilled","code":"COMPLETED"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"BROWSER_PREPARATION_OUTCOME","at":"2026-09-27T23:35:05.167Z","elapsedMs":2135,"sincePreviousMs":0,"workerId":"F","status":"fulfilled","code":"COMPLETED"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"BROWSER_PREPARATION_OUTCOME","at":"2026-09-27T23:35:05.167Z","elapsedMs":2135,"sincePreviousMs":0,"workerId":"G","status":"fulfilled","code":"COMPLETED"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"PHASE3_AUTHORIZATION","at":"2026-09-27T23:35:05.169Z","elapsedMs":2137,"sincePreviousMs":2,"candidateCount":10,"wave1Count":7,"standbyCount":0,"maxWave2":0,"maxRescue":1,"maxTotal":8,"fingerprint":"[REDACTED]"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"PHASE3_CANDIDATE","at":"2026-09-27T23:35:05.169Z","elapsedMs":2137,"sincePreviousMs":0,"candidateId":"85746ed1a88a159960b11e0d2c8b10c708b9f33cd500ea5a2bb0850aa481b032","court":7,"startTime":"19:00","endTime":"22:00","durationHours":3,"priority":1,"amount":2100,"rateStatus":"VENUE_SCHEDULE","source":"current venue schedule"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"PHASE3_CANDIDATE","at":"2026-09-27T23:35:05.169Z","elapsedMs":2137,"sincePreviousMs":0,"candidateId":"9cf2c3872f8c8c5e6867a9211f3fc9e91f9903a7451380bb72b0b187da0f0fcf","court":6,"startTime":"19:00","endTime":"22:00","durationHours":3,"priority":2,"amount":2100,"rateStatus":"VENUE_SCHEDULE","source":"current venue schedule"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"PHASE3_CANDIDATE","at":"2026-09-27T23:35:05.169Z","elapsedMs":2137,"sincePreviousMs":0,"candidateId":"0aafa30e010464e6b8a17e61980df60fbbbfb769640964ed4af67b15f6b6a09d","court":5,"startTime":"19:00","endTime":"22:00","durationHours":3,"priority":3,"amount":2100,"rateStatus":"VENUE_SCHEDULE","source":"current venue schedule"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"PHASE3_CANDIDATE","at":"2026-09-27T23:35:05.169Z","elapsedMs":2137,"sincePreviousMs":0,"candidateId":"5dfb38082fe0d4977a10e38c4c9206b64a97e97ea8034aa93f6a7fd699d6b59a","court":4,"startTime":"19:00","endTime":"22:00","durationHours":3,"priority":4,"amount":2100,"rateStatus":"VENUE_SCHEDULE","source":"current venue schedule"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"PHASE3_CANDIDATE","at":"2026-09-27T23:35:05.169Z","elapsedMs":2138,"sincePreviousMs":1,"candidateId":"5589eb0cb6e51ddb891ffe17f5b7b8d0a3acbbd46ee68a9d8fe68832504154c3","court":3,"startTime":"19:00","endTime":"22:00","durationHours":3,"priority":5,"amount":2100,"rateStatus":"VENUE_SCHEDULE","source":"current venue schedule"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"PHASE3_CANDIDATE","at":"2026-09-27T23:35:05.169Z","elapsedMs":2138,"sincePreviousMs":0,"candidateId":"9a0e7b37cb7df37170afa84d5efeb1706016659f468b2baa5f237296291e991c","court":2,"startTime":"19:00","endTime":"22:00","durationHours":3,"priority":6,"amount":2100,"rateStatus":"VENUE_SCHEDULE","source":"current venue schedule"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"PHASE3_CANDIDATE","at":"2026-09-27T23:35:05.169Z","elapsedMs":2138,"sincePreviousMs":0,"candidateId":"5caf181e63715dbd31129a673fe1b463ba7602d79cf8d96902831f4196b3baeb","court":1,"startTime":"19:00","endTime":"22:00","durationHours":3,"priority":7,"amount":2100,"rateStatus":"VENUE_SCHEDULE","source":"current venue schedule"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"PHASE3_CANDIDATE","at":"2026-09-27T23:35:05.169Z","elapsedMs":2138,"sincePreviousMs":0,"candidateId":"1fb999448ad5d37123c239003c9bf868a815f0155a993fe5a513f4cb490496ce","court":3,"startTime":"20:00","endTime":"23:00","durationHours":3,"priority":8,"amount":2100,"rateStatus":"VENUE_SCHEDULE","source":"current venue schedule"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"PHASE3_CANDIDATE","at":"2026-09-27T23:35:05.169Z","elapsedMs":2138,"sincePreviousMs":0,"candidateId":"6313348273e5a5a7a8414749530e14b59d93fd784cb083ca4b582cafc0240507","court":6,"startTime":"17:00","endTime":"20:00","durationHours":3,"priority":9,"amount":2100,"rateStatus":"VENUE_SCHEDULE","source":"current venue schedule"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"PHASE3_CANDIDATE","at":"2026-09-27T23:35:05.169Z","elapsedMs":2138,"sincePreviousMs":0,"candidateId":"9e0bd2eb82da5da0f4f120d5344c535bdb77338a6ab1a03330576343969cabe2","court":6,"startTime":"20:00","endTime":"23:00","durationHours":3,"priority":10,"amount":2100,"rateStatus":"VENUE_SCHEDULE","source":"current venue schedule"}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"PHASE3_DIVERSIFICATION_WARNING","at":"2026-09-27T23:35:05.169Z","elapsedMs":2138,"sincePreviousMs":0,"message":"All 7 Wave 1 attempts share 19:00–22:00. A time-wide unavailable block would affect every attempt."}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"PHASE3_DRY_COMPLETE","at":"2026-09-27T23:35:05.169Z","elapsedMs":2138,"sincePreviousMs":0,"candidateCount":10,"wave1Count":7}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"PROCESS_EXIT","at":"2026-09-27T23:35:05.188Z","elapsedMs":2157,"sincePreviousMs":19,"exitCode":0}
{"runId":"8508e622-2219-4ed9-970c-6a2b791d73a0","mode":"dry","targetDate":"2026-09-30","stage":"RUN_DIAGNOSTIC_SUMMARY","at":"2026-09-27T23:35:05.188Z","elapsedMs":2156,"sincePreviousMs":2156,"timingKind":"EVENT_TIMESTAMP","eventAt":"2026-09-27T23:35:05.188Z","finalCode":"COMPLETED","aborted":false,"retryCount":0,"verifiedHoldCount":0,"qrHandoffCount":0,"partialHolds":false,"coreElapsedMs":0,"slowestStages":"","absentEvidence":"availability-response,core-attempt","activeAvailability":0,"activeSecurity":0,"activeSlotChecks":0,"activeCheckouts":0}
```

### Appendix I — Release forensics report, verbatim

```
RELEASE FORENSICS — run e3f7de87-d1d5-4949-9ddc-4cc49529cfa7 · target 2026-09-30 · mode live
Status: FINAL · generated 2026-09-28T00:15:00.561Z
All offsets are relative to the release instant (2026-09-28T00:00:00.000Z).

1. RELEASE CLOCK
  T-10M  offset +35.0 ms · 10 samples · RTT 43 ms · spread 17.3 ms · ±21.9 ms · used
  T-60S  offset +39.8 ms · 10 samples · RTT 42 ms · spread 8.9 ms · ±21.3 ms · used
  T-30S  offset +39.0 ms · 10 samples · RTT 43 ms · spread 3.5 ms · ±21.9 ms · used
  Observer (Slot Watch) offset at release: 34.8 ms · observer − dispatch -4.2 ms

2. POST INITIATION (browser request event)
  Worker C  −0.046 s
  Worker B  −0.021 s
  Worker A  −0.006 s
  Worker D  −0.001 s
  Worker G  +0.008 s
  Worker E  +0.009 s
  Worker F  +0.009 s
  First −0.046 s · last +0.009 s · spread 54.4 ms

3. FIRST PUBLISHED GRID (Slot Watch)
  Reads: 204 scheduled · 202 answered · 2 failed · 0 not launched · max in flight 6 · early launches +0.000 s, +0.250 s, +0.500 s, +1.000 s, +2.000 s, +5.000 s
  Last read without the date:  #13 request +5.003 s → response +5.083 s
  First read with the date:    #14 request +6.014 s → response +6.094 s · edge cache HIT, age 1 s
  Open 77 · unavailable 35 · unknown 0
         08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23   (O open, X unavailable, ? unknown)
    C1    O  O  O  O  O  O  O  O  O  X  X  X  O  X  O  O
    C2    O  O  O  O  O  O  O  O  O  O  X  O  X  X  O  O
    C3    X  X  X  X  O  O  O  O  O  X  X  X  O  X  X  O
    C4    X  X  X  X  O  O  O  O  O  X  X  O  X  O  X  O
    C5    X  X  X  X  O  O  O  O  O  O  O  X  X  X  O  O
    C6    O  O  O  O  O  O  O  O  O  O  O  X  X  O  X  O
    C7    O  O  O  O  O  O  O  O  O  O  X  O  O  O  O  O

4. TARGETS
  Phase 3 race e8c15a9d69d902f7a2f65dcf15190c78049f8451d50d06af2bcf28db205b63db · 10 authorized candidates · Wave 2 max 0 · Rescue max 1 · total max 8
  WAVE_1 · Worker C · Court 5 19:00–22:00 · candidate 0aafa30e010464e6b8a17e61980df60fbbbfb769640964ed4af67b15f6b6a09d · attempt core-C-official-3
    Observation #pre-release assignment · POST −0.046 s · REJECTED · HTTP 409
    Passive trace available · response fallback HTTP 409, server Vercel, request —
  WAVE_1 · Worker B · Court 6 19:00–22:00 · candidate 9cf2c3872f8c8c5e6867a9211f3fc9e91f9903a7451380bb72b0b187da0f0fcf · attempt core-B-official-2
    Observation #pre-release assignment · POST −0.021 s · REJECTED · HTTP 409
    Passive trace available · response fallback HTTP 409, server Vercel, request —
  WAVE_1 · Worker A · Court 7 19:00–22:00 · candidate 85746ed1a88a159960b11e0d2c8b10c708b9f33cd500ea5a2bb0850aa481b032 · attempt core-A-official-1
    Observation #pre-release assignment · POST −0.006 s · REJECTED · HTTP 409
    Passive trace available · response fallback HTTP 409, server Vercel, request —
  WAVE_1 · Worker D · Court 4 19:00–22:00 · candidate 5dfb38082fe0d4977a10e38c4c9206b64a97e97ea8034aa93f6a7fd699d6b59a · attempt core-D-official-4
    Observation #pre-release assignment · POST −0.001 s · REJECTED · HTTP 409
    Passive trace available · response fallback HTTP 409, server Vercel, request —
  WAVE_1 · Worker G · Court 1 19:00–22:00 · candidate 5caf181e63715dbd31129a673fe1b463ba7602d79cf8d96902831f4196b3baeb · attempt core-G-official-7
    Observation #pre-release assignment · POST +0.008 s · REJECTED · HTTP 409
    Passive trace available · response fallback HTTP 409, server Vercel, request —
  WAVE_1 · Worker E · Court 3 19:00–22:00 · candidate 5589eb0cb6e51ddb891ffe17f5b7b8d0a3acbbd46ee68a9d8fe68832504154c3 · attempt core-E-official-5
    Observation #pre-release assignment · POST +0.009 s · REJECTED · HTTP 409
    Passive trace available · response fallback HTTP 409, server Vercel, request —
  WAVE_1 · Worker F · Court 2 19:00–22:00 · candidate 9a0e7b37cb7df37170afa84d5efeb1706016659f468b2baa5f237296291e991c · attempt core-F-official-6
    Observation #pre-release assignment · POST +0.009 s · REJECTED · HTTP 409
    Passive trace available · response fallback HTTP 409, server Vercel, request —

  Worker A · Court 7 · 19:00–22:00 · core-A-official-1
    POST initiated:              −0.006 s
    First published state:       FULLY OPEN (19:00 open PHP 700, 20:00 open PHP 700, 21:00 open PHP 700)
      from read                  #14 request +6.014 s → response +6.094 s
      That read was requested 6.020 s after this POST; the grid at POST time was not observed.
    First fully-open read:       #14 request +6.014 s → response +6.094 s
    First unavailable read:      #24 request +16.010 s → response +16.099 s (19:00, 20:00, 21:00)
    Public booking record:       #b4 request +30.013 s → response +30.297 s (19:00, 20:00, 21:00)
    Reopened (fully open again): #137 request +606.015 s → response +606.091 s after #136 request +605.003 s → response +605.090 s
    Checkout:                    HTTP 409 · hint availability
    Response recorded by runner: +10.579 s (network duration 10,588 ms)
    Response headers:            +10.576 s
    Body complete:               +10.577 s
    Protocol / connection:       h2 · reused yes · dns — · connect — · tls — · send 0.2 ms · wait 10,581.9 ms
    Provider IDs:                x-vercel-id sin1::sin1::xmblb-1790553600017-a8cface69893 · x-request-id — · cf-ray —
    Server / cache / timing:     Vercel · x-vercel-cache MISS · server-timing —

  Worker B · Court 6 · 19:00–22:00 · core-B-official-2
    POST initiated:              −0.021 s
    First published state:       PARTIALLY UNAVAILABLE (19:00 unavailable PHP 700, 20:00 unavailable PHP 700, 21:00 open PHP 700)
      from read                  #14 request +6.014 s → response +6.094 s
      That read was requested 6.035 s after this POST; the grid at POST time was not observed.
    First fully-open read:       none observed
    First unavailable read:      #14 request +6.014 s → response +6.094 s (19:00, 20:00)
    Public booking record:       #b2 request +2.014 s → response +2.845 s (19:00, 20:00)
    Reopened (fully open again): none observed
    Checkout:                    HTTP 409 · hint availability
    Response recorded by runner: +8.066 s (network duration 8,089 ms)
    Response headers:            +8.058 s
    Body complete:               +8.059 s
    Protocol / connection:       h2 · reused yes · dns — · connect — · tls — · send 0.2 ms · wait 8,078.2 ms
    Provider IDs:                x-vercel-id sin1::sin1::4vphp-1790553600005-eea3d5a81e4f · x-request-id — · cf-ray —
    Server / cache / timing:     Vercel · x-vercel-cache MISS · server-timing —

  Worker C · Court 5 · 19:00–22:00 · core-C-official-3
    POST initiated:              −0.046 s
    First published state:       FULLY UNAVAILABLE (19:00 unavailable PHP 700, 20:00 unavailable PHP 700, 21:00 unavailable PHP 700)
      from read                  #14 request +6.014 s → response +6.094 s
      That read was requested 6.060 s after this POST; the grid at POST time was not observed.
    First fully-open read:       #74 request +90.009 s → response +90.170 s
    First unavailable read:      #14 request +6.014 s → response +6.094 s (19:00, 20:00, 21:00)
    Public booking record:       #b2 request +2.014 s → response +2.845 s (20:00)
    Reopened (fully open again): #74 request +90.009 s → response +90.170 s after #73 request +85.017 s → response +85.186 s
    Checkout:                    HTTP 409 · hint availability
    Response recorded by runner: +10.328 s (network duration 10,377 ms)
    Response headers:            +10.326 s
    Body complete:               +10.326 s
    Protocol / connection:       h2 · reused yes · dns — · connect — · tls — · send 0.2 ms · wait 10,370.9 ms
    Provider IDs:                x-vercel-id sin1::sin1::5hqz4-1790553599977-373e7e3a40f2 · x-request-id — · cf-ray —
    Server / cache / timing:     Vercel · x-vercel-cache MISS · server-timing —

  Worker D · Court 4 · 19:00–22:00 · core-D-official-4
    POST initiated:              −0.001 s
    First published state:       PARTIALLY UNAVAILABLE (19:00 open PHP 700, 20:00 unavailable PHP 700, 21:00 open PHP 700)
      from read                  #14 request +6.014 s → response +6.094 s
      That read was requested 6.015 s after this POST; the grid at POST time was not observed.
    First fully-open read:       #74 request +90.009 s → response +90.170 s
    First unavailable read:      #14 request +6.014 s → response +6.094 s (20:00)
    Public booking record:       #b3 request +10.016 s → response +10.753 s (19:00, 20:00, 21:00)
    Reopened (fully open again): #74 request +90.009 s → response +90.170 s after #73 request +85.017 s → response +85.186 s
    Checkout:                    HTTP 409 · hint availability
    Response recorded by runner: +12.088 s (network duration 12,093 ms)
    Response headers:            +12.086 s
    Body complete:               +12.086 s
    Protocol / connection:       h2 · reused yes · dns — · connect — · tls — · send 0.3 ms · wait 12,086 ms
    Provider IDs:                x-vercel-id sin1::sin1::t7sc7-1790553600025-c8c3f7635381 · x-request-id — · cf-ray —
    Server / cache / timing:     Vercel · x-vercel-cache MISS · server-timing —

  Worker E · Court 3 · 19:00–22:00 · core-E-official-5
    POST initiated:              +0.009 s
    First published state:       PARTIALLY UNAVAILABLE (19:00 unavailable PHP 700, 20:00 open PHP 700, 21:00 unavailable PHP 700)
      from read                  #14 request +6.014 s → response +6.094 s
      That read was requested 6.005 s after this POST; the grid at POST time was not observed.
    First fully-open read:       none observed
    First unavailable read:      #14 request +6.014 s → response +6.094 s (19:00, 21:00)
    Public booking record:       #b2 request +2.014 s → response +2.845 s (19:00, 21:00)
    Reopened (fully open again): none observed
    Checkout:                    HTTP 409 · hint availability
    Response recorded by runner: +9.847 s (network duration 9,846 ms)
    Response headers:            +9.845 s
    Body complete:               +9.847 s
    Protocol / connection:       h2 · reused yes · dns — · connect — · tls — · send 0.1 ms · wait 9,836.4 ms
    Provider IDs:                x-vercel-id sin1::sin1::gsvmw-1790553600027-aa378ac9fbd4 · x-request-id — · cf-ray —
    Server / cache / timing:     Vercel · x-vercel-cache MISS · server-timing —

  Worker F · Court 2 · 19:00–22:00 · core-F-official-6
    POST initiated:              +0.009 s
    First published state:       PARTIALLY UNAVAILABLE (19:00 open PHP 700, 20:00 unavailable PHP 700, 21:00 unavailable PHP 700)
      from read                  #14 request +6.014 s → response +6.094 s
      That read was requested 6.005 s after this POST; the grid at POST time was not observed.
    First fully-open read:       none observed
    First unavailable read:      #14 request +6.014 s → response +6.094 s (20:00, 21:00)
    Public booking record:       #b2 request +2.014 s → response +2.845 s (20:00)
    Reopened (fully open again): none observed
    Checkout:                    HTTP 409 · hint availability
    Response recorded by runner: +10.426 s (network duration 10,425 ms)
    Response headers:            +10.428 s
    Body complete:               +10.429 s
    Protocol / connection:       h2 · reused yes · dns — · connect — · tls — · send 0.3 ms · wait 10,419.2 ms
    Provider IDs:                x-vercel-id sin1::sin1::vwkmg-1790553600030-e06a61aa6615 · x-request-id — · cf-ray —
    Server / cache / timing:     Vercel · x-vercel-cache MISS · server-timing —

  Worker G · Court 1 · 19:00–22:00 · core-G-official-7
    POST initiated:              +0.008 s
    First published state:       PARTIALLY UNAVAILABLE (19:00 unavailable PHP 700, 20:00 open PHP 700, 21:00 unavailable PHP 700)
      from read                  #14 request +6.014 s → response +6.094 s
      That read was requested 6.006 s after this POST; the grid at POST time was not observed.
    First fully-open read:       none observed
    First unavailable read:      #14 request +6.014 s → response +6.094 s (19:00, 21:00)
    Public booking record:       #b2 request +2.014 s → response +2.845 s (19:00, 21:00)
    Reopened (fully open again): none observed
    Checkout:                    HTTP 409 · hint availability
    Response recorded by runner: +12.109 s (network duration 12,108 ms)
    Response headers:            +12.109 s
    Body complete:               +12.110 s
    Protocol / connection:       h2 · reused yes · dns — · connect — · tls — · send 0.1 ms · wait 12,100.7 ms
    Provider IDs:                x-vercel-id sin1::sin1::r6dd5-1790553600031-5bbbebb72c64 · x-request-id — · cf-ray —
    Server / cache / timing:     Vercel · x-vercel-cache MISS · server-timing —

5. AVAILABILITY TRANSITIONS
  OPEN → unavailable (cells): 28 · unavailable → OPEN (cells): 34. Per-cell read pairs are in the Slot Watch report and summary.

6. PUBLIC BOOKING EVIDENCE
  9 public booking reads answered · 0 failed · 0 failed court queries
  Unavailable in the first published grid without any matching public booking record during the watch: 12 cells (cause unknown).

7. PROVIDER / NETWORK TRACE
  7 traced POST(s), 7 complete. Details per target above.

8. CHECKOUT OUTCOME
  ALL_REJECTED_WAITING_FOR_REOPEN

9. LIMITATIONS
  - An availability read shows Onda's state at an unknown moment between its request start and its response. No source here gives the provider-side moment of a change.
  - Unavailable without a matching public booking record: the cause is not visible in Onda's public data.
  - A public booking record shows that a booking record exists. It does not show who made it, whether it belongs to this bot, or why.
  - POST initiation is the Playwright request event in the runner (trusted release clock). Header and body times are that instant plus Chrome intervals from its network request start (under 1 ms after the request event); they carry the few-ms delivery lag of that event.
  - The provider trace enables DevTools Network only after each POST has left, so it never adds work at the release instant; a response that arrives before it is enabled (tens of ms) is not traced.
  - Response timing and headers describe what arrived at this PC. They do not establish how Onda queued or ordered requests, or why a request was accepted or rejected.
  - The observer and the dispatch clocks differ by -4.2 ms (observer minus dispatch); comparisons between grid reads and POST times carry that difference.

SOURCES
  Runner trace:   [REDACTED_LOCAL_PATH]\Downloads\Thirsty Pickle Bot\.local\api-booking\run-progress\e3f7de87-d1d5-4949-9ddc-4cc49529cfa7.ndjson
  Slot Watch log: [REDACTED_LOCAL_PATH]\Downloads\Thirsty Pickle Bot\.local\slot-watch\2026-09-30_ffe896ed-9c1f-43c7-9ce9-7767b6d12d49.ndjson
  Provider trace: [REDACTED_LOCAL_PATH]\Downloads\Thirsty Pickle Bot\.local\release-forensics\e3f7de87-d1d5-4949-9ddc-4cc49529cfa7\provider-trace.ndjson
```

### Appendix J — Slot Watch text report, verbatim

```
RELEASE SLOT WATCH — target 2026-09-30
Release: 2026-09-28 08:00:00.000 Manila · observer network clock synchronized (offset 34.8 ms)
Watch finished: window complete
Availability reads: 204 launched · 202 answered · 2 failed · 0 cancelled · 0 not launched (cap or late) · max 2 in flight (cap 6) · median 87 ms
Early launches (release-relative): +0.000 s, +0.250 s, +0.500 s, +1.000 s, +2.000 s, +5.000 s; overlapping reads allowed
Public booking reads: 9 launched · 9 answered · 0 failed · 0 failed court queries · 0 not launched

Each read shows Onda's state at an unknown moment between its request and its response. Changes are listed between two reads in request order.

FIRST PUBLISHED GRID
  Last read without the date:   #13 request +5.003 s → response +5.083 s
  First read with the date:     #14 request +6.014 s → response +6.094 s · edge cache HIT, age 1 s
  Open 77 · unavailable 35 · unknown 0
  (O open, X unavailable, U not published, ? unknown)
       08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1    O  O  O  O  O  O  O  O  O  X  X  X  O  X  O  O
  C2    O  O  O  O  O  O  O  O  O  O  X  O  X  X  O  O
  C3    X  X  X  X  O  O  O  O  O  X  X  X  O  X  X  O
  C4    X  X  X  X  O  O  O  O  O  X  X  O  X  O  X  O
  C5    X  X  X  X  O  O  O  O  O  O  O  X  X  X  O  O
  C6    O  O  O  O  O  O  O  O  O  O  O  X  X  O  X  O
  C7    O  O  O  O  O  O  O  O  O  O  X  O  O  O  O  O

OPEN → UNAVAILABLE (first change per cell)
  Court 1 8 PM  open in #23 request +15.015 s → response +15.098 s; unavailable in #24 request +16.010 s → response +16.099 s · public booking record first seen #b3 request +10.016 s → response +10.753 s
  Court 1 10 PM open in #23 request +15.015 s → response +15.098 s; unavailable in #24 request +16.010 s → response +16.099 s · public booking record first seen #b3 request +10.016 s → response +10.753 s
  Court 2 5 PM  open in #23 request +15.015 s → response +15.098 s; unavailable in #24 request +16.010 s → response +16.099 s · public booking record first seen #b3 request +10.016 s → response +10.753 s
  Court 2 7 PM  open in #23 request +15.015 s → response +15.098 s; unavailable in #24 request +16.010 s → response +16.099 s · public booking record first seen #b3 request +10.016 s → response +10.753 s
  Court 2 10 PM open in #23 request +15.015 s → response +15.098 s; unavailable in #24 request +16.010 s → response +16.099 s · public booking record first seen #b3 request +10.016 s → response +10.753 s
  Court 3 8 PM  open in #23 request +15.015 s → response +15.098 s; unavailable in #24 request +16.010 s → response +16.099 s · public booking record first seen #b3 request +10.016 s → response +10.753 s
  Court 4 7 PM  open in #23 request +15.015 s → response +15.098 s; unavailable in #24 request +16.010 s → response +16.099 s · public booking record first seen #b3 request +10.016 s → response +10.753 s
  Court 4 9 PM  open in #23 request +15.015 s → response +15.098 s; unavailable in #24 request +16.010 s → response +16.099 s · public booking record first seen #b3 request +10.016 s → response +10.753 s
  Court 5 5 PM  open in #23 request +15.015 s → response +15.098 s; unavailable in #24 request +16.010 s → response +16.099 s · public booking record first seen #b3 request +10.016 s → response +10.753 s
  Court 5 6 PM  open in #23 request +15.015 s → response +15.098 s; unavailable in #24 request +16.010 s → response +16.099 s · public booking record first seen #b3 request +10.016 s → response +10.753 s
  Court 5 10 PM open in #23 request +15.015 s → response +15.098 s; unavailable in #24 request +16.010 s → response +16.099 s · public booking record first seen #b3 request +10.016 s → response +10.753 s
  Court 6 5 PM  open in #23 request +15.015 s → response +15.098 s; unavailable in #24 request +16.010 s → response +16.099 s · public booking record first seen #b3 request +10.016 s → response +10.753 s
  Court 6 6 PM  open in #23 request +15.015 s → response +15.098 s; unavailable in #24 request +16.010 s → response +16.099 s · public booking record first seen #b3 request +10.016 s → response +10.753 s
  Court 6 9 PM  open in #23 request +15.015 s → response +15.098 s; unavailable in #24 request +16.010 s → response +16.099 s · public booking record first seen #b3 request +10.016 s → response +10.753 s
  Court 7 5 PM  open in #23 request +15.015 s → response +15.098 s; unavailable in #24 request +16.010 s → response +16.099 s · public booking record first seen #b4 request +30.013 s → response +30.297 s
  Court 7 7 PM  open in #23 request +15.015 s → response +15.098 s; unavailable in #24 request +16.010 s → response +16.099 s · public booking record first seen #b4 request +30.013 s → response +30.297 s
  Court 7 8 PM  open in #23 request +15.015 s → response +15.098 s; unavailable in #24 request +16.010 s → response +16.099 s · public booking record first seen #b4 request +30.013 s → response +30.297 s
  Court 7 9 PM  open in #23 request +15.015 s → response +15.098 s; unavailable in #24 request +16.010 s → response +16.099 s · public booking record first seen #b4 request +30.013 s → response +30.297 s
  Court 7 10 PM open in #23 request +15.015 s → response +15.098 s; unavailable in #24 request +16.010 s → response +16.099 s · public booking record first seen #b4 request +30.013 s → response +30.297 s
  Court 4 8 PM  open in #75 request +95.004 s → response +95.175 s; unavailable in #76 request +100.005 s → response +100.174 s · public booking record first seen #b3 request +10.016 s → response +10.753 s
  Court 5 7 PM  open in #75 request +95.004 s → response +95.175 s; unavailable in #76 request +100.005 s → response +100.174 s · public booking record first seen #b3 request +10.016 s → response +10.753 s
  Court 5 8 PM  open in #75 request +95.004 s → response +95.175 s; unavailable in #76 request +100.005 s → response +100.174 s · public booking record first seen #b2 request +2.014 s → response +2.845 s
  Court 5 9 PM  open in #75 request +95.004 s → response +95.175 s; unavailable in #76 request +100.005 s → response +100.174 s · public booking record first seen #b3 request +10.016 s → response +10.753 s
  Court 1 9 PM  open in #125 request +570.003 s → response +570.198 s; unavailable in #126 request +595.008 s → response +595.178 s · public booking record first seen #b2 request +2.014 s → response +2.845 s
  Court 1 11 PM open in #125 request +570.003 s → response +570.198 s; unavailable in #126 request +595.008 s → response +595.178 s · no matching public booking record seen
  Court 2 9 PM  open in #125 request +570.003 s → response +570.198 s; unavailable in #126 request +595.008 s → response +595.178 s · public booking record first seen #b3 request +10.016 s → response +10.753 s
  Court 2 11 PM open in #125 request +570.003 s → response +570.198 s; unavailable in #126 request +595.008 s → response +595.178 s · no matching public booking record seen
  Court 7 6 PM  open in #200 request +780.015 s → response +780.179 s; unavailable in #201 request +810.006 s → response +810.156 s · public booking record first seen #b2 request +2.014 s → response +2.845 s

UNAVAILABLE IN THE FIRST PUBLISHED GRID
  Court 1: 5 PM (public booking record, first seen +2.845 s), 6 PM (public booking record, first seen +10.753 s), 7 PM (public booking record, first seen +2.845 s), 9 PM (public booking record, first seen +2.845 s)
  Court 2: 6 PM (public booking record, first seen +10.753 s), 8 PM (public booking record, first seen +2.845 s), 9 PM (public booking record, first seen +10.753 s)
  Court 3: 8 AM (no matching public booking record · cause unknown), 9 AM (no matching public booking record · cause unknown), 10 AM (no matching public booking record · cause unknown), 11 AM (no matching public booking record · cause unknown), 5 PM (public booking record, first seen +10.753 s), 6 PM (public booking record, first seen +10.753 s), 7 PM (public booking record, first seen +2.845 s), 9 PM (public booking record, first seen +2.845 s), 10 PM (public booking record, first seen +2.845 s)
  Court 4: 8 AM (no matching public booking record · cause unknown), 9 AM (no matching public booking record · cause unknown), 10 AM (no matching public booking record · cause unknown), 11 AM (no matching public booking record · cause unknown), 5 PM (public booking record, first seen +10.753 s), 6 PM (public booking record, first seen +2.845 s), 8 PM (public booking record, first seen +10.753 s), 10 PM (public booking record, first seen +2.845 s)
  Court 5: 8 AM (no matching public booking record · cause unknown), 9 AM (no matching public booking record · cause unknown), 10 AM (no matching public booking record · cause unknown), 11 AM (no matching public booking record · cause unknown), 7 PM (public booking record, first seen +10.753 s), 8 PM (public booking record, first seen +2.845 s), 9 PM (public booking record, first seen +10.753 s)
  Court 6: 7 PM (public booking record, first seen +2.845 s), 8 PM (public booking record, first seen +2.845 s), 10 PM (public booking record, first seen +10.753 s)
  Court 7: 6 PM (public booking record, first seen +2.845 s)

UNAVAILABLE → OPEN (reopened; cause unknown)
  Court 4 7 PM  unavailable in #73 request +85.017 s → response +85.186 s; open in #74 request +90.009 s → response +90.170 s
  Court 4 8 PM  unavailable in #73 request +85.017 s → response +85.186 s; open in #74 request +90.009 s → response +90.170 s
  Court 4 9 PM  unavailable in #73 request +85.017 s → response +85.186 s; open in #74 request +90.009 s → response +90.170 s
  Court 5 7 PM  unavailable in #73 request +85.017 s → response +85.186 s; open in #74 request +90.009 s → response +90.170 s
  Court 5 8 PM  unavailable in #73 request +85.017 s → response +85.186 s; open in #74 request +90.009 s → response +90.170 s
  Court 5 9 PM  unavailable in #73 request +85.017 s → response +85.186 s; open in #74 request +90.009 s → response +90.170 s
  Court 1 9 PM  unavailable in #117 request +330.016 s → response +330.185 s; open in #118 request +360.007 s → response +360.163 s
  Court 1 10 PM unavailable in #117 request +330.016 s → response +330.185 s; open in #118 request +360.007 s → response +360.163 s
  Court 2 9 PM  unavailable in #117 request +330.016 s → response +330.185 s; open in #118 request +360.007 s → response +360.163 s
  Court 2 10 PM unavailable in #117 request +330.016 s → response +330.185 s; open in #118 request +360.007 s → response +360.163 s
  Court 6 9 PM  unavailable in #117 request +330.016 s → response +330.185 s; open in #118 request +360.007 s → response +360.163 s
  Court 6 10 PM unavailable in #117 request +330.016 s → response +330.185 s; open in #118 request +360.007 s → response +360.163 s
  Court 7 10 PM unavailable in #117 request +330.016 s → response +330.185 s; open in #118 request +360.007 s → response +360.163 s
  Court 1 5 PM  unavailable in #122 request +480.003 s → response +480.180 s; open in #123 request +510.014 s → response +510.207 s
  Court 1 6 PM  unavailable in #122 request +480.003 s → response +480.180 s; open in #123 request +510.014 s → response +510.207 s
  Court 2 5 PM  unavailable in #122 request +480.003 s → response +480.180 s; open in #123 request +510.014 s → response +510.207 s
  Court 2 6 PM  unavailable in #122 request +480.003 s → response +480.180 s; open in #123 request +510.014 s → response +510.207 s
  Court 2 7 PM  unavailable in #136 request +605.003 s → response +605.090 s; open in #137 request +606.015 s → response +606.091 s
  Court 3 5 PM  unavailable in #136 request +605.003 s → response +605.090 s; open in #137 request +606.015 s → response +606.091 s
  Court 3 6 PM  unavailable in #136 request +605.003 s → response +605.090 s; open in #137 request +606.015 s → response +606.091 s
  Court 3 10 PM unavailable in #136 request +605.003 s → response +605.090 s; open in #137 request +606.015 s → response +606.091 s
  Court 4 5 PM  unavailable in #136 request +605.003 s → response +605.090 s; open in #137 request +606.015 s → response +606.091 s
  Court 4 6 PM  unavailable in #136 request +605.003 s → response +605.090 s; open in #137 request +606.015 s → response +606.091 s
  Court 4 10 PM unavailable in #136 request +605.003 s → response +605.090 s; open in #137 request +606.015 s → response +606.091 s
  Court 5 10 PM unavailable in #136 request +605.003 s → response +605.090 s; open in #137 request +606.015 s → response +606.091 s
  Court 6 5 PM  unavailable in #136 request +605.003 s → response +605.090 s; open in #137 request +606.015 s → response +606.091 s
  Court 6 6 PM  unavailable in #136 request +605.003 s → response +605.090 s; open in #137 request +606.015 s → response +606.091 s
  Court 7 5 PM  unavailable in #136 request +605.003 s → response +605.090 s; open in #137 request +606.015 s → response +606.091 s
  Court 7 6 PM  unavailable in #136 request +605.003 s → response +605.090 s; open in #137 request +606.015 s → response +606.091 s
  Court 7 7 PM  unavailable in #136 request +605.003 s → response +605.090 s; open in #137 request +606.015 s → response +606.091 s
  Court 7 8 PM  unavailable in #136 request +605.003 s → response +605.090 s; open in #137 request +606.015 s → response +606.091 s
  Court 7 9 PM  unavailable in #136 request +605.003 s → response +605.090 s; open in #137 request +606.015 s → response +606.091 s
  Court 5 5 PM  unavailable in #146 request +615.001 s → response +615.066 s; open in #147 request +616.003 s → response +616.068 s
  Court 5 6 PM  unavailable in #146 request +615.001 s → response +615.066 s; open in #147 request +616.003 s → response +616.068 s

CURRENT MATRIX (newest answered request: #204 request +900.004 s → response +900.485 s; a late answer to an older request never replaces it)
  (O open, X unavailable, U not published, ? unknown)
       08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1    O  O  O  O  O  O  O  O  O  O  O  X  X  X  X  X
  C2    O  O  O  O  O  O  O  O  O  O  O  X  X  X  X  X
  C3    X  X  X  X  O  O  O  O  O  O  O  X  X  X  O  O
  C4    X  X  X  X  O  O  O  O  O  O  O  X  X  X  O  O
  C5    X  X  X  X  O  O  O  O  O  O  O  X  X  X  O  O
  C6    O  O  O  O  O  O  O  O  O  O  O  X  X  O  O  O
  C7    O  O  O  O  O  O  O  O  O  O  X  X  O  O  O  O

LIMITATIONS
  - A read does not show the provider-side moment of a change; only the request/response interval of the reads around it.
  - Unavailable without a matching public booking record: the cause is not visible in Onda's public data.
  - A public booking record shows that a booking record exists. It does not show who made it or why.
  - Responses served from Onda's edge cache (x-vercel-cache/age) may reflect an earlier state than the request time.

Full read-by-read log (response order, with request order in seq): [REDACTED_LOCAL_PATH]\Downloads\Thirsty Pickle Bot\.local\slot-watch\2026-09-30_ffe896ed-9c1f-43c7-9ce9-7767b6d12d49.ndjson
```

### Appendix K — Slot Watch header, clock and every booking-record line

All 204 availability lines and the summary line are in [RELEASE_RUN_REPORT_2026-09-28_RAW_LOGS.md](RELEASE_RUN_REPORT_2026-09-28_RAW_LOGS.md).

```json
{"type":"header","version":2,"id":"ffe896ed-9c1f-43c7-9ce9-7767b6d12d49","date":"2026-09-30","releaseAt":"2026-09-28T00:00:00.000Z","releaseMs":1790553600000,"releaseManila":"2026-09-28 08:00:00.000","startedAt":"2026-09-27T23:35:25.369Z","clockOffsetMs":22.545654296875,"clockSynced":true,"schedule":{"availability":[-60000,-50000,-40000,-30000,-20000,-10000,-2000,0,250,500,1000,2000,5000,6000,7000,8000,9000,10000,11000,12000,13000,14000,15000,16000,17000,18000,19000,20000,21000,22000,23000,24000,25000,26000,27000,28000,29000,30000,31000,32000,33000,34000,35000,36000,37000,38000,39000,40000,41000,42000,43000,44000,45000,46000,47000,48000,49000,50000,51000,52000,53000,54000,55000,56000,57000,58000,59000,60000,65000,70000,75000,80000,85000,90000,95000,100000,105000,110000,115000,120000,125000,130000,135000,140000,145000,150000,155000,160000,165000,170000,175000,180000,185000,190000,195000,200000,205000,210000,215000,220000,225000,230000,235000,240000,245000,250000,255000,260000,265000,270000,275000,280000,285000,290000,295000,300000,330000,360000,390000,420000,450000,480000,510000,540000,570000,595000,596000,597000,598000,599000,600000,601000,602000,603000,604000,605000,606000,607000,608000,609000,610000,611000,612000,613000,614000,615000,616000,617000,618000,619000,620000,621000,622000,623000,624000,625000,626000,627000,628000,629000,630000,631000,632000,633000,634000,635000,636000,637000,638000,639000,640000,641000,642000,643000,644000,645000,646000,647000,648000,649000,650000,651000,652000,653000,654000,655000,656000,657000,658000,659000,660000,661000,662000,663000,664000,665000,690000,720000,750000,780000,810000,840000,870000,900000],"bookings":[-60000,2000,10000,30000,60000,120000,300000,600000,900000],"maxInFlight":6,"readTimeoutMs":15000,"bookingTimeoutMs":10000},"legend":{"O":"open","X":"unavailable","U":"date not published","?":"unknown (cell missing or read failed)"},"note":"Offsets are ms since release on the observer network clock. A read reflects Onda at an unknown moment between its request and its response. Lines are written in response order; seq is request order."}
{"type":"clock","at":"2026-09-27T23:59:00.012Z","offsetMs":34.8}
{"type":"bookings","seq":1,"scheduledOffsetMs":-60000,"requestOffsetMs":-59982.2,"responseOffsetMs":-59602.2,"outcome":"ok","failedCourts":[],"cells":[],"durationMs":380,"requestedAt":"2026-09-27T23:59:00.017Z","respondedAt":"2026-09-27T23:59:00.397Z"}
{"type":"bookings","seq":2,"scheduledOffsetMs":2000,"requestOffsetMs":2013.8,"responseOffsetMs":2844.8,"outcome":"ok","failedCourts":[],"cells":["1/17:00","1/19:00","1/21:00","2/20:00","3/19:00","3/21:00","3/22:00","4/18:00","4/22:00","5/20:00","6/19:00","6/20:00","7/18:00"],"durationMs":831,"requestedAt":"2026-09-28T00:00:02.013Z","respondedAt":"2026-09-28T00:00:02.844Z"}
{"type":"bookings","seq":3,"scheduledOffsetMs":10000,"requestOffsetMs":10015.8,"responseOffsetMs":10752.8,"outcome":"ok","failedCourts":[],"cells":["1/17:00","1/18:00","1/19:00","1/20:00","1/21:00","1/22:00","2/17:00","2/18:00","2/19:00","2/20:00","2/21:00","2/22:00","3/17:00","3/18:00","3/19:00","3/20:00","3/21:00","3/22:00","4/17:00","4/18:00","4/19:00","4/20:00","4/21:00","4/22:00","5/17:00","5/18:00","5/19:00","5/20:00","5/21:00","5/22:00","6/17:00","6/18:00","6/19:00","6/20:00","6/21:00","6/22:00","7/18:00"],"durationMs":737,"requestedAt":"2026-09-28T00:00:10.015Z","respondedAt":"2026-09-28T00:00:10.752Z"}
{"type":"bookings","seq":4,"scheduledOffsetMs":30000,"requestOffsetMs":30012.8,"responseOffsetMs":30296.8,"outcome":"ok","failedCourts":[],"cells":["1/17:00","1/18:00","1/19:00","1/20:00","1/21:00","1/22:00","2/17:00","2/18:00","2/19:00","2/20:00","2/21:00","2/22:00","3/17:00","3/18:00","3/19:00","3/20:00","3/21:00","3/22:00","4/17:00","4/18:00","4/19:00","4/20:00","4/21:00","4/22:00","5/17:00","5/18:00","5/19:00","5/20:00","5/21:00","5/22:00","6/17:00","6/18:00","6/19:00","6/20:00","6/21:00","6/22:00","7/17:00","7/18:00","7/19:00","7/20:00","7/21:00","7/22:00"],"durationMs":284,"requestedAt":"2026-09-28T00:00:30.012Z","respondedAt":"2026-09-28T00:00:30.296Z"}
{"type":"bookings","seq":5,"scheduledOffsetMs":60000,"requestOffsetMs":60009.8,"responseOffsetMs":60264.8,"outcome":"ok","failedCourts":[],"cells":["1/17:00","1/18:00","1/19:00","1/20:00","1/21:00","1/22:00","2/17:00","2/18:00","2/19:00","2/20:00","2/21:00","2/22:00","3/17:00","3/18:00","3/19:00","3/20:00","3/21:00","3/22:00","4/17:00","4/18:00","4/19:00","4/20:00","4/21:00","4/22:00","5/17:00","5/18:00","5/19:00","5/20:00","5/21:00","5/22:00","6/17:00","6/18:00","6/19:00","6/20:00","6/21:00","6/22:00","7/17:00","7/18:00","7/19:00","7/20:00","7/21:00","7/22:00"],"durationMs":255,"requestedAt":"2026-09-28T00:01:00.009Z","respondedAt":"2026-09-28T00:01:00.264Z"}
{"type":"bookings","seq":6,"scheduledOffsetMs":120000,"requestOffsetMs":120012.8,"responseOffsetMs":120239.8,"outcome":"ok","failedCourts":[],"cells":["1/17:00","1/18:00","1/19:00","1/20:00","1/21:00","1/22:00","2/17:00","2/18:00","2/19:00","2/20:00","2/21:00","2/22:00","3/17:00","3/18:00","3/19:00","3/20:00","3/21:00","3/22:00","4/17:00","4/18:00","4/19:00","4/20:00","4/21:00","4/22:00","5/17:00","5/18:00","5/19:00","5/20:00","5/21:00","5/22:00","6/17:00","6/18:00","6/19:00","6/20:00","6/21:00","6/22:00","7/17:00","7/18:00","7/19:00","7/20:00","7/21:00","7/22:00"],"durationMs":227,"requestedAt":"2026-09-28T00:02:00.012Z","respondedAt":"2026-09-28T00:02:00.239Z"}
{"type":"bookings","seq":7,"scheduledOffsetMs":300000,"requestOffsetMs":300008.8,"responseOffsetMs":300232.8,"outcome":"ok","failedCourts":[],"cells":["1/17:00","1/18:00","1/19:00","1/20:00","1/21:00","1/22:00","2/17:00","2/18:00","2/19:00","2/20:00","2/21:00","2/22:00","3/17:00","3/18:00","3/22:00","4/17:00","4/18:00","4/19:00","4/20:00","4/21:00","4/22:00","5/17:00","5/18:00","5/19:00","5/20:00","5/21:00","5/22:00","6/17:00","6/18:00","6/19:00","6/20:00","6/21:00","6/22:00","7/17:00","7/18:00","7/19:00","7/20:00","7/21:00","7/22:00"],"durationMs":224,"requestedAt":"2026-09-28T00:05:00.008Z","respondedAt":"2026-09-28T00:05:00.232Z"}
{"type":"bookings","seq":8,"scheduledOffsetMs":600000,"requestOffsetMs":600007.8,"responseOffsetMs":600366.8,"outcome":"ok","failedCourts":[],"cells":["1/19:00","1/20:00","1/21:00","1/22:00","2/19:00","2/20:00","2/21:00","2/22:00","3/17:00","3/18:00","3/19:00","3/20:00","3/21:00","3/22:00","4/17:00","4/18:00","4/19:00","4/20:00","4/21:00","4/22:00","5/17:00","5/18:00","5/19:00","5/20:00","5/21:00","5/22:00","6/17:00","6/18:00","6/19:00","6/20:00","7/17:00","7/18:00","7/19:00","7/20:00","7/21:00"],"durationMs":359,"requestedAt":"2026-09-28T00:10:00.007Z","respondedAt":"2026-09-28T00:10:00.366Z"}
{"type":"bookings","seq":9,"scheduledOffsetMs":900000,"requestOffsetMs":900004.8,"responseOffsetMs":900448.8,"outcome":"ok","failedCourts":[],"cells":["1/19:00","1/20:00","1/21:00","1/22:00","2/19:00","2/20:00","2/21:00","2/22:00","3/19:00","3/20:00","3/21:00","4/19:00","4/20:00","4/21:00","5/19:00","5/20:00","5/21:00","6/19:00","6/20:00","7/18:00","7/19:00"],"durationMs":444,"requestedAt":"2026-09-28T00:15:00.004Z","respondedAt":"2026-09-28T00:15:00.448Z"}
```

### Appendix L — Provider trace, every line

```json
{"type":"header","version":2,"runId":"e3f7de87-d1d5-4949-9ddc-4cc49529cfa7","reference":"release","referenceMs":1790553600000,"traces":[{"workerId":"A","status":"active"},{"workerId":"B","status":"active"},{"workerId":"C","status":"active"},{"workerId":"D","status":"active"},{"workerId":"E","status":"active"},{"workerId":"F","status":"active"},{"workerId":"G","status":"active"}],"note":"Passive DevTools Network events, enabled only after each POST had left. browser.* are browser-monotonic ms after Chrome's network request start; nodeObserved.* are ms after the reference on the runner trusted clock when Node received the event."}
{"type":"provider-trace","workerId":"A","attemptId":"core-A-official-1","method":"POST","path":"/api/bookings/public-checkout","nodeObserved":{"enabledOffsetMs":4.2,"headersOffsetMs":10577.7,"finishedOffsetMs":10578},"browser":{"dnsMs":null,"connectMs":null,"tlsMs":null,"sendMs":0.2,"waitMs":10581.9,"headersStartMs":10582.7,"headersEndMs":10582.7,"bodyCompleteMs":10583.1,"failedMs":null},"connection":{"protocol":"h2","reused":true},"response":{"status":409,"contentType":"application/json","server":"Vercel","cfRay":null,"cfMitigated":null,"vercelId":"sin1::sin1::xmblb-1790553600017-a8cface69893","requestId":null,"vercelCache":"MISS","ageS":null,"serverTiming":null,"encodedBytes":424},"failure":null,"complete":true}
{"type":"provider-trace","workerId":"B","attemptId":"core-B-official-2","method":"POST","path":"/api/bookings/public-checkout","nodeObserved":{"enabledOffsetMs":4.5,"headersOffsetMs":8062.3,"finishedOffsetMs":8063.3},"browser":{"dnsMs":null,"connectMs":null,"tlsMs":null,"sendMs":0.2,"waitMs":8078.2,"headersStartMs":8078.9,"headersEndMs":8079,"bodyCompleteMs":8080.3,"failedMs":null},"connection":{"protocol":"h2","reused":true},"response":{"status":409,"contentType":"application/json","server":"Vercel","cfRay":null,"cfMitigated":null,"vercelId":"sin1::sin1::4vphp-1790553600005-eea3d5a81e4f","requestId":null,"vercelCache":"MISS","ageS":null,"serverTiming":null,"encodedBytes":399},"failure":null,"complete":true}
{"type":"provider-trace","workerId":"C","attemptId":"core-C-official-3","method":"POST","path":"/api/bookings/public-checkout","nodeObserved":{"enabledOffsetMs":4.6,"headersOffsetMs":10326.6,"finishedOffsetMs":10326.9},"browser":{"dnsMs":null,"connectMs":null,"tlsMs":null,"sendMs":0.2,"waitMs":10370.9,"headersStartMs":10371.4,"headersEndMs":10371.5,"bodyCompleteMs":10371.9,"failedMs":null},"connection":{"protocol":"h2","reused":true},"response":{"status":409,"contentType":"application/json","server":"Vercel","cfRay":null,"cfMitigated":null,"vercelId":"sin1::sin1::5hqz4-1790553599977-373e7e3a40f2","requestId":null,"vercelCache":"MISS","ageS":null,"serverTiming":null,"encodedBytes":399},"failure":null,"complete":true}
{"type":"provider-trace","workerId":"D","attemptId":"core-D-official-4","method":"POST","path":"/api/bookings/public-checkout","nodeObserved":{"enabledOffsetMs":4.7,"headersOffsetMs":12087.1,"finishedOffsetMs":12087.4},"browser":{"dnsMs":null,"connectMs":null,"tlsMs":null,"sendMs":0.3,"waitMs":12086,"headersStartMs":12086.9,"headersEndMs":12086.9,"bodyCompleteMs":12087.3,"failedMs":null},"connection":{"protocol":"h2","reused":true},"response":{"status":409,"contentType":"application/json","server":"Vercel","cfRay":null,"cfMitigated":null,"vercelId":"sin1::sin1::t7sc7-1790553600025-c8c3f7635381","requestId":null,"vercelCache":"MISS","ageS":null,"serverTiming":null,"encodedBytes":425},"failure":null,"complete":true}
{"type":"provider-trace","workerId":"E","attemptId":"core-E-official-5","method":"POST","path":"/api/bookings/public-checkout","nodeObserved":{"enabledOffsetMs":4.8,"headersOffsetMs":9845.2,"finishedOffsetMs":9845.9},"browser":{"dnsMs":null,"connectMs":null,"tlsMs":null,"sendMs":0.1,"waitMs":9836.4,"headersStartMs":9837,"headersEndMs":9837.2,"bodyCompleteMs":9838.1,"failedMs":null},"connection":{"protocol":"h2","reused":true},"response":{"status":409,"contentType":"application/json","server":"Vercel","cfRay":null,"cfMitigated":null,"vercelId":"sin1::sin1::gsvmw-1790553600027-aa378ac9fbd4","requestId":null,"vercelCache":"MISS","ageS":null,"serverTiming":null,"encodedBytes":398},"failure":null,"complete":true}
{"type":"provider-trace","workerId":"F","attemptId":"core-F-official-6","method":"POST","path":"/api/bookings/public-checkout","nodeObserved":{"enabledOffsetMs":4.8,"headersOffsetMs":10424.9,"finishedOffsetMs":10425.1},"browser":{"dnsMs":null,"connectMs":null,"tlsMs":null,"sendMs":0.3,"waitMs":10419.2,"headersStartMs":10419.7,"headersEndMs":10419.7,"bodyCompleteMs":10420.1,"failedMs":null},"connection":{"protocol":"h2","reused":true},"response":{"status":409,"contentType":"application/json","server":"Vercel","cfRay":null,"cfMitigated":null,"vercelId":"sin1::sin1::vwkmg-1790553600030-e06a61aa6615","requestId":null,"vercelCache":"MISS","ageS":null,"serverTiming":null,"encodedBytes":409},"failure":null,"complete":true}
{"type":"provider-trace","workerId":"G","attemptId":"core-G-official-7","method":"POST","path":"/api/bookings/public-checkout","nodeObserved":{"enabledOffsetMs":5.3,"headersOffsetMs":12107.9,"finishedOffsetMs":12108.2},"browser":{"dnsMs":null,"connectMs":null,"tlsMs":null,"sendMs":0.1,"waitMs":12100.7,"headersStartMs":12101.1,"headersEndMs":12101.2,"bodyCompleteMs":12101.8,"failedMs":null},"connection":{"protocol":"h2","reused":true},"response":{"status":409,"contentType":"application/json","server":"Vercel","cfRay":null,"cfMitigated":null,"vercelId":"sin1::sin1::r6dd5-1790553600031-5bbbebb72c64","requestId":null,"vercelCache":"MISS","ageS":null,"serverTiming":null,"encodedBytes":398},"failure":null,"complete":true}
{"type":"response-fallback","workerId":"B","attemptId":"core-B-official-2","candidateId":"9cf2c3872f8c8c5e6867a9211f3fc9e91f9903a7451380bb72b0b187da0f0fcf","wave":"WAVE_1","status":409,"contentType":"application/json","server":"Vercel","cfRay":null,"vercelId":"sin1::sin1::4vphp-1790553600005-eea3d5a81e4f","requestId":null,"serverTiming":null,"responseReceivedMs":8083.3,"responseCompletedMs":8083.7,"evidence":{"version":1,"status":409,"headers":{"content-type":"application/json","server":"Vercel","date":"Mon, 28 Sep 2026 00:00:08 GMT","cache-control":"public, max-age=0, must-revalidate","x-vercel-id":"sin1::sin1::4vphp-1790553600005-eea3d5a81e4f","x-vercel-cache":"MISS","x-matched-path":"/api/bookings/public-checkout"},"vercel":{"regions":["sin1","sin1"],"edgeRegion":"sin1","functionRegion":"sin1","embeddedMs":1790553600005,"embeddedInterpretation":"UNDOCUMENTED"},"serverDateMs":1790553608000,"serverTiming":null,"body":{"version":1,"byteLength":100,"contentKind":"json","jsonType":"object","shape":[{"path":"$","type":"object"},{"path":"error","type":"string","length":72},{"path":"success","type":"boolean"}],"fields":{"success":false,"error":"This booking slot is no longer available (overlaps an existing booking)."},"shapeFingerprint":"[REDACTED]","sanitizedFingerprint":"[REDACTED]"}}}
{"type":"response-fallback","workerId":"E","attemptId":"core-E-official-5","candidateId":"5589eb0cb6e51ddb891ffe17f5b7b8d0a3acbbd46ee68a9d8fe68832504154c3","wave":"WAVE_1","status":409,"contentType":"application/json","server":"Vercel","cfRay":null,"vercelId":"sin1::sin1::gsvmw-1790553600027-aa378ac9fbd4","requestId":null,"serverTiming":null,"responseReceivedMs":9841.1,"responseCompletedMs":9841.5,"evidence":{"version":1,"status":409,"headers":{"content-type":"application/json","server":"Vercel","date":"Mon, 28 Sep 2026 00:00:09 GMT","cache-control":"public, max-age=0, must-revalidate","x-vercel-id":"sin1::sin1::gsvmw-1790553600027-aa378ac9fbd4","x-vercel-cache":"MISS","x-matched-path":"/api/bookings/public-checkout"},"vercel":{"regions":["sin1","sin1"],"edgeRegion":"sin1","functionRegion":"sin1","embeddedMs":1790553600027,"embeddedInterpretation":"UNDOCUMENTED"},"serverDateMs":1790553609000,"serverTiming":null,"body":{"version":1,"byteLength":100,"contentKind":"json","jsonType":"object","shape":[{"path":"$","type":"object"},{"path":"error","type":"string","length":72},{"path":"success","type":"boolean"}],"fields":{"success":false,"error":"This booking slot is no longer available (overlaps an existing booking)."},"shapeFingerprint":"[REDACTED]","sanitizedFingerprint":"[REDACTED]"}}}
{"type":"response-fallback","workerId":"C","attemptId":"core-C-official-3","candidateId":"0aafa30e010464e6b8a17e61980df60fbbbfb769640964ed4af67b15f6b6a09d","wave":"WAVE_1","status":409,"contentType":"application/json","server":"Vercel","cfRay":null,"vercelId":"sin1::sin1::5hqz4-1790553599977-373e7e3a40f2","requestId":null,"serverTiming":null,"responseReceivedMs":10373.5,"responseCompletedMs":10373.7,"evidence":{"version":1,"status":409,"headers":{"content-type":"application/json","server":"Vercel","date":"Mon, 28 Sep 2026 00:00:10 GMT","cache-control":"public, max-age=0, must-revalidate","x-vercel-id":"sin1::sin1::5hqz4-1790553599977-373e7e3a40f2","x-vercel-cache":"MISS","x-matched-path":"/api/bookings/public-checkout"},"vercel":{"regions":["sin1","sin1"],"edgeRegion":"sin1","functionRegion":"sin1","embeddedMs":1790553599977,"embeddedInterpretation":"UNDOCUMENTED"},"serverDateMs":1790553610000,"serverTiming":null,"body":{"version":1,"byteLength":100,"contentKind":"json","jsonType":"object","shape":[{"path":"$","type":"object"},{"path":"error","type":"string","length":72},{"path":"success","type":"boolean"}],"fields":{"success":false,"error":"This booking slot is no longer available (overlaps an existing booking)."},"shapeFingerprint":"[REDACTED]","sanitizedFingerprint":"[REDACTED]"}}}
{"type":"response-fallback","workerId":"F","attemptId":"core-F-official-6","candidateId":"9a0e7b37cb7df37170afa84d5efeb1706016659f468b2baa5f237296291e991c","wave":"WAVE_1","status":409,"contentType":"application/json","server":"Vercel","cfRay":null,"vercelId":"sin1::sin1::vwkmg-1790553600030-e06a61aa6615","requestId":null,"serverTiming":null,"responseReceivedMs":10421.7,"responseCompletedMs":10421.8,"evidence":{"version":1,"status":409,"headers":{"content-type":"application/json","server":"Vercel","date":"Mon, 28 Sep 2026 00:00:10 GMT","cache-control":"public, max-age=0, must-revalidate","x-vercel-id":"sin1::sin1::vwkmg-1790553600030-e06a61aa6615","x-vercel-cache":"MISS","x-matched-path":"/api/bookings/public-checkout"},"vercel":{"regions":["sin1","sin1"],"edgeRegion":"sin1","functionRegion":"sin1","embeddedMs":1790553600030,"embeddedInterpretation":"UNDOCUMENTED"},"serverDateMs":1790553610000,"serverTiming":null,"body":{"version":1,"byteLength":100,"contentKind":"json","jsonType":"object","shape":[{"path":"$","type":"object"},{"path":"error","type":"string","length":72},{"path":"success","type":"boolean"}],"fields":{"success":false,"error":"This booking slot is no longer available (overlaps an existing booking)."},"shapeFingerprint":"[REDACTED]","sanitizedFingerprint":"[REDACTED]"}}}
{"type":"response-fallback","workerId":"A","attemptId":"core-A-official-1","candidateId":"85746ed1a88a159960b11e0d2c8b10c708b9f33cd500ea5a2bb0850aa481b032","wave":"WAVE_1","status":409,"contentType":"application/json","server":"Vercel","cfRay":null,"vercelId":"sin1::sin1::xmblb-1790553600017-a8cface69893","requestId":null,"serverTiming":null,"responseReceivedMs":10585.1,"responseCompletedMs":10585.3,"evidence":{"version":1,"status":409,"headers":{"content-type":"application/json","server":"Vercel","date":"Mon, 28 Sep 2026 00:00:10 GMT","cache-control":"public, max-age=0, must-revalidate","x-vercel-id":"sin1::sin1::xmblb-1790553600017-a8cface69893","x-vercel-cache":"MISS","x-matched-path":"/api/bookings/public-checkout"},"vercel":{"regions":["sin1","sin1"],"edgeRegion":"sin1","functionRegion":"sin1","embeddedMs":1790553600017,"embeddedInterpretation":"UNDOCUMENTED"},"serverDateMs":1790553610000,"serverTiming":null,"body":{"version":1,"byteLength":100,"contentKind":"json","jsonType":"object","shape":[{"path":"$","type":"object"},{"path":"error","type":"string","length":72},{"path":"success","type":"boolean"}],"fields":{"success":false,"error":"This booking slot is no longer available (overlaps an existing booking)."},"shapeFingerprint":"[REDACTED]","sanitizedFingerprint":"[REDACTED]"}}}
{"type":"response-fallback","workerId":"D","attemptId":"core-D-official-4","candidateId":"5dfb38082fe0d4977a10e38c4c9206b64a97e97ea8034aa93f6a7fd699d6b59a","wave":"WAVE_1","status":409,"contentType":"application/json","server":"Vercel","cfRay":null,"vercelId":"sin1::sin1::t7sc7-1790553600025-c8c3f7635381","requestId":null,"serverTiming":null,"responseReceivedMs":12089.6,"responseCompletedMs":12089.8,"evidence":{"version":1,"status":409,"headers":{"content-type":"application/json","server":"Vercel","date":"Mon, 28 Sep 2026 00:00:12 GMT","cache-control":"public, max-age=0, must-revalidate","x-vercel-id":"sin1::sin1::t7sc7-1790553600025-c8c3f7635381","x-vercel-cache":"MISS","x-matched-path":"/api/bookings/public-checkout"},"vercel":{"regions":["sin1","sin1"],"edgeRegion":"sin1","functionRegion":"sin1","embeddedMs":1790553600025,"embeddedInterpretation":"UNDOCUMENTED"},"serverDateMs":1790553612000,"serverTiming":null,"body":{"version":1,"byteLength":100,"contentKind":"json","jsonType":"object","shape":[{"path":"$","type":"object"},{"path":"error","type":"string","length":72},{"path":"success","type":"boolean"}],"fields":{"success":false,"error":"This booking slot is no longer available (overlaps an existing booking)."},"shapeFingerprint":"[REDACTED]","sanitizedFingerprint":"[REDACTED]"}}}
{"type":"response-fallback","workerId":"G","attemptId":"core-G-official-7","candidateId":"5caf181e63715dbd31129a673fe1b463ba7602d79cf8d96902831f4196b3baeb","wave":"WAVE_1","status":409,"contentType":"application/json","server":"Vercel","cfRay":null,"vercelId":"sin1::sin1::r6dd5-1790553600031-5bbbebb72c64","requestId":null,"serverTiming":null,"responseReceivedMs":12103.7,"responseCompletedMs":12103.9,"evidence":{"version":1,"status":409,"headers":{"content-type":"application/json","server":"Vercel","date":"Mon, 28 Sep 2026 00:00:12 GMT","cache-control":"public, max-age=0, must-revalidate","x-vercel-id":"sin1::sin1::r6dd5-1790553600031-5bbbebb72c64","x-vercel-cache":"MISS","x-matched-path":"/api/bookings/public-checkout"},"vercel":{"regions":["sin1","sin1"],"edgeRegion":"sin1","functionRegion":"sin1","embeddedMs":1790553600031,"embeddedInterpretation":"UNDOCUMENTED"},"serverDateMs":1790553612000,"serverTiming":null,"body":{"version":1,"byteLength":100,"contentKind":"json","jsonType":"object","shape":[{"path":"$","type":"object"},{"path":"error","type":"string","length":72},{"path":"success","type":"boolean"}],"fields":{"success":false,"error":"This booking slot is no longer available (overlaps an existing booking)."},"shapeFingerprint":"[REDACTED]","sanitizedFingerprint":"[REDACTED]"}}}
```

### Appendix M — Frozen plan and saved Smart plan

The freeze file, sanitized. Its `authorization` object is redacted by the sanitizer's key rule, but every candidate in it appears verbatim in the `PHASE3_CANDIDATE` lines of Appendix E and in the saved plan below.

```json
{
  "runId": "e3f7de87-d1d5-4949-9ddc-4cc49529cfa7",
  "frozenAt": "2026-09-27T23:58:00.012Z",
  "authorization": "[REDACTED]",
  "wave1Freeze": "17079f047d7d41ef1e1ec4115b9227b5c16a35e23fb9608bc33b2dc0212ea7c3"
}
```

Saved `PRECISION_PHASE3` from `config.local.json`:

```json
{
  "candidates": [
    {
      "court": 7,
      "start": "19:00",
      "durationHours": 3,
      "priority": 1,
      "permissions": {
        "wave1": true,
        "wave2": false,
        "rescue": true
      },
      "rateEvidence": {
        "source": "current venue schedule",
        "capturedAt": "2026-09-27T23:34:41.481Z",
        "status": "VENUE_SCHEDULE",
        "date": "2026-09-30",
        "perHour": [
          700,
          700,
          700
        ],
        "actionable": true
      }
    },
    {
      "court": 6,
      "start": "19:00",
      "durationHours": 3,
      "priority": 2,
      "permissions": {
        "wave1": true,
        "wave2": false,
        "rescue": true
      },
      "rateEvidence": {
        "source": "current venue schedule",
        "capturedAt": "2026-09-27T23:34:41.481Z",
        "status": "VENUE_SCHEDULE",
        "date": "2026-09-30",
        "perHour": [
          700,
          700,
          700
        ],
        "actionable": true
      }
    },
    {
      "court": 5,
      "start": "19:00",
      "durationHours": 3,
      "priority": 3,
      "permissions": {
        "wave1": true,
        "wave2": false,
        "rescue": true
      },
      "rateEvidence": {
        "source": "current venue schedule",
        "capturedAt": "2026-09-27T23:34:41.481Z",
        "status": "VENUE_SCHEDULE",
        "date": "2026-09-30",
        "perHour": [
          700,
          700,
          700
        ],
        "actionable": true
      }
    },
    {
      "court": 4,
      "start": "19:00",
      "durationHours": 3,
      "priority": 4,
      "permissions": {
        "wave1": true,
        "wave2": false,
        "rescue": true
      },
      "rateEvidence": {
        "source": "current venue schedule",
        "capturedAt": "2026-09-27T23:34:41.481Z",
        "status": "VENUE_SCHEDULE",
        "date": "2026-09-30",
        "perHour": [
          700,
          700,
          700
        ],
        "actionable": true
      }
    },
    {
      "court": 3,
      "start": "19:00",
      "durationHours": 3,
      "priority": 5,
      "permissions": {
        "wave1": true,
        "wave2": false,
        "rescue": true
      },
      "rateEvidence": {
        "source": "current venue schedule",
        "capturedAt": "2026-09-27T23:34:41.481Z",
        "status": "VENUE_SCHEDULE",
        "date": "2026-09-30",
        "perHour": [
          700,
          700,
          700
        ],
        "actionable": true
      }
    },
    {
      "court": 2,
      "start": "19:00",
      "durationHours": 3,
      "priority": 6,
      "permissions": {
        "wave1": true,
        "wave2": false,
        "rescue": true
      },
      "rateEvidence": {
        "source": "current venue schedule",
        "capturedAt": "2026-09-27T23:34:41.481Z",
        "status": "VENUE_SCHEDULE",
        "date": "2026-09-30",
        "perHour": [
          700,
          700,
          700
        ],
        "actionable": true
      }
    },
    {
      "court": 1,
      "start": "19:00",
      "durationHours": 3,
      "priority": 7,
      "permissions": {
        "wave1": true,
        "wave2": false,
        "rescue": true
      },
      "rateEvidence": {
        "source": "current venue schedule",
        "capturedAt": "2026-09-27T23:34:41.481Z",
        "status": "VENUE_SCHEDULE",
        "date": "2026-09-30",
        "perHour": [
          700,
          700,
          700
        ],
        "actionable": true
      }
    },
    {
      "court": 3,
      "start": "20:00",
      "durationHours": 3,
      "priority": 8,
      "permissions": {
        "wave1": false,
        "wave2": true,
        "rescue": true
      },
      "rateEvidence": {
        "source": "current venue schedule",
        "capturedAt": "2026-09-27T23:34:41.481Z",
        "status": "VENUE_SCHEDULE",
        "date": "2026-09-30",
        "perHour": [
          700,
          700,
          700
        ],
        "actionable": true
      }
    },
    {
      "court": 6,
      "start": "17:00",
      "durationHours": 3,
      "priority": 9,
      "permissions": {
        "wave1": false,
        "wave2": true,
        "rescue": true
      },
      "rateEvidence": {
        "source": "current venue schedule",
        "capturedAt": "2026-09-27T23:34:41.481Z",
        "status": "VENUE_SCHEDULE",
        "date": "2026-09-30",
        "perHour": [
          700,
          700,
          700
        ],
        "actionable": true
      }
    },
    {
      "court": 6,
      "start": "20:00",
      "durationHours": 3,
      "priority": 10,
      "permissions": {
        "wave1": false,
        "wave2": true,
        "rescue": true
      },
      "rateEvidence": {
        "source": "current venue schedule",
        "capturedAt": "2026-09-27T23:34:41.481Z",
        "status": "VENUE_SCHEDULE",
        "date": "2026-09-30",
        "perHour": [
          700,
          700,
          700
        ],
        "actionable": true
      }
    }
  ],
  "wave1": [
    {
      "workerId": "A",
      "candidateIndex": 0,
      "releaseOffsetMs": -10
    },
    {
      "workerId": "B",
      "candidateIndex": 1,
      "releaseOffsetMs": -25
    },
    {
      "workerId": "C",
      "candidateIndex": 2,
      "releaseOffsetMs": -50
    },
    {
      "workerId": "D",
      "candidateIndex": 3,
      "releaseOffsetMs": -5
    },
    {
      "workerId": "E",
      "candidateIndex": 4
    },
    {
      "workerId": "F",
      "candidateIndex": 5
    },
    {
      "workerId": "G",
      "candidateIndex": 6
    }
  ],
  "standby": [],
  "budgets": {
    "wave2": 0,
    "rescue": 1,
    "total": 8
  },
  "concurrentWave2": true,
  "rescueEnabled": true
}
```

### Appendix N — Journals, every file (private raw responses excluded)

```json
// Worker A · Court 7 · .local/api-booking/api-first-journals/46dbfff25881…/
{"key":"46dbfff25881e6d4a55957d492ba73da6d2df719f5f5e695178cd6b84973ce45","state":"rejected","createdAt":"2026-09-27T23:58:00.066Z","updatedAt":"2026-09-28T00:00:10.624Z","attempt":{"attemptId":"46dbfff25881e6d4a55957d492ba73da6d2df719f5f5e695178cd6b84973ce45","planFingerprint":"[REDACTED]","targetDate":"2026-09-30","courtIds":[7],"hourlyBoundaries":[{"startTime":"19:00","endTime":"20:00"},{"startTime":"20:00","endTime":"21:00"},{"startTime":"21:00","endTime":"22:00"}],"expectedBookingCount":3,"maximumAmount":2100,"stage":"armed","releaseMs":1790553600000,"dispatchDeadlineMs":1790553601000},"diagnostic":{"status":409,"category":"http-rejection","contentKind":"json","responseSource":"application","errorHint":"availability"},"failureCode":"ONDA_HTTP_STATUS_INVALID"}
{"claimedAt":"2026-09-27T23:58:00.070Z","mode":"armed"}
// Worker B · Court 6 · .local/api-booking/api-first-journals/d1b1010ccf67…/
{"key":"d1b1010ccf67743e9460911b416e143b6e83d6acdf8ec87f6fac7a4f0dd558f8","state":"rejected","createdAt":"2026-09-27T23:58:00.066Z","updatedAt":"2026-09-28T00:00:08.068Z","attempt":{"attemptId":"d1b1010ccf67743e9460911b416e143b6e83d6acdf8ec87f6fac7a4f0dd558f8","planFingerprint":"[REDACTED]","targetDate":"2026-09-30","courtIds":[6],"hourlyBoundaries":[{"startTime":"19:00","endTime":"20:00"},{"startTime":"20:00","endTime":"21:00"},{"startTime":"21:00","endTime":"22:00"}],"expectedBookingCount":3,"maximumAmount":2100,"stage":"armed","releaseMs":1790553600000,"dispatchDeadlineMs":1790553601000},"diagnostic":{"status":409,"category":"http-rejection","contentKind":"json","responseSource":"application","errorHint":"availability"},"failureCode":"ONDA_HTTP_STATUS_INVALID"}
{"claimedAt":"2026-09-27T23:58:00.072Z","mode":"armed"}
// Worker C · Court 5 · .local/api-booking/api-first-journals/1fda8bc07fa6…/
{"key":"1fda8bc07fa62b1eb9eaca80b9ac7c132a0552f2b7aca0dd7df8def112be3a72","state":"rejected","createdAt":"2026-09-27T23:58:00.066Z","updatedAt":"2026-09-28T00:00:10.366Z","attempt":{"attemptId":"1fda8bc07fa62b1eb9eaca80b9ac7c132a0552f2b7aca0dd7df8def112be3a72","planFingerprint":"[REDACTED]","targetDate":"2026-09-30","courtIds":[5],"hourlyBoundaries":[{"startTime":"19:00","endTime":"20:00"},{"startTime":"20:00","endTime":"21:00"},{"startTime":"21:00","endTime":"22:00"}],"expectedBookingCount":3,"maximumAmount":2100,"stage":"armed","releaseMs":1790553600000,"dispatchDeadlineMs":1790553601000},"diagnostic":{"status":409,"category":"http-rejection","contentKind":"json","responseSource":"application","errorHint":"availability"},"failureCode":"ONDA_HTTP_STATUS_INVALID"}
{"claimedAt":"2026-09-27T23:58:00.071Z","mode":"armed"}
// Worker D · Court 4 · .local/api-booking/api-first-journals/6fe7e449f1c9…/
{"key":"6fe7e449f1c920513a1a9d6282a85b94b5c1ac5c3efff5244b87f9263a6fee10","state":"rejected","createdAt":"2026-09-27T23:58:00.066Z","updatedAt":"2026-09-28T00:00:12.105Z","attempt":{"attemptId":"6fe7e449f1c920513a1a9d6282a85b94b5c1ac5c3efff5244b87f9263a6fee10","planFingerprint":"[REDACTED]","targetDate":"2026-09-30","courtIds":[4],"hourlyBoundaries":[{"startTime":"19:00","endTime":"20:00"},{"startTime":"20:00","endTime":"21:00"},{"startTime":"21:00","endTime":"22:00"}],"expectedBookingCount":3,"maximumAmount":2100,"stage":"armed","releaseMs":1790553600000,"dispatchDeadlineMs":1790553601000},"diagnostic":{"status":409,"category":"http-rejection","contentKind":"json","responseSource":"application","errorHint":"availability"},"failureCode":"ONDA_HTTP_STATUS_INVALID"}
{"claimedAt":"2026-09-27T23:58:00.072Z","mode":"armed"}
// Worker E · Court 3 · .local/api-booking/api-first-journals/19f00779166b…/
{"key":"19f00779166b47b4997bce71a6a03efd7a11e03b9d0781090322bfd83ff18488","state":"rejected","createdAt":"2026-09-27T23:58:00.066Z","updatedAt":"2026-09-28T00:00:09.887Z","attempt":{"attemptId":"19f00779166b47b4997bce71a6a03efd7a11e03b9d0781090322bfd83ff18488","planFingerprint":"[REDACTED]","targetDate":"2026-09-30","courtIds":[3],"hourlyBoundaries":[{"startTime":"19:00","endTime":"20:00"},{"startTime":"20:00","endTime":"21:00"},{"startTime":"21:00","endTime":"22:00"}],"expectedBookingCount":3,"maximumAmount":2100,"stage":"armed","releaseMs":1790553600000,"dispatchDeadlineMs":1790553601000},"diagnostic":{"status":409,"category":"http-rejection","contentKind":"json","responseSource":"application","errorHint":"availability"},"failureCode":"ONDA_HTTP_STATUS_INVALID"}
{"claimedAt":"2026-09-27T23:58:00.071Z","mode":"armed"}
// Worker F · Court 2 · .local/api-booking/api-first-journals/2743d5629aaf…/
{"key":"2743d5629aafc0e8f4ba2c5e0117bca90a1e47b06a7f560981b90eddce319b93","state":"rejected","createdAt":"2026-09-27T23:58:00.066Z","updatedAt":"2026-09-28T00:00:10.428Z","attempt":{"attemptId":"2743d5629aafc0e8f4ba2c5e0117bca90a1e47b06a7f560981b90eddce319b93","planFingerprint":"[REDACTED]","targetDate":"2026-09-30","courtIds":[2],"hourlyBoundaries":[{"startTime":"19:00","endTime":"20:00"},{"startTime":"20:00","endTime":"21:00"},{"startTime":"21:00","endTime":"22:00"}],"expectedBookingCount":3,"maximumAmount":2100,"stage":"armed","releaseMs":1790553600000,"dispatchDeadlineMs":1790553601000},"diagnostic":{"status":409,"category":"http-rejection","contentKind":"json","responseSource":"application","errorHint":"availability"},"failureCode":"ONDA_HTTP_STATUS_INVALID"}
{"claimedAt":"2026-09-27T23:58:00.072Z","mode":"armed"}
// Worker G · Court 1 · .local/api-booking/api-first-journals/9c2763657e2a…/
{"key":"9c2763657e2a5b7a02a9fa4fee4c3300439b0d5477fe991992aac8d7067762bb","state":"rejected","createdAt":"2026-09-27T23:58:00.066Z","updatedAt":"2026-09-28T00:00:12.110Z","attempt":{"attemptId":"9c2763657e2a5b7a02a9fa4fee4c3300439b0d5477fe991992aac8d7067762bb","planFingerprint":"[REDACTED]","targetDate":"2026-09-30","courtIds":[1],"hourlyBoundaries":[{"startTime":"19:00","endTime":"20:00"},{"startTime":"20:00","endTime":"21:00"},{"startTime":"21:00","endTime":"22:00"}],"expectedBookingCount":3,"maximumAmount":2100,"stage":"armed","releaseMs":1790553600000,"dispatchDeadlineMs":1790553601000},"diagnostic":{"status":409,"category":"http-rejection","contentKind":"json","responseSource":"application","errorHint":"availability"},"failureCode":"ONDA_HTTP_STATUS_INVALID"}
{"claimedAt":"2026-09-27T23:58:00.072Z","mode":"armed"}
```

### Appendix O — Clock evidence, verbatim

```json
// .local/network-clock-evidence/2026-09-27T23-50-00-278Z-T-10M.json
{
  "checkpoint": "T-10M",
  "capturedAt": "2026-09-27T23:50:00.278Z",
  "method": "ntp-consensus-v1",
  "offsetMs": 34.798095703125,
  "sampleCount": 10,
  "keptCount": 10,
  "rejectedCount": 0,
  "minRoundTripMs": 43,
  "medianRoundTripMs": 51,
  "maxRoundTripMs": 76,
  "spreadMs": 17.283935546875,
  "uncertaintyMs": 21.896484375,
  "quality": "GOOD",
  "bestHost": "time4.google.com",
  "samples": [
    {
      "host": "time.google.com",
      "offsetMs": 49.2,
      "roundTripMs": 76,
      "kept": true
    },
    {
      "host": "time1.google.com",
      "offsetMs": 36.9,
      "roundTripMs": 54,
      "kept": true
    },
    {
      "host": "time2.google.com",
      "offsetMs": 35.1,
      "roundTripMs": 57,
      "kept": true
    },
    {
      "host": "time3.google.com",
      "offsetMs": 35,
      "roundTripMs": 59,
      "kept": true
    },
    {
      "host": "time4.google.com",
      "offsetMs": 36,
      "roundTripMs": 57,
      "kept": true
    },
    {
      "host": "time.google.com",
      "offsetMs": 31.9,
      "roundTripMs": 48,
      "kept": true
    },
    {
      "host": "time1.google.com",
      "offsetMs": 34.6,
      "roundTripMs": 44,
      "kept": true
    },
    {
      "host": "time2.google.com",
      "offsetMs": 34.5,
      "roundTripMs": 44,
      "kept": true
    },
    {
      "host": "time3.google.com",
      "offsetMs": 33.9,
      "roundTripMs": 44,
      "kept": true
    },
    {
      "host": "time4.google.com",
      "offsetMs": 34.4,
      "roundTripMs": 43,
      "kept": true
    }
  ]
}
// .local/network-clock-evidence/2026-09-27T23-59-00-191Z-T-60S.json
{
  "checkpoint": "T-60S",
  "capturedAt": "2026-09-27T23:59:00.191Z",
  "method": "ntp-consensus-v1",
  "offsetMs": 39.779541015625,
  "sampleCount": 10,
  "keptCount": 10,
  "rejectedCount": 0,
  "minRoundTripMs": 42,
  "medianRoundTripMs": 48,
  "maxRoundTripMs": 65,
  "spreadMs": 8.892333984375,
  "uncertaintyMs": 21.31787109375,
  "quality": "GOOD",
  "bestHost": "time.google.com",
  "samples": [
    {
      "host": "time.google.com",
      "offsetMs": 40.5,
      "roundTripMs": 47,
      "kept": true
    },
    {
      "host": "time1.google.com",
      "offsetMs": 40.1,
      "roundTripMs": 48,
      "kept": true
    },
    {
      "host": "time2.google.com",
      "offsetMs": 41.4,
      "roundTripMs": 47,
      "kept": true
    },
    {
      "host": "time3.google.com",
      "offsetMs": 45.1,
      "roundTripMs": 65,
      "kept": true
    },
    {
      "host": "time4.google.com",
      "offsetMs": 41.3,
      "roundTripMs": 47,
      "kept": true
    },
    {
      "host": "time.google.com",
      "offsetMs": 39.5,
      "roundTripMs": 42,
      "kept": true
    },
    {
      "host": "time1.google.com",
      "offsetMs": 36.2,
      "roundTripMs": 50,
      "kept": true
    },
    {
      "host": "time2.google.com",
      "offsetMs": 37,
      "roundTripMs": 48,
      "kept": true
    },
    {
      "host": "time3.google.com",
      "offsetMs": 37.2,
      "roundTripMs": 48,
      "kept": true
    },
    {
      "host": "time4.google.com",
      "offsetMs": 37.1,
      "roundTripMs": 48,
      "kept": true
    }
  ]
}
// .local/network-clock-evidence/2026-09-27T23-59-30-188Z-T-30S.json
{
  "checkpoint": "T-30S",
  "capturedAt": "2026-09-27T23:59:30.188Z",
  "method": "ntp-consensus-v1",
  "offsetMs": 39.0162353515625,
  "sampleCount": 10,
  "keptCount": 10,
  "rejectedCount": 0,
  "minRoundTripMs": 43,
  "medianRoundTripMs": 48,
  "maxRoundTripMs": 52,
  "spreadMs": 3.51611328125,
  "uncertaintyMs": 21.8568115234375,
  "quality": "GOOD",
  "bestHost": "time.google.com",
  "samples": [
    {
      "host": "time.google.com",
      "offsetMs": 39.4,
      "roundTripMs": 43,
      "kept": true
    },
    {
      "host": "time1.google.com",
      "offsetMs": 38.9,
      "roundTripMs": 46,
      "kept": true
    },
    {
      "host": "time2.google.com",
      "offsetMs": 39.8,
      "roundTripMs": 43,
      "kept": true
    },
    {
      "host": "time3.google.com",
      "offsetMs": 36.9,
      "roundTripMs": 49,
      "kept": true
    },
    {
      "host": "time4.google.com",
      "offsetMs": 39.7,
      "roundTripMs": 44,
      "kept": true
    },
    {
      "host": "time.google.com",
      "offsetMs": 37.8,
      "roundTripMs": 51,
      "kept": true
    },
    {
      "host": "time1.google.com",
      "offsetMs": 38.6,
      "roundTripMs": 50,
      "kept": true
    },
    {
      "host": "time2.google.com",
      "offsetMs": 40.4,
      "roundTripMs": 47,
      "kept": true
    },
    {
      "host": "time3.google.com",
      "offsetMs": 39.1,
      "roundTripMs": 50,
      "kept": true
    },
    {
      "host": "time4.google.com",
      "offsetMs": 38.4,
      "roundTripMs": 52,
      "kept": true
    }
  ]
}
// .local/network-clock.json
{
  "source": "time4.google.com",
  "offsetMs": 34.798095703125,
  "roundTripMs": 43,
  "synchronizedAt": "2026-09-27T23:50:00.277Z",
  "method": "ntp-consensus-v1",
  "sampleCount": 10,
  "keptCount": 10,
  "spreadMs": 17.283935546875,
  "uncertaintyMs": 21.896484375,
  "quality": "GOOD"
}
```

### Appendix P — Arbitration manifest and analyzer report, verbatim

```json
{
  "schema": "wave1-experiment-manifest/v2",
  "analysisSchema": "wave1-arbitration-analysis/v2.1.0",
  "createdAt": "2026-09-27T23:35:25.305Z",
  "createdBy": "DESKTOP_ARM",
  "hypothesisSpecVersion": "wave1-arbitration-hypotheses/v2.0.0",
  "runId": "UNBOUND_PRE_RUN",
  "releaseMs": 1790553600000,
  "targetDate": "2026-09-30",
  "wave1Candidates": null,
  "wave1CandidateSource": "RUNNER_PHASE3_FREEZE_WRITTEN_BEFORE_RELEASE",
  "knownPreReleaseConflictSource": "UNKNOWN: no Slot Watch evidence supplied",
  "clockQuality": null,
  "expectedEvidenceSources": [
    "run-progress",
    "slot-watch",
    "provider-trace",
    "critical-path",
    "journals",
    "clock-evidence",
    "release-forensics",
    "response-evidence"
  ],
  "safety": {
    "readOnlyManifest": true,
    "changesBookingPlan": false,
    "addsCheckoutTraffic": false
  }
}
```

```markdown
# Wave 1 arbitration report — e3f7de87-d1d5-4949-9ddc-4cc49529cfa7

# Executive result

POOR: 1/7 Wave 1 attempts are meaningful contest samples. The report separates known/impossible attempts from contestable attempts and does not identify a single provider mechanism as proven.

# Experiment quality

- Label: POOR
- Useful contest samples: 1
- Missing sources: none

## Evidence Association

- Run progress: MATCH — requested run ID + RUN_CONFIGURATION; selected: api-booking/run-progress/e3f7de87-d1d5-4949-9ddc-4cc49529cfa7.ndjson; confidence: HIGH
- Slot Watch: MATCH — exact target date + release instant + started with this runner (within 10 s); selected: slot-watch/2026-09-30_ffe896ed-9c1f-43c7-9ce9-7767b6d12d49.ndjson; confidence: HIGH; rejected: 16 candidate(s); see analysis.json
- Provider trace: MATCH — embedded run ID; selected: release-forensics/e3f7de87-d1d5-4949-9ddc-4cc49529cfa7/provider-trace.ndjson; confidence: HIGH
- Critical path: MATCH — embedded run ID; selected: release-forensics/e3f7de87-d1d5-4949-9ddc-4cc49529cfa7/critical-path.ndjson; confidence: HIGH
- Clock evidence: MATCH — each file matches a clock event in this run's progress log; selected: network-clock-evidence/2026-09-27T23-50-00-278Z-T-10M.json, network-clock-evidence/2026-09-27T23-59-00-191Z-T-60S.json, network-clock-evidence/2026-09-27T23-59-30-188Z-T-30S.json; confidence: HIGH; rejected: network-clock-evidence/2026-09-24T23-50-00-299Z-T-10M.json (T-10M captured outside its current-release window (nominal checkpoint to release)), network-clock-evidence/2026-09-24T23-59-00-190Z-T-60S.json (T-60S captured outside its current-release window (nominal checkpoint to release)), network-clock-evidence/2026-09-24T23-59-30-180Z-T-30S.json (T-30S captured outside its current-release window (nominal checkpoint to release)), network-clock-evidence/2026-09-25T23-50-00-316Z-T-10M.json (T-10M captured outside its current-release window (nominal checkpoint to release)), network-clock-evidence/2026-09-25T23-59-00-176Z-T-60S.json (T-60S captured outside its current-release window (nominal checkpoint to release)), network-clock-evidence/2026-09-25T23-59-30-188Z-T-30S.json (T-30S captured outside its current-release window (nominal checkpoint to release))
- Journals: MATCH — attempt.releaseMs exactly matches runner release; selected: api-booking/api-first-journals/19f00779166b47b4997bce71a6a03efd7a11e03b9d0781090322bfd83ff18488/19f00779166b47b4997bce71a6a03efd7a11e03b9d0781090322bfd83ff18488.json, api-booking/api-first-journals/1fda8bc07fa62b1eb9eaca80b9ac7c132a0552f2b7aca0dd7df8def112be3a72/1fda8bc07fa62b1eb9eaca80b9ac7c132a0552f2b7aca0dd7df8def112be3a72.json, api-booking/api-first-journals/2743d5629aafc0e8f4ba2c5e0117bca90a1e47b06a7f560981b90eddce319b93/2743d5629aafc0e8f4ba2c5e0117bca90a1e47b06a7f560981b90eddce319b93.json, api-booking/api-first-journals/46dbfff25881e6d4a55957d492ba73da6d2df719f5f5e695178cd6b84973ce45/46dbfff25881e6d4a55957d492ba73da6d2df719f5f5e695178cd6b84973ce45.json, api-booking/api-first-journals/6fe7e449f1c920513a1a9d6282a85b94b5c1ac5c3efff5244b87f9263a6fee10/6fe7e449f1c920513a1a9d6282a85b94b5c1ac5c3efff5244b87f9263a6fee10.json, api-booking/api-first-journals/9c2763657e2a5b7a02a9fa4fee4c3300439b0d5477fe991992aac8d7067762bb/9c2763657e2a5b7a02a9fa4fee4c3300439b0d5477fe991992aac8d7067762bb.json, api-booking/api-first-journals/d1b1010ccf67743e9460911b416e143b6e83d6acdf8ec87f6fac7a4f0dd558f8/d1b1010ccf67743e9460911b416e143b6e83d6acdf8ec87f6fac7a4f0dd558f8.json; confidence: HIGH; rejected: 74 candidate(s); see analysis.json
- Release forensics: MATCH — release-forensics directory named by run ID; selected: release-forensics/e3f7de87-d1d5-4949-9ddc-4cc49529cfa7/summary.json; confidence: HIGH
- Experiment manifest: MATCH — pre-run unbound manifest + matching release + target date + created before runner start; selected: arbitration-manifests/2026-09-30_1790553600000/experiment-manifest.json; confidence: MEDIUM; limitations: Manifest was created before the runner assigned its run ID; release instant and target date provide the association.

# Wave 1 timing

Chrome/network start summary: {"n":7,"min":-45.59,"p50":-0.78,"p95":4.83,"p99":4.83,"max":4.83,"mean":-8.56}.

# Target-by-target timeline

# Wave 1 canonical timeline — e3f7de87-d1d5-4949-9ddc-4cc49529cfa7

Release: 2026-09-28T00:00:00.000Z  
Target: 2026-09-30

| Worker | Target | Contest class | Chrome start | Arrival candidate | Provider response | Reason | Disappearance bound | First booking visibility |
|---|---|---|---:|---:|---:|---|---|---|
| C | C5 19:00 +3h | UNKNOWN_AT_RELEASE | -45.59 ms | -23 ms (UNDOCUMENTED) | 10327.5 ms | OVERLAPS_EXISTING_BOOKING | ?…6093.8 ms | -59602.2…2844.8 ms |
| B | C6 19:00 +3h | UNKNOWN_AT_RELEASE | -20.92 ms | 5 ms (UNDOCUMENTED) | 8064.1 ms | OVERLAPS_EXISTING_BOOKING | ?…6093.8 ms | -59602.2…2844.8 ms |
| A | C7 19:00 +3h | CONFIRMED_CONTESTABLE_FROM_FIRST_PUBLISHED_STATE | -5.98 ms | 17 ms (UNDOCUMENTED) | 10578.1 ms | OVERLAPS_EXISTING_BOOKING | 15097.8…16098.8 ms | 10752.8…30296.8 ms |
| D | C4 19:00 +3h | UNKNOWN_AT_RELEASE | -0.78 ms | 25 ms (UNDOCUMENTED) | 12088.1 ms | OVERLAPS_EXISTING_BOOKING | ?…6093.8 ms | 2844.8…10752.8 ms |
| G | C1 19:00 +3h | UNKNOWN_AT_RELEASE | 4.83 ms | 31 ms (UNDOCUMENTED) | 12108.9 ms | OVERLAPS_EXISTING_BOOKING | ?…6093.8 ms | -59602.2…2844.8 ms |
| E | C3 19:00 +3h | UNKNOWN_AT_RELEASE | 4.23 ms | 27 ms (UNDOCUMENTED) | 9846.1 ms | OVERLAPS_EXISTING_BOOKING | ?…6093.8 ms | -59602.2…2844.8 ms |
| F | C2 19:00 +3h | UNKNOWN_AT_RELEASE | 4.29 ms | 30 ms (UNDOCUMENTED) | 10425.6 ms | OVERLAPS_EXISTING_BOOKING | ?…6093.8 ms | -59602.2…2844.8 ms |

Every interval is a bound. No first-seen value is treated as provider commit time.

# Contestable-only ordering

n=1; quality=INSUFFICIENT; Kendall tau=UNKNOWN; Spearman=UNKNOWN; inversions=0; ties=0.
For n=2 or n=3 this is descriptive only. The Vercel timestamp candidate is INFERENCE / UNDOCUMENTED.

# Response reason analysis

- OVERLAPS_EXISTING_BOOKING: 7; provider wait {"n":7,"min":8078.2,"p50":10419.2,"p95":12100.7,"p99":12100.7,"max":12100.7,"mean":10496.2}; contest classes {"UNKNOWN_AT_RELEASE":6,"CONFIRMED_CONTESTABLE_FROM_FIRST_PUBLISHED_STATE":1}.

# Inventory disappearance windows

See `timeline.md` and `analysis.json`; bounds remain intervals.

# Public booking visibility

First-seen booking records are compared with send and response bounds. They are not treated as customer identity or internal commit time.

# Read path analysis

Raw provider matrices are retained separately from analytic transitions. Strong state-regression cases: 0; additional expiry-derived INFERENCE cases: 13.

# Slow-read flush relationships

Qualifying flushes: 0. Temporal proximity is reported without a causal claim.

# Hold commit timing if successful

No successful hold was recorded; commit position is UNKNOWN.

# Existing model replay results

No replay result was supplied. Run `npm run arbitration:replay -- --analysis <analysis.json>`; the v2 simulator input is embedded in `analysis.json`.

# Cross-release recurrence

| Release | Attempts | Contestable | Quality | Provider wait | Stale/regressive | Slow flushes |
|---|---:|---:|---|---|---:|---:|
| 2026-09-23 | 2 | UNKNOWN | UNKNOWN | {"min":11496,"max":13288} | UNKNOWN direct + ? inferred | UNKNOWN |
| 2026-09-24 | 3 | 0 | POOR | {"min":17625,"max":28365} | 0 direct + 0 inferred | 0 |
| 2026-09-25 | 7 | 7 | CLEAN | {"min":29098.2,"max":34609.3} | 26 direct + 6 inferred | 2 |
| 2026-09-26 | 6 | 2 | POOR | {"min":6848.7,"max":13988.6} | 0 direct + 13 inferred | 0 |
| 2026-09-28 | 7 | 1 | POOR | {"min":8078.2,"max":12100.7} | 0 direct + 13 inferred | 0 |

# Hypothesis assessments

- H1 ARRIVAL_SENSITIVE_SHARED_ADMISSION_OR_FIFO_LIKE_QUEUE: INSUFFICIENT. Evaluated against wave1-arbitration-hypotheses/v2.0.0. Contestable sample is too small or mixed for a strong FIFO conclusion.
- H2 FACILITY_DATE_SERIALIZATION_OR_SHARED_CURRENT_STATE_BOTTLENECK: NEUTRAL. No qualifying slow-read flush was observed, or read evidence was missing.
- H3 BACKEND_ADMISSION_OR_INSTANCE_SPLIT: SUPPORTING. 0 contest-order inversion(s); 13 state-regression case(s).
- H4 PER_COURT_SERIALIZATION: INSUFFICIENT. No same-court contestable pair; per-court serialization is not testable.
- H5 SPLIT_OR_STALE_READ_PATH: SUPPORTING. 13 raw state-regression case(s) were preserved separately from analytic state.

# What this run established

- Recorded facts, bounded inferences and hypotheses remain distinct.
- Contestability is separated before order analysis.

# What this run weakened

- Only hypotheses with a CONTRADICTING assessment are weakened, and only within the stated evidence quality.

# What remains unresolved

- Provider queue entry, database lock acquisition, instance identity and internal commit time are not externally observable.
- Public booking first-seen time is a visibility bound, not internal commit time.
- The Vercel embedded timestamp candidate remains UNDOCUMENTED.

# What evidence would be needed next

- Another clean release with at least four genuinely contestable Wave 1 attempts.
- Recurrent ordering, read-flush and state-regression signatures under the same pre-registered rules.
- A successful legitimate hold would add an approximate commit-position bound without extra traffic.
```

### Appendix Q — Release Intelligence summary, verbatim

```
Release Intelligence v1 · generated 2026-09-28T00:15:00.913Z
Derived from local raw artifacts; delete and rebuild at any time. Counts are observations, not probabilities.
Quality: GOOD = first published read answered by +3 s, complete and cache MISS; FAIR = by +10 s and complete; POOR = later, incomplete or counts only; NONE = not observed.

2026-09-22T00:00:00.000Z · target 2026-09-24 (Thursday) · HISTORICAL_PRE_PHASE3 · quality NONE
  - No published availability was observed after release.
  Outcome: API_NO_AVAILABLE_CANDIDATE
  Transitions: 0 open→unavailable, 0 reopened (0 cache-uncertain)

2026-09-23T00:00:00.000Z · target 2026-09-25 (Friday) · HISTORICAL_PRE_PHASE3 · quality POOR
  - Only availability counts were recorded; there is no court/hour grid.
  - The first published read answered at +6.0 s (after +3 s).
  - Cache provenance was not recorded: the age of that answer is uncertain.
  Runner availability counts only: first published answer +6.017 s
  Attempts: immediate E POST — → REJECTED; immediate F POST — → REJECTED
  Outcome: SPECIAL_SESSION_NOT_AVAILABLE
  Transitions: 0 open→unavailable, 0 reopened (0 cache-uncertain)
  Note: Historical, before the current release architecture (Special Friday run).
  Note: The target date was not observed before release, and no court/hour grid was recorded; only runner availability counts exist.
  Note: The first useful released availability answered about +6.0 s after release.
  Note: The requested plan could not use other open inventory that existed at release. Later openings may be visible in the counts; no win is implied.
  Note: Unavailable cells without a public booking record at publication have an unknown cause.

2026-09-24T00:00:00.000Z · target 2026-09-26 (Saturday) · HISTORICAL_PRE_PHASE3 · quality POOR
  - The first published read answered at +15.7 s, later than +10 s: it is not release-instant evidence.
  - Cache provenance was not recorded: the age of that answer is uncertain.
  First published grid: requested +11.293 s, answered +15.744 s · 55 open / 57 unavailable / 0 unknown
  Attempts: immediate D court 6 15:00 POST +0.100 s → 409; immediate C court 5 15:00 POST +0.101 s → 409; immediate A court 3 15:00 POST +0.104 s → 409; immediate B court 4 15:00 POST — → IDENTITY_FAILED
  Outcome: OBJECTIVE_NOT_ACHIEVED_ALL_REJECTED
  Transitions: 49 open→unavailable, 15 reopened (15 cache-uncertain)
  Note: Historical, before the current release architecture (Precision v1 run).
  Note: Worker B was excluded for that run (duplicate customer identity at the time). Workers A, C and D sent about +0.10 s after release.
  Note: All sent attempts were rejected after slow provider responses (about 17.5 to 28.3 s).
  Note: The release-instant grid was not captured: the old observer answered its first published read long after release.
  Note: Later unavailable cells without a public booking record have an unknown cause.

2026-09-25T00:00:00.000Z · target 2026-09-27 (Sunday) · REAL_RELEASE · quality FAIR
  - The first published read answered at +4.1 s (after +3 s).
  First published grid: requested +0.016 s, answered +4.142 s · 107 open / 5 unavailable / 0 unknown
  Attempts: immediate A court 7 19:00 POST +0.010 s → 409; immediate B court 6 19:00 POST +0.011 s → 409; immediate C court 5 19:00 POST +0.011 s → 409; immediate D court 4 19:00 POST +0.011 s → 409; immediate F court 2 15:00 POST +0.011 s → 409; immediate E court 3 19:00 POST +0.012 s → 409; immediate G court 1 15:00 POST +0.012 s → 409
  Outcome: ALL_REJECTED_WAITING_FOR_REOPEN
  Transitions: 95 open→unavailable, 79 reopened (0 cache-uncertain)

2026-09-26T00:00:00.000Z · target 2026-09-28 (Monday) · REAL_RELEASE · quality GOOD
  - First published read answered by +1.5 s, complete, uncached.
  First published grid: requested +0.017 s, answered +1.462 s · 75 open / 37 unavailable / 0 unknown
  Attempts: immediate B court 5 19:00 POST +0.008 s → 409; immediate C court 1 19:00 POST +0.008 s → 409; immediate A court 4 19:00 POST +0.009 s → 409; immediate D court 2 17:00 POST +0.009 s → 409; immediate F court 3 17:00 POST +0.009 s → 409; immediate E court 2 20:00 POST +0.010 s → 409
  Outcome: ALL_REJECTED_WAITING_FOR_REOPEN
  Transitions: 25 open→unavailable, 24 reopened (0 cache-uncertain)

2026-09-28T00:00:00.000Z · target 2026-09-30 (Wednesday) · REAL_RELEASE · quality FAIR
  - The first published read answered at +6.1 s (after +3 s).
  - Cache status HIT: the age of that answer is not bounded.
  First published grid: requested +6.014 s, answered +6.094 s · 77 open / 35 unavailable / 0 unknown
  Attempts: immediate C court 5 19:00 POST −0.046 s → 409; immediate B court 6 19:00 POST −0.021 s → 409; immediate A court 7 19:00 POST −0.006 s → 409; immediate D court 4 19:00 POST −0.001 s → 409; immediate G court 1 19:00 POST +0.008 s → 409; immediate E court 3 19:00 POST +0.009 s → 409; immediate F court 2 19:00 POST +0.009 s → 409
  Outcome: ALL_REJECTED_WAITING_FOR_REOPEN
  Transitions: 28 open→unavailable, 34 reopened (34 cache-uncertain)

Skipped artifacts: 2026-09-26_0cb886f9-a705-4748-ac90-da8130a72747.ndjson (NO_READS), 2026-09-26_20a3805e-f957-471b-a093-acffae751c84.ndjson (NO_READS), 2026-09-26_785f2fc9-cecf-4fae-bb5d-1d34fd15e2c1.ndjson (NO_READS), 2026-09-26_f337db15-c690-436f-a16d-57c26d5bd009.ndjson (NO_READS), 2026-09-27_108ad87f-0cc0-4bb8-8b4a-ea515784a71b.ndjson (NO_READS), 2026-09-27_575165ee-3243-4c4e-8220-adb39a2cf4ec.ndjson (NO_READS), 2026-09-27_5786bdb0-ddd1-4128-8912-80a3abebe006.ndjson (NO_READS), 2026-09-27_9d19e89c-9756-47c3-ba9b-6ea035d2851d.ndjson (NO_READS), 2026-09-27_9e52ff6a-2191-4552-bd64-d2a9d21b3406.ndjson (NO_READS), 2026-09-27_b18d5498-55ed-4e1e-8fcb-1ef41991b28d.ndjson (NO_READS), 2026-09-27_c3e74423-413c-4e75-ba1f-867ae366607a.ndjson (NO_READS), 2026-09-27_e76f6629-4be4-4cd6-b601-8bab429462c6.ndjson (NO_READS), 2026-09-28_bcba2d86-f2b3-4db6-b822-5ece7cf7fe3c.ndjson (NO_READS)
```
