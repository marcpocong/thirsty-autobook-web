# Publication validation and reproduction

This file describes checks for the forensic publication. The production-fix qualification is a separate historical record in [README.md, section 19](README.md#19-regression-ci-and-installed-validation). Passing a publication check does not establish provider acceptance, reconcile an UNKNOWN group, install another app, or authorize a release.

## Published artifacts

| File | Purpose |
|---|---|
| [README.md](README.md) | Complete narrative, tables, evidence boundaries, repair inventory and independent-review plan |
| [evidence.json](evidence.json) | Deterministic, allowlisted projection of the original incident and later qualification evidence |
| [Repository entry report](../../../RELEASE_RUN_REPORT_2026-11-02.md) | Discoverable summary linking to the full package |
| [export-nov2-evidence.mjs](../../../scripts/forensics/export-nov2-evidence.mjs) | Incident-specific offline reproduction tool |

Published evidence schema: `nov2-release-forensics/v1`.

Published `evidence.json` SHA-256:

```text
7abf8873f77c9d15a9f47a6559cf2cebafea976645ca373bc5e831b13b7566ee
```

The export is **316,867 bytes** and contains a manifest of **90 original input files**. Its contents do not depend on the new output filename or the time of export. An authorized reviewer needs the original local files to reproduce the private-source hashes; a public reader cannot independently recover unpublished identifiers from this sanitized package.

## Offline export checks

The exporter imports only Node filesystem, path, crypto and assertion modules. It imports no browser, network client, booking runner, recovery engine or payment integration. It reads original files and writes one explicitly supplied **new** output file with `flag: 'wx'`.

It checks the following invariants before publishing:

1. Exactly eight child journals join to the incident's exact critical-path child identities.
2. Exactly seven child POST events and seven corresponding response events exist; each child has at most one of each.
3. Exactly five children have HTTP 200 captures. Those have three hourly bookings, three sessions and PHP 2,100 trusted total each.
4. Across the five captures, 15 booking IDs exist and all 15 are distinct. The identifiers themselves are not exported.
5. The original child journal states are five `verified` and three locally `rejected`; the separate review classification is five UNKNOWN, two rejected and one not dispatched.
6. Every child has one exact terminal `PHASE3_SETTLED` event.
7. The progress log has exactly 190 rows and no `PROVIDER_HOLD_CONFIRMED` stage.
8. Every saved verification-history response hash matches its own immutable private capture.
9. Every captured group has its own bound-record follow-up lookup result, with HTTP 404 and provider UNKNOWN.
10. Every recorded follow-up result occurred more than 170 seconds before the original advertised expiry. This is recorded-timestamp arithmetic, not a new clock calibration.
11. Both published provider-error messages equal the specifically reviewed unavailable-date message. Arbitrary provider body text is not blindly copied.
12. All 90 input hashes still match when reread immediately before the new export is written.

The publication check reproduced the exporter into two additional, new local output files and compared both byte-for-byte with the tracked export. All three outputs have the SHA-256 above. The exporter also refuses an existing output path; the prior output remains unchanged.

## Privacy and redaction review

Projection is by explicit allowlist. The following are excluded from the public JSON and report:

- Usable checkout access values, headers/cookies, browser profiles, proof/security values and payment QR payloads.
- Raw booking IDs/numbers, booking-session identities, transaction/reference identities and raw customer identifiers.
- Customer names, email addresses, phone numbers, local environment files, private configuration contents and absolute user-directory paths.

The exporter privately collected **70 distinct sensitive values** from the five original captures and required that none occur in its output. A separate publication review checked those values against the added Markdown, JSON and exporter source. Additional field-name/email/credential-query scans and recursive key review were performed. SHA-256 values, nonsecret run/attempt identities, relative evidence filenames, court/date/time facts, amounts and software/build revisions are intentionally retained.

The public source manifest names private local files and supplies their hashes. It does not include their contents or grant permission to open or use them. Screenshots, full maintenance wrappers, private captures, baseline manifests, raw logs and runtime/profile stores remain local.

## Source and document checks

- The exporter passed Node syntax checking and actual offline execution against the original incident files.
- Typecheck passed for the report publication's source checkout.
- Every repository-relative Markdown file link in the entry report, detailed report and validation file resolved.
- Local report-section anchors and table-of-contents anchors were checked.
- JSON accounting and all eight attempt/timing values were checked against the original frozen authorization, request events and critical-path rows.
- The five capture hashes and the primary input hashes printed in the narrative matched the machine-readable source manifest.
- `git diff --check` passed.
- The staged publication contains only these five intended artifacts: the repository entry report, incident README, validation file, evidence JSON and offline exporter. No production TypeScript, installed file, private runtime file or old incident report is part of this publication commit.

The full booking/lab suites were not rerun merely to publish Markdown and an offline exporter. The final production commit's completed [CI run](https://github.com/marcpocong/thirsty-autobook-web/actions/runs/41371181860) remains the evidence for that code revision: 2,307 passed and seven existing platform skips. The earlier complete isolated local qualification, retained Windows-native failure and final installed acceptance are described separately and are not relabelled as tests of this documentation commit. Any GitHub workflow triggered by this publication has its own commit identity and status.

## Reproduction commands

Use a new filename in an existing directory. The installation root is the directory containing the canonical application and its original `.local` evidence stores, not the `Source` checkout itself.

```powershell
# From the Source checkout:
node --check scripts/forensics/export-nov2-evidence.mjs
node scripts/forensics/export-nov2-evidence.mjs .. C:/review/nov2-export-1.json
node scripts/forensics/export-nov2-evidence.mjs .. C:/review/nov2-export-2.json
Get-FileHash -Algorithm SHA256 C:/review/nov2-export-1.json
Get-FileHash -Algorithm SHA256 C:/review/nov2-export-2.json
```

Expected console summary: eight children, 90 source files, 70 private values checked, 316,867 output bytes, `originalsUnchanged=true`, and the published SHA-256. If evidence has changed, the output may differ or an invariant may fail. Investigate and retain the discrepancy; never rewrite the original evidence to match this report.

## Unchanged action boundary

This publication performs source/document editing, local evidence reads, offline export/validation, and a normal commit/push directly to `main`. It performs **no new checkout, hold, live lookup, QR recovery, payment, cancellation, retry, browser/profile operation, journal rewrite, lock clearing, arming, app restart or installation**.

The installed runtime remains the previously qualified `48d2859-60bb1aad7c`. A documentation-only main commit is not a claim that the installed code was rebuilt or that future scheduled release readiness was established.
