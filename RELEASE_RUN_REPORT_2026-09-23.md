# Production release report: September 23, 2026 (Special Friday)

## Result

The live Special Friday run for **Friday, September 25, 2026** failed with **`SPECIAL_SESSION_NOT_AVAILABLE`** at **08:00:15.051 Manila**. No hold, booking or payment was created.

The bot's own preparation and release timing worked. All eight browsers were ready, the security contexts were prepared, the release trigger fired at 08:00:00.002 by the PC clock, and the E/F direct checkouts were sent 45 ms later.

The run could not have succeeded with its configured plan. When Onda opened Friday, **19:00–22:00 on courts 1–5** and **17:00–20:00 on courts 6–7** were unavailable with no booking on them, most likely a block set by the venue. Every combination the bot was allowed to book needed at least one of those hours:

- **A–D (core)** needed one court free 17:00–22:00 and a second court free 19:00–23:00. No court had either block free. The lane read availability five times, found no match, and stopped without sending a checkout.
- **E/F (direct)** sent checkouts without an availability read ("proofless") for court 5, 17:00–20:00 and 20:00–22:00. Both included blocked hours, and Onda rejected both with HTTP 409.
- **G/H (bonus)** never started, because it waits for A–D's court assignment.

Bookable evening time did exist at release: 17:00–19:00 and 22:00–00:00 on courts 1–5, and 20:00–00:00 on courts 6–7. The bot had that grid by 08:00:06, before most other players' holds landed. It did not ask for any of it, because the plan has no fallback. By 08:07 all of it was taken.

## Evidence and scope

- UI run ID: `175d0c16-704f-467d-9661-ac8641fe5541`. Runner run ID: `88473147-c70a-4417-a352-aed2502bbca4`.
- Sources, all in the installation folder rather than this repository:
  - `.local/booking-runs/175d0c16-….ndjson`: the UI activity log.
  - `.local/api-booking/run-progress/88473147-….ndjson`: the runner progress log, 749 events.
  - `.local/api-booking/api-first-journals/`: the two submission journals written at 08:00, one for E and one for F.
  - `.local/automation.lock`, `config.local.json` and `BUILD-INFO.txt`.
- Build: the self-contained installation was built at 2026-09-22T18:08:26Z (02:08:26 Manila). Telemetry does not record a Git SHA. Repository HEAD when this report was prepared was `2969311`, with uncommitted changes:
  - In `desktop-runner.ts`, the uncommitted changes add diagnostic instrumentation only (107 lines added, 12 removed), plus the new `run-diagnostics.ts`. The planning, retry and lock logic cited below is the same in the build that ran.
  - `special-session.ts` and `special-direct-checkout.ts` are identical to the build.
  - Line links point to the repository working tree.
