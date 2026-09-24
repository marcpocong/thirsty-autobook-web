# Release forensics, Phase 2: observability without touching the release path

Status: implemented and verified offline on 2026-09-24. **Not yet exercised at a real 08:00 release.**

Goal: make the next 08:00 release reconstructable from evidence, without changing booking strategy and without
slowing the Phase 1 dispatch. Phase 2 only observes. It contains no customer IDs, contact hashes, names, phones,
emails, tokens or journal keys.

## 1. Slot Watch (read-only observer, desktop app main process)

### Before

- One read at a time: the loop waited for a read to finish before moving to the next scheduled read.
- 5 s read timeout.
- Response time was used as the observation time.

What that cost on 2026-09-24: reads at +0.26 s and +0.76 s answered quickly without the target date; the +1.26 s and
+6.27 s reads each hit the 5 s timeout; so the first published grid came from a read **requested at +11.29 s**
(answered +15.74 s). Release-time reads took 3.7–6+ s for about 30 s after release on both 09-23 and 09-24,
then about 100 ms.

### Now

| | |
| --- | --- |
| Early launches | T+0, +0.25, +0.5, +1, +2, +5 s, launched on time even while earlier reads are still waiting |
| Then | every 1 s to +60 s, every 5 s to +5 min, every 30 s to +15 min (−60 s…−2 s before release as before) |
| In-flight cap | 6 availability reads. The early burst is 6 launches, so six 6-second reads all still launch |
| Cap reached | the launch is written as `not-launched` (`CAP_REACHED`), never as an observation |
| Late launch (> 1 s, e.g. PC sleep) | written as `not-launched` (`LATE`) |
| Read timeout | 15 s (measured release reads took up to ~6 s) |
| Rate | 11 planned reads in the first 10 s (the old schedule planned 20); overlap only when Onda is slow |
| Public booking reads | separate schedule (−60 s, +2 s, +10 s, +30 s, +1, +2, +5, +10, +15 min), one at a time; a launch while the previous read is still running is written as `not-launched` |

Every availability read records: `seq` (request order), scheduled offset, request start (ISO + offset), response
(ISO + offset), duration, `dateFlag` (published / unpublished / absent), `responseComplete` (date published **and**
all 112 cells present), the exact 112-cell matrix, per-cell prices, and the edge cache status (`x-vercel-cache`,
`age`) when present. Booking reads record their own `seq`, request/response offsets, failed court queries and the
matching court/hour cells. A clock line is written whenever the network-clock offset changes.

### Out-of-order answers

1. Raw evidence: the NDJSON log is written in response order (`seq` keeps request order).
2. Request-order evidence: all derived evidence (`src/slot-evidence.ts`) sorts reads by `seq`; `summary.json` has a
   `requestOrder` row per launched read.
3. UI rule: the current matrix is the **newest request that has answered**. A late answer to an older request never
   replaces it.

A change is reported between two reads in request order, with both reads' request and response times. When the two
reads' intervals overlap it is flagged "reads overlapped: their provider-side order is not established". No
provider-side moment is ever claimed.

### First-published evidence

- Grid: the earliest *request* whose answer had the date (also the earliest *answer* when that differs), and the
  last read without the date.
- Every court/hour: first-published state (OPEN / UNAVAILABLE / UNKNOWN) and price; first OPEN; first unavailable;
  first OPEN → unavailable and first unavailable → OPEN (each with the bracketing reads); first public booking
  record and its disappearance (a failed court query is unknown, never "no record"); latest state.
- Target ranges: FULLY_OPEN only when every hour is open; any unknown hour gives UNKNOWN_INCOMPLETE; otherwise
  PARTIALLY or FULLY_UNAVAILABLE. Forensic only: never used to choose or send a checkout.

### Wording

"likely venue block" is gone. Evidence-only phrases: "unavailable · no matching public booking record · cause
unknown", "OPEN → UNAVAILABLE", "UNAVAILABLE → OPEN (reopened; cause unknown)". A public booking record is described
as a record that exists, not as anyone's booking. Older (version 1) Slot Watch files are shown as legacy entries;
their own saved reports are left as they were written.

## 2. Passive checkout provider trace (runner)

`src/api-booking/checkout-provider-trace.ts`. One extra Chrome DevTools session per dispatching worker page.

