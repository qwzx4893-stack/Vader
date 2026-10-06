/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { FeatureName, ModelSelectionOptions, OverridesOfModel, ProviderName } from './voidSettingsTypes.js';
import { curatedModelFacts, curatedModelNames } from './providerModelData.js';





export const defaultProviderSettings = {
	anthropic: {
		apiKey: '',
	},
	openAI: {
		apiKey: '',
	},
	deepseek: {
		apiKey: '',
	},
	ollama: {
		endpoint: 'http://127.0.0.1:11434',
	},
	vLLM: {
		endpoint: 'http://localhost:8000',
	},
	openRouter: {
		apiKey: '',
	},
	openAICompatible: {
		endpoint: '',
		apiKey: '',
		headersJSON: '{}', // default to {}
	},
	gemini: {
		apiKey: '',
	},
	groq: {
		apiKey: '',
	},
	xAI: {
		apiKey: '',
	},
	mistral: {
		apiKey: '',
	},
	lmStudio: {
		endpoint: 'http://localhost:1234',
	},
	liteLLM: { // https://docs.litellm.ai/docs/providers/openai_compatible
		endpoint: '',
	},
	googleVertex: { // google https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/call-vertex-using-openai-library
		region: 'us-central1', // Vertex's primary region, where every Gemini model is available
		project: '',
	},
	microsoftAzure: { // microsoft Azure Foundry
		project: '', // really 'resource'
		apiKey: '',
		azureApiVersion: '2025-04-01-preview',
	},
	awsBedrock: {
		apiKey: '',
		region: 'us-east-1', // add region setting
		endpoint: '', // optionally allow overriding default
	},
	// Vader addition, production-hardening provider expansion (docs/integrations/providers/).
	// Real, official, OpenAI-compatible-mode endpoints - `endpoint` defaults to each provider's
	// international/default region and is user-editable for the mainland-China region variant
	// (both regions exist and use non-portable, region-issued API keys per this session's
	// research - see the doc for exact sourcing and confidence level per fact).
	minimax: { // https://platform.minimax.io/docs/api-reference/text-openai-api
		apiKey: '',
		endpoint: 'https://api.minimax.io/v1', // China: https://api.minimax.cn/v1 (LiteLLM still lists api.minimaxi.com; earlier research found it redirects here - see docs/integrations/providers/minimax.md)
	},
	alibaba: { // Alibaba Cloud Model Studio (DashScope) - https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope
		apiKey: '',
		endpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', // China: https://dashscope.aliyuncs.com/compatible-mode/v1
	},
	moonshot: { // Moonshot AI (Kimi) - https://platform.moonshot.ai/docs/guide/start-using-kimi-api
		apiKey: '',
		endpoint: 'https://api.moonshot.ai/v1', // China: https://api.moonshot.cn/v1
	},
	openCodeZen: { // https://opencode.ai/docs/zen/ - a pay-as-you-go gateway re-exposing many vendors' models; only the OpenAI-shaped subset of its catalog is reachable through this provider (see doc)
		apiKey: '',
		endpoint: 'https://opencode.ai/zen/v1',
	},

} as const




export const defaultModelsOfProvider = {
	openAI: [...curatedModelNames.openAI], // https://platform.openai.com/docs/models - facts in providerModelData.ts
	anthropic: [...curatedModelNames.anthropic], // https://docs.anthropic.com/en/docs/about-claude/models
	xAI: [...curatedModelNames.xAI], // https://docs.x.ai/docs/models
	gemini: [...curatedModelNames.gemini], // https://ai.google.dev/gemini-api/docs/models
	deepseek: [...curatedModelNames.deepseek], // https://api-docs.deepseek.com/quick_start/pricing
	ollama: [ // autodetected
	],
	vLLM: [ // autodetected
	],
	lmStudio: [], // autodetected

	openRouter: [...curatedModelNames.openRouter], // https://openrouter.ai/models - the full catalog is fetched live once a key is entered
	groq: [...curatedModelNames.groq], // https://console.groq.com/docs/models
	mistral: [...curatedModelNames.mistral], // https://docs.mistral.ai/getting-started/models/models_overview/
	openAICompatible: [], // fallback
	googleVertex: [],
	microsoftAzure: [],
	awsBedrock: [],
	liteLLM: [],
	minimax: [ // https://platform.minimax.io/docs/api-reference/models/openai/list-models
		...curatedModelNames.minimax,
		'MiniMax-M2.7',
		'MiniMax-M2.7-highspeed',
		'MiniMax-M2.5',
		'MiniMax-M2.5-highspeed',
		'MiniMax-M2.1',
		'MiniMax-M2.1-lightning',
		'MiniMax-M2',
	],
	alibaba: [...curatedModelNames.alibaba], // https://www.alibabacloud.com/help/en/model-studio/model-pricing
	moonshot: [ // https://platform.kimi.ai/docs/api/list-models
		'kimi-k3',
		'kimi-k2.7-code',
		'kimi-k2.6',
	],
	openCodeZen: [], // beta, volatile catalog re-exposing other vendors' model IDs - add the exact id shown in your Zen console


} as const satisfies Record<ProviderName, string[]>



export type VoidStaticModelInfo = { // not stateful
	// Vader uses the information below to know how to handle each model.
	// for some examples, see openAIModelOptions and anthropicModelOptions (below).

	contextWindow: number; // input tokens
	reservedOutputTokenSpace: number | null; // reserve this much space in the context window for output, defaults to 4096 if null

	supportsSystemMessage: false | 'system-role' | 'developer-role' | 'separated'; // typically you should use 'system-role'. 'separated' means the system message is passed as a separate field (e.g. anthropic)
	specialToolFormat?: 'openai-style' | 'anthropic-style' | 'gemini-style', // typically you should use 'openai-style'. null means "can't call tools by default", and asks the LLM to output XML in agent mode
	supportsFIM: boolean; // whether the model was specifically designed for autocomplete or "FIM" ("fill-in-middle" format)

	additionalOpenAIPayload?: { [key: string]: string } // additional payload in the message body for requests that are openai-compatible (ollama, vllm, openai, openrouter, etc)

	// reasoning options
	reasoningCapabilities: false | {
		readonly supportsReasoning: true; // for clarity, this must be true if anything below is specified
		readonly canTurnOffReasoning: boolean; // whether or not the user can disable reasoning mode (false if the model only supports reasoning)
		readonly canIOReasoning: boolean; // whether or not the model actually outputs reasoning (eg o1 lets us control reasoning but not output it)
		readonly reasoningReservedOutputTokenSpace?: number; // overrides normal reservedOutputTokenSpace
		readonly reasoningSlider?:
		| undefined
		| { type: 'budget_slider'; min: number; max: number; default: number } // anthropic supports this (reasoning budget)
		| { type: 'effort_slider'; values: string[]; default: string } // openai-compatible supports this (reasoning effort)

		// if it's open source and specifically outputs think tags, put the think tags here and we'll parse them out (e.g. ollama)
		readonly openSourceThinkTags?: [string, string];

		// the only other field related to reasoning is "providerReasoningIOSettings", which varies by provider.
	};


	// --- below is just informative, not used in sending / receiving, cannot be customized in settings ---
	cost: {
		input: number;
		output: number;
		cache_read?: number;
		cache_write?: number;
	}
	downloadable: false | {
		sizeGb: number | 'not-known'
	}
}
// if you change the above type, remember to update the Settings link



export const modelOverrideKeys = [
	'contextWindow',
	'reservedOutputTokenSpace',
	'supportsSystemMessage',
	'specialToolFormat',
	'supportsFIM',
	'reasoningCapabilities',
	'additionalOpenAIPayload'
] as const

export type ModelOverrides = Pick<
	VoidStaticModelInfo,
	(typeof modelOverrideKeys)[number]
>




type ProviderReasoningIOSettings = {
	// include this in payload to get reasoning
	input?: { includeInPayload?: (reasoningState: SendableReasoningInfo) => null | { [key: string]: any }, };
	// nameOfFieldInDelta: reasoning output is in response.choices[0].delta[deltaReasoningField]
	// needsManualParse: whether we must manually parse out the <think> tags
	output?:
	| { nameOfFieldInDelta?: string, needsManualParse?: undefined, }
	| { nameOfFieldInDelta?: undefined, needsManualParse?: true, };
}

type VoidStaticProviderInfo = { // doesn't change (not stateful)
	providerReasoningIOSettings?: ProviderReasoningIOSettings; // input/output settings around thinking (allowed to be empty) - only applied if the model supports reasoning output
	modelOptions: { [key: string]: VoidStaticModelInfo };
	modelOptionsFallback: (modelName: string, fallbackKnownValues?: Partial<VoidStaticModelInfo>) => (VoidStaticModelInfo & { modelName: string, recognizedModelName: string }) | null;
}



const defaultModelOptions = {
	contextWindow: 4_096,
	reservedOutputTokenSpace: 4_096,
	cost: { input: 0, output: 0 },
	downloadable: false,
	supportsSystemMessage: false,
	supportsFIM: false,
	reasoningCapabilities: false,
} as const satisfies VoidStaticModelInfo


// ---------------- models offered by default (facts: providerModelData.ts, generated from the LiteLLM catalog) ----------------
type CuratedFacts = typeof curatedModelFacts[string][string]
const _fromFacts = (f: CuratedFacts, o: { supportsSystemMessage: VoidStaticModelInfo['supportsSystemMessage'], toolFormat: VoidStaticModelInfo['specialToolFormat'], reasoningCapabilities: VoidStaticModelInfo['reasoningCapabilities'], supportsFIM?: boolean }): VoidStaticModelInfo => ({
	contextWindow: f.ctx,
	reservedOutputTokenSpace: Math.min(f.out, 32_768), // the catalog's max output is a hard limit; reserving that much of the window for every reply would waste it
	cost: { ...f.cost },
	downloadable: false,
	supportsFIM: o.supportsFIM ?? false,
	supportsSystemMessage: o.supportsSystemMessage,
	specialToolFormat: f.tools ? o.toolFormat : undefined, // a model without native tool calling gets the XML-in-prompt path
	reasoningCapabilities: o.reasoningCapabilities,
})
const _factsOf = (provider: string, build: (name: string, f: CuratedFacts) => VoidStaticModelInfo): { [name: string]: VoidStaticModelInfo } =>
	Object.fromEntries(Object.entries(curatedModelFacts[provider] ?? {}).map(([name, f]) => [name, build(name, f)]))

