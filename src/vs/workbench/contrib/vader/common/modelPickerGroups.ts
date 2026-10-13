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
