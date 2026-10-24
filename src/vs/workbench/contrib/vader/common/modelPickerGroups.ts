/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// How the model picker in the chat box arranges the models the person can choose from (browser/react/src/vader-settings-tsx/ProviderModelPicker.tsx).
//   - one provider with a key: its live list, flat;
//   - several providers: the providers, and a click on a provider opens its models;
//   - something typed in the search box: the matching models of every provider, still under their provider.
// Pure, so it can be tested without the editor.

export type PickerOption<S> = { selection: S, providerName: string, providerTitle: string, modelName: string }
export type PickerGroup<S> = { providerName: string, providerTitle: string, models: PickerOption<S>[] }

/** Providers in the order they first appear, each with its models in the order given. */
export const groupByProvider = <S>(options: readonly PickerOption<S>[]): PickerGroup<S>[] => {
	const groups: PickerGroup<S>[] = []
	const byName = new Map<string, PickerGroup<S>>()
	for (const o of options) {
		let g = byName.get(o.providerName)
		if (!g) { g = { providerName: o.providerName, providerTitle: o.providerTitle, models: [] }; byName.set(o.providerName, g); groups.push(g) }
		g.models.push(o)
	}
	return groups
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_\-:/.]+/g, '')

/**
 * Models matching what was typed. Every word has to be found in the model name or the provider's name (so "claude sonnet" and "sonnet claude" both work, and so does
 * "openrouter gpt"). Matching ignores case, spaces and the separators - _ : / .
 */
export const filterOptions = <S>(options: readonly PickerOption<S>[], query: string): PickerOption<S>[] => {
	const words = query.trim().split(/\s+/).map(norm).filter(Boolean)
	if (words.length === 0) { return [...options] }
	return options.filter(o => {
		const hay = norm(o.modelName) + '|' + norm(o.providerTitle) + '|' + norm(o.providerName)
		return words.every(w => hay.includes(w))
	})
}

export type PickerLayout = 'flat' | 'providers'

/** What the open picker shows: no search and several providers -> the providers (collapsed, the chosen one open); otherwise a flat list of models grouped under provider headers only when several providers are in it. */
export const pickerLayout = <S>(options: readonly PickerOption<S>[], query: string): { layout: PickerLayout, groups: PickerGroup<S>[], searching: boolean, singleProvider: boolean } => {
	const searching = query.trim().length > 0
	const shown = searching ? filterOptions(options, query) : options
	const groups = groupByProvider(shown)
	const singleProvider = groupByProvider(options).length <= 1
	return { layout: !searching && !singleProvider ? 'providers' : 'flat', groups, searching, singleProvider }
}

/** A search box is worth showing once there are more models than fit on a screen. */
export const SEARCH_BOX_FROM = 8
export const showSearchBox = (totalModels: number): boolean => totalModels > SEARCH_BOX_FROM

// ---- the words of the picker's states (board S04)

/** "OpenAI", "OpenAI and Gemini", "OpenAI, Gemini and Groq" */
export const listNames = (names: readonly string[]): string => names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

/** what the picker says when the search finds nothing: what was searched, and which providers could not be, for lack of a key */
export const noMatchWords = (query: string, searchedWithKey: number, withoutKey: readonly string[]): { headline: string, detail: string } => ({
	headline: `No model named “${query.trim()}”.`,
	detail: `Searched ${searchedWithKey} provider${searchedWithKey === 1 ? '' : 's'} with a key.${withoutKey.length > 0 ? ` ${listNames(withoutKey.slice(0, 3))} ${withoutKey.length === 1 ? 'has' : 'have'} no key yet.` : ''}`,
})

/** the line under the providers that have no key yet */
export const addableLine = (count: number): string => `${count} provider${count === 1 ? '' : 's'} can be added. Models appear as soon as a key works.`

/** how long ago, in the words of the footer ("fetched just now") */
export const agoWords = (ms: number): string => ms < 45_000 ? 'just now' : ms < 90 * 60_000 ? `${Math.max(1, Math.round(ms / 60_000))} min ago` : ms < 36 * 3_600_000 ? `${Math.round(ms / 3_600_000)} h ago` : `${Math.round(ms / 86_400_000)} days ago`

/** a list that was fetched is used for this long before the picker asks again when it opens */
export const LIST_MAX_AGE_MS = 10 * 60_000
export const listIsStale = (fetchedAt: number | undefined, now: number): boolean => fetchedAt === undefined || now - fetchedAt >= LIST_MAX_AGE_MS

/** Anthropic's ids read as names ("claude-sonnet-4-5" -> "Claude Sonnet 4.5"); any other id is shown as the provider wrote it */
export const friendlyModelName = (providerName: string, id: string): { text: string, mono: boolean } => {
	if (providerName === 'anthropic') {
		const m = /^claude-(?:(\d)(?:-(\d))?-)?(opus|sonnet|haiku)(?:-(\d)(?:-(\d))?)?(?:-\d{8})?$/.exec(id)
		if (m) {
			const family = m[3].charAt(0).toUpperCase() + m[3].slice(1)
			const major = m[4] ?? m[1], minor = m[4] !== undefined ? m[5] : m[2]
			return { text: `Claude ${family}${major ? ` ${major}${minor ? `.${minor}` : ''}` : ''}`, mono: false }
		}
	}
	return { text: id, mono: true }
}

/** A compact display caption only. Keep the original id for selection, requests and tooltips. */
export const compactModelName = (providerName: string, id: string): string => {
	if (providerName === 'anthropic') return friendlyModelName(providerName, id).text
	const parts = id.split('/')
	const vendor = parts.length > 1 ? parts.shift()! : ''
	const vendors: Record<string, string> = { nvidia: 'NVIDIA', google: 'Google', 'meta-llama': 'Meta', microsoft: 'Microsoft', openai: 'OpenAI', anthropic: 'Anthropic', qwen: 'Qwen' }
	const name = parts.join('/').replace(/:(?:free|nitro|extended|online)$/i, '')
		.replace(/-a?\d+(?:\.\d+)?[bmae](?=-|$)/gi, '').replace(/-(?:instruct|it|preview)(?=-|$)/gi, '')
		.replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2})$/g, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
	const title = name.replace(/\b[a-z]/g, char => char.toUpperCase())
	return `${vendors[vendor.toLowerCase()] ?? ''} ${title || id}`.trim()
}
