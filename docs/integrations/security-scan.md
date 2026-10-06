# Security scanning and what was done about the findings

Vader is a desktop app that runs a model's decisions against a user's files, terminal and browser, so the security bar is the product's own bar, not an add-on. This file records what is scanned, how, what was found, what was fixed, and the decisions taken for what cannot be fixed. Nothing here is left as "a recommendation": every finding is either fixed and tested, or closed with a written reason that a test keeps honest.

## What runs, where

| Layer | Tool | Where | Looks at |
|---|---|---|---|
| Semantic data-flow analysis | CodeQL, `security-extended` suite | `security-scan.yml` | Vader's TypeScript (`void/`, Electron main entry points, build tooling) |
| Pattern rules | Semgrep (OWASP top ten, JS/TS, Node, Electron, XSS, secrets) | `security-scan.yml`, and locally with the community rule set | same code |
| Secrets | gitleaks | `security-scan.yml` | the whole git history |
| Known-vulnerable dependencies | OSV (broadest advisory database) + `npm audit` | `security-scan.yml`, CI gate | `package-lock.json` |
| **What actually ships** | `test/shippedAdvisoriesE2E.mjs` | CI | the production dependency tree minus what `build/.moduleignore` leaves out of the installer: **fails on any high/critical advisory** |
| Workflow security | zizmor | `security-scan.yml`, and locally | `.github/workflows` |
| Electron configuration | Electronegativity + Semgrep Electron rules | `security-scan.yml` | main-process entry points, window setup |
| Behaviour | `searchRegexGuardE2E`, `cloudModelListE2E`, `providerSdkE2E`, `policyBypassE2E`, `browserUrlPolicyE2E`, `mcpServerEnvE2E`, `scmInjectionE2E`... | CI | the specific attacks each guards against |

The run is weekly, on pushes that touch the scan, and on demand. Each job prints a readable summary into its log and uploads the raw SARIF; no job fails the run, so one noisy tool cannot hide the others.

Local runs (this environment cannot download scanner binaries from GitHub releases; PyPI and npm work): Semgrep 1.179 with the community `javascript`/`typescript`/`generic` rules, zizmor 1.30, `npm audit`.

## Findings and how each was closed

### Fixed in code (each with a test)

| Finding | Why it mattered | Fix | Test |
|---|---|---|---|
| **ReDoS in the agent's file search.** `search_in_file` compiled a model-supplied regular expression and ran it on every line. `^(a+)+$` froze the window: 1.5 s on a 26-character line, 45 s on 31. A prompt-injected page or file could make the agent hang the app. | availability, triggered by untrusted content | catastrophic shapes (a repeated group that already repeats) and absurd lengths are rejected with a message the model can act on; lines are capped at 5,000 characters | `searchRegexGuardE2E` (shows the freeze, 7 evil and 9 ordinary patterns) |
| **Reasoning settings never reached the request.** Effort / budget settings were passed to the OpenAI SDK as *client* options, which silently ignores them. | a setting the user chose did nothing (and cost) | added to the request body | `providerSdkE2E` (fails without the fix) |
| **Gemini dropped parallel tool calls** spread over several stream chunks | lost tool calls | accumulated across chunks | `providerSdkE2E` (fails without the fix) |
| **Provider errors could echo the API key** (a rejected key is quoted back by some providers; SDK errors carry the whole body) and errors reach the chat, logs and bug reports | secret disclosure | every secret from the provider's settings (key, token-like custom header values) is redacted from message and full error in the main process | `providerSdkE2E` |
| **Region / Azure resource / GCP project pasted into a host name** from settings | a tampered setting could send the request, and the key, to another host | validated as a plain label first | `providerSdkE2E`, `providerCatalogE2E` |
| **Live model-list requests** (new) | a key must never follow a redirect or travel over plain http | https only (loopback excepted), redirects refused, 15 s / 8 MB caps, ids restricted to a plain character set, the key never echoed | `cloudModelListE2E` (three mutations verified to fail it) |
| Directory listing limit computed and then ignored | a huge folder could flood the model's context | enforced | covered by the full e2e run |
| Worktree directory from a branch name could start with `..` | path traversal in principle (git rejects such names first) | leading dots neutralised | - |

