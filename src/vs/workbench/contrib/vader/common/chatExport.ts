/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A conversation as a Markdown file the person owns (board S13): what was said, one line for each thing the agent did, and which files it changed. Keys and settings are
// not part of a conversation, so they are not in the file; what the person typed into the conversation is exported as typed.

export type ExportMessage = {
	readonly role: string;
	readonly displayContent?: unknown;
	readonly summary?: unknown;
	readonly name?: unknown;
	readonly type?: unknown;
	readonly params?: unknown;
	readonly images?: readonly { readonly name: string }[];
};

const FILE_TOOLS = new Set(['edit_file', 'rewrite_file', 'create_file_or_folder', 'delete_file_or_folder']);
const READ_TOOLS = new Set(['read_file', 'ls_dir', 'get_dir_tree']);
const pathOf = (params: unknown): string | undefined => {
	const u = (params as { uri?: unknown } | undefined)?.uri;
	const p = typeof u === 'string' ? u : (u as { fsPath?: unknown } | undefined)?.fsPath;
	return typeof p === 'string' ? p.replace(/\\/g, '/') : undefined;
};
const one = (s: string) => s.replace(/\s+/g, ' ').trim();

/** one line for a tool call, or undefined when it says nothing the reader needs */
export function toolLine(m: ExportMessage): string | undefined {
	if (m.role !== 'tool' || typeof m.name !== 'string') return undefined;
	if (m.type === 'tool_request') return undefined; // still waiting: not something that happened
	const status = m.type === 'rejected' ? ' (you rejected it)' : m.type === 'tool_error' ? ' (it failed)' : '';
	const params = m.params as { command?: unknown } | undefined;
	if ((m.name === 'run_command' || m.name === 'run_persistent_command') && typeof params?.command === 'string') return `Ran \`${one(params.command).replace(/`/g, "'")}\`${status}`;
	const p = pathOf(m.params);
	if (FILE_TOOLS.has(m.name) && p) return `${m.name === 'delete_file_or_folder' ? 'Deleted' : m.name === 'create_file_or_folder' ? 'Created' : 'Edited'} \`${p}\`${status}`;
	if (READ_TOOLS.has(m.name) && p) return `Read \`${p}\`${status}`;
	return `Used ${m.name.replace(/_/g, ' ')}${status}`;
}

export function chatToMarkdown(thread: { readonly messages: readonly ExportMessage[] }, opts: { title: string, exportedOn: Date }): string {
	const out: string[] = [];
	out.push(`# ${one(opts.title) || 'Chat'}`);
	out.push('');
	out.push(`Exported from Vader on ${opts.exportedOn.toISOString().slice(0, 10)}. API keys and settings are not part of a conversation and are not in this file.`);
	const changed: string[] = [];
	let lastRole = '';
	for (const m of thread.messages) {
		if (m.role === 'user') {
			out.push('', '## You', '', String(m.displayContent ?? '').trim());
			// the images are named, never put in the file
			if (m.images && m.images.length > 0) out.push('', m.images.map(i => `[image: ${i.name}]`).join(' '));
			lastRole = 'user';
		} else if (m.role === 'assistant') {
			const text = String(m.displayContent ?? '').trim();
			if (!text) continue;
			if (lastRole !== 'assistant') out.push('', '## Vader', '');
			else out.push('');
			out.push(text);
			lastRole = 'assistant';
		} else if (m.role === 'tool') {
			const line = toolLine(m);
			if (!line) continue;
			if (lastRole !== 'tool') out.push('');
			out.push(`- ${line}`);
			lastRole = 'tool';
			const p = pathOf(m.params);
			if (m.type === 'success' && typeof m.name === 'string' && FILE_TOOLS.has(m.name) && p && !changed.includes(p)) changed.push(p);
		} else if (m.role === 'compacted_summary' && typeof m.summary === 'string') {
			out.push('', '_Earlier messages were summarised:_', '', m.summary.trim());
			lastRole = 'summary';
		}
	}
	if (changed.length) { out.push('', '## Files changed', ''); for (const c of changed) out.push(`- \`${c}\``); }
	return out.join('\n') + '\n';
}

/** a file name for the export: the title, made safe for any file system */
export function exportFileName(title: string): string {
	const base = one(title).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, '-').replace(/^\.+/, '').slice(0, 60).replace(/-+$/, '');
	return `${base || 'chat'}.md`;
}
