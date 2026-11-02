# Historical hold notices and installed-build validation

The November 3 fix addresses two misleading preflight warnings without changing booking evidence or dispatch policy.

## Hold notices

The reader retains every original UNKNOWN journal. Preflight classifies the notices against the **saved** plan, not the editable draft:

* An original date/court/overlapping-hour target remains blocked, including archived notices and provider-terminal records. The runner's durable duplicate guard is unchanged.
* Active advertised holds, recent UNKNOWN records, incomplete targets, malformed expiry/verification and an unavailable trusted clock remain blocking.
* A record that passes the existing 24-hour quiet-history eligibility, whose latest advertised hourly expiry elapsed, and whose target is disjoint from the saved plan becomes historical information. It is explicitly **not** provider-confirmed expiry. Archival does not grant permission.
* Separately persisted provider terminal evidence is recognized only with matching response and original journal hashes, exact captured target and booking identities, no contradiction and the supported terminal code. A missing checkout after advertised expiry is labelled unavailable, not confirmed expired. Paid bookings retain original-target protection.

All hourly expiry timestamps are compared numerically; the latest is used so one expired hour cannot hide another still-live hour. Both Booking Setup and the execution console use the same classifier. Existing history remains available in Activity. No provider request, journal rewrite, target substitution or automatic retry is introduced.

## Build validation

The canonical updater already requires successful exact-commit CI and validates the staged and installed package, provenance, managed paths and protected-state preservation. It writes `.local/build/installed-update.json` after the transaction succeeds.

The readiness reader now recognizes that completed evidence, binding its clean main SHA, content ID and build ID to the running installation, its successful CI head and the canonical output directory. It displays **Exact-commit CI and canonical installation verified**. It does not edit or fabricate the older `last-release-build.json`. Missing, inconsistent, dirty or failed evidence remains a warning. Actual memory and event-loop thresholds are unchanged.

Regression coverage includes historical/disjoint and overlapping targets, current and mixed-hour expiries, recent UNKNOWN, corrupt data, bound and mismatched terminal proofs, unchanged original journals and duplicate guards, both renderer panels, and valid/invalid installation/CI provenance. Full-suite and installed evidence is recorded separately in the workspace report.
