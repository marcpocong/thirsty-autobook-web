# Sanitized runtime diagnostics

`2026-09-18/` is a snapshot of all files present under ignored
`DiagnosticsLocal/` when this branch was pushed: JSON telemetry, three retained
recovery lock records, and six visually reviewed UI screenshots. The export
preserves filenames and telemetry structure. Hostnames, process IDs, private
field names, and contact-like string values are redacted in JSON. The original
local diagnostics are unchanged. `manifest.json` records the exported files,
byte counts, hashes, and redaction count.

Run `node scripts/export-sanitized-diagnostics.mjs` to refresh this snapshot
after reviewing any newly added screenshots. The script refuses unreviewed
file types. It does not export `.local/`, browser profiles, environment files,
or the API submission journal.

`2026-09-25/` is a sanitized snapshot of the installed app's runtime logs
after the 2026-09-25 08:00 release (target 2026-09-27), covering every run
since 2026-09-19: `local/` mirrors the install folder's `.local/` (booking-run
activity logs, runner traces, Slot Watch logs and reports, release forensics
and provider traces, Release Intelligence, durable journals and their
expired/rejected archives, network-clock evidence, retained-hold and lock
records, security-audit canaries), `diagnostics-local/` mirrors
`DiagnosticsLocal/`, and `install/` holds `BUILD-INFO.txt` and
`SMOKE-RESULT.txt`. The same redaction rules as the script above apply, plus:
every Onda booking ID, booking number and transaction ID (929 values) is
replaced everywhere, including inside text and file names, by a stable
`ref-N` pseudonym so records still correlate; 64-character hash directory
names are shortened to 12 characters for Windows path limits. Not exported:
browser profiles, the Electron control-panel profile, `.local/private/`
worker identities, the bundled `node.exe`, icons, `config.local.json`, `.env*`,
and every `*-private.json` raw provider response (they embed customer data;
the journal next to each keeps status and diagnostics). The export was
checked against all private worker identity values and the original booking
references with zero matches. `manifest.json` lists every file with its
source path, size and SHA-256. The analysis of this release is
`RELEASE_RUN_REPORT_2026-09-25.md`.

`2026-09-25/arbitration/` holds derived, regenerable analysis of that snapshot (no new runtime data): the
release timeline (`release-2026-09-25.timeline.jsonl`), the arbitration evidence summary
(`arbitration-evidence.json`), and the contention-simulator replay (`replay-arbitration.json`). They are rebuilt
deterministically by `scripts/analyze-release-arbitration.ts` and `scripts/replay-release-arbitration.ts`; see
`SERVER_ARBITRATION_INVESTIGATION.md`.
