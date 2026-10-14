/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Conversations under the project they belong to, like the sidebar of Claude Code or Codex: a folder name, and under it the conversations
// started in that folder. A thread remembers the folders that were open when it began (ThreadType.projectFolders); an older thread has none
// and is listed under "Chats", the conversations that belong to no project.

/** the folder a thread belongs to: the first folder that was open, written the same way wherever it came from (slashes, case of a drive letter, no trailing slash) */
export function projectKeyOf(folders: readonly string[] | undefined | null): string | null {
	const first = folders?.find(f => typeof f === 'string' && f.trim().length > 0);
	if (!first) return null;
	let key = first.trim().replace(/\\/g, '/').replace(/\/+$/, '');
	if (/^[A-Za-z]:/.test(key)) key = key[0].toLowerCase() + key.slice(1); // C:/x and c:/x are the same folder
	return key || null;
}

/** what the sidebar shows for a project: the last part of its path */
export function projectNameOf(key: string): string {
	const parts = key.split('/').filter(Boolean);
	return parts[parts.length - 1] ?? key;
}

export type ThreadForGrouping = {
	readonly id: string;
	readonly lastModified: string;
	readonly messageCount: number;
	readonly projectFolders?: readonly string[];
	/** a hidden thread made for a sub-agent, a check or a research task */
	readonly hidden?: boolean;
};

export type ProjectGroup = {
	/** null for the conversations that belong to no project */
	readonly key: string | null;
	readonly name: string;
	/** newest first */
	readonly threadIds: readonly string[];
	readonly lastModified: string;
};

/**
 * Projects with their conversations. Hidden threads and empty ones are left out. The project that is open now comes first, then the others
 * by their most recent conversation, and "Chats" (no project) last. Two names that are the same folder name in different places stay two
 * projects (the key is the whole path), so the caller can tell them apart by adding the parent folder when names collide.
 */
export function groupThreadsByProject(threads: readonly ThreadForGrouping[], currentKey?: string | null): ProjectGroup[] {
	const byKey = new Map<string | null, ThreadForGrouping[]>();
	for (const t of threads) {
		if (t.hidden || t.messageCount === 0) continue;
		const k = projectKeyOf(t.projectFolders);
		const list = byKey.get(k) ?? [];
		list.push(t);
		byKey.set(k, list);
	}
	const groups: ProjectGroup[] = [];
	for (const [key, list] of byKey) {
		list.sort((a, b) => (a.lastModified < b.lastModified ? 1 : a.lastModified > b.lastModified ? -1 : 0));
		groups.push({ key, name: key === null ? 'Chats' : projectNameOf(key), threadIds: list.map(t => t.id), lastModified: list[0].lastModified });
	}
	const rank = (g: ProjectGroup) => (g.key === null ? 2 : g.key === (currentKey ?? undefined) ? 0 : 1);
	groups.sort((a, b) => rank(a) - rank(b) || (a.lastModified < b.lastModified ? 1 : a.lastModified > b.lastModified ? -1 : 0));
	return groups;
}

/** names that appear more than once among the projects, so the list can show "api / web" instead of two rows called "web" */
export function projectDisplayNames(groups: readonly ProjectGroup[]): Map<string | null, string> {
	const counts = new Map<string, number>();
	for (const g of groups) counts.set(g.name, (counts.get(g.name) ?? 0) + 1);
	const out = new Map<string | null, string>();
	for (const g of groups) {
		if (g.key !== null && (counts.get(g.name) ?? 0) > 1) {
			const parts = g.key.split('/').filter(Boolean);
			out.set(g.key, parts.length >= 2 ? `${parts[parts.length - 2]} / ${parts[parts.length - 1]}` : g.name);
		} else {
			out.set(g.key, g.name);
		}
	}
	return out;
}
