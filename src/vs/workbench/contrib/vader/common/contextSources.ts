/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What the @ menu offers besides files (board R06, "Context, after typing @"): the output of the terminal, the page open in the browser, the changes in git. Each is
// read when it is chosen and kept in the message box as one line with Show and Remove, and is sent in full with the message. Pure, so it is tested without the editor.

export type ContextSourceId = 'terminal' | 'browser' | 'git' | 'image';

export type ContextSourceInfo = {
	readonly id: ContextSourceId;
	readonly name: string;
	/** the grey words on the right of the row */
	readonly detail: string;
};

/** a source is offered only when it has something to give */
export function offeredSources(a: { terminalLines: number, browserUrl: string | undefined, gitFiles: number, modelSeesImages?: boolean }): ContextSourceInfo[] {
	const out: ContextSourceInfo[] = [];
	if (a.terminalLines > 0) out.push({ id: 'terminal', name: 'Terminal output', detail: 'last command' });
	if (a.browserUrl) out.push({ id: 'browser', name: 'Browser page', detail: hostAndPort(a.browserUrl) });
	if (a.gitFiles > 0) out.push({ id: 'git', name: 'Git changes', detail: `${a.gitFiles} file${a.gitFiles === 1 ? '' : 's'}` });
	// an image on the clipboard cannot be looked at without asking, so it is always offered; it says whether the chosen model reads images
	if (a.modelSeesImages !== undefined) out.push({ id: 'image', name: 'Image from the clipboard', detail: a.modelSeesImages ? 'for models that see' : 'this model cannot read images' });
	return out;
}

/** "http://localhost:5173/app" -> "localhost:5173" */
export function hostAndPort(url: string): string {
	try { return new URL(url).host || url; } catch { return url; }
}

/** the files changed, from the line git prints last ("3 files changed, 12 insertions(+)"), or counted from the lines above it */
export function filesInStat(stat: string): number {
	const m = /(\d+) files? changed/.exec(stat);
	if (m) return Number(m[1]);
	return stat.split(/\r?\n/).filter(l => /\|\s+\d+/.test(l)).length;
}

export const MAX_CONTEXT_CHARS = 40_000;

/** a text kept to a size the model can be given: the end of terminal output (the newest lines matter), the start of anything else; it says that it was cut */
export function clipContext(text: string, kind: ContextSourceId, max = MAX_CONTEXT_CHARS): { text: string, cut: boolean } {
	if (text.length <= max) return { text, cut: false };
	if (kind === 'terminal') {
		const tail = text.slice(text.length - max);
		const nl = tail.indexOf('\n');
		return { text: '(earlier lines left out)\n' + (nl >= 0 && nl < 200 ? tail.slice(nl + 1) : tail), cut: true };
	}
	const head = text.slice(0, max);
	const nl = head.lastIndexOf('\n');
	return { text: (nl > max - 400 ? head.slice(0, nl) : head) + '\n(the rest is left out)', cut: true };
}

/** the heading a chip and the message use for each source */
export const sourceTitle = (kind: ContextSourceId, detail?: string): string =>
	kind === 'terminal' ? 'Terminal output' : kind === 'browser' ? `Browser page${detail ? ` (${detail})` : ''}` : kind === 'image' ? 'Image from the clipboard' : 'Git changes';

/** how an attachment goes into the message: its heading, then the text in a block */
export const attachmentBlock = (title: string | undefined, text: string): string => `${title ? title + ':\n' : ''}\`\`\`\n${text}\n\`\`\``;

/** the words of the chip: "212 lines, 9K characters" */
export function describeAttachment(text: string): string {
	const lines = text.split(/\r?\n/).length;
	const chars = text.length;
	return `${lines} line${lines === 1 ? '' : 's'}, ${chars >= 1000 ? `${Math.round(chars / 1000)}K` : chars} characters`;
}
