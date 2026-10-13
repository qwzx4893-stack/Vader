# Vader's agent engine against the open-source ones (2026-10-13)

Method: the ten open-source projects below were cloned (depth 1, all on 2026-10-13) and searched for each mechanism with the same patterns; the implementations that matter were read.
Vader was searched the same way. Counts are files that mention the mechanism: a pointer to where to look, not a measure of quality. Nothing here comes from closed products: Cursor, Windsurf and
Claude Code are not open source, their internals were not examined, and the only things used from them are their public documentation and the public prompt-writing guidance their makers publish.

Projects (licence read from each repo's LICENSE file): Codex CLI, Cline, Roo Code, Continue, Aider, Gemini CLI, Goose (Apache-2.0); opencode, Kilo Code, OpenHands (MIT; OpenHands' `enterprise/` folder, if any, is excluded).

## Verdict

The loop is sound in design and strong where governance matters; it is average in robustness mechanisms, behind in context tooling, and its quality is still unmeasured.
1. **Strong, and unusual:** the policy engine runs before the approval prompt and cannot be turned off (no other project in this set has a locked tier); structured compaction that archives the raw
   messages to memory instead of discarding them, routed to a cheap model; an independent read-only verification agent with a bounded verify-repair loop; provider-agnostic (49 providers).
2. **Average:** loop guards (two now: identical calls in a row, and an alternating cycle), reasoning controls, subagents, plan mode.
3. **Behind:** no repo-wide code map, no pruning of old tool output before summarising, no task list for long jobs, edit matching is exact-then-whitespace-stripped, no content-repetition detection,
   autocomplete is one 948-line service where Continue's pipeline is about 13,700 lines, and the terminal has no sandbox.
4. **Risk to watch:** the loop itself is `@cline/agents` **0.0.90**, a pre-1.0 SDK, pinned exactly with a typings-drift test. It works, and every upgrade is a risk until it reaches 1.0.
5. **Unknown:** whether it is better or worse than these projects at finishing tasks. That needs the same benchmark run on the same model (`docs/integrations/agent-benchmark.md`); one 21-exercise sample is all there is.

## Mechanism by mechanism

