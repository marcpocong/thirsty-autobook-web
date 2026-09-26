# Winning playbook: legitimate plays beyond the millisecond race

Date: 2026-09-25 (Manila). Companion to `RED_TEAM_RELEASE_ANALYSIS_2026-09-24.md`. Same evidence labels: **PROVEN**, **SUGGESTED**, **SPECULATIVE** and **UNKNOWN**. No live request was made. The only outside sources were two public web searches about the venue.

## 1. The reframe

We have been treating 08:00 as a speed contest over a full board. The evidence says it is closer to this: **a small public remainder of the Saturday inventory, contested by organized groups, with part of the board never public at all.** You don't win that by being 5 ms faster. You win by one of three routes:

- getting the inventory **without racing** (the venue channel);
- racing for inventory **nobody else is aiming at** (contrarian and predictive targeting);
- being ready for the **second and third releases**: unpaid-hold expiry at ~T+10 min, cancellations over the next two days, and new courts.

## 2. New evidence from this pass

| # | Finding | Level | Why it matters |
| --- | --- | --- | --- |
| 1 | **One checkout can contain several courts.** Onda's normal UI books "two courts in one checkout" (Phase 7), and the request carries an `items[]` list with `session_1`, `session_2`…. The limit is three consecutive hours *per checkout* | PROVEN (platform feature used by this repo) | A single customer can take several courts × 3 h with **one** request. Broad acquisition by one actor needs a handful of requests, not ~18 sessions. The earlier report's LOW confidence was too low |
| 2 | **Courts 1, 2 and 7 had byte-identical 16-hour rows** at 08:06 on 09-24: `O P P P O P P P P P P P P P P X` | PROVEN (grid) | Independent customers don't produce identical rows on three courts. One organizer does: a venue program, or one group booking 3 courts per checkout |
| 3 | **17 booking records existed on 09-26 before it was published** (C1=5, C2=3, C5=3, C6=3, C7=3 at T-10 min) | PROVEN (counts only; cells not logged) | **A pre-release booking channel exists.** Some of the evening may never have been public at 08:00. The ordinary customer race may be over a much smaller remainder than the grid suggests |
| 4 | **08:00 Manila is exactly 00:00 UTC** | PROVEN (arithmetic) | Release is most likely a server-side UTC date rollover with a 2-day horizon, not a scheduled event. The edge cache then decides when *readers* see it. That explains fast "date absent" answers at +0.26 s and +0.76 s, and why direct POSTs have a seconds-long head start over UI users (SUGGESTED) |
| 5 | **Holds last about 10 minutes from creation.** On 09-12 our hold showed 09:58 remaining at 08:00:14.684 | SUGGESTED (±1 s) | Unpaid holds created at T+6…30 s expire at **T+10:06…T+10:40**. That is a predictable second release |
| 6 | **Saturday morning was still open 6.5 minutes after the 09-24 release**: Court 6 08:00–13:00 (3 valid 3-hour ranges) | PROVEN | If a morning block is acceptable, it could have been booked by hand at 08:06 |
| 7 | **The venue has 7 courts with "eight more on the way"** and runs its own programs (DISCO days) | Public web sources (see chat) | New courts mean new, briefly uncontested inventory. Programs are a likely source of record-less rectangles |
| 8 | **The bot goes blind the day a new court appears.** `availability-parser.ts:104` throws `AVAILABILITY_UNKNOWN_COURT` for any unknown space ID; `TimeSchema` rejects hours outside 08:00–23:00 | PROVEN (code) | Slot Watch, Wave 2, Rescue and the block audit all fail on exactly the day the supply grows |
| 9 | **Wave 2 burns itself without sending.** `select()` sets `wave2Selected=true` before `dispatchAdaptive` spends 6–7 s refreshing security. It then returns silently when a newer read has arrived (reads run every 1 s). The one wave is gone | PROVEN (code path); live effect UNKNOWN | Wave 2, the tool for the richest window (T+6–10 s), will very likely fire zero times |

