/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../../base/common/event.js';

export type ParallelTaskStatus = 'pending' | 'running' | 'success' | 'error' | 'cancelled';

export type ParallelTaskSpec = {
	task: string;
	agentName: string | null;
	/**
	 * true: runs in its own git worktree on its own branch, changes are committed and
	 * merged (or left for manual resolution on conflict) - for tasks that will edit files.
	 * false: runs directly against the live workspace, no isolation - for read-only/research
	 * tasks that don't write anything, where isolation would be pure overhead.
	 */
	usesWorktree: boolean;
};

export type ParallelTaskState = {
	id: string;
	task: string;
	agentName: string | null;
	usesWorktree: boolean;
	status: ParallelTaskStatus;
	/** the hidden subagent thread running (or that ran) this task, once created */
	threadId?: string;
	worktreePath?: string;
	branchName?: string;
	conclusion?: string;
	changedFilePaths?: string[];
	/** only meaningful when usesWorktree is true */
	mergeOutcome?: 'merged' | 'no_changes' | 'conflict' | 'not_attempted';
	errorMessage?: string;
	startedAt?: number;
	finishedAt?: number;
};

export type ParallelRunState = {
	id: string;
	createdAt: number;
	finishedAt?: number;
	cancelled: boolean;
	tasks: ParallelTaskState[];
};

/**
 * Genuine bounded-concurrency execution of multiple subagent tasks at once (real
 * Promise-based concurrency - see orchestrationService.ts's runWithConcurrencyLimit - not
 * tasks labeled "parallel" that actually run one after another), with git-worktree
 * isolation for tasks that modify files. This is deliberately a layer above
 * IAgentGatewayService, not a replacement for it or for delegate_subagent_task: a single
 * delegated task still goes straight through the Gateway; this is for running several at
 * once. See docs/integrations/parallel-agents.md for the full lifecycle.
 */
export interface IAgentOrchestrationService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeOrchestration: Event<void>;
	readonly runs: ParallelRunState[];

	getRun(runId: string): ParallelRunState | undefined;
	runParallelTasks(specs: ParallelTaskSpec[]): Promise<ParallelRunState>;
	/** best-effort: cancels every task in the run that hasn't finished yet; already-finished tasks are untouched */
	cancelRun(runId: string): void;
}

export const IAgentOrchestrationService = createDecorator<IAgentOrchestrationService>('vaderAgentOrchestrationService');
