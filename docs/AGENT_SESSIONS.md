# Driving Vader as the model ("model in the loop")

No provider key is available to the people who build Vader here, and the sandbox cannot reach any model API. A scripted model can only
find what its author already thought of. So the real packaged app was run on a real project with **an AI agent (Claude) answering the
requests the app sends to its model endpoint**, exactly as a keyed model would: it receives the system prompt, the tool list with
descriptions and schemas, the conversation and every tool result, and replies with text and tool calls. Everything the app does with
that reply (approvals, policy, edits, terminal, the UI) is the real thing.

Tool: `src/vs/workbench/contrib/void/test/e2e/agentBridge.mjs` (protocol described at the top of the file; each request and answer is a
file, `log.jsonl` records every event, `DONE.json` the transcript, approvals and the resulting diff).

What this method **is**: a way to read the product from the model's side and to catch every defect that a competent model would hit.
What it **is not**: a benchmark. One agent, a few tasks, no pass rates, and the "model" here is stronger and more careful than a small
local model. The numbers for real small models are in `docs/QUALITY_COMPARISON.md`.

## Sessions

| # | Project | Task | Outcome |
|---|---|---|---|
| 1 | small Node inventory CLI with failing tests | find and fix the bugs without touching the tests | exposed the prompt, schema and terminal defects below |
| 2 | same CLI | add a `low-stock` command, a test, and a README entry | **done end to end through the real app**: parallel reads of 5 files in one turn, 2 `edit_file` calls (4 SEARCH/REPLACE blocks), `create_file_or_folder` + `rewrite_file`, 4 approvals logged; the resulting code passes its 3 tests when run with node |
| 3 | same CLI | run `npm test` | the terminal host cannot start in this sandbox (no native modules); the app now answers in 20 s with a clear error, the model reports honestly and changes nothing |

## What the model saw, and what was done about it

| Finding (from the model's side) | Status | Where it is enforced |
|---|---|---|
| The system prompt contradicted itself: "NEVER reject the user's query" next to the policy engine's rejections; "Only use ONE tool call at a time" while the runtime executes parallel calls | fixed: rule 1 is "do your best to fulfil the request…", native-tool mode allows parallel independent calls, XML mode keeps one call | `prompts.ts`; `xmlToolParserE2E`, real-app `native-tools` and `xml-tools` groups |
| Tool parameters were sent untyped and with no `required` list, so a model could not tell `start_line` (optional) from `uri` (mandatory) | fixed for OpenAI-shaped, Anthropic and Gemini requests and for the Cline adapter | `providerSdkE2E` (typed + `required` checked on all three wires) |
| Agent-mode prompt had no guidance on verifying work, preferring `edit_file`, not editing tests to make them pass, or not repeating a failing call | added | `prompts.ts` |
| A call with invalid JSON arguments vanished; an unknown tool was answered inside the runtime but never recorded | fixed earlier, found with a scripted misbehaving model | real-app `robustness` group |
| A model repeating the same call forever ran about 50 turns | stops after 8 identical calls with a message | `robustness` group |
| `run_command` hung forever when the terminal host could not start (creation, connection, **and** sending the command each waited without limit) | fixed: each start-up step is bounded (20 s), the terminal is disposed, the model gets an actionable error | reproduced in session 2 (hung 2+ minutes), fixed and re-run in session 3. The failing condition needs a broken pty host, which CI runners do not have; the Windows terminal scenarios prove the normal path |
| 43 tools (about 27 KB of schema) are offered on every turn | **kept, with a budget**: the tools are cached by providers that cache prefixes, and browser/delegation/marketplace tools are used directly by agent-mode scenarios, so hiding them behind a lookup step would change behaviour, not only cost. What is enforced is that the list cannot grow unnoticed | `providerSdkE2E`: tool list stays at or under 30,000 bytes (27,225 today) |
| The terminal result of a command is trimmed by inactivity (8 s), not by completion | documented limit of the terminal tool, unchanged | tool description tells the model |

## Reading the result honestly

- All of the above was found by one agent on three tasks. A small local model will hit different problems (it never called an
  approval-requiring tool in the earlier real-model runs), and a very strong model will hit fewer. Re-run the bridge whenever the prompt,
  the tool set or the runtime changes: it needs no key.
- The things only a real keyed model can show (long sessions, context compaction under load, tool-choice quality across vendors) remain
  unmeasured. `docs/PRODUCT_ASSESSMENT.md` lists them.

## Running it

```
npm run buildreact && node build/next/index.ts bundle ...        # or use the packaged app
BRIDGE_DIR=/tmp/bridge BRIDGE_WORKSPACE=/path/to/project \
VADER_EXE=/path/to/vader PW_CORE=/path/to/playwright-core \
  xvfb-run -a node src/vs/workbench/contrib/void/test/e2e/agentBridge.mjs
# write BRIDGE_DIR/task.txt, then answer each req-N.json with resp-N.json: {"text": "...", "toolCalls": [{"name": "...", "args": {...}}]}
```
