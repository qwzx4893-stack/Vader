/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What an edit did to the problems of a file. After edit_file or rewrite_file the agent used to be handed every error and warning the editor showed for the file (up to a hundred),
// after a fixed two seconds, with the line "if this is related to your change, you might want to fix it". In a file that already had thirty warnings that is thirty things that are
// not the agent's doing, and the agent spends turns on them. Here the problems are read before the edit and after it, and the agent is told only what the edit introduced (and how many
// it fixed, and that others were there before), once the editor has stopped changing its list. Pure: the markers, the clock and the sleeping are given to it.

export type LintItem = { code: string; message: string; startLineNumber: number; endLineNumber: number }

/** two problems are the same problem when they have the same code and the same words (line numbers move when lines are added above) */
const keyOf = (l: LintItem): string => `${l.code}\u0000${l.message.replace(/\s+/g, ' ').trim()}`

export type LintDelta = { fresh: LintItem[]; /** problems that were there before and still are */ old: number; /** problems that were there before and are gone */ fixed: number }

/**
 * `before` and `after` are the problems of the file before and after the edit. A problem that is in both is matched in the order of its lines; what is left in `after` is new, what is left
 * in `before` was fixed. When the same message occurs several times and the edit changed which of them are where, the match is approximate: the count is right, the lines may not be.
 */
export function splitLintDelta(before: readonly LintItem[], after: readonly LintItem[]): LintDelta {
	const pool = new Map<string, number>()
	for (const b of before) pool.set(keyOf(b), (pool.get(keyOf(b)) ?? 0) + 1)
	const fresh: LintItem[] = []
	let old = 0
	for (const a of [...after].sort((x, y) => x.startLineNumber - y.startLineNumber)) {
		const k = keyOf(a)
		const left = pool.get(k) ?? 0
		if (left > 0) { pool.set(k, left - 1); old++ } else fresh.push(a)
	}
	let fixed = 0
	for (const n of pool.values()) fixed += n
	return { fresh, old, fixed }
}

export type SettleIO = {
	/** the problems of the file as the editor shows them now, as one string that changes when they do */
	signature: () => string
	now: () => number
	sleep: (ms: number) => Promise<void>
}
export type SettleOptions = { pollMs?: number; quietMs?: number; noChangeMs?: number; maxMs?: number }

/**
 * Waits for the editor's list of problems to settle after an edit. The language server decides when it publishes, so there are three ends:
 *  - the list changed from what it was before the edit and has been still for `quietMs`: it settled (usually well under a second);
 *  - it has not changed at all in `noChangeMs` (default 2 s, what was always waited): the edit most likely changed nothing, or the server is not going to say;
 *  - `maxMs` (4 s) passed with the list still moving.
 */
export async function settleLints(io: SettleIO, before: string, o: SettleOptions = {}): Promise<'settled' | 'unchanged' | 'timeout'> {
	const poll = o.pollMs ?? 100, quiet = o.quietMs ?? 400, noChange = o.noChangeMs ?? 2000, max = o.maxMs ?? 4000
	const start = io.now()
	let last = before
	let lastChange = start
	let changed = false
	for (;;) {
		await io.sleep(poll)
		const now = io.now()
		const sig = io.signature()
		if (sig !== last) { last = sig; lastChange = now; if (sig !== before) changed = true }
		if (changed && now - lastChange >= quiet) return 'settled'
		if (!changed && now - start >= noChange) return 'unchanged'
		if (now - start >= max) return 'timeout'
	}
}

/** edits in a row that left new problems in the same file: told to the agent so that it does not go round the same error for ever */
export class LintStreak {
	private readonly _n = new Map<string, number>()
	constructor(private readonly _limit = 3) { }
	/** `introduced`: the edit left new problems. Returns how many edits in a row have, counting this one. */
	record(file: string, introduced: boolean): number {
		const n = introduced ? (this._n.get(file) ?? 0) + 1 : 0
		if (n === 0) this._n.delete(file); else this._n.set(file, n)
		return n
	}
	get limit(): number { return this._limit }
}

/** what the agent is told after an edit */
export function lintReport(d: LintDelta | undefined, o: { stringify: (items: LintItem[]) => string; streak?: number; streakLimit?: number }): string {
	if (!d) return ''
	const tail: string[] = []
	if (d.old > 0) tail.push(`${d.old} problem${d.old === 1 ? ' that was' : 's that were'} already in this file ${d.old === 1 ? 'is' : 'are'} not shown`)
	if (d.fixed > 0) tail.push(`this change fixed ${d.fixed}`)
	const side = tail.length ? ` (${tail.join('; ')}.)` : ''
	if (d.fresh.length === 0) return ` No new problems.${side}`
	const limit = o.streakLimit ?? 3
	const stuck = (o.streak ?? 0) >= limit
		? `\nThis is the ${o.streak}${o.streak === 3 ? 'rd' : 'th'} edit in a row to this file that leaves new problems. Stop trying small variations: read the file again, reconsider the approach, or tell the user what is left and why.`
		: ''
	return ` Problems this change introduced (${d.fresh.length}):\n${o.stringify(d.fresh)}.${side}\nIf these come from your change, fix them.${stuck}`
}
