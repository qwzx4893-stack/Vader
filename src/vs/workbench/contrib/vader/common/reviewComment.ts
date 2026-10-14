/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A comment the person writes on a line while reviewing what an agent changed, sent back to that agent as a message: the file, the line,
// the code on it, and what the person wants. The agent can then answer or change the code without being told where to look.

export type ReviewComment = {
	/** path as the person sees it (relative to the project when possible) */
	readonly path: string;
	/** 1-based; endLine is for a comment on a range */
	readonly line: number;
	readonly endLine?: number;
	/** the lines the comment is on, as they are in the file now */
	readonly snippet?: string;
	readonly text: string;
};

const MAX_SNIPPET_LINES = 40;
const MAX_TEXT = 4000;

/** null when there is nothing to send (an empty comment, or a line that does not exist) */
export function composeReviewComment(c: ReviewComment): string | null {
	const text = c.text.trim().slice(0, MAX_TEXT);
	if (!text || !Number.isInteger(c.line) || c.line < 1) return null;
	const end = c.endLine && Number.isInteger(c.endLine) && c.endLine > c.line ? c.endLine : undefined;
	const where = end ? `${c.path}, lines ${c.line} to ${end}` : `${c.path}, line ${c.line}`;
	const lines = (c.snippet ?? '').replace(/\r\n/g, '\n').split('\n');
	const shown = lines.slice(0, MAX_SNIPPET_LINES);
	const snippet = c.snippet !== undefined && c.snippet.trim() ? `\n\n\`\`\`\n${shown.join('\n')}${lines.length > shown.length ? '\n...' : ''}\n\`\`\`` : '';
	return `A comment on your change in ${where}:${snippet}\n\n${text}\n\nAnswer the comment. If it asks for a change, make it in that file, and say what you changed.`;
}
