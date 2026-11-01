# Publication validation

This file records qualification limits for the source publication, separately from installed runtime and live provider evidence. GitHub's final commit/merge/check identities are available from [PR #21](https://github.com/marcpocong/thirsty-autobook-web/pull/21) and its [checks](https://github.com/marcpocong/thirsty-autobook-web/pull/21/checks). A successful source merge is not an app installation.

## Completed local checks

- 165 tests passed across seven focused release/security/recovery suites during production-path review.
- 36 tests passed across `v2-integrity.test.ts` and `api-booking/checkout-recovery.test.ts` after making the observer fixture deterministic. The fixture retains all original count assertions and production behavior.
- Main full-suite group: **181 files, 2,040 tests passed**, with the existing eight heavy suites separated by `scripts/test-all.mjs`.
- Offline Shotgun browser lab: **35 passed, one failed**. The failing quota scenario's child process exited with native Windows code `3221226505` / `0xC0000409`, `LAB_TEST_CHILD_EXIT`; it did not produce an assertion explaining the native termination. This matches a previously observed class of Windows fixture failure, but its underlying cause is not established. The local full-suite command stopped there, so later separated suites must not be claimed as completed by that command.
- The exact failed quota scenario subsequently passed in isolation (one passed, 35 unselected). That establishes intermittence, not a fix for the native Windows termination. The original full-run failure is retained above.
- Typecheck passed after the publication changes.
- Final publication clean source build passed, and distribution verification checked 511 compiled files with zero problems. Local relative links in the incident/entry/validation reports passed. GitHub CI is checked independently before merge.
- Original incident export was reproduced twice, byte-for-byte identical. Published `evidence.json` SHA-256: `e547b5e1240c6b1e4411367124e45df2795d31f1db5539a5554dbb6491f5d1ce`.
- All 35 original source-file hashes matched; eight unique diagnostic children, seven observed browser POSTs, seven UNKNOWN and one proven-unsent child were checked. Every child's strict deadline remains trigger +50 ms. Each of the seven saved morning projections has three bookings, three sessions and PHP 2,100.
- Export privacy review found no checkout access token fields/values, customer contact fields, browser profile contents or payment QR payload. Only explicit allowlisted fields and hashes are published. Private originals remain local.

## Earlier CI failure addressed

The earlier merge-ref [run 41284645855](https://github.com/marcpocong/thirsty-autobook-web/actions/runs/41284645855) failed one wall-clock-dependent Slot Watch count fixture (2 expected locally refused reads, 1 observed). The branch run [41284642235](https://github.com/marcpocong/thirsty-autobook-web/actions/runs/41284642235) passed. The fixture placed release only 10 ms ahead and subsequent reads 15 ms apart; CI load could cause a scheduled point to precede construction or be skipped. The test now uses the existing VirtualClock and injected policy clock/sleep. No runtime scheduling, refusal rule, strict deadline, timeout or assertion was relaxed.

## Unchanged action boundaries

This publication performs source editing, offline tests, evidence reads and GitHub integration only. No new checkout, hold, payment, retry, recovery request, browser-profile change, journal rewrite, lock clearing, app restart or canonical installation is performed. Historical live results in the incident report describe earlier separately authorized actions.
