/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Words of code, for finding it by what it is about. A name in code is several words run together (`getUserName`, `get_user_name`, `HTTPServer2`): it is kept whole, so that
// the exact name finds it, and also as its parts, so that "user name" finds it. Words that every file has (`the`, `return`, `const`) are left out: they say nothing about which
// file matters, and leaving them out keeps the index small. Pure.

const STOP = new Set([
	'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'not', 'but', 'you', 'all', 'can', 'has', 'have', 'its', 'will', 'into', 'than', 'then', 'when', 'where', 'which',
	'return', 'const', 'let', 'var', 'function', 'else', 'null', 'true', 'false', 'undefined', 'new', 'void', 'export', 'import', 'default', 'async', 'await', 'public', 'private', 'static',
	'class', 'self', 'def', 'end', 'elif', 'pass', 'none', 'int', 'string', 'bool', 'boolean', 'number', 'any', 'type', 'use', 'mod', 'pub', 'fn', 'impl', 'package',
]);

/** the parts of one name: `getUserName` -> get, user, name; `HTTPServer2` -> http, server, 2; `get_user_name` -> get, user, name */
export function splitIdentifier(id: string): string[] {
	const spaced = id
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.replace(/([A-Za-z])([0-9])/g, '$1 $2')
		.replace(/([0-9])([A-Za-z])/g, '$1 $2')
		.replace(/[_\-$.]+/g, ' ');
	return spaced.split(/\s+/).map(s => s.toLowerCase()).filter(Boolean);
}

const IDENT = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/** the terms of a text: every name whole (lower case), and the parts of every compound name; no stop words, no one-letter terms */
export function tokenize(text: string, maxTerms = 200_000): string[] {
	const out: string[] = [];
	IDENT.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = IDENT.exec(text)) !== null && out.length < maxTerms) {
		const id = m[0];
		if (id.length > 64) continue; // a hash, a base64 blob
		const parts = splitIdentifier(id);
		const whole = id.toLowerCase().replace(/[_$]/g, '');
		if (parts.length > 1 && whole.length >= 3 && !STOP.has(whole)) out.push(whole);
		for (const p of parts) { if (p.length >= 2 && !STOP.has(p)) out.push(p); }
	}
	return out;
}

/** the terms of a question: the same words as the code is cut into, each once; a name written whole is kept as a stronger term */
export function queryTerms(query: string): { terms: string[]; whole: Set<string> } {
	const terms: string[] = [];
	const whole = new Set<string>();
	const seen = new Set<string>();
	IDENT.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = IDENT.exec(query)) !== null) {
		const id = m[0];
		const parts = splitIdentifier(id);
		const w = id.toLowerCase().replace(/[_$]/g, '');
		if (parts.length > 1 && w.length >= 3) { whole.add(w); if (!seen.has(w)) { seen.add(w); terms.push(w); } }
		for (const p of parts) { if (p.length >= 2 && !STOP.has(p) && !seen.has(p)) { seen.add(p); terms.push(p); } }
	}
	return { terms, whole };
}
