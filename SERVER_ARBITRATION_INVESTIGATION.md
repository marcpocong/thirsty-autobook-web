# Server-side arbitration investigation — 2026-09-25 release

Prepared 2026-09-25 from the repository state on branch `claude/onda-inventory-arbitration-7pr1kj`. **No request was sent to Onda during this investigation.** Everything below comes from the committed, sanitized archive (`diagnostics-archive/2026-09-25/`), earlier reports, the source, and offline tools built here (tests, benchmarks, a simulator). Times are ms or s after 08:00:00.000 Manila on the runner's dispatch clock unless stated.

Labels: **FACT** (directly recorded), **INFERENCE** (follows from facts plus a stated assumption), **HYPOTHESIS** (compatible with the facts, not established), **UNKNOWN** (not observable with current data).

This builds on, and does not repeat, [RELEASE_RUN_REPORT_2026-09-25.md](RELEASE_RUN_REPORT_2026-09-25.md) (what happened that morning) and [RED_TEAM_RELEASE_ANALYSIS_2026-09-24.md](RED_TEAM_RELEASE_ANALYSIS_2026-09-24.md), whose open item W6 ("provider queue and bottleneck behavior is unknown: FIFO or unordered, per-client serialized or not") is the subject here.

---

## 1. Answers, with confidence

### Q1. Why did seven proofless POSTs sent ~10 ms after release wait 29–35 s and then get 409?

| # | Statement | Label | Confidence |
|---|---|---|---|
| 1 | Chrome started all seven requests by +8.0…+10.6 ms; Playwright saw them at +9.8…+11.7 ms (1.9 ms spread). The dispatch clock was within ±24.2 ms of UTC. | FACT | high |
| 2 | Every answer was HTTP 409 from Onda's application (JSON, `x-vercel-cache: MISS`) after 29.1–34.6 s. There were two body sizes (≈220 B ×2, ≈400 B ×5). The bodies were not stored. | FACT | high |
| 3 | All seven target ranges were fully open in the first published read (processed between +0.02 and +4.14 s). Each one was shown taken before our answer arrived: A/D/F by a read answered at +17.0 s, E/G by +18.9 s, B/C by +28.9 s. | FACT | high |
| 4 | During the same seconds the public read path answered in two ways. Slow reads (4–15 s) came back in **batches** ("flushes") at +17.8 s and +28.9 s and carried the highest taken counts. Fast reads (70–160 ms) included 10 of 43 that were **provably stale**: they reported fewer taken cells than a read that had already finished before they were sent (§4.3). | FACT (counts, times); INFERENCE ("stale view") | high / medium |
| 5 | Our first 409 arrived 120 ms after the +28.9 s read flush. The next slow-read flush (+32.85 s) falls between our 4th and 5th answers. | FACT | high |
| 6 | Our POSTs were held behind the same thing that held back the current-data reads. The 409 was decided when each POST was finally processed, after competitors' holds had been committed. | INFERENCE | medium–high |
| 7 | **Best-supported mechanism:** checkout work for the date was effectively serialized, or admission-limited, behind one shared resource on the current-data path (a facility/date lock, a saturated connection pool, or instances blocked on one). Commits advanced at roughly 0.3–1 s each, and we were about 30 s deep in that queue, while some reads were answered from a separate, stale view. The replay (§12) contradicts C (per-court lock), D (optimistic), E (retry/backoff), G (lanes) and H (per-IP) as sole mechanisms within the searched ranges. It narrows the field to models whose bottleneck sits behind the edge on the current-data path (B, F, P; A cannot produce the overtaking reads), but **no model reproduced all six Sept 25 signatures jointly**. | HYPOTHESIS | medium that a shared bottleneck exists; low on which one |
| 8 | Per-client (per-IP) serialization is **not** the explanation. Our own public reads (same machine, so INFERENCE: same public IP) answered in 70–160 ms while all seven POSTs were outstanding. Our seven answers are also not evenly spaced (gaps 0.27–2.35 s). | INFERENCE | medium–high |
| 9 | Six of the seven answers came in the order of the `x-vercel-id` embedded numbers (ties allowed). A is the exception: earliest stamp, last answer. This fits FIFO at some stage, plus one request delayed before reaching it. The meaning of the number is UNDOCUMENTED. | FACT (order); INFERENCE (meaning) | medium |

### Q2. What is the earliest legitimate operation that establishes inventory ownership?

| # | Statement | Label |
|---|---|---|
| 1 | Ownership is created by a **successful `POST /api/bookings/public-checkout`**. It returns pending bookings with `hold_expires_at`, and the booking page describes a 10-minute hold that starts only after "Confirm & Proceed to Payment". Reading `hold_expires_at` − 10 min as the provider's commit time, the commit happens late in the request: off-peak it lands 1.0–1.6 s after send in a 1.1–2.1 s request, and the answer follows 0.1–0.8 s later. | FACT (verified holds, [VERIFIED_ONDA.md](VERIFIED_ONDA.md) hold notice); INFERENCE (commit = expiry − 10 min; PC clock offset bounds in `offPeak.commitPosition`) |
| 2 | `POST /api/public/is-slot-available` is a read that returns a proof. The booking page itself says the slot is not reserved before "Confirm & Proceed to Payment". A proof is not ownership. Payment comes after the hold. | FACT |
| 3 | The hold is exclusive but **time-limited**. Unpaid holds return to inventory. On both observed releases a cluster of cells reopened between the +600 s and +630 s reads (31 on Sept 25, including all of our target G; 10 on Sept 24). That bounds the commits of the holds that beat us to ≤ +30.3 s. | FACT (reads); INFERENCE (expiry rather than cancellation) |
| 4 | So **arbitration between customers happens at the provider's commit of a pending hold, in the order requests reach that commit, not the order they were sent.** "Release → inventory ownership" is release → our transaction's commit. Once the provider is saturated, that time is set by our position in the provider's queue and the provider's per-transaction time. A ~1 ms send-side gain does not reliably change it. | INFERENCE |

What this investigation did **not** establish: the provider's internal mechanism (UNKNOWN; only indirectly constrained), the contents of the 409 bodies (UNKNOWN until the new capture runs at a release), the checkout-side release gate (UNKNOWN; probing it would need a pre-release checkout, which is out of bounds), and who the competitors are.

---

## 2. Evidence audit

### 2.1 Sources used

| Source | What it establishes | Limits |
|---|---|---|
| Runner trace `local/api-booking/run-progress/fc62669a-….ndjson` | Arm, clock rounds, `CHECKOUT_PRE_POST` lateness (0.1 ms), Playwright request events, network durations, outcomes | Wake, worker call and renderer fetch not logged in that build |
| Provider trace `local/release-forensics/fc62669a-…/provider-trace.ndjson` | Chrome request/response timing, HTTP/2 connection reuse, status, sizes, `x-vercel-id`, `x-vercel-cache` | Late-enabled passive trace; no bodies |
| Slot Watch v2 `local/slot-watch/2026-09-27_60d68777-….ndjson` (Sept 25) | 127 availability reads: request/response times, cache status, 112-cell matrices; 8 public-booking reads | Observer clock (shifted +3.7 ms to dispatch); the moment each read was processed is unknown within its window |
| Slot Watch v1 `local/slot-watch/2026-09-26_d4cc58f6-….ndjson` (Sept 24) | Serial reads, matrices, publication flag | No cache status |
| API-first journals (Sept 23) | Send/answer times on the network-corrected clock | No reads with cache status |
| Off-peak run traces (19–24 Sept) | Lane comparison, hold commit position (`hold_expires_at` − 10 min) | PC clock offset uncertain for commit position |
| Network-clock evidence | Dispatch clock bound (±24.2 ms at T−30 s round) | — |
| [VERIFIED_ONDA.md](VERIFIED_ONDA.md), [API_CHECKOUT_403_RESOLUTION.md](API_CHECKOUT_403_RESOLUTION.md), [HEADERLESS_CHECKOUT_INVESTIGATION.md](HEADERLESS_CHECKOUT_INVESTIGATION.md) | The first-party flow: proof read, checkout, hold, payment; proofless acceptance off-peak | — |
| Reports: Sept 12, 23 (red team), 24, 25; Phase 1–4 | Earlier findings; send-side latency history | Dated |

The machine-readable outputs are `diagnostics-archive/2026-09-25/arbitration/release-2026-09-25.timeline.jsonl` (284 events, schema `release-timeline/v1`) and `arbitration-evidence.json` (schema `arbitration-evidence/v1`). Both are regenerated deterministically by `npx tsx scripts/analyze-release-arbitration.ts`.

### 2.2 Evidence matrix (what each hypothesis predicts vs what was seen)