const _effortSlider = (f: CuratedFacts): VoidStaticModelInfo['reasoningCapabilities'] => !f.reasoning ? false
	: { supportsReasoning: true, canTurnOffReasoning: false, canIOReasoning: false, reasoningSlider: { type: 'effort_slider', values: ['low', 'medium', 'high'], default: 'medium' } }

const generatedAnthropicOptions = _factsOf('anthropic', (_n, f) => _fromFacts(f, {
	supportsSystemMessage: 'separated', toolFormat: 'anthropic-style',
	// adaptive-only models (Claude 5 family, Opus 4.8) reject the budget_tokens parameter and think on their own, so no slider is offered for them
	reasoningCapabilities: !f.reasoning || f.adaptive ? false
		: { supportsReasoning: true, canTurnOffReasoning: true, canIOReasoning: true, reasoningReservedOutputTokenSpace: 8192, reasoningSlider: { type: 'budget_slider', min: 1024, max: 8192, default: 1024 } },
}))
const generatedOpenAIOptions = _factsOf('openAI', (_n, f) => _fromFacts(f, { supportsSystemMessage: 'developer-role', toolFormat: 'openai-style', reasoningCapabilities: _effortSlider(f) }))
const generatedXAIOptions = _factsOf('xAI', (_n, f) => _fromFacts(f, { supportsSystemMessage: 'system-role', toolFormat: 'openai-style', reasoningCapabilities: false })) // grok 4 reasons by itself and takes no effort parameter
const generatedGeminiOptions = _factsOf('gemini', (n, f) => _fromFacts(f, {
	supportsSystemMessage: 'separated', toolFormat: 'gemini-style',
	// only the 2.5 family is known to take thinkingBudget; newer ones think on their own
	reasoningCapabilities: f.reasoning && n.includes('2.5') ? { supportsReasoning: true, canTurnOffReasoning: n !== 'gemini-2.5-pro', canIOReasoning: false, reasoningSlider: { type: 'budget_slider', min: 1024, max: 8192, default: 1024 }, reasoningReservedOutputTokenSpace: 8192 } : false,
}))
const generatedDeepseekOptions = _factsOf('deepseek', (_n, f) => _fromFacts(f, { supportsSystemMessage: 'system-role', toolFormat: 'openai-style', reasoningCapabilities: false }))
const generatedMistralOptions = _factsOf('mistral', (n, f) => _fromFacts(f, { supportsSystemMessage: 'system-role', toolFormat: 'openai-style', reasoningCapabilities: false, supportsFIM: n.startsWith('codestral') }))
const generatedGroqOptions = _factsOf('groq', (_n, f) => _fromFacts(f, { supportsSystemMessage: 'system-role', toolFormat: 'openai-style', reasoningCapabilities: false }))
const generatedMoonshotOptions = _factsOf('moonshot', (_n, f) => _fromFacts(f, { supportsSystemMessage: 'system-role', toolFormat: 'openai-style', reasoningCapabilities: false }))
const generatedMinimaxOptions = _factsOf('minimax', (_n, f) => _fromFacts(f, { supportsSystemMessage: 'system-role', toolFormat: 'openai-style', reasoningCapabilities: false }))
const generatedAlibabaOptions = _factsOf('alibaba', (_n, f) => _fromFacts(f, { supportsSystemMessage: 'system-role', toolFormat: 'openai-style', reasoningCapabilities: false }))
const generatedOpenRouterOptions = _factsOf('openRouter', (_n, f) => _fromFacts(f, { supportsSystemMessage: 'system-role', toolFormat: 'openai-style', reasoningCapabilities: false }))

// TODO!!! double check all context sizes below
// TODO!!! add openrouter common models
// TODO!!! allow user to modify capabilities and tell them if autodetected model or falling back
const openSourceModelOptions_assumingOAICompat = {
	'deepseekR1': {
		supportsFIM: false,
		supportsSystemMessage: false,
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: false, canIOReasoning: true, openSourceThinkTags: ['<think>', '</think>'] },
		contextWindow: 32_000, reservedOutputTokenSpace: 4_096,
	},
	'deepseekCoderV3': {
		supportsFIM: false,
		supportsSystemMessage: false, // unstable
		reasoningCapabilities: false,
		contextWindow: 32_000, reservedOutputTokenSpace: 4_096,
	},
	'deepseekCoderV2': {
		supportsFIM: false,
		supportsSystemMessage: false, // unstable
		reasoningCapabilities: false,
		contextWindow: 32_000, reservedOutputTokenSpace: 4_096,
	},
	'codestral': {
		supportsFIM: true,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
		contextWindow: 32_000, reservedOutputTokenSpace: 4_096,
	},
	'devstral': {
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
		contextWindow: 131_000, reservedOutputTokenSpace: 8_192,
	},
	'openhands-lm-32b': { // https://www.all-hands.dev/blog/introducing-openhands-lm-32b----a-strong-open-coding-agent-model
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false, // built on qwen 2.5 32B instruct
		contextWindow: 128_000, reservedOutputTokenSpace: 4_096
	},

	// really only phi4-reasoning supports reasoning... simpler to combine them though
	'phi4': {
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: true, canIOReasoning: true, openSourceThinkTags: ['<think>', '</think>'] },
		contextWindow: 16_000, reservedOutputTokenSpace: 4_096,
	},

	'gemma': { // https://news.ycombinator.com/item?id=43451406
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
		contextWindow: 32_000, reservedOutputTokenSpace: 4_096,
	},
	// llama 4 https://ai.meta.com/blog/llama-4-multimodal-intelligence/
	'llama4-scout': {
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
		contextWindow: 10_000_000, reservedOutputTokenSpace: 4_096,
	},
	'llama4-maverick': {
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
		contextWindow: 10_000_000, reservedOutputTokenSpace: 4_096,
	},

	// llama 3
	'llama3': {
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
		contextWindow: 32_000, reservedOutputTokenSpace: 4_096,
	},
	'llama3.1': {
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
		contextWindow: 32_000, reservedOutputTokenSpace: 4_096,
	},
	'llama3.2': {
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
		contextWindow: 32_000, reservedOutputTokenSpace: 4_096,
	},
	'llama3.3': {
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
		contextWindow: 32_000, reservedOutputTokenSpace: 4_096,
	},
	// qwen
	'qwen2.5coder': {
		supportsFIM: true,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
		contextWindow: 32_000, reservedOutputTokenSpace: 4_096,
	},
	'qwq': {
		supportsFIM: false, // no FIM, yes reasoning
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: false, canIOReasoning: true, openSourceThinkTags: ['<think>', '</think>'] },
		contextWindow: 128_000, reservedOutputTokenSpace: 8_192,
	},
	'qwen3': {
		supportsFIM: false, // replaces QwQ
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: true, canIOReasoning: true, openSourceThinkTags: ['<think>', '</think>'] },
		contextWindow: 32_768, reservedOutputTokenSpace: 8_192,
	},
	// FIM only
	'starcoder2': {
		supportsFIM: true,
		supportsSystemMessage: false,
		reasoningCapabilities: false,
		contextWindow: 128_000, reservedOutputTokenSpace: 8_192,

	},
	'codegemma:2b': {
		supportsFIM: true,
		supportsSystemMessage: false,
		reasoningCapabilities: false,
		contextWindow: 128_000, reservedOutputTokenSpace: 8_192,

	},
	'quasar': { // openrouter/quasar-alpha
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
		contextWindow: 1_000_000, reservedOutputTokenSpace: 32_000,
	}
} as const satisfies { [s: string]: Partial<VoidStaticModelInfo> }




