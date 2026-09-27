# Vader Architecture

Vader is Void (a deprecated, MIT/Apache-2.0-licensed fork of VS Code) with a new agent platform layered on top. This document is for whoever - human or AI - next needs to extend, replace, or debug a piece of that platform. It describes what exists today, not an aspirational design; where something is a known gap, it says so.

## Two layers

**The Void layer** (`src/vs/workbench/contrib/void/`, mostly unchanged from upstream): the editor shell, the chat/agent UI (React, under `browser/react/src/`), the streaming diff/apply engine (`editCodeService.ts`), checkpoints, the terminal tool, and the original LLM provider abstraction (`sendLLMMessageService.ts` / `electron-main/llmMessage/`). This is the UI and interaction model Vader intentionally keeps.

**The Vader layer** (`src/vs/workbench/contrib/void/common/{policy,agents,instructions,discovery,capabilities,browser}/` and `electron-main/{discoveryMainService,browserToolMainService}.ts`): new services that plug into the Void layer's existing extension points rather than replacing them. Every new service in this layer follows the same pattern already established by Void's own services (`voidSettingsService.ts`, `mcpService.ts`): a `common/` interface + browser-side implementation (and an `electron-main/` counterpart with an IPC channel, when it needs Node/network access Electron's renderer shouldn't have directly).

## The agent loop, and where Vader hooks into it

