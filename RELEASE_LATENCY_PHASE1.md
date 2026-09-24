# Release latency, Phase 1: durable pre-armed Precision dispatch

Status: implemented and verified offline on 2026-09-24. **Not yet exercised at a real 08:00 release.**

This note specifies what changed on the Precision release path, the crash semantics, and how the
latency was measured. It contains no customer IDs, contact hashes, names, phones, emails, tokens or journal keys.

## 1. Release clock

| | Before | After |
| --- | --- | --- |
| Sampling | One round, three Google hosts, one sample each; the lowest round trip wins | Five Google hosts (`time`, `time1`–`time4`), two spaced samples each, in parallel |
| Near release | T-10 min (retry T-5 min); nothing in the last 3 min | T-10 min consensus, then **T-60 s and T-30 s** consensus rounds |
| Selection | Single sample | Drop samples over 250 ms RTT; keep RTT <= max(2 x fastest, fastest + 15 ms); keep samples whose +/- RTT/2 interval contains the provisional median; offset = median of the kept samples |
| Quality | None | `GOOD` needs >= 3 consistent samples; a near-release round that is not GOOD is not adopted |
| Final wait | `Date.now() + offset` polled with 500 ms timers; a 20 ms spin only if the timer happened to land inside it | Monotonic deadline: `releaseMono = performance.now() + (releaseMs - (Date.now() + offset))` at anchoring; sleep until `releaseMono - tail`, then spin |
| No-early check | `Date.now() + offset >= release` | Same anchored clock as the wait (immune to a later Windows wall-clock step); checked in the fire step and again as the transport's last step |

- The consensus re-anchors the clock at each adopted round; the wait re-reads the deadline on every iteration.
- A round that would move release **earlier** by more than 100 ms is not adopted (a later or small change is).
- Degraded or failed near-release rounds keep the previous clock; with none adopted the fresh T-10 min consensus is used; a stale sync (> 2 h) still fails closed before dispatch.
- Reported per round (run trace and `.local/network-clock-evidence/`): offset, sample count, kept/rejected samples, min/median/max RTT, offset spread, and an error bound `min(|selected - sample| + RTT/2)`. That bound is millisecond-scale (about half the fastest RTT, ~20 ms from Manila). Nothing here claims sub-millisecond truth.
- The Windows clock is never changed.

## 2. Durable pre-armed dispatch

### Before (per worker, after T-0)

1. Global lock rewrite to `FINAL_ACTION_DISPATCHING` (read, temp write, fsync, rename), awaited by every worker.
2. Request construction, journal-key and plan-fingerprint hashing.
3. Journal `begin()`: mkdir, exclusive create, write, fsync.
4. One-shot claim: journal readback, mkdir, exclusive create, write, fsync.
5. Transport: key hashing again, permit consumption, final window check, CDP `evaluate` + in-page `JSON.stringify` + `fetch`.

### After

At the T-2 min freeze, `armPrecisionRace()` does everything durable or costly:

- builds each exact request, deep-freezes it, serializes it once, and caches its journal key and body with the transport;
- computes the plan fingerprint;
- rewrites the global lock to **`FINAL_ACTION_ARMED`** (`releaseAt`, `dispatchDeadlineAt`, `armedCount`);
- creates each target journal as **`armed`** (written and flushed under a temporary name, hard-linked into place, flushed again: complete or absent);
- claims each write-once one-shot file (complete and flushed before the in-memory permit exists).

At T-0 (`dispatchArmedPrecisionRace()`), in one synchronous pass per ready worker:

1. abort check;
2. in-memory one-shot state check;
3. trusted-clock no-early and maximum-lateness check (same anchored clock as the wait);
4. in-memory one-shot flip (`armed` -> `fired`);
5. browser transport call: prepared-security check, cached-key permit consumption, final window check, CDP `evaluate` of the pre-serialized body, `fetch`.

No file is created, written, flushed, renamed or read, nothing is hashed or built, and no lock is touched
between T-0 and the POSTs. Diagnostics for the two pre-POST events are timestamped at the event and
recorded on a later macrotask. `FINAL_ACTION_DISPATCHING` is written only after every ready POST has started.
`tests/api-booking/armed-hot-path.test.ts` wraps `node:fs`, `node:fs/promises`, `node:crypto` and the request
builder and proves this for 1, 3 and 7 workers with the real browser transport.

