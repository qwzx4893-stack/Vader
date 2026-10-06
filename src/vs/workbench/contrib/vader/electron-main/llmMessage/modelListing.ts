/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Asks a hosted provider which models an API key can use ("list models"). Runs in the main process like every other network call
// of the LLM subsystem (AGENTS.md), with the provider's own endpoint, a timeout, a size cap and no redirects, so a key is only ever
// sent to the host it was entered for. The key never appears in a result or an error message.

import { vendorLiveListedNames } from '../../common/vendorProviderData.js';
import type { CloudListedProviderName, CloudModelListResult } from '../../common/cloudModelListTypes.js';
import { isCloudListedProvider } from '../../common/cloudModelListTypes.js';
import type { ProviderName, SettingsOfProvider } from '../../common/vaderSettingsTypes.js';

export type ListDeps = {
	fetch?: typeof fetch;
	/** tests only: replaces the provider's base URL. Never reachable from the app's IPC. */
	baseUrlOverride?: string;
	timeoutMs?: number;
}

const MAX_BODY_BYTES = 8 * 1024 * 1024
const MAX_MODELS = 300
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/ // ids end up in menus and prompts: refuse anything exotic

type Raw = { id: string; created?: number }
type Spec = {
	url: (s: SettingsOfProvider) => string;
	headers: (key: string) => Record<string, string>;
	/** pulls (id, created) out of the response body, already without non-chat models; null = the body does not look like this provider's */
	parse: (json: any) => { items: Raw[]; total: number } | null;
	/** responses that mean "key rejected" although the status code is not 401/403 */
	isAuthError?: (status: number, body: any) => boolean;
	needsKey?: boolean;
}

const bearer = (key: string) => ({ Authorization: `Bearer ${key}` })
const NON_CHAT = /(embed|moderation|whisper|tts|transcri|dall-e|image|imagen|veo|audio|realtime|speech|rerank|ocr|guard|safeguard|orpheus|playai|lyria|robotics|aqa|computer-use|search-preview|davinci|babbage|instruct$)/i

const openAIShaped = (keep: (id: string, m: any) => boolean = () => true) => (json: any) => {
	const data = Array.isArray(json) ? json : json?.data // a few vendors (Together) return the bare array
	if (!Array.isArray(data)) return null
	const items: Raw[] = []
	for (const m of data) {
		if (typeof m?.id !== 'string') continue
		if (keep(m.id, m)) items.push({ id: m.id, created: typeof m.created === 'number' ? m.created : undefined })
	}
	return { items, total: data.length }
}

