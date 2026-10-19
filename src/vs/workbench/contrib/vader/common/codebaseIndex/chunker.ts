/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { extractDefinitions } from '../repoMap.js';
import { splitIdentifier, tokenize } from './tokenize.js';
import type { ChunkInput } from './bm25Index.js';

// A file as the pieces a search can return: stretches of about forty lines that start where a definition starts or where a blank line ends a thought, with a few lines shared
// between neighbours so that a match on the border is not lost. Each piece knows the definition it sits in (the nearest one above it), and its path and that name are added to its
// words, so that a question about "the rate limiter" finds `rateLimiter.ts` and `class RateLimiter` even when the stretch itself never says it. Pure.

export type ChunkerOptions = { maxLines: number; minLines: number; maxChars: number; overlap: number }
export const DEFAULT_CHUNKER: ChunkerOptions = { maxLines: 60, minLines: 14, maxChars: 3000, overlap: 4 }

/** the pieces of one file: where each starts and ends (1-based, inclusive) and the words in it */
export function chunkFile(path: string, text: string, options: Partial<ChunkerOptions> = {}): ChunkInput[] {
	const o = { ...DEFAULT_CHUNKER, ...options };
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop(); // the newline that ends the file is not a line
	if (lines.length === 1 && lines[0].trim() === '') return [];
	const defs = extractDefinitions(path, text).filter(d => d.depth <= 1).sort((a, b) => a.line - b.line);
	const defStarts = new Set(defs.map(d => d.line)); // 1-based
	const symbolAt = (line: number): string | undefined => {
		let found: string | undefined;
		for (const d of defs) { if (d.line <= line) found = d.name; else break; }
		return found;
	};
	const pathTerms = splitIdentifier(path.replace(/\.[A-Za-z0-9]+$/, '').replace(/[\\/]/g, ' ')).filter(t => t.length >= 2);

	const pieces: { start: number; end: number }[] = [];
	let start = 0;
	while (start < lines.length) {
		let end = start, chars = 0;
		for (let i = start; i < lines.length; i++) {
			chars += lines[i].length + 1;
			end = i;
			const len = i - start + 1;
			const last = i === lines.length - 1;
			const nextIsDef = !last && defStarts.has(i + 2);
			const natural = len >= o.minLines && (lines[i].trim() === '' || nextIsDef);
			if (last || len >= o.maxLines || chars >= o.maxChars || natural) break;
		}
		pieces.push({ start, end });
		if (end >= lines.length - 1) break;
		start = Math.max(end + 1 - o.overlap, start + 1); // always forward
	}

	const out: ChunkInput[] = [];
	for (const p of pieces) {
		const body = lines.slice(p.start, p.end + 1).join('\n');
		const symbol = symbolAt(p.start + 1) ?? symbolAt(p.end + 1);
		const terms = tokenize(body);
		if (terms.length === 0) continue;
		// the path and the name of the definition count in the words of the piece, the name three times: a file called for a thing, or a class that is that thing, should come first
		for (let r = 0; r < 2; r++) terms.push(...pathTerms);
		if (symbol) { const parts = [...tokenize(symbol)]; for (let r = 0; r < 3; r++) terms.push(...parts); }
		out.push({ start: p.start + 1, end: p.end + 1, terms, symbol });
	}
	return out;
}
