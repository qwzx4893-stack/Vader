# Testing the packaged app without a model API key

Vader's behaviour depends on a model, and CI has no API key. Three layers stand in for one, each with a stated limit.

| Layer | What it proves | Where | Limit |
| --- | --- | --- | --- |
| Unit-style checks (`test/*E2E.mjs`) | Real TypeScript (bundled with esbuild) for the XML tool parser, history converters, policy engine, import graph, packaged-import safety, React type-check | `ci.yml` | No UI, no model |
| Scripted model server (`test/e2e/modelServer.mjs`) | The **real packaged app**, driven through its UI by Playwright over CDP, talks the OpenAI-compatible wire protocol (SSE chunks, split tool-call arguments, usage chunk, FIM, error statuses) to a server whose replies the scenario scripts. Every tool, mode, approval, editor feature and error path is exercised; assertions look at what the app really did (files on disk, requests the model received, rendered chat). The server itself is checked against the official `openai` SDK (`modelServerE2E.mjs`). | `test/e2e/suite.mjs`, `windows-e2e.yml` | The model's *decisions* are scripted, so this proves the app handles any model behaviour correctly, not that a given model behaves well |
| Real small model (Ollama in `windows-e2e.yml`, `real_llm: true`) | The same app against an unscripted model: streaming, history, tool prompts. Hard checks are only those that hold for any working model; tool use by a tiny model is reported as information | `test/e2e/scenarios/realLlm.mjs` | A 1.5B model is not GPT/Claude-class |

## Running it

- Locally on Linux (no native modules, so terminal and restart scenarios are skipped):
  `VADER_EXE=<packaged app> PW_CORE=<playwright-core> E2E_ARGS=--no-sandbox E2E_NATIVES=0 xvfb-run node src/vs/workbench/contrib/void/test/e2e/suite.mjs`
- On Windows with every native module: dispatch the *Windows E2E* workflow with the run id of a *Windows Build*.
- `E2E_ONLY` is a regex over `"<group> <scenario>"`; failures leave a screenshot, the chat transcript, the requests the model received and the renderer's errors in `E2E_OUT`.
- `E2E_PRISTINE=1` (set by the workflow, not valid for a locally patched package) also fails on a "corrupt installation" notification.

Rule when a scenario fails: decide whether the **test** or the **product** is wrong before touching either. Several real bugs were found this way (lost parallel tool calls, hung approvals, missing chat UI for Vader's own tools, Quick Edit, commit-message generation after the 1.136 upgrade, `.vaderrules` created after opening a folder); several failures were wrong test assumptions and were fixed in the test.
