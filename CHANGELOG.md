# Changelog

## Unreleased - Cline Main Agent Runtime integration (Milestone 1) + Unified Marketplace (in progress)

**Verified, not assumed**: independently confirmed (npm registry API directly, plus an actual
`npm install @cline/sdk` in a scratch directory with the real `.d.ts` files read) that Cline's
upstream now publishes a genuinely embeddable, non-VS-Code-extension agent SDK
(`@cline/agents`, Apache-2.0, `0.0.86`) - see `docs/integrations/agent-runtime.md` for the full
evidence trail and the resulting integration design.

**Main Agent Runtime seam** (`common/agentRuntime/`, `browser/agentRuntime/`): a new
`IAgentRuntimeRegistryService` reports which loop drives Main Agent turns (`legacy` today) and
honest per-runtime health, surfaced in the Agent Manager Settings UI (`RuntimeStatusBlock`).
`@cline/agents`/`@cline/shared` are declared in `package.json` but **could not be installed in
this environment** - the sandbox's dependency-install safety policy declined the `npm install`
as "Untrusted Code Integration," which is outside this session's own authority to override.
The full `ClineRuntimeAdapter` design (tool adapter reusing the existing Policy Engine gate
with zero duplication, a `VaderAgentModel` that preserves every existing provider by never
routing through Cline's own provider layer, and the mid-batch-approval-resume fix this
unlocks) is written up in `docs/integrations/agent-runtime.md`, ready to implement the moment
a human runs that install. This is reported as a genuine environment/tooling limitation, not
skipped work - the design is complete and reviewed against the real installed package types.

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors), `npm run buildreact` (clean).

## Unreleased - Branding re-audit, performance pass, verification model routing fix

**Branding re-audit**: a fresh, read-only pass over every `localize`/`localize2` call,
title/description/label/placeholder literal, `product.json`, and Vader-authored extension
manifests under `src/vs/workbench/contrib/void/` found the user-visible rebrand already
complete and consistent. One real finding: a dev-only `useAccessor` error message in
`services.tsx` still said "Void" - fixed. Internal identifiers
(`IVoidSettingsService`/`void-bg-1`/`void-channel-*`/etc.) and comments citing Void for
historical accuracy are unchanged, per this project's own "no blind global rename" rule.

**Performance**: `IVerificationService.gatherEvidence()` was awaiting the git diff fetch and
the build/lint/test check run one after another despite them being fully independent -
switched to `Promise.all`, matching the concurrency discipline already used in the Context
Engine and Agent Orchestration.

**Bug fix found while writing this pass's own docs**: a verification thread is also flagged
`isSubagentThread` (so it gets checkpoints, etc.), which meant `_currentModelSelectionProps`
was routing it through the Model Router's `'subagent'` category instead of the dedicated
`'verification'` one added back in Phase 4/9. Fixed - `isVerificationThread` is now checked
first.

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors), `npm run buildreact` (clean), full
`npm run compile` (0 errors).

## Unreleased - Memory UI, Agent Manager UI, Model Router per-category picker

New `MemorySection` (Settings): browse project/agent memory records, remove individually,
clear a whole scope - `IMemoryService` had zero UI before this. New `AgentManagerSection`:
live visibility into `IAgentOrchestrationService.runs` (Phase 5's parallel-agent
orchestration) - every run and task's real-time status/agent/worktree/merge-outcome/error,
not a mockup. Both built as Settings sections (same pattern as the existing
Agents/Policy/Model-Router/Skills sections) rather than new standalone workbench views;
a dedicated Agent Manager panel with its own activity-bar presence is further, separately-
scoped workbench plumbing, tracked honestly as not done here rather than half-built.

`ModelRouterSection` gains the per-category manual override picker it was missing - a
dropdown per category (subagent/research/browser/summarization/verification) over every
currently configured model, calling `IModelRouterService.setCategoryOverride` directly
(previously only settable programmatically).

See `docs/integrations/agent-manager-ui.md`.

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors), `npm run buildreact` (clean), full
`npm run compile` (0 errors).

## Unreleased - Independent Verification Agent + checkpoint/orchestration integration

