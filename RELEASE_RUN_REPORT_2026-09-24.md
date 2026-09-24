# Production release report: September 24, 2026 (Precision Release)

## Executive result

The live 08:00 Precision Release run for **Saturday, September 26, 2026** failed. The final runner outcome was **`OBJECTIVE_NOT_ACHIEVED_ALL_REJECTED`**.

- The configured objective was one verified temporary hold from four independent exact targets.
- Worker B was excluded before the race because its private Onda customer ID duplicated Worker A's ID. No request was sent for B.
- Workers A, C and D successfully prepared their browsers and checkout security.
- All three eligible requests reached Onda approximately **100–104 ms after the network-adjusted release boundary**.
- Onda returned a confirmed **HTTP 409** for every dispatched request, with the sanitized diagnostic hint **`availability`**.
- The three durable journals are conclusively **`rejected`**. There are **zero verified holds** and **zero unknown outcomes**.
- No booking ID, booking number, QR handoff or payment hold was returned.
- The automation lock was released automatically after the conclusive all-rejected outcome; no live lock existed when this report was prepared.

This was not a browser-preparation failure, a missed one-second dispatch window, a security-prewarm failure, an unknown network outcome or a payment-stage failure. The direct cause was that every request Onda received was rejected for availability. The race also had only three attempts instead of the configured four because of the duplicate customer identity.

## Bottom line

The run reached the intended critical path quickly enough to compete: the three HTTP POSTs were initiated in a 4 ms cluster at PC-clock times 08:00:00.048–08:00:00.052, equivalent to +100.086–+104.086 ms after the release boundary using the run's measured +52.086 ms network-clock correction. Onda then took 17.5–28.3 seconds to return the three rejections.

The evidence does **not** establish whether each target was already unavailable at 08:00:00 or was taken while Onda queued the requests. Precision mode intentionally makes no availability read after release before posting, and this run recorded no release-instant slot grid. A read-only audit at 08:05 found only 11 of 112 court-hours open; a detailed read at 08:06:30 found the same 11/112 total. Every hour in all four configured 15:00–18:00 targets was blocked by then.

## Run identity and evidence scope

| Item | Value |
| --- | --- |
| UI run ID | `ea42c2f8-15c6-4214-993c-99c199e5d232` |
| Runner run ID | `8bcc1790-2475-4fcf-ba60-96551f7b7fe3` |
| Mode | `live` |
| Booking method | `proofless` |
| Release strategy | `precision` |
| Target date | Saturday, 2026-09-26 |
| Release instant | 2026-09-24 08:00:00.000 Asia/Manila |
| Release epoch | `1790208000000` |
| UI start | 07:35:18.122 Manila |
| Runner start | 07:35:18.866 Manila |
| Runner finish | 08:00:28.446 Manila |
| UI finish | 08:00:28.563 Manila |
| Final code | `OBJECTIVE_NOT_ACHIEVED_ALL_REJECTED` |
| Process exit | 1 |

Primary private evidence, deliberately not committed:

- `.local/booking-runs/ea42c2f8-15c6-4214-993c-99c199e5d232.ndjson` in the installed application folder: UI activity stream.
- `.local/api-booking/run-progress/8bcc1790-2475-4fcf-ba60-96551f7b7fe3.ndjson`: append-only runner trace.
- `.local/api-booking/precision-races/8bcc1790-2475-4fcf-ba60-96551f7b7fe3-freeze.json`: immutable frozen dispatch set.
- `.local/api-booking/api-first-journals/`: three rejected attempt journals and three sanitized private response captures.
- `.local/network-clock.json`: network-clock sample used by the release.
- `config.local.json`: saved local plan.
- `BUILD-INFO.txt`: installed build provenance.

The report excludes names, phone numbers, email addresses, customer UUIDs, contact hashes, cookies, browser profiles, raw request bodies and journal keys. Those are neither reproduced here nor committed.

## Installed build and repository state

The installed application reported:

