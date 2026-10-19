/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A task's own copy of the project (boards S06 and R01): in Agent mode the agent works in a separate checkout of the same git repository, on its own branch, so that the person's
// folder does not change until they accept. This file holds what needs no editor to be right: the branch name, where a path goes when it moves from the folder to the copy,
// what each failure of a merge means, and every word on the cards. Pure.

export type TaskCopyPhase = 'working' | 'merging' | 'agent-merging' | 'merged' | 'conflict' | 'failed' | 'discarded';

export type MergeFailureKind = 'local-changes' | 'other';

export type TaskCopyState = {
	readonly threadId: string;
	/** what the person asked, first line, for the commit and the conflict prompt */
	readonly title: string;
	readonly repoPath: string;
	readonly worktreePath: string;
	readonly branchName: string;
	/** the branch the copy was made from, and the one it is merged back into */
	readonly baseBranch: string;
	readonly phase: TaskCopyPhase;
	/** files the task has changed so far */
	readonly files: number;
	readonly conflictFiles?: readonly string[];
	readonly failure?: { readonly kind: MergeFailureKind; readonly reason: string; readonly files: readonly string[] };
	/** the commit on the base branch before the merge, and the merge commit; kept so that the merge can be undone */
	readonly preMergeSha?: string;
	readonly mergeSha?: string;
	/** while an agent merges: which of the conflicted files it has finished */
	readonly resolving?: readonly string[];
	readonly resolved?: readonly string[];
	/** set once an undo has been made */
	readonly undone?: boolean;
	/** a note for the person that is not an error ("The merge was undone") */
	readonly note?: string;
};

/** what to ask before an agent task starts: nothing, or one of the two questions on board S06 */
export type StartCheck =
	| { readonly kind: 'ok' }
	| { readonly kind: 'not-git' }
	| { readonly kind: 'dirty'; readonly files: number };

/** a question the person is asked before the task can start (boards S06), and what they can answer */
export type StartQuestion =
	| { readonly kind: 'dirty'; readonly files: number; readonly project: string }
	| { readonly kind: 'not-git' }
	| { readonly kind: 'copy-failed'; readonly reason: string };
export type StartAnswer = 'start-anyway' | 'commit' | 'init-git' | 'use-chat' | 'work-in-folder' | 'cancel';

/** is there a copy on disk that edits go to: it exists from its creation until it is merged, discarded or found empty */
export const hasCopyOnDisk = (s: Pick<TaskCopyState, 'phase'> | undefined): boolean => !!s && (s.phase === 'working' || s.phase === 'merging' || s.phase === 'agent-merging' || s.phase === 'conflict' || s.phase === 'failed');

/** the words of the failed-to-copy card */
export const copyFailedWords = (reason: string) => ({
	title: 'Could not make a copy of the project',
	body: reason.split('\n')[0].replace(/^Command failed: .*$/, 'git did not make the copy.').slice(0, 200) || 'git did not make the copy.',
	workHere: 'Work in the folder instead',
	cancel: 'Cancel',
});

/** the first line of the request, kept to what a commit title takes */
export const taskTitleOf = (message: string): string => (message.split(/\r?\n/).find(l => l.trim()) ?? 'Agent task').trim().slice(0, 72);

// ---- names

const slugOf = (text: string): string => {
	const words = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w));
	const slug = words.slice(0, 3).join('-').replace(/-+/g, '-').slice(0, 28).replace(/^-+|-+$/g, '');
	return slug || 'task';
};
const STOP = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'please', 'can', 'you', 'make', 'add', 'to', 'of', 'in', 'on', 'a', 'an', 'my', 'it', 'is']);

/** "agent/rate-limiter-3f2a": from what the person asked, with a few letters of the thread so that two tasks never share a branch */
export function branchNameFor(firstMessage: string, threadId: string): string {
	const suffix = threadId.replace(/[^a-z0-9]/gi, '').slice(0, 4).toLowerCase() || 'x';
	return `agent/${slugOf(firstMessage)}-${suffix}`;
}

/** the branch with its random tail left off, for the words on the cards: "agent/rate-limiter" */
export const branchLabel = (branchName: string): string => branchName.replace(/-[a-z0-9]{1,4}$/, '');

// ---- paths

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '');
const windowsish = (p: string): boolean => /^[a-z]:\//i.test(p) || p.startsWith('//');

/** is `path` the folder `root` or inside it (separator-agnostic, and case-blind for a Windows drive path) */
export function isInside(path: string, root: string): boolean {
	const p = norm(path), r = norm(root);
	if (!r) return false;
	const ci = windowsish(r);
	const a = ci ? p.toLowerCase() : p, b = ci ? r.toLowerCase() : r;
	return a === b || a.startsWith(b + '/');
}

