/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A parallel run as the window shows it (board R05): one row for each task with where it stands, its branch and what it changed, and, for a task that conflicts, what
// both sides changed and the ways out. Built from what the orchestration service really holds (common/orchestration/orchestrationTypes.ts). Pure.

export type TaskLike = {
	readonly id: string;
	readonly task: string;
	readonly agentName: string | null;
	readonly usesWorktree: boolean;
	readonly status: 'pending' | 'running' | 'success' | 'error' | 'cancelled';
	readonly branchName?: string;
	readonly changedFilePaths?: readonly string[];
	readonly mergeOutcome?: 'merged' | 'no_changes' | 'conflict' | 'merge_failed' | 'not_attempted' | 'verification_failed';
	readonly conflictFiles?: readonly string[];
	readonly errorMessage?: string;
	readonly startedAt?: number;
	readonly finishedAt?: number;
	readonly preMergeChecks?: readonly { readonly name: string, readonly passed: boolean }[];
};

export type RunLike = { readonly id: string, readonly createdAt: number, readonly finishedAt?: number, readonly cancelled: boolean, readonly tasks: readonly TaskLike[] };

export type ResultKind = 'waiting' | 'working' | 'merged' | 'unchanged' | 'conflict' | 'merge-failed' | 'checks-failed' | 'not-merged' | 'error' | 'cancelled';
export type TaskRow = {
	readonly id: string;
	readonly title: string;
	/** "finished in 6 min", "running for 3 min" */
	readonly sub: string;
	readonly helper: string;
	readonly branch: string;
	readonly kind: ResultKind;
	readonly result: string;
	readonly tone: 'ok' | 'warn' | 'bad' | 'plain';
	readonly files: string;
};

/** "under a minute", "6 min", "1 h 5 min" */
export function minutesWords(ms: number): string {
	const m = Math.round(ms / 60_000);
	if (m < 1) return 'under a minute';
	if (m < 60) return `${m} min`;
	return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function rowOf(t: TaskLike, now: number): TaskRow {
	const files = t.changedFilePaths?.length ?? 0;
	const base = { id: t.id, title: t.task, helper: t.agentName ?? 'Default agent', branch: t.usesWorktree ? (t.branchName ?? 'its own copy') : 'your folder', files: files ? plural(files, 'file', 'files') : '' };
	const took = t.startedAt !== undefined && t.finishedAt !== undefined ? minutesWords(t.finishedAt - t.startedAt) : undefined;
	if (t.status === 'pending') return { ...base, sub: 'waiting to start', kind: 'waiting', result: 'Waiting', tone: 'plain' };
	if (t.status === 'running') return { ...base, sub: `running for ${minutesWords(now - (t.startedAt ?? now))}`, kind: 'working', result: 'Working', tone: 'plain' };
	if (t.status === 'cancelled') return { ...base, sub: 'stopped', kind: 'cancelled', result: 'Stopped', tone: 'plain' };
	const sub = took ? `finished in ${took}` : 'finished';
	if (t.status === 'error') return { ...base, sub, kind: 'error', result: 'Failed', tone: 'bad' };
	switch (t.mergeOutcome) {
		case 'merged': return { ...base, sub, kind: 'merged', result: 'Merged cleanly', tone: 'ok' };
		case 'no_changes': return { ...base, sub, kind: 'unchanged', result: 'No changes', tone: 'plain' };
		case 'conflict': return { ...base, sub, kind: 'conflict', result: `Conflict in ${plural(t.conflictFiles?.length ?? 0, 'file', 'files')}`, tone: 'warn' };
		case 'merge_failed': return { ...base, sub, kind: 'merge-failed', result: 'Could not merge', tone: 'bad' };
		case 'verification_failed': return { ...base, sub, kind: 'checks-failed', result: 'Checks failed', tone: 'bad' };
		case 'not_attempted': return { ...base, sub, kind: 'not-merged', result: 'Not merged', tone: 'plain' };
		default: return { ...base, sub, kind: 'unchanged', result: t.usesWorktree ? 'Finished' : 'Done', tone: 'plain' };
	}
}

/** "3 of 4 finished, 1 running" */
export function runSummary(run: RunLike): string {
	const total = run.tasks.length;
	const finished = run.tasks.filter(t => t.status === 'success' || t.status === 'error' || t.status === 'cancelled').length;
	const running = run.tasks.filter(t => t.status === 'running').length;
	return `${finished} of ${total} finished${running ? `, ${running} running` : ''}`;
}

export const isRunning = (run: RunLike): boolean => run.finishedAt === undefined && !run.cancelled && run.tasks.some(t => t.status === 'running' || t.status === 'pending');

/** what the person reads under a task that conflicts */
export function conflictWords(t: TaskLike): { title: string, files: readonly string[], text: string } {
	const files = t.conflictFiles ?? [];
	return {
		title: `Conflict in ${t.branchName ?? 'this task'}`,
		files,
		text: `Both this task and the current branch changed the same lines${files.length === 1 ? ' of ' + files[0] : files.length > 1 ? ' of ' + files.length + ' files' : ''}. Keep one side where they differ (lines only one side changed are kept either way), or let an agent merge them in the task’s own folder first.`,
	};
}

/** a path cut in the middle to fit, as the board writes it: src/ … /acpRegistrySnapshot.ts */
export function middleCut(path: string, max = 34): string {
	const p = path.replace(/\\/g, '/');
	if (p.length <= max) return p;
	const parts = p.split('/');
	if (parts.length < 3) return p.slice(0, max - 1) + '…';
	return `${parts[0]}/ … /${parts[parts.length - 1]}`;
}
