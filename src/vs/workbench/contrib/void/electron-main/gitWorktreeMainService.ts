/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { promisify } from 'util';
import { execFile as _execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { CreateWorktreeResult, IGitWorktreeMainService, MergeWorktreeResult } from '../common/worktree/gitWorktreeTypes.js';

const execFile = promisify(_execFile);

// Vader addition, found in a production-hardening security audit: this used to build a shell
// command string via interpolation (`exec(\`git ${args}\`)`) - a real shell-injection risk,
// since `commitMessage`/`branchName` can originate from an LLM's tool-call arguments (e.g.
// delegate_parallel_tasks' task text), which may itself have been influenced by untrusted
// content the agent read (a classic prompt-injection path). `execFile` passes each argument to
// the `git` binary directly (execve, no shell), so no argument value - however it's
// quoted/escaped or what special characters it contains - can ever be interpreted as a second
// command. Every call site below now passes a real argv array instead of a string.
const git = async (args: string[], cwd: string): Promise<string> => {
	const { stdout } = await execFile('git', args, { cwd });
	return stdout.trim();
};

// worktrees live as siblings of the repo, never nested inside it - nesting would put them
// inside the main workspace's own file tree (visible to its file watcher, its own git
// status, anything scanning the workspace), defeating the point of isolating them
const worktreesRootFor = (repoPath: string) => path.join(path.dirname(repoPath), '.vader-worktrees');

const sanitizeForPath = (branchName: string) => branchName.replace(/[^a-zA-Z0-9_.-]/g, '-');

export class GitWorktreeMainService implements IGitWorktreeMainService {
	readonly _serviceBrand: undefined;

	async createWorktree({ repoPath, branchName }: { repoPath: string; branchName: string }): Promise<CreateWorktreeResult> {
		try {
			const root = worktreesRootFor(repoPath);
			await fs.promises.mkdir(root, { recursive: true });
			const worktreePath = path.join(root, sanitizeForPath(branchName));
			await git(['worktree', 'add', '-b', branchName, worktreePath], repoPath);
			return { ok: true, worktreePath, branchName };
		} catch (e) {
			return { ok: false, reason: e instanceof Error ? e.message : String(e) };
		}
	}

	async getWorktreeDiffStat(worktreePath: string): Promise<string> {
		try {
			await git(['add', '-A'], worktreePath);
			return await git(['diff', '--cached', '--stat'], worktreePath);
		} catch (e) {
			return `(failed to compute diff: ${e instanceof Error ? e.message : String(e)})`;
		}
	}

	async commitAndMergeWorktreeBranch({ repoPath, worktreePath, branchName, targetBranch, commitMessage }: { repoPath: string; worktreePath: string; branchName: string; targetBranch: string; commitMessage: string }): Promise<MergeWorktreeResult> {
		try {
			await git(['add', '-A'], worktreePath);
			const status = await git(['status', '--porcelain'], worktreePath);
			if (!status) {
				return { ok: true, merged: false, hadChanges: false };
			}
			await git(['commit', '-m', commitMessage], worktreePath);
		} catch (e) {
			return { ok: false, reason: `Failed to commit worktree changes: ${e instanceof Error ? e.message : String(e)}` };
		}

		try {
			await git(['checkout', targetBranch], repoPath);
			await git(['merge', '--no-ff', branchName, '-m', `Merge parallel agent branch ${branchName}`], repoPath);
			return { ok: true, merged: true };
		} catch (e) {
			// never leave the main repo mid-conflict for a process with no user to resolve it -
			// abort and report instead. The worktree/branch are untouched, so the commit made
			// above is not lost - it's still reachable from branchName for manual merging later.
			try { await git(['merge', '--abort'], repoPath); } catch { /* nothing was in progress - fine */ }
			return { ok: false, reason: e instanceof Error ? e.message : String(e) };
		}
	}

	async removeWorktree({ repoPath, worktreePath, branchName }: { repoPath: string; worktreePath: string; branchName: string }): Promise<void> {
		try {
			await git(['worktree', 'remove', worktreePath, '--force'], repoPath);
		} catch { /* best-effort - if this fails, the worktree stays on disk, which is safe (never destroys user work) even if untidy */ }
		try {
			await git(['branch', '-D', branchName], repoPath);
		} catch { /* branch may already be gone (e.g. worktree remove auto-cleans in some git versions) - fine */ }
	}

	getCurrentBranch(repoPath: string): Promise<string> {
		return git(['branch', '--show-current'], repoPath);
	}
}
