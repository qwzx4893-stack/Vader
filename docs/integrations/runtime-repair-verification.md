# Installed-audit repair boundaries

The installed 0.2.0 binary was audited separately from these source changes. No
installer was built or replaced for this pass. A component fixture is not the
installed app, and a fake ACP/MCP peer cannot verify a vendor account.

## Repairs and regressions

- `windowLayersE2E.mjs` exercises actual shell/Settings overlay methods and their
  CSS alongside upstream workbench focus/titlebar CSS. It covers bootstrap,
  pointer/keyboard focus, hover, failed mount/retry, Settings return, onboarding
  visibility and disposal. Host mounting is substituted; Electron is not run.
- `shellUiE2E.mjs` uses the real FilesPage with a controlled asynchronous file
  service: external create/edit/delete, watcher error/retry, outside-root files,
  late read suppression and watcher disposal. Open in editor stays read-only.
- `fileWatchLifecycleE2E.mjs` uses the actual FileService and a synthetic provider
  to verify asynchronous setup errors, provider errors, retry and watcher refs.
- `settingsUiE2E.mjs` covers unavailable model vs Off, Tab/Enter/Escape, selected
  agent recovery, local cached model vs connection state and label geometry.
- `externalAgentE2E.mjs` starts isolated Node ACP fixtures, with no user/vendor
  PATH. Startup gates verify cancellation, cold-probe ownership, concurrent
  capacity and actual subprocess exit. These are real process tests, not real
  vendor login/model tests.
- `mcpLifecycleE2E.mjs` combines production services and the real SDK Client with
  controlled transports. It covers replacement/delete races, disconnect before
  readiness publication, recovery, timeout cancellation and joined shutdown.
- `localEmbedderE2E.mjs` uses actual worker threads with synthetic model replies
  to cover missing assets/module, startup/request timeouts, crash, idle restart
  and disposal. Model-start errors remain distinguishable from absent assets.
- `semanticIndexerE2E.mjs` and `codebaseIndexE2E.mjs` verify failure diagnostics and
  lexical fallback. Raw diagnostics are available under Privacy and network.

Run UI suites serially after `npm run buildreact`; run
`reactTypecheckE2E.mjs` and the full project TypeScript check as well. A failing
pre-existing static baseline is recorded, never converted into a clean pass.

## Offline real-model probe

Set `VADER_EMBEDDING_DIR` to an existing offline embedding resource directory and
run `node src/vs/workbench/contrib/vader/test/embedWorkerRuntimeE2E.mjs`. This
bundles the actual worker and host in a disposable temp directory and uses the
specified installed runtime/weights, with remote models disabled. It checks real
finite normalized vectors and reports process RSS, dimensions and elapsed time.
It downloads nothing and does not modify the installation. Three vectors do not
establish search quality, broad performance or whole-application memory usage.

Both desktop build graphs must include `embedWorker`. `packagedImportsE2E.mjs`
also requires its output explicitly because its dynamic FileAccess reference is
invisible to static import walks. The Windows workflow already invokes this
validator before producing an installer. Its amended gate remains unverified on
GitHub until an authorized build actually runs. Local native-model success does
not establish that a future installer contains the worker.

The dependency inspection in this pass checked the installed production graph,
affected SDK contracts, desktop entry graphs and the separate embedding runtime.
It did not establish an exhaustive vulnerability audit of every dependency.