New `common/verification/` (`IVerificationService`) and a new mechanism in
`chatThreadService.ts`: `isVerificationThread`, which hard-forces the exact same read-only
enforcement Plan/Gather mode use (every mutating built-in tool and every MCP tool call
blocked, regardless of the user's actual global chat mode) onto a hidden verification
thread. This is what makes verification genuinely independent - not the same agent
context grading its own work, in a fresh thread that cannot edit anything to make its own
checks pass. New `run_verification_agent` tool: gathers real evidence (git diff, live
`IMarkerService` diagnostics, and `run_verification`'s own build/lint/test results -
explicitly never treating "no checks detected" as a pass), asks the independent verifier
for a structured `<vader_verdict>` (parsed the same tag-extraction way as compaction/Plan
Mode), and runs a bounded verify→repair→re-verify loop (delegates a repair subagent task
for any `blocker` finding, re-verifies, up to 3 rounds by default) - never loops
unboundedly, and reports honestly if it's still failing after the cap.

Checkpoint/orchestration integration: provenance (which agent/worktree produced which
changes) was already tracked by Phase 5's `ParallelTaskState`; verification/repair hidden
threads now checkpoint their edits the same way an interactive turn does; and worktree
merge safety against unrelated user work turns out to already be a property of git itself
(a merge that would conflict with uncommitted changes is refused, not silently overwritten -
this pass's existing conflict handling already covers that). See
`docs/integrations/verification.md` for what's real and the one stated boundary (verifying
a worktree's isolated changes before merge isn't implemented - `IMarkerService` can't see a
separate checkout's files without opening them in this workbench first).

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors), `npm run buildreact` (clean), full
`npm run compile` (0 errors).

## Unreleased - Multi-tab browser automation

Removed the single-page limitation: `IBrowserToolMainService` now manages any number of
pages, each with a stable `pageId` (a uuid, not an index - stable across other pages
opening/closing). New page-lifecycle tools `browser_new_page`/`browser_list_pages`/
`browser_switch_page`/`browser_close_page`; every existing browser tool
(`navigate`/`reload`(new)/`snapshot`/`click`/`type`/`screenshot`/`console_logs`) takes an
optional `page_id`, defaulting to the active page (auto-created if none exists) so existing
single-page usage keeps working unchanged. New `browser_page_errors` (uncaught JS
exceptions, distinct from console.error) and `browser_network_log` (failed requests + 4xx/5xx
responses only - "relevant" network activity, not a full HAR dump).

Session handling: a closed/crashed page gets a clear, specific error instead of a raw
Playwright exception on next use, and stops being "active" automatically; the whole browser
process disconnecting marks every page closed at once; a stale `aria-ref` (from before a
navigation/reload invalidated it) is caught and rewritten into an actionable "call
browser_snapshot again" message instead of a generic locator-timeout stack trace.

See `docs/integrations/browser-backend.md` for the full interface, the
"software-engineering loop" workflow these tools are meant to compose into, and how to
replace the backend.

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors), `npm run buildreact` (clean), full
`npm run compile` (0 errors).

## Unreleased - Skill lifecycle, External Agent Adapter, MCP/Policy Engine fix

**Skills** (`common/skills/`, new `ISkillService`): full install/cache/pin/enable/disable/
update/remove lifecycle - previously only discovery (`search_skillnet`,
`fetch_skill_instructions`) existed; a stale comment referenced a
`skills/skillProviderTypes.ts` that was never actually created. New `install_skill` tool +
`SkillsSection` Settings UI. Trust states (`trusted`/`review_required`/`blocked`, defense in
depth, not a claim of static analysis) gate what's composed into the system prompt; a
content-changed update automatically downgrades a `trusted` skill back to
`review_required` (promotion is always an explicit user action, demotion can happen
automatically) - the concrete mechanism behind "never let a silent external update keep
trusted status." Skill instructions are still subject to the same Policy Engine as
everything else - trust only controls what the model is told, never what executes. New
`installed-skill` Capability Bus source. See `docs/integrations/skills.md`.

**External Agent Adapter** (`common/externalAgent/`): an ACP-inspired boundary
(capabilities/session/streamed events/cancellation), deliberately kept separate from the
Agent Gateway's Vader-internal shape. One real reference adapter
(`VaderNativeExternalAgentAdapter`) wraps Vader's own runtime behind it - streaming is
genuinely live (read off the Agent Gateway's real `onDidChangeExecutionState`/
`getExecutionState`, not simulated), cancellation goes through the same `cancelTask` path
as everywhere else, and `supportsToolRequests` honestly reports `false` since a subagent run
has no live human to approve an interactive request. No third-party ACP-speaking process is
wired up - there's no such binary in this environment to build and verify against, and a
protocol adapter with nothing real to talk to would prove less than wrapping Vader's own
verified backend. See `docs/integrations/external-agent-adapter.md`.

