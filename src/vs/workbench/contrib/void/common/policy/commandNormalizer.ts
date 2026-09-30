/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Policy rules are regexes over the command text, so the text is matched in two forms: as written,
// and normalized here so trivial obfuscation (quotes inside words, fullwidth letters, zero-width
// characters, line continuations, `${HOME}`) cannot slip a destructive command past a pattern.
// This narrows the gap; it cannot close it. A regex over a shell string is not a sandbox, and
// indirection such as `$(echo rm) -rf /` or an encoded payload still evades it.

export function normalizeCommandForPolicy(command: string): string {
	return command
		.normalize('NFKC')
		.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
		.replace(/\\\r?\n/g, ' ')
		.replace(/\$\{HOME\}/gi, '$HOME')
		.replace(/["'`]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}
