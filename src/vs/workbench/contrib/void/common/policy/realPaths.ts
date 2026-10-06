/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';

// The Policy Engine and agent scopes match path globs against the path a tool call names. A model (or text it
// read) can name a path through a symbolic link: `project/docs/credentials` where `docs` is a link to `~/.aws`
// matches none of the secret-file globs, yet reads the credentials. So every file path is also resolved to where it
// really points, and the gate evaluates the path as written AND the resolved one (the more restrictive verdict wins).
//
// Dot segments are collapsed first, so `..` cannot walk around a rule either (URI.fsPath keeps them as written).
//
// A path that does not exist yet (create_file_or_folder, rewrite_file on a new file) is resolved through its nearest
// existing ancestor, because the ancestor can be the link (`link/new.txt` creates a file in the link's target).

export type RealpathFn = (resource: URI) => Promise<URI | undefined>;

const MAX_ANCESTOR_STEPS = 64;
const RESOLVE_TIMEOUT_MS = 3000;

const splitTrailing = (fsPath: string): { parent: string; name: string } | undefined => {
	const trimmed = fsPath.replace(/[\\/]+$/, '');
	const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
	if (i <= 0) { return undefined; } // a root: nothing above it
	const parent = trimmed.slice(0, i);
	if (/^[A-Za-z]:$/.test(parent)) { return { parent: parent + '\\', name: trimmed.slice(i + 1) }; } // keep the drive root
	return { parent, name: trimmed.slice(i + 1) };
};

/** The path with every symbolic link in it resolved, or undefined when nothing could be resolved (no provider support, no existing ancestor). */
export async function resolveRealFsPath(realpath: RealpathFn, fsPath: string): Promise<string | undefined> {
	const suffix: string[] = [];
	let current = fsPath;
	for (let step = 0; step < MAX_ANCESTOR_STEPS; step++) {
		try {
			const real = await realpath(URI.file(current));
			if (real) { return suffix.length ? `${real.fsPath.replace(/[\\/]+$/, '')}/${suffix.reverse().join('/')}` : real.fsPath; }
			return undefined; // the provider cannot resolve links at all
		} catch {
			const up = splitTrailing(current);
			if (!up) { return undefined; }
			suffix.push(up.name);
			current = up.parent;
		}
	}
	return undefined;
}

/** The path with `.` and `..` segments collapsed, without touching the file system (`/ws/src/../../etc/shadow` is `/etc/shadow`). */
export function normalizeDotSegments(fsPath: string): string {
	const sep = fsPath.includes('\\') && !fsPath.includes('/') ? '\\' : '/';
	const parts = fsPath.split(/[\\/]+/);
	const drive = /^[A-Za-z]:$/.test(parts[0] ?? '') ? parts.shift()! : undefined;
	const absolute = drive !== undefined || fsPath.startsWith('/') || fsPath.startsWith('\\');
	const out: string[] = [];
	for (const part of parts) {
		if (part === '' || part === '.') { continue; }
		if (part === '..') { if (out.length && out[out.length - 1] !== '..') { out.pop(); } else if (!absolute) { out.push('..'); } continue; }
		out.push(part);
	}
	return (drive ?? '') + (absolute ? sep : '') + out.join(sep);
}

/** `fsPaths` plus the resolved form of each one that differs, so that a rule or a scope matching either one applies. Never throws, never waits more than a few seconds. */
export async function withResolvedPaths(realpath: RealpathFn, fsPaths: string[]): Promise<string[]> {
	const out = [...fsPaths];
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<undefined>(res => { timer = setTimeout(() => res(undefined), RESOLVE_TIMEOUT_MS); });
	try {
		for (const p of fsPaths) {
			const lexical = normalizeDotSegments(p);
			if (lexical !== p && !out.includes(lexical)) { out.push(lexical); }
			const real = await Promise.race([resolveRealFsPath(realpath, lexical).catch(() => undefined), timeout]);
			if (real && !out.includes(real)) { out.push(real); }
		}
	} finally {
		if (timer) { clearTimeout(timer); }
	}
	return out;
}
