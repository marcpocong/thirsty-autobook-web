# Build and release procedure

## One installed application

“Update my Thirsty Pickle Bot to the latest version” means update the recognized original installation in place. Run from `Source`:

```powershell
npm run app:update
# Equivalent canonical pipeline:
npm run release:build
```

`exe:build` also delegates to the full release pipeline. No output-directory or dirty-source override is accepted. Missing, ambiguous or inconsistent installation markers cause refusal; there is no nested-folder fallback. No shortcut, Start Menu entry or second launcher is created.

The source must be clean committed `main`, equal to the current remote `main`, with successful final-SHA GitHub `ci.yml`. The pipeline runs typecheck, the full test suite (heavy browser suites run sequentially, no automatic retries), clean UI/runtime build and fresh source-versus-dist verification before packaging. `npm run release:build -- --no-package` validates source without changing the installation.

The parent of `Source` must already contain the original `Thirsty Pickle Bot.exe`, matching `BUILD-INFO.txt` / `dist/build-info.json`, saved configuration, private directory, Node and Electron runtime and launcher script. The launcher digest and runtime content ID must match their records. Detection refuses a competing historical nested installation.

## Safe staged update

Close the main app normally. The updater does not terminate processes or browsers. Installation safety and booking submission safety are separate checks. `npm run app:update-check` prints the read-only installation preflight; `app:update` repeats it and records it in `.local/build/update-preflight.json`.

These **active lifecycle blockers** refuse installation before anything is staged: running app/booking processes; a lock whose owner process is alive or has an unknown start time (a PID reused by a process started after the lock was written is not the owner); `armed` or `dispatching` journals and `.arming` files; per-key recycle locks; active or unknown hold expiry; unreadable or unrecognized lifecycle records; an unfinished update transaction. A recorded validated hold with an elapsed expiry can be retained without clearing its lock.

A **historical UNKNOWN journal** does not block a code-only update when the record is well-formed, nothing has written to it for 24 hours (record timestamps and file time), every recorded dispatch deadline has passed and every recorded hold expiry has elapsed. A recent, future-dated, malformed or still-dispatchable UNKNOWN record remains a blocker. Age is never evidence of the provider outcome. The record stays `unknown`, the write-once journal keeps refusing that target (`DUPLICATE_LOGICAL_BOOKING_BLOCKED`, recycle `blocked`), and the updated app never resumes, retries or reclassifies it. Installing does not mean these records are cleared or safe to retry.

Before staging, the updater writes a read-only manifest of every lifecycle file (relative path, size and SHA-256) to `.local/build/protected-state/`. Package validation, the pre-replacement check, the installed validation and the final record all compare against it. Any added, removed or changed byte fails installation, and a failure after replacement restores the previous runtime. This is a local replacement check, never permission to retry a checkout or cancel a provider hold.

New files are built only in the internal `.local/build/staging` directory of the recognized installation. All runtime, launcher and dependency files are hashed before application. Safety and source identity are checked again before replacement. Same-volume renames move previous managed files into numbered entries under `.local/build/rollback`; the backup has no user-facing EXE filename. An exclusive update lock and persistent transaction record detect interrupted updates. Stage or installation validation failure during replacement restores the previous files.

Only the explicit managed application paths are replaced: `dist`, `src`, `ui`, `scripts`, `node_modules`, package manifests, `assets/brand`, launcher, build metadata, Node executable and app icon. Configuration is not rewritten or migrated. All other files remain in place, including `.local/private`, profiles, customer bindings, security, journals, retained handoffs, history, allocations, offsets and settings. Saved configuration and private-directory digests are verified before/after installation. Never clear booking locks or journals to make an update pass.

Build provenance appears in the navigation bar and **Tools → Build information**: source SHA, build ID, package version, content ID and build time. These are kept as separate facts: **Installed** (the canonical installation runs this commit), **CI verified** (required by the updater for that exact commit), **Installed runtime verified** (dist checked against a fresh compile), and **Source checkout** (the local `Source` HEAD, read from `.git` metadata). A newer source commit is labelled *Source updated · not installed* until the updater installs it; a GitHub commit alone never means installed. The last read-only installation preflight (`.local/build/update-preflight.json`: eligibility, active blocker count, preserved historical UNKNOWN count, timestamp) is shown as recorded, never re-derived. Installation verification records are `.local/build/stage-manifest.json`, `update-transaction.json`, `installed-update.json` and `BUILD-INFO.txt`. Verify the installed runtime independently with `npm run verify:dist -- --dist ../dist`.

## Rollback and interrupted updates

A failed in-process update restores previous managed files automatically. For an explicit rollback after a completed update, close the app, ensure lifecycle evidence is safe, then run `node scripts/app-rollback.mjs` from `Source`. It restores numbered backups and validates the previous SHA/content ID/configuration; displaced files remain internally under `failed-runtime`. It never changes private state.

After power loss or process termination, do not launch or rerun installation blindly. Review `.local/build/update-transaction.json` and confirm the updater process is gone before removing only the updater's stale `.local/build/update.lock`. Use the rollback command to restore the interrupted transaction. A booking lifecycle lock is different and must never be removed for recovery. An existing staging or recovery directory requires inspection; the updater will not silently discard it.

## Configured release calendar

Mango remains VERIFIED at 08:00 Manila, booking date release date +2 calendar days. Buko is PROVISIONAL at 08:00 Manila, +6 calendar days: approved October 14, 2026 from the observed official banner horizon (Oct 20), and the date rule was observed again on October 15 (Oct 21 published, Oct 22 unreleased). The 08:00 instant itself has not been observed, so Buko is not VERIFIED. No extra rollover observation is required for planning or offline rehearsal. Independently verified provider timing remains distinct. October 15 08:00 maps to Mango October 17 and Buko October 21; exact matching timestamps allow one mixed-wing planning cohort. Saved strategies are never changed automatically.

Live Shotgun is a Mango LIVE PILOT capability: arming requires an owner attestation for the exact plan fingerprint and every existing readiness gate; Buko scheduled targets and immediate current-slot bursts stay refused. Assumed scheduling never authorizes Buko live submissions. All offline rehearsals remain OFFLINE / INTERCEPTED and use isolated browsers and the existing real dispatcher (see [Booking Setup v3](BOOKING_SETUP_V3.md)).

## CI and safe UI verification

GitHub CI runs every test, with the heavy or real-time suites (strict-deadline dispatcher tests, isolated Chrome Test Lab, offline Normal Test Lab children, destination screenshots, complete strategy flow) scheduled sequentially. For package verification, launch only the canonical installed Electron runtime with Playwright and run the locally intercepted Test Lab; never prepare a provider browser or authorize Terms. Preserve any existing planning draft before tests and restore it byte-for-byte afterward. Verify displayed provenance and the four destinations (Home, Booking Setup, Activity, Settings). If installation was refused, do not claim the new installed UI was tested or updated.
