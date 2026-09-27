/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { VoidFileSnapshot } from './editCodeServiceTypes.js';
import { AnthropicReasoning, RawToolParamsObj } from './sendLLMMessageTypes.js';
import { ToolCallParams, ToolName, ToolResult } from './toolsServiceTypes.js';

export type ToolMessage<T extends ToolName> = {
	role: 'tool';
	content: string; // give this result to LLM (string of value)
	id: string;
	rawParams: RawToolParamsObj;
	mcpServerName: string | undefined; // the server name at the time of the call
} & (
		// in order of events:
		| { type: 'invalid_params', result: null, name: T, }

		| { type: 'tool_request', result: null, name: T, params: ToolCallParams<T>, }  // params were validated, awaiting user

		| { type: 'running_now', result: null, name: T, params: ToolCallParams<T>, }

		| { type: 'tool_error', result: string, name: T, params: ToolCallParams<T>, } // error when tool was running
		| { type: 'success', result: Awaited<ToolResult<T>>, name: T, params: ToolCallParams<T>, }
		| { type: 'rejected', result: null, name: T, params: ToolCallParams<T> }
	) // user rejected

export type DecorativeCanceledTool = {
	role: 'interrupted_streaming_tool';
	name: ToolName;
	mcpServerName: string | undefined; // the server name at the time of the call
}


// Vader addition: structured context compaction. Replaces a run of older messages with a
// structured summary when a thread approaches its model's context limit - see
// chatThreadService.ts's _maybeCompactThread. This is purely additive to the ChatMessage
// union (a new role, not a changed meaning for an existing one), so old persisted threads -
// which can never contain this role - need no migration; they simply never hit this case.
// The raw messages this replaces are archived via common/memory/ (scope 'compactionArchive'),
// never deleted outright, so compaction can never be a silent, permanent loss of history.
export type CompactedSummaryEntry = {
	role: 'compacted_summary';
	originalMessageCount: number;
	compactedAt: string; // ISO timestamp, also used as the memory archive's lookup key
	summary: {
		objective: string;
		constraints: string;
		decisions: string;
		architectureNotes: string;
		filesModified: string;
		importantLocations: string;
		unresolvedProblems: string;
		testResults: string;
		nextSteps: string;
	};
}

// checkpoints
export type CheckpointEntry = {
	role: 'checkpoint';
	type: 'user_edit' | 'tool_edit';
	voidFileSnapshotOfURI: { [fsPath: string]: VoidFileSnapshot | undefined };

	userModifications: {
		voidFileSnapshotOfURI: { [fsPath: string]: VoidFileSnapshot | undefined };
	};
}


// WARNING: changing this format is a big deal!!!!!! need to migrate old format to new format on users' computers so people don't get errors.
export type ChatMessage =
	| {
		role: 'user';
		content: string; // content displayed to the LLM on future calls - allowed to be '', will be replaced with (empty)
		displayContent: string; // content displayed to user  - allowed to be '', will be ignored
		selections: StagingSelectionItem[] | null; // the user's selection
		state: {
			stagingSelections: StagingSelectionItem[];
			isBeingEdited: boolean;
		}
	} | {
		role: 'assistant';
		displayContent: string; // content received from LLM  - allowed to be '', will be replaced with (empty)
		reasoning: string; // reasoning from the LLM, used for step-by-step thinking

		anthropicReasoning: AnthropicReasoning[] | null; // anthropic reasoning
	}
	| ToolMessage<ToolName>
	| DecorativeCanceledTool
	| CheckpointEntry
	| CompactedSummaryEntry


// one of the square items that indicates a selection in a chat bubble
export type StagingSelectionItem = {
	type: 'File';
	uri: URI;
	language: string;
	state: { wasAddedAsCurrentFile: boolean; };
} | {
	type: 'CodeSelection';
	range: [number, number];
	uri: URI;
	language: string;
	state: { wasAddedAsCurrentFile: boolean; };
} | {
	type: 'Folder';
	uri: URI;
	language?: undefined;
	state?: undefined;
}


// a link to a symbol (an underlined link to a piece of code)
export type CodespanLocationLink = {
	uri: URI, // we handle serialization for this
	displayText: string,
	selection?: { // store as JSON so dont have to worry about serialization
		startLineNumber: number
		startColumn: number,
		endLineNumber: number
		endColumn: number,
	} | undefined
} | null
