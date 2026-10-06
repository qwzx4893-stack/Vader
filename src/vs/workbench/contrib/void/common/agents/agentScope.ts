/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { match as matchGlob } from '../../../../../base/common/glob.js';

// Filesystem scope of a permanent agent: it may touch a file only when the file is inside one of its scope globs.
// PolicyRule's glob matching is positive-only (match => deny/ask) and cannot say "deny everything NOT under these globs",
// hence this dedicated check. A glob is either absolute (`/srv/app/**`, `C:/work/**`) or relative to a workspace folder
// (`src/**`, `**/*.md`), the form a model naturally writes.

const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase(); // case-insensitive on every platform, like the Policy Engine
const isAbsoluteGlob = (g: string) => g.startsWith('/') || /^[a-z]:\//i.test(g);

const insideScope = (path: string, globs: readonly string[], roots: readonly string[]): boolean => {
	const p = norm(path);
	const relatives: string[] = [];
	for (const root of roots) {
		const r = norm(root).replace(/\/+$/, '');
		if (p === r) { relatives.push(''); } else if (p.startsWith(r + '/')) { relatives.push(p.slice(r.length + 1)); }
	}
	return globs.some(raw => {
		const g = norm(raw.trim()).replace(/^\.\//, '');
		if (!g) { return false; }
		if (isAbsoluteGlob(g)) { return matchGlob(g, p); }
		return relatives.some(rel => matchGlob(g, rel));
	});
};

/** `roots` are the workspace folders (and their real paths); `filePaths` are the paths a tool call names (and their real paths): every one of them must be in scope. */
export function agentScopeCheck(scopeGlobs: readonly string[] | undefined, filePaths: readonly string[] | undefined, roots: readonly string[]): { ok: true } | { ok: false, path: string } {
	if (!scopeGlobs || scopeGlobs.length === 0) { return { ok: true }; }
	if (!filePaths || filePaths.length === 0) { return { ok: true }; }
	for (const path of filePaths) {
		if (!insideScope(path, scopeGlobs, roots)) { return { ok: false, path }; }
	}
	return { ok: true };
}