| Field | Value |
| --- | --- |
| Built | 2026-09-24 06:54:31 Manila |
| Base source commit | `b332c83` |
| Build marker | `b332c83 + uncommitted changes` |
| Launcher SHA-256 | `B4499146378E2276EF63184EB4BC5379A7A99FDD71BD61D7418D0B3561833328` |

The relevant installed JavaScript matched the repository working-tree build byte-for-byte when checked for `desktop-runner.js`, `precision-race.js`, `customer-identity.js`, `proofless-checkout.js` and the UI controller. The working tree contained pre-existing, uncommitted customer-identity/UI work when this report was prepared. This report does not claim that those source changes were part of `b332c83`, and the report commit intentionally does not absorb them.

### Verification performed while preparing this report

| Check | Result |
| --- | --- |
| TypeScript typecheck | Passed |
| Focused identity/Precision/proofless/UI tests | 5 files, 89 tests passed |
| Full Vitest regression suite | 75 files, 888 tests passed |
| Report whitespace check | Passed |
| Private `.env.local` values in report | None, except the non-secret literal release time `08:00:00` |
| Email-address patterns in report | 0 |
| Philippine mobile-number patterns in report | 0 |

These checks validate the current working tree and the factual consistency of the report. They do not retroactively change the provider result or turn the failed run into a successful booking.

## Authorized plan

Precision Release treats every row as an independent one-court attempt. Its success condition is at least one verified hold; `COURT_COUNT` does not group these targets.

| Worker | Exact target | Duration | Assumed maximum | Pre-run identity | Dispatch result |
| --- | --- | ---: | ---: | --- | --- |
| A | Court 3, 15:00–18:00 | 3 h | PHP 2,000 | Valid | Sent; HTTP 409; rejected |
| B | Court 4, 15:00–18:00 | 3 h | PHP 2,000 | Invalid: duplicates A | Not sent |
| C | Court 5, 15:00–18:00 | 3 h | PHP 2,000 | Valid | Sent; HTTP 409; rejected |
| D | Court 6, 15:00–18:00 | 3 h | PHP 2,000 | Valid | Sent; HTTP 409; rejected |

The assumed PHP 2,000 is produced by the configured rate model: PHP 600 for 15:00–16:00 and PHP 700 for each hour from 16:00 onward. The post-release availability response observed PHP 700 for all three target hours, or PHP 2,100 for a three-hour block. The sanitized 409 response explicitly points to availability, not price, so this PHP 100 difference is a separate unresolved rate-drift risk rather than the demonstrated cause of this failure.

## Customer-identity failure on Worker B

At 07:35:18.910, 29 ms after configuration logging, the runner emitted:

```text
CUSTOMER_IDENTITY_INVALID workerId=B code=DUPLICATE_ONDA_CUSTOMER_ID duplicateOf=A
```

The private configuration confirms that A and B were assigned the same Onda customer UUID. The UUID itself is intentionally omitted.

The runtime behavior was fail-safe at the individual-attempt level:

1. A retained ownership of the shared ID because workers are resolved deterministically in A-to-G order.
2. B was marked `IDENTITY_FAILED` before freezing.
3. B never received a security prewarm.
4. No journal or one-shot permit was created for B's Court 4 target.
5. A, C and D remained eligible and continued independently, as Precision mode is designed to do.

This reduced the race from four attempts to three. It did not cause the three sent requests to be rejected. It did remove one independent chance of success.

## Browser preparation

All four configured browsers launched and passed preparation:

| Worker | Preparation began | Browser ready | Port | Outcome |
| --- | --- | --- | ---: | --- |
| A | 07:35:18.911 | 07:35:21.201 | 19444 | `COMPLETED` |
| B | 07:35:18.936 | 07:35:21.195 | 19445 | `COMPLETED` |
| C | 07:35:18.948 | 07:35:21.198 | 19446 | `COMPLETED` |
| D | 07:35:18.963 | 07:35:21.201 | 19447 | `COMPLETED` |

The last browser was ready 2.376 seconds after runner start and more than 24 minutes before release. Browser B being technically ready did not override its invalid customer identity.

