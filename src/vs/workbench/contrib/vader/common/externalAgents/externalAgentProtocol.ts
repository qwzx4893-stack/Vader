/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The small pure rules of the Agent Client Protocol client, kept out of the process code so they can be tested on their own with the answers real
// agents gave (see test/externalAgentE2E.mjs: the initialize replies of Gemini CLI and Codex are in there verbatim).

import { AgentConfigOption } from './externalAgentTypes.js'
import { isSafeRelativePath } from './externalAgentCatalog.js'

export type AuthMethodLike = { readonly id: string, readonly name: string, readonly description?: string | null, readonly type?: string, readonly _meta?: { readonly [k: string]: unknown } | null }

/** a way of signing in that needs a secret or a setting the person has not given Vader (an API key, a cloud project, a gateway address) */
const needsSecret = (m: AuthMethodLike): boolean => {
	const meta = m._meta ?? {}
	if ('api-key' in meta || 'gateway' in meta) { return true }
	if (m.type === 'env_var') { return true }
	return /api[\s_-]?key|vertex|gateway|bedrock|azure/i.test(`${m.id} ${m.name}`)
}

export type AuthChoice =
	| { readonly kind: 'agent', readonly method: AuthMethodLike }        // the agent signs the person in itself (it opens the vendor's page)
	| { readonly kind: 'terminal', readonly method: AuthMethodLike }     // the agent's login runs in a terminal
	| { readonly kind: 'none', readonly offered: readonly string[] }     // only methods that need a key: say so, do not guess

/**
 * Picks the way of signing in. A real agent lists its methods in its own order and Codex lists "API Key" before "ChatGPT", so "the first one" signs
 * the person into the wrong thing. Order of preference: the ids the catalog names for that agent, then any method that signs in with an account
 * (nothing that needs a key), the agent's own page before a terminal.
 */
export const chooseAuthMethod = (methods: readonly AuthMethodLike[], preferredIds: readonly string[] = []): AuthChoice => {
	const kindOf = (m: AuthMethodLike): 'agent' | 'terminal' => m.type === 'terminal' ? 'terminal' : 'agent'
	for (const id of preferredIds) {
		const m = methods.find(x => x.id === id)
		if (m) { return { kind: kindOf(m), method: m } }
	}
	const accountMethods = methods.filter(m => !needsSecret(m))
	const own = accountMethods.find(m => kindOf(m) === 'agent')
	if (own) { return { kind: 'agent', method: own } }
	const terminal = accountMethods.find(m => kindOf(m) === 'terminal')
	if (terminal) { return { kind: 'terminal', method: terminal } }
	return { kind: 'none', offered: methods.map(m => m.name) }
}

type RawOption = {
	id: string, name: string, description?: string | null, category?: string | null, type?: string,
	currentValue?: string | boolean,
	options?: ReadonlyArray<{ value: string, name: string, description?: string | null } | { group: string, name: string, options: ReadonlyArray<{ value: string, name: string, description?: string | null }> }>
}

/** the session settings an agent offers, in the shape the chat shows; groups of choices are flattened */
export const flattenConfigOptions = (raw: readonly RawOption[] | null | undefined): AgentConfigOption[] => {
	const out: AgentConfigOption[] = []
	for (const o of raw ?? []) {
		if (!o || typeof o.id !== 'string' || typeof o.name !== 'string') { continue }
		if (o.type === 'boolean') {
			out.push({ id: o.id, name: o.name, category: o.category ?? undefined, description: o.description ?? undefined, type: 'boolean', value: !!o.currentValue })
			continue
		}
		const choices: { value: string, name: string, description?: string }[] = []
		for (const c of o.options ?? []) {
			if ('group' in c) { for (const g of c.options) { choices.push({ value: g.value, name: g.name, description: g.description ?? undefined }) } }
			else { choices.push({ value: c.value, name: c.name, description: c.description ?? undefined }) }
		}
		if (!choices.length) { continue }
		out.push({ id: o.id, name: o.name, category: o.category ?? undefined, description: o.description ?? undefined, type: 'select', value: String(o.currentValue ?? ''), choices })
	}
	return out
}

/** the settings of an older agent that offers `modes` instead of config options, shown the same way */
export const modesAsConfigOption = (modes: { currentModeId: string, availableModes: ReadonlyArray<{ id: string, name: string, description?: string | null }> } | null | undefined): AgentConfigOption | undefined => {
	if (!modes?.availableModes?.length) { return undefined }
	return { id: '__mode', name: 'Mode', category: 'mode', type: 'select', value: modes.currentModeId, choices: modes.availableModes.map(m => ({ value: m.id, name: m.name, description: m.description ?? undefined })) }
}

/** the program an installed npm package starts: its `bin` entry, which must stay inside the package */
export const npmBinScript = (pkg: { name?: unknown, bin?: unknown }): string | undefined => {
	const bin = pkg.bin
	let script: string | undefined
	if (typeof bin === 'string') { script = bin }
	else if (bin && typeof bin === 'object') {
		const entries = Object.entries(bin as { [k: string]: unknown }).filter(([, v]) => typeof v === 'string') as [string, string][]
		const short = typeof pkg.name === 'string' ? pkg.name.replace(/^@[^/]+\//, '') : ''
		script = (entries.find(([k]) => k === short) ?? (entries.length === 1 ? entries[0] : undefined))?.[1]
	}
	return script && isSafeRelativePath(script) ? script : undefined
}

/** the files a tool call touches, from the protocol's `locations` and `content` (diffs name their file) */
export const pathsOfToolCall = (u: { locations?: ReadonlyArray<{ path: string }> | null, content?: ReadonlyArray<{ type: string, path?: string }> | null }): string[] => {
	const paths = new Set<string>()
	for (const l of u.locations ?? []) { if (typeof l?.path === 'string') { paths.add(l.path) } }
	for (const c of u.content ?? []) { if (c?.type === 'diff' && typeof c.path === 'string') { paths.add(c.path) } }
	return [...paths].slice(0, 5)
}

/** Windows and POSIX file name of an absolute path, for showing a path briefly */
export const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/** An error that means "sign in first": the protocol's auth-required code, or the words agents put in the message when they use another code. */
export const isAuthRequiredError = (e: unknown): boolean => {
	const code = (e as { code?: unknown } | null)?.code
	if (code === -32000) { return true }
	const message = String((e as { message?: unknown } | null)?.message ?? '')
	return /auth(entication)?[\s_-]*required|not (signed|logged) in|please (sign|log) ?in|unauthenticated|\b401\b/i.test(message)
}
