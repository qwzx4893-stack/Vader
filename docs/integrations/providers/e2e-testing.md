# Real OpenRouter + Cline end-to-end test harness

**File:** `src/vs/workbench/contrib/void/test/openRouterE2E.mjs`. **Status as of this writing: built, syntax-checked, import-path-verified — not yet run against live OpenRouter traffic.**

## Why it hasn't run yet

This sandbox's egress proxy explicitly denies `openrouter.ai:443` at the organization-policy level (`gateway answered 403 to CONNECT`, confirmed via the proxy's own `/__agentproxy/status` diagnostic endpoint, not just a timeout). This is a network policy decision made when this cloud environment was configured, not a bug in the harness or in Vader. The fix is on the environment side: open the cloud environment's settings (the environment menu in the session's title bar → Edit → Network access) and either broaden network access or add `openrouter.ai` to the allowed domains, then re-run the harness with a real `OPENROUTER_API_KEY`.

Everything else about this integration - the provider wiring itself (`sendLLMMessageToProviderImplementation.openRouter`, already shipped and used by real OpenRouter users of Vader before this session), the Cline runtime, the mid-batch-approval-resume fix - is independently verified elsewhere (`clineRuntimeSmoke.mjs`, real installed `@cline/agents`, scripted model). What only *this* harness proves - a real model's real tool-call behavior flowing through the real runtime, not a scripted one - remains genuinely untested pending that network change. This is stated here plainly rather than glossed over: **ENVIRONMENTALLY UNTESTABLE, not IMPLEMENTATION MISSING.**

## What the harness does

1. **Model selection**: queries OpenRouter's public `/models` endpoint live, filters to models that (a) declare `tools` in `supported_parameters` (native tool-calling), (b) cost under $2/M input tokens, and (c) are from a short list of models with a strong track record for reliable tool-calling at low cost (`gpt-4o-mini`, `gpt-5-mini`/`nano`, `claude-3-5-haiku`). Picks the cheapest match; falls back to `openai/gpt-4o-mini` (a well-established, cheap, reliable choice for tool-calling) if the live query fails. **Rationale for this shortlist**: the mission explicitly asks for "economical but genuinely capable" - a model with a poor tool-calling track record would produce a misleading test (failures attributable to the model, not to Vader's integration), and an expensive flagship model would waste the provided credit on a test whose point is integration correctness, not model capability.
2. **Disposable fixture project**: a fresh directory under the OS temp dir (`os.tmpdir()`, never inside the Vader repo), containing a tiny Node module (`math.js`) with one deliberate bug, a test script (`test.js`), and a `README.md` - realistic enough to exercise read/write/run-command tool use without needing a large fixture.
3. **Real provider call**: uses `sendLLMMessageToProviderImplementation.openRouter.sendChat` - the exact compiled function Vader ships (`out/vs/workbench/contrib/void/electron-main/llmMessage/sendLLMMessage.impl.js`), not a reimplementation - imported directly since it has no Electron-specific dependencies (confirmed by importing it successfully in plain Node).
4. **Real runtime**: the real, installed `@cline/agents` `AgentRuntime`, wired to a bridge (`makeOpenRouterAgentModel`) that mirrors `vaderAgentModel.ts`'s real logic (same event-queue bridging pattern, same incremental text-delta computation) - the harness's own message history stands in for `VaderAgentModel`'s real `getThreadMessages()`/`prepareLLMChatMessages()` call, since the full `ChatMessage`/`IChatThreadService` layer requires the Electron DI graph this sandbox can't launch (see the file's own header comment for the full reasoning on scope).
5. **A harness-local Policy gate** (`buildClineTools`) that mirrors `_evaluateToolCallGate`/`_runToolCallInline`'s real shape: read-only tools run immediately, mutating tools (`write_file`, `run_command`) await an external promise exactly like `_pendingInlineApprovals` - proving the mid-batch-resume mechanism against a **real model's real tool-call batch**, not a scripted one.

## The three scenarios

1. **Real coding task** (auto-approved): "there's a bug in math.js, find it via the failing test, fix it, verify." Exercises multi-tool-call ordering (read → run → analyze → edit → run again) end-to-end, checked against the actual resulting file contents and a real re-run of the fixture's tests.
2. **Ask → pause → delayed approval → resume**: the test driver deliberately holds an approval for 2 real seconds before resolving it, then asserts the run only completed *after* that measured delay and that the file was actually changed - proving the pause is real (the model is genuinely blocked, not just architecturally "supposed to" wait).
3. **Rejection**: the model is asked to run a destructive command; the driver rejects the tool call and asserts the run completes cleanly (no crash) and the destructive command never executed.

## Cost/usage reporting

The harness does not attempt precise billing-accurate token accounting (`sendChat`'s callback shape doesn't surface a `usage` object - see `common/sendLLMMessageTypes.ts`'s `OnFinalMessage`). It reports that real, small OpenRouter credit was consumed by the selected model without fabricating a specific dollar figure it can't actually measure from the code path being tested.

## Running it once network access is granted

```
OPENROUTER_API_KEY=sk-or-... node src/vs/workbench/contrib/void/test/openRouterE2E.mjs
```

The key is read from the environment only; it is never hardcoded, written to any file, logged, or echoed by this script.
