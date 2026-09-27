# Plan Mode

**Where:** `voidSettingsTypes.ts` (`ChatMode`), `chatThreadService.ts` (`PlanObject`, `_maybeCaptureThreadPlan`, `READONLY_MODE_BLOCKED_BUILTIN_TOOLS`), `prompts.ts` (`chat_systemMessage`'s `plan` branch), `SidebarChat.tsx` (the plan banner).

## Audit finding this starts from

Void already shipped a "Gather" mode, described in its own UI as *"Reads files, but can't edit."* That claim was **not actually enforced anywhere** - `chatThreadService.ts`'s tool-execution gate (`_runToolCall`) never checked `chatMode` at all before this change. Gather mode's read-only-ness was prompt-level only: `availableTools()` in `prompts.ts` simply never told the model a mutating tool existed, so a native tool-calling model had nothing to call - but the XML tool-calling fallback grammar (used by models without native function-calling) parses tool tags out of raw text, and a model that hallucinated or was steered into emitting an `<edit_file>` tag anyway would have had it executed. This was a real gap, not a hypothetical one, and it's what "Plan Mode must be strictly read-only, hard-enforced" is actually asking to be true of.

## What's real now

1. **Hard enforcement, not just a missing tool definition.** `chatThreadService.ts`'s `_runToolCall` gains gate "1.45": in `gather` or `plan` mode, any built-in tool in `READONLY_MODE_BLOCKED_BUILTIN_TOOLS` (every file-write, terminal, delegation, memory-write, and browser-interaction tool) is rejected outright, and **every MCP tool call is rejected outright** (an MCP tool's side effects can't be verified as read-only from here). This runs regardless of what the model was told or attempted - the same "hard gate before approval" position as the Policy Engine and agent-scope checks, per this file's own numbered-comment convention (see `AGENTS.md`).
2. **`plan` is a new `ChatMode`**, alongside the existing `normal`/`gather`/`agent`. It gets the exact same prompt-level tool filter as `gather` (`availableTools()` in `prompts.ts`) plus the same hard execution-level gate above - Plan Mode is Gather Mode's read-only guarantee, made real, plus a plan-producing prompt on top.
3. **A structured plan, not prose.** In `plan` mode, the system prompt asks the model to end its response with a `<vader_plan>` block containing `<objective>`, `<phases>`, `<files_or_subsystems>`, `<constraints>`, `<validation_requirements>`, and `<unresolved_assumptions>` tags - only once it has done enough research, and explicitly *not* for a small, obvious change (Plan Mode is optional, never forced). `chatThreadService.ts`'s `_maybeCaptureThreadPlan` parses this into a `PlanObject` and stores it on `ThreadType.activePlan` (additive/optional field - old persisted threads never have one, no migration needed).
4. **Structured Plan→Execute handoff.** `SidebarChat.tsx` shows a "Plan ready" banner with the objective and two actions:
   - **Approve & Execute**: switches the thread's chat mode to `agent` and calls `IAgentGatewayService.startTask` with a message built from every field of the `PlanObject` (not just the raw plan text the model wrote) - phases, files, constraints, validation requirements, and assumptions are each carried through explicitly.
   - **Discard**: clears `activePlan` without executing anything.
   Because the plan lives as structured fields on the thread (not free text the agent has to re-parse), a later phase's Agent Manager UI can render/edit it directly.
5. **Revising a plan**: since the thread stays in `plan` mode until the user explicitly approves or discards, replying with feedback ("actually, don't touch the auth module") just continues the read-only research turn; the model is instructed to emit a fresh `<vader_plan>` block reflecting the change, which overwrites `activePlan` (a plan with no meaningfully parsed content never overwrites a previously-captured real one, so a stray reply that doesn't include a plan block can't silently wipe it).

## What's intentionally not (yet) built

- No dedicated Plan Mode UI beyond the banner - no phase-by-phase checklist view, no inline editing of individual plan fields before approving. The `PlanObject` itself is fully structured and ready for that; today's banner is the minimum real, working handoff, not a placeholder.
- Revising a plan happens by chatting normally in Plan Mode, not via a dedicated "revise" UI action distinct from just replying - functionally equivalent (the model re-plans and the new block overwrites the old), but no separate button exists yet.
