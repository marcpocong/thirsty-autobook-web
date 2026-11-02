# November 2, 2026 release investigation and repair record

The complete independent-review package is:

- [Detailed forensic report](docs/incidents/2026-11-02-release/README.md).
- [Allowlisted, machine-readable evidence](docs/incidents/2026-11-02-release/evidence.json).
- [Publication validation and reproduction instructions](docs/incidents/2026-11-02-release/VALIDATION.md).

The 08:00 Manila release targeted November 4 Mango Courts 7/6/5, 19:00–22:00. Eight children were authorized; seven checkout POSTs were observed. Five HTTP 200 responses describe five apparent pending-reservation groups containing 15 distinct hourly booking IDs. Two HTTP 400 responses explicitly said the booking date was not available yet. The eighth child was suppressed without sending.

**Five apparent pending-response groups; zero independently confirmed holds; zero QR handoffs.** All five groups subsequently returned official lookup 404s before their advertised expiry. The original application's objective-achieved/verified-hold labels were unsupported. Corrected reconstruction reports `MANUAL_RECONCILIATION_REQUIRED`; original journals and reports remain unchanged.

The report documents the error-classification, recovery-queue, controller, forensic, quota, grid-ownership and historical-label fixes in `4d1834e` and `48d2859`, their local/CI/installed qualification, and the remaining provider, timing, historical-count and Windows-native-crash uncertainties. It also separates the successful after-midnight Available Now qualification from the failed scheduled release. Publishing this record performs no booking, recovery request, payment, retry, installation or arming.
