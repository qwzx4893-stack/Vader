/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What the chat says about a run, as rules without the editor (the interface boards S01 and S03): how the run ended and what it was doing when the person stopped it,
// the messages that wait for their turn, how full the conversation is against the room the model has, and how long a pasted text may be before it is folded.

import { imageChars } from './imageRules.js';
import { CHARS_PER_TOKEN, inputBudgetChars, PRUNE_START_FRACTION, SUMMARISE_FRACTION, systemOverheadChars } from './contextBudget.js';

// ---- how a run ended

/** what the chat remembers about a run the person stopped, until the next message */
export type StoppedRun = { readonly at: number, readonly doing: string };

export type RunSnapshot =
	| { readonly phase: 'writing' }
	| { readonly phase: 'tool', readonly toolName: string, readonly command?: string }
	| { readonly phase: 'awaiting_approval', readonly toolName?: string, readonly command?: string }
	| { readonly phase: 'idle' };

const clip = (s: string, n: number) => { const one = s.replace(/\s+/g, ' ').trim(); return one.length > n ? one.slice(0, n - 1) + '…' : one; };
const VERBS: { readonly [tool: string]: string } = {
	read_file: 'reading a file', ls_dir: 'listing a folder', get_dir_tree: 'reading the folder tree', search_pathnames_only: 'searching for files', search_for_files: 'searching the project', search_in_file: 'searching a file',
	edit_file: 'editing a file', rewrite_file: 'writing a file', create_file_or_folder: 'creating a file', delete_file_or_folder: 'deleting a file', run_command: 'running a command', run_persistent_command: 'running a command',
	open_persistent_terminal: 'opening a terminal', browser_navigate: 'loading a page', browser_click: 'clicking on a page', browser_type: 'typing on a page', browser_screenshot: 'taking a screenshot',
};

/** "Stopped while running npm test": the words after the stop, from what the run was doing at that moment */
export function stoppedWhile(s: RunSnapshot): string {
	switch (s.phase) {
		case 'writing': return 'Stopped while writing an answer';
		case 'tool': return s.command ? `Stopped while running ${clip(s.command, 60)}` : `Stopped while ${VERBS[s.toolName] ?? 'using a tool'}`;
		case 'awaiting_approval': return s.command ? `Stopped while asking to run ${clip(s.command, 60)}` : `Stopped while waiting for your answer`;
		case 'idle': return 'Stopped between two steps';
	}
}

export type RunEnd = 'finished' | 'stopped' | 'error';

/** A message waits for the run to end on its own; a run that was stopped or failed keeps it in the list for the person to send or remove. */
export const shouldSendQueued = (end: RunEnd, queued: number): boolean => end === 'finished' && queued > 0;

// ---- the messages that wait

export type QueuedMessage = { readonly id: string, readonly text: string };
export const MAX_QUEUED_MESSAGES = 5;

/** adds a message at the end; an empty one, or one over the limit, is not added (the second is reported by `queueIsFull`) */
export function enqueue(queue: readonly QueuedMessage[] | undefined, text: string, id: string): QueuedMessage[] {
	const q = [...(queue ?? [])];
	const t = text.trim();
	if (!t || q.length >= MAX_QUEUED_MESSAGES) return q;
	return [...q, { id, text: t }];
}
export const queueIsFull = (queue: readonly QueuedMessage[] | undefined): boolean => (queue?.length ?? 0) >= MAX_QUEUED_MESSAGES;
export const removeQueued = (queue: readonly QueuedMessage[] | undefined, id: string): QueuedMessage[] => (queue ?? []).filter(m => m.id !== id);
/** the first message to send, and what remains */
export function takeNext(queue: readonly QueuedMessage[] | undefined): { next: QueuedMessage | undefined, rest: QueuedMessage[] } {
	const q = [...(queue ?? [])];
	return { next: q[0], rest: q.slice(1) };
}

// ---- how full the conversation is

/** the real steps, from contextBudget.ts: old tool output is dropped from half of the room, older messages are summarised from 70% of it; the chat starts to say so at 60% */
export type ContextStage = 'roomy' | 'filling' | 'summarising';

/** the share of the room a request may use (the model's window, less what is kept for the answer) that this conversation takes, from its size in characters */
export function contextShare(messageChars: number, contextWindow: number, reservedOutputTokenSpace?: number | null): number {
	if (!(contextWindow > 0)) return 0;
	const budget = inputBudgetChars(contextWindow, reservedOutputTokenSpace);
	return Math.max(0, (messageChars + systemOverheadChars(contextWindow)) / budget);
}

export const SHOW_CONTEXT_FROM = 0.6;
/** "roomy" below 60% of the room: nothing to say. From 60% the chat says it is filling; from 70% the next request summarises. */
export function contextStage(share: number): ContextStage {
	if (share >= SUMMARISE_FRACTION) return 'summarising';
	if (share >= SHOW_CONTEXT_FROM) return 'filling';
	return 'roomy';
}

/** the words of the banner, with the figures the app really uses */
export function contextBanner(share: number): { title: string, body: string } | undefined {
	const stage = contextStage(share);
	if (stage === 'roomy') return undefined;
	const pct = Math.min(100, Math.round(share * 100));
	const sum = Math.round(SUMMARISE_FRACTION * 100);
	if (stage === 'summarising') return { title: `${pct}% of the room is used`, body: `Vader summarises the older messages before the next request, and keeps the newest ones as they are. Old tool output is dropped first.` };
	return { title: `${pct}% of the room is used`, body: `From ${sum}% Vader summarises the older messages and keeps the newest ones as they are. Old tool output is dropped first, from ${Math.round(PRUNE_START_FRACTION * 100)}% of the room.` };
}