## Pre-release evidence

Precision mode performed sparse read-only evidence checkpoints. The target date was not yet published in Onda's availability response at either checkpoint.

### T-10 minutes

- Availability request: 07:49:59.957–07:50:00.238, 281 ms.
- Availability result: target date absent; 112 cells unknown in the parsed matrix.
- Public booking queries: all seven courts succeeded.
- Public record counts by court: C1=5, C2=3, C3=0, C4=0, C5=3, C6=3, C7=3.
- Each target was classified `NO_PUBLIC_BOOKING_DATE_UNRELEASED` and eligible.
- The network clock was refreshed immediately afterwards.

### Freeze at T-2 minutes

- Availability request: 07:57:59.955–07:58:00.280, 325 ms.
- Availability result: target date still absent.
- All seven public booking queries again succeeded with the same per-court counts.
- All four target time ranges still had no conflicting public booking record.
- B remained unusable because of its identity error.
- At 07:58:00.337 the frozen file recorded A, C and D as the three immutable attempts.
- At 07:58:00.339 the trace emitted `PRECISION_FROZEN targetCount=4 frozenCount=3`.

An important limitation: `NO_PUBLIC_BOOKING_DATE_UNRELEASED` means only that no public booking record conflicted while the actual date grid was not published. It is not proof that Onda would release the slot, and it cannot reveal venue/admin blocks hidden until the release grid appears.

## Network-clock evidence

At 07:50:00.336, the app synchronized its release calculations against `time2.google.com`:

| Measurement | Value |
| --- | ---: |
| Offset | +52.0859375 ms |
| Round trip | 44 ms |
| Change from prior saved offset | 9 ms |

The positive offset means network time was about 52 ms ahead of the PC clock. The runner used this offset in its dispatch-window timing. Therefore an HTTP request event stamped 08:00:00.048 by the PC clock is recorded as approximately +100.086 ms late relative to corrected release time.

This is far better than the roughly 0.3–0.4 second lag observed in the previous day's report, but it still means the machine did not originate the requests at corrected +0 ms.

## Security prewarm

Only the three frozen attempts were prewarmed. All succeeded on their first attempt:

| Worker | Started | Completed | Duration | Ready before release |
| --- | --- | --- | ---: | ---: |
| C | 07:59:44.962 | 07:59:50.969 | 6,007 ms | 9.031 s |
| A | 07:59:44.960 | 07:59:51.111 | 6,152 ms | 8.889 s |
| D | 07:59:44.963 | 07:59:52.227 | 7,264 ms | 7.773 s |

There were no `SECURITY_PREWARM_FAILED`, retry or dispatch-window-missed events. Prepared context ages at checkout entry were 7.801–9.067 seconds, so the requests used recently acquired, page-bound contexts rather than acquiring security after release.

## Release dispatch timing

Events are concurrent, so append order is not always timestamp order. The event timestamps give the following sequence:

| Worker | Attempt start | Checkout function entered | Pre-POST | HTTP POST initiated | Corrected release lateness |
| --- | --- | --- | --- | --- | ---: |
| D | 08:00:00.004 | 08:00:00.028 | 08:00:00.028 | 08:00:00.048 | +100.0859375 ms |
| C | 08:00:00.004 | 08:00:00.037 | 08:00:00.037 | 08:00:00.049 | +101.0859375 ms |
| A | 08:00:00.002 | 08:00:00.042 | 08:00:00.042 | 08:00:00.052 | +104.0859375 ms |

All three requests:

- used prepared security context;
- passed the one-second direct dispatch guard;
- claimed one-shot journal permits;
- emitted Playwright request-event evidence proving that the POST left the browser;
- were in flight concurrently by 08:00:00.052.

The spread between first and last POST initiation was only 4 ms. This run therefore does not show a serial-dispatch bottleneck.

## Onda response timing