const specOf: { [p in CloudListedProviderName]: Spec } = {
	openAI: {
		url: () => 'https://api.openai.com/v1/models',
		headers: bearer,
		parse: openAIShaped(id => /^(gpt-|o\d|chatgpt-|ft:gpt-|ft:o\d)/.test(id) && !NON_CHAT.test(id)),
	},
	anthropic: {
		url: () => 'https://api.anthropic.com/v1/models?limit=1000',
		headers: key => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
		parse: (json) => {
			const data = json?.data
			if (!Array.isArray(data)) return null
			const items: Raw[] = data.filter((m: any) => typeof m?.id === 'string' && m.id.startsWith('claude')).map((m: any) => ({ id: m.id as string, created: Date.parse(m.created_at) / 1000 || undefined }))
			return { items, total: data.length }
		},
	},
	gemini: {
		url: () => 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
		headers: key => ({ 'x-goog-api-key': key }), // a header, not ?key=, so the key does not end up in URLs
		parse: (json) => {
			const models = json?.models
			if (!Array.isArray(models)) return null
			const items: Raw[] = []
			for (const m of models) {
				if (typeof m?.name !== 'string') continue
				const id = m.name.replace(/^models\//, '')
				const canChat = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods.includes('generateContent') : true
				if (canChat && /^(gemini|gemma)/.test(id) && !NON_CHAT.test(id)) items.push({ id })
			}
			return { items, total: models.length }
		},
		// Google answers an invalid key with HTTP 400 "API key not valid", not 401
		isAuthError: (status, body) => status === 400 && /api key/i.test(String(body?.error?.message ?? '')),
	},
	xAI: {
		url: () => 'https://api.x.ai/v1/models',
		headers: bearer,
		parse: openAIShaped(id => /^grok/.test(id) && !NON_CHAT.test(id)),
	},
	groq: {
		url: () => 'https://api.groq.com/openai/v1/models',
		headers: bearer,
		parse: openAIShaped((id, m) => m.active !== false && !NON_CHAT.test(id)),
	},
	mistral: {
		url: () => 'https://api.mistral.ai/v1/models',
		headers: bearer,
		parse: openAIShaped((id, m) => (m.capabilities?.completion_chat ?? true) !== false && !NON_CHAT.test(id)),
	},
	deepseek: {
		url: () => 'https://api.deepseek.com/models',
		headers: bearer,
		parse: openAIShaped(),
	},
	openRouter: {
		url: () => 'https://openrouter.ai/api/v1/models',
		headers: bearer,
		needsKey: false, // OpenRouter lists its catalog without a key; a key is still sent so a bad one is reported
		parse: (json) => {
			const data = json?.data
			if (!Array.isArray(data)) return null
			// the catalog is several hundred models: offer the ones an agent can use (text out + tool calling), newest first
			const items: Raw[] = data
				.filter((m: any) => typeof m?.id === 'string'
					&& (m.architecture?.output_modalities ?? ['text']).includes('text')
					&& (m.supported_parameters ?? ['tools']).includes('tools')
					&& !String(m.id).endsWith(':batch'))
				.map((m: any) => ({ id: m.id as string, created: typeof m.created === 'number' ? m.created : undefined }))
			return { items, total: data.length }
		},
	},
	moonshot: { url: s => `${trimSlash(s.moonshot.endpoint)}/models`, headers: bearer, parse: openAIShaped() },
	minimax: { url: s => `${trimSlash(s.minimax.endpoint)}/models`, headers: bearer, parse: openAIShaped() },
	alibaba: { url: s => `${trimSlash(s.alibaba.endpoint)}/models`, headers: bearer, parse: openAIShaped(id => !NON_CHAT.test(id)) },
	openCodeZen: { url: s => `${trimSlash(s.openCodeZen.endpoint)}/models`, headers: bearer, parse: openAIShaped() },
	// the vendor providers (common/vendorProviderData.ts): every one with an OpenAI-style /models route, on the endpoint the user configured
	...(Object.fromEntries(vendorLiveListedNames.map(k => [k, { url: (s: SettingsOfProvider) => `${trimSlash(s[k].endpoint)}/models`, headers: bearer, parse: openAIShaped(id => !NON_CHAT.test(id)) } as Spec])) as { [K in typeof vendorLiveListedNames[number]]: Spec }),
}

function trimSlash(u: string) { return (u || '').replace(/\/+$/, '') }

const apiKeyOf = (p: CloudListedProviderName, s: SettingsOfProvider): string => (s[p] as { apiKey?: string }).apiKey ?? ''

/** https is required; plain http is accepted only for a loopback address (a local gateway) */
const isAllowedUrl = (raw: string): boolean => {
	try {
		const u = new URL(raw)
		if (u.protocol === 'https:') return true
		return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
	} catch { return false }
}

export async function listCloudModels(providerName: ProviderName, settingsOfProvider: SettingsOfProvider, deps: ListDeps = {}): Promise<CloudModelListResult> {
	if (!isCloudListedProvider(providerName)) return { ok: false, reason: 'unsupported', message: `Live model lists are not available for this provider.` }
	const spec = specOf[providerName]
	const key = apiKeyOf(providerName, settingsOfProvider).trim()
	if (!key && spec.needsKey !== false) return { ok: false, reason: 'unauthorized', message: 'No API key entered.' }

	let url = spec.url(settingsOfProvider)
	if (deps.baseUrlOverride) { url = deps.baseUrlOverride.replace(/\/+$/, '') + new URL(url).pathname + new URL(url).search }
	if (!isAllowedUrl(url)) return { ok: false, reason: 'http', message: 'The provider endpoint must use https.' }

	const f = deps.fetch ?? fetch
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 15_000)
	try {
		let res: Response
		try {
			res = await f(url, { method: 'GET', headers: { Accept: 'application/json', ...(key ? spec.headers(key) : {}) }, signal: controller.signal, redirect: 'error' })
		} catch (e) {
			const aborted = (e as { name?: string })?.name === 'AbortError'
			return { ok: false, reason: 'network', message: aborted ? 'The provider did not answer in time.' : 'Could not reach the provider.' }
		}

		const declared = Number(res.headers.get('content-length') ?? 0)
		if (declared > MAX_BODY_BYTES) return { ok: false, reason: 'bad-response', message: 'The provider answered with an unexpectedly large response.' }
		let body: any = null
		try {
			const text = await res.text()
			if (text.length > MAX_BODY_BYTES) return { ok: false, reason: 'bad-response', message: 'The provider answered with an unexpectedly large response.' }
			body = text ? JSON.parse(text) : null
		} catch { /* not JSON: handled by the status / shape checks below */ }

		if (res.status === 401 || res.status === 403 || spec.isAuthError?.(res.status, body)) {
			return { ok: false, reason: 'unauthorized', message: 'The provider rejected this API key.' }
		}
		if (res.status === 429) return { ok: false, reason: 'rate-limited', message: 'The provider is rate-limiting requests right now. Try again in a minute.' }
		if (!res.ok) return { ok: false, reason: 'http', message: `The provider answered with HTTP ${res.status}.` }

		const parsed = spec.parse(body)
		if (!parsed) return { ok: false, reason: 'bad-response', message: 'The provider answered in a format Vader does not recognise.' }

		// newest first when the provider says when a model was created; otherwise the provider's own order
		const items = parsed.items.slice()
		if (items.every(i => i.created !== undefined)) items.sort((a, b) => (b.created as number) - (a.created as number))
		const seen = new Set<string>()
		const models: string[] = []
		for (const { id } of items) {
			if (!MODEL_ID.test(id) || seen.has(id)) continue
			seen.add(id)
			models.push(id)
			if (models.length >= MAX_MODELS) break
		}
		if (models.length === 0) return { ok: false, reason: 'bad-response', message: 'The provider returned no chat models for this key.' }
		return { ok: true, models, total: parsed.total }
	} finally {
		clearTimeout(timer)
	}
}
