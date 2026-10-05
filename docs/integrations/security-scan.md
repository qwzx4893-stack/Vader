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
