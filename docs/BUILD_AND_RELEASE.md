# Build and release procedure

`dist/` is generated output. It is gitignored and no longer tracked. The tracked copy used to drift from source: on 2026-09-28/29, 24 compiled files and 3 orphaned modules differed.

## One canonical command

```powershell
npm run release:build              # typecheck → tests → clean UI/runtime build → dist verification → packaging → build metadata
npm run release:build -- --no-package
npm run release:build -- --output C:\scratch\pickle-test   # package into another folder
npm run release:build -- --allow-dirty                     # package uncommitted work (the build ID then says +dirty)
```

The steps run in order, and each must pass:

1. `tsc --noEmit`.
2. The complete test suite; a failing test is retried once and reported.
3. A clean `./dist` build (`npm run ui:build`).
4. Verification of `./dist` against a fresh compile.
5. Packaging with `scripts/build-app.mjs`: it compiles into `dist.staging`, verifies it, then swaps it in. The previous install dist is kept as `.local/build/dist.previous`.
6. Build metadata:
   - `dist/build-info.json`: git SHA, branch, dirty state, build time, content ID and build ID;
   - `BUILD-INFO.txt` in the installation;
   - `.local/build/last-release-build.json`.

Packaging a dirty tree is refused unless `--allow-dirty` is given.

The default packaging target is the **installed app** (the folder that contains `Thirsty Pickle Bot.exe`). Close the app first. Packaging keeps the operator's saved `config.local.json` and booking method.

## Checking what is installed

- The app shows `Build <sha>` in the navigation bar. The full record (SHA, branch, clean or uncommitted, build time, build ID, dist content ID) is in **Tools → Build information**.
- Does the installation contain a commit? Run `git merge-base --is-ancestor <commit> <installed SHA>` in the source folder.
- Does the installed runtime match the current source? Run `npm run verify:dist -- --dist "../dist"`. This is read-only against the installation.

## CI

`.github/workflows/ci.yml` runs on every push: typecheck, the full suite (the UI tests drive the real renderer in Chromium), a clean build and the source-vs-dist check.

## Known intermittent tests

Two tests can fail under heavy full-suite load and pass on rerun:

- `phase2-independence` "stopping the observer…";
- `armed-dispatch` "a verified hold is handed to the QR step…", which has a 1 s dispatch window.

Rerun them rather than change the code.
