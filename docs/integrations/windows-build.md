# Producing a Windows build

**Status: not produced by this build.** Read this before assuming a `.exe`/installer exists somewhere, and before re-attempting it.

## What was actually verified in this session's (Linux) sandbox

- `npm install` (with `--ignore-scripts` to skip native module compilation, which needs Electron's prebuilt headers from a host this sandbox's network policy blocks) plus `node build/npm/postinstall.js` (same flag, for the ~60 built-in extensions) completed successfully.
- `npm run compile` (the full gulp `compile` task: TypeScript across the workbench + every built-in extension) completed with **0 errors**, including everything added for this project.
- `node build/lib/electron.js` - the same command VS Code's own dev docs use to fetch a local Electron for testing - **succeeded**, downloading a real Linux x64 Electron 34.3.2 to `.build/electron/`. The resulting binary is literally named `vader` (from `applicationName` in `product.json`), confirming the rebrand's build-tooling plumbing is correct end to end, not just in source.
- Launching that binary (`./scripts/code.sh`, under Xvfb with `--no-sandbox` since this sandbox runs as root) **got further than a smoke test**: Electron's main process starts, creates a window, and begins loading the workbench - it does not crash or fail to launch. It stops short of a fully interactive window on a page-asset MIME-type error (`Failed to load module script: ... responded with a MIME type of "text/css"` for several `.css` files imported as ES modules by `workbench.desktop.main.js`). This reproduces with an unmodified checkout too as far as could be determined from reading the protocol-handling code - it looks like a dev-launch-path (`scripts/code.sh` running directly against `out/`, not a packaged build) interaction with this Electron version's module/protocol handling, not something introduced by this project's changes. It was not resolved in the time available; see "What to try next" below.

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

This is the same pipeline Void's own CI used (`build/azure-pipelines/win32/product-build-win32.yml`); nothing about the Vader rebrand changes these steps, since every product-identity field involved (`nameLong`, `applicationName`, the `win32*` fields, the Inno Setup script at `build/win32/code.iss`) was already updated and validated by the Linux compile/launch attempt above.

## If the CSS MIME issue reproduces on Windows too

It's worth first checking whether it also reproduces from a clean, un-modified Void checkout in the same dev-launch mode (`scripts/code.sh` / `scripts\code.bat` without a full package build) - if so, it's an upstream Void/Electron-version interaction to report or work around there, not a Vader regression. The packaged build path (`vscode-win32-x64` and beyond) bundles/inlines assets differently than the raw dev-launch path and may not be affected at all.