| Worker | Court | POST initiated | Response | Network duration | HTTP | Sanitized hint |
| --- | ---: | --- | --- | ---: | ---: | --- |
| A | 3 | 08:00:00.052 | 08:00:17.583 | 17,541 ms | 409 | `availability` |
| C | 5 | 08:00:00.049 | 08:00:23.026 | 22,988 ms | 409 | `availability` |
| D | 6 | 08:00:00.048 | 08:00:28.359 | 28,331 ms | 409 | `availability` |

The responses arrived 5.4 seconds apart in A, C, D order, not request-initiation order. Onda's server-side processing/queueing dominated the critical-path duration. Local code classified each response as a conclusive application rejection, not as a timeout or ambiguous transport failure.

The diagnostic summary reported:

```text
finalCode=OBJECTIVE_NOT_ACHIEVED_ALL_REJECTED
retryCount=0
verifiedHoldCount=0
qrHandoffCount=0
partialHolds=false
coreElapsedMs=43411
absentEvidence=NONE
activeAvailability=0
activeSecurity=0
activeSlotChecks=0
activeCheckouts=0
```

## Durable journal and outcome safety

Three journals were begun at dispatch, one for each of A, C and D. Each journal finished in `rejected` state with:

- failure code `ONDA_HTTP_STATUS_INVALID`;
- response status 409;
- diagnostic category `http-rejection`;
- content kind `json`;
- response source `application`;
- error hint `availability`;
- `success=false`;
- no booking ID;
- no booking number;
- no booking-session ID;
- no hold-expiry value.

There is no `unknown` journal. Reconciliation is not required for this specific run, and the bot must not reinterpret these HTTP 409 responses as possible success.

Because all dispatched attempts were conclusively rejected and B was provably unsent, the race reducer marked the lock releasable. The lock was absent when checked for this report. No retained-hold file was created by this run; the newest retained-hold artifact predates it by almost two hours and is unrelated.

## Post-release court state

At 08:05:02, the app's built-in read-only block audit reported:

```text
2026-09-26 · Open 11 · Blocked 101 · Unreleased 0 · Unknown 0
```

A separate read-only detailed observation at **08:06:30.964 Manila** returned the same totals and no failed public-booking court queries. This later snapshot cannot prove the exact 08:00:00 state, but it shows the state shortly after the race.

Legend:

- `O` = open in availability response
- `P` = blocked with a public booking record
- `X` = unavailable in availability response without a matching public booking record

```text
court | 08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  1   | O  P  P  P  O  P  P  P  P  P  P  P  P  P  P  X
  2   | O  P  P  P  O  P  P  P  P  P  P  P  P  P  P  X
  3   | X  X  X  X  X  X  X  X  X  X  X  X  P  P  P  X
  4   | X  X  X  X  X  X  X  X  X  X  X  X  P  P  P  X
  5   | X  X  X  X  X  X  X  X  X  X  X  X  P  P  P  X
  6   | O  O  O  O  O  P  P  P  P  X  X  X  P  P  P  X
  7   | O  P  P  P  O  P  P  P  P  P  P  P  P  P  P  X
```

Totals at 08:06:30:

| Status | Cells |
| --- | ---: |
| Open | 11 |
| Blocked with public booking | 55 |
| Unavailable without public booking | 46 |
| Unknown/unreleased | 0 |
| Total | 112 |

The only open cells were Court 1 at 08:00 and 12:00; Court 2 at 08:00 and 12:00; Court 6 from 08:00 through 13:00; and Court 7 at 08:00 and 12:00.

### Configured targets in the post-release snapshot

| Target | 15:00 | 16:00 | 17:00 | Interpretation at 08:06:30 |
| --- | --- | --- | --- | --- |
| A / Court 3 | X | X | X | Entire block unavailable; no public booking record |
| B / Court 4 | X | X | X | Entire block unavailable; no public booking record; B was not sent |
| C / Court 5 | X | X | X | Entire block unavailable; no public booking record |
| D / Court 6 | P | P | X | First two hours had public bookings; final hour unavailable without one |

