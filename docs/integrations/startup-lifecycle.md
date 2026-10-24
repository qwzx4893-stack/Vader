# Startup and background lifecycle fixes

The full-window shell registers at `WorkbenchPhase.BlockRestore`, subscribes to
the first main-container layout, and mounts before restored editor panels paint.
The native bootstrap passes `vaderWindowFirst` from `vader.window.agentsFirst` and
omits saved classic-panel splash geometry while that mode starts. Theme/zoom
data remain available. Explicit classic mode retains its original startup.

`setVaderWindowLayer` tracks shell, Settings and onboarding separately. Desktop
Vader pages hide inherited editor menus/parts and window border, while real
window controls retain visibility and pointer events. Host-outline suppression
does not remove keyboard-focus indicators from controls. A synchronous shell
mount failure removes partial resources, preserves modern screen ownership,
propagates the actual error to diagnostics, and permits retry on a later layout.
It never reveals the classic editor as an automatic fallback and adds no new
failure/retry page. All inherited part descendants are suppressed, including
widgets that set `visibility:visible` themselves. Native window controls remain
visible and clickable. Explicit editor mode still intentionally exposes the
editor; this is distinct from accidental startup/transition leakage.
Completed onboarding unmounts;
returning users do not mount its provider discovery hooks.

Agent inventory is passive: manifests/file locations only, no handshake or
sign-in session. Connect, Test connection and chat still perform explicit
verification. Installation polling is serial and disposable. The initiating
window owns a sign-in terminal. One session key reserves its opening promise
before awaiting capacity. React service access has stable identity, and the
navigation update effect follows the marketplace service instead of wrappers.

MCP file refreshes are serialized; unchanged parsed entries do not reconnect.
Saved disabled state and tool review survive discovery. Main-process operations
are serialized per server so replacement/removal cannot orphan pending clients.
Connection deduplication still publishes state to a new window or repeated
enable request. Disabled entries create no transport. Error messages retain the
server's actual cause; connection timeout handles are cleared after settlement.

Semantic background work checks holds before loading the code model. Closing a
folder during loading releases a late model and prevents queued embedding. It
does not temporarily undo disposal while persisting vectors.

## Regression boundaries

Run `npm run buildreact` before UI suites. Execute UI suites serially.

- `startupServicesE2E.mjs`: actual agent services with isolated file, clock and
  transport boundaries; `--baseline` runs pre-fix HEAD service sources.
- `mcpLifecycleE2E.mjs`: actual MCP/settings services and SDK Client with synthetic
  transports/config/IPC. `--source-ref=HEAD` demonstrates pre-fix failures.
- `windowLayersE2E.mjs`: Chromium with production CSS/layer helper and the actual
  shell contribution, controlled host/mount; startup, nested layers, window
  button clicks, focus, mount failure/retry and disposal. Executes the production
  bootstrap function against saved splash geometry and samples 72 frames across
  Settings transitions. `--baseline-css` uses released HEAD CSS and must fail the
  visible-menu regression; it is a sensitivity experiment, not a passing gate.
- `smokeReadinessE2E.mjs`: checks the packaged observer also detects a visible
  MenuBar descendant even when its ancestor has `visibility:hidden`.
- `semanticIndexerE2E.mjs`: real indexer and temporary folders, synthetic vectors;
  power hold, persistence and delayed-factory disposal.
- Existing external-agent protocol, MCP review, shell, onboarding, Settings,
  composed-window, chat, Add-ons, picker, React typecheck and runtime browser
  suites remain relevant. The external-agent protocol test isolates PATH from
  host vendor installations while retaining the OS tree-termination utility.

These establish controlled local behavior. They do not measure installed-app
CPU/RAM, native dragging/window-control behavior, live vendor connectivity or
real model-worker termination. CI entries are configured in the working tree;
new checks are not externally enforced until pushed and executed. The earlier
348 missing-Electron-type diagnostics were resolved by restoring checksum-verified
Electron type declarations; the full local TypeScript baseline is now zero.
No installer/release was produced for this fix set.
