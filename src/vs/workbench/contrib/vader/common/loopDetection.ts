/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Detects an agent that is going round in circles. The first guard (the same call N times in a row) misses a loop that alternates:
// in a benchmark run a model repeated `cd build`, `cmake ..`, `cd ..`, `cd build`, `cmake ..` ... until the time limit, never making the same call twice in a row.
// A run of many calls that only ever uses a handful of distinct (tool, arguments) pairs is that kind of loop: real work changes the arguments
// (another file, other content), so it keeps producing new pairs.

// How many model turns one request may take. The SDK stops at its cap with the bare error "Agent runtime exceeded maxIterations (N)" and leaves the work half done; 50 was too few
// for a refactor that reads before it edits (a turn may batch several calls), and the three loop guards in this file stop a model that goes round in circles long before a cap matters.
export const MAX_AGENT_TURNS = 100

/** The error text of a failed run, in words the person can act on. Other errors pass through unchanged. */
export const explainRunFailure = (message: string): string => {
	const m = /exceeded maxIterations \((\d+)\)/i.exec(message)
	if (!m) { return message }
	return `The agent used all ${m[1]} steps it is allowed for one request and stopped before it was finished. Its work so far is kept: send "continue" to let it carry on from where it stopped, or split the request into smaller parts.`
}

export const LOOP_WINDOW = 20 // how many of the latest calls are looked at
export const LOOP_MAX_DISTINCT = 4 // at most this many different calls inside a full window means the agent is stuck

export class RepeatedCallDetector {
	private readonly recent: string[] = []

	constructor(private readonly windowSize = LOOP_WINDOW, private readonly maxDistinct = LOOP_MAX_DISTINCT) { }

	/** Records one tool call (tool name + its arguments) and says whether the latest calls look like a loop. */
	push(toolName: string, input: unknown): { stuck: boolean, distinct: number, window: number } {
		this.recent.push(toolName + '\u0000' + stableStringify(input))
		if (this.recent.length > this.windowSize) { this.recent.shift() }
		const distinct = new Set(this.recent).size
		return { stuck: this.recent.length >= this.windowSize && distinct <= this.maxDistinct, distinct, window: this.recent.length }
	}
}

const stableStringify = (v: unknown): string => {
	try {
		return JSON.stringify(v ?? {}, (_k, val) => (val && typeof val === 'object' && !Array.isArray(val)) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : val)
	} catch { return String(v) }
}

// A model that repeats the same text over and over (common with small local models, in its answer or in its reasoning) makes no tool call, so the guards above never see it
// and it runs until the output limit. The idea is Gemini CLI's "chanting" check (Apache-2.0, packages/core/src/services/loopDetectionService.ts), reimplemented: hash every
// 50-character window of the text; a window that comes back 12 times with a small gap between returns is a loop. Windows made of one or two distinct characters
// (table rules, `-----`, indentation) are ignored, and the detector only reads text, never code that is being written to a file (that goes through tool calls).

export const REPEAT_CHUNK_CHARS = 50
export const REPEAT_COUNT = 12 // occurrences of the same window that make a loop
export const REPEAT_MAX_AVG_GAP = 5 * REPEAT_CHUNK_CHARS // ...when they come back this close to each other, on average
export const REPEAT_MIN_DISTINCT_CHARS = 8
const REPEAT_MAX_TRACKED = 40_000 // windows remembered before the memory is reset

export class TextRepetitionDetector {
	private text = ''
	private checked = 0
	private readonly seen = new Map<string, number[]>()
	private base = 0 // characters dropped from the front of `text` by a reset, so positions stay comparable

	/** Give the whole text streamed so far (it only grows); says whether its end is a loop. A shorter text than before starts a new one. */
	update(fullText: string): { stuck: boolean, sample?: string } {
		if (fullText.length < this.base + this.text.length) { this.reset() }
		this.text = fullText.slice(this.base)
		for (; this.checked + REPEAT_CHUNK_CHARS <= this.text.length; this.checked++) {
			const chunk = this.text.slice(this.checked, this.checked + REPEAT_CHUNK_CHARS)
			if (new Set(chunk).size < REPEAT_MIN_DISTINCT_CHARS) { continue }
			const pos = this.base + this.checked
			let at = this.seen.get(chunk)
			if (!at) { at = []; this.seen.set(chunk, at) }
			at.push(pos)
			if (at.length > REPEAT_COUNT) { at.shift() }
			if (at.length === REPEAT_COUNT && (at[at.length - 1] - at[0]) / (REPEAT_COUNT - 1) <= REPEAT_MAX_AVG_GAP && this.tailIsPeriodic(at[at.length - 1] - at[at.length - 2])) {
				return { stuck: true, sample: chunk.trim() }
			}
		}
		if (this.seen.size > REPEAT_MAX_TRACKED) { this.dropOld(fullText) }
		return { stuck: false }
	}

	// Twelve similar windows are not yet a loop: generated code and tables repeat boilerplate. A loop makes the END of the text periodic: the last 11 periods
	// of length `period` are (almost) the same text over and over.
	private tailIsPeriodic(period: number): boolean {
		const end = this.checked + REPEAT_CHUNK_CHARS
		const from = end - period * (REPEAT_COUNT - 1)
		if (period < 1 || from - period < 0) { return false }
		let same = 0
		for (let k = from; k < end; k++) { if (this.text.charCodeAt(k) === this.text.charCodeAt(k - period)) { same++ } }
		return same / (end - from) >= 0.9
	}

	reset() { this.text = ''; this.checked = 0; this.base = 0; this.seen.clear() }

	// keep memory bounded on a very long answer: forget everything before the last window's worth
	private dropOld(fullText: string) {
		const keepFrom = Math.max(0, fullText.length - REPEAT_CHUNK_CHARS * REPEAT_COUNT)
		this.seen.clear()
		this.base = keepFrom
		this.text = fullText.slice(keepFrom)
		this.checked = 0
	}
}