Unavailable without a public record can indicate a venue/admin block, an internal state not exposed by the public-bookings endpoint, or another transient provider condition. It must not be labeled a confirmed venue block without stronger provider evidence.

## Root-cause assessment

### Confirmed primary cause: Onda rejected all dispatched targets for availability

This is the strongest conclusion because three independent evidence layers agree:

1. Every browser emitted an HTTP POST request event.
2. Every response was HTTP 409 with application-level hint `availability`.
3. Every corresponding durable journal was marked `rejected` with no booking or hold identifier.

### Confirmed coverage loss: Worker B shared Worker A's customer ID

B's Court 4 attempt was removed before freeze and never sent. This is a real configuration defect, but not the explanation for the rejection of A, C and D.

### Likely contributing condition: extreme demand or provider-side queueing

The three application responses took 17.5, 23.0 and 28.3 seconds. By 08:05 only 11 of 112 slots remained open. This is consistent with a heavily contested release and/or provider-side request queue. It does not prove which competing request acquired any specific target first.

### Possible contributing condition: hidden/unpublished court blocks

At 08:06, Courts 3–5 were unavailable from 08:00 through 20:00 without matching public booking records. That pattern is consistent with an administrative or venue block, but Onda's public responses do not disclose the reason. If those cells were already blocked at release, A, B and C were impossible targets regardless of dispatch speed. The current telemetry cannot prove when those cells became unavailable.

### Separate risk: assumed rate differed from the published post-release rate

The request builder assumed PHP 600 for 15:00–16:00 and PHP 700 thereafter. The later availability response reported PHP 700 for all hours, making the observed three-hour rate PHP 2,100 rather than PHP 2,000. The 409 diagnostic says availability, so there is no evidence that price caused this run's rejection. The rate model should still be reviewed before the next release.

## What worked correctly

- All configured browsers prepared successfully.
- Duplicate customer identity was detected without exposing the private UUID.
- The invalid worker was provably prevented from dispatching.
- The remaining attempts were frozen immutably.
- Network-clock refresh succeeded with a recent, low-round-trip sample.
- All three security contexts were ready 7.8–9.0 seconds before release.
- Dispatch remained inside the one-second authorized window.
- Three requests were launched concurrently within 4 ms of one another.
- One-shot permits prevented duplicate submission.
- The runner did not retry confirmed rejections.
- Journals preserved conclusive outcomes.
- The reducer correctly reported zero holds and zero unknowns.
- The lock was released only after every possible outcome was known to be rejected or unsent.
- No payment action occurred.

## What did not work

- One of four configured attempts had an invalid duplicate identity.
- None of the three sent target blocks was accepted.
- The plan concentrated every attempt on the same 15:00–18:00 period, limiting time diversity.
- Pre-release evidence could not distinguish an unreleased date from hidden provider blocks.
- No immediate post-release grid snapshot was recorded alongside the dispatch, preventing exact reconstruction of the slot state at 08:00.
- The assumed rate schedule was PHP 100 below the rate later published for each three-hour target.

## What this run proves

- The installed Precision path can prepare four dedicated browsers and degrade safely to the workers with unique valid identities.
- The A/C/D dispatch path reached Onda inside its one-second guard.
- The three requests were independent and concurrent.
- The provider gave conclusive rejections, not ambiguous failures.
- No hold or reservation from this run requires manual payment or reconciliation.
- Shortly after release, all four target blocks were unavailable.

## What this run does not prove

- It does not prove the exact release-instant availability of Courts 3–6 at 15:00–18:00.
- It does not prove that another customer beat each request; some cells may have been provider- or venue-blocked from publication.
- It does not prove that a +100 ms request would normally lose; this release may have unusual demand or queue behavior.
- It does not prove that the PHP 100 rate difference was accepted or rejected independently.
- It does not test Worker B checkout, because B never dispatched.
- It does not show whether additional courts or different times would have succeeded.

## Recommendations before the next live release

### 1. Fix Worker B's customer binding

