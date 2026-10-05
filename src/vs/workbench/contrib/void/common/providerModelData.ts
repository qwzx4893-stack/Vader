/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// GENERATED - do not edit by hand. Regenerate with build/lib/vader/genProviderModelData.py - see docs/integrations/providers/README.md.
//
// Per-model facts for the models Vader offers by default, taken from the LiteLLM project's model catalog
// (BerriAI/litellm, litellm/model_prices_and_context_window_backup.json, commit a99bccace, 2026-10-05), the most widely used open-source
// registry of provider models. Provider documentation hosts are not reachable from the build environment, so this is the
// single source of these numbers, and a model Vader does not list here still works: once a working API key is entered the
// provider's own /models endpoint is queried (see electron-main/llmMessage/modelListing.ts) and name-family fallbacks in
// modelCapabilities.ts supply sane capabilities.
//
// ctx / out are tokens; cost is USD per million tokens. `reasoning` is the catalog's supports_reasoning flag.
// `adaptive` marks Anthropic models that only support adaptive thinking (no legacy budget_tokens parameter).

export type CuratedModelFacts = {
	ctx: number; out: number; tools: boolean; vision: boolean; reasoning: boolean; adaptive?: boolean;
	cost: { input: number; output: number; cache_read?: number };
}

export const curatedModelFacts: { [provider in string]: { [model: string]: CuratedModelFacts } } = {
	openAI: {
		'gpt-6.1-sol': { ctx: 922000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 2.0, output: 10.0, cache_read: 0.1 } },
		'gpt-6-astra': { ctx: 922000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 10.0, output: 50.0, cache_read: 1.0 } },
		'gpt-6-luna': { ctx: 922000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 0.1, output: 0.5, cache_read: 0.01 } },
		'gpt-5.5': { ctx: 1050000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 5.0, output: 30.0, cache_read: 0.5 } },
		'gpt-5.4': { ctx: 1050000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 2.5, output: 15.0, cache_read: 0.25 } },
		'gpt-5.4-mini': { ctx: 272000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 0.75, output: 4.5, cache_read: 0.075 } },
		'gpt-4.1': { ctx: 1047576, out: 32768, tools: true, vision: true, reasoning: false, cost: { input: 2.0, output: 8.0, cache_read: 0.5 } },
		'gpt-4.1-mini': { ctx: 1047576, out: 32768, tools: true, vision: true, reasoning: false, cost: { input: 0.4, output: 1.6, cache_read: 0.1 } },
		'o3': { ctx: 200000, out: 100000, tools: true, vision: true, reasoning: true, cost: { input: 2.0, output: 8.0, cache_read: 0.5 } },
	},
	anthropic: {
		'claude-fable-5-1': { ctx: 1000000, out: 128000, tools: true, vision: true, reasoning: true, adaptive: true, cost: { input: 10.0, output: 50.0, cache_read: 0.25 } },
		'claude-opus-5-5': { ctx: 1000000, out: 128000, tools: true, vision: true, reasoning: true, adaptive: true, cost: { input: 4.0, output: 20.0, cache_read: 0.2 } },
		'claude-sonnet-5-5': { ctx: 1000000, out: 128000, tools: true, vision: true, reasoning: true, adaptive: true, cost: { input: 2.0, output: 10.0, cache_read: 0.2 } },
		'claude-opus-4-8': { ctx: 1000000, out: 128000, tools: true, vision: true, reasoning: true, adaptive: true, cost: { input: 5.0, output: 25.0, cache_read: 0.5 } },
		'claude-sonnet-4-6': { ctx: 1000000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 3.0, output: 15.0, cache_read: 0.3 } },
		'claude-haiku-4-5': { ctx: 200000, out: 64000, tools: true, vision: true, reasoning: true, cost: { input: 1.0, output: 5.0, cache_read: 0.1 } },
	},
	gemini: {
		'gemini-pro-latest': { ctx: 1048576, out: 65536, tools: true, vision: true, reasoning: true, cost: { input: 2.0, output: 12.0, cache_read: 0.2 } },
		'gemini-flash-latest': { ctx: 1048576, out: 65536, tools: true, vision: true, reasoning: true, cost: { input: 0.75, output: 3.75, cache_read: 0.075 } },
		'gemini-3.1-pro-preview': { ctx: 1048576, out: 65536, tools: true, vision: true, reasoning: true, cost: { input: 2.0, output: 12.0, cache_read: 0.2 } },
		'gemini-3.8-flash': { ctx: 1048576, out: 65536, tools: true, vision: true, reasoning: true, cost: { input: 0.75, output: 3.75, cache_read: 0.075 } },
		'gemini-2.5-pro': { ctx: 1048576, out: 65536, tools: true, vision: true, reasoning: true, cost: { input: 1.25, output: 10.0, cache_read: 0.125 } },
		'gemini-2.5-flash': { ctx: 1048576, out: 65536, tools: true, vision: true, reasoning: true, cost: { input: 0.3, output: 2.5, cache_read: 0.03 } },
		'gemini-2.5-flash-lite': { ctx: 1048576, out: 65536, tools: true, vision: true, reasoning: true, cost: { input: 0.1, output: 0.4, cache_read: 0.01 } },
	},
	xAI: {
		'grok-4.7': { ctx: 500000, out: 500000, tools: true, vision: true, reasoning: true, cost: { input: 2.0, output: 6.0, cache_read: 0.5 } },
		'grok-4.6': { ctx: 500000, out: 500000, tools: true, vision: true, reasoning: true, cost: { input: 2.0, output: 6.0, cache_read: 0.5 } },
		'grok-4.5': { ctx: 500000, out: 500000, tools: true, vision: true, reasoning: true, cost: { input: 2.0, output: 6.0, cache_read: 0.3 } },
		'grok-4.3': { ctx: 1000000, out: 1000000, tools: true, vision: true, reasoning: true, cost: { input: 1.25, output: 2.5, cache_read: 0.2 } },
		'grok-code-fast-1': { ctx: 256000, out: 256000, tools: true, vision: true, reasoning: true, cost: { input: 1.0, output: 2.0, cache_read: 0.2 } },
	},
	groq: {
		'openai/gpt-oss-120b': { ctx: 131072, out: 65536, tools: true, vision: false, reasoning: true, cost: { input: 0.15, output: 0.6, cache_read: 0.075 } },
		'openai/gpt-oss-20b': { ctx: 131072, out: 65536, tools: true, vision: false, reasoning: true, cost: { input: 0.075, output: 0.3, cache_read: 0.0375 } },
		'qwen/qwen3.8-27b': { ctx: 131072, out: 16384, tools: true, vision: true, reasoning: true, cost: { input: 0.8, output: 4.0 } },
	},
	mistral: {
		'mistral-large-latest': { ctx: 262144, out: 262144, tools: true, vision: true, reasoning: false, cost: { input: 0.5, output: 1.5, cache_read: 0.05 } },
		'mistral-medium-latest': { ctx: 262144, out: 262144, tools: true, vision: true, reasoning: true, cost: { input: 1.5, output: 7.5, cache_read: 0.15 } },
		'mistral-small-latest': { ctx: 262144, out: 262144, tools: true, vision: true, reasoning: true, cost: { input: 0.15, output: 0.6, cache_read: 0.015 } },
		'codestral-latest': { ctx: 128000, out: 128000, tools: true, vision: false, reasoning: false, cost: { input: 0.3, output: 0.9, cache_read: 0.03 } },
		'devstral-latest': { ctx: 256000, out: 256000, tools: true, vision: false, reasoning: false, cost: { input: 0.4, output: 2.0, cache_read: 0.04 } },
		'magistral-medium-latest': { ctx: 262144, out: 262144, tools: true, vision: true, reasoning: true, cost: { input: 1.5, output: 7.5, cache_read: 0.15 } },
		'ministral-8b-latest': { ctx: 262144, out: 262144, tools: true, vision: true, reasoning: false, cost: { input: 0.15, output: 0.15, cache_read: 0.015 } },
	},
	deepseek: {
		'deepseek-v4-pro': { ctx: 1000000, out: 393216, tools: true, vision: false, reasoning: true, cost: { input: 1.32, output: 3.96, cache_read: 0.044 } },
		'deepseek-v4-flash': { ctx: 1000000, out: 393216, tools: true, vision: true, reasoning: true, cost: { input: 0.3, output: 1.2, cache_read: 0.006 } },
	},
	moonshot: {
		'kimi-k3': { ctx: 1048576, out: 1048576, tools: true, vision: true, reasoning: true, cost: { input: 3.0, output: 15.0, cache_read: 0.3 } },
		'kimi-k2.7-code': { ctx: 262144, out: 262144, tools: true, vision: true, reasoning: true, cost: { input: 0.95, output: 4.0, cache_read: 0.19 } },
		'kimi-k2.6': { ctx: 262144, out: 262144, tools: true, vision: true, reasoning: true, cost: { input: 0.95, output: 4.0, cache_read: 0.16 } },
	},
	minimax: {
		'MiniMax-M3': { ctx: 1000000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 0.3, output: 1.2, cache_read: 0.06 } },
	},
	alibaba: {
		'qwen3.8-max': { ctx: 991808, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 2.0, output: 6.0, cache_read: 0.25 } },
		'qwen3.8-flash': { ctx: 991808, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 0.15, output: 0.47, cache_read: 0.016 } },
		'qwen3.7-max': { ctx: 991808, out: 65536, tools: true, vision: false, reasoning: true, cost: { input: 2.5, output: 7.5, cache_read: 0.5 } },
		'qwen3-coder-plus': { ctx: 997952, out: 65536, tools: true, vision: false, reasoning: true, cost: { input: 0.0, output: 0.0 } },
		'qwen-plus': { ctx: 129024, out: 16384, tools: true, vision: false, reasoning: true, cost: { input: 0.4, output: 1.2 } },
		'qwq-plus': { ctx: 98304, out: 8192, tools: true, vision: false, reasoning: true, cost: { input: 0.8, output: 2.4 } },
	},
	openRouter: {
		'anthropic/claude-opus-5.5': { ctx: 1000000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 4.0, output: 20.0, cache_read: 0.2 } },
		'anthropic/claude-sonnet-5.5': { ctx: 1000000, out: 128000, tools: true, vision: true, reasoning: true, adaptive: true, cost: { input: 2.0, output: 10.0, cache_read: 0.2 } },
		'anthropic/claude-fable-5.1': { ctx: 1000000, out: 128000, tools: true, vision: true, reasoning: true, adaptive: true, cost: { input: 10.0, output: 50.0, cache_read: 0.25 } },
		'anthropic/claude-haiku-4.5': { ctx: 200000, out: 64000, tools: true, vision: true, reasoning: true, cost: { input: 1.0, output: 5.0, cache_read: 0.1 } },
		'openai/gpt-6.1-sol': { ctx: 1050000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 2.0, output: 10.0, cache_read: 0.1 } },
		'openai/gpt-5.5': { ctx: 1050000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 5.0, output: 30.0, cache_read: 0.5 } },
		'google/gemini-3.1-pro-preview': { ctx: 1048576, out: 65536, tools: true, vision: true, reasoning: true, cost: { input: 2.0, output: 12.0, cache_read: 0.2 } },
		'google/gemini-3.8-flash': { ctx: 1048576, out: 65536, tools: true, vision: true, reasoning: true, cost: { input: 0.75, output: 3.75, cache_read: 0.075 } },
		'deepseek/deepseek-v4-pro': { ctx: 1048576, out: 384000, tools: true, vision: false, reasoning: true, cost: { input: 0.2088, output: 0.4176, cache_read: 0.0174 } },
		'x-ai/grok-4.7': { ctx: 500000, out: 450000, tools: true, vision: true, reasoning: true, cost: { input: 2.0, output: 6.0, cache_read: 0.5 } },
		'qwen/qwen3.8-max': { ctx: 1000000, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 2.0, output: 6.0, cache_read: 0.25 } },
		'moonshotai/kimi-k3': { ctx: 1048576, out: 943718, tools: true, vision: true, reasoning: true, cost: { input: 0.72, output: 14.0, cache_read: 0.7 } },
	},
}