// keep modelName, but use the fallback's defaults
const extensiveModelOptionsFallback: VoidStaticProviderInfo['modelOptionsFallback'] = (modelName, fallbackKnownValues) => {

	const lower = modelName.toLowerCase()

	const toFallback = <T extends { [s: string]: Omit<VoidStaticModelInfo, 'cost' | 'downloadable'> },>(obj: T, recognizedModelName: string & keyof T)
		: VoidStaticModelInfo & { modelName: string, recognizedModelName: string } => {

		const opts = obj[recognizedModelName]
		const supportsSystemMessage = opts.supportsSystemMessage === 'separated'
			? 'system-role'
			: opts.supportsSystemMessage

		return {
			recognizedModelName,
			modelName,
			...opts,
			supportsSystemMessage: supportsSystemMessage,
			cost: { input: 0, output: 0 },
			downloadable: false,
			...fallbackKnownValues
		};
	}

	if (lower.includes('gemini') && (lower.includes('2.5') || lower.includes('2-5'))) return toFallback(geminiModelOptions, 'gemini-2.5-pro-exp-03-25')

	if (lower.includes('claude-3-5') || lower.includes('claude-3.5')) return toFallback(anthropicModelOptions, 'claude-3-5-sonnet-20241022')
	if (lower.includes('claude')) return toFallback(anthropicModelOptions, 'claude-3-7-sonnet-20250219')

	if (lower.includes('grok2') || lower.includes('grok2')) return toFallback(xAIModelOptions, 'grok-2')
	if (lower.includes('grok')) return toFallback(xAIModelOptions, 'grok-3')

	if (lower.includes('deepseek-r1') || lower.includes('deepseek-reasoner')) return toFallback(openSourceModelOptions_assumingOAICompat, 'deepseekR1')
	if (lower.includes('deepseek') && lower.includes('v2')) return toFallback(openSourceModelOptions_assumingOAICompat, 'deepseekCoderV2')
	if (lower.includes('deepseek')) return toFallback(openSourceModelOptions_assumingOAICompat, 'deepseekCoderV3')

	if (lower.includes('llama3')) return toFallback(openSourceModelOptions_assumingOAICompat, 'llama3')
	if (lower.includes('llama3.1')) return toFallback(openSourceModelOptions_assumingOAICompat, 'llama3.1')
	if (lower.includes('llama3.2')) return toFallback(openSourceModelOptions_assumingOAICompat, 'llama3.2')
	if (lower.includes('llama3.3')) return toFallback(openSourceModelOptions_assumingOAICompat, 'llama3.3')
	if (lower.includes('llama') || lower.includes('scout')) return toFallback(openSourceModelOptions_assumingOAICompat, 'llama4-scout')
	if (lower.includes('llama') || lower.includes('maverick')) return toFallback(openSourceModelOptions_assumingOAICompat, 'llama4-scout')
	if (lower.includes('llama')) return toFallback(openSourceModelOptions_assumingOAICompat, 'llama4-scout')

	if (lower.includes('qwen') && lower.includes('2.5') && lower.includes('coder')) return toFallback(openSourceModelOptions_assumingOAICompat, 'qwen2.5coder')
	if (lower.includes('qwen') && lower.includes('3')) return toFallback(openSourceModelOptions_assumingOAICompat, 'qwen3')
	if (lower.includes('qwen')) return toFallback(openSourceModelOptions_assumingOAICompat, 'qwen3')
	if (lower.includes('qwq')) { return toFallback(openSourceModelOptions_assumingOAICompat, 'qwq') }
	if (lower.includes('phi4')) return toFallback(openSourceModelOptions_assumingOAICompat, 'phi4')
	if (lower.includes('codestral')) return toFallback(openSourceModelOptions_assumingOAICompat, 'codestral')
	if (lower.includes('devstral')) return toFallback(openSourceModelOptions_assumingOAICompat, 'devstral')

	if (lower.includes('gemma')) return toFallback(openSourceModelOptions_assumingOAICompat, 'gemma')

	if (lower.includes('starcoder2')) return toFallback(openSourceModelOptions_assumingOAICompat, 'starcoder2')

	if (lower.includes('openhands')) return toFallback(openSourceModelOptions_assumingOAICompat, 'openhands-lm-32b') // max output uncler

	if (lower.includes('quasar') || lower.includes('quaser')) return toFallback(openSourceModelOptions_assumingOAICompat, 'quasar')

	if (lower.includes('gpt') && lower.includes('mini') && (lower.includes('4.1') || lower.includes('4-1'))) return toFallback(openAIModelOptions, 'gpt-4.1-mini')
	if (lower.includes('gpt') && lower.includes('nano') && (lower.includes('4.1') || lower.includes('4-1'))) return toFallback(openAIModelOptions, 'gpt-4.1-nano')
	if (lower.includes('gpt') && (lower.includes('4.1') || lower.includes('4-1'))) return toFallback(openAIModelOptions, 'gpt-4.1')

	if (lower.includes('4o') && lower.includes('mini')) return toFallback(openAIModelOptions, 'gpt-4o-mini')
	if (lower.includes('4o')) return toFallback(openAIModelOptions, 'gpt-4o')

	if (lower.includes('o1') && lower.includes('mini')) return toFallback(openAIModelOptions, 'o1-mini')
	if (lower.includes('o1')) return toFallback(openAIModelOptions, 'o1')
	if (lower.includes('o3') && lower.includes('mini')) return toFallback(openAIModelOptions, 'o3-mini')
	if (lower.includes('o3')) return toFallback(openAIModelOptions, 'o3')
	if (lower.includes('o4') && lower.includes('mini')) return toFallback(openAIModelOptions, 'o4-mini')


	if (Object.keys(openSourceModelOptions_assumingOAICompat).map(k => k.toLowerCase()).includes(lower))
		return toFallback(openSourceModelOptions_assumingOAICompat, lower as keyof typeof openSourceModelOptions_assumingOAICompat)

	return null
}