Assign B a real, unique Onda customer UUID observed from B's own official customer flow and verify it against B's contact hash. Do not copy another worker's UUID and do not guess or fabricate one. Run Reset & Prepare afterwards and confirm there is no `DUPLICATE_ONDA_CUSTOMER_ID` warning.

### 2. Review all active worker identities together

For the exact next Precision target count, verify that every active worker has:

- a locally valid contact binding;
- a unique customer UUID;
- a dedicated prepared browser;
- no stale or blocked journal for the target range.

Unused workers should remain out of scope.

### 3. Diversify authorized targets

If the real objective is one court rather than one exact time, use the supported independent rows to spread attempts across courts and times. Four attempts all targeting 15:00–18:00 share the same schedule risk. This must be an operator choice before arming; the bot must not invent fallback times after the target set freezes.

### 4. Confirm Saturday venue blocks

Ask the venue whether Courts 3–5 are intentionally blocked for most of September 26 and whether Court 6 has a scheduled block around 17:00–20:00. Public availability alone cannot establish the reason.

### 5. Revalidate rates

Confirm whether Saturday uses PHP 700 starting at 15:00. Update the assumed proofless rate schedule only from authoritative current evidence, then test request construction without sending a checkout.

### 6. Add non-blocking release-state telemetry

Record a sanitized post-release court-hour matrix without delaying or serializing the authorized checkout requests. The critical report needs the first published grid, exact capture time and per-cell source (`AVAILABILITY` versus `PUBLIC_BOOKING`). This would separate an initial venue block from a slot lost during Onda's queue.

### 7. Make degraded coverage impossible to overlook

Continue allowing valid Precision rows to run independently, but require a prominent pre-arm acknowledgement when any configured row is invalid and will not dispatch. The saved plan said four attempts; the frozen race contained three.

## Full sanitized timeline

All times below are Asia/Manila. Offsets are relative to 08:00:00.000 by the PC clock unless the row explicitly states corrected lateness.

