# The Main Agent Runtime seam (Cline integration)

**Contract:** `IAgentRuntimeRegistryService` in `common/agentRuntime/agentRuntimeTypes.ts`. **Implementation:** `browser/agentRuntime/agentRuntimeRegistryService.ts`. **Settings UI:** `RuntimeStatusBlock` inside `AgentManagerSection`, `void-settings-tsx/Settings.tsx`.

## What this is, and what it honestly is not (yet)

This doc is the record of a real, in-progress integration, not a finished one - read it alongside `AgentRuntimeHealth.status` in the running app, which is exactly this honest.

**Verified real** (not assumed from stale training data): Cline's upstream repository (`github.com/cline/cline`) publishes a genuinely embeddable, non-VS-Code-extension agent SDK under `sdk/packages/*`, split into `@cline/core` (session/hub/telemetry/cloud), `@cline/agents` (the standalone, "browser-safe" agentic tool-calling loop - its own `package.json` description), `@cline/llms` (provider layer), and `@cline/shared` (types, `createTool`). `@cline/sdk` is a thin alias re-exporting `@cline/core`. All are real, currently-published npm packages, Apache-2.0 licensed, version `0.0.86` as of 2026-09-28 - confirmed by three independent methods in this session: (1) fetching `https://registry.npmjs.org/@cline/sdk` and `.../@cline/core` directly (the authoritative npm registry API, not the bot-blocked marketing site), (2) fetching the real `sdk/README.md` from `raw.githubusercontent.com`, and (3) actually running `npm install @cline/sdk` in a scratch directory and reading the installed `.d.ts` files directly (`Agent`/`AgentRuntime` class, `createTool`, `AgentModel`, `AgentTool`, `ToolApprovalRequest`/`ToolApprovalResult`/`ToolPolicy`, the full `AgentRuntimeEvent` union) - this is ground truth, not summarized web text.

**Not yet done**: `@cline/agents`/`@cline/shared` are declared in this repo's `package.json` (`0.0.86`, exact-pinned) but **could not be installed into this repository** in this session - the sandbox's own dependency-install safety policy declined `npm install` here as "Untrusted Code Integration," a control outside this session's own judgment to override (see the session's own tooling notes; the correct next step is a human running the install, or granting the equivalent permission). Because `src/tsconfig.json` type-checks every `.ts` file under `src/vs/**` whether or not anything imports it, a `ClineRuntimeAdapter.ts` that imports a package this build cannot resolve would fail this project's own mandatory `tsc --noEmit` gate - so it has not been written as a real file yet. Writing one anyway and leaving it broken, or writing one that fakes the import, would both violate this project's "never suppress errors, never claim compiles-because-stubbed" rule more directly than simply not writing it.

What **has** been built, is real, and compiles/runs today:
- `IAgentRuntimeRegistryService` (`common/agentRuntime/agentRuntimeTypes.ts` + `browser/agentRuntime/agentRuntimeRegistryService.ts`): reports exactly the state above - `legacy: initialized`, `cline: unavailable` with the precise reason and the exact command that resolves it.
- The Agent Manager's `RuntimeStatusBlock` (`Settings.tsx`): shows both runtimes' health, which one is active, and why (`default`/`fallback`/`explicit`), with a manual Refresh button - satisfies Part III's requirement that the legacy runtime is never silently substituted without being visible.
- This document's design below, which is the literal plan `ClineRuntimeAdapter` implements the moment the dependency resolves - not a vague intention, but concrete types and call sites cited by file:line.

## Why `@cline/agents`, not `@cline/core` or `@cline/sdk`

`@cline/core`'s own `package.json` `exports` map (`./hub`, `./cloud`, `./telemetry`, `./remote/helper-entry`) and dependency list (`ws`, `simple-git`, `node-machine-id`, OpenTelemetry, `@modelcontextprotocol/sdk`) show it's the layer that owns Cline's own session persistence, hub/remote transport, telemetry, and cloud account integration - exactly the surface the mission requires Vader *not* to become dependent on ("Vader must not become dependent on a Cline account/hosted service"). `@cline/agents`, by contrast, is described in its own `index.d.ts` module doc as "Browser-safe agent runtime for the next-generation Cline SDK" with a dependency list of only `@cline/llms`, `@cline/shared`, and `nanoid` - no hub, no cloud, no telemetry, no persistence. It exports exactly one class that matters here: `AgentRuntime` (aliased `Agent`), a stateless, host-supplied-model, host-supplied-tools agentic loop. This is the correct integration point: it *is* "the Cline Agent Runtime" the mission's target architecture diagram refers to, without pulling in the parts of Cline that would compete with Vader's own session/persistence/telemetry ownership.

## The design (ready to implement once the dependency installs)

### 1. `VaderAgentModel` - preserves every existing provider, not just Cline's

