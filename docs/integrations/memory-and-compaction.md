# Memory layers and context compaction

**Memory contract:** `IMemoryService` in `common/memory/memoryServiceTypes.ts`. **Implementation:** `common/memory/memoryService.ts`. **Compaction:** `chatThreadService.ts`'s `_maybeCompactThread`, using prompts in `common/prompt/prompts.ts`'s "context compaction" section.

## The six memory layers, and where each one actually lives

The mission's memory architecture asks for six separated layers. Three of them are not separate storage - they're already exactly something else in this codebase, and duplicating them here would just create a second, driftable copy of the same data:

| Layer | Where it actually lives |
|---|---|
| Immediate conversation | `IChatThreadService`'s `ThreadType.messages` (unchanged) |
| Current task | Same - a thread *is* a task in this architecture |
| Temporary subagent scratch memory | A hidden subagent thread's own `messages`, discarded once `runSubagentTask` returns its structured `SubagentTaskResult` - never written to `IMemoryService` |
| **Project memory** | `IMemoryService`, `scope: 'project'`, keyed by workspace root path - **new** |
| **Persistent agent memory** | `IMemoryService`, `scope: 'agent'`, keyed by agent id - **new** |
| **Compacted summaries** | `ChatMessage`'s new `compacted_summary` role, inline in the thread; the raw messages it replaced go to `IMemoryService`, `scope: 'compactionArchive'` - **new** |

## Writing memory

The `remember` tool (`toolsService.ts`) lets the Main Agent (or any thread) write project memory, or agent memory when running as a named permanent agent (`remember(content, label, scope, agent_name?)` - requires `agent_name` when `scope` is `"agent"`). It goes through the 'edits' approval bucket, same as `create_persistent_agent`, since writing memory silently shapes every future turn. There's currently no tool-based path for an agent to write another agent's memory (only its own, when running as that agent) or to update/delete a memory record - those are user-only operations, via Settings' `MemorySection` (see `docs/integrations/agent-manager-ui.md`), which calls `IMemoryService.remove`/`clearScope` directly (no per-record edit yet, only remove).

## Reading memory back into a turn

`convertToLLMMessageService.ts`'s `_getCombinedAIInstructions` reads `IMemoryService.list('project', workspaceRoot)` and, when running as an agent, `list('agent', agentId)`, rendering each as a bullet and feeding them into `IInstructionsService`'s layered composition as two new layers (`projectMemory`, right after `workspace`; `agentMemory`, right after `agent`) - see `instructionsService.ts`. Memory is therefore visible to the model as ordinary instructions, not as a special tool result the model has to ask for.

## Context compaction

`chatThreadService.ts`'s `_runChatAgent` calls `_maybeCompactThread(threadId, modelSelection)` at the start of every turn, before assembling that turn's messages. It:

1. Estimates the thread's total content length (chars/4 heuristic, matching `convertToLLMMessageService.ts`'s own existing heuristic) against the model's usable window (`contextWindow - reservedOutputTokenSpace`, from `getModelCapabilities`).
2. If usage is under 70% of that window, does nothing - this is a cheap check on every turn, not a rare cron job.
3. Otherwise, takes every message after the last existing `compacted_summary` (so a thread is never re-compacted past a point it's already compacted), minus the most recent 6 messages (always kept in full - a compaction pass should never remove context from the turn that's actively in progress), and - if that's still at least 6 messages - sends them to the model with `contextCompaction_systemMessage`, which asks for a structured summary (objective/constraints/decisions/architecture notes/files modified/important locations/unresolved problems/test results/next steps), each in its own tag.
4. Archives the exact raw messages being replaced into `IMemoryService` (`scope: 'compactionArchive'`, keyed by thread id, capped at 20 archived compactions per thread) - compaction is never a silent, permanent loss of history.
5. Splices the thread's persisted messages: the compacted range becomes one `compacted_summary` message; everything before and after (the preserved tail) stays untouched.

If the summarization call itself fails (provider error, offline), compaction is skipped for that turn - it's a best-effort optimization, not load-bearing. the original safety net, `convertToLLMMessageService.ts`'s `prepareMessages` (blind per-message character truncation when the final assembled request would still be too big), is untouched and still runs as the last resort if compaction didn't get to a message in time; the two aren't in tension, since compaction runs first, with a safety margin, and truncation only ever sees what compaction left behind.

## What isn't done here

- **Memory UI** (inspect/clear/scope) now exists - Settings' `MemorySection`, see `docs/integrations/agent-manager-ui.md`. It supports browse/remove/clear-scope; per-record editing (changing a label/content in place rather than removing and re-writing) isn't built.
- **Compaction uses the Chat feature's model selection**, not a dedicated cheaper "Summarization" category - there's no such category in `ModelSelectionOfFeature` yet (see the Model Router section of `ARCHITECTURE.md`). Functionally correct today; not yet cost-optimal.
- **No agent-to-agent memory writes** - an agent can only write its own memory (when running as that agent) or project memory, never another named agent's memory record.
