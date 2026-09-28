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
| Browser automation | `common/browser/`, `electron-main/browserToolMainService.ts` | Playwright-backed, multi-tab: navigate/reload/snapshot/click/type/screenshot/console/page-errors/network-log, page create/list/switch/close with stable page ids; see `docs/integrations/browser-backend.md` |
| Context Engine | `common/context/`, `browser/contextEngineService.ts` | Per-turn dynamic context (symbol outlines, diagnostics, git diff/log) for mentioned/open files - relevance-ranked, token-budget-aware, incrementally cached; see `docs/integrations/context-engine.md` |
| Memory | `common/memory/` | Persistent project/agent memory (`remember` tool) + the compaction archive; see `docs/integrations/memory-and-compaction.md` |
| Context compaction | `browser/chatThreadService.ts` (`_maybeCompactThread`) | Structured summarization of older messages before the context window fills, with raw messages archived (not destroyed) to Memory |
| Model Router | `common/modelRouter/` | AUTO/MANUAL routing + machine-readable capability descriptors for subagent/research/browser/summarization/verification categories, on top of (not replacing) Void's per-feature Settings dropdowns; see `docs/integrations/model-router.md` |
| Agent Orchestration | `common/orchestration/`, `browser/orchestrationService.ts` | Real bounded-concurrency parallel subagent tasks (`delegate_parallel_tasks`), with git-worktree isolation for code-modifying ones; see `docs/integrations/parallel-agents.md` |
| Git worktree lifecycle | `common/worktree/`, `electron-main/gitWorktreeMainService.ts` | Create/execute/merge-or-conflict/cleanup for a single isolated worktree - used by Agent Orchestration |
| Plan Mode | `browser/chatThreadService.ts` (`PlanObject`), `common/prompt/prompts.ts` | Hard-enforced read-only research mode producing a structured plan with an Approve & Execute handoff into Agent mode; see `docs/integrations/plan-mode.md` (also fixes Gather mode's previously-unenforced read-only claim) |
| Skills | `common/skills/` | Full install/cache/pin/enable/disable/update/remove lifecycle + trust states (trusted/review_required/blocked), routed through the Policy Engine by never bypassing it; see `docs/integrations/skills.md` |
| External Agent Adapter | `common/externalAgent/`, `browser/vaderNativeExternalAgentAdapter.ts` | ACP-inspired boundary (capabilities/session/streamed events/cancellation), kept separate from the Agent Gateway; one real reference adapter backed by Vader's own runtime; see `docs/integrations/external-agent-adapter.md` |
| MCP + Policy | `common/mcpService.ts` (audited, unchanged), `common/policy/` | Fixed dead-code Policy Engine integration for MCP server permissions (`serverNamePatterns`) + a real custom-rule authoring UI; see `docs/integrations/mcp-and-policy.md` |
| Memory UI, Agent Manager, Model Router UI | `void-settings-tsx/Settings.tsx` (`MemorySection`, `AgentManagerSection`, extended `ModelRouterSection`) | Live, real Settings UI over Memory/Orchestration/Model Router state; see `docs/integrations/agent-manager-ui.md` |
| Checkpoints | `browser/editCodeService.ts`, `browser/chatThreadService.ts` (`CheckpointEntry`) | Inherited from Void, unmodified - per-file snapshot/restore tied to chat messages; every subagent/repair/verification hidden thread gets one too, same as an interactive turn |
| Verification | `browser/toolsService.ts` (`run_verification`), `common/verification/` (`run_verification_agent`) | Deterministic build/lint/test detection, plus an independent, hard-enforced-read-only Verification Agent with a bounded verify→repair→re-verify loop; see `docs/integrations/verification.md` |

## Extension points (how to add or replace something)

**Add a built-in tool**: three places, always together - `common/toolsServiceTypes.ts` (`BuiltinToolCallParams`/`BuiltinToolResultType`, plus `approvalTypeOfBuiltinToolName` if it should require approval), `common/prompt/prompts.ts` (`builtinTools`, the description/params the model sees), and `browser/toolsService.ts` (`validateParams`/`callTool`/`stringOfResult` - all three maps are exhaustive over tool names, so TypeScript will tell you if you miss one). If the tool needs Node/network access, put the real work in an `electron-main/*MainService.ts` behind an IPC channel (see `discoveryMainService.ts` or `browserToolMainService.ts` for the pattern) rather than reaching for Node APIs from browser code.

**Add a policy rule**: append to `builtInPolicyRules` in `common/policy/builtInPolicyRules.ts` (for something that should ship on by default) or use `IPolicyService.addCustomRule` (for a user/project-specific one, surfaced in Settings). `locked: true` rules can never be disabled from settings - reserve that for the "no legitimate use case" tier.

**Replace the browser backend**: everything outside `electron-main/browserToolMainService.ts` talks to `IBrowserToolMainService` (`common/browser/browserToolServiceTypes.ts`), not to Playwright directly. A different backend (a CDP-only client, vercel-labs/agent-browser, a remote browser) is a new class implementing that interface; nothing else changes.

**Replace SkillNet or the MCP Registry**: same shape - `common/discovery/discoveryServiceTypes.ts`'s `IDiscoveryMainService` is the contract; `discoveryMainService.ts` is one implementation of it. A different skill index or a self-hosted MCP registry is a new implementation behind the same interface.

**Add a new permission mode behavior**: `PolicyRule.neverBypassAutonomous` controls whether an `ask` rule survives switching to autonomous mode; `locked` rules always survive every mode. There is deliberately no way to make a `locked` rule bypassable from configuration.

## What's genuinely new vs. what's Void with a rebrand

Real functional changes beyond the name (see `CHANGELOG.md` for the full list): the update-checker no longer phones home to Void's own GitHub org, the "transfer settings from another editor" feature no longer writes into a real Void install's data folder, and anonymous usage telemetry is hard-disabled (previously sent to Void's own analytics account) - these were bugs a naive rename would have left in place, not just branding.

## Branding

A dedicated re-audit (a fresh, read-only pass over every `localize`/`localize2` call, title/description/label/placeholder literal, `product.json`, and Vader-authored extension manifests under `src/vs/workbench/contrib/void/`) found the user-visible rebrand already complete and consistent - the one real finding (a dev-only `useAccessor` error message in `services.tsx` still saying "Void") was fixed. Internal identifiers (`IVoidSettingsService`, `void-bg-1`, `void-channel-*`, etc.) and comments citing Void for historical/architectural accuracy are intentionally left alone - see `AGENTS.md`'s "no blind global source replacement" guidance.

## Known gaps (see the final report for the complete, current list)

- The XML tool-calling fallback grammar (for models without native function-calling) is still single-tool-per-turn - only the three native provider paths were extended to multiple, a deliberate scope boundary (see `docs/integrations/agent-gateway.md`), not an oversight.
- A model turn with multiple tool calls, where one partway through needs interactive approval, does not resume the rest of that turn's calls after the user approves - the remaining calls in that specific batch are simply not attempted. This is a known, deliberate limitation of the current approve/resume mechanism, not a crash risk.
- A full, unpackaged Electron launch of this codebase (Vader or an unmodified Void checkout alike) does not reach a fully interactive workbench in the Linux sandbox this was built in - see `docs/integrations/windows-build.md` for what was verified (via CDP screenshots and console capture, not just log reading) and what's still unresolved.
- The Windows GitHub Actions build workflow (`.github/workflows/windows-build.yml`) has not been run - there's no Windows runner available here to test it against.
- No genuine third-party ACP-speaking agent process is wired into the External Agent Adapter - only a reference adapter backed by Vader's own runtime exists (see `docs/integrations/external-agent-adapter.md` for why: there's no concrete external agent binary in this environment to build and verify against).
- Verifying a worktree-isolated parallel agent's changes *before* merging them (rather than only against the main workspace after) isn't implemented - `IMarkerService` can't report diagnostics for a separate checkout's files without opening them in this workbench first, and `run_verification`'s script-running is scoped to the main workspace root (see `docs/integrations/verification.md`).
- The Agent Manager, Memory, and Model Router UIs are real Settings sections (Phase 11), not a standalone dedicated workbench panel with its own activity-bar presence - the latter is further, separately-scoped workbench plumbing (see `docs/integrations/agent-manager-ui.md`).
- Research/browser Model Router categories are resolvable but nothing currently calls `resolveModel('research'|'browser')` specifically - there's no dedicated research-subagent or browser-driving execution path distinct from generic subagent delegation yet. ('verification' is wired - see `runVerificationTask`'s model selection in `chatThreadService.ts`.) See `docs/integrations/model-router.md`.