The single most important file to understand is `browser/chatThreadService.ts`. `_runChatAgent` is the tool-calling loop: send an LLM message, get back zero or more tool calls, run each via `_runToolCall`, repeat until the model stops asking for tools. **This loop is Void's own, hardened and extended in place - not replaced with an external agent runtime.** `docs/integrations/agent-gateway.md` covers why a wholesale swap for Cline/Kilo Code/OpenHands/Zed's runtimes was evaluated and rejected as an architectural mismatch (extension-host-only, Python-first, and Rust/GPUI-only respectively - none is a clean transplant into a native VS Code-family workbench), and what was fixed instead: every native tool-calling provider path (OpenAI-compatible, Anthropic, Gemini) used to silently keep only the *first* tool call a model returned in one turn and drop the rest; all three now collect every tool call, and the loop executes each one serially (never concurrently - Void's diff/checkpoint engine assumes one edit lands before the next starts).

Vader adds two things to `_runToolCall`, in order, before any tool actually executes (per call, when a turn has more than one):

1. **Agent scope** (if the thread is running as a permanent agent - see below): checks the agent's `deniedToolNames`, `allowedApprovalTypes`, `mcpServerNames`, and `filesystemScopeGlobs`.
2. **Policy Engine** (`common/policy/`): a hard, rule-based gate that runs unconditionally - independent of the model's behavior, the user's auto-approve settings, and the running agent's own restrictions.

Either can produce a `deny` (the call never runs; a `rejected` tool message explains why) or an `ask` (forces the interactive approval flow even if the tool category is globally auto-approved, and stops the rest of that turn's tool calls from running until it's resolved). This is the mechanism the mission calls a "hard policy engine" - see `common/policy/policyService.ts` and `common/policy/builtInPolicyRules.ts` for the actual rules.

The **Agent Gateway** (`common/agentGateway/`, see `docs/integrations/agent-gateway.md`) is the stable seam in front of this loop, and it's the real primary path for executing a task: the chat UI's send/edit/abort/approve/reject/dismiss-error actions (`SidebarChat.tsx`) all go through `IAgentGatewayService`, as does `delegate_subagent_task`. The UI still reads `IChatThreadService`'s persisted thread data and live stream-state event directly for *rendering* the conversation (messages, checkpoints, thread list) - that's inherent to displaying history, not to driving execution, and duplicating it behind the Gateway would just mirror the same event bus a second time. Swapping the runtime behind the Gateway now means implementing one interface and changing one `registerSingleton` call, without touching the UI's send/abort/approve code paths.

## Subsystem map

| Subsystem | Where | What it owns |
|---|---|---|
| Agent Gateway | `common/agentGateway/`, `browser/agentGatewayService.ts` | Real primary seam for executing a task - start/revise/cancel a turn, approve/reject a tool, dismiss an error, normalized execution state; used by the chat UI and subagent delegation alike |
| Policy Engine | `common/policy/` | Pre-execution allow/ask/deny rules, permission mode (safe/balanced/autonomous) |
| Layered instructions | `common/instructions/` | Composes system invariants + policy summary + global settings + `.vaderrules` + agent instructions into the system prompt, in a fixed, inspectable order |
| Permanent agents | `common/agents/` | Named, persistent agent definitions (instructions, model override, tool/MCP/filesystem restrictions); `create_persistent_agent` tool lets the main agent create one itself |
| Subagent delegation | `browser/chatThreadService.ts` (`runSubagentTask`) | Hidden threads for one-off delegated tasks; returns a structured summary, not the transcript |
| External discovery | `common/discovery/` | Live search against the official MCP Registry and SkillNet; read-only, no auto-install |
| Capability bus | `common/capabilities/` | Read-only inventory/resolver over native tools + MCP tools + agents, falling back to discovery only when nothing local matches |
| Browser automation | `common/browser/`, `electron-main/browserToolMainService.ts` | Playwright-backed navigate/snapshot/click/type/screenshot/console |
| Context Engine | `common/context/`, `browser/contextEngineService.ts` | Per-turn dynamic context (symbol outlines, diagnostics, git diff/log) for mentioned/open files - relevance-ranked, token-budget-aware, incrementally cached; see `docs/integrations/context-engine.md` |
| Memory | `common/memory/` | Persistent project/agent memory (`remember` tool) + the compaction archive; see `docs/integrations/memory-and-compaction.md` |
| Context compaction | `browser/chatThreadService.ts` (`_maybeCompactThread`) | Structured summarization of older messages before the context window fills, with raw messages archived (not destroyed) to Memory |
| Checkpoints | `browser/editCodeService.ts`, `browser/chatThreadService.ts` (`CheckpointEntry`) | Inherited from Void, unmodified - per-file snapshot/restore tied to chat messages |
| Verification | `browser/toolsService.ts` (`run_verification`) | Runs a project's own build/lint/test scripts and reports pass/fail |

## Extension points (how to add or replace something)

**Add a built-in tool**: three places, always together - `common/toolsServiceTypes.ts` (`BuiltinToolCallParams`/`BuiltinToolResultType`, plus `approvalTypeOfBuiltinToolName` if it should require approval), `common/prompt/prompts.ts` (`builtinTools`, the description/params the model sees), and `browser/toolsService.ts` (`validateParams`/`callTool`/`stringOfResult` - all three maps are exhaustive over tool names, so TypeScript will tell you if you miss one). If the tool needs Node/network access, put the real work in an `electron-main/*MainService.ts` behind an IPC channel (see `discoveryMainService.ts` or `browserToolMainService.ts` for the pattern) rather than reaching for Node APIs from browser code.

**Add a policy rule**: append to `builtInPolicyRules` in `common/policy/builtInPolicyRules.ts` (for something that should ship on by default) or use `IPolicyService.addCustomRule` (for a user/project-specific one, surfaced in Settings). `locked: true` rules can never be disabled from settings - reserve that for the "no legitimate use case" tier.

**Replace the browser backend**: everything outside `electron-main/browserToolMainService.ts` talks to `IBrowserToolMainService` (`common/browser/browserToolServiceTypes.ts`), not to Playwright directly. A different backend (a CDP-only client, vercel-labs/agent-browser, a remote browser) is a new class implementing that interface; nothing else changes.

**Replace SkillNet or the MCP Registry**: same shape - `common/discovery/discoveryServiceTypes.ts`'s `IDiscoveryMainService` is the contract; `discoveryMainService.ts` is one implementation of it. A different skill index or a self-hosted MCP registry is a new implementation behind the same interface.

**Add a new permission mode behavior**: `PolicyRule.neverBypassAutonomous` controls whether an `ask` rule survives switching to autonomous mode; `locked` rules always survive every mode. There is deliberately no way to make a `locked` rule bypassable from configuration.

## What's genuinely new vs. what's Void with a rebrand

Real functional changes beyond the name (see `CHANGELOG.md` for the full list): the update-checker no longer phones home to Void's own GitHub org, the "transfer settings from another editor" feature no longer writes into a real Void install's data folder, and anonymous usage telemetry is hard-disabled (previously sent to Void's own analytics account) - these were bugs a naive rename would have left in place, not just branding.

## Known gaps (see the final report for the complete, current list)

- The XML tool-calling fallback grammar (for models without native function-calling) is still single-tool-per-turn - only the three native provider paths were extended to multiple. Multi-tab browser sessions are also not supported (single-item-at-a-time by design choice for this version, not oversight - see the code comments at each).
- A model turn with multiple tool calls, where one partway through needs interactive approval, does not resume the rest of that turn's calls after the user approves - the remaining calls in that specific batch are simply not attempted. This is a known, deliberate limitation of the current approve/resume mechanism, not a crash risk.
- A full, unpackaged Electron launch of this codebase (Vader or an unmodified Void checkout alike) does not reach a fully interactive workbench in the Linux sandbox this was built in - see `docs/integrations/windows-build.md` for what was verified (via CDP screenshots and console capture, not just log reading) and what's still unresolved.
- The Windows GitHub Actions build workflow (`.github/workflows/windows-build.yml`) has not been run - there's no Windows runner available here to test it against.
