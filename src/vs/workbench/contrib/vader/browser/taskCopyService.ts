/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IAgentGatewayService } from '../common/agentGateway/agentGatewayTypes.js';
import { IVaderSettingsService } from '../common/vaderSettingsService.js';
import { IGitWorktreeMainService } from '../common/worktree/gitWorktreeService.js';
import { resolveTaskConflict, ConflictChoice } from '../common/worktree/conflictResolution.js';
import { StartAnswer, StartQuestion, TaskCopyState, branchNameFor, classifyMergeFailure, hasCopyOnDisk, isInside, mergedUndoneNote, remapPath, taskTitleOf } from '../common/taskCopyModel.js';

// A task's own copy of the project, for the main agent (boards S06 and R01). Before the agent's first step in Agent mode a copy of the project is made with git
// (a worktree on its own branch, next to the folder, never inside it); every file the agent reads, edits or runs a command in is the copy's, and the folder does not change
// until the person accepts. This service owns the copy's life: make it, count what changed, merge it, resolve a conflict, undo the merge, discard it.
// The same worktree and merge code runs parallel tasks (orchestrationService.ts); only the person's questions and the paths below are new.

export interface ITaskCopyService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;

	/** the copy this thread works in, or what became of it (merged, and so on); undefined when the thread has none */
	getState(threadId: string): TaskCopyState | undefined;
	/** the question the thread is waiting on before its task can start */
	getQuestion(threadId: string): StartQuestion | undefined;
	answerQuestion(threadId: string, answer: StartAnswer): void;

	/** before a task starts in Agent mode: makes the copy (asking what must be asked first). 'direct' means work in the folder itself (copies are off, or there is no folder) */
	prepareForTask(threadId: string, message: string): Promise<'copy' | 'direct' | 'cancel'>;
	/** the copy's folder and branch while edits go there */
	copyOf(threadId: string): { worktreePath: string; branchName: string } | undefined;
	/** the same parameters with every path in the folder moved to the same place in the copy, and commands run there */
	remapToolParams<T extends object>(threadId: string, toolName: string, params: T): T;
	/** writes the open files of the copy to disk, so that commands and git see what the agent changed */
	saveOpenFiles(threadId: string): Promise<void>;
	/** after a run: counts the changed files; a copy where nothing changed is removed */
	afterRun(threadId: string, opts: { keepIfEmpty: boolean }): Promise<void>;

	merge(threadId: string): Promise<void>;
	stashAndRetry(threadId: string): Promise<void>;
	resolveConflict(threadId: string, choice: ConflictChoice): Promise<void>;
	undoMerge(threadId: string): Promise<void>;
	/** deletes the copy and its branch; the folder is not touched */
	discard(threadId: string): Promise<void>;
	/** forget a finished copy (the "Done" of a merge) */
	dismiss(threadId: string): void;
}

export const ITaskCopyService = createDecorator<ITaskCopyService>('vaderTaskCopyService');

const STORAGE_KEY = 'vader.taskCopies.v1';