### Crash semantics

A crash (or power loss) at each point, and what a restart concludes:

| Point | Durable state left behind | Restart conclusion |
| --- | --- | --- |
| A. before arm completes | no journal, a stray temp file, or `armed` with no complete one-shot claim | **Provably unsent**: the permit is created only after the claim file is complete and flushed. Archived to `unsent-attempts/`, target reusable. |
| B. after arm, before release | `armed` + claimed one-shot; lock `FINAL_ACTION_ARMED` | **Blocked / manual reconciliation.** Not inferred from the label or the clock. Only the live process, holding the unspent permit, can record it unsent (abort, prewarm failure, window missed). |
| C. at/around release | same as B | Blocked / manual reconciliation. |
| D. after the transport call, before a request event | `armed` + claimed one-shot | Potentially dispatched. Blocked; never retried. |
| E. POST may have left, no response | `unknown` (or `armed` if the crash beat that write) | UNKNOWN; blocked; never retried. |
| F. confirmed HTTP/application rejection | `rejected` | Conclusive; reusable only through the existing recycle logic. |
| G. verified hold | `verified`; lock `HOLD_VERIFIED` | Hold retained; blocked until every hold expiry has passed. |

The invariant "a request left, the process died before a later write, the restart sees armed-but-unsent and
sends again" cannot happen: an armed record with a claimed one-shot is never reusable after a crash, and a
second arm of the same logical target fails on the exclusive journal create. The cost is a possible false
positive (manual reconciliation) after a crash between T-2 min and the outcome.

Lock recovery: Reset & Prepare, Review Lock, the retained-hold status and practice reset treat
`FINAL_ACTION_ARMED` like `FINAL_ACTION_DISPATCHING`. The 11-minute safety window counts from `dispatchDeadlineAt`
(not from the earlier arm time); an armed lock without that field never recovers from a clean Schedule alone
(a proofless POST does not navigate the tab, so a clean tab proves nothing).

Process priority: HIGH (never REALTIME) from T-1 s until the POSTs have left, then restored (see section 3).

Stop: the waits use the runner's abort-aware pause, so the runner disarms and releases the lock well inside
the UI's 350 ms stop window. If it is killed anyway, the journals stay blocked (conservative).

## 3. Benchmark

`npm run bench:release -- --mode legacy|armed --workers 1,3,7 --runs 100` (script: `scripts/benchmark-precision-release.ts`).

- Real Chrome, headless, one process per worker, attached over CDP like production; DNS disabled and all traffic proxied
  to a closed local port; every `app.onda.fit` request fulfilled locally (checkout -> synthetic HTTP 409). Nothing leaves the machine.
- Real lock, journals, one-shot, transport, race code and progress log in a scratch directory; synthetic customer and security headers.
- `legacy` reproduces the pre-Phase-1 runner composition exactly (including its inline 500 ms-poll scheduler).
- Request initiation = the Playwright `request` event (the production evidence). Times are relative to the monotonic release deadline.
- Two warm-up runs per configuration are discarded. Raw and summary JSON: `.local/benchmarks/` (ignored by git).

All values are milliseconds after the release deadline, p50 / p95 / p99 / max, 100 runs per configuration (offline, 2026-09-24, this PC).

**Release -> request initiation (Playwright request event)**

| Workers | Path | First request | Last request | First-to-last spread |
| --- | --- | --- | --- | --- |
| 1 | BEFORE (legacy) | 51.2 / 68.6 / 82.2 / 94.6 | same | 0 |
| 1 | same-session legacy control | 51.3 / 68.5 / 87.2 / 89.4 | same | 0 |
| 1 | **AFTER (armed, tail 50)** | **2.7 / 3.3 / 3.4 / 3.6** | same | 0 |
| 3 | BEFORE | 25.7 / 68.3 / 96.2 / 787.6 | 28.2 / 72.5 / 98.2 / 790.5 | 2.1 / 4.1 / 5.5 / 7.7 |
| 3 | control | 53.3 / 85.4 / 98.9 / 99.5 | 56.4 / 87.2 / 102.1 / 102.4 | 2.2 / 3.5 / 5.0 / 5.1 |
| 3 | **AFTER** | **3.4 / 4.3 / 4.6 / 4.8** | **5.3 / 6.6 / 7.0 / 7.0** | 1.9 / 2.6 / 3.1 / 3.3 |
| 7 | BEFORE | 32.1 / 73.9 / 107.5 / 113.2 | 36.6 / 78.5 / 111.6 / 117.9 | 4.7 / 7.4 / 9.4 / 11.2 |
| 7 | control | 62.6 / 92.7 / 103.0 / 109.7 | 67.2 / 96.8 / 108.3 / 113.7 | 4.6 / 6.5 / 7.4 / 18.0 |
| 7 | **AFTER** | **6.0 / 6.9 / 7.5 / 8.3** | **10.1 / 11.3 / 11.7 / 12.4** | 4.1 / 4.8 / 5.6 / 5.7 |
| 7 | AFTER + HIGH window (shipped) | 5.2 / 6.3 / 6.8 / 7.2 | 9.3 / 11.0 / 11.3 / 11.5 | 4.0 / 5.3 / 5.9 / 6.5 |

