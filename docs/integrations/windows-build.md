# Producing a Windows build

**Status: not produced by this build.** Read this before assuming a `.exe`/installer exists somewhere, and before re-attempting it.

## What was actually verified in this session's (Linux) sandbox

- `npm install` (with `--ignore-scripts` to skip native module compilation, which needs Electron's prebuilt headers from a host this sandbox's network policy blocks) plus `node build/npm/postinstall.js` (same flag, for the ~60 built-in extensions) completed successfully.
- `npm run compile` (the full gulp `compile` task: TypeScript across the workbench + every built-in extension) completed with **0 errors**, including everything added for this project.
- `node build/lib/electron.js` - the same command VS Code's own dev docs use to fetch a local Electron for testing - **succeeded**, downloading a real Linux x64 Electron 34.3.2 to `.build/electron/`. The resulting binary is literally named `vader` (from `applicationName` in `product.json`), confirming the rebrand's build-tooling plumbing is correct end to end, not just in source.
- Launching that binary (`./scripts/code.sh`, under Xvfb with `--no-sandbox` since this sandbox runs as root) **got further than a smoke test**: Electron's main process starts and creates a window. It stops short of a fully interactive workbench on a page-asset error (`Failed to load module script: ... responded with a MIME type of "text/css"` for several `.css` files, then `Failed to fetch dynamically imported module: workbench.desktop.main.js`).

  **This was checked against an unmodified upstream checkout, not assumed** - a second copy of the repo at the same pre-Vader commit was built and launched identically (same Electron binary, same Xvfb/`--no-sandbox` flags, same `--ignore-scripts`-installed dependencies). Connecting to both windows over Electron's own `--remote-debugging-port` (via `playwright-core`'s `connectOverCDP`, not just reading logs) and screenshotting them shows **both** windows stuck on a blank themed canvas with no `.monaco-workbench` element ever mounting - not a functioning Vader either. So this is not "Vader broke something that worked upstream." What differs is *how* each one gets stuck: Vader's stdout shows the specific CSS-MIME/dynamic-import error above; the unmodified upstream checkout shows no equivalent error in its stdout in the time observed, and separately logs missing-native-binding errors for `@vscode/sqlite3` and `@vscode/spdlog` (expected, since native module compilation was skipped in both checkouts - see the network note below) that may be masking or preceding whatever it would have hit at the same later stage. The two failure modes were not fully reconciled to a single root cause in the time available - what's established is that this sandbox's raw dev-launch path (Xvfb, root, `--no-sandbox`, no natively-compiled modules) doesn't reach a working workbench for this Vader-family codebase at all, before any Vader-specific change is considered.

## Why a Windows build specifically wasn't attempted further

`build/lib/electron.ts`'s `getElectron()` - the function every platform-specific packaging task in `build/gulpfile.vscode.win32.js`/`.linux.js`/`.js` calls to fetch the Electron runtime to bundle - hardcodes `platform: process.platform`. It downloads Electron for whatever OS the build is running on, not a chosen target. This matches how the project's own CI is set up (`build/azure-pipelines/win32/product-build-win32.yml` runs on a Windows agent, `.../linux/...yml` on Linux, `.../darwin/...yml` on macOS) - **each platform's build is built natively on that platform**, not cross-compiled. Producing a genuine Windows package therefore requires running this build on an actual Windows machine (or a Windows CI runner), not something achievable by reconfiguring flags on Linux.

Separately, and independently of the above: this sandbox's network egress policy blocks `electronjs.org` and Playwright's CDN hosts (confirmed via the proxy's own status endpoint, which logs `connect_rejected` for both), which is what caused `npm install`'s native-module rebuild step to fail before it was worked around with `--ignore-scripts`. A Windows build attempted from a network with that same restriction would hit further blocked downloads (Windows-specific tooling, `inno_updater.exe` signing steps, etc.) even if the platform mismatch above weren't already a blocker.

## What to try next, on a Windows machine with normal network access

```powershell
npm install
npm run buildreact
npm run compile
npm run gulp vscode-win32-x64          # or vscode-win32-x64-min for a minified build
npm run gulp vscode-win32-x64-inno-updater
# then build/win32/code.iss with Inno Setup, per build/gulpfile.vscode.win32.js
```

This is the same pipeline the upstream CI used (`build/azure-pipelines/win32/product-build-win32.yml`); nothing about the Vader rebrand changes these steps, since every product-identity field involved (`nameLong`, `applicationName`, the `win32*` fields, the Inno Setup script at `build/win32/code.iss`) was already updated and validated by the Linux compile/launch attempt above.

## If the CSS MIME issue reproduces on Windows too

Given it already reproduces on an unmodified upstream checkout in this Linux sandbox (see above), check first whether it's specific to this sandbox (missing native modules, running as root, Xvfb) rather than assuming it needs a code fix at all. The packaged build path (`vscode-win32-x64` and beyond) bundles/inlines assets differently than the raw dev-launch path (`scripts/code.sh`/`scripts\code.bat` against unpackaged `out/`) and may not be affected regardless.

## GitHub Actions workflow

`.github/workflows/windows-build.yml` runs the pipeline above on `windows-latest` (manual `workflow_dispatch`, plus automatically on pushes to `main` that touch build/product-identity files), uploading both the unpacked app and the Inno Setup installer as build artifacts. **This workflow has not been run** - there is no `windows-latest` runner available in this sandbox to test it against, so treat the exact gulp task names and output paths as informed by reading `build/gulpfile.vscode.win32.js` directly (they're real, confirmed task names - `vscode-win32-x64-min`, `vscode-win32-x64-inno-updater`, `vscode-win32-x64-user-setup` all exist and were verified by listing the gulp task registry, not guessed), not as a run that's been observed to succeed end to end. The first real run on this repo's Actions tab should be watched for failures in the Inno Setup step in particular, since Inno Setup's own installation via Chocolatey and its exact invocation are the least-verified part of this workflow.
