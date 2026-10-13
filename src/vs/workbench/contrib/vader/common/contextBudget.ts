/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// One place that decides how much of a model's context window a conversation may use, and what is done as it fills up. Three steps, in this order, each cheaper and
// less lossy than the next:
//   1. PRUNE   (from half of the budget): the output of old tool calls is replaced by a one-line note. No model call, deterministic, nothing but old tool output is touched.
//   2. SUMMARISE (from 70% of the budget, measured after pruning): older messages become a structured summary (chatThreadService `_maybeCompactThread`).
//   3. TRIM    (above 100% of the budget): the last-resort blind cut in convertToLLMMessageService `prepareMessages`, which shrinks the largest messages to 120 characters.
// Before this module the three used different yardsticks and the last one fired first: the trim started at half of the window (the reserve for the answer was
// half the window, while the comment said a quarter), the summary only at 70% of the window minus the answer, and the summary's own size estimate cut every tool result to
// 2,000 characters, so a thread full of file reads looked small. Result: the blind cut ran before the careful summary ever did.
//
// The pruning idea (keep the newest tool output intact, replace older ones, only when enough is freed) follows opencode's session compaction (MIT), reimplemented here.

export const CHARS_PER_TOKEN = 4 // deliberately pessimistic, as in the converter

/** Share of the window kept free for the answer, when the model's own reserve is smaller. */
export const MIN_OUTPUT_RESERVE_FRACTION = 0.25
export const DEFAULT_OUTPUT_RESERVE_TOKENS = 4096

/** What the system prompt, the tool definitions and the context block take before the first message (tokens), capped for small windows. */
export const SYSTEM_OVERHEAD_TOKENS = 8000
export const MAX_OVERHEAD_FRACTION = 0.25

export const PRUNE_START_FRACTION = 0.5 // start looking for old tool output to drop at this share of the budget
export const PRUNE_PROTECT_FRACTION = 0.25 // the newest tool output up to this share of the budget is never pruned
export const PRUNE_MIN_FREED_FRACTION = 0.08 // pruning is worth its effect on the provider's prompt cache only when it frees at least this much
export const SUMMARISE_FRACTION = 0.7

export const PRUNE_PROTECT_LAST_MESSAGES = 8

/** A tool output shorter than this is not worth replacing. */
export const PRUNE_MIN_OUTPUT_CHARS = 400

export const prunedOutputNote = (toolName: string, chars: number): string =>
	`[The output of an earlier "${toolName}" call (${chars} characters) was removed to save context. Call the tool again if you still need it.]`

/** Tokens kept free for the model's answer. The model's own figure wins when it is larger than a quarter of the window. */
export const outputReserveTokens = (contextWindow: number, reservedOutputTokenSpace: number | null | undefined): number =>
	Math.max(contextWindow * MIN_OUTPUT_RESERVE_FRACTION, reservedOutputTokenSpace ?? DEFAULT_OUTPUT_RESERVE_TOKENS)

/** Characters of messages (system prompt included) a request may hold. Above this, the converter cuts blindly. Never below 5,000, as before. */
export const inputBudgetChars = (contextWindow: number, reservedOutputTokenSpace: number | null | undefined): number =>
	Math.max((contextWindow - outputReserveTokens(contextWindow, reservedOutputTokenSpace)) * CHARS_PER_TOKEN, 5_000)

export const systemOverheadChars = (contextWindow: number): number =>
	Math.min(SYSTEM_OVERHEAD_TOKENS, contextWindow * MAX_OVERHEAD_FRACTION) * CHARS_PER_TOKEN

export type SizedMessage = {
	role: string
	/** characters this message adds to the request, as the model will see it */
	size: number
	/** a tool result that can be replaced by a note (not already pruned, not a request still waiting for approval) */
	prunable?: boolean
	toolName?: string
}

export type ContextPlan = {
	/** indexes (into the given list) whose tool output is to be replaced by a note */
	pruneIndexes: number[]
	/** characters the pruning frees (note included) */
	freedChars: number
	/** the thread is still above the summary threshold after pruning */
	summarise: boolean
	totalChars: number
	totalAfterPrune: number
	budgetChars: number
}

export const planContextReduction = (messages: readonly SizedMessage[], opts: { contextWindow: number, reservedOutputTokenSpace: number | null | undefined }): ContextPlan => {
	const budgetChars = inputBudgetChars(opts.contextWindow, opts.reservedOutputTokenSpace)
	const overhead = systemOverheadChars(opts.contextWindow)
	const totalChars = overhead + messages.reduce((n, m) => n + m.size, 0)
	const none: ContextPlan = { pruneIndexes: [], freedChars: 0, summarise: totalChars >= budgetChars * SUMMARISE_FRACTION, totalChars, totalAfterPrune: totalChars, budgetChars }
	if (totalChars < budgetChars * PRUNE_START_FRACTION) { return { ...none, summarise: false } }

	// the last few messages are never pruned: the model is working with them right now. (Not "the current exchange": one request often runs for hundreds of calls.)
	const protectedFrom = Math.max(0, messages.length - PRUNE_PROTECT_LAST_MESSAGES)

	// walk back from the newest message: tool output inside the protected share stays, older output becomes a candidate
	let keptToolChars = 0
	const candidates: number[] = []
	const protectChars = budgetChars * PRUNE_PROTECT_FRACTION
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]
		if (!m.prunable || m.size < PRUNE_MIN_OUTPUT_CHARS) { continue }
		if (i >= protectedFrom || keptToolChars < protectChars) { keptToolChars += m.size; continue }
		candidates.push(i)
	}

	let freedChars = 0
	for (const i of candidates) { freedChars += Math.max(0, messages[i].size - prunedOutputNote(messages[i].toolName ?? 'tool', messages[i].size).length) }
	if (freedChars < budgetChars * PRUNE_MIN_FREED_FRACTION) { return none }

	const totalAfterPrune = totalChars - freedChars
	return { pruneIndexes: candidates.sort((a, b) => a - b), freedChars, summarise: totalAfterPrune >= budgetChars * SUMMARISE_FRACTION, totalChars, totalAfterPrune, budgetChars }
}
