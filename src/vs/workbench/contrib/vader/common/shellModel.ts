/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What the sidebar and the "All agents" page of the Vader window say about a conversation. Pure: it only reads what the chat thread service already
// holds, so every rule here is tested without the editor (test/shellModelE2E.mjs).

import { ThreadStatus } from './threadStatus.js';
import { parseTaskList, summariseTaskList, Task } from './taskList.js';

type MessageLike = {
	readonly role: string;
	readonly displayContent?: string;
	readonly type?: string;
	readonly name?: string;
	readonly params?: unknown;
	readonly result?: unknown;
};

type UriParams = { readonly uri?: { readonly fsPath?: string } | string };

export type ThreadLike = {
	readonly id: string;
	readonly lastModified: string;
	readonly createdAt?: string;
	readonly messages: readonly MessageLike[];
	readonly isSubagentThread?: boolean;
	readonly isVerificationThread?: boolean;
	readonly agentId?: string | null;
	/** a name the person gave it */
	readonly customTitle?: string;
};

const TITLE_CHARS = 80;

/** the name of a conversation: what the person called it, else the first thing they said, on one line */
export function threadTitle(t: Pick<ThreadLike, 'messages' | 'customTitle'>): string {
	if (t.customTitle && t.customTitle.trim()) return t.customTitle.trim();
	const first = t.messages.find(m => m.role === 'user' && (m.displayContent ?? '').trim().length > 0);
	const text = (first?.displayContent ?? '').replace(/\s+/g, ' ').trim();
	if (!text) return 'New chat';
	return text.length > TITLE_CHARS ? text.slice(0, TITLE_CHARS - 1).trimEnd() + '…' : text;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** how long ago, the way the sidebar writes it: 2m, 14m, 1h, then the weekday for the last week, then the date */
export function ageLabel(iso: string, now: number): string {
	const then = Date.parse(iso);
	if (!Number.isFinite(then)) return '';
	const mins = Math.max(0, Math.floor((now - then) / 60000));
	if (mins < 1) return 'now';
	if (mins < 60) return `${mins}m`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h`;
	const d = new Date(then);
	if (hours < 24 * 7) return DAYS[d.getDay()];
	return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

const FILE_CHANGING = new Set(['edit_file', 'rewrite_file', 'create_file_or_folder', 'delete_file_or_folder']);

/** a conversation in which the agent used tools is an agent task; one without is a chat (board R03: "Chat, no changes to files") */
export function isAgentTask(t: Pick<ThreadLike, 'messages' | 'agentId'>): boolean {
	return t.messages.some(m => m.role === 'tool') || !!t.agentId;
}

/** the files the agent changed in a conversation (successful edits only), in the order they were first changed */
export function changedFilePaths(messages: readonly MessageLike[]): string[] {
	const out: string[] = [];
	for (const m of messages) {
		if (m.role !== 'tool' || m.type !== 'success' || !m.name || !FILE_CHANGING.has(m.name)) continue;
		const u = (m.params as UriParams | undefined)?.uri;
		const p = typeof u === 'string' ? u : u?.fsPath;
		if (p && !out.includes(p)) out.push(p);
	}
	return out;
}

/** hidden conversations (made for a helper agent, a check or a research task) are never listed */
export function isListed(t: Pick<ThreadLike, 'isSubagentThread' | 'isVerificationThread' | 'messages'>): boolean {
	return !t.isSubagentThread && !t.isVerificationThread && t.messages.length > 0;
}

export type Glyph = 'running' | 'needs_you' | 'review' | 'error' | 'paused' | 'none';

/** the small mark in front of a conversation in a list */
export function glyphOf(status: ThreadStatus): Glyph {
	switch (status) {
		case 'running': return 'running';
		case 'needs_you': return 'needs_you';
		case 'review': return 'review';
		case 'error': return 'error';
		case 'paused': return 'paused';
		default: return 'none';
	}
}

/** the tabs of the "All agents" page and what each holds */
export type AgentGroupId = 'needs_you' | 'running' | 'review' | 'merged';

export const AGENT_GROUP_TITLE: Record<AgentGroupId, string> = { needs_you: 'Needs you', running: 'Running', review: 'Ready to review', merged: 'Merged' };
export const AGENT_GROUP_ORDER: readonly AgentGroupId[] = ['needs_you', 'running', 'review', 'merged'];

/** which group of the "All agents" page a conversation belongs to: waiting for the person, working (or paused), changes to read, or finished */
export function agentGroupOf(status: ThreadStatus): AgentGroupId {
	if (status === 'needs_you' || status === 'error') return 'needs_you';
	if (status === 'running' || status === 'paused') return 'running';
	if (status === 'review') return 'review';
	return 'merged';
}

// ---- what an agent has been doing (the "Steps" column and the detail panel of All agents)

// ---- the helpers a task handed work to (board R04, "Sub-agents")

export type SubAgent = { readonly label: string; /** what kind of helper: research, browser, verify, or the name of the saved agent */ readonly kind: string; readonly state: 'running' | 'done' | 'failed' };

const oneLine = (s: string, n = 70): string => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '\u2026' : t; };

/** the helpers the agent started in this conversation, in the order it started them, with whether each is still working */
export function subAgents(messages: readonly MessageLike[]): SubAgent[] {
	const out: SubAgent[] = [];
	for (const m of messages) {
		if (m.role !== 'tool' || !m.name) continue;
		const state: SubAgent['state'] = m.type === 'success' ? (((m.result ?? {}) as { hadError?: boolean }).hadError ? 'failed' : 'done') : m.type === 'running_now' || m.type === 'tool_request' ? 'running' : m.type === 'tool_error' ? 'failed' : 'done';
		if (m.type === 'rejected' || m.type === 'invalid_params') continue;
		const p = (m.params ?? {}) as { task?: unknown; objective?: unknown; agentName?: unknown; specs?: unknown };
		if (m.name === 'delegate_research_task' && typeof p.task === 'string') out.push({ label: oneLine(p.task), kind: 'research', state });
		else if (m.name === 'delegate_browser_task' && typeof p.task === 'string') out.push({ label: oneLine(p.task), kind: 'browser', state });
		else if (m.name === 'delegate_subagent_task' && typeof p.task === 'string') out.push({ label: oneLine(p.task), kind: typeof p.agentName === 'string' && p.agentName ? p.agentName : 'helper', state });
		else if (m.name === 'run_verification_agent') out.push({ label: typeof p.objective === 'string' && p.objective ? oneLine(p.objective) : 'Check the result, read-only', kind: 'verify', state });
		else if (m.name === 'delegate_parallel_tasks' && Array.isArray(p.specs)) {
			for (const s of p.specs as { task?: unknown; agentName?: unknown }[]) if (typeof s?.task === 'string') out.push({ label: oneLine(s.task), kind: typeof s.agentName === 'string' && s.agentName ? s.agentName : 'parallel', state });
		}
	}
	return out;
}

/** the task list the agent last wrote, if it wrote one */
export function latestTaskList(messages: readonly MessageLike[]): { tasks: Task[]; total: number; done: number } | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role !== 'tool' || m.name !== 'update_task_list' || m.type !== 'success') continue;
		const text = (m.result as { text?: string } | null)?.text;
		if (!text) continue;
		const tasks = parseTaskList(text);
		const s = summariseTaskList(tasks);
		return { tasks, total: s.total, done: s.done };
	}
	return undefined;
}

export type Activity = { verb: string; target: string };

const VERB_OF: Record<string, string> = {
	read_file: 'Read', ls_dir: 'Listed', get_dir_tree: 'Listed', search_pathnames_only: 'Searched', search_for_files: 'Searched', search_in_file: 'Searched',
	edit_file: 'Edited', rewrite_file: 'Rewrote', create_file_or_folder: 'Created', delete_file_or_folder: 'Deleted',
	run_command: 'Ran', run_persistent_command: 'Ran', open_persistent_terminal: 'Opened terminal', kill_persistent_terminal: 'Closed terminal', await_terminal: 'Waited for a terminal',
	repo_map: 'Mapped the project', codebase_search: 'Searched the project',
};

const baseName = (p: string) => p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p;

/** the last few things the agent did, newest last: "Edited contentBudget.ts", "Ran npm test" */
export function recentActivity(messages: readonly MessageLike[], max = 3): Activity[] {
	const out: Activity[] = [];
	for (let i = messages.length - 1; i >= 0 && out.length < max; i--) {
		const m = messages[i];
		if (m.role !== 'tool' || (m.type !== 'success' && m.type !== 'running_now' && m.type !== 'tool_request') || !m.name) continue;
		const verb = VERB_OF[m.name];
		if (!verb) continue;
		const params = (m.params ?? {}) as Record<string, unknown>;
		const uri = params.uri as { fsPath?: string } | string | undefined;
		const path = typeof uri === 'string' ? uri : uri?.fsPath;
		const cmd = typeof params.command === 'string' ? params.command : undefined;
		const query = typeof params.query === 'string' ? params.query : undefined;
		out.unshift({ verb, target: path ? baseName(path) : cmd ?? query ?? '' });
	}
	return out;
}

// ---- the page the agent opened and the terminals it started (boards R25 and R26)

const hostOf = (url: string): string => { try { return new URL(url).host || url; } catch { return url; } };

const BROWSER_VERB: Record<string, string> = {
	browser_new_page: 'Opened a new tab', browser_navigate: 'Opened', browser_reload: 'Reloaded', browser_click: 'Clicked', browser_type: 'Typed',
	browser_snapshot: 'Read the page', browser_screenshot: 'Took a screenshot', browser_switch_page: 'Switched tab', browser_close_page: 'Closed a tab',
	browser_console: 'Read the console', browser_network: 'Read the network',
};

/** what the agent did in its browser, oldest first: "Opened localhost:5173", "Clicked a button", "Took a screenshot" */
export function browserActivity(messages: readonly MessageLike[], max = 12): Activity[] {
	const out: Activity[] = [];
	for (const m of messages) {
		if (m.role !== 'tool' || m.type !== 'success' || !m.name || !m.name.startsWith('browser_')) continue;
		const verb = BROWSER_VERB[m.name] ?? m.name.replace(/^browser_/, '').replace(/_/g, ' ');
		const p = (m.params ?? {}) as Record<string, unknown>;
		const target = typeof p.url === 'string' ? hostOf(p.url) : m.name === 'browser_type' && typeof p.text === 'string' ? `“${p.text.slice(0, 40)}”` : typeof p.ref === 'string' ? p.ref : '';
		out.push({ verb, target });
	}
	return out.slice(-max);
}

export type TerminalRun = { readonly command: string; readonly status: 'done' | 'failed' | 'rejected' | 'running' | 'waiting'; readonly exitCode?: number };
export type TerminalOfTask = { readonly id: string; readonly persistent: boolean; readonly runs: TerminalRun[] };

/** the terminals a task used and what ran in each: persistent ones by their id, and every one-off command together as "commands" */
export function terminalActivity(messages: readonly MessageLike[]): { terminals: TerminalOfTask[]; ran: number; failed: number; rejected: number } {
	const byId = new Map<string, TerminalRun[]>();
	const oneOff: TerminalRun[] = [];
	let ran = 0, failed = 0, rejected = 0;
	for (const m of messages) {
		if (m.role !== 'tool' || !m.name) continue;
		if (m.name === 'open_persistent_terminal' && m.type === 'success') {
			const id = (m.result as { persistentTerminalId?: string } | null)?.persistentTerminalId;
			if (id && !byId.has(id)) byId.set(id, []);
			continue;
		}
		if (m.name !== 'run_command' && m.name !== 'run_persistent_command') continue;
		const p = (m.params ?? {}) as { command?: string; persistentTerminalId?: string };
		const command = String(p.command ?? '');
		const status: TerminalRun['status'] = m.type === 'rejected' ? 'rejected' : m.type === 'tool_request' ? 'waiting' : m.type === 'running_now' ? 'running' : m.type === 'tool_error' ? 'failed' : 'done';
		const reason = (m.result as { resolveReason?: { type?: string; exitCode?: number } } | null)?.resolveReason;
		const exitCode = reason?.type === 'done' ? reason.exitCode : undefined;
		// a command the agent stopped waiting for (a dev server, a watcher) is still running
		const stillRunning = status === 'done' && reason?.type === 'timeout';
		const finalStatus: TerminalRun['status'] = stillRunning ? 'running' : status === 'done' && exitCode !== undefined && exitCode !== 0 ? 'failed' : status;
		if (finalStatus === 'rejected') rejected++; else if (finalStatus === 'done' || finalStatus === 'failed' || finalStatus === 'running') { ran++; if (finalStatus === 'failed') failed++; }
		const run: TerminalRun = { command, status: finalStatus, exitCode };
		if (m.name === 'run_persistent_command' && p.persistentTerminalId) { const l = byId.get(p.persistentTerminalId) ?? []; l.push(run); byId.set(p.persistentTerminalId, l); }
		else oneOff.push(run);
	}
	const terminals: TerminalOfTask[] = [...byId.entries()].map(([id, runs]) => ({ id, persistent: true, runs }));
	if (oneOff.length > 0) terminals.push({ id: 'commands', persistent: false, runs: oneOff });
	return { terminals, ran, failed, rejected };
}

/**
 * What a person calls a terminal by what runs in it ("dev server", "tests") rather than by its number. Read from the first command that ran there; a command it does
 * not recognise is called by its program, and a terminal nothing ran in has no name of its own (undefined: the caller says "Terminal 2" or whatever it has).
 */
export function terminalLabel(runs: readonly { readonly command: string }[]): string | undefined {
	const first = runs.find(r => r.command.trim().length > 0)?.command.trim();
	if (!first) return undefined;
	const c = first.toLowerCase();
	if (/\b(test|tests|jest|vitest|pytest|mocha|playwright test|cargo test|go test)\b/.test(c)) return 'tests';
	if (/\b(lint|eslint|tsc|typecheck|type-check|check)\b/.test(c)) return 'checks';
	if (/\b(build|compile|bundle|webpack|rollup|esbuild|make)\b/.test(c)) return 'build';
	if (/\b(install|add|ci|restore|bundle install|pip install|npm i)\b/.test(c) && /\b(npm|pnpm|yarn|pip|bun|cargo|go|dotnet|bundle|gem)\b/.test(c)) return 'install';
	if (/\b(dev|start|serve|server|watch|preview|run dev|runserver|uvicorn|flask run|http\.server|vite|next dev|nodemon)\b/.test(c)) return 'dev server';
	if (/\b(git)\b/.test(c)) return 'git';
	const token = first.split(/\s+/)[0].split(/[\\/]/).pop() ?? '';
	const program = token.replace(/\.exe$/i, '');
	return program ? program.toLowerCase() : undefined;
}

/** what the list says under a terminal's name: whether the agent left it open, or how its last command ended */
export function terminalNote(runs: readonly TerminalRun[]): string {
	const last = runs[runs.length - 1];
	if (!last) return 'kept open by the agent';
	if (last.status === 'running') return 'running, kept open by the agent';
	if (last.status === 'waiting') return 'waiting for you to allow it';
	if (last.status === 'failed') return last.exitCode !== undefined ? `failed, exit ${last.exitCode}` : 'failed';
	if (last.status === 'rejected') return 'you rejected the last command';
	return last.exitCode !== undefined ? `finished, exit ${last.exitCode}` : 'finished';
}

/** what the line under the terminals says about the commands a task ran */
export function commandsLine(c: { ran: number; failed: number; rejected: number }): string {
	const total = c.ran + c.rejected;
	if (total === 0) return 'This task has not run a command.';
	const parts = [`${c.ran} ran`];
	if (c.failed > 0) parts.push(`${c.failed} failed`);
	if (c.rejected > 0) parts.push(`${c.rejected} you rejected`);
	return `${total} in all: ${parts.join(', ')}.`;
}
