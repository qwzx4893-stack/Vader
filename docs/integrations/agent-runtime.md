# The Main Agent Runtime (Cline integration)

**Contract:** `IAgentRuntimeRegistryService` in `common/agentRuntime/agentRuntimeTypes.ts`. **Implementation:** `browser/agentRuntime/agentRuntimeRegistryService.ts` (health only) + `browser/agentRuntime/{clineRuntimeAdapter,vaderAgentModel,clineToolAdapter}.ts` (the actual runtime). **Driven from:** `chatThreadService.ts`'s `_runChatAgent`/`_runChatAgentImpl`. **Settings UI:** `RuntimeStatusBlock` inside `AgentManagerSection`, `vader-settings-tsx/Settings.tsx`.

## Current state: installed, implemented, and the only runtime

Cline is Vader's Main Agent runtime - not a selectable option alongside something else. There is no legacy loop left to fall back to; a Cline failure surfaces as a clear per-task error (`_runChatAgentImpl`'s upfront `IAgentRuntimeRegistryService.getHealth()` check, plus the `_runChatAgent` wrapper's catch), never a silent switch to different execution logic.

`@cline/agents`/`@cline/shared`, version `0.0.90` exact-pinned, are real, installed dependencies (Apache-2.0, verified against the npm registry directly and the actual installed `.d.ts` files - not assumed from training data).

## Why `@cline/agents`, not `@cline/core` or `@cline/sdk`

`@cline/core`'s own `package.json` `exports` map (`./hub`, `./cloud`, `./telemetry`, `./remote/helper-entry`) and dependency list (`ws`, `simple-git`, `node-machine-id`, OpenTelemetry, `@modelcontextprotocol/sdk`) show it's the layer that owns Cline's own session persistence, hub/remote transport, telemetry, and cloud account integration - Vader deliberately does not depend on it, since Vader owns its own session/persistence/telemetry. `@cline/agents`, by contrast, is described in its own `index.d.ts` module doc as "Browser-safe agent runtime for the next-generation Cline SDK" with a dependency list of only `@cline/llms`, `@cline/shared`, and `nanoid` - no hub, no cloud, no telemetry, no persistence. It exports exactly one class that matters here: `AgentRuntime` (aliased `Agent`), a stateless, host-supplied-model, host-supplied-tools agentic loop.

## The `tsconfig.json` typings shim, and why it exists

The real installed `@cline/agents`/`@cline/shared` `.d.ts` files use extensionless relative import specifiers (`from "./agent"` instead of `from "./agent.js"`), which is invalid under this project's `moduleResolution: "nodenext"` (`src/tsconfig.base.json`) - confirmed by reading the actual installed files and reproducing the exact `TS2834` errors. Confirmed this is a **type-checking-only** problem, not a runtime one: `node -e "import('@cline/shared').then(m=>console.log(typeof m.createTool))"` succeeds (the compiled JS is self-contained; only the shipped `.d.ts` files have the broken specifiers).

Fixed via `src/tsconfig.json`'s `compilerOptions.paths`:
```json
"paths": {
  "@cline/shared": ["./typings/cline-shared.d.ts"],
  "@cline/agents": ["./typings/cline-agents.d.ts"]
}
```
redirecting TypeScript's type resolution (only - not runtime module resolution) to two hand-transcribed, extension-clean local `.d.ts` files (`src/typings/cline-{shared,agents}.d.ts`), copied faithfully from the real installed declarations. Alternatives considered and rejected: an ambient `declare module` shim (TypeScript resolves to the real, existing file first, so this can't override it), deep-importing a specific subpath (blocked by the packages' own `package.json` "exports" maps, and the target files have the same broken-import problem internally anyway), patching `node_modules` directly or via `patch-package` (fragile, non-persistent across reinstalls, or a new dependency for something this narrow).

**This shim is a real, acknowledged maintenance risk** - see `src/vs/workbench/contrib/vader/test/checkClineTypingsVersion.mjs`, a standalone script (also runnable as part of the smoke test) that reads the installed `@cline/agents`/`@cline/shared` package versions from `node_modules` and fails loudly if they no longer match `CLINE_AGENTS_VERSION`/`CLINE_SHARED_VERSION` in `clineRuntimeAdapter.ts` - so a future `npm install @cline/agents@<newer>` cannot silently diverge from what these hand-written `.d.ts` files declare without a visible failure pointing at exactly this file pair.

## The three pieces

### 1. `VaderAgentModel` - preserves every existing provider

`vaderAgentModel.ts` implements `@cline/shared`'s `AgentModel` interface (`stream(request): AsyncIterable<AgentModelEvent>`) by wrapping `ILLMMessageService.sendLLMMessage` - Vader's one, existing, provider-correct entry point. Model construction stays entirely on Vader's side, so every existing provider (Anthropic/OpenAI/Gemini/Mistral/OpenRouter/Ollama/vLLM/LM Studio/any OpenAI-compatible endpoint, plus whatever Part I of the production-hardening pass added - see `docs/integrations/providers/`) and the Model Router (`resolveModel(category)`) keep working unchanged. It deliberately ignores `AgentModelRequest.messages` (Cline's own internal transcript) and instead reads Vader's live `ChatMessage[]` thread history via a `getThreadMessages()` closure on every call, converting it with the existing `IConvertToLLMMessageService.prepareLLMChatMessages` - the one real conversion path, not a second one written for Cline.

