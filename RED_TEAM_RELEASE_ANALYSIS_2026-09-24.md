# Red-team analysis: why the 08:00 release keeps being lost

Date: 2026-09-24. Scope: `main` at `4a9cb2c`, the three live release reports (09-12, 09-23, 09-24), the Phase 1–3 reports, and the Phase 3 runner code. No live request of any kind was made for this analysis.

Evidence labels used throughout:

- **PROVEN**: directly shown by recorded evidence.
- **SUGGESTED**: the evidence points this way but doesn't exclude alternatives.
- **SPECULATIVE**: consistent with the evidence, with no direct support.
- **UNKNOWN**: the evidence cannot decide it.

---

## 1. Executive diagnosis

**Short version:** in the two losses we have evidence for, a faster competitor is not the best-supported explanation. The best-supported explanation is that **the targets were chosen blind, before publication, and landed on cells that were probably never bookable**. After that come three structural weaknesses that would matter even with feasible targets:

1. the Wave 1 portfolio concentrates correlated risk;
2. the adaptive paths (Wave 2, Reopen Rescue) are too slow, by seconds rather than milliseconds, to win what is left;
3. the 3-hour requirement collapses much faster than the cell count suggests.

The evidence:

1. **09-24 (Saturday 09-26 target). All four targets were probably infeasible at publication (SUGGESTED, strongly).** The 08:06:30 grid breaks down exactly into rectangles that carry *no public booking record*:
   - Courts 3–5, 08:00–19:00 (36 cells).
   - All seven courts at 23:00 (7 cells).
   - Court 6, 17:00–19:00 (3 cells).

   That is 36 + 7 + 3 = 46, exactly the 46 "unavailable without public booking" cells. A customer's temporary hold shows up in the public bookings list as a *pending* record; the 09-23 report established that hold state as `P`. These cells are not `P`. They also cover **08:00–12:00 on courts 3–5, while 08:00 stayed OPEN on courts 1, 2, 6 and 7 at 08:06**. No demand-driven competitor grabs the least-wanted morning hour on exactly three adjacent courts and leaves the same hour open everywhere else. Targets A, B and C (Courts 3/4/5, 15:00–18:00) sit entirely inside that rectangle. Target D (Court 6, 15:00–18:00) needs 17:00, which is inside the Court 6 17:00–19:00 rectangle. **If those rectangles existed at publication, zero of four targets were ever bookable, and dispatch speed was irrelevant.**
2. **09-23 (Friday special). PROVEN infeasible.** The run report shows the configured plan could not be satisfied from the moment the date was published (21 cells unavailable with no record, in the same rectangular pattern).
3. **09-12 (Monday 09-14 target). We won**, with the slow UI path: first click at +1.6 s, final Onda action at +9.5 s, hold verified at +14.7 s. On the one day we have a success, being roughly 9 seconds "slow" did not lose.

So across the three live releases with evidence:

- The one success happened at UI speed.
- Both failures are best explained by target infeasibility.

**There is not yet a single release where we can show that a feasible target was lost to a faster request.** The belief "they win because they are faster" has no direct support in our own data.

That doesn't make speed irrelevant. It means we have been optimizing the variable we can measure (local dispatch ms) rather than the variables that decided the outcome:

- **Target feasibility at publication.**
- **Portfolio correlation.** On 09-24 every attempt shared the same time window and three of four shared one block.
- **Adaptive latency.** Wave 2 and Rescue respond in *seconds to tens of seconds* (Section 4).
- **Range survival.** A 3-hour range dies when any one of its three cells goes.

**About the "competitor blankets 13:00–24:00" theory.** On 09-24 the afternoon/evening unavailability decomposes into:

- (a) venue-style rectangles with no record;
- (b) `P` records on Courts 1, 2, 6 and 7, some of which **existed before release**: the T-10 min public-booking read found 17 records (C1=5, C2=3, C5=3, C6=3, C7=3) *before the date was published*;
- (c) `P` records created after release, whose layout is consistent with many independent 3-hour checkouts. The one-hour leftovers at 08:00 and 12:00 are exactly what 3-hour tiles starting at 09:00 and 13:00 leave behind.

A single blanketing bot is **not needed** to explain the observed board. It is also **not excluded**: public data doesn't reveal who owns a record. Section 11 gives the experiments that would decide it.

---

## 2. Competitor architecture hypothesis

The simplest legitimate architecture that explains everything observed, without assuming an exploit:

