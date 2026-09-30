/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// SkillNet and the MCP registry are third-party indexes, so the repository URL they return is
// untrusted input. Only a plain https://github.com/<owner>/<repo>[/tree/<ref>/<subpath>] URL is turned
// into raw.githubusercontent.com URLs. The old pattern was unanchored, so any URL that merely
// contained "github.com/..." (for example https://evil.test/?github.com/o/r) was accepted.

const SEGMENT = /^[A-Za-z0-9_.-]+$/;
const FILENAMES = ['SKILL.md', 'skill.md', 'README.md', 'readme.md'];

export function rawSkillInstructionUrls(repositoryUrl: string): string[] | null {
	let url: URL;
	try { url = new URL(repositoryUrl); } catch { return null; }
	if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.port) { return null; }

	const parts = url.pathname.split('/').filter(Boolean);
	if (parts.length < 2) { return null; }
	const owner = parts[0];
	const repo = parts[1].replace(/\.git$/, '');
	if (!SEGMENT.test(owner) || !SEGMENT.test(repo) || repo === '.' || repo === '..') { return null; }

	let ref = 'main';
	let sub: string[] = [];
	if (parts.length > 2) {
		if (parts[2] !== 'tree' || parts.length < 4) { return null; }
		ref = parts[3];
		sub = parts.slice(4);
		if (!SEGMENT.test(ref) || ref === '.' || ref === '..') { return null; }
		if (!sub.every(p => SEGMENT.test(p) && p !== '.' && p !== '..')) { return null; }
	}
	const base = sub.length ? `${sub.join('/')}/` : '';
	return FILENAMES.map(f => `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${base}${f}`);
}