- **Attached at T−2 min with no domain enabled** (no per-request cost).
- **Network is enabled for all traces together once every traced worker's POST request event has been seen**
  (on a later macrotask), so no DevTools command is sent while another worker's POST may still be on its way.
  Fallbacks: 50 ms after the first POST, and T+1.1 s (after the one-second dispatch window). Chrome still reports
  the in-flight request's response to a late-enabled session (verified in real Chrome).
- Two earlier designs were measured and rejected: enabling before release added 1–3 ms to request initiation at
  3–7 workers; enabling each worker as soon as its own POST was seen left first-request timing unchanged but
  widened the 7-worker first-to-last spread from ~1 ms to ~4 ms.
- Commands sent: `Network.enable` and `Network.disable` only. No Fetch domain, request interception, extra headers,
  cache override or Runtime calls. Checkout still runs through the page's own `fetch`.
- It never subscribes to request events, so request headers, cookies, the Turnstile token, the fingerprint and the
  request body never reach it (`maxPostDataSize: 1` as well).
- Written to `.local/release-forensics/<runId>/provider-trace.ndjson` only after every attempt has settled.
- Any failure (attach, enable, handler) leaves the trace unavailable; checkout is unchanged.

Captured when Chrome exposes it:

| Field | Source |
| --- | --- |
| protocol (`h2`, `http/1.1`, `h3`…), connection reused | `Network.responseReceived` |
| DNS, connect, TLS, send, wait (send → first header byte) | ResourceTiming; `null` when Chrome reports −1 (e.g. reused connection) |
| response headers first/last byte, body complete (or failure) | ResourceTiming and `loadingFinished`/`loadingFailed`, browser-monotonic from Chrome's network request start |
| status, media type, `server`, `cf-ray`, `cf-mitigated`, `x-vercel-id`, `x-request-id`, `x-vercel-cache`, `age`, `server-timing` names/durations | strict per-header patterns; a value that does not match is dropped, never truncated |

Never stored: cookies, `Authorization`, Turnstile token, fingerprint, request body, response body, customer data,
checkout token, payment data, QR payload, local or remote IPs, TLS details, any other header, `server-timing`
descriptions.

Limit: a response that arrives before the late enable (tens of ms after the POST) is not traced; the runner still
records its status and duration. A request that fails before any response header is not traced either.

The existing sanitized `checkoutDiagnostic` categories (`errorHint`, `responseSource`) are now also on the run trace's
`CHECKOUT_RESPONSE_COMPLETED` event (computed after the response, as before).

## 3. Post-run forensic report

`src/release-forensics.ts`, built by the desktop app **after the runner process has exited**:

- a PRELIMINARY report right after a live run (the Slot Watch is normally still running), and the FINAL one when that
  watch ends (about +15 min);
- `npm run release:forensics -- --run <runId> [--watch <file>] [--out <dir>]` rebuilds it from files at any time.

Files: `.local/release-forensics/<runId>/summary.json` and `report.txt`, next to `provider-trace.ndjson`. Raw
evidence is referenced, not copied (runner trace in `.local/api-booking/run-progress/`, Slot Watch log in
`.local/slot-watch/`).

Sections: release clock (T-10M, T-60S, T-30S rounds; observer − dispatch clock difference), POST initiation per
worker, first published grid, per-target correlation (POST, first-published range state with the read's
request/response times, first fully-open read, first unavailable read, public booking record, reopen, checkout
status and hint, response headers and body complete, protocol/connection reuse, provider IDs), availability
transitions, public booking evidence, provider trace, checkout outcome, limitations. When the first published read
was requested after a POST, the report says the grid at POST time was not observed.

The Runs view shows one concise card per report; the Slots view shows the first-published timing, the current or
first-published matrix, the request/response windows of each change, and in-flight / not-launched counts.

## 4. Independence from checkout

- The runner does not import the observer or the report builder (test-enforced).
- `tests/api-booking/phase2-independence.test.ts` runs a real armed Precision dispatch next to: an observer read that
  hangs 3 s (later early reads still launch on time), an observer that throws / whose UI callback throws / whose log
  handle breaks, an observer stopped at the release instant, and provider traces whose attach is refused, whose
  listeners throw, whose commands fail and whose events explode. Outcomes and POST timing match the baseline.
