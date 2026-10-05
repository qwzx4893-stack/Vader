/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IAgentOrchestrationService, ParallelRunState, ParallelTaskSpec, ParallelTaskState } from '../common/orchestration/orchestrationTypes.js';
import { IAgentGatewayService } from '../common/agentGateway/agentGatewayTypes.js';
import { IGitWorktreeMainService } from '../common/worktree/gitWorktreeService.js';
import { IAgentsService } from '../common/agents/agentsService.js';
import { IVerificationService } from '../common/verification/verificationTypes.js';

export * from '../common/orchestration/orchestrationTypes.js';

// real, bounded worker-pool concurrency - not tasks queued and run one after another with a
// "parallel" label on top. MAX_CONCURRENCY caps simultaneous LLM calls + (for worktree
// tasks) simultaneous git worktrees, so a large task list doesn't try to run 30 agents and
// 30 worktrees at once.
const MAX_CONCURRENCY = 4;

async function runWithConcurrencyLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
	let nextIdx = 0;
	const worker = async () => {
		while (nextIdx < items.length) {
			const i = nextIdx++;
			await fn(items[i]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

class AgentOrchestrationService extends Disposable implements IAgentOrchestrationService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeOrchestration = this._register(new Emitter<void>());
	readonly onDidChangeOrchestration: Event<void> = this._onDidChangeOrchestration.event;

	private readonly _runs: ParallelRunState[] = [];
	get runs(): ParallelRunState[] { return this._runs; }

	private readonly _cancelledRunIds = new Set<string>();

	// Vader addition, found in a production-hardening audit: _runs/_cancelledRunIds were only
	// ever appended to, never pruned - a long session doing many delegate_parallel_tasks calls
	// would retain every run's full task list/diffs/error messages forever. Only finished runs
	// are ever evicted (a running/pending run is never removed out from under itself), oldest
	// first, so the Agent Manager UI still shows recent history while bounding memory growth.
	private static readonly MAX_RETAINED_RUNS = 50;
	private _pruneOldRuns(): void {
		const excess = this._runs.length - AgentOrchestrationService.MAX_RETAINED_RUNS;
		if (excess <= 0) return;
		let removed = 0;
		for (let i = 0; i < this._runs.length && removed < excess; i++) {
			if (this._runs[i].finishedAt === undefined) continue // never evict a run still in progress
			this._cancelledRunIds.delete(this._runs[i].id)
			this._runs.splice(i, 1)
			i--
			removed++
		}
	}

	constructor(
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IAgentGatewayService private readonly _agentGatewayService: IAgentGatewayService,
		@IGitWorktreeMainService private readonly _gitWorktreeService: IGitWorktreeMainService,
		@IAgentsService private readonly _agentsService: IAgentsService,
		@IVerificationService private readonly _verificationService: IVerificationService,
	) {
		super();
	}

	getRun(runId: string): ParallelRunState | undefined {
		return this._runs.find(r => r.id === runId);
	}

	private _fire() { this._onDidChangeOrchestration.fire(); }

	private _resolveAgentId(agentName: string | null): string | undefined {
		if (!agentName) return undefined;
		return this._agentsService.state.agents.find(a => a.name === agentName)?.id;
	}

	async runParallelTasks(specs: ParallelTaskSpec[]): Promise<ParallelRunState> {
		const run: ParallelRunState = {
			id: generateUuid(),
			createdAt: Date.now(),
			cancelled: false,
			tasks: specs.map((s): ParallelTaskState => ({
				id: generateUuid(),
				task: s.task,
				agentName: s.agentName,
				usesWorktree: s.usesWorktree,
				status: 'pending',
			})),
		};
		this._runs.push(run);
		this._fire();

		await runWithConcurrencyLimit(run.tasks, MAX_CONCURRENCY, async (t) => {
			if (this._cancelledRunIds.has(run.id)) {
				t.status = 'cancelled';
				this._fire();
				return;
			}
			t.status = 'running';
			t.startedAt = Date.now();
			this._fire();

			try {
				if (t.usesWorktree) await this._runWorktreeTask(run.id, t);
				else await this._runDirectTask(run.id, t);
			} catch (e) {
				t.status = 'error';
				t.errorMessage = e instanceof Error ? e.message : String(e);
			}
			t.finishedAt = Date.now();
			this._fire();
		});

		run.finishedAt = Date.now();
		if (this._cancelledRunIds.has(run.id)) run.cancelled = true;
		this._pruneOldRuns();
		this._fire();
		return run;
	}

	cancelRun(runId: string): void {
		this._cancelledRunIds.add(runId);
		const run = this.getRun(runId);
		if (!run) return;
		for (const t of run.tasks) {
			if (t.status === 'running' && t.threadId) {
				// goes through the Agent Gateway, same as every other cancellation in this
				// codebase - see docs/integrations/agent-gateway.md
				this._agentGatewayService.cancelTask(t.threadId);
			} else if (t.status === 'pending') {
				t.status = 'cancelled';
			}
		}
		this._fire();
	}

	private async _runDirectTask(runId: string, t: ParallelTaskState): Promise<void> {
		const result = await this._agentGatewayService.runIsolatedTask({
			task: t.task,
			agentId: this._resolveAgentId(t.agentName),
			onThreadCreated: (threadId) => { t.threadId = threadId; this._fire(); },
		});
		t.conclusion = result.conclusion;
		t.changedFilePaths = result.changedFilePaths;
		if (this._cancelledRunIds.has(runId)) t.status = 'cancelled';
		else if (result.hadError || result.stalledAwaitingApproval) {
			t.status = 'error';
			t.errorMessage = result.stalledAwaitingApproval
				? 'Subagent stalled awaiting an approval nothing could grant in this context.'
				: 'Subagent run ended with an error.';
		}
		else t.status = 'success';
	}

	private async _runWorktreeTask(runId: string, t: ParallelTaskState): Promise<void> {
		const repoPath = this._workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
		if (!repoPath) {
			t.status = 'error';
			t.mergeOutcome = 'not_attempted';
			t.errorMessage = 'No workspace is open, so there is no git repository to create an isolated worktree in.';
			return;
		}

		const branchName = `vader/parallel/${t.id.slice(0, 8)}`;
		const created = await this._gitWorktreeService.createWorktree({ repoPath, branchName });
		if (!created.ok) {
			// safe fallback: refuse to run a code-modifying task unisolated rather than risk
			// it colliding with a sibling task or the user's own live edits - see
			// docs/integrations/parallel-agents.md's "what happens when isolation fails" note
			t.status = 'error';
			t.mergeOutcome = 'not_attempted';
			t.errorMessage = `Could not create an isolated git worktree, so this task was not run (safety stop, not a crash): ${created.reason}`;
			return;
		}
		t.worktreePath = created.worktreePath;
		t.branchName = created.branchName;
		this._fire();

		const worktreeTaskPrompt = `${t.task}

---
IMPORTANT: your working directory for this task is exactly: ${created.worktreePath}
This is an isolated git worktree - a separate checkout of this same repository, on its own branch, created so your work can't collide with other agents running at the same time. Use this exact absolute path as the root for every file you read, search, or edit. Do not read or write any file outside this directory.`;

		let result;
		try {
			result = await this._agentGatewayService.runIsolatedTask({
				task: worktreeTaskPrompt,
				agentId: this._resolveAgentId(t.agentName),
				onThreadCreated: (threadId) => { t.threadId = threadId; this._fire(); },
			});
		} catch (e) {
			t.status = 'error';
			t.mergeOutcome = 'not_attempted';
			t.errorMessage = e instanceof Error ? e.message : String(e);
			return; // worktree is left in place - nothing to merge, but nothing destroyed either
		}

		t.conclusion = result.conclusion;
		t.changedFilePaths = result.changedFilePaths;

		if (this._cancelledRunIds.has(runId)) {
			t.status = 'cancelled';
			t.mergeOutcome = 'not_attempted';
			return; // leave the worktree - the task may be partially done; never auto-discard it
		}

		if (result.hadError || result.stalledAwaitingApproval) {
			t.status = 'error';
			t.mergeOutcome = 'not_attempted';
			t.errorMessage = result.stalledAwaitingApproval
				? 'Subagent stalled awaiting an approval nothing could grant in this context. Its worktree and branch are left in place for manual review.'
				: 'Subagent run ended with an error. Its worktree and branch are left in place for manual review.';
			return;
		}

		// Vader addition: pre-merge verification. Runs the project's own build/typecheck/lint/
		// test commands *inside the worktree's own isolated checkout* (not the main
		// workbench's IMarkerService, which only reflects files open in editors and would
		// never see an unopened worktree's changes) before integrating them - see
		// docs/integrations/parallel-agents.md. A real check failure blocks the merge; the
		// branch and worktree are left in place for manual review, exactly like a merge
		// conflict, so nothing is silently discarded and a human (or a follow-up task) can
		// still merge it after inspecting or fixing it - that manual path is this gate's
		// "explicit override," rather than a new settings toggle that would let a failing
		// check be integrated unreviewed by default. No checks detected for the project is
		// never treated as a pass or a fail - the merge proceeds exactly as before this gate
		// existed, since there's nothing here to judge it against.
		const preMergeEvidence = await this._verificationService.gatherEvidence({ cwd: created.worktreePath });
		if (preMergeEvidence.checksDetected && preMergeEvidence.checks.some(c => !c.passed)) {
			t.preMergeChecks = preMergeEvidence.checks.map(c => ({ name: c.name, command: c.command, passed: c.passed }));
			t.status = 'error';
			t.mergeOutcome = 'verification_failed';
			const failed = preMergeEvidence.checks.filter(c => !c.passed).map(c => c.name).join(', ');
			t.errorMessage = `Pre-merge verification failed in the isolated worktree (${failed}). Not merged - branch "${created.branchName}" and its worktree are left in place for manual review.`;
			return; // never auto-remove a worktree whose verification failed
		}
		if (preMergeEvidence.checksDetected) {
			t.preMergeChecks = preMergeEvidence.checks.map(c => ({ name: c.name, command: c.command, passed: c.passed }));
		}

		const targetBranch = await this._gitWorktreeService.getCurrentBranch(repoPath);
		const mergeResult = await this._gitWorktreeService.commitAndMergeWorktreeBranch({
			repoPath,
			worktreePath: created.worktreePath,
			branchName: created.branchName,
			targetBranch,
			commitMessage: `Parallel agent: ${t.task.slice(0, 72)}`,
		});

		if (!mergeResult.ok) {
			t.status = 'error';
			t.mergeOutcome = 'conflict';
			t.errorMessage = `This task's changes conflict with the current branch and were not merged: ${mergeResult.reason}. Branch "${created.branchName}" and its worktree are left in place for manual resolution.`;
			return; // never auto-remove a worktree whose merge failed
		}

		if (!mergeResult.merged) {
			t.mergeOutcome = 'no_changes';
			t.status = 'success';
			await this._gitWorktreeService.removeWorktree({ repoPath, worktreePath: created.worktreePath, branchName: created.branchName });
			return;
		}

		t.mergeOutcome = 'merged';
		t.status = 'success';
		await this._gitWorktreeService.removeWorktree({ repoPath, worktreePath: created.worktreePath, branchName: created.branchName });
	}
}

registerSingleton(IAgentOrchestrationService, AgentOrchestrationService, InstantiationType.Delayed);