> **Status on `main` (2026-09-26).** Finding 9's silent return no longer exists: after security preparation, a Wave 2 or Rescue attempt re-checks the newest actionable read and continues while the same range is still fully open (`97452c3`), and every attempt abandoned before its POST is logged with a reason (`PHASE3_ADAPTIVE_SKIPPED`). An attempt proven never sent no longer spends Rescue or total send budget (`488552a`). Still true: `select()` marks the single Wave 2 as used when it selects, so a Wave 2 abandoned for a genuine reason (range taken, stale or unpriced evidence) still spends the wave. Of the P4 fixes, "accept the newest read" is now done in code.

## 3. Ranked plays

### Tier 0: win without racing (largest expected gain)

**P1. Use the channel the pre-release bookings come from.** Finding 3 proves some bookings exist before public release. Ask the venue directly:

- whether regular groups can hold a standing weekly slot;
- whether bookings can be made via staff before release;
- whether you can **organize a recurring session** yourself (open play, social league, clinic) that the venue schedules.

Organizers get rectangles; racers get fragments.

*Tomorrow (Sat 09-26) is the lost date.* Go to the venue, or message the front desk, and ask what is running on Courts 3–5 and who runs the Courts 1/2/7 sessions. Ten minutes of in-person reconnaissance can settle what weeks of telemetry can't. If it's a community open play, **joining** it or co-organizing may be the fastest legitimate "win".

**P2. Widen what counts as a win, where genuinely acceptable.** Each of these, if acceptable, turns a lost race into a sure booking:

- A Saturday **morning** block (Finding 6).
- A **weekday** evening (the 09-12 Monday win came at slow UI speed).
- **The new courts** (P7).
- **A 2-hour block you can extend to 3 hours** (P5).

This is a question for your group, not for the code.

### Tier 1: race smarter

**P3. Contrarian, predicted-grid targeting.**

- **Predict the release grid before 08:00:** all cells, minus the positions of pre-release records (readable publicly before release), minus the weekday's block calendar.
- **Move the freeze from T-2 min to about T-45 s**, with a final bookings read at T-50 s. That catches late pre-release records; arming takes about 11–26 ms, so there is time.
- **Aim Wave 1 as a barbell:** one attempt on the most-wanted range (the lottery ticket), plus two or three on acceptable ranges that are least likely to be targeted.
- **Against multi-court groups** (Findings 1–2), choose times their tiles don't cover, rather than trying to be faster than them on the same tile.

**P4. Make Wave 2 actually work.** It is the best time-based edge you have. On 09-23 the first grid arrived at T+6 s with every non-blocked cell still open, and humans need 5–10 s more to click through. Fixes:

- Only use up the wave once a send is recorded (Finding 9).
- Keep standby contexts at most 20 s old from T−12 s to T+30 s.
- Accept "the newest read still shows the range open" instead of "same read".
- Turn on concurrent Wave 2 within the hold budget.

One more reason it matters: **multi-court checkouts are all-or-nothing** (SUGGESTED). When a group's bundle fails because one cell was taken, its other courts stay open, and a working Wave 2 collects them.

**P5. Anchor and extend (only if 2 hours is a genuine fallback).** A 2-hour range survives much longer than a 3-hour one. With a 2-hour hold on court X, the third hour can come from **either side** (the hour before or after), in any later window: T+10 min expiry, or cancellations. Two back-to-back checkouts on one court are allowed; the Special Friday plan did it. The chance of completing 3 hours roughly doubles compared with needing one exact extra hour. Not legitimate if you'd drop the 2 hours when the extension fails. Then it's holding inventory to deny it.

**P6. Predictive Rescue for the T+10 min second release.**

- Public bookings expose each record's **status** (pending or confirmed). At T+9:30, every *pending* record covering an acceptable 3-hour range is a candidate to reopen.
- Its first-seen time plus 10 minutes predicts **when**. Multi-court bundles expire **together**, so reopens arrive in clusters.
- Pre-refresh security, read every second around each predicted instant, and send on the first OPEN read.
- Today's Rescue (30 s cadence plus a forced 6–7 s refresh after detection) cannot compete for this.

