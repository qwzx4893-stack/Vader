/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A long result of a command, folded (board S13, "A long result, folded"): the agent got all of it, the chat shows the head and says how many lines are not shown,
// and Show all opens the rest. Pure.

/** a result of this many lines or fewer is shown whole */
export const FOLD_OVER_LINES = 12;
/** how many lines of a longer one stay visible */
export const FOLD_HEAD_LINES = 6;

export type Folded = { readonly folded: boolean, readonly text: string, readonly total: number, readonly hidden: number };

export function foldOutput(output: string): Folded {
	const lines = output.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
	const total = output.trim() === '' ? 0 : lines.length;
	if (total <= FOLD_OVER_LINES) return { folded: false, text: lines.join('\n'), total, hidden: 0 };
	return { folded: true, text: lines.slice(0, FOLD_HEAD_LINES).join('\n'), total, hidden: total - FOLD_HEAD_LINES };
}

/** "412 lines", "1 line" */
export const lineCount = (n: number): string => `${n} line${n === 1 ? '' : 's'}`;

/** "… 406 more lines" */
export const moreLines = (hidden: number): string => `… ${hidden} more line${hidden === 1 ? '' : 's'}`;
