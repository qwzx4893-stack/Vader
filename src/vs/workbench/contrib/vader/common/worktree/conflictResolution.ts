/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { conflictResolutionPrompt } from '../orchestration/conflictPrompt.js';
import { IGitWorktreeMainService } from './gitWorktreeTypes.js';

// What happens when a task's branch meets changes already on the branch it is merged into (boards R05 and S06): keep one side, or let an agent merge the two inside
// the task's own copy. One implementation, used by parallel tasks (orchestrationService.ts) and by the main agent's own copy (taskCopyService.ts).

export type ConflictChoice = 'target' | 'branch' | 'agent';

export type ConflictDeps = {
	readonly git: Pick<IGitWorktreeMainService, 'mergeWorktreeBranchPreferring' | 'startMergeInWorktree' | 'finishMergeInWorktree' | 'commitAndMergeWorktreeBranch' | 'conflictMarkersIn'>;
	/** runs an agent on the prompt; the answer says whether it finished cleanly */
	readonly runAgent: (prompt: string) => Promise<{ hadError: boolean; stalledAwaitingApproval: boolean }>;
	/** for an agent merge: told which of the conflicted files no longer hold markers, as the agent works */
	readonly onProgress?: (info: { files: readonly string[]; resolved: readonly string[] }) => void;
	/** how often the files are looked at while an agent works */
	readonly pollMs?: number;
};

export type ConflictArgs = {
	readonly repoPath: string;
	readonly worktreePath: string;
	readonly branchName: string;
	readonly targetBranch: string;
	readonly task: string;
	readonly choice: ConflictChoice;
	readonly commitMessage: string;
};

/** ok: the branch is merged into the target (the caller removes the copy); not ok: nothing was merged, and the reason says why */
export async function resolveTaskConflict(deps: ConflictDeps, a: ConflictArgs): Promise<{ ok: true } | { ok: false; reason: string }> {
	const { git } = deps;
	if (a.choice !== 'agent') {
		const merged = await git.mergeWorktreeBranchPreferring({ repoPath: a.repoPath, worktreePath: a.worktreePath, branchName: a.branchName, targetBranch: a.targetBranch, prefer: a.choice, commitMessage: a.commitMessage });
		return merged.ok ? { ok: true } : { ok: false, reason: `Nothing was merged: ${merged.reason}` };
	}

	// let an agent merge: the current branch goes into the task's worktree, an agent removes the markers there, then the result is merged as usual
	const started = await git.startMergeInWorktree({ worktreePath: a.worktreePath, targetBranch: a.targetBranch });
	if (!started.ok) return { ok: false, reason: `The merge could not be started: ${started.reason}` };
	if (started.conflictFiles.length) {
		const files = started.conflictFiles;
		let timer: ReturnType<typeof setInterval> | undefined;
		if (deps.onProgress) {
			deps.onProgress({ files, resolved: [] });
			timer = setInterval(() => {
				void git.conflictMarkersIn(a.worktreePath).then(stillMarked => deps.onProgress?.({ files, resolved: files.filter(f => !stillMarked.includes(f)) }));
			}, deps.pollMs ?? 1500);
		}
		let result: { hadError: boolean; stalledAwaitingApproval: boolean };
		try {
			result = await deps.runAgent(conflictResolutionPrompt({ worktreePath: a.worktreePath, targetBranch: a.targetBranch, files, task: a.task }));
		} finally {
			if (timer) clearInterval(timer);
		}
		if (result.hadError || result.stalledAwaitingApproval) return { ok: false, reason: 'The agent could not finish merging the two versions. The worktree is left as it is for you to look at.' };
	}
	const done = await git.finishMergeInWorktree({ worktreePath: a.worktreePath, commitMessage: `Merge ${a.targetBranch} into ${a.branchName}` });
	if (!done.ok) return { ok: false, reason: done.stillConflicted?.length ? `The agent left conflict markers in: ${done.stillConflicted.join(', ')}. Nothing was merged.` : `Nothing was merged: ${done.reason}` };
	deps.onProgress?.({ files: started.conflictFiles, resolved: started.conflictFiles });
	const merged = await git.commitAndMergeWorktreeBranch({ repoPath: a.repoPath, worktreePath: a.worktreePath, branchName: a.branchName, targetBranch: a.targetBranch, commitMessage: a.commitMessage });
	return merged.ok ? { ok: true } : { ok: false, reason: `The two versions were merged in the worktree, but the final merge failed: ${merged.reason}` };
}
