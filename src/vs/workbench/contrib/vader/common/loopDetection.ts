/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Detects an agent that is going round in circles. The first guard (the same call N times in a row) misses a loop that alternates:
// in a benchmark run a model repeated `cd build`, `cmake ..`, `cd ..`, `cd build`, `cmake ..` ... until the time limit, never making the same call twice in a row.
// A run of many calls that only ever uses a handful of distinct (tool, arguments) pairs is that kind of loop: real work changes the arguments
// (another file, other content), so it keeps producing new pairs.

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
