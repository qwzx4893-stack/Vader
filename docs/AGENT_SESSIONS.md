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

## Session 4: attacking the file tools as a hostile or confused model

The same method pointed at security: what could a prompt-injected model do with the *file* tools alone (the terminal is a separate,
already gated path)? Each row was reproduced first, then fixed, then pinned by a test that uses the real rules and real symbolic links
(`symlinkPolicyE2E`, 63 checks) and, for the first two, a real-app scenario (`core` group).

| Finding | Severity | Fix |
|---|---|---|
| A path through a symbolic link inside the workspace (`docs/credentials`, `docs` linking to `~/.aws`) matched none of the secret-file rules, so the file was read with no question asked | high | every file path is also resolved to where it really points (`IFileService.realpath`; a path that does not exist yet is resolved through its nearest existing ancestor, since the ancestor can be the link) and the rules see both forms |
| `..` segments were never collapsed (`<workspace>/src/../../../../etc/sudoers.d/x` is not `/etc/sudoers.d/**` to a glob), so the **locked** system-file deny could be walked around | high | dot segments are collapsed before matching; the real-app scenario shows no approval prompt and no file created |
| Nothing asked before the agent wrote a file that runs code later: `.vscode/tasks.json` (runs on folder open), `.vscode/settings.json`, `.git/hooks/*`, `.husky/*`, `.envrc`, devcontainer and MCP config, shell startup files, the workspace `.vaderrules`. With edits auto-approved, a prompt-injected model got code execution without ever calling a terminal tool | high | new built-in ask rule `vader.ask.autorun-config` (the user can switch it off in settings; autonomous agents never bypass it) |
| Credential files the secret rule did not know: `.git-credentials`, `gh`/`gcloud`/`azure` config, `.gnupg`, `.pgpass`, `.pypirc`, `*.tfvars`, keystores, `secrets.*` | medium | added to `vader.ask.secrets-and-keys` |
| A permanent agent with a filesystem scope could not touch **any** file, in scope or not (the check denied unconditionally): the feature was unusable, and failed closed so it was not exploitable | functional bug | real glob matching: relative globs against each workspace folder, absolute globs as written, every path (as written and resolved) must be in scope; `agentScope.ts` |

What is **not** closed by this: a hostile *terminal* command can still reach anything the user's account can (the terminal rules are
pattern-based and the hard denies are the catastrophic cases); the answer to that is the approval prompt, which is on by default.

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
