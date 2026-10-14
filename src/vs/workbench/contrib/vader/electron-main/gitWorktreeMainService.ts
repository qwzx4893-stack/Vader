/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { safeGitConfigArgs, SAFE_DIFF_FLAGS } from './safeGit.js';
import { promisify } from 'util';
import { execFile as _execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { CreateWorktreeResult, IGitWorktreeMainService, MergeWorktreeResult } from '../common/worktree/gitWorktreeTypes.js';

const execFile = promisify(_execFile);

// Vader addition, part of the final production-readiness pass's timeout-policy audit: every
// call here is a local, non-interactive git operation (worktree/branch/commit/merge/diff), never
// a network operation (no fetch/clone/push) - so it should never legitimately need user input or
// take long. Without a bound, a hung `git commit` waiting on a GPG pinentry prompt, a blocked
// pre-commit/post-commit hook, or contention on a stale `.git/index.lock` would await forever,
// permanently consuming one of orchestrationService.ts's MAX_CONCURRENCY worker slots (a real,
// reachable way to slowly deadlock the whole parallel-task system, one hung git call at a time).
// GIT_TERMINAL_PROMPT=0 makes git fail fast instead of blocking on a credential prompt it will
// never receive an answer to (belt); the explicit timeout is the backstop for every other way a
// subprocess can hang (suspenders) - 60s is generous for any of the local operations above while
// still being a real, finite bound instead of none at all.
const GIT_TIMEOUT_MS = 60_000;
const git = async (args: string[], cwd: string): Promise<string> => {
	try {
		const { stdout } = await execFile('git', [...safeGitConfigArgs(), ...args], { cwd, timeout: GIT_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
		return stdout.trim();
	} catch (e) {
		if (e && typeof e === 'object' && 'killed' in e && (e as { killed?: boolean }).killed && 'signal' in e && (e as { signal?: string }).signal === 'SIGTERM') {
			throw new Error(`git ${args[0]} timed out after ${GIT_TIMEOUT_MS / 1000}s (it may have been waiting on a prompt, a hook, or a lock file) and was killed.`);
		}
		throw e;
	}
};

// worktrees live as siblings of the repo, never nested inside it - nesting would put them
// inside the main workspace's own file tree (visible to its file watcher, its own git
// status, anything scanning the workspace), defeating the point of isolating them
const worktreesRootFor = (repoPath: string) => path.join(path.dirname(repoPath), '.vader-worktrees');

const sanitizeForPath = (branchName: string) => branchName.replace(/[^a-zA-Z0-9_.-]/g, '-').replace(/^\.+/, '-') || 'branch'; // a leading dot would let '..' point at the parent directory

/** files git lists as unmerged right now (a merge stopped on them); empty when none or when git cannot say */
const unmergedFiles = async (cwd: string): Promise<string[]> => {
	try {
		return (await git(['diff', '--name-only', '--diff-filter=U'], cwd)).split('\n').map(s => s.trim()).filter(Boolean);
	} catch {
		return [];
	}
};

/** a branch name that is safe to hand to git as an argument: no leading dash (an option), no whitespace or control characters */
const isSafeRef = (name: string) => /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(name) && !name.includes('..');

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
			return await git(['diff', ...SAFE_DIFF_FLAGS, '--cached', '--stat'], worktreePath);
		} catch (e) {
			return `(failed to compute diff: ${e instanceof Error ? e.message : String(e)})`;
		}
	}

	async commitAndMergeWorktreeBranch({ repoPath, worktreePath, branchName, targetBranch, commitMessage }: { repoPath: string; worktreePath: string; branchName: string; targetBranch: string; commitMessage: string }): Promise<MergeWorktreeResult> {
		try {
			await git(['add', '-A'], worktreePath);
			const status = await git(['status', '--porcelain'], worktreePath);
			if (status) {
				await git(['commit', '-m', commitMessage], worktreePath);
			} else if (!isSafeRef(targetBranch) || !isSafeRef(branchName) || Number(await git(['rev-list', '--count', `${targetBranch}..${branchName}`], repoPath)) === 0) {
				// nothing uncommitted, and the branch has no commit the target lacks (an agent may have committed its own work): nothing to merge
				return { ok: true, merged: false, hadChanges: false };
			}
		} catch (e) {
			return { ok: false, reason: `Failed to commit worktree changes: ${e instanceof Error ? e.message : String(e)}` };
		}

		try {
			await git(['checkout', targetBranch], repoPath);
			await git(['merge', '--no-ff', branchName, '-m', `Merge parallel agent branch ${branchName}`], repoPath);
			return { ok: true, merged: true };
		} catch (e) {
			// the files both sides changed, read before the merge is abandoned, so a caller can tell a conflict from any other failure
			const conflictFiles = await unmergedFiles(repoPath);
			// never leave the main repo mid-conflict for a process with no user to resolve it -
			// abort and report instead. The worktree/branch are untouched, so the commit made
			// above is not lost - it's still reachable from branchName for manual merging later.
			try { await git(['merge', '--abort'], repoPath); } catch { /* nothing was in progress - fine */ }
			return { ok: false, reason: e instanceof Error ? e.message : String(e), ...(conflictFiles.length ? { conflictFiles } : {}) };
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

	async mergeWorktreeBranchPreferring({ repoPath, worktreePath, branchName, targetBranch, prefer, commitMessage }: { repoPath: string; worktreePath: string; branchName: string; targetBranch: string; prefer: 'target' | 'branch'; commitMessage: string }): Promise<MergeWorktreeResult> {
		if (!isSafeRef(branchName) || !isSafeRef(targetBranch)) return { ok: false, reason: 'The branch name is not one Vader will pass to git.' };
		try {
			// anything the task left uncommitted in its worktree goes into its branch first, as in commitAndMergeWorktreeBranch
			await git(['add', '-A'], worktreePath);
			if (await git(['status', '--porcelain'], worktreePath)) await git(['commit', '-m', commitMessage], worktreePath);
		} catch (e) {
			return { ok: false, reason: `Failed to commit worktree changes: ${e instanceof Error ? e.message : String(e)}` };
		}
		try {
			await git(['checkout', targetBranch], repoPath);
			// -X ours keeps the side already on targetBranch where both changed the same lines; -X theirs keeps the task's side
			await git(['merge', '--no-ff', '-X', prefer === 'target' ? 'ours' : 'theirs', branchName, '-m', `Merge parallel agent branch ${branchName} (kept ${prefer === 'target' ? 'the current version' : 'the task\'s version'} where they differed)`], repoPath);
			return { ok: true, merged: true };
		} catch (e) {
			const conflictFiles = await unmergedFiles(repoPath);
			try { await git(['merge', '--abort'], repoPath); } catch { /* nothing was in progress - fine */ }
			return { ok: false, reason: e instanceof Error ? e.message : String(e), ...(conflictFiles.length ? { conflictFiles } : {}) };
		}
	}

	async startMergeInWorktree({ worktreePath, targetBranch }: { worktreePath: string; targetBranch: string }): Promise<{ ok: true; conflictFiles: string[] } | { ok: false; reason: string }> {
		if (!isSafeRef(targetBranch)) return { ok: false, reason: 'The branch name is not one Vader will pass to git.' };
		try {
			// whatever the task left uncommitted is committed first, so the merge starts from a clean worktree
			await git(['add', '-A'], worktreePath);
			if (await git(['status', '--porcelain'], worktreePath)) await git(['commit', '-m', 'Parallel agent: work in progress before merging the current branch'], worktreePath);
		} catch (e) {
			return { ok: false, reason: `Failed to commit worktree changes: ${e instanceof Error ? e.message : String(e)}` };
		}
		try {
			await git(['merge', '--no-ff', '--no-commit', targetBranch], worktreePath);
			return { ok: true, conflictFiles: [] }; // nothing conflicted after all: the merge is staged and finishMergeInWorktree commits it
		} catch (e) {
			const conflictFiles = await unmergedFiles(worktreePath);
			if (conflictFiles.length) return { ok: true, conflictFiles };
			try { await git(['merge', '--abort'], worktreePath); } catch { /* nothing was in progress */ }
			return { ok: false, reason: e instanceof Error ? e.message : String(e) };
		}
	}

	async finishMergeInWorktree({ worktreePath, commitMessage }: { worktreePath: string; commitMessage: string }): Promise<{ ok: true } | { ok: false; reason: string; stillConflicted?: string[] }> {
		try {
			// a file still holding git's conflict markers has not been resolved, whatever its state in the index
			const marked = (await git(['grep', '-l', '-E', '^(<<<<<<< |=======$|>>>>>>> )', '--', '.'], worktreePath).catch(() => '')).split('\n').map(s => s.trim()).filter(Boolean);
			if (marked.length) return { ok: false, reason: 'Some files still contain conflict markers.', stillConflicted: marked };
			await git(['add', '-A'], worktreePath);
			const stillUnmerged = await unmergedFiles(worktreePath);
			if (stillUnmerged.length) return { ok: false, reason: 'Some files are still unmerged.', stillConflicted: stillUnmerged };
			await git(['commit', '--no-edit', '-m', commitMessage], worktreePath);
			return { ok: true };
		} catch (e) {
			return { ok: false, reason: e instanceof Error ? e.message : String(e) };
		}
	}
}
