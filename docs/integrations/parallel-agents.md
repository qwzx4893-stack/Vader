# Parallel agents and git worktree isolation

**Contract:** `IAgentOrchestrationService` in `common/orchestration/orchestrationTypes.ts`. **Implementation:** `browser/orchestrationService.ts`. **Git worktree backend:** `common/worktree/gitWorktreeTypes.ts` / `electron-main/gitWorktreeMainService.ts`. **Tool:** `delegate_parallel_tasks`.

## Real concurrency, not sequential-labeled-as-parallel

`runWithConcurrencyLimit` in `orchestrationService.ts` is a small worker-pool: up to `MAX_CONCURRENCY` (4) tasks run their `IAgentGatewayService.runIsolatedTask` calls genuinely at the same time via `Promise.all` over concurrent workers pulling from a shared queue - not `for...of` with `await` inside the loop (which would be sequential despite being called "parallel"). Each task still goes through the same Agent Gateway, Policy Engine, and agent-scope checks as any other subagent task; nothing about running several at once bypasses those.

## Two kinds of task

`delegate_parallel_tasks`'s `specs` param is a JSON array of `{task, agent_name?, uses_worktree?}` (up to 8 per call). `uses_worktree` decides which path a task takes:

- **`false` (read-only/research)**: runs directly against the live workspace, exactly like `delegate_subagent_task`, just concurrently with its siblings. No isolation overhead, because there's nothing to isolate - it doesn't write anything.
- **`true` (code-modifying)**: gets its own git worktree and branch for the full lifecycle below.

## The worktree lifecycle

1. **Create**: `IGitWorktreeMainService.createWorktree` runs `git worktree add -b <branch> <path>` from the workspace root, with the worktree placed as a **sibling** of the repo (`<repo-parent>/.vader-worktrees/<branch>`), never nested inside it - nesting would put it inside the main workspace's own file tree, visible to its file watcher and its own `git status`.
2. **Assign/execute**: the subagent's task prompt is prefixed with an explicit instruction naming the worktree's absolute path as its working root ("use this exact absolute path... do not read or write any file outside this directory"). This works with zero changes to the tool-execution engine itself, because every file tool (`read_file`, `edit_file`, etc.) already takes an explicit absolute URI rather than resolving paths against an implicit "the workspace" - a subagent told to work under a given absolute path simply does, the same way it would if the user pointed it at any other folder.
3. **Collect diff**: `getWorktreeDiffStat` (`git add -A && git diff --cached --stat` inside the worktree) is available for inspection; the orchestration service uses `commitAndMergeWorktreeBranch` directly once the subagent's run finishes.
4. **Merge or conflict-handle**: stages and commits whatever the worktree has (skips entirely, `mergeOutcome: 'no_changes'`, if there's nothing to commit), checks out the current target branch in the **main repo** (not the worktree), and attempts `git merge --no-ff <branch>`. On conflict, runs `git merge --abort` immediately (a process with no user can't resolve a conflict interactively) and reports `mergeOutcome: 'conflict'` - **the worktree and branch are left in place**, so the commit made in step 3 is still reachable for the user to merge or cherry-pick by hand later.
5. **Cleanup**: only on a successful merge (or a confirmed no-op) does `removeWorktree` run (`git worktree remove --force` + `git branch -D`). A conflicted, errored, or cancelled task's worktree is never automatically removed.

## What happens when isolation itself fails

If `git worktree add` fails (not a git repo, git not installed, or any other error), the task is marked `error` with `mergeOutcome: 'not_attempted'` and **is not run at all** - it does not fall back to editing the live workspace directly. Running a code-modifying task unisolated when isolation was explicitly requested would risk it colliding with a sibling task or the user's own concurrent edits; refusing to run is the safe fallback, not silently proceeding.

## Cancellation

`cancelRun(runId)` marks the run cancelled and, for every task still `running`, calls `IAgentGatewayService.cancelTask(threadId)` - the same cancellation path the main chat UI uses (see `docs/integrations/agent-gateway.md`), captured via `runIsolatedTask`'s new `onThreadCreated` callback (fires synchronously with the hidden thread's id, since `runIsolatedTask` itself only resolves once the task is fully done). A cancelled worktree task's worktree is left in place, exactly like a conflicted one - cancellation never destroys partial work.

## Status for a future Agent Manager UI

`IAgentOrchestrationService.runs`/`getRun`/`onDidChangeOrchestration` expose every run's per-task status (`pending`/`running`/`success`/`error`/`cancelled`), thread id, worktree path/branch, conclusion, changed files, and merge outcome - real, live, queryable state, now surfaced in Settings' `AgentManagerSection` (see `docs/integrations/agent-manager-ui.md`) as a first pass; a dedicated standalone panel is further, separately-scoped UI work.