| Observation (Sept 25 unless noted) | A edge FIFO | B instance admission | C per-court lock | D optimistic | E retry/backoff | F facility/date serial | G lanes | H per-IP |
|---|---|---|---|---|---|---|---|---|
| 29–35 s waits for all seven (FACT) | ✓ if overloaded | ✓ | ✗ unless holders take ~30 s | ✗ (≈1–2 s) | ✓ | ✓ | only with a 30 s lane penalty | ✓ |
| All 409 (FACT) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Slow reads flush in batches, issued 7–13 s apart (FACT) | ✓ (backlog, then burst) | ✓ | — | — | — | ✓ with blocked connections | — | ✓ (behind our own POSTs) |
| Fast reads overtaking stuck ones while POSTs pending, some provably stale (FACT) | ✗ unless reads bypass the queue | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| 409s start 120 ms after a slow-read flush (FACT) | ~ | ✓ | ✗ | ✗ | ~ | ✓ | — | ~ |
| 6/7 answers in `x-vercel-id` order, τ 0.87 for those six (FACT order, INFERENCE meaning) | ✓ (but never puts the earliest last) | ✗ scrambles (sim τ ≈ 0.1) | ✗ (7 courts, 7 queues) | ✗ | ✗ tends to scramble | ~ only if order is fixed early (sim τ ≈ 0 with varying pre-lock work) | — | ✓ |
| Gaps between our answers 0.27–2.35 s (FACT) | ✓ | ✓ | — | — | ✓ | ✓ (interleaved crowd) | — | ✗ (even spacing) |
| Sept 24: 3 answers 5.4 s apart, reversed order (FACT, n=3) | ✗ | ✓ | — | — | ✓ | ~ (random grant) | — | ~ |
| Sept 23/24: targets blocked from publication, still 11–28 s to 409 (FACT) | ✓ | ✓ | ✗ (nothing to wait for) | ✗ | ✓ (retries) | ✓ (queue before the check) | ~ | ✓ |
| Off-peak: proofless = proof-based latency (p=0.26) (FACT) | — | — | — | — | — | — | ✗ as a large effect off-peak | — |

✓ compatible, ✗ contradicted, ~ weakly compatible, — no prediction. The replay in §12 checks these jointly under a crowd whose size is unknown.

---

## 3. Sept 25 timeline, layer by layer

All values from the timeline JSONL. The dispatch clock is within ±24.2 ms of UTC (the NTP geometry bound of the round adopted at T−30 s). Relative times between our own events are much tighter (0.1–1 ms).

| Layer | Time | Label | Clock domain | Note |
|---|---|---|---|---|
| Release deadline | 0 | FACT | dispatch | 2026-09-25T00:00:00.000Z |
| Clock rounds | T−10 min, T−60 s, T−30 s (adopted: offset 23.3 ms, ±24.2 ms) | FACT | PC wall → dispatch | |
| Scheduler fired | ≤ +0.4 ms | INFERENCE | dispatch | Not logged in that build; bounded by the first pre-POST mark |
| Worker invoked / transport entered | ≤ pre-POST | INFERENCE | dispatch | Not logged separately in that build (now logged: §9) |
| Pre-POST gate | +0.4 … +2.9 ms | FACT | dispatch | Last Node code before `page.evaluate` |
| `page.evaluate` entry | UNKNOWN | UNKNOWN | renderer | Not instrumented then; now instrumented (§9) |
| Renderer `fetch()` | ≤ Chrome start | UNKNOWN | renderer | Now instrumented |
| Chrome request start | ≤ +8.0 … +10.6 ms | FACT (upper bound) | dispatch | From the trace's headers time minus Chrome's own headers offset |
| Playwright request event | +9.8 … +11.7 ms | FACT | dispatch | 1.9 ms spread across seven browsers |
| Provider edge evidence | `x-vercel-id` numbers +30 … +38 ms | INFERENCE | provider-embedded | 20.2–27.3 ms after our request event (one-way Cebu→Singapore is about that). The number's meaning is UNDOCUMENTED, so this can't be treated as edge arrival |
| Response start (Node) | +29,108 … +34,618 ms | FACT | dispatch | D, B, C, E, G, F, A |
| Response complete | +2 … +8 ms later | FACT | dispatch | 219–407 B |
| Availability reads | 127 reads, −60 s … +900 s | FACT | observer → dispatch | Each read's content reflects an unknown moment inside its window |
| Publication (read side) | between −1.78 s and +4.14 s | INFERENCE | observer → dispatch | First published read: cache MISS, age 0 |
| Earliest disappearance per target | A/D/F in the read answered +17.0 s (sent +2.0 s); E/G +18.9 s; B/C +28.9 s (last fully open read for B/C answered at +18.08 s) | INFERENCE | observer → dispatch | See §4.3 about stale reads: "last fully open" can be a stale view |
| Booking observations | public records at −60 s, +2 s, +30 s (77 cells), … | FACT | observer → dispatch | Court/hour only |
| Hold expiry (new category) | 31 cells reopened between +600.0 s and +630.3 s; 6 at +390–420 s; 1 at +840–870 s | FACT (reads) / INFERENCE (cause) | observer → dispatch | The +390 s cells were open at publication, so they were not 10-minute expiries (cancellations or abandoned holds). The +600 s cluster implies commits ≤ +30.3 s |

**`x-vercel-id` as edge arrival.** The format is `sin1::sin1::<id>-<13 digits>-<hex>`. The 13-digit value behaves like Unix ms: it is 20–27 ms after our request events and 29–35 s before our answers. That fits "edge receipt" or "function start", but Vercel does not document it, and one day's consistency is not proof. It stays INFERENCE. `parseVercelId` marks it `embeddedInterpretation: 'UNDOCUMENTED'`.

---

## 4. The 29–35 s wait

### 4.1 Models

| Model | Mechanism | Predicts |
|---|---|---|
| A | Edge/global FIFO or general overload (admission limit) | Everything drains in arrival order; no batch completion of reads issued seconds apart |
| B | Instance admission (few instances, each with one DB connection) | Requests routed to a blocked instance stall together and complete together; others are fast |
| C | Pessimistic lock per court | Losers answer soon after the holder commits; different courts don't wait on each other |
| D | Optimistic concurrency, no retry | Losers answer in about one service time |
| E | Optimistic with retry and backoff | Losers answer late, after their backoff sum; early arrivals can finish last |
| F | Facility/date serialization (one lock) | Wait ∝ queue position; answers roughly in lock-arrival order, spaced by per-transaction time |
| G | Separate lanes (proofless pays extra work) | Proofless slower than proof-based |
| H | Per-IP limiter | Our requests, reads included, serialized with each other |

### 4.2 What the data rules in and out (without the simulator)

