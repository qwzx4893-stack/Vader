# Vader: product assessment and validation plan

Written 2026-10-06 against branch `upgrade/vscode-1.136.2` (commit `1bdf86c`). Two parts: where Vader stands against comparable products, and how
companies validate that an AI coding product is fit for daily use, mapped onto what Vader has and lacks.

Evidence tags: **[measured]** counted or run in this repository or in CI; **[source]** taken from a web source (linked, mostly secondary
comparison sites for competitors, so read competitor rows as indicative); **[not measured]** nobody has checked it yet.

## 1. What Vader is today

| Item | Value |
|---|---|
| Base | VS Code 1.136.2, Electron 42.11.10 **[measured]** |
| Vader's own code | 153 TypeScript/TSX files, about 40,500 lines (generated model data excluded) **[measured]** |
| Agent loop | `@cline/agents` 0.0.90 behind Vader's own gate (policy engine, approvals, agent scoping) **[measured]** |
| Built-in tools | 37: files, search, terminal and persistent terminals, browser (Playwright, 15 tools), verification, MCP/skill discovery, agents and sub-agents **[measured]** |
| Providers | hosted and local providers, curated model lists that turn into live lists when a key works; real-SDK wire tests 45/45 **[measured]** |
| Agent features | hard policy engine with non-disableable rules, permanent agents, sub-agent delegation, plan mode, checkpoints, verification pipeline, memory/compaction, model router, marketplace (extensions, MCP, SkillNet, ACP adapter) **[measured: exist and are tested at the feature level; depth per `docs/integrations/*`]** |
| Tests | 33 Node-level test files and a real-app suite of 9 scenario groups (about 51 scenarios, 172 checks) that drives the packaged Windows app, including a run against a real (small) local model **[measured]** |
| Security | CodeQL 0, Semgrep 0, zizmor 0 high/medium, shipped-dependency gate, secrets history scan triaged **[measured]** |
| Privacy | Electron and agent browser contact no Google host on their own except two documented residuals **[measured]** |
| CI | Security Scan, CI, Windows Build, Windows E2E, Windows Smoke all green on the latest commit **[measured]** |

## 2. Comparison with similar products

