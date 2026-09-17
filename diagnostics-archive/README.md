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
