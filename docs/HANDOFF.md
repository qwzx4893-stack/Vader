# Vader: hand-off for continuing the work in a new session

Written 2026-10-13 at the end of a long cloud session (`session_017KMferaC8oUHQizn48GQnw`). The goal of this file: an agent that has read it (plus the files listed in
section 11) can continue the work with the owner as if the conversation had never been interrupted. Where this file and the code disagree, **trust the code**, and
tell the owner what changed. Nothing here is a secret; do not add keys or tokens to it.

Contents: 1 project and owner · 2 standing rules · 3 decisions already made · 4 state right now · 5 the release procedure · 6 how to verify things ·
7 known issues and open items · 8 the quality plan (the most important open item) · 9 history · 10 pitfalls · 11 reading list and file map · 12 how to work with this owner.

## 1. The project and the owner

- **Vader**: an AI-native IDE, a fork of Void on VS Code **1.136.2** (Electron 42.11.10). Repo `qwzx4893-stack/Vader`, default branch `main`. `product.json`: `nameShort` Vader,
  `applicationName` vader, `dataFolderName` `.vader-editor`, `vaderVersion` **0.1.0** (this number names the release and the installer `Vader-Setup-x64-0.1.0.exe`).
  Windows is the only platform built in CI. Vader's own code is in `src/vs/workbench/contrib/vader/` (about 40k lines of TypeScript/TSX, plus tests); the rest is the VS Code base.
- Agent loop: `@cline/agents` behind Vader's own gate (policy engine, approvals, agent scope). **49 providers**, **39 built-in tools** (files, search, terminal and persistent terminals,
  browser via Playwright, verification, MCP/skill discovery, agents and sub-agents), MCP, permanent agents and sub-agents, plan mode, checkpoints, verification pipeline,
  memory/compaction, model router, marketplace (extensions, MCP, SkillNet), first-run welcome then import-settings then editor, a full-window Settings page
  (Models, Coding Agents, Local/Main Providers, Agent & Permissions, Context & Instructions, MCP, Editor Features, Extensions, Privacy & Network, Data & Backup, About & Updates).
- **External coding agents** (Settings > Coding Agents): Codex, OpenCode, Cursor, Copilot, Mistral Vibe, Grok Build, Kimi can be used in the chat through ACP with the account the
  person already has (Install -> Connect -> Use in the chat; programs already on the machine are found and used as they are); Claude Code, Antigravity, Freebuff are hosted in a
  terminal and never wired into the chat. Gemini CLI was removed (Google ended its free personal login). See `docs/integrations/external-agents.md`.
- **The owner writes in Arabic. Reply in Arabic**, plainly. Technical terms and file names stay in English. See section 12 for how they like to be worked with.

## 2. Standing rules from the owner (repeated several times; follow them)

1. **No Windows build or release without their explicit approval.** The approval they gave on 2026-10-13 covers exactly the release in section 4/5 (validation build, E2E/Smoke,
   then publishing `v0.1.0` over the old one). Anything new needs its own approval.
2. **Show real screenshots before any build** when the change is visual.
3. **All work ends up on `main`.** The project must stay build-once, low-maintenance and error-free.
4. In design or mock-up phases do **not** modify project files unless told to.
5. **Never claim to use a tool that is not available** (Claude Design commands, Affinity; Figma and Canva were limited by plan quotas). Say so instead of substituting.
6. A release must be **a version without problems**: first look for what can go wrong in the build and fix it, then start the build, watch it, and fix whatever appears.
   Do not publish with a known failing check without telling them and getting a decision.
7. Report honestly: what passed, what failed, what was **not verified** (for example Windows icon rendering was never seen by a human).
8. Things only the owner can do: delete the 8 non-main branches, import the protect-main ruleset (`docs/REPOSITORY_SETUP.md`), set the repo description/topics, add the
   `OPENROUTER_API_KEY` repository secret, rotate the OpenRouter key that leaked earlier in the project's history.

## 3. Decisions already made (do not re-litigate)

- **Visual identity**: the existing grey and blue look, only polished (the owner rejected an amber/near-black redesign and "traditional" looks; they wanted calm, modern, Cursor/Linear-like
  polish on the same identity). The editor base's own *Modern UI* (floating rounded panels) is on by default via `src/vs/workbench/contrib/vader/browser/vaderDefaults.ts`
  (the desktop workbench ignores `configurationDefaults` in `product.json`, that works for the web build only). Dark-theme refinement CSS:
  `src/vs/workbench/contrib/vader/browser/media/vaderPolish.css`, scoped to `.monaco-workbench.vs-dark`, light/high-contrast untouched. **The send button stays white**, as in the original UI.
  Before/after screenshots of the real app are on a Design canvas: https://claude.ai/artifact/4PYTZhRChMgxwBbSoQpmDP
