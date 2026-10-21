/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A backup of what is Vader's own (board S11): the chats, the saved agents, the rules the person wrote and the settings, in one file, without API keys and without the
// contents of the projects. Restoring only ADDS: chats and agents that are not here are added, those already here are kept as they are, and nothing is overwritten.
// The words of each step say what will happen before it happens. Pure: reading and writing the services is done by the Data and backup page.

export type BackupChat = { readonly id: string, readonly [k: string]: unknown };
export type BackupAgent = { readonly name: string, readonly description?: string, readonly instructions?: string, readonly [k: string]: unknown };
export type BackupRule = { readonly description: string, readonly effect: 'deny' | 'ask', readonly kinds: readonly string[], readonly [k: string]: unknown };

export type Backup = {
	readonly format: 'vader-backup';
	readonly version: 1;
	readonly createdAt: string;
	readonly chats: { readonly [id: string]: BackupChat };
	readonly agents: readonly BackupAgent[];
	readonly rules: readonly BackupRule[];
	/** the settings as they are exported (keys and headers already left out) */
	readonly settings: unknown;
};

export function buildBackup(parts: { chats: { [id: string]: BackupChat }, agents: readonly BackupAgent[], rules: readonly BackupRule[], settings: unknown }, now: Date): Backup {
	return { format: 'vader-backup', version: 1, createdAt: now.toISOString(), chats: parts.chats, agents: parts.agents, rules: parts.rules, settings: parts.settings };
}

export const backupFileName = (now: Date): string => `vader-backup-${now.toISOString().slice(0, 10)}.json`;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export type ParsedBackup = { readonly ok: true, readonly backup: Backup } | { readonly ok: false, readonly reason: string };

/** reads a backup file; says what is wrong with one that is not a backup, or is from a newer Vader */
export function parseBackup(text: string): ParsedBackup {
	let json: unknown;
	try { json = JSON.parse(text); } catch { return { ok: false, reason: 'It is not a backup file: it is not readable as JSON.' }; }
	if (!isObj(json) || json.format !== 'vader-backup') return { ok: false, reason: 'It is not a Vader backup.' };
	if (json.version !== 1) return { ok: false, reason: typeof json.version === 'number' && json.version > 1 ? 'It was made by a newer Vader than this one. Update Vader, then restore it.' : 'Its version is not one this Vader knows.' };
	const chats: { [id: string]: BackupChat } = {};
	if (isObj(json.chats)) for (const [id, c] of Object.entries(json.chats)) { if (isObj(c) && typeof c.id === 'string' && Array.isArray(c.messages)) chats[id] = c as BackupChat; }
	const agents = Array.isArray(json.agents) ? json.agents.filter((a): a is BackupAgent => isObj(a) && typeof a.name === 'string' && a.name.length > 0) : [];
	const rules = Array.isArray(json.rules) ? json.rules.filter((r): r is BackupRule => isObj(r) && typeof r.description === 'string' && (r.effect === 'deny' || r.effect === 'ask') && Array.isArray(r.kinds)) : [];
	return { ok: true, backup: { format: 'vader-backup', version: 1, createdAt: typeof json.createdAt === 'string' ? json.createdAt : '', chats, agents, rules, settings: json.settings } };
}

export type RestorePlan = {
	readonly addChatIds: string[];
	readonly keptChats: number;
	readonly addAgents: BackupAgent[];
	readonly keptAgents: number;
	readonly addRules: BackupRule[];
	readonly keptRules: number;
};

export function planRestore(b: Backup, here: { chatIds: ReadonlySet<string>, agentNames: ReadonlySet<string>, ruleDescriptions: ReadonlySet<string> }): RestorePlan {
	const ids = Object.keys(b.chats);
	const addChatIds = ids.filter(id => !here.chatIds.has(id));
	const addAgents = b.agents.filter(a => !here.agentNames.has(a.name));
	const addRules = b.rules.filter(r => !here.ruleDescriptions.has(r.description));
	return { addChatIds, keptChats: ids.length - addChatIds.length, addAgents, keptAgents: b.agents.length - addAgents.length, addRules, keptRules: b.rules.length - addRules.length };
}

const n = (count: number, one: string, many = one + 's') => `${count} ${count === 1 ? one : many}`;

/** the question before a restore: what will be added and what stays as it is */
export function restoreWords(p: RestorePlan, fileName: string): { title: string, text: string, nothing: boolean } {
	const added = [p.addChatIds.length ? n(p.addChatIds.length, 'chat') : '', p.addAgents.length ? n(p.addAgents.length, 'saved agent') : '', p.addRules.length ? n(p.addRules.length, 'rule') : ''].filter(Boolean);
	const kept = p.keptChats + p.keptAgents + p.keptRules;
	if (added.length === 0) return { title: `Restore from ${fileName}?`, text: kept > 0 ? 'Everything in it is already here, so nothing would be added.' : 'There is nothing in it to restore.', nothing: true };
	const list = added.length === 1 ? added[0] : `${added.slice(0, -1).join(', ')} and ${added[added.length - 1]}`;
	const keep = [p.keptChats ? n(p.keptChats, 'chat') : '', p.keptAgents ? n(p.keptAgents, 'saved agent') : '', p.keptRules ? n(p.keptRules, 'rule') : ''].filter(Boolean);
	return { title: `Restore from ${fileName}?`, text: `${list} will be added.${keep.length ? ` ${keep.join(', ')} that ${kept === 1 ? 'is' : 'are'} already here ${kept === 1 ? 'is' : 'are'} kept as ${kept === 1 ? 'it is' : 'they are'}.` : ''} Nothing here is overwritten.`, nothing: false };
}

export const BACKUP_TITLE = 'Back up your data';
export const BACKUP_TEXT = 'Chats, saved agents, your rules and settings. Not included: API keys and the contents of your projects.';

/** the question before all chats are deleted */
export const deleteChatsWords = (count: number): { title: string, text: string } => ({
	title: `Delete ${count === 1 ? 'this chat' : `all ${count} chats`}?`,
	text: 'This cannot be undone. Saved agents, rules and settings stay.',
});
