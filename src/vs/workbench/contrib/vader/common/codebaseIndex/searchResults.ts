/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import type { Hit } from './bm25Index.js';

// From ranked pieces to what the agent is shown: pieces that overlap or touch are one stretch, no file takes the whole list, and each stretch comes with its lines. Pure.

export type Found = { file: string; start: number; end: number; score: number; symbol?: string }

export function selectResults(hits: readonly Hit[], opts: { limit: number; perFile: number }): Found[] {
	const byFile = new Map<string, Found[]>()
	let total = 0
	for (const h of hits) {
		const { file, start, end, symbol } = h.chunk
		const list = byFile.get(file) ?? []
		// a piece that overlaps or sits within two lines of one already chosen belongs to it
		const near = list.find(f => start <= f.end + 2 && end >= f.start - 2)
		if (near) {
			near.start = Math.min(near.start, start); near.end = Math.max(near.end, end); near.score += h.score * 0.3
			continue
		}
		if (list.length >= opts.perFile || total >= opts.limit) continue
		list.push({ file, start, end, score: h.score, symbol })
		byFile.set(file, list)
		total++
	}
	return [...byFile.values()].flat().sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.start - b.start)
}

/** a stretch of lines cut to what is worth showing: the lines it starts with, and a note of how many were left out */
export function clipSnippet(text: string, maxLines = 30, maxChars = 1800): string {
	let lines = text.split('\n')
	let more = 0
	if (lines.length > maxLines) { more = lines.length - maxLines; lines = lines.slice(0, maxLines) }
	let out = lines.join('\n')
	if (out.length > maxChars) { out = out.slice(0, maxChars); more = Math.max(more, 1) }
	return more > 0 ? `${out}\n... (${more > 1 ? `${more} more lines` : 'cut'})` : out
}

export type ResultWithText = Found & { text: string }

export function formatResults(query: string, results: readonly ResultWithText[], info: { files: number; stale?: boolean; scopedTo?: readonly string[] }): string {
	if (results.length === 0) {
		return `Nothing in the project index matches "${query}"${info.scopedTo?.length ? ` inside ${info.scopedTo.join(', ')}` : ''} (${info.files} files indexed). Try other words from the code itself (names of functions, types, files), or search_for_files for an exact text.`
	}
	const head = `${results.length} place${results.length === 1 ? '' : 's'} in the project that best match "${query}" (${info.files} files indexed${info.stale ? '; the index is still catching up with recent changes' : ''}). Read a file for the whole of it.`
	const body = results.map((r, i) => `${i + 1}. ${r.file}:${r.start}-${r.end}${r.symbol ? `  (in ${r.symbol})` : ''}\n${r.text}`).join('\n\n')
	return `${head}\n\n${body}`
}
