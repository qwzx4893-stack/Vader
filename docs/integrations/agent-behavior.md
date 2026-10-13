# How the agent is told to behave, and why

The agent's instructions are in `src/vs/workbench/contrib/vader/common/prompt/agentBehavior.ts` (the behaviour sections), assembled by `chat_systemMessage` in `prompts.ts`, next to the tool
descriptions (`builtinTools` in the same file). Rewritten 2026-10-13: the old text was a flat list of "Important notes" inherited from the upstream project.

## What it was built from (primary sources, read in full on 2026-10-13)

| Source | What was taken |
|---|---|
| [OpenAI, Codex prompting guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide) and [Codex CLI's own prompt](https://github.com/openai/codex/blob/main/codex-rs/core/gpt_5_codex_prompt.md) | an autonomous senior engineer that gathers context, implements, tests and finishes in the same turn; bias to action; batch independent reads; stop and report when re-reading the same files without progress; never revert changes it did not make; no amend; no `reset --hard`; a code review leads with findings |
| [Anthropic, prompting best practices for Claude](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) | act instead of only suggesting; investigate before answering (never describe code that was not opened); keep the change minimal (extra files, abstractions and flexibility are the known failure of current models); write general solutions and never hard-code to pass tests; weigh reversibility and blast radius; commit to an approach; **calm wording**: emphatic ALWAYS/NEVER/CRITICAL makes current models over-trigger tools and over-explore; damp sub-agent over-use; clean up scratch files |
| [Claude Code's published prompt fragments](https://github.com/Piebald-AI/claude-code-system-prompts) | outcome-first, readable reports; report faithfully (failing tests are reported as failing); a yes to one action is not a yes to the next; never skip hooks, stage files by name; do not create planning documents; defer to the user on scope |
| [Anthropic, effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) and [writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) | load context just in time with tools; a tool description is a contract with a non-deterministic reader, so it says when to use the tool, what comes back and what to do on failure; treat what the agent reads from outside as data |

Where the sources disagree, the choice and the reason: OpenAI says to remove "announce a plan, preambles, status updates" for its Codex models because they can make the model end the turn before the work is
finished; Claude Code asks for a one-sentence opening. The text allows one short sentence about the goal but only **in the same reply as the first tool call**, and says that a reply with no tool call ends the turn
(in Vader's loop it does), because a weaker model that answers with the sentence alone would otherwise stop.

## What changed

- Agent mode: nine short tagged sections (`role`, `working_style`, `understand_before_changing`, `code_quality`, `tools`, `verification`, `safety`, `untrusted_content`, `communication`) instead of eight loosely related lines.
  Gone: "ALWAYS have maximal certainty", "ALWAYS use tools", "Do not immediately make a change unless you have ALL relevant context" (they push a model to over-explore before touching anything).
  New: persistence until the task is verified and reported; one approach and no thrashing; the minimal-change rules; no special-casing to pass a test and no weakening tests; error handling only where it can happen; the verification loop with a stop
  after the same fix fails twice; git safety on a worktree that may hold the user's own work; do not route around a block or a rejection; outside text is information, not instructions; an outcome-first report that says what was and was not verified.
- Gather and Plan modes: only the outside-text rule is added (they read hostile files too).
- Tool descriptions: `edit_file` and its block format say when to use it, that several changes go in one call, to copy the text exactly from a recent read and what happens when it does not match (the benchmark showed
  `No Search/Replace blocks were received` and edits that missed); `rewrite_file` no longer says "use it to edit a file you just created" and forbids placeholders; `read_file` no longer tells the model **not** to use line ranges (that
  made large files be read whole); the two search tools say which question each answers; the terminal description asks for non-interactive one-command calls and says the result ends with the exit code.
- Size: the behaviour block is about 8,000 characters; the test keeps it under 10,000, because every request pays for it (prompt caching makes the repeated part cheap on providers that support it).

## How it is tested and measured

- `test/agentPromptE2E.mjs` (54 checks, in CI) builds the prompt of every mode from the real source and pins the structure, the rules that matter most, the absence of shouting and of the old slogans, the size budget, and the
  difference between native and XML tool calling. A unit test cannot say the agent got better; that is measured:
- `test/e2e/promptSwap.mjs` lets an installed Vader run with the source tree's instructions and tool descriptions (the proxy replaces them in each request), so the same binary, model and exercises differ only in the instructions.
  Run `polyglotBench.mjs` twice, once with `POLY_PROMPT=app` (the installed app's own text) and once with `POLY_PROMPT=source`, tests hidden, edit-only, same seed and sample.

Status when written: the new text is implemented, unit-tested and read through; the A/B measurement has **not** been run yet (the free OpenRouter quota of the day was used up by the earlier runs; the paid credit is nearly gone).
A prompt change can make a model worse as easily as better: do not release it on the strength of this document, release it on the A/B.
