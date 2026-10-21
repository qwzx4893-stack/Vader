/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { sideBySide } from '../checkpointModel.js';

// What the person has just been changing, as the model should see it. The next edit is best guessed from the last few: rename a field here and the place that still uses the old
// name is the next edit. Changes to a file that come one after another (typing a word is twenty changes) are one burst; when the file has been still for a moment the burst is
// compared with the file as it was when it began and becomes a few changed lines, with the lines before and after left out. The trail keeps the last dozen, in a size limit.
// Pure: it is told the text of a file and the time, and reads nothing.

export type TrailEntry = { file: string; line: number; lines: string[]; at: number }

type FileState = { seen: string; last: number; burst?: { startText: string; at: number } }

const MAX_LINES_PER_ENTRY = 14

export class EditTrail {
	private readonly _files = new Map<string, FileState>()
	private _entries: TrailEntry[] = []

	constructor(private readonly _opts: { max?: number; settleMs?: number } = {}) { }

	/** the file's text is now `text` (called after each change, and once when a file is first seen) */
	update(file: string, text: string, now: number): void {
		const st = this._files.get(file)
		if (!st) { this._files.set(file, { seen: text, last: now }); return }
		if (text === st.seen) return
		if (!st.burst) st.burst = { startText: st.seen, at: now }
		st.seen = text
		st.last = now
	}

	forget(file: string): void { this._files.delete(file) }

	/** closes the bursts that have been still for `settleMs` (all of them when `force`) and keeps what they changed */
	settle(now: number, force = false): void {
		const settleMs = this._opts.settleMs ?? 800
		for (const [file, st] of this._files) {
			if (!st.burst || (!force && now - st.last < settleMs)) continue
			const rows = sideBySide(st.burst.startText, st.seen, 0)
			st.burst = undefined
			if (rows.length === 0) continue
			// one entry per run of changed lines
			let cur: TrailEntry | undefined
			for (const r of rows) {
				if (r.gap !== undefined) { cur = undefined; continue }
				const line = r.right?.no ?? r.left?.no ?? 1
				if (!cur) { cur = { file, line, lines: [], at: now }; this._entries.push(cur) }
				if (cur.lines.length < MAX_LINES_PER_ENTRY) {
					if (r.left?.changed) cur.lines.push(`- ${r.left.text}`)
					if (r.right?.changed) cur.lines.push(`+ ${r.right.text}`)
				}
			}
		}
		const max = this._opts.max ?? 12
		if (this._entries.length > max) this._entries = this._entries.slice(this._entries.length - max)
	}

	entries(): readonly TrailEntry[] { return this._entries }

	/** the trail as text for the model: oldest first, each change with its file and line, within a size */
	text(now: number, maxChars = 3000): string {
		this.settle(now, true)
		const parts: string[] = []
		let size = 0
		for (let i = this._entries.length - 1; i >= 0; i--) { // newest first while it fits, then put back in order
			const e = this._entries[i]
			const block = `${e.file}:${e.line}\n${e.lines.join('\n')}`
			if (size + block.length > maxChars) break
			parts.unshift(block)
			size += block.length + 2
		}
		return parts.join('\n\n')
	}

	clear(): void { this._entries = []; this._files.clear() }
}