The BEFORE 3-worker max (788 ms) is one CDP stall (transport call -> request event 728 ms), kept as measured.

**Where the time goes (7 workers, p50 / p99)**

| Segment | BEFORE | AFTER |
| --- | --- | --- |
| Scheduler wake lateness | 7.0 / 15.0 | 0.007 / 0.08 |
| Global lock rewrite after T-0 | 4.3 / 82.7 (bimodal ~4 or ~40; control p50 40.8) | none (armed before release: whole arm 11.4 / 26.5, at T-2 min) |
| Journal begin after T-0 | 4.4 / 6.9 | none |
| One-shot claim after T-0 | 6.3 / 12.4 | none |
| Request build + hashing after T-0 | 0.02 / 0.14 | none |
| Wake -> transport call (Node, all 7 in one pass) | 17.4 / 95.6 | 0.86 / 1.61 |
| Transport call -> request event (Node/CDP/browser) | 7.0 / 9.9 | 6.4 / 9.8 |

**Final-wait tail (7 workers, armed)**

| Spin tail | Wake p99 / max | First request p99 | Last request p99 | CPU arm->wake p50 |
| --- | --- | --- | --- | --- |
| 0 (timer only) | 15.7 / 15.8 | 24.6 | 29.5 | ~0 |
| 20 | 0.22 / 0.24 | 8.4 | 13.9 | 31 |
| **50 (chosen)** | 0.08 / 0.10 | 7.5 | 11.7 | 93 |
| 100 | 0.04 / 0.04 | 7.6 | 12.9 | 187 |
| 150 | 0.04 / 0.11 | 7.9 | 13.0 | 281 |
| 250 | 0.02 / 0.04 | 7.5 | 12.1 | 484 |

50 ms: 20 ms is only ~4 ms above the 15.6 ms Windows timer quantum (little margin under real load); 100-250 ms add CPU without improving p95/p99. CPU is roughly two spin tails (the prewarm-lead wait also spins).

**Process priority.** HIGH for the whole benchmark process gave first-request p50 4.7 vs 6.0. The shipped setting raises the runner to HIGH only from T-1 s (after prewarm normally finishes at about T-7 s) until the POSTs have left, then restores it: first-request p50/p95/p99 5.2 / 6.3 / 6.8 vs 6.0 / 6.9 / 7.5. Node's own wake -> transport-call time did not change (0.86 both); the gain is in transport call -> request event, which mixes Node sending the CDP message with Node receiving the event, so part of it may be on the observation side. Security preparation was synthetic in the benchmark, which is why HIGH is not used during prewarm. REALTIME is never used.

**Limits.** Offline, headless Chrome, synthetic security headers, local disk in a temp folder. It does not include Onda's network or server time (the 2026-09-24 release took 17.5-28.3 s to answer), real Turnstile preparation, or visible-window rendering. The AFTER latency is not live-proven until a real 08:00 release.

## 4. Worker B

At the September 24 08:00 run, B was excluded because its configured Onda customer ID duplicated A's.
This was the status when the Phase 1 benchmark was written. At 22:45 Asia/Manila on September 24,
a read-only check using the installed runtime's `.local/private/.env.local` and
`loadLocalCheckoutCustomer` validated the contact bindings for A-G and found seven distinct customer IDs.
B no longer has the duplicate-ID configuration blocker. This local check did not prepare browsers,
dispatch a checkout, or prove a successful B booking; release readiness still needs a fresh check.
