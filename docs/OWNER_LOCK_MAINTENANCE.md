# Owner-authorized lock maintenance

Local maintenance is distinct from booking permission and provider state. An archived global lease does not release an UNKNOWN target. Original journals, original submission permits and browser recovery identities remain unchanged. No provider restriction is overridden.

The owner must explicitly authorize local maintenance. The CLI requires the actual directive file and an explicit attestation. Run from the canonical installation root, with no installed application, dispatch, recovery or configured Chrome process running. Close only verified idle application/profile processes; active checkout contexts must be preserved.

Read-only inspection:

    .local/runtime/node.exe --import tsx Source/scripts/maintain-owner-locks.ts inspect

Authorize a code-only installation exception:

    .local/runtime/node.exe --import tsx Source/scripts/maintain-owner-locks.ts --attest-owner INSTALL <owner-directive.txt>

This prints a unique audit directory. Pass that directory once to the canonical packaging step after local full validation, clean committed main, matching remote and exact-commit CI:

    node Source/scripts/build-app.mjs --owner-maintenance <audit-directory>

Normal `release:build` remains unchanged; the packaging option supports a separately completed validation workflow. Without this explicit option all normal update blockers remain in force. Exceptions are limited to hash-bound, quiet legacy locally-verified aggregate records with fully elapsed child response evidence. No active process, armed/dispatching journal, malformed evidence, unlisted blocker or possibly active explicit expiry may be waived. Elapsed timers are installation facts only, never provider expiry proof. Protected lifecycle manifests are checked before and after transactional replacement; ordinary installer rollback remains in force.

For an abandoned global lease, select an exact nonconflicting next Lab request and then:

    .local/runtime/node.exe --import tsx Source/scripts/maintain-owner-locks.ts --attest-owner ARCHIVE_GLOBAL <owner-directive.txt> <next-request.json>

The CLI checks the entire original Lab journal tree for overlapping date/court/time intervals, across profiles, before authoring. The lifecycle digest and final process scan prevent stale approval. The maintenance library archives the original lease bytes write-once, then atomically replaces the global path with a maintenance sentinel. Normal exclusive creation stays blocked throughout verification. Failure restores the original bytes; changed ownership fails closed for review. Only after preservation and completion auditing is the maintenance sentinel released. Original exact-target barriers remain.

Every authorization is bound to root, source SHA, directive hash, purpose, original record hashes, lifecycle digest and a maximum 90-minute expiry. Its execution claim is exclusive and single-use, even after failure. Never recycle a consumed claim. Authorization, claim, lifecycle baseline, original archive and completion remain under `.local/owner-lock-maintenance/<id>/`; these are private local operator audit records. Inspect them for the original scope, exact action and preservation result. No previous V2 ad hoc exception is reused.

The initial implementation deliberately handles global leases and code-only aggregate blockers. It does not automatically recycle per-target Lab claims, preparation guards, permits or update mutexes. Unrecognized restrictions require evidence-led investigation and retain their original protection. Owner authority is not a reason to pretend an ambiguous target is safe.
