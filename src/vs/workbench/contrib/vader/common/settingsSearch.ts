/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Searching Settings (board S10): a page is found when every word typed is in its name or its words; when nothing is found, the nearest places are offered (the pages
// whose words share the most letters-in-a-row with what was typed), so a misspelt or half-remembered word still leads somewhere. Pure.

export type SearchPage = { readonly id: string, readonly label: string, readonly words: string, readonly group: string };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const trigrams = (w: string): Set<string> => { const t = new Set<string>(); const p = `  ${w} `; for (let i = 0; i + 3 <= p.length; i++) t.add(p.slice(i, i + 3)); return t; };

/** pages that contain every word typed */
export function matchPages(pages: readonly SearchPage[], query: string): SearchPage[] {
	const words = norm(query).split(' ').filter(Boolean);
	if (words.length === 0) return [...pages];
	return pages.filter(p => { const hay = norm(p.label + ' ' + p.words); return words.every(w => hay.includes(w)); });
}

/** the pages nearest to what was typed, best first: a page counts when a word of it shares at least a third of its letter triples with a word typed */
export function nearestPages(pages: readonly SearchPage[], query: string, max = 2): SearchPage[] {
	const typed = norm(query).split(' ').filter(w => w.length >= 3);
	if (typed.length === 0) return [];
	const scored = pages.map(p => {
		const hay = [...new Set(norm(p.label + ' ' + p.words).split(' ').filter(w => w.length >= 3))];
		let best = 0;
		for (const t of typed) {
			const tt = trigrams(t);
			for (const h of hay) {
				const ht = trigrams(h);
				let common = 0;
				for (const g of tt) if (ht.has(g)) common++;
				const score = common / Math.max(tt.size, ht.size);
				if (score > best) best = score;
			}
		}
		return { p, best };
	}).filter(x => x.best >= 0.34).sort((a, b) => b.best - a.best);
	return scored.slice(0, max).map(x => x.p);
}
