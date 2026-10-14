/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Where each conversation stands, so a list of them can say which one needs the person ("Needs you"), which is working, and which has
// changes waiting to be read. Pure: it only reads what the chat thread service already knows.

export type ThreadStatus = 'needs_you' | 'running' | 'paused' | 'error' | 'review' | 'idle';

export type StatusInput = {
	/** the live state of the run, if any (IsRunningType in chatThreadService.ts) */
	readonly isRunning: 'LLM' | 'tool' | 'awaiting_user' | 'idle' | undefined;
	readonly isPaused: boolean;
	readonly hasError: boolean;
	/** the thread ends with a tool request nobody answered */
	readonly endsWithToolRequest: boolean;
	/** the agent changed files since the last message from the person */
	readonly changedFilesSinceLastUserMessage: boolean;
};

/** a person is needed first, then work in progress, then a failure, then changes to read */
export function deriveThreadStatus(i: StatusInput): ThreadStatus {
	if (i.isRunning === 'awaiting_user' || i.endsWithToolRequest) return 'needs_you';
	if (i.isPaused) return 'paused';
	if (i.isRunning === 'LLM' || i.isRunning === 'tool' || i.isRunning === 'idle') return 'running';
	if (i.hasError) return 'error';
	if (i.changedFilesSinceLastUserMessage) return 'review';
	return 'idle';
}

const FILE_CHANGING_TOOLS = new Set(['edit_file', 'rewrite_file', 'create_file_or_folder', 'delete_file_or_folder']);

type MessageLike = { readonly role: string; readonly type?: string; readonly name?: string };

/** true when a file-changing tool finished successfully after the last message from the person */
export function changedFilesSinceLastUserMessage(messages: readonly MessageLike[]): boolean {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role === 'user') return false;
		if (m.role === 'tool' && m.type === 'success' && m.name && FILE_CHANGING_TOOLS.has(m.name)) return true;
	}
	return false;
}

export function endsWithToolRequest(messages: readonly MessageLike[]): boolean {
	const last = messages[messages.length - 1];
	return !!last && last.role === 'tool' && last.type === 'tool_request';
}

/** how the status reads in a list; "Needs you" first in any ordering */
export const STATUS_ORDER: readonly ThreadStatus[] = ['needs_you', 'running', 'paused', 'error', 'review', 'idle'];

export const STATUS_LABEL: Record<ThreadStatus, string> = {
	needs_you: 'Needs you', running: 'Working', paused: 'Paused', error: 'Stopped by an error', review: 'Ready to review', idle: '',
};