**P7. Be first on the new courts.**

- Make observation tolerant: record unknown space IDs and hours instead of throwing. Checkout stays strict.
- Alert when a new court appears, and add it to authorized candidates once the operator confirms it.
- In the first weeks, bots with hardcoded court lists (like ours today) and unaware humans leave new courts under-contested.

**P8. The two-day long tail.** Between Thursday 08:00 and Saturday afternoon, bookings change: cancellations, failed payments, programs released, reschedules. A low-rate read-only watcher (every 2–5 minutes, public endpoints) that **pushes a phone notification** when a full acceptable 3-hour range appears lets a human book in 30 seconds through the normal UI. Few people are watching at 23:00 on a Friday. How often it pays off is UNKNOWN, so measure it this week.

### Tier 2: stop self-inflicted losses

**P9.** These each cost a win on their own:

- a real, distinct identity for Worker B;
- Wave 1 prices from a published same-weekday grid;
- a payment-ready person, with a backup, at 08:00 and at T+10 min;
- a **wired** connection with nobody streaming, and a jitter check at 07:59 (Wi-Fi jitter of 10–50 ms now dwarfs Phase 1's 5 ms);
- a connection warmed by one legitimate read at about T−3 s;
- the PC's sleep and updates disabled;
- the 00:00 UTC boundary confirmed by rehearsal.

## 4. Six free rehearsals before the next Saturday release

**A date is released every day at 08:00.** Saturday 10-03 opens Thursday 10-01. Before that: **Fri 09-25, Sat 09-26, Sun 09-27, Mon 09-28, Tue 09-29, Wed 09-30**. Every one is a free, low-contention rehearsal. Run the full pipeline in **shadow mode**:

- real Slot Watch;
- real standby security preparation;
- real Wave 2 and Rescue *decisions*, logged with timestamps;
- the POST replaced by a no-op.

Add a genuinely wanted weekday booking if the group has one. By Thursday you would know:

- the cache behavior and whether the MISS gate can ever open;
- where the publication boundary falls on uncached reads;
- read latency by second;
- expiry timing and clustering at T+10 min;
- when pre-release records appear;
- whether the fixed Wave 2 and Rescue fire, and how fast.

That is six releases of evidence, compared with one per week today.

Do now, before today's 08:00 (read-only):

1. Log public records' **court, start, end and status** (never names or IDs).
2. Read every second from T+9:30 to T+11:30.
3. Read 09-26 once: are Courts 3–5 still unavailable with no record? Are Courts 1/2/7 identical, pending or confirmed?
4. Open the 09-24 first-grid file (`.local/slot-watch/`) and the freeze file to check which cells the 17 pre-release records covered.

## 5. Things that look clever but I would not do

- **Sending before 08:00 so it arrives at 00:00 UTC.** It breaks your own rule. A too-early 409 is conclusive and ends that target.
- **Multi-court or multi-account holds to deny others, then dropping the surplus.** Same harm you object to; account risk.
- **Cache-busting query parameters to see the grid early.** It pushes load onto the origin at its worst moment.
- **Per-hour proof calls (`is-slot-available`) as a fast freshness probe.** Many POSTs in the rush for little gain.
- **Anything aimed at avoiding Onda noticing automation.** Ask whether automation is allowed instead; a banned account loses every future release.

## 6. Corrections to the 09-24 analysis

- **Broad acquisition by one actor** was rated LOW because it "would need ~18 concurrent sessions". Multi-court checkouts (Finding 1) and the identical rows (Finding 2) make **LOW–MEDIUM** fairer. Still, the pre-release channel or a venue program explains the same rows without any race at all.
- **The "too early" risk** raised in chat is probably small. If the provider evaluates the horizon when it processes a request, and requests queue for 17–28 s, evaluation happens well after 00:00 UTC. It is still unverified; rehearsals will show it.
- **Wave 2** was described as late. As implemented it is worse: it will most likely never send (Finding 9).
