# Availability dependency audit — October 14, 2026

Production availability requires a legitimate browser session. `OndaLiveAvailabilityProvider` remains the strict parser/HTTP adapter base and an explicitly injected offline comparison tool. Inheritance by `OndaBrowserAvailabilityProvider` does not send Node HTTP requests: it installs a bounded same-origin browser fetcher. No failure falls back to default Node fetch.

| Caller | Role and current disposition |
|---|---|
| `desktop-runner.ts` discovery | Booking-critical Normal preparation/preview/execution: verified dedicated Chrome browser provider, wing scoped |
| `desktop-runner.ts` snapshot reads | Release preparation and audit: removed Node fallback; missing page produces `AVAILABILITY_BROWSER_PREPARATION_REQUIRED`; audit prepares the trusted worker first |
| `block-audit-runner.ts` / `block-audit-read.ts` | Active court-hour audit: read-only verified Worker A attachment, no navigation or security acquisition; failure remains unknown, occupancy supplemental. Explicit injected fetcher retained for tests |
| `court-browser-runner.ts` / `availability-observer.ts` | Active one-click Check Availability (October 15): dedicated observer Chrome window on its own profile (launched like worker browsers, read-only CDP attach, GET-only routing, closed with `Browser.close`), two sequential wing-scoped reads; needs no prepared worker; OPEN/BLOCKED/UNRELEASED/UNKNOWN per cell; oldest capture governs freshness |
| `preview-config.ts`, `preview-live.ts` | CLI previews: require verified existing Chrome schedule, no Node fallback |
| `network-readiness.ts` | Active diagnostic: verified Chrome availability and existing separate clock check; Node fetch only when explicitly injected by tests. Browser connection reuse/protocol unmeasured |
| `slot-watch.ts` | Active observer: no default HTTP availability. Injected isolated observer or UNKNOWN; public booking records retained |
| `slot-watch-observer-child.ts` / `slot-watch-browser.ts` | Active desktop observation: independent Chrome guest profile, browser and Node child; since October 15 launched through `observer-chrome.ts` because automation-launched and headless browsers receive HTTP 403 from the availability endpoint. No dispatch CDP/customer/security context; GET-only routing, bounded existing polling. Access failure/throttle stops further availability network requests for this observer |
| `strategy-engine.ts` / release advisor | Suggestions use existing public occupancy and saved historical observations; absence of conflict is never availability. No Node availability dependency was found |
| `prewarmed-runner.ts` (`api:prewarm`) | Archived experimental CLI; now refuses immediately with `LEGACY_ENTRYPOINT_RETIRED_USE_DESKTOP_RUNNER`, before reads/proofs/submission |
| `calendar-free-live-attempt.ts` | Archived September diagnostic harness; immediate refusal. Historical source retained; use guarded desktop runner |
| `calendar-independent-probe.ts`, `verify-candidate.ts`, `real-checkout-dry-run.ts` | Archived probes/security diagnostics; immediate refusal before browser/read/proof operations |
| `arbitration/read-concurrency.ts`, scripts `probe-release-availability.ts` | Explicit historical public GET experiments, outside operational decisions. Retained for forensic reference; not wired into booking/preview/observer readiness |
| `onda-availability.ts`, discovery/compare Browser helpers | Existing Browser/Hybrid reads through Playwright pages, Mango scoped; their validated booking semantics preserved |
| Mock provider and test fixtures | Offline only; deliberately retained schema, 403, freshness, pricing, wing and occupancy regression coverage |

The audit was traced from actual imports, process commands and UI callbacks at starting commit `d630f67`. The active grid does not infer openness from the facility calendar flag, absence of bookings, a missing slot, a retired Node endpoint or old captures. A missing morning Buko slot is unknown/restricted, never open. The parser validates registry UUIDs, dates, currency and prices before producing a cell.

The observer matrix remains Mango scoped because Buko recurring release is unverified. Book Now covers both wings. A fresh snapshot proves the represented slot facts, not a future booking outcome. All checkout authorization, journals, permits, locks and final proof acquisition remain separate.

Live finding, October 14 23:15 Manila: a Playwright-launched guest profile (headed or headless) and a normally launched headless Chrome both received HTTP 403 for the availability endpoint, including the official page's own requests carrying the site's bot-protection headers. A normally launched Chrome window on a fresh dedicated profile received HTTP 200 for the page's requests and for the bounded same-origin read. No headers, cookies or credentials are copied in any mode.
