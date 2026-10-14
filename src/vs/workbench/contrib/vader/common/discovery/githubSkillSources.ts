/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A GitHub repository that holds skills (each skill is a folder with a SKILL.md) is a source the skills store can browse, next to
// SkillNet. These are the pure helpers: turning a repository name into an owner and a repo, finding the skill folders in a
// repository's file tree, and reading the name and description from a SKILL.md. The network calls live in electron-main/discoveryMainService.ts.

export type GithubRepoRef = { readonly owner: string; readonly repo: string };

export type GithubTreeEntry = { readonly path: string; readonly type: string; readonly size?: number };

export type SkillFolder = {
	/** folder of the skill inside the repository; empty for a skill at the root */
	readonly dir: string;
	readonly skillMdPath: string;
	/** every file in the folder added up, the size a person pays to install it */
	readonly sizeBytes: number;
};

const SEGMENT = /^[A-Za-z0-9_.-]+$/;

/** accepts "owner/repo" and https://github.com/owner/repo (with or without .git or a trailing path); anything else is refused */
export function parseRepoRef(spec: string): GithubRepoRef | null {
	const s = spec.trim();
	let owner: string | undefined;
	let repo: string | undefined;
	if (/^https?:\/\//i.test(s)) {
		let url: URL;
		try { url = new URL(s); } catch { return null; }
		if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.port) { return null; }
		[owner, repo] = url.pathname.split('/').filter(Boolean);
	} else {
		[owner, repo] = s.split('/');
	}
	if (!owner || !repo) { return null; }
	repo = repo.replace(/\.git$/, '');
	if (!SEGMENT.test(owner) || !SEGMENT.test(repo) || owner === '.' || owner === '..' || repo === '.' || repo === '..') { return null; }
	return { owner, repo };
}

/** every folder that holds a SKILL.md, with the total size of the files inside it; hidden folders and test fixtures are left out */
export function skillFoldersFromTree(tree: readonly GithubTreeEntry[], maxFolders = 80): SkillFolder[] {
	const blobs = tree.filter(t => t.type === 'blob');
	const folders: SkillFolder[] = [];
	for (const b of blobs) {
		const m = /^(?:(.*)\/)?SKILL\.md$/.exec(b.path);
		if (!m) { continue; }
		const dir = m[1] ?? '';
		const segments = dir.split('/').filter(Boolean);
		if (segments.some(s => s.startsWith('.') || s === 'node_modules' || s === 'test' || s === 'tests' || s === 'fixtures' || s === 'template' || s === 'templates')) { continue; }
		if (!segments.every(s => SEGMENT.test(s))) { continue; }
		const prefix = dir ? `${dir}/` : '';
		const sizeBytes = blobs.filter(x => (dir ? x.path.startsWith(prefix) : true)).reduce((n, x) => n + (x.size ?? 0), 0);
		folders.push({ dir, skillMdPath: b.path, sizeBytes });
		if (folders.length >= maxFolders) { break; }
	}
	return folders;
}

/** reads name and description from the --- block at the top of a SKILL.md; a folded or literal block (">" or "|") is joined onto one line */
export function parseSkillFrontmatter(markdown: string): { name?: string; description?: string } {
	const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
	if (!m) { return {}; }
	const lines = m[1].split(/\r?\n/);
	const out: { name?: string; description?: string } = {};
	for (let i = 0; i < lines.length; i++) {
		const kv = /^(name|description):\s*(.*)$/.exec(lines[i]);
		if (!kv) { continue; }
		let value = kv[2].trim();
		if (value === '>' || value === '|' || value === '>-' || value === '|-') {
			const parts: string[] = [];
			while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) { parts.push(lines[++i].trim()); }
			value = parts.join(' ');
		}
		value = value.replace(/^["']|["']$/g, '');
		if (value) { out[kv[1] as 'name' | 'description'] = value; }
	}
	return out;
}

/** the page of one skill folder on GitHub; rawSkillInstructionUrls in githubSkillUrl.ts understands this shape */
export function skillFolderUrl(ref: GithubRepoRef, branch: string, dir: string): string {
	return dir ? `https://github.com/${ref.owner}/${ref.repo}/tree/${branch}/${dir}` : `https://github.com/${ref.owner}/${ref.repo}`;
}
