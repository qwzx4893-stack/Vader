# Measuring the agent: Aider polyglot through the real app

What this measures, how to run it, and how far the numbers can be trusted. Written 2026-10-13 with the first results.

## Why this benchmark

Cursor, Windsurf and Cline do not publish a standard score for their editors; they publish private benchmarks (CursorBench) or model scores on public ones. The only open,
per-model public leaderboard that an editor can be set beside is **Aider's polyglot benchmark**: 225 Exercism exercises (C++, Go, Java, JavaScript, Python, Rust), two attempts
each, the second one with the failing test output. Running the same exercises through Vader gives a number that can be compared with the published figure for the same model.

## What was built (all under `src/vs/workbench/contrib/vader/test/e2e/`)

| File | Purpose |
|---|---|
| `polyglotBench.mjs` | Drives the REAL packaged app through the exercises; grades by the tests on the final files in Docker; resumable; `POLY_SHARD=i/N` runs several app windows side by side |
| `polyglotOracle.mjs` | Grades every exercise with its reference solution: the ceiling of the grader (210/225 first, Java fixed after: only 9 cannot pass: 6 Rust references need crates the instructions forbid, 3 C++ test files do not compile with Ubuntu 22.04's compiler, as in Aider's own image) |
| `llmProxy.mjs` | Local OpenAI-compatible proxy in front of OpenRouter: real cost and tokens per request, a hard budget (never spends past it), no retry on the daily free quota, 429 back-off |
| `polyglot-grader/Dockerfile` (+ the two test scripts) | Aider's toolchains without the aider package; Jest pinned to 29.7.0 (Jest 30 removed `toThrowError`) |

Protocol details that matter for comparability: tests are put back before grading; `CMakeLists.txt` and `Cargo.toml` are restored (Aider never lets the model touch them);
`.meta` (reference solution) and `.docs` are removed from the workspace; **`POLY_HIDE_TESTS` (default on) takes the test files out of the workspace while the agent works**,
because Aider's model never sees them; `POLY_MODE=edit-only` (default) approves file edits and rejects every command the agent asks to run, as Aider's model cannot run code
(the benchmark machine is Windows without C++/Go/Rust/Java toolchains; with commands allowed the agent loops until the time limit).

## First results (honest reading)

Model `poolside/laguna-s-2.1` through the app configured as `gpt-4o` (see "model name" below), tests VISIBLE to the agent, edit-only mode:
33 valid trials on 22 distinct exercises: 79% on the first attempt, 91% within two (95% interval 76-97%). **Not comparable with Aider's leaderboard**: the agent read the tests in
24 of 29 attempts. With the tests hidden (7 trials on 7 exercises, chosen among earlier passes): 5 of 7. The samples are far too small for a verdict; they show the method works and
where the defects are. Repeating the same exercise gave a different outcome in 2 of 11 cases: single runs are noisy, report pass^k.

Invalid trials are dropped: in 8 records no request reached the run's proxy because two parallel runs picked the same debugging port and one attached to the other's window
(fixed: a free port is checked before launching).

## Defects the runs exposed (and what was done)

| Finding | Evidence | Status |
|---|---|---|
| A model name Vader does not know, on the OpenAI-compatible provider, gets XML tool calls in text; weak models then answer with JSON text and nothing runs | the same model failed twice that way and passed with a known name | fixed: native tools first, XML when the server refuses them, remembered (`common/toolSupport.ts`); not yet re-measured |
| Loop that alternates between a few calls (`cd build`, `cmake ..`, `cd ..`...) was never caught by the "same call 8 times" guard | run stuck until the time limit | fixed: `common/loopDetection.ts`, 20 calls with at most 4 distinct |
| File argument written as `path`/`file_path` fails with "Provided uri must be a string" | 4 occurrences | fixed: `common/toolArgAliases.ts` |
| Call to a non-existent tool (`shell`, 11 times) answered with "Unknown tool", shown as an MCP call | transcripts | fixed: `common/toolNameHints.ts` (lists the real tools and the one meant) |
| `&&` is not valid in Windows PowerShell 5.1, the default shell | transcripts | fixed earlier by the shell hint in the system prompt (`prompts.ts`); not re-measured |
| `Edit file ... No Search/Replace blocks were received` | recurring | fixed: marker variants are read (`common/editMatching.ts`); not re-measured |

The fixes are covered by `test/agentRobustnessE2E.mjs` (30 checks, run in CI) and type-check clean in `contrib/vader`. They have NOT been seen working inside a rebuilt app: that needs a Windows build.

## Running it

```
set VADER_EXE=...\Vader.exe  PW_CORE=...\playwright-core  POLYGLOT_DIR=...\polyglot-benchmark  E2E_OUT=...
set OPENROUTER_API_KEY=...  POLY_MODEL=<openrouter id>  POLY_BUDGET_USD=0.5  POLY_COUNT=60
node src/vs/workbench/contrib/vader/test/e2e/polyglotBench.mjs
```

Keep the key in the environment only; never in a file or a workflow.

## What still has to happen for a publishable number

A model that has a published Aider score (for example DeepSeek-V3.2-Exp), the full 225 or a stratified 60+, tests hidden, several runs for pass^k, and the grader's 9 unsolvable
exercises left in the denominator as Aider does. The free OpenRouter quota (1000 requests a day) and a small paid credit are the limit, not the tooling.
