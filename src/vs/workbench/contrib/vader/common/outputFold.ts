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

/** how a command ended, for its header (board S14): "exit 0, 41 s" in green, "exit 1, 3 s" in red, "still running" when it was left to run */
export function commandEndWords(reason: { readonly type: string, readonly exitCode?: number } | undefined, durationMs: number | undefined): { text: string, tone: 'ok' | 'bad' | 'plain' } {
	const secs = durationMs === undefined ? undefined : durationMs < 950 ? '<1 s' : `${Math.round(durationMs / 1000)} s`;
	if (reason?.type === 'timeout') return { text: secs ? `still running after ${secs}` : 'still running', tone: 'plain' };
	if (reason?.type === 'done' && typeof reason.exitCode === 'number') return { text: `exit ${reason.exitCode}${secs ? `, ${secs}` : ''}`, tone: reason.exitCode === 0 ? 'ok' : 'bad' };
	return { text: secs ?? '', tone: 'plain' };
}