### Fixed in the build and workflows

- zizmor: no `${{ }}` expression is interpolated into a script any more (values go through environment variables); `persist-credentials: false` on every checkout. Left: 7 low-severity notes (an unpinned `choco install`, `shell: cmd` on the Windows packaging steps).
- Installer: `foundry-local-sdk`, `adm-zip` and `node-forge` are no longer shipped (voice dictation is not part of Vader; `adm-zip` had a 4 GB-allocation and symlink-extraction advisory, `node-forge` a signature-verification one).
- Dependencies: provider SDKs moved to their current majors (see `providers/README.md`); `@anthropic-ai/sdk` 0.131 clears its advisory; non-breaking `npm audit fix` applied; the unused SAP AI provider chain (`@jerome-benoit/sap-ai-provider` -> SAP cloud SDK -> `jks-js` -> `node-forge`, 14 high advisories) is replaced by a tiny stand-in package (`build/stubs/sap-ai-provider`) through an `overrides` entry, so none of it is installed.

### Closed with a reason (not shipped, enforced by a test)

`npm audit` still lists advisories in **build and development tooling** that never reaches a user: `gulp 4`, `mocha`, `tailwindcss 3`, `nodemon`, `ts-morph` (via `@vscode/telemetry-extractor`), `next`/`postcss`, and their `chokidar` / `braces` / `micromatch` / `fast-glob` / `glob-watcher` chain. These are ReDoS-class advisories against inputs the build controls (the repository's own file names), several have no patched version at all (`braces`, `micromatch`), and bumping them is a breaking major upgrade of the VS Code build system. They run only on the build machine.

The guarantee that matters is enforced instead: `shippedAdvisoriesE2E.mjs` audits the production tree minus what the installer excludes and **fails the build on any high or critical advisory that would ship**, unless it carries a written exception in `build/advisory-exceptions.json` (an exception that stops applying is itself a failure). At the time of writing the list of exceptions is empty.

Moderate advisories that remain in shipped code: `uuid` 3.x inside `@microsoft/dev-tunnels-connections` (the bounds check only matters when a caller passes its own buffer; the remote-tunnels feature is not part of Vader) and a few low advisories in the AI SDK telemetry packages used by `@cline/llms`.


## First hosted run (commit `baf57bd`, all six jobs)

| Scanner | Result | Disposition |
|---|---|---|
| CodeQL `security-extended` | **0 findings** over 169 TypeScript + 8 JavaScript files | nothing to fix |
| Semgrep (security rules, Vader code) | **0 findings** | nothing to fix |
| zizmor | 0 high, 0 medium, 7 low (`adhoc-packages`: `npm install` outside a lockfile in the Windows E2E/smoke workflows) | fixed: the Playwright client is now `.github/e2e-client` (package + lock) installed with `npm ci --ignore-scripts`; the MCP fixture install and the Windows build use `--ignore-scripts` / `npm ci` |
| gitleaks (whole history) | 31, none a secret: VS Code extension manifests (public client ids, telemetry keys), VS Code test fixtures, a regex that *detects* private keys, and three fake provider keys in Vader's own stub-server tests | `.gitleaks.toml` allow-lists exactly those paths with reasons; the rest of `void/` is not exempt |
| OSV (`package-lock.json`) | 23 advisory groups: `braces`, `micromatch`, `decode-uri-component`, `postcss`, `esbuild` (build tooling: gulp watchers, `next`) and `adm-zip` | none is in the production tree except `adm-zip`/`foundry-local-sdk`, which `build/.moduleignore` keeps out of the installer; `shippedAdvisoriesE2E` fails if that ever stops being true |
| Electronegativity | 3 global warnings (no CSP, no navigation limits, no permission handler) and 1 note (`openExternal`) | false positives for VS Code's window code, which the scanner cannot see: the workbench HTML carries a CSP, `app.ts` sets permission request/check handlers, `will-navigate`/`setWindowOpenHandler` guards exist in `browserView.ts` and `webPageLoader.ts`; the `openExternal` call is VS Code's own, URL-validated link opening |

## Install scripts and signatures
- `package-lock.json`: every package resolves to `https://registry.npmjs.org` with an integrity hash (checked by script; nothing from git, tarball URLs or other hosts except the in-repo SAP stub).
- 31 packages run install scripts. All are native-module builds or prebuilt downloads of VS Code's own dependencies; `foundry-local-sdk` downloads binaries but is excluded from the installer. `npm audit signatures` could not be run from the sandbox (key endpoint blocked); run it in CI when the registry keys are reachable.


## Second pass: shipped sub-packages, and what is left

`shippedAdvisoriesE2E` used to audit only the root `package-lock.json`. VS Code's built-in extensions (css/html/json language features, emmet, npm,
markdown, mermaid, open-remote-ssh...) each carry their own lockfile and `node_modules` into the installer, and had high advisories the gate never saw.
It now audits the production dependencies of all 36 shipped lockfiles, **at every severity**, and the whole set is at zero:

