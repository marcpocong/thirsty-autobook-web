# Shotgun reliability V2.1 engineering scope

V2 established actual published-slot confirmation and exact official QR for three one-hour Mango groups, single A and concurrent B/C, on installed `b7c323d`. This is not actual 08:00 release qualification.

V2.1 keeps the production dispatcher and independent recovery implementation. Security helpers now expose sanitized per-helper stage/duration observations without token, fingerprint or rejection reason; acceptance and the genuine helper timeout are unchanged. A security-only experiment runs against installed modules in normal, minimized or unattended window conditions with both booking routes blocked. Stage records distinguish clean-page checks, navigation, venue readiness and genuine helper acquisition. No reservation permit exists, no failed acquisition is automatically retried and a visible human challenge is surfaced rather than solved.

The desktop's earlier Not synced status was supported: its saved NTP consensus was older than the two-hour network-clock freshness limit. Per-run Lab clocks are independent and were not persisted as future release authority. Refresh Clock now verifies current GOOD evidence and its age/uncertainty before claiming synchronization; failed, stale, absent or degraded data cannot produce a success headline. Production release readiness and near-release clock/calibration gates remain independent.

[Owner lock maintenance](OWNER_LOCK_MAINTENANCE.md) replaces repeated undocumented exceptions with explicit one-use, exact-hash authorizations, immutable originals, process and in-flight checks, atomic global occupancy, rollback and full lifecycle preservation. It never reuses a booking permit or releases an UNKNOWN duplicate barrier.

The two earlier offline native Node exits remain unexplained. More process/executable, version, Chrome spawn and exit diagnostics are retained; tests are not retried or suppressed by the runner. Windows Application and WER inspection found no matching record during the new investigation. Later successful tests cannot establish the native cause.

Live three-hour grouping, three-worker A/B/C execution, final installed clock/recovery and exact-commit CI results belong in the private final qualification report after they have actually been observed. No future release is silently armed. Revised negative offsets, arbitrary dense live bursts and claims of production readiness are outside any inferred qualification.
