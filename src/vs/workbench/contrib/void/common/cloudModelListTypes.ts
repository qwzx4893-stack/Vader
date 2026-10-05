/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import type { ProviderName } from './voidSettingsTypes.js';

// Live model lists for hosted providers: once a provider has a working API key, Vader asks the provider which models that key can
// use and shows exactly those (instead of only the built-in defaults). See electron-main/llmMessage/modelListing.ts (the only place
// that makes these requests) and common/refreshModelService.ts (when they are made).

/** Hosted providers whose "list models" endpoint is queried. Azure/Vertex/Bedrock are deployment- or account-scoped and are not listed this way. */
export const cloudListedProviderNames = [
	'openAI', 'anthropic', 'gemini', 'xAI', 'groq', 'mistral', 'deepseek', 'openRouter',
	'moonshot', 'minimax', 'alibaba', 'openCodeZen',
] as const satisfies readonly ProviderName[]
export type CloudListedProviderName = typeof cloudListedProviderNames[number]
export const isCloudListedProvider = (p: string): p is CloudListedProviderName => (cloudListedProviderNames as readonly string[]).includes(p)

export type CloudModelListFailure = 'unauthorized' | 'rate-limited' | 'network' | 'http' | 'bad-response' | 'unsupported'

export type CloudModelListResult =
	| { ok: true; models: string[]; total: number } // `total` is how many the provider returned before non-chat models were filtered out
	| { ok: false; reason: CloudModelListFailure; message: string }

export type CloudListState =
	| { status: 'idle' }
	| { status: 'loading' }
	| { status: 'ok'; count: number }
	| { status: 'error'; reason: CloudModelListFailure; message: string }
