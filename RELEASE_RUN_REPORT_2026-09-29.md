# Release Run Report: 2026-09-29 08:00 (target Thu 2026-10-01)

All times are Manila (UTC+8) on the trusted network clock. The release instant was 08:00:00.000. "+x s" means seconds after release. Sources are the local run logs listed in [Sources](#sources). Nothing here was taken from private request or response bodies, apart from Onda's one-line error text.

## Update, 09:55 the same day: fix proven live, two follow-up bugs fixed

- **Live proof.** An off-peak Proofless test booked **Wed 09-30, Court 5, 22:00–00:00** (worker A, 2 h). Onda returned HTTP 200 with a verified pending hold in 928 ms, and the official QRPH page opened. Onda's public bookings list shows the hold as `22:00:00–23:00:00` and `23:00:00–00:00:00`, both pending. It was left unpaid to expire at 10:05:13.
- **The fix as first merged (87e8cdb) would still have failed tomorrow.** Journal and permit keys keep `24:00`, but the transport rebuilt the key from the payload's new `00:00` end. The transport then threw `SUBMISSION_PERMIT_INVALID_OR_USED` before sending; the first test attempt (Court 6) failed this way, provably unsent. `armed-dispatch.ts` would also have refused to arm any midnight-ending Precision target. Fixed in c3e0408: `requestKey()` maps a `00:00` end back to `24:00`. Regression tests fail without the fix and pass with it.
- **Fan-out broke Test runs.** With `PRECISION_FAN_OUT` saved on, a Proofless Test run keyed its browser transports `A:0`… but looked up `A`, and stopped with `API_CHECKOUT_WORKER_MISSING` before dispatch. Fan-out now applies only to Fixed Precision runs (c3e0408).
- **Installed app.** These fixes reach the exe only after `npm run exe:build`, which needs the app closed.

## Bottom line

- **Result:** 0 holds. Onda answered **all 28 checkout POSTs** (7 workers × 4 fan-out attempts) with **HTTP 400 `Invalid booking session time`**.
- **Root cause (our bug, not Onda):** every target was 21:00–24:00. The checkout request sent the end of the 23:00 hour as `"24:00"`. Onda's own availability feed writes that boundary as `"00:00"`. Earlier releases targeted 17:00–23:00, so this was the first live target that ended at midnight, and nothing had ever exercised it.
- **Fix status:** fixed at 08:09, after the run, by `ondaCheckoutBoundary()` in `src/api-booking/public-checkout.ts` (both checkout builders). It was rebuilt into the exe at 08:12. Its permit-key follow-up (c3e0408) and a live test at 09:55 are described in the update above.
- **Why this one hurts:** the target was right. At first publication, 21:00–24:00 was **open on all seven courts**. Our POSTs reached Vercel between −1 ms and +31 ms. Onda answered them at +1.1 to +6.6 s, before any competing 21:00–23:00 record was visible on most courts (competing records first appeared between +4 and +10 s). This was the strongest position the bot has had at any release. A valid payload would probably have won at least one court. That is an inference, not proof (see [Was it winnable?](#was-it-winnable)).
- **Follow-on effects:** the 400s were classified as UNKNOWN ("may have been sent; do not retry"), so the run ended at +6.9 s as `OBJECTIVE_NOT_CONFIRMED_MANUAL_RECONCILIATION`. This plan type (Fixed Precision + fan-out) has no Wave 2/Rescue lane anyway. At about +606 s, C3 and C7 21:00–24:00 reopened and **stayed open at least 141 s**, until Slot Watch was cut off at +747 s.

## Run identity

| Item | Value |
|---|---|
| Booking run (UI) | `2039d807` (label `full`, armed 07:33:45) |
| API run | `06efdcad` (mode live, proofless, 7 workers) |
| Slot Watch | `5ca0c711` (started 07:33:44, last read +747 s) |
| Arbitration manifest | `2026-10-01_1790640000000` (pre-registered 07:33:45) |
| Plan | Fixed Precision, **fan-out on** (4 child attempts per worker, each with its own "Send early by"), Proofless Direct, Standard, 3 h |
| Build used live | `2ce3077` (main) plus uncommitted work: Release Lab, bounded-cache evidence, Slot Watch upgrades and Fixed Precision fan-out. The build contained fan-out (source last edited 07:26) and was armed at 07:33. It did **not** contain the 08:09 midnight fix. The exact build record was overwritten by the 08:12 rebuild. |
| Installed build now | Built 08:12:37, `2ce3077`, branch `feature/release-lab-v1`, dirty (includes the midnight fix) |
| PC clock | About **750 ms fast**. NTP consensus offset was −752 / −747.4 / −746.2 ms at T−10 min / T−60 s / T−30 s, 10 samples, RTT 42 ms, ±21 ms. The correction was applied. (09-26: 373 ms slow. 09-28: 39 ms behind.) |

### Targets and configured offsets

| Worker | Court | Window | Fan-out "Send early by" (ms) |
|---|---|---|---|
| A | 7 | 21:00–24:00 | −35, −30, −25, −10 |
| B | 6 | 21:00–24:00 | −35, −30, −20, −15 |
| C | 5 | 21:00–24:00 | −35, −30, −25, 0 |
| D | 4 | 21:00–24:00 | −35, −30, −25, −20 |
| E | 3 | 21:00–24:00 | −35, −30, −25, 0 |
| F | 2 | 21:00–24:00 | −35, −30, −15, 0 |
| G | 1 | 21:00–24:00 | −35, −30, −25, 0 |

The pre-release block audit at 07:14 showed Open 0, Blocked 28 and Unreleased 84. The 28 blocked cells were 17:00–21:00 on every court (public records visible at −60 s). **21:00–24:00 was therefore the only 3-hour evening window without a known booking**, so the target choice was correct.

## Timeline

| Time | Event |
|---|---|
| 07:14:44 | Block audit for 10-01: Open 0 · Blocked 28 · Unreleased 84 |
| 07:33:16 | Prepare; 7 browsers ready |
| 07:33:45 | Full run armed; arbitration manifest created automatically |
| 07:50:00 (T−10 min) | Evidence for all 7 targets: "No known booking · target date not yet published". Clock refreshed, −752 ms. |
| 07:58:00 (T−2 min) | Freeze: 28 attempts frozen, 0 unsent; 24 non-zero offsets scheduled |
| 07:59:00 / 07:59:30 | Clock consensus −747.4 ms / −746.2 ms (±21 ms) |
| 07:59:44.97 (T−15.0 s) | 28 fresh checkout-security acquisitions start in parallel |
| T−7.4 s … T−3.2 s | Security ready (7.6–11.8 s each). The last one was ready **3.2 s** before release. |
| T−34.9 ms | Dispatch scheduler fires |
| T−4.2 ms … T+11.8 ms | 28 POSTs leave Chrome (Playwright request events) |
| T−1 ms … T+31 ms | Vercel edge receive stamps (the ms value embedded in `x-vercel-id`; undocumented) |
| +1.07 s | First response: F0 (Court 2), **400** |
| +2.0–2.5 s | Date published. The first cache entry (generated 00:00:02 UTC) shows 72 open and 40 taken, with **21:00–23:00 open on all 7 courts** |
| +2.77 … +6.55 s | Remaining 27 responses, all **400 `Invalid booking session time`** |
| +4 … +10 s | Competing **21:00–23:00 records** appear on all 7 courts (see table below) |
| +6.85 s | Race settled: 0 verified, 28 unknown, 0 rejected → `OBJECTIVE_NOT_CONFIRMED_MANUAL_RECONCILIATION` |
| +6.90 s | API process exit 1; UI shows `COMMAND_FAILED` and "Run finished: failed" |
| +13 s | 23:00 taken on C1/C2/C3/C7. C4/C5/C6 23:00 still open. |
| +150 s / +160 s | 23:00 taken on C4 and C6 / C5 |
| +604 … +606 s | 21:00–23:00 records disappear on C1/C2/C3/C7 (the 10-minute hold-expiry pattern for holds made at about +4–6 s); all four courts show 21:00–24:00 open at +606 s |
| +624 s / +636 s | C1 and C2 taken again |
| +606 … ≥+747 s | **C3 and C7 21:00–24:00 open** (C7 showed one record for a single read at +610 s). Nothing was running to act on it. |
| 08:12:27 (+747 s) | Slot Watch ends early (scheduled to +900 s). The app was closed for the 08:12 rebuild, so no Slot Watch summary or final forensics were written. |
| 08:27 | 7 bot Chrome windows closed (force-closed after not responding) |

## Root cause

**What was sent.** Each proofless checkout lists one item per hour. For a 21:00 start and 3 h, the items were 21:00–22:00, 22:00–23:00 and **23:00–24:00**. `prooflessRequest()` copied the plan's slot `endTime` (`"24:00"`) straight into the payload.

**What Onda said.** All 28 responses were identical: HTTP 400, `application/json`, 56-byte body, `error: "Invalid booking session time"`, `x-vercel-cache: MISS`, route `/api/bookings/public-checkout`, region sin1. No booking, hold or transaction ID was returned.

**Why this is the cause.** Onda's availability feed represents the end of the 23:00 hour as `"00:00"`. The codebase already knows this: `onda-availability.ts` accepts `end === 24 && endTime === '00:00'`, and `availability-parser.ts` normalizes `24:00 → 00:00`. The checkout builders were the one place that didn't convert. It is the only field that differed from every previously accepted payload shape, and Onda's error names the time.

**Why it wasn't caught.**
- Every earlier live target ended by 23:00.
- The plan validator correctly allows windows that end at 24:00 ("would end after midnight" only triggers above 24).
- No unit test serialized a midnight-ending plan.
- Pre-release checks (fleet validation, block audit, T−10 min evidence) never build or send a checkout body.

**The fix** (uncommitted until this push, written 08:09–08:11):
- `ondaCheckoutBoundary(time)` maps `"24:00"` to `"00:00"`. Both `prooflessRequest()` and `buildStandardPublicCheckoutRequest()` use it.
- The internal plan and journal keys keep `24:00`. Only the wire format changes.
- New tests assert that the 21:00+3 h payload is `[21–22, 22–23, 23–00:00]` and contains no `"24:00"`. They also check that a pending-hold response with a 21:00:00–00:00:00 session still validates, and that the journal reaches `verified`.

**Proven live at 09:55:** Onda accepted `22:00–00:00` (see the update at the top). The permit-key follow-up in c3e0408 was also required.

## Was it winnable?

**Availability.** The first published cache entry (+2.0–2.5 s) had 21:00, 22:00 and 23:00 open on every court. 17:00–21:00 was taken everywhere, and 08:00–12:00 was taken on C3–C5 with no public record.

**Our responses compared with the first competing record.** Public booking records were read on every court in parallel. "Absent" and "present" are the last read without, and the first read with, a 21:00–22:00 record for that court. Each read's window runs from its request start to that court's response.

| Court | Worker | Our 4 responses | Competing record absent in read | First read showing it |
|---|---|---|---|---|
| 7 | A | +2.88 … +3.72 s | +4.0 … +4.3 s | +8.0 … +8.3 s |
| 6 | B | +2.77 … +4.48 s | +4.0 … +4.4 s | +8.0 … +8.6 s |
| 5 | C | +2.89 … +6.55 s | +4.0 … +5.4 s | +8.0 … +8.9 s |
| 4 | D | +3.34 … +4.48 s | +4.0 … +5.7 s | +8.0 … +9.2 s |
| 3 | E | +3.82 … +4.17 s | +4.0 … +4.1 s | +8.0 … +8.7 s |
| 2 | F | +1.07 … +5.53 s | +4.0 … +4.2 s | +8.0 … +11.0 s |
| 1 | G | +3.29 … +4.60 s | +4.0 … +7.9 s | +8.0 … +8.6 s |

On Court 7, all four of our requests were answered before any competing Court 7 record existed. Courts 3, 6 and 2 were largely the same. Competing records covering 21:00–23:00 appeared on all seven courts within the same few seconds.

**Limits of this evidence.**
- A public record appears when a competitor's booking commits. Their request may already have been in flight, or mid-processing, when ours were answered.
- Onda does not answer in arrival order: on 09-26, requests that reached Vercel within about 1 ms were answered 7 s apart.
- The 400 may be produced earlier in Onda's handler than a real booking decision would be.

So this does not prove we would have won. It is the best circumstantial position recorded so far.

**23:00 visibility gap.** No public record ever appeared for any 23:00 cell, yet 23:00 turned unavailable on C1/C2/C3/C7 at +13 s and on C4/C5/C6 at +150/+160 s. `readPublicBookingRecords()` keeps only records with `start < end` as strings. A record ending `"00:00"` fails that check and is silently dropped. The cause of those 23:00 changes therefore can't be seen in this data.

## Dispatch timing under 4× fan-out

All 28 POSTs left within a 16 ms window and reached Vercel within 32 ms. However, **the configured per-attempt offsets were not honoured at the network level.** Requests went out in four bands set by fan-out index, whatever offset each attempt had:

| Fan-out index | Configured offsets | Node invocation | Chrome request event | Vercel edge stamp |
|---|---|---|---|---|
| 0 | all −35 | −34.7 … −30.3 ms | **−4.2 … −2.9 ms** | −1 … +5 ms |
| 1 | all −30 | −29.7 … −26.9 ms | **−1.7 … −0.7 ms** | +3 … +7 ms |
| 2 | −25 / −20 / −15 | −17.5 … −13.4 ms | **+8.6 … +9.9 ms** | +12 … +27 ms |
| 3 | −20 / −15 / −10 / 0 | −14.3 … +2.7 ms | **+11.4 … +11.8 ms** | +16 … +31 ms |

<details><summary>All 28 attempts</summary>

| Attempt | Court | Offset | Request event | Edge stamp | Response |
|---|---|---|---|---|---|
| A0 | 7 | −35 | −4.2 | −1 | +2.883 s |
| A1 | 7 | −30 | −1.7 | +3 | +3.291 s |
| A2 | 7 | −25 | +9.8 | +12 | +2.876 s |
| A3 | 7 | −10 | +11.5 | +20 | +3.716 s |
| B0 | 6 | −35 | −3.2 | 0 | +3.207 s |
| B1 | 6 | −30 | −1.0 | +4 | +2.771 s |
| B2 | 6 | −20 | +9.7 | +16 | +3.207 s |
| B3 | 6 | −15 | +11.6 | +16 | +4.481 s |
| C0 | 5 | −35 | −4.0 | +2 | +6.553 s |
| C1 | 5 | −30 | −1.6 | +5 | +3.912 s |
| C2 | 5 | −25 | +8.6 | +14 | +6.553 s |
| C3 | 5 | 0 | +11.4 | +30 | +2.887 s |
| D0 | 4 | −35 | −3.0 | +5 | +4.479 s |
| D1 | 4 | −30 | −0.8 | +7 | +3.336 s |
| D2 | 4 | −25 | +9.9 | +27 | +3.335 s |
| D3 | 4 | −20 | +11.8 | +27 | +3.738 s |
| E0 | 3 | −35 | −3.1 | +2 | +4.111 s |
| E1 | 3 | −30 | −0.9 | +6 | +4.164 s |
| E2 | 3 | −25 | +9.9 | +14 | +4.168 s |
| E3 | 3 | 0 | +11.8 | +31 | +3.815 s |
| F0 | 2 | −35 | −2.9 | +3 | +1.073 s |
| F1 | 2 | −30 | −0.7 | +6 | +5.532 s |
| F2 | 2 | −15 | +9.9 | +19 | +3.716 s |
| F3 | 2 | 0 | +11.7 | +30 | +4.944 s |
| G0 | 1 | −35 | −2.9 | +4 | +4.603 s |
| G1 | 1 | −30 | −0.8 | +7 | +4.364 s |
| G2 | 1 | −25 | +9.9 | +15 | +3.291 s |
| G3 | 1 | 0 | +11.6 | +31 | +3.715 s |

Request events and edge stamps are in ms. Edge stamps are Vercel's clock, and their meaning is undocumented.
</details>

- Nothing left Chrome as early as configured. The −35 ms attempts left at about −3 ms. Invocation-to-request lag was about 30 ms for the first band and 10–26 ms for the last. For comparison, on 09-28 with 7 single attempts (offsets −50…0), Chrome start was −45.6 … +4.8 ms.
- Under 28 simultaneous dispatches, the Node → Playwright → renderer path appears to serialise.
- It made no difference this morning, because the payload was the blocker, but the UI's "Send early by" values are not what happens under fan-out.
- Server wait (Chrome `waitMs`) was 1.09–6.57 s for a 400. On 09-28, 409s took 8.1–12.1 s. Onda's handler was congested, so even the validation error took seconds.

**Security-prep margin.** 28 parallel fresh acquisitions started at T−15.0 s and took 7.6–11.8 s. The last was ready at T−3.2 s. With 4× more contexts than before, the 15 s pre-warm lead has about 3 s to spare.

## Classification and run end

- `browser-session-transport.ts` treats only 409 and the "not available yet" message as confirmed application rejections. Any other non-200 becomes `ONDA_HTTP_STATUS_INVALID`, so all 28 attempts ended UNKNOWN / `SUBMISSION_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED` ("may have been sent; do not retry").
- The run then ended as `OBJECTIVE_NOT_CONFIRMED_MANUAL_RECONCILIATION`. The UI listed 28 identical-looking "UNKNOWN" lines (4 per worker), which hid the real, single cause.
- No reconciliation is actually needed. Every response was a 400 with no booking, hold or transaction ID. The 28 journals for 2026-10-01 stay in `unknown`. They block only a retry of the same 10-01 goals, and that date has passed.

## Evidence-quality notes

- **Availability feed is still edge-cached:** 223 reads with 1 MISS (−60 s), 179 HIT and 43 STALE. Entry lifetime is about 10 s. Public booking reads were all MISS (637 per-court responses). The new bounded-cache rule (Age + 1 s plus elapsed, within the adaptive freshness budget) was in this build. It only affects Smart Precision's Wave 2/Rescue, which this plan did not use.
- **Slot Watch upgrades worked live.** Booking records were read every 2 s early on, and 33 predicted expiry windows were read at 2 s cadence. Those reads captured the +604–612 s record drops and re-adds. Bookings reads scheduled at +2 s, +6 s and +10 s were skipped (`PREVIOUS_READ_IN_FLIGHT`) because some per-court reads took about 3 s.
- **Preliminary forensics** (`report.txt`, written at +8 s) said "No Slot Watch log was found for this run" even though `5ca0c711` was running. A final report was never produced because the app was closed at +747 s.
- **UI schema:** "Unrecognized structured event omitted" appeared twice, at arming (07:33:48) and freeze (07:58:01). These match `PRECISION_RACE_CONFIGURED` (`fanOut`) and `PRECISION_ARMED` (`fanOut`, `parentGoalCount`). `UiEventSchema` has no fields for them. The `CRITICAL_PATH_SAVED` omission seen on 09-26/09-28 did not recur, because its `max*Ms` fields were added in this build.

## Recommendations (in priority order)

1. ~~Prove `23:00–00:00` live~~. Done at 09:55 (see the update above). **Rebuild the installed exe** (`npm run exe:build`, app closed) before the next release, so that it includes c3e0408.
2. **Add an arm-time payload self-check.** At freeze, build each frozen request exactly as it will be sent and assert that every time is in Onda's wire format (no `24:00`, contiguous hours, `duration: 60`). A payload bug would then stop the arming instead of spending the release.
3. **Name this failure.** Treat a 400 whose body is exactly `Invalid booking session time` as a definitive, non-retryable **payload rejection** with its own code and a loud UI message, not as "UNKNOWN — may have been sent".
4. **Accept midnight in public booking records.** `readPublicBookingRecords()` drops records ending `00:00`. Map that end to 24:00 so 23:00 records become visible to Slot Watch, T−10 min evidence and the block audit.
5. **Fan-out timing.** Either fire each child on its own timer, with more spread between them, or document that under 4× fan-out the offsets collapse into roughly −4 / −1 / +10 / +12 ms bands. Consider raising the pre-warm lead above 15 s for 28 contexts, since the last was ready with 3.2 s to spare.
6. **Leave the app running until Slot Watch finishes** (+15 min) before rebuilding, so that the Slot Watch summary and final forensics get written.
7. **If reopenings matter,** only Smart Precision has Wave 2/Rescue, and it now has the bounded-cache evidence rule. Today C3 and C7 21:00–24:00 were open from about +606 s for at least 141 s.

## Sources

Install folder (not in the repo), relative to the install root:

- `.local/booking-runs/2039d807-….ndjson`: UI activity for the run
- `.local/api-booking/run-progress/06efdcad-….ndjson`: runner stages and per-attempt diagnostics
- `.local/api-booking/precision-races/06efdcad-…-freeze.json`: 28 frozen attempts and offsets
- `.local/api-booking/api-first-journals/*/fan-out/*/*/`: per-attempt journals and sanitized response evidence (status, headers, body shape, error text)
- `.local/release-forensics/06efdcad-…/`: `report.txt` (preliminary), `critical-path.ndjson`, `provider-trace.ndjson`
- `.local/slot-watch/2026-10-01_5ca0c711-….ndjson`: 223 availability reads and 91 public booking reads
- `.local/network-clock-evidence/2026-09-28T23-5*`: clock consensus samples
- `.local/booking-runs/75576d7e-….ndjson`: 07:14 block audit