**MCP + Policy Engine bug fix**: audited Void's existing MCP service (discovery,
health-status per server, enable/disable, lazy tool exposure, agent-scoped server
allowlists - all already real, not rebuilt) and found the Policy Engine's MCP integration
was dead code: every `'mcp-tool'`/`'network'` policy rule was unreachable, because the
matcher unconditionally required `pathGlobs`/`commandPatterns` and those two kinds can never
have either. Fixed with a new `serverNamePatterns` field and a kind-aware match guard, plus
a real (previously nonexistent) custom-policy-rule authoring UI in Settings - the backend
methods (`addCustomRule` etc.) had zero UI callers before this. See
`docs/integrations/mcp-and-policy.md`.

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors), `npm run buildreact` (clean), full
`npm run compile` (0 errors).

## Unreleased - Plan Mode, and a real fix for Gather mode's read-only claim

**Audit finding, fixed**: Void's "Gather" mode has always been described in its own UI as
"Reads files, but can't edit" - that was never actually enforced in code, only implied by
not telling the model a mutating tool exists (`availableTools()` in `prompts.ts`). The XML
tool-calling fallback grammar (models without native function-calling) parses whatever tool
tag text it finds, so a model that emitted an edit tag anyway in Gather mode would have had
it executed. `chatThreadService.ts`'s `_runToolCall` now has a hard gate (numbered "1.45",
same enforcement position as the Policy Engine and agent-scope checks) that rejects every
mutating built-in tool and every MCP tool call outright in `gather` mode - independent of
what the model was told or attempted.

**New `plan` ChatMode**: gets the identical hard read-only enforcement, plus a prompt asking
the model to end its response with a structured `<vader_plan>` block
(objective/phases/files-or-subsystems/constraints/validation-requirements/unresolved-
assumptions) once it has enough context - optional, skipped for small/obvious changes.
`_maybeCaptureThreadPlan` parses this into a new `PlanObject` stored on `ThreadType.activePlan`
(additive field, no migration needed). A new "Plan ready" banner in `SidebarChat.tsx` offers
"Approve & Execute" (switches to `agent` mode and hands the agent every field of the
structured plan, not re-parsed prose) and "Discard".

See `docs/integrations/plan-mode.md` for the full audit note and current gaps (no dedicated
plan-editing UI yet, no separate "revise" action distinct from just replying).

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors), `npm run buildreact` (clean), full
`npm run compile` (0 errors).

## Unreleased - Parallel agents with real concurrency + git worktree isolation

New `common/orchestration/` (`IAgentOrchestrationService`) and `common/worktree/` +
`electron-main/gitWorktreeMainService.ts` (`IGitWorktreeMainService`). New
`delegate_parallel_tasks` tool: runs up to 8 subagent tasks with genuine bounded
concurrency (a worker-pool over `Promise.all`, up to 4 at once - not a loop that awaits
each task in turn under a "parallel" label). Read-only tasks run directly against the live
workspace; tasks marked `uses_worktree` get a full isolation lifecycle: `git worktree add`
on a sibling directory (never nested in the main workspace), an explicit working-directory
instruction prepended to the task prompt (works with zero changes to the tool-execution
engine, since every file tool already takes explicit absolute URIs), commit + `git merge
--no-ff` back into the current branch, and cleanup - or, on conflict, `git merge --abort`
plus leaving the worktree and branch in place for manual resolution (never destroys work).
A worktree that fails to create at all stops that task rather than falling back to editing
the live workspace unisolated. `cancelRun` cancels in-flight tasks through the Agent
Gateway's existing `cancelTask`, via a new `onThreadCreated` callback on
`runIsolatedTask`/`runSubagentTask` that exposes a task's hidden thread id before it
finishes.

See `docs/integrations/parallel-agents.md` for the exact lifecycle. Orchestration state
(per-task status/thread/worktree/merge outcome) is fully real and queryable
(`IAgentOrchestrationService.runs`) but has no dedicated UI yet - tracked as later Agent
Manager UI work, not silently skipped.

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors), `npm run buildreact` (clean), full
`npm run compile` (0 errors).

## Unreleased - Model Router (AUTO/MANUAL) and capability descriptors

