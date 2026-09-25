# Production release report: September 25, 2026 (target Sunday September 27)

Prepared 2026-09-25 about 08:50 Manila from local evidence on the release PC. Read-only: no source change, no commit, no rebuild. Every raw log for the run is reproduced in the appendices (A–N). Times are Manila (UTC+8). `+x s` means after the release instant 08:00:00.000 on the network clock.

## 1. Executive result

- **No court was booked.** All 7 Wave 1 checkouts were sent 9.8–11.7 ms after 08:00:00 and all 7 were rejected by Onda with **HTTP 409, hint "availability"**, after the server held each request for **29.1–34.6 s**.
- **Nothing is held and nothing needs reconciling.** Every response had zero booking IDs, numbers, sessions and holds; all seven journals are `rejected`; the automation lock was released; the bot browsers were closed at 08:20.
- **The run ended at 08:15:00 as `ALL_REJECTED_WAITING_FOR_REOPEN`** (exit code 1 is the normal code for that outcome).
- **Sunday 12:00–22:00 was gone on every court within about 30 s.** A grid read requested at +2.0 s already showed three of our target hours taken while our requests were still unanswered. By about +3 min only 12 of 112 hours were left.
- **Hours came back in short windows at about +4 min, +7 min and +10.5 min.** At +10.5 min one of our 11 candidates (Court 1 15:00–18:00) was fully open, but the plan had **Rescue off and a Wave 2 that could not run**, so the bot could not act. The same +10.5 min reopening happened on the 24 Sep release.
- **The send side worked as designed and is no longer the bottleneck we can measure.** Send time improved from about +100 ms (24 Sep) to about +10 ms, and the outcome was the same.

## 2. Bottom line for next time