export const curatedModelNames = {
	openAI: ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-4.1", "gpt-4.1-mini", "o3"],
	anthropic: ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"],
	gemini: ["gemini-pro-latest", "gemini-flash-latest", "gemini-3.1-pro-preview", "gemini-3.8-flash", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
	xAI: ["grok-4.7", "grok-4.6", "grok-4.5", "grok-4.3", "grok-code-fast-1"],
	groq: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"],
	mistral: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "codestral-latest", "devstral-latest", "magistral-medium-latest", "ministral-8b-latest"],
	deepseek: ["deepseek-v4-pro", "deepseek-v4-flash"],
	moonshot: ["kimi-k3", "kimi-k2.7-code", "kimi-k2.6"],
	minimax: ["MiniMax-M3"],
	alibaba: ["qwen3.8-max", "qwen3.8-flash", "qwen3.7-max", "qwen3-coder-plus", "qwen-plus", "qwq-plus"],
	openRouter: ["anthropic/claude-opus-5.5", "anthropic/claude-sonnet-5.5", "anthropic/claude-fable-5.1", "anthropic/claude-haiku-4.5", "openai/gpt-6.1-sol", "openai/gpt-5.5", "google/gemini-3.1-pro-preview", "google/gemini-3.8-flash", "deepseek/deepseek-v4-pro", "x-ai/grok-4.7", "qwen/qwen3.8-max", "moonshotai/kimi-k3"],
} as const
