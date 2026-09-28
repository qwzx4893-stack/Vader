# Independent verification, and checkpoint/orchestration integration

**Contract:** `IVerificationService` in `common/verification/verificationTypes.ts`. **Implementation:** `browser/verificationService.ts`. **Independent-agent mechanism:** `chatThreadService.ts`'s `isVerificationThread`/`runVerificationTask`. **Tool:** `run_verification_agent`.

## "Independent" means a different context, not just a different prompt

`run_verification` (existing, unchanged) is a deterministic tool: it runs the project's own build/typecheck/lint/test scripts and reports pass/fail with real exit codes. That's already about as independent as a check can be - it's not an LLM judgment at all.

What was missing is the mission's other half: a check for things exit codes can't catch (does the diff actually match the stated objective? is anything in it suspicious? does a passing test suite actually mean the task is done?). Asking the *same* agent that just made the change "did you do this correctly?" is grading your own homework - it has every incentive (explicit or not) to see its own work favorably. `runVerificationTask` fixes this the same way Plan Mode enforces read-only: a **new hidden thread** (`isVerificationThread: true`), forced into `gather`-equivalent tool availability and a **hard, execution-level block** on every mutating built-in tool and every MCP tool call (`chatThreadService.ts`'s `_runToolCall` gate, extended to check `isVerificationThread` in addition to the global chat mode) - regardless of whatever the user's actual Agent/Gather/Plan toggle is set to. A verifier that could edit a file to make its own check pass would defeat the entire point.

## What evidence it's given - real, not self-reported

`IVerificationService.gatherEvidence()`:
- **Git diff** (`git diff --stat` via `IVoidSCMService`, the same real git service `mcp-and-policy.md` describes).
- **Live diagnostics** (`IMarkerService`, current workspace-wide errors/warnings - the same data source the Context Engine and Problems panel use).
- **Build/typecheck/lint/test results** - calls `IToolsService.callTool['run_verification']` directly rather than re-implementing project-command auto-detection a second time.

This is rendered into plain text and handed to the verification thread alongside the stated objective (`verificationAgent_userMessage` in `prompts.ts`). **Absence of checks is never silently treated as a pass**: if `run_verification` couldn't auto-detect anything, the evidence text says so explicitly and instructs the verifier to weigh that as "unverified by automated checks," not as "verified."

## The verdict, and the bounded verify→repair→re-verify loop

The verification thread must respond with a structured `<vader_verdict>` block (`passed`/`findings` with severity `blocker|warning|info`/`summary`), parsed by `parseVerificationVerdict` in `chatThreadService.ts` - the same tag-extraction convention used for compaction and Plan Mode elsewhere in this codebase. An unparseable response fails safe: `passed: false` with a blocker finding saying verification couldn't be completed, never silently treated as passing.

`runVerifyRepairLoop` (exposed as the `run_verification_agent` tool):
1. Runs one independent verification pass.
2. If there are no `blocker` findings (only warnings/info, or none), stops - passed.
3. Otherwise, delegates a repair subagent task (via the Agent Gateway's `runIsolatedTask`, same mechanism as `delegate_subagent_task`) describing exactly the blocker findings, then re-verifies.
4. Repeats up to `maxIterations` (default 3) - **never loops unboundedly**. If still failing after the cap, it reports the final verdict and every repair attempt's conclusion, honestly, rather than declaring success to end the loop.

## Checkpoint and orchestration integration

- **Provenance**: `common/orchestration/`'s `ParallelTaskState` already records which `agentName` and which `worktreePath`/`branchName` produced a given set of `changedFilePaths` - this *is* the "track which agent/worktree produced which changes" requirement; it's surfaced in `delegate_parallel_tasks`'s tool result and the merge commit message (`"Parallel agent: <task>"`).
- **Checkpoint-before-dangerous-modification**: already existed for the interactive path (`chatThreadService.ts`'s `_addToolEditCheckpoint`/`_addUserCheckpoint`, unmodified here) and now also exists for verification/repair: `runVerificationTask` and every subagent/repair task create a checkpoint on their own hidden thread the same way an interactive turn does, so a delegated repair's edits are checkpointed exactly like a user-driven edit would be.
- **Restoration never destroys unrelated work**: for worktree-isolated tasks specifically, this is a property of git itself, not new code - `commitAndMergeWorktreeBranch` (`gitWorktreeMainService.ts`) runs `git merge` against the main repo, and git itself refuses a merge that would conflict with uncommitted changes in the working tree rather than overwriting them; that refusal surfaces as this pass's existing `mergeOutcome: 'conflict'` handling (worktree and branch left in place, nothing discarded).

## What isn't integrated (a real, stated boundary, not an oversight)

**Verifying a worktree's isolated changes *before* merging them** (rather than only after, against the main workspace) is not implemented. `gatherEvidence()`'s diagnostics come from `IMarkerService`, which only knows about files actually open in this workbench - it fundamentally cannot report diagnostics for a separate worktree checkout's files without opening them here first, and its build/lint/test path reuses `run_verification`'s hardcoded workspace-root `cwd`. Making this fully worktree-aware means generalizing both of those paths to accept an arbitrary directory, which is real, additional, well-scoped work - not attempted here rather than half-implemented and shipped as if it were general.