1. **Winning at 08:00:00 has failed on both observed releases** despite a ~10 ms send. Whoever is taking the hours gets processed first; Onda's public data can't show how or by whom.
2. **The repeatable opportunity is after the rush.** Both observed releases reopened hours between the +600 s and +630 s reads, which matches Onda's 10-minute hold. There were also smaller reopenings at about +255 s and +420 s on Sunday.
3. **Those reopenings were 3-hour blocks at start times we weren't targeting** (12:00, 13:00, 16:00), plus one we were (C1 15:00). A wider candidate list with Rescue allowed would have had 4–5 shots instead of 1.
4. **This run could not use any of them:** Rescue disabled with budget 0, total capped at 7, and Wave 2 impossible because every worker was in Wave 1.
5. **Before relying on Rescue, one code behaviour needs attention:** an adaptive attempt silently gives up if a newer grid read arrives during its 4–5 s security preparation (§15.4). At 30 s read spacing it's fine; with denser reads it would starve.
6. **Monday 28 Sep (tomorrow's release) already has 14 confirmed records:** Court 2 and Court 3 20:00–23:00, Court 6 and Court 7 18:00–22:00. Don't target those.

## 3. Run identity and evidence scope

| Item | Value |
|---|---|
| Release | Fri 2026-09-25 08:00:00.000 Manila (2026-09-25T00:00:00Z), opening **Sun 2026-09-27** |
| App run (control panel) | `94772f25-edb2-49e4-b9ee-d1a1529ff329`, label `full` / API LIVE, 07:29:50.868 → 08:15:00.100, outcome `failed` |
| Runner run | `fc62669a-bfe5-4726-998a-fa0616bd1e19`, mode `live`, process exit code 1 at 08:15:00.067 |
| Slot Watch | `60d68777-0022-471a-99aa-3a47543858f4` (v2), 07:29:50.864 → 08:15:00.644, "window complete" |
| Installed build | Built 2026-09-24T16:16:42Z (00:16 Manila), `Source: 4a9cb2c + uncommitted changes`; content equals pushed `a16bb8a` (Phase 1–4). Launcher SHA-256 `62046D02…BEAE2F6` |
| Booking method | `proofless`, `RELEASE_STRATEGY: precision`, Phase 3 plan (§5) |
| Workers | A–G (7), each with its own verified customer identity (7/7 unique on 24 Sep 22:35) |
| Evidence used | Runner trace, app activity log, Slot Watch log + summary + text report, provider trace, forensic report + summary, 7 journals + private response summaries + one-shot claims, Phase 3 freeze file, 3 network-clock evidence files, Release Intelligence summary, the 24 Sep Slot Watch log, every booking-runs log since midnight, source code for Wave 2/Rescue, and three read-only public reads after the run (08:24 and 08:33) |
| Not available | Onda's server-side ordering, identities behind public booking records, the 409 response bodies (only size, status and hint are stored) |

## 4. The morning, in order

Full index in Appendix K. Summary:

| Manila | What happened |
|---|---|
| 00:57–01:35 | Block audit for Sun 27 (5 hours already unavailable, all with public records). Three live runs started and **aborted by the operator** (01:05:29, 01:05:56, 01:35:32). Bot Chrome browsers had to be **force-closed** twice ("7 force-closed after not responding"). |
| 05:09–05:10 | Block audits: Sun 27 (5 blocked), **Mon 28 (14 blocked)**, Tue 29 (0), Fri 2 Oct (0), Sat 3 Oct (0), Fri 25 (28 open / 84 blocked), Sat 19 (62 blocked / 50 unknown). |
| 07:10–07:13 | Plan saved, dry prepare OK, browsers closed, one prepare aborted, dry prepare OK. |
| 07:13:09 | Live run started; **aborted** 07:21:14. |
| 07:21:52 | Prepare **failed** after 2 s (`COMMAND_FAILED`; no error stage logged, it stopped after starting browser preparation). Retried 4 s later: OK. |
| 07:22:04 | Live run started; **aborted** 07:26:02. Six block audits 07:26 (Sun 27 ×5: 5 blocked; Mon 28: 14 blocked). |
| 07:27:58 | Live run started; **aborted** 07:28:37. |
| 07:29:40 | Dry prepare OK. |
| **07:29:50** | **Final live run starts.** |
| 07:29:53 | All 7 browsers ready in 1.7 s. Phase 3 authorization: 11 candidates, Wave 1 = 7, standby 0, Wave 2 max 0, Rescue max 0, total max 7. |
| 07:50:00 | T−10 min clock: offset +20.0 ms, ±21.5 ms, 9 of 10 samples kept. |
| 07:58:00 | T−2 min: Wave 1 prices recorded, plan frozen, 7 attempts armed, journals created, one-shot sends claimed. |
| 07:59:00 / 07:59:30 | T−60 s / T−30 s clock: +24.3 ms ±22.3 / +23.3 ms ±24.2. Slot Watch reads every 10 s: date not yet published. |
| 07:59:44.98 | T−15 s: fresh security preparation on all 7 (took 3.8–5.5 s). |
| 07:59:58.2 | Last read without the date (request −1.987 s, answer −1.779 s). |
| **08:00:00.010–.012** | **7 checkouts sent.** |
| 08:00:04.1 | First grid with the date (requested +0.016 s): 107 open, every target fully open. |
| 08:00:17.0 | Read requested at +2.0 s shows C7 19:00, C4 21:00, C2 16:00, C2 14:00, C4 12:00 taken. |
| 08:00:29.1–34.6 | All 7 answers: 409 availability. |
| 08:00:30–31 | Reads requested by +31 s show 12:00–22:00 taken on every court. |
| 08:00:47–08:02:50 | Morning hours (09:00–12:00) taken court by court in 3-hour blocks. |
| 08:04:15 / 08:07:00 | Short reopenings: C4/C5 13:00–16:00 (seen at +255 and +260 s, gone by +265 s), C5/C6 16:00–19:00 (seen in one read at +420 s). |
| **08:10:30** | **31 hours reopen at once**, including C1 15:00–18:00 (a candidate). Taken again by 08:11:00. |
| 08:15:00 | Watch ends. Outcome recorded, provider trace saved, runner exits, forensic report and Release Intelligence rebuilt. |
| 08:20 | Block audit Mon 28 (14 blocked). Bot browsers closed (7 force-closed after not responding). |

## 5. Authorized plan

Source: `config.local.json` (`PRECISION_PHASE3`) and the freeze file (Appendix I). Every candidate was 3 hours at PHP 700/h (PHP 2,100), rate evidence "current venue schedule" captured 2026-09-25 01:00 Manila.

| Priority | Court | Hours | Wave 1 worker | Wave 2 allowed | Rescue allowed |
|---|---|---|---|---|---|
| 1 | 7 | 19:00–22:00 | A | no | no |
| 2 | 6 | 19:00–22:00 | B | no | no |
| 3 | 5 | 19:00–22:00 | C | no | no |
| 4 | 4 | 19:00–22:00 | D | no | no |
| 5 | 3 | 19:00–22:00 | E | no | no |
| 6 | 2 | 15:00–18:00 | F | no | no |
| 7 | 1 | 15:00–18:00 | G | no | no |
| 8 | 7 | 15:00–18:00 | — | **yes** | no |
| 9 | 6 | 15:00–18:00 | — | **yes** | no |
| 10 | 5 | 15:00–18:00 | — | **yes** | no |
| 11 | 4 | 15:00–18:00 | — | **yes** | no |

Budgets: Wave 2 **0**, Rescue **0** (`rescueEnabled: false`), total **7**, standby **none**, `concurrentWave2: true`.

**Plan problems found:**
- **Candidates 8–11 could never be used.** They are marked for Wave 2, but Wave 2 only uses standby workers and there were none, and the Wave 2 budget was 0.
- **Candidate 11 (C4 15:00–18:00) was impossible from the start.** C4 16:00–19:00 had public booking records before 08:00 (the only pre-existing records on Sunday were C3 16:00–18:00 and C4 16:00–19:00).
- **No candidate allowed Rescue**, so nothing could act after the rush.
- All candidates started at 15:00 or 19:00. The reopenings that happened were mostly at other start times (§11).

## 6. Preparation and arming

| Step | Result |
|---|---|
| Browser preparation | 7/7 `COMPLETED`, ready 1.69–1.75 s after run start |
| T−10 min clock | +20.0 ms offset, RTT 43 ms, spread 12.7 ms, ±21.5 ms, quality GOOD |
| Freeze (T−2 min, 07:58:00.063) | 11 candidates, 7 Wave 1, prices from rate evidence |
| Arm | 7 attempts armed 07:58:00.046, lock stage `FINAL_ACTION_ARMED`, journals created 07:58:00.068–.069, one-shot claims 07:58:00.079–.080 |
| Security prep (T−15 s) | Started 07:59:44.977–.980. Finished: G 3.81 s, B 4.32, E 4.85, D 4.89, A 4.93, F 5.18, C 5.54 s |
| Prepared context age at send | A 10.1 s, B 10.7, C 9.5, D 10.1, E 10.2, F 9.8, G 11.2 s (all `PREPARED_CONTEXT`) |

## 7. Clock

| Checkpoint | Offset | Uncertainty | Spread | RTT (min) | Samples kept |
|---|---|---|---|---|---|
| T−10 min (07:50:00) | +20.0 ms | ±21.5 ms | 12.7 ms | 43 ms | 9/10 |
| T−60 s (07:59:00) | +24.3 ms | ±22.3 ms | 10.4 ms | 44 ms | 10/10 |
| T−30 s (07:59:30) | +23.3 ms | ±24.2 ms | 4.2 ms | 44 ms | 10/10 |

Sources: time.google.com and time1–4.google.com (Appendix J). The dispatch clock used +23.3 ms; the Slot Watch observer used +19.6 ms, so grid-vs-POST comparisons carry a −3.7 ms difference.

## 8. Release dispatch

| Worker | Target | Function entered / pre-POST | POST sent (browser request event) | Vercel ID stamp* |
|---|---|---|---|---|
| A | C7 19:00–22:00 | +0.4 ms | **+9.8 ms** | …400**030** (+30 ms) |
| B | C6 19:00–22:00 | +1.1 ms | +10.5 ms | …400**031** (+31 ms) |
| C | C5 19:00–22:00 | +1.5 ms | +10.6 ms | …400**032** (+32 ms) |
| D | C4 19:00–22:00 | +1.8 ms | +10.6 ms | …400**031** (+31 ms) |
| F | C2 15:00–18:00 | +2.7 ms | +10.7 ms | …400**038** (+38 ms) |
| E | C3 19:00–22:00 | +2.0 ms | +11.6 ms | …400**032** (+32 ms) |
| G | C1 15:00–18:00 | +2.9 ms | **+11.7 ms** | …400**034** (+34 ms) |

First to last: 1.9 ms. About 8–9 ms passes between the runner's pre-POST mark and Chrome's request event.

\*The middle number of each `x-vercel-id` (e.g. `sin1::sin1::p8z7w-1790294400030-…`) reads as a millisecond timestamp 30–38 ms after release. If that is Vercel's receive time, the requests reached Vercel's Singapore edge at +30 to +38 ms. This is a reading of the ID format, not documented behaviour.

**Compared with the offline benchmark** (Phase 3, 7 workers: first POST p50 6.3 ms, last POST p50 7.4 ms / p95 10.8 ms), live was 2–4 ms slower. That is within the clock uncertainty. **Compared with 24 Sep** (A, C, D at +100 to +104 ms), sending was about 90 ms earlier.

## 9. Onda's answers

| Worker | Target | Answered | Server wait | Body | Result |
|---|---|---|---|---|---|
| D | C4 19–22 | +29.107 s | 29,098 ms | 219 B | 409 · application · availability |
| B | C6 19–22 | +29.557 s | 29,548 ms | 405 B | 409 · application · availability |
| C | C5 19–22 | +29.822 s | 29,810 ms | 220 B | 409 · application · availability |
| E | C3 19–22 | +32.175 s | 32,165 ms | 407 B | 409 · application · availability |
| G | C1 15–18 | +32.976 s | 32,966 ms | 399 B | 409 · application · availability |
| F | C2 15–18 | +33.857 s | 33,847 ms | 399 B | 409 · application · availability |
| A | C7 19–22 | +34.618 s | 34,609 ms | 397 B | 409 · application · availability |

- All went over already-open HTTP/2 connections: no DNS, connect or TLS time, 0.1–0.3 ms to send. **Everything else was waiting for Onda.**
- All answers came from Onda's application (JSON), not a Vercel edge error page. `x-vercel-cache: MISS`; no `cf-ray`, `x-request-id` or `server-timing`.
- **Two body sizes:** C and D (courts 5 and 4, 19:00–22:00) got about 220-byte bodies; the other five got about 400 bytes. The bot doesn't store the body, so what differs is unknown.
- Answers arrived in the order D, B, C, E, G, F, A, over 5.5 s.
- For comparison, 24 Sep's three answers took 17.5–28.3 s.

## 10. What the public grid showed

### 10.1 Publication
- Last read without Sunday: requested −1.987 s, answered −1.779 s.
- First read with Sunday: requested +0.016 s, answered +4.142 s, cache MISS, age 0. So publication happened somewhere between −1.78 s and +4.14 s; nothing was read in between.
- First grid: 107 open, 5 unavailable (the pre-existing C3 16–18 and C4 16–19 records). **Every Wave 1 target was fully open.** Unlike 23 and 24 Sep, no hour was unavailable without a public booking record.

### 10.2 Read speed by phase (availability reads, by request time)

| Requested | Reads | Fastest | Median | Slowest |
|---|---|---|---|---|
| +0 to +12 s | 9 | 4.1 s | 8.9 s | 15.0 s |
| +12 to +30 s | 12 | 0.07 s | 4.0 s | 9.9 s |
| +30 to +60 s | 30 | 0.07 s | 0.09 s | 2.8 s |
| +60 to +300 s | 48 | 0.07 s | 0.22 s | 1.2 s |
| +300 to +900 s | 21 | 0.17 s | 0.35 s | 0.61 s |

9 reads were skipped because 6 were already in flight (at +7, 8, 9, 13, 14, 15, 16, 27, 28 s), and 1 booking read was skipped at +10 s. No read failed.

### 10.3 Order in which hours first showed as taken

By the first read (in request order) showing each hour unavailable. Reads overlapped, so Onda's own order isn't established.

| Read | Requested → answered | Newly unavailable |
|---|---|---|
| #12 | +2.0 s → +17.0 s | C2 14, C2 16, C4 12, C4 21, **C7 19** |
| #15 | +10.0 s → +18.9 s | **C1 15**, C1 19, C3 12, C3 14, **C3 20**, **C4 20**, C5 12, C5 14, C6 17 |
| #17 | +12.0 s → +17.9 s | **C1 16, C1 17**, **C2 15**, C2 19, C2 21, C4 14, C4 15, C6 16 |
| #20 | +19.0 s → +28.9 s | 39 hours: the rest of 12:00–22:00 on C1–C5, most of C6, several on C7 |
| #25 | +24.0 s → +29.0 s | C1 21, C6 19, C7 16, C7 21 |
| #29 | +30.0 s → +32.8 s | C2 17, C3 22, C6 14, C6 21, C7 15, C7 18 |
| #30 | +31.0 s → +32.9 s | C7 12 → **12:00–22:00 now gone on every court** |
| #46 | +47 s | C7 08–11 |
| #53 | +54 s | C4 09–12, C5 09–12 |
| #62 | +75 s | C6 08–11 |
| #65 | +90 s | C3 09–12 |
| #70 | +115 s | C1 09–12, C2 09–12 |
| #81 | +170 s | C6 11, C7 11 → 12 hours left (08:00 on C1–C5, 23:00 everywhere) |

Bold marks hours in our Wave 1 targets. Public booking records followed: 5 hours at −60 s and +2 s, **77 at +30 s (exactly 12:00–22:00 × 7 courts)**, 86 at +60 s, 98 at +120 s, 100 at +300 s and +600 s, 85 at +900 s.

**The morning went in 3-hour blocks, one court at a time, over two minutes:** C7 08–11, then C4 and C5 09–12, C6 08–11, C3 09–12, C1 and C2 09–12.

### 10.4 Reads disagreeing with each other (+17 s to +60 s)
Between about +17 s and +60 s, reads answered a second apart often disagreed. For example, open counts in request order went 42, 46, 36, 46, 36, 35, …, 32, 35, 32, …, 26, 32, 26. Counting in request order, hours flipped from unavailable back to open 95 times before +60 s and 44 times after. The app's own reopen list uses a different rule and has 79 entries, 76 of them before +60 s. Cache status was MISS throughout. The cause isn't visible in the data; it could be different backend replicas answering, or holds being created and dropped.

## 11. Reopenings after the rush

Every change after +60 s (Sunday, this release):

| Read (requested) | Opened | Closed again |
|---|---|---|
| +250 s | C5 13 | — |
| +255 s | C4 13–16, C5 14–15 (**C4 and C5 13:00–16:00 fully open**) | +265 s (all six) |
| +420 s | **C5 16:00–19:00, C6 16:00–19:00** | +450 s |
| **+630 s** | **31 hours**: C1 12–18 and 21; C2 12–15, 16–18, 21–23; C3 12, 14, 20, 22; C4 12, 22; C5 12; C6 12–16, 19, 21; C7 12–14, 15, 18 | +660 s: C1 15–18 and C6 13–16 (as exact 3-hour blocks); +690 s: C1 13, C6 21; +720 s: C1 21, C2 16–18, C2 21, C3 20, C6 19; +810 s: C7 18; +870 s: C1 14 (C1 13 reopened); +900 s: C2 14 |
| End (+900 s) | 27 open, none of the 11 candidates fully open | |

- **The +630 s reopening fits Onda's 10-minute hold.** The bot's own hold on 23 Sep expired exactly 10:00 after capture, and most records here were created between +2 s and +30 s. It's not proven.
- Public records dropped from 100 hours (+600 s) to 85 (+900 s).
- **12:00 opened on all 7 courts in the same read**, and by 08:24 was still free on 6 of 7.
- **Some reopened hours were re-taken within 30 s as exact 3-hour blocks** (C1 15–18, C6 13–16).

**The same happened on the 24 Sep release (target Sat 26):** 7 → 17 open between the +600 s and +630 s reads (C1 21 and 23, C2 14, C3 20, C4 20–22, C6 13 and 23, C7 14 and 17). Then C7 09:00–12:00 opened at +690 s. Records went 59 → 53. Grids are in Appendix L.

**Candidate-matching windows after the rush (Sunday):**

| When | Fully open 3-hour window | Was it a candidate? |
|---|---|---|
| +255 s (two reads, gone by +265 s) | C4 13–16, C5 13–16 | No (no 13:00 candidates) |
| +420 s (one read) | C5 16–19, C6 16–19 | No (candidates were 15:00–18:00, one hour earlier) |
| +630 s (one read) | **C1 15–18** | **Yes, priority 7, Rescue not allowed** |
| +630 s | C1 12–15, C2 12–15, C6 12–15, C6 13–16 | No (no 12:00/13:00 candidates) |
| +630 s | C1 13–16, C1 14–17 | No |

## 12. The 12:00–22:00 blanket-grab question

The operator believes scalpers blanketed 12:00–22:00 on every court.

**What fits that:**
- At +30 s the public records were **exactly 12:00–22:00, the same range on all 7 courts** (77 hours), while 08:00 and 23:00 were untouched.
- Three of our target hours were already unavailable in a read sent at +2 s while our requests, sent at +10 ms, waited about 30 s.
- At +10.5 min the first hour of that range (12:00) opened **on all 7 courts in the same read**. By 08:24, 12:00 was free on 6 of 7 courts and 22:00 on all 7: the edges of the range let go across every court together. Many unrelated bookers each failing to pay for the same hour on every court is less likely than one party trimming a block.
- Morning hours were taken in identical 3-hour blocks court by court, and reopened hours were re-taken as exact 3-hour blocks within 30 s.

**What the data can't show:**
- Onda's public booking list returns only date, start, end and status. There are no names or customer data, and there's one record per hour, so it can't show who booked or whether the hours were one party or many.
- Sunday midday and evening is prime time; heavy ordinary demand would also take those hours first.
- Records at 08:24: 54 confirmed, 23 pending. At 08:33: 57 confirmed, 24 pending, and C1/C2 21:00–24:00, which had been free at 08:24, were now pending. Pending lasting well past 10 minutes means "pending" is not only the 10-minute hold; its exact meaning is unknown.

## 13. Every candidate

"Fully open" means all three hours showed O in the same read.

| Priority | Target | Sent? | Fully open in reads requested at | First unavailable read | Fully open after the rush |
|---|---|---|---|---|---|
| 1 | C7 19–22 (A) | +9.8 ms → 409 at +34.6 s | +0.0, 0.3, 0.5, 1.0 s | #12 (+2.0 s) | never |
| 2 | C6 19–22 (B) | +10.5 ms → 409 at +29.6 s | 14 reads up to +22.0 s | #20 (+19.0 s) | never |
| 3 | C5 19–22 (C) | +10.6 ms → 409 at +29.8 s | 14 reads up to +22.0 s | #20 (+19.0 s) | never |
| 4 | C4 19–22 (D) | +10.6 ms → 409 at +29.1 s | +0.0 to +1.0 s | #12 (+2.0 s) | never |
| 5 | C3 19–22 (E) | +11.6 ms → 409 at +32.2 s | 9 reads up to +22.0 s | #15 (+10.0 s) | never |
| 6 | C2 15–18 (F) | +10.7 ms → 409 at +33.9 s | +0.0 to +1.0 s | #12 (+2.0 s) | never |
| 7 | C1 15–18 (G) | +11.7 ms → 409 at +33.0 s | 9 reads up to +22.0 s | #15 (+10.0 s) | **+630 s read only** |
| 8 | C7 15–18 | not sendable | 14 reads up to +22.0 s | #20 (+19.0 s) | never |
| 9 | C6 15–18 | not sendable | 9 reads up to +22.0 s | #15 (+10.0 s) | never |
| 10 | C5 15–18 | not sendable | 14 reads up to +22.0 s | #20 (+19.0 s) | never |
| 11 | C4 15–18 | not sendable | never (pre-existing records) | — | never |

B's and C's targets still looked fully open in reads requested up to +22 s but were refused at +29.6 s and +29.8 s. Reads show state at an unknown moment between request and answer, so this doesn't show the order in which Onda processed things.

## 14. Compared with earlier releases

| Release (target) | Grid quality | First useful grid | Sent | Answer time | Outcome |
|---|---|---|---|---|---|
| 22 Sep (Thu 24) | NONE | none | — | — | `API_NO_AVAILABLE_CANDIDATE` |
| 23 Sep (Fri 25, Special Friday) | POOR (counts only) | +6.0 s | E, F | — | `SPECIAL_SESSION_NOT_AVAILABLE` |
| 24 Sep (Sat 26) | POOR | +15.7 s (55 open) | A, C, D at about +0.100 s (B excluded) | 17.5–28.3 s | all 409 |
| **25 Sep (Sun 27)** | **FAIR** | **+4.1 s (107 open)** | **A–G at +0.010 to +0.012 s** | **29.1–34.6 s** | **all 409** |

On both releases with grids (24 and 25 Sep), prime hours were gone within about 30 s, and hours reopened between the +600 s and +630 s reads.

## 15. What limited this run (from the plan and the code)

Code references are to `Source/src/api-booking/`. These are code findings; Wave 2 and Rescue have never run live.

1. **Wave 2 needs standby workers.** `precision-phase3.ts:213` selects Wave 2 workers only from `standby`, and authorization rejects a Wave 2 budget larger than the standby count (`:91`, `:93`). With all 7 workers in Wave 1, Wave 2 was impossible.
2. **Rescue was off.** It needs `rescueEnabled`, a rescue budget, the candidate's own Rescue permission, and a total at least Wave 1 + Rescue (`:89–93`, `:208–210`). All four were missing.
3. **What Rescue needs to fire** (`:199–231`):
   - nothing in flight, at least one rejection, and no UNKNOWN or held attempt;
   - the candidate's range seen unavailable in an earlier read, then fully open in the newest complete, cache-MISS, fresh read;
   - one Rescue per candidate per unavailable period.
   It can reuse Wave 1 workers once they've settled (`:214–217`).
   Applied to this run, a Rescue for C1 15–18 would have qualified on the +630 s read and posted around +635–637 s. Whether Onda would have accepted it is unknown; the +660 s read showed it taken again.
4. **Risk: attempts give up when a newer read arrives.** `desktop-runner.ts:835–844` runs fresh security preparation (3.8–5.5 s at release), then continues only if no newer grid read has arrived (`current.observation.seq !== evidenceSeq` → return, with no log line). `:859–862` checks again before the POST.
   - Slot Watch reads every 1 s from +5 to +60 s and every 5 s to +300 s, so a Wave 2 or Rescue in those periods would usually abandon itself and try again from the next read, likely without ever sending.
   - At the 30 s spacing used after +300 s it passes.
   - This affects the +255 s window (5 s spacing) and any plan to read faster around +10 min.
5. **Freshness limit.** `adaptiveMaxAgeMs` = 2 × read time + security time + 1 s, clamped to 6–15 s (`precision-phase3.ts:133`). At +630 s that's about 7.3 s, so the POST had to leave within about 7 s of the read's request. That's feasible with a 4–5 s security step.
6. **Window length.** The adaptive loop stops at release + 15 min (`desktop-runner.ts:877`) and Slot Watch ends at +900 s. Changes were still happening at +660–900 s on Sunday, and Saturday reopened more at +690 s.
7. **Read spacing after +5 min is 30 s.** The +420 s and +630 s windows were each seen in only one read, so a window can open and close between reads without being seen at all.
8. **Booking reads drop the status.** `public-bookings.ts` keeps court/start/end only; Onda also returns `bookingStatus` (confirmed/pending). Keeping it would show whether reopened hours were pending holds.
9. **The 409 body isn't kept**, so the two body sizes (§9) can't be explained.

## 16. What worked

- Seven identities, seven browsers ready in 1.7 s, no identity failure (24 Sep lost worker B).
- NTP consensus stable (±22–24 ms); the no-early-send guard held (earliest send +9.8 ms).
- Phase 1 armed dispatch performed live as offline: 7 sends within 1.9 ms, about 90 ms earlier than 24 Sep.
- Phase 2 Slot Watch produced the first well-observed release (FAIR): a complete grid requested at +0.016 s, 127/127 reads answered, 8/8 booking reads answered.
- The provider trace captured all 7 POSTs without touching the release instant (enabled +12 ms after each send).
- Journals, one-shot claims, lock and outcome were all consistent. No UNKNOWN and nothing to reconcile.
- Forensic report and Release Intelligence rebuilt automatically at 08:15.

## 17. What this data can't tell us

- How Onda queued or ordered requests, or why ours waited about 30 s while other bookings appeared within 2–17 s.
- Who holds the Sunday hours, or whether it's one party.
- The exact publication moment (between −1.78 s and +4.14 s).
- What pending means past 10 minutes.
- Whether a Rescue at +635 s would have been accepted.

## 18. Strategy for the next release (Sat 26 Sep 08:00, opening Mon 28 Sep)

**Known Monday state (08:33, before release):** 14 confirmed records. Court 2 20:00–23:00, Court 3 20:00–23:00, Court 6 18:00–22:00, Court 7 18:00–22:00. The date isn't published yet.

**Recommended plan changes (config only, no code):**
1. **Keep Wave 1 at 08:00 on 7 workers.** It costs nothing and sends at about +10 ms. Just don't expect it to win on its own: 0 for 2 on observed releases.
2. **Turn Rescue on:** `rescueEnabled: true`, Rescue budget 2–3, total = 7 + Rescue, and Rescue permission on every candidate you'd actually accept.
3. **Widen the candidates to the start times that actually reopened.** Phase 3 allows up to 21. Add, for example, 12:00, 13:00, 14:00, 16:00 and 17:00 starts across courts, and 2-hour candidates if acceptable. On Sunday this would have matched reopened ranges at +255 s, +420 s and +630 s, instead of only one range at +630 s. Which times and lengths are acceptable is your call.
4. **Drop the Wave 2 permissions** unless you move workers out of Wave 1 into standby. As configured they do nothing, and the rush is over within about 30 s while reads arrive 4–15 s late.
5. **Avoid Monday's pre-booked ranges:** C2/C3 20–23 and C6/C7 18–22.

**Code changes to consider before relying on Rescue (not done):**
1. Let an adaptive attempt proceed when a newer read still shows its range fully open, instead of requiring the same read number (§15.4). Without this, faster reads make Rescue less likely to fire.
2. Then read faster from about +9:30 to +12:00 (for example every 2 s), and extend the watch and adaptive loop to about +20 min.
3. Keep `bookingStatus` in booking reads and save a sanitized 409 body.
4. Add reads at T−1 s and T−0.5 s to narrow down when the date goes live.

## 19. Safety state now

- All 7 journals `rejected`; no holds, booking IDs or numbers.
- Automation lock released at 08:15. Bot browsers closed at 08:20 (all 7 had to be force-closed).
- Nothing to reconcile or pay.

## 20. Sources

| What | Path (under the install folder) |
|---|---|
| Runner trace | `.local/api-booking/run-progress/fc62669a-bfe5-4726-998a-fa0616bd1e19.ndjson` |
| App activity log | `.local/booking-runs/94772f25-edb2-49e4-b9ee-d1a1529ff329.ndjson` |
| Slot Watch | `.local/slot-watch/2026-09-27_60d68777-0022-471a-99aa-3a47543858f4.{ndjson,summary.json,txt}` |
| Forensic report and provider trace | `.local/release-forensics/fc62669a-bfe5-4726-998a-fa0616bd1e19/` |
| Freeze file | `.local/api-booking/precision-races/fc62669a-bfe5-4726-998a-fa0616bd1e19-phase3-freeze.json` |
| Journals | `.local/api-booking/api-first-journals/<key>/` (7 keys, Appendix H) |
| Clock evidence | `.local/network-clock-evidence/2026-09-24T23-*` and `.local/network-clock.json` |
| Release Intelligence | `.local/release-intelligence/` |
| 24 Sep Slot Watch | `.local/slot-watch/2026-09-26_d4cc58f6-2624-48fa-a60e-40736380511d.ndjson` |
| Plan | `config.local.json` → `PRECISION_PHASE3` |

The appendices below were generated from these files with the redaction rules of `scripts/export-sanitized-diagnostics.mjs`: fingerprint fields redacted, emails, phones and local paths removed, and 64-character hashes shortened.

## Appendices

### Appendix A — Runner trace (every event, 247 lines)

Source: `.local/api-booking/run-progress/fc62669a-bfe5-4726-998a-fa0616bd1e19.ndjson`. Times are this PC's wall clock (Manila); the PC clock was about 23 ms behind the NTP consensus, so release-relative offsets from the runner's trusted clock (`releaseLatenessMs`) are the authoritative ones. Candidate and journal hashes are shortened to 10 characters. Fields named *fingerprint* are redacted by the project's sanitizer rules.

| # | Manila time | vs 08:00 (wall) | Stage | Worker | Details |
|---|---|---|---|---|---|
| 1 | 07:29:51.439 | −1808.561 s | RUN_STARTED |  | elapsedMs=2 · sincePreviousMs=2 |
| 2 | 07:29:51.446 | −1808.554 s | RUN_CONFIGURATION |  | elapsedMs=9 · sincePreviousMs=7 · bookingMethod=proofless · workerCount=7 · prewarmLeadMs=15000 · releaseMs=1790294400000 |
| 3 | 07:29:51.518 | −1808.482 s | PREPARING_BROWSER | A | elapsedMs=81 · sincePreviousMs=72 |
| 4 | 07:29:51.535 | −1808.465 s | PREPARING_BROWSER | B | elapsedMs=98 · sincePreviousMs=17 |
| 5 | 07:29:51.548 | −1808.452 s | PREPARING_BROWSER | C | elapsedMs=111 · sincePreviousMs=13 |
| 6 | 07:29:51.559 | −1808.441 s | PREPARING_BROWSER | D | elapsedMs=122 · sincePreviousMs=11 |
| 7 | 07:29:51.571 | −1808.429 s | PREPARING_BROWSER | E | elapsedMs=134 · sincePreviousMs=12 |
| 8 | 07:29:51.584 | −1808.416 s | PREPARING_BROWSER | F | elapsedMs=146 · sincePreviousMs=12 |
| 9 | 07:29:51.595 | −1808.405 s | PREPARING_BROWSER | G | elapsedMs=158 · sincePreviousMs=12 |
| 10 | 07:29:53.128 | −1806.872 s | BROWSER_READY | A | elapsedMs=1691 · sincePreviousMs=1533 · port=19444 |
| 11 | 07:29:53.168 | −1806.832 s | BROWSER_READY | C | elapsedMs=1731 · sincePreviousMs=40 · port=19446 |
| 12 | 07:29:53.174 | −1806.826 s | BROWSER_READY | B | elapsedMs=1737 · sincePreviousMs=6 · port=19445 |
| 13 | 07:29:53.176 | −1806.824 s | BROWSER_READY | D | elapsedMs=1739 · sincePreviousMs=2 · port=19447 |
| 14 | 07:29:53.179 | −1806.821 s | BROWSER_READY | E | elapsedMs=1742 · sincePreviousMs=3 · port=19448 |
| 15 | 07:29:53.182 | −1806.818 s | BROWSER_READY | F | elapsedMs=1745 · sincePreviousMs=3 · port=19449 |
| 16 | 07:29:53.182 | −1806.818 s | BROWSER_READY | G | elapsedMs=1745 · sincePreviousMs=0 · port=19450 |
| 17 | 07:29:53.183 | −1806.817 s | BROWSER_PREPARATION_OUTCOME | A | elapsedMs=1745 · sincePreviousMs=0 · status=fulfilled · code=COMPLETED |
| 18 | 07:29:53.183 | −1806.817 s | BROWSER_PREPARATION_OUTCOME | B | elapsedMs=1746 · sincePreviousMs=1 · status=fulfilled · code=COMPLETED |
| 19 | 07:29:53.183 | −1806.817 s | BROWSER_PREPARATION_OUTCOME | C | elapsedMs=1746 · sincePreviousMs=0 · status=fulfilled · code=COMPLETED |
| 20 | 07:29:53.183 | −1806.817 s | BROWSER_PREPARATION_OUTCOME | D | elapsedMs=1746 · sincePreviousMs=0 · status=fulfilled · code=COMPLETED |
| 21 | 07:29:53.183 | −1806.817 s | BROWSER_PREPARATION_OUTCOME | E | elapsedMs=1746 · sincePreviousMs=0 · status=fulfilled · code=COMPLETED |
| 22 | 07:29:53.183 | −1806.817 s | BROWSER_PREPARATION_OUTCOME | F | elapsedMs=1746 · sincePreviousMs=0 · status=fulfilled · code=COMPLETED |
| 23 | 07:29:53.183 | −1806.817 s | BROWSER_PREPARATION_OUTCOME | G | elapsedMs=1746 · sincePreviousMs=0 · status=fulfilled · code=COMPLETED |
| 24 | 07:29:53.185 | −1806.815 s | PHASE3_AUTHORIZATION |  | elapsedMs=1748 · sincePreviousMs=2 · candidateCount=11 · wave1Count=7 · standbyCount=0 · maxWave2=0 · maxRescue=0 · maxTotal=7 · fingerprint=[REDACTED] |
| 25 | 07:29:53.185 | −1806.815 s | PHASE3_CANDIDATE |  | elapsedMs=1748 · sincePreviousMs=0 · candidateId=21f81fe8d0… · court=7 · startTime=19:00 · endTime=22:00 · durationHours=3 · priority=1 · amount=2100 · rateStatus=VENUE_SCHEDULE · source=current venue schedule |
| 26 | 07:29:53.185 | −1806.815 s | PHASE3_CANDIDATE |  | elapsedMs=1748 · sincePreviousMs=0 · candidateId=6ff22c70f6… · court=6 · startTime=19:00 · endTime=22:00 · durationHours=3 · priority=2 · amount=2100 · rateStatus=VENUE_SCHEDULE · source=current venue schedule |
| 27 | 07:29:53.185 | −1806.815 s | PHASE3_CANDIDATE |  | elapsedMs=1748 · sincePreviousMs=0 · candidateId=5186cf932d… · court=5 · startTime=19:00 · endTime=22:00 · durationHours=3 · priority=3 · amount=2100 · rateStatus=VENUE_SCHEDULE · source=current venue schedule |
| 28 | 07:29:53.185 | −1806.815 s | PHASE3_CANDIDATE |  | elapsedMs=1748 · sincePreviousMs=0 · candidateId=eff27bfc9a… · court=4 · startTime=19:00 · endTime=22:00 · durationHours=3 · priority=4 · amount=2100 · rateStatus=VENUE_SCHEDULE · source=current venue schedule |
| 29 | 07:29:53.185 | −1806.815 s | PHASE3_CANDIDATE |  | elapsedMs=1748 · sincePreviousMs=0 · candidateId=8bcb34195d… · court=3 · startTime=19:00 · endTime=22:00 · durationHours=3 · priority=5 · amount=2100 · rateStatus=VENUE_SCHEDULE · source=current venue schedule |
| 30 | 07:29:53.185 | −1806.815 s | PHASE3_CANDIDATE |  | elapsedMs=1748 · sincePreviousMs=0 · candidateId=e9b14c0cdb… · court=2 · startTime=15:00 · endTime=18:00 · durationHours=3 · priority=6 · amount=2100 · rateStatus=VENUE_SCHEDULE · source=current venue schedule |
| 31 | 07:29:53.185 | −1806.815 s | PHASE3_CANDIDATE |  | elapsedMs=1748 · sincePreviousMs=0 · candidateId=36414a6a2b… · court=1 · startTime=15:00 · endTime=18:00 · durationHours=3 · priority=7 · amount=2100 · rateStatus=VENUE_SCHEDULE · source=current venue schedule |
| 32 | 07:29:53.185 | −1806.815 s | PHASE3_CANDIDATE |  | elapsedMs=1748 · sincePreviousMs=0 · candidateId=6156d8c8d6… · court=7 · startTime=15:00 · endTime=18:00 · durationHours=3 · priority=8 · amount=2100 · rateStatus=VENUE_SCHEDULE · source=current venue schedule |
| 33 | 07:29:53.185 | −1806.815 s | PHASE3_CANDIDATE |  | elapsedMs=1748 · sincePreviousMs=0 · candidateId=8d207103c5… · court=6 · startTime=15:00 · endTime=18:00 · durationHours=3 · priority=9 · amount=2100 · rateStatus=VENUE_SCHEDULE · source=current venue schedule |
| 34 | 07:29:53.185 | −1806.815 s | PHASE3_CANDIDATE |  | elapsedMs=1748 · sincePreviousMs=0 · candidateId=f7fb95acc2… · court=5 · startTime=15:00 · endTime=18:00 · durationHours=3 · priority=10 · amount=2100 · rateStatus=VENUE_SCHEDULE · source=current venue schedule |
| 35 | 07:29:53.185 | −1806.815 s | PHASE3_CANDIDATE |  | elapsedMs=1748 · sincePreviousMs=0 · candidateId=58a0e5512a… · court=4 · startTime=15:00 · endTime=18:00 · durationHours=3 · priority=11 · amount=2100 · rateStatus=VENUE_SCHEDULE · source=current venue schedule |
| 36 | 07:50:00.300 | −599.700 s | NETWORK_CLOCK_REFRESHED |  | elapsedMs=1208847 · sincePreviousMs=1207099 · checkpoint=T-10M · offsetMs=20 · roundTripMs=43 · deltaMs=15 · sampleCount=10 · spreadMs=12.7 · uncertaintyMs=21.5 |
| 37 | 07:58:00.057 | −119.943 s | PHASE3_WAVE1_PRICE | A | elapsedMs=1688605 · sincePreviousMs=479758 · candidateId=21f81fe8d0… · amount=2100 · source=current venue schedule · rateStatus=VENUE_SCHEDULE · capturedAt=2026-09-24T17:00:11.776Z |
| 38 | 07:58:00.059 | −119.941 s | PHASE3_WAVE1_PRICE | B | elapsedMs=1688606 · sincePreviousMs=1 · candidateId=6ff22c70f6… · amount=2100 · source=current venue schedule · rateStatus=VENUE_SCHEDULE · capturedAt=2026-09-24T17:00:11.776Z |
| 39 | 07:58:00.059 | −119.941 s | PHASE3_WAVE1_PRICE | C | elapsedMs=1688607 · sincePreviousMs=1 · candidateId=5186cf932d… · amount=2100 · source=current venue schedule · rateStatus=VENUE_SCHEDULE · capturedAt=2026-09-24T17:00:11.776Z |
| 40 | 07:58:00.060 | −119.940 s | PHASE3_WAVE1_PRICE | D | elapsedMs=1688608 · sincePreviousMs=1 · candidateId=eff27bfc9a… · amount=2100 · source=current venue schedule · rateStatus=VENUE_SCHEDULE · capturedAt=2026-09-24T17:00:11.776Z |
| 41 | 07:58:00.061 | −119.939 s | PHASE3_WAVE1_PRICE | E | elapsedMs=1688609 · sincePreviousMs=1 · candidateId=8bcb34195d… · amount=2100 · source=current venue schedule · rateStatus=VENUE_SCHEDULE · capturedAt=2026-09-24T17:00:11.776Z |
| 42 | 07:58:00.062 | −119.938 s | PHASE3_WAVE1_PRICE | F | elapsedMs=1688609 · sincePreviousMs=0 · candidateId=e9b14c0cdb… · amount=2100 · source=current venue schedule · rateStatus=VENUE_SCHEDULE · capturedAt=2026-09-24T17:00:11.776Z |
| 43 | 07:58:00.063 | −119.937 s | PHASE3_WAVE1_PRICE | G | elapsedMs=1688611 · sincePreviousMs=2 · candidateId=36414a6a2b… · amount=2100 · source=current venue schedule · rateStatus=VENUE_SCHEDULE · capturedAt=2026-09-24T17:00:11.776Z |
| 44 | 07:58:00.065 | −119.935 s | PHASE3_FROZEN |  | elapsedMs=1688612 · sincePreviousMs=1 · candidateCount=11 · wave1Count=7 · fingerprint=[REDACTED] |
| 45 | 07:58:00.046 | −119.954 s | DIAGNOSTIC_ATTEMPT_ARMED | A | elapsedMs=1688613 · sincePreviousMs=1688613 · lane=core · attemptType=official · attemptId=core-A-official-1 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:58:00.046Z · court=7 · startTime=19:00 · durationHours=3 · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=0 |
| 46 | 07:58:00.046 | −119.954 s | DIAGNOSTIC_ATTEMPT_ARMED | B | elapsedMs=1688613 · sincePreviousMs=0 · lane=core · attemptType=official · attemptId=core-B-official-2 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:58:00.046Z · court=6 · startTime=19:00 · durationHours=3 · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=0 |
| 47 | 07:58:00.046 | −119.954 s | DIAGNOSTIC_ATTEMPT_ARMED | C | elapsedMs=1688613 · sincePreviousMs=0 · lane=core · attemptType=official · attemptId=core-C-official-3 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:58:00.046Z · court=5 · startTime=19:00 · durationHours=3 · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=0 |
| 48 | 07:58:00.046 | −119.954 s | DIAGNOSTIC_ATTEMPT_ARMED | D | elapsedMs=1688613 · sincePreviousMs=0 · lane=core · attemptType=official · attemptId=core-D-official-4 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:58:00.046Z · court=4 · startTime=19:00 · durationHours=3 · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=0 |
| 49 | 07:58:00.046 | −119.954 s | DIAGNOSTIC_ATTEMPT_ARMED | E | elapsedMs=1688613 · sincePreviousMs=0 · lane=core · attemptType=official · attemptId=core-E-official-5 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:58:00.046Z · court=3 · startTime=19:00 · durationHours=3 · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=0 |
| 50 | 07:58:00.046 | −119.954 s | DIAGNOSTIC_ATTEMPT_ARMED | F | elapsedMs=1688613 · sincePreviousMs=0 · lane=core · attemptType=official · attemptId=core-F-official-6 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:58:00.046Z · court=2 · startTime=15:00 · durationHours=3 · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=0 |
| 51 | 07:58:00.046 | −119.954 s | DIAGNOSTIC_ATTEMPT_ARMED | G | elapsedMs=1688613 · sincePreviousMs=0 · lane=core · attemptType=official · attemptId=core-G-official-7 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:58:00.046Z · court=1 · startTime=15:00 · durationHours=3 · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=0 |
| 52 | 07:59:00.192 | −59.808 s | NETWORK_CLOCK_CONSENSUS |  | elapsedMs=1748734 · sincePreviousMs=60122 · checkpoint=T-60S · offsetMs=24.3 · roundTripMs=44 · deltaMs=4.7 · sampleCount=10 · spreadMs=10.4 · uncertaintyMs=22.3 |
| 53 | 07:59:00.316 | −59.684 s | PHASE3_EVIDENCE |  | elapsedMs=1748858 · sincePreviousMs=124 · seq=1 · fitness=UNRELEASED · cache=MISS |
| 54 | 07:59:10.258 | −49.742 s | PHASE3_EVIDENCE |  | elapsedMs=1758801 · sincePreviousMs=9943 · seq=2 · fitness=UNRELEASED · cache=MISS |
| 55 | 07:59:20.205 | −39.795 s | PHASE3_EVIDENCE |  | elapsedMs=1768748 · sincePreviousMs=9947 · seq=3 · fitness=UNRELEASED · cache=MISS |
| 56 | 07:59:30.218 | −29.782 s | NETWORK_CLOCK_CONSENSUS |  | elapsedMs=1778761 · sincePreviousMs=10013 · checkpoint=T-30S · offsetMs=23.3 · roundTripMs=44 · deltaMs=-1 · sampleCount=10 · spreadMs=4.2 · uncertaintyMs=24.2 |
| 57 | 07:59:30.444 | −29.556 s | PHASE3_EVIDENCE |  | elapsedMs=1778988 · sincePreviousMs=227 · seq=4 · fitness=UNRELEASED · cache=MISS |
| 58 | 07:59:40.262 | −19.738 s | PHASE3_EVIDENCE |  | elapsedMs=1788806 · sincePreviousMs=9818 · seq=5 · fitness=UNRELEASED · cache=MISS |
| 59 | 07:59:44.977 | −15.023 s | SECURITY_PREPARATION_STARTED | A | elapsedMs=1793543 · sincePreviousMs=104930 · lane=core · attemptType=official · attemptId=core-A-official-1 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:44.977Z · securitySource=FRESH_ACQUISITION · operation=security · activeAvailability=0 · activeSecurity=1 · activeSlotChecks=0 · activeCheckouts=0 |
| 60 | 07:59:44.979 | −15.021 s | SECURITY_PREPARATION_STARTED | B | elapsedMs=1793545 · sincePreviousMs=2 · lane=core · attemptType=official · attemptId=core-B-official-2 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:44.979Z · securitySource=FRESH_ACQUISITION · operation=security · activeAvailability=0 · activeSecurity=2 · activeSlotChecks=0 · activeCheckouts=0 |
| 61 | 07:59:44.979 | −15.021 s | SECURITY_PREPARATION_STARTED | C | elapsedMs=1793546 · sincePreviousMs=1 · lane=core · attemptType=official · attemptId=core-C-official-3 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:44.979Z · securitySource=FRESH_ACQUISITION · operation=security · activeAvailability=0 · activeSecurity=3 · activeSlotChecks=0 · activeCheckouts=0 |
| 62 | 07:59:44.979 | −15.021 s | SECURITY_PREPARATION_STARTED | D | elapsedMs=1793546 · sincePreviousMs=0 · lane=core · attemptType=official · attemptId=core-D-official-4 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:44.979Z · securitySource=FRESH_ACQUISITION · operation=security · activeAvailability=0 · activeSecurity=4 · activeSlotChecks=0 · activeCheckouts=0 |
| 63 | 07:59:44.979 | −15.021 s | SECURITY_PREPARATION_STARTED | E | elapsedMs=1793546 · sincePreviousMs=0 · lane=core · attemptType=official · attemptId=core-E-official-5 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:44.979Z · securitySource=FRESH_ACQUISITION · operation=security · activeAvailability=0 · activeSecurity=5 · activeSlotChecks=0 · activeCheckouts=0 |
| 64 | 07:59:44.980 | −15.020 s | SECURITY_PREPARATION_STARTED | F | elapsedMs=1793546 · sincePreviousMs=0 · lane=core · attemptType=official · attemptId=core-F-official-6 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:44.980Z · securitySource=FRESH_ACQUISITION · operation=security · activeAvailability=0 · activeSecurity=6 · activeSlotChecks=0 · activeCheckouts=0 |
| 65 | 07:59:44.980 | −15.020 s | SECURITY_PREPARATION_STARTED | G | elapsedMs=1793546 · sincePreviousMs=0 · lane=core · attemptType=official · attemptId=core-G-official-7 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:44.980Z · securitySource=FRESH_ACQUISITION · operation=security · activeAvailability=0 · activeSecurity=7 · activeSlotChecks=0 · activeCheckouts=0 |
| 66 | 07:59:48.790 | −11.210 s | SECURITY_PREPARATION_COMPLETED | G | elapsedMs=1797357 · sincePreviousMs=3811 · lane=core · attemptType=official · attemptId=core-G-official-7 · timingKind=MEASURED_DURATION · eventAt=2026-09-24T23:59:48.790Z · securitySource=FRESH_ACQUISITION · durationMs=3811 · operation=security · activeAvailability=0 · activeSecurity=6 · activeSlotChecks=0 · activeCheckouts=0 |
| 67 | 07:59:49.303 | −10.697 s | SECURITY_PREPARATION_COMPLETED | B | elapsedMs=1797869 · sincePreviousMs=512 · lane=core · attemptType=official · attemptId=core-B-official-2 · timingKind=MEASURED_DURATION · eventAt=2026-09-24T23:59:49.303Z · securitySource=FRESH_ACQUISITION · durationMs=4324 · operation=security · activeAvailability=0 · activeSecurity=5 · activeSlotChecks=0 · activeCheckouts=0 |
| 68 | 07:59:49.825 | −10.175 s | SECURITY_PREPARATION_COMPLETED | E | elapsedMs=1798392 · sincePreviousMs=523 · lane=core · attemptType=official · attemptId=core-E-official-5 · timingKind=MEASURED_DURATION · eventAt=2026-09-24T23:59:49.825Z · securitySource=FRESH_ACQUISITION · durationMs=4846 · operation=security · activeAvailability=0 · activeSecurity=4 · activeSlotChecks=0 · activeCheckouts=0 |
| 69 | 07:59:49.871 | −10.129 s | SECURITY_PREPARATION_COMPLETED | D | elapsedMs=1798438 · sincePreviousMs=46 · lane=core · attemptType=official · attemptId=core-D-official-4 · timingKind=MEASURED_DURATION · eventAt=2026-09-24T23:59:49.871Z · securitySource=FRESH_ACQUISITION · durationMs=4892 · operation=security · activeAvailability=0 · activeSecurity=3 · activeSlotChecks=0 · activeCheckouts=0 |
| 70 | 07:59:49.908 | −10.092 s | SECURITY_PREPARATION_COMPLETED | A | elapsedMs=1798474 · sincePreviousMs=36 · lane=core · attemptType=official · attemptId=core-A-official-1 · timingKind=MEASURED_DURATION · eventAt=2026-09-24T23:59:49.908Z · securitySource=FRESH_ACQUISITION · durationMs=4931 · operation=security · activeAvailability=0 · activeSecurity=2 · activeSlotChecks=0 · activeCheckouts=0 |
| 71 | 07:59:50.156 | −9.844 s | SECURITY_PREPARATION_COMPLETED | F | elapsedMs=1798722 · sincePreviousMs=248 · lane=core · attemptType=official · attemptId=core-F-official-6 · timingKind=MEASURED_DURATION · eventAt=2026-09-24T23:59:50.156Z · securitySource=FRESH_ACQUISITION · durationMs=5176 · operation=security · activeAvailability=0 · activeSecurity=1 · activeSlotChecks=0 · activeCheckouts=0 |
| 72 | 07:59:50.234 | −9.766 s | PHASE3_EVIDENCE |  | elapsedMs=1798778 · sincePreviousMs=9972 · seq=6 · fitness=UNRELEASED · cache=MISS |
| 73 | 07:59:50.517 | −9.483 s | SECURITY_PREPARATION_COMPLETED | C | elapsedMs=1799084 · sincePreviousMs=362 · lane=core · attemptType=official · attemptId=core-C-official-3 · timingKind=MEASURED_DURATION · eventAt=2026-09-24T23:59:50.517Z · securitySource=FRESH_ACQUISITION · durationMs=5538 · operation=security · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=0 |
| 74 | 07:59:58.248 | −1.752 s | PHASE3_EVIDENCE |  | elapsedMs=1806792 · sincePreviousMs=8014 · seq=7 · fitness=UNRELEASED · cache=MISS |
| 75 | 08:00:00.006 | +0.006 s | PHASE3_WAVE1_STARTED | A | elapsedMs=1808550 · sincePreviousMs=1758 · candidateId=21f81fe8d0… · wave=WAVE_1 · attemptId=core-A-official-1 · court=7 · startTime=19:00 · endTime=22:00 · amount=2100 |
| 76 | 08:00:00.007 | +0.007 s | PHASE3_WAVE1_STARTED | B | elapsedMs=1808550 · sincePreviousMs=0 · candidateId=6ff22c70f6… · wave=WAVE_1 · attemptId=core-B-official-2 · court=6 · startTime=19:00 · endTime=22:00 · amount=2100 |
| 77 | 08:00:00.007 | +0.007 s | PHASE3_WAVE1_STARTED | C | elapsedMs=1808551 · sincePreviousMs=1 · candidateId=5186cf932d… · wave=WAVE_1 · attemptId=core-C-official-3 · court=5 · startTime=19:00 · endTime=22:00 · amount=2100 |
| 78 | 08:00:00.007 | +0.007 s | PHASE3_WAVE1_STARTED | D | elapsedMs=1808551 · sincePreviousMs=0 · candidateId=eff27bfc9a… · wave=WAVE_1 · attemptId=core-D-official-4 · court=4 · startTime=19:00 · endTime=22:00 · amount=2100 |
| 79 | 08:00:00.007 | +0.007 s | PHASE3_WAVE1_STARTED | E | elapsedMs=1808551 · sincePreviousMs=0 · candidateId=8bcb34195d… · wave=WAVE_1 · attemptId=core-E-official-5 · court=3 · startTime=19:00 · endTime=22:00 · amount=2100 |
| 80 | 08:00:00.007 | +0.007 s | PHASE3_WAVE1_STARTED | F | elapsedMs=1808551 · sincePreviousMs=0 · candidateId=e9b14c0cdb… · wave=WAVE_1 · attemptId=core-F-official-6 · court=2 · startTime=15:00 · endTime=18:00 · amount=2100 |
| 81 | 08:00:00.007 | +0.007 s | PHASE3_WAVE1_STARTED | G | elapsedMs=1808551 · sincePreviousMs=0 · candidateId=36414a6a2b… · wave=WAVE_1 · attemptId=core-G-official-7 · court=1 · startTime=15:00 · endTime=18:00 · amount=2100 |
| 82 | 07:59:59.977 | −0.023 s | CHECKOUT_FUNCTION_ENTERED | A | elapsedMs=1808543 · sincePreviousMs=9459 · lane=core · attemptType=official · attemptId=core-A-official-1 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:59.977Z · preparedContextAgeMs=10069 · securitySource=PREPARED_CONTEXT · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=0 |
| 83 | 07:59:59.977 | −0.023 s | CHECKOUT_PRE_POST | A | elapsedMs=1808543 · sincePreviousMs=0 · lane=core · attemptType=official · attemptId=core-A-official-1 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:59.977Z · preparedContextAgeMs=10069 · securitySource=PREPARED_CONTEXT · releaseLatenessMs=0.4 · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=0 |
| 84 | 07:59:59.977 | −0.023 s | CHECKOUT_FUNCTION_ENTERED | B | elapsedMs=1808544 · sincePreviousMs=1 · lane=core · attemptType=official · attemptId=core-B-official-2 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:59.977Z · preparedContextAgeMs=10674 · securitySource=PREPARED_CONTEXT · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=0 |
| 85 | 07:59:59.977 | −0.023 s | CHECKOUT_PRE_POST | B | elapsedMs=1808544 · sincePreviousMs=0 · lane=core · attemptType=official · attemptId=core-B-official-2 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:59.977Z · preparedContextAgeMs=10674 · securitySource=PREPARED_CONTEXT · releaseLatenessMs=1.1 · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=0 |
| 86 | 07:59:59.978 | −0.022 s | CHECKOUT_FUNCTION_ENTERED | C | elapsedMs=1808544 · sincePreviousMs=0 · lane=core · attemptType=official · attemptId=core-C-official-3 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:59.978Z · preparedContextAgeMs=9461 · securitySource=PREPARED_CONTEXT · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=0 |
| 87 | 07:59:59.978 | −0.022 s | CHECKOUT_PRE_POST | C | elapsedMs=1808544 · sincePreviousMs=0 · lane=core · attemptType=official · attemptId=core-C-official-3 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:59.978Z · preparedContextAgeMs=9461 · securitySource=PREPARED_CONTEXT · releaseLatenessMs=1.5 · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=0 |
| 88 | 07:59:59.978 | −0.022 s | CHECKOUT_FUNCTION_ENTERED | D | elapsedMs=1808545 · sincePreviousMs=1 · lane=core · attemptType=official · attemptId=core-D-official-4 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:59.978Z · preparedContextAgeMs=10107 · securitySource=PREPARED_CONTEXT · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=0 |
| 89 | 07:59:59.978 | −0.022 s | CHECKOUT_PRE_POST | D | elapsedMs=1808545 · sincePreviousMs=0 · lane=core · attemptType=official · attemptId=core-D-official-4 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:59.978Z · preparedContextAgeMs=10107 · securitySource=PREPARED_CONTEXT · releaseLatenessMs=1.8 · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=0 |
| 90 | 07:59:59.978 | −0.022 s | CHECKOUT_FUNCTION_ENTERED | E | elapsedMs=1808545 · sincePreviousMs=0 · lane=core · attemptType=official · attemptId=core-E-official-5 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:59.978Z · preparedContextAgeMs=10153 · securitySource=PREPARED_CONTEXT · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=0 |
| 91 | 07:59:59.978 | −0.022 s | CHECKOUT_PRE_POST | E | elapsedMs=1808545 · sincePreviousMs=0 · lane=core · attemptType=official · attemptId=core-E-official-5 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:59.978Z · preparedContextAgeMs=10153 · securitySource=PREPARED_CONTEXT · releaseLatenessMs=2 · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=0 |
| 92 | 07:59:59.979 | −0.021 s | CHECKOUT_FUNCTION_ENTERED | F | elapsedMs=1808546 · sincePreviousMs=1 · lane=core · attemptType=official · attemptId=core-F-official-6 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:59.979Z · preparedContextAgeMs=9823 · securitySource=PREPARED_CONTEXT · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=0 |
| 93 | 07:59:59.979 | −0.021 s | CHECKOUT_PRE_POST | F | elapsedMs=1808546 · sincePreviousMs=0 · lane=core · attemptType=official · attemptId=core-F-official-6 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:59.979Z · preparedContextAgeMs=9823 · securitySource=PREPARED_CONTEXT · releaseLatenessMs=2.7 · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=0 |
| 94 | 07:59:59.979 | −0.021 s | CHECKOUT_FUNCTION_ENTERED | G | elapsedMs=1808546 · sincePreviousMs=0 · lane=core · attemptType=official · attemptId=core-G-official-7 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:59.979Z · preparedContextAgeMs=11188 · securitySource=PREPARED_CONTEXT · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=0 |
| 95 | 07:59:59.979 | −0.021 s | CHECKOUT_PRE_POST | G | elapsedMs=1808546 · sincePreviousMs=0 · lane=core · attemptType=official · attemptId=core-G-official-7 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:59.979Z · preparedContextAgeMs=11188 · securitySource=PREPARED_CONTEXT · releaseLatenessMs=2.9 · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=0 |
| 96 | 08:00:00.010 | +0.010 s | PHASE3_DISPATCH | A | elapsedMs=1808553 · sincePreviousMs=2 · candidateId=21f81fe8d0… · wave=WAVE_1 · attemptId=core-A-official-1 |
| 97 | 08:00:00.011 | +0.011 s | PHASE3_DISPATCH | B | elapsedMs=1808554 · sincePreviousMs=1 · candidateId=6ff22c70f6… · wave=WAVE_1 · attemptId=core-B-official-2 |
| 98 | 08:00:00.011 | +0.011 s | PHASE3_DISPATCH | C | elapsedMs=1808554 · sincePreviousMs=0 · candidateId=5186cf932d… · wave=WAVE_1 · attemptId=core-C-official-3 |
| 99 | 08:00:00.011 | +0.011 s | PHASE3_DISPATCH | D | elapsedMs=1808554 · sincePreviousMs=0 · candidateId=eff27bfc9a… · wave=WAVE_1 · attemptId=core-D-official-4 |
| 100 | 08:00:00.011 | +0.011 s | PHASE3_DISPATCH | F | elapsedMs=1808554 · sincePreviousMs=0 · candidateId=e9b14c0cdb… · wave=WAVE_1 · attemptId=core-F-official-6 |
| 101 | 08:00:00.011 | +0.011 s | PHASE3_DISPATCH | E | elapsedMs=1808555 · sincePreviousMs=1 · candidateId=8bcb34195d… · wave=WAVE_1 · attemptId=core-E-official-5 |
| 102 | 07:59:59.986 | −0.014 s | CHECKOUT_HTTP_POST_INITIATED | A | elapsedMs=1808553 · sincePreviousMs=7 · lane=core · attemptType=official · attemptId=core-A-official-1 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:59.986Z · initiationEvidence=PLAYWRIGHT_REQUEST_EVENT · releaseLatenessMs=9.8 · operation=checkout · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=1 |
| 103 | 08:00:00.012 | +0.012 s | PHASE3_DISPATCH | G | elapsedMs=1808555 · sincePreviousMs=0 · candidateId=36414a6a2b… · wave=WAVE_1 · attemptId=core-G-official-7 |
| 104 | 07:59:59.987 | −0.013 s | CHECKOUT_HTTP_POST_INITIATED | B | elapsedMs=1808553 · sincePreviousMs=0 · lane=core · attemptType=official · attemptId=core-B-official-2 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:59.987Z · initiationEvidence=PLAYWRIGHT_REQUEST_EVENT · releaseLatenessMs=10.5 · operation=checkout · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=2 |
| 105 | 07:59:59.987 | −0.013 s | CHECKOUT_HTTP_POST_INITIATED | C | elapsedMs=1808554 · sincePreviousMs=1 · lane=core · attemptType=official · attemptId=core-C-official-3 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:59.987Z · initiationEvidence=PLAYWRIGHT_REQUEST_EVENT · releaseLatenessMs=10.6 · operation=checkout · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=3 |
| 106 | 07:59:59.987 | −0.013 s | CHECKOUT_HTTP_POST_INITIATED | D | elapsedMs=1808554 · sincePreviousMs=0 · lane=core · attemptType=official · attemptId=core-D-official-4 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:59.987Z · initiationEvidence=PLAYWRIGHT_REQUEST_EVENT · releaseLatenessMs=10.6 · operation=checkout · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=4 |
| 107 | 07:59:59.987 | −0.013 s | CHECKOUT_HTTP_POST_INITIATED | F | elapsedMs=1808554 · sincePreviousMs=0 · lane=core · attemptType=official · attemptId=core-F-official-6 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:59.987Z · initiationEvidence=PLAYWRIGHT_REQUEST_EVENT · releaseLatenessMs=10.7 · operation=checkout · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=5 |
| 108 | 07:59:59.988 | −0.012 s | CHECKOUT_HTTP_POST_INITIATED | E | elapsedMs=1808554 · sincePreviousMs=0 · lane=core · attemptType=official · attemptId=core-E-official-5 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:59.988Z · initiationEvidence=PLAYWRIGHT_REQUEST_EVENT · releaseLatenessMs=11.6 · operation=checkout · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=6 |
| 109 | 07:59:59.988 | −0.012 s | CHECKOUT_HTTP_POST_INITIATED | G | elapsedMs=1808555 · sincePreviousMs=1 · lane=core · attemptType=official · attemptId=core-G-official-7 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-24T23:59:59.988Z · initiationEvidence=PLAYWRIGHT_REQUEST_EVENT · releaseLatenessMs=11.7 · operation=checkout · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=7 |
| 110 | 08:00:04.146 | +4.146 s | PHASE3_EVIDENCE |  | elapsedMs=1812689 · sincePreviousMs=4134 · seq=8 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 111 | 08:00:09.079 | +9.079 s | PHASE3_EVIDENCE |  | elapsedMs=1817622 · sincePreviousMs=4933 · seq=11 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 112 | 08:00:09.079 | +9.079 s | PHASE3_EVIDENCE |  | elapsedMs=1817622 · sincePreviousMs=0 · seq=10 · fitness=FORENSIC_ONLY_OUTDATED_REQUEST · cache=MISS |
| 113 | 08:00:11.641 | +11.641 s | PHASE3_EVIDENCE |  | elapsedMs=1820184 · sincePreviousMs=2562 · seq=9 · fitness=FORENSIC_ONLY_OUTDATED_REQUEST · cache=MISS |
| 114 | 08:00:17.004 | +17.004 s | PHASE3_EVIDENCE |  | elapsedMs=1825548 · sincePreviousMs=5364 · seq=12 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 115 | 08:00:17.783 | +17.783 s | PHASE3_EVIDENCE |  | elapsedMs=1826326 · sincePreviousMs=778 · seq=13 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 116 | 08:00:17.783 | +17.783 s | PHASE3_EVIDENCE |  | elapsedMs=1826326 · sincePreviousMs=0 · seq=16 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 117 | 08:00:17.783 | +17.783 s | PHASE3_EVIDENCE |  | elapsedMs=1826326 · sincePreviousMs=0 · seq=14 · fitness=FORENSIC_ONLY_OUTDATED_REQUEST · cache=MISS |
| 118 | 08:00:17.941 | +17.941 s | PHASE3_EVIDENCE |  | elapsedMs=1826484 · sincePreviousMs=158 · seq=18 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 119 | 08:00:17.941 | +17.941 s | PHASE3_EVIDENCE |  | elapsedMs=1826484 · sincePreviousMs=0 · seq=17 · fitness=FORENSIC_ONLY_OUTDATED_REQUEST · cache=MISS |
| 120 | 08:00:18.100 | +18.100 s | PHASE3_EVIDENCE |  | elapsedMs=1826644 · sincePreviousMs=160 · seq=19 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 121 | 08:00:18.943 | +18.943 s | PHASE3_EVIDENCE |  | elapsedMs=1827486 · sincePreviousMs=842 · seq=15 · fitness=FORENSIC_ONLY_OUTDATED_REQUEST · cache=MISS |
| 122 | 08:00:21.133 | +21.133 s | PHASE3_EVIDENCE |  | elapsedMs=1829676 · sincePreviousMs=2190 · seq=22 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 123 | 08:00:22.099 | +22.099 s | PHASE3_EVIDENCE |  | elapsedMs=1830642 · sincePreviousMs=966 · seq=23 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 124 | 08:00:28.893 | +28.893 s | PHASE3_EVIDENCE |  | elapsedMs=1837436 · sincePreviousMs=6794 · seq=20 · fitness=FORENSIC_ONLY_OUTDATED_REQUEST · cache=MISS |
| 125 | 08:00:28.893 | +28.893 s | PHASE3_EVIDENCE |  | elapsedMs=1837436 · sincePreviousMs=0 · seq=24 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 126 | 08:00:28.957 | +28.957 s | PHASE3_EVIDENCE |  | elapsedMs=1837500 · sincePreviousMs=64 · seq=21 · fitness=FORENSIC_ONLY_OUTDATED_REQUEST · cache=MISS |
| 127 | 08:00:28.989 | +28.989 s | PHASE3_EVIDENCE |  | elapsedMs=1837532 · sincePreviousMs=32 · seq=25 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 128 | 08:00:29.021 | +29.021 s | PHASE3_EVIDENCE |  | elapsedMs=1837564 · sincePreviousMs=32 · seq=26 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 129 | 08:00:29.021 | +29.021 s | PHASE3_EVIDENCE |  | elapsedMs=1837564 · sincePreviousMs=0 · seq=27 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 130 | 08:00:29.086 | +29.086 s | CHECKOUT_RESPONSE_COMPLETED | D | elapsedMs=1837652 · sincePreviousMs=29097 · lane=core · attemptType=official · attemptId=core-D-official-4 · timingKind=MEASURED_DURATION · eventAt=2026-09-25T00:00:29.086Z · networkDurationMs=29107 · statusCode=409 · dispatchState=RESPONSE_CAPTURED · failureCategory=ONDA_HTTP_STATUS_INVALID · errorHint=availability · responseSource=application · operation=checkout · durationMs=29098 · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=6 |
| 131 | 08:00:29.162 | +29.162 s | PHASE3_SETTLED | D | elapsedMs=1837705 · sincePreviousMs=141 · candidateId=eff27bfc9a… · wave=WAVE_1 · attemptId=core-D-official-4 · state=REJECTED |
| 132 | 08:00:29.180 | +29.180 s | PHASE3_EVIDENCE |  | elapsedMs=1837723 · sincePreviousMs=18 · seq=28 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 133 | 08:00:29.535 | +29.535 s | CHECKOUT_RESPONSE_COMPLETED | B | elapsedMs=1838101 · sincePreviousMs=449 · lane=core · attemptType=official · attemptId=core-B-official-2 · timingKind=MEASURED_DURATION · eventAt=2026-09-25T00:00:29.535Z · networkDurationMs=29557 · statusCode=409 · dispatchState=RESPONSE_CAPTURED · failureCategory=ONDA_HTTP_STATUS_INVALID · errorHint=availability · responseSource=application · operation=checkout · durationMs=29548 · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=5 |
| 134 | 08:00:29.580 | +29.580 s | PHASE3_SETTLED | B | elapsedMs=1838123 · sincePreviousMs=400 · candidateId=6ff22c70f6… · wave=WAVE_1 · attemptId=core-B-official-2 · state=REJECTED |
| 135 | 08:00:29.801 | +29.801 s | CHECKOUT_RESPONSE_COMPLETED | C | elapsedMs=1838367 · sincePreviousMs=266 · lane=core · attemptType=official · attemptId=core-C-official-3 · timingKind=MEASURED_DURATION · eventAt=2026-09-25T00:00:29.801Z · networkDurationMs=29822 · statusCode=409 · dispatchState=RESPONSE_CAPTURED · failureCategory=ONDA_HTTP_STATUS_INVALID · errorHint=availability · responseSource=application · operation=checkout · durationMs=29813 · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=4 |
| 136 | 08:00:29.875 | +29.875 s | PHASE3_SETTLED | C | elapsedMs=1838418 · sincePreviousMs=295 · candidateId=5186cf932d… · wave=WAVE_1 · attemptId=core-C-official-3 · state=REJECTED |
| 137 | 08:00:32.173 | +32.173 s | PHASE3_EVIDENCE |  | elapsedMs=1840716 · sincePreviousMs=2298 · seq=31 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 138 | 08:00:32.152 | +32.152 s | CHECKOUT_RESPONSE_COMPLETED | E | elapsedMs=1840718 · sincePreviousMs=2351 · lane=core · attemptType=official · attemptId=core-E-official-5 · timingKind=MEASURED_DURATION · eventAt=2026-09-25T00:00:32.152Z · networkDurationMs=32173 · statusCode=409 · dispatchState=RESPONSE_CAPTURED · failureCategory=ONDA_HTTP_STATUS_INVALID · errorHint=availability · responseSource=application · operation=checkout · durationMs=32164 · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=3 |
| 139 | 08:00:32.197 | +32.197 s | PHASE3_SETTLED | E | elapsedMs=1840740 · sincePreviousMs=24 · candidateId=8bcb34195d… · wave=WAVE_1 · attemptId=core-E-official-5 · state=REJECTED |
| 140 | 08:00:32.871 | +32.871 s | PHASE3_EVIDENCE |  | elapsedMs=1841414 · sincePreviousMs=674 · seq=29 · fitness=FORENSIC_ONLY_OUTDATED_REQUEST · cache=MISS |
| 141 | 08:00:32.897 | +32.897 s | PHASE3_EVIDENCE |  | elapsedMs=1841440 · sincePreviousMs=26 · seq=30 · fitness=FORENSIC_ONLY_OUTDATED_REQUEST · cache=MISS |
| 142 | 08:00:32.953 | +32.953 s | CHECKOUT_RESPONSE_COMPLETED | G | elapsedMs=1841519 · sincePreviousMs=801 · lane=core · attemptType=official · attemptId=core-G-official-7 · timingKind=MEASURED_DURATION · eventAt=2026-09-25T00:00:32.953Z · networkDurationMs=32973 · statusCode=409 · dispatchState=RESPONSE_CAPTURED · failureCategory=ONDA_HTTP_STATUS_INVALID · errorHint=availability · responseSource=application · operation=checkout · durationMs=32965 · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=2 |
| 143 | 08:00:33.025 | +33.025 s | PHASE3_SETTLED | G | elapsedMs=1841568 · sincePreviousMs=128 · candidateId=36414a6a2b… · wave=WAVE_1 · attemptId=core-G-official-7 · state=REJECTED |
| 144 | 08:00:33.118 | +33.118 s | PHASE3_EVIDENCE |  | elapsedMs=1841661 · sincePreviousMs=93 · seq=32 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 145 | 08:00:33.834 | +33.834 s | CHECKOUT_RESPONSE_COMPLETED | F | elapsedMs=1842400 · sincePreviousMs=881 · lane=core · attemptType=official · attemptId=core-F-official-6 · timingKind=MEASURED_DURATION · eventAt=2026-09-25T00:00:33.834Z · networkDurationMs=33855 · statusCode=409 · dispatchState=RESPONSE_CAPTURED · failureCategory=ONDA_HTTP_STATUS_INVALID · errorHint=availability · responseSource=application · operation=checkout · durationMs=33847 · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=1 |
| 146 | 08:00:33.915 | +33.915 s | PHASE3_SETTLED | F | elapsedMs=1842458 · sincePreviousMs=797 · candidateId=e9b14c0cdb… · wave=WAVE_1 · attemptId=core-F-official-6 · state=REJECTED |
| 147 | 08:00:34.117 | +34.117 s | PHASE3_EVIDENCE |  | elapsedMs=1842660 · sincePreviousMs=202 · seq=33 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 148 | 08:00:34.596 | +34.596 s | CHECKOUT_RESPONSE_COMPLETED | A | elapsedMs=1843162 · sincePreviousMs=762 · lane=core · attemptType=official · attemptId=core-A-official-1 · timingKind=MEASURED_DURATION · eventAt=2026-09-25T00:00:34.596Z · networkDurationMs=34618 · statusCode=409 · dispatchState=RESPONSE_CAPTURED · failureCategory=ONDA_HTTP_STATUS_INVALID · errorHint=availability · responseSource=application · operation=checkout · durationMs=34609 · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=0 |
| 149 | 08:00:34.672 | +34.672 s | PHASE3_SETTLED | A | elapsedMs=1843215 · sincePreviousMs=555 · candidateId=21f81fe8d0… · wave=WAVE_1 · attemptId=core-A-official-1 · state=REJECTED |
| 150 | 08:00:35.117 | +35.117 s | PHASE3_EVIDENCE |  | elapsedMs=1843660 · sincePreviousMs=445 · seq=34 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 151 | 08:00:36.082 | +36.082 s | PHASE3_EVIDENCE |  | elapsedMs=1844625 · sincePreviousMs=965 · seq=35 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 152 | 08:00:37.112 | +37.112 s | PHASE3_EVIDENCE |  | elapsedMs=1845655 · sincePreviousMs=1030 · seq=36 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 153 | 08:00:38.110 | +38.110 s | PHASE3_EVIDENCE |  | elapsedMs=1846653 · sincePreviousMs=998 · seq=37 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 154 | 08:00:39.327 | +39.327 s | PHASE3_EVIDENCE |  | elapsedMs=1847871 · sincePreviousMs=1218 · seq=38 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 155 | 08:00:40.326 | +40.326 s | PHASE3_EVIDENCE |  | elapsedMs=1848869 · sincePreviousMs=998 · seq=39 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 156 | 08:00:41.256 | +41.256 s | PHASE3_EVIDENCE |  | elapsedMs=1849799 · sincePreviousMs=930 · seq=40 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 157 | 08:00:42.105 | +42.105 s | PHASE3_EVIDENCE |  | elapsedMs=1850649 · sincePreviousMs=850 · seq=41 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 158 | 08:00:43.101 | +43.101 s | PHASE3_EVIDENCE |  | elapsedMs=1851645 · sincePreviousMs=996 · seq=42 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 159 | 08:00:44.099 | +44.099 s | PHASE3_EVIDENCE |  | elapsedMs=1852642 · sincePreviousMs=997 · seq=43 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 160 | 08:00:45.191 | +45.191 s | PHASE3_EVIDENCE |  | elapsedMs=1853734 · sincePreviousMs=1092 · seq=44 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 161 | 08:00:46.097 | +46.097 s | PHASE3_EVIDENCE |  | elapsedMs=1854640 · sincePreviousMs=906 · seq=45 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 162 | 08:00:47.344 | +47.344 s | PHASE3_EVIDENCE |  | elapsedMs=1855887 · sincePreviousMs=1247 · seq=46 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 163 | 08:00:48.127 | +48.127 s | PHASE3_EVIDENCE |  | elapsedMs=1856670 · sincePreviousMs=783 · seq=47 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 164 | 08:00:49.374 | +49.374 s | PHASE3_EVIDENCE |  | elapsedMs=1857917 · sincePreviousMs=1247 · seq=48 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 165 | 08:00:50.496 | +50.496 s | PHASE3_EVIDENCE |  | elapsedMs=1859040 · sincePreviousMs=1123 · seq=49 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 166 | 08:00:51.123 | +51.123 s | PHASE3_EVIDENCE |  | elapsedMs=1859666 · sincePreviousMs=626 · seq=50 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 167 | 08:00:52.127 | +52.127 s | PHASE3_EVIDENCE |  | elapsedMs=1860671 · sincePreviousMs=1005 · seq=51 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 168 | 08:00:53.096 | +53.096 s | PHASE3_EVIDENCE |  | elapsedMs=1861639 · sincePreviousMs=968 · seq=52 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 169 | 08:00:54.348 | +54.348 s | PHASE3_EVIDENCE |  | elapsedMs=1862891 · sincePreviousMs=1252 · seq=53 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 170 | 08:00:55.319 | +55.319 s | PHASE3_EVIDENCE |  | elapsedMs=1863862 · sincePreviousMs=971 · seq=54 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 171 | 08:00:56.102 | +56.102 s | PHASE3_EVIDENCE |  | elapsedMs=1864645 · sincePreviousMs=783 · seq=55 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 172 | 08:00:57.104 | +57.104 s | PHASE3_EVIDENCE |  | elapsedMs=1865647 · sincePreviousMs=1002 · seq=56 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 173 | 08:00:58.100 | +58.100 s | PHASE3_EVIDENCE |  | elapsedMs=1866643 · sincePreviousMs=996 · seq=57 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 174 | 08:00:59.099 | +59.099 s | PHASE3_EVIDENCE |  | elapsedMs=1867642 · sincePreviousMs=999 · seq=58 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 175 | 08:01:00.130 | +60.130 s | PHASE3_EVIDENCE |  | elapsedMs=1868673 · sincePreviousMs=1031 · seq=59 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 176 | 08:01:05.436 | +65.436 s | PHASE3_EVIDENCE |  | elapsedMs=1873980 · sincePreviousMs=5307 · seq=60 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 177 | 08:01:10.235 | +70.235 s | PHASE3_EVIDENCE |  | elapsedMs=1878778 · sincePreviousMs=4798 · seq=61 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 178 | 08:01:15.246 | +75.246 s | PHASE3_EVIDENCE |  | elapsedMs=1883789 · sincePreviousMs=5011 · seq=62 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 179 | 08:01:20.309 | +80.309 s | PHASE3_EVIDENCE |  | elapsedMs=1888853 · sincePreviousMs=5064 · seq=63 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 180 | 08:01:25.267 | +85.267 s | PHASE3_EVIDENCE |  | elapsedMs=1893810 · sincePreviousMs=4957 · seq=64 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 181 | 08:01:30.344 | +90.344 s | PHASE3_EVIDENCE |  | elapsedMs=1898888 · sincePreviousMs=5078 · seq=65 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 182 | 08:01:35.200 | +95.200 s | PHASE3_EVIDENCE |  | elapsedMs=1903744 · sincePreviousMs=4856 · seq=66 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 183 | 08:01:40.413 | +100.413 s | PHASE3_EVIDENCE |  | elapsedMs=1908957 · sincePreviousMs=5213 · seq=67 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 184 | 08:01:45.212 | +105.212 s | PHASE3_EVIDENCE |  | elapsedMs=1913755 · sincePreviousMs=4798 · seq=68 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 185 | 08:01:50.262 | +110.262 s | PHASE3_EVIDENCE |  | elapsedMs=1918806 · sincePreviousMs=5051 · seq=69 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 186 | 08:01:56.249 | +116.249 s | PHASE3_EVIDENCE |  | elapsedMs=1924793 · sincePreviousMs=5987 · seq=70 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 187 | 08:02:00.082 | +120.082 s | PHASE3_EVIDENCE |  | elapsedMs=1928626 · sincePreviousMs=3833 · seq=71 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 188 | 08:02:05.229 | +125.229 s | PHASE3_EVIDENCE |  | elapsedMs=1933772 · sincePreviousMs=5146 · seq=72 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 189 | 08:02:10.226 | +130.226 s | PHASE3_EVIDENCE |  | elapsedMs=1938769 · sincePreviousMs=4997 · seq=73 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 190 | 08:02:15.215 | +135.215 s | PHASE3_EVIDENCE |  | elapsedMs=1943759 · sincePreviousMs=4990 · seq=74 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 191 | 08:02:20.336 | +140.336 s | PHASE3_EVIDENCE |  | elapsedMs=1948880 · sincePreviousMs=5121 · seq=75 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 192 | 08:02:25.364 | +145.364 s | PHASE3_EVIDENCE |  | elapsedMs=1953907 · sincePreviousMs=5027 · seq=76 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 193 | 08:02:30.237 | +150.237 s | PHASE3_EVIDENCE |  | elapsedMs=1958780 · sincePreviousMs=4873 · seq=77 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 194 | 08:02:35.218 | +155.218 s | PHASE3_EVIDENCE |  | elapsedMs=1963762 · sincePreviousMs=4982 · seq=78 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 195 | 08:02:40.511 | +160.511 s | PHASE3_EVIDENCE |  | elapsedMs=1969054 · sincePreviousMs=5292 · seq=79 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 196 | 08:02:45.208 | +165.208 s | PHASE3_EVIDENCE |  | elapsedMs=1973752 · sincePreviousMs=4698 · seq=80 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 197 | 08:02:50.200 | +170.200 s | PHASE3_EVIDENCE |  | elapsedMs=1978743 · sincePreviousMs=4991 · seq=81 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 198 | 08:02:55.359 | +175.359 s | PHASE3_EVIDENCE |  | elapsedMs=1983902 · sincePreviousMs=5159 · seq=82 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 199 | 08:03:00.226 | +180.226 s | PHASE3_EVIDENCE |  | elapsedMs=1988769 · sincePreviousMs=4867 · seq=83 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 200 | 08:03:05.430 | +185.430 s | PHASE3_EVIDENCE |  | elapsedMs=1993973 · sincePreviousMs=5204 · seq=84 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 201 | 08:03:10.188 | +190.188 s | PHASE3_EVIDENCE |  | elapsedMs=1998731 · sincePreviousMs=4758 · seq=85 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 202 | 08:03:15.208 | +195.208 s | PHASE3_EVIDENCE |  | elapsedMs=2003751 · sincePreviousMs=5020 · seq=86 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 203 | 08:03:20.391 | +200.391 s | PHASE3_EVIDENCE |  | elapsedMs=2008934 · sincePreviousMs=5183 · seq=87 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 204 | 08:03:25.380 | +205.380 s | PHASE3_EVIDENCE |  | elapsedMs=2013924 · sincePreviousMs=4990 · seq=88 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 205 | 08:03:30.400 | +210.400 s | PHASE3_EVIDENCE |  | elapsedMs=2018943 · sincePreviousMs=5019 · seq=89 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 206 | 08:03:35.352 | +215.352 s | PHASE3_EVIDENCE |  | elapsedMs=2023896 · sincePreviousMs=4953 · seq=90 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 207 | 08:03:40.203 | +220.203 s | PHASE3_EVIDENCE |  | elapsedMs=2028747 · sincePreviousMs=4851 · seq=91 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 208 | 08:03:45.192 | +225.192 s | PHASE3_EVIDENCE |  | elapsedMs=2033735 · sincePreviousMs=4988 · seq=92 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 209 | 08:03:50.219 | +230.219 s | PHASE3_EVIDENCE |  | elapsedMs=2038762 · sincePreviousMs=5027 · seq=93 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 210 | 08:03:55.236 | +235.236 s | PHASE3_EVIDENCE |  | elapsedMs=2043779 · sincePreviousMs=5017 · seq=94 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 211 | 08:04:00.356 | +240.356 s | PHASE3_EVIDENCE |  | elapsedMs=2048899 · sincePreviousMs=5120 · seq=95 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 212 | 08:04:05.228 | +245.228 s | PHASE3_EVIDENCE |  | elapsedMs=2053771 · sincePreviousMs=4872 · seq=96 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 213 | 08:04:10.618 | +250.618 s | PHASE3_EVIDENCE |  | elapsedMs=2059162 · sincePreviousMs=5391 · seq=97 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 214 | 08:04:15.369 | +255.369 s | PHASE3_EVIDENCE |  | elapsedMs=2063912 · sincePreviousMs=4750 · seq=98 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 215 | 08:04:20.211 | +260.211 s | PHASE3_EVIDENCE |  | elapsedMs=2068754 · sincePreviousMs=4842 · seq=99 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 216 | 08:04:25.412 | +265.412 s | PHASE3_EVIDENCE |  | elapsedMs=2073955 · sincePreviousMs=5201 · seq=100 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 217 | 08:04:30.216 | +270.216 s | PHASE3_EVIDENCE |  | elapsedMs=2078759 · sincePreviousMs=4804 · seq=101 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 218 | 08:04:35.386 | +275.386 s | PHASE3_EVIDENCE |  | elapsedMs=2083929 · sincePreviousMs=5170 · seq=102 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 219 | 08:04:40.216 | +280.216 s | PHASE3_EVIDENCE |  | elapsedMs=2088760 · sincePreviousMs=4831 · seq=103 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 220 | 08:04:45.742 | +285.742 s | PHASE3_EVIDENCE |  | elapsedMs=2094285 · sincePreviousMs=5525 · seq=104 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 221 | 08:04:50.237 | +290.237 s | PHASE3_EVIDENCE |  | elapsedMs=2098780 · sincePreviousMs=4495 · seq=105 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 222 | 08:04:55.370 | +295.370 s | PHASE3_EVIDENCE |  | elapsedMs=2103913 · sincePreviousMs=5133 · seq=106 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 223 | 08:05:00.506 | +300.506 s | PHASE3_EVIDENCE |  | elapsedMs=2109049 · sincePreviousMs=5136 · seq=107 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 224 | 08:05:30.460 | +330.460 s | PHASE3_EVIDENCE |  | elapsedMs=2139003 · sincePreviousMs=29954 · seq=108 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 225 | 08:06:00.368 | +360.368 s | PHASE3_EVIDENCE |  | elapsedMs=2168911 · sincePreviousMs=29908 · seq=109 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 226 | 08:06:30.413 | +390.413 s | PHASE3_EVIDENCE |  | elapsedMs=2198957 · sincePreviousMs=30046 · seq=110 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 227 | 08:07:00.416 | +420.416 s | PHASE3_EVIDENCE |  | elapsedMs=2228960 · sincePreviousMs=30003 · seq=111 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 228 | 08:07:30.217 | +450.217 s | PHASE3_EVIDENCE |  | elapsedMs=2258761 · sincePreviousMs=29801 · seq=112 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 229 | 08:08:00.403 | +480.403 s | PHASE3_EVIDENCE |  | elapsedMs=2288947 · sincePreviousMs=30186 · seq=113 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 230 | 08:08:30.547 | +510.547 s | PHASE3_EVIDENCE |  | elapsedMs=2319090 · sincePreviousMs=30143 · seq=114 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 231 | 08:09:00.327 | +540.327 s | PHASE3_EVIDENCE |  | elapsedMs=2348870 · sincePreviousMs=29780 · seq=115 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 232 | 08:09:30.472 | +570.472 s | PHASE3_EVIDENCE |  | elapsedMs=2379016 · sincePreviousMs=30146 · seq=116 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 233 | 08:10:00.481 | +600.481 s | PHASE3_EVIDENCE |  | elapsedMs=2409025 · sincePreviousMs=30009 · seq=117 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 234 | 08:10:30.430 | +630.430 s | PHASE3_EVIDENCE |  | elapsedMs=2438973 · sincePreviousMs=29948 · seq=118 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 235 | 08:11:00.218 | +660.218 s | PHASE3_EVIDENCE |  | elapsedMs=2468762 · sincePreviousMs=29789 · seq=119 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 236 | 08:11:30.230 | +690.230 s | PHASE3_EVIDENCE |  | elapsedMs=2498773 · sincePreviousMs=30011 · seq=120 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 237 | 08:12:00.200 | +720.200 s | PHASE3_EVIDENCE |  | elapsedMs=2528743 · sincePreviousMs=29970 · seq=121 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 238 | 08:12:30.379 | +750.379 s | PHASE3_EVIDENCE |  | elapsedMs=2558922 · sincePreviousMs=30179 · seq=122 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 239 | 08:13:00.212 | +780.212 s | PHASE3_EVIDENCE |  | elapsedMs=2588755 · sincePreviousMs=29833 · seq=123 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 240 | 08:13:30.353 | +810.353 s | PHASE3_EVIDENCE |  | elapsedMs=2618896 · sincePreviousMs=30141 · seq=124 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 241 | 08:14:00.221 | +840.221 s | PHASE3_EVIDENCE |  | elapsedMs=2648764 · sincePreviousMs=29868 · seq=125 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 242 | 08:14:30.226 | +870.226 s | PHASE3_EVIDENCE |  | elapsedMs=2678770 · sincePreviousMs=30006 · seq=126 · fitness=ACTIONABLE_FRESH · cache=MISS |
| 243 | 08:15:00.037 | +900.037 s | PHASE3_OUTCOME |  | elapsedMs=2708581 · sincePreviousMs=29811 · outcome=ALL_REJECTED_WAITING_FOR_REOPEN · verifiedCount=0 · unknownCount=0 · attemptCount=7 |
| 244 | 08:15:00.037 | +900.037 s | PROVIDER_TRACE_SAVED |  | elapsedMs=2708581 · sincePreviousMs=865419 · status=SUCCESS · traceCount=7 · traceComplete=7 |
| 245 | 08:15:00.038 | +900.038 s | FAILED |  | elapsedMs=2708582 · sincePreviousMs=1 · code=ALL_REJECTED_WAITING_FOR_REOPEN |
| 246 | 08:15:00.067 | +900.067 s | PROCESS_EXIT |  | elapsedMs=2708611 · sincePreviousMs=29 · exitCode=1 |
| 247 | 08:15:00.044 | +900.044 s | RUN_DIAGNOSTIC_SUMMARY |  | elapsedMs=2708611 · sincePreviousMs=30 · timingKind=EVENT_TIMESTAMP · eventAt=2026-09-25T00:15:00.044Z · finalCode=ALL_REJECTED_WAITING_FOR_REOPEN · aborted=false · retryCount=0 · verifiedHoldCount=0 · qrHandoffCount=0 · partialHolds=false · coreElapsedMs=154549 · slowestStages=CHECKOUT_RESPONSE_COMPLETED:34618,CHECKOUT_RESPONSE_COMPLETED:33855,CHECKOUT_RESPONSE_COMPLETED:32973,CHECKOUT_RESPONSE_COMPLETED:32173,CHECKOUT_RESPONSE_COMPLETED:29822 · absentEvidence=availability-response,core-attempt · activeAvailability=0 · activeSecurity=0 · activeSlotChecks=0 · activeCheckouts=0 |

### Appendix B — App activity log for the run (every line, 202 lines)

Source: `.local/booking-runs/94772f25-edb2-49e4-b9ee-d1a1529ff329.ndjson` (the control panel's mirror of the runner; it adds process start/finish and the final status line).

```
07:29:50.868 run-start {"type":"run-start","label":"full","elapsedMs":0,"deltaMs":0}
07:29:50.868 info  Run started: full · Timing log: <install>\.local\booking-runs\94772f25-edb2-49e4-b9ee-d1a1529ff329.ndjson
07:29:50.878 info  Process started: apiRun · live
07:29:51.439 info  API run started · Timing log: .local/api-booking/run-progress/fc62669a-bfe5-4726-998a-fa0616bd1e19.ndjson · 2 ms total · +2 ms since prior stage
07:29:51.446 info  RUN CONFIGURATION · Progress recorded · 9 ms total · +7 ms since prior stage
07:29:51.518 info  Preparing isolated Chrome · Progress recorded · 81 ms total · +72 ms since prior stage
07:29:51.535 info  Preparing isolated Chrome · Progress recorded · 98 ms total · +17 ms since prior stage
07:29:51.548 info  Preparing isolated Chrome · Progress recorded · 111 ms total · +13 ms since prior stage
07:29:51.559 info  Preparing isolated Chrome · Progress recorded · 122 ms total · +11 ms since prior stage
07:29:51.571 info  Preparing isolated Chrome · Progress recorded · 134 ms total · +12 ms since prior stage
07:29:51.584 info  Preparing isolated Chrome · Progress recorded · 146 ms total · +12 ms since prior stage
07:29:51.595 info  Preparing isolated Chrome · Progress recorded · 158 ms total · +12 ms since prior stage
07:29:53.128 info  API browser ready · Progress recorded · 1691 ms total · +1533 ms since prior stage
07:29:53.168 info  API browser ready · Progress recorded · 1731 ms total · +40 ms since prior stage
07:29:53.174 info  API browser ready · Progress recorded · 1737 ms total · +6 ms since prior stage
07:29:53.176 info  API browser ready · Progress recorded · 1739 ms total · +2 ms since prior stage
07:29:53.179 info  API browser ready · Progress recorded · 1742 ms total · +3 ms since prior stage
07:29:53.182 info  API browser ready · Progress recorded · 1745 ms total · +3 ms since prior stage
07:29:53.182 browser-ready {"type":"browser-ready","elapsedMs":2356}
07:29:53.182 info  API browser ready · Progress recorded · 1745 ms total · +0 ms since prior stage
07:29:53.183 info  BROWSER PREPARATION OUTCOME · Progress recorded · 1745 ms total · +0 ms since prior stage
07:29:53.183 info  BROWSER PREPARATION OUTCOME · Progress recorded · 1746 ms total · +1 ms since prior stage
07:29:53.183 info  BROWSER PREPARATION OUTCOME · Progress recorded · 1746 ms total · +0 ms since prior stage
07:29:53.183 info  BROWSER PREPARATION OUTCOME · Progress recorded · 1746 ms total · +0 ms since prior stage
07:29:53.183 info  BROWSER PREPARATION OUTCOME · Progress recorded · 1746 ms total · +0 ms since prior stage
07:29:53.183 info  BROWSER PREPARATION OUTCOME · Progress recorded · 1746 ms total · +0 ms since prior stage
07:29:53.183 info  BROWSER PREPARATION OUTCOME · Progress recorded · 1746 ms total · +0 ms since prior stage
07:29:53.185 info  PHASE3 AUTHORIZATION · Progress recorded · 1748 ms total · +2 ms since prior stage
07:29:53.185 info  PHASE3 CANDIDATE · Progress recorded · 1748 ms total · +0 ms since prior stage
07:29:53.185 info  PHASE3 CANDIDATE · Progress recorded · 1748 ms total · +0 ms since prior stage
07:29:53.185 info  PHASE3 CANDIDATE · Progress recorded · 1748 ms total · +0 ms since prior stage
07:29:53.185 info  PHASE3 CANDIDATE · Progress recorded · 1748 ms total · +0 ms since prior stage
07:29:53.185 info  PHASE3 CANDIDATE · Progress recorded · 1748 ms total · +0 ms since prior stage
07:29:53.185 info  PHASE3 CANDIDATE · Progress recorded · 1748 ms total · +0 ms since prior stage
07:29:53.185 info  PHASE3 CANDIDATE · Progress recorded · 1748 ms total · +0 ms since prior stage
07:29:53.185 info  PHASE3 CANDIDATE · Progress recorded · 1748 ms total · +0 ms since prior stage
07:29:53.185 info  PHASE3 CANDIDATE · Progress recorded · 1748 ms total · +0 ms since prior stage
07:29:53.185 info  PHASE3 CANDIDATE · Progress recorded · 1748 ms total · +0 ms since prior stage
07:29:53.185 info  PHASE3 CANDIDATE · Progress recorded · 1748 ms total · +0 ms since prior stage
07:50:00.300 info  Network clock refreshed · T-10M · offset 20 ms · round trip 43 ms · change 15 ms · 10 samples · spread 12.7 ms · ±21.5 ms · 1208847 ms total · +1207099 ms since prior stage
07:58:00.057 info  PHASE3 WAVE1 PRICE · Progress recorded · 1688605 ms total · +479758 ms since prior stage
07:58:00.059 info  PHASE3 WAVE1 PRICE · Progress recorded · 1688606 ms total · +1 ms since prior stage
07:58:00.059 info  PHASE3 WAVE1 PRICE · Progress recorded · 1688607 ms total · +1 ms since prior stage
07:58:00.060 info  PHASE3 WAVE1 PRICE · Progress recorded · 1688608 ms total · +1 ms since prior stage
07:58:00.061 info  PHASE3 WAVE1 PRICE · Progress recorded · 1688609 ms total · +1 ms since prior stage
07:58:00.062 info  PHASE3 WAVE1 PRICE · Progress recorded · 1688609 ms total · +0 ms since prior stage
07:58:00.063 info  PHASE3 WAVE1 PRICE · Progress recorded · 1688611 ms total · +2 ms since prior stage
07:58:00.065 info  PHASE3 FROZEN · Progress recorded · 1688612 ms total · +1 ms since prior stage
07:59:00.192 info  Release clock consensus · T-60S · offset 24.3 ms · 10 samples · fastest round trip 44 ms · spread 10.4 ms · ±22.3 ms · change 4.7 ms · 1748734 ms total · +60122 ms since prior stage
07:59:00.316 info  PHASE3 EVIDENCE · Progress recorded · 1748858 ms total · +124 ms since prior stage
07:59:10.258 info  PHASE3 EVIDENCE · Progress recorded · 1758801 ms total · +9943 ms since prior stage
07:59:20.205 info  PHASE3 EVIDENCE · Progress recorded · 1768748 ms total · +9947 ms since prior stage
07:59:30.218 info  Release clock consensus · T-30S · offset 23.3 ms · 10 samples · fastest round trip 44 ms · spread 4.2 ms · ±24.2 ms · change -1 ms · 1778761 ms total · +10013 ms since prior stage
07:59:30.444 info  PHASE3 EVIDENCE · Progress recorded · 1778988 ms total · +227 ms since prior stage
07:59:40.262 info  PHASE3 EVIDENCE · Progress recorded · 1788806 ms total · +9818 ms since prior stage
07:59:50.234 info  PHASE3 EVIDENCE · Progress recorded · 1798778 ms total · +9972 ms since prior stage
07:59:58.248 info  PHASE3 EVIDENCE · Progress recorded · 1806792 ms total · +8014 ms since prior stage
08:00:00.006 info  PHASE3 WAVE1 STARTED · Progress recorded · 1808550 ms total · +1758 ms since prior stage
08:00:00.007 info  PHASE3 WAVE1 STARTED · Progress recorded · 1808550 ms total · +0 ms since prior stage
08:00:00.007 info  PHASE3 WAVE1 STARTED · Progress recorded · 1808551 ms total · +1 ms since prior stage
08:00:00.007 info  PHASE3 WAVE1 STARTED · Progress recorded · 1808551 ms total · +0 ms since prior stage
08:00:00.007 info  PHASE3 WAVE1 STARTED · Progress recorded · 1808551 ms total · +0 ms since prior stage
08:00:00.007 info  PHASE3 WAVE1 STARTED · Progress recorded · 1808551 ms total · +0 ms since prior stage
08:00:00.007 info  PHASE3 WAVE1 STARTED · Progress recorded · 1808551 ms total · +0 ms since prior stage
08:00:00.010 info  PHASE3 DISPATCH · Progress recorded · 1808553 ms total · +2 ms since prior stage
08:00:00.011 info  PHASE3 DISPATCH · Progress recorded · 1808554 ms total · +1 ms since prior stage
08:00:00.011 info  PHASE3 DISPATCH · Progress recorded · 1808554 ms total · +0 ms since prior stage
08:00:00.011 info  PHASE3 DISPATCH · Progress recorded · 1808554 ms total · +0 ms since prior stage
08:00:00.011 info  PHASE3 DISPATCH · Progress recorded · 1808554 ms total · +0 ms since prior stage
08:00:00.011 info  PHASE3 DISPATCH · Progress recorded · 1808555 ms total · +1 ms since prior stage
08:00:00.012 info  PHASE3 DISPATCH · Progress recorded · 1808555 ms total · +0 ms since prior stage
08:00:04.146 info  PHASE3 EVIDENCE · Progress recorded · 1812689 ms total · +4134 ms since prior stage
08:00:09.079 info  PHASE3 EVIDENCE · Progress recorded · 1817622 ms total · +4933 ms since prior stage
08:00:09.079 info  PHASE3 EVIDENCE · Progress recorded · 1817622 ms total · +0 ms since prior stage
08:00:11.641 info  PHASE3 EVIDENCE · Progress recorded · 1820184 ms total · +2562 ms since prior stage
08:00:17.004 info  PHASE3 EVIDENCE · Progress recorded · 1825548 ms total · +5364 ms since prior stage
08:00:17.783 info  PHASE3 EVIDENCE · Progress recorded · 1826326 ms total · +778 ms since prior stage
08:00:17.783 info  PHASE3 EVIDENCE · Progress recorded · 1826326 ms total · +0 ms since prior stage
08:00:17.783 info  PHASE3 EVIDENCE · Progress recorded · 1826326 ms total · +0 ms since prior stage
08:00:17.941 info  PHASE3 EVIDENCE · Progress recorded · 1826484 ms total · +158 ms since prior stage
08:00:17.941 info  PHASE3 EVIDENCE · Progress recorded · 1826484 ms total · +0 ms since prior stage
08:00:18.100 info  PHASE3 EVIDENCE · Progress recorded · 1826644 ms total · +160 ms since prior stage
08:00:18.943 info  PHASE3 EVIDENCE · Progress recorded · 1827486 ms total · +842 ms since prior stage
08:00:21.133 info  PHASE3 EVIDENCE · Progress recorded · 1829676 ms total · +2190 ms since prior stage
08:00:22.099 info  PHASE3 EVIDENCE · Progress recorded · 1830642 ms total · +966 ms since prior stage
08:00:28.893 info  PHASE3 EVIDENCE · Progress recorded · 1837436 ms total · +6794 ms since prior stage
08:00:28.893 info  PHASE3 EVIDENCE · Progress recorded · 1837436 ms total · +0 ms since prior stage
08:00:28.957 info  PHASE3 EVIDENCE · Progress recorded · 1837500 ms total · +64 ms since prior stage
08:00:28.989 info  PHASE3 EVIDENCE · Progress recorded · 1837532 ms total · +32 ms since prior stage
08:00:29.021 info  PHASE3 EVIDENCE · Progress recorded · 1837564 ms total · +32 ms since prior stage
08:00:29.021 info  PHASE3 EVIDENCE · Progress recorded · 1837564 ms total · +0 ms since prior stage
08:00:29.162 info  PHASE3 SETTLED · Progress recorded · 1837705 ms total · +141 ms since prior stage
08:00:29.180 info  PHASE3 EVIDENCE · Progress recorded · 1837723 ms total · +18 ms since prior stage
08:00:29.580 info  PHASE3 SETTLED · Progress recorded · 1838123 ms total · +400 ms since prior stage
08:00:29.875 info  PHASE3 SETTLED · Progress recorded · 1838418 ms total · +295 ms since prior stage
08:00:32.173 info  PHASE3 EVIDENCE · Progress recorded · 1840716 ms total · +2298 ms since prior stage
08:00:32.197 info  PHASE3 SETTLED · Progress recorded · 1840740 ms total · +24 ms since prior stage
08:00:32.871 info  PHASE3 EVIDENCE · Progress recorded · 1841414 ms total · +674 ms since prior stage
08:00:32.897 info  PHASE3 EVIDENCE · Progress recorded · 1841440 ms total · +26 ms since prior stage
08:00:33.025 info  PHASE3 SETTLED · Progress recorded · 1841568 ms total · +128 ms since prior stage
08:00:33.118 info  PHASE3 EVIDENCE · Progress recorded · 1841661 ms total · +93 ms since prior stage
08:00:33.915 info  PHASE3 SETTLED · Progress recorded · 1842458 ms total · +797 ms since prior stage
08:00:34.117 info  PHASE3 EVIDENCE · Progress recorded · 1842660 ms total · +202 ms since prior stage
08:00:34.672 info  PHASE3 SETTLED · Progress recorded · 1843215 ms total · +555 ms since prior stage
08:00:35.117 info  PHASE3 EVIDENCE · Progress recorded · 1843660 ms total · +445 ms since prior stage
08:00:36.082 info  PHASE3 EVIDENCE · Progress recorded · 1844625 ms total · +965 ms since prior stage
08:00:37.112 info  PHASE3 EVIDENCE · Progress recorded · 1845655 ms total · +1030 ms since prior stage
08:00:38.110 info  PHASE3 EVIDENCE · Progress recorded · 1846653 ms total · +998 ms since prior stage
08:00:39.327 info  PHASE3 EVIDENCE · Progress recorded · 1847871 ms total · +1218 ms since prior stage
08:00:40.326 info  PHASE3 EVIDENCE · Progress recorded · 1848869 ms total · +998 ms since prior stage
08:00:41.256 info  PHASE3 EVIDENCE · Progress recorded · 1849799 ms total · +930 ms since prior stage
08:00:42.105 info  PHASE3 EVIDENCE · Progress recorded · 1850649 ms total · +850 ms since prior stage
08:00:43.101 info  PHASE3 EVIDENCE · Progress recorded · 1851645 ms total · +996 ms since prior stage
08:00:44.099 info  PHASE3 EVIDENCE · Progress recorded · 1852642 ms total · +997 ms since prior stage
08:00:45.191 info  PHASE3 EVIDENCE · Progress recorded · 1853734 ms total · +1092 ms since prior stage
08:00:46.097 info  PHASE3 EVIDENCE · Progress recorded · 1854640 ms total · +906 ms since prior stage
08:00:47.344 info  PHASE3 EVIDENCE · Progress recorded · 1855887 ms total · +1247 ms since prior stage
08:00:48.127 info  PHASE3 EVIDENCE · Progress recorded · 1856670 ms total · +783 ms since prior stage
08:00:49.374 info  PHASE3 EVIDENCE · Progress recorded · 1857917 ms total · +1247 ms since prior stage
08:00:50.496 info  PHASE3 EVIDENCE · Progress recorded · 1859040 ms total · +1123 ms since prior stage
08:00:51.123 info  PHASE3 EVIDENCE · Progress recorded · 1859666 ms total · +626 ms since prior stage
08:00:52.127 info  PHASE3 EVIDENCE · Progress recorded · 1860671 ms total · +1005 ms since prior stage
08:00:53.096 info  PHASE3 EVIDENCE · Progress recorded · 1861639 ms total · +968 ms since prior stage
08:00:54.348 info  PHASE3 EVIDENCE · Progress recorded · 1862891 ms total · +1252 ms since prior stage
08:00:55.319 info  PHASE3 EVIDENCE · Progress recorded · 1863862 ms total · +971 ms since prior stage
08:00:56.102 info  PHASE3 EVIDENCE · Progress recorded · 1864645 ms total · +783 ms since prior stage
08:00:57.104 info  PHASE3 EVIDENCE · Progress recorded · 1865647 ms total · +1002 ms since prior stage
08:00:58.100 info  PHASE3 EVIDENCE · Progress recorded · 1866643 ms total · +996 ms since prior stage
08:00:59.099 info  PHASE3 EVIDENCE · Progress recorded · 1867642 ms total · +999 ms since prior stage
08:01:00.130 info  PHASE3 EVIDENCE · Progress recorded · 1868673 ms total · +1031 ms since prior stage
08:01:05.436 info  PHASE3 EVIDENCE · Progress recorded · 1873980 ms total · +5307 ms since prior stage
08:01:10.235 info  PHASE3 EVIDENCE · Progress recorded · 1878778 ms total · +4798 ms since prior stage
08:01:15.246 info  PHASE3 EVIDENCE · Progress recorded · 1883789 ms total · +5011 ms since prior stage
08:01:20.309 info  PHASE3 EVIDENCE · Progress recorded · 1888853 ms total · +5064 ms since prior stage
08:01:25.267 info  PHASE3 EVIDENCE · Progress recorded · 1893810 ms total · +4957 ms since prior stage
08:01:30.344 info  PHASE3 EVIDENCE · Progress recorded · 1898888 ms total · +5078 ms since prior stage
08:01:35.200 info  PHASE3 EVIDENCE · Progress recorded · 1903744 ms total · +4856 ms since prior stage
08:01:40.413 info  PHASE3 EVIDENCE · Progress recorded · 1908957 ms total · +5213 ms since prior stage
08:01:45.212 info  PHASE3 EVIDENCE · Progress recorded · 1913755 ms total · +4798 ms since prior stage
08:01:50.262 info  PHASE3 EVIDENCE · Progress recorded · 1918806 ms total · +5051 ms since prior stage
08:01:56.249 info  PHASE3 EVIDENCE · Progress recorded · 1924793 ms total · +5987 ms since prior stage
08:02:00.082 info  PHASE3 EVIDENCE · Progress recorded · 1928626 ms total · +3833 ms since prior stage
08:02:05.229 info  PHASE3 EVIDENCE · Progress recorded · 1933772 ms total · +5146 ms since prior stage
08:02:10.226 info  PHASE3 EVIDENCE · Progress recorded · 1938769 ms total · +4997 ms since prior stage
08:02:15.215 info  PHASE3 EVIDENCE · Progress recorded · 1943759 ms total · +4990 ms since prior stage
08:02:20.336 info  PHASE3 EVIDENCE · Progress recorded · 1948880 ms total · +5121 ms since prior stage
08:02:25.364 info  PHASE3 EVIDENCE · Progress recorded · 1953907 ms total · +5027 ms since prior stage
08:02:30.237 info  PHASE3 EVIDENCE · Progress recorded · 1958780 ms total · +4873 ms since prior stage
08:02:35.218 info  PHASE3 EVIDENCE · Progress recorded · 1963762 ms total · +4982 ms since prior stage
08:02:40.511 info  PHASE3 EVIDENCE · Progress recorded · 1969054 ms total · +5292 ms since prior stage
08:02:45.208 info  PHASE3 EVIDENCE · Progress recorded · 1973752 ms total · +4698 ms since prior stage
08:02:50.200 info  PHASE3 EVIDENCE · Progress recorded · 1978743 ms total · +4991 ms since prior stage
08:02:55.359 info  PHASE3 EVIDENCE · Progress recorded · 1983902 ms total · +5159 ms since prior stage
08:03:00.226 info  PHASE3 EVIDENCE · Progress recorded · 1988769 ms total · +4867 ms since prior stage
08:03:05.430 info  PHASE3 EVIDENCE · Progress recorded · 1993973 ms total · +5204 ms since prior stage
08:03:10.188 info  PHASE3 EVIDENCE · Progress recorded · 1998731 ms total · +4758 ms since prior stage
08:03:15.208 info  PHASE3 EVIDENCE · Progress recorded · 2003751 ms total · +5020 ms since prior stage
08:03:20.391 info  PHASE3 EVIDENCE · Progress recorded · 2008934 ms total · +5183 ms since prior stage
08:03:25.380 info  PHASE3 EVIDENCE · Progress recorded · 2013924 ms total · +4990 ms since prior stage
08:03:30.400 info  PHASE3 EVIDENCE · Progress recorded · 2018943 ms total · +5019 ms since prior stage
08:03:35.352 info  PHASE3 EVIDENCE · Progress recorded · 2023896 ms total · +4953 ms since prior stage
08:03:40.203 info  PHASE3 EVIDENCE · Progress recorded · 2028747 ms total · +4851 ms since prior stage
08:03:45.192 info  PHASE3 EVIDENCE · Progress recorded · 2033735 ms total · +4988 ms since prior stage
08:03:50.219 info  PHASE3 EVIDENCE · Progress recorded · 2038762 ms total · +5027 ms since prior stage
08:03:55.236 info  PHASE3 EVIDENCE · Progress recorded · 2043779 ms total · +5017 ms since prior stage
08:04:00.356 info  PHASE3 EVIDENCE · Progress recorded · 2048899 ms total · +5120 ms since prior stage
08:04:05.228 info  PHASE3 EVIDENCE · Progress recorded · 2053771 ms total · +4872 ms since prior stage
08:04:10.618 info  PHASE3 EVIDENCE · Progress recorded · 2059162 ms total · +5391 ms since prior stage
08:04:15.369 info  PHASE3 EVIDENCE · Progress recorded · 2063912 ms total · +4750 ms since prior stage
08:04:20.211 info  PHASE3 EVIDENCE · Progress recorded · 2068754 ms total · +4842 ms since prior stage
08:04:25.412 info  PHASE3 EVIDENCE · Progress recorded · 2073955 ms total · +5201 ms since prior stage
08:04:30.216 info  PHASE3 EVIDENCE · Progress recorded · 2078759 ms total · +4804 ms since prior stage
08:04:35.386 info  PHASE3 EVIDENCE · Progress recorded · 2083929 ms total · +5170 ms since prior stage
08:04:40.216 info  PHASE3 EVIDENCE · Progress recorded · 2088760 ms total · +4831 ms since prior stage
08:04:45.742 info  PHASE3 EVIDENCE · Progress recorded · 2094285 ms total · +5525 ms since prior stage
08:04:50.237 info  PHASE3 EVIDENCE · Progress recorded · 2098780 ms total · +4495 ms since prior stage
08:04:55.370 info  PHASE3 EVIDENCE · Progress recorded · 2103913 ms total · +5133 ms since prior stage
08:05:00.506 info  PHASE3 EVIDENCE · Progress recorded · 2109049 ms total · +5136 ms since prior stage
08:05:30.460 info  PHASE3 EVIDENCE · Progress recorded · 2139003 ms total · +29954 ms since prior stage
08:06:00.368 info  PHASE3 EVIDENCE · Progress recorded · 2168911 ms total · +29908 ms since prior stage
08:06:30.413 info  PHASE3 EVIDENCE · Progress recorded · 2198957 ms total · +30046 ms since prior stage
08:07:00.416 info  PHASE3 EVIDENCE · Progress recorded · 2228960 ms total · +30003 ms since prior stage
08:07:30.217 info  PHASE3 EVIDENCE · Progress recorded · 2258761 ms total · +29801 ms since prior stage
08:08:00.403 info  PHASE3 EVIDENCE · Progress recorded · 2288947 ms total · +30186 ms since prior stage
08:08:30.547 info  PHASE3 EVIDENCE · Progress recorded · 2319090 ms total · +30143 ms since prior stage
08:09:00.327 info  PHASE3 EVIDENCE · Progress recorded · 2348870 ms total · +29780 ms since prior stage
08:09:30.472 info  PHASE3 EVIDENCE · Progress recorded · 2379016 ms total · +30146 ms since prior stage
08:10:00.481 info  PHASE3 EVIDENCE · Progress recorded · 2409025 ms total · +30009 ms since prior stage
08:10:30.430 info  PHASE3 EVIDENCE · Progress recorded · 2438973 ms total · +29948 ms since prior stage
08:11:00.218 info  PHASE3 EVIDENCE · Progress recorded · 2468762 ms total · +29789 ms since prior stage
08:11:30.230 info  PHASE3 EVIDENCE · Progress recorded · 2498773 ms total · +30011 ms since prior stage
08:12:00.200 info  PHASE3 EVIDENCE · Progress recorded · 2528743 ms total · +29970 ms since prior stage
08:12:30.379 info  PHASE3 EVIDENCE · Progress recorded · 2558922 ms total · +30179 ms since prior stage
08:13:00.212 info  PHASE3 EVIDENCE · Progress recorded · 2588755 ms total · +29833 ms since prior stage
08:13:30.353 info  PHASE3 EVIDENCE · Progress recorded · 2618896 ms total · +30141 ms since prior stage
08:14:00.221 info  PHASE3 EVIDENCE · Progress recorded · 2648764 ms total · +29868 ms since prior stage
08:14:30.226 info  PHASE3 EVIDENCE · Progress recorded · 2678770 ms total · +30006 ms since prior stage
08:15:00.037 info  PHASE3 OUTCOME · Progress recorded · 2708581 ms total · +29811 ms since prior stage
08:15:00.038 error API run needs attention · ALL_REJECTED_WAITING_FOR_REOPEN · 2708582 ms total · +1 ms since prior stage
08:15:00.076 error COMMAND_FAILED
08:15:00.086 error Run finished: failed
08:15:00.100 run-end {"type":"run-end","elapsedMs":2709232,"outcome":"failed","readyElapsedMs":2706877,"label":"API LIVE"}
```

### Appendix C — Slot Watch log (every record, 148 lines)

Source: `.local/slot-watch/2026-09-27_60d68777-0022-471a-99aa-3a47543858f4.ndjson`. Lines are in **response** order as written; `seq` is request order. Offsets are ms since 08:00:00.000 on the observer's network clock (offset 4.7 ms at start, 19.6 ms at T−60 s). Matrix columns are 08:00…23:00; O open, X unavailable, ? unknown/date not published.

Schedule (availability, ms): -60000, -50000, -40000, -30000, -20000, -10000, -2000, 0, 250, 500, 1000, 2000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000, 13000, 14000, 15000, 16000, 17000, 18000, 19000, 20000, 21000, 22000, 23000, 24000, 25000, 26000, 27000, 28000, 29000, 30000, 31000, 32000, 33000, 34000, 35000, 36000, 37000, 38000, 39000, 40000, 41000, 42000, 43000, 44000, 45000, 46000, 47000, 48000, 49000, 50000, 51000, 52000, 53000, 54000, 55000, 56000, 57000, 58000, 59000, 60000, 65000, 70000, 75000, 80000, 85000, 90000, 95000, 100000, 105000, 110000, 115000, 120000, 125000, 130000, 135000, 140000, 145000, 150000, 155000, 160000, 165000, 170000, 175000, 180000, 185000, 190000, 195000, 200000, 205000, 210000, 215000, 220000, 225000, 230000, 235000, 240000, 245000, 250000, 255000, 260000, 265000, 270000, 275000, 280000, 285000, 290000, 295000, 300000, 330000, 360000, 390000, 420000, 450000, 480000, 510000, 540000, 570000, 600000, 630000, 660000, 690000, 720000, 750000, 780000, 810000, 840000, 870000, 900000

Schedule (booking reads, ms): -60000, 2000, 10000, 30000, 60000, 120000, 300000, 600000, 900000 · max 6 availability reads in flight · read timeout 15000 ms · booking timeout 10000 ms

| Line | Type | seq | Scheduled | Request | Response | Took | In flight at launch | Date | Open/Unavail/Unknown | Cache | Matrix or detail |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | clock | — | — | −59.989 s | — | — | — | — | — | — | observer offset 19.6 ms |
| 3 | bookings | b1 | −60.000 s | −59.985 s | −59.746 s | 239 ms | — | — | 5 hours with records | — | failed courts: none |
| 4 | availability | 1 | −60.000 s | −59.988 s | −59.715 s | 273 ms | 1 | absent | 0/0/112 | MISS 0 | `1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????` |
| 5 | availability | 2 | −50.000 s | −49.995 s | −49.775 s | 220 ms | 1 | absent | 0/0/112 | MISS 0 | `1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????` |
| 6 | availability | 3 | −40.000 s | −39.988 s | −39.816 s | 172 ms | 1 | absent | 0/0/112 | MISS 0 | `1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????` |
| 7 | availability | 4 | −30.000 s | −29.998 s | −29.587 s | 411 ms | 1 | absent | 0/0/112 | MISS 0 | `1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????` |
| 8 | availability | 5 | −20.000 s | −19.990 s | −19.760 s | 230 ms | 1 | absent | 0/0/112 | MISS 0 | `1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????` |
| 9 | availability | 6 | −10.000 s | −9.984 s | −9.769 s | 215 ms | 1 | absent | 0/0/112 | MISS 0 | `1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????` |
| 10 | availability | 7 | −2.000 s | −1.987 s | −1.779 s | 208 ms | 1 | absent | 0/0/112 | MISS 0 | `1:????????????????,2:????????????????,3:????????????????,4:????????????????,5:????????????????,6:????????????????,7:????????????????` |
| 11 | availability | 8 | +0.000 s | +0.016 s | +4.142 s | 4126 ms | 1 | published | 107/5/0 | MISS 0 | `1:OOOOOOOOOOOOOOOO,2:OOOOOOOOOOOOOOOO,3:OOOOOOOOXXOOOOOO,4:OOOOOOOOXXXOOOOO,5:OOOOOOOOOOOOOOOO,6:OOOOOOOOOOOOOOOO,7:OOOOOOOOOOOOOOOO` |
| 12 | not launched (availability) | — | +7.000 s | at +7.004 s | — | — | 6 | — | — | — | CAP_REACHED |
| 13 | not launched (availability) | — | +8.000 s | at +8.013 s | — | — | 6 | — | — | — | CAP_REACHED |
| 14 | not launched (availability) | — | +9.000 s | at +9.012 s | — | — | 6 | — | — | — | CAP_REACHED |
| 15 | availability | 11 | +1.000 s | +1.008 s | +9.049 s | 8041 ms | 4 | published | 107/5/0 | MISS 0 | `1:OOOOOOOOOOOOOOOO,2:OOOOOOOOOOOOOOOO,3:OOOOOOOOXXOOOOOO,4:OOOOOOOOXXXOOOOO,5:OOOOOOOOOOOOOOOO,6:OOOOOOOOOOOOOOOO,7:OOOOOOOOOOOOOOOO` |
| 16 | availability | 10 | +0.500 s | +0.504 s | +9.059 s | 8555 ms | 3 | published | 107/5/0 | MISS 0 | `1:OOOOOOOOOOOOOOOO,2:OOOOOOOOOOOOOOOO,3:OOOOOOOOXXOOOOOO,4:OOOOOOOOXXXOOOOO,5:OOOOOOOOOOOOOOOO,6:OOOOOOOOOOOOOOOO,7:OOOOOOOOOOOOOOOO` |
| 17 | not launched (bookings) | — | +10.000 s | at +10.014 s | — | — | 1 | — | — | — | PREVIOUS_READ_IN_FLIGHT |
| 18 | bookings | b2 | +2.000 s | +2.013 s | +11.051 s | 9038 ms | — | — | 5 hours with records | — | failed courts: none |
| 19 | availability | 9 | +0.250 s | +0.266 s | +11.608 s | 11342 ms | 2 | published | 107/5/0 | MISS 0 | `1:OOOOOOOOOOOOOOOO,2:OOOOOOOOOOOOOOOO,3:OOOOOOOOXXOOOOOO,4:OOOOOOOOXXXOOOOO,5:OOOOOOOOOOOOOOOO,6:OOOOOOOOOOOOOOOO,7:OOOOOOOOOOOOOOOO` |
| 20 | not launched (availability) | — | +13.000 s | at +13.012 s | — | — | 6 | — | — | — | CAP_REACHED |
| 21 | not launched (availability) | — | +14.000 s | at +14.011 s | — | — | 6 | — | — | — | CAP_REACHED |
| 22 | not launched (availability) | — | +15.000 s | at +15.004 s | — | — | 6 | — | — | — | CAP_REACHED |
| 23 | not launched (availability) | — | +16.000 s | at +16.004 s | — | — | 6 | — | — | — | CAP_REACHED |
| 24 | availability | 12 | +2.000 s | +2.012 s | +17.000 s | 14988 ms | 5 | published | 102/10/0 | MISS 0 | `1:OOOOOOOOOOOOOOOO,2:OOOOOOXOXOOOOOOO,3:OOOOOOOOXXOOOOOO,4:OOOOXOOOXXXOOXOO,5:OOOOOOOOOOOOOOOO,6:OOOOOOOOOOOOOOOO,7:OOOOOOOOOOOXOOOO` |
| 25 | availability | 13 | +5.000 s | +5.003 s | +17.762 s | 12759 ms | 5 | published | 102/10/0 | MISS 0 | `1:OOOOOOOOOOOOOOOO,2:OOOOOOXOXOOOOOOO,3:OOOOOOOOXXOOOOOO,4:OOOOXOOOXXXOOXOO,5:OOOOOOOOOOOOOOOO,6:OOOOOOOOOOOOOOOO,7:OOOOOOOOOOOXOOOO` |
| 26 | availability | 16 | +11.000 s | +11.012 s | +17.770 s | 6758 ms | 6 | published | 102/10/0 | MISS 0 | `1:OOOOOOOOOOOOOOOO,2:OOOOOOXOXOOOOOOO,3:OOOOOOOOXXOOOOOO,4:OOOOXOOOXXXOOXOO,5:OOOOOOOOOOOOOOOO,6:OOOOOOOOOOOOOOOO,7:OOOOOOOOOOOXOOOO` |
| 27 | availability | 14 | +6.000 s | +6.002 s | +17.779 s | 11777 ms | 6 | published | 102/10/0 | MISS 0 | `1:OOOOOOOOOOOOOOOO,2:OOOOOOXOXOOOOOOO,3:OOOOOOOOXXOOOOOO,4:OOOOXOOOXXXOOXOO,5:OOOOOOOOOOOOOOOO,6:OOOOOOOOOOOOOOOO,7:OOOOOOOOOOOXOOOO` |
| 28 | availability | 18 | +17.000 s | +17.007 s | +17.919 s | 912 ms | 6 | published | 85/27/0 | MISS 0 | `1:OOOOOOOXXXOXOOOO,2:OOOOOOXXXOOXOXOO,3:OOOOXOXOXXOOXOOO,4:OOOOXOXXXXXOXXOO,5:OOOOXOXOOOOOOOOO,6:OOOOOOOOXXOOOOOO,7:OOOOOOOOOOOXOOOO` |
| 29 | availability | 17 | +12.000 s | +12.014 s | +17.929 s | 5915 ms | 6 | published | 85/27/0 | MISS 0 | `1:OOOOOOOXXXOXOOOO,2:OOOOOOXXXOOXOXOO,3:OOOOXOXOXXOOXOOO,4:OOOOXOXXXXXOXXOO,5:OOOOXOXOOOOOOOOO,6:OOOOOOOOXXOOOOOO,7:OOOOOOOOOOOXOOOO` |
| 30 | availability | 19 | +18.000 s | +18.002 s | +18.072 s | 70 ms | 2 | published | 85/27/0 | MISS 0 | `1:OOOOOOOXXXOXOOOO,2:OOOOOOXXXOOXOXOO,3:OOOOXOXOXXOOXOOO,4:OOOOXOXXXXXOXXOO,5:OOOOXOXOOOOOOOOO,6:OOOOOOOOXXOOOOOO,7:OOOOOOOOOOOXOOOO` |
| 31 | availability | 15 | +10.000 s | +10.014 s | +18.920 s | 8906 ms | 5 | published | 93/19/0 | MISS 0 | `1:OOOOOOOXOOOXOOOO,2:OOOOOOXOXOOOOOOO,3:OOOOXOXOXXOOXOOO,4:OOOOXOOOXXXOXXOO,5:OOOOXOXOOOOOOOOO,6:OOOOOOOOOXOOOOOO,7:OOOOOOOOOOOXOOOO` |
| 32 | availability | 22 | +21.000 s | +21.005 s | +21.105 s | 100 ms | 3 | published | 85/27/0 | MISS 0 | `1:OOOOOOOXXXOXOOOO,2:OOOOOOXXXOOXOXOO,3:OOOOXOXOXXOOXOOO,4:OOOOXOXXXXXOXXOO,5:OOOOXOXOOOOOOOOO,6:OOOOOOOOXXOOOOOO,7:OOOOOOOOOOOXOOOO` |
| 33 | availability | 23 | +22.000 s | +22.005 s | +22.088 s | 83 ms | 3 | published | 102/10/0 | MISS 0 | `1:OOOOOOOOOOOOOOOO,2:OOOOOOXOXOOOOOOO,3:OOOOOOOOXXOOOOOO,4:OOOOXOOOXXXOOXOO,5:OOOOOOOOOOOOOOOO,6:OOOOOOOOOOOOOOOO,7:OOOOOOOOOOOXOOOO` |
| 34 | not launched (availability) | — | +27.000 s | at +27.006 s | — | — | 6 | — | — | — | CAP_REACHED |
| 35 | not launched (availability) | — | +28.000 s | at +28.006 s | — | — | 6 | — | — | — | CAP_REACHED |
| 36 | availability | 20 | +19.000 s | +19.005 s | +28.868 s | 9863 ms | 1 | published | 46/66/0 | MISS 0 | `1:OOOOXXXXXXXXXOXO,2:OOOOXXXXXOXXXXXO,3:OOOOXXXXXXXXXXOO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXOXXXXOXOXO,7:OOOOOXXOOXOXXOXO` |
| 37 | availability | 24 | +23.000 s | +23.015 s | +28.879 s | 5864 ms | 3 | published | 46/66/0 | MISS 0 | `1:OOOOXXXXXXXXXOXO,2:OOOOXXXXXOXXXXXO,3:OOOOXXXXXXXXXXOO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXOXXXXOXOXO,7:OOOOOXXOOXOXXOXO` |
| 38 | availability | 21 | +20.000 s | +20.001 s | +28.923 s | 8922 ms | 2 | published | 46/66/0 | MISS 0 | `1:OOOOXXXXXXXXXOXO,2:OOOOXXXXXOXXXXXO,3:OOOOXXXXXXXXXXOO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXOXXXXOXOXO,7:OOOOOXXOOXOXXOXO` |
| 39 | availability | 25 | +24.000 s | +24.011 s | +28.974 s | 4963 ms | 4 | published | 42/70/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXOXXXXXO,3:OOOOXXXXXXXXXXOO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXOXXXXXXOXO,7:OOOOOXXOXXOXXXXO` |
| 40 | availability | 26 | +25.000 s | +25.010 s | +28.985 s | 3975 ms | 5 | published | 42/70/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXOXXXXXO,3:OOOOXXXXXXXXXXOO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXOXXXXXXOXO,7:OOOOOXXOXXOXXXXO` |
| 41 | availability | 27 | +26.000 s | +26.010 s | +28.995 s | 2985 ms | 6 | published | 42/70/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXOXXXXXO,3:OOOOXXXXXXXXXXOO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXOXXXXXXOXO,7:OOOOOXXOXXOXXXXO` |
| 42 | availability | 28 | +29.000 s | +29.003 s | +29.158 s | 155 ms | 1 | published | 42/70/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXOXXXXXO,3:OOOOXXXXXXXXXXOO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXOXXXXXXOXO,7:OOOOOXXOXXOXXXXO` |
| 43 | availability | 31 | +32.000 s | +32.003 s | +32.169 s | 166 ms | 3 | published | 42/70/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXOXXXXXO,3:OOOOXXXXXXXXXXOO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXOXXXXXXOXO,7:OOOOOXXOXXOXXXXO` |
| 44 | availability | 29 | +30.000 s | +30.007 s | +32.847 s | 2840 ms | 1 | published | 36/76/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:OOOOOXXXXXXXXXXO` |
| 45 | availability | 30 | +31.000 s | +31.006 s | +32.893 s | 1887 ms | 2 | published | 35/77/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:OOOOXXXXXXXXXXXO` |
| 46 | availability | 32 | +33.000 s | +33.008 s | +33.114 s | 106 ms | 1 | published | 42/70/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXOXXXXXO,3:OOOOXXXXXXXXXXOO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXOXXXXXXOXO,7:OOOOOXXOXXOXXXXO` |
| 47 | bookings | b3 | +30.000 s | +30.008 s | +33.712 s | 3704 ms | — | — | 77 hours with records | — | failed courts: none |
| 48 | availability | 33 | +34.000 s | +34.005 s | +34.090 s | 85 ms | 1 | published | 42/70/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXOXXXXXO,3:OOOOXXXXXXXXXXOO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXOXXXXXXOXO,7:OOOOOXXOXXOXXXXO` |
| 49 | availability | 34 | +35.000 s | +35.004 s | +35.100 s | 96 ms | 1 | published | 46/66/0 | MISS 0 | `1:OOOOXXXXXXXXXOXO,2:OOOOXXXXXOXXXXXO,3:OOOOXXXXXXXXXXOO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXOXXXXOXOXO,7:OOOOOXXOOXOXXOXO` |
| 50 | availability | 35 | +36.000 s | +36.004 s | +36.078 s | 74 ms | 1 | published | 36/76/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:OOOOOXXXXXXXXXXO` |
| 51 | availability | 36 | +37.000 s | +37.002 s | +37.095 s | 93 ms | 1 | published | 46/66/0 | MISS 0 | `1:OOOOXXXXXXXXXOXO,2:OOOOXXXXXOXXXXXO,3:OOOOXXXXXXXXXXOO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXOXXXXOXOXO,7:OOOOOXXOOXOXXOXO` |
| 52 | availability | 37 | +38.000 s | +38.015 s | +38.105 s | 90 ms | 1 | published | 36/76/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:OOOOOXXXXXXXXXXO` |
| 53 | availability | 38 | +39.000 s | +39.012 s | +39.296 s | 284 ms | 1 | published | 35/77/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:OOOOXXXXXXXXXXXO` |
| 54 | availability | 39 | +40.000 s | +40.012 s | +40.314 s | 302 ms | 1 | published | 35/77/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:OOOOXXXXXXXXXXXO` |
| 55 | availability | 40 | +41.000 s | +41.011 s | +41.252 s | 241 ms | 1 | published | 35/77/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:OOOOXXXXXXXXXXXO` |
| 56 | availability | 41 | +42.000 s | +42.010 s | +42.078 s | 68 ms | 1 | published | 35/77/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:OOOOXXXXXXXXXXXO` |
| 57 | availability | 42 | +43.000 s | +43.005 s | +43.075 s | 70 ms | 1 | published | 35/77/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:OOOOXXXXXXXXXXXO` |
| 58 | availability | 43 | +44.000 s | +44.007 s | +44.095 s | 88 ms | 1 | published | 35/77/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:OOOOXXXXXXXXXXXO` |
| 59 | availability | 44 | +45.000 s | +45.016 s | +45.161 s | 145 ms | 1 | published | 35/77/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:OOOOXXXXXXXXXXXO` |
| 60 | availability | 45 | +46.000 s | +46.016 s | +46.086 s | 70 ms | 1 | published | 35/77/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:OOOOXXXXXXXXXXXO` |
| 61 | availability | 46 | +47.000 s | +47.012 s | +47.325 s | 313 ms | 1 | published | 32/80/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 62 | availability | 47 | +48.000 s | +48.015 s | +48.096 s | 81 ms | 1 | published | 35/77/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:OOOOXXXXXXXXXXXO` |
| 63 | availability | 48 | +49.000 s | +49.013 s | +49.359 s | 346 ms | 1 | published | 32/80/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 64 | availability | 49 | +50.000 s | +50.013 s | +50.465 s | 452 ms | 1 | published | 32/80/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 65 | availability | 50 | +51.000 s | +51.011 s | +51.099 s | 88 ms | 1 | published | 32/80/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 66 | availability | 51 | +52.000 s | +52.015 s | +52.104 s | 89 ms | 1 | published | 32/80/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 67 | availability | 52 | +53.000 s | +53.001 s | +53.092 s | 91 ms | 1 | published | 32/80/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 68 | availability | 53 | +54.000 s | +54.014 s | +54.325 s | 311 ms | 1 | published | 26/86/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 69 | availability | 54 | +55.000 s | +55.001 s | +55.293 s | 292 ms | 1 | published | 26/86/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 70 | availability | 55 | +56.000 s | +56.003 s | +56.091 s | 88 ms | 1 | published | 26/86/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 71 | availability | 56 | +57.000 s | +57.006 s | +57.091 s | 85 ms | 1 | published | 26/86/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 72 | availability | 57 | +58.000 s | +58.004 s | +58.079 s | 75 ms | 1 | published | 26/86/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 73 | availability | 58 | +59.000 s | +59.003 s | +59.089 s | 86 ms | 1 | published | 32/80/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 74 | availability | 59 | +60.000 s | +60.003 s | +60.111 s | 108 ms | 1 | published | 32/80/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OOOOXXXXXXXXXXXO,5:OOOOXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 75 | bookings | b4 | +60.000 s | +60.004 s | +60.234 s | 230 ms | — | — | 86 hours with records | — | failed courts: none |
| 76 | availability | 60 | +65.000 s | +65.014 s | +65.432 s | 418 ms | 1 | published | 26/86/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 77 | availability | 61 | +70.000 s | +70.003 s | +70.231 s | 228 ms | 1 | published | 26/86/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:OOOOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 78 | availability | 62 | +75.000 s | +75.009 s | +75.212 s | 203 ms | 1 | published | 23/89/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 79 | availability | 63 | +80.000 s | +80.010 s | +80.293 s | 283 ms | 1 | published | 23/89/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 80 | availability | 64 | +85.000 s | +85.012 s | +85.242 s | 230 ms | 1 | published | 23/89/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OOOOXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 81 | availability | 65 | +90.000 s | +90.014 s | +90.324 s | 310 ms | 1 | published | 20/92/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 82 | availability | 66 | +95.000 s | +95.011 s | +95.196 s | 185 ms | 1 | published | 20/92/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 83 | availability | 67 | +100.000 s | +100.008 s | +100.393 s | 385 ms | 1 | published | 20/92/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 84 | availability | 68 | +105.000 s | +105.008 s | +105.180 s | 172 ms | 1 | published | 20/92/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 85 | availability | 69 | +110.000 s | +110.011 s | +110.227 s | 216 ms | 1 | published | 20/92/0 | MISS 0 | `1:OOOOXXXXXXXXXXXO,2:OOOOXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 86 | availability | 70 | +115.000 s | +115.015 s | +116.223 s | 1208 ms | 1 | published | 14/98/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 87 | availability | 71 | +120.000 s | +120.005 s | +120.078 s | 73 ms | 1 | published | 14/98/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 88 | bookings | b5 | +120.000 s | +120.005 s | +120.297 s | 292 ms | — | — | 98 hours with records | — | failed courts: none |
| 89 | availability | 72 | +125.000 s | +125.006 s | +125.200 s | 194 ms | 1 | published | 14/98/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 90 | availability | 73 | +130.000 s | +130.006 s | +130.195 s | 189 ms | 1 | published | 14/98/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 91 | availability | 74 | +135.000 s | +135.012 s | +135.195 s | 183 ms | 1 | published | 14/98/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 92 | availability | 75 | +140.000 s | +140.013 s | +140.332 s | 319 ms | 1 | published | 14/98/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 93 | availability | 76 | +145.000 s | +145.004 s | +145.360 s | 356 ms | 1 | published | 14/98/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 94 | availability | 77 | +150.000 s | +150.014 s | +150.201 s | 187 ms | 1 | published | 14/98/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 95 | availability | 78 | +155.000 s | +155.012 s | +155.206 s | 194 ms | 1 | published | 14/98/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 96 | availability | 79 | +160.000 s | +160.009 s | +160.477 s | 468 ms | 1 | published | 14/98/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 97 | availability | 80 | +165.000 s | +165.003 s | +165.181 s | 178 ms | 1 | published | 14/98/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXOXXXXXXXXXXXO,7:XXXOXXXXXXXXXXXO` |
| 98 | availability | 81 | +170.000 s | +170.009 s | +170.196 s | 187 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 99 | availability | 82 | +175.000 s | +175.012 s | +175.339 s | 327 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 100 | availability | 83 | +180.000 s | +180.004 s | +180.197 s | 193 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 101 | availability | 84 | +185.000 s | +185.007 s | +185.415 s | 408 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 102 | availability | 85 | +190.000 s | +190.004 s | +190.184 s | 180 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 103 | availability | 86 | +195.000 s | +195.003 s | +195.175 s | 172 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 104 | availability | 87 | +200.000 s | +200.012 s | +200.379 s | 367 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 105 | availability | 88 | +205.000 s | +205.001 s | +205.349 s | 348 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 106 | availability | 89 | +210.000 s | +210.009 s | +210.380 s | 371 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 107 | availability | 90 | +215.000 s | +215.006 s | +215.338 s | 332 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 108 | availability | 91 | +220.000 s | +220.014 s | +220.186 s | 172 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 109 | availability | 92 | +225.000 s | +225.008 s | +225.188 s | 180 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 110 | availability | 93 | +230.000 s | +230.014 s | +230.195 s | 181 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 111 | availability | 94 | +235.000 s | +235.016 s | +235.232 s | 216 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 112 | availability | 95 | +240.000 s | +240.013 s | +240.329 s | 316 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 113 | availability | 96 | +245.000 s | +245.007 s | +245.194 s | 187 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 114 | availability | 97 | +250.000 s | +250.005 s | +250.614 s | 609 ms | 1 | published | 13/99/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXOXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 115 | availability | 98 | +255.000 s | +255.009 s | +255.341 s | 332 ms | 1 | published | 18/94/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXOOOXXXXXXXO,5:OXXXXOOOXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 116 | availability | 99 | +260.000 s | +260.006 s | +260.178 s | 172 ms | 1 | published | 18/94/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXOOOXXXXXXXO,5:OXXXXOOOXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 117 | availability | 100 | +265.000 s | +265.005 s | +265.395 s | 390 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 118 | availability | 101 | +270.000 s | +270.011 s | +270.212 s | 201 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 119 | availability | 102 | +275.000 s | +275.009 s | +275.366 s | 357 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 120 | availability | 103 | +280.000 s | +280.010 s | +280.201 s | 191 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 121 | availability | 104 | +285.000 s | +285.005 s | +285.719 s | 714 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 122 | availability | 105 | +290.000 s | +290.016 s | +290.210 s | 194 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 123 | availability | 106 | +295.000 s | +295.009 s | +295.355 s | 346 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 124 | bookings | b6 | +300.000 s | +300.010 s | +300.304 s | 294 ms | — | — | 100 hours with records | — | failed courts: none |
| 125 | availability | 107 | +300.000 s | +300.008 s | +300.480 s | 472 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 126 | availability | 108 | +330.000 s | +330.004 s | +330.429 s | 425 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 127 | availability | 109 | +360.000 s | +360.012 s | +360.344 s | 332 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 128 | availability | 110 | +390.000 s | +390.008 s | +390.383 s | 375 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 129 | availability | 111 | +420.000 s | +420.008 s | +420.381 s | 373 ms | 1 | published | 18/94/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXOOOXXXXO,6:XXXXXXXXOOOXXXXO,7:XXXXXXXXXXXXXXXO` |
| 130 | availability | 112 | +450.000 s | +450.012 s | +450.195 s | 183 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 131 | availability | 113 | +480.000 s | +480.009 s | +480.370 s | 361 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 132 | availability | 114 | +510.000 s | +510.003 s | +510.531 s | 528 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 133 | availability | 115 | +540.000 s | +540.009 s | +540.294 s | 285 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 134 | availability | 116 | +570.000 s | +570.002 s | +570.448 s | 446 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 135 | bookings | b7 | +600.000 s | +600.011 s | +600.297 s | 286 ms | — | — | 100 hours with records | — | failed courts: none |
| 136 | availability | 117 | +600.000 s | +600.009 s | +600.453 s | 444 ms | 1 | published | 12/100/0 | MISS 0 | `1:OXXXXXXXXXXXXXXO,2:OXXXXXXXXXXXXXXO,3:OXXXXXXXXXXXXXXO,4:OXXXXXXXXXXXXXXO,5:OXXXXXXXXXXXXXXO,6:XXXXXXXXXXXXXXXO,7:XXXXXXXXXXXXXXXO` |
| 137 | availability | 118 | +630.000 s | +630.006 s | +630.409 s | 403 ms | 1 | published | 43/69/0 | MISS 0 | `1:OXXXOOOOOOXXXOXO,2:OXXXOOOXOOXXXOOO,3:OXXXOXOXXXXXOXOO,4:OXXXOXXXXXXXXXOO,5:OXXXOXXXXXXXXXXO,6:XXXXOOOOXXXOXOXO,7:XXXXOOXOXXOXXXXO` |
| 138 | availability | 119 | +660.000 s | +660.011 s | +660.195 s | 184 ms | 1 | published | 37/75/0 | MISS 0 | `1:OXXXOOOXXXXXXOXO,2:OXXXOOOXOOXXXOOO,3:OXXXOXOXXXXXOXOO,4:OXXXOXXXXXXXXXOO,5:OXXXOXXXXXXXXXXO,6:XXXXOXXXXXXOXOXO,7:XXXXOOXOXXOXXXXO` |
| 139 | availability | 120 | +690.000 s | +690.011 s | +690.204 s | 193 ms | 1 | published | 35/77/0 | MISS 0 | `1:OXXXOXOXXXXXXOXO,2:OXXXOOOXOOXXXOOO,3:OXXXOXOXXXXXOXOO,4:OXXXOXXXXXXXXXOO,5:OXXXOXXXXXXXXXXO,6:XXXXOXXXXXXOXXXO,7:XXXXOOXOXXOXXXXO` |
| 140 | availability | 121 | +720.000 s | +720.010 s | +720.196 s | 186 ms | 1 | published | 29/83/0 | MISS 0 | `1:OXXXOXOXXXXXXXXO,2:OXXXOOOXXXXXXXOO,3:OXXXOXOXXXXXXXOO,4:OXXXOXXXXXXXXXOO,5:OXXXOXXXXXXXXXXO,6:XXXXOXXXXXXXXXXO,7:XXXXOOXOXXOXXXXO` |
| 141 | availability | 122 | +750.000 s | +750.004 s | +750.350 s | 346 ms | 1 | published | 29/83/0 | MISS 0 | `1:OXXXOXOXXXXXXXXO,2:OXXXOOOXXXXXXXOO,3:OXXXOXOXXXXXXXOO,4:OXXXOXXXXXXXXXOO,5:OXXXOXXXXXXXXXXO,6:XXXXOXXXXXXXXXXO,7:XXXXOOXOXXOXXXXO` |
| 142 | availability | 123 | +780.000 s | +780.003 s | +780.177 s | 174 ms | 1 | published | 29/83/0 | MISS 0 | `1:OXXXOXOXXXXXXXXO,2:OXXXOOOXXXXXXXOO,3:OXXXOXOXXXXXXXOO,4:OXXXOXXXXXXXXXOO,5:OXXXOXXXXXXXXXXO,6:XXXXOXXXXXXXXXXO,7:XXXXOOXOXXOXXXXO` |
| 143 | availability | 124 | +810.000 s | +810.008 s | +810.326 s | 318 ms | 1 | published | 28/84/0 | MISS 0 | `1:OXXXOXOXXXXXXXXO,2:OXXXOOOXXXXXXXOO,3:OXXXOXOXXXXXXXOO,4:OXXXOXXXXXXXXXOO,5:OXXXOXXXXXXXXXXO,6:XXXXOXXXXXXXXXXO,7:XXXXOOXOXXXXXXXO` |
| 144 | availability | 125 | +840.000 s | +840.008 s | +840.217 s | 209 ms | 1 | published | 28/84/0 | MISS 0 | `1:OXXXOXOXXXXXXXXO,2:OXXXOOOXXXXXXXOO,3:OXXXOXOXXXXXXXOO,4:OXXXOXXXXXXXXXOO,5:OXXXOXXXXXXXXXXO,6:XXXXOXXXXXXXXXXO,7:XXXXOOXOXXXXXXXO` |
| 145 | availability | 126 | +870.000 s | +870.005 s | +870.214 s | 209 ms | 1 | published | 28/84/0 | MISS 0 | `1:OXXXOOXXXXXXXXXO,2:OXXXOOOXXXXXXXOO,3:OXXXOXOXXXXXXXOO,4:OXXXOXXXXXXXXXOO,5:OXXXOXXXXXXXXXXO,6:XXXXOXXXXXXXXXXO,7:XXXXOOXOXXXXXXXO` |
| 146 | bookings | b8 | +900.000 s | +900.006 s | +900.443 s | 437 ms | — | — | 85 hours with records | — | failed courts: none |
| 147 | availability | 127 | +900.000 s | +900.006 s | +900.618 s | 612 ms | 1 | published | 27/85/0 | MISS 0 | `1:OXXXOOXXXXXXXXXO,2:OXXXOOXXXXXXXXOO,3:OXXXOXOXXXXXXXOO,4:OXXXOXXXXXXXXXOO,5:OXXXOXXXXXXXXXXO,6:XXXXOXXXXXXXXXXO,7:XXXXOOXOXXXXXXXO` |
| 148 | summary | — | — | — | — | — | — | — | — | — | status=finished · reason=window complete · ended 2026-09-25T00:15:00.644Z |

### Appendix D — Public booking reads, hours with a record (all 8 reads)

Onda's public booking list returns one record per hour with only date, start, end and status. The bot keeps court and time only (status was not recorded during the watch).

| Read | Request | Response | Hours | Ranges with records (end hour exclusive) |
|---|---|---|---|---|
| b1 | −59.985 s | −59.746 s | 5 | C3 16–18 · C4 16–19 |
| b2 | +2.013 s | +11.051 s | 5 | C3 16–18 · C4 16–19 |
| b3 | +30.008 s | +33.712 s | 77 | C1 12–23 · C2 12–23 · C3 12–23 · C4 12–23 · C5 12–23 · C6 12–23 · C7 12–23 |
| b4 | +60.004 s | +60.234 s | 86 | C1 12–23 · C2 12–23 · C3 12–23 · C4 09–23 · C5 09–23 · C6 12–23 · C7 08–11, 12–23 |
| b5 | +120.005 s | +120.297 s | 98 | C1 09–23 · C2 09–23 · C3 09–23 · C4 09–23 · C5 09–23 · C6 08–11, 12–23 · C7 08–11, 12–23 |
| b6 | +300.010 s | +300.304 s | 100 | C1 09–23 · C2 09–23 · C3 09–23 · C4 09–23 · C5 09–23 · C6 08–23 · C7 08–23 |
| b7 | +600.011 s | +600.297 s | 100 | C1 09–23 · C2 09–23 · C3 09–23 · C4 09–23 · C5 09–23 · C6 08–23 · C7 08–23 |
| b8 | +900.006 s | +900.443 s | 85 | C1 09–12, 14–23 · C2 09–12, 14–22 · C3 09–12, 13–14, 15–22 · C4 09–12, 13–22 · C5 09–12, 13–23 · C6 08–12, 13–23 · C7 08–12, 14–15, 16–23 |

### Appendix E — Grid at key moments (Sunday 27 Sep, this release)

**Read #7** · request −1.987 s → response −1.779 s · open 0
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?
  C2   ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?
  C3   ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?
  C4   ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?
  C5   ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?
  C6   ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?
  C7   ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?
```

**Read #8** · request +0.016 s → response +4.142 s · open 107
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  O  O  O  O  O  O  O
  C2   O  O  O  O  O  O  O  O  O  O  O  O  O  O  O  O
  C3   O  O  O  O  O  O  O  O  X  X  O  O  O  O  O  O
  C4   O  O  O  O  O  O  O  O  X  X  X  O  O  O  O  O
  C5   O  O  O  O  O  O  O  O  O  O  O  O  O  O  O  O
  C6   O  O  O  O  O  O  O  O  O  O  O  O  O  O  O  O
  C7   O  O  O  O  O  O  O  O  O  O  O  O  O  O  O  O
```

**Read #12** · request +2.012 s → response +17.000 s · open 102
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  O  O  O  O  O  O  O
  C2   O  O  O  O  O  O  X  O  X  O  O  O  O  O  O  O
  C3   O  O  O  O  O  O  O  O  X  X  O  O  O  O  O  O
  C4   O  O  O  O  X  O  O  O  X  X  X  O  O  X  O  O
  C5   O  O  O  O  O  O  O  O  O  O  O  O  O  O  O  O
  C6   O  O  O  O  O  O  O  O  O  O  O  O  O  O  O  O
  C7   O  O  O  O  O  O  O  O  O  O  O  X  O  O  O  O
```

**Read #15** · request +10.014 s → response +18.920 s · open 93
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  X  O  O  O  X  O  O  O  O
  C2   O  O  O  O  O  O  X  O  X  O  O  O  O  O  O  O
  C3   O  O  O  O  X  O  X  O  X  X  O  O  X  O  O  O
  C4   O  O  O  O  X  O  O  O  X  X  X  O  X  X  O  O
  C5   O  O  O  O  X  O  X  O  O  O  O  O  O  O  O  O
  C6   O  O  O  O  O  O  O  O  O  X  O  O  O  O  O  O
  C7   O  O  O  O  O  O  O  O  O  O  O  X  O  O  O  O
```

**Read #17** · request +12.014 s → response +17.929 s · open 85
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  X  X  X  O  X  O  O  O  O
  C2   O  O  O  O  O  O  X  X  X  O  O  X  O  X  O  O
  C3   O  O  O  O  X  O  X  O  X  X  O  O  X  O  O  O
  C4   O  O  O  O  X  O  X  X  X  X  X  O  X  X  O  O
  C5   O  O  O  O  X  O  X  O  O  O  O  O  O  O  O  O
  C6   O  O  O  O  O  O  O  O  X  X  O  O  O  O  O  O
  C7   O  O  O  O  O  O  O  O  O  O  O  X  O  O  O  O
```

**Read #18** · request +17.007 s → response +17.919 s · open 85
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  X  X  X  O  X  O  O  O  O
  C2   O  O  O  O  O  O  X  X  X  O  O  X  O  X  O  O
  C3   O  O  O  O  X  O  X  O  X  X  O  O  X  O  O  O
  C4   O  O  O  O  X  O  X  X  X  X  X  O  X  X  O  O
  C5   O  O  O  O  X  O  X  O  O  O  O  O  O  O  O  O
  C6   O  O  O  O  O  O  O  O  X  X  O  O  O  O  O  O
  C7   O  O  O  O  O  O  O  O  O  O  O  X  O  O  O  O
```

**Read #20** · request +19.005 s → response +28.868 s · open 46
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  X  X  X  X  X  X  X  X  X  O  X  O
  C2   O  O  O  O  X  X  X  X  X  O  X  X  X  X  X  O
  C3   O  O  O  O  X  X  X  X  X  X  X  X  X  X  O  O
  C4   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C5   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C6   O  O  O  O  X  X  O  X  X  X  X  O  X  O  X  O
  C7   O  O  O  O  O  X  X  O  O  X  O  X  X  O  X  O
```

**Read #22** · request +21.005 s → response +21.105 s · open 85
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  X  X  X  O  X  O  O  O  O
  C2   O  O  O  O  O  O  X  X  X  O  O  X  O  X  O  O
  C3   O  O  O  O  X  O  X  O  X  X  O  O  X  O  O  O
  C4   O  O  O  O  X  O  X  X  X  X  X  O  X  X  O  O
  C5   O  O  O  O  X  O  X  O  O  O  O  O  O  O  O  O
  C6   O  O  O  O  O  O  O  O  X  X  O  O  O  O  O  O
  C7   O  O  O  O  O  O  O  O  O  O  O  X  O  O  O  O
```

**Read #25** · request +24.011 s → response +28.974 s · open 42
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C2   O  O  O  O  X  X  X  X  X  O  X  X  X  X  X  O
  C3   O  O  O  O  X  X  X  X  X  X  X  X  X  X  O  O
  C4   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C5   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C6   O  O  O  O  X  X  O  X  X  X  X  X  X  O  X  O
  C7   O  O  O  O  O  X  X  O  X  X  O  X  X  X  X  O
```

**Read #29** · request +30.007 s → response +32.847 s · open 36
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C2   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C3   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C4   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C5   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C6   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C7   O  O  O  O  O  X  X  X  X  X  X  X  X  X  X  O
```

**Read #30** · request +31.006 s → response +32.893 s · open 35
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C2   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C3   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C4   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C5   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C6   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C7   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
```

**Read #32** · request +33.008 s → response +33.114 s · open 42
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C2   O  O  O  O  X  X  X  X  X  O  X  X  X  X  X  O
  C3   O  O  O  O  X  X  X  X  X  X  X  X  X  X  O  O
  C4   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C5   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C6   O  O  O  O  X  X  O  X  X  X  X  X  X  O  X  O
  C7   O  O  O  O  O  X  X  O  X  X  O  X  X  X  X  O
```

**Read #35** · request +36.004 s → response +36.078 s · open 36
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C2   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C3   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C4   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C5   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C6   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C7   O  O  O  O  O  X  X  X  X  X  X  X  X  X  X  O
```

**Read #53** · request +54.014 s → response +54.325 s · open 26
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C2   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C3   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C4   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C5   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C6   O  O  O  O  X  X  X  X  X  X  X  X  X  X  X  O
  C7   X  X  X  O  X  X  X  X  X  X  X  X  X  X  X  O
```

**Read #70** · request +115.015 s → response +116.223 s · open 14
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C2   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C3   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C4   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C5   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C6   X  X  X  O  X  X  X  X  X  X  X  X  X  X  X  O
  C7   X  X  X  O  X  X  X  X  X  X  X  X  X  X  X  O
```

**Read #81** · request +170.009 s → response +170.196 s · open 12
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C2   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C3   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C4   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C5   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C6   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C7   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
```

**Read #97** · request +250.005 s → response +250.614 s · open 13
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C2   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C3   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C4   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C5   O  X  X  X  X  O  X  X  X  X  X  X  X  X  X  O
  C6   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C7   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
```

**Read #98** · request +255.009 s → response +255.341 s · open 18
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C2   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C3   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C4   O  X  X  X  X  O  O  O  X  X  X  X  X  X  X  O
  C5   O  X  X  X  X  O  O  O  X  X  X  X  X  X  X  O
  C6   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C7   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
```

**Read #111** · request +420.008 s → response +420.381 s · open 18
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C2   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C3   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C4   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C5   O  X  X  X  X  X  X  X  O  O  O  X  X  X  X  O
  C6   X  X  X  X  X  X  X  X  O  O  O  X  X  X  X  O
  C7   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
```

**Read #117** · request +600.009 s → response +600.453 s · open 12
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C2   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C3   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C4   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C5   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C6   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C7   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
```

**Read #118** · request +630.006 s → response +630.409 s · open 43
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  X  X  X  O  O  O  O  O  O  X  X  X  O  X  O
  C2   O  X  X  X  O  O  O  X  O  O  X  X  X  O  O  O
  C3   O  X  X  X  O  X  O  X  X  X  X  X  O  X  O  O
  C4   O  X  X  X  O  X  X  X  X  X  X  X  X  X  O  O
  C5   O  X  X  X  O  X  X  X  X  X  X  X  X  X  X  O
  C6   X  X  X  X  O  O  O  O  X  X  X  O  X  O  X  O
  C7   X  X  X  X  O  O  X  O  X  X  O  X  X  X  X  O
```

**Read #119** · request +660.011 s → response +660.195 s · open 37
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  X  X  X  O  O  O  X  X  X  X  X  X  O  X  O
  C2   O  X  X  X  O  O  O  X  O  O  X  X  X  O  O  O
  C3   O  X  X  X  O  X  O  X  X  X  X  X  O  X  O  O
  C4   O  X  X  X  O  X  X  X  X  X  X  X  X  X  O  O
  C5   O  X  X  X  O  X  X  X  X  X  X  X  X  X  X  O
  C6   X  X  X  X  O  X  X  X  X  X  X  O  X  O  X  O
  C7   X  X  X  X  O  O  X  O  X  X  O  X  X  X  X  O
```

**Read #120** · request +690.011 s → response +690.204 s · open 35
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  X  X  X  O  X  O  X  X  X  X  X  X  O  X  O
  C2   O  X  X  X  O  O  O  X  O  O  X  X  X  O  O  O
  C3   O  X  X  X  O  X  O  X  X  X  X  X  O  X  O  O
  C4   O  X  X  X  O  X  X  X  X  X  X  X  X  X  O  O
  C5   O  X  X  X  O  X  X  X  X  X  X  X  X  X  X  O
  C6   X  X  X  X  O  X  X  X  X  X  X  O  X  X  X  O
  C7   X  X  X  X  O  O  X  O  X  X  O  X  X  X  X  O
```

**Read #121** · request +720.010 s → response +720.196 s · open 29
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  X  X  X  O  X  O  X  X  X  X  X  X  X  X  O
  C2   O  X  X  X  O  O  O  X  X  X  X  X  X  X  O  O
  C3   O  X  X  X  O  X  O  X  X  X  X  X  X  X  O  O
  C4   O  X  X  X  O  X  X  X  X  X  X  X  X  X  O  O
  C5   O  X  X  X  O  X  X  X  X  X  X  X  X  X  X  O
  C6   X  X  X  X  O  X  X  X  X  X  X  X  X  X  X  O
  C7   X  X  X  X  O  O  X  O  X  X  O  X  X  X  X  O
```

**Read #124** · request +810.008 s → response +810.326 s · open 28
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  X  X  X  O  X  O  X  X  X  X  X  X  X  X  O
  C2   O  X  X  X  O  O  O  X  X  X  X  X  X  X  O  O
  C3   O  X  X  X  O  X  O  X  X  X  X  X  X  X  O  O
  C4   O  X  X  X  O  X  X  X  X  X  X  X  X  X  O  O
  C5   O  X  X  X  O  X  X  X  X  X  X  X  X  X  X  O
  C6   X  X  X  X  O  X  X  X  X  X  X  X  X  X  X  O
  C7   X  X  X  X  O  O  X  O  X  X  X  X  X  X  X  O
```

**Read #126** · request +870.005 s → response +870.214 s · open 28
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  X  X  X  O  O  X  X  X  X  X  X  X  X  X  O
  C2   O  X  X  X  O  O  O  X  X  X  X  X  X  X  O  O
  C3   O  X  X  X  O  X  O  X  X  X  X  X  X  X  O  O
  C4   O  X  X  X  O  X  X  X  X  X  X  X  X  X  O  O
  C5   O  X  X  X  O  X  X  X  X  X  X  X  X  X  X  O
  C6   X  X  X  X  O  X  X  X  X  X  X  X  X  X  X  O
  C7   X  X  X  X  O  O  X  O  X  X  X  X  X  X  X  O
```

**Read #127** · request +900.006 s → response +900.618 s · open 27
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  X  X  X  O  O  X  X  X  X  X  X  X  X  X  O
  C2   O  X  X  X  O  O  X  X  X  X  X  X  X  X  O  O
  C3   O  X  X  X  O  X  O  X  X  X  X  X  X  X  O  O
  C4   O  X  X  X  O  X  X  X  X  X  X  X  X  X  O  O
  C5   O  X  X  X  O  X  X  X  X  X  X  X  X  X  X  O
  C6   X  X  X  X  O  X  X  X  X  X  X  X  X  X  X  O
  C7   X  X  X  X  O  O  X  O  X  X  X  X  X  X  X  O
```


### Appendix F — Every court-hour (112 cells): state changes, public records, end state

Changes are listed in request order as `state@request offset(#read)`. "Record" columns come from the booking reads (b1 −60 s … b8 +900 s). Last column is the public snapshot at 08:33:25.204 Manila (availability + record status: CO confirmed, PE pending, .. none).

| Cell | First grid (#8) | Changes after #8 | Record first seen | Record last seen | End of watch (#127) | 08:33 snapshot |
|---|---|---|---|---|---|---|
| C1 08:00 | O | — | — | — | O | O.. |
| C1 09:00 | O | X@+115.015 s(#70) | b5 +120.005 s | b8 +900.006 s | X | XCO |
| C1 10:00 | O | X@+115.015 s(#70) | b5 +120.005 s | b8 +900.006 s | X | XCO |
| C1 11:00 | O | X@+115.015 s(#70) | b5 +120.005 s | b8 +900.006 s | X | XCO |
| C1 12:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) O@+630.006 s(#118) | b3 +30.008 s | b7 +600.011 s | O | O.. |
| C1 13:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) O@+630.006 s(#118) X@+690.011 s(#120) O@+870.005 s(#126) | b3 +30.008 s | b7 +600.011 s | O | O.. |
| C1 14:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) O@+630.006 s(#118) X@+870.005 s(#126) | b3 +30.008 s | b8 +900.006 s | X | XPE |
| C1 15:00 | O | X@+10.014 s(#15) O@+11.012 s(#16) X@+12.014 s(#17) O@+22.005 s(#23) X@+23.015 s(#24) O@+630.006 s(#118) X@+660.011 s(#119) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C1 16:00 | O | X@+12.014 s(#17) O@+22.005 s(#23) X@+23.015 s(#24) O@+630.006 s(#118) X@+660.011 s(#119) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C1 17:00 | O | X@+12.014 s(#17) O@+22.005 s(#23) X@+23.015 s(#24) O@+630.006 s(#118) X@+660.011 s(#119) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C1 18:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | XPE |
| C1 19:00 | O | X@+10.014 s(#15) O@+11.012 s(#16) X@+12.014 s(#17) O@+22.005 s(#23) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | XPE |
| C1 20:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | XPE |
| C1 21:00 | O | X@+24.011 s(#25) O@+35.004 s(#34) X@+36.004 s(#35) O@+37.002 s(#36) X@+38.015 s(#37) O@+630.006 s(#118) X@+720.010 s(#121) | b3 +30.008 s | b8 +900.006 s | X | XPE |
| C1 22:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | XPE |
| C1 23:00 | O | — | — | — | O | XPE |
| C2 08:00 | O | — | — | — | O | O.. |
| C2 09:00 | O | X@+115.015 s(#70) | b5 +120.005 s | b8 +900.006 s | X | XCO |
| C2 10:00 | O | X@+115.015 s(#70) | b5 +120.005 s | b8 +900.006 s | X | XCO |
| C2 11:00 | O | X@+115.015 s(#70) | b5 +120.005 s | b8 +900.006 s | X | XCO |
| C2 12:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) O@+630.006 s(#118) | b3 +30.008 s | b7 +600.011 s | O | O.. |
| C2 13:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) O@+630.006 s(#118) | b3 +30.008 s | b7 +600.011 s | O | O.. |
| C2 14:00 | O | X@+2.012 s(#12) O@+630.006 s(#118) X@+900.006 s(#127) | b3 +30.008 s | b8 +900.006 s | X | XPE |
| C2 15:00 | O | X@+12.014 s(#17) O@+22.005 s(#23) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | O.. |
| C2 16:00 | O | X@+2.012 s(#12) O@+630.006 s(#118) X@+720.010 s(#121) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C2 17:00 | O | X@+30.007 s(#29) O@+32.003 s(#31) X@+36.004 s(#35) O@+37.002 s(#36) X@+38.015 s(#37) O@+630.006 s(#118) X@+720.010 s(#121) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C2 18:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | XPE |
| C2 19:00 | O | X@+12.014 s(#17) O@+22.005 s(#23) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | XPE |
| C2 20:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | XPE |
| C2 21:00 | O | X@+12.014 s(#17) O@+22.005 s(#23) X@+23.015 s(#24) O@+630.006 s(#118) X@+720.010 s(#121) | b3 +30.008 s | b8 +900.006 s | X | XPE |
| C2 22:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) O@+630.006 s(#118) | b3 +30.008 s | b7 +600.011 s | O | XPE |
| C2 23:00 | O | — | — | — | O | XPE |
| C3 08:00 | O | — | — | — | O | O.. |
| C3 09:00 | O | X@+90.014 s(#65) | b5 +120.005 s | b8 +900.006 s | X | XCO |
| C3 10:00 | O | X@+90.014 s(#65) | b5 +120.005 s | b8 +900.006 s | X | XCO |
| C3 11:00 | O | X@+90.014 s(#65) | b5 +120.005 s | b8 +900.006 s | X | XCO |
| C3 12:00 | O | X@+10.014 s(#15) O@+11.012 s(#16) X@+12.014 s(#17) O@+22.005 s(#23) X@+23.015 s(#24) O@+630.006 s(#118) | b3 +30.008 s | b7 +600.011 s | O | O.. |
| C3 13:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | XPE |
| C3 14:00 | O | X@+10.014 s(#15) O@+11.012 s(#16) X@+12.014 s(#17) O@+22.005 s(#23) X@+23.015 s(#24) O@+630.006 s(#118) | b3 +30.008 s | b7 +600.011 s | O | O.. |
| C3 15:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | O.. |
| C3 16:00 | X | — | b1 −59.985 s | b8 +900.006 s | X | XCO |
| C3 17:00 | X | — | b1 −59.985 s | b8 +900.006 s | X | XCO |
| C3 18:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | XPE |
| C3 19:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | XPE |
| C3 20:00 | O | X@+10.014 s(#15) O@+11.012 s(#16) X@+12.014 s(#17) O@+22.005 s(#23) X@+23.015 s(#24) O@+630.006 s(#118) X@+720.010 s(#121) | b3 +30.008 s | b8 +900.006 s | X | XPE |
| C3 21:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | XPE |
| C3 22:00 | O | X@+30.007 s(#29) O@+32.003 s(#31) X@+36.004 s(#35) O@+37.002 s(#36) X@+38.015 s(#37) O@+630.006 s(#118) | b3 +30.008 s | b7 +600.011 s | O | O.. |
| C3 23:00 | O | — | — | — | O | O.. |
| C4 08:00 | O | — | — | — | O | O.. |
| C4 09:00 | O | X@+54.014 s(#53) O@+59.003 s(#58) X@+65.014 s(#60) | b4 +60.004 s | b8 +900.006 s | X | XCO |
| C4 10:00 | O | X@+54.014 s(#53) O@+59.003 s(#58) X@+65.014 s(#60) | b4 +60.004 s | b8 +900.006 s | X | XCO |
| C4 11:00 | O | X@+54.014 s(#53) O@+59.003 s(#58) X@+65.014 s(#60) | b4 +60.004 s | b8 +900.006 s | X | XCO |
| C4 12:00 | O | X@+2.012 s(#12) O@+630.006 s(#118) | b3 +30.008 s | b7 +600.011 s | O | O.. |
| C4 13:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) O@+255.009 s(#98) X@+265.005 s(#100) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C4 14:00 | O | X@+12.014 s(#17) O@+22.005 s(#23) X@+23.015 s(#24) O@+255.009 s(#98) X@+265.005 s(#100) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C4 15:00 | O | X@+12.014 s(#17) O@+22.005 s(#23) X@+23.015 s(#24) O@+255.009 s(#98) X@+265.005 s(#100) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C4 16:00 | X | — | b1 −59.985 s | b8 +900.006 s | X | XCO |
| C4 17:00 | X | — | b1 −59.985 s | b8 +900.006 s | X | XCO |
| C4 18:00 | X | — | b1 −59.985 s | b8 +900.006 s | X | XCO |
| C4 19:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C4 20:00 | O | X@+10.014 s(#15) O@+11.012 s(#16) X@+12.014 s(#17) O@+22.005 s(#23) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C4 21:00 | O | X@+2.012 s(#12) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C4 22:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) O@+630.006 s(#118) | b3 +30.008 s | b7 +600.011 s | O | O.. |
| C4 23:00 | O | — | — | — | O | O.. |
| C5 08:00 | O | — | — | — | O | O.. |
| C5 09:00 | O | X@+54.014 s(#53) O@+59.003 s(#58) X@+65.014 s(#60) | b4 +60.004 s | b8 +900.006 s | X | XCO |
| C5 10:00 | O | X@+54.014 s(#53) O@+59.003 s(#58) X@+65.014 s(#60) | b4 +60.004 s | b8 +900.006 s | X | XCO |
| C5 11:00 | O | X@+54.014 s(#53) O@+59.003 s(#58) X@+65.014 s(#60) | b4 +60.004 s | b8 +900.006 s | X | XCO |
| C5 12:00 | O | X@+10.014 s(#15) O@+11.012 s(#16) X@+12.014 s(#17) O@+22.005 s(#23) X@+23.015 s(#24) O@+630.006 s(#118) | b3 +30.008 s | b7 +600.011 s | O | O.. |
| C5 13:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) O@+250.005 s(#97) X@+265.005 s(#100) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C5 14:00 | O | X@+10.014 s(#15) O@+11.012 s(#16) X@+12.014 s(#17) O@+22.005 s(#23) X@+23.015 s(#24) O@+255.009 s(#98) X@+265.005 s(#100) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C5 15:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) O@+255.009 s(#98) X@+265.005 s(#100) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C5 16:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) O@+420.008 s(#111) X@+450.012 s(#112) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C5 17:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) O@+420.008 s(#111) X@+450.012 s(#112) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C5 18:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) O@+420.008 s(#111) X@+450.012 s(#112) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C5 19:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C5 20:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C5 21:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C5 22:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | O.. |
| C5 23:00 | O | — | — | — | O | O.. |
| C6 08:00 | O | X@+75.009 s(#62) | b5 +120.005 s | b8 +900.006 s | X | XCO |
| C6 09:00 | O | X@+75.009 s(#62) | b5 +120.005 s | b8 +900.006 s | X | XCO |
| C6 10:00 | O | X@+75.009 s(#62) | b5 +120.005 s | b8 +900.006 s | X | XCO |
| C6 11:00 | O | X@+170.009 s(#81) | b6 +300.010 s | b8 +900.006 s | X | XCO |
| C6 12:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) O@+630.006 s(#118) | b3 +30.008 s | b7 +600.011 s | O | XPE |
| C6 13:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) O@+630.006 s(#118) X@+660.011 s(#119) | b3 +30.008 s | b8 +900.006 s | X | XPE |
| C6 14:00 | O | X@+30.007 s(#29) O@+32.003 s(#31) X@+36.004 s(#35) O@+37.002 s(#36) X@+38.015 s(#37) O@+630.006 s(#118) X@+660.011 s(#119) | b3 +30.008 s | b8 +900.006 s | X | O.. |
| C6 15:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) O@+630.006 s(#118) X@+660.011 s(#119) | b3 +30.008 s | b8 +900.006 s | X | O.. |
| C6 16:00 | O | X@+12.014 s(#17) O@+22.005 s(#23) X@+23.015 s(#24) O@+420.008 s(#111) X@+450.012 s(#112) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C6 17:00 | O | X@+10.014 s(#15) O@+11.012 s(#16) X@+12.014 s(#17) O@+22.005 s(#23) X@+23.015 s(#24) O@+420.008 s(#111) X@+450.012 s(#112) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C6 18:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) O@+420.008 s(#111) X@+450.012 s(#112) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C6 19:00 | O | X@+24.011 s(#25) O@+35.004 s(#34) X@+36.004 s(#35) O@+37.002 s(#36) X@+38.015 s(#37) O@+630.006 s(#118) X@+720.010 s(#121) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C6 20:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C6 21:00 | O | X@+30.007 s(#29) O@+32.003 s(#31) X@+36.004 s(#35) O@+37.002 s(#36) X@+38.015 s(#37) O@+630.006 s(#118) X@+690.011 s(#120) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C6 22:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | O.. |
| C6 23:00 | O | — | — | — | O | O.. |
| C7 08:00 | O | X@+47.012 s(#46) O@+48.015 s(#47) X@+49.013 s(#48) | b4 +60.004 s | b8 +900.006 s | X | XCO |
| C7 09:00 | O | X@+47.012 s(#46) O@+48.015 s(#47) X@+49.013 s(#48) | b4 +60.004 s | b8 +900.006 s | X | XCO |
| C7 10:00 | O | X@+47.012 s(#46) O@+48.015 s(#47) X@+49.013 s(#48) | b4 +60.004 s | b8 +900.006 s | X | XCO |
| C7 11:00 | O | X@+170.009 s(#81) | b6 +300.010 s | b8 +900.006 s | X | XCO |
| C7 12:00 | O | X@+31.006 s(#30) O@+32.003 s(#31) X@+39.012 s(#38) O@+630.006 s(#118) | b3 +30.008 s | b7 +600.011 s | O | O.. |
| C7 13:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) O@+630.006 s(#118) | b3 +30.008 s | b7 +600.011 s | O | O.. |
| C7 14:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | XPE |
| C7 15:00 | O | X@+30.007 s(#29) O@+32.003 s(#31) X@+36.004 s(#35) O@+37.002 s(#36) X@+38.015 s(#37) O@+630.006 s(#118) | b3 +30.008 s | b7 +600.011 s | O | O.. |
| C7 16:00 | O | X@+24.011 s(#25) O@+35.004 s(#34) X@+36.004 s(#35) O@+37.002 s(#36) X@+38.015 s(#37) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C7 17:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C7 18:00 | O | X@+30.007 s(#29) O@+32.003 s(#31) X@+36.004 s(#35) O@+37.002 s(#36) X@+38.015 s(#37) O@+630.006 s(#118) X@+810.008 s(#124) | b3 +30.008 s | b8 +900.006 s | X | XCO |
| C7 19:00 | O | X@+2.012 s(#12) | b3 +30.008 s | b8 +900.006 s | X | XPE |
| C7 20:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | XPE |
| C7 21:00 | O | X@+24.011 s(#25) O@+35.004 s(#34) X@+36.004 s(#35) O@+37.002 s(#36) X@+38.015 s(#37) | b3 +30.008 s | b8 +900.006 s | X | O.. |
| C7 22:00 | O | X@+19.005 s(#20) O@+21.005 s(#22) X@+23.015 s(#24) | b3 +30.008 s | b8 +900.006 s | X | O.. |
| C7 23:00 | O | — | — | — | O | O.. |

### Appendix G — Provider / network trace (all records)

Source: `.local/release-forensics/fc62669a-bfe5-4726-998a-fa0616bd1e19/provider-trace.ndjson`. Header: [{"workerId":"A","status":"active"},{"workerId":"B","status":"active"},{"workerId":"C","status":"active"},{"workerId":"D","status":"active"},{"workerId":"E","status":"active"},{"workerId":"F","status":"active"},{"workerId":"G","status":"active"}]. Browser times are Chrome-monotonic ms after the request start; node times are ms after 08:00:00 on the runner's trusted clock.

| Worker | Attempt | Path | Trace enabled | Headers | Finished | send / wait (ms) | dns/connect/tls | Protocol · reused | Status | Server | x-vercel-id | vercel-cache | Bytes | Complete |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A | core-A-official-1 | POST /api/bookings/public-checkout | +12 ms | +34618.2 ms | +34618.4 ms | 0.3 / 34609.3 | —/—/— | h2 · true | 409 application/json | Vercel | sin1::sin1::p8z7w-1790294400030-a73f748bcd1f | MISS | 397 | true |
| B | core-B-official-2 | POST /api/bookings/public-checkout | +12.2 ms | +29557.5 ms | +29557.9 ms | 0.2 / 29547.7 | —/—/— | h2 · true | 409 application/json | Vercel | sin1::sin1::9tkzx-1790294400031-dd767626ebff | MISS | 405 | true |
| C | core-C-official-3 | POST /api/bookings/public-checkout | +12.3 ms | +29822.4 ms | +29822.7 ms | 0.2 / 29809.9 | —/—/— | h2 · true | 409 application/json | Vercel | sin1::sin1::rlfmg-1790294400032-46c4b8097878 | MISS | 220 | true |
| D | core-D-official-4 | POST /api/bookings/public-checkout | +12.3 ms | +29107.4 ms | +29108.2 ms | 0.2 / 29098.2 | —/—/— | h2 · true | 409 application/json | Vercel | sin1::sin1::rss2s-1790294400031-ad67912a9919 | MISS | 219 | true |
| E | core-E-official-5 | POST /api/bookings/public-checkout | +12.4 ms | +32174.9 ms | +32175.1 ms | 0.2 / 32164.9 | —/—/— | h2 · true | 409 application/json | Vercel | sin1::sin1::gqthg-1790294400032-bcbd8236050a | MISS | 407 | true |
| F | core-F-official-6 | POST /api/bookings/public-checkout | +12.5 ms | +33856.6 ms | +33856.8 ms | 0.2 / 33847.1 | —/—/— | h2 · true | 409 application/json | Vercel | sin1::sin1::m5p5p-1790294400038-eda31da31ebb | MISS | 399 | true |
| G | core-G-official-7 | POST /api/bookings/public-checkout | +12.5 ms | +32975.6 ms | +32975.8 ms | 0.1 / 32965.8 | —/—/— | h2 · true | 409 application/json | Vercel | sin1::sin1::lp9st-1790294400034-2e1077ff7233 | MISS | 399 | true |

Other trace records:
```
{"type":"response-fallback","workerId":"D","attemptId":"core-D-official-4","candidateId":"eff27bfc9a73d9bc47117c7b970661955ba1f6fb416963def41aea4851ab27d0","wave":"WAVE_1","status":409,"contentType":"application/json","server":"Vercel","cfRay":null,"vercelId":"sin1::sin1::rss2s-1790294400031-ad67912a9919","requestId":null,"serverTiming":null,"responseReceivedMs":29101.2,"responseCompletedMs":29101.3}
{"type":"response-fallback","workerId":"B","attemptId":"core-B-official-2","candidateId":"6ff22c70f69e41ba9c6bb76bc8b4fade7f8422c8194513ac4adcfe30970aafed","wave":"WAVE_1","status":409,"contentType":"application/json","server":"Vercel","cfRay":null,"vercelId":"sin1::sin1::9tkzx-1790294400031-dd767626ebff","requestId":null,"serverTiming":null,"responseReceivedMs":29551.3,"responseCompletedMs":29551.6}
{"type":"response-fallback","workerId":"C","attemptId":"core-C-official-3","candidateId":"5186cf932de0142132a9ad9e5a9d5cb0a2ff7e63c98caad9d6a56811f224dbdf","wave":"WAVE_1","status":409,"contentType":"application/json","server":"Vercel","cfRay":null,"vercelId":"sin1::sin1::rlfmg-1790294400032-46c4b8097878","requestId":null,"serverTiming":null,"responseReceivedMs":29815.4,"responseCompletedMs":29815.8}
{"type":"response-fallback","workerId":"E","attemptId":"core-E-official-5","candidateId":"8bcb34195d35e7ffe098670f7edf3778d0763221c325566cff5aedf4971b4c00","wave":"WAVE_1","status":409,"contentType":"application/json","server":"Vercel","cfRay":null,"vercelId":"sin1::sin1::gqthg-1790294400032-bcbd8236050a","requestId":null,"serverTiming":null,"responseReceivedMs":32168.1,"responseCompletedMs":32168.4}
{"type":"response-fallback","workerId":"G","attemptId":"core-G-official-7","candidateId":"36414a6a2b84eed2a9b7ce4d3358cdb3b269d5444e1d31c2863c61e12f51fb10","wave":"WAVE_1","status":409,"contentType":"application/json","server":"Vercel","cfRay":null,"vercelId":"sin1::sin1::lp9st-1790294400034-2e1077ff7233","requestId":null,"serverTiming":null,"responseReceivedMs":32968.2,"responseCompletedMs":32968.3}
{"type":"response-fallback","workerId":"F","attemptId":"core-F-official-6","candidateId":"e9b14c0cdb821e41157f2b57a3386482846ef17b5819da9206ab9f9b31dc7287","wave":"WAVE_1","status":409,"contentType":"application/json","server":"Vercel","cfRay":null,"vercelId":"sin1::sin1::m5p5p-1790294400038-eda31da31ebb","requestId":null,"serverTiming":null,"responseReceivedMs":33849.7,"responseCompletedMs":33849.9}
{"type":"response-fallback","workerId":"A","attemptId":"core-A-official-1","candidateId":"21f81fe8d04d861fce8c839ab5d757e58e0b5da5ff83d9585a68bd5d54b9a066","wave":"WAVE_1","status":409,"contentType":"application/json","server":"Vercel","cfRay":null,"vercelId":"sin1::sin1::p8z7w-1790294400030-a73f748bcd1f","requestId":null,"serverTiming":null,"responseReceivedMs":34612.4,"responseCompletedMs":34612.6}
```

### Appendix H — Durable journals for the seven Wave 1 attempts

Source: `.local/api-booking/api-first-journals/<key>/`. The private response file is summarised field-by-field; booking IDs, numbers, session IDs and hold expiry were all empty.

| Journal key | Court · hours | State | Created | Updated | Diagnostic | Failure code | One-shot claimed | Private response: success · IDs · holds |
|---|---|---|---|---|---|---|---|---|
| 3fcba1ce13… | C7 19:00–22:00 (3 h, max PHP 2100) | rejected | 07:58:00.068 | 08:00:34.659 | 409 http-rejection · json · application · availability | ONDA_HTTP_STATUS_INVALID | 07:58:00.079 (armed) | false · 0 IDs · 0 numbers · 0 holds |
| eb4344f95f… | C6 19:00–22:00 (3 h, max PHP 2100) | rejected | 07:58:00.069 | 08:00:29.565 | 409 http-rejection · json · application · availability | ONDA_HTTP_STATUS_INVALID | 07:58:00.080 (armed) | false · 0 IDs · 0 numbers · 0 holds |
| 894f9c50a3… | C5 19:00–22:00 (3 h, max PHP 2100) | rejected | 07:58:00.069 | 08:00:29.863 | 409 http-rejection · json · application · availability | ONDA_HTTP_STATUS_INVALID | 07:58:00.080 (armed) | false · 0 IDs · 0 numbers · 0 holds |
| d14980ebe3… | C4 19:00–22:00 (3 h, max PHP 2100) | rejected | 07:58:00.069 | 08:00:29.149 | 409 http-rejection · json · application · availability | ONDA_HTTP_STATUS_INVALID | 07:58:00.080 (armed) | false · 0 IDs · 0 numbers · 0 holds |
| e9ea07fcd3… | C3 19:00–22:00 (3 h, max PHP 2100) | rejected | 07:58:00.069 | 08:00:32.185 | 409 http-rejection · json · application · availability | ONDA_HTTP_STATUS_INVALID | 07:58:00.080 (armed) | false · 0 IDs · 0 numbers · 0 holds |
| 6c15a106dc… | C2 15:00–18:00 (3 h, max PHP 2100) | rejected | 07:58:00.069 | 08:00:33.896 | 409 http-rejection · json · application · availability | ONDA_HTTP_STATUS_INVALID | 07:58:00.080 (armed) | false · 0 IDs · 0 numbers · 0 holds |
| 00e4ed1fe1… | C1 15:00–18:00 (3 h, max PHP 2100) | rejected | 07:58:00.069 | 08:00:33.015 | 409 http-rejection · json · application · availability | ONDA_HTTP_STATUS_INVALID | 07:58:00.080 (armed) | false · 0 IDs · 0 numbers · 0 holds |

### Appendix I — Frozen authorization at T−2 min (all 11 candidates)

Source: `.local/api-booking/precision-races/fc62669a-bfe5-4726-998a-fa0616bd1e19-phase3-freeze.json`, frozen 07:58:00.063 Manila. Budgets {"wave2":0,"rescue":0,"total":7} · standby [] · concurrentWave2 true · rescueEnabled false.

| Priority | Court | Hours | Wave 1 | Wave 2 | Rescue | Wave 1 worker | Rate evidence | Expected PHP | Candidate ID | Journal key |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 7 | 19:00–22:00 | yes | no | no | A | VENUE_SCHEDULE 700/700/700 (captured 2026-09-25 01:00 Manila) | 2100 | 21f81fe8d0… | 3fcba1ce13… |
| 2 | 6 | 19:00–22:00 | yes | no | no | B | VENUE_SCHEDULE 700/700/700 (captured 2026-09-25 01:00 Manila) | 2100 | 6ff22c70f6… | eb4344f95f… |
| 3 | 5 | 19:00–22:00 | yes | no | no | C | VENUE_SCHEDULE 700/700/700 (captured 2026-09-25 01:00 Manila) | 2100 | 5186cf932d… | 894f9c50a3… |
| 4 | 4 | 19:00–22:00 | yes | no | no | D | VENUE_SCHEDULE 700/700/700 (captured 2026-09-25 01:00 Manila) | 2100 | eff27bfc9a… | d14980ebe3… |
| 5 | 3 | 19:00–22:00 | yes | no | no | E | VENUE_SCHEDULE 700/700/700 (captured 2026-09-25 01:00 Manila) | 2100 | 8bcb34195d… | e9ea07fcd3… |
| 6 | 2 | 15:00–18:00 | yes | no | no | F | VENUE_SCHEDULE 700/700/700 (captured 2026-09-25 01:00 Manila) | 2100 | e9b14c0cdb… | 6c15a106dc… |
| 7 | 1 | 15:00–18:00 | yes | no | no | G | VENUE_SCHEDULE 700/700/700 (captured 2026-09-25 01:00 Manila) | 2100 | 36414a6a2b… | 00e4ed1fe1… |
| 8 | 7 | 15:00–18:00 | no | yes | no | — | VENUE_SCHEDULE 700/700/700 (captured 2026-09-25 01:00 Manila) | 2100 | 6156d8c8d6… | 13f8f7c69b… |
| 9 | 6 | 15:00–18:00 | no | yes | no | — | VENUE_SCHEDULE 700/700/700 (captured 2026-09-25 01:00 Manila) | 2100 | 8d207103c5… | c26ebd3105… |
| 10 | 5 | 15:00–18:00 | no | yes | no | — | VENUE_SCHEDULE 700/700/700 (captured 2026-09-25 01:00 Manila) | 2100 | f7fb95acc2… | 42c3ffa814… |
| 11 | 4 | 15:00–18:00 | no | yes | no | — | VENUE_SCHEDULE 700/700/700 (captured 2026-09-25 01:00 Manila) | 2100 | 58a0e5512a… | 8c67ffd405… |

Other freeze fields:
```
{
 "wave1Freeze": "9deaf56c25c1e78dc8a6f1bbbaedcc49cac1cfb1f66da46dc5d337adc700bdd3"
}
```

### Appendix J — Network clock evidence (all three checkpoints, every sample)

**T-10M** · captured 07:50:00.299 Manila · offset 19.6 ms · uncertainty ±21.5 ms · spread 12.7 ms · RTT min/median/max 43/53/98 ms · kept 9/10 · quality GOOD

| Host | Offset ms | RTT ms | Kept |
|---|---|---|---|
| time.google.com | 43.7 | 98 | false |
| time1.google.com | 28.5 | 78 | true |
| time2.google.com | 24.9 | 56 | true |
| time3.google.com | 22.6 | 61 | true |
| time4.google.com | 23.4 | 64 | true |
| time.google.com | 19.6 | 43 | true |
| time1.google.com | 15.8 | 50 | true |
| time2.google.com | 18.7 | 43 | true |
| time3.google.com | 19 | 43 | true |
| time4.google.com | 16.6 | 49 | true |

**T-60S** · captured 07:59:00.190 Manila · offset 24.3 ms · uncertainty ±22.3 ms · spread 10.4 ms · RTT min/median/max 44/49/67 ms · kept 10/10 · quality GOOD

| Host | Offset ms | RTT ms | Kept |
|---|---|---|---|
| time.google.com | 22.4 | 49 | true |
| time1.google.com | 23.9 | 46 | true |
| time2.google.com | 30.6 | 65 | true |
| time3.google.com | 32.1 | 67 | true |
| time4.google.com | 30.1 | 65 | true |
| time.google.com | 23.9 | 45 | true |
| time1.google.com | 24.6 | 44 | true |
| time2.google.com | 21.7 | 49 | true |
| time3.google.com | 22.2 | 49 | true |
| time4.google.com | 24.8 | 45 | true |

**T-30S** · captured 07:59:30.180 Manila · offset 23.3 ms · uncertainty ±24.2 ms · spread 4.2 ms · RTT min/median/max 44/49/50 ms · kept 10/10 · quality GOOD

| Host | Offset ms | RTT ms | Kept |
|---|---|---|---|
| time.google.com | 26 | 47 | true |
| time1.google.com | 22.8 | 49 | true |
| time2.google.com | 23.1 | 50 | true |
| time3.google.com | 23.5 | 49 | true |
| time4.google.com | 23.8 | 50 | true |
| time.google.com | 25.5 | 44 | true |
| time1.google.com | 21.8 | 50 | true |
| time2.google.com | 25.2 | 45 | true |
| time3.google.com | 23 | 50 | true |
| time4.google.com | 22.3 | 49 | true |

`.local/network-clock.json` (observer): {"source":"time.google.com","offsetMs":19.586181640625,"roundTripMs":43,"synchronizedAt":"2026-09-24T23:50:00.297Z","method":"ntp-consensus-v1","sampleCount":10,"keptCount":9,"spreadMs":12.730712890625,"uncertaintyMs":21.5,"quality":"GOOD"}

### Appendix K — Every app command this morning (booking-runs index)

| Log | Started (Manila) | Ended | Label | Outcome | Key lines |
|---|---|---|---|---|---|
| 0d1854d2 | 00:57:08.823 | 00:57:10.069 | blockAudit | complete (blockAudit) | 2026-09-27 · Open 0 · Blocked 5 · Unreleased 107 · Unknown 0. No hold or booking was created. |
| 30f54a66 | 01:01:08.426 | 01:01:08.445 | saving | complete (saving) | — |
| d7749cac | 01:01:21.776 | 01:01:35.353 | prepare | complete (API DRY) | — |
| 27f391c6 | 01:01:44.794 | 01:05:29.408 | full | aborted (API LIVE) | Slot watch stopped for 2026-09-27: 0 reads answered · 0 open → unavailable.  / API run needs attention · USER_ABORT · 223998 ms total · +221409 ms since prior stage / AUTOMATION ABORTED — USER CONTROL RESTORED |
| 6e77a8bf | 01:05:46.868 | 01:05:56.432 | full | aborted (API LIVE) | Slot watch stopped for 2026-09-27: 0 reads answered · 0 open → unavailable.  / API run needs attention · USER_ABORT · 8970 ms total · +6568 ms since prior stage / AUTOMATION ABORTED — USER CONTROL RESTORED |
| f89db7ef | 01:05:58.761 | 01:06:11.066 | closingBrowsers | complete (closingBrowsers) | Closed 7 bot Chrome browsers (7 force-closed after not responding). Your own Chrome windows were not touched. |
| f842a5fc | 01:23:18.789 | 01:23:19.453 | blockAudit | complete (blockAudit) | 2026-09-27 · Open 0 · Blocked 5 · Unreleased 107 · Unknown 0. No hold or booking was created. |
| 95af745c | 01:30:36.380 | 01:30:37.026 | blockAudit | complete (blockAudit) | 2026-09-27 · Open 0 · Blocked 5 · Unreleased 107 · Unknown 0. No hold or booking was created. |
| f09d0a19 | 01:34:58.750 | 01:34:58.807 | saving | complete (saving) | — |
| 074c1290 | 01:35:03.355 | 01:35:16.270 | prepare | complete (API DRY) | — |
| d35e0336 | 01:35:20.578 | 01:35:32.814 | full | aborted (API LIVE) | Slot watch stopped for 2026-09-27: 0 reads answered · 0 open → unavailable.  / API run needs attention · USER_ABORT · 11599 ms total · +8930 ms since prior stage / AUTOMATION ABORTED — USER CONTROL RESTORED |
| a1429dea | 01:35:35.598 | 01:35:47.465 | closingBrowsers | complete (closingBrowsers) | Closed 7 bot Chrome browsers (7 force-closed after not responding). Your own Chrome windows were not touched. |
| 8a3b810b | 05:09:11.190 | 05:09:13.415 | blockAudit | complete (blockAudit) | 2026-09-27 · Open 0 · Blocked 5 · Unreleased 107 · Unknown 0. No hold or booking was created. |
| cd49f6fa | 05:09:19.395 | 05:09:19.942 | blockAudit | complete (blockAudit) | 2026-09-28 · Open 0 · Blocked 14 · Unreleased 98 · Unknown 0. No hold or booking was created. |
| fbc06d51 | 05:09:43.696 | 05:09:44.579 | blockAudit | complete (blockAudit) | 2026-09-29 · Open 0 · Blocked 0 · Unreleased 112 · Unknown 0. No hold or booking was created. |
| fdb602a1 | 05:09:49.516 | 05:09:50.159 | blockAudit | complete (blockAudit) | 2026-10-02 · Open 0 · Blocked 0 · Unreleased 112 · Unknown 0. No hold or booking was created. |
| 1d0821fb | 05:09:55.366 | 05:09:55.958 | blockAudit | complete (blockAudit) | 2026-10-03 · Open 0 · Blocked 0 · Unreleased 112 · Unknown 0. No hold or booking was created. |
| 9d73e15c | 05:10:02.438 | 05:10:03.246 | blockAudit | complete (blockAudit) | 2026-09-25 · Open 28 · Blocked 84 · Unreleased 0 · Unknown 0. No hold or booking was created. |
| d27d0e27 | 05:10:22.861 | 05:10:23.492 | blockAudit | complete (blockAudit) | 2026-09-19 · Open 0 · Blocked 62 · Unreleased 0 · Unknown 50. No hold or booking was created. |
| 11c4907a | 07:10:05.916 | 07:10:05.941 | saving | complete (saving) | — |
| 35ded988 | 07:10:09.912 | 07:10:22.733 | prepare | complete (API DRY) | — |
| a11db9f6 | 07:12:33.782 | 07:12:35.596 | closingBrowsers | complete (closingBrowsers) | — |
| 5e7f13d3 | 07:12:47.164 | 07:12:49.485 | prepare | aborted (API PREPARE) | AUTOMATION ABORTED — USER CONTROL RESTORED |
| b2523347 | 07:12:54.993 | 07:12:55.818 | blockAudit | complete (blockAudit) | 2026-09-27 · Open 0 · Blocked 5 · Unreleased 107 · Unknown 0. No hold or booking was created. |
| 1e214074 | 07:12:58.826 | 07:13:05.156 | prepare | complete (API DRY) | — |
| 083725e5 | 07:13:09.472 | 07:21:14.024 | full | aborted (API LIVE) | Slot watch stopped for 2026-09-27: 0 reads answered · 0 open → unavailable.  / API run needs attention · USER_ABORT · 483904 ms total · +481460 ms since prior stage / AUTOMATION ABORTED — USER CONTROL RESTORED |
| 2d45c7a3 | 07:21:52.558 | 07:21:54.669 | prepare | failed (API PREPARE) | COMMAND_FAILED |
| 2ef4bd4b | 07:21:56.271 | 07:22:00.827 | prepare | complete (API DRY) | — |
| a388f1f5 | 07:22:04.570 | 07:26:02.873 | full | aborted (API LIVE) | Slot watch stopped for 2026-09-27: 0 reads answered · 0 open → unavailable.  / API run needs attention · USER_ABORT · 237692 ms total · +236081 ms since prior stage / AUTOMATION ABORTED — USER CONTROL RESTORED |
| e0a1ceea | 07:26:08.031 | 07:26:08.675 | blockAudit | complete (blockAudit) | 2026-09-27 · Open 0 · Blocked 5 · Unreleased 107 · Unknown 0. No hold or booking was created. |
| 6e900e49 | 07:26:12.628 | 07:26:13.683 | blockAudit | complete (blockAudit) | 2026-09-27 · Open 0 · Blocked 5 · Unreleased 107 · Unknown 0. No hold or booking was created. |
| 6949d888 | 07:26:23.803 | 07:26:24.558 | blockAudit | complete (blockAudit) | 2026-09-27 · Open 0 · Blocked 5 · Unreleased 107 · Unknown 0. No hold or booking was created. |
| 0a47583a | 07:26:25.063 | 07:26:25.735 | blockAudit | complete (blockAudit) | 2026-09-27 · Open 0 · Blocked 5 · Unreleased 107 · Unknown 0. No hold or booking was created. |
| f6914c16 | 07:26:29.757 | 07:26:30.850 | blockAudit | complete (blockAudit) | 2026-09-28 · Open 0 · Blocked 14 · Unreleased 98 · Unknown 0. No hold or booking was created. |
| 3c730ac2 | 07:26:40.198 | 07:26:40.800 | blockAudit | complete (blockAudit) | 2026-09-27 · Open 0 · Blocked 5 · Unreleased 107 · Unknown 0. No hold or booking was created. |
| f4387a96 | 07:26:49.731 | 07:26:54.589 | prepare | complete (API DRY) | — |
| 7be2ca9d | 07:27:20.682 | 07:27:25.938 | prepare | complete (API DRY) | — |
| 86682dd5 | 07:27:58.142 | 07:28:37.880 | full | aborted (API LIVE) | Slot watch stopped for 2026-09-27: 0 reads answered · 0 open → unavailable.  / API run needs attention · USER_ABORT · 38020 ms total · +36131 ms since prior stage / AUTOMATION ABORTED — USER CONTROL RESTORED |
| 9271f690 | 07:28:44.981 | 07:28:45.763 | blockAudit | complete (blockAudit) | 2026-09-27 · Open 0 · Blocked 5 · Unreleased 107 · Unknown 0. No hold or booking was created. |
| 6f59d9d5 | 07:29:40.430 | 07:29:45.533 | prepare | complete (API DRY) | — |
| 94772f25 | 07:29:50.868 | 08:15:00.100 | full | failed (API LIVE) | API run needs attention · ALL_REJECTED_WAITING_FOR_REOPEN · 2708582 ms total · +1 ms since prior stage / COMMAND_FAILED |
| 7a5f0995 | 08:20:12.092 | 08:20:12.710 | blockAudit | complete (blockAudit) | 2026-09-28 · Open 0 · Blocked 14 · Unreleased 98 · Unknown 0. No hold or booking was created. |
| 7cefc408 | 08:20:19.232 | 08:20:30.928 | closingBrowsers | complete (closingBrowsers) | Closed 7 bot Chrome browsers (7 force-closed after not responding). Your own Chrome windows were not touched. |

### Appendix L — 24 Sep release (target Sat 26 Sep): grid at key moments (older v1 watch, serial reads)

Source: `.local/slot-watch/2026-09-26_d4cc58f6-2624-48fa-a60e-40736380511d.ndjson`. The v1 watch read one grid at a time; two reads at +6.3 s and +11.3 s timed out at 5 s. Offsets are release-relative, taken at the response.

**+15.744 s** (latency 4451 ms) · open 55
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  X  X  X  X  X  O  O  O  O  O
  C2   O  O  O  O  O  O  O  O  X  X  X  O  O  O  O  O
  C3   X  X  X  X  X  X  X  X  X  X  X  X  O  O  O  O
  C4   X  X  X  X  X  X  X  X  X  X  X  X  O  O  O  O
  C5   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  O
  C6   O  O  O  O  O  O  O  O  X  X  X  X  X  X  X  O
  C7   O  O  O  O  O  O  O  O  O  O  X  X  X  O  O  O
```

**+29.489 s** (latency 3710 ms) · open 21
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  X  X  X  X  X  X  X  X  O  X  X
  C2   O  O  O  O  O  X  X  X  X  X  X  X  X  X  X  X
  C3   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  X
  C4   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  X
  C5   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  X
  C6   O  O  O  O  O  X  X  X  X  X  X  X  X  X  X  X
  C7   O  O  O  O  O  X  X  X  X  X  X  X  X  X  X  X
```

**+60.370 s** (latency 368 ms) · open 14 · booking records 52
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  X  X  X  O  X  X  X  X  X  X  X  X  X  X  X
  C2   O  X  X  X  O  X  X  X  X  X  X  X  X  X  X  X
  C3   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  X
  C4   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  X
  C5   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  X
  C6   O  O  O  O  O  X  X  X  X  X  X  X  X  X  X  X
  C7   O  O  O  O  O  X  X  X  X  X  X  X  X  X  X  X
```

**+90.452 s** (latency 452 ms) · open 11
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  X  X  X  O  X  X  X  X  X  X  X  X  X  X  X
  C2   O  X  X  X  O  X  X  X  X  X  X  X  X  X  X  X
  C3   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  X
  C4   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  X
  C5   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  X
  C6   O  O  O  O  O  X  X  X  X  X  X  X  X  X  X  X
  C7   O  X  X  X  O  X  X  X  X  X  X  X  X  X  X  X
```

**+450.196 s** (latency 184 ms) · open 8
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  X  X  X  O  X  X  X  X  X  X  X  X  X  X  X
  C2   O  X  X  X  O  X  X  X  X  X  X  X  X  X  X  X
  C3   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  X
  C4   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  X
  C5   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  X
  C6   X  X  X  O  O  X  X  X  X  X  X  X  X  X  X  X
  C7   O  X  X  X  O  X  X  X  X  X  X  X  X  X  X  X
```

**+600.422 s** (latency 411 ms) · open 7 · booking records 59
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  X  X  X  O  X  X  X  X  X  X  X  X  X  X  X
  C2   O  X  X  X  O  X  X  X  X  X  X  X  X  X  X  X
  C3   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  X
  C4   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  X
  C5   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  X
  C6   X  X  X  O  O  X  X  X  X  X  X  X  X  X  X  X
  C7   O  X  X  X  X  X  X  X  X  X  X  X  X  X  X  X
```

**+630.479 s** (latency 472 ms) · open 17
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  X  X  X  O  X  X  X  X  X  X  X  X  O  X  O
  C2   O  X  X  X  O  X  O  X  X  X  X  X  X  X  X  X
  C3   X  X  X  X  X  X  X  X  X  X  X  X  O  X  X  X
  C4   X  X  X  X  X  X  X  X  X  X  X  X  O  O  X  X
  C5   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  X
  C6   X  X  X  O  O  O  X  X  X  X  X  X  X  X  X  O
  C7   O  X  X  X  X  X  O  X  X  O  X  X  X  X  X  X
```

**+690.418 s** (latency 406 ms) · open 20
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  X  X  X  O  X  X  X  X  X  X  X  X  O  X  O
  C2   O  X  X  X  O  X  O  X  X  X  X  X  X  X  X  X
  C3   X  X  X  X  X  X  X  X  X  X  X  X  O  X  X  X
  C4   X  X  X  X  X  X  X  X  X  X  X  X  O  O  X  X
  C5   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  X
  C6   X  X  X  O  O  O  X  X  X  X  X  X  X  X  X  O
  C7   O  O  O  O  X  X  O  X  X  O  X  X  X  X  X  X
```

**+720.497 s** (latency 483 ms) · open 18
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  X  X  X  O  X  X  X  X  X  X  X  X  O  X  O
  C2   O  X  X  X  O  X  O  X  X  X  X  X  X  X  X  X
  C3   X  X  X  X  X  X  X  X  X  X  X  X  O  X  X  X
  C4   X  X  X  X  X  X  X  X  X  X  X  X  O  O  X  X
  C5   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  X
  C6   X  X  X  O  X  X  X  X  X  X  X  X  X  X  X  O
  C7   O  O  O  O  X  X  O  X  X  O  X  X  X  X  X  X
```

**+840.179 s** (latency 170 ms) · open 15
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  X  X  X  O  X  X  X  X  X  X  X  X  O  X  O
  C2   O  X  X  X  O  X  O  X  X  X  X  X  X  X  X  X
  C3   X  X  X  X  X  X  X  X  X  X  X  X  O  X  X  X
  C4   X  X  X  X  X  X  X  X  X  X  X  X  O  O  X  X
  C5   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  X
  C6   X  X  X  O  X  X  X  X  X  X  X  X  X  X  X  O
  C7   O  X  X  X  X  X  O  X  X  O  X  X  X  X  X  X
```

**+900.482 s** (latency 468 ms) · open 15 · booking records 53
```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  X  X  X  O  X  X  X  X  X  X  X  X  O  X  O
  C2   O  X  X  X  O  X  O  X  X  X  X  X  X  X  X  X
  C3   X  X  X  X  X  X  X  X  X  X  X  X  O  X  X  X
  C4   X  X  X  X  X  X  X  X  X  X  X  X  O  O  X  X
  C5   X  X  X  X  X  X  X  X  X  X  X  X  X  X  X  X
  C6   X  X  X  O  X  X  X  X  X  X  X  X  X  X  X  O
  C7   O  X  X  X  X  X  O  X  X  O  X  X  X  X  X  X
```


### Appendix M — Public snapshots after the run (read-only)

**08:24:15 Manila** (booking records only; CO confirmed, PE pending, . none):
```
       08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1    . CO CO CO  .  . PE CO CO CO PE PE PE  .  .  .
  C2    . CO CO CO  .  . PE PE CO CO PE PE PE  .  .  .
  C3    . CO CO CO  . PE  .  . CO CO PE PE PE PE  .  .
  C4    . CO CO CO  . CO CO CO CO CO CO CO CO CO  .  .
  C5    . CO CO CO  . CO CO CO CO CO CO CO CO CO  .  .
  C6   CO CO CO CO PE PE  .  . CO CO CO PE PE PE  .  .
  C7   CO CO CO CO  .  . PE  . CO CO CO PE PE PE  .  .
```
54 confirmed · 23 pending.

**08:33:25.204 Manila · 2026-09-27** · released true · {"open":31,"unavailable":81,"records":81,"confirmed":57,"pending":24,"unavailableNoRecord":0} (first letter availability O/X/?; then record status CO/PE/..):
```
      08  09  10  11  12  13  14  15  16  17  18  19  20  21  22  23  
  C1  O.. XCO XCO XCO O.. O.. XPE XCO XCO XCO XPE XPE XPE XPE XPE XPE
  C2  O.. XCO XCO XCO O.. O.. XPE O.. XCO XCO XPE XPE XPE XPE XPE XPE
  C3  O.. XCO XCO XCO O.. XPE O.. O.. XCO XCO XPE XPE XPE XPE O.. O..
  C4  O.. XCO XCO XCO O.. XCO XCO XCO XCO XCO XCO XCO XCO XCO O.. O..
  C5  O.. XCO XCO XCO O.. XCO XCO XCO XCO XCO XCO XCO XCO XCO O.. O..
  C6  XCO XCO XCO XCO XPE XPE O.. O.. XCO XCO XCO XCO XCO XCO O.. O..
  C7  XCO XCO XCO XCO O.. O.. XPE O.. XCO XCO XCO XPE XPE O.. O.. O..
```

**08:33:25.204 Manila · 2026-09-28** · released false · {"open":0,"unavailable":0,"records":14,"confirmed":14,"pending":0,"unavailableNoRecord":0} (first letter availability O/X/?; then record status CO/PE/..):
```
      08  09  10  11  12  13  14  15  16  17  18  19  20  21  22  23  
  C1  ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?..
  C2  ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?CO ?CO ?CO ?..
  C3  ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?CO ?CO ?CO ?..
  C4  ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?..
  C5  ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?..
  C6  ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?CO ?CO ?CO ?CO ?.. ?..
  C7  ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?.. ?CO ?CO ?CO ?CO ?.. ?..
```


### Appendix N — App-generated reports, verbatim (paths shortened)

**Release forensics report** (`.local/release-forensics/fc62669a-bfe5-4726-998a-fa0616bd1e19/report.txt`, sections 1–9 as generated at 08:15:00):
```
RELEASE FORENSICS — run fc62669a-bfe5-4726-998a-fa0616bd1e19 · target 2026-09-27 · mode live
Status: FINAL · generated 2026-09-25T00:15:00.703Z
All offsets are relative to the release instant (2026-09-25T00:00:00.000Z).

1. RELEASE CLOCK
  T-10M  offset +20.0 ms · 10 samples · RTT 43 ms · spread 12.7 ms · ±21.5 ms · used
  T-60S  offset +24.3 ms · 10 samples · RTT 44 ms · spread 10.4 ms · ±22.3 ms · used
  T-30S  offset +23.3 ms · 10 samples · RTT 44 ms · spread 4.2 ms · ±24.2 ms · used
  Observer (Slot Watch) offset at release: 19.6 ms · observer − dispatch -3.7 ms

2. POST INITIATION (browser request event)
  Worker A  +0.010 s
  Worker B  +0.011 s
  Worker C  +0.011 s
  Worker D  +0.011 s
  Worker F  +0.011 s
  Worker E  +0.012 s
  Worker G  +0.012 s
  First +0.010 s · last +0.012 s · spread 1.9 ms

3. FIRST PUBLISHED GRID (Slot Watch)
  Reads: 136 scheduled · 127 answered · 0 failed · 9 not launched · max in flight 6 · early launches +0.000 s, +0.250 s, +0.500 s, +1.000 s, +2.000 s, +5.000 s
  Last read without the date:  #7 request −1.987 s → response −1.779 s
  First read with the date:    #8 request +0.016 s → response +4.142 s · edge cache MISS, age 0 s
  Open 107 · unavailable 5 · unknown 0
         08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23   (O open, X unavailable, ? unknown)
    C1    O  O  O  O  O  O  O  O  O  O  O  O  O  O  O  O
    C2    O  O  O  O  O  O  O  O  O  O  O  O  O  O  O  O
    C3    O  O  O  O  O  O  O  O  X  X  O  O  O  O  O  O
    C4    O  O  O  O  O  O  O  O  X  X  X  O  O  O  O  O
    C5    O  O  O  O  O  O  O  O  O  O  O  O  O  O  O  O
    C6    O  O  O  O  O  O  O  O  O  O  O  O  O  O  O  O
    C7    O  O  O  O  O  O  O  O  O  O  O  O  O  O  O  O

4. TARGETS
  Phase 3 race 1f3c07462cc0e2d2d4ce3faf9a8d3c93b55e38739c151d458e2e0e5d32737c94 · 11 authorized candidates · Wave 2 max 0 · Rescue max 0 · total max 7
  WAVE_1 · Worker A · Court 7 19:00–22:00 · candidate 21f81fe8d04d861fce8c839ab5d757e58e0b5da5ff83d9585a68bd5d54b9a066 · attempt core-A-official-1
    Observation #pre-release assignment · POST +0.010 s · REJECTED · HTTP 409
    Passive trace available · response fallback HTTP 409, server Vercel, request —
  WAVE_1 · Worker B · Court 6 19:00–22:00 · candidate 6ff22c70f69e41ba9c6bb76bc8b4fade7f8422c8194513ac4adcfe30970aafed · attempt core-B-official-2
    Observation #pre-release assignment · POST +0.011 s · REJECTED · HTTP 409
    Passive trace available · response fallback HTTP 409, server Vercel, request —
  WAVE_1 · Worker C · Court 5 19:00–22:00 · candidate 5186cf932de0142132a9ad9e5a9d5cb0a2ff7e63c98caad9d6a56811f224dbdf · attempt core-C-official-3
    Observation #pre-release assignment · POST +0.011 s · REJECTED · HTTP 409
    Passive trace available · response fallback HTTP 409, server Vercel, request —
  WAVE_1 · Worker D · Court 4 19:00–22:00 · candidate eff27bfc9a73d9bc47117c7b970661955ba1f6fb416963def41aea4851ab27d0 · attempt core-D-official-4
    Observation #pre-release assignment · POST +0.011 s · REJECTED · HTTP 409
    Passive trace available · response fallback HTTP 409, server Vercel, request —
  WAVE_1 · Worker F · Court 2 15:00–18:00 · candidate e9b14c0cdb821e41157f2b57a3386482846ef17b5819da9206ab9f9b31dc7287 · attempt core-F-official-6
    Observation #pre-release assignment · POST +0.011 s · REJECTED · HTTP 409
    Passive trace available · response fallback HTTP 409, server Vercel, request —
  WAVE_1 · Worker E · Court 3 19:00–22:00 · candidate 8bcb34195d35e7ffe098670f7edf3778d0763221c325566cff5aedf4971b4c00 · attempt core-E-official-5
    Observation #pre-release assignment · POST +0.012 s · REJECTED · HTTP 409
    Passive trace available · response fallback HTTP 409, server Vercel, request —
  WAVE_1 · Worker G · Court 1 15:00–18:00 · candidate 36414a6a2b84eed2a9b7ce4d3358cdb3b269d5444e1d31c2863c61e12f51fb10 · attempt core-G-official-7
    Observation #pre-release assignment · POST +0.012 s · REJECTED · HTTP 409
    Passive trace available · response fallback HTTP 409, server Vercel, request —

  Worker A · Court 7 · 19:00–22:00 · core-A-official-1
    POST initiated:              +0.010 s
    First published state:       FULLY OPEN (19:00 open PHP 700, 20:00 open PHP 700, 21:00 open PHP 700)
      from read                  #8 request +0.016 s → response +4.142 s
      That read was requested 0.006 s after this POST; the grid at POST time was not observed.
    First fully-open read:       #8 request +0.016 s → response +4.142 s
    First unavailable read:      #12 request +2.012 s → response +17.000 s (19:00)
    Public booking record:       #b3 request +30.008 s → response +33.712 s (19:00, 20:00, 21:00)
    Reopened (fully open again): none observed
    Checkout:                    HTTP 409 · hint availability
    Response recorded by runner: +34.620 s (network duration 34,618 ms)
    Response headers:            +34.620 s
    Body complete:               +34.620 s
    Protocol / connection:       h2 · reused yes · dns — · connect — · tls — · send 0.3 ms · wait 34,609.3 ms
    Provider IDs:                x-vercel-id sin1::sin1::p8z7w-1790294400030-a73f748bcd1f · x-request-id — · cf-ray —
    Server / cache / timing:     Vercel · x-vercel-cache MISS · server-timing —

  Worker B · Court 6 · 19:00–22:00 · core-B-official-2
    POST initiated:              +0.011 s
    First published state:       FULLY OPEN (19:00 open PHP 700, 20:00 open PHP 700, 21:00 open PHP 700)
      from read                  #8 request +0.016 s → response +4.142 s
      That read was requested 0.005 s after this POST; the grid at POST time was not observed.
    First fully-open read:       #8 request +0.016 s → response +4.142 s
    First unavailable read:      #20 request +19.005 s → response +28.868 s (20:00)
    Public booking record:       #b3 request +30.008 s → response +33.712 s (19:00, 20:00, 21:00)
    Reopened (fully open again): #22 request +21.005 s → response +21.105 s after #21 request +20.001 s → response +28.923 s (reads overlapped)
    Checkout:                    HTTP 409 · hint availability
    Response recorded by runner: +29.558 s (network duration 29,557 ms)
    Response headers:            +29.559 s
    Body complete:               +29.560 s
    Protocol / connection:       h2 · reused yes · dns — · connect — · tls — · send 0.2 ms · wait 29,547.7 ms
    Provider IDs:                x-vercel-id sin1::sin1::9tkzx-1790294400031-dd767626ebff · x-request-id — · cf-ray —
    Server / cache / timing:     Vercel · x-vercel-cache MISS · server-timing —

  Worker C · Court 5 · 19:00–22:00 · core-C-official-3
    POST initiated:              +0.011 s
    First published state:       FULLY OPEN (19:00 open PHP 700, 20:00 open PHP 700, 21:00 open PHP 700)
      from read                  #8 request +0.016 s → response +4.142 s
      That read was requested 0.005 s after this POST; the grid at POST time was not observed.
    First fully-open read:       #8 request +0.016 s → response +4.142 s
    First unavailable read:      #20 request +19.005 s → response +28.868 s (19:00, 20:00, 21:00)
    Public booking record:       #b3 request +30.008 s → response +33.712 s (19:00, 20:00, 21:00)
    Reopened (fully open again): #22 request +21.005 s → response +21.105 s after #21 request +20.001 s → response +28.923 s (reads overlapped)
    Checkout:                    HTTP 409 · hint availability
    Response recorded by runner: +29.825 s (network duration 29,822 ms)
    Response headers:            +29.821 s
    Body complete:               +29.822 s
    Protocol / connection:       h2 · reused yes · dns — · connect — · tls — · send 0.2 ms · wait 29,809.9 ms
    Provider IDs:                x-vercel-id sin1::sin1::rlfmg-1790294400032-46c4b8097878 · x-request-id — · cf-ray —
    Server / cache / timing:     Vercel · x-vercel-cache MISS · server-timing —

  Worker D · Court 4 · 19:00–22:00 · core-D-official-4
    POST initiated:              +0.011 s
    First published state:       FULLY OPEN (19:00 open PHP 700, 20:00 open PHP 700, 21:00 open PHP 700)
      from read                  #8 request +0.016 s → response +4.142 s
      That read was requested 0.005 s after this POST; the grid at POST time was not observed.
    First fully-open read:       #8 request +0.016 s → response +4.142 s
    First unavailable read:      #12 request +2.012 s → response +17.000 s (21:00)
    Public booking record:       #b3 request +30.008 s → response +33.712 s (19:00, 20:00, 21:00)
    Reopened (fully open again): none observed
    Checkout:                    HTTP 409 · hint availability
    Response recorded by runner: +29.110 s (network duration 29,107 ms)
    Response headers:            +29.110 s
    Body complete:               +29.110 s
    Protocol / connection:       h2 · reused yes · dns — · connect — · tls — · send 0.2 ms · wait 29,098.2 ms
    Provider IDs:                x-vercel-id sin1::sin1::rss2s-1790294400031-ad67912a9919 · x-request-id — · cf-ray —
    Server / cache / timing:     Vercel · x-vercel-cache MISS · server-timing —

  Worker E · Court 3 · 19:00–22:00 · core-E-official-5
    POST initiated:              +0.012 s
    First published state:       FULLY OPEN (19:00 open PHP 700, 20:00 open PHP 700, 21:00 open PHP 700)
      from read                  #8 request +0.016 s → response +4.142 s
      That read was requested 0.004 s after this POST; the grid at POST time was not observed.
    First fully-open read:       #8 request +0.016 s → response +4.142 s
    First unavailable read:      #15 request +10.014 s → response +18.920 s (20:00)
    Public booking record:       #b3 request +30.008 s → response +33.712 s (19:00, 20:00, 21:00)
    Reopened (fully open again): #16 request +11.012 s → response +17.770 s after #15 request +10.014 s → response +18.920 s (reads overlapped)
    Checkout:                    HTTP 409 · hint availability
    Response recorded by runner: +32.176 s (network duration 32,173 ms)
    Response headers:            +32.177 s
    Body complete:               +32.177 s
    Protocol / connection:       h2 · reused yes · dns — · connect — · tls — · send 0.2 ms · wait 32,164.9 ms
    Provider IDs:                x-vercel-id sin1::sin1::gqthg-1790294400032-bcbd8236050a · x-request-id — · cf-ray —
    Server / cache / timing:     Vercel · x-vercel-cache MISS · server-timing —

  Worker F · Court 2 · 15:00–18:00 · core-F-official-6
    POST initiated:              +0.011 s
    First published state:       FULLY OPEN (15:00 open PHP 700, 16:00 open PHP 700, 17:00 open PHP 700)
      from read                  #8 request +0.016 s → response +4.142 s
      That read was requested 0.005 s after this POST; the grid at POST time was not observed.
    First fully-open read:       #8 request +0.016 s → response +4.142 s
    First unavailable read:      #12 request +2.012 s → response +17.000 s (16:00)
    Public booking record:       #b3 request +30.008 s → response +33.712 s (15:00, 16:00, 17:00)
    Reopened (fully open again): none observed
    Checkout:                    HTTP 409 · hint availability
    Response recorded by runner: +33.858 s (network duration 33,855 ms)
    Response headers:            +33.858 s
    Body complete:               +33.859 s
    Protocol / connection:       h2 · reused yes · dns — · connect — · tls — · send 0.2 ms · wait 33,847.1 ms
    Provider IDs:                x-vercel-id sin1::sin1::m5p5p-1790294400038-eda31da31ebb · x-request-id — · cf-ray —
    Server / cache / timing:     Vercel · x-vercel-cache MISS · server-timing —

  Worker G · Court 1 · 15:00–18:00 · core-G-official-7
    POST initiated:              +0.012 s
    First published state:       FULLY OPEN (15:00 open PHP 700, 16:00 open PHP 700, 17:00 open PHP 700)
      from read                  #8 request +0.016 s → response +4.142 s
      That read was requested 0.004 s after this POST; the grid at POST time was not observed.
    First fully-open read:       #8 request +0.016 s → response +4.142 s
    First unavailable read:      #15 request +10.014 s → response +18.920 s (15:00)
    Public booking record:       #b3 request +30.008 s → response +33.712 s (15:00, 16:00, 17:00)
    Reopened (fully open again): #16 request +11.012 s → response +17.770 s after #15 request +10.014 s → response +18.920 s (reads overlapped)
    Checkout:                    HTTP 409 · hint availability
    Response recorded by runner: +32.977 s (network duration 32,973 ms)
    Response headers:            +32.978 s
    Body complete:               +32.978 s
    Protocol / connection:       h2 · reused yes · dns — · connect — · tls — · send 0.1 ms · wait 32,965.8 ms
    Provider IDs:                x-vercel-id sin1::sin1::lp9st-1790294400034-2e1077ff7233 · x-request-id — · cf-ray —
    Server / cache / timing:     Vercel · x-vercel-cache MISS · server-timing —

5. AVAILABILITY TRANSITIONS
  OPEN → unavailable (cells): 95 · unavailable → OPEN (cells): 79. Per-cell read pairs are in the Slot Watch report and summary.

6. PUBLIC BOOKING EVIDENCE
  8 public booking reads answered · 0 failed · 0 failed court queries
  Unavailable in the first published grid without any matching public booking record during the watch: 0 cells (cause unknown).

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
  - The observer and the dispatch clocks differ by -3.7 ms (observer minus dispatch); comparisons between grid reads and POST times carry that difference.

SOURCES
  Runner trace:   <install>\.local\api-booking\run-progress\fc62669a-bfe5-4726-998a-fa0616bd1e19.ndjson
  Slot Watch log: <install>\.local\slot-watch\2026-09-27_60d68777-0022-471a-99aa-3a47543858f4.ndjson
  Provider trace: <install>\.local\release-forensics\fc62669a-bfe5-4726-998a-fa0616bd1e19\provider-trace.ndjson
```

**Slot Watch report** (`.local/slot-watch/2026-09-27_60d68777-0022-471a-99aa-3a47543858f4.txt`):
```
RELEASE SLOT WATCH — target 2026-09-27
Release: 2026-09-25 08:00:00.000 Manila · observer network clock synchronized (offset 19.6 ms)
Watch finished: window complete
Availability reads: 127 launched · 127 answered · 0 failed · 0 cancelled · 9 not launched (cap or late) · max 6 in flight (cap 6) · median 241 ms
Early launches (release-relative): +0.000 s, +0.250 s, +0.500 s, +1.000 s, +2.000 s, +5.000 s; overlapping reads allowed
Public booking reads: 8 launched · 8 answered · 0 failed · 0 failed court queries · 1 not launched

Each read shows Onda's state at an unknown moment between its request and its response. Changes are listed between two reads in request order.

FIRST PUBLISHED GRID
  Last read without the date:   #7 request −1.987 s → response −1.779 s
  First read with the date:     #8 request +0.016 s → response +4.142 s · edge cache MISS, age 0 s
  Open 107 · unavailable 5 · unknown 0
  (O open, X unavailable, U not published, ? unknown)
       08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1    O  O  O  O  O  O  O  O  O  O  O  O  O  O  O  O
  C2    O  O  O  O  O  O  O  O  O  O  O  O  O  O  O  O
  C3    O  O  O  O  O  O  O  O  X  X  O  O  O  O  O  O
  C4    O  O  O  O  O  O  O  O  X  X  X  O  O  O  O  O
  C5    O  O  O  O  O  O  O  O  O  O  O  O  O  O  O  O
  C6    O  O  O  O  O  O  O  O  O  O  O  O  O  O  O  O
  C7    O  O  O  O  O  O  O  O  O  O  O  O  O  O  O  O

OPEN → UNAVAILABLE (first change per cell)
  Court 2 2 PM  open in #11 request +1.008 s → response +9.049 s; unavailable in #12 request +2.012 s → response +17.000 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 2 4 PM  open in #11 request +1.008 s → response +9.049 s; unavailable in #12 request +2.012 s → response +17.000 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 4 12 PM open in #11 request +1.008 s → response +9.049 s; unavailable in #12 request +2.012 s → response +17.000 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 4 9 PM  open in #11 request +1.008 s → response +9.049 s; unavailable in #12 request +2.012 s → response +17.000 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 7 7 PM  open in #11 request +1.008 s → response +9.049 s; unavailable in #12 request +2.012 s → response +17.000 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 1 3 PM  open in #14 request +6.002 s → response +17.779 s; unavailable in #15 request +10.014 s → response +18.920 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 1 7 PM  open in #14 request +6.002 s → response +17.779 s; unavailable in #15 request +10.014 s → response +18.920 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 3 12 PM open in #14 request +6.002 s → response +17.779 s; unavailable in #15 request +10.014 s → response +18.920 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 3 2 PM  open in #14 request +6.002 s → response +17.779 s; unavailable in #15 request +10.014 s → response +18.920 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 3 8 PM  open in #14 request +6.002 s → response +17.779 s; unavailable in #15 request +10.014 s → response +18.920 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 4 8 PM  open in #14 request +6.002 s → response +17.779 s; unavailable in #15 request +10.014 s → response +18.920 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 5 12 PM open in #14 request +6.002 s → response +17.779 s; unavailable in #15 request +10.014 s → response +18.920 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 5 2 PM  open in #14 request +6.002 s → response +17.779 s; unavailable in #15 request +10.014 s → response +18.920 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 6 5 PM  open in #14 request +6.002 s → response +17.779 s; unavailable in #15 request +10.014 s → response +18.920 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 1 4 PM  open in #16 request +11.012 s → response +17.770 s; unavailable in #17 request +12.014 s → response +17.929 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 1 5 PM  open in #16 request +11.012 s → response +17.770 s; unavailable in #17 request +12.014 s → response +17.929 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 2 3 PM  open in #16 request +11.012 s → response +17.770 s; unavailable in #17 request +12.014 s → response +17.929 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 2 7 PM  open in #16 request +11.012 s → response +17.770 s; unavailable in #17 request +12.014 s → response +17.929 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 2 9 PM  open in #16 request +11.012 s → response +17.770 s; unavailable in #17 request +12.014 s → response +17.929 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 4 2 PM  open in #16 request +11.012 s → response +17.770 s; unavailable in #17 request +12.014 s → response +17.929 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 4 3 PM  open in #16 request +11.012 s → response +17.770 s; unavailable in #17 request +12.014 s → response +17.929 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 6 4 PM  open in #16 request +11.012 s → response +17.770 s; unavailable in #17 request +12.014 s → response +17.929 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 1 12 PM open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 1 1 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 1 2 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 1 6 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 1 8 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 1 10 PM open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 2 12 PM open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 2 1 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 2 6 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 2 8 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 2 10 PM open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 3 1 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 3 3 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 3 6 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 3 7 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 3 9 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 4 1 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 4 7 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 4 10 PM open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 5 1 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 5 3 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 5 4 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 5 5 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 5 6 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 5 7 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 5 8 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 5 9 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 5 10 PM open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 6 12 PM open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 6 1 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 6 3 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 6 6 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 6 8 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 6 10 PM open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 7 1 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 7 2 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 7 5 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 7 8 PM  open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 7 10 PM open in #19 request +18.002 s → response +18.072 s; unavailable in #20 request +19.005 s → response +28.868 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 1 9 PM  open in #24 request +23.015 s → response +28.879 s; unavailable in #25 request +24.011 s → response +28.974 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 6 7 PM  open in #24 request +23.015 s → response +28.879 s; unavailable in #25 request +24.011 s → response +28.974 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 7 4 PM  open in #24 request +23.015 s → response +28.879 s; unavailable in #25 request +24.011 s → response +28.974 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 7 9 PM  open in #24 request +23.015 s → response +28.879 s; unavailable in #25 request +24.011 s → response +28.974 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 2 5 PM  open in #28 request +29.003 s → response +29.158 s; unavailable in #29 request +30.007 s → response +32.847 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 3 10 PM open in #28 request +29.003 s → response +29.158 s; unavailable in #29 request +30.007 s → response +32.847 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 6 2 PM  open in #28 request +29.003 s → response +29.158 s; unavailable in #29 request +30.007 s → response +32.847 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 6 9 PM  open in #28 request +29.003 s → response +29.158 s; unavailable in #29 request +30.007 s → response +32.847 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 7 3 PM  open in #28 request +29.003 s → response +29.158 s; unavailable in #29 request +30.007 s → response +32.847 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 7 6 PM  open in #28 request +29.003 s → response +29.158 s; unavailable in #29 request +30.007 s → response +32.847 s · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 7 12 PM open in #29 request +30.007 s → response +32.847 s; unavailable in #30 request +31.006 s → response +32.893 s (reads overlapped: their provider-side order is not established) · public booking record first seen #b3 request +30.008 s → response +33.712 s
  Court 7 8 AM  open in #45 request +46.016 s → response +46.086 s; unavailable in #46 request +47.012 s → response +47.325 s · public booking record first seen #b4 request +60.004 s → response +60.234 s
  Court 7 9 AM  open in #45 request +46.016 s → response +46.086 s; unavailable in #46 request +47.012 s → response +47.325 s · public booking record first seen #b4 request +60.004 s → response +60.234 s
  Court 7 10 AM open in #45 request +46.016 s → response +46.086 s; unavailable in #46 request +47.012 s → response +47.325 s · public booking record first seen #b4 request +60.004 s → response +60.234 s
  Court 4 9 AM  open in #52 request +53.001 s → response +53.092 s; unavailable in #53 request +54.014 s → response +54.325 s · public booking record first seen #b4 request +60.004 s → response +60.234 s
  Court 4 10 AM open in #52 request +53.001 s → response +53.092 s; unavailable in #53 request +54.014 s → response +54.325 s · public booking record first seen #b4 request +60.004 s → response +60.234 s
  Court 4 11 AM open in #52 request +53.001 s → response +53.092 s; unavailable in #53 request +54.014 s → response +54.325 s · public booking record first seen #b4 request +60.004 s → response +60.234 s
  Court 5 9 AM  open in #52 request +53.001 s → response +53.092 s; unavailable in #53 request +54.014 s → response +54.325 s · public booking record first seen #b4 request +60.004 s → response +60.234 s
  Court 5 10 AM open in #52 request +53.001 s → response +53.092 s; unavailable in #53 request +54.014 s → response +54.325 s · public booking record first seen #b4 request +60.004 s → response +60.234 s
  Court 5 11 AM open in #52 request +53.001 s → response +53.092 s; unavailable in #53 request +54.014 s → response +54.325 s · public booking record first seen #b4 request +60.004 s → response +60.234 s
  Court 6 8 AM  open in #61 request +70.003 s → response +70.231 s; unavailable in #62 request +75.009 s → response +75.212 s · public booking record first seen #b5 request +120.005 s → response +120.297 s
  Court 6 9 AM  open in #61 request +70.003 s → response +70.231 s; unavailable in #62 request +75.009 s → response +75.212 s · public booking record first seen #b5 request +120.005 s → response +120.297 s
  Court 6 10 AM open in #61 request +70.003 s → response +70.231 s; unavailable in #62 request +75.009 s → response +75.212 s · public booking record first seen #b5 request +120.005 s → response +120.297 s
  Court 3 9 AM  open in #64 request +85.012 s → response +85.242 s; unavailable in #65 request +90.014 s → response +90.324 s · public booking record first seen #b5 request +120.005 s → response +120.297 s
  Court 3 10 AM open in #64 request +85.012 s → response +85.242 s; unavailable in #65 request +90.014 s → response +90.324 s · public booking record first seen #b5 request +120.005 s → response +120.297 s
  Court 3 11 AM open in #64 request +85.012 s → response +85.242 s; unavailable in #65 request +90.014 s → response +90.324 s · public booking record first seen #b5 request +120.005 s → response +120.297 s
  Court 1 9 AM  open in #69 request +110.011 s → response +110.227 s; unavailable in #70 request +115.015 s → response +116.223 s · public booking record first seen #b5 request +120.005 s → response +120.297 s
  Court 1 10 AM open in #69 request +110.011 s → response +110.227 s; unavailable in #70 request +115.015 s → response +116.223 s · public booking record first seen #b5 request +120.005 s → response +120.297 s
  Court 1 11 AM open in #69 request +110.011 s → response +110.227 s; unavailable in #70 request +115.015 s → response +116.223 s · public booking record first seen #b5 request +120.005 s → response +120.297 s
  Court 2 9 AM  open in #69 request +110.011 s → response +110.227 s; unavailable in #70 request +115.015 s → response +116.223 s · public booking record first seen #b5 request +120.005 s → response +120.297 s
  Court 2 10 AM open in #69 request +110.011 s → response +110.227 s; unavailable in #70 request +115.015 s → response +116.223 s · public booking record first seen #b5 request +120.005 s → response +120.297 s
  Court 2 11 AM open in #69 request +110.011 s → response +110.227 s; unavailable in #70 request +115.015 s → response +116.223 s · public booking record first seen #b5 request +120.005 s → response +120.297 s
  Court 6 11 AM open in #80 request +165.003 s → response +165.181 s; unavailable in #81 request +170.009 s → response +170.196 s · public booking record first seen #b6 request +300.010 s → response +300.304 s
  Court 7 11 AM open in #80 request +165.003 s → response +165.181 s; unavailable in #81 request +170.009 s → response +170.196 s · public booking record first seen #b6 request +300.010 s → response +300.304 s

UNAVAILABLE IN THE FIRST PUBLISHED GRID
  Court 3: 4 PM (public booking record, first seen −59.746 s), 5 PM (public booking record, first seen −59.746 s)
  Court 4: 4 PM (public booking record, first seen −59.746 s), 5 PM (public booking record, first seen −59.746 s), 6 PM (public booking record, first seen −59.746 s)

UNAVAILABLE → OPEN (reopened; cause unknown)
  Court 1 3 PM  unavailable in #15 request +10.014 s → response +18.920 s; open in #16 request +11.012 s → response +17.770 s (reads overlapped)
  Court 1 7 PM  unavailable in #15 request +10.014 s → response +18.920 s; open in #16 request +11.012 s → response +17.770 s (reads overlapped)
  Court 3 12 PM unavailable in #15 request +10.014 s → response +18.920 s; open in #16 request +11.012 s → response +17.770 s (reads overlapped)
  Court 3 2 PM  unavailable in #15 request +10.014 s → response +18.920 s; open in #16 request +11.012 s → response +17.770 s (reads overlapped)
  Court 3 8 PM  unavailable in #15 request +10.014 s → response +18.920 s; open in #16 request +11.012 s → response +17.770 s (reads overlapped)
  Court 4 8 PM  unavailable in #15 request +10.014 s → response +18.920 s; open in #16 request +11.012 s → response +17.770 s (reads overlapped)
  Court 5 12 PM unavailable in #15 request +10.014 s → response +18.920 s; open in #16 request +11.012 s → response +17.770 s (reads overlapped)
  Court 5 2 PM  unavailable in #15 request +10.014 s → response +18.920 s; open in #16 request +11.012 s → response +17.770 s (reads overlapped)
  Court 6 5 PM  unavailable in #15 request +10.014 s → response +18.920 s; open in #16 request +11.012 s → response +17.770 s (reads overlapped)
  Court 1 12 PM unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 1 1 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 1 2 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 1 6 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 1 8 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 1 10 PM unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 2 12 PM unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 2 1 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 2 6 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 2 8 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 2 10 PM unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 3 1 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 3 3 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 3 6 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 3 7 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 3 9 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 4 1 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 4 7 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 4 10 PM unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 5 1 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 5 3 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 5 4 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 5 5 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 5 6 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 5 7 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 5 8 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 5 9 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 5 10 PM unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 6 12 PM unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 6 1 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 6 3 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 6 6 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 6 8 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 6 10 PM unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 7 1 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 7 2 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 7 5 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 7 8 PM  unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 7 10 PM unavailable in #21 request +20.001 s → response +28.923 s; open in #22 request +21.005 s → response +21.105 s (reads overlapped)
  Court 1 4 PM  unavailable in #22 request +21.005 s → response +21.105 s; open in #23 request +22.005 s → response +22.088 s
  Court 1 5 PM  unavailable in #22 request +21.005 s → response +21.105 s; open in #23 request +22.005 s → response +22.088 s
  Court 2 3 PM  unavailable in #22 request +21.005 s → response +21.105 s; open in #23 request +22.005 s → response +22.088 s
  Court 2 7 PM  unavailable in #22 request +21.005 s → response +21.105 s; open in #23 request +22.005 s → response +22.088 s
  Court 2 9 PM  unavailable in #22 request +21.005 s → response +21.105 s; open in #23 request +22.005 s → response +22.088 s
  Court 4 2 PM  unavailable in #22 request +21.005 s → response +21.105 s; open in #23 request +22.005 s → response +22.088 s
  Court 4 3 PM  unavailable in #22 request +21.005 s → response +21.105 s; open in #23 request +22.005 s → response +22.088 s
  Court 6 4 PM  unavailable in #22 request +21.005 s → response +21.105 s; open in #23 request +22.005 s → response +22.088 s
  Court 2 5 PM  unavailable in #30 request +31.006 s → response +32.893 s; open in #31 request +32.003 s → response +32.169 s (reads overlapped)
  Court 3 10 PM unavailable in #30 request +31.006 s → response +32.893 s; open in #31 request +32.003 s → response +32.169 s (reads overlapped)
  Court 6 2 PM  unavailable in #30 request +31.006 s → response +32.893 s; open in #31 request +32.003 s → response +32.169 s (reads overlapped)
  Court 6 9 PM  unavailable in #30 request +31.006 s → response +32.893 s; open in #31 request +32.003 s → response +32.169 s (reads overlapped)
  Court 7 12 PM unavailable in #30 request +31.006 s → response +32.893 s; open in #31 request +32.003 s → response +32.169 s (reads overlapped)
  Court 7 3 PM  unavailable in #30 request +31.006 s → response +32.893 s; open in #31 request +32.003 s → response +32.169 s (reads overlapped)
  Court 7 6 PM  unavailable in #30 request +31.006 s → response +32.893 s; open in #31 request +32.003 s → response +32.169 s (reads overlapped)
  Court 1 9 PM  unavailable in #33 request +34.005 s → response +34.090 s; open in #34 request +35.004 s → response +35.100 s
  Court 6 7 PM  unavailable in #33 request +34.005 s → response +34.090 s; open in #34 request +35.004 s → response +35.100 s
  Court 7 4 PM  unavailable in #33 request +34.005 s → response +34.090 s; open in #34 request +35.004 s → response +35.100 s
  Court 7 9 PM  unavailable in #33 request +34.005 s → response +34.090 s; open in #34 request +35.004 s → response +35.100 s
  Court 7 8 AM  unavailable in #46 request +47.012 s → response +47.325 s; open in #47 request +48.015 s → response +48.096 s
  Court 7 9 AM  unavailable in #46 request +47.012 s → response +47.325 s; open in #47 request +48.015 s → response +48.096 s
  Court 7 10 AM unavailable in #46 request +47.012 s → response +47.325 s; open in #47 request +48.015 s → response +48.096 s
  Court 4 9 AM  unavailable in #57 request +58.004 s → response +58.079 s; open in #58 request +59.003 s → response +59.089 s
  Court 4 10 AM unavailable in #57 request +58.004 s → response +58.079 s; open in #58 request +59.003 s → response +59.089 s
  Court 4 11 AM unavailable in #57 request +58.004 s → response +58.079 s; open in #58 request +59.003 s → response +59.089 s
  Court 5 9 AM  unavailable in #57 request +58.004 s → response +58.079 s; open in #58 request +59.003 s → response +59.089 s
  Court 5 10 AM unavailable in #57 request +58.004 s → response +58.079 s; open in #58 request +59.003 s → response +59.089 s
  Court 5 11 AM unavailable in #57 request +58.004 s → response +58.079 s; open in #58 request +59.003 s → response +59.089 s
  Court 2 2 PM  unavailable in #117 request +600.009 s → response +600.453 s; open in #118 request +630.006 s → response +630.409 s
  Court 2 4 PM  unavailable in #117 request +600.009 s → response +600.453 s; open in #118 request +630.006 s → response +630.409 s
  Court 4 12 PM unavailable in #117 request +600.009 s → response +600.453 s; open in #118 request +630.006 s → response +630.409 s

CURRENT MATRIX (newest answered request: #127 request +900.006 s → response +900.618 s; a late answer to an older request never replaces it)
  (O open, X unavailable, U not published, ? unknown)
       08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1    O  X  X  X  O  O  X  X  X  X  X  X  X  X  X  O
  C2    O  X  X  X  O  O  X  X  X  X  X  X  X  X  O  O
  C3    O  X  X  X  O  X  O  X  X  X  X  X  X  X  O  O
  C4    O  X  X  X  O  X  X  X  X  X  X  X  X  X  O  O
  C5    O  X  X  X  O  X  X  X  X  X  X  X  X  X  X  O
  C6    X  X  X  X  O  X  X  X  X  X  X  X  X  X  X  O
  C7    X  X  X  X  O  O  X  O  X  X  X  X  X  X  X  O

LIMITATIONS
  - A read does not show the provider-side moment of a change; only the request/response interval of the reads around it.
  - Unavailable without a matching public booking record: the cause is not visible in Onda's public data.
  - A public booking record shows that a booking record exists. It does not show who made it or why.
  - Responses served from Onda's edge cache (x-vercel-cache/age) may reflect an earlier state than the request time.

Full read-by-read log (response order, with request order in seq): <install>\.local\slot-watch\2026-09-27_60d68777-0022-471a-99aa-3a47543858f4.ndjson
```

**Release Intelligence summary** (`.local/release-intelligence/summary.txt`, rebuilt 08:15:00):
```
Release Intelligence v1 · generated 2026-09-25T00:15:00.934Z
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

Skipped artifacts: 2026-09-26_0cb886f9-a705-4748-ac90-da8130a72747.ndjson (NO_READS), 2026-09-26_20a3805e-f957-471b-a093-acffae751c84.ndjson (NO_READS), 2026-09-26_785f2fc9-cecf-4fae-bb5d-1d34fd15e2c1.ndjson (NO_READS), 2026-09-26_f337db15-c690-436f-a16d-57c26d5bd009.ndjson (NO_READS), 2026-09-27_108ad87f-0cc0-4bb8-8b4a-ea515784a71b.ndjson (NO_READS), 2026-09-27_575165ee-3243-4c4e-8220-adb39a2cf4ec.ndjson (NO_READS), 2026-09-27_5786bdb0-ddd1-4128-8912-80a3abebe006.ndjson (NO_READS), 2026-09-27_9d19e89c-9756-47c3-ba9b-6ea035d2851d.ndjson (NO_READS), 2026-09-27_9e52ff6a-2191-4552-bd64-d2a9d21b3406.ndjson (NO_READS), 2026-09-27_b18d5498-55ed-4e1e-8fcb-1ef41991b28d.ndjson (NO_READS), 2026-09-27_c3e74423-413c-4e75-ba1f-867ae366607a.ndjson (NO_READS), 2026-09-27_e76f6629-4be4-4cd6-b601-8bab429462c6.ndjson (NO_READS)
```