// ---------------- ANTHROPIC ----------------
const anthropicModelOptions = {
	'claude-3-7-sonnet-20250219': { // https://docs.anthropic.com/en/docs/about-claude/models/all-models#model-comparison-table
		contextWindow: 200_000,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 3.00, cache_read: 0.30, cache_write: 3.75, output: 15.00 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'anthropic-style',
		supportsSystemMessage: 'separated',
		reasoningCapabilities: {
			supportsReasoning: true,
			canTurnOffReasoning: true,
			canIOReasoning: true,
			reasoningReservedOutputTokenSpace: 8192, // can bump it to 128_000 with beta mode output-128k-2025-02-19
			reasoningSlider: { type: 'budget_slider', min: 1024, max: 8192, default: 1024 }, // they recommend batching if max > 32_000. we cap at 8192 because above is typically not necessary (often even buggy)
		},

	},
	'claude-opus-4-20250514': {
		contextWindow: 200_000,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 15.00, cache_read: 1.50, cache_write: 18.75, output: 30.00 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'anthropic-style',
		supportsSystemMessage: 'separated',
		reasoningCapabilities: {
			supportsReasoning: true,
			canTurnOffReasoning: true,
			canIOReasoning: true,
			reasoningReservedOutputTokenSpace: 8192, // can bump it to 128_000 with beta mode output-128k-2025-02-19
			reasoningSlider: { type: 'budget_slider', min: 1024, max: 8192, default: 1024 }, // they recommend batching if max > 32_000. we cap at 8192 because above is typically not necessary (often even buggy)
		},

	},
	'claude-sonnet-4-20250514': {
		contextWindow: 200_000,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 3.00, cache_read: 0.30, cache_write: 3.75, output: 6.00 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'anthropic-style',
		supportsSystemMessage: 'separated',
		reasoningCapabilities: {
			supportsReasoning: true,
			canTurnOffReasoning: true,
			canIOReasoning: true,
			reasoningReservedOutputTokenSpace: 8192, // can bump it to 128_000 with beta mode output-128k-2025-02-19
			reasoningSlider: { type: 'budget_slider', min: 1024, max: 8192, default: 1024 }, // they recommend batching if max > 32_000. we cap at 8192 because above is typically not necessary (often even buggy)
		},

	},
	'claude-3-5-sonnet-20241022': {
		contextWindow: 200_000,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 3.00, cache_read: 0.30, cache_write: 3.75, output: 15.00 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'anthropic-style',
		supportsSystemMessage: 'separated',
		reasoningCapabilities: false,
	},
	'claude-3-5-haiku-20241022': {
		contextWindow: 200_000,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.80, cache_read: 0.08, cache_write: 1.00, output: 4.00 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'anthropic-style',
		supportsSystemMessage: 'separated',
		reasoningCapabilities: false,
	},
	'claude-3-opus-20240229': {
		contextWindow: 200_000,
		reservedOutputTokenSpace: 4_096,
		cost: { input: 15.00, cache_read: 1.50, cache_write: 18.75, output: 75.00 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'anthropic-style',
		supportsSystemMessage: 'separated',
		reasoningCapabilities: false,
	},
	'claude-3-sonnet-20240229': { // no point of using this, but including this for people who put it in
		contextWindow: 200_000, cost: { input: 3.00, output: 15.00 },
		downloadable: false,
		reservedOutputTokenSpace: 4_096,
		supportsFIM: false,
		specialToolFormat: 'anthropic-style',
		supportsSystemMessage: 'separated',
		reasoningCapabilities: false,
	}
} as const satisfies { [s: string]: VoidStaticModelInfo }

const anthropicSettings: VoidStaticProviderInfo = {
	providerReasoningIOSettings: {
		input: {
			includeInPayload: (reasoningInfo) => {
				if (!reasoningInfo?.isReasoningEnabled) return null

				if (reasoningInfo.type === 'budget_slider_value') {
					return { thinking: { type: 'enabled', budget_tokens: reasoningInfo.reasoningBudget } }
				}
				return null
			}
		},
	},
	modelOptions: anthropicModelOptions,
	modelOptionsFallback: (modelName) => {
		const lower = modelName.toLowerCase()
		let fallbackName: keyof typeof anthropicModelOptions | null = null
		if (lower.includes('claude-4-opus') || lower.includes('claude-opus-4')) fallbackName = 'claude-opus-4-20250514'
		if (lower.includes('claude-4-sonnet') || lower.includes('claude-sonnet-4')) fallbackName = 'claude-sonnet-4-20250514'


		if (lower.includes('claude-3-7-sonnet')) fallbackName = 'claude-3-7-sonnet-20250219'
		if (lower.includes('claude-3-5-sonnet')) fallbackName = 'claude-3-5-sonnet-20241022'
		if (lower.includes('claude-3-5-haiku')) fallbackName = 'claude-3-5-haiku-20241022'
		if (lower.includes('claude-3-opus')) fallbackName = 'claude-3-opus-20240229'
		if (lower.includes('claude-3-sonnet')) fallbackName = 'claude-3-sonnet-20240229'
		if (fallbackName) return { modelName: fallbackName, recognizedModelName: fallbackName, ...anthropicModelOptions[fallbackName] }
		return null
	},
}


// ---------------- OPENAI ----------------
const openAIModelOptions = { // https://platform.openai.com/docs/pricing
	'o3': {
		contextWindow: 1_047_576,
		reservedOutputTokenSpace: 32_768,
		cost: { input: 10.00, output: 40.00, cache_read: 2.50 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'openai-style',
		supportsSystemMessage: 'developer-role',
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: false, canIOReasoning: false, reasoningSlider: { type: 'effort_slider', values: ['low', 'medium', 'high'], default: 'low' } },
	},
	'o4-mini': {
		contextWindow: 1_047_576,
		reservedOutputTokenSpace: 32_768,
		cost: { input: 1.10, output: 4.40, cache_read: 0.275 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'openai-style',
		supportsSystemMessage: 'developer-role',
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: false, canIOReasoning: false, reasoningSlider: { type: 'effort_slider', values: ['low', 'medium', 'high'], default: 'low' } },
	},
	'gpt-4.1': {
		contextWindow: 1_047_576,
		reservedOutputTokenSpace: 32_768,
		cost: { input: 2.00, output: 8.00, cache_read: 0.50 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'openai-style',
		supportsSystemMessage: 'developer-role',
		reasoningCapabilities: false,
	},
	'gpt-4.1-mini': {
		contextWindow: 1_047_576,
		reservedOutputTokenSpace: 32_768,
		cost: { input: 0.40, output: 1.60, cache_read: 0.10 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'openai-style',
		supportsSystemMessage: 'developer-role',
		reasoningCapabilities: false,
	},
	'gpt-4.1-nano': {
		contextWindow: 1_047_576,
		reservedOutputTokenSpace: 32_768,
		cost: { input: 0.10, output: 0.40, cache_read: 0.03 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'openai-style',
		supportsSystemMessage: 'developer-role',
		reasoningCapabilities: false,
	},
	'o1': {
		contextWindow: 128_000,
		reservedOutputTokenSpace: 100_000,
		cost: { input: 15.00, cache_read: 7.50, output: 60.00, },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'developer-role',
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: false, canIOReasoning: false, reasoningSlider: { type: 'effort_slider', values: ['low', 'medium', 'high'], default: 'low' } },
	},
	'o3-mini': {
		contextWindow: 200_000,
		reservedOutputTokenSpace: 100_000,
		cost: { input: 1.10, cache_read: 0.55, output: 4.40, },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'developer-role',
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: false, canIOReasoning: false, reasoningSlider: { type: 'effort_slider', values: ['low', 'medium', 'high'], default: 'low' } },
	},
	'gpt-4o': {
		contextWindow: 128_000,
		reservedOutputTokenSpace: 16_384,
		cost: { input: 2.50, cache_read: 1.25, output: 10.00, },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'openai-style',
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'o1-mini': {
		contextWindow: 128_000,
		reservedOutputTokenSpace: 65_536,
		cost: { input: 1.10, cache_read: 0.55, output: 4.40, },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: false, // does not support any system
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: false, canIOReasoning: false, reasoningSlider: { type: 'effort_slider', values: ['low', 'medium', 'high'], default: 'low' } },
	},
	'gpt-4o-mini': {
		contextWindow: 128_000,
		reservedOutputTokenSpace: 16_384,
		cost: { input: 0.15, cache_read: 0.075, output: 0.60, },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'openai-style',
		supportsSystemMessage: 'system-role', // ??
		reasoningCapabilities: false,
	},
} as const satisfies { [s: string]: VoidStaticModelInfo }


// https://platform.openai.com/docs/guides/reasoning?api-mode=chat
const openAICompatIncludeInPayloadReasoning = (reasoningInfo: SendableReasoningInfo) => {
	if (!reasoningInfo?.isReasoningEnabled) return null
	if (reasoningInfo.type === 'effort_slider_value') {
		return { reasoning_effort: reasoningInfo.reasoningEffort }
	}
	return null

}

const openAISettings: VoidStaticProviderInfo = {
	modelOptions: openAIModelOptions,
	modelOptionsFallback: (modelName) => {
		const lower = modelName.toLowerCase()
		let fallbackName: keyof typeof openAIModelOptions | null = null
		if (lower.includes('o1')) { fallbackName = 'o1' }
		if (lower.includes('o3-mini')) { fallbackName = 'o3-mini' }
		if (lower.includes('gpt-4o')) { fallbackName = 'gpt-4o' }
		if (fallbackName) return { modelName: fallbackName, recognizedModelName: fallbackName, ...openAIModelOptions[fallbackName] }
		return null
	},
	providerReasoningIOSettings: {
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
	},
}

// ---------------- XAI ----------------
const xAIModelOptions = {
	// https://docs.x.ai/docs/guides/reasoning#reasoning
	// https://docs.x.ai/docs/models#models-and-pricing
	'grok-2': {
		contextWindow: 131_072,
		reservedOutputTokenSpace: null,
		cost: { input: 2.00, output: 10.00 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style',
		reasoningCapabilities: false,
	},
	'grok-3': {
		contextWindow: 131_072,
		reservedOutputTokenSpace: null,
		cost: { input: 3.00, output: 15.00 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style',
		reasoningCapabilities: false,
	},
	'grok-3-fast': {
		contextWindow: 131_072,
		reservedOutputTokenSpace: null,
		cost: { input: 5.00, output: 25.00 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style',
		reasoningCapabilities: false,
	},
	// only mini supports thinking
	'grok-3-mini': {
		contextWindow: 131_072,
		reservedOutputTokenSpace: null,
		cost: { input: 0.30, output: 0.50 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style',
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: false, canIOReasoning: false, reasoningSlider: { type: 'effort_slider', values: ['low', 'high'], default: 'low' } },
	},
	'grok-3-mini-fast': {
		contextWindow: 131_072,
		reservedOutputTokenSpace: null,
		cost: { input: 0.60, output: 4.00 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style',
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: false, canIOReasoning: false, reasoningSlider: { type: 'effort_slider', values: ['low', 'high'], default: 'low' } },
	},
} as const satisfies { [s: string]: VoidStaticModelInfo }

const xAISettings: VoidStaticProviderInfo = {
	modelOptions: xAIModelOptions,
	modelOptionsFallback: (modelName) => {
		const lower = modelName.toLowerCase()
		let fallbackName: keyof typeof xAIModelOptions | null = null
		if (lower.includes('grok-2')) fallbackName = 'grok-2'
		if (lower.includes('grok-3')) fallbackName = 'grok-3'
		if (lower.includes('grok')) fallbackName = 'grok-3'
		if (fallbackName) return { modelName: fallbackName, recognizedModelName: fallbackName, ...xAIModelOptions[fallbackName] }
		return null
	},
	// same implementation as openai
	providerReasoningIOSettings: {
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
	},
}


// ---------------- GEMINI ----------------
const geminiModelOptions = { // https://ai.google.dev/gemini-api/docs/pricing
	// https://ai.google.dev/gemini-api/docs/thinking#set-budget
	'gemini-2.5-pro-preview-05-06': {
		contextWindow: 1_048_576,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0, output: 0 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		specialToolFormat: 'gemini-style',
		reasoningCapabilities: {
			supportsReasoning: true,
			canTurnOffReasoning: true,
			canIOReasoning: false,
			reasoningSlider: { type: 'budget_slider', min: 1024, max: 8192, default: 1024 }, // max is really 24576
			reasoningReservedOutputTokenSpace: 8192,
		},
	},
	'gemini-2.0-flash-lite': {
		contextWindow: 1_048_576,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0, output: 0 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		specialToolFormat: 'gemini-style',
		reasoningCapabilities: false, // no reasoning
	},
	'gemini-2.5-flash-preview-04-17': {
		contextWindow: 1_048_576,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.15, output: .60 }, // TODO $3.50 output with thinking not included
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		specialToolFormat: 'gemini-style',
		reasoningCapabilities: {
			supportsReasoning: true,
			canTurnOffReasoning: true,
			canIOReasoning: false,
			reasoningSlider: { type: 'budget_slider', min: 1024, max: 8192, default: 1024 }, // max is really 24576
			reasoningReservedOutputTokenSpace: 8192,
		},
	},
	'gemini-2.5-pro-exp-03-25': {
		contextWindow: 1_048_576,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0, output: 0 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		specialToolFormat: 'gemini-style',
		reasoningCapabilities: {
			supportsReasoning: true,
			canTurnOffReasoning: true,
			canIOReasoning: false,
			reasoningSlider: { type: 'budget_slider', min: 1024, max: 8192, default: 1024 }, // max is really 24576
			reasoningReservedOutputTokenSpace: 8192,
		},
	},
	'gemini-2.0-flash': {
		contextWindow: 1_048_576,
		reservedOutputTokenSpace: 8_192, // 8_192,
		cost: { input: 0.10, output: 0.40 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		specialToolFormat: 'gemini-style',
		reasoningCapabilities: false,
	},
	'gemini-2.0-flash-lite-preview-02-05': {
		contextWindow: 1_048_576,
		reservedOutputTokenSpace: 8_192, // 8_192,
		cost: { input: 0.075, output: 0.30 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		specialToolFormat: 'gemini-style',
		reasoningCapabilities: false,
	},
	'gemini-1.5-flash': {
		contextWindow: 1_048_576,
		reservedOutputTokenSpace: 8_192, // 8_192,
		cost: { input: 0.075, output: 0.30 },  // TODO!!! price doubles after 128K tokens, we are NOT encoding that info right now
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		specialToolFormat: 'gemini-style',
		reasoningCapabilities: false,
	},
	'gemini-1.5-pro': {
		contextWindow: 2_097_152,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 1.25, output: 5.00 },  // TODO!!! price doubles after 128K tokens, we are NOT encoding that info right now
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		specialToolFormat: 'gemini-style',
		reasoningCapabilities: false,
	},
	'gemini-1.5-flash-8b': {
		contextWindow: 1_048_576,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.0375, output: 0.15 },  // TODO!!! price doubles after 128K tokens, we are NOT encoding that info right now
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		specialToolFormat: 'gemini-style',
		reasoningCapabilities: false,
	},
} as const satisfies { [s: string]: VoidStaticModelInfo }

const geminiSettings: VoidStaticProviderInfo = {
	modelOptions: geminiModelOptions,
	modelOptionsFallback: (modelName) => { return null },
}



// ---------------- DEEPSEEK API ----------------
const deepseekModelOptions = {
	'deepseek-chat': {
		...openSourceModelOptions_assumingOAICompat.deepseekR1,
		contextWindow: 64_000, // https://api-docs.deepseek.com/quick_start/pricing
		reservedOutputTokenSpace: 8_000, // 8_000,
		cost: { cache_read: .07, input: .27, output: 1.10, },
		downloadable: false,
	},
	'deepseek-reasoner': {
		...openSourceModelOptions_assumingOAICompat.deepseekCoderV2,
		contextWindow: 64_000,
		reservedOutputTokenSpace: 8_000, // 8_000,
		cost: { cache_read: .14, input: .55, output: 2.19, },
		downloadable: false,
	},
} as const satisfies { [s: string]: VoidStaticModelInfo }


const deepseekSettings: VoidStaticProviderInfo = {
	modelOptions: deepseekModelOptions,
	modelOptionsFallback: (modelName) => { return null },
	providerReasoningIOSettings: {
		// reasoning: OAICompat +  response.choices[0].delta.reasoning_content // https://api-docs.deepseek.com/guides/reasoning_model
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
		output: { nameOfFieldInDelta: 'reasoning_content' },
	},
}



// ---------------- MISTRAL ----------------

const mistralModelOptions = { // https://mistral.ai/products/la-plateforme#pricing https://docs.mistral.ai/getting-started/models/models_overview/#premier-models
	'mistral-large-latest': {
		contextWindow: 131_000,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 2.00, output: 6.00 },
		supportsFIM: false,
		downloadable: { sizeGb: 73 },
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'mistral-medium-latest': { // https://openrouter.ai/mistralai/mistral-medium-3
		contextWindow: 131_000,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.40, output: 2.00 },
		supportsFIM: false,
		downloadable: { sizeGb: 'not-known' },
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'codestral-latest': {
		contextWindow: 256_000,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.30, output: 0.90 },
		supportsFIM: true,
		downloadable: { sizeGb: 13 },
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'magistral-medium-latest': {
		contextWindow: 256_000,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.30, output: 0.90 }, // TODO: check this
		supportsFIM: true,
		downloadable: { sizeGb: 13 },
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: { supportsReasoning: true, canIOReasoning: true, canTurnOffReasoning: false, openSourceThinkTags: ['<think>', '</think>'] },
	},
	'magistral-small-latest': {
		contextWindow: 40_000,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.30, output: 0.90 }, // TODO: check this
		supportsFIM: true,
		downloadable: { sizeGb: 13 },
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: { supportsReasoning: true, canIOReasoning: true, canTurnOffReasoning: false, openSourceThinkTags: ['<think>', '</think>'] },
	},
	'devstral-small-latest': { //https://openrouter.ai/mistralai/devstral-small:free
		contextWindow: 131_000,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0, output: 0 },
		supportsFIM: false,
		downloadable: { sizeGb: 14 }, //https://ollama.com/library/devstral
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'ministral-8b-latest': { // ollama 'mistral'
		contextWindow: 131_000,
		reservedOutputTokenSpace: 4_096,
		cost: { input: 0.10, output: 0.10 },
		supportsFIM: false,
		downloadable: { sizeGb: 4.1 },
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'ministral-3b-latest': {
		contextWindow: 131_000,
		reservedOutputTokenSpace: 4_096,
		cost: { input: 0.04, output: 0.04 },
		supportsFIM: false,
		downloadable: { sizeGb: 'not-known' },
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
} as const satisfies { [s: string]: VoidStaticModelInfo }

const mistralSettings: VoidStaticProviderInfo = {
	modelOptions: mistralModelOptions,
	modelOptionsFallback: (modelName) => { return null },
	providerReasoningIOSettings: {
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
	},
}


// ---------------- GROQ ----------------
const groqModelOptions = { // https://console.groq.com/docs/models, https://groq.com/pricing/
	'llama-3.3-70b-versatile': {
		contextWindow: 128_000,
		reservedOutputTokenSpace: 32_768, // 32_768,
		cost: { input: 0.59, output: 0.79 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'llama-3.1-8b-instant': {
		contextWindow: 128_000,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.05, output: 0.08 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'qwen-2.5-coder-32b': {
		contextWindow: 128_000,
		reservedOutputTokenSpace: null, // not specified?
		cost: { input: 0.79, output: 0.79 },
		downloadable: false,
		supportsFIM: false, // unfortunately looks like no FIM support on groq
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'qwen-qwq-32b': { // https://huggingface.co/Qwen/QwQ-32B
		contextWindow: 128_000,
		reservedOutputTokenSpace: null, // not specified?
		cost: { input: 0.29, output: 0.39 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: { supportsReasoning: true, canIOReasoning: true, canTurnOffReasoning: false, openSourceThinkTags: ['<think>', '</think>'] }, // we're using reasoning_format:parsed so really don't need to know openSourceThinkTags
	},
} as const satisfies { [s: string]: VoidStaticModelInfo }
const groqSettings: VoidStaticProviderInfo = {
	modelOptions: groqModelOptions,
	modelOptionsFallback: (modelName) => { return null },
	providerReasoningIOSettings: {
		// Must be set to either parsed or hidden when using tool calling https://console.groq.com/docs/reasoning
		input: {
			includeInPayload: (reasoningInfo) => {
				if (!reasoningInfo?.isReasoningEnabled) return null
				if (reasoningInfo.type === 'budget_slider_value') {
					return { reasoning_format: 'parsed' }
				}
				return null
			}
		},
		output: { nameOfFieldInDelta: 'reasoning' },
	},
}


// ---------------- GOOGLE VERTEX ----------------
const googleVertexModelOptions = {
} as const satisfies Record<string, VoidStaticModelInfo>
const googleVertexSettings: VoidStaticProviderInfo = {
	modelOptions: googleVertexModelOptions,
	modelOptionsFallback: (modelName) => { return null },
	providerReasoningIOSettings: {
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
	},
}

// ---------------- MICROSOFT AZURE ----------------
const microsoftAzureModelOptions = {
} as const satisfies Record<string, VoidStaticModelInfo>
const microsoftAzureSettings: VoidStaticProviderInfo = {
	modelOptions: microsoftAzureModelOptions,
	modelOptionsFallback: (modelName) => { return null },
	providerReasoningIOSettings: {
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
	},
}

// ---------------- AWS BEDROCK ----------------
const awsBedrockModelOptions = {
} as const satisfies Record<string, VoidStaticModelInfo>

const awsBedrockSettings: VoidStaticProviderInfo = {
	modelOptions: awsBedrockModelOptions,
	modelOptionsFallback: (modelName) => { return null },
	providerReasoningIOSettings: {
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
	},
}


// ---------------- VLLM, OLLAMA, OPENAICOMPAT (self-hosted / local) ----------------
const ollamaModelOptions = {
	'qwen2.5-coder:7b': {
		contextWindow: 32_000,
		reservedOutputTokenSpace: null,
		cost: { input: 0, output: 0 },
		downloadable: { sizeGb: 1.9 },
		supportsFIM: true,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'qwen2.5-coder:3b': {
		contextWindow: 32_000,
		reservedOutputTokenSpace: null,
		cost: { input: 0, output: 0 },
		downloadable: { sizeGb: 1.9 },
		supportsFIM: true,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'qwen2.5-coder:1.5b': {
		contextWindow: 32_000,
		reservedOutputTokenSpace: null,
		cost: { input: 0, output: 0 },
		downloadable: { sizeGb: .986 },
		supportsFIM: true,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'llama3.1': {
		contextWindow: 128_000,
		reservedOutputTokenSpace: null,
		cost: { input: 0, output: 0 },
		downloadable: { sizeGb: 4.9 },
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'qwen2.5-coder': {
		contextWindow: 128_000,
		reservedOutputTokenSpace: null,
		cost: { input: 0, output: 0 },
		downloadable: { sizeGb: 4.7 },
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'qwq': {
		contextWindow: 128_000,
		reservedOutputTokenSpace: 32_000,
		cost: { input: 0, output: 0 },
		downloadable: { sizeGb: 20 },
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: { supportsReasoning: true, canIOReasoning: false, canTurnOffReasoning: false, openSourceThinkTags: ['<think>', '</think>'] },
	},
	'deepseek-r1': {
		contextWindow: 128_000,
		reservedOutputTokenSpace: null,
		cost: { input: 0, output: 0 },
		downloadable: { sizeGb: 4.7 },
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: { supportsReasoning: true, canIOReasoning: false, canTurnOffReasoning: false, openSourceThinkTags: ['<think>', '</think>'] },
	},
	'devstral:latest': {
		contextWindow: 131_000,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0, output: 0 },
		downloadable: { sizeGb: 14 },
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},

} as const satisfies Record<string, VoidStaticModelInfo>

export const ollamaRecommendedModels = ['qwen2.5-coder:1.5b', 'llama3.1', 'qwq', 'deepseek-r1', 'devstral:latest'] as const satisfies (keyof typeof ollamaModelOptions)[]


const vLLMSettings: VoidStaticProviderInfo = {
	modelOptionsFallback: (modelName) => extensiveModelOptionsFallback(modelName, { downloadable: { sizeGb: 'not-known' } }),
	modelOptions: {},
	providerReasoningIOSettings: {
		// reasoning: OAICompat + response.choices[0].delta.reasoning_content // https://docs.vllm.ai/en/stable/features/reasoning_outputs.html#streaming-chat-completions
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
		output: { nameOfFieldInDelta: 'reasoning_content' },
	},
}

const lmStudioSettings: VoidStaticProviderInfo = {
	modelOptionsFallback: (modelName) => extensiveModelOptionsFallback(modelName, { downloadable: { sizeGb: 'not-known' }, contextWindow: 4_096 }),
	modelOptions: {},
	providerReasoningIOSettings: {
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
		output: { needsManualParse: true },
	},
}

const ollamaSettings: VoidStaticProviderInfo = {
	modelOptionsFallback: (modelName) => extensiveModelOptionsFallback(modelName, { downloadable: { sizeGb: 'not-known' } }),
	modelOptions: ollamaModelOptions,
	providerReasoningIOSettings: {
		// reasoning: we need to filter out reasoning <think> tags manually
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
		output: { needsManualParse: true },
	},
}

const openaiCompatible: VoidStaticProviderInfo = {
	modelOptionsFallback: (modelName) => extensiveModelOptionsFallback(modelName),
	modelOptions: {},
	providerReasoningIOSettings: {
		// reasoning: we have no idea what endpoint they used, so we can't consistently parse out reasoning
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
		output: { nameOfFieldInDelta: 'reasoning_content' },
	},
}

const liteLLMSettings: VoidStaticProviderInfo = { // https://docs.litellm.ai/docs/reasoning_content
	modelOptionsFallback: (modelName) => extensiveModelOptionsFallback(modelName, { downloadable: { sizeGb: 'not-known' } }),
	modelOptions: {},
	providerReasoningIOSettings: {
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
		output: { nameOfFieldInDelta: 'reasoning_content' },
	},
}


// ---------------- MINIMAX ----------------
// Vader addition, production-hardening provider expansion. Verified via the official
// platform.minimax.io docs (via search) + the MiniMax-AI GitHub org - see
// docs/integrations/providers/minimax.md for the full sourcing and confidence notes.
//
// Re-verified during the final production-readiness pass's provider re-validation: the M2.1/
// M2.5/M2.7(-highspeed) variants below were confirmed against a real, merged upstream Cline PR
// (cline/cline#10007) correcting all of them to a shared 204,800-token context window - the
// original Vader entries only listed M2/M2.1, missing the M2.5/M2.7 line entirely.
//
// MiniMax-M3 (a real, released flagship model - 2026-05/06, native multimodal) is DELIBERATELY
// still not given a static entry: live sources disagree on its context window even now (some
// report 1,048,576/~1M; at least one tracker reports a widely-used integration's built-in value
// of 512,000 as an open, acknowledged bug still being corrected upstream as of this writing) -
// asserting either number here as fact would be a guess dressed up as verified data. The
// `modelSupportsVision` regex below already recognizes "minimax-m3" by name so a user who adds
// it manually (Settings > custom model name) still gets correct vision detection; only the
// context-window/pricing static entry is withheld pending a source that isn't disputed.
const minimaxModelOptions = {
	'MiniMax-M2': {
		contextWindow: 204_800,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.30, output: 1.20 }, // approximate - check platform.minimax.io/docs/pricing for current rates
		supportsFIM: false,
		downloadable: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style', // native function calling (all three vendors document it) - without this, models fall back to XML-in-prompt tools
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: false, canIOReasoning: true },
	},
	'MiniMax-M2.1': {
		contextWindow: 204_800,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.30, output: 1.20 },
		supportsFIM: false,
		downloadable: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style', // native function calling (all three vendors document it) - without this, models fall back to XML-in-prompt tools
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: false, canIOReasoning: true },
	},
	'MiniMax-M2.1-lightning': {
		contextWindow: 204_800,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.30, output: 1.20 },
		supportsFIM: false,
		downloadable: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style', // native function calling (all three vendors document it) - without this, models fall back to XML-in-prompt tools
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: false, canIOReasoning: true },
	},
	'MiniMax-M2.5': {
		contextWindow: 204_800,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.30, output: 1.20 }, // approximate - check platform.minimax.io/docs/pricing for current rates
		supportsFIM: false,
		downloadable: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style', // native function calling (all three vendors document it) - without this, models fall back to XML-in-prompt tools
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: false, canIOReasoning: true },
	},
	'MiniMax-M2.5-highspeed': {
		contextWindow: 204_800,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.30, output: 1.20 },
		supportsFIM: false,
		downloadable: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style', // native function calling (all three vendors document it) - without this, models fall back to XML-in-prompt tools
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: false, canIOReasoning: true },
	},
	'MiniMax-M2.7': {
		contextWindow: 204_800,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.30, output: 1.20 }, // approximate - check platform.minimax.io/docs/pricing for current rates
		supportsFIM: false,
		downloadable: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style', // native function calling (all three vendors document it) - without this, models fall back to XML-in-prompt tools
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: false, canIOReasoning: true },
	},
	'MiniMax-M2.7-highspeed': {
		contextWindow: 204_800,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.30, output: 1.20 },
		supportsFIM: false,
		downloadable: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style', // native function calling (all three vendors document it) - without this, models fall back to XML-in-prompt tools
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: false, canIOReasoning: true },
	},
} as const satisfies { [s: string]: VoidStaticModelInfo }

