# Production release report: September 26, 2026 (target Monday September 28)

Prepared by Claude on 2026-09-26 from the installed app's local evidence. The analysis only read files: nothing was sent to Onda, and no booking, lock, journal or configuration was changed. OpenAI Codex wrote a separate report on the same run; it is archived in [diagnostics-archive/2026-09-26/codex/](diagnostics-archive/2026-09-26/codex/REPORT.md). Where the two overlap they agree. This report adds Onda's rejection texts, the clock comparison from the `Date` headers, the reopen timing analysis, the stale-read evidence and the analysis of why the 08:00 race was lost.

**Conventions.** All times are Manila. "+x s" means seconds after 08:00:00.000 on the bot's corrected (NTP consensus) clock. "Cell" is one court for one hour, and "C4 19:00" means Court 4, 19:00–20:00. A list such as "C1 17–21" gives the start hours of the cells (17:00 through 21:00, so 17:00–22:00). Ranges written with minutes, such as "19:00–22:00", are booking times. **(inference)** marks conclusions that rest on a stated assumption. Everything else is directly recorded. Unavailable cells that have no public booking record have no known cause. Where Onda gave a reason, it is quoted exactly as sent.

## 1. Executive result

- **No booking and no hold.** All six Wave 1 checkouts started in Chrome 6.2–7.7 ms after 08:00. Onda answered all six with HTTP 409 after 6.8–14.0 s. All six journals are closed as `rejected`, and nothing is armed or left to reconcile.
- **The new 409 capture recorded Onda's reason for the first time, and there were two:**
  - A, B, C (Courts 4, 5, 1 at 19:00–22:00): *"This booking slot is temporarily unavailable because an event is already scheduled in this space."*
  - D, E, F (Court 2 17:00–20:00, Court 2 20:00–23:00, Court 3 17:00–20:00): *"This booking slot is no longer available (overlaps an existing booking)."*
- **Only 2 of the 9 authorized candidates could be won at 08:00:** Court 2 and Court 3 at 17:00–20:00. Both went to someone who booked 18:00–20:00 on both courts before Onda processed our requests.
- **At +597 s both of those targets came back fully open for about 7 seconds, and the bot sent nothing.** Standby worker G started preparing four times and quit silently each time. A code guard requires the exact read that triggered the attempt to still be the newest one after the 1.2–1.6 s security preparation. The new 1-second read window always delivered a newer read first.
- **Speed was not the problem.** Release to Chrome network start was 6.2–7.7 ms. The number embedded in Onda's edge ID (undocumented, but it looks like the arrival time) read +28 to +41 ms. Everything after that happened inside Onda: 6.8–14.0 s of waiting.
- Release Intelligence rates this release **GOOD**, the first well-observed release so far: the first published grid was answered at +1.46 s, complete and uncached.

## 2. Why we lost at 08:00

1. **The main target did not exist.** Monday 19:00–22:00 was unavailable on every court before the race. Courts 1, 4 and 5 had what Onda calls "an event already scheduled". Courts 2, 3, 6 and 7 had public bookings that were already visible at 03:43 (block audit: "Blocked 14"). In the 18:00–23:00 band, 24 of 35 cells were gone before 08:00. No bot, however fast, could have booked 19:00–22:00.
2. **Four of six Wave 1 shots, and all three standby targets, were aimed at cells nobody could win.** A, B and C went to event cells. E went to Court 2 20:00–23:00, which was booked before 07:59. G's Wave 2 targets (C3 20:00–23:00, C6 17:00–20:00, C6 20:00–23:00) all overlapped the same pre-release records. At 08:00 only D and F were in a real race.
3. **Onda's order, not ours, decided D and F.**
   - Four of our requests reached Onda's edge within about 1 ms of each other (embedded stamps +28/+29 ms). Onda answered them at 6.9, 10.0, 10.9 and 14.0 s.
   - Onda happened to process the three event-cell requests first (+6.85, +10.02, +10.89 s). D and F came 4th and 5th (+11.93, +12.29 s).
   - The public booking read answered at +12.15 s did not yet include Court 3 18:00–19:00. Onda's rejection of F at +12.29 s says it overlapped an existing booking. So the other booking on Court 3 was probably created no more than about 2 seconds before F was checked **(inference: assumes that booking read showed the current state)**.
   - Had F been checked in the slot C got (+6.85 s), it would likely have found Court 3 free. That only holds if Onda's order is per request; if Onda keeps a separate line per court, it may not.
4. **Nothing on our side of the send could have changed this.** Our 7.7 ms is about 0.1% of the shortest wait inside Onda.

## 3. What the new evidence loggers recorded

| Logger (commit) | Result this morning | Output |
|---|---|---|
| Sanitized 409 capture (`f684136`) | 6/6: message text, body size and shape, `Date`, `x-vercel-id`, cache, matched path | `provider-trace.ndjson` (`response-fallback` records), private capture per journal |
| Critical-path telemetry (`50f32fa`) | 6/6 workers; page-clock calibration consistent, ±0.38–0.44 ms | `critical-path.ndjson`; `CRITICAL_PATH_SAVED` |
| Passive provider trace (Phase 2) | 6/6 complete (HTTP/2, reused connection, send/wait) | `provider-trace.ndjson` |
| 1-second reads at +595…+665 s (`65c6420`) | 71 reads, all answered; dated every reopening in that window to about 1 s | Slot Watch log #126–#196 |
| Slot Watch v2 | 204/204 grid reads, 9/9 booking-record reads, max 4 in flight, median 178 ms | Slot Watch log, summary, text report |
| Release forensics report | Preliminary, then FINAL at 08:15:00.26 | `release-forensics/<run>/report.txt`, `summary.json` |
| Release Intelligence | Rebuilt at 08:15:01.9; this release rated GOOD | `release-intelligence/` |

Renderer-resident dispatch stayed off (`dispatchMode: node` for every worker), as intended.

## 4. Run identity and evidence scope

