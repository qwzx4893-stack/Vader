# What could be taken from other open-source projects, and what must not be (2026-10-13)

## The licence rule

Vader's own licence is Apache-2.0 (`LICENSE.txt`; the editor base is MIT). Code under **Apache-2.0** and **MIT** can be used if the licence text and copyright notice stay with the copied files
(Apache-2.0 also asks that a `NOTICE` file be carried on and that changed files say they were changed). Each candidate below was checked against the LICENSE file of its repository, not against its reputation.

Not to be copied from, whatever their usefulness:
- **Closed products** (Cursor, Windsurf, Claude Code, Antigravity, Copilot): proprietary; their terms forbid reverse engineering and extraction of internals, and code or prompts taken from them would put Vader at legal risk.
  Their public documentation and the prompt-writing guidance their makers publish are fair sources of ideas, and that is all that was used.
- **Zed** (its repository root holds `LICENSE-GPL` and `LICENSE-APACHE`, and licences differ crate by crate): the editor itself is copyleft, which cannot be copied into Vader. A single Apache crate could be used only after reading that crate's own licence.
- **OpenHands' `enterprise/` folder** and any folder with its own licence file: source-available terms. Take only what the root MIT licence covers.
- Anything vendored inside a project with its own third-party licence: check the subfolder before copying.

A reimplementation of an idea (an algorithm described in a paper or a README) needs no licence, only care that it is written fresh; copying code needs the notices. Where a candidate says "reimplement", that is the intent.

## Candidates, ranked by value for the cost and risk

| # | What | From (licence) | Where | What it gives | Effort | Risk | Recommendation |
|---|---|---|---|---|---|---|---|
| 1 | Prune old tool outputs before summarising | opencode lineage via Kilo (MIT) | `packages/opencode/src/session/compaction.ts` (`PRUNE_PROTECT` 40,000, `PRUNE_MINIMUM` 20,000) | cheaper long sessions and less summary loss; deterministic, no model call | small (reimplement; about 100 lines) | low; test with a real long thread | **do first** |
| 2 | Content-repetition detector | Gemini CLI (Apache-2.0) | `packages/core/src/services/loopDetectionService.ts` (50-character chunks, threshold 10) | stops a model that repeats text endlessly (common with small local models); not covered by the call-based guards | small (reimplement the chunk-hash idea) | low | **do** |
| 3 | A task list tool (create, update, show in the chat) | opencode (MIT; readable in Kilo's copy), Roo (Apache-2.0), Codex `update_plan` (Apache-2.0) | `packages/opencode/src/tool/todo.ts` with its prompt `todowrite.txt`; `update_todo_list` in Roo's `src/shared/tools.ts` | coherence on long tasks; the user sees progress | medium (a tool, a state field on the thread, a small React view) | low; the persisted thread format must stay compatible (optional field) | **do** after the A/B |
| 4 | Repo map | Aider (Apache-2.0) | `aider/repomap.py`: tree-sitter definitions and references, PageRank, token budget | the model sees the shape of a large repository without reading it | medium to large; the parser is already in the base (`@vscode/tree-sitter-wasm`); the algorithm is reimplemented in TypeScript | medium: language coverage and speed on big repositories; build it behind a setting | **do**, behind a setting, measured on a large repository |
| 5 | Conservative edit matching | opencode lineage (MIT), Roo (Apache-2.0) | `tool/edit.ts` (line-trimmed, indentation-flexible, whitespace-normalised, escape-normalised, trimmed-boundary replacers) | fewer "text not found" failures: 2 of 63 edits in Vader's own runs | small (the replacers are short pure functions) | **medium: loose matching edits the wrong place; upstream opencode abandoned the cascade.** Take only the strict replacers, require a unique match, never the Levenshtein anchor, and the user still sees the diff | optional; modest gain |
| 6 | `apply_patch` for OpenAI-family models | Cline SDK (Apache-2.0) | `sdk/packages/core/src/extensions/tools/executors/apply-patch-parser.ts` (520 lines TypeScript) | the format OpenAI's models are trained on; fewer failed edits for them | medium (a second edit tool, chosen per model) | low for the code, medium for behaviour: only worth it after measuring GPT-family results | wait for the measurement |
| 7 | Autocomplete pipeline | Continue (Apache-2.0) | `core/autocomplete` (about 13,700 lines: prefilter, snippets, filtering, post-processing, classification) | the likely largest quality gap of the editor | large; the code is tied to Continue's own interfaces | high: take ideas stage by stage, never the whole; measure first | **measure Vader's completion first**, then borrow the stages that matter |
| 8 | Repair of a failed edit by a model | Gemini CLI (Apache-2.0) | `packages/core/src/utils/llm-edit-fixer.ts` (`FixLLMEditWithInstruction`, used by `tools/edit.ts`) | recovers edits that do not match | small to medium | costs tokens; hides model errors | not now |
| 9 | Windows sandbox for the terminal | Codex (Apache-2.0) | `codex-rs/windows-sandbox-rs` (over 21,000 lines of Rust: dedicated users, ACLs, firewall rules, elevation) | the real fix for the gap that no regex over a shell string can close | very large: a Rust build in the pipeline, an elevated installer step, a service | high: it changes how the product installs; Windows-only | **not now**; a product decision. Cheaper steps first: run the terminal with a scrubbed environment, offer a container or WSL option |
| 10 | Shadow-git checkpoints | Cline, Roo (Apache-2.0) | Roo `src/services/checkpoints/RepoPerTaskCheckpointService.ts`; Cline `sdk/packages/core/src/session/checkpoint-restore.ts` | restores terminal-made changes too, not only the agent's file edits | medium | medium: it writes a hidden repository next to the project | not now |

## What was looked at and left out

- **Goose** (Apache-2.0): MCP-first extension model; Vader already has MCP and a marketplace. Nothing to take.
- **Kilo Code** (MIT): a fork of Roo and opencode; useful only as the place where opencode's older code is still readable.
- **OpenHands** (MIT): its value is the Docker runtime and condensers; the runtime is a different product shape (server, not an editor).

## Rule for doing any of it

One candidate at a time; code in a separate commit with the licence header and the source file named; a test that fails without it; a measurement before and after on the same sample where behaviour changes (`polyglotBench.mjs`); and no
push or build without the owner's approval.
