/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Asking a model for the next edit, and reading its answer. The model is shown the code around the caret with a small stretch of it marked as the part it may rewrite, what the
// person has just been changing, and the caret. It answers with the new text of that stretch, or says there is nothing to change. The answer is compared with the stretch as it is, and
// only the lines that really differ become the suggestion; the editor draws it (the old lines in red, the new ones as the suggestion; Tab accepts). An answer that does not look like a
// careful edit of the stretch (a placeholder instead of code, a stretch three times as long, most of it deleted) is thrown away, not shown. Pure.

export const NO_EDIT = 'NO_EDIT'

export const NEXT_EDIT_SYSTEM = `You predict the next edit a programmer is about to make, from the code around their cursor and the edits they just made.
You are shown part of a file. Inside it, the lines between <editable_region_start> and <editable_region_end> are the only lines you may change; <|cursor|> marks the cursor.
Reply with the complete new text of the editable region and nothing else (no explanation, no markers, no fences needed). Keep every line you do not change exactly as it is.
Make the edit the programmer is most likely to make next: finish what they started, or repeat their last change where the same change is needed (a renamed name still used in the region, an argument added to a call, an import for something they just used).
If nothing in the region should change, reply with exactly ${NO_EDIT}. Never write placeholders like "... existing code ...".`

export type EditRequest = { system: string; user: string; regionStart: number; regionEnd: number; regionText: string }

export type RequestInput = {
	file: string
	languageId: string
	/** the whole file, split into lines */
	lines: readonly string[]
	/** 1-based */
	caretLine: number
	caretColumn: number
	trail: string
	linesAbove?: number
	linesBelow?: number
	regionAbove?: number
	regionBelow?: number
}

export function buildRequest(a: RequestInput): EditRequest {
	const n = a.lines.length
	const above = a.linesAbove ?? 60, below = a.linesBelow ?? 40
	const rAbove = a.regionAbove ?? 4, rBelow = a.regionBelow ?? 10
	const caret = Math.max(1, Math.min(a.caretLine, n))
	const regionStart = Math.max(1, caret - rAbove)
	const regionEnd = Math.min(n, caret + rBelow)
	const winStart = Math.max(1, caret - above), winEnd = Math.min(n, caret + below)
	const region = a.lines.slice(regionStart - 1, regionEnd)
	const regionText = region.join('\n')
	const withCursor = region.map((l, i) => {
		if (regionStart + i !== caret) return l
		const col = Math.max(0, Math.min(l.length, a.caretColumn - 1))
		return l.slice(0, col) + '<|cursor|>' + l.slice(col)
	})
	const parts: string[] = []
	if (a.trail.trim()) parts.push(`Recent edits (oldest first):\n${a.trail}`)
	parts.push(`File: ${a.file} (${a.languageId}), lines ${winStart}-${winEnd} of ${n}:`)
	parts.push([
		...a.lines.slice(winStart - 1, regionStart - 1),
		'<editable_region_start>',
		...withCursor,
		'<editable_region_end>',
		...a.lines.slice(regionEnd, winEnd),
	].join('\n'))
	parts.push('Reply with the new text of the editable region.')
	return { system: NEXT_EDIT_SYSTEM, user: parts.join('\n\n'), regionStart, regionEnd, regionText }
}

/** the new text of the region from a model's answer, or why there is none */
export function parseAnswer(answer: string, regionText: string): { text: string } | { none: string } {
	let t = answer.replace(/\r\n/g, '\n')
	const fence = /```[A-Za-z0-9_+-]*\n([\s\S]*?)```/.exec(t)
	if (fence) t = fence[1]
	t = t.split('\n').filter(l => !/^\s*<\/?editable_region_(start|end)>\s*$/.test(l)).join('\n').replace(/<\|cursor\|>/g, '')
	t = t.replace(/\n+$/, '')
	if (t.trim() === '' || t.trim() === NO_EDIT) return { none: 'the model sees nothing to change' }
	if (/^\s*(?:\/\/|#|\/\*|<!--|--)?\s*\.{3}\s*(?:existing|rest|unchanged|same|previous|omitted)/im.test(t)) return { none: 'the answer has a placeholder where code should be' }
	const origLines = regionText.split('\n').length, newLines = t.split('\n').length
	if (newLines > origLines * 3 + 10) return { none: 'the answer is far longer than the region' }
	if (origLines >= 6 && newLines < origLines / 3) return { none: 'the answer deletes most of the region' }
	if (t === regionText || t.trim() === regionText.trim()) return { none: 'the answer changes nothing' }
	return { text: t }
}

export type LineEdit =
	| { kind: 'replace'; startLine: number; endLine: number; text: string }
	| { kind: 'insert'; beforeLine: number; text: string }
	| { kind: 'delete'; startLine: number; endLine: number }

/** the lines that really differ: the common first and last lines are left alone, and what is between is the edit */
export function toLineEdit(regionStart: number, orig: string, next: string): LineEdit | undefined {
	const a = orig.split('\n'), b = next.split('\n')
	let pre = 0
	while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
	let suf = 0
	while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
	const oldMid = a.length - pre - suf, newMid = b.length - pre - suf
	if (oldMid === 0 && newMid === 0) return undefined
	const start = regionStart + pre
	if (oldMid === 0) return { kind: 'insert', beforeLine: start, text: b.slice(pre, b.length - suf).join('\n') }
	if (newMid === 0) return { kind: 'delete', startLine: start, endLine: start + oldMid - 1 }
	return { kind: 'replace', startLine: start, endLine: start + oldMid - 1, text: b.slice(pre, b.length - suf).join('\n') }
}

/** the file after an edit (for tests, and for checking that a suggestion is what the model said) */
export function applyLineEdit(lines: readonly string[], e: LineEdit): string[] {
	const out = [...lines]
	if (e.kind === 'insert') out.splice(e.beforeLine - 1, 0, ...e.text.split('\n'))
	else if (e.kind === 'delete') out.splice(e.startLine - 1, e.endLine - e.startLine + 1)
	else out.splice(e.startLine - 1, e.endLine - e.startLine + 1, ...e.text.split('\n'))
	return out
}

/** is it worth showing: a change of only blanks is not */
export const isWorthShowing = (orig: string, next: string): boolean => orig.replace(/\s+/g, '') !== next.replace(/\s+/g, '')