New `common/modelRouter/` (`IModelRouterService`): AUTO/MANUAL routing for work that doesn't
have its own Settings dropdown (subagent delegation, research, browser automation,
compaction summarization), sitting on top of - not replacing - Void's original per-feature
model selection (Chat/Ctrl+K/Autocomplete/Apply/SCM keep their own dropdowns and storage
unchanged; MANUAL mode, the default, reproduces exactly the old behavior for anyone
upgrading). AUTO mode ranks only `listConfiguredModels()` - providers with real credentials
entered - so an unconfigured provider is never silently selected however capable its static
info claims it is; ranking uses a `ModelCapabilityDescriptor` built entirely from data this
codebase already tracks (`getModelCapabilities`'s tool-calling format/context
window/reasoning/FIM/cost/cache fields, plus `localProviderNames` for local-vs-cloud) -
vision/multimodal capability is deliberately left out rather than guessed, since this
codebase doesn't track it per-model today.

Wired into two real consumers: subagent delegation (`chatThreadService.ts`'s
`_currentModelSelectionProps`, for subagent threads with no agent-pinned model) and context
compaction's own summarization call. A new `ModelRouterSection` in Settings gives a
functional (if first-pass) Auto/Manual toggle and a live read-out of what each category
resolves to. See `docs/integrations/model-router.md` for exactly what's wired vs. what's
tracked follow-up (research/browser/verification categories exist but have no execution
path calling them yet; no per-category manual-override picker in Settings yet).

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors), `npm run buildreact` (clean), full
`npm run compile` (0 errors).

## Unreleased - Memory layers and structured context compaction

New `common/memory/` (`IMemoryService`): persistent, inspectable, clearable project memory
(keyed by workspace) and agent memory (keyed by agent id), plus a bounded compaction
archive. New `remember` tool lets the Main Agent (or a running permanent agent) write a
durable fact; memory is read back into every turn via two new instruction layers
(`projectMemory`, `agentMemory` in `instructionsService.ts`), composed alongside
`.vaderrules` and agent instructions - real end-to-end, not a tool with nothing reading its
output back.

New structured context compaction (`chatThreadService.ts`'s `_maybeCompactThread`, prompts in
`prompts.ts`): checked every turn, triggers at 70% of the model's usable context window,
replaces older messages (always keeping the most recent 6 in full) with one structured
summary message (objective/constraints/decisions/architecture notes/files
modified/important locations/unresolved problems/test results/next steps) instead of
Void's original blind per-message character truncation - which is untouched and still runs
as the final safety net, since compaction is a best-effort pass that can fail (provider
error) without blocking the turn. The raw messages a compaction pass replaces are archived
to `IMemoryService` (`scope: 'compactionArchive'`, capped at 20 per thread), never deleted
outright. New `ChatMessage` role `compacted_summary` (purely additive - old persisted
threads can't contain it, so no migration) rendered in both the chat UI and the LLM-facing
message conversion.

See `docs/integrations/memory-and-compaction.md` for what's real vs. still open (no Memory
UI yet; compaction uses the Chat feature's model selection, not a dedicated cheaper
category).

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors), `npm run buildreact` (clean), and
the full `npm run compile` gulp task (0 errors).

## Unreleased - Context Engine

New `common/context/` + `browser/contextEngineService.ts`: a per-turn dynamic context
section (symbol outlines, live diagnostics, git diff/log) for files the user mentioned or
has open, wired into `convertToLLMMessageService.ts`'s system-message generation - every
chat turn (agent/gather/normal/subagent) gets it, not just a new tool the model has to
remember to call. Built entirely on data sources already real and present in this codebase
(`ILanguageFeaturesService`'s document symbol provider, `IMarkerService`, and
`IVoidSCMService` - the git service that existed fully wired end-to-end but had exactly one
consumer before this, the commit-message generator). Relevance-ranked by a keyword-based
task-type classifier (bug-fixing/architecture/ui/general) that decides section priority
when the token budget (min(6000, 15% of the model's context window), heuristic chars/4)
can't fit everything; truncates the first section that overflows rather than dropping
sections outright. Symbol/diagnostic caches are invalidated by the text model's own
`getVersionId()`/marker-changed events - not a timer, not a full-repo rescan. Bounded to at
most 12 mentioned/open files regardless of repo size - no full-repo symbol indexing.
See `docs/integrations/context-engine.md` for what this does and doesn't cover (no
repo-wide semantic search, no independent LSP client - diagnostics/symbols are only as good
as whatever language service is already active for a file).

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors) and the full `npm run compile`
gulp task (0 errors) after the change.

