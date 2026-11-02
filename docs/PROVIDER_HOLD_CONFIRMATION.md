# Provider confirmation and checkout outcome accounting

A successful checkout response is local creation evidence. It is not proof that Onda retained the reservation. The durable journal's legacy `verified` state still protects that response and consumes its one-shot permit; it must not by itself satisfy a booking quota or produce a provider-confirmed outcome.

The November 2 release exposed this distinction: the post-response recovery callback wrapped a busy-worker or failed-lookup error in `VerifiedHoldQrError`. That error was then counted as a confirmed hold with a QR problem. A separate early diagnostic and the controller's pending-response state repeated the same unsupported claim.

The corrected flow is:

1. Persist and locally validate the original response; retain all original journal/lock/duplicate protection.
2. Queue automatic recovery work by browser profile after dispatch, while preserving the production recovery claim and identity guards. Different profiles can verify independently.
3. Independently validate the exact provider booking/group/customer/amount/expiry through the existing recovery controller.
4. Count `QR_READY` only after the verified official QR handoff. A QR failure may count as `HOLD_VERIFIED_QR_ATTENTION` only when an explicit, recent successful provider lookup established that same still-active group.
5. A busy claim, 404, identity/group mismatch, missing confirmation callback or generic post-response error remains UNKNOWN. A locally verified journal cannot upgrade it. Original permits remain consumed and no retry is introduced.

The runner emits the verified diagnostic and correlated `PROVIDER_HOLD_CONFIRMED` stage only after independent confirmation. The controller keeps a pending local response in flight, and an unconfirmed handoff failure becomes UNKNOWN. Automatic verification queues do not delay, reschedule or retry booking POSTs; they operate in post-response work.

Live Monitor's quota and Slot Watch's ownership overlay use fresh provider evidence rather than local handoff or child-state labels. Its primary recovery action uses the supported fresh-tab mode, and recovery results are visible directly in the monitor. Original-tab recovery remains available in Activity.

Activity's timing-history card retains legacy successes as "Recorded success labels" with an explicit notice that they are not provider proof. Per-child timing tables identify their states as recorded outcomes. The browser manager describes an unexpired local handoff as a retained checkout requiring fresh provider confirmation, while continuing to block profile reuse. These presentation rules never rewrite historical telemetry or upgrade it to provider evidence.

Forensic reconstruction requires matching per-attempt provider confirmation. When an older trace claims success without it, the derived report preserves `recordedOutcome`/`recordedFinalState`, reports the unsupported result as UNKNOWN/manual reconciliation and states the limitation. Original traces, captures and historical journals are not rewritten by this classification change.

Regression coverage includes pre-expiry 404, busy worker claims, identity/group failures, confirmed QR failure/success, missing journal evidence, serial same-profile recovery with independent other profiles, missing confirmation callback, controller intermediate states, legacy forensic false success, grid ownership and provider-confirmed quotas. All tests use synthetic fixtures or read-only offline reconstruction. They do not establish a live booking or scheduled-release timing result.