- **Logo and icons**: the **whole logo** (ring and both wings) on a black square, only sharper. The owner rejected ring-only crops, thickened versions and removed-hairline versions;
  the version they approved ("Q1") keeps today's look. Source of every asset is the Real-ESRGAN x4 master `brand/source/logo-black-x4.png` (made from `logo-black.jpg`);
  `build/lib/vader/make_brand_assets.py` regenerates `.ico` (16-256), installer images, favicon, in-app logo, SVGs. Below 64 px it is drawn 16x oversampled with a contrast curve.
- **Models are live only.** No provider starts with model names. What a person can pick is what the provider's own list route returns for the key (every vendor provider now asks its
  `/models`, GitHub Models its catalogue route), what a local server reports, or a model added by name. Never show a built-in catalogue as a choice. The catalogue in
  `modelCapabilities.ts` / `vendorProviderData.ts` (generated by `build/lib/vader/genVendorProviders.py`) only describes models (context window, tools, price) once one is in use.
  Providers with no list route (HTTP 404/405/501) say so and ask for a name via "Add model".
- **No inheritance from pre-release installs.** Settings and chats moved to storage keys `vader.settingsServiceStorageIII` / `vader.chatThreadStorageIII`; the old `...II` keys are deleted on
  startup (`common/storageKeys.ts`). One-time reset only: later versions must keep user data, so do not bump them again unless a reset is deliberately intended.
- **Extension signatures**: `extensions.verifySignature` is off by default (Open VSX cannot be verified); the download process treats an unset value as off
  (`src/vs/platform/extensionManagement/node/extensionManagementService.ts`); turning the setting on still verifies. (Weakening-looking edits like this may be blocked by an
  auto-mode classifier in the agent environment; the owner explicitly approved it, and the Edit tool is the normal way to make it.)
- The Policy Engine's `locked: true` rules can never be disabled from configuration; new gates belong in `chatThreadService.ts` `_runToolCall`, before the approval UI (`AGENTS.md`).
- Renderer code (`browser/`, `common/`) must not import npm packages by bare name; network calls go through `electron-main/*MainService.ts` (`AGENTS.md`).
- Keep `ChatMessage`/`ThreadType` persisted formats backward compatible: add optional fields only.

## 4. State right now (update this when you finish something)

- `main` is at the commit that added this file, on top of `b9fdd86` (clean start, no built-in model names, stale approvals), `02660d4` (signature default, Claude Code card test) and
  `7a5ef36` (icons + dark polish). The three user-visible fixes in `b9fdd86` answer problems the owner saw in the **installed** v0.1.0:
  1. no welcome screen: the first install had inherited an earlier build's stored state -> new storage keys;
  2. the side chat showed an old message and could not send: a thread closed while a tool request awaited approval stayed locked on it -> such a request is now closed as rejected on restore
     (`chatThreadService.ts` `_setState`). The exact cause on the owner's machine was **not reproduced** (the local suite cannot persist: no `@vscode/sqlite3`), so ask them to confirm;
  3. baked-in model names in Settings > Providers -> every provider starts empty.
- **Published**: GitHub release `v0.1.0` (installer `Vader-Setup-x64-0.1.0.exe`, 168 MB) built from `02660d4`; Windows Smoke passed on it. It does **not** contain `b9fdd86`.
- **In flight when this was written**: validation build (publish=false) of `b9fdd86`, run **38397058798**; CI on it passed (run 38397052418). The plan the owner approved:
  1. wait for the build; 2. dispatch **Windows E2E** and **Windows Smoke** with `run_id` = that build run (the E2E includes the new scenario
     `upgrade: data left by an earlier build is not inherited, and a chat closed mid-approval opens ready to use`); 3. if everything passes, dispatch `windows-build.yml` with
     `publish=true` and `remove_previous_releases=true`: it deletes the existing `v0.1.0` release **and tag** and recreates it from `main` (same version number, as the owner asked);
  4. run Windows Smoke with `tag=v0.1.0`; 5. report to the owner in Arabic, including anything not verified.
  Check the Actions tab: this file may be out of date by the time you read it. If `v0.1.0` already contains the `b9fdd86` changes, step 3 is done.