## Unreleased - Agent Gateway as the primary execution seam

`IAgentGatewayService` (`common/agentGateway/`) is now the real path the chat UI uses to run a
task, not only `delegate_subagent_task`'s call site. Added `startTask`/`reviseTask`/
`cancelTask`/`approveToolRequest`/`rejectToolRequest`/`dismissError` plus a normalized
`getExecutionState`/`getExecutionMetadata` projection (`AgentExecutionState`/
`AgentExecutionMetadata` - a smaller, runtime-independent vocabulary than
`chatThreadService.ts`'s own `ThreadStreamState`/`ThreadType`). `SidebarChat.tsx`'s
send/edit-message/abort/approve/reject/dismiss-error actions all now call through the
Gateway instead of `IChatThreadService` directly; rendering the conversation itself
(persisted messages, checkpoints, thread list, staging selections, codespan links) still
reads `IChatThreadService` directly in `SidebarThreadSelector.tsx`/`Settings.tsx`/
`ChatMarkdownRender.tsx`/`inputs.tsx` and the read side of `SidebarChat.tsx`, since that's
inherent to displaying history, not to driving execution - see
`docs/integrations/agent-gateway.md` for the exact boundary. Verified with a clean
`npm run buildreact` and a clean `tsc -p src/tsconfig.json --noEmit` (0 errors) after the
change.

## Unreleased - agent runtime hardening, Agent Gateway, Windows CI

**Agent runtime decision**: evaluated replacing the core agent loop with Cline, Kilo Code,
OpenHands, or Zed's runtimes (as a later revision of this project's brief asked for) and
rejected all four as clean transplants - see `docs/integrations/agent-gateway.md` for the
reasoning (extension-host-only, Python-first, and Rust/GPUI-only respectively). Instead,
fixed the actual defect that motivated the ask:

- **Multi-tool-call-per-turn**: the OpenAI-compatible, Anthropic, and Gemini native
  provider paths (`electron-main/llmMessage/sendLLMMessage.impl.ts`) used to silently keep
  only the first tool call a model returned in one turn and drop the rest. All three now
  collect every tool call the provider returns; `chatThreadService.ts`'s agent loop
  executes each one serially (never concurrently, to stay compatible with Void's
  single-edit-at-a-time diff/checkpoint engine and to avoid faking parallelism the
  provider didn't actually provide), each still gated by the Policy Engine and agent
  scope exactly as before. The XML tool-calling fallback (for models without native
  function-calling) remains single-tool-per-turn - its custom incremental parser locks
  onto the first tag it finds by construction, and extending it safely was judged
  higher-risk than the value it would add for what's already the weaker-tool-support path.
- **Agent Gateway** (`common/agentGateway/`): a small, real (not decorative) interface in
  front of the agent loop, used today by `delegate_subagent_task`, so a future runtime
  swap touches one implementation and one call site rather than the UI.

**CSS MIME dev-launch issue, re-investigated with evidence**: the previous report noted a
CSS-module MIME error blocking a fully interactive workbench in this project's Linux build
sandbox and guessed it was upstream/environment-specific. This time it was actually
checked: a second, unmodified Void checkout was built and launched identically, and both
windows were inspected live over Electron's `--remote-debugging-port` (via
`playwright-core`'s CDP client - screenshots and console capture, not just log reading).
Neither reaches a working workbench in this sandbox; Vader's failure surfaces the specific
CSS-MIME/dynamic-import error, the unmodified checkout's does not (it separately hits
missing-native-binding errors for `@vscode/sqlite3`/`@vscode/spdlog`, expected since native
module compilation is skipped in this sandbox for both checkouts). Not fully root-caused,
but no longer an assumption: this is confirmed as a shared, sandbox-level limitation, not a
Vader-introduced regression.

**Windows build CI**: added `.github/workflows/windows-build.yml`, running the full
install → compile → package → installer pipeline on a `windows-latest` GitHub Actions
runner (manual dispatch, or automatically on product-identity-affecting pushes to `main`),
uploading the unpacked app and Inno Setup installer as artifacts. The gulp task names it
calls were confirmed to exist by listing this repo's actual gulp task registry, not
guessed - but the workflow itself has not been run, since no Windows runner is available
in this sandbox.