- **D is contradicted.** Off-peak, a loser learns of the conflict in about one request time (1–2 s). A 29 s 409 is not conflict detection alone.
- **C is contradicted as the sole cause.** Our seven targets were on seven different courts. A per-court lock would give seven independent waits, each about one holder transaction.
- **H is contradicted** (§1 Q1 #8), and so is the red-team's weak hint of per-client serialization.
- **G** can't be tested at the release with our data (every Sept 25 attempt was proofless). Off-peak there is no lane difference (proofless p50 1,213 ms n=11 vs proof-based 1,208 ms n=49; Mann–Whitney p=0.26).
- **A is not ruled out by the flushes alone.** Reads sent at +5.0, +6.0, +11.0, +12.0 and +17.0 s all answered between +17.76 and +17.93 s. A FIFO backlog can do that: short reads queued back to back behind it drain in a burst. What a pure edge FIFO cannot do is let a later read overtake a stuck earlier one. Real fast reads did overtake stuck ones, so A needs a read path that bypasses its queue (§4.3).
- **B, E, F and P remain**, alone or combined. The replay (§12) later removes E as a sole mechanism.

### 4.3 Two read paths during the release (new)

A read is **provably stale** when it reports fewer taken cells than a read that had already *finished* before it was *sent*. Taken cells come back only through cancellation or hold expiry (10 min).

| Release | Reads answered in < 500 ms | …provably stale | Reads that took ≥ 2 s | …provably stale |
|---|---|---|---|---|
| Sept 25 (first 120 s) | 43 | **10** | 17 | **0** |
| Sept 24 (first 120 s, v1 serial reads) | 38 | 2 | 2 | 0 |

(`arbitration-evidence.json` → `sep25.staleReads`, `sep24.staleReads`; `staleReadEvidence()` in [`src/arbitration/archive-evidence.ts`](src/arbitration/archive-evidence.ts).)

Example: the read sent at +22.00 s answered in 90 ms with 10 taken cells. Reads that had already finished by then showed 27. At +35 s and +37 s fast reads showed 66 while earlier-finished reads showed 77.

- The alternative, that 17 cells were released and re-taken within seconds, is not excluded but is implausible.
- The report's §10.4 saw the disagreement; this test rules out the "overlapping reads" explanation.

Consequences:

- **INFERENCE:** during the rush, the fast answers came from an older view of the data (a lagging replica or a cache). The slow answers came from the current view, the one that was congested.
- **"Last fully open read" timestamps are therefore not reliable upper bounds** on when a competitor committed. For B/C the read that still showed them open at +18.0 s may have been stale.
- A booking decision based on a fast read during the rush can act on data several seconds old. Wave 2/Rescue logic that treats a fast OPEN read as current is exposed to this.

### 4.4 Our answers line up with the current-view flushes

| Event | Time |
|---|---|
| Slow reads (sent +19.0…+26.0 s) answer together | +28.87 … +28.99 s |
| D answered (409) | +29.11 s |
| B, C answered | +29.56, +29.82 s |
| E answered | +32.18 s |
| Slow reads (sent +30.0, +31.0 s) answer | +32.85, +32.89 s |
| G, F, A answered | +32.98, +33.86, +34.62 s |

A second flush at +17.76…+17.93 s has no checkout answer next to it. Our POSTs were further back.

INFERENCE: current-view reads and our POSTs were released by the same events. That points to a shared resource on the current data path: database primary, connection pool, lock, or the instances blocked on one of these. It does not point to an edge queue in front of everything, because fast (stale) reads kept flowing.

### 4.5 Where A's lateness might come from

A had the earliest stamp (+30 ms) and answered last (+34.6 s). The other six answered in stamp order (τ = 0.87, ties allowed), with gaps averaging 0.92 s (0.27–2.35 s): what consecutive transactions of ~0.3–1 s would look like.

Simulated with the replay's Sept 25 inputs (60 seeds; 160 competitor checkouts, 30% arriving just before release):

| Model | P(A answered last) | τ of the other six (observed 0.87) |
|---|---|---|
| A edge FIFO (admission 8) | 0.00 | 0.57 |
| F facility/date FIFO (pre-lock work varies per request) | 0.15 | 0.00 |
| F with one connection per instance | 0.05 | 0.07 |
| B instance admission | 0.07 | 0.09 |

- **INFERENCE:** the order of six of our requests was fixed at or near arrival by a stage with little per-request variance, and the six sat almost adjacent in it. That stage could be an edge/admission FIFO, or a lock taken at the very start of processing.
- **HYPOTHESIS:** A was delayed *before* that stage by something that hit only A (a busy or cold instance, a connection re-establishment, an internal retry). UNKNOWN which.
- None of the tested models reproduces both halves of the pattern.

### 4.6 Sept 23 and 24 compared

| Release | Our sends | Our targets at publication | Our answers | Reads during the rush |
|---|---|---|---|---|
| Sept 12 (UI flow, proof-backed, target a Monday) | final action at +9.5 s | open | **verified hold** detected +13.4 s | not recorded the same way |
| Sept 23 (API, proofless) | +47/+48 ms | **blocked** (venue) | 409 at +11.5, +13.3 s | up to 6 s |
| Sept 24 (API, proofless) | +100…+104 ms | mostly **blocked** (courts 3–5) | 409 at +17.6, +23.1, +28.4 s (reversed, 5.4 s apart) | timing out at 5 s until ~+29 s |
| Sept 25 (API, proofless) | +9.8…+11.7 ms | **open** | 409 at +29.1…+34.6 s | up to 15 s, flushing at +17.8 and +28.9 s |

Our waits track each day's read congestion. INFERENCE: a shared bottleneck, as the red team suggested for Sept 24. Sending 90 ms earlier (Sept 24 → 25) did not shorten the wait. On Sept 12, with no comparable congestion, a checkout sent 9.5 s after release still got a hold.

---

## 5. What the 409s were

**Known (FACT):** 409, JSON, from the application (not an edge page), `errorHint: availability`, two sizes (C/D ≈220 B; A/B/E/F/G ≈400 B), no `x-request-id`/`server-timing`/`cf-ray`, HTTP/2 over reused connections, 0.1–0.3 ms to send.

**Unknown:** the bodies. The size split doesn't follow answer order, start time or court. It suggests two server code paths or messages: for example "already held" vs "not available/not released", or a message that lists conflicting hours. This is the single most useful missing fact.

**Added (C):** [`src/api-booking/response-evidence.ts`](src/api-booking/response-evidence.ts) keeps a **sanitized, structural** record of every non-200 checkout answer:

- status, content type, byte length;
- allowlisted headers: `server`, `x-vercel-id`, `x-vercel-cache`, `x-request-id`, `server-timing`, `retry-after`, rate-limit headers, `cf-ray`, `cf-mitigated`, …;
- the body's JSON **shape**: key paths, types, lengths;
- allowlisted **fields**: `success`, `error`, `message`, `code`, `errorCode`, `status`, `reason`, `category`, `conflicts`, … with values redacted.

Redaction removes the customer's own values (client/customer IDs, email, phone, names) first, then patterns: URLs, emails, JWTs, UUIDs, phone numbers, long hex/tokens/mixed IDs, long digit runs and capitalized name pairs. Values are capped at 300 characters. It never records cookies, Turnstile tokens, fingerprints, auth headers or full bodies.

The evidence goes into:

- the `CHECKOUT_RESPONSE_COMPLETED` observation (`responseBytes`, `bodyShape` fingerprint);
- the provider trace fallback (`evidence`);
- the runner's sanitized checkout capture.

Tests: `tests/api-booking/response-evidence.test.ts` (redaction rules, header allowlist, `x-vercel-id` parsing) and `tests/api-booking/checkout-response-evidence.test.ts` (end to end: a synthetic 409 that echoes every private value; asserts nothing private survives in the observation, the evidence or the provider-trace file).

---

## 6. Inventory ownership state machine

```
            (date published: read side between −1.78 s and +4.14 s on Sept 25)
UNRELEASED ─────────────────────────────────────────────► OPEN
                                                           │  public-checkout POST reaches the provider's commit
                                                           │  (FACT: pending bookings + hold_expires_at; INFERENCE: = commit + 10 min)
                                                           ▼
                                                 HELD (pending, exclusive, ≤ 10 min)
                          payment completed  ┌─────────────┼─────────────┐  cancelled/abandoned before expiry
                                             ▼             │             ▼
                                        BOOKED (paid)      │         OPEN (INFERENCE: e.g. +390–420 s reopenings of cells open at publication)
                                                           │ hold_expires_at reached unpaid
                                                           ▼
                                                         OPEN (INFERENCE: +600–630 s clusters on Sept 24 and 25)
Other states: BLOCKED by the venue (record-less, rectangular; red-team W1), PRE-ALLOCATED before release (records on the unpublished date).
```

| Transition | Trigger | Evidence |
|---|---|---|
| UNRELEASED → OPEN (read side) | provider release | FACT window per day; exact instant UNKNOWN. Sept 24 reads processed at ≤ +0.36 s and ≤ +0.90 s were still unpublished (cache status not recorded) |
| UNRELEASED → OPEN (checkout side) | provider gate | UNKNOWN; never probed (would need a pre-release checkout) |
| OPEN → HELD | commit inside a successful public-checkout | FACT (off-peak and Sept 12); INFERENCE: competitors' commits ≤ +30.3 s for the +10 min cluster on Sept 25 |
| OPEN → (proof) | is-slot-available | FACT: a read; **no** ownership |
| HELD → OPEN | expiry at `hold_expires_at` | FACT for our own holds (Sept 23 expired exactly 10:00 after capture, per the Sept 25 report); INFERENCE for others |
| HELD → OPEN | cancellation/abandonment | INFERENCE (+390–420 s cells) |
| HELD → BOOKED | payment | FACT (flow); "pending" records lasting well past 10 min mean "pending" is not only the 10-minute hold (Sept 25 report §12) |

**Earliest ownership transition:** OPEN → HELD at the provider's commit inside our public-checkout request. Nothing earlier (no proof, no read, no page action) gives ownership. Nothing is legitimately obtainable before the provider's release.

---

## 7. Conflict latency vs general latency; lanes; concurrency

- **General latency dominates on busy releases.**
  - Every release-time checkout of the API/Precision path (Sept 23, 24, 25) answered 409 after 11–35 s, and the reads of the same moment were slow too. The 409 is the conflict *outcome* at processing time; the wait is congestion. Off-peak, conflict-free holds take 1.1–2.6 s.
  - **The wait comes before the availability check.** On Sept 23 and 24 our targets were unavailable from the moment of publication (venue blocks; red-team W1; [RELEASE_RUN_REPORT_2026-09-23.md](RELEASE_RUN_REPORT_2026-09-23.md)), yet the 409s still took 11.5–13.3 s and 17.6–28.4 s. A request that can be refused on sight still waited, so the wait is not conflict resolution on our rows. That was the red team's point for Sept 24; Sept 23 confirms it. Sept 25 was the first release whose targets were open at publication: a genuine race, lost.
  - The one other release-time checkout on record behaved differently: Sept 12, the normal UI flow booking a **Monday**. Its final Onda action (+9.5 s) got a verified hold ~3.8 s later ([RELEASE_RUN_REPORT_2026-09-12.md](RELEASE_RUN_REPORT_2026-09-12.md)). So the ~30 s queue is a property of high-demand releases (the three 409 days all opened weekend dates), not of every release (INFERENCE from n=4 days).
- **Proofless vs proof-backed at the arbitration layer:**
  - off-peak, no latency difference (above);
  - at release, UNTESTED: all Sept 25 attempts were proofless and all Sept 24 attempts were too.
  - The safe test is one proof-backed attempt through the normal UI flow, on a distinct target the operator genuinely wants, at the same release. It is ranked in §13. No forged or reused proof is involved.
- **Concurrency 1/2/4/7:**
  - checkouts can't be used, because each creates a hold;
  - the read-only harness (§13, F) measures whether simultaneous requests from one client are serialized. It is built and tested offline and has **not been run live**.
  - For the release itself, H (per-IP) is already contradicted by our own fast reads.

---

## 8. Release gate (CLOSED → OPEN)

- **Read side (FACT):**
  - Sept 25: the date was published between the last unpublished answer (−1.78 s) and the first published answer (+4.14 s, MISS). Nothing was read in between.
  - Sept 24: reads processed no later than +0.36 s and +0.90 s were still unpublished. That was the v1 watch, with no cache status. The red team noted this may mean the boundary was later than 08:00:00.3.
- **Checkout side: UNKNOWN,** and it stays so. It could only be probed by a pre-release checkout, which is out of bounds. The new 409 capture can still help after the fact: if a release-time 409 carries a "not released" code instead of "not available", the gate was closed when that request was processed.
- **Proposed read-only bracketing:** add reads at −1,000, −500 and −250 ms to the existing early burst (0, 250, 500, 1,000, 2,000, 5,000 ms). v2 already records cache status and `Date`. This is the red team's "boundary location" test at a lower read count. It is not implemented here, because the Slot Watch early burst is capped at six in-flight reads.

---

## 9. Critical-path telemetry (B, and part of D)

Files: [`src/api-booking/critical-path.ts`](src/api-booking/critical-path.ts), [`src/api-booking/renderer-clock.ts`](src/api-booking/renderer-clock.ts), wiring in [`desktop-runner.ts`](src/api-booking/desktop-runner.ts) and [`browser-session-transport.ts`](src/api-booking/browser-session-transport.ts); tests in `tests/api-booking/critical-path.test.ts`.

**Recorded per worker, per release (schema `critical-path/v1`).** All times are ms after the release instant on the trusted clock:

- `schedulerFiredMs`, `workerInvokedMs`, `transportEnteredMs`, `prePostMs`, `rendererArmSentMs` (Node);
- `evaluateEnteredMs`, `fetchInvokedMs`, `rendererArmedMs`, `responseHeadersMs`, `responseCompleteMs` (renderer, each with `[lowMs, highMs]`);
- `browserRequestStartMs` (Chrome's own request start: CDP `wallTime` via `request.timing().startTime`, read after the response);
- `requestObservedMs`, `responseObservedMs` (Playwright events in Node);
- derived segments: pre-POST → renderer entry, renderer entry → `fetch()`, `fetch()` → Chrome start, Chrome start → request event;
- the renderer clock calibration: samples, uncertainty, round trip.

**Clock domains and mappings:**

| Domain | Source | Mapping to the trusted release clock |
|---|---|---|
| Trusted epoch | `TrustedReleaseClock` (anchored NTP consensus) | Identity. Bound vs UTC = the adopted round's error (±24.2 ms on Sept 25) |
| Node monotonic | `performance.now()` in the runner | `clock.monotonicDeadline(release)` = release |
| Renderer monotonic | `performance.now()` in each page | Round-trip calibration. Each sample (Node before, page reading, Node after) bounds `node = renderer + offset` to `[before − r, after − r]`, widened by Chrome's 0.1 ms timer coarsening. Intersecting all samples gives `[low, high]`. An empty intersection means INCONSISTENT and the calibration is refused |
| Browser wall | CDP `wallTime` | `trusted = wall + offset − wallDisagreement`, the same OS wall clock as Node |
| Provider | `x-vercel-id` number, `hold_expires_at`, `Date` | Not mapped: evidence only, labelled UNDOCUMENTED or INFERENCE |

**Hot-path discipline:**

- During dispatch the recorder does a clock read and a property write into preallocated per-worker objects. There is no I/O, formatting or hashing, and the first value wins.
- Logging of the new events is deferred (`setImmediate`/`observeDeferred`).
- After every POST has settled, the runner calibrates each page (8 round trips) and writes `.local/release-forensics/<run>/critical-path.ndjson` (mode 0600, exclusive create). It then logs `CRITICAL_PATH_SAVED` with the maxima.
- The file holds only worker letters, numbers and calibration statistics: no URLs, bodies or identities.

**Overhead (benchmarked, `scripts/benchmark-critical-path-overhead.ts`, 7 workers = 22 hot-path calls per release):**

| Regime | What it is | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| Warm (20,000 releases, one process) | JIT-optimized steady state | 2.27 µs | 3.09 µs | 5.19 µs | 600 µs (a GC pause) |
| **Cold** (40 fresh processes, first release) | what a release would pay **without** warm-up | 176 µs | 289 µs | 552 µs | 552 µs |
| **Cold after `warmUpCriticalPath()`** (40 fresh processes) | what the runner pays: it warms up before release | 21.6 µs | 35.2 µs | 119 µs | 119 µs |
| Timer alone (empty region) | measurement floor | 0.06–0.55 µs | | | |

The cold row was a real finding. V8 compiles each method on its first call, and in production the first `mark()` happens at T−0. That would have added ~0.2 ms to the 7-worker hot path. `warmUpCriticalPath()` (300 throwaway rounds, ~1 ms, called when the recorder is created well before release) removes ~88% of it. The remaining ~22 µs is spread over seven transport calls whose Node-side cost is already ~0.3 ms each (§11, "wake → transport call").

An end-to-end on/off run of the dispatch benchmark was not made. After warm-up the recorder adds ~22 µs per 7-worker release, three orders of magnitude below the benchmark's own run-to-run variation (milliseconds; §11). An on/off comparison could not resolve it; the microbenchmark bounds it directly.

**Guarantee tested:**

- Over 1,000 random clocks, the calibration always brackets the true offset.
- A deadline mapped with the lower bound is never early and at most 2 × uncertainty late.
- Inconsistent, stale or loose calibrations are refused.
- A real Chromium page calibrates to < 5 ms and maps an in-page mark between its Node brackets.

---

## 10. Experimental renderer-resident dispatch (D)

Files: [`src/api-booking/renderer-dispatch.ts`](src/api-booking/renderer-dispatch.ts), `fireArmedAttemptRenderer` and the renderer branch of `dispatchArmedPrecisionRace` in [`armed-dispatch.ts`](src/api-booking/armed-dispatch.ts), `publicCheckoutProoflessRendererArmed`/`disarmRendererCheckout` in [`browser-session-transport.ts`](src/api-booking/browser-session-transport.ts); tests in `tests/api-booking/renderer-dispatch.test.ts`.

**Off by default.** Enabled only when `ONDA_EXPERIMENTAL_RENDERER_DISPATCH` is exactly `RENDERER_RESIDENT_V1`. Without it the dispatcher takes exactly the existing Node path, and the existing armed-dispatch, hot-path and Phase 2 independence tests pass unchanged.

**Design:**

1. **Calibrate.**
   - At T−3 s each ready attempt's page clock is calibrated adaptively: 8 round trips, then more (up to 32) until the uncertainty is ≤ 1.5 ms.
   - Calibration must finish by the final approach (T−1 s). Whatever hasn't finished is abandoned, so a stuck page can't hold the Node path past release.
2. **Plan.**
   - The page fire time is `releaseMono − offsetLow`: when the page reaches it, Node's clock is **certainly** ≥ release.
   - `notAfter` comes from `offsetHigh` and the dispatch deadline.
   - A wall-clock guard must independently agree, within 5 ms.
   - A calibration that is missing, inconsistent, older than 15 s or looser than 2 ms is refused, and that attempt uses the Node path.
3. **Arm.**
   - At T−40 ms Node checks it is inside the arm window, consumes the one-shot permit and sends the exact pre-serialized request to the page.
   - The page yields through `MessageChannel` (not throttled like timers in background tabs), then spins ≤ 1 ms, and calls `fetch()` itself.
4. **Refuse.** Every refusal happens before `fetch()` and is recorded as **provably unsent**:
   - already armed;
   - page changed;
   - arm window invalid;
   - disarmed by Stop;
   - wall guard;
   - window missed.

   A page that dies after arming is recorded as UNKNOWN. A fired key stays taken for the page's lifetime. A refused key is released.
5. **The page function is a static source string** (no bundler helpers can leak into it). The same source runs in the page and, in tests, in a Node `vm` realm with a virtual clock.

**Tested properties:**

- 500 random schedules never call `fetch()` before the fire time, and always call it within the final spin.
- Refusals send nothing.
- Arm is once per key per page.
- Disarm works before the final spin.
- A 50 ms wall lag delays the fire; a lag larger than the window refuses.
- The planner is conservative, and the flag is exact-match.
- The transport sends the exact armed body once: a refusal journals `rejected`, a page loss journals `unknown`.
- The dispatcher mixes renderer and Node paths per attempt; a never-answering calibration falls back.
- Real Chromium: 5/5 runs fired after release, by the renderer path.

**Results vs the targets (release → request p95 ≤ 2 ms, spread p95 ≤ 1 ms):** **not met** on this container, except at 1 worker for `fetch()` itself.

| Workers | `fetch()` p95, renderer (adaptive) vs node | Chrome request start p95, renderer vs node | Spread p95 (`fetch()` / Chrome start), renderer | Target met? |
|---|---|---|---|---|
| 1 | **1.17 ms** vs 3.72 ms | 4.12 vs 6.01 ms | — | `fetch()` yes; Chrome start no |
| 3 | 2.49 vs 6.46 ms | 8.37 vs 9.00 ms | 2.99 / 6.17 ms | no |
| 7 | 9.69 vs 12.97 ms (136 of 560 attempts fell back to the Node path) | 13.81 vs 15.99 ms | 14.08 / 14.83 ms | no |

Reading:

- **What it improves.** The renderer path removes the Node → CDP → renderer hop (p50 ≈ 2.6–5.9 ms on the Node path here). At 1–3 workers `fetch()` then fires ~0.8 ms after release.
- **What it doesn't.** It doesn't remove `fetch()` → Chrome request start (≈2–3 ms: the browser's own network stack), or CPU contention when 7 Chromes share 4 cores.
- **Why 7 workers fall back.** Calibration under load (7 pages calibrating while prewarming) is often looser than the 2 ms limit even with 32 round trips, and those attempts safely use the Node path. A mix of paths *widens* the spread. The regression gate reports this as a failure ("no silent fallback").
- **No early transmission** in 3,760 benchmarked attempts across all modes:
  - 0 `fetch()` provably early;
  - 0 Chrome request starts before release (Chrome's own wall clock, an independent check);
  - 0 route-handler hits before release.

  In renderer mode 21/80, 33/240 and 7/560 `fetch()` marks are "not provably on time". Their post-run mapping interval (±0.7–0.9 ms) straddles the release instant. That is the resolution of the after-the-fact check, not evidence of an early fire: the fire time is planned with the conservative bound, and Chrome's independent start stamp is never early.
- **Decision.** Keep it off. It is not shown to help on the release PC, and §4 shows the provider's queue (~30 s), not our send time, decides the outcome today. The fallback is not only an artifact of the benchmark's compressed schedule. With a 4 s prewarm lead (calibration at T−3 s on idle pages, as in production) 115 of 560 attempts still fell back. Seven pages calibrating at once on 4 cores make round trips too slow and variable for a ±2 ms bound. Calibrating pages one at a time might help. It was not pursued: the benchmarks do not justify further investment in this path (see the decision below and §15).

---

## 11. Benchmarks and regression gates (E)

Environment: this container (Linux, 4 vCPU, headless Chromium 141 (a substitute for the pinned build), Node 24.21), **offline**:

- DNS disabled; every request to `app.onda.fit` fulfilled locally by `page.route` with a synthetic 409;
- synthetic customer and journals.

This is **not** the Windows release PC. Absolute numbers don't transfer; relative comparisons on the same host do.

Method (`scripts/benchmark-precision-release.ts --mode armed`):

- 80 measured runs per configuration after 2 discarded warm-ups;
- prewarm lead 1.4 s for every mode, since the renderer path needs ≥ 1.3 s;
- every per-worker time is release-relative on the trusted monotonic deadline;
- renderer times are mapped through an **independent** post-run calibration.

Cells are p50 / p95 / p99 in ms.

| Workers | Path | release → `fetch()` | release → Chrome request start | release → Playwright request event | `fetch()` spread | Chrome-start spread | early: fetch / Chrome / route | not provably on time | attempts (path) |
|---|---|---|---|---|---|---|---|---|---|
| 1w | node (production) | 2.82 / 3.72 / 5.84 | 4.72 / 6.01 / 7.79 | 5.759 / 7.419 / 9.456 | n/a | n/a | 0 / 0 / 0 | 0 | 80 (node) |
| 1w | renderer (8-sample calibration) | 0.85 / 2.58 / 4.29 | 2.94 / 4.86 / 6.59 | 4.235 / 8.892 / 11.663 | n/a | n/a | 0 / 0 / 0 | 19 | 80 (80 renderer, 0 fallback) |
| 1w | renderer (adaptive calibration) | 0.8 / 1.17 / 2.3 | 2.82 / 4.12 / 5.98 | 4.179 / 7.178 / 8.251 | n/a | n/a | 0 / 0 / 0 | 21 | 80 (80 renderer, 0 fallback) |
| 3w | node (production) | 4.52 / 6.46 / 7.18 | 6.82 / 9 / 9.75 | 10.692 / 14.209 / 18.039 | 1.52 / 2.56 / 3.47 | 1.39 / 2.9 / 7.88 | 0 / 0 / 0 | 0 | 240 (node) |
| 3w | renderer (8-sample calibration) | 0.84 / 2 / 3.14 | 3.92 / 6.37 / 9.47 | 9.179 / 15.746 / 28.968 | 0.18 / 2.11 / 3.04 | 1.5 / 4.93 / 9.6 | 0 / 0 / 0 | 37 | 240 (240 renderer, 0 fallback) |
| 3w | renderer (adaptive calibration) | 0.86 / 2.49 / 4.11 | 3.92 / 8.37 / 11.46 | 9.011 / 16.833 / 21.079 | 0.19 / 2.99 / 4.36 | 1.58 / 6.17 / 8.66 | 0 / 0 / 0 | 33 | 240 (240 renderer, 0 fallback) |
| 7w | node (production) | 8.21 / 12.97 / 15.17 | 10.94 / 15.99 / 19.59 | 19.142 / 28.005 / 32.499 | 5.11 / 6.67 / 11.52 | 4.79 / 6.59 / 10.34 | 0 / 0 / 0 | 0 | 560 (node) |
| 7w | renderer (8-sample calibration) | 3.3 / 12.27 / 15.49 | 7.6 / 15.33 / 18.75 | 17.872 / 26.596 / 35.377 | 7.51 / 14.1 / 19.21 | 7.57 / 14.3 / 20.83 | 0 / 0 / 0 | 2 | 560 (303 renderer, 257 fallback) |
| 7w | renderer (adaptive calibration) | 1.74 / 9.69 / 16.06 | 6.64 / 13.81 / 19.01 | 17.26 / 27.364 / 33.603 | 5.86 / 14.08 / 27.08 | 6.7 / 14.83 / 27.48 | 0 / 0 / 0 | 7 | 560 (424 renderer, 136 fallback) |

Reading:

- The Node path here (7 workers: Chrome request start p50 10.9 ms) is in the same range as the release PC on Sept 25 (Chrome start ≤ +8.0…+10.6 ms). Spread grows with workers because the T−0 loop calls seven transports in turn (wake → last transport call p50 2.0 ms at 7 workers).
- All 3,760 attempts across all modes settled REJECTED (the synthetic 409). None was UNKNOWN or unsent.

7 workers with a 4 s prewarm lead: calibration at T−3 s runs on idle pages, as in production (prewarm T−15 s, calibration T−3 s):

| Workers | Path | release → `fetch()` | release → Chrome request start | release → Playwright request event | `fetch()` spread | Chrome-start spread | early: fetch / Chrome / route | not provably on time | attempts (path) |
|---|---|---|---|---|---|---|---|---|---|
| 7w | node (production), 4 s lead | 8.16 / 12.7 / 16.55 | 11.27 / 15.65 / 19.84 | 19.871 / 28.721 / 36.485 | 5.07 / 7.26 / 16.89 | 4.91 / 8.02 / 16.09 | 0 / 0 / 0 | 0 | 560 (node) |
| 7w | renderer (adaptive), 4 s lead | 1.46 / 9.51 / 13.81 | 5.93 / 13.29 / 17.28 | 16.638 / 27.834 / 32.573 | 5.87 / 13.77 / 21.68 | 6.13 / 14.93 / 19.98 | 0 / 0 / 0 | 7 | 560 (445 renderer, 115 fallback) |

The Node path is stable between the two leads: 7-worker Chrome start p50 10.9 vs 11.3 ms, p95 16.0 vs 15.7 ms. That run-to-run variation (~±0.5 ms at p50, several ms at p99) is the scale any change has to beat.

**Regression gates** ([`src/arbitration/benchmark-gates.ts`](src/arbitration/benchmark-gates.ts), [`scripts/check-release-performance-gates.ts`](scripts/check-release-performance-gates.ts); tests `tests/arbitration/benchmark-gates.test.ts`):

- *Safety gates (absolute, machine-independent):*
  - every attempt settles REJECTED offline;
  - zero early `fetch()`, Chrome start or route hits;
  - in renderer mode, no silent fallback.
- *Latency gates (relative):* p50/p95/p99 of release → request event, → `fetch()`, → Chrome start, and the spreads may not exceed 1.25× (spreads 1.5×) of a **same-machine** baseline + 1 ms.

There are deliberately no absolute latency targets in code: a number from this container says nothing about the Windows desktop.

Results on the summaries above:

- Node: all 12 safety gates pass.
- Renderer (8-sample, adaptive, adaptive with 4 s lead): the 7-worker "no silent fallback" gate fails (257, 136, 115).
- Renderer vs the Node baseline of the same lead: Chrome-start spread p95 regresses at 3 workers (6.17 > 5.35 ms) and 7 workers (14.83 > 10.89 ms; with a 4 s lead 14.93 > 13.03 ms), and p99 at 7 workers.

Usage:

```
npx tsx scripts/benchmark-precision-release.ts --mode armed --workers 1,3,7 --runs 80 --prewarm-lead 1400 [--dispatch renderer] [--critical-path off]
npx tsx scripts/check-release-performance-gates.ts --summary .local/benchmarks/<new>-summary.json --baseline .local/benchmarks/<baseline>-summary.json
npx tsx scripts/benchmark-critical-path-overhead.ts --workers 7
```

---

## 12. Contention simulator and deterministic replay (H)

Files: [`src/arbitration/contention-sim.ts`](src/arbitration/contention-sim.ts), [`src/arbitration/release-replay.ts`](src/arbitration/release-replay.ts), [`scripts/replay-release-arbitration.ts`](scripts/replay-release-arbitration.ts); output `diagnostics-archive/2026-09-25/arbitration/replay-arbitration.json`; tests in `tests/arbitration/contention-sim.test.ts`.

**What it is.** A deterministic discrete-event model of the provider (seeded PRNG, FIFO-tie-broken event heap). It is a **hypothesis tool**: it contacts nothing, and a model that fits is not thereby true.

**The request path:**

```
edge arrival → [per-IP limit] → [admission limit] → instance (random routing)
             → [DB connection per instance] → pre-lock work → [lock: none | court | facility-date, FIFO or random grant]
             → in-lock work → commit (slots free: 200 hold; taken: retry with backoff or 409)
```

Reads use the same path without a lock. With `sharedCapacity` set, all work shares one overloaded processor (model **P**, general overload: everything slows together rather than queueing).

**Families.** A–H as in §4.1, plus P.

**Inputs:**

- Our real requests of each day: send times; Sept 25 edge times taken from the `x-vercel-id` numbers (INFERENCE); the Sept 25 Slot Watch read schedule.
- A crowd of competitor checkouts and page reads whose size, timing and share arriving before release are **unknown** and therefore swept. "Before release" means competitor requests reaching the provider during the last second and being held until it opens. That is modelled only, as a hypothesis about the provider; nothing here sends anything.
- Service times from off-peak FACTS: holds 1.1–2.6 s end to end; reads 70–100 ms.

**Signatures scored per simulated release:**

| Signature | Sept 25 observed | Sept 24 | Sept 23 |
|---|---|---|---|
| All our answers inside a window | 28.5–36 s (observed 29.1–34.6) | 16.5–29.5 s | 10.5–14.5 s |
| All 409 | yes | yes | yes |
| Spread of our answers | 4–7.5 s (5.5) | 8–13 s (10.8) | 0.8–3 s (1.8) |
| Kendall τ (edge order, answer order) | 0.33 ± 0.3 | — | — |
| ≥ 1 flush of our slow reads | yes (2) | — | — |
| A later fast read overtakes a stuck earlier one | yes (2) | — | — |

Each observed day scores a full match against its own signatures (self-check in the output and the tests).

**Fixed grid.** 38 provider variants × 48 crowd variants (checkouts 20/40/80/160, arrival mean 0.2/1/4 s, 10 or 40 reads/s, 0% or 30% arriving before release) × 5 seeds × 3 days = 27,360 simulated releases. **Random search** (Sept 25): 400 seeded draws per family over wider ranges, 3 seeds each (10,800 more). Half the search draws add a replica/cache read path (a share of reads answered without waiting), because §4.3 shows the real fast reads were stale.

**Results:**

| Family | Sept 23 (3 signatures): configs reproducing all | Sept 24 (3) | Sept 25 (6): grid | Sept 25: random search | Sept 25 signatures the family can produce (search) | Best mean score (of 6) |
|---|---|---|---|---|---|---|
| A edge FIFO | 2/144 | 0/144 | 0/144 | 0/400 | all but overtake | 3.00 |
| B instance admission | 3/144 | **1/144** | 0/144 | 0/400 | all six | **4.33** |
| C per-court lock | 3/144 | 0/144 | 0/144 | 0/400 | all but latency, flush, overtake | 2.67 |
| D optimistic | 0/144 | 0/144 | 0/144 | 0/400 | all but latency, flush, overtake | 2.33 |
| E retry/backoff | 0/192 | 0/192 | 0/192 | 0/400 | all but latency, flush, overtake | 2.67 |
| F facility/date serial | 14/576 | **7/576** | 0/576 | 0/400 | all but latency (a search without the replica path also reached latency) | 3.33 |
| G lanes | 28/192 | 0/192 | 0/192 | 0/400 | all but flush, overtake | 3.00 |
| H per-IP | 0/96 | 0/96 | 0/96 | 0/400 | all but latency, overtake | 3.00 |
| P processor sharing | 2/192 | **3/192** | 0/192 | 0/400 | all six | 3.00 |

"Configs reproducing all" = configurations in which at least one seed matched every signature of that day. No provider variant reproduced every day (the `joint` list is empty).

**What the replay supports:**

- **C, D and E cannot produce the Sept 25 read pattern** (slow reads flushing together while fast ones overtake) or the ~30 s waits anywhere in the searched ranges. G cannot produce the read pattern. **As sole mechanisms they are contradicted within the searched ranges.** This agrees with §4.2, reached independently from the raw data.
- **H and A cannot produce the overtaking fast reads.** Every request of ours passes the same per-IP or edge queue, so a later read cannot finish before an earlier stuck one, even when replica reads exist behind that queue. H also cannot produce the answer order (τ ≈ 0.33).
- **The read pattern needs two paths behind the edge.** It requires reads that wait on the same blocked resource as the checkouts (flushes), plus reads that bypass it (overtakes). Only families whose blocking stage sits behind the edge produce both: B (busy instance connections), F (a lock held while connections are held) and P (an overloaded shared processor). They produce them most easily with a separate replica/cache path, which matches the stale-read evidence of §4.3.
- **The ~30 s wait for requests reaching the provider at +30 ms requires dozens of transactions ahead of ours** in any order-preserving stage. In the configurations that reach it, 30–50% of the competitor checkouts arrive just *before* release (held until it opens), or the crowd is very dense in the first tens of milliseconds. Under FIFO, at ~0.6 s per transaction, a 30 s wait means ~50 transactions ahead. Either **~50 competitor checkouts reached the provider within ~30 ms of 08:00:00**, or **requests arriving before 08:00:00 were held and served first**. The second is exactly what could not be tested without a pre-release checkout. It remains a hypothesis to keep in view, not an instruction: sending early stays out of bounds.
- **No single simple mechanism reproduces all six Sept 25 signatures at once** in ~38,000 simulated releases. The likely reasons are that the provider combines elements (serialization + blocked instances/connections + replica reads + load-dependent service time), that the search did not reach the right corner, or that three seeds per configuration are too few for a six-way joint match. The simulator narrows the field. It does not identify the mechanism.

**A's position** (earliest stamp, last answer) is **not** reproduced together with the ordered other six by any tested model (§4.5 table).

Reproduce: `npx tsx scripts/replay-release-arbitration.ts` (identical output for identical inputs).

---

## 13. Safe experiments, ranked (F, G)

Ranked by information gained per unit of risk. None needs a pre-release checkout, a forged or reused proof, a security bypass, an identity/IP change or extra load at release beyond a few reads.

| Rank | Experiment | Status | Risk | What it settles |
|---|---|---|---|---|
| 1 | **Capture sanitized 409 structure** at the next release (§5) | Implemented, passive | none | "Already held" vs "not released" vs another code; whether the two body sizes are two paths |
| 2 | **Date competitors' commits from hold expiry.** 1 s reads across +9:55…+11:05 (`SLOT_WATCH_HOLD_EXPIRY_WINDOW_MS` in [`src/slot-watch.ts`](src/slot-watch.ts)) | Implemented (Slot Watch schedule) | none: the same public read at the same 1 s cadence the watch already uses in minute one | If cells reopen one by one, each reopening − 10 min is a competitor's commit time. That gives the provider's **commit order and rate during the release**, which directly tests F (evenly paced commits) vs B/E. If they reopen in one batch, expiry is a periodic job and doesn't date commits |
| 3 | **Critical-path telemetry** at the next release (§9) | Implemented, passive | none | Where our milliseconds go on the real PC: wake → worker → transport → evaluate → fetch → Chrome start → request event |
| 4 | **Read-side gate bracketing:** 3 extra reads at −1,000/−500/−250 ms | Proposed | very low | Bounds the read-side release instant to ~250 ms each day |
| 5 | **Off-peak read concurrency 1/2/4/7** (harness below) | Implemented, offline-tested, not run live | low | Whether simultaneous requests from one client are serialized on the read path |
| 6 | **One proof-backed attempt** in parallel, via the normal UI flow, on a distinct target the operator genuinely wants | Proposed | low (a normal booking) | G at the arbitration layer: does the proof lane reach the commit sooner? |
| 7 | **Cebu vs Singapore, read-only** (procedure below) | Procedure written | low | Whether geography changes latency or region (`x-vercel-id`). At most ~20 ms of arrival order, against ~30 s of queue |
| 8 | **Renderer dispatch offline benchmark on the Windows release PC** | Tool ready (`--dispatch renderer`) | none (offline) | Whether the renderer path meets its targets on the real hardware (§10–11) |

Not proposed, because each needs something out of bounds:

- measuring the checkout gate (a pre-release POST);
- testing whether early arrivals queue (a pre-release POST);
- testing duplicate or speculative holds (exploiting holds, degrading service for others);
- adding more concurrent checkouts to "buy" queue positions (load and fairness).

These stay hypotheses.

### F. Read concurrency harness

Files: [`src/arbitration/read-concurrency.ts`](src/arbitration/read-concurrency.ts), [`scripts/characterize-read-concurrency.ts`](scripts/characterize-read-concurrency.ts), tests in `tests/arbitration/read-concurrency.test.ts`.

- **What it sends.** Only the booking page's own read: `GET /api/public/facilities/{facility}/date-availability?startDate=…&endDate=…&duration=60&includeSchedule=true`, with credentials omitted and no cookies. Levels 1/2/4/7 run in a balanced, shuffled order; rounds are ≥ 5 s apart; at most 120 requests in total.
- **Enforced in code:**
  - refused between 07:45 and 08:45 Manila;
  - stops at the first 403, 429, 5xx, `cf-mitigated`/`x-vercel-mitigated` challenge, non-JSON page, transport error or read slower than 10 s;
  - live only with the exact acknowledgement `--live READ_ONLY_PUBLIC_AVAILABILITY`.
- **Output.** `.local/arbitration/read-concurrency-<label>-<time>.json` (ignored by git), with timing, status, cache, region and allowlisted headers only.
- **Analysis.** Per level: latency p50/p95/p99, completion span, a **serialization index**, and launch-vs-completion order τ.
  - Serialization index = completion span ÷ (level − 1) ÷ median single-read latency: ≈1 serialized, ≈0 parallel.
  - Offline, against two local servers, it separates a serializing server from a parallel one (the test asserts > 0.6 vs < 0.35).
- **Caveat.** It measures the read path. The checkout path can be limited differently, but checking that would need writes.

### G. Cebu vs Singapore procedure (read-only; operator-run; never automated)

1. **Same software.** Pick the same commit on both hosts: the Cebu release PC and a Singapore host that the operator controls and is allowed to use. Do not rotate IPs or accounts, and do not use a host to get around any limit.
2. **Off-peak.** Use the same off-peak hour for both, e.g. 14:00–16:00 Manila on a weekday. Never between 07:45 and 08:45; the harness refuses that window anyway.
3. **Run.** On each host: `npx tsx scripts/characterize-read-concurrency.ts --live READ_ONLY_PUBLIC_AVAILABILITY --dates <two already-published dates> --label <cebu|singapore>`.
4. **Security flow.** If a host gets a challenge, 403 or 429, the harness stops. **Stop there.** Do not retry from another address and do not work around the provider's normal security flow. Record that host as unsuitable.
5. **Compare the two JSON files:**
   - latency p50/p95/p99 at level 1;
   - `x-vercel-id` regions (both are expected to be `sin1→sin1`);
   - the edge-stamp minus local-send difference (a one-way latency estimate);
   - serialization index per level;
   - cache status.
6. **Decision rule.**
   - Geography matters only if level-1 p50 differs by more than the release queue variation. Sept 25 answers spanned 5.5 s; send-to-edge was about 20 ms.
   - With a ~30 s provider queue, a 10–20 ms edge advantage changes the outcome only if the queue is FIFO **and** competitors arrive within the same 10–20 ms.
   - Experiment 2 is what tells whether that holds.
   - **No live checkout from new infrastructure** unless a separate, explicit decision is made after all of the above.

---

## 14. Contradictions and open questions (searched for explicitly)

| # | Tension | Status |
|---|---|---|
| 1 | Answer order vs send order is uncorrelated (τ = 0.10), yet answer order matches the `x-vercel-id` order for 6 of 7. | Resolved as far as the data allows: send order within 1.9 ms is below network jitter; arrival order (by stamp) is what matters. A is the open exception |
| 2 | A: first stamp, last answer. | OPEN. Explained by B+F (front-stage wait) or E (retry). UNKNOWN which |
| 3 | Fast reads kept answering while current-data reads and our POSTs stalled. | Resolved as INFERENCE: two read views (§4.3). It also means fast reads during the rush can't be trusted as current |
| 4 | B/C targets looked open at +18.0 s but were lost to commits before +28.9 s, while our B/C POSTs had been at the edge since +31 ms. | OPEN. Either competitors reached the commit point before us (earlier arrival, or non-FIFO), or the +18.0 s read was stale (§4.3). Experiment 2 dates those commits |
| 5 | Sept 24: three answers exactly 5.4 s apart, in reverse send order. Sept 25: irregular gaps, stamp order. | OPEN; n=3 on Sept 24. Random grant order (F-random) or retry schedules (E) fit Sept 24; FIFO fits Sept 25. The replay scores both days (§12) |
| 6 | Two 409 body sizes that don't follow timing, court or start time. | OPEN until experiment 1 |
| 7 | Sept 25 sends were ~90 ms earlier than Sept 24's, yet the waits were longer. | Consistent with a queue position decided by others' arrivals and the day's load, not by our send time |
| 8 | Off-peak: no proofless penalty. At release: no data. | OPEN (experiment 6) |
| 9 | "Pending" public records lasting well past 10 minutes (Sept 25 report §12) vs a 10-minute hold. | OPEN. "Pending" may include states other than the checkout hold (e.g. awaiting payment confirmation). The +600 s cluster still fits the hold |
| 10 | Reopenings at +390–420 s of cells that were open at publication. | Resolved as "not 10-minute expiries" (cancellation or abandonment), so reopen time − 10 min is **not** a commit time for every reopening. Experiment 2 must use only reopenings of cells that were taken early |
| 11 | The dispatch clock bound (±24.2 ms) is larger than the effects discussed at the ms scale. | Real limit: statements about ±10 ms vs competitors are not supportable from our clock alone. Relative order of our own events is fine |
| 12 | Sept 12: a release-time checkout sent at +9.5 s got a hold in ~3.8 s, while Sept 23–25 checkouts sent at +10…+104 ms waited 11–35 s. | Consistent with demand-dependent congestion (a Monday target vs weekend targets). It cannot separate demand from lane: Sept 12 was the proof-backed UI flow, Sept 23–25 were API proofless checkouts, and on Sept 23 the proof-based lanes never sent a checkout. Experiment 6 separates them |

---

## 15. Decision matrix and recommended architecture (I)

Each row states only what the evidence supports. "Out of bounds" means excluded by the investigation's safety rules whatever it might gain.

| Option | Evidence for | Evidence against | Decision |
|---|---|---|---|
| Keep the armed Node path as the default dispatch | Exactly-once and journaled. Pre-POST at +0.4–2.9 ms; Chrome start ≤ +10.6 ms on the release PC (FACT) | — | **Keep** |
| Enable renderer-resident dispatch live | Offline on this container, 1–3 workers: `fetch()` 2.0–3.7 ms earlier at p50 (1 worker 0.80 vs 2.82 ms; 3 workers 0.86 vs 4.52 ms) | Targets not met at 7 workers here (§10–11). Not benchmarked on the Windows release PC. Its gain (ms) is four orders of magnitude below the provider wait (~30 s). Arrival order at the provider is not established as FIFO across customers: §4.5 suggests an order-preserving stage for our own requests, which would make milliseconds matter only if competitors arrive within the same tens of ms. §13 rank 2 decides that first | **Do not enable.** Keep behind the flag; benchmark offline on the release PC (§13 rank 8) |
| Send before the release instant | — | Out of bounds (pre-release checkout) | **No** |
| More simultaneous checkouts or retries per target | — | Adds load at the provider's worst moment; flooding is out of bounds; the release data don't show that it helps | **No** |
| Capture 409 structure, critical path, hold-expiry dates | Zero risk; answers the top unknowns (§5, §9, §13 ranks 1–3) | — | **Done** (implemented; runs at the next release) |
| Read-side gate bracketing (3 reads) | Very low risk; bounds the read-side release instant | The checkout gate stays UNKNOWN | **Do next** (small Slot Watch change) |
| Off-peak read concurrency harness | Low risk; tests per-client serialization on reads | Reads only | **Operator may run** off-peak |
| One proof-backed attempt on a distinct, genuinely wanted target | Tests G at the release | Needs a real extra target | **Do** when the operator has one |
| Singapore host | ≤ ~20 ms nearer the `sin1` edge | ~30 s queue; a new host may meet the provider's security flow; no live checkout from new infrastructure | **Read-only comparison only** (§13 G) |
| Act on hours that reopen after the rush (+4, +7, +10.5 min) | FACT on both observed releases; the Sept 25 report §11 showed a fully open candidate at +630 s | Competitors re-took some within 30 s; fast reads during the rush can be stale (§4.3) | **Supported** (Sept 25 report §2). Addition from this investigation: base triggers on reads that are not provably stale |
| Treat any fast OPEN read in the first minute as current | — | Provably stale fast reads (§4.3) | **No** |

### Recommended architecture (evidence-based)

1. **Dispatch.** Keep the armed Node path. The send side was 9.8–11.7 ms after release, and the outcome was decided ~29–35 s later at the provider's commit. Further send-side work is not where the outcome is decided today.
2. **Ownership.** Ownership is the provider's commit inside public-checkout (§6). The measure of success is "our commit happened while inventory existed", not "our packet left early". This favors more *distinct, genuinely wanted* candidates reaching a commit while inventory exists: Wave 2/Rescue on the published grid and the reopen windows, as the Sept 25 report recommends. It does not favor faster or more duplicated requests for the same target.
3. **Observation before optimization.** Run the next release with the passive captures on:
   - 409 structure;
   - critical path;
   - the 1 s hold-expiry read window.

   Together they answer whether 409s mean "held" or "not released", where our milliseconds go on the release PC, and, from dated competitor commits, whether the provider's commits are evenly paced (serialized) and in what order. That is the red team's W6.
4. **Read handling.** During the rush, prefer reads that are not provably stale when deciding to act: for example, reject a read whose taken count is below one already seen by a completed earlier read.
5. **Experimental paths stay experimental.** The renderer path stays off behind its flag until it meets its targets on the release PC across repeated offline benchmarks, and even then only if the commit-dating data show that arrival order matters.

---

## Appendix: what changed, how it was checked

### Files

| Area | Files |
|---|---|
| Report | `SERVER_ARBITRATION_INVESTIGATION.md` (this), doc-map lines in `README.md`, `REVIEW_GUIDE.md`, `diagnostics-archive/README.md` |
| Evidence (A, B) | `src/arbitration/archive-evidence.ts`, `src/arbitration/release-timeline.ts`, `src/arbitration/stats.ts`, `scripts/analyze-release-arbitration.ts`, `diagnostics-archive/2026-09-25/arbitration/{release-2026-09-25.timeline.jsonl, arbitration-evidence.json, replay-arbitration.json}` |
| 409 diagnostics (C) | `src/api-booking/response-evidence.ts`, `browser-session-transport.ts`, `checkout-provider-trace.ts`, `desktop-runner.ts`, `run-diagnostics.ts` |
| Critical path (B/D) | `src/api-booking/critical-path.ts`, `src/api-booking/renderer-clock.ts`, runner wiring |
| Renderer dispatch (D) | `src/api-booking/renderer-dispatch.ts`, `armed-dispatch.ts`, transport |
| Benchmarks and gates (E) | `scripts/benchmark-precision-release.ts` (`--dispatch`, `--prewarm-lead`, `--critical-path`, `--renderer-calibration`, `--chrome`), `scripts/benchmark-critical-path-overhead.ts`, `src/arbitration/benchmark-gates.ts`, `scripts/check-release-performance-gates.ts` |
| Harness and procedure (F, G) | `src/arbitration/read-concurrency.ts`, `scripts/characterize-read-concurrency.ts` |
| Simulator and replay (H) | `src/arbitration/contention-sim.ts`, `src/arbitration/release-replay.ts`, `scripts/replay-release-arbitration.ts` |
| Slot Watch | `src/slot-watch.ts`: 1 s reads across +9:55…+11:05 |
| Tests | `tests/api-booking/{response-evidence, checkout-response-evidence, critical-path, renderer-dispatch}.test.ts`, `tests/arbitration/{archive-evidence, contention-sim, benchmark-gates, read-concurrency}.test.ts`, `tests/slot-watch.test.ts`, and a fixture fix in `tests/api-booking/proofless-checkout.test.ts` |

### Commands and results

Environment: this cloud container, Linux, 4 vCPU.

- The repository needs Node ≥ 24; the container had Node 22, so Node 24.21.0 was downloaded to the session scratch area (SHA-256 verified) and used for everything.
- Playwright expects Chromium build 1243. Only build 1194 is installed, so a scratch-directory mapping pointed Playwright at it; `/opt` was not modified and nothing was downloaded by Playwright.
- No request was made to Onda.

| Command | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` (full suite) | Final run: 1,088 passed, 4 skipped, 1 failed. The failure is the pre-existing environment one below. See also the intermittent armed-dispatch note below |
| `npx tsx scripts/analyze-release-arbitration.ts` | regenerated `release-2026-09-25.timeline.jsonl` (284 events) and `arbitration-evidence.json` |
| `npx tsx scripts/replay-release-arbitration.ts --seeds 5 --search 400` | `replay-arbitration.json` (§12); deterministic |
| `npx tsx scripts/benchmark-precision-release.ts --mode armed --dispatch node --prewarm-lead 1400 --workers 1,3,7 --runs 80` | §11 table; 880 attempts, all REJECTED offline |
| same with `--dispatch renderer` (8-sample calibration, then adaptive) | §11 table |
| `… --workers 7 --prewarm-lead 4000` (node and renderer) | §11 second table; 1,120 attempts, all REJECTED offline |
| `npx tsx scripts/benchmark-critical-path-overhead.ts --workers 7 --warm 20000 --cold 40` | §9 table |
| `npx tsx scripts/check-release-performance-gates.ts --summary … [--baseline …]` | §11 |
| `npx tsx scripts/characterize-read-concurrency.ts --rounds 3` (offline self-test) | serialization index: parallel server 0.006–0.008, serializing server 0.96–0.98; `--live` without the exact acknowledgement is refused before any request |

Benchmark raw and summary JSON were written to the session's scratch directory. Following the repository convention for `.local/benchmarks`, they are not committed; the tables above reproduce them.

**Failures and fixes during the work:**

- **Pre-existing time-bomb fixture.** `tests/api-booking/proofless-checkout.test.ts` had two tests failing because the fixture's `hold_expires_at` (2026-09-25T02:05Z) had passed. Fixed by making it ten minutes after the test start.
- **Pre-existing environment failure.** `tests/availability-browser.test.ts` › "a reload-destroyed browser request is not retried" fails in this container with the substitute Chromium build. It fails without these changes too and is untouched.
- **Intermittent, load-sensitive armed-dispatch tests (not resolved).**
  - One full-suite run failed `tests/api-booking/armed-dispatch.test.ts` › "G. a verified hold is VERIFIED…"; its error text was not captured.
  - It passed in 3 isolated runs and in the next full-suite run.
  - Under 4 artificial busy loops, 6 runs on the base commit (`3235251`, before the dispatcher changes) and 6 on the final tree all passed.
  - One earlier stressed run, with heavier load and probably the container's default Node 22, failed a different real-timer test in the same file ("a verified hold is handed to the QR step…": no verified hold, consistent with dispatch starved past its window and refusing, i.e. fail-closed).
  - The dispatcher changes are confined to the renderer branch, which these tests do not enable. The added real-Chromium tests do raise the suite's CPU load, though.
  - No cause was established, so this is recorded as open rather than dismissed.
- **CI on the pull request (both fixed).**
  - The first run failed the new real-Chromium renderer dispatch test. On a busy runner, one page-clock calibration was looser than the production 2 ms limit, so that attempt correctly fell back to the Node path, and the test treated the fallback as a failure. The test now calibrates adaptively as production does. It accepts a looser bound, which can only make the page fire later. It retries only fallbacks caused by load. Under 4 busy loops, the renderer tests failed 1 of 6 runs before the change and 0 of 8 after.
  - A later run failed a pre-existing test, `tests/api-booking/phase2-independence.test.ts` › "an observer that crashes…", with one attempt `UNKNOWN`.
    - The test faked an unwritable observer log by closing the Slot Watch's file descriptor while the watch kept using that number.
    - A checkout journal file opened during the release could receive the same number. The watch then wrote its failure records into the journal and, at stop, closed the journal's descriptor.
    - The defect was test-only: in production the watch closes its own descriptor once, after every read has settled.
    - The test now gives the watch a read-only descriptor, so every write still fails, and checks that nothing after the header reached the log. Vitest runs each test file in its own process, so this race cannot explain the armed-dispatch failures above.
    - With 80 observer writes around the release, the old test failed 12 of 12 runs and the new one 0 of 12. On the fix commit (`66331f8`), both CI runs passed.
- **Found by review and fixed:**
  - a hanging renderer calibration could have held the Node path past release; it is now bounded;
  - the benchmark reused page keys and was refused (`RENDERER_ALREADY_ARMED`, a correct refusal), which led to refused keys being released while fired keys stay sticky;
  - the recorder's cold first-call cost (~0.2 ms at T−0) is now removed by the pre-release warm-up.
