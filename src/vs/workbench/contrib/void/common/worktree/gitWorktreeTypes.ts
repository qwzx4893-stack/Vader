/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

export type CreateWorktreeResult =
	| { ok: true; worktreePath: string; branchName: string }
	| { ok: false; reason: string };

export type MergeWorktreeResult =
	| { ok: true; merged: true }
	| { ok: true; merged: false; hadChanges: boolean } // nothing to merge - the worktree had no changes
	| { ok: false; reason: string }; // merge attempted and failed (conflict, etc) - worktree/branch are left in place

/**
 * Real git-worktree lifecycle, run in electron-main (git is a `child_process`, same
 * reasoning as voidSCMMainService.ts: this repo's convention is that anything reaching the
 * network or the OS shell goes through an electron-main service behind an IPC channel, not
 * a direct call from browser code). See common/orchestration/ for the caller and
 * docs/integrations/parallel-agents.md for the full lifecycle this backs.
 */
export interface IGitWorktreeMainService {
	readonly _serviceBrand: undefined;

	/** `git worktree add` a new worktree + branch, sibling to the repo (never nested inside it, so it can't itself be walked/watched as part of the main workspace) */
	createWorktree(opts: { repoPath: string; branchName: string }): Promise<CreateWorktreeResult>;

	/** `git diff --stat` inside the worktree, comparing its working tree to its own branch base */
	getWorktreeDiffStat(worktreePath: string): Promise<string>;

	/** commits whatever's uncommitted in the worktree (if anything), then attempts a merge of the worktree's branch into targetBranch in the main repo. Aborts and reports failure rather than leaving repoPath in a conflicted state - never requires interactive conflict resolution from a process with no user to ask. */
	commitAndMergeWorktreeBranch(opts: { repoPath: string; worktreePath: string; branchName: string; targetBranch: string; commitMessage: string }): Promise<MergeWorktreeResult>;

	/** `git worktree remove` + delete the branch. Only call this after a successful merge or when discarding a task's changes on purpose - never called automatically after a failed merge, so a conflicted worktree is always still there to recover from. */
	removeWorktree(opts: { repoPath: string; worktreePath: string; branchName: string }): Promise<void>;

	getCurrentBranch(repoPath: string): Promise<string>;
}

export const IGitWorktreeMainService = createDecorator<IGitWorktreeMainService>('vaderGitWorktreeMainService');