/** 62000 -> "62K", 900 -> "900" */
export const kTokens = (n: number): string => n >= 1000 ? `${Math.round(n / 1000)}K` : `${Math.max(0, Math.round(n))}`;

/** a conversation that is already bigger than what the model can take (after a smaller model was chosen): said before the request fails, with the figures */
export function contextOverflow(messageChars: number, contextWindow: number, reservedOutputTokenSpace: number | null | undefined, modelName: string): { title: string, body: string, usedTokens: number, windowTokens: number, cutTokens: number } | undefined {
	if (!(contextWindow > 0) || contextShare(messageChars, contextWindow, reservedOutputTokenSpace) < 1) return undefined;
	const usedTokens = Math.round((messageChars + systemOverheadChars(contextWindow)) / CHARS_PER_TOKEN);
	const cutTokens = Math.max(0, usedTokens - Math.round(inputBudgetChars(contextWindow, reservedOutputTokenSpace) / CHARS_PER_TOKEN));
	return {
		title: 'This chat is bigger than the model’s window',
		body: `The chat is about ${kTokens(usedTokens)} tokens. ${modelName} reads ${kTokens(contextWindow)}. Vader would have to cut the oldest ${kTokens(cutTokens)}.`,
		usedTokens, windowTokens: contextWindow, cutTokens,
	};
}

/** what fills the window, in tokens, by what it is made of (board R06, "Context meter"): the system prompt and tool list, what the tools returned, what was said, and any summary */
export type ContextBreakdown = { readonly rows: readonly { readonly label: string, readonly tokens: number }[], readonly usedTokens: number, readonly windowTokens: number, readonly share: number };

export function contextBreakdown(messages: readonly { readonly role: string, readonly displayContent?: unknown, readonly content?: unknown, readonly summary?: unknown, readonly outputPruned?: unknown, readonly images?: readonly { readonly width: number, readonly height: number }[] }[], contextWindow: number, reservedOutputTokenSpace?: number | null): ContextBreakdown {
	let tool = 0, said = 0, summary = 0, pictures = 0;
	for (const m of messages) {
		if (m.role === 'user') pictures += (m.images ?? []).reduce((k, i) => k + imageChars(i.width, i.height), 0);
		if (m.role === 'user' || m.role === 'assistant') said += typeof m.displayContent === 'string' ? m.displayContent.length : 0;
		else if (m.role === 'tool') tool += m.outputPruned ? 0 : typeof m.content === 'string' ? m.content.length : 0;
		else if (m.role === 'compacted_summary') summary += typeof m.summary === 'string' ? m.summary.length : 0;
	}
	const toTokens = (chars: number) => Math.round(chars / CHARS_PER_TOKEN);
	const rows = [
		{ label: 'System and tools', tokens: toTokens(systemOverheadChars(contextWindow)) },
		{ label: 'Files and tool output', tokens: toTokens(tool) },
		{ label: 'Conversation', tokens: toTokens(said) },
		...(pictures > 0 ? [{ label: 'Images', tokens: toTokens(pictures) }] : []),
		...(summary > 0 ? [{ label: 'Summary of earlier steps', tokens: toTokens(summary) }] : []),
	];
	return { rows, usedTokens: rows.reduce((n, r) => n + r.tokens, 0), windowTokens: contextWindow, share: contextShare(tool + said + summary + pictures, contextWindow, reservedOutputTokenSpace) };
}

/** the line under the breakdown: what the app really does with the room */
export const contextMeterNote = (): string => `Old tool output is dropped from ${Math.round(PRUNE_START_FRACTION * 100)}%. Earlier steps are summarised from ${Math.round(SUMMARISE_FRACTION * 100)}%.`;

/** the characters of a conversation as the model will be asked about it: what was said, what the tools returned (a result that was dropped counts as nothing), and a summary */
export function messageChars(messages: readonly { readonly role: string, readonly displayContent?: unknown, readonly content?: unknown, readonly summary?: unknown, readonly outputPruned?: unknown, readonly images?: readonly { readonly width: number, readonly height: number }[] }[]): number {
	let n = 0;
	for (const m of messages) {
		if (m.role === 'user') n += (m.images ?? []).reduce((k, i) => k + imageChars(i.width, i.height), 0);
		if (m.role === 'user' || m.role === 'assistant') n += typeof m.displayContent === 'string' ? m.displayContent.length : 0;
		else if (m.role === 'tool') n += m.outputPruned ? 0 : typeof m.content === 'string' ? m.content.length : 0;
		else if (m.role === 'compacted_summary') n += typeof m.summary === 'string' ? m.summary.length : 0;
	}
	return n;
}

// ---- a long paste

/** a pasted text longer than this many lines, or characters, is shown as one line with Show and Remove, and sent in full */
export const PASTE_FOLD_LINES = 12;
export const PASTE_FOLD_CHARS = 1500;

export function shouldFoldPaste(text: string): boolean {
	return text.split(/\r\n|\r|\n/).length > PASTE_FOLD_LINES || text.length > PASTE_FOLD_CHARS;
}
export function describePaste(text: string): { lines: number, chars: number, label: string } {
	const lines = text.split(/\r\n|\r|\n/).length;
	const chars = text.length;
	const size = chars >= 1000 ? `${(chars / 1000).toFixed(chars >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K characters` : `${chars} characters`;
	return { lines, chars, label: `${lines} line${lines === 1 ? '' : 's'}, ${size}` };
}

export { CHARS_PER_TOKEN };