| Component | Hypothesis | Confidence |
| --- | --- | --- |
| Population | Not one competitor but a **market**: regular customers using the normal UI (10–15 s to a hold, as our own 09-12 UI run took), plus possibly one or more scripted clients | MEDIUM |
| Pre-release allocation | Some inventory is allocated **before** public release (records visible at T-10 min on an unpublished date: recurring or venue-entered bookings, members, staff) | HIGH that records exist pre-release (PROVEN by counts). UNKNOWN which cells or why |
| Venue blocks | Rectangular, record-less unavailability (events, coaching, maintenance, closing hour) | MEDIUM–HIGH for the 09-24 rectangles; PROVEN pattern on 09-23 |
| Scripted fast checkout at T≈0 | A client that POSTs checkout for 3-hour blocks at popular start times near 08:00:00 | SPECULATIVE. Plausible, since we built one, but no direct evidence |
| Broad acquisition by one actor (many holds, later released) | Many sessions each holding a 3-hour block, most released unpaid at ~T+10 min | LOW. Would need ~18 concurrent sessions for the 55 `P` cells. Pending→confirmed conversion on 09-23 (many `C` by 08:20) points to real paying customers |
| Better release-boundary knowledge | Knows the provider's real acceptance instant | UNKNOWN. Our data can't locate the boundary yet (Section 3) |
| Hosting near the origin | Runs close to the serving region (see `x-vercel-id`), saving tens to hundreds of ms per request versus Manila | UNKNOWN. Measurable now |
| Connection reuse / warm TLS | Standard in any browser or HTTP client | HIGH that they have it; UNKNOWN whether we lack it (Phase 2 will tell us) |
| Cherry-picking then releasing | Holds broadly, keeps what it wants | LOW. The reopen fragments on 09-23 are consistent with ordinary abandonment |

If I were building a competing bot to produce this board, I would not need speed at all. I would need three things:

1. **Knowledge of which cells are blocked.** Ask the venue, or learn it from past weeks.
2. **Targets on courts and times that are actually released.**
3. **A process that works from the published grid** rather than a pre-committed guess.

A patient human with those three already beats a precise bot aimed at blocked cells.

---

## 3. Failure-chain reconstruction (09-24)