- Last full Windows E2E on the released build `02660d4`: **91/91 scenarios, 383/383 checks** in the scripted suite; the small real-model step (qwen2.5:3b on a CPU runner) passed
  in one run and failed one check in another because of timeouts (informational, see section 7).

## 5. The release procedure (and why it is shaped this way)

- `windows-build.yml` (workflow_dispatch; inputs `arch` (x64), `publish`, `remove_previous_releases`). The build job produces the unpacked app and the Inno Setup installer; the **publish job
  runs in the same run**, deletes the existing tag/release `v<vaderVersion>` and recreates it from the dispatched commit (`GITHUB_SHA`); with `remove_previous_releases` it also deletes every
  other release. A push to `main` does **not** build or publish anything on Windows.
- Always **validate first**: dispatch with `publish=false`, then `windows-e2e.yml` (inputs `run_id`, `real_llm`, `only` regex, `real_llm_model`) and `windows-smoke.yml` (`tag` or `run_id`) on
  that run id. A push that touches the e2e suite also starts `windows-e2e` automatically, against the latest successful build, which is the *previous* commit's build: ignore that run.
  Only then publish. Finally run `windows-smoke.yml` with `tag=v0.1.0` against the released file.
- The installer is **unsigned**; there is no auto-update URL in `product.json` (the update check compares with the latest GitHub release).
- A build took 25 to 60 minutes (queueing varies), the scripted E2E about 20 minutes plus 15-25 for the optional real-model step. Do not poll in a loop; use a monitor/wait.
- Windows E2E logs are huge because of Ollama progress bars. Fetch the job log through the GitHub API and filter lines for `FAIL`, `====`, `group:`, `FAILED`.

## 6. How to verify things

- Type check, before and after a change: `node_modules/.bin/tsc -p src/tsconfig.json --noEmit`. After touching `browser/react/src/` run `npm run buildreact` first (the type check
  resolves the built `react/out/` bundle; stale output hides real errors). After a fresh clone run `npm run buildcline` (the renderer cannot import bare packages; `AGENTS.md`).
- Node-level suites: the `src/vs/workbench/contrib/vader/test/*E2E.mjs` files, run by `.github/workflows/ci.yml` (26 suites, e.g. `vendorProvidersE2E`, `providerCatalogE2E`, `externalAgentE2E`,
  `symlinkPolicyE2E`, `settingsPortabilityE2E`, `packagedImportsE2E`, `clineBundleBrowserE2E`). Run any with `node <file>`; all passed on `b9fdd86` locally.
- Real-app suite: `src/vs/workbench/contrib/vader/test/e2e/suite.mjs` (env `VADER_EXE`, `PW_CORE`, `E2E_OUT`, `E2E_ONLY`, `E2E_NATIVES`) drives the packaged app with a scripted model server
  (`modelServer.mjs`). Groups: native-tools, xml-tools, unknown-model, providers, robustness, external-agents, no-workspace, agent-tasks, autocomplete, persistence (+ upgrade), privacy, real-llm.
  Without native modules (`node-pty`, `@vscode/sqlite3`) 11 scenarios skip; in the cloud sandbox 2 more fail only because the network is blocked (GitHub update check, Open VSX install).
  On Windows CI nothing is skipped. On your own machine with a Windows build you can run everything.
- `externalAgentLiveE2E.mjs` runs the real external agents (needs network and the programs): last result 46 passed, 2 skipped (Cursor and Antigravity download hosts unreachable from the sandbox).
- Docs for testing: `docs/integrations/testing.md`, `docs/integrations/windows-build.md` (older, partly historical), `docs/integrations/security-scan.md`.

## 7. Known issues and open items (honest list)

- **Agent quality is not measured.** See section 8. This is the biggest gap and the owner has said it is what should have come first.
- The tiny local model in the Windows real-LLM step fails coding tasks and sometimes exceeds the 300 s attempt timeout after delegating to a sub-agent: informational, not a product defect,
  but it proves the suite does not measure quality.
