/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A model (or text a model was shown) can ask the agent to search a file with a regular expression. JavaScript has no regex
// timeout, so a pattern such as ^(a+)+$ against a long line freezes the whole window for minutes. This is a conservative
// guard for model-supplied patterns: it rejects the classic catastrophic shapes (a quantified group that itself contains a
// quantifier) and absurd lengths. It is a heuristic, not a proof - patterns it accepts are also only ever run against
// lines truncated to MAX_LINE_CHARS.

export const MAX_REGEX_SOURCE_CHARS = 300
export const MAX_LINE_CHARS = 5_000

// ( ... + or * or {n,} ... ) followed by + * ? or {   - e.g. (a+)+, (x+x+)+y, (.*)*, ([a-z]+\d*){2,}
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*(?:[+*]|\{\d+,\d*\})(?:[^()\\]|\\.)*\)(?:[+*]|\{\d+,\d*\})/

export type SafeRegexResult = { ok: true, regex: RegExp } | { ok: false, reason: string }

export const compileModelRegex = (source: string, flags = ''): SafeRegexResult => {
	if (source.length > MAX_REGEX_SOURCE_CHARS) return { ok: false, reason: `The pattern is longer than ${MAX_REGEX_SOURCE_CHARS} characters.` }
	if (NESTED_QUANTIFIER.test(source)) return { ok: false, reason: 'The pattern repeats a group that already repeats (like "(a+)+"), which can make the search hang. Rewrite it without nested repetition.' }
	try { return { ok: true, regex: new RegExp(source, flags) } }
	catch (e) { return { ok: false, reason: `Invalid regular expression: ${e instanceof Error ? e.message : String(e)}` } }
}

/** the reason a user-written, case-insensitive pattern cannot be used (invalid, or unsafe to run), or undefined when it is fine */
export const validateUserPattern = (src: string): string | undefined => {
	const r = compileModelRegex(src, 'i')
	return r.ok ? undefined : r.reason
}
