/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Anthropic prompt caching. An agent resends its whole prompt every turn (tool definitions, system prompt, the conversation so far); without cache
// markers every turn pays full price and full latency for all of it. Marking the end of each stable prefix lets Anthropic read it back from cache
// at a fraction of the cost. The API allows four markers and ignores them silently when the prefix is below the model's minimum, so this is always safe.
//
// Markers placed (never more than four): the last tool definition (caches tools), the system prompt (tools + system), and the last two user turns
// (the conversation so far, and the previous turn's prefix so the cache keeps hitting as the conversation grows).

type CacheControl = { type: 'ephemeral' }
const EPHEMERAL: CacheControl = { type: 'ephemeral' }

type Block = { type: string, text?: string, cache_control?: CacheControl, [k: string]: unknown }
type Msg = { role: string, content: string | Block[], [k: string]: unknown }

// block types that accept a cache marker and are never empty text
const markable = (b: Block) => (b.type === 'text' ? !!b.text : b.type === 'tool_result' || b.type === 'image' || b.type === 'tool_use')

export function withPromptCaching<M extends Msg, T extends { [k: string]: unknown }>(input: { system: string | undefined, messages: M[], tools?: T[] }): { system: string | Block[] | undefined, messages: M[], tools?: T[] } {
	const system: string | Block[] | undefined = input.system ? [{ type: 'text', text: input.system, cache_control: EPHEMERAL }] : input.system

	let tools = input.tools
	if (tools && tools.length) {
		tools = tools.map((t, i) => i === tools!.length - 1 ? { ...t, cache_control: EPHEMERAL } : t)
	}

	const userIdx: number[] = []
	input.messages.forEach((m, i) => { if (m.role === 'user') userIdx.push(i) })
	const marked = new Set(userIdx.slice(-2))

	const messages = input.messages.map((m, i): M => {
		if (!marked.has(i)) return m
		const blocks: Block[] = typeof m.content === 'string' ? (m.content ? [{ type: 'text', text: m.content }] : []) : m.content.map(b => ({ ...b }))
		for (let k = blocks.length - 1; k >= 0; k--) {
			if (markable(blocks[k])) { blocks[k] = { ...blocks[k], cache_control: EPHEMERAL }; return { ...m, content: blocks }; }
		}
		return m
	})
	return { system, messages, tools }
}
