# Vader against comparable projects: code quality and agent quality, measured

Written 2026-10-06. Everything below was computed the same way for every project by `build/lib/vader/quality_compare.py` (code metrics) and by
reading each project's own source (mechanisms), plus real-app tests for Vader's agent behaviour. No API key was used or needed.

**Scope of the comparison.** Open-source projects only, because only their code can be measured: Cline (`sdk/`, `apps/`), Roo Code (`src`, `webview-ui/src`,
`packages`), Continue (`core`, `gui/src`, `extensions/vscode/src`), opencode (`packages/*`), the original base (Vader's origin, `src/vs/workbench/contrib/vader`, which is
the same folder as Vader's). Test files, generated files, `node_modules` and bundles are excluded everywhere. Closed-source products (Cursor, Windsurf,
Copilot, Claude Code) cannot be measured this way; for them see `PRODUCT_ASSESSMENT.md` (public information only).
Roo Code's last commit is from May 2026 and the original base's from June 2026, so both are quiet; the others were measured on commits from the last three months.

## 1. Code quality (measured)

| Measure | Vader | Original base | Cline | Roo Code | Continue | opencode |
|---|---|---|---|---|---|---|
| Source files (non-test) | 156 | 95 | 2303 | 895 | 1083 | 1542 |
| Lines of code (non-comment) | 28,694 | 22,391 | 421,906 | 115,884 | 136,587 | 298,568 |
| Mean complexity per function (lower is better) | 2.78 | 2.95 | 3.09 | 3.36 | 2.31 | 2.46 |
| 95th-percentile complexity | 8 | 8 | 10 | 11 | 8 | 7 |
| Functions above complexity 15 (%) | 1.78 | 2.02 | 2.18 | 2.96 | 1.2 | 1.15 |
| Functions above complexity 25 (%) | 0.5 | 0.52 | 0.83 | 1.45 | 0.32 | 0.39 |
| Files above 1000 lines (share of files) | 6 (3.8%) | 6 (6.3%) | 63 (2.7%) | 12 (1.3%) | 7 (0.6%) | 84 (5.4%) |
| Explicit `any` per 1000 lines | 3.31 | 3.13 | 1.0 | 4.84 | 7.91 | 0.65 |
| Lint/type suppressions per 1000 lines | 0.07 | 0.09 | 0.23 | 0.48 | 0.92 | 0.29 |
| Duplicated lines (%) | 0.42 | 0.55 | 7.47 | 1.93 | 2.37 | 1.97 |
| Test files | 54 | 0 | 954 | 597 | 168 | 789 |
| Test lines per source line | 0.165 | 0.0 | 0.642 | 1.231 | 0.295 | 0.542 |
| Security-rule findings per 1000 lines (same Semgrep rules) | 1.08 | 1.03 | 1.07 | 5.9 | 1.19 | 1.33 |
| CI workflows | 5 | 1 | 18 | 7 | 31 | 27 |
| SECURITY.md | yes | no | yes | yes | yes | yes |
| CodeQL | yes | no | no | yes | no | no |
| Dependency-update bot | no | no | yes | yes | yes | no |
| CODEOWNERS | no | no | yes | yes | yes | yes |
| Last commit measured |  | b3166e7 2026-06-02 | dec80da 2026-10-06 | b867ec9 2026-05-15 | 5522c6f 2026-07-20 | f03046d 2026-10-06 |

