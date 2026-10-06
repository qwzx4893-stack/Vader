/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { VADER_AGENT_MEMORY_STORAGE_KEY, VADER_COMPACTION_ARCHIVE_STORAGE_KEY, VADER_PROJECT_MEMORY_STORAGE_KEY } from '../storageKeys.js';
import { IMemoryService, MemoryRecord, MemoryScope, MemorySource } from './memoryServiceTypes.js';

export * from './memoryServiceTypes.js';

// 'project' and 'agent' memory are meant to accumulate deliberately (a handful of written
// facts, not a log), so they're unbounded. 'compactionArchive' is written automatically by
// every compaction pass, so it's capped per-thread to bound storage growth - see
// chatThreadService.ts's _maybeCompactThread, the only writer of that scope.
const MAX_COMPACTION_ARCHIVE_ENTRIES_PER_THREAD = 20;

const STORAGE_KEY_OF_SCOPE: Record<MemoryScope, string> = {
	project: VADER_PROJECT_MEMORY_STORAGE_KEY,
	agent: VADER_AGENT_MEMORY_STORAGE_KEY,
	compactionArchive: VADER_COMPACTION_ARCHIVE_STORAGE_KEY,
};

// 'project' memory is meaningless outside the workspace it describes, so it's stored
// per-workspace; 'agent' memory follows agentsService.ts's own scope (APPLICATION - agents
// are global, not per-workspace); the compaction archive follows a thread's own workspace
// scope, same reasoning as 'project'.
const STORAGE_SCOPE_OF_SCOPE: Record<MemoryScope, StorageScope> = {
	project: StorageScope.WORKSPACE,
	agent: StorageScope.APPLICATION,
	compactionArchive: StorageScope.WORKSPACE,
};

class MemoryService extends Disposable implements IMemoryService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeMemory = this._register(new Emitter<void>());
	readonly onDidChangeMemory: Event<void> = this._onDidChangeMemory.event;

	// one in-memory array per scope, lazily hydrated from its own storage key/scope
	private readonly _recordsByScope: Record<MemoryScope, MemoryRecord[] | undefined> = {
		project: undefined,
		agent: undefined,
		compactionArchive: undefined,
	};

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
	) {
		super();
	}

	private _load(scope: MemoryScope): MemoryRecord[] {
		const cached = this._recordsByScope[scope];
		if (cached) return cached;
		let records: MemoryRecord[] = [];
		try {
			const raw = this._storageService.get(STORAGE_KEY_OF_SCOPE[scope], STORAGE_SCOPE_OF_SCOPE[scope]);
			if (raw) {
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) records = parsed;
			}
		} catch {
			records = [];
		}
		this._recordsByScope[scope] = records;
		return records;
	}

	private _save(scope: MemoryScope, records: MemoryRecord[]) {
		this._recordsByScope[scope] = records;
		this._storageService.store(STORAGE_KEY_OF_SCOPE[scope], JSON.stringify(records), STORAGE_SCOPE_OF_SCOPE[scope], StorageTarget.USER);
		this._onDidChangeMemory.fire();
	}

	list(scope: MemoryScope, scopeKey?: string): MemoryRecord[] {
		const records = this._load(scope);
		return scopeKey === undefined ? records.slice() : records.filter(r => r.scopeKey === scopeKey);
	}

	get(id: string): MemoryRecord | undefined {
		for (const scope of Object.keys(this._recordsByScope) as MemoryScope[]) {
			const found = this._load(scope).find(r => r.id === id);
			if (found) return found;
		}
		return undefined;
	}

	write(opts: { scope: MemoryScope; scopeKey: string; label: string; content: string; source: MemorySource }): MemoryRecord {
		const now = Date.now();
		const record: MemoryRecord = {
			id: generateUuid(),
			scope: opts.scope,
			scopeKey: opts.scopeKey,
			label: opts.label,
			content: opts.content,
			createdAt: now,
			updatedAt: now,
			source: opts.source,
		};
		let records = [...this._load(opts.scope), record];

		if (opts.scope === 'compactionArchive') {
			// evict the oldest entries for this thread once past the cap, oldest-first
			const forThisThread = records.filter(r => r.scopeKey === opts.scopeKey).sort((a, b) => a.createdAt - b.createdAt);
			if (forThisThread.length > MAX_COMPACTION_ARCHIVE_ENTRIES_PER_THREAD) {
				const toEvict = new Set(forThisThread.slice(0, forThisThread.length - MAX_COMPACTION_ARCHIVE_ENTRIES_PER_THREAD).map(r => r.id));
				records = records.filter(r => !toEvict.has(r.id));
			}
		}

		this._save(opts.scope, records);
		return record;
	}

	update(id: string, patch: Partial<Pick<MemoryRecord, 'label' | 'content'>>): void {
		for (const scope of Object.keys(this._recordsByScope) as MemoryScope[]) {
			const records = this._load(scope);
			const idx = records.findIndex(r => r.id === id);
			if (idx === -1) continue;
			const updated = [...records];
			updated[idx] = { ...updated[idx], ...patch, updatedAt: Date.now() };
			this._save(scope, updated);
			return;
		}
	}

	remove(id: string): void {
		for (const scope of Object.keys(this._recordsByScope) as MemoryScope[]) {
			const records = this._load(scope);
			if (!records.some(r => r.id === id)) continue;
			this._save(scope, records.filter(r => r.id !== id));
			return;
		}
	}

	clearScope(scope: MemoryScope, scopeKey?: string): void {
		const records = this._load(scope);
		const remaining = scopeKey === undefined ? [] : records.filter(r => r.scopeKey !== scopeKey);
		this._save(scope, remaining);
	}
}

registerSingleton(IMemoryService, MemoryService, InstantiationType.Delayed);