| Time | PC offset | Source | Event |
| --- | ---: | --- | --- |
| 07:35:18.122 | −1,481,878 ms | UI | Run started, label `API LIVE` |
| 07:35:18.866 | −1,481,134 ms | Runner | `RUN_STARTED` |
| 07:35:18.880 | −1,481,120 ms | Runner | Four-worker proofless Precision configuration recorded |
| 07:35:18.910 | −1,481,090 ms | Runner | Worker B identity invalid; duplicate of A |
| 07:35:18.911 | −1,481,089 ms | Runner | Browser A preparation began |
| 07:35:18.936 | −1,481,064 ms | Runner | Browser B preparation began |
| 07:35:18.948 | −1,481,052 ms | Runner | Browser C preparation began |
| 07:35:18.963 | −1,481,037 ms | Runner | Browser D preparation began |
| 07:35:21.195 | −1,478,805 ms | Runner | Browser B ready on 19445 |
| 07:35:21.198 | −1,478,802 ms | Runner | Browser C ready on 19446 |
| 07:35:21.201 | −1,478,799 ms | Runner | Browsers A and D ready on 19444/19447 |
| 07:35:21.202 | −1,478,798 ms | Runner | All four browser-preparation outcomes fulfilled |
| 07:35:21.202 | −1,478,798 ms | Runner | Precision race configured with four targets |
| 07:35:21.203 | −1,478,797 ms | Runner | B set to `IDENTITY_FAILED`; no dispatch authorized |
| 07:49:59.957 | −600,043 ms | Runner | T-10 availability read started |
| 07:50:00.238 | −599,762 ms | Runner | T-10 availability returned after 281 ms; target date absent |
| 07:50:00.246–.272 | about −599,740 ms | Runner | Seven public booking reads succeeded |
| 07:50:00.281 | −599,719 ms | Runner | T-10 availability/public evidence checkpoint complete |
| 07:50:00.282 | −599,718 ms | Runner | A–D classified eligible from unreleased-date/no-conflicting-public-booking evidence |
| 07:50:00.336 | −599,664 ms | Clock | Network clock sampled; +52.086 ms offset, 44 ms RTT |
| 07:57:59.955 | −120,045 ms | Runner | Freeze availability read started |
| 07:58:00.280 | −119,720 ms | Runner | Freeze availability returned after 325 ms; date still absent |
| 07:58:00.317 | −119,683 ms | Runner | Freeze public booking reads complete |
| 07:58:00.332–.333 | about −119,668 ms | Runner | A–D again classified eligible by public evidence |
| 07:58:00.337 | −119,663 ms | Freeze file | A, C and D frozen; B recorded not dispatched |
| 07:58:00.339 | −119,661 ms | Runner | `PRECISION_FROZEN targetCount=4 frozenCount=3` |
| 07:59:44.960–.963 | about −15,039 ms | Runner | A/C/D security preparation started |
| 07:59:50.969 | −9,031 ms | Runner | C security ready after 6,007 ms |
| 07:59:51.111 | −8,889 ms | Runner | A security ready after 6,152 ms |
| 07:59:52.227 | −7,773 ms | Runner | D security ready after 7,264 ms |
| 08:00:00.002 | +2 ms | Runner | A attempt started |
| 08:00:00.004 | +4 ms | Runner | C and D attempts started |
| 08:00:00.028 | +28 ms | Runner | D checkout entered and reached pre-POST |
| 08:00:00.037 | +37 ms | Runner | C checkout entered and reached pre-POST |
| 08:00:00.042 | +42 ms | Runner | A checkout entered and reached pre-POST |
| 08:00:00.048 | +48 ms | Browser | D POST initiated; corrected lateness +100.086 ms |
| 08:00:00.049 | +49 ms | Browser | C POST initiated; corrected lateness +101.086 ms |
| 08:00:00.052 | +52 ms | Browser | A POST initiated; corrected lateness +104.086 ms |
| 08:00:00.053 | +53 ms | Runner | Dispatch stage persisted; all three requests in flight |
| 08:00:17.583 | +17,583 ms | Onda/browser | A response HTTP 409 after 17,541 ms |
| 08:00:17.632 | +17,632 ms | Runner | A attempt classified failed/rejected |
| 08:00:23.026 | +23,026 ms | Onda/browser | C response HTTP 409 after 22,988 ms |
| 08:00:23.043 | +23,043 ms | Runner | C attempt classified failed/rejected |
| 08:00:28.359 | +28,359 ms | Onda/browser | D response HTTP 409 after 28,331 ms |
| 08:00:28.371 | +28,371 ms | Runner | D attempt classified failed/rejected |
| 08:00:28.432 | +28,432 ms | Runner | A/C/D `REJECTED`; outcome 0 verified, 0 unknown, 3 rejected, 1 unsent |
| 08:00:28.433 | +28,433 ms | Runner | `FAILED OBJECTIVE_NOT_ACHIEVED_ALL_REJECTED` |
| 08:00:28.446 | +28,446 ms | Runner | Process exit 1 |
| 08:00:28.563 | +28,563 ms | UI | Run finished `failed` |
| 08:05:02.216 | +302,216 ms | Read-only audit | 11 open, 101 blocked, 0 unreleased, 0 unknown |
| 08:06:30.964 | +390,964 ms | Read-only analysis | Detailed grid captured; still 11 open and 101 blocked |

## Final classification

| Question | Answer |
| --- | --- |
| Did the bot arm and send? | Yes, for A/C/D only |
| Did Worker B send? | No; duplicate identity blocked it before freeze |
| Did the dispatched POSTs leave the browser? | Yes; request-event evidence exists for all three |
| Was the one-second dispatch window missed? | No |
| Did security preparation fail? | No |
| Did Onda respond? | Yes, three HTTP 409 responses |
| Is any result unknown? | No |
| Was any hold verified? | No |
| Is there a QR/payment handoff? | No |
| Is manual reconciliation required? | No, not for this run |
| Is a live automation lock retained? | No |
| Safe summary | Three confirmed availability rejections; one provably unsent invalid-identity target |
