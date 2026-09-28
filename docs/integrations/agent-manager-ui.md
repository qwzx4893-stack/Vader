# Agent Manager UI, Memory UI, Model Router UI

Three Settings sections, all reading fully real, live-updating service state - not mockups:

## Memory UI (`MemorySection`)

Lists project memory and agent memory (`common/memory/`), grouped, with per-record removal and a "Clear all" per scope. Agent-scoped records show the owning agent's name (resolved via `IAgentsService.getAgent`, falling back to "(deleted agent)" if the agent was since removed - a record isn't deleted just because its agent is). Never shows model reasoning/chain-of-thought - only what a `remember` tool call actually wrote (`label`/`content`), which is all `MemoryRecord` contains.

## Agent Manager (`AgentManagerSection`)

Live visibility into `IAgentOrchestrationService.runs` (Phase 5's parallel-agent orchestration): every run, most recent first, with each task's status, agent (if any), worktree/merge outcome (if isolated), changed-file count, and error message (if any) - all read directly off real orchestration state, not summarized or delayed.

**Scoping note**: this is built as a Settings section, following the same pattern as `AgentsAndPolicySection`/`ModelRouterSection`/`SkillsSection`, rather than a new standalone workbench view with its own activity-bar icon. A dedicated panel is real, additional VS Code workbench plumbing (view container registration, icon, layout) - a separate, well-scoped piece of UI work, not something to half-build here. What it would show is already fully implemented and real (`IAgentOrchestrationService`'s live state); only the "its own pane" presentation is deferred.

## Model Router UI (`ModelRouterSection`, extended)

Already had an Auto/Manual toggle and read-only visibility into what each category resolves to. This pass adds the actual per-category override picker the mission's "Model Router UI (AUTO/MANUAL, per-feature)" asks for: a dropdown per category (`subagent`/`research`/`browser`/`summarization`/`verification`) listing every currently configured model plus a "(default: Chat model)" option, calling `IModelRouterService.setCategoryOverride` directly. The picker is always visible; a note clarifies it only takes effect in Manual mode, since Auto mode's `_autoSelect` deliberately ignores overrides (see `docs/integrations/model-router.md`).