const minimaxSettings: VoidStaticProviderInfo = {
	modelOptions: minimaxModelOptions,
	modelOptionsFallback: (modelName) => extensiveModelOptionsFallback(modelName),
	providerReasoningIOSettings: {
		// reasoning_content field on the hosted OpenAI-compatible API - same convention as deepseek
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
		output: { nameOfFieldInDelta: 'reasoning_content' },
	},
}


// ---------------- ALIBABA (Qwen via DashScope) ----------------
// Vader addition, production-hardening provider expansion. Uses DashScope's OpenAI-compatible
// mode (`/compatible-mode/v1`) - see docs/integrations/providers/alibaba.md. Model IDs below are
// the long-stable ones (qwen-max/plus/flash, qwq-plus); newer dated snapshots can be added by
// name in Settings without a code change (modelOptionsFallback covers them).
const alibabaModelOptions = {
	'qwen-max': {
		contextWindow: 32_768,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 1.60, output: 6.40 }, // approximate - check alibabacloud.com/help/en/model-studio/model-pricing for current, region-specific rates
		supportsFIM: false,
		downloadable: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style', // native function calling (all three vendors document it) - without this, models fall back to XML-in-prompt tools
		reasoningCapabilities: false,
	},
	'qwen-plus': {
		contextWindow: 131_072,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.40, output: 1.20 },
		supportsFIM: false,
		downloadable: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style', // native function calling (all three vendors document it) - without this, models fall back to XML-in-prompt tools
		reasoningCapabilities: false,
	},
	'qwen-flash': {
		contextWindow: 131_072,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.05, output: 0.40 },
		supportsFIM: false,
		downloadable: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style', // native function calling (all three vendors document it) - without this, models fall back to XML-in-prompt tools
		reasoningCapabilities: false,
	},
	'qwq-plus': {
		contextWindow: 131_072,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.40, output: 1.20 },
		supportsFIM: false,
		downloadable: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style', // native function calling (all three vendors document it) - without this, models fall back to XML-in-prompt tools
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: false, canIOReasoning: true },
	},
} as const satisfies { [s: string]: VoidStaticModelInfo }