class TaskCopyService extends Disposable implements ITaskCopyService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private readonly _states = new Map<string, TaskCopyState>();
	private readonly _questions = new Map<string, { q: StartQuestion; resolve: (a: StartAnswer) => void }>();
	private readonly _startedAnyway = new Set<string>();
	private readonly _preparing =new Map<string, Promise<'copy' | 'direct' | 'cancel'>>();

	constructor(
		@IGitWorktreeMainService private readonly _git: IGitWorktreeMainService,
		@IWorkspaceContextService private readonly _workspace: IWorkspaceContextService,
		@IStorageService private readonly _storage: IStorageService,
		@ITextFileService private readonly _textFiles: ITextFileService,
		@IVaderSettingsService private readonly _settings: IVaderSettingsService,
		@IInstantiationService private readonly _instantiation: IInstantiationService,
	) {
		super();
		try {
			const raw = this._storage.get(STORAGE_KEY, StorageScope.APPLICATION);
			if (raw) for (const s of JSON.parse(raw) as TaskCopyState[]) this._states.set(s.threadId, s);
		} catch { /* nothing kept, or unreadable: start empty */ }
	}

	// ---- state

	private _set(threadId: string, patch: Partial<TaskCopyState> | undefined, base?: TaskCopyState): void {
		if (!patch) this._states.delete(threadId);
		else {
			const cur = base ?? this._states.get(threadId);
			if (!cur) return;
			this._states.set(threadId, { ...cur, ...patch });
		}
		try { this._storage.store(STORAGE_KEY, JSON.stringify([...this._states.values()].filter(s => s.phase !== 'discarded')), StorageScope.APPLICATION, StorageTarget.MACHINE); } catch { /* not kept; the copy still works */ }
		this._onDidChange.fire();
	}

	getState(threadId: string): TaskCopyState | undefined { return this._states.get(threadId); }
	getQuestion(threadId: string): StartQuestion | undefined { return this._questions.get(threadId)?.q; }
	copyOf(threadId: string): { worktreePath: string; branchName: string } | undefined {
		const s = this._states.get(threadId);
		return hasCopyOnDisk(s) ? { worktreePath: s!.worktreePath, branchName: s!.branchName } : undefined;
	}

	answerQuestion(threadId: string, answer: StartAnswer): void {
		const q = this._questions.get(threadId);
		if (!q) return;
		this._questions.delete(threadId);
		this._onDidChange.fire();
		q.resolve(answer);
	}

	private _ask(threadId: string, q: StartQuestion): Promise<StartAnswer> {
		return new Promise(resolve => {
			this._questions.set(threadId, { q, resolve });
			this._onDidChange.fire();
		});
	}

	// ---- before a task starts

	prepareForTask(threadId: string, message: string): Promise<'copy' | 'direct' | 'cancel'> {
		// two turns sent quickly on one thread must not make two copies
		const running = this._preparing.get(threadId);
		if (running) return running;
		const p = this._prepare(threadId, message).finally(() => this._preparing.delete(threadId));
		this._preparing.set(threadId, p);
		return p;
	}

	private async _prepare(threadId: string, message: string): Promise<'copy' | 'direct' | 'cancel'> {
		if (!this._settings.state.globalSettings.taskCopies) return 'direct';
		if (hasCopyOnDisk(this._states.get(threadId))) return 'copy';
		const repoPath = this._workspace.getWorkspace().folders[0]?.uri.fsPath;
		if (!repoPath) return 'direct';

		let insp = await this._git.inspectRepo(repoPath);
		if (!insp.isRepo || !insp.hasCommits) {
			const a = await this._ask(threadId, { kind: 'not-git' });
			if (a === 'use-chat') { await this._settings.setGlobalSetting('chatMode', 'normal'); return 'cancel'; }
			if (a !== 'init-git') return 'cancel';
			const init = await this._git.initRepo(repoPath);
			if (!init.ok) return this._copyFailed(threadId, init.reason);
			insp = await this._git.inspectRepo(repoPath);
		}
		if (insp.dirtyFiles > 0 && !this._startedAnyway.has(threadId)) {
			const a = await this._ask(threadId, { kind: 'dirty', files: insp.dirtyFiles, project: repoPath.split(/[\\/]/).filter(Boolean).pop() ?? repoPath });
			if (a === 'cancel') return 'cancel';
			this._startedAnyway.add(threadId); // asked once for a thread, not before every message
			if (a === 'commit') {
				const c = await this._git.commitAllChanges({ repoPath, message: 'Save my changes before an agent task' });
				if (!c.ok) return this._copyFailed(threadId, c.reason);
			}
		}

		const branchName = branchNameFor(message, threadId);
		const created = await this._git.createWorktree({ repoPath, branchName });
		if (!created.ok) return this._copyFailed(threadId, created.reason);
		const baseBranch = (await this._git.getCurrentBranch(repoPath)) || 'HEAD';
		this._set(threadId, { threadId, title: taskTitleOf(message), repoPath, worktreePath: created.worktreePath, branchName: created.branchName, baseBranch, phase: 'working', files: 0 } as TaskCopyState, { threadId } as TaskCopyState);
		return 'copy';
	}

	private async _copyFailed(threadId: string, reason: string): Promise<'direct' | 'cancel'> {
		const a = await this._ask(threadId, { kind: 'copy-failed', reason });
		return a === 'work-in-folder' ? 'direct' : 'cancel';
	}

	// ---- where the agent's calls go

	remapToolParams<T extends object>(threadId: string, toolName: string, params: T): T {
		const s = this._states.get(threadId);
		if (!hasCopyOnDisk(s)) return params;
		const from = s!.repoPath, to = s!.worktreePath;
		const out: { [k: string]: unknown } = { ...(params as { [k: string]: unknown }) };
		const toCopy = (u: URI): URI => u.scheme === 'file' && isInside(u.fsPath, from) ? URI.file(remapPath(u.fsPath, from, to)) : u;
		for (const [k, v] of Object.entries(out)) {
			if (URI.isUri(v)) out[k] = toCopy(v);
			else if (k === 'cwd' && typeof v === 'string' && v.trim()) out[k] = remapPath(v, from, to);
		}
		// a command or a terminal with no folder named starts in the project's folder; here that is the copy
		if ((toolName === 'run_command' || toolName === 'open_persistent_terminal') && (out.cwd === null || out.cwd === undefined || out.cwd === '')) out.cwd = to;
		// a search over "the project" searches the copy, which holds what the agent has changed
		if (toolName === 'search_for_files' && out.searchInFolder === null) out.searchInFolder = URI.file(to);
		return out as T;
	}

	async saveOpenFiles(threadId: string): Promise<void> {
		const s = this._states.get(threadId);
		if (!hasCopyOnDisk(s)) return;
		const dirty = this._textFiles.files.models.filter(m => m.isDirty() && isInside(m.resource.fsPath, s!.worktreePath));
		await Promise.all(dirty.map(m => m.save().catch(() => undefined)));
	}

	async afterRun(threadId: string, { keepIfEmpty }: { keepIfEmpty: boolean }): Promise<void> {
		const s = this._states.get(threadId);
		if (!s || s.phase !== 'working') return;
		await this.saveOpenFiles(threadId);
		const files = (await this._git.changedFilesVsBase({ worktreePath: s.worktreePath, baseBranch: s.baseBranch })).length;
		if (files === 0 && !keepIfEmpty) {
			await this._git.removeWorktree({ repoPath: s.repoPath, worktreePath: s.worktreePath, branchName: s.branchName });
			this._set(threadId, undefined);
			return;
		}
		if (files !== s.files) this._set(threadId, { files });
	}

	// ---- accepting

	private _commitMessage(s: TaskCopyState): string { return `Agent: ${s.title}`; }

	async merge(threadId: string): Promise<void> {
		const s = this._states.get(threadId);
		if (!s || !hasCopyOnDisk(s) || s.phase === 'merging' || s.phase === 'agent-merging') return;
		this._set(threadId, { phase: 'merging', failure: undefined, conflictFiles: undefined, note: undefined });
		await this.saveOpenFiles(threadId);
		await this._mergeNow(threadId);
	}

	private async _mergeNow(threadId: string): Promise<void> {
		const s = this._states.get(threadId)!;
		const target = (await this._git.getCurrentBranch(s.repoPath)) || s.baseBranch;
		const preMergeSha = await this._git.headOf(s.repoPath);
		const res = await this._git.commitAndMergeWorktreeBranch({ repoPath: s.repoPath, worktreePath: s.worktreePath, branchName: s.branchName, targetBranch: target, commitMessage: this._commitMessage(s) });
		await this._afterMerge(threadId, res, preMergeSha, target);
	}

	private async _afterMerge(threadId: string, res: Awaited<ReturnType<IGitWorktreeMainService['commitAndMergeWorktreeBranch']>>, preMergeSha: string, target: string): Promise<void> {
		const s = this._states.get(threadId)!;
		if (!res.ok) {
			if (res.conflictFiles?.length) { this._set(threadId, { phase: 'conflict', conflictFiles: res.conflictFiles, baseBranch: target }); return; }
			const f = classifyMergeFailure(res.reason);
			this._set(threadId, { phase: 'failed', failure: { kind: f.kind, reason: res.reason, files: f.files }, baseBranch: target });
			return;
		}
		await this._git.removeWorktree({ repoPath: s.repoPath, worktreePath: s.worktreePath, branchName: s.branchName });
		if (!res.merged) { this._set(threadId, undefined); return; } // nothing changed after all
		const mergeSha = await this._git.headOf(s.repoPath);
		this._set(threadId, { phase: 'merged', baseBranch: target, preMergeSha, mergeSha, conflictFiles: undefined, failure: undefined, resolving: undefined, resolved: undefined });
	}

	async stashAndRetry(threadId: string): Promise<void> {
		const s = this._states.get(threadId);
		if (!s || s.phase !== 'failed' || s.failure?.kind !== 'local-changes') return;
		this._set(threadId, { phase: 'merging', failure: undefined });
		const stash = await this._git.stashChanges({ repoPath: s.repoPath, message: `Vader: your changes, set aside before merging ${s.branchName}` });
		if (!stash.ok) { this._set(threadId, { phase: 'failed', failure: { kind: 'other', reason: stash.reason, files: [] } }); return; }
		await this._mergeNow(threadId);
		if (stash.stashed) {
			const pop = await this._git.popStash(s.repoPath);
			const cur = this._states.get(threadId);
			if (!pop.ok && cur) this._set(threadId, { note: pop.kept ? 'Your own changes could not be put back on top of the merged files, so they are kept in git’s stash (git stash list).' : `Your own changes could not be put back: ${pop.reason.split('\n')[0]}` });
		}
	}

	async resolveConflict(threadId: string, choice: ConflictChoice): Promise<void> {
		const s = this._states.get(threadId);
		if (!s || s.phase !== 'conflict') return;
		const target = (await this._git.getCurrentBranch(s.repoPath)) || s.baseBranch;
		const preMergeSha = await this._git.headOf(s.repoPath);
		const files = s.conflictFiles ?? [];
		this._set(threadId, choice === 'agent' ? { phase: 'agent-merging', resolving: files, resolved: [] } : { phase: 'merging' });
		await this.saveOpenFiles(threadId);
		const gateway = () => this._instantiation.invokeFunction(a => a.get(IAgentGatewayService)); // resolved when needed: the gateway depends on the chat service, which depends on this one
		const done = await resolveTaskConflict({
			git: this._git,
			runAgent: (prompt) => gateway().runIsolatedTask({ task: prompt }),
			onProgress: ({ files: all, resolved }) => this._set(threadId, { resolving: all.filter(f => !resolved.includes(f)), resolved: [...resolved] }),
		}, { repoPath: s.repoPath, worktreePath: s.worktreePath, branchName: s.branchName, targetBranch: target, task: s.title, choice, commitMessage: this._commitMessage(s) });
		if (done.ok) {
			await this._afterMerge(threadId, { ok: true, merged: true }, preMergeSha, target);
		} else {
			const f = classifyMergeFailure(done.reason);
			// an agent that gave up leaves the conflict for the person to decide again; any other failure is shown as one
			this._set(threadId, choice === 'agent' && !f.files.length ? { phase: 'conflict', resolving: undefined, resolved: undefined, note: done.reason } : { phase: 'failed', failure: { kind: f.kind, reason: done.reason, files: f.files } });
		}
	}

	async undoMerge(threadId: string): Promise<void> {
		const s = this._states.get(threadId);
		if (!s || s.phase !== 'merged' || !s.mergeSha || s.undone) return;
		const r = await this._git.undoMerge({ repoPath: s.repoPath, mergeSha: s.mergeSha });
		if (r.ok) this._set(threadId, { undone: true, note: mergedUndoneNote(s) });
		else this._set(threadId, { note: `The merge could not be undone: ${r.reason.split('\n').find(l => l.trim()) ?? 'git stopped.'}` });
	}

	async discard(threadId: string): Promise<void> {
		const s = this._states.get(threadId);
		if (!s) return;
		if (hasCopyOnDisk(s)) await this._git.removeWorktree({ repoPath: s.repoPath, worktreePath: s.worktreePath, branchName: s.branchName });
		this._set(threadId, undefined);
	}

	dismiss(threadId: string): void {
		const s = this._states.get(threadId);
		if (s && !hasCopyOnDisk(s)) this._set(threadId, undefined);
	}
}

registerSingleton(ITaskCopyService, TaskCopyService, InstantiationType.Delayed);
