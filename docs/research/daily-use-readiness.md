# What Vader still needs to be a tool you can rely on every day (2026-10-13)

Written after the engine review (`agent-engine-assessment.md`) and the fixes that followed it. The question: what separates Vader today from a tool a person can open every morning
and use to build real projects, ordinary or important? Evidence tags: **[verified]** run or measured here, **[code]** read in the code, **[source]** from a public source, **[not measured]**.

## Verdict

Vader is a well-built, unusually careful agent platform inside a real editor, with the strongest safety and privacy design of the open projects compared, and a test suite that drives the
packaged app. It is **not yet a tool whose output quality anyone has measured**, it has **no way to reach a user's machine safely after the first install** (no signing, no updates, no
crash signal), and a few things a daily user meets in the first week are missing (cost visibility, image input, web lookup, a terminal sandbox). None of this is a design flaw; each item
below is a bounded piece of work. The order matters: proof first, then delivery, then the daily-use gaps.

**Can it build real projects today?** With a strong model, for small and medium projects, probably yes, with the person reviewing the diffs (which the editor makes easy): the loop,
edits, context handling, checkpoints and policy gate are sound **[code][verified by tests]**. For projects where a wrong change is expensive, not yet: nobody has measured how often it
finishes a task correctly, and the terminal is not sandboxed.

## What is already strong (and verified)

- **Governance:** a locked policy tier that runs before the approval prompt and cannot be switched off; path rules that also read terminal commands; 4,000-spelling path fuzz with 0 bypasses; untrusted text (project rules, memory, pages) framed as data **[verified]**.
- **Loop robustness (after today):** three loop guards (identical calls, alternating calls, repeated text), a turn cap of 100 with a plain message, one context budget (prune, summarise, cut) that never lets the blind cut run first in a 600-step simulation, edits that land on the exact characters and fail loudly when ambiguous, unknown model names that get native tools with an XML fallback **[verified by tests, not by a model]**.
- **Context tools:** `repo_map` (ranked map of 14 languages, 80 ms on Vader's own 216 files), `update_task_list`, sub-agents with worktree isolation, an independent verification agent **[verified by tests]**.
- **Reach:** 48 providers with live model lists, every gateway probed against the real server on 2026-10-13 (Hyperbolic found retired and removed), 8 coding agents over ACP checked against the live registry **[verified]**; a model picker that groups providers with their real logos **[verified on a rendered preview, not in the app]**.
- **Hygiene:** about 30 Node-level suites in CI, a packaged-app suite on Windows (91 scenarios at the last full run), security scans at zero in Vader's own code **[verified earlier]**.

## What is missing, most important first

### 1. Proof that it finishes tasks (the largest gap; blocks every claim about quality)

- Nothing has measured task success with a strong model. One 21-exercise sample with a free model exists (`docs/integrations/agent-benchmark.md`). The A/B of the new instructions, and of every change made today, is waiting for model quota. **[not measured]**
- Needed: the polyglot benchmark through the real app, 60+ exercises, tests hidden, a model with a published Aider score, pass@1 and pass^3, before and after each change; then a second, harder set (SWE-bench-style repository issues, or Terminal-Bench through Harbor). Needs: an API key with a spending cap (about 10 to 30 USD for a first publishable number), Docker.
- Dogfood loop: use Vader to develop Vader for two weeks; every failed task becomes a benchmark task.

### 2. Delivery: how a fix reaches a person

- The installer is **unsigned** (Windows SmartScreen warns every first-time user), there is **no auto-update** (a security fix cannot reach an installed copy; the app only compares its version with the latest GitHub release), **Windows only**, no crash reporting, no field signal at all **[code]**.
- Needed: a code-signing certificate (an owner decision and cost), an update feed (GitHub Releases is enough), a staged channel, opt-in local-first crash reports with a "copy diagnostics" button. macOS and Linux builds in CI once Windows is stable.
- Fork maintenance is the hidden long-term cost: the base is VS Code 1.136, which moves monthly. The last upgrade (1.99 to 1.136) took a session of its own. A written policy (upgrade every quarter, on a branch, with the packaged-app suite as the gate) keeps this from becoming the thing that kills the project.

### 3. Things a daily user meets in the first week

| Gap | Why it matters | Size |
|---|---|---|
| **No cost or token display.** The app shows no usage per chat or per day **[code]** | people on paid keys will not trust what they cannot see; also the cheapest way to notice a runaway loop | small to medium: the providers already return usage; show it per thread and a daily total |
| **No image input in the chat** (paste a screenshot, a design, an error) | a large part of building UIs; today only a narrow screenshot-analysis tool exists | medium: a persisted-format change, so it needs care (optional field) |
| **No web search or fetch tool** for the agent (only a Playwright browser with URL policy) | looking up a library's current API is the second most common thing an agent does | small: a read-only `fetch_url` through the existing URL policy, and optional search through a user-provided key |
| **No terminal sandbox**: the policy is a regex over a shell string; indirection evades it **[verified]** | the one real hole left for a prompt-injected agent in autonomous mode | large: a container or WSL option first (cheap), a Windows sandbox only as a product decision (Codex's is 21,000 lines of Rust) |
| **Terminal changes are not checkpointed** (only the agent's file edits are) | `rm` or a formatter run in the terminal cannot be undone from the chat | medium: shadow-git checkpoints (Cline and Roo have them) |
| **Autocomplete is a 948-line service** against Continue's roughly 13,700 lines | the feature people use most hours per day; unmeasured | measure first (acceptance rate, latency), then borrow stages |
| **Reasoning-mode fidelity:** Anthropic's signed thinking blocks are not replayed in the Cline-driven turns (documented) | worse results with extended thinking on long tool chains | medium |
| **OpenAI's newest agentic models** are reached through chat completions; some (the Codex family) are Responses-API only | a provider that cannot use the vendor's best coding models | medium: a Responses-API path for OpenAI |

### 4. Engine items still open (from the review)

Model-based edit repair (not now), `apply_patch` for OpenAI-family models (after the benchmark), a content-aware read of very large files, a diff-aware compaction summary (today the
summary is generic), and the loop itself being `@cline/agents` 0.0.90, a pre-1.0 SDK pinned exactly: every upgrade needs the typings test and the packaged-app suite.

### 5. Process and honesty items

- **Nothing from today has been seen in a rebuilt app.** The unit-level tests pass; the packaged-app scenarios for the new tools, the unknown-model fallback and the picker have not run. A validation build (`publish=false`) and the Windows E2E are the next gate, and they need the owner's approval.
- The picker and the AGENTS.md support are untested with real data in the app; the model picker was judged on a rendered preview only.
- Known data limits: the model catalogue in `modelCapabilities.ts` describes models (window, price, tools) and goes stale; providers without a list route (Perplexity) ask for a model name.

## Suggested order

1. **This week:** validation build and Windows E2E of everything so far; then the benchmark A/B (needs a key with a cap). Decide on code signing.
2. **Next:** cost and token display, `fetch_url`, image input. These are what a person notices first.
3. **Then:** update feed and crash opt-in; shadow-git checkpoints; container option for the terminal.
4. **Then:** autocomplete measurement; Responses-API path; a second benchmark; the quarterly upgrade policy.

## What only the owner can decide or provide

An API key with a spending limit for the benchmark; approval for each Windows build and for publishing; whether to buy a code-signing certificate; whether the terminal sandbox is worth its installer cost; the repository settings listed in `docs/REPOSITORY_SETUP.md`.