- `tests/api-booking/armed-hot-path.test.ts` (Phase 1) now also runs with 7 attached traces: still nothing but the 7
  POSTs between release and the last POST, and every `Network.enable` comes after its own worker's POST.

## 5. Benchmark

`npm run bench:release -- --mode armed --workers 1,3,7 --runs 100 --priority window --response-delay 50 [--phase2 on|trace]`
(Phase 1 harness: headless Chrome per worker, nothing leaves the machine; request initiation = Playwright request event).
ON = the provider trace exactly as the runner uses it **plus a Slot Watch in the same process** firing its T+0 read at the
release instant (worst case; in production the watch runs in the desktop app process). `--response-delay 50` holds each
synthetic 409 so the late-enabled trace can record it (same value for OFF and ON). ON was run between two OFF passes;
this PC was also running other work, and OFF-to-OFF drift is 1–3 ms at p50.

ms after the release deadline, p50 / p95 / p99 / max, 100 runs each (2026-09-24, final design):

| Workers | Metric | OFF (before) | **ON** | OFF (after) |
| --- | --- | --- | --- | --- |
| 1 | first = last request | 3.6 / 4.3 / 4.5 / 4.9 | 3.6 / 5.0 / 5.4 / 5.9 | 2.6 / 3.0 / 3.0 / 3.1 |
| 3 | first request | 4.8 / 6.5 / 7.7 / 8.6 | 5.0 / 6.9 / 7.6 / 8.2 | 3.3 / 3.9 / 4.2 / 4.2 |
| 3 | last request | 5.7 / 7.7 / 8.7 / 9.7 | 6.1 / 7.8 / 8.7 / 8.7 | 4.0 / 4.6 / 4.8 / 4.9 |
| 3 | first-to-last spread | 0.9 / 1.6 / 1.8 / 2.0 | 1.1 / 1.6 / 1.8 / 2.7 | 0.7 / 1.0 / 1.3 / 1.3 |
| 7 | first request | 6.3 / 10.0 / 13.0 / 14.1 | 8.9 / 11.6 / 12.9 / 13.1 | 5.3 / 6.6 / 254.3* / 254.3* |
| 7 | last request | 7.9 / 11.5 / 13.5 / 14.5 | 10.1 / 13.7 / 15.4 / 15.6 | 6.1 / 7.2 / 255.0* / 255.0* |
| 7 | first-to-last spread | 0.9 / 1.8 / 2.2 / 2.2 | 1.1 / 2.4 / 2.8 / 3.4 | 0.8 / 1.3 / 51.5* / 51.5* |

* one machine stall in that OFF pass (14 attempts outside the window, no Phase 2 code running). All other passes: every attempt sent and REJECTED as expected; ON captured every trace (7 of 7 per 7-worker run).

Attribution at 7 workers, trace only (the runner-side production setup) interleaved with OFF, two passes each, 60 runs per pass, pooled (120 runs):

| 7 workers | first request | last request | spread p50 / p95 |
| --- | --- | --- | --- |
| OFF | 9.1 / 11.5 / 12.5 / 12.5 | 10.2 / 12.9 / 14.2 / 17.9 | 1.1 / 2.3 |
| trace only | 9.0 / 13.4 / 15.7 / 15.9 | 10.0 / 15.5 / 17.6 / 20.1 | 1.2 / 2.3 |

Medians and spread match; the tails swing both ways between passes (trace pass 1 p95 9.8 ms, pass 2 15.4 ms) and are within this
machine's pass-to-pass noise. By construction the trace sends and receives nothing between release and the last traced POST.

Rejected designs, same harness: Network enabled before release (+1–3 ms at 3–7 workers); enabling each worker on its own POST
(7-worker spread p50 ~4 ms vs ~1 ms). Raw and summary JSON: `.local/benchmarks/*phase2*` (ignored by git).

## 6. Not established by any of this

- Who or what made a court unavailable; a public booking record's owner.
- Why an unavailable court has no public booking record.
- How Onda queues or orders checkout requests, or why one was accepted or rejected.
- Whether connection timing caused a win or a loss.
- The meaning of the time-like component inside `x-vercel-id` (undocumented; stored, not interpreted).
- Whether an edge-cached availability answer (`x-vercel-cache`/`age`) reflects an earlier state than its request.
