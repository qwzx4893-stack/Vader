/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { defaultProviderSettings } from './modelCapabilities.js';
import { displayInfoOfProviderName, ProviderName } from './vaderSettingsTypes.js';

// With dozens of providers the settings page needs a search box. A provider matches when every word of the query appears in its title, its internal
// name or its default gateway host (so "qwen" finds Alibaba Cloud, "kimi" finds Moonshot, "nvidia" finds NVIDIA NIM).
const ALIASES: { [name: string]: string } = { alibaba: 'qwen dashscope', moonshot: 'kimi', xAI: 'grok', zai: 'glm zhipu', volcengine: 'doubao bytedance ark', minimax: 'm2', openAI: 'gpt chatgpt', anthropic: 'claude', gemini: 'google', googleVertex: 'google', stepfun: 'step', xiaomi: 'mimo', inception: 'mercury', llama: 'meta', upstage: 'solar', ai21: 'jamba', cohere: 'command' }

export const providerMatchesQuery = (providerName: ProviderName, query: string): boolean => {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean)
	if (words.length === 0) { return true }
	let host = ''
	const settings = (defaultProviderSettings as { [k: string]: { endpoint?: string } })[providerName]
	try { if (settings?.endpoint) { host = new URL(settings.endpoint).hostname } } catch { /* no endpoint */ }
	const haystack = `${displayInfoOfProviderName(providerName).title} ${providerName} ${host} ${ALIASES[providerName] ?? ''}`.toLowerCase()
	return words.every(w => haystack.includes(w))
}

export const filterProviders = (providerNames: ProviderName[], query: string): ProviderName[] => providerNames.filter(p => providerMatchesQuery(p, query))