const alibabaSettings: VoidStaticProviderInfo = {
	modelOptions: alibabaModelOptions,
	modelOptionsFallback: (modelName) => extensiveModelOptionsFallback(modelName),
	providerReasoningIOSettings: {
		// reasoning_content field (enable_thinking/thinking_budget go via additionalOpenAIPayload
		// on the model entry, not modeled generically here since they're per-model, non-standard
		// extra_body params on top of the OpenAI-compatible payload)
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
		output: { nameOfFieldInDelta: 'reasoning_content' },
	},
}


// ---------------- MOONSHOT (Kimi) ----------------
// Vader addition, production-hardening provider expansion - see
// docs/integrations/providers/moonshot.md and docs/integrations/dependency-audit.md's sibling
// provider re-validation. This provider's model catalog churns quickly - re-verified against
// live sources during the final production-readiness pass, which found the original
// `kimi-k2-thinking` entry had gone stale into a genuinely dead model id: the whole original
// kimi-k2 series (including -thinking) was retired on Moonshot's own direct API on 2026-05-25
// ("requests to them no longer succeed" per contemporary reporting) - a real defect fixed here,
// not just documented, since Vader's "moonshot" provider calls platform.moonshot.ai/
// platform.kimi.ai directly rather than through a proxy that might still serve the old id.
// Replaced with the three models actually current as of this pass: kimi-k3 (flagship, released
// 2026-07-16), kimi-k2.7-code (coding-focused), kimi-k2.6 (general-purpose, unchanged from
// before). Add newer ones by name in Settings.
const moonshotModelOptions = {
	'kimi-k3': {
		contextWindow: 1_048_576,
		reservedOutputTokenSpace: 16_384,
		cost: { input: 3.00, output: 15.00 }, // approximate - check platform.moonshot.ai for current rates
		supportsFIM: false,
		downloadable: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style', // native function calling (all three vendors document it) - without this, models fall back to XML-in-prompt tools
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: false, canIOReasoning: true },
	},
	'kimi-k2.7-code': {
		contextWindow: 262_144,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.95, output: 4.00, cache_read: 0.19 }, // approximate - check platform.moonshot.ai for current rates
		supportsFIM: false,
		downloadable: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style', // native function calling (all three vendors document it) - without this, models fall back to XML-in-prompt tools
		reasoningCapabilities: false,
	},
	'kimi-k2.6': {
		contextWindow: 262_144,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.60, output: 2.50 },
		supportsFIM: false,
		downloadable: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style', // native function calling (all three vendors document it) - without this, models fall back to XML-in-prompt tools
		reasoningCapabilities: false,
	},
} as const satisfies { [s: string]: VoidStaticModelInfo }

const moonshotSettings: VoidStaticProviderInfo = {
	modelOptions: moonshotModelOptions,
	modelOptionsFallback: (modelName) => extensiveModelOptionsFallback(modelName),
	providerReasoningIOSettings: {
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
		output: { nameOfFieldInDelta: 'reasoning_content' },
	},
}


// ---------------- OPENCODE ZEN ----------------
// Vader addition, production-hardening provider expansion - see
// docs/integrations/providers/opencode-zen.md. A pay-as-you-go gateway (opencode.ai/docs/zen)
// re-exposing many vendors' models; only its OpenAI-shaped chat/completions surface is reached
// here (the same subset "OpenCode Go" - a subscription-gated slice of the same infrastructure -
// also uses). The catalog is explicitly beta/volatile, so - like openAICompatible - there is no
// hardcoded model list; the user adds the exact model id shown in their Zen console.
const openCodeZenSettings: VoidStaticProviderInfo = {
	modelOptions: {},
	modelOptionsFallback: (modelName) => extensiveModelOptionsFallback(modelName),
	providerReasoningIOSettings: {
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
		output: { nameOfFieldInDelta: 'reasoning_content' },
	},
}


