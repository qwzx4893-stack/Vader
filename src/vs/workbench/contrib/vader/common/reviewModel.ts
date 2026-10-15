/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What the review page shows of a change (board R02): the files grouped by folder with how much each changed, each change as rows of lines with the
// lines around it, which changes are too big or too generated to open by default, and the page where a pull request is made. Pure, so every rule is
// tested without the editor (test/reviewModelE2E.mjs).

/** the shape of a diff as the editor's edit service keeps it (common/editCodeServiceTypes.ts), only what is read here */
export type DiffLike =
	| { readonly type: 'edit'; readonly originalCode: string; readonly originalStartLine: number; readonly code: string; readonly startLine: number }
	| { readonly type: 'insertion'; readonly originalStartLine: number; readonly code: string; readonly startLine: number }
	| { readonly type: 'deletion'; readonly originalCode: string; readonly originalStartLine: number; readonly startLine: number };

const linesOf = (text: string | undefined): string[] => (text === undefined || text === '' ? [] : text.replace(/\r\n/g, '\n').split('\n'));

export function diffCounts(d: DiffLike): { added: number; removed: number } {
	return {
		added: d.type === 'deletion' ? 0 : linesOf(d.code).length,
		removed: d.type === 'insertion' ? 0 : linesOf(d.originalCode).length,
	};
}

export function fileCounts(diffs: readonly DiffLike[]): { added: number; removed: number } {
	let added = 0, removed = 0;
	for (const d of diffs) { const c = diffCounts(d); added += c.added; removed += c.removed; }
	return { added, removed };
}

export type Row = { readonly kind: 'ctx' | 'del' | 'add'; readonly n: number; readonly text: string };

/**
 * The rows of one change: up to `context` unchanged lines before it, the removed lines (numbered as they were), the added lines (numbered as they are now), and
 * up to `context` unchanged lines after it. `fileLines` is the file as it is now, so the lines around come from it.
 */
export function hunkRows(d: DiffLike, fileLines: readonly string[], context = 2): Row[] {
	const rows: Row[] = [];
	const added = d.type === 'deletion' ? [] : linesOf(d.code);
	const removed = d.type === 'insertion' ? [] : linesOf(d.originalCode);
	const firstNew = d.startLine;
	for (let n = Math.max(1, firstNew - context); n < firstNew; n++) {
		if (n - 1 < fileLines.length) rows.push({ kind: 'ctx', n, text: fileLines[n - 1] });
	}
	removed.forEach((text, i) => rows.push({ kind: 'del', n: d.originalStartLine + i, text }));
	added.forEach((text, i) => rows.push({ kind: 'add', n: firstNew + i, text }));
	const after = firstNew + added.length;
	for (let n = after; n < after + context; n++) {
		if (n - 1 < fileLines.length) rows.push({ kind: 'ctx', n, text: fileLines[n - 1] });
	}
	return rows;
}

const GENERATED = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|go\.sum|composer\.lock)$|(^|\/)(generated|dist|build|out|node_modules)\//i;
export const FOLD_ABOVE_LINES = 400;

/** a change that is large, or in a file nobody writes by hand, is folded until the person opens it */
export function isFolded(path: string, total: number): boolean {
	return total > FOLD_ABOVE_LINES || GENERATED.test(path.replace(/\\/g, '/'));
}

export type FolderGroup<T> = { readonly folder: string; readonly files: T[] };

/** the changed files grouped by the folder they are in, written relative to the project when they are inside it; the folders in the order they first appear */
export function groupByFolder<T extends { readonly path: string }>(files: readonly T[], projectRoot: string | undefined): FolderGroup<T>[] {
	const root = projectRoot ? projectRoot.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : undefined;
	const rel = (p: string) => {
		const norm = p.replace(/\\/g, '/');
		return root && norm.toLowerCase().startsWith(root + '/') ? norm.slice(root.length + 1) : norm;
	};
	const groups = new Map<string, T[]>();
	for (const f of files) {
		const parts = rel(f.path).split('/');
		const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
		const list = groups.get(folder) ?? [];
		list.push(f);
		groups.set(folder, list);
	}
	return [...groups.entries()].map(([folder, list]) => ({ folder, files: list }));
}

export function relativePath(path: string, projectRoot: string | undefined): string {
	const norm = path.replace(/\\/g, '/');
	const root = projectRoot ? projectRoot.replace(/\\/g, '/').replace(/\/+$/, '') : undefined;
	return root && norm.toLowerCase().startsWith(root.toLowerCase() + '/') ? norm.slice(root.length + 1) : norm;
}

/** the page where a pull request is made from the branch, when the remote is on GitHub; undefined otherwise (no remote, another host, or no branch) */
export function pullRequestPageUrl(remoteUrl: string, branch: string): string | undefined {
	const b = branch.trim();
	if (!b) return undefined;
	const m = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(remoteUrl.trim());
	if (!m) return undefined;
	return `https://github.com/${m[1]}/${m[2]}/compare/${encodeURIComponent(b).replace(/%2F/gi, '/')}?expand=1`;
}

/** what a commit button says it will commit */
export function commitSummary(files: number, added: number, removed: number): string {
	if (files === 0) return 'No changes to commit';
	return `${files} changed file${files === 1 ? '' : 's'}, +${added} −${removed}`;
}