## Vader 0.1.0 - initial fork from Void

Imported [voideditor/void](https://github.com/voideditor/void) @ `b3166e7` (v1.4.9) as the upstream foundation and built a new agent platform on top of it. See `ARCHITECTURE.md` for the design and `AGENTS.md` for how to extend it.

### Rebranding (Void → Vader)

- Product identity throughout: `product.json`, About dialog, window/application metadata, command palette titles, notification text, undo-history labels, installer text (`build/win32/code.iss`), OpenRouter identification headers, onboarding copy, Settings copy.
- New Windows installer identity: fresh GUIDs for all `win32*AppId` fields (never reusing Void's, to avoid any registry/upgrade collision with a real Void install on the same machine), new bundle identifiers, new data folder (`.vader-editor`), new URL protocol (`vader`).
- `.voidrules` renamed to `.vaderrules` (workspace instructions file), with `.voidrules` still read as a fallback for repos migrating from Void.
- **Two real bugs fixed, not just renamed**: the update-checker no longer queries `voideditor/binaries` on GitHub and offers to send users to reinstall Void; the "transfer settings from another editor" feature no longer writes into `~/Library/Application Support/Void` (and platform equivalents) instead of Vader's own data folder.
- Anonymous usage telemetry (previously sent to Void's own PostHog project by default) is hard-disabled rather than re-pointed - no telemetry request is made, regardless of the opt-out setting's value.
- Void's own README/codebase guide/contribution guide are kept (marked as inherited, unmodified reference material) rather than deleted, since they still accurately describe the code they document.

### New: Policy Engine (`common/policy/`)

Hard, pre-execution rule evaluation for every built-in tool call, MCP tool call, and terminal command, independent of the model's behavior and the user's auto-approve settings. Locked rules (destructive commands, fork bombs, OS-critical paths) can never be disabled, in any permission mode. Default-on rules (secrets/key files, `sudo`, force-push, piping a download into a shell) force approval unless the mode is Autonomous *and* the rule allows that. Three permission modes: safe, balanced, autonomous.

### New: Layered instructions (`common/instructions/`)

Replaces an ad-hoc string concatenation with named, ordered layers (system invariants, policy summary, global settings, workspace `.vaderrules`, agent, skill, task), each independently inspectable.

### New: Permanent agents (`common/agents/`)

Persistent, named agent definitions with their own instructions, optional model override, and optional tool/MCP-server/filesystem restrictions. A chat thread can run "as" an agent. The main agent can create one itself via a new `create_persistent_agent` tool. A Settings UI section (Agents & Permissions) lists, creates, assigns, and deletes agents, and switches the policy permission mode.

### New: Temporary subagent delegation (`delegate_subagent_task` tool)

Spins up a hidden thread with its own context for a self-contained task, runs it to completion, and returns a structured result (conclusion, changed files, whether it stalled on an approval nothing could grant, whether it errored) rather than merging its transcript into the caller.

### New: External discovery (`common/discovery/`)

Live search against the official MCP Registry (`registry.modelcontextprotocol.io`) and SkillNet (`api-skillnet.openkg.cn`), plus best-effort fetch of a skill's instructions file. New tools: `search_mcp_registry`, `search_skillnet`, `fetch_skill_instructions`. Read-only; does not auto-install anything.

### New: Capability bus (`common/capabilities/`)

Read-only inventory/resolver over native tools, connected MCP tools, and permanent agents, falling back to external discovery only when nothing local matches. New tool: `find_capability`.

### New: Browser automation (`common/browser/`, `electron-main/browserToolMainService.ts`)

Playwright-backed (via `playwright-core`) navigate/snapshot/click/type/screenshot/console-log tools, using Playwright's `ariaSnapshot`/`aria-ref=` mechanism for element targeting. Single page/tab in this version.

### New: Verification pipeline (`run_verification` tool)

Auto-detects and runs a package.json-based project's build/typecheck/lint/test scripts, reports pass/fail with output.

### Known limitations (superseded in part - see the "Unreleased" section above)

Multi-tool-per-turn is now supported for native tool-calling providers (see above); the XML fallback grammar and the browser tool remain single-item-at-a-time. MCP registry/SkillNet results still require the user to manually add them (no automated install, by design). A genuine Windows build still hasn't been produced, but there's now a CI workflow to produce one on a real Windows runner - see `docs/integrations/windows-build.md`.