| Product (kind) | What it is | What it has that Vader does not |
|---|---|---|
| Cursor (closed, VS Code fork) | paid editor; Composer agent mode; Supermaven-based autocomplete **[source]** | tuned autocomplete/next-edit models, background agents, online A/B evaluation on real usage, signed auto-updating installers on all platforms, accounts/teams/billing |
| Windsurf (closed, VS Code fork) | paid editor; fast context retrieval ("SWE-grep") **[source]** | trained retrieval model, same distribution machinery |
| GitHub Copilot (closed) | extension plus agent | enterprise controls, huge usage-driven tuning |
| Claude Code (closed CLI) | terminal agent | benchmarked on Terminal-Bench by its vendor **[source]**; hooks/sub-agents are comparable to Vader's, quality is measured and Vader's is not |
| Cline (open source) | VS Code/JetBrains/CLI agent, bring-your-own-key **[source]** | its own real-task benchmark (cline-bench) and eval harness **[source]**, large user base |
| Roo Code / Kilo Code (open source) | modes (Architect, Code, Debug), agent manager, autocomplete **[source]** | Aider/Exercism-based eval repository **[source]**, large user base |
| Continue (open source) | model-agnostic; AI checks as GitHub status checks in CI **[source]** | CI-side agent checks |
| Zed (open source editor) | native, fast; AI less deep **[source]** | native performance |
| Void (open source, Vader's origin) | VS Code fork with agent | Vader replaced its agent core, added policy, privacy, security and tests |

Where Vader is ahead of the open-source field: a locked policy engine that sits before the approval UI, persistent agents and sub-agents with
scoped permissions, a verification pipeline, a documented and tested privacy posture, a security scan with zero findings in its own code,
and a test suite that drives the real packaged app. Where it is level: bring-your-own-key provider breadth, MCP, checkpoints, plan mode.

## 3. Gaps that keep Vader below "professional product" (most important first)

1. **Agent quality is not measured.** Every competitor in the table publishes or runs task-success evaluations. Vader's suite proves the
   plumbing works (tools run, policy blocks, UI renders) with a scripted model and a 1.5B local model; it cannot say "X% of real coding
   tasks succeed with model Y". Until it can, nobody, including us, knows whether the product is good, only that it is not broken. **[not measured]**
2. **No distribution path.** Builds are unsigned, Windows is the only platform built in CI, there is no update URL in `product.json`, so a
   security fix cannot reach an installed copy. Signed, auto-updating, staged installers are the baseline of every product above. **[measured: absent]**
3. **No field health signal.** Telemetry is disabled by design (right for privacy) but that leaves no crash-free-session figure, so a bad
   release is found by user complaints. An opt-in, local-first crash report fixes this without breaking the privacy posture. **[measured: absent]**
4. **Autocomplete and retrieval quality unmeasured.** The features exist; there is no latency, acceptance or relevance measurement. **[not measured]**
5. **Long-session reliability with strong models** (hours, hundreds of tool calls, context compaction under load) has only been soaked with
   scripted models. **[not measured]**
6. **macOS and Linux installers** are not produced or tested in CI. **[measured: absent]**
7. Startup time, memory growth and accessibility have no numbers. **[not measured]**

Verdict: a strong open-source-class agent platform with unusually good security, privacy and test hygiene for its size. It is not yet a
product that can honestly be called "professional-grade" because of gaps 1 to 3, which are about proof and delivery, not features.

## 4. How companies validate this kind of product

- **Layered evaluation ("Swiss cheese").** Anthropic's guidance: automated evals on every commit, A/B tests once there is traffic, production
  monitoring for drift, weekly human review of transcripts; no single layer catches everything.
  ([Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents))
- **Two kinds of eval.** Capability evals start at a low pass rate and give something to improve; regression evals should sit near 100%
  and protect what already works. Start with 20 to 50 tasks taken from real failures. Grade outcomes (tests pass, files in the expected
  state), not the order of tool calls. Two experts must agree on pass/fail; isolate each trial; read transcripts; watch for saturation. (same source)
- **pass@k and pass^k.** pass@k = at least one success in k tries; pass^k = all k succeed. For a product users rely on, consistency (pass^k) is the honest number. (same source)
- **Real-task benchmarks.** SWE-bench family for repository issues; Terminal-Bench 2.0 for command-line work: 89 tasks, each a Docker image
  plus a pytest verifier, run through the Harbor harness; completion is decided only by tests on the final container state.
  ([overview](https://snorkel.ai/agentic-coding-benchmarks/), [Terminal-Bench](https://arxiv.org/pdf/2601.11868))
- **Your own benchmark from real sessions.** Cursor builds CursorBench from its engineers' real sessions and checks that offline rankings
  predict online results; online it A/B-tests harness variants and tracks what fraction of proposed code is still in the codebase later.
  ([Cursor](https://cursor.com/blog/cursorbench), found via search; the page itself was not reachable from the sandbox)
  Cline did the same with [cline-bench](https://cline.bot/blog/cline-bench-initiative); Roo Code uses [Exercism-based exercises](https://github.com/RooCodeInc/Roo-Code-Evals).
- **Test the harness, not just the model.** Results shift with the scaffold, so the product as shipped must be what is measured.
  ([The Scaffold Effect in Coding Agents](https://arxiv.org/pdf/2607.22585))
- **Release engineering.** VS Code: monthly iterations, an endgame week with a test plan, smoke tests on the release build, an Insiders channel
  for early users. ([release process](https://github.com/microsoft/vscode/wiki/Release-Process)) Electron apps: staged rollout (internal plus about 5%,
  then 20%, then everyone), gate each step on crash-free sessions (about 99.5% or better) and watch auto-update success.
  ([Sentry release health](https://docs.sentry.io/product/releases/health/))
- **Standards as CI checks.** Continue runs agent-based checks on every pull request as status checks. ([Continue](https://github.com/devYRPauli/continue))

## 5. Vader mapped to those practices

| Practice | Vader today |
|---|---|
| Deterministic regression suite on every commit | done: 33 Node tests, scripted-model real-app suite, CodeQL/Semgrep |
| Real-app end to end on the shipped binary | done: Windows E2E and smoke |
| Real-model run | partial: one small local model; no strong-model result |
| Capability evals with real tasks and test-based graders | **missing** |
| pass@k / pass^k reporting | **missing** |
| Benchmark from real sessions | **missing** (needs dogfooding first) |
| Public benchmark number (Terminal-Bench / SWE-bench subset) | **missing** |
| Long-session soak with a strong model | **missing** |
| Staged rollout, signed installers, auto-update | **missing** |
| Field crash-free rate | **missing** |
| Insiders/dogfood ring | **missing** |

## 6. Plan to close the gaps

1. **Vader-Bench, tier 1 (about 40 tasks).** Real coding tasks in throwaway workspaces (bug fixes, small features, refactors, repo
   questions, a few terminal tasks), each with a reference solution and a pytest/unit-test grader plus a state check, run through the
   packaged app by the existing E2E harness against a strong model. Report pass@1 and pass^3, tool calls, tokens, time, policy blocks
   and approval requests. Keep the tasks that fail as capability evals; those that pass become regression evals. Needs: a provider key and a spend limit.
2. **Public anchor.** Run a subset of Terminal-Bench 2.0 tasks through an adapter so Vader has one number comparable to Claude Code and
   others. Needs: Docker on the runner.
3. **Soak.** 4 to 8 hour sessions with a strong model, tracking memory, event-loop lag and compaction correctness.
4. **Distribution.** Code-signing certificate, update server (GitHub Releases is enough), an Insiders channel, staged rollout, macOS and
   Linux builds in CI. Needs: a certificate and a decision on hosting.
5. **Field health.** Opt-in crash reports and a local-only "copy diagnostics" button; crash-free sessions as the rollout gate.
6. **Dogfood.** Use Vader for Vader's own development; every failure becomes a task in Vader-Bench.