- `ReferenceError: require is not defined` from the language-detection web worker appears in the Windows renderer log. Not investigated (may be inherited from VS Code; the built worker contains no `require(`).
- **Windows rendering of the new `.ico` and installer images was never seen by a human.** Ask the owner how the desktop icon and the small sizes look.
- The first installed v0.1.0 showed a "installation appears to be corrupt" toast in local-package screenshots (swapped files); unverified on a clean Windows build (the E2E scenario for a clean install checks for it).
- Not done: signed installer, auto-update, macOS/Linux installers, crash reporting (`docs/PRODUCT_ASSESSMENT.md` section 3); the weekly real-model E2E needs the `OPENROUTER_API_KEY` secret;
  Dependabot PRs untouched; optional second-wave agents (Cline, Junie, Factory Droid).
- Provider list routes recorded from vendor documentation (29 newest gateways) were **not exercised live** from the build environment (provider hosts unreachable there); real keys will tell.
- The cloud sandbox where this work happened blocks several hosts (screenrove.com, linear.app, cursor.com, vercel.com, pytorch.org, some GitHub-hosted downloads); PyPI, GitHub and npm work. A local machine does not have these limits.
- Design leftovers: an empty Figma draft exists (https://www.figma.com/design/vsfJoenyvPOSbCikYE6cPt); Figma and Canva were blocked by plan quotas.

## 8. The quality plan (most important next step, needs the owner's decision)

The owner asked, after an honest assessment, that the project be checked against commercial tools. The assessment given to them (keep it consistent): Vader's strengths are privacy/control
(no telemetry, own endpoints, local models), a hard policy engine before approvals, many providers in one UI, persistent agents/sub-agents with scoped permissions, a rich environment (editor,
diagnostics, browser, terminals, checkpoints, MCP), external agents inside the editor, and unusually good security/test hygiene. Its weaknesses: agent loop quality unmeasured (so no claim that it matches
Claude Code or Cursor), autocomplete/retrieval weaker than Cursor's trained models, no signed/auto-updating distribution, no field health signal, little long-session testing with strong models,
Windows only. Its value today: an open platform for control and privacy, **not yet proven better for daily output**.

Plan agreed in principle (not started):
1. A set of 30-50 real tasks (fix a bug in a repo with tests, add a feature, refactor, terminal tasks) graded by **tests on the final files**, not by what the model says; report pass@k and pass^k.
2. Run the **same model on the same tasks** through Vader's headless agent runtime (the `@cline/agents` + gate path, no GUI), plain Cline, and if possible Claude Code / Codex, to separate loop quality from model quality.
3. Fix what the comparison exposes (loop errors, tool-call shapes, context handling, prompts), measured again.
- Tooling: **Harbor** (open, the official Terminal-Bench 2.0 harness; tasks run in containers on Daytona/Modal/local Docker; adapters for SWE-bench and Aider Polyglot; billed by the sandbox provider),
  Senior SWE-Bench (Snorkel, Harbor-compatible), public leaderboards (tbench.ai, Artificial Analysis) for reference. No hosted service evaluates an IDE for free; GUI is not what is in doubt.
- Models: **a strong-model API key is needed**. OpenRouter `:free` models: 20 requests/min, 50/day unless $10 was ever purchased, then 1000/day (from third-party blogs; verify in OpenRouter's docs). Free models are weaker, so
  numbers from them do not represent Claude Code with a frontier model. The owner has **not yet answered** whether they will provide a key.
- Existing building blocks: `docs/QUALITY_COMPARISON.md`, `build/lib/vader/quality_compare.py`, `test/e2e/scenarios/realLlmTasks.mjs` (task graders), `agentBridge.mjs` (human-in-the-loop driving), `docs/PRODUCT_ASSESSMENT.md` section 4.

## 9. History in one page

- 2026-09-27/30: rebrand Void -> Vader, Windows CI, Cline runtime made the only agent path, policy engine, agents/sub-agents, MCP + marketplace, security fixes.
- 2026-10-05: upgraded the base from VS Code 1.99.3 to 1.136.2, fixed the packaged app (blank window from import cycles, DI cycle, onboarding stand-in), built the real-app E2E suite and the Windows E2E/Smoke workflows,
  security passes (CodeQL, Semgrep, zizmor, gitleaks all at zero in Vader's own code).
- 2026-10-06: all advisories cleared (58 lockfiles), 29 vendor providers added to the original 20 (table-driven, searchable, real logos), live-only model lists, contrib/void renamed to contrib/vader,
  new logo, README, release workflow, first public release `v0.1.0`, Open VSX signature fix, quality comparison and product assessment.
- 2026-10-10/12: full-window Settings page and sections, GitHub-release update check, tool calls written with attributes or `<tool_call>` JSON accepted, untrusted-input hardening (markdown images/links,
  network shares, git config programs, settings import must not bring custom agents), external coding agents (rounds 1-4: ACP integration, Connect/Install flow, Antigravity via Google's ACP server, logos).
- 2026-10-12/13: design phase (several rejected directions, then polish on the same identity), logo upscaled (Real-ESRGAN) and re-traced, Modern UI on by default, icons "Q1", release 2 validated on Windows
  (found and fixed the Open VSX install bug in the download process), then the owner installed the release and reported the three problems fixed in `b9fdd86`.
- `CHANGELOG.md` has a detailed entry per round; `git log` has one commit per round.

## 10. Pitfalls met (save yourself the time)

- A default registered by a workbench contribution (renderer) is invisible to the shared/main process: anything those processes read must not depend on it (this caused the signature bug).
- `src/tsconfig.json` resolves the built `react/out/` bundle: stale output hides real errors.
- The Linux packaged copy used for fast local iteration is refreshed by bundling `main.js` and the workbench into it; the shared-process bundle is not refreshed that way, so shared-process changes need a real build.
- A new storage key means a one-time reset for everyone: do not change `VADER_SETTINGS_STORAGE_KEY` casually.
- The Windows E2E `real-llm` step downloads Ollama and a model; it is slow and its tiny model makes it noisy. Do not treat a failure there as a regression without reading which check failed.
- Rate and scope: never put an API key in a workflow file, a log, or this repository; keys live in repository secrets or the owner's own settings.

## 11. Reading list and file map

Read in this order (from `main`, via GitHub if you do not have a clone yet): this file, `AGENTS.md`, `ARCHITECTURE.md`, `CHANGELOG.md` (first two sections), `docs/PRODUCT_ASSESSMENT.md`, `docs/CODEBASE_GUIDE.md`,
`.github/workflows/` (`ci.yml`, `windows-build.yml`, `windows-e2e.yml`, `windows-smoke.yml`). Then only what the task needs:

| Need | Where |
|---|---|
| Subsystem map, extension points | `ARCHITECTURE.md`, `docs/integrations/*.md` |
| Agent loop, gate, runtime | `common/agentGateway`, `common/agentRuntime`, `browser/chatThreadService.ts`, `docs/integrations/agent-gateway.md`, `agent-runtime.md` |
| Policy engine, approvals | `common/policy`, `docs/integrations/mcp-and-policy.md`, `AGENTS.md` |
| Providers, model lists, settings state | `common/vaderSettingsTypes.ts`, `vaderSettingsService.ts`, `refreshModelService.ts`, `common/modelCapabilities.ts`, `vendorProviderData.ts`, `electron-main/llmMessage/` (`modelListing.ts`, `sendLLMMessage.impl.ts`), `docs/integrations/providers/` |
| Settings and onboarding UI (React) | `browser/react/src/vader-settings-tsx/Settings.tsx`, `vader-onboarding/VaderOnboarding.tsx`, chat in `browser/react/src/` |
| External coding agents | `common/externalAgents`, `common/externalAgent`, `docs/integrations/external-agents.md`, `external-agent-adapter.md` |
| Brand assets | `brand/`, `build/lib/vader/make_brand_assets.py` |
| Tests | `src/vs/workbench/contrib/vader/test/` (Node suites, `e2e/` real-app suite and scenarios) |
| Repo settings the owner must click | `docs/REPOSITORY_SETUP.md` |

## 12. How to work with this owner

- They answer in Arabic and expect Arabic back. They are decisive and want results, not options lists; recommend one path and say why.
- They dislike silence on long jobs: say in a line what you are doing, then continue. They also dislike being told something works without proof: run it, or say it was not run.
- They push back with specifics from the real installed app (screenshots, what they saw). Treat those as ground truth, reproduce, fix, and re-test; do not argue from the code.
- They care about the result being comparable to commercial tools (Cursor, Claude Code, Codex) and about not carrying hard-coded data that goes stale (model lists, versions).
- They watch cost and limits of the cloud session; a local session with the same context is why this file exists. Keep their time: batch questions, do not ask what the code or this file can answer.
- When something could weaken a security setting, say so plainly and get their explicit yes before changing it; they have given it for the signature default only.
- Do not create pull requests unless asked; work on `main` as above. Commit messages end with the project's attribution lines when your environment provides them.