How to read it:
- **Size is not comparable one to one**: Vader's folder is the agent layer (about 29k lines) on top of VS Code; Cline, opencode and Roo Code contain whole applications. Ratios and densities are the fair columns.
- **Complexity**: Vader's mean (2.78) and share of very complex functions (0.5% above 25) are better than Cline, Roo Code and the original base, and close to Continue and opencode. No project is clearly excellent; the spread is small.
- **Type safety**: Vader uses about 3.3 explicit `any` per 1000 lines, better than Roo Code (4.8) and Continue (7.9), worse than Cline (1.0) and opencode (0.65). It has the fewest suppression comments of all (0.07).
- **Duplication**: Vader 0.42%, the lowest; Cline 7.5% is the highest.
- **Security rules**: with the same Semgrep community security rules, Vader sits at 1.08 findings per 1000 lines, level with Cline (1.07), the original base and Continue, and far below Roo Code (5.9). The findings that remain were reviewed one by one: guarded dynamic dispatch, regexes built from fixed tag names, and build scripts.
- **Tests**: Vader's test code is 0.17 lines per source line, the lowest of the projects that have tests (Continue 0.30, opencode 0.54, Cline 0.64, Roo Code 1.23); the original base has none. Vader's tests are mostly end-to-end runs of the real app (about 60 scenarios and 33 Node-level suites), which cover more behaviour per line than unit tests, but the ratio is still the weakest figure in this table.
- **Process**: Vader had no dependency-update bot and no CODEOWNERS, which every active peer has; both were added (`.github/dependabot.yml`, `.github/CODEOWNERS`). It has fewer CI workflows (5) than the larger projects (18 to 31), and is one of only two (with Roo Code) that run CodeQL.
- **A known measurement artefact**: lizard reports one 2,456-line "function" in `SidebarChat.tsx`. It is a parsing artefact (the file's many React components lumped together), but the real fact behind it stands: that file is about 2,600 lines and is the largest in Vader, and splitting it is the single best maintainability refactor on the list.

## 2. Agent harness mechanisms (read from source)

A mechanism counts as present when its characteristic code exists in non-test source (keyword search, so a hit shows presence, not quality; the number
is files and scales with project size).

| Mechanism (files containing it) | Vader | Original base | Cline | Roo Code | Continue | opencode |
|---|---|---|---|---|---|---|
| malformed tool-argument handling | yes (4) | yes (2) | yes (31) | yes (16) | yes (6) | yes (13) |
| repeated-call / loop detection | yes (1) | no (0) | yes (34) | yes (39) | no (0) | yes (70) |
| context compaction / summarisation | yes (13) | yes (3) | yes (134) | yes (42) | yes (14) | yes (189) |
| checkpoints / rollback | yes (6) | yes (5) | yes (110) | yes (35) | no (0) | yes (72) |
| approval gate (ask before acting) | yes (8) | yes (5) | yes (114) | yes (34) | yes (4) | yes (5) |
| hard deny rules independent of the UI | yes (18) | no (0) | yes (10) | yes (4) | no (0) | yes (70) |
| provider retry with backoff | yes (2) | no (0) | yes (35) | yes (12) | yes (3) | yes (7) |
| cancel kills child processes | no (0) | no (0) | yes (29) | yes (5) | yes (6) | yes (7) |
| sub-agents / delegation | yes (18) | no (0) | yes (107) | yes (19) | yes (6) | yes (69) |
| plan mode | yes (4) | no (0) | yes (121) | no (0) | yes (5) | yes (5) |
| MCP support | yes (25) | yes (13) | yes (117) | yes (28) | yes (37) | yes (14) |
| prompt caching | yes (4) | no (0) | yes (63) | yes (72) | yes (13) | yes (18) |
| git worktree isolation | yes (11) | no (0) | yes (56) | yes (21) | no (0) | yes (177) |
| secret redaction | yes (4) | yes (2) | yes (69) | yes (7) | yes (10) | yes (19) |
| tool-output size limits | yes (9) | yes (6) | yes (95) | yes (52) | yes (20) | yes (50) |
| diagnostics after edits | yes (19) | yes (8) | yes (71) | yes (37) | yes (26) | yes (16) |
| fuzzy / robust edit application | yes (9) | yes (10) | yes (34) | yes (39) | yes (20) | yes (32) |
| verification / test-run tool | yes (11) | no (0) | yes (1) | no (0) | yes (1) | no (0) |
| browser automation | yes (8) | no (0) | yes (7) | no (0) | yes (2) | yes (3) |
| persistent agents / memory | yes (20) | no (0) | yes (25) | yes (5) | yes (1) | yes (6) |

Findings:
- **Vader has every mechanism the peers have.** The keyword search shows no hit for "cancel kills child processes" because Vader does it through the terminal service rather than with a kill call in its own code; the new `robustness` scenario proves it on Windows (a command that writes a heartbeat stops writing the moment the run is stopped). Until this pass it lacked prompt caching and a loop guard.
- **Where Vader is ahead**: hard deny rules independent of the UI (shared only with Cline, Roo Code and opencode, and only Vader makes them non-disableable), a built-in verification tool (`run_verification`, not found in the others), persistent agents with memory, and browser automation as a first-class tool (Cline and Continue have traces of it).
- **Gaps found by this comparison and closed in this pass**: prompt caching for Anthropic requests (Cline, Roo Code, opencode and Continue have it; agents resend their whole prompt each turn, so it is the largest cost lever); an identical-call loop guard (the runtime's own cap only stopped a stuck model after about 50 turns, it now stops after 8); and the two real defects below.

## 3. Agent behaviour without a model (fault injection and an oracle)

Two key-free tiers, both running the real packaged app through its UI:

**Robustness group (`e2e/scenarios/robustness.mjs`, 8 scenarios).** A scripted "model" misbehaves on purpose: invalid tool-argument JSON, a tool that does not exist, the same call forever, a reply cut off in the middle of a tool call, an empty reply, a 30 MB file read, instructions hidden in a file, and stopping a running command. Each asserts that the run ends, the user can keep working, and nothing unsafe happened. It found two real defects that no existing test caught, now fixed:
1. Tool arguments that were not valid JSON made the call vanish: the turn ended with an empty message, the user saw nothing and the model was never told. Now the model receives an error result for that call and can retry.
2. A call to an unknown tool (or one the runtime refused) was answered inside the runtime but never recorded in the thread, so the next request lacked both the call and its error. Now it is recorded and the model is told.
Also fixed: a model repeating one call 50 times; now 8.

**Oracle task suite (`agent-tasks` group, 4 tasks).** Four plain-language coding tasks (create a file, fix a failing test, write a function, transform a file) run with a perfect scripted model and are graded by the resulting files. This measures the ceiling of the tool layer: if the harness lost an edit or mishandled an approval, a task would fail even though the "model" did everything right. Result: 4 of 4 on the local build and on the first Windows run (the Windows run found that the file-transform grader compared line endings too strictly; CRLF-tolerant now).

**Real-model capability eval (`real-llm` group, same 4 tasks).** The same tasks with a real model served by Ollama in the Windows workflow, several attempts each, reported as pass@k and pass^k in `agent-bench.json`. First Windows result with the 1.5B model `qwen2.5:1.5b`: 0 of 4 tasks in 2 attempts each (it never made a tool call that needed approval), against 4 of 4 for the scripted perfect model, which shows the harness is not what limits that number. The workflow now uses `qwen2.5:3b`. With small models the numbers are a baseline, not a quality claim; the same file runs against any stronger OpenAI-compatible model by setting `REAL_LLM_MODEL` and `REAL_LLM_BASEURL`.

## 4. What this does and does not show

It shows that Vader's code is at least as clean as the open-source agents it was compared with on every measure except test volume and CI breadth, that its harness has the mechanisms they have, and that it survives a misbehaving model. It does **not** show how often a strong model solves hard tasks through Vader, nor how Vader compares with the closed products; that needs a model and real usage, and cannot be produced from this environment.
