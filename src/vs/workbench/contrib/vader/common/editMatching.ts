/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Where does the text of an ORIGINAL block sit in the file? Used when the agent applies an edit (editCodeService `_instantlyApplySRBlocks`).
//
// Two defects of the matching it replaces, both found by reading it against the review of other editors' edit tools:
//   1. An exact match was never checked for uniqueness: a search text that occurs three times silently edited the first one. Now it is an error that says so, and the model adds context.
//   2. The replacement was always whole lines, whatever was matched: ORIGINAL `timeout: 5000` inside `const opts = { timeout: 5000, retries: 3 }` turned the whole line into the new
//      fragment. Now an exact match replaces exactly the characters that matched.
//
// When there is no exact match, one tolerant step is tried, and only this one (opencode abandoned its cascade of looser matchers because they apply edits in the wrong place;
// Roo's fuzzy matching has the same risk): the same lines, compared with all whitespace removed and typographic quotes, dashes and non-breaking spaces made plain. Every line must match,
// in order, and the match must be unique. A looser rule (similarity scores, anchors at the first and last line) is deliberately not offered.

export type EditMatch = { start: number, end: number } // character offsets in the file, `end` exclusive

const plainTypography = (s: string): string => s
	.replace(/[‘’‚‛]/g, '\'')
	.replace(/[“”„‟]/g, '"')
	.replace(/[‐-―−]/g, '-')
	.replace(/…/g, '...')
	.normalize('NFC')

/** The form two lines are compared in when the exact text did not match: whitespace gone, typography plain. */
const lineKey = (line: string): string => plainTypography(line).replace(/\s+/g, '')

export const locateEdit = (origIn: string, file: string): EditMatch | 'Not found' | 'Not unique' => {
	const orig = origIn.replace(/\r\n/g, '\n')
	if (orig === '') { return file === '' ? { start: 0, end: 0 } : 'Not found' }

	// 1. exactly the characters the model wrote
	const idx = file.indexOf(orig)
	if (idx !== -1) {
		return file.indexOf(orig, idx + 1) !== -1 ? 'Not unique' : { start: idx, end: idx + orig.length }
	}

	// 2. the same lines, ignoring whitespace and typography
	const origLines = orig.split('\n')
	while (origLines.length > 0 && lineKey(origLines[0]) === '') { origLines.shift() }
	while (origLines.length > 0 && lineKey(origLines[origLines.length - 1]) === '') { origLines.pop() }
	if (origLines.length === 0) { return 'Not found' }
	const keys = origLines.map(lineKey)

	const fileLines = file.split('\n')
	const lineStart: number[] = []
	let offset = 0
	for (const l of fileLines) { lineStart.push(offset); offset += l.length + 1 }
	const fileKeys = fileLines.map(lineKey)

	let found = -1
	for (let i = 0; i + keys.length <= fileLines.length; i++) {
		let ok = true
		for (let j = 0; j < keys.length; j++) { if (fileKeys[i + j] !== keys[j]) { ok = false; break } }
		if (!ok) { continue }
		if (found !== -1) { return 'Not unique' }
		found = i
	}
	if (found === -1) { return 'Not found' }
	const last = found + keys.length - 1
	return { start: lineStart[found], end: lineStart[last] + fileLines[last].length }
}

/**
 * Block markers the model wrote slightly differently are read as the real ones: `<<<<<<< SEARCH` for ORIGINAL, `>>>>>>> REPLACE` (or FINAL, NEW) for UPDATED, a different number of
 * `<` or `>`, spaces around a marker, Windows line ends. Only complete lines are changed, so text that is still being streamed is left alone.
 * "No Search/Replace blocks were received" was the most frequent edit failure in the benchmark runs (docs/integrations/agent-benchmark.md).
 */
export const normaliseBlockMarkers = (text: string): string => {
	if (!text.includes('<<<') && !text.includes('>>>')) { return text }
	const lines = text.replace(/\r\n/g, '\n').split('\n')
	return lines.map((line, i) => {
		const complete = i < lines.length - 1 // the last element has no newline after it yet: it may still be growing
		if (complete && /^[ \t]*<{3,}[ \t]*(?:ORIGINAL|SEARCH|OLD)[ \t]*$/i.test(line)) { return '<<<<<<< ORIGINAL' }
		// the divider is left alone (a line of `=====` is also a Markdown heading underline), and a closing marker needs its keyword (a bare `>>>` may still be growing)
		if (/^[ \t]*>{3,}[ \t]*(?:UPDATED|REPLACE|FINAL|NEW)[ \t]*$/i.test(line)) { return '>>>>>>> UPDATED' }
		return line
	}).join('\n')
}