/** where a path goes when the folder is replaced by the copy: the same place under the copy's root; a path outside the folder is left alone */
export function remapPath(path: string, fromRoot: string, toRoot: string): string {
	if (!isInside(path, fromRoot)) return path;
	const rest = norm(path).slice(norm(fromRoot).length).replace(/^\//, '');
	const sep = toRoot.includes('\\') && !toRoot.includes('/') ? '\\' : '/';
	const base = toRoot.replace(/[\\/]+$/, '');
	return rest ? `${base}${sep}${sep === '\\' ? rest.replace(/\//g, '\\') : rest}` : base;
}

/** the path as the person knows it, from a path in the copy: the folder's own path for the same place */
export const unmapPath = (path: string, copyRoot: string, folderRoot: string): string => remapPath(path, copyRoot, folderRoot);

/** the files a tool call can write to, by tool; a call to one of these is the first edit of a task */
export const EDITING_TOOLS: ReadonlySet<string> = new Set(['edit_file', 'rewrite_file', 'create_file_or_folder', 'delete_file_or_folder', 'run_command', 'run_persistent_command']);

// ---- the words a model is told

/** appended to the instructions of an agent that works in a copy: where it is, and that it never writes outside it */
export const copyInstructions = (worktreePath: string, branchName: string): string =>
	`Your working directory for this task is exactly: ${worktreePath}\nThis is a separate copy of the project on its own git branch (${branchName}), made so that the person's own folder does not change until they accept your work. Use this absolute path as the root for every file you read, search or edit and as the directory of every command. Do not read or write any file outside it, and do not run git commands that switch branches or merge: Vader merges your branch when the person accepts.`;

// ---- merge failures

/** the files git names when it refuses a merge because local changes would be overwritten */
export function overwrittenFiles(reason: string): string[] {
	const out: string[] = [];
	const block = /would be overwritten by (?:merge|checkout)[^\n]*:?\n((?:[ \t]+[^\n]+\n?)+)/i.exec(reason);
	if (block) for (const l of block[1].split('\n')) { const f = l.trim(); if (f) out.push(f); }
	return out;
}

export function classifyMergeFailure(reason: string): { kind: MergeFailureKind; files: string[] } {
	if (/would be overwritten by (merge|checkout)|Your local changes to the following files/i.test(reason)) return { kind: 'local-changes', files: overwrittenFiles(reason) };
	return { kind: 'other', files: [] };
}

// ---- words

const sentenceList = (names: readonly string[], shown = 3): string => {
	const some = names.slice(0, shown);
	const more = names.length - some.length;
	const parts = more > 0 ? [...some, `${more} more`] : some;
	if (parts.length <= 1) return parts[0] ?? '';
	return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
};
const filesWords = (n: number): string => `${n} file${n === 1 ? '' : 's'}`;

export const ownCopyWords = (s: Pick<TaskCopyState, 'branchName' | 'baseBranch' | 'files'>, project: string) => ({
	branch: branchLabel(s.branchName),
	from: `from ${s.baseBranch || 'the current branch'}, ${filesWords(s.files)}`,
	body: `The agent edits a copy of ${project} on its own branch. Your folder does not change until you accept.`,
});

export const mergedWords = (s: Pick<TaskCopyState, 'branchName' | 'baseBranch'>) => ({
	title: `Merged into ${s.baseBranch}`,
	body: `${branchLabel(s.branchName)} was merged into ${s.baseBranch} without conflicts. The copy was removed.`,
});

export const conflictWords = (s: Pick<TaskCopyState, 'baseBranch' | 'conflictFiles'>) => ({
	title: `This task conflicts with ${s.baseBranch}`,
	body: `Both changed ${sentenceList(s.conflictFiles ?? [], 3)}.`,
	keepMine: 'Keep my version',
	keepTask: 'Keep the task’s version',
	askAgent: 'Ask an agent to merge',
});

export const agentMergingWords = (s: Pick<TaskCopyState, 'baseBranch' | 'branchName'>) => ({
	title: `Merging ${s.baseBranch} into ${branchLabel(s.branchName)}`,
	footer: 'You review the result before it reaches ' + s.baseBranch + '.',
});

export function mergeFailedWords(s: Pick<TaskCopyState, 'branchName' | 'baseBranch' | 'failure'>) {
	const f = s.failure;
	const title = `Could not merge ${branchLabel(s.branchName)}`;
	if (f?.kind === 'local-changes') {
		const names = f.files.length ? sentenceList(f.files, 2) : 'some files';
		return { title, body: `git said: your local changes to ${names} would be overwritten. This is not a conflict between tasks.`, retry: 'Stash my changes and retry', output: 'Show the git output' };
	}
	return { title, body: 'The merge could not be completed and nothing was merged. Your folder is as it was.', retry: 'Try again', output: 'Show the git output' };
}

export const discardWords = (s: Pick<TaskCopyState, 'branchName' | 'files'>) => ({
	title: 'Discard this task?',
	body: `${branchLabel(s.branchName)} and its ${s.files} changed file${s.files === 1 ? '' : 's'} will be deleted. Your folder is not touched.`,
	cancel: 'Cancel',
	confirm: 'Discard',
});

export const dirtyWords = (files: number, project: string) => ({
	title: 'You have uncommitted changes',
	body: `${filesWords(files)} in ${project} ${files === 1 ? 'is' : 'are'} changed. The task starts from the last commit, so it will not see ${files === 1 ? 'it' : 'them'}.`,
	startAnyway: 'Start anyway',
	commitFirst: 'Commit them first',
	cancel: 'Cancel',
});

export const notGitWords = () => ({
	title: 'This folder is not a git project',
	body: 'Agent mode works in a copy made with git. You can still use Chat here.',
	start: 'Start git here',
	useChat: 'Use Chat',
});

export const mergedUndoneNote = (s: Pick<TaskCopyState, 'baseBranch'>): string => `The merge was undone. ${s.baseBranch} is as it was before.`;

/** the stat line of `git diff --stat` ("3 files changed, ...") as a count; counted from the lines above it when the summary line is missing */
export function filesInDiffStat(stat: string): number {
	const m = /(\d+) files? changed/.exec(stat);
	if (m) return Number(m[1]);
	return stat.split(/\r?\n/).filter(l => /\|\s+(\d+|Bin)/.test(l)).length;
}

/** the progress rows of an agent merge: every conflicted file is either resolved or being resolved */
export function mergeProgressRows(files: readonly string[], resolved: readonly string[]): { name: string; state: 'resolved' | 'resolving' }[] {
	const done = new Set(resolved);
	return files.map(name => ({ name, state: done.has(name) ? 'resolved' : 'resolving' }));
}
