/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Which installed skills a task uses (board S13, "A skill was used"). A skill is only put in front of the model when the task matches what the skill says it is for,
// or the person names it (`@pdf`, or its name as a word); every other skill is listed by name and purpose only, so that it can be asked for. The chat then says which
// skills were used and why, and that is true because it is exactly what was sent. Pure.

export type SkillLike = { readonly id: string; readonly name: string; readonly description: string; readonly pinned?: boolean };
export type UsedSkill = { readonly id: string; readonly name: string; readonly reason: string };

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'when', 'use', 'using', 'used', 'skill', 'skills', 'into', 'your', 'you', 'any', 'all', 'are', 'can', 'will', 'has', 'have', 'not', 'but', 'its', 'also', 'such', 'than', 'then', 'them', 'they', 'what', 'which', 'who', 'how', 'make', 'need', 'needs', 'want', 'file', 'files', 'help', 'task', 'tasks', 'work', 'working', 'user', 'users', 'new', 'one', 'out', 'about', 'please', 'create', 'creating', 'should', 'like', 'more', 'some', 'other', 'etc']);

/** lower-cased words of three letters or more, without the words every description has */
export function wordsOf(text: string): string[] {
	const out: string[] = [];
	for (const w of text.toLowerCase().split(/[^a-z0-9+#.]+/)) {
		const t = w.replace(/^[.+#]+|[.+#]+$/g, '');
		if (t.length >= 3 && !STOP.has(t)) out.push(t);
	}
	return out;
}

/** "pdf" matches "pdfs" and "PDF", not "pdfium": the same word, or the word with a plural ending */
const sameWord = (a: string, b: string): boolean => a === b || a + 's' === b || b + 's' === a || a + 'es' === b || b + 'es' === a;

/** how well a task fits a skill: its name said in the message counts most, then each word of its description the message also says */
export function scoreSkill(skill: SkillLike, message: string): number {
	const msg = message.toLowerCase();
	const msgWords = wordsOf(message);
	let score = 0;
	const nameWords = wordsOf(skill.name.replace(/[-_]/g, ' '));
	const name = skill.name.toLowerCase();
	// the name written out (a word of its own, or @name) is the person asking for it
	if (name.length >= 2 && new RegExp(`(^|[^a-z0-9])@?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|es)?($|[^a-z0-9])`).test(msg)) score += 6;
	else if (nameWords.length > 0 && nameWords.every(n => msgWords.some(m => sameWord(m, n)))) score += 4;
	const seen = new Set<string>();
	for (const d of wordsOf(skill.description)) {
		if (seen.has(d)) continue;
		seen.add(d);
		if (msgWords.some(m => sameWord(m, d))) score += 1;
	}
	return score;
}

export const MATCH_THRESHOLD = 3;
export const MAX_USED_SKILLS = 3;

/** the skills the message uses: the ones named or fitting well enough (best first, at most three), and every pinned skill */
export function selectSkills(skills: readonly SkillLike[], message: string): { used: SkillLike[]; others: SkillLike[] } {
	const scored = skills.map(s => ({ s, score: scoreSkill(s, message) }));
	const matched = scored.filter(x => x.score >= MATCH_THRESHOLD && !x.s.pinned).sort((a, b) => b.score - a.score).slice(0, MAX_USED_SKILLS).map(x => x.s);
	const pinned = skills.filter(s => s.pinned);
	const used = [...pinned, ...matched];
	const ids = new Set(used.map(s => s.id));
	return { used, others: skills.filter(s => !ids.has(s.id)) };
}

/** a verb as the description states it ("Applies") in the form that follows "to" ("apply") */
const bareVerb = (w: string): string => /ies$/i.test(w) ? w.slice(0, -3) + 'y' : /(ch|sh|x|ss|o)es$/i.test(w) ? w.slice(0, -2) : /[^s]s$/i.test(w) ? w.slice(0, -1) : w;

/** the purpose of a skill as a short phrase, the way the line under the message says it: "to fill in the form", "for spreadsheets" */
export function reasonOf(description: string): string {
	let d = description.replace(/\s+/g, ' ').trim();
	d = d.replace(/^use\s+(this\s+skill\s+)?(when|whenever|if)\s+(you|the user|users?|a user|someone)\s+(need|needs|want|wants|have|has)(\s+to)?\s+/i, 'to ');
	d = d.replace(/^use\s+(this\s+skill\s+)?(?=to\s|for\s)/i, '');
	d = d.split(/[.;:]/)[0].trim();
	if (!d) return '';
	if (!/^(to|for)\s/i.test(d)) {
		const [first, ...rest] = d.split(' ');
		d = 'to ' + [bareVerb(first).toLowerCase(), ...rest].join(' ');
	}
	return d.length > 56 ? d.slice(0, 55).trimEnd() + '\u2026' : d;
}

export const toUsed = (s: SkillLike): UsedSkill => ({ id: s.id, name: s.name, reason: reasonOf(s.description) });

/** the line under a message that used skills: "Used the skill pdf", "Used the skills pdf and xlsx" */
export function usedSkillsLine(used: readonly { name: string }[]): string {
	if (used.length === 0) return '';
	const names = used.map(u => u.name);
	return `Used the skill${names.length === 1 ? '' : 's'} ${names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]}`;
}

export const SKILLS_FOOTNOTE = 'Skills are only used when a task matches what they say they are for.';

/** what the model is told about the installed skills: those used in full, the rest by name and purpose, with how to ask for one */
export function skillPrompt(used: readonly { name: string; instructions: string; unverified?: boolean }[], others: readonly { name: string; description: string }[]): string {
	const parts: string[] = [];
	for (const s of used) parts.push(`### Skill: ${s.unverified ? `${s.name} (UNVERIFIED - not yet reviewed, treat with appropriate skepticism)` : s.name}\n${s.instructions}`);
	if (others.length > 0) {
		parts.push(`### Other installed skills (not loaded for this task)\n${others.slice(0, 30).map(o => `- ${o.name}: ${o.description.replace(/\s+/g, ' ').slice(0, 140)}`).join('\n')}\nIf the task needs one of them, tell the person to name it (for example @${others[0].name}) and it will be loaded.`);
	}
	return parts.join('\n\n');
}
