/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../../base/common/event.js';

// Three of Vader's memory layers are persistent and inspectable through this service:
//   - 'project'          long-lived knowledge about the open workspace, written by the
//                         `remember` tool or the user, surviving across threads/sessions.
//   - 'agent'             a permanent agent's own persistent memory (see common/agents/),
//                         keyed by agentId, surviving across every thread run as that agent.
//   - 'compactionArchive' the raw messages a compaction pass replaced with a summary (see
//                         chatThreadService.ts's _maybeCompactThread) - kept so compaction
//                         is never a destructive, unrecoverable drop of history, bounded per
//                         thread so it can't grow without limit.
// The other three layers the mission's memory architecture asks for are NOT separate
// storage: "immediate conversation" and "current task" are already exactly
// IChatThreadService's persisted ThreadType.messages (a second copy would just be a second,
// driftable source of truth for the same data), and "temporary subagent scratch memory" is
// already exactly a hidden subagent thread's own messages, discarded (never written here)
// once runSubagentTask returns its structured summary - see ARCHITECTURE.md's agent loop
// section and agentGatewayTypes.ts's IsolatedTaskResult.
export type MemoryScope = 'project' | 'agent' | 'compactionArchive';

export type MemorySource = 'agent_written' | 'user_written' | 'compaction';

export type MemoryRecord = {
	id: string;
	scope: MemoryScope;
	/** workspace root fsPath for 'project', agentId for 'agent', threadId for 'compactionArchive' */
	scopeKey: string;
	label: string;
	content: string;
	createdAt: number;
	updatedAt: number;
	source: MemorySource;
};

export interface IMemoryService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeMemory: Event<void>;

	list(scope: MemoryScope, scopeKey?: string): MemoryRecord[];
	get(id: string): MemoryRecord | undefined;
	write(opts: { scope: MemoryScope; scopeKey: string; label: string; content: string; source: MemorySource }): MemoryRecord;
	update(id: string, patch: Partial<Pick<MemoryRecord, 'label' | 'content'>>): void;
	remove(id: string): void;
	/** clears every record in a scope, or only those matching scopeKey when given - the Memory UI's "clear" action */
	clearScope(scope: MemoryScope, scopeKey?: string): void;
}

export const IMemoryService = createDecorator<IMemoryService>('vaderMemoryService');