### 2. Tool adapter - the Policy Engine gate is shared code, not re-implemented

`chatThreadService.ts`'s tool-call gate is `_evaluateToolCallGate` (validate params → checkpoint → agent-scope check → read-only-mode check → Policy Engine evaluate → approval-type resolution) + `_executeAndRecordToolCall` (call the tool, stringify, record). `_runToolCallInline` - the callback every `AgentTool.execute()` built by `clineToolAdapter.ts`'s `buildClineTools()` calls - runs `_evaluateToolCallGate`, and on `needs_approval` **awaits a promise that resolves when the user approves/rejects** (via `approveLatestToolRequest`/`rejectLatestToolRequest`, which check a `_pendingInlineApprovals` map first) instead of returning early. Because this await happens inside one `execute()` call that `AgentRuntime`'s own `executeToolCalls` is itself awaiting as part of a turn's tool-call batch, the remaining tool calls in that batch are never lost - `AgentRuntime` resumes them itself once the promise settles. **This is empirically verified**, not just architecturally argued - see the smoke test below. `AgentTool[]` is built from the same `builtinTools`/`availableTools(chatMode, mcpTools)` filter the system prompt uses - no second tool-registration surface.

### 3. Crash recovery for a pending approval

`_pendingInlineApprovals` is in-memory and does not survive a Vader restart. If the app restarts while a tool_request is still pending, `approveLatestToolRequest`'s fallback path (`_resumeToolRequestAfterRestart`) runs that one tool call directly (preapproved - it was already fully gated before the request was shown) via `_executeAndRecordToolCall`, then starts a brand-new `_runChatAgent` call. This works because `VaderAgentModel` always rebuilds its request from live thread messages - a fresh `AgentRuntime.run()` picks up the conversation exactly where the restart interrupted it; there is no need to "resume" the old, now-gone `AgentRuntime` instance, since a full process restart destroyed its in-memory batch state either way.

### 4. Verification, subagents, Plan Mode

A verification thread's model resolves through `resolveModel('verification')`; `_evaluateToolCallGate`'s read-only-mode check (`isVerificationThread`) applies identically. Plan Mode's hard read-only enforcement is the same gate. Subagent/parallel-agent delegation (`runSubagentTask`, `orchestrationService.ts`) calls `IAgentGatewayService.runIsolatedTask`, which is runtime-independent by design (`agentGatewayTypes.ts`) and drives its hidden thread through the same `_runChatAgent`.

### 5. Runtime health (diagnostics only, not a selection mechanism)

`IAgentRuntimeRegistryService.getHealth()`/`.refresh()` run `probeClineRuntime()` (a real, throwaway `AgentRuntime` construction) and report `initialized`/`runtime-error` with the real thrown-error message. This exists purely so a genuine incompatibility is visible in the Agent Manager UI (and caught early by `_runChatAgentImpl`'s upfront check) - it is not consulted to pick between runtimes, since there is only one.

## XML tool-calling fallback

`getModelCapabilities(...).specialToolFormat` being `undefined` still means a model has no native tool-calling, and Vader falls back to the single-tool-per-turn XML grammar (see `docs/integrations/agent-gateway.md`). This is orthogonal to the agent loop: `AgentTool`/`createTool` describe tools to whatever convention the underlying `AgentModel.stream()` implementation uses, and `VaderAgentModel` is the thing that still falls back to XML-style single-tool prompting for a weak/local model. The XML fallback is not made obsolete by `@cline/agents` - it lives at the model-integration layer, not the agent-loop layer, and remains necessary for weak/local-model compatibility.

## Testing

`src/vs/workbench/contrib/vader/test/clineRuntimeSmoke.mjs`: a standalone Node ESM script (no test infra exists for `contrib/vader` code) exercising the **real, installed** `AgentRuntime` with scripted `AgentModel`/`AgentTool` objects (no real provider credentials in this sandbox, but the runtime itself is never mocked). 5 test functions, 14 assertions: basic run, single tool call, mid-batch approval resume (the critical one - tool A runs, tool B blocks on an external approval promise, tool C is verified not to run while B is pending, then runs once B resolves), cancellation, tool rejection. All passing.

For real-provider, real-network testing (an actual OpenRouter model driving a real coding task through this same runtime), see `docs/integrations/providers/e2e-testing.md`.

## Status labels used in this doc and the completion reports

- **Compiled**: verified via `tsc -p src/tsconfig.json --noEmit` (0 errors) and `npm run buildreact`.
- **Unit/integration-tested against the real installed package**: `clineRuntimeSmoke.mjs`.
- **Real-provider-tested**: the OpenRouter E2E harness (see `docs/integrations/providers/e2e-testing.md`).
- **Not live-UI-verified**: an unpackaged Electron launch of this codebase does not reach a working workbench in this Linux sandbox (a pre-existing, documented limitation, true of unmodified upstream too) - so the actual chat UI driving a Cline turn has not been click-tested here.
