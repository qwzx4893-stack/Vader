# The Agent Gateway, and why the runtime wasn't replaced wholesale

**Contract:** `IAgentGatewayService` in `src/vs/workbench/contrib/void/common/agentGateway/agentGatewayTypes.ts`. **Current implementation:** `browser/agentGatewayService.ts`, which delegates to `chatThreadService.ts`.

## The question this answers

A later revision of this project's own build brief asked, bluntly, whether the primary agent loop should be replaced with a runtime from Cline, Kilo Code, OpenHands, or Zed, citing "single tool call per model turn" as evidence the existing loop was a structural constraint. That evidence was real (see `CHANGELOG.md`'s multi-tool-call entry - it's fixed now), but the conclusion drawn from it wasn't: none of those four are a clean transplant.

- **Cline and Kilo Code** are VS Code *extensions*. Their agent loop runs in the extension-host process and is written against `vscode.*` extension APIs and their own webview UI. Moving that loop into Void's native workbench doesn't give you "a modern runtime behind a clean interface" - it gives you an extension pretending to be part of the editor, which is exactly the "Cline running inside Void" outcome this project's own brief separately names as something to avoid.
- **OpenHands' agent SDK** is Python-first.
- **Zed's agent** is Rust, built directly against Zed's own GPUI toolkit. There's no TypeScript surface to embed.

Composing "the best parts" of these into Vader without one of the above problems isn't a weekend refactor - it's a from-scratch runtime that happens to borrow ideas, which is a different (and much larger) project than "swap the runtime behind a stable interface."

## What was actually wrong, and what was done about it

The concrete defect behind "single tool call per turn" was in `electron-main/llmMessage/sendLLMMessage.impl.ts`: the OpenAI-compatible streaming path only ever accumulated tool-call index 0 (`if (index !== 0) continue`), the Anthropic path only ever read `tools[0]`, and Gemini's path only ever read `functionCalls[0]`. When a model asked for two or three tools in one turn, every one after the first was silently discarded - not queued, not deferred, just dropped. That's fixed: all three native tool-calling paths now collect every tool call the provider returns, and `chatThreadService.ts`'s `_runChatAgent` executes each one (serially - see the code comment at that loop for why not concurrently) through the same per-call Policy Engine and agent-scope gate as before. The XML fallback grammar (used by models without native function-calling) still only detects one tool tag per response, since its custom incremental parser locks onto the first match by construction and safely extending that parser was judged higher-risk than the value it would add for what's already the weaker-tool-support code path; it wraps its single result in a one-element array to satisfy the same contract without claiming a capability it doesn't have.

## The Gateway itself

`IAgentGatewayService` is a small, deliberately minimal interface - today just `runIsolatedTask` - that sits between a caller and whichever loop actually executes a task. It exists so that *if* a suitable external runtime appears later, or if Vader outgrows the Void-derived loop for other reasons, swapping it is "write a new class implementing this interface, change one `registerSingleton` call" rather than "rewrite the UI." The `delegate_subagent_task` tool goes through it today (see `toolsService.ts`) - that's a real, exercised call site, not a decorative interface with nothing behind it.

The workbench's own chat UI does **not** go through this Gateway yet. It's woven into `IChatThreadService`'s live thread/stream state (`ThreadType`, `ThreadStreamState`, the `onDidChangeStreamState` event) for rendering the conversation, checkpoints, and streaming text in real time. Cutting that over to the Gateway is a separate, riskier UI-layer change - the Gateway would need to either expose that same live-state surface (defeating some of the point of a thin interface) or the UI would need a different rendering model entirely. That work is out of scope here; this Gateway is honest about covering the "delegate a task and get a result back" shape, not the "render a live conversation" shape.
