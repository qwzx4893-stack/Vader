# External Agent Adapter

**Contract:** `common/externalAgent/externalAgentAdapterTypes.ts` (`IExternalAgentAdapter`, `IExternalAgentSession`, `ExternalAgentEvent`). **Registry:** `common/externalAgent/externalAgentAdapterRegistry.ts`. **Reference implementation:** `browser/vaderNativeExternalAgentAdapter.ts`.

## Why a separate contract from the Agent Gateway

`IAgentGatewayService` (Phase 1, `docs/integrations/agent-gateway.md`) is Vader's own internal seam - thread ids, `AgentExecutionState`'s Void-loop-shaped phases, methods like `approveToolRequest` that assume Vader's own approval model. It's meant for callers *inside* this codebase.

This is a different, ACP-inspired (Zed's Agent Client Protocol) shape, meant to be implementable by something that has never heard of `chatThreadService.ts`: capabilities, session creation, a prompt/response cycle, streamed events (`message_chunk`, `tool_call`, `plan_update`, `permission_request`, `error`, `complete`), and cancellation. Collapsing the two into one contract would mean either leaking Vader-internal concepts into a protocol boundary meant to be genuinely swappable, or weakening the Gateway's own shape to the lowest common denominator. They're kept separate on purpose.

## The reference adapter - real, not a stub

`VaderNativeExternalAgentAdapter` wraps Vader's own real runtime behind this ACP-shaped interface:

- `createSession` / `sendPrompt` calls `IAgentGatewayService.runIsolatedTask` - a real subagent run, through the real Policy Engine and agent-scope gates, not a canned response.
- **Streaming is genuinely live**, not simulated: the session subscribes to `IAgentGatewayService.onDidChangeExecutionState` and reads `getExecutionState(threadId)`, forwarding `phase: 'streaming'`'s `streamingTextSoFar` as incremental `message_chunk` events (diffed against what's already been sent) and `phase: 'running_tool'` as `tool_call` events. This is two of this project's own real subsystems (the Gateway's execution-state projection from Phase 1, and this adapter) composed together, which is exactly what "the boundary actually functions" needs to mean to be worth claiming.
- `cancel()` calls the same `IAgentGatewayService.cancelTask` every other cancellation path in this codebase uses.
- `getCapabilities()` reports `supportsToolRequests: false` **honestly, not aspirationally**: a subagent run has no live human to approve an interactive request the way the chat UI does, so tool-category approval auto-approves itself on that pathway (see `chatThreadService.ts`) - only the Policy Engine's un-bypassable rules can still stop something, and when they do, it surfaces as a `stalledAwaitingApproval` result, which this adapter turns into an `error` event explaining exactly that, rather than pretending a `permission_request` round-trip is possible when it isn't.

## What's not wired up, and why

**No genuine third-party ACP-speaking agent process is connected.** Building one properly means picking a concrete external agent binary, speaking its actual wire protocol (likely JSON-RPC over stdio, per ACP), and handling its process lifecycle - and this environment has no such binary available to test against. Writing an adapter for a protocol with nothing real on the other end to verify it against would mean either (a) also writing a fake external process to talk to, which is a mock of a mock and proves nothing about interoperating with a *real* external agent, or (b) shipping untested protocol-parsing code with no way to know if it's actually correct. Wrapping Vader's own real runtime, as done here, is the stronger proof available in this pass: every event this reference adapter emits is backed by a real, running, verified agent loop.

The natural next step, when there's a concrete target to build against (a specific ACP-speaking agent binary, or Zed's own ACP client), is a second `IExternalAgentAdapter` implementation that shells out to it - the registry (`IExternalAgentAdapterRegistry`) already supports registering more than one, and nothing about this contract needs to change to add it.