| Item | Value |
|---|---|
| Live run | runner `e69098a8-b8b2-444e-b0ea-2b1170f1420f` · app run `515b2975-e312-44c9-bcda-1ba760f838b6` (label "full", API LIVE) |
| Slot Watch | `3ca6d99a-c914-4d25-ac93-7ccd75bda270` (v2), reads 07:59:00–08:15:00.5 |
| Build | `06114db` (merge of PR #3: evidence loggers, critical path, arbitration tools), installed 03:40:56 |
| Method | proofless Precision Phase 3, 7 workers (A–F Wave 1, G standby), prewarm lead 15 s |
| Plan | 9 candidates, all 3 hours at PHP 2,100 (700/hour, "current venue schedule" rates captured 03:44:44); budgets Wave 2 = 1, Rescue = 1, total 8; concurrent Wave 2 on; Rescue on |
| Frozen | 07:58:00.055, fingerprint `aa73196b…` |
| Outcome | `ALL_REJECTED_WAITING_FOR_REOPEN`, exit code 1 at 08:15:00.12. The process had stopped; the label does not mean it was still waiting |

## 5. The morning, in order

| Time | Event |
|---|---|
| 03:40:56 | Build `06114db` installed |
| 03:42:46 | Network readiness check |
| 03:43:10 | Block audit for Mon 28 Sep: **Open 0 · Blocked 14 · Unreleased 98**. The 14 pre-booked evening cells were visible more than 4 hours before release |
| 03:44:47 | Settings saved (rates captured 03:44:44) |
| 06:36:10 | Block audit: the same 14 |
| 06:37:51–06:38:05 | Prepare + dry run: complete |
| 06:38:17 | LIVE started, then **user-aborted after 5.8 s** (`USER_ABORT`; Slot Watch had 0 reads) |
| 07:29:20 | Block audit: the same 14 |
| 07:29:48–07:30:01 | Prepare + dry run: complete |
| 07:30:23.9 | **LIVE run starts**; all 7 Chromes ready by 07:30:26.8; plan authorized |
| 07:50:00.3 | Clock T−10 min: +368.0 ms ±23.7 |
| 07:58:00.06 | Plan frozen; A–F armed |
| 07:59:00 | Slot Watch starts. The booking read shows 14 records: C2/C3 20–22, C6/C7 18–21 |
| 07:59:00.2 | Clock T−60 s: +372.6 ms ±21.9 |
| 07:59:30.0 | G security prep (2.5 s); standby ready 07:59:32.5 |
| 07:59:30.2 | Clock T−30 s: +373.0 ms ±21.5 (used for dispatch) |
| 07:59:45.04 | A–F security prep; done 07:59:48.35–49.16 (3.3–4.1 s) |
| −1.571 s | Last read without the date answered (#7) |
| +0.00007 s | Scheduler fires |
| **+6.2 to +7.7 ms** | Chrome starts all six POSTs; Onda edge stamps +28 to +41 ms |
| +0.074 s | DevTools Network enabled for the passive trace |
| +1.462 s | **First published grid** (#8, requested +0.017 s): 75 open / 37 unavailable |
| +5.916 s | Booking read b2: still only the 14 pre-release records |
| +6.85 s | 409 for C (Court 1) — "event" |
| +10.03 / +10.89 s | 409 for A (Court 4), B (Court 5) — "event" |
| +11.93 s | 409 for D (Court 2 17:00) — "overlaps" |
| +12.149 s | Booking read b3: 23 records, adding C2 18–19, C4 18, C5 18, and 22:00 on C1, C4, C5, C6, C7 |
| +12.29 s | 409 for F (Court 3 17:00) — "overlaps" |
| +13.860 s | Grid #21: **18:00–23:00 unavailable on all 7 courts** |
| +13.99 s | 409 for E (Court 2 20:00) — "overlaps"; Wave 1 settled |
| +52 to +54 s | C5 14–16 taken (#61 briefly showed it open again) |
| +65 / +80 s | C3 17:00, then C2 17:00 taken |
| +85 s | C6/C7 15–17 taken |
| +115 s | C4 17 and C5 17 taken |
| +190 s | C5 14–16 reopen; taken again by +280 s |
| +595 s | 1-second reads begin |
| **+597.3 s** | **C2 and C3 17–19 reopen: D's and F's full targets are open** |
| +597.4 to +604.7 s | G prepares four times and sends nothing (§11) |
| +600.3 s | Booking read b8: the C2/C3 17–19 records are gone |
| +605.3 s | C2/C3 17–19 taken again. C1 22, C4 18, C4 22, C5 18 and C7 22 released (C6 22 by +606.3 s, C5 22 by +607.3 s) |
| +665 s | 1-second reads end |
| +690 / +720 s | C6/C7 15–17 reopen, then are re-taken; C4 17 and C5 17 reopen |
| +840 s | C4 16–18 and C5 17–18 taken |
| +900 s | Final read: 55 open / 57 unavailable; booking read b9: 34 records |
| 08:15:00.07 | Outcome recorded; critical path and provider trace saved; exit 1 |
| 08:15:00.26 | Forensic report FINAL; Release Intelligence rebuilt 08:15:01.9 |
| 08:21:00 | Block audit for Mon 28 Sep: Open 51 · Blocked 61. Tue 29 Sep: all 112 unreleased |

## 6. The authorized plan

| Priority | Target | Assigned | Could it be won at 08:00? |
|---:|---|---|---|
| 1 | C4 19:00–22:00 | Wave 1 A | No. Unavailable in the first grid, no public record all morning; Onda: "event already scheduled" |
| 2 | C5 19:00–22:00 | Wave 1 B | No. Same |
| 3 | C1 19:00–22:00 | Wave 1 C | No. Same (C1 17–21 unavailable) |
| 4 | C2 17:00–20:00 | Wave 1 D | **Yes.** Fully open in the first grid |
| 5 | C2 20:00–23:00 | Wave 1 E | No. Public records from 03:43 |
| 6 | C3 17:00–20:00 | Wave 1 F | **Yes.** Fully open in the first grid |
| 7 | C3 20:00–23:00 | G, Wave 2 / Rescue | No. Public records from 03:43 |
| 8 | C6 17:00–20:00 | G, Wave 2 / Rescue | No. C6 18–19 records from 03:43 |
| 9 | C6 20:00–23:00 | G, Wave 2 / Rescue | No. C6 20–21 records from 03:43 |

All nine were also allowed for Rescue. Full frozen plan: Appendix I.

## 7. Clock

- Three NTP consensus rounds against time.google.com and time1–4 (10 samples each, all kept, quality GOOD). Offsets were +368.0, +372.6 and +373.0 ms. The T−30 s round (uncertainty ±21.5 ms, spread 6.2 ms, minimum RTT 43 ms) drove dispatch. The Slot Watch used +368.1 ms, so observer minus dispatch = −4.9 ms.
- **The Windows clock was 373 ms slow.** On Sept 25 it was 23 ms. The bot corrected it; with no correction, it would have sent about 0.37 s late. Windows time sync is worth checking.
- **Onda's clock (inference, from the six 409 `Date` headers).** Each header is Onda's time rounded down to the second, and we know when each answer reached us. A's (":09", received +10.022 s) and F's (":12", received +12.293 s) bound Onda's clock to between about 0.29 s behind ours and about equal, plus the few tens of ms of transit. Onda's clock was not seconds ahead of ours. Whether this is the clock Onda's release gate uses is unknown.

Every sample: Appendix J.

## 8. Dispatch (critical path)

| Step | A | B | C | D | E | F |
|---|---:|---:|---:|---:|---:|---:|
| Worker called (ms) | 0.11 | 1.21 | 1.52 | 1.75 | 1.95 | 2.14 |
| Pre-POST (ms) | 0.47 | 1.26 | 1.55 | 1.77 | 1.97 | 2.15 |
| Page evaluate / `fetch()` (ms) | 3.58 | 4.03 | 4.32 | 4.69 | 4.89 | 4.94 |
| **Chrome network start (ms)** | **6.21** | **6.46** | **6.94** | **7.50** | **7.30** | **7.74** |
| Playwright request event (ms) | 8.60 | 7.64 | 7.92 | 8.68 | 9.61 | 9.54 |
| Onda edge stamp (ms, undocumented) | 28 | 29 | 29 | 34 | 29 | 41 |

- The timer fired at +0.07 ms. Handing off to the six workers one after another took up to 2.15 ms.
- Node → page hand-off took 2.77–3.11 ms, and page `fetch()` → Chrome network start took 2.41–2.81 ms. Those are the two largest parts.
- Sends went out on reused HTTP/2 connections in 0.1–0.2 ms, with no DNS, connect or TLS.
- Page clocks calibrated within ±0.38–0.44 ms (8 round trips each, all consistent).
- Node noticed C's response 61 ms after Chrome had it complete (+6.920 s against +6.859 s). That was after the answer, so it did not affect the result.
- Compared with Sept 25 (Chrome start by +8.0 to +10.6 ms with 7 workers), sends were 2–3 ms earlier.

## 9. Onda's answers

| Order answered | Worker | Target | Server wait | Answered | Onda edge stamp | Body | On the wire | Message |
|---:|---|---|---:|---:|---:|---:|---:|---|
| 1 | C | C1 19:00–22:00 | 6.849 s | +6.859 s | +29 | 125 B | 423 B | event already scheduled |
| 2 | A | C4 19:00–22:00 | 10.018 s | +10.026 s | +28 | 125 B | 245 B | event already scheduled |
| 3 | B | C5 19:00–22:00 | 10.884 s | +10.891 s | +29 | 125 B | 244 B | event already scheduled |
| 4 | D | C2 17:00–20:00 | 11.923 s | +11.932 s | +34 | 100 B | 399 B | overlaps an existing booking |
| 5 | F | C3 17:00–20:00 | 12.289 s | +12.298 s | +41 | 100 B | 398 B | overlaps an existing booking |
| 6 | E | C2 20:00–23:00 | 13.989 s | +13.996 s | +29 | 100 B | 399 B | overlaps an existing booking |

- All six responses: application JSON `{ success: false, error: "…" }` from Vercel `sin1→sin1`, `x-vercel-cache: MISS`, `x-matched-path: /api/bookings/public-checkout`, no `x-request-id`, no `server-timing`, no `cf-ray`.
- **Waits were much shorter than the last two releases:** 6.8–14.0 s, against 29.1–34.6 s on Sept 25 and 17.5–28.3 s on Sept 24. The whole morning was lighter: first grid at +1.46 s instead of +4.14 s, and 25 cells closing instead of 95.
- **Requests Onda could refuse on sight still waited 6.8–10.9 s.** The "event" answers did not depend on anyone else's booking. The wait therefore happens before Onda checks the slot, as on Sept 23 and 24. That fits the Sept 25 investigation's shared-queue hypothesis but does not prove it.
- **All three "event" answers arrived before all three "overlap" answers.** Split 3/3, that order happens by chance 1 time in 20. It could be chance, a per-court line (Courts 2 and 3 carried the contested blocks), or different code paths.
- **Order against edge stamps.** With ties (+28 A; +29 B, C, E; +34 D; +41 F), five of six answers follow stamp order. E (+29) is the exception: it was answered last. Sept 25 had the same shape: six of seven in order, one exception. Four requests stamped within 1 ms were still answered 7.1 s apart.
- **On-the-wire size does not reveal the message.** It was 244–245 B for A and B and 398–423 B for the others, and the "event" message appears in both groups (C's is 423 B). So the two size groups on Sept 25 cannot be read as two different rejection reasons. Header compression on each connection is the likely cause **(inference)**.

## 10. What the grid showed

- **Publication.** The date became visible between #7 (requested −1.992 s, answered −1.571 s, date absent) and #8 (requested +0.017 s, answered +1.462 s, date present, cache MISS). The early reads were slow (#8 1.4 s, #9 2.8 s, #10 4.2 s, #11 1.1 s), then fell to about 100 ms from #12 (+2.0 s).
- **First grid:** 75 open, 37 unavailable.
  - The 37 unavailable cells break down as follows:
    - 14 with public records: C2/C3 20–22, C6/C7 18–21.
    - 12 mornings: C3/C4/C5 08:00–12:00. The user says these are morning open-play admin blocks (user-provided, per the Codex report).
    - 11 evenings with no public record ever: C1 17–21, C4 19–21, C5 19–21. Onda's reason for 19–21 on C1/C4/C5 is "an event is already scheduled in this space".
- **Reads #8 to #20 (to +12.1 s) showed no change.** The first change came in #21 (requested +13.000 s, answered +13.860 s): 11 cells taken (C1 22, C2 18–19, C3 18–19, C4 18, C4 22, C5 18, C5 22, C6 22, C7 22). After that, 18:00–23:00 was unavailable on every court.
- **Totals for the watch:** 25 cells went open→unavailable and 24 went back. Every change is listed in Appendices A and D.
- **Stale fast reads (inference).**
  - Seven of those 11 cells came back at +604–607 s. If Onda's 10-minute hold applies, they were taken between +4.0 and +7.3 s (§12).
  - Yet fast reads sent from +6 to +12 s (70–190 ms each) showed them open.
  - The booking read answered at +12.15 s already listed them. Sept 25 had the same kind of stale fast reads.
  - During the rush, a fast "open" read is not proof a cell is still free.

## 11. The missed second chance at +597 s

**What happened.**
- C2 and C3 17:00–19:00 (6 cells) reopened between #127 (requested +596.006 s) and #128 (answered +597.342 s).
- That made both D's and F's full 3-hour targets open in eight reads in a row (#128–#135, to +604.1 s). They were taken again by #136 (answered +605.326 s).
- The booking read at +600.3 s confirms their records had disappeared.

**What G did** (times on the corrected clock):

| Prep started | Acting on read | Prep took | Newest read when prep finished | Result |
|---|---|---:|---|---|
| +597.37 s | #128 (answered +597.342) | 1.48 s | #129 | silent return |
| +599.12 s | #130 (answered +599.092) | 1.20 s | #131 | silent return |
| +601.16 s | #132 (answered +601.138) | 1.24 s | #133 | silent return |
| +603.14 s | #134 (answered +603.108) | 1.56 s | #135 | silent return |

**Why.**
- In [src/api-booking/desktop-runner.ts](src/api-booking/desktop-runner.ts) (lines 888–891 at `06114db`), an adaptive attempt calls `prepareCheckoutContext()` first. Afterwards it returns without logging if `session.latest.observation.seq !== evidenceSeq`, that is, if any newer read has arrived.
- The new hold-expiry window sends a read every second, and G's prep took 1.2–1.6 s. So there was always a newer read, even though each newer read still showed the same target open.
- Codex's offline replay of the frozen plan against the recorded grids (`diagnostics-archive/2026-09-26/codex/analysis.json`) selects **Rescue → C2 17:00–20:00 on G** for all eight reads.
- This is the starvation risk flagged after Sept 25 ("an adaptive attempt returns silently if a newer read arrives during its security prep"), now seen in a live run.

**Limits.**
- It does not prove we would have won: someone took both blocks within about 7 s.
- The fix must keep the freshness, price, budget, journal and no-UNKNOWN checks. The re-check should accept a newer read that still shows the same target fully open and fresh.
- Every skip should be logged with its reason.

## 12. Reopenings, dated by the 1-second window

| Reopened | Cells | If it was a 10-minute hold expiry, it was booked at | Fits? |
|---|---|---|---|
| +596.0 to +597.3 s | C2 17, 18, 19; C3 17, 18, 19 | ≤ −2.7 s (before 08:00) | **No.** 18–19 were booked after about +2.0 s (not in booking read b2, assuming it was current), and the 17:00 cells only at +60 to +81 s. Released together by some other mechanism (cancellation, a different expiry rule, or something else); cause unknown |
| +604.0 to +605.3 s | C1 22, C4 18, C4 22, C5 18, C7 22 | +4.0 to +5.3 s | Yes |
| +605.0 to +606.3 s | C6 22 | +5.0 to +6.3 s | Yes |
| +606.0 to +607.3 s | C5 22 | +6.0 to +7.3 s | Yes |

- If these are expiries, the other side's bookings were being created at roughly one-second steps from about +4 s. That is before Onda answered any of ours (first answer at +6.85 s) **(inference)**.
- All five 22:00 cells were still open at 08:15. C4 18 and C5 18 were re-taken at about +840 s.
- Earlier reopenings that do not fit a 10-minute hold: C5 14–16 at +190 s (taken about +52 s), C6/C7 15–17 at +690 s (taken about +85 s), C4 17 / C5 17 at +720 s (taken about +115 s).

## 13. The 18:00–23:00 band (35 cells) at +13.9 s

| Group | Cells | Count |
|---|---|---:|
| Public records before 07:59 (visible at 03:43) | C2 20–22, C3 20–22, C6 18–21, C7 18–21 | 14 |
| Unavailable from publication, no public record all morning (Onda: "event" for 19–21 on C1/C4/C5) | C1 18–21, C4 19–21, C5 19–21 | 10 |
| Taken at release | C1 22, C2 18–19, C3 18–19, C4 18, C4 22, C5 18, C5 22, C6 22, C7 22 | 11 |

- Of the 11 taken at release, 7 were released at +604–607 s, consistent with unpaid 10-minute holds **(inference)**. C2/C3 18–19 were released at +597 s and re-taken within about 7 s.
- The belief that "scalpers blocked 6–11 PM" is partly supported: 11 cells were taken at release and most were released unpaid. But 24 of the 35 were gone before 08:00.
- Onda's public data cannot show who held any cell or whether it was one party.
- 3-hour blocks outside the evening stayed open far longer than our 14 s:
  - C2 15:00–18:00 until about +75 s, C3 15:00–18:00 until about +60 s, C4 15:00–18:00 until about +110 s.
  - C6/C7 14:00–17:00 and 15:00–18:00 until about +80 s.
  - C1, C2 and C3 14:00–17:00 for the full 15 minutes.
  - C4/C5 16:00–19:00 were gone by +13 s.
  - All blocks: Appendix E.

## 14. Compared with earlier releases

| Release (target) | First grid answered | Our send | Onda's answers | Outcome | Intelligence quality |
|---|---|---|---|---|---|
| 12 Sep (Mon 14 Sep), normal website flow with slot check | — | final Onda action +9.5 s | hold about 3.8 s later | **verified hold**, the only release win on record | — |
| 22 Sep (Thu 24 Sep) | not observed | — | — | no available candidate | NONE |
| 23 Sep (Fri 25 Sep) | +6.0 s (counts only) | — | 409 after 11.5–13.3 s | special session not available | POOR |
| 24 Sep (Sat 26 Sep) | +15.7 s | +100 ms | 409 after 17.5–28.3 s | all rejected | POOR |
| 25 Sep (Sun 27 Sep) | +4.14 s | +8.0 to +10.6 ms (Chrome) | 409 after 29.1–34.6 s | all rejected; nothing aimed at the +630 s reopen | FAIR |
| **26 Sep (Mon 28 Sep)** | **+1.46 s** | **+6.2 to +7.7 ms (Chrome)** | **409 after 6.8–14.0 s** | all rejected; the +597 s reopen was missed by the guard | **GOOD** |

- Sept 12 and today were both Mondays. Sept 12 used the normal website flow, which checks the slot and gets a proof before checking out. That checkout, sent at +9.5 s, was held in about 3.8 s. Today's proofless checkouts, sent at +7 ms, took 6.8–14.0 s.
- Different days and loads, so not a controlled comparison. It is the one untested lever that might change our place in Onda's order rather than our send time.

## 15. What worked

- Every new logger wrote complete data: 409 bodies, critical path, provider trace, 1-second window, forensic report, intelligence.
- Clock correction handled a 373 ms Windows drift. Dispatch was the tightest yet: 1.5 ms spread in Chrome start across six workers.
- No crash, no UNKNOWN attempt, no retry, no duplicate. All journals are closed, and the one-shot claims held.
- Slot Watch answered every read (204/204 and 9/9); the booking reads corroborated the grid at +600 s.

## 16. What limited this run

1. **Candidate choice (plan).** Four of nine candidates had public records hours before release, and the plan was not checked against them at freeze. E and all standby targets were dead on arrival. The same thing happened on Sept 25 with C4 15:00–18:00.
2. **Event cells in the top three priorities.** They could not be known from the grid before 08:00, but the same pattern has shown up on earlier dates (Friday evenings; courts 3–5 on Saturday) and is worth confirming with the venue.
3. **The Rescue same-read guard (§11).**
4. **Wave 2 draws only from standby workers.** G was the only candidate, and its three Wave 2 targets were dead.
5. **Minor issues.**
   - The outcome label `ALL_REJECTED_WAITING_FOR_REOPEN` reads as if the bot kept waiting, but it had exited.
   - The app log shows a red "Unrecognized structured event omitted" at the same moment as the new `CRITICAL_PATH_SAVED` event; the UI's event schema rejects it.
   - The runner log mixes two clocks: rows with `eventAt` use the raw PC clock (373 ms slow), the others the corrected clock.
   - The forensic report is only built at the end of the watch, so a mid-run check cannot see the deep timing.

## 17. What this data cannot tell us

- Who took any cell, whether it was one party, or whether any hold was paid.
- Whether Onda keeps one line for all checkouts or one per court.
- When exactly Onda's checkout gate opens. Probing it would need a checkout before 08:00, which is out of bounds.
- Whether requests that arrive early are queued.
- Whether the proof-backed flow gets processed sooner.
- Why the +597 s group was released.
- Who scheduled the "event" cells, and whether they repeat every Monday.

## 18. What to change before the next release (Sun 27 Sep 08:00, opening Tue 29 Sep)

1. **Drop or flag dead candidates before freeze.** Use the pre-release public records (visible hours before) and a per-weekday memory of cells Onda answered with "event already scheduled". Today this would have freed 4 of 6 Wave 1 workers and G.
2. **Aim every freed worker at something that exists, without sending more requests.** Two options, and the choice is yours:
   - **More workers on the few live evening blocks.** Only one can succeed per block. This helps if Onda's order is per request; it does not help if Onda keeps a line per court.
   - **Add fallback blocks you would accept.** 14:00–18:00 blocks stayed open well past our 14 s.
3. **Fix the Rescue/Wave 2 re-check (§11)** and log every skip reason. Consider keeping standby security prep warm so an attempt can fire before the next read.
4. **Test the proof-backed lane with one worker** on a separate block you actually want (Sept 25 investigation §13, experiment 6).
5. **Leave dispatch alone.** No renderer dispatch, and no faster send.
6. **Check Windows time sync** (373 ms drift).

## 19. Safety state now

- All six journals for 28 Sep are `rejected` (`ONDA_HTTP_STATUS_INVALID`, 409, application, hint `availability`). None is `armed`, and no one-shot needs manual reconciliation.
- No hold, booking or QR exists for this run. Nothing to cancel or pay.

## 20. Sources (install folder)

- Runner: `.local/api-booking/run-progress/e69098a8-b8b2-444e-b0ea-2b1170f1420f.ndjson` (323 lines)
- App run: `.local/booking-runs/515b2975-e312-44c9-bcda-1ba760f838b6.ndjson` (275 lines) and the other nine command logs from 26 Sep (Appendix L)
- Slot Watch: `.local/slot-watch/2026-09-28_3ca6d99a-c914-4d25-ac93-7ccd75bda270.{ndjson,summary.json,txt}`
- Forensics: `.local/release-forensics/e69098a8-b8b2-444e-b0ea-2b1170f1420f/{report.txt,summary.json,provider-trace.ndjson,critical-path.ndjson}`
- Plan: `.local/api-booking/precision-races/e69098a8-b8b2-444e-b0ea-2b1170f1420f-phase3-freeze.json`
- Journals: `.local/api-booking/api-first-journals/<key>/` (six)
- Clock: `.local/network-clock-evidence/2026-09-25T23-*.json`, `.local/network-clock.json`
- Intelligence: `.local/release-intelligence/{summary.txt,index.json,releases/}`
- Codex's run reports and replay: `DiagnosticsLocal/{LATEST_RUN_REPORT_2026-09-26.md,ongoing-forensics-2026-09-26/,final-forensics-2026-09-26/}`. The sanitized subset is already in [diagnostics-archive/2026-09-26/](diagnostics-archive/2026-09-26/).

The appendices below are derived from these files. They contain no identity, contact, customer ID, token or local path.

## Appendices

### Appendix A — Every availability read (all 204)

Times are release offsets on the Slot Watch clock (observer − dispatch = −4.9 ms). `Open/Unav` are cell counts out of 112. "Changes" compares each read with the previous read by sequence number, so a change can be undone by a later read that saw an older view.

| # | Scheduled | Requested | Answered | Took | Date shown | Open | Unav | Cache | Changes vs previous read |
|---:|---:|---:|---:|---:|---|---:|---:|---|---|
| 1 | −60.000 s | −59.995 s | −59.736 s | 259 ms | no | — | — | MISS |  |
| 2 | −50.000 s | −49.992 s | −48.999 s | 993 ms | no | — | — | MISS |  |
| 3 | −40.000 s | −39.985 s | −39.690 s | 295 ms | no | — | — | MISS |  |
| 4 | −30.000 s | −29.990 s | −29.828 s | 162 ms | no | — | — | MISS |  |
| 5 | −20.000 s | −19.990 s | −19.725 s | 265 ms | no | — | — | MISS |  |
| 6 | −10.000 s | −9.987 s | −9.691 s | 296 ms | no | — | — | MISS |  |
| 7 | −2.000 s | −1.992 s | −1.571 s | 421 ms | no | — | — | MISS |  |
| 8 | +0.000 s | +0.017 s | +1.462 s | 1445 ms | yes | 75 | 37 | MISS |  |
| 9 | +0.250 s | +0.257 s | +3.050 s | 2793 ms | yes | 75 | 37 | MISS |  |
| 10 | +0.500 s | +0.512 s | +4.708 s | 4196 ms | yes | 75 | 37 | MISS |  |
| 11 | +1.000 s | +1.011 s | +2.145 s | 1134 ms | yes | 75 | 37 | MISS |  |
| 12 | +2.000 s | +2.011 s | +2.088 s | 77 ms | yes | 75 | 37 | MISS |  |
| 13 | +5.000 s | +5.007 s | +5.150 s | 143 ms | yes | 75 | 37 | MISS |  |
| 14 | +6.000 s | +6.012 s | +6.199 s | 187 ms | yes | 75 | 37 | MISS |  |
| 15 | +7.000 s | +7.015 s | +7.124 s | 109 ms | yes | 75 | 37 | MISS |  |
| 16 | +8.000 s | +8.014 s | +8.106 s | 92 ms | yes | 75 | 37 | MISS |  |
| 17 | +9.000 s | +9.013 s | +9.106 s | 93 ms | yes | 75 | 37 | MISS |  |
| 18 | +10.000 s | +10.009 s | +10.127 s | 118 ms | yes | 75 | 37 | MISS |  |
| 19 | +11.000 s | +11.009 s | +11.132 s | 123 ms | yes | 75 | 37 | MISS |  |
| 20 | +12.000 s | +12.003 s | +12.099 s | 96 ms | yes | 75 | 37 | MISS |  |
| 21 | +13.000 s | +13.000 s | +13.860 s | 860 ms | yes | 64 | 48 | MISS | C1 22:00 open→unav, C2 18:00 open→unav, C2 19:00 open→unav, C3 18:00 open→unav, C3 19:00 open→unav, C4 18:00 open→unav, C4 22:00 open→unav, C5 18:00 open→unav, C5 22:00 open→unav, C6 22:00 open→unav, C7 22:00 open→unav |
| 22 | +14.000 s | +14.014 s | +14.687 s | 673 ms | yes | 64 | 48 | MISS |  |
| 23 | +15.000 s | +15.014 s | +15.078 s | 64 ms | yes | 64 | 48 | MISS |  |
| 24 | +16.000 s | +16.010 s | +16.240 s | 230 ms | yes | 64 | 48 | MISS |  |
| 25 | +17.000 s | +17.010 s | +17.090 s | 80 ms | yes | 64 | 48 | MISS |  |
| 26 | +18.000 s | +18.010 s | +18.098 s | 88 ms | yes | 64 | 48 | MISS |  |
| 27 | +19.000 s | +19.008 s | +19.078 s | 70 ms | yes | 64 | 48 | MISS |  |
| 28 | +20.000 s | +20.004 s | +20.096 s | 92 ms | yes | 64 | 48 | MISS |  |
| 29 | +21.000 s | +21.001 s | +21.089 s | 88 ms | yes | 64 | 48 | MISS |  |
| 30 | +22.000 s | +22.003 s | +22.076 s | 73 ms | yes | 64 | 48 | MISS |  |
| 31 | +23.000 s | +23.016 s | +23.100 s | 84 ms | yes | 64 | 48 | MISS |  |
| 32 | +24.000 s | +24.000 s | +24.090 s | 90 ms | yes | 64 | 48 | MISS |  |
| 33 | +25.000 s | +25.015 s | +25.289 s | 274 ms | yes | 64 | 48 | MISS |  |
| 34 | +26.000 s | +26.014 s | +26.104 s | 90 ms | yes | 64 | 48 | MISS |  |
| 35 | +27.000 s | +27.011 s | +27.425 s | 414 ms | yes | 64 | 48 | MISS |  |
| 36 | +28.000 s | +28.011 s | +28.120 s | 109 ms | yes | 64 | 48 | MISS |  |
| 37 | +29.000 s | +29.014 s | +29.423 s | 409 ms | yes | 64 | 48 | MISS |  |
| 38 | +30.000 s | +30.006 s | +30.101 s | 95 ms | yes | 64 | 48 | MISS |  |
| 39 | +31.000 s | +31.007 s | +31.301 s | 294 ms | yes | 64 | 48 | MISS |  |
| 40 | +32.000 s | +32.004 s | +33.035 s | 1031 ms | yes | 64 | 48 | MISS |  |
| 41 | +33.000 s | +33.004 s | +33.091 s | 87 ms | yes | 64 | 48 | MISS |  |
| 42 | +34.000 s | +34.014 s | +34.189 s | 175 ms | yes | 64 | 48 | MISS |  |
| 43 | +35.000 s | +35.011 s | +35.112 s | 101 ms | yes | 64 | 48 | MISS |  |
| 44 | +36.000 s | +36.008 s | +36.419 s | 411 ms | yes | 64 | 48 | MISS |  |
| 45 | +37.000 s | +37.008 s | +37.252 s | 244 ms | yes | 64 | 48 | MISS |  |
| 46 | +38.000 s | +38.008 s | +38.109 s | 101 ms | yes | 64 | 48 | MISS |  |
| 47 | +39.000 s | +39.004 s | +39.114 s | 110 ms | yes | 64 | 48 | MISS |  |
| 48 | +40.000 s | +40.003 s | +40.096 s | 93 ms | yes | 64 | 48 | MISS |  |
| 49 | +41.000 s | +41.002 s | +41.078 s | 76 ms | yes | 64 | 48 | MISS |  |
| 50 | +42.000 s | +42.015 s | +42.091 s | 76 ms | yes | 64 | 48 | MISS |  |
| 51 | +43.000 s | +43.014 s | +43.326 s | 312 ms | yes | 64 | 48 | MISS |  |
| 52 | +44.000 s | +44.010 s | +44.086 s | 76 ms | yes | 64 | 48 | MISS |  |
| 53 | +45.000 s | +45.008 s | +45.118 s | 110 ms | yes | 64 | 48 | MISS |  |
| 54 | +46.000 s | +46.004 s | +46.245 s | 241 ms | yes | 64 | 48 | MISS |  |
| 55 | +47.000 s | +47.012 s | +47.103 s | 91 ms | yes | 64 | 48 | MISS |  |
| 56 | +48.000 s | +48.010 s | +48.096 s | 86 ms | yes | 64 | 48 | MISS |  |
| 57 | +49.000 s | +49.012 s | +49.114 s | 102 ms | yes | 64 | 48 | MISS |  |
| 58 | +50.000 s | +50.010 s | +50.094 s | 84 ms | yes | 64 | 48 | MISS |  |
| 59 | +51.000 s | +51.003 s | +51.092 s | 89 ms | yes | 64 | 48 | MISS |  |
| 60 | +52.000 s | +52.001 s | +53.120 s | 1119 ms | yes | 61 | 51 | MISS | C5 14:00 open→unav, C5 15:00 open→unav, C5 16:00 open→unav |
| 61 | +53.000 s | +53.014 s | +53.270 s | 256 ms | yes | 64 | 48 | MISS | C5 14:00 unav→open, C5 15:00 unav→open, C5 16:00 unav→open |
| 62 | +54.000 s | +54.016 s | +54.303 s | 287 ms | yes | 61 | 51 | MISS | C5 14:00 open→unav, C5 15:00 open→unav, C5 16:00 open→unav |
| 63 | +55.000 s | +55.002 s | +55.098 s | 96 ms | yes | 61 | 51 | MISS |  |
| 64 | +56.000 s | +56.007 s | +56.101 s | 94 ms | yes | 61 | 51 | MISS |  |
| 65 | +57.000 s | +57.001 s | +57.110 s | 109 ms | yes | 61 | 51 | MISS |  |
| 66 | +58.000 s | +58.016 s | +58.114 s | 98 ms | yes | 61 | 51 | MISS |  |
| 67 | +59.000 s | +59.015 s | +59.099 s | 84 ms | yes | 61 | 51 | MISS |  |
| 68 | +60.000 s | +60.004 s | +60.084 s | 80 ms | yes | 61 | 51 | MISS |  |
| 69 | +65.000 s | +65.014 s | +65.327 s | 313 ms | yes | 60 | 52 | MISS | C3 17:00 open→unav |
| 70 | +70.000 s | +70.004 s | +70.190 s | 186 ms | yes | 60 | 52 | MISS |  |
| 71 | +75.000 s | +75.011 s | +75.207 s | 196 ms | yes | 60 | 52 | MISS |  |
| 72 | +80.000 s | +80.005 s | +80.636 s | 631 ms | yes | 59 | 53 | MISS | C2 17:00 open→unav |
| 73 | +85.000 s | +85.001 s | +85.327 s | 326 ms | yes | 53 | 59 | MISS | C6 15:00 open→unav, C6 16:00 open→unav, C6 17:00 open→unav, C7 15:00 open→unav, C7 16:00 open→unav, C7 17:00 open→unav |
| 74 | +90.000 s | +90.007 s | +90.286 s | 279 ms | yes | 53 | 59 | MISS |  |
| 75 | +95.000 s | +95.011 s | +95.196 s | 185 ms | yes | 53 | 59 | MISS |  |
| 76 | +100.000 s | +100.005 s | +100.181 s | 176 ms | yes | 53 | 59 | MISS |  |
| 77 | +105.000 s | +105.014 s | +105.343 s | 329 ms | yes | 53 | 59 | MISS |  |
| 78 | +110.000 s | +110.004 s | +110.168 s | 164 ms | yes | 53 | 59 | MISS |  |
| 79 | +115.000 s | +115.004 s | +115.192 s | 188 ms | yes | 51 | 61 | MISS | C4 17:00 open→unav, C5 17:00 open→unav |
| 80 | +120.000 s | +120.013 s | +120.222 s | 209 ms | yes | 51 | 61 | MISS |  |
| 81 | +125.000 s | +125.002 s | +125.563 s | 561 ms | yes | 51 | 61 | MISS |  |
| 82 | +130.000 s | +130.013 s | +130.389 s | 376 ms | yes | 51 | 61 | MISS |  |
| 83 | +135.000 s | +135.003 s | +135.359 s | 356 ms | yes | 51 | 61 | MISS |  |
| 84 | +140.000 s | +140.015 s | +140.579 s | 564 ms | yes | 51 | 61 | MISS |  |
| 85 | +145.000 s | +145.006 s | +145.403 s | 397 ms | yes | 51 | 61 | MISS |  |
| 86 | +150.000 s | +150.002 s | +150.180 s | 178 ms | yes | 51 | 61 | MISS |  |
| 87 | +155.000 s | +155.008 s | +155.185 s | 177 ms | yes | 51 | 61 | MISS |  |
| 88 | +160.000 s | +160.014 s | +160.193 s | 179 ms | yes | 51 | 61 | MISS |  |
| 89 | +165.000 s | +165.015 s | +165.422 s | 407 ms | yes | 51 | 61 | MISS |  |
| 90 | +170.000 s | +170.001 s | +170.211 s | 210 ms | yes | 51 | 61 | MISS |  |
| 91 | +175.000 s | +175.005 s | +175.415 s | 410 ms | yes | 51 | 61 | MISS |  |
| 92 | +180.000 s | +180.010 s | +180.180 s | 170 ms | yes | 51 | 61 | MISS |  |
| 93 | +185.000 s | +185.011 s | +185.183 s | 172 ms | yes | 51 | 61 | MISS |  |
| 94 | +190.000 s | +190.013 s | +190.481 s | 468 ms | yes | 54 | 58 | MISS | C5 14:00 unav→open, C5 15:00 unav→open, C5 16:00 unav→open |
| 95 | +195.000 s | +195.004 s | +195.302 s | 298 ms | yes | 54 | 58 | MISS |  |
| 96 | +200.000 s | +200.005 s | +200.172 s | 167 ms | yes | 54 | 58 | MISS |  |
| 97 | +205.000 s | +205.005 s | +205.194 s | 189 ms | yes | 54 | 58 | MISS |  |
| 98 | +210.000 s | +210.010 s | +210.377 s | 367 ms | yes | 54 | 58 | MISS |  |
| 99 | +215.000 s | +215.015 s | +215.446 s | 431 ms | yes | 54 | 58 | MISS |  |
| 100 | +220.000 s | +220.011 s | +220.200 s | 189 ms | yes | 54 | 58 | MISS |  |
| 101 | +225.000 s | +225.015 s | +225.339 s | 324 ms | yes | 54 | 58 | MISS |  |
| 102 | +230.000 s | +230.008 s | +230.205 s | 197 ms | yes | 54 | 58 | MISS |  |
| 103 | +235.000 s | +235.004 s | +235.180 s | 176 ms | yes | 54 | 58 | MISS |  |
| 104 | +240.000 s | +240.007 s | +240.312 s | 305 ms | yes | 54 | 58 | MISS |  |
| 105 | +245.000 s | +245.012 s | +245.543 s | 531 ms | yes | 54 | 58 | MISS |  |
| 106 | +250.000 s | +250.009 s | +250.332 s | 323 ms | yes | 54 | 58 | MISS |  |
| 107 | +255.000 s | +255.014 s | +255.207 s | 193 ms | yes | 54 | 58 | MISS |  |
| 108 | +260.000 s | +260.004 s | +260.368 s | 364 ms | yes | 54 | 58 | MISS |  |
| 109 | +265.000 s | +265.016 s | +265.208 s | 192 ms | yes | 54 | 58 | MISS |  |
| 110 | +270.000 s | +270.014 s | +270.373 s | 359 ms | yes | 54 | 58 | MISS |  |
| 111 | +275.000 s | +275.004 s | +275.203 s | 199 ms | yes | 54 | 58 | MISS |  |
| 112 | +280.000 s | +280.006 s | +280.435 s | 429 ms | yes | 51 | 61 | MISS | C5 14:00 open→unav, C5 15:00 open→unav, C5 16:00 open→unav |
| 113 | +285.000 s | +285.006 s | +285.645 s | 639 ms | yes | 51 | 61 | MISS |  |
| 114 | +290.000 s | +290.013 s | +290.194 s | 181 ms | yes | 51 | 61 | MISS |  |
| 115 | +295.000 s | +295.010 s | +295.191 s | 181 ms | yes | 51 | 61 | MISS |  |
| 116 | +300.000 s | +300.008 s | +300.392 s | 384 ms | yes | 51 | 61 | MISS |  |
| 117 | +330.000 s | +330.011 s | +330.365 s | 354 ms | yes | 51 | 61 | MISS |  |
| 118 | +360.000 s | +360.003 s | +360.501 s | 498 ms | yes | 51 | 61 | MISS |  |
| 119 | +390.000 s | +390.014 s | +390.372 s | 358 ms | yes | 51 | 61 | MISS |  |
| 120 | +420.000 s | +420.005 s | +420.346 s | 341 ms | yes | 51 | 61 | MISS |  |
| 121 | +450.000 s | +450.012 s | +450.414 s | 402 ms | yes | 51 | 61 | MISS |  |
| 122 | +480.000 s | +480.001 s | +480.376 s | 375 ms | yes | 51 | 61 | MISS |  |
| 123 | +510.000 s | +510.010 s | +510.201 s | 191 ms | yes | 51 | 61 | MISS |  |
| 124 | +540.000 s | +540.009 s | +540.363 s | 354 ms | yes | 51 | 61 | MISS |  |
| 125 | +570.000 s | +570.007 s | +570.368 s | 361 ms | yes | 51 | 61 | MISS |  |
| 126 | +595.000 s | +595.007 s | +595.198 s | 191 ms | yes | 51 | 61 | MISS |  |
| 127 | +596.000 s | +596.006 s | +596.119 s | 113 ms | yes | 51 | 61 | MISS |  |
| 128 | +597.000 s | +597.005 s | +597.342 s | 337 ms | yes | 57 | 55 | MISS | C2 17:00 unav→open, C2 18:00 unav→open, C2 19:00 unav→open, C3 17:00 unav→open, C3 18:00 unav→open, C3 19:00 unav→open |
| 129 | +598.000 s | +598.000 s | +598.138 s | 138 ms | yes | 57 | 55 | MISS |  |
| 130 | +599.000 s | +599.004 s | +599.092 s | 88 ms | yes | 57 | 55 | MISS |  |
| 131 | +600.000 s | +600.003 s | +600.086 s | 83 ms | yes | 57 | 55 | MISS |  |
| 132 | +601.000 s | +601.001 s | +601.138 s | 137 ms | yes | 57 | 55 | MISS |  |
| 133 | +602.000 s | +602.014 s | +602.106 s | 92 ms | yes | 57 | 55 | MISS |  |
| 134 | +603.000 s | +603.013 s | +603.108 s | 95 ms | yes | 57 | 55 | MISS |  |
| 135 | +604.000 s | +604.013 s | +604.099 s | 86 ms | yes | 57 | 55 | MISS |  |
| 136 | +605.000 s | +605.000 s | +605.326 s | 326 ms | yes | 56 | 56 | MISS | C1 22:00 unav→open, C2 17:00 open→unav, C2 18:00 open→unav, C2 19:00 open→unav, C3 17:00 open→unav, C3 18:00 open→unav, C3 19:00 open→unav, C4 18:00 unav→open, C4 22:00 unav→open, C5 18:00 unav→open, C7 22:00 unav→open |
| 137 | +606.000 s | +606.002 s | +606.295 s | 293 ms | yes | 57 | 55 | MISS | C6 22:00 unav→open |
| 138 | +607.000 s | +607.001 s | +607.292 s | 291 ms | yes | 58 | 54 | MISS | C5 22:00 unav→open |
| 139 | +608.000 s | +608.014 s | +608.124 s | 110 ms | yes | 58 | 54 | MISS |  |
| 140 | +609.000 s | +609.015 s | +609.127 s | 112 ms | yes | 58 | 54 | MISS |  |
| 141 | +610.000 s | +610.015 s | +610.225 s | 210 ms | yes | 58 | 54 | MISS |  |
| 142 | +611.000 s | +611.003 s | +611.489 s | 486 ms | yes | 58 | 54 | MISS |  |
| 143 | +612.000 s | +612.003 s | +612.145 s | 142 ms | yes | 58 | 54 | MISS |  |
| 144 | +613.000 s | +613.000 s | +613.110 s | 110 ms | yes | 58 | 54 | MISS |  |
| 145 | +614.000 s | +614.009 s | +614.104 s | 95 ms | yes | 58 | 54 | MISS |  |
| 146 | +615.000 s | +615.008 s | +615.087 s | 79 ms | yes | 58 | 54 | MISS |  |
| 147 | +616.000 s | +616.003 s | +616.094 s | 91 ms | yes | 58 | 54 | MISS |  |
| 148 | +617.000 s | +617.005 s | +617.113 s | 108 ms | yes | 58 | 54 | MISS |  |
| 149 | +618.000 s | +618.014 s | +618.342 s | 328 ms | yes | 58 | 54 | MISS |  |
| 150 | +619.000 s | +619.007 s | +619.083 s | 76 ms | yes | 58 | 54 | MISS |  |
| 151 | +620.000 s | +620.004 s | +620.108 s | 104 ms | yes | 58 | 54 | MISS |  |
| 152 | +621.000 s | +621.009 s | +621.082 s | 73 ms | yes | 58 | 54 | MISS |  |
| 153 | +622.000 s | +622.002 s | +622.334 s | 332 ms | yes | 58 | 54 | MISS |  |
| 154 | +623.000 s | +623.014 s | +623.097 s | 83 ms | yes | 58 | 54 | MISS |  |
| 155 | +624.000 s | +624.013 s | +624.097 s | 84 ms | yes | 58 | 54 | MISS |  |
| 156 | +625.000 s | +625.010 s | +625.097 s | 87 ms | yes | 58 | 54 | MISS |  |
| 157 | +626.000 s | +626.011 s | +626.093 s | 82 ms | yes | 58 | 54 | MISS |  |
| 158 | +627.000 s | +627.007 s | +627.081 s | 74 ms | yes | 58 | 54 | MISS |  |
| 159 | +628.000 s | +628.004 s | +628.340 s | 336 ms | yes | 58 | 54 | MISS |  |
| 160 | +629.000 s | +629.006 s | +629.085 s | 79 ms | yes | 58 | 54 | MISS |  |
| 161 | +630.000 s | +630.007 s | +630.134 s | 127 ms | yes | 58 | 54 | MISS |  |
| 162 | +631.000 s | +631.006 s | +631.265 s | 259 ms | yes | 58 | 54 | MISS |  |
| 163 | +632.000 s | +632.007 s | +632.089 s | 82 ms | yes | 58 | 54 | MISS |  |
| 164 | +633.000 s | +633.007 s | +633.400 s | 393 ms | yes | 58 | 54 | MISS |  |
| 165 | +634.000 s | +634.007 s | +634.094 s | 87 ms | yes | 58 | 54 | MISS |  |
| 166 | +635.000 s | +635.002 s | +635.102 s | 100 ms | yes | 58 | 54 | MISS |  |
| 167 | +636.000 s | +636.015 s | +636.142 s | 127 ms | yes | 58 | 54 | MISS |  |
| 168 | +637.000 s | +637.010 s | +637.097 s | 87 ms | yes | 58 | 54 | MISS |  |
| 169 | +638.000 s | +638.010 s | +638.077 s | 67 ms | yes | 58 | 54 | MISS |  |
| 170 | +639.000 s | +639.009 s | +639.089 s | 80 ms | yes | 58 | 54 | MISS |  |
| 171 | +640.000 s | +640.009 s | +640.081 s | 72 ms | yes | 58 | 54 | MISS |  |
| 172 | +641.000 s | +641.013 s | +641.275 s | 262 ms | yes | 58 | 54 | MISS |  |
| 173 | +642.000 s | +642.006 s | +642.266 s | 260 ms | yes | 58 | 54 | MISS |  |
| 174 | +643.000 s | +643.003 s | +643.087 s | 84 ms | yes | 58 | 54 | MISS |  |
| 175 | +644.000 s | +644.001 s | +644.308 s | 307 ms | yes | 58 | 54 | MISS |  |
| 176 | +645.000 s | +645.015 s | +645.349 s | 334 ms | yes | 58 | 54 | MISS |  |
| 177 | +646.000 s | +646.014 s | +646.110 s | 96 ms | yes | 58 | 54 | MISS |  |
| 178 | +647.000 s | +647.011 s | +647.094 s | 83 ms | yes | 58 | 54 | MISS |  |
| 179 | +648.000 s | +648.011 s | +648.098 s | 87 ms | yes | 58 | 54 | MISS |  |
| 180 | +649.000 s | +649.009 s | +649.112 s | 103 ms | yes | 58 | 54 | MISS |  |
| 181 | +650.000 s | +650.012 s | +650.099 s | 87 ms | yes | 58 | 54 | MISS |  |
| 182 | +651.000 s | +651.009 s | +651.091 s | 82 ms | yes | 58 | 54 | MISS |  |
| 183 | +652.000 s | +652.003 s | +652.096 s | 93 ms | yes | 58 | 54 | MISS |  |
| 184 | +653.000 s | +653.015 s | +653.105 s | 90 ms | yes | 58 | 54 | MISS |  |
| 185 | +654.000 s | +654.011 s | +654.099 s | 88 ms | yes | 58 | 54 | MISS |  |
| 186 | +655.000 s | +655.011 s | +655.235 s | 224 ms | yes | 58 | 54 | MISS |  |
| 187 | +656.000 s | +656.008 s | +656.100 s | 92 ms | yes | 58 | 54 | MISS |  |
| 188 | +657.000 s | +657.007 s | +657.245 s | 238 ms | yes | 58 | 54 | MISS |  |
| 189 | +658.000 s | +658.016 s | +658.102 s | 86 ms | yes | 58 | 54 | MISS |  |
| 190 | +659.000 s | +659.012 s | +659.094 s | 82 ms | yes | 58 | 54 | MISS |  |
| 191 | +660.000 s | +660.013 s | +660.106 s | 93 ms | yes | 58 | 54 | MISS |  |
| 192 | +661.000 s | +661.008 s | +661.248 s | 240 ms | yes | 58 | 54 | MISS |  |
| 193 | +662.000 s | +662.007 s | +662.099 s | 92 ms | yes | 58 | 54 | MISS |  |
| 194 | +663.000 s | +663.004 s | +663.095 s | 91 ms | yes | 58 | 54 | MISS |  |
| 195 | +664.000 s | +664.012 s | +664.087 s | 75 ms | yes | 58 | 54 | MISS |  |
| 196 | +665.000 s | +665.007 s | +665.093 s | 86 ms | yes | 58 | 54 | MISS |  |
| 197 | +690.000 s | +690.000 s | +690.450 s | 450 ms | yes | 64 | 48 | MISS | C6 15:00 unav→open, C6 16:00 unav→open, C6 17:00 unav→open, C7 15:00 unav→open, C7 16:00 unav→open, C7 17:00 unav→open |
| 198 | +720.000 s | +720.005 s | +720.197 s | 192 ms | yes | 60 | 52 | MISS | C4 17:00 unav→open, C5 17:00 unav→open, C6 15:00 open→unav, C6 16:00 open→unav, C6 17:00 open→unav, C7 15:00 open→unav, C7 16:00 open→unav, C7 17:00 open→unav |
| 199 | +750.000 s | +750.014 s | +750.192 s | 178 ms | yes | 60 | 52 | MISS |  |
| 200 | +780.000 s | +780.000 s | +780.412 s | 412 ms | yes | 60 | 52 | MISS |  |
| 201 | +810.000 s | +810.009 s | +810.401 s | 392 ms | yes | 60 | 52 | MISS |  |
| 202 | +840.000 s | +840.016 s | +840.188 s | 172 ms | yes | 55 | 57 | MISS | C4 16:00 open→unav, C4 17:00 open→unav, C4 18:00 open→unav, C5 17:00 open→unav, C5 18:00 open→unav |
| 203 | +870.000 s | +870.005 s | +870.334 s | 329 ms | yes | 55 | 57 | MISS |  |
| 204 | +900.000 s | +900.006 s | +900.520 s | 514 ms | yes | 55 | 57 | MISS |  |

### Appendix B — Every public booking-record read (all 9)

Onda's public bookings endpoint returns one record per booked hour (date, start, end, status). It never says who booked.

| # | Requested | Answered | Records | Hours with a record (court: hours) |
|---:|---:|---:|---:|---|
| b1 | −59.990 s | −59.725 s | 14 | C2: 20 21 22 · C3: 20 21 22 · C6: 18 19 20 21 · C7: 18 19 20 21 |
| b2 | +2.013 s | +5.916 s | 14 | C2: 20 21 22 · C3: 20 21 22 · C6: 18 19 20 21 · C7: 18 19 20 21 |
| b3 | +10.010 s | +12.149 s | 23 | C1: 22 · C2: 18 19 20 21 22 · C3: 20 21 22 · C4: 18 22 · C5: 18 22 · C6: 18 19 20 21 22 · C7: 18 19 20 21 22 |
| b4 | +30.007 s | +30.375 s | 25 | C1: 22 · C2: 18 19 20 21 22 · C3: 18 19 20 21 22 · C4: 18 22 · C5: 18 22 · C6: 18 19 20 21 22 · C7: 18 19 20 21 22 |
| b5 | +60.005 s | +60.253 s | 28 | C1: 22 · C2: 18 19 20 21 22 · C3: 18 19 20 21 22 · C4: 18 22 · C5: 14 15 16 18 22 · C6: 18 19 20 21 22 · C7: 18 19 20 21 22 |
| b6 | +120.014 s | +120.263 s | 38 | C1: 22 · C2: 17 18 19 20 21 22 · C3: 17 18 19 20 21 22 · C4: 17 18 22 · C5: 14 15 16 17 18 22 · C6: 15 16 17 18 19 20 21 22 · C7: 15 16 17 18 19 20 21 22 |
| b7 | +300.009 s | +300.269 s | 38 | C1: 22 · C2: 17 18 19 20 21 22 · C3: 17 18 19 20 21 22 · C4: 17 18 22 · C5: 14 15 16 17 18 22 · C6: 15 16 17 18 19 20 21 22 · C7: 15 16 17 18 19 20 21 22 |
| b8 | +600.004 s | +600.294 s | 32 | C1: 22 · C2: 20 21 22 · C3: 20 21 22 · C4: 17 18 22 · C5: 14 15 16 17 18 22 · C6: 15 16 17 18 19 20 21 22 · C7: 15 16 17 18 19 20 21 22 |
| b9 | +900.007 s | +900.421 s | 34 | C2: 17 18 19 20 21 22 · C3: 17 18 19 20 21 22 · C4: 16 17 18 · C5: 14 15 16 17 18 · C6: 15 16 17 18 19 20 21 · C7: 15 16 17 18 19 20 21 |

### Appendix C — The grid at key moments

`O` open, `X` unavailable, `·` date not yet published. Hours are start times (08 = 08:00–09:00).

**Read #7**: requested −1.992 s, answered −1.571 s · date not published

```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·
  C2   ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·
  C3   ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·
  C4   ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·
  C5   ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·
  C6   ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·
  C7   ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·
```

**Read #8**: requested +0.017 s, answered +1.462 s · 75 open / 37 unavailable

```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  X  X  X  X  X  O  O
  C2   O  O  O  O  O  O  O  O  O  O  O  O  X  X  X  O
  C3   X  X  X  X  O  O  O  O  O  O  O  O  X  X  X  O
  C4   X  X  X  X  O  O  O  O  O  O  O  X  X  X  O  O
  C5   X  X  X  X  O  O  O  O  O  O  O  X  X  X  O  O
  C6   O  O  O  O  O  O  O  O  O  O  X  X  X  X  O  O
  C7   O  O  O  O  O  O  O  O  O  O  X  X  X  X  O  O
```

**Read #20**: requested +12.003 s, answered +12.099 s · 75 open / 37 unavailable

```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  X  X  X  X  X  O  O
  C2   O  O  O  O  O  O  O  O  O  O  O  O  X  X  X  O
  C3   X  X  X  X  O  O  O  O  O  O  O  O  X  X  X  O
  C4   X  X  X  X  O  O  O  O  O  O  O  X  X  X  O  O
  C5   X  X  X  X  O  O  O  O  O  O  O  X  X  X  O  O
  C6   O  O  O  O  O  O  O  O  O  O  X  X  X  X  O  O
  C7   O  O  O  O  O  O  O  O  O  O  X  X  X  X  O  O
```

**Read #21**: requested +13.000 s, answered +13.860 s · 64 open / 48 unavailable

```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C2   O  O  O  O  O  O  O  O  O  O  X  X  X  X  X  O
  C3   X  X  X  X  O  O  O  O  O  O  X  X  X  X  X  O
  C4   X  X  X  X  O  O  O  O  O  O  X  X  X  X  X  O
  C5   X  X  X  X  O  O  O  O  O  O  X  X  X  X  X  O
  C6   O  O  O  O  O  O  O  O  O  O  X  X  X  X  X  O
  C7   O  O  O  O  O  O  O  O  O  O  X  X  X  X  X  O
```

**Read #60**: requested +52.001 s, answered +53.120 s · 61 open / 51 unavailable

```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C2   O  O  O  O  O  O  O  O  O  O  X  X  X  X  X  O
  C3   X  X  X  X  O  O  O  O  O  O  X  X  X  X  X  O
  C4   X  X  X  X  O  O  O  O  O  O  X  X  X  X  X  O
  C5   X  X  X  X  O  O  X  X  X  O  X  X  X  X  X  O
  C6   O  O  O  O  O  O  O  O  O  O  X  X  X  X  X  O
  C7   O  O  O  O  O  O  O  O  O  O  X  X  X  X  X  O
```

**Read #61**: requested +53.014 s, answered +53.270 s · 64 open / 48 unavailable

```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C2   O  O  O  O  O  O  O  O  O  O  X  X  X  X  X  O
  C3   X  X  X  X  O  O  O  O  O  O  X  X  X  X  X  O
  C4   X  X  X  X  O  O  O  O  O  O  X  X  X  X  X  O
  C5   X  X  X  X  O  O  O  O  O  O  X  X  X  X  X  O
  C6   O  O  O  O  O  O  O  O  O  O  X  X  X  X  X  O
  C7   O  O  O  O  O  O  O  O  O  O  X  X  X  X  X  O
```

**Read #62**: requested +54.016 s, answered +54.303 s · 61 open / 51 unavailable

```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C2   O  O  O  O  O  O  O  O  O  O  X  X  X  X  X  O
  C3   X  X  X  X  O  O  O  O  O  O  X  X  X  X  X  O
  C4   X  X  X  X  O  O  O  O  O  O  X  X  X  X  X  O
  C5   X  X  X  X  O  O  X  X  X  O  X  X  X  X  X  O
  C6   O  O  O  O  O  O  O  O  O  O  X  X  X  X  X  O
  C7   O  O  O  O  O  O  O  O  O  O  X  X  X  X  X  O
```

**Read #69**: requested +65.014 s, answered +65.327 s · 60 open / 52 unavailable

```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C2   O  O  O  O  O  O  O  O  O  O  X  X  X  X  X  O
  C3   X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C4   X  X  X  X  O  O  O  O  O  O  X  X  X  X  X  O
  C5   X  X  X  X  O  O  X  X  X  O  X  X  X  X  X  O
  C6   O  O  O  O  O  O  O  O  O  O  X  X  X  X  X  O
  C7   O  O  O  O  O  O  O  O  O  O  X  X  X  X  X  O
```

**Read #72**: requested +80.005 s, answered +80.636 s · 59 open / 53 unavailable

```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C2   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C3   X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C4   X  X  X  X  O  O  O  O  O  O  X  X  X  X  X  O
  C5   X  X  X  X  O  O  X  X  X  O  X  X  X  X  X  O
  C6   O  O  O  O  O  O  O  O  O  O  X  X  X  X  X  O
  C7   O  O  O  O  O  O  O  O  O  O  X  X  X  X  X  O
```

**Read #73**: requested +85.001 s, answered +85.327 s · 53 open / 59 unavailable

```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C2   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C3   X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C4   X  X  X  X  O  O  O  O  O  O  X  X  X  X  X  O
  C5   X  X  X  X  O  O  X  X  X  O  X  X  X  X  X  O
  C6   O  O  O  O  O  O  O  X  X  X  X  X  X  X  X  O
  C7   O  O  O  O  O  O  O  X  X  X  X  X  X  X  X  O
```

**Read #79**: requested +115.004 s, answered +115.192 s · 51 open / 61 unavailable

```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C2   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C3   X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C4   X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C5   X  X  X  X  O  O  X  X  X  X  X  X  X  X  X  O
  C6   O  O  O  O  O  O  O  X  X  X  X  X  X  X  X  O
  C7   O  O  O  O  O  O  O  X  X  X  X  X  X  X  X  O
```

**Read #94**: requested +190.013 s, answered +190.481 s · 54 open / 58 unavailable

```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C2   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C3   X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C4   X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C5   X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C6   O  O  O  O  O  O  O  X  X  X  X  X  X  X  X  O
  C7   O  O  O  O  O  O  O  X  X  X  X  X  X  X  X  O
```

**Read #112**: requested +280.006 s, answered +280.435 s · 51 open / 61 unavailable

```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C2   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C3   X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C4   X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C5   X  X  X  X  O  O  X  X  X  X  X  X  X  X  X  O
  C6   O  O  O  O  O  O  O  X  X  X  X  X  X  X  X  O
  C7   O  O  O  O  O  O  O  X  X  X  X  X  X  X  X  O
```

**Read #127**: requested +596.006 s, answered +596.119 s · 51 open / 61 unavailable

```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C2   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C3   X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C4   X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C5   X  X  X  X  O  O  X  X  X  X  X  X  X  X  X  O
  C6   O  O  O  O  O  O  O  X  X  X  X  X  X  X  X  O
  C7   O  O  O  O  O  O  O  X  X  X  X  X  X  X  X  O
```

**Read #128**: requested +597.005 s, answered +597.342 s · 57 open / 55 unavailable

```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C2   O  O  O  O  O  O  O  O  O  O  O  O  X  X  X  O
  C3   X  X  X  X  O  O  O  O  O  O  O  O  X  X  X  O
  C4   X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C5   X  X  X  X  O  O  X  X  X  X  X  X  X  X  X  O
  C6   O  O  O  O  O  O  O  X  X  X  X  X  X  X  X  O
  C7   O  O  O  O  O  O  O  X  X  X  X  X  X  X  X  O
```

**Read #135**: requested +604.013 s, answered +604.099 s · 57 open / 55 unavailable

```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C2   O  O  O  O  O  O  O  O  O  O  O  O  X  X  X  O
  C3   X  X  X  X  O  O  O  O  O  O  O  O  X  X  X  O
  C4   X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C5   X  X  X  X  O  O  X  X  X  X  X  X  X  X  X  O
  C6   O  O  O  O  O  O  O  X  X  X  X  X  X  X  X  O
  C7   O  O  O  O  O  O  O  X  X  X  X  X  X  X  X  O
```

**Read #136**: requested +605.000 s, answered +605.326 s · 56 open / 56 unavailable

```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  X  X  X  X  X  O  O
  C2   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C3   X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C4   X  X  X  X  O  O  O  O  O  X  O  X  X  X  O  O
  C5   X  X  X  X  O  O  X  X  X  X  O  X  X  X  X  O
  C6   O  O  O  O  O  O  O  X  X  X  X  X  X  X  X  O
  C7   O  O  O  O  O  O  O  X  X  X  X  X  X  X  O  O
```

**Read #137**: requested +606.002 s, answered +606.295 s · 57 open / 55 unavailable

```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  X  X  X  X  X  O  O
  C2   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C3   X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C4   X  X  X  X  O  O  O  O  O  X  O  X  X  X  O  O
  C5   X  X  X  X  O  O  X  X  X  X  O  X  X  X  X  O
  C6   O  O  O  O  O  O  O  X  X  X  X  X  X  X  O  O
  C7   O  O  O  O  O  O  O  X  X  X  X  X  X  X  O  O
```

**Read #138**: requested +607.001 s, answered +607.292 s · 58 open / 54 unavailable

```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  X  X  X  X  X  O  O
  C2   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C3   X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C4   X  X  X  X  O  O  O  O  O  X  O  X  X  X  O  O
  C5   X  X  X  X  O  O  X  X  X  X  O  X  X  X  O  O
  C6   O  O  O  O  O  O  O  X  X  X  X  X  X  X  O  O
  C7   O  O  O  O  O  O  O  X  X  X  X  X  X  X  O  O
```

**Read #196**: requested +665.007 s, answered +665.093 s · 58 open / 54 unavailable

```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  X  X  X  X  X  O  O
  C2   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C3   X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C4   X  X  X  X  O  O  O  O  O  X  O  X  X  X  O  O
  C5   X  X  X  X  O  O  X  X  X  X  O  X  X  X  O  O
  C6   O  O  O  O  O  O  O  X  X  X  X  X  X  X  O  O
  C7   O  O  O  O  O  O  O  X  X  X  X  X  X  X  O  O
```

**Read #197**: requested +690.000 s, answered +690.450 s · 64 open / 48 unavailable

```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  X  X  X  X  X  O  O
  C2   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C3   X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C4   X  X  X  X  O  O  O  O  O  X  O  X  X  X  O  O
  C5   X  X  X  X  O  O  X  X  X  X  O  X  X  X  O  O
  C6   O  O  O  O  O  O  O  O  O  O  X  X  X  X  O  O
  C7   O  O  O  O  O  O  O  O  O  O  X  X  X  X  O  O
```

**Read #198**: requested +720.005 s, answered +720.197 s · 60 open / 52 unavailable

```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  X  X  X  X  X  O  O
  C2   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C3   X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C4   X  X  X  X  O  O  O  O  O  O  O  X  X  X  O  O
  C5   X  X  X  X  O  O  X  X  X  O  O  X  X  X  O  O
  C6   O  O  O  O  O  O  O  X  X  X  X  X  X  X  O  O
  C7   O  O  O  O  O  O  O  X  X  X  X  X  X  X  O  O
```

**Read #202**: requested +840.016 s, answered +840.188 s · 55 open / 57 unavailable

```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  X  X  X  X  X  O  O
  C2   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C3   X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C4   X  X  X  X  O  O  O  O  X  X  X  X  X  X  O  O
  C5   X  X  X  X  O  O  X  X  X  X  X  X  X  X  O  O
  C6   O  O  O  O  O  O  O  X  X  X  X  X  X  X  O  O
  C7   O  O  O  O  O  O  O  X  X  X  X  X  X  X  O  O
```

**Read #204**: requested +900.006 s, answered +900.520 s · 55 open / 57 unavailable

```
      08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  C1   O  O  O  O  O  O  O  O  O  X  X  X  X  X  O  O
  C2   O  O  O  O  O  O  O  O  O  X  X  X  X  X  X  O
  C3   X  X  X  X  O  O  O  O  O  X  X  X  X  X  X  O
  C4   X  X  X  X  O  O  O  O  X  X  X  X  X  X  O  O
  C5   X  X  X  X  O  O  X  X  X  X  X  X  X  X  O  O
  C6   O  O  O  O  O  O  O  X  X  X  X  X  X  X  O  O
  C7   O  O  O  O  O  O  O  X  X  X  X  X  X  X  O  O
```

### Appendix D — Every court-hour (112 cells)

For each cell: state in the first published grid (#8), every change seen by the grid reads (with the bracketing reads: last read in the old state → first read in the new state, as request/answer offsets), public-record presence across the 9 booking reads, and the state at +900 s.

| Cell | First grid | Changes (old-state read → new-state read) | Public record in reads | At +900 s |
|---|---|---|---|---|
| C1 08:00 | open | — | none | open |
| C1 09:00 | open | — | none | open |
| C1 10:00 | open | — | none | open |
| C1 11:00 | open | — | none | open |
| C1 12:00 | open | — | none | open |
| C1 13:00 | open | — | none | open |
| C1 14:00 | open | — | none | open |
| C1 15:00 | open | — | none | open |
| C1 16:00 | open | — | none | open |
| C1 17:00 | unavailable | — | none | unavailable |
| C1 18:00 | unavailable | — | none | unavailable |
| C1 19:00 | unavailable | — | none | unavailable |
| C1 20:00 | unavailable | — | none | unavailable |
| C1 21:00 | unavailable | — | none | unavailable |
| C1 22:00 | open | open→unav #20 (req +12.003 s) → #21 (ans +13.860 s); unav→open #135 (req +604.013 s) → #136 (ans +605.326 s) | b3 b4 b5 b6 b7 b8 | open |
| C1 23:00 | open | — | none | open |
| C2 08:00 | open | — | none | open |
| C2 09:00 | open | — | none | open |
| C2 10:00 | open | — | none | open |
| C2 11:00 | open | — | none | open |
| C2 12:00 | open | — | none | open |
| C2 13:00 | open | — | none | open |
| C2 14:00 | open | — | none | open |
| C2 15:00 | open | — | none | open |
| C2 16:00 | open | — | none | open |
| C2 17:00 | open | open→unav #71 (req +75.011 s) → #72 (ans +80.636 s); unav→open #127 (req +596.006 s) → #128 (ans +597.342 s); open→unav #135 (req +604.013 s) → #136 (ans +605.326 s) | b6 b7 b9 | unavailable |
| C2 18:00 | open | open→unav #20 (req +12.003 s) → #21 (ans +13.860 s); unav→open #127 (req +596.006 s) → #128 (ans +597.342 s); open→unav #135 (req +604.013 s) → #136 (ans +605.326 s) | b3 b4 b5 b6 b7 b9 | unavailable |
| C2 19:00 | open | open→unav #20 (req +12.003 s) → #21 (ans +13.860 s); unav→open #127 (req +596.006 s) → #128 (ans +597.342 s); open→unav #135 (req +604.013 s) → #136 (ans +605.326 s) | b3 b4 b5 b6 b7 b9 | unavailable |
| C2 20:00 | unavailable | — | b1 b2 b3 b4 b5 b6 b7 b8 b9 | unavailable |
| C2 21:00 | unavailable | — | b1 b2 b3 b4 b5 b6 b7 b8 b9 | unavailable |
| C2 22:00 | unavailable | — | b1 b2 b3 b4 b5 b6 b7 b8 b9 | unavailable |
| C2 23:00 | open | — | none | open |
| C3 08:00 | unavailable | — | none | unavailable |
| C3 09:00 | unavailable | — | none | unavailable |
| C3 10:00 | unavailable | — | none | unavailable |
| C3 11:00 | unavailable | — | none | unavailable |
| C3 12:00 | open | — | none | open |
| C3 13:00 | open | — | none | open |
| C3 14:00 | open | — | none | open |
| C3 15:00 | open | — | none | open |
| C3 16:00 | open | — | none | open |
| C3 17:00 | open | open→unav #68 (req +60.004 s) → #69 (ans +65.327 s); unav→open #127 (req +596.006 s) → #128 (ans +597.342 s); open→unav #135 (req +604.013 s) → #136 (ans +605.326 s) | b6 b7 b9 | unavailable |
| C3 18:00 | open | open→unav #20 (req +12.003 s) → #21 (ans +13.860 s); unav→open #127 (req +596.006 s) → #128 (ans +597.342 s); open→unav #135 (req +604.013 s) → #136 (ans +605.326 s) | b4 b5 b6 b7 b9 | unavailable |
| C3 19:00 | open | open→unav #20 (req +12.003 s) → #21 (ans +13.860 s); unav→open #127 (req +596.006 s) → #128 (ans +597.342 s); open→unav #135 (req +604.013 s) → #136 (ans +605.326 s) | b4 b5 b6 b7 b9 | unavailable |
| C3 20:00 | unavailable | — | b1 b2 b3 b4 b5 b6 b7 b8 b9 | unavailable |
| C3 21:00 | unavailable | — | b1 b2 b3 b4 b5 b6 b7 b8 b9 | unavailable |
| C3 22:00 | unavailable | — | b1 b2 b3 b4 b5 b6 b7 b8 b9 | unavailable |
| C3 23:00 | open | — | none | open |
| C4 08:00 | unavailable | — | none | unavailable |
| C4 09:00 | unavailable | — | none | unavailable |
| C4 10:00 | unavailable | — | none | unavailable |
| C4 11:00 | unavailable | — | none | unavailable |
| C4 12:00 | open | — | none | open |
| C4 13:00 | open | — | none | open |
| C4 14:00 | open | — | none | open |
| C4 15:00 | open | — | none | open |
| C4 16:00 | open | open→unav #201 (req +810.009 s) → #202 (ans +840.188 s) | b9 | unavailable |
| C4 17:00 | open | open→unav #78 (req +110.004 s) → #79 (ans +115.192 s); unav→open #197 (req +690.000 s) → #198 (ans +720.197 s); open→unav #201 (req +810.009 s) → #202 (ans +840.188 s) | b6 b7 b8 b9 | unavailable |
| C4 18:00 | open | open→unav #20 (req +12.003 s) → #21 (ans +13.860 s); unav→open #135 (req +604.013 s) → #136 (ans +605.326 s); open→unav #201 (req +810.009 s) → #202 (ans +840.188 s) | b3 b4 b5 b6 b7 b8 b9 | unavailable |
| C4 19:00 | unavailable | — | none | unavailable |
| C4 20:00 | unavailable | — | none | unavailable |
| C4 21:00 | unavailable | — | none | unavailable |
| C4 22:00 | open | open→unav #20 (req +12.003 s) → #21 (ans +13.860 s); unav→open #135 (req +604.013 s) → #136 (ans +605.326 s) | b3 b4 b5 b6 b7 b8 | open |
| C4 23:00 | open | — | none | open |
| C5 08:00 | unavailable | — | none | unavailable |
| C5 09:00 | unavailable | — | none | unavailable |
| C5 10:00 | unavailable | — | none | unavailable |
| C5 11:00 | unavailable | — | none | unavailable |
| C5 12:00 | open | — | none | open |
| C5 13:00 | open | — | none | open |
| C5 14:00 | open | open→unav #59 (req +51.003 s) → #60 (ans +53.120 s); unav→open #60 (req +52.001 s) → #61 (ans +53.270 s); open→unav #61 (req +53.014 s) → #62 (ans +54.303 s); unav→open #93 (req +185.011 s) → #94 (ans +190.481 s); open→unav #111 (req +275.004 s) → #112 (ans +280.435 s) | b5 b6 b7 b8 b9 | unavailable |
| C5 15:00 | open | open→unav #59 (req +51.003 s) → #60 (ans +53.120 s); unav→open #60 (req +52.001 s) → #61 (ans +53.270 s); open→unav #61 (req +53.014 s) → #62 (ans +54.303 s); unav→open #93 (req +185.011 s) → #94 (ans +190.481 s); open→unav #111 (req +275.004 s) → #112 (ans +280.435 s) | b5 b6 b7 b8 b9 | unavailable |
| C5 16:00 | open | open→unav #59 (req +51.003 s) → #60 (ans +53.120 s); unav→open #60 (req +52.001 s) → #61 (ans +53.270 s); open→unav #61 (req +53.014 s) → #62 (ans +54.303 s); unav→open #93 (req +185.011 s) → #94 (ans +190.481 s); open→unav #111 (req +275.004 s) → #112 (ans +280.435 s) | b5 b6 b7 b8 b9 | unavailable |
| C5 17:00 | open | open→unav #78 (req +110.004 s) → #79 (ans +115.192 s); unav→open #197 (req +690.000 s) → #198 (ans +720.197 s); open→unav #201 (req +810.009 s) → #202 (ans +840.188 s) | b6 b7 b8 b9 | unavailable |
| C5 18:00 | open | open→unav #20 (req +12.003 s) → #21 (ans +13.860 s); unav→open #135 (req +604.013 s) → #136 (ans +605.326 s); open→unav #201 (req +810.009 s) → #202 (ans +840.188 s) | b3 b4 b5 b6 b7 b8 b9 | unavailable |
| C5 19:00 | unavailable | — | none | unavailable |
| C5 20:00 | unavailable | — | none | unavailable |
| C5 21:00 | unavailable | — | none | unavailable |
| C5 22:00 | open | open→unav #20 (req +12.003 s) → #21 (ans +13.860 s); unav→open #137 (req +606.002 s) → #138 (ans +607.292 s) | b3 b4 b5 b6 b7 b8 | open |
| C5 23:00 | open | — | none | open |
| C6 08:00 | open | — | none | open |
| C6 09:00 | open | — | none | open |
| C6 10:00 | open | — | none | open |
| C6 11:00 | open | — | none | open |
| C6 12:00 | open | — | none | open |
| C6 13:00 | open | — | none | open |
| C6 14:00 | open | — | none | open |
| C6 15:00 | open | open→unav #72 (req +80.005 s) → #73 (ans +85.327 s); unav→open #196 (req +665.007 s) → #197 (ans +690.450 s); open→unav #197 (req +690.000 s) → #198 (ans +720.197 s) | b6 b7 b8 b9 | unavailable |
| C6 16:00 | open | open→unav #72 (req +80.005 s) → #73 (ans +85.327 s); unav→open #196 (req +665.007 s) → #197 (ans +690.450 s); open→unav #197 (req +690.000 s) → #198 (ans +720.197 s) | b6 b7 b8 b9 | unavailable |
| C6 17:00 | open | open→unav #72 (req +80.005 s) → #73 (ans +85.327 s); unav→open #196 (req +665.007 s) → #197 (ans +690.450 s); open→unav #197 (req +690.000 s) → #198 (ans +720.197 s) | b6 b7 b8 b9 | unavailable |
| C6 18:00 | unavailable | — | b1 b2 b3 b4 b5 b6 b7 b8 b9 | unavailable |
| C6 19:00 | unavailable | — | b1 b2 b3 b4 b5 b6 b7 b8 b9 | unavailable |
| C6 20:00 | unavailable | — | b1 b2 b3 b4 b5 b6 b7 b8 b9 | unavailable |
| C6 21:00 | unavailable | — | b1 b2 b3 b4 b5 b6 b7 b8 b9 | unavailable |
| C6 22:00 | open | open→unav #20 (req +12.003 s) → #21 (ans +13.860 s); unav→open #136 (req +605.000 s) → #137 (ans +606.295 s) | b3 b4 b5 b6 b7 b8 | open |
| C6 23:00 | open | — | none | open |
| C7 08:00 | open | — | none | open |
| C7 09:00 | open | — | none | open |
| C7 10:00 | open | — | none | open |
| C7 11:00 | open | — | none | open |
| C7 12:00 | open | — | none | open |
| C7 13:00 | open | — | none | open |
| C7 14:00 | open | — | none | open |
| C7 15:00 | open | open→unav #72 (req +80.005 s) → #73 (ans +85.327 s); unav→open #196 (req +665.007 s) → #197 (ans +690.450 s); open→unav #197 (req +690.000 s) → #198 (ans +720.197 s) | b6 b7 b8 b9 | unavailable |
| C7 16:00 | open | open→unav #72 (req +80.005 s) → #73 (ans +85.327 s); unav→open #196 (req +665.007 s) → #197 (ans +690.450 s); open→unav #197 (req +690.000 s) → #198 (ans +720.197 s) | b6 b7 b8 b9 | unavailable |
| C7 17:00 | open | open→unav #72 (req +80.005 s) → #73 (ans +85.327 s); unav→open #196 (req +665.007 s) → #197 (ans +690.450 s); open→unav #197 (req +690.000 s) → #198 (ans +720.197 s) | b6 b7 b8 b9 | unavailable |
| C7 18:00 | unavailable | — | b1 b2 b3 b4 b5 b6 b7 b8 b9 | unavailable |
| C7 19:00 | unavailable | — | b1 b2 b3 b4 b5 b6 b7 b8 b9 | unavailable |
| C7 20:00 | unavailable | — | b1 b2 b3 b4 b5 b6 b7 b8 b9 | unavailable |
| C7 21:00 | unavailable | — | b1 b2 b3 b4 b5 b6 b7 b8 b9 | unavailable |
| C7 22:00 | open | open→unav #20 (req +12.003 s) → #21 (ans +13.860 s); unav→open #135 (req +604.013 s) → #136 (ans +605.326 s) | b3 b4 b5 b6 b7 b8 | open |
| C7 23:00 | open | — | none | open |

### Appendix E — Every 3-hour block that was fully open at some point

A block counts as open in a read when all three hours are open in that read. Windows are from the first read showing it open to the last; "closed by" is the first read that no longer shows it open.

| Block | Open windows |
|---|---|
| C1 08:00–11:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C1 09:00–12:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C1 10:00–13:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C1 11:00–14:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C1 12:00–15:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C1 13:00–16:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C1 14:00–17:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C2 08:00–11:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C2 09:00–12:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C2 10:00–13:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C2 11:00–14:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C2 12:00–15:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C2 13:00–16:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C2 14:00–17:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C2 15:00–18:00 | #8 (+1.462 s) … #71 (+75.207 s), closed by #72 (req +80.005 s)<br>#128 (+597.342 s) … #135 (+604.099 s), closed by #136 (req +605.000 s) |
| C2 16:00–19:00 | #8 (+1.462 s) … #20 (+12.099 s), closed by #21 (req +13.000 s)<br>#128 (+597.342 s) … #135 (+604.099 s), closed by #136 (req +605.000 s) |
| C2 17:00–20:00 | #8 (+1.462 s) … #20 (+12.099 s), closed by #21 (req +13.000 s)<br>#128 (+597.342 s) … #135 (+604.099 s), closed by #136 (req +605.000 s) |
| C3 12:00–15:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C3 13:00–16:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C3 14:00–17:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C3 15:00–18:00 | #8 (+1.462 s) … #68 (+60.084 s), closed by #69 (req +65.014 s)<br>#128 (+597.342 s) … #135 (+604.099 s), closed by #136 (req +605.000 s) |
| C3 16:00–19:00 | #8 (+1.462 s) … #20 (+12.099 s), closed by #21 (req +13.000 s)<br>#128 (+597.342 s) … #135 (+604.099 s), closed by #136 (req +605.000 s) |
| C3 17:00–20:00 | #8 (+1.462 s) … #20 (+12.099 s), closed by #21 (req +13.000 s)<br>#128 (+597.342 s) … #135 (+604.099 s), closed by #136 (req +605.000 s) |
| C4 12:00–15:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C4 13:00–16:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C4 14:00–17:00 | #8 (+1.462 s) … #201 (+810.401 s), closed by #202 (req +840.016 s) |
| C4 15:00–18:00 | #8 (+1.462 s) … #78 (+110.168 s), closed by #79 (req +115.004 s)<br>#198 (+720.197 s) … #201 (+810.401 s), closed by #202 (req +840.016 s) |
| C4 16:00–19:00 | #8 (+1.462 s) … #20 (+12.099 s), closed by #21 (req +13.000 s)<br>#198 (+720.197 s) … #201 (+810.401 s), closed by #202 (req +840.016 s) |
| C5 12:00–15:00 | #8 (+1.462 s) … #59 (+51.092 s), closed by #60 (req +52.001 s)<br>#61 (+53.270 s) … #61 (+53.270 s), closed by #62 (req +54.016 s)<br>#94 (+190.481 s) … #111 (+275.203 s), closed by #112 (req +280.006 s) |
| C5 13:00–16:00 | #8 (+1.462 s) … #59 (+51.092 s), closed by #60 (req +52.001 s)<br>#61 (+53.270 s) … #61 (+53.270 s), closed by #62 (req +54.016 s)<br>#94 (+190.481 s) … #111 (+275.203 s), closed by #112 (req +280.006 s) |
| C5 14:00–17:00 | #8 (+1.462 s) … #59 (+51.092 s), closed by #60 (req +52.001 s)<br>#61 (+53.270 s) … #61 (+53.270 s), closed by #62 (req +54.016 s)<br>#94 (+190.481 s) … #111 (+275.203 s), closed by #112 (req +280.006 s) |
| C5 15:00–18:00 | #8 (+1.462 s) … #59 (+51.092 s), closed by #60 (req +52.001 s)<br>#61 (+53.270 s) … #61 (+53.270 s), closed by #62 (req +54.016 s) |
| C5 16:00–19:00 | #8 (+1.462 s) … #20 (+12.099 s), closed by #21 (req +13.000 s) |
| C6 08:00–11:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C6 09:00–12:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C6 10:00–13:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C6 11:00–14:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C6 12:00–15:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C6 13:00–16:00 | #8 (+1.462 s) … #72 (+80.636 s), closed by #73 (req +85.001 s)<br>#197 (+690.450 s) … #197 (+690.450 s), closed by #198 (req +720.005 s) |
| C6 14:00–17:00 | #8 (+1.462 s) … #72 (+80.636 s), closed by #73 (req +85.001 s)<br>#197 (+690.450 s) … #197 (+690.450 s), closed by #198 (req +720.005 s) |
| C6 15:00–18:00 | #8 (+1.462 s) … #72 (+80.636 s), closed by #73 (req +85.001 s)<br>#197 (+690.450 s) … #197 (+690.450 s), closed by #198 (req +720.005 s) |
| C7 08:00–11:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C7 09:00–12:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C7 10:00–13:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C7 11:00–14:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C7 12:00–15:00 | #8 (+1.462 s) … still open at #204 (+900.520 s) |
| C7 13:00–16:00 | #8 (+1.462 s) … #72 (+80.636 s), closed by #73 (req +85.001 s)<br>#197 (+690.450 s) … #197 (+690.450 s), closed by #198 (req +720.005 s) |
| C7 14:00–17:00 | #8 (+1.462 s) … #72 (+80.636 s), closed by #73 (req +85.001 s)<br>#197 (+690.450 s) … #197 (+690.450 s), closed by #198 (req +720.005 s) |
| C7 15:00–18:00 | #8 (+1.462 s) … #72 (+80.636 s), closed by #73 (req +85.001 s)<br>#197 (+690.450 s) … #197 (+690.450 s), closed by #198 (req +720.005 s) |

### Appendix F — Runner stage timeline (every stage except the 203 PHASE3_EVIDENCE rows)

Rows that carry `eventAt` were stamped with the raw PC clock, which was 373 ms slow; the other rows use the corrected (trusted) clock. The "Corrected Manila" column adds 373 ms to raw-clock rows. `PHASE3_EVIDENCE` rows are summarised in Appendix A (one per grid read the runner processed).

| Corrected Manila | Offset | Stage | Worker | Detail |
|---|---:|---|---|---|
| 07:30:24.793 | −1775.207 s | RUN_STARTED |  |  |
| 07:30:24.800 | −1775.200 s | RUN_CONFIGURATION |  | bookingMethod=proofless · workerCount=7 · prewarmLeadMs=15000 · releaseMs=1790380800000 |
| 07:30:24.831 | −1775.169 s | PREPARING_BROWSER | A |  |
| 07:30:24.849 | −1775.151 s | PREPARING_BROWSER | B |  |
| 07:30:24.862 | −1775.138 s | PREPARING_BROWSER | C |  |
| 07:30:24.873 | −1775.127 s | PREPARING_BROWSER | D |  |
| 07:30:24.885 | −1775.115 s | PREPARING_BROWSER | E |  |
| 07:30:24.896 | −1775.104 s | PREPARING_BROWSER | F |  |
| 07:30:24.908 | −1775.092 s | PREPARING_BROWSER | G |  |
| 07:30:26.731 | −1773.269 s | BROWSER_READY | C | port=19446 |
| 07:30:26.775 | −1773.225 s | BROWSER_READY | F | port=19449 |
| 07:30:26.776 | −1773.224 s | BROWSER_READY | E | port=19448 |
| 07:30:26.778 | −1773.222 s | BROWSER_READY | B | port=19445 |
| 07:30:26.779 | −1773.221 s | BROWSER_READY | A | port=19444 |
| 07:30:26.780 | −1773.220 s | BROWSER_READY | D | port=19447 |
| 07:30:26.780 | −1773.220 s | BROWSER_READY | G | port=19450 |
| 07:30:26.780 | −1773.220 s | BROWSER_PREPARATION_OUTCOME | A | status=fulfilled · code=COMPLETED |
| 07:30:26.780 | −1773.220 s | BROWSER_PREPARATION_OUTCOME | B | status=fulfilled · code=COMPLETED |
| 07:30:26.781 | −1773.219 s | BROWSER_PREPARATION_OUTCOME | C | status=fulfilled · code=COMPLETED |
| 07:30:26.781 | −1773.219 s | BROWSER_PREPARATION_OUTCOME | D | status=fulfilled · code=COMPLETED |
| 07:30:26.781 | −1773.219 s | BROWSER_PREPARATION_OUTCOME | E | status=fulfilled · code=COMPLETED |
| 07:30:26.781 | −1773.219 s | BROWSER_PREPARATION_OUTCOME | F | status=fulfilled · code=COMPLETED |
| 07:30:26.781 | −1773.219 s | BROWSER_PREPARATION_OUTCOME | G | status=fulfilled · code=COMPLETED |
| 07:30:26.784 | −1773.216 s | PHASE3_AUTHORIZATION |  | candidateCount=9 · wave1Count=6 · standbyCount=1 · maxWave2=1 · maxRescue=1 · maxTotal=8 |
| 07:30:26.784 | −1773.216 s | PHASE3_CANDIDATE |  | court=4 · startTime=19:00 · endTime=22:00 · durationHours=3 · priority=1 · amount=2100 · rateStatus=VENUE_SCHEDULE · source=current venue schedule |
| 07:30:26.784 | −1773.216 s | PHASE3_CANDIDATE |  | court=5 · startTime=19:00 · endTime=22:00 · durationHours=3 · priority=2 · amount=2100 · rateStatus=VENUE_SCHEDULE · source=current venue schedule |
| 07:30:26.784 | −1773.216 s | PHASE3_CANDIDATE |  | court=1 · startTime=19:00 · endTime=22:00 · durationHours=3 · priority=3 · amount=2100 · rateStatus=VENUE_SCHEDULE · source=current venue schedule |
| 07:30:26.784 | −1773.216 s | PHASE3_CANDIDATE |  | court=2 · startTime=17:00 · endTime=20:00 · durationHours=3 · priority=4 · amount=2100 · rateStatus=VENUE_SCHEDULE · source=current venue schedule |
| 07:30:26.784 | −1773.216 s | PHASE3_CANDIDATE |  | court=2 · startTime=20:00 · endTime=23:00 · durationHours=3 · priority=5 · amount=2100 · rateStatus=VENUE_SCHEDULE · source=current venue schedule |
| 07:30:26.784 | −1773.216 s | PHASE3_CANDIDATE |  | court=3 · startTime=17:00 · endTime=20:00 · durationHours=3 · priority=6 · amount=2100 · rateStatus=VENUE_SCHEDULE · source=current venue schedule |
| 07:30:26.784 | −1773.216 s | PHASE3_CANDIDATE |  | court=3 · startTime=20:00 · endTime=23:00 · durationHours=3 · priority=7 · amount=2100 · rateStatus=VENUE_SCHEDULE · source=current venue schedule |
| 07:30:26.784 | −1773.216 s | PHASE3_CANDIDATE |  | court=6 · startTime=17:00 · endTime=20:00 · durationHours=3 · priority=8 · amount=2100 · rateStatus=VENUE_SCHEDULE · source=current venue schedule |
| 07:30:26.785 | −1773.215 s | PHASE3_CANDIDATE |  | court=6 · startTime=20:00 · endTime=23:00 · durationHours=3 · priority=9 · amount=2100 · rateStatus=VENUE_SCHEDULE · source=current venue schedule |
| 07:50:00.317 | −599.683 s | NETWORK_CLOCK_REFRESHED |  | checkpoint=T-10M · offsetMs=368 · roundTripMs=46 · deltaMs=13 · sampleCount=10 · spreadMs=14.6 · uncertaintyMs=23.7 |
| 07:58:00.050 | −119.950 s | PHASE3_WAVE1_PRICE | A | amount=2100 · source=current venue schedule · rateStatus=VENUE_SCHEDULE · capturedAt=2026-09-25T19:44:44.409Z |
| 07:58:00.052 | −119.948 s | PHASE3_WAVE1_PRICE | B | amount=2100 · source=current venue schedule · rateStatus=VENUE_SCHEDULE · capturedAt=2026-09-25T19:44:44.409Z |
| 07:58:00.052 | −119.948 s | PHASE3_WAVE1_PRICE | C | amount=2100 · source=current venue schedule · rateStatus=VENUE_SCHEDULE · capturedAt=2026-09-25T19:44:44.409Z |
| 07:58:00.054 | −119.946 s | PHASE3_WAVE1_PRICE | D | amount=2100 · source=current venue schedule · rateStatus=VENUE_SCHEDULE · capturedAt=2026-09-25T19:44:44.409Z |
| 07:58:00.054 | −119.946 s | PHASE3_WAVE1_PRICE | E | amount=2100 · source=current venue schedule · rateStatus=VENUE_SCHEDULE · capturedAt=2026-09-25T19:44:44.409Z |
| 07:58:00.055 | −119.945 s | PHASE3_WAVE1_PRICE | F | amount=2100 · source=current venue schedule · rateStatus=VENUE_SCHEDULE · capturedAt=2026-09-25T19:44:44.409Z |
| 07:58:00.058 | −119.942 s | PHASE3_FROZEN |  | candidateCount=9 · wave1Count=6 |
| 07:58:00.063 | −119.937 s | DIAGNOSTIC_ATTEMPT_ARMED | A | attemptId=core-A-official-1 · court=4 · startTime=19:00 · durationHours=3 |
| 07:58:00.064 | −119.936 s | DIAGNOSTIC_ATTEMPT_ARMED | B | attemptId=core-B-official-2 · court=5 · startTime=19:00 · durationHours=3 |
| 07:58:00.064 | −119.936 s | DIAGNOSTIC_ATTEMPT_ARMED | C | attemptId=core-C-official-3 · court=1 · startTime=19:00 · durationHours=3 |
| 07:58:00.064 | −119.936 s | DIAGNOSTIC_ATTEMPT_ARMED | D | attemptId=core-D-official-4 · court=2 · startTime=17:00 · durationHours=3 |
| 07:58:00.064 | −119.936 s | DIAGNOSTIC_ATTEMPT_ARMED | E | attemptId=core-E-official-5 · court=2 · startTime=20:00 · durationHours=3 |
| 07:58:00.064 | −119.936 s | DIAGNOSTIC_ATTEMPT_ARMED | F | attemptId=core-F-official-6 · court=3 · startTime=17:00 · durationHours=3 |
| 07:59:00.177 | −59.823 s | NETWORK_CLOCK_CONSENSUS |  | checkpoint=T-60S · offsetMs=372.6 · roundTripMs=43 · deltaMs=4.5 · sampleCount=10 · spreadMs=9.1 · uncertaintyMs=21.9 |
| 07:59:30.017 | −29.983 s | SECURITY_PREPARATION_STARTED | G | securitySource=FRESH_ACQUISITION · operation=security |
| 07:59:30.189 | −29.811 s | NETWORK_CLOCK_CONSENSUS |  | checkpoint=T-30S · offsetMs=373 · roundTripMs=43 · deltaMs=0.4 · sampleCount=10 · spreadMs=6.2 · uncertaintyMs=21.5 |
| 07:59:32.525 | −27.475 s | PHASE3_STANDBY_READY | G |  |
| 07:59:32.524 | −27.476 s | SECURITY_PREPARATION_COMPLETED | G | securitySource=FRESH_ACQUISITION · durationMs=2507 · operation=security |
| 07:59:45.036 | −14.964 s | SECURITY_PREPARATION_STARTED | A | attemptId=core-A-official-1 · securitySource=FRESH_ACQUISITION · operation=security |
| 07:59:45.037 | −14.963 s | SECURITY_PREPARATION_STARTED | B | attemptId=core-B-official-2 · securitySource=FRESH_ACQUISITION · operation=security |
| 07:59:45.037 | −14.963 s | SECURITY_PREPARATION_STARTED | C | attemptId=core-C-official-3 · securitySource=FRESH_ACQUISITION · operation=security |
| 07:59:45.038 | −14.962 s | SECURITY_PREPARATION_STARTED | D | attemptId=core-D-official-4 · securitySource=FRESH_ACQUISITION · operation=security |
| 07:59:45.038 | −14.962 s | SECURITY_PREPARATION_STARTED | E | attemptId=core-E-official-5 · securitySource=FRESH_ACQUISITION · operation=security |
| 07:59:45.038 | −14.962 s | SECURITY_PREPARATION_STARTED | F | attemptId=core-F-official-6 · securitySource=FRESH_ACQUISITION · operation=security |
| 07:59:48.354 | −11.646 s | SECURITY_PREPARATION_COMPLETED | E | attemptId=core-E-official-5 · securitySource=FRESH_ACQUISITION · durationMs=3316 · operation=security |
| 07:59:48.428 | −11.572 s | SECURITY_PREPARATION_COMPLETED | B | attemptId=core-B-official-2 · securitySource=FRESH_ACQUISITION · durationMs=3391 · operation=security |
| 07:59:48.715 | −11.285 s | SECURITY_PREPARATION_COMPLETED | F | attemptId=core-F-official-6 · securitySource=FRESH_ACQUISITION · durationMs=3677 · operation=security |
| 07:59:48.785 | −11.215 s | SECURITY_PREPARATION_COMPLETED | D | attemptId=core-D-official-4 · securitySource=FRESH_ACQUISITION · durationMs=3747 · operation=security |
| 07:59:48.860 | −11.140 s | SECURITY_PREPARATION_COMPLETED | C | attemptId=core-C-official-3 · securitySource=FRESH_ACQUISITION · durationMs=3823 · operation=security |
| 07:59:49.158 | −10.842 s | SECURITY_PREPARATION_COMPLETED | A | attemptId=core-A-official-1 · securitySource=FRESH_ACQUISITION · durationMs=4122 · operation=security |
| 08:00:00.006 | +0.006 s | PHASE3_WAVE1_STARTED | A | wave=WAVE_1 · attemptId=core-A-official-1 · court=4 · startTime=19:00 · endTime=22:00 · amount=2100 |
| 08:00:00.006 | +0.006 s | PHASE3_WAVE1_STARTED | B | wave=WAVE_1 · attemptId=core-B-official-2 · court=5 · startTime=19:00 · endTime=22:00 · amount=2100 |
| 08:00:00.006 | +0.006 s | PHASE3_WAVE1_STARTED | C | wave=WAVE_1 · attemptId=core-C-official-3 · court=1 · startTime=19:00 · endTime=22:00 · amount=2100 |
| 08:00:00.006 | +0.006 s | PHASE3_WAVE1_STARTED | D | wave=WAVE_1 · attemptId=core-D-official-4 · court=2 · startTime=17:00 · endTime=20:00 · amount=2100 |
| 08:00:00.006 | +0.006 s | PHASE3_WAVE1_STARTED | E | wave=WAVE_1 · attemptId=core-E-official-5 · court=2 · startTime=20:00 · endTime=23:00 · amount=2100 |
| 08:00:00.006 | +0.006 s | PHASE3_WAVE1_STARTED | F | wave=WAVE_1 · attemptId=core-F-official-6 · court=3 · startTime=17:00 · endTime=20:00 · amount=2100 |
| 08:00:00.001 | +0.001 s | CHECKOUT_FUNCTION_ENTERED | A | attemptId=core-A-official-1 · preparedContextAgeMs=10843 · securitySource=PREPARED_CONTEXT |
| 08:00:00.001 | +0.001 s | CHECKOUT_PRE_POST | A | attemptId=core-A-official-1 · preparedContextAgeMs=10843 · securitySource=PREPARED_CONTEXT · releaseLatenessMs=0.5 |
| 08:00:00.002 | +0.002 s | CHECKOUT_FUNCTION_ENTERED | B | attemptId=core-B-official-2 · preparedContextAgeMs=11574 · securitySource=PREPARED_CONTEXT |
| 08:00:00.002 | +0.002 s | CHECKOUT_PRE_POST | B | attemptId=core-B-official-2 · preparedContextAgeMs=11574 · securitySource=PREPARED_CONTEXT · releaseLatenessMs=1.3 |
| 08:00:00.002 | +0.002 s | CHECKOUT_FUNCTION_ENTERED | C | attemptId=core-C-official-3 · preparedContextAgeMs=11142 · securitySource=PREPARED_CONTEXT |
| 08:00:00.002 | +0.002 s | CHECKOUT_PRE_POST | C | attemptId=core-C-official-3 · preparedContextAgeMs=11142 · securitySource=PREPARED_CONTEXT · releaseLatenessMs=1.6 |
| 08:00:00.003 | +0.003 s | CHECKOUT_FUNCTION_ENTERED | D | attemptId=core-D-official-4 · preparedContextAgeMs=11218 · securitySource=PREPARED_CONTEXT |
| 08:00:00.003 | +0.003 s | CHECKOUT_PRE_POST | D | attemptId=core-D-official-4 · preparedContextAgeMs=11218 · securitySource=PREPARED_CONTEXT · releaseLatenessMs=1.8 |
| 08:00:00.003 | +0.003 s | CHECKOUT_FUNCTION_ENTERED | E | attemptId=core-E-official-5 · preparedContextAgeMs=11649 · securitySource=PREPARED_CONTEXT |
| 08:00:00.003 | +0.003 s | CHECKOUT_PRE_POST | E | attemptId=core-E-official-5 · preparedContextAgeMs=11649 · securitySource=PREPARED_CONTEXT · releaseLatenessMs=2 |
| 08:00:00.003 | +0.003 s | CHECKOUT_FUNCTION_ENTERED | F | attemptId=core-F-official-6 · preparedContextAgeMs=11288 · securitySource=PREPARED_CONTEXT |
| 08:00:00.003 | +0.003 s | CHECKOUT_PRE_POST | F | attemptId=core-F-official-6 · preparedContextAgeMs=11288 · securitySource=PREPARED_CONTEXT · releaseLatenessMs=2.2 |
| 08:00:00.009 | +0.009 s | PHASE3_DISPATCH | B | wave=WAVE_1 · attemptId=core-B-official-2 |
| 08:00:00.009 | +0.009 s | PHASE3_DISPATCH | C | wave=WAVE_1 · attemptId=core-C-official-3 |
| 08:00:00.008 | +0.008 s | CHECKOUT_HTTP_POST_INITIATED | B | attemptId=core-B-official-2 · initiationEvidence=PLAYWRIGHT_REQUEST_EVENT · releaseLatenessMs=7.7 · operation=checkout |
| 08:00:00.009 | +0.009 s | CHECKOUT_HTTP_POST_INITIATED | C | attemptId=core-C-official-3 · initiationEvidence=PLAYWRIGHT_REQUEST_EVENT · releaseLatenessMs=7.9 · operation=checkout |
| 08:00:00.010 | +0.010 s | PHASE3_DISPATCH | A | wave=WAVE_1 · attemptId=core-A-official-1 |
| 08:00:00.010 | +0.010 s | PHASE3_DISPATCH | D | wave=WAVE_1 · attemptId=core-D-official-4 |
| 08:00:00.010 | +0.010 s | PHASE3_DISPATCH | F | wave=WAVE_1 · attemptId=core-F-official-6 |
| 08:00:00.049 | +0.049 s | PHASE3_DISPATCH | E | wave=WAVE_1 · attemptId=core-E-official-5 |
| 08:00:00.009 | +0.009 s | CHECKOUT_HTTP_POST_INITIATED | A | attemptId=core-A-official-1 · initiationEvidence=PLAYWRIGHT_REQUEST_EVENT · releaseLatenessMs=8.6 · operation=checkout |
| 08:00:00.009 | +0.009 s | CHECKOUT_HTTP_POST_INITIATED | D | attemptId=core-D-official-4 · initiationEvidence=PLAYWRIGHT_REQUEST_EVENT · releaseLatenessMs=8.7 · operation=checkout |
| 08:00:00.010 | +0.010 s | CHECKOUT_HTTP_POST_INITIATED | F | attemptId=core-F-official-6 · initiationEvidence=PLAYWRIGHT_REQUEST_EVENT · releaseLatenessMs=9.5 · operation=checkout |
| 08:00:00.010 | +0.010 s | CHECKOUT_HTTP_POST_INITIATED | E | attemptId=core-E-official-5 · initiationEvidence=PLAYWRIGHT_REQUEST_EVENT · releaseLatenessMs=9.6 · operation=checkout |
| 08:00:06.921 | +6.921 s | CHECKOUT_RESPONSE_COMPLETED | C | attemptId=core-C-official-3 · networkDurationMs=6862 · statusCode=409 · dispatchState=RESPONSE_CAPTURED · failureCategory=ONDA_HTTP_STATUS_INVALID · errorHint=availability · responseSource=application · responseBytes=125 · bodyShape=80651c57074d · operation=ch |
| 08:00:06.945 | +6.945 s | PHASE3_SETTLED | C | wave=WAVE_1 · attemptId=core-C-official-3 · state=REJECTED |
| 08:00:10.028 | +10.028 s | CHECKOUT_RESPONSE_COMPLETED | A | attemptId=core-A-official-1 · networkDurationMs=10026 · statusCode=409 · dispatchState=RESPONSE_CAPTURED · failureCategory=ONDA_HTTP_STATUS_INVALID · errorHint=availability · responseSource=application · responseBytes=125 · bodyShape=80651c57074d · operation=c |
| 08:00:10.107 | +10.107 s | PHASE3_SETTLED | A | wave=WAVE_1 · attemptId=core-A-official-1 · state=REJECTED |
| 08:00:10.894 | +10.894 s | CHECKOUT_RESPONSE_COMPLETED | B | attemptId=core-B-official-2 · networkDurationMs=10891 · statusCode=409 · dispatchState=RESPONSE_CAPTURED · failureCategory=ONDA_HTTP_STATUS_INVALID · errorHint=availability · responseSource=application · responseBytes=125 · bodyShape=80651c57074d · operation=c |
| 08:00:10.940 | +10.940 s | PHASE3_SETTLED | B | wave=WAVE_1 · attemptId=core-B-official-2 · state=REJECTED |
| 08:00:11.936 | +11.936 s | CHECKOUT_RESPONSE_COMPLETED | D | attemptId=core-D-official-4 · networkDurationMs=11933 · statusCode=409 · dispatchState=RESPONSE_CAPTURED · failureCategory=ONDA_HTTP_STATUS_INVALID · errorHint=availability · responseSource=application · responseBytes=100 · bodyShape=80651c57074d · operation=c |
| 08:00:11.988 | +11.988 s | PHASE3_SETTLED | D | wave=WAVE_1 · attemptId=core-D-official-4 · state=REJECTED |
| 08:00:12.301 | +12.301 s | CHECKOUT_RESPONSE_COMPLETED | F | attemptId=core-F-official-6 · networkDurationMs=12297 · statusCode=409 · dispatchState=RESPONSE_CAPTURED · failureCategory=ONDA_HTTP_STATUS_INVALID · errorHint=availability · responseSource=application · responseBytes=100 · bodyShape=80651c57074d · operation=c |
| 08:00:12.357 | +12.357 s | PHASE3_SETTLED | F | wave=WAVE_1 · attemptId=core-F-official-6 · state=REJECTED |
| 08:00:13.999 | +13.999 s | CHECKOUT_RESPONSE_COMPLETED | E | attemptId=core-E-official-5 · networkDurationMs=13996 · statusCode=409 · dispatchState=RESPONSE_CAPTURED · failureCategory=ONDA_HTTP_STATUS_INVALID · errorHint=availability · responseSource=application · responseBytes=100 · bodyShape=80651c57074d · operation=c |
| 08:00:14.027 | +14.027 s | PHASE3_SETTLED | E | wave=WAVE_1 · attemptId=core-E-official-5 · state=REJECTED |
| 08:09:57.366 | +597.366 s | SECURITY_PREPARATION_STARTED | G | securitySource=FRESH_ACQUISITION · operation=security |
| 08:09:58.847 | +598.847 s | SECURITY_PREPARATION_COMPLETED | G | securitySource=FRESH_ACQUISITION · durationMs=1481 · operation=security |
| 08:09:59.117 | +599.117 s | SECURITY_PREPARATION_STARTED | G | securitySource=FRESH_ACQUISITION · operation=security |
| 08:10:00.313 | +600.313 s | SECURITY_PREPARATION_COMPLETED | G | securitySource=FRESH_ACQUISITION · durationMs=1196 · operation=security |
| 08:10:01.163 | +601.163 s | SECURITY_PREPARATION_STARTED | G | securitySource=FRESH_ACQUISITION · operation=security |
| 08:10:02.401 | +602.401 s | SECURITY_PREPARATION_COMPLETED | G | securitySource=FRESH_ACQUISITION · durationMs=1238 · operation=security |
| 08:10:03.140 | +603.140 s | SECURITY_PREPARATION_STARTED | G | securitySource=FRESH_ACQUISITION · operation=security |
| 08:10:04.698 | +604.698 s | SECURITY_PREPARATION_COMPLETED | G | securitySource=FRESH_ACQUISITION · durationMs=1558 · operation=security |
| 08:15:00.060 | +900.060 s | CRITICAL_PATH_SAVED |  | workerCount=6 · maxPrePostMs=2.15 · maxFetchInvokedMs=4.94 · maxBrowserRequestStartMs=7.74 · maxRequestObservedMs=9.61 |
| 08:15:00.069 | +900.069 s | PHASE3_OUTCOME |  | outcome=ALL_REJECTED_WAITING_FOR_REOPEN · verifiedCount=0 · unknownCount=0 · attemptCount=6 |
| 08:15:00.069 | +900.069 s | PROVIDER_TRACE_SAVED |  | status=SUCCESS · traceCount=6 · traceComplete=6 |
| 08:15:00.071 | +900.071 s | FAILED |  | code=ALL_REJECTED_WAITING_FOR_REOPEN |
| 08:15:00.120 | +900.120 s | PROCESS_EXIT |  | exitCode=1 |
| 08:15:00.119 | +900.119 s | RUN_DIAGNOSTIC_SUMMARY |  | finalCode=ALL_REJECTED_WAITING_FOR_REOPEN · aborted=false · retryCount=0 · verifiedHoldCount=0 · qrHandoffCount=0 · partialHolds=false · coreElapsedMs=724634 · slowestStages=CHECKOUT_RESPONSE_COMPLETED:13996,CHECKOUT_RESPONSE_COMPLETED:12297,CHECKOUT_RESPONSE_ |

PHASE3_EVIDENCE: 203 rows · UNRELEASED 7 · ACTIONABLE_FRESH 193 · FORENSIC_ONLY_OUTDATED_REQUEST 3 · cache MISS.

### Appendix G — Critical path per worker (ms after 08:00:00.000, trusted clock)

| Worker | Scheduler | Worker call | Transport | Pre-POST | Page evaluate [low–high] | fetch() | Chrome request start | Playwright request event | Headers [low–high] | Body complete | Node saw response | Node→page | fetch→Chrome | Event lag | Calibration |
|---|---:|---:|---:|---:|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---|
| A | 0.07 | 0.11 | 0.38 | 0.47 | 3.58 [3.14–4.01] | 3.58 | 6.21 | 8.6 | 10025.48 [10025.04–10025.91] | 10025.68 | 10027.7 | 3.11 | 2.63 | 2.39 | 8 samples ±0.44 ms, min RTT 0.79 ms, consistent |
| B | 0.07 | 1.21 | 1.24 | 1.26 | 4.03 [3.65–4.41] | 4.03 | 6.46 | 7.64 | 10890.73 [10890.35–10891.11] | 10891.03 | 10893.19 | 2.77 | 2.43 | 1.18 | 8 samples ±0.38 ms, min RTT 0.64 ms, consistent |
| C | 0.07 | 1.52 | 1.54 | 1.55 | 4.32 [3.91–4.72] | 4.32 | 6.94 | 7.92 | 6858.52 [6858.11–6858.92] | 6858.92 | 6920.37 | 2.77 | 2.62 | 0.98 | 8 samples ±0.41 ms, min RTT 0.7 ms, consistent |
| D | 0.07 | 1.75 | 1.76 | 1.77 | 4.69 [4.27–5.11] | 4.69 | 7.5 | 8.68 | 11931.29 [11930.87–11931.71] | 11932.39 | 11935.29 | 2.92 | 2.81 | 1.18 | 8 samples ±0.42 ms, min RTT 0.64 ms, consistent |
| E | 0.07 | 1.95 | 1.96 | 1.97 | 4.89 [4.49–5.3] | 4.89 | 7.3 | 9.61 | 13996.09 [13995.69–13996.5] | 13996.29 | 13998.61 | 2.92 | 2.41 | 2.31 | 8 samples ±0.4 ms, min RTT 0.63 ms, consistent |
| F | 0.07 | 2.14 | 2.15 | 2.15 | 4.94 [4.54–5.34] | 4.94 | 7.74 | 9.54 | 12297.74 [12297.34–12298.14] | 12297.94 | 12300 | 2.79 | 2.8 | 1.8 | 8 samples ±0.4 ms, min RTT 0.64 ms, consistent |

Header: wallToTrustedMs 373.16. Dispatch mode `node` for all six (renderer-resident dispatch was off).

### Appendix H — Provider trace and captured 409 evidence (all six)

| Worker | Status | Protocol | Reused | Send | Wait (browser) | Headers (Node) | Encoded bytes | Body bytes | x-vercel-id | Embedded ms (undocumented) | `Date` header | Cache | Message |
|---|---:|---|---|---:|---:|---:|---:|---:|---|---:|---|---|---|
| A | 409 | h2 | yes | 0.2 ms | 10018.3 ms | +10.026 s | 245 | 125 | `sin1::sin1::84v78-1790380800028-4689566155d4` | +28 | Sat, 26 Sep 2026 00:00:09 GMT | MISS | "This booking slot is temporarily unavailable because an event is already scheduled in this space." |
| B | 409 | h2 | yes | 0.2 ms | 10883.5 ms | +10.892 s | 244 | 125 | `sin1::sin1::mzbtl-1790380800029-20c2808df262` | +29 | Sat, 26 Sep 2026 00:00:10 GMT | MISS | "This booking slot is temporarily unavailable because an event is already scheduled in this space." |
| C | 409 | h2 | yes | 0.2 ms | 6848.7 ms | +6.861 s | 423 | 125 | `sin1::sin1::5lvvt-1790380800029-6a650f2b2586` | +29 | Sat, 26 Sep 2026 00:00:06 GMT | MISS | "This booking slot is temporarily unavailable because an event is already scheduled in this space." |
| D | 409 | h2 | yes | 0.1 ms | 11923.1 ms | +11.934 s | 399 | 100 | `sin1::sin1::9s7kg-1790380800034-7cb03a47ec66` | +34 | Sat, 26 Sep 2026 00:00:11 GMT | MISS | "This booking slot is no longer available (overlaps an existing booking)." |
| E | 409 | h2 | yes | 0.1 ms | 13988.6 ms | +13.997 s | 399 | 100 | `sin1::sin1::4gnwj-1790380800029-5710976d19e7` | +29 | Sat, 26 Sep 2026 00:00:13 GMT | MISS | "This booking slot is no longer available (overlaps an existing booking)." |
| F | 409 | h2 | yes | 0.2 ms | 12289 ms | +12.299 s | 398 | 100 | `sin1::sin1::cxzbc-1790380800041-41b5ab2f430a` | +41 | Sat, 26 Sep 2026 00:00:12 GMT | MISS | "This booking slot is no longer available (overlaps an existing booking)." |

All six: content-type application/json, server Vercel, cache-control "public, max-age=0, must-revalidate", x-matched-path /api/bookings/public-checkout, no x-request-id, no server-timing, no cf-ray. Body shape (all six) `{ success: boolean, error: string }`, shape fingerprint 80651c57074d…; sanitized fingerprints cfc065c77f68 and 4ec90bfc413d (one per message). DevTools Network was enabled at +73.6–74.2 ms, after every POST had left.

### Appendix I — Frozen authorization at T−2 min (all nine candidates)

Frozen 2026-09-25T23:58:00.055Z (07:58:00.055 Manila), authorized 2026-09-25T23:30:26.783Z. Budgets: Wave 2 1, Rescue 1, total 8. Concurrent Wave 2: true. Rescue enabled: true. Standby: G. Fingerprint aa73196bdae886ed…

| Priority | Court | Time | Amount | Wave 1 | Wave 2 | Rescue | Rate source | Assigned |
|---:|---:|---|---:|---|---|---|---|---|
| 1 | 4 | 19:00–22:00 | PHP 2100 | yes | no | yes | VENUE_SCHEDULE 700/700/700 (captured 2026-09-25T19:44:44.409Z) | Wave 1 worker A |
| 2 | 5 | 19:00–22:00 | PHP 2100 | yes | no | yes | VENUE_SCHEDULE 700/700/700 (captured 2026-09-25T19:44:44.409Z) | Wave 1 worker B |
| 3 | 1 | 19:00–22:00 | PHP 2100 | yes | no | yes | VENUE_SCHEDULE 700/700/700 (captured 2026-09-25T19:44:44.409Z) | Wave 1 worker C |
| 4 | 2 | 17:00–20:00 | PHP 2100 | yes | no | yes | VENUE_SCHEDULE 700/700/700 (captured 2026-09-25T19:44:44.409Z) | Wave 1 worker D |
| 5 | 2 | 20:00–23:00 | PHP 2100 | yes | no | yes | VENUE_SCHEDULE 700/700/700 (captured 2026-09-25T19:44:44.409Z) | Wave 1 worker E |
| 6 | 3 | 17:00–20:00 | PHP 2100 | yes | no | yes | VENUE_SCHEDULE 700/700/700 (captured 2026-09-25T19:44:44.409Z) | Wave 1 worker F |
| 7 | 3 | 20:00–23:00 | PHP 2100 | no | yes | yes | VENUE_SCHEDULE 700/700/700 (captured 2026-09-25T19:44:44.409Z) | standby G (Wave 2 / Rescue) |
| 8 | 6 | 17:00–20:00 | PHP 2100 | no | yes | yes | VENUE_SCHEDULE 700/700/700 (captured 2026-09-25T19:44:44.409Z) | standby G (Wave 2 / Rescue) |
| 9 | 6 | 20:00–23:00 | PHP 2100 | no | yes | yes | VENUE_SCHEDULE 700/700/700 (captured 2026-09-25T19:44:44.409Z) | standby G (Wave 2 / Rescue) |

### Appendix J — Network clock evidence (every sample)

**T-10M** captured 2026-09-25T23:50:00.316Z: offset +368.1 ms · uncertainty ±23.7 ms · spread 14.6 ms · RTT min/median/max 46/53/69 ms · kept 10/10 · quality GOOD · best host time.google.com

| Host | Offset | RTT | Kept |
|---|---:|---:|---|
| time.google.com | +372.2 ms | 58 ms | yes |
| time1.google.com | +371.1 ms | 55 ms | yes |
| time2.google.com | +371.4 ms | 55 ms | yes |
| time3.google.com | +368.9 ms | 60 ms | yes |
| time4.google.com | +378.5 ms | 69 ms | yes |
| time.google.com | +367.4 ms | 46 ms | yes |
| time1.google.com | +363.8 ms | 51 ms | yes |
| time2.google.com | +365.1 ms | 50 ms | yes |
| time3.google.com | +364.5 ms | 51 ms | yes |
| time4.google.com | +364.2 ms | 50 ms | yes |

**T-60S** captured 2026-09-25T23:59:00.176Z: offset +372.6 ms · uncertainty ±21.9 ms · spread 9.1 ms · RTT min/median/max 42.999755859375/47/70 ms · kept 10/10 · quality GOOD · best host time.google.com

| Host | Offset | RTT | Kept |
|---|---:|---:|---|
| time.google.com | +371.9 ms | 53 ms | yes |
| time1.google.com | +371.7 ms | 54 ms | yes |
| time2.google.com | +380.5 ms | 70 ms | yes |
| time3.google.com | +380.8 ms | 61 ms | yes |
| time4.google.com | +374.6 ms | 49 ms | yes |
| time.google.com | +372 ms | 43 ms | yes |
| time1.google.com | +372.2 ms | 43 ms | yes |
| time2.google.com | +371.8 ms | 45 ms | yes |
| time3.google.com | +373 ms | 43 ms | yes |
| time4.google.com | +373.3 ms | 43 ms | yes |

**T-30S** captured 2026-09-25T23:59:30.188Z: offset +373.0 ms · uncertainty ±21.5 ms · spread 6.2 ms · RTT min/median/max 43/49.5/56 ms · kept 10/10 · quality GOOD · best host time2.google.com

| Host | Offset | RTT | Kept |
|---|---:|---:|---|
| time.google.com | +372.2 ms | 55 ms | yes |
| time1.google.com | +375.8 ms | 49 ms | yes |
| time2.google.com | +375.1 ms | 49 ms | yes |
| time3.google.com | +375.2 ms | 50 ms | yes |
| time4.google.com | +372.6 ms | 56 ms | yes |
| time.google.com | +373.3 ms | 44 ms | yes |
| time1.google.com | +369.5 ms | 51 ms | yes |
| time2.google.com | +373 ms | 43 ms | yes |
| time3.google.com | +373 ms | 43 ms | yes |
| time4.google.com | +369.7 ms | 50 ms | yes |

### Appendix K — Durable journals for the six Wave 1 attempts

| Journal (short) | Court | Time | State | Failure code | Diagnostic | Updated (raw PC clock) |
|---|---:|---|---|---|---|---|
| 3bdfd94f13f8 | 4 | 19:00–22:00 | rejected | ONDA_HTTP_STATUS_INVALID | 409 http-rejection application hint=availability | 2026-09-26T00:00:10.098Z |
| 470dee9ddd31 | 3 | 17:00–20:00 | rejected | ONDA_HTTP_STATUS_INVALID | 409 http-rejection application hint=availability | 2026-09-26T00:00:12.340Z |
| 537091d24854 | 2 | 17:00–20:00 | rejected | ONDA_HTTP_STATUS_INVALID | 409 http-rejection application hint=availability | 2026-09-26T00:00:11.974Z |
| 8fe7dd4c799d | 1 | 19:00–22:00 | rejected | ONDA_HTTP_STATUS_INVALID | 409 http-rejection application hint=availability | 2026-09-26T00:00:06.927Z |
| acb3d5e05b3f | 5 | 19:00–22:00 | rejected | ONDA_HTTP_STATUS_INVALID | 409 http-rejection application hint=availability | 2026-09-26T00:00:10.932Z |
| bcd026ea16c7 | 2 | 20:00–23:00 | rejected | ONDA_HTTP_STATUS_INVALID | 409 http-rejection application hint=availability | 2026-09-26T00:00:14.012Z |

### Appendix L — Every app command on 26 September (booking-runs)

| Started (Manila) | Ended | Label | Outcome | Lines | Summary line |
|---|---|---|---|---:|---|
| 03:43:10.479 | 03:43:12.625 | blockAudit (blockAudit) | complete | 7 | 2026-09-28 · Open 0 · Blocked 14 · Unreleased 98 · Unknown 0. No hold or booking was created. |
| 03:44:46.944 | 03:44:47.035 | saving (saving) | complete | 4 | Run finished: complete |
| 06:36:10.409 | 06:36:12.661 | blockAudit (blockAudit) | complete | 7 | 2026-09-28 · Open 0 · Blocked 14 · Unreleased 98 · Unknown 0. No hold or booking was created. |
| 06:37:51.099 | 06:38:05.144 | prepare (API DRY) | complete | 65 | Process completed: apiRun · dry · exit code 0 |
| 06:38:17.556 | 06:38:23.979 | full (API LIVE) | aborted | 42 | API run needs attention · USER_ABORT · 5759 ms total · +3624 ms since prior stage |
| 07:29:20.051 | 07:29:22.540 | blockAudit (blockAudit) | complete | 7 | 2026-09-28 · Open 0 · Blocked 14 · Unreleased 98 · Unknown 0. No hold or booking was created. |
| 07:29:48.679 | 07:30:01.512 | prepare (API DRY) | complete | 65 | Process completed: apiRun · dry · exit code 0 |
| 07:30:23.853 | 08:14:59.817 | full (API LIVE) | failed | 275 | API run needs attention · ALL_REJECTED_WAITING_FOR_REOPEN · 2675260 ms total · +1 ms since prior stage |
| 08:21:00.168 | 08:21:01.333 | blockAudit (blockAudit) | complete | 7 | 2026-09-28 · Open 51 · Blocked 61 · Unreleased 0 · Unknown 0. No hold or booking was created. |
| 08:21:06.724 | 08:21:07.508 | blockAudit (blockAudit) | complete | 7 | 2026-09-29 · Open 0 · Blocked 0 · Unreleased 112 · Unknown 0. No hold or booking was created. |

Times are the app's raw PC clock (+8 h), about 0.37 s behind true time.