| Time (Manila) | What happened | Evidence level |
| --- | --- | --- |
| 07:35 | 4 browsers prepared; B excluded (duplicate customer ID) → 3 attempts | PROVEN |
| 07:50 (T-10 min) | Availability: target date absent. Public bookings for the **unpublished** date: 17 records across courts (C3=0, C4=0) | PROVEN |
| 07:58 (T-2 min) | Freeze: A, C, D. The "no conflicting public record" check passed | PROVEN. The check cannot see record-less blocks, so passing it was **not evidence of feasibility** |
| 07:58–07:59:45 | Courts 3–5 had **zero** public records before release. If courts were ranked by public emptiness, that ranking **selects blocked courts**, because blocks are invisible to that endpoint | Adverse selection is SUGGESTED. Whether it actually drove the court choice is UNKNOWN |
| 07:59:45–07:59:52 | Security prewarm A/C/D, 6.0–7.3 s each | PROVEN |
| 07:59:59 | Nothing observable | — |
| 08:00:00.000 | Nominal release. The provider's actual acceptance boundary is UNKNOWN | UNKNOWN |
| +100 to +104 ms | 3 POSTs leave the browser (corrected clock; error bound ≈ ±20 ms per Phase 1 clock notes) | PROVEN (± clock bound) |
| +100 ms to first second | Provider state UNKNOWN. Slot Watch reads requested at +0.26 s and +0.76 s answered *quickly* **without the target date**. Fast answers during a rush suggest cache or stale views. They may also mean the publication boundary was later than 08:00:00.3 | Observations PROVEN; interpretation UNKNOWN (cache status wasn't recorded then) |
| +1.26 s, +6.27 s | Two reads time out at 5 s | PROVEN |
| +1 s to +30 s | Provider saturated: reads 3.7–6+ s for about 30 s on both 09-23 and 09-24, then about 100 ms | PROVEN |
| +11.29 s → +15.74 s | First published grid captured (old Slot Watch v1). **Its contents are in `.local/slot-watch/` and haven't been analyzed in any report.** It is the single most important existing artifact (Section 5) | Exists; content UNKNOWN to this analysis |
| +17.5 / +23.0 / +28.3 s | 409 `availability` for A, C, D. **Response order A, C, D is the exact reverse of send order D, C, A**, at roughly even 5.4 s spacing | PROVEN. Meaning UNKNOWN (3 samples) |
| +5 min, +6.5 min | 11/112 open; 3 valid 3-hour ranges (all Court 6, 08:00–13:00); 0 valid ranges starting at or after 13:00 | PROVEN |
| ~+10 min | Expected expiry of any unpaid holds created in the first seconds (10-minute hold) | Hold length SUGGESTED by the QR countdown ≤ 10 min. Reopens on 09-24 UNKNOWN (no reads then) |
| After +15 min | Whether the Courts 3–5 rectangle ever reopened | UNKNOWN, and **decisive**: a block persists for hours, a hold expires in ~10 min |

A point about the 17–28 s rejections: if Courts 3–5 were blocked from publication, rejecting them should be cheap, yet it still took 17–28 s. That **suggests** the latency is a shared bottleneck *before or around* evaluation (queue, concurrency limit, DB pool), not contention on our particular rows. Reads were also 3.7–6 s in the same window, which points the same way. It does not tell us whether that bottleneck is FIFO (arrival order decides) or unordered.

---

## 4. Ranking of our weaknesses

In order of expected relative impact. No fabricated percentages.

### W1. Targets are chosen blind to record-less blocks, and possibly biased toward them. **Highest impact.**
- **Why it matters:** an infeasible target has zero chance whatever the latency. It probably decided both recent losses.
- **Phases 1–3:** not fixed. Phase 3 lets the operator enter 21 candidates, but nothing tells the operator which cells tend to be blocked at publication. Pre-release evidence (`NO_PUBLIC_BOOKING_DATE_UNRELEASED`) can't see blocks. The "no public record" check is at best uninformative and at worst an adverse-selection signal.
- **Live-proven?** The problem is proven on 09-23 and strongly suggested on 09-24. No fix exists yet.

### W2. Correlated Wave 1 portfolio. **High.**
- **Why:** on 09-24 all attempts used 15:00–18:00, and three of four sat in one block rectangle. That is effectively one bet placed three times. On 09-23 every combination depended on 19:00–22:00.
- **Phases 1–3:** Phase 3 warns about common times but doesn't change them. Worker B's identity problem (still open per Phase 1 notes) cut coverage further.
- **Live-proven?** The failure is proven. A diversified portfolio is untested.

### W3. Wave 2 responds seconds late, not milliseconds. **High, if targets are feasible.**
- **Why:** on 09-23 the first grid (answered +6.0 s) showed every non-blocked cell open. Other players' holds only began appearing in the read sent at +6.3 s and passed 18 by the read sent at +9.9 s. There is a window of roughly 6–10 s in which the *published grid* is known and most of the market hasn't landed. Wave 2 is built for exactly that window. As implemented, it is late:
  - **Standby security goes stale before Wave 2 can use it.** Standby contexts are prepared at **T-30 s** (`desktop-runner.ts:815`). The transport reuses a prepared context only if it is **≤ 20 s old** (`browser-session-transport.ts:164`). At T+6 s a standby context is 36 s old, so Wave 2 pays a **fresh 6–7 s security acquisition after seeing the OPEN grid**. Its POST lands around T+13 s, in the middle of the human crowd.
  - **Default mode waits for Wave 1 to settle.** Unless `concurrentWave2` is on, Wave 2 waits for Wave 1, which took 17–28 s.
  - **The cache gate may never open.** Wave 2 requires `x-vercel-cache: MISS` with no positive `Age`. If the availability endpoint is normally served from edge cache, Wave 2 **never fires**. UNKNOWN until the next trace.
- **Live-proven?** No. Never exercised live.

### W4. Reopen Rescue cannot compete at the likely reopen time. **High, if reopen opportunities exist.**
- **Why:** the likely reopen is ~T+10 min (10-minute unpaid holds). The design is too slow there on three counts:
  - **Detection latency up to 30 s.** Slot Watch reads availability only **every 30 s** from +5.5 min to +15 min (`slot-watch.ts:51`).
  - **Security preparation after detection.** Rescue then calls `prepareCheckoutContext(true)`, which forces a new 6–7 s acquisition *after* the reopen is seen.
  - **Livelock at higher cadence.** After preparing, `dispatchAdaptive` aborts if `session.latest.observation.seq !== evidenceSeq`. If you raise the cadence to 1 s (you should), a newer read almost always arrives during the 6–7 s refresh. The Rescue then aborts, and the next selection forces another refresh: **a livelock where Rescue never sends.** At today's 30 s cadence it doesn't trigger, which is the only reason it hasn't shown up.

  Net: a competitor polling at 1 s with a prepared session beats our Rescue by roughly 7 to 37 s.
- **Live-proven?** No.

### W5. The 3-hour requirement collapses faster than cell counts suggest. **Medium–high, structural.**
- **Why:** see Section 6. A court's evening (13:00–24:00, 11 cells, 9 three-hour windows) loses **every** 3-hour range when just 3 well-placed cells go, which is 27% of its cells. Ordinary 3-hour bookers starting at mixed times do this without intending to.
- **Phases 1–3:** Phase 3 selects by full range (correct). No metrics exist yet.

### W6. Provider queue and bottleneck behavior is unknown. **Unknown impact, possibly large.**
- **Why:** if the bottleneck is FIFO on arrival, arrival order matters. Our +100 ms (old) against an unknown competitor offset could then matter for *contested feasible* cells. If it's per-client serialized (the reversed, evenly spaced responses hint at it, weakly), then several workers from one machine are fewer independent chances than they look.
- **Phases 1–3:** Phase 2 captures what's needed to start deciding. Nothing is decided yet.

### W7. Rate assumptions in the proofless request. **Medium, easy fix.**
- **Why:** 09-24 assumed PHP 2,000; the published price was PHP 2,100. The hint said `availability`, so it wasn't the cause this time. But it is a latent rejection cause on a *feasible* target, which is exactly the case we care about.
- **Phase 3:** takes Wave 2/Rescue prices from the grid (good). Wave 1 still depends on operator-entered rates.

### W8. Local dispatch latency. **Low now.**
- **Why:** old +100 ms, new ~5–12 ms offline. The clock's own error bound is about ±20 ms. The network to the edge is tens of ms. The provider then takes 11–28 s. Phase 1 very likely solved the part we control. Its live proof is pending and cheap to collect, but further gains here won't change outcomes.

---

## 5. Ethical ways to beat the competitor

### BEFORE NEXT RELEASE (no new trace needed)

1. **Mine the evidence you already have. Zero risk, highest value.**
   - Open the 09-24 Slot Watch v1 file (first published grid, read requested +11.29 s). Were Courts 3–5 08:00–19:00 and Court 6 17:00–19:00 already unavailable-without-record in it? If yes, W1 is confirmed for 09-24.
   - Check the T-10/T-2 public-booking payloads in the run trace. If only counts were logged, start logging record **court/start/end/status** (no identity fields) from now on.
   - **09-26 hasn't happened yet.** A single read-only availability and public-bookings read of 09-26 now (hours after release) settles it. If Courts 3–5 are still unavailable with no record, the rectangle is a block, not a hold.
2. **Ask the venue.** It is legitimate and the highest-leverage action available:
   - Which courts and hours are blocked on which weekdays?
   - Are some bookings allocated before public release (members, recurring reservations)?
   - Is there a maximum-hours or maximum-holds-per-customer policy?
   - **Can you get a standing or recurring 3-hour reservation?** If your real goal is "a 3-hour court every week", a recurring booking with the venue beats every bot, including theirs.
   - Also confirm that automated booking is permitted under Onda's and the venue's terms. That is the one legitimacy question this whole system depends on.
3. **Rebuild the Wave 1 portfolio.** Details in Section 6.
   - Exclude cells with any record-less unavailability history on that weekday.
   - Diversify **time windows**, not just courts.
   - Only authorize candidates you would genuinely pay for.
4. **Fix Worker B with a real, distinct person's own customer identity**, or plan for six workers. Never copy or fabricate an identity.
5. **Verify Wave 1 prices** from the most recent *published* same-weekday grid (already public, read-only), rather than an assumed rate model.
6. **Fix the adaptive-path defects** (code changes, testable offline):
   - **Standby freshness:** keep each standby context **≤ 20 s old across T−5 s…T+30 s**. Prepare at about T−12 s, then do scheduled genuine refreshes every ~15 s until T+30 s or until the worker is used. That is a handful of normal page security acquisitions per standby worker, not a bypass.
   - **Replace the `seq === evidenceSeq` guard** in `dispatchAdaptive` with: "the newest answered actionable observation still shows the full candidate range OPEN at acceptable prices". Newer confirming evidence should not cancel a send.
   - **Rescue:** stop forcing a refresh after detection. Pre-refresh Rescue-authorized workers from **T+9:30 to T+11:30** on a ~15 s schedule and use the fresh context immediately.
   - **Slot Watch cadence:** read once per second from **T+9:30 to T+11:30** (the hold-expiry wave for holds created in the first ~30 s). Consider the same at T+20 min for second-generation holds. That is ~1 req/s from one client, the same rate you already use in the first minute.
7. **Decide `concurrentWave2` deliberately.** Without it, Wave 2 waits 17–28 s and is effectively useless in the contested window. With it, you risk more than one hold, so pair it with the hold budget in Section 6.
8. **Keep Phase 1 as-is.** Don't spend more time on it (Section 12).

### AFTER NEXT RELEASE EVIDENCE

- Decide the cache question. If availability reads during the release are mostly HIT, the MISS-only gate makes Wave 2 dead code. Then re-evaluate using `Age` and the cost asymmetry: acting on a stale OPEN costs one 409; missing a real OPEN costs the booking. The real safety constraint is the **hold budget**, not the freshness gate.
- Read `x-vercel-id` for the edge and function regions. If the function region is far from Manila, a competitor hosted near it has a structural latency edge. Moving your *whole* legitimate client (one stable host, not rotating IPs) is a legitimate option, but a datacenter IP may trigger more Turnstile challenges. Only consider it if (a) the data shows arrival order matters and (b) it's allowed.
- Check whether connections were reused on the Wave 1 POSTs. If not, add one legitimate lightweight read-only request from each worker page at about T−3 s to keep its connection warm.
- Look at response spacing across up to 7 workers. Even spacing in some fixed order suggests serialization. If it's per client, more same-machine workers give little.
- Replay Wave 2 decisions offline against the recorded grids: would it have fired, when, and on what?

### LONGER-TERM

- Phase 4 range-survival intelligence (Section 10), especially the **"feasible at publication" probability per court, hour and weekday**, which is the one historical signal likely to matter.
- A weekly habit: after each release, rebuild the block calendar and re-rank candidates.

---

## 6. Opening-race strategy (Wave 1)

**The math of 3-hour ranges.** For a court whose open cells form maximal runs of lengths L₁, L₂, …, the number of valid k-hour ranges is Σ max(0, Lᵢ − k + 1).

- Evening 13:00–24:00 is 11 cells. It holds 9 possible 3-hour ranges and 10 possible 2-hour ranges.
- Unavailable cells at 15:00, 18:00 and 21:00 leave runs of 2, 2, 2 and 2. That is **zero** 3-hour ranges from three lost cells.
- In general, ⌊11/3⌋ = 3 cells per court destroy every evening 3-hour range; ⌊11/2⌋ = 5 destroy every 2-hour range. Across 7 courts, **21 of 77 evening cells (27%)** is enough to eliminate every evening 3-hour option.
- Ordinary 3-hour checkouts starting at 13:00, 16:00 and 19:00 leave isolated single hours at 22:00 or 23:00. Tiles starting at 09:00 and 13:00 leave 08:00 and 12:00 alone, which is exactly the 09-24 leftover pattern.

Worked numbers for 09-24:

| | At 08:06:30 (observed) | If only the 46 record-less cells were unavailable at publication (hypothetical) |
| --- | ---: | ---: |
| Open cells | 11 | 66 |
| Valid 2-hour ranges | 4 | — |
| Valid 3-hour ranges, all day | 3 (Court 6, 08–13) | 50 |
| Valid 3-hour ranges starting 13:00–21:00 | 0 | 30 (24 of them on Courts 1, 2, 7) |
| Our 4 targets feasible | 0 | **0** |

In the hypothetical, 30 afternoon/evening 3-hour ranges existed at publication, and our plan hit none of them. **The portfolio was aimed at the four courts where 15:00–18:00 was blocked.**

**Recommended Wave 1 structure** (legitimate intent is the constraint):

- **Hold budget first.** The largest number of simultaneous holds you would genuinely pay for, or promptly cancel through Onda's normal flow, is your Wave 1 + concurrent Wave 2 ceiling. If surplus holds can't be cancelled and you won't pay for them, a 7-way Wave 1 for a 1-booking objective does exactly what you suspect the competitor of doing: parking inventory for 10 minutes. Don't.
- **3–4 Wave 1 attempts**, chosen as follows:
  - **Different time windows**, e.g. one each around 14:00, 16:00 and 19:00 starts.
  - **Courts with no record-less unavailability history on that weekday.**
  - **No two attempts sharing a cell.** Cell-disjoint means failures are as independent as the board allows.
  - **Not all on the most popular start time.** A 3-hour range whose cells are *slightly* less popular (e.g. 14:00–17:00 rather than 15:00–18:00) survives tiling longer.
- **Pre-authorize 10–15 more exact candidates for Wave 2/Rescue**, covering every 3-hour range you'd genuinely accept. Wave 2 can then act on the published grid.
- **Standby: 2–3 workers**, kept security-fresh (Section 5).
- **Two-hour candidates only if you'd genuinely accept two hours.** If you would, they widen the feasible set a lot. If not, leave them out.

---

## 7. Adaptive strategy (Wave 2)

- **Trigger:** the first *complete* published grid, from a request started after release, that shows an authorized candidate range fully OPEN at acceptable per-hour prices.
- **Evidence required:**
  - date published;
  - all 112 cells present;
  - prices present;
  - request start ≥ release;
  - it is the newest answered request.

  The cache rule is decided after the next trace: MISS if MISS is common; otherwise HIT with a bounded, known `Age` (e.g. ≤ 1 s).
- **Staleness protection:** a candidate is eligible only if **no later answered read** shows any of its cells unavailable. A late answer from an earlier request never overrides a newer one (already implemented). For the 87↔73 flip-flop seen on 09-23 (alternating views at ~80 ms), require that the *newest two* answered reads agree on the range when they came from overlapping requests. That costs ≤ 1 s at the ~100 ms read latency seen after T+12 s.
- **Speed:**
  - standby contexts pre-fresh (≤ 20 s);
  - `concurrentWave2` on;
  - selection → POST in milliseconds;
  - prioritize candidates on courts and times that are *not* correlated with any Wave 1 attempt still in flight.
- **Budget:** one wave is fine, provided an empty or ineligible grid doesn't consume it (already so). Total holds ≤ the hold budget.

---

## 8. Reopen strategy

Premise: unpaid holds expire at ~10 min. Holds created at T+6…T+30 s therefore expire around **T+10:06…T+10:30**, a *predictable second release*. Is it valuable? UNKNOWN. On 09-23 the evening reopens seen by 08:20 were **fragments** (single hours plus one 2-hour range), with no 3-hour evening range. Measure before relying on it.

The safest fast design:

1. **Arm at T+9:30:**
   - Slot Watch at 1 s cadence until T+11:30.
   - Rescue-authorized workers refreshed every ~15 s so a ≤ 20 s-old genuine context always exists.
   - Confirm all earlier attempts are settled (they will be by then).
2. **Trigger:**
   - A candidate range observed unavailable earlier, then **fully OPEN** in the newest answered actionable read, with prices from that read.
   - No verified hold, no UNKNOWN, no in-flight attempt.
3. **Send immediately with the pre-fresh context.** No refresh after detection.
4. **Guard:** before the POST, the newest actionable read must still show the range OPEN (not "must be the same seq").
5. **One Rescue per candidate per unavailable epoch** (already implemented), within a small total budget.
6. **Measure the whole time** (Section 9), so the next release tells you whether reopen is a real channel for 3-hour ranges.

---

## 9. Telemetry we are still missing

Exact list:

1. **Public booking record structure:** per record court, start, end and status (pending or confirmed). **No names, IDs or contact fields.** Capture at T-10 min, T-2 min, and each post-release bookings read. This yields record-length histograms, pre-release allocation, and pending→confirmed conversion.
2. **Cell classification per read:** OPEN, PENDING-record, CONFIRMED-record, or UNAVAILABLE-no-record.
3. **Persistence of UNAVAILABLE-no-record cells:** single reads at +30 min, +2 h, and T+24 h. Block versus hold is decided here.
4. **Cache status and `Age` on every availability read**, especially the fast answers in the first second. Phase 2 does this. Verify the headers are actually exposed cross-origin.
5. **The HTTP `Date` header on read responses.** Its 1 s ticks, sampled at known local times before release (not at release), bound the edge clock offset.
6. **Per-POST:**
   - protocol and connection reuse;
   - connect and TLS times (null if reused);
   - send and wait;
   - `x-vercel-id` edge and function regions;
   - `server-timing`.

   Phase 2 captures these. Confirm the late enable catches them on 17–28 s responses (it should).
7. **Inter-response spacing and order against send order**, with 4–7 workers.
8. **First appearance of each `P` record** against our 409 timestamps. If competitor records appear in reads *before* our 409s, the provider decided before it answered.
9. **Wave 2/Rescue internals:** evidence seq, evidence age at POST, security-context age at POST, and the reason for every skipped selection (freshness, seq, budget, conflict).
10. **Machine-side:** wall-clock step events, process priority change timestamps, and CPU load at T±2 s.

---

## 10. Phase 4 changes

**Add:**

- **Range survival analysis with interval censoring.** Per candidate range and per court: first-observed state and its **snapshot interval** [request start, response end], not a point in time. Also:
  - last-seen-OPEN and first-seen-unavailable brackets;
  - reopen brackets;
  - OPEN duration after reopen (interval-censored);
  - counts of valid 2-hour and 3-hour ranges per snapshot;
  - longest run per court;
  - courts retaining any 3-hour range;
  - "time until last acceptable 3-hour range disappears" and "first acceptable 3-hour range reappears", both as intervals.
- **Feasible-at-publication rate** per court × hour × weekday. This is the most decision-relevant statistic you can build.
- **Block calendar:** record-less unavailability that persists past T+30 min, by weekday.
- **Pre-release allocation map:** from record structure (item 1 in Section 9).
- **Reopen cluster detection:** P→OPEN transitions whose brackets overlap in the T+10 min window; cluster size; whether they return as complete ranges.
- **Deterministic replay** of Phase 3 selection against recorded grids, with the *actual* observation latencies and the proposed standby/rescue timing. This is how you validate Section 5 fixes without a live release.

**Change:**

- **Replace the T+100 ms / 250 ms / 500 ms / 1 s buckets with "state as of the earliest snapshot interval that covers or follows T+x".** Release reads take 3.7–6 s, so the state at T+100 ms is unobservable, and the fastest early answers may be cache. Report `UNOBSERVED` or `CENSORED` rather than interpolating. Keep T+2 s and T+5 s only if a MISS read's interval actually covers them.
- **Advisor output:** a ranked list of candidate ranges with their feasibility history and correlation groups (shared cells, shared block pattern). Advisory only; operator authorizes. This is already your intent.

**Remove or defer:**

- Correlation/shared-risk *modeling* beyond simple co-occurrence counts. With 3 releases you have anecdotes, not statistics. Revisit after about 10 releases per weekday.
- Anything that estimates competitor identity or ownership. Public data can't support it, and it drifts toward profiling other customers.

**Temporary inventory capture analysis:** yes, add it, framed as range survival plus record-status tracking. It is the only way to test the "broad temporary acquisition" hypothesis. Its signature is many PENDING records appearing together, low confirmation, and synchronized expiry at ~T+10 min.

---

## 11. Experiments

All are read-only, or use sends you would legitimately make anyway.

| Question | Experiment | Distinguishing outcome |
| --- | --- | --- |
| Infeasible target vs speed | Classify each Wave 1 target in the first published MISS grid | Unavailable-no-record at first publication → infeasible. OPEN at publication and lost → a race loss (speed, queue or luck) |
| Block vs hold | Re-read the date at +30 min, +2 h, next day | Persisting no-record → block. Reopens around T+10 min → hold |
| Broad acquisition by one actor | Record-level PENDING timing, record lengths, confirmation ratio, expiry clustering | Large synchronized PENDING burst + low confirmation + synchronized T+10 min expiry → broad acquisition. Scattered creation and many confirmations → organic market |
| Provider queueing | 4–7 concurrent Wave 1 responses: spacing, order vs send order, `server-timing`, compared with concurrent read latency | Even spacing in fixed order → serialization. Durations tracking read latency → shared saturation |
| Is a decision made early? | Compare first appearance of competitor `P` records with our 409 arrival | Records visible well before our 409 → the provider committed early and answered late |
| Connection setup | Provider trace: reuse flag, connect/TLS on Wave 1 POSTs | Non-null connect/TLS → cold connection; fix with a legitimate warm-up read |
| Browser/runtime | Offline: Phase 1 shows transport call → request event ≈ 6 ms. Live: Playwright request time vs CDP `requestWillBeSent` | Should be ≤ 10 ms. If so, the browser isn't the bottleneck |
| Boundary location | Read-only reads every 250 ms from T−1 s to T+2 s, recording cache status and `Date` header | The first MISS read with the date published brackets the read-side boundary. The checkout-side boundary remains UNKNOWN (never probe it with early POSTs) |
| Proof-based vs proofless | On **genuinely wanted off-peak bookings** on different days, alternate the paths and compare POST→response and response shape | Any difference in latency or validation. Never duplicate for a single target |
| Reopen value | 1 s reads T+9:30–T+11:30 | Count reopened 3-hour ranges and their lifetimes |
| Adaptive path timing | Offline replay with recorded latencies and the standby/rescue fixes | Selection→POST should be milliseconds, not 6–7 s |

---

## 12. Stop doing

- **Stop shaving local dispatch milliseconds.** Going from 5 ms to 3 ms is below the clock's ±20 ms error bound and far below the provider's 11–28 s processing. It can't change an outcome until a trace shows arrival order deciding a *feasible* contested cell.
- **Stop treating "no conflicting public record" as positive evidence.** It can't see blocks. On 09-24 it may have steered attempts toward blocked courts.
- **Stop same-window portfolios.** Four courts at 15:00–18:00 is one bet.
- **Stop re-arguing the competitor theory from the cell count at +5 min.** It can't separate pre-release allocation, blocks, organic tiling and broad acquisition. Record structure and persistence can.
- **Stop running Rescue as designed.** A 30 s cadence plus a forced 7 s refresh after detection means it can't win a contested reopen. Fix it or leave it off.
- **Don't add more workers until the portfolio is diversified.** Correlated targets make worker N+1 nearly worthless. Workers beyond your hold budget create holds you'll let expire.

On the eight beliefs:

| Belief | Verdict |
| --- | --- |
| 1. They win because they're faster | **Unsupported** by our data. The only win was at UI speed; both losses look infeasible |
| 2. They blanket the inventory | **Not needed** to explain the board; not excluded |
| 3. Their broad holds cause the one-hour fragments | **Alternative explanation is simpler:** 3-hour tiling at common start times leaves exactly these fragments |
| 4. The three-hour requirement is the main disadvantage | **Secondary but real.** On 09-24 even 1-hour targets in Courts 3–5 15:00–18:00 would have failed |
| 5. Reopen Rescue is our best opportunity | **Unproven.** 09-23 reopens were fragments. Our Rescue is too slow to test it fairly |
| 6. Phase 1 solved latency | Solved **local Wave 1** latency (offline). Adaptive-path latency (6–37 s) is unsolved and matters more |
| 7. More workers significantly help | Only if targets are uncorrelated and within the hold budget. Possibly less if the provider serializes per client |
| 8. Historical intelligence will materially help | **Yes for one thing:** block and pre-release allocation knowledge. Weak for demand prediction at n≈3. No help on speed |

---

## 13. Final conclusion

If I were responsible for winning the next legitimate release, my top five priorities would be:

1. **Establish feasibility before choosing targets.**
   - Analyze the existing 09-24 first-published grid.
   - Read 09-26 now to see whether Courts 3–5 are still unavailable without records.
   - Log record court/start/end/status going forward.
   - Ask the venue about blocks, pre-release allocations and a standing reservation.
   - Exclude any cell with record-less unavailability history on that weekday.
2. **Rebuild Wave 1 as a diversified, cell-disjoint portfolio of 3–4 genuinely wanted 3-hour ranges across different time windows**, capped by the number of holds you'd pay for or promptly cancel. Also:
   - Fix Worker B with a real distinct identity.
   - Take Wave 1 prices from the latest published same-weekday grid.
3. **Make Wave 2 able to act in the T+6–10 s window:**
   - standby contexts kept ≤ 20 s fresh from T−12 s to T+30 s;
   - `concurrentWave2` within the hold budget;
   - replace the seq-equality guard with "newest actionable read still shows the range OPEN";
   - confirm from the next trace that the cache gate can ever open.
4. **Make Reopen Rescue measurable and competitive around T+10 min:**
   - 1 s reads from T+9:30 to T+11:30;
   - pre-refreshed contexts instead of a forced refresh after detection;
   - fix the livelock;
   - candidates covering every acceptable 3-hour range.
5. **Run the next release as an experiment as much as a race.** Capture:
   - the first-publication feasibility of every candidate;
   - cache status;
   - provider trace fields (reuse, regions, `server-timing`);
   - response spacing;
   - competitor record timing and T+10 min reopen clusters.

   Then build Phase 4 as interval-censored range survival and feasibility history, not millisecond buckets.
