/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What the codebase index leaves out. In a git project git itself says which files exist and are not ignored (`git ls-files --cached --others --exclude-standard`), which is
// exact, down to nested .gitignore files and the person's global excludes. This file serves the rest: a folder that is not a git project, and `.vaderignore`, a file of the
// same form for what the person wants kept out of the index and out of what the agent finds by searching (generated data, large fixtures). The matcher follows git's rules
// (the same cases as the `ignore` package documents): a pattern with a slash in it is anchored to the folder, one without matches at any depth, a trailing slash means
// folders only, `**` crosses folders, `!` brings a file back, and nothing inside an excluded folder can be brought back. Pure.

type Rule = { re: RegExp; negate: boolean; dirOnly: boolean }

const escapeRe = (s: string): string => s.replace(/[.+^${}()|\\]/g, '\\$&')

/** one line of a .gitignore as a rule, or undefined for a blank line, a comment or a line git ignores */
function compileRule(lineIn: string): Rule | undefined {
	let line = lineIn.replace(/\r$/, '');
	if (/^\s*$/.test(line) || line.startsWith('#')) return undefined;
	// trailing spaces are dropped unless escaped with a backslash
	line = line.replace(/(?<!\\)\s+$/, '');
	if (line === '' || /(?:[^\\]|^)\\$/.test(line)) return undefined;
	let negate = false;
	if (line.startsWith('!')) { negate = true; line = line.slice(1); }
	if (line.startsWith('\\!') || line.startsWith('\\#')) line = line.slice(1);
	let dirOnly = false;
	if (line.endsWith('/')) { dirOnly = true; line = line.replace(/\/+$/, ''); }
	if (line === '') return undefined;
	const anchored = line.includes('/');
	if (line.startsWith('/')) line = line.slice(1);

	let out = '';
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (c === '\\' && i + 1 < line.length) { out += escapeRe(line[++i]).replace(/[*?[\]]/g, '\\$&'); continue; }
		if (c === '*') {
			if (line[i + 1] === '*') {
				const before = i === 0 || line[i - 1] === '/';
				const after = i + 2 >= line.length || line[i + 2] === '/';
				if (before && after) {
					if (i + 2 >= line.length) { out += '.*'; i += 1; }       // trailing "/**": everything inside
					else { out += '(?:.*/)?'; i += 2; }                          // "**/" or "/**/": any number of folders, also none
					continue;
				}
				out += '[^/]*'; i += 1; continue;                                 // "a**b" is two plain stars
			}
			out += '[^/]*'; continue;
		}
		if (c === '?') { out += '[^/]'; continue; }
		if (c === '[') {
			const end = line.indexOf(']', i + 2);
			if (end === -1) { out += '\\['; continue; }
			let body = line.slice(i + 1, end);
			if (body.startsWith('!')) body = '^' + body.slice(1);
			out += '[' + body.replace(/\\/g, '\\\\') + ']';
			i = end; continue;
		}
		out += escapeRe(c);
	}
	return { re: new RegExp((anchored ? '^' : '(?:^|/)') + out + '$'), negate, dirOnly };
}

export type IgnoreMatcher = { ignores(relPath: string, isDir?: boolean): boolean };

/** a matcher for the lines of one or more ignore files, in the order they were read (a later line wins) */
export function createIgnore(patternLines: readonly string[]): IgnoreMatcher {
	const rules: Rule[] = [];
	for (const l of patternLines) { const r = compileRule(l); if (r) rules.push(r); }
	return {
		ignores(relPath: string, isDir = false): boolean {
			const parts = relPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
			let prefix = '';
			for (let i = 0; i < parts.length; i++) {
				prefix = prefix ? prefix + '/' + parts[i] : parts[i];
				const dir = i < parts.length - 1 || isDir;
				let state: boolean | undefined;
				for (const r of rules) {
					if (r.dirOnly && !dir) continue;
					if (r.re.test(prefix)) state = !r.negate;
				}
				if (state) return true;       // a folder that is excluded takes everything in it, whatever a later line says
				if (i === parts.length - 1) return false;
			}
			return false;
		},
	};
}

/** what no project wants indexed, in a folder where git cannot say */
export const DEFAULT_IGNORE_LINES: readonly string[] = [
	'.git/', '.hg/', '.svn/', 'node_modules/', 'bower_components/', '__pycache__/', '*.pyc', '.venv/', 'venv/', '.tox/', '.mypy_cache/', '.pytest_cache/',
	'dist/', 'build/', 'out/', 'target/', '.next/', '.nuxt/', '.gradle/', '.idea/', '.vs/', 'coverage/', '.cache/', '.parcel-cache/', '.turbo/',
	'*.min.js', '*.min.css', '*.map', '*.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.DS_Store', 'Thumbs.db', '.vader-worktrees/', '.vader/',
];

const BINARY_EXT = new Set(['exe', 'dll', 'so', 'dylib', 'node', 'bin', 'iso', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tif', 'tiff', 'psd', 'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv', 'flac', 'ogg',
	'zip', 'tar', 'gz', 'xz', '7z', 'rar', 'deb', 'rpm', 'jar', 'war', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pyc', 'pyo', 'class', 'o', 'a', 'obj', 'lib', 'wasm', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'sqlite', 'db', 'pack', 'idx']);

export const extensionOf = (p: string): string => { const m = /\.([A-Za-z0-9]+)$/.exec(p); return m ? m[1].toLowerCase() : ''; };

export const isBinaryPath = (p: string): boolean => BINARY_EXT.has(extensionOf(p));

/** a file that commonly holds a secret: its text is never indexed, so a search can never show it to the model */
export function isSecretLikePath(p: string): boolean {
	const base = p.replace(/\\/g, '/').split('/').pop() ?? p;
	return /^\.env(\..*)?$/i.test(base) && !/\.(example|sample|template|dist)$/i.test(base)
		|| /^(id_rsa|id_dsa|id_ecdsa|id_ed25519)(\.pub)?$/i.test(base) && !/\.pub$/i.test(base)
		|| /\.(pem|key|pfx|p12|jks|keystore|ppk|kdbx)$/i.test(base)
		|| /^(\.npmrc|\.pypirc|\.netrc|\.git-credentials|credentials(\.json)?|secrets?\.(json|ya?ml|toml)|service-account.*\.json)$/i.test(base);
}

/** text that is a machine's output and not a person's code: a file whose lines are very long on average (minified, bundled, a data dump) */
export function looksGenerated(text: string): boolean {
	if (text.length < 2000) return false;
	const lines = text.split('\n').length;
	return text.length / lines > 400;
}

/** files bigger than this are not read for the index */
export const MAX_INDEXED_FILE_BYTES = 512 * 1024;