| Package | Where | Advisory | Fix |
|---|---|---|---|
| `proxy-addr` 2.0.7 (critical) | root, via MCP SDK -> express | IP spoofing through IPv4-mapped IPv6 | override to 2.0.8 (it was in the shipped app) |
| `adm-zip` | root, via foundry-local-sdk (not in the installer) | 4 GB allocation, symlink extraction | override to 0.6.1 |
| `katex` | root, `remote`, `remote/web`, markdown extensions, mermaid | prototype pollution bypassing trust settings | 0.19.0 everywhere; rendering verified with `@vscode/markdown-it-katex` |
| `brace-expansion`, `minimatch`, `ip-address`, `socks`, `@babel/runtime-corejs3`, `js-yaml`, `sprintf-js`, ... | language-feature extensions, open-remote-ssh, extension-editing | ReDoS / XSS / DoS | `npm audit fix` (semver-compatible) per lockfile |
| `image-size` | emmet | infinite loop in ICNS parser | upgraded to 2.0.4 and the helper ported to its API (`imageSizeFromFile`) |
| `which-pm`, `find-yarn-workspace-root` (-> YAML parser, micromatch, braces) | npm extension | merge-key CPU use, brace-nesting stack exhaustion, both reachable from files in the opened workspace; `braces` has no patched release at all | replaced by ~50 lines in `preferred-pm.ts`; `npmExtensionPreferredPmE2E` checks real layouts and hostile inputs (merge-key bomb, 50,000 nested braces, 2 MB manifest) |
| `Object` hook tables | `sendLLMMessageService`, `consistentItemService` | Semgrep dynamic-dispatch pattern | prototype-less tables, so ids like `constructor` cannot resolve to inherited members |

Still reported by `npm audit` on the **root development tree** (33 packages): the gulp 4 chain (`glob-watcher`, `chokidar`, `anymatch`, `micromatch`, `braces`,
`findup-sync`, `liftoff`, `gulp-sourcemaps`...), `tailwindcss` 3, `mocha`, `nodemon`, `ts-morph`, `next` and `@vscode/component-explorer-cli`. They are
build and test tooling that only ever sees files from this repository. `braces`, `micromatch` and `fast-glob` have **no patched release** to move to; the
rest need major upgrades of VS Code's own build (gulp 5, tailwind 4), which are upstream decisions. None of them is in the installer: the shipped
`node_modules.asar` was checked and contains none of these packages, and the gate above fails if any advisory reaches a production tree.