| Mechanism | Vader | Best open-source reference (file in the 2026-10-13 clones) | Gap |
|---|---|---|---|
| Loop skeleton | `AgentRuntime` of `@cline/agents` 0.0.90, `maxIterations` 50, Vader's model adapter (`browser/agentRuntime/vaderAgentModel.ts`) | Codex `codex-rs/core`, opencode `session/` | none in design; SDK age is the risk |
| Loop detection | identical call 8 times in a row; a window of 20 calls with at most 4 distinct (`common/loopDetection.ts`, new) | Gemini CLI `packages/core/src/services/loopDetectionService.ts`: 5 identical tool calls; a 50-character chunk repeated 10 times ("chanting"); an LLM judge after 30 turns with a 0.9 confidence bar and a second model to double-check | no content-repetition detector (a cheap pure function); the LLM judge costs tokens |
| Provider retries | the SDKs' own (OpenAI/Anthropic: 2 retries with back-off, honouring `Retry-After`); an error class is passed to the runtime, no second layer (documented in `common/providerErrorTypes.ts`) | Codex and Goose have their own layers | acceptable; a rate-limited free tier shows it (a run needs a proxy that waits) |
| Context compaction | summary of the older messages in tagged sections, raw messages archived to memory, cheap model by the router, tail kept, best effort (`browser/chatThreadService.ts` `_maybeCompactThread`); size estimated from characters | opencode lineage (`kilocode/packages/opencode/src/session/compaction.ts`): **first prune old tool outputs** (keep the latest 40,000 tokens of them, only when 20,000 can be freed), then summarise | no deterministic pruning step; character-based estimate |
| Edit application | exact `indexOf`, then the same with all spaces and tabs removed; reports not found / not unique / overlap (`browser/editCodeService.ts` `findTextInCode`) | opencode (old lineage, still in Kilo) `tool/edit.ts`: eight replacers in a cascade, including a first-and-last-line anchor with Levenshtein similarity 0.65; Roo `core/diff/strategies/multi-search-replace.ts`: Levenshtein with a threshold; Gemini CLI: a model that repairs a failed edit (`packages/core/src/utils/llm-edit-fixer.ts`) | measured on Vader's own runs: 5 of 63 edit calls failed (3 format, 2 text not found). **Caution:** upstream opencode has since moved to exact + Unicode normalisation (`packages/core/src/tool/plugin/edit.ts`): loose matching applies edits in wrong places |
| Patch format | search/replace blocks | Codex `apply-patch` and Cline `sdk/packages/core/src/extensions/tools/executors/apply-patch-parser.ts` (520 lines TypeScript, Apache-2.0): OpenAI says its models are trained on it | worth it for OpenAI-family models, not for Claude |
| Repo-wide code context | Context Engine: outlines, diagnostics and git changes for files the user mentioned or has open | Aider `aider/repomap.py` (867 lines): tree-sitter definitions and references, a graph ranked with PageRank, fitted to a token budget; Continue has the same idea | missing; Vader's base ships `@vscode/tree-sitter-wasm`, so the parser is already in the app |
| Task list for long jobs | none (Plan mode produces a plan, nothing tracks it) | opencode `tool/todo.ts` (prompt `todowrite.txt`, in Kilo's copy), Roo `update_todo_list` (`src/shared/tools.ts`), Codex `update_plan` | missing |
| Subagents | `delegate_subagent_task`, parallel tasks with worktree isolation | opencode, Codex, Gemini CLI, Cline | on par |
| Permission model | locked deny tier + ask tier that survives autonomous mode (now also for terminal commands) | Codex `execpolicy`, Gemini CLI | ahead on locked rules; behind on enforcement (below) |
| Sandbox | none: the policy is a regex over a shell string | Codex `windows-sandbox-rs` (over 21,000 lines of Rust, needs elevation, dedicated users and firewall rules), `linux-sandbox`, Gemini CLI sandbox | the largest security gap; not a drop-in (see the integration list) |
| Autocomplete | `browser/autocompleteService.ts`, 948 lines | Continue `core/autocomplete` (about 13,700 lines): prefilter, snippet and import context, filtering, post-processing, classification | probably the biggest quality gap of the editor (not measured) |
| Reasoning controls | per-model capability table, effort or budget sliders | Codex, Cline | on par |
| Prompt caching | Anthropic requests (5 files) | Cline, Roo, opencode | partial |
| Instructions | rewritten 2026-10-13 from published guidance (`docs/integrations/agent-behavior.md`) | Codex's prompt, the guides of Anthropic and OpenAI | **not measured**; the old text was weaker than all of these |

## What was done about it (same day, after the review; every item in its own commit, none measured with a real model yet)

| Finding | Result | Where |
|---|---|---|
| (new, found by reading the code) the blind cut of oversized requests (120 characters per message) ran before the careful summary: it started at half of the window, the summary at 70% measured with tool results capped at 2,000 characters | one yardstick for prune, summarise and cut; simulated session: the old rules sent a request over the cut line in 71% to 98% of 600 steps, the new ones in 0 | `common/contextBudget.ts`, `test/contextBudgetE2E.mjs` |
| no pruning of old tool output | prune from 50% of the budget, no model call, the chat still shows the full result | same |
| no content-repetition detector | 50-character window repeated 12 times and a periodic tail; 0 false positives on 255 of Vader's own files | `common/loopDetection.ts` |
| (new) an exact edit match was not checked for uniqueness, and a match inside a line replaced the whole line | unique, exact-character replacement; one whitespace/typography-tolerant step on whole lines; marker variants (SEARCH/REPLACE ...) read | `common/editMatching.ts`, `test/editMatchingE2E.mjs` |
| unknown model names got XML tools | native tools first, XML fallback when the server refuses, remembered | `common/toolSupport.ts` |
| no task list | tool `update_task_list` | `common/taskList.ts` |
| no repo map | tool `repo_map` (line patterns, PageRank, budget) | `common/repoMap.ts` |
| (new) 50-turn cap ended long jobs with a bare SDK error | 100 turns, plain message, "continue" resumes | `common/loopDetection.ts` |

Not done, on purpose: the terminal sandbox (a product decision, see candidate 9), autocomplete (needs its own measurement first), a model-based edit repair (costs tokens and hides model errors), `apply_patch` for OpenAI-family models (wait for the benchmark), shadow-git checkpoints. Nothing above has been seen working in a rebuilt app: that needs a Windows build, which needs the owner's approval; the Windows E2E suite has the new scenarios.

## What follows from it

In order of value for the effort: (1) measure the new instructions (the A/B is built and waits for a quota); (2) tool-output pruning before compaction and a content-repetition detector (both small, pure, testable);
(3) a task list tool; (4) a repo map on the tree-sitter already in the app; (5) autocomplete, which needs its own measurement first; (6) a terminal sandbox, as a product decision. The candidates for taking code from
other projects, with licences and risks, are in `integration-candidates.md`.