- All times are Manila (UTC+8) by the PC clock unless stated. The PC clock was about 0.3–0.4 s behind true time (see [Latency](#latency)).
- Read-only checks run after the run for this report:
  - Three reads of Onda's public availability endpoint for September 25: at 08:07:17, once between 08:07 and 08:16, and at 08:20:09.
  - Three reads of Onda's public bookings endpoint for the same date: twice between 08:07 and 08:16, and at 08:20:09.
  - One clock-offset measurement at 08:15:58.

  No booking, hold, reload, lock cleanup or payment action was taken.
- Excluded from this report: player identities, cookies, tokens, customer identifiers, journal keys and raw checkout bodies.

## Configuration and plan

| Setting | Value |
| --- | --- |
| Mode | `special-friday`, API-first, live |
| Target date | Friday 2026-09-25 |
| Configured target | 4 courts, start 17:00, 5 hours |
| Configured court order | 6, 7, 1, 2, 3, 4, 5 |
| Workers | 8 (A–H) |
| Release | 08:00:00.000 Manila (epoch ms 1790121600000) |
| Security prewarm lead | 15 s (core and direct) |
| Early availability watcher | From 07:50 (release minus 10 minutes, [desktop-runner.ts:557](src/api-booking/desktop-runner.ts#L557)). Reads availability every 5 s and the site version about every 1 s. |
| Post-release retries | Up to 5 availability reads, with pauses of 0, 250, 500, 1,000 and 2,000 ms ([desktop-runner.ts:874-885](src/api-booking/desktop-runner.ts#L874-L885)) |

The lane plan is hard-coded in [special-session.ts:39-56](src/api-booking/special-session.ts#L39-L56) and [special-direct-checkout.ts:12-18](src/api-booking/special-direct-checkout.ts#L12-L18):

| Lane | Workers | Blocks | Court priority | Method |
| --- | --- | --- | --- | --- |
| Core early | A, B | A 17:00–20:00 + B 20:00–22:00, one court | 6, 7, 5, 4, 3, 2, 1 | Proof-based: reads availability first |
| Core late | C, D | C 19:00–21:00 + D 21:00–23:00, a second court | 7, 6, 5, 4, 3, 2, 1 | Proof-based |
| Direct | E, F | E 17:00–20:00 + F 20:00–22:00 | 5, 4, 3, 2, 1 (court reserved at 07:50) | Proofless at 08:00 if no availability appears before release |
| Bonus | G, H | G 17:00–20:00 + H 20:00–22:00, a fourth court | 4, 3, 2, 1, 5, 6, 7 | Proof-based only. Starts after A–D's assignment is known. |

The blocks are split because Onda permits at most three consecutive hours per checkout ([special-session.ts:37-38](src/api-booking/special-session.ts#L37-L38)).

A–D matching is all-or-nothing. `specialSessionPlans` tries each court pair with `requireCompleteSession = true` ([special-session.ts:170-175](src/api-booking/special-session.ts#L170-L175)), so one missing hour on either court rejects that pair. The direct lane's court (5) is excluded from the search. There is no fallback to other start times, shorter blocks or a single court.

## What Onda offered for Friday

### Hours blocked by the venue

This grid combines the public availability and bookings reads captured at **08:20:09**:

```
P = pending booking   C = confirmed booking   ? = unavailable with no booking   ok = open

court | 08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  1   | ok ok ok ok ok ok ok ok P  ok P  ?  ?  ?  ok ok
  2   | ok ok ok ok ok ok ok ok P  P  ok ?  ?  ?  P  P
  3   | ok ok ok ok ok C  C  C  P  P  P  ?  ?  ?  C  C
  4   | ok ok C  C  C  C  C  C  C  P  P  ?  ?  ?  C  C
  5   | ok ok C  C  C  C  C  C  C  ?  P  ?  ?  ?  C  C
  6   | ok ok ok ok ok ok P  P  P  ?  ?  ?  C  C  C  ok
  7   | ok ok ok ok ok ok ok ok ok ?  ?  ?  C  C  C  ok
```

Totals at 08:20:09: 46 open, 44 booked (pending or confirmed), 22 unavailable with no booking.

Twenty-one of those 22 cells form a regular pattern: **19:00–22:00 on courts 1–5** (15 cells) and **17:00–20:00 on courts 6–7** (6 cells). The 22nd, court 5 at 17:00, was seen only at 08:20 and may have been a checkout still in progress. Three observations indicate the 21-cell pattern was set by the venue and present from the moment Friday opened:

1. **The count matches.** The bot's first post-release read found 91 of 112 slots open, so 21 unavailable. That is exactly the size of the pattern.
2. **It persists.** The cells were still unavailable with no booking at 08:20:09, 20 minutes after release. Unpaid holds expire after 10 minutes, and while active they appear as pending bookings in the public bookings list.
3. **No booking covers them.** Onda's public bookings endpoint lists pending and confirmed bookings, and none covers these cells.

Onda's responses give no reason for a slot being unavailable, so "venue block" is an inference. This run cannot tell whether the block recurs every Friday.

### What was bookable at release (reconstructed)

The first post-release read returned exactly 21 unavailable slots. If those were the 21 blocked cells, as the count implies, the evening at release looked like this:

| Courts | Bookable evening blocks | Blocked |
| --- | --- | --- |
| 1–5 | 17:00–19:00 (2 h) and 22:00–00:00 (2 h) | 19:00–22:00 |
| 6–7 | 20:00–00:00 (4 h) | 17:00–20:00 |

That is 28 bookable evening slots (49 minus 21), with 08:00–17:00 fully open. No court had a continuous 17:00–22:00 or 19:00–23:00 block, so the configured target was infeasible from the moment the date opened.

Prices seen at 08:20:09 were PHP 600/hour for 08:00–16:00 and PHP 700/hour for 16:00–00:00. The E/F assumed rate of PHP 700/hour was correct, so price did not cause the E/F rejections.

## Lane outcomes

### A–D (core): no checkout sent

- All four security contexts were ready by 07:59:50.407.
- **Early watcher (07:50:00–07:59:46.947):** Friday never appeared in any of 119 availability reads. The site version did not change across 583 reads. There was no early-release signal.
- **Release:** the trigger fired at 08:00:00.002, and the first post-release availability request was sent at 08:00:00.013.
- Friday appeared in all five post-release reads, but none had a qualifying court pair (see [Availability reads after release](#availability-reads-after-release)). The lane threw `SPECIAL_SESSION_NOT_AVAILABLE` at 08:00:15.051 ([desktop-runner.ts:884](src/api-booking/desktop-runner.ts#L884)).
- No A–D journal was written, which confirms nothing was dispatched.

### E/F (direct): two checkouts sent, both rejected

- **07:50:00.351, court 5 chosen.** The choice used Onda's public bookings list, which showed no booking on court 5 between 17:00 and 22:00 ([desktop-runner.ts:200](src/api-booking/desktop-runner.ts#L200), [special-direct-checkout.ts:28](src/api-booking/special-direct-checkout.ts#L28)). Venue blocks are not bookings, and the availability grid was not published until 08:00, so this check could not see the block. The rate was recorded as `UNVERIFIED_PRIOR_RATE`, with an assumed total of PHP 3,500.
- **Security:** E was ready at 07:59:50.220 and F at 07:59:50.372.
- **Dispatch:** 08:00:00.047 (+45 ms), within the direct lane's 1-second window. Each worker claimed its one-shot permit at 08:00:00.050–.051.
- **E, court 5, 17:00–20:00, maximum PHP 2,100:** HTTP 409 at 08:00:11.503, 11.46 s after dispatch. Onda's error hint was "availability". The 19:00 hour is blocked.
- **F, court 5, 20:00–22:00, maximum PHP 1,400:** HTTP 409 at 08:00:13.297, 13.25 s after dispatch, with the same hint. Both hours are blocked.
- Both journals are marked `rejected`: a confirmed rejection, not an unknown outcome. There was no retry. The runner code `ONDA_HTTP_STATUS_INVALID` is the transport's code for any non-200 checkout response ([browser-session-transport.ts:211](src/api-booking/browser-session-transport.ts#L211)).

### G/H (bonus): never started

The bonus lane starts only after A–D's court assignment is known. Browsers G and H were prepared at 07:33, but no security prewarm, availability read or checkout ran for them.

## Availability reads after release

| Sent | Returned | Took | Friday listed | Open / total | Unavailable beyond the 21 blocked |
| --- | --- | ---: | --- | ---: | ---: |
| 08:00:00.013 | 08:00:06.017 | 6,004 ms | Yes | 91 / 112 | 0 |
| 08:00:06.279 | 08:00:09.380 | 3,101 ms | Yes | 87 / 112 | 4 |
| 08:00:09.894 | 08:00:11.869 | 1,975 ms | Yes | 73 / 112 | 18 |
| 08:00:12.875 | 08:00:12.955 | 80 ms | Yes | 87 / 112 | 4 |
| 08:00:14.969 | 08:00:15.051 | 82 ms | Yes | 73 / 112 | 18 |

The open count went 87 → 73 → 87 → 73 across the last reads. Slot-level data was not logged, so the telemetry cannot show whether holds were created and released or different backends returned different views.

## Why other players got the slots

The bot was not outrun on the slots other players booked. It never requested them.

- Onda's first response to the bot, returned at 08:00:06.017, showed nothing unavailable beyond the 21 blocked cells. Other players' holds first appeared in the read sent at 08:00:06.279 (4 slots) and reached 18 by the read sent at 08:00:09.894.
- At 08:00:06 the bot had the full grid with every bookable evening block still open. None fit its plan, so it sent nothing.
- By **08:07:17**, every evening slot (17:00–00:00) on all seven courts was unavailable, either held or booked.
- Other players booked what was actually open. At 08:20:09:
  - Courts 6–7 20:00–23:00 and courts 3–5 22:00–00:00 were confirmed bookings.
  - Courts 1–5 17:00–19:00 were mostly pending.
- The bot cannot see Friday's grid before 08:00, because the date is not listed until then. Its plan was therefore fixed before it could know about the block, and it has no step to re-plan from the released grid.

## Latency

### Bot side

| Step | PC clock | After 08:00:00.000 |
| --- | --- | ---: |
| Release trigger | 08:00:00.002 | +2 ms |
| Lock stage set to `FINAL_ACTION_DISPATCHING` | 08:00:00.005 | +5 ms |
| First availability request sent | 08:00:00.013 | +13 ms |
| E/F checkouts dispatched | 08:00:00.047 | +47 ms |

### Onda side

| Request | Before release | At release |
| --- | --- | --- |
| Availability read | Median 127 ms, p90 237 ms, max 805 ms (119 reads) | 6,004 → 3,101 → 1,975 ms, then 80 ms from 08:00:12 |
| Site-version read | Median 54 ms, max 456 ms (583 reads) | Not read after 07:59:48, by design (release guard) |
| Checkout | — | 11.46 s (E) and 13.25 s (F) to a 409 |

Onda's servers caused most of the delay. The API route skips page loads and clicks, but not Onda's queue.

### Where the bot still loses time

1. **The PC clock is behind.** At 08:15:58, `w32tm /stripchart` against time.google.com measured the local clock about **0.434 s behind**. The readiness assessment earlier today measured 330–339 ms behind, with Windows Time not synchronizing. The bot's 08:00:00.002 was therefore about 08:00:00.4 true time, so every request joined Onda's queue about 0.4 s after players on synced clocks.
2. **Proof-based lanes need two trips through the server:** an availability read, then a checkout. Under this load that is at least 6 s for the read plus about 11–13 s for the checkout.
3. **Post-release reads are sequential,** one in flight at a time ([desktop-runner.ts:876-883](src/api-booking/desktop-runner.ts#L876-L883)). The 6-second first read blocked the next one. The server was answering in 80 ms by 08:00:12, but the fixed pauses and 5-read limit ended the window at about 08:00:15.

None of these changed this outcome, because the plan was infeasible regardless. They matter once the plan can adapt.

## State after the run

- **Holds and bookings:** none. Both journals are confirmed rejections with no booking IDs, and `.local/retained-holds` has no file newer than 06:04.
- **Lock:** `.local/automation.lock` was last written at 08:00:00.005 with stage `FINAL_ACTION_DISPATCHING`. The process it records was not running at 08:02. The lock is kept on purpose once any checkout is dispatched ([desktop-runner.ts:599](src/api-booking/desktop-runner.ts#L599)). Both dispatched outcomes are confirmed rejections, so there is no unknown submission to reconcile, but the lock may block the next live run until it is cleared. It was not modified for this report.

## What this run establishes

- Eight-browser preparation, security prewarm and release timing work in production: trigger +2 ms, availability request +13 ms, direct dispatch +47 ms.
- The early watcher correctly saw nothing before release; Onda listed Friday only after 08:00.
- Onda was heavily loaded for about 12 s after release, with 6-second reads and 11–13-second checkout responses.
- The direct lane's journaling and one-shot permits worked: exactly one request per worker, both recorded as confirmed rejections, with no retry.
- Friday 2026-09-25 had evening hours unavailable without bookings on every court, which made the configured plan infeasible.

## What this run does not establish

- Which slots were open at each read. Slot-level data was not logged, so the grid at release is reconstructed from counts and later reads.
- Why those hours were blocked, or whether the block recurs every Friday.
- Whether a flexible plan would have won a hold. The bot never competed for the bookable slots, and a valid checkout under this load is untested.
- A–D and G/H checkout performance under release load, since no requests were sent.
- The exact clock offset at 08:00. It was measured at 08:15:58.

## Recommendations

### Before the next live run

1. **Confirm the venue's Friday schedule.** Ask whether 19:00–22:00 on courts 1–5 and 17:00–20:00 on courts 6–7 are blocked every Friday. If they are, 17:00–22:00 on one court can never be booked on a Friday.
2. **Clear `.local/automation.lock` deliberately.** No outcome is unknown, since both E/F attempts are confirmed rejections.
3. **Resync the PC clock** (Windows Time, admin), and re-measure the offset before 07:50.

### Code changes

1. **Plan from the released grid.** After the first successful post-release read, choose the best bookable blocks per court, for example the longest continuous evening block split into checkouts of three hours or less, instead of requiring 17:00–22:00 plus 19:00–23:00. At minimum, let A–D book a single court when no pair exists.
2. **Stop E/F from sending proofless requests for hours that may be blocked.** Either set its blocks from the confirmed venue schedule or drop the proofless path in favor of the planner above.
3. **Ship per-slot logging.** The uncommitted `specialAvailabilityObservation` in [run-diagnostics.ts:59](src/api-booking/run-diagnostics.ts#L59) records a per-court 17:00–22:00 mask for every read. That would have made this report direct observation instead of reconstruction.
4. **Overlap post-release availability reads and extend the window** past about 15 s, so one slow response does not block fresher ones.

## Complete sanitized event timeline

Offsets are relative to the trigger at 08:00:00.002 by the PC clock. Journal and lock rows come from the E/F submission journals and `automation.lock`. Early availability reads (119) and site-version reads (583) are summarized by their first entry.

| Manila time | Offset from trigger (ms) | Source | Event |
| --- | ---: | --- | --- |
| 07:32:57.592 | −1,622,410 | UI | run-start |
| 07:32:57.600 | −1,622,402 | UI | Process started: apiRun |
| 07:32:58.120 | −1,621,882 | Runner | `RUN_STARTED` |
| 07:32:58.125 | −1,621,877 | Runner | `RUN_CONFIGURATION` |
| 07:32:58.157 | −1,621,845 | Runner | `PREPARING_BROWSER` workerId=A |
| 07:32:58.172 | −1,621,830 | Runner | `PREPARING_BROWSER` workerId=B |
| 07:32:58.185 | −1,621,817 | Runner | `PREPARING_BROWSER` workerId=C |
| 07:32:58.196 | −1,621,806 | Runner | `PREPARING_BROWSER` workerId=D |
| 07:32:58.208 | −1,621,794 | Runner | `PREPARING_BROWSER` workerId=E |
| 07:32:58.222 | −1,621,780 | Runner | `PREPARING_BROWSER` workerId=F |
| 07:32:58.235 | −1,621,767 | Runner | `PREPARING_BROWSER` workerId=G |
| 07:32:58.246 | −1,621,756 | Runner | `PREPARING_BROWSER` workerId=H |
| 07:33:00.119 | −1,619,883 | Runner | `BROWSER_READY` workerId=C |
| 07:33:00.129 | −1,619,873 | Runner | `BROWSER_READY` workerId=B |
| 07:33:00.129 | −1,619,873 | Runner | `BROWSER_READY` workerId=D |
| 07:33:00.138 | −1,619,864 | Runner | `BROWSER_READY` workerId=A |
| 07:33:00.169 | −1,619,833 | Runner | `BROWSER_READY` workerId=H |
| 07:33:00.173 | −1,619,829 | Runner | `BROWSER_READY` workerId=F |
| 07:33:00.179 | −1,619,823 | Runner | `BROWSER_READY` workerId=G |
| 07:33:00.179 | −1,619,823 | Runner | `BROWSER_READY` workerId=E |
| 07:33:00.180 | −1,619,822 | Runner | `BROWSER_PREPARATION_OUTCOME` A–H, all fulfilled, code=COMPLETED |
| 07:33:00.180 | −1,619,822 | Runner | `WAITING_FOR_RELEASE` |
| 07:50:00.006 | −599,996 | Runner | `SPECIAL_AVAILABILITY_WATCHING` |
| 07:50:00.334 | −599,668 | Runner | First early availability read: Friday not listed (328 ms) |
| 07:50:00.351 | −599,651 | Runner | `DIRECT_LANE_PREPARED` court=5, rateSource=UNVERIFIED_PRIOR_RATE, assumedPrice=3500 |
| 07:50:00.411 | −599,591 | Runner | First site-version read (59 ms, HTTP 200); version unchanged for all 583 reads |
| 07:59:45.008 | −14,994 | Runner | `SECURITY_PREWARM_STARTED` |
| 07:59:46.947 | −13,055 | Runner | Last early availability read: Friday not listed (129 ms) |
| 07:59:48.145 | −11,857 | Runner | Last site-version read (57 ms, HTTP 200) |
| 07:59:49.194 | −10,808 | Runner | `SECURITY_PREWARM_READY` workerId=A |
| 07:59:49.826 | −10,176 | Runner | `SECURITY_PREWARM_READY` workerId=D |
| 07:59:50.220 | −9,782 | Runner | `DIRECT_SECURITY_READY` workerId=E |
| 07:59:50.372 | −9,630 | Runner | `DIRECT_SECURITY_READY` workerId=F |
| 07:59:50.373 | −9,629 | Runner | `SECURITY_PREWARM_READY` workerId=C |
| 07:59:50.407 | −9,595 | Runner | `SECURITY_PREWARM_READY` workerId=B |
| 08:00:00.002 | +0 | Runner | `RELEASE_TRIGGERED` |
| 08:00:00.005 | +3 | Lock | Stage set to `FINAL_ACTION_DISPATCHING` |
| 08:00:00.013 | +11 | Runner | First post-release availability request sent |
| 08:00:00.047 | +45 | Runner | `DIRECT_LANE_DISPATCHING` court=5, rateSource=UNVERIFIED_PRIOR_RATE |
| 08:00:00.047 | +45 | Journal | E attempt (court 5, 17:00–20:00, max PHP 2,100) recorded as dispatching |
| 08:00:00.048 | +46 | Journal | F attempt (court 5, 20:00–22:00, max PHP 1,400) recorded as dispatching |
| 08:00:00.050 | +48 | Journal | F one-shot permit claimed |
| 08:00:00.051 | +49 | Journal | E one-shot permit claimed |
| 08:00:06.017 | +6,015 | Runner | Availability read returned: Friday listed, 91/112 open (took 6,004 ms) |
| 08:00:09.380 | +9,378 | Runner | Availability read returned: Friday listed, 87/112 open (took 3,101 ms) |
| 08:00:11.503 | +11,501 | Journal | E checkout response: HTTP 409, hint "availability" |
| 08:00:11.543 | +11,541 | Journal | E attempt marked rejected |
| 08:00:11.869 | +11,867 | Runner | Availability read returned: Friday listed, 73/112 open (took 1,975 ms) |
| 08:00:12.955 | +12,953 | Runner | Availability read returned: Friday listed, 87/112 open (took 80 ms) |
| 08:00:13.297 | +13,295 | Journal | F checkout response: HTTP 409, hint "availability" |
| 08:00:13.336 | +13,334 | Journal | F attempt marked rejected |
| 08:00:13.338 | +13,336 | Runner | `DIRECT_WORKER_OUTCOME` workerId=E, status=rejected, code=ONDA_HTTP_STATUS_INVALID |
| 08:00:13.338 | +13,336 | Runner | `DIRECT_WORKER_OUTCOME` workerId=F, status=rejected, code=ONDA_HTTP_STATUS_INVALID |
| 08:00:15.051 | +15,049 | Runner | Availability read returned: Friday listed, 73/112 open (took 82 ms) |
| 08:00:15.051 | +15,049 | Runner | `FAILED` code=SPECIAL_SESSION_NOT_AVAILABLE |
| 08:00:15.051 | +15,049 | UI | API run needs attention · SPECIAL_SESSION_NOT_AVAILABLE |
| 08:00:15.110 | +15,108 | Runner | `PROCESS_EXIT` exitCode=1 |
| 08:00:15.267 | +15,265 | UI | COMMAND_FAILED |
| 08:00:15.271 | +15,269 | UI | Run finished: failed |
| 08:00:15.275 | +15,273 | UI | run-end (failed) |

### Post-run observations (read-only)

| Manila time | Observation |
| --- | --- |
| 08:02:31 | The process recorded in `automation.lock` is not running; the lock file remains. |
| 08:07:17 | Availability: every slot 17:00–00:00 on courts 1–7 unavailable. |
| 08:07–08:16 | Bookings and availability compared. The 21 blocked cells are unavailable with no booking, and some unpaid holds have started expiring. |
| 08:15:58 | PC clock about 0.434 s behind time.google.com. |
| 08:20:09 | Full grid captured (see [Hours blocked by the venue](#hours-blocked-by-the-venue)): 46 open, 44 booked, 22 unavailable with no booking. |