// ---------------- OPENROUTER ----------------
const openRouterModelOptions_assumingOpenAICompat = {
	'qwen/qwen3-235b-a22b': {
		contextWindow: 40_960,
		reservedOutputTokenSpace: null,
		cost: { input: .10, output: .10 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: { supportsReasoning: true, canIOReasoning: true, canTurnOffReasoning: false },
	},
	'microsoft/phi-4-reasoning-plus:free': { // a 14B model...
		contextWindow: 32_768,
		reservedOutputTokenSpace: null,
		cost: { input: 0, output: 0 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: { supportsReasoning: true, canIOReasoning: true, canTurnOffReasoning: false },
	},
	'mistralai/mistral-small-3.1-24b-instruct:free': {
		contextWindow: 128_000,
		reservedOutputTokenSpace: null,
		cost: { input: 0, output: 0 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'google/gemini-2.0-flash-lite-preview-02-05:free': {
		contextWindow: 1_048_576,
		reservedOutputTokenSpace: null,
		cost: { input: 0, output: 0 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'google/gemini-2.0-pro-exp-02-05:free': {
		contextWindow: 1_048_576,
		reservedOutputTokenSpace: null,
		cost: { input: 0, output: 0 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'google/gemini-2.0-flash-exp:free': {
		contextWindow: 1_048_576,
		reservedOutputTokenSpace: null,
		cost: { input: 0, output: 0 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'deepseek/deepseek-r1': {
		...openSourceModelOptions_assumingOAICompat.deepseekR1,
		contextWindow: 128_000,
		reservedOutputTokenSpace: null,
		cost: { input: 0.8, output: 2.4 },
		downloadable: false,
	},
	'anthropic/claude-opus-4': {
		contextWindow: 200_000,
		reservedOutputTokenSpace: null,
		cost: { input: 15.00, output: 75.00 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'anthropic/claude-sonnet-4': {
		contextWindow: 200_000,
		reservedOutputTokenSpace: null,
		cost: { input: 15.00, output: 75.00 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'anthropic/claude-3.7-sonnet:thinking': {
		contextWindow: 200_000,
		reservedOutputTokenSpace: null,
		cost: { input: 3.00, output: 15.00 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: { // same as anthropic, see above
			supportsReasoning: true,
			canTurnOffReasoning: false,
			canIOReasoning: true,
			reasoningReservedOutputTokenSpace: 8192,
			reasoningSlider: { type: 'budget_slider', min: 1024, max: 8192, default: 1024 }, // they recommend batching if max > 32_000.
		},
	},
	'anthropic/claude-3.7-sonnet': {
		contextWindow: 200_000,
		reservedOutputTokenSpace: null,
		cost: { input: 3.00, output: 15.00 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false, // stupidly, openrouter separates thinking from non-thinking
	},
	'anthropic/claude-3.5-sonnet': {
		contextWindow: 200_000,
		reservedOutputTokenSpace: null,
		cost: { input: 3.00, output: 15.00 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'mistralai/codestral-2501': {
		...openSourceModelOptions_assumingOAICompat.codestral,
		contextWindow: 256_000,
		reservedOutputTokenSpace: null,
		cost: { input: 0.3, output: 0.9 },
		downloadable: false,
		reasoningCapabilities: false,
	},
	'mistralai/devstral-small:free': {
		...openSourceModelOptions_assumingOAICompat.devstral,
		contextWindow: 130_000,
		reservedOutputTokenSpace: null,
		cost: { input: 0, output: 0 },
		downloadable: false,
		reasoningCapabilities: false,
	},
	'qwen/qwen-2.5-coder-32b-instruct': {
		...openSourceModelOptions_assumingOAICompat['qwen2.5coder'],
		contextWindow: 33_000,
		reservedOutputTokenSpace: null,
		cost: { input: 0.07, output: 0.16 },
		downloadable: false,
	},
	'qwen/qwq-32b': {
		...openSourceModelOptions_assumingOAICompat['qwq'],
		contextWindow: 33_000,
		reservedOutputTokenSpace: null,
		cost: { input: 0.07, output: 0.16 },
		downloadable: false,
	}
} as const satisfies { [s: string]: VoidStaticModelInfo }

const openRouterSettings: VoidStaticProviderInfo = {
	modelOptions: openRouterModelOptions_assumingOpenAICompat,
	modelOptionsFallback: (modelName) => {
		const res = extensiveModelOptionsFallback(modelName)
		// openRouter does not support gemini-style, use openai-style instead
		if (res?.specialToolFormat === 'gemini-style') {
			res.specialToolFormat = 'openai-style'
		}
		return res
	},
	providerReasoningIOSettings: {
		// reasoning: OAICompat + response.choices[0].delta.reasoning : payload should have {include_reasoning: true} https://openrouter.ai/announcements/reasoning-tokens-for-thinking-models
		input: {
			// https://openrouter.ai/docs/use-cases/reasoning-tokens
			includeInPayload: (reasoningInfo) => {
				if (!reasoningInfo?.isReasoningEnabled) return null

				if (reasoningInfo.type === 'budget_slider_value') {
					return {
						reasoning: {
							max_tokens: reasoningInfo.reasoningBudget
						}
					}
				}
				if (reasoningInfo.type === 'effort_slider_value')
					return {
						reasoning: {
							effort: reasoningInfo.reasoningEffort
						}
					}
				return null
			}
		},
		output: { nameOfFieldInDelta: 'reasoning' },
	},
}




// ---------------- model settings of everything above ----------------

// ---------------- model families: names newer than the table still get the right capabilities ----------------
// A model id the tables do not list (a brand-new release, or one only the live /models call returned) must not fall to the
// "unrecognised" default (32k window, XML tools). These map a name to the closest listed model of the same family; the model
// name that is sent to the API stays exactly what the user picked.
const _augment = (
	base: VoidStaticProviderInfo,
	generated: { [name: string]: VoidStaticModelInfo },
	family: (lowerName: string) => string | null,
	precedence: 'generated' | 'base' = 'generated',
): VoidStaticProviderInfo => ({
	...base,
	modelOptions: precedence === 'generated' ? { ...base.modelOptions, ...generated } : { ...generated, ...base.modelOptions },
	modelOptionsFallback: (modelName) => {
		const key = family(modelName.toLowerCase())
		if (key && generated[key]) { return { ...generated[key], modelName, recognizedModelName: key } }
		return base.modelOptionsFallback(modelName)
	},
})

export const familyOfAnthropicModel = (n: string): string | null => {
	if (!n.includes('claude')) return null
	if (/fable|mythos|claude-(opus|sonnet|haiku)-5/.test(n)) return 'claude-sonnet-5-5'
	if (/opus-4[-.][6-9]/.test(n)) return 'claude-opus-4-8'
	if (/haiku-4[-.]5/.test(n)) return 'claude-haiku-4-5'
	if (/(sonnet|opus)-4[-.][5-9]/.test(n)) return 'claude-sonnet-4-6'
	return null
}
const familyOfOpenAIModel = (n: string): string | null => {
	if (/^gpt-6/.test(n)) return 'gpt-6-luna'
	if (/^(gpt-5|chatgpt-)/.test(n)) return 'gpt-5.4-mini'
	if (/^o[3-9](-|$)/.test(n)) return 'o3'
	return null
}
const familyOfXAIModel = (n: string): string | null => /grok-code/.test(n) ? 'grok-code-fast-1' : /grok-[4-9]/.test(n) ? 'grok-4.7' : null
const familyOfGeminiModel = (n: string): string | null => {
	if (!n.includes('gemini')) return null
	const flash = n.includes('flash') || n.includes('lite')
	if (/gemini-([3-9]|flash-latest|pro-latest)/.test(n)) return flash ? 'gemini-3.8-flash' : 'gemini-3.1-pro-preview'
	if (n.includes('2.5') || n.includes('2-5')) return n.includes('lite') ? 'gemini-2.5-flash-lite' : flash ? 'gemini-2.5-flash' : 'gemini-2.5-pro'
	return null
}
const familyOfDeepseekModel = (n: string): string | null => /v4/.test(n) ? 'deepseek-v4-flash' : null
const familyOfMistralModel = (n: string): string | null => {
	if (n.includes('codestral')) return 'codestral-latest'
	if (n.includes('devstral')) return 'devstral-latest'
	if (n.includes('magistral')) return 'magistral-medium-latest'
	if (n.includes('ministral')) return 'ministral-8b-latest'
	if (/mistral|pixtral/.test(n)) return 'mistral-large-latest'
	return null
}
const familyOfGroqModel = (n: string): string | null => /gpt-oss-20b/.test(n) ? 'openai/gpt-oss-20b' : /gpt-oss/.test(n) ? 'openai/gpt-oss-120b' : /qwen3/.test(n) ? 'qwen/qwen3.8-27b' : null
const familyOfOpenRouterModel = (n: string): string | null => {
	if (n.startsWith('anthropic/')) {
		const k = familyOfAnthropicModel(n.slice('anthropic/'.length).replace(/\./g, '-'))
		return k === 'claude-sonnet-5-5' ? 'anthropic/claude-sonnet-5.5' : k === 'claude-opus-4-8' ? 'anthropic/claude-opus-5.5' : k === 'claude-haiku-4-5' ? 'anthropic/claude-haiku-4.5' : k === 'claude-sonnet-4-6' ? 'anthropic/claude-sonnet-5.5' : null
	}
	if (/^openai\/gpt-[56]/.test(n)) return 'openai/gpt-5.5'
	if (/^google\/gemini-[3-9]/.test(n)) return n.includes('pro') ? 'google/gemini-3.1-pro-preview' : 'google/gemini-3.8-flash'
	if (/^x-ai\/grok-[4-9]/.test(n)) return 'x-ai/grok-4.7'
	if (/^deepseek\/deepseek-v4/.test(n)) return 'deepseek/deepseek-v4-pro'
	if (/^moonshotai\/kimi-k[3-9]/.test(n)) return 'moonshotai/kimi-k3'
	if (/^qwen\/qwen3\.[5-9]/.test(n)) return 'qwen/qwen3.8-max'
	return null
}

const modelSettingsOfProvider: { [providerName in ProviderName]: VoidStaticProviderInfo } = {
	openAI: _augment(openAISettings, generatedOpenAIOptions, familyOfOpenAIModel),
	anthropic: _augment(anthropicSettings, generatedAnthropicOptions, familyOfAnthropicModel),
	xAI: _augment(xAISettings, generatedXAIOptions, familyOfXAIModel),
	gemini: _augment(geminiSettings, generatedGeminiOptions, familyOfGeminiModel),

	// open source models
	deepseek: _augment(deepseekSettings, generatedDeepseekOptions, familyOfDeepseekModel),
	groq: _augment(groqSettings, generatedGroqOptions, familyOfGroqModel),

	// open source models + providers (mixture of everything)
	openRouter: _augment(openRouterSettings, generatedOpenRouterOptions, familyOfOpenRouterModel),
	vLLM: vLLMSettings,
	ollama: ollamaSettings,
	openAICompatible: openaiCompatible,
	mistral: _augment(mistralSettings, generatedMistralOptions, familyOfMistralModel),

	liteLLM: liteLLMSettings,
	lmStudio: lmStudioSettings,

	googleVertex: googleVertexSettings,
	microsoftAzure: microsoftAzureSettings,
	awsBedrock: awsBedrockSettings,

	minimax: _augment(minimaxSettings, generatedMinimaxOptions, () => null, 'base'),
	alibaba: _augment(alibabaSettings, generatedAlibabaOptions, () => null, 'base'),
	moonshot: _augment(moonshotSettings, generatedMoonshotOptions, () => null, 'base'),
	openCodeZen: openCodeZenSettings,
} as const


// ---------------- exports ----------------

// returns the capabilities and the adjusted modelName if it was a fallback
export const getModelCapabilities = (
	providerName: ProviderName,
	modelName: string,
	overridesOfModel: OverridesOfModel | undefined
): VoidStaticModelInfo & (
	| { modelName: string; recognizedModelName: string; isUnrecognizedModel: false }
	| { modelName: string; recognizedModelName?: undefined; isUnrecognizedModel: true }
) => {

	const lowercaseModelName = modelName.toLowerCase()

	const { modelOptions, modelOptionsFallback } = modelSettingsOfProvider[providerName]

	// Get any override settings for this model
	const overrides = overridesOfModel?.[providerName]?.[modelName];

	// search model options object directly first
	for (const modelName_ in modelOptions) {
		const lowercaseModelName_ = modelName_.toLowerCase()
		if (lowercaseModelName === lowercaseModelName_) {
			return { ...modelOptions[modelName], ...overrides, modelName, recognizedModelName: modelName, isUnrecognizedModel: false };
		}
	}

	const result = modelOptionsFallback(modelName)
	if (result) {
		return { ...result, ...overrides, modelName: result.modelName, isUnrecognizedModel: false };
	}

	// Vader fix. A model name we do not recognise (a local model called "my-model", a fine-tune, a LiteLLM alias...)
	// used to get a 4k context window. Vader's agent prompt (tool descriptions, policy, instructions) is far larger than
	// that, so it was trimmed down to almost nothing - found by a live run: the model was offered only the first few
	// read-only tools, cut off mid-sentence, and could not edit files or run commands at all. 32k matches what every
	// recognised open-source family above is configured with. Ollama stays at 4k because that is its real default
	// num_ctx; if a server's real window is smaller the provider reports a context-length error, which is visible
	// and fixable in settings, unlike a silently crippled prompt.
	const contextWindow = providerName === 'ollama' ? defaultModelOptions.contextWindow : 32_000
	return { modelName, ...defaultModelOptions, contextWindow, ...overrides, isUnrecognizedModel: true };
}

// Vader addition, part of the real vision/multimodal pipeline (docs/integrations/model-router.md).
// Whether a model accepts image input, as a pattern-based, best-effort check over well-known
// model-name families - there is no per-model "supportsVision" field in this codebase's static
// model tables (VoidStaticModelInfo above) to read this from honestly, so this function is the
// single, documented source of truth instead of silently guessing in multiple places. Kept
// deliberately conservative: an unrecognized/local model name returns false unless it matches an
// explicit vision-model naming convention, so a non-vision-capable model is never handed an image
// by mistake (the caller in electron-main/llmMessage/sendLLMMessage.impl.ts's sendVisionQuery
// re-checks this same function immediately before making the network call, as the last gate
// before an image ever leaves the app).
export const modelSupportsVision = (providerName: ProviderName, modelName: string): boolean => {
	const m = modelName.toLowerCase()
	if (providerName === 'anthropic') {
		// every Claude 3+ model accepts images; Claude 1/2 did not and are no longer offered
		return /claude-(3|4|5|6|7|8|9)/.test(m) || m.includes('claude-3') || m.includes('claude-opus') || m.includes('claude-sonnet') || m.includes('claude-haiku')
	}
	if (providerName === 'openAI' || providerName === 'microsoftAzure' || providerName === 'openRouter' || providerName === 'liteLLM' || providerName === 'openAICompatible' || providerName === 'awsBedrock') {
		// gpt-4o/4.1/4.5/5*, o1/o3/o4 (not the text-only o1-mini early preview), Claude/Gemini
		// model names also routed through one of these (Bedrock/OpenRouter/OpenAI-compatible
		// proxies), and anything explicitly marketed as "vision"
		if (m.includes('gpt-3.5') || m.includes('o1-mini')) return false
		return /gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|^gpt-4-vision|4-vision|^o1(?!-mini)|^o3|^o4|claude-(3|4)|gemini-(1\.5|2|3)/.test(m) || m.includes('vision')
	}
	if (providerName === 'gemini' || providerName === 'googleVertex') {
		// Gemini 1.5+/2.0+/2.5+ are natively multimodal; the legacy text-only "gemini-pro" (1.0) is not
		return /gemini-(1\.5|2|3)/.test(m)
	}
	if (providerName === 'mistral') {
		return m.includes('pixtral')
	}
	if (providerName === 'minimax') {
		// MiniMax-M3/M3.1(-Flash-Preview) are documented multimodal (text/image/video); M2.x is text-only
		return /minimax-m3/i.test(m)
	}
	if (providerName === 'alibaba') {
		// the Qwen-VL family - qwen-max/plus/flash/qwq above are text-only
		return /-vl|vl-/.test(m)
	}
	if (providerName === 'moonshot') {
		// kimi-k3 and the k2.5/k2.6/k2.7 line are documented multimodal; kimi-k2-thinking is not
		return /kimi-k3|kimi-k2\.[567]/.test(m)
	}
	// local/self-hosted runtimes (ollama, vLLM, lmStudio, ...) and volatile-catalog gateways
	// (openCodeZen): only well-known open vision-model families, matched by their standard
	// naming convention
	return /llava|bakllava|moondream|pixtral|llama3\.2-vision|llama-3\.2-vision|qwen.*-vl|qwen2-vl|qwen2\.5-vl|vl-chat|minicpm-v|cogvlm|phi-3\.5-vision|phi-3-vision|kimi-k3|claude-(3|4)|gpt-4o|gemini-(1\.5|2|3)/.test(m)
}

// non-model settings
export const getProviderCapabilities = (providerName: ProviderName) => {
	const { providerReasoningIOSettings } = modelSettingsOfProvider[providerName]
	return { providerReasoningIOSettings }
}


export type SendableReasoningInfo = {
	type: 'budget_slider_value',
	isReasoningEnabled: true,
	reasoningBudget: number,
} | {
	type: 'effort_slider_value',
	isReasoningEnabled: true,
	reasoningEffort: string,
} | null



export const getIsReasoningEnabledState = (
	featureName: FeatureName,
	providerName: ProviderName,
	modelName: string,
	modelSelectionOptions: ModelSelectionOptions | undefined,
	overridesOfModel: OverridesOfModel | undefined,
) => {
	const { supportsReasoning, canTurnOffReasoning } = getModelCapabilities(providerName, modelName, overridesOfModel).reasoningCapabilities || {}
	if (!supportsReasoning) return false

	// default to enabled if can't turn off, or if the featureName is Chat.
	const defaultEnabledVal = featureName === 'Chat' || !canTurnOffReasoning

	const isReasoningEnabled = modelSelectionOptions?.reasoningEnabled ?? defaultEnabledVal
	return isReasoningEnabled
}


export const getReservedOutputTokenSpace = (providerName: ProviderName, modelName: string, opts: { isReasoningEnabled: boolean, overridesOfModel: OverridesOfModel | undefined }) => {
	const {
		reasoningCapabilities,
		reservedOutputTokenSpace,
	} = getModelCapabilities(providerName, modelName, opts.overridesOfModel)
	return opts.isReasoningEnabled && reasoningCapabilities ? reasoningCapabilities.reasoningReservedOutputTokenSpace : reservedOutputTokenSpace
}

// used to force reasoning state (complex) into something simple we can just read from when sending a message
export const getSendableReasoningInfo = (
	featureName: FeatureName,
	providerName: ProviderName,
	modelName: string,
	modelSelectionOptions: ModelSelectionOptions | undefined,
	overridesOfModel: OverridesOfModel | undefined,
): SendableReasoningInfo => {

	const { reasoningSlider: reasoningBudgetSlider } = getModelCapabilities(providerName, modelName, overridesOfModel).reasoningCapabilities || {}
	const isReasoningEnabled = getIsReasoningEnabledState(featureName, providerName, modelName, modelSelectionOptions, overridesOfModel)
	if (!isReasoningEnabled) return null

	// check for reasoning budget
	const reasoningBudget = reasoningBudgetSlider?.type === 'budget_slider' ? modelSelectionOptions?.reasoningBudget ?? reasoningBudgetSlider?.default : undefined
	if (reasoningBudget) {
		return { type: 'budget_slider_value', isReasoningEnabled: isReasoningEnabled, reasoningBudget: reasoningBudget }
	}

	// check for reasoning effort
	const reasoningEffort = reasoningBudgetSlider?.type === 'effort_slider' ? modelSelectionOptions?.reasoningEffort ?? reasoningBudgetSlider?.default : undefined
	if (reasoningEffort) {
		return { type: 'effort_slider_value', isReasoningEnabled: isReasoningEnabled, reasoningEffort: reasoningEffort }
	}

	return null
}
