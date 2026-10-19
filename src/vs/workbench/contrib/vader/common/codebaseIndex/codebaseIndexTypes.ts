/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

// The index of a project's code, kept on this computer by the main process (electron-main/codebaseIndexer.ts) and asked by the agent's `codebase_search` tool and by Settings.
// What it is and what it leaves out: docs/integrations/codebase-index.md.

export type IndexStatus = 'idle' | 'indexing' | 'ready' | 'error'
export type IndexState = { status: IndexStatus; files: number; chunks: number; rootHash: string; updatedAt: number; truncated: boolean; message?: string; progress?: { done: number; total: number } }
export type SearchOutcome = { text: string; results: { file: string; start: number; end: number; score: number }[]; files: number; stale: boolean }

export interface ICodebaseIndexMainService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeState: Event<{ root: string; state: IndexState }>;
	/** starts indexing the project (and keeping the index current as files change); returns at once with the state */
	open(root: string): Promise<IndexState>;
	getState(root: string): Promise<IndexState | undefined>;
	/** the places in the project that best match the question (the first time, it waits for the index to be built) */
	search(root: string, query: string, opts?: { directories?: string[]; limit?: number }): Promise<SearchOutcome>;
	/** forgets the saved index and builds it again */
	rebuild(root: string): Promise<IndexState>;
	/** stops watching the project and frees what the index holds in memory (the saved index stays) */
	close(root: string): Promise<void>;
}

export const ICodebaseIndexMainService = createDecorator<ICodebaseIndexMainService>('vaderCodebaseIndexMainService');