`AgentRuntimeConfigWithModel.model: AgentModel` (from `@cline/shared`'s `agent.d.ts`) requires only:
```ts
interface AgentModel { stream(request: AgentModelRequest): AsyncIterable<AgentModelEvent> | Promise<AsyncIterable<AgentModelEvent>> }
```
This means Vader does **not** need `@cline/llms`'s provider layer at all. `VaderAgentModel implements AgentModel` wraps `ILLMMessageService.sendLLMMessage` (`common/sendLLMMessageService.ts`) exactly as `chatThreadService.ts`'s `_runChatAgent` already calls it today (see that file's line ~1218), translating its callback style (`onText`/`onFinalMessage`/`onError`/`onAbort`) into an async generator yielding `AgentModelEvent`s (`text-delta` per `onText` delta, `tool-call-delta`/`finish` from `onFinalMessage`'s `toolCalls`, `finish` with `errorClass` from `onError`). Because model construction stays entirely on Vader's side, every existing provider (Anthropic/OpenAI/Gemini/Mistral/OpenRouter/Ollama/vLLM/LM Studio/any OpenAI-compatible endpoint) keeps working unchanged, and the Model Router (`resolveModel(category)`) picks the concrete `ModelSelection` fed into `VaderAgentModel` per category exactly as it does today for the legacy loop - satisfying "Model Router must control Cline's model selection... AUTO mode only ever using configured/authorized providers" by construction, not by convention.

### 2. Tool adapter - the Policy Engine gate is shared code, not re-implemented

`_runToolCall` in `chatThreadService.ts` (see that file's numbered gate comments `1`/`1.4`/`1.45`/`1.5`/`2`) is refactored into two pieces without behavior change for the legacy path:
- `_evaluateToolCallGate(...)`: validate params → checkpoint → agent-scope check → read-only-mode check → Policy Engine evaluate → approval-type resolution. Returns `{kind:'blocked', reason} | {kind:'needs_approval', validatedParams, requestContent} | {kind:'auto_approved', validatedParams}`.
- `_executeAndRecordToolCall(...)`: the existing steps 3-5 (call tool, stringify, record message).

`_runToolCall` (legacy) calls both in sequence exactly as today. A new `_runToolCallInline(...)` - used only by `ClineRuntimeAdapter`'s `createTool().execute()` - calls the same `_evaluateToolCallGate`, and on `needs_approval` **awaits a promise that resolves when the user approves/rejects** (via the existing `approveLatestToolRequest`/`rejectLatestToolRequest` UI path) instead of returning early. Because this all happens inside one `execute()` call that `AgentRuntime`'s own `executeToolCalls` is `await`-ing as part of a turn's tool-call batch, the remaining tool calls in that same batch are never lost - `AgentRuntime` resumes them itself once the awaited promise settles. This is the concrete, load-bearing fix for the documented limitation in `_runChatAgent`'s own comment (around line 1298): "if one in the batch needs interactive approval, the batch stops there... rather than resuming mid-batch after approval, which the current approve/resume path can't express." No gate logic is duplicated between the two paths - both call the same `_evaluateToolCallGate`/`_executeAndRecordToolCall`, so Cline can never bypass a check the legacy loop enforces.

`AgentTool[]` is built once, generically, from the existing three exhaustive maps in `toolsServiceTypes.ts`/`toolsService.ts` (`BuiltinToolName`, `validateParams`, `callTool`, `stringOfResult`) via `createTool()` - no new tool-registration surface, so the AGENTS.md rule about those three maps staying exhaustive is unaffected.

### 3. `requestToolApproval` as a second, defense-in-depth gate

`AgentRuntimeConfig.requestToolApproval?: (request: ToolApprovalRequest) => Promise<ToolApprovalResult>` is wired to the same approval state `_runToolCallInline` awaits, so Cline's own runtime-level approval mechanism and Vader's Policy Engine agree structurally, not just by convention - there is no path through `AgentRuntime` that skips both.

### 4. Verification, subagents, Plan Mode

A verification thread's model resolves through `resolveModel('verification')` exactly as today, and `_evaluateToolCallGate`'s existing read-only-mode check (`isVerificationThread`) is untouched by this refactor, so "an independent verifier must never be able to change what it is checking" holds for Cline-driven verification exactly as it does for legacy. Plan Mode's hard read-only enforcement is the same gate, same guarantee. Subagent/parallel-agent delegation (`runSubagentTask`, `orchestrationService.ts`) continues to call `IAgentGatewayService.runIsolatedTask`, which is unaffected by which runtime drives the underlying thread - the Gateway's contract is runtime-independent by design (see `agentGatewayTypes.ts`).

### 5. Runtime selection

`ClineRuntimeAdapter`'s constructor attempts to construct a trivial `AgentRuntime` instance; success sets `cline: initialized` and makes it the active runtime; any thrown error (missing dependency, incompatible version) is caught and reported as `cline: unavailable` or `cline: runtime-error` with the real error message, and `legacy` remains active - satisfying "fallback activates ONLY on genuine runtime init/compatibility failure... never silently after an ordinary task error" (an ordinary per-task error surfaces through the existing `dismissError`/stream-error path, not through a runtime-health transition).

## XML tool-calling fallback audit

`getModelCapabilities(...).specialToolFormat` being `undefined` still means a model has no native tool-calling and Vader falls back to the single-tool-per-turn XML grammar (see `docs/integrations/agent-gateway.md`). This is orthogonal to which agent runtime drives the loop: `AgentTool`/`createTool` describe tools to whatever model-calling convention the underlying `AgentModel.stream()` implementation uses, and `VaderAgentModel` is the thing that would still need to fall back to XML-style single-tool prompting for a weak/local model, exactly as `_runChatAgent` does today. **Conclusion: the XML fallback is not made obsolete by adopting `@cline/agents`** - it lives at the model-integration layer (`VaderAgentModel`), not the agent-loop layer (`AgentRuntime`), and remains necessary for weak/local-model compatibility regardless of which loop is driving the turn.

## Status labels used in this doc and the completion report

- **Designed**: the architecture above - concrete types, concrete call sites, cross-checked against the real installed `.d.ts` files.
- **Compiled**: `IAgentRuntimeRegistryService` and the Agent Manager UI change only - verified via `tsc -p src/tsconfig.json --noEmit` (0 errors) and `npm run buildreact`.
- **Not yet implemented**: `ClineRuntimeAdapter`, `VaderAgentModel`, `_evaluateToolCallGate`/`_executeAndRecordToolCall`/`_runToolCallInline` - blocked on the dependency install described above, not on any remaining design uncertainty.
