/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// disable foreign import complaints
/* eslint-disable */
import Anthropic from '@anthropic-ai/sdk';
import { withPromptCaching } from './anthropicCache.js';
import { Ollama } from 'ollama';
import OpenAI, { ClientOptions, AzureOpenAI } from 'openai';
import { MistralCore } from '@mistralai/mistralai/core.js';
import { fimComplete } from '@mistralai/mistralai/funcs/fimComplete.js';
import { Tool as GeminiTool, FunctionDeclaration, GoogleGenAI, ThinkingConfig, Schema, Type } from '@google/genai';
import { GoogleAuth } from 'google-auth-library'
/* eslint-enable */

import { AnthropicLLMChatMessage, GeminiLLMChatMessage, LLMChatMessage, LLMFIMMessage, ModelListParams, OllamaModelResponse, OnError, OnFinalMessage, OnText, RawToolCallObj, RawToolParamsObj } from '../../common/sendLLMMessageTypes.js';
import { ChatMode, displayInfoOfProviderName, ModelSelectionOptions, OverridesOfModel, ProviderName, SettingsOfProvider } from '../../common/voidSettingsTypes.js';
import { getSendableReasoningInfo, getModelCapabilities, getProviderCapabilities, defaultProviderSettings, getReservedOutputTokenSpace, modelSupportsVision } from '../../common/modelCapabilities.js';
import { extractReasoningWrapper, extractXMLToolsWrapper } from './extractGrammar.js';
import { availableTools, InternalToolInfo, requiredParamNames } from '../../common/prompt/prompts.js';
import { generateUuid } from '../../../../../base/common/uuid.js';

const getGoogleApiKey = async () => {
	// module‑level singleton
	const auth = new GoogleAuth({ scopes: `https://www.googleapis.com/auth/cloud-platform` });
	const key = await auth.getAccessToken()
	if (!key) throw new Error(`Google API failed to generate a key.`)
	return key
}




type InternalCommonMessageParams = {
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	providerName: ProviderName;
	settingsOfProvider: SettingsOfProvider;
	modelSelectionOptions: ModelSelectionOptions | undefined;
	overridesOfModel: OverridesOfModel | undefined;
	modelName: string;
	_setAborter: (aborter: () => void) => void;
}

type SendChatParams_Internal = InternalCommonMessageParams & {
	messages: LLMChatMessage[];
	separateSystemMessage: string | undefined;
	chatMode: ChatMode | null;
	mcpTools: InternalToolInfo[] | undefined;
}
type SendFIMParams_Internal = InternalCommonMessageParams & { messages: LLMFIMMessage; separateSystemMessage: string | undefined; }
export type ListParams_Internal<ModelResponse> = ModelListParams<ModelResponse>


// Values that end up inside a host name or URL path (a region, an Azure resource, a GCP project) come from settings; refuse
// anything that is not a plain label so a stray or tampered setting cannot redirect a request - and the API key with it - elsewhere.
const assertUrlLabel = (value: string, what: string, pattern: RegExp = /^[a-z0-9][a-z0-9-]{0,62}$/i) => {
	if (!pattern.test(value)) throw new Error(`Invalid ${what} "${value.slice(0, 40)}": use only letters, digits and "-".`)
	return value
}

const invalidApiKeyMessage = (providerName: ProviderName) => `Invalid ${displayInfoOfProviderName(providerName).title} API key.`

// ------------ OPENAI-COMPATIBLE (HELPERS) ------------



const parseHeadersJSON = (s: string | undefined): Record<string, string | null | undefined> | undefined => {
	if (!s) return undefined
	try {
		return JSON.parse(s)
	} catch (e) {
		throw new Error(`Error parsing OpenAI-Compatible headers: ${s} is not a valid JSON.`)
	}
}

const newOpenAICompatibleSDK = async ({ settingsOfProvider, providerName, includeInPayload }: { settingsOfProvider: SettingsOfProvider, providerName: ProviderName, includeInPayload?: { [s: string]: any } }) => {
	// NOTE: `includeInPayload` (reasoning effort / budget, provider-specific extras) used to be spread in here, i.e. into the
	// SDK's *client* options, where unknown keys are silently ignored - so none of it ever reached the request. It is part of the
	// request body and is now added where the request is built (see _sendOpenAICompatibleChat / _sendOpenAICompatibleFIM).
	void includeInPayload
	const commonPayloadOpts = {
		dangerouslyAllowBrowser: true,
	} satisfies ClientOptions
	if (providerName === 'openAI') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({ apiKey: thisConfig.apiKey, ...commonPayloadOpts })
	}
	else if (providerName === 'ollama') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({ baseURL: `${thisConfig.endpoint}/v1`, apiKey: 'noop', ...commonPayloadOpts })
	}
	else if (providerName === 'vLLM') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({ baseURL: `${thisConfig.endpoint}/v1`, apiKey: 'noop', ...commonPayloadOpts })
	}
	else if (providerName === 'liteLLM') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({ baseURL: `${thisConfig.endpoint}/v1`, apiKey: 'noop', ...commonPayloadOpts })
	}
	else if (providerName === 'lmStudio') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({ baseURL: `${thisConfig.endpoint}/v1`, apiKey: 'noop', ...commonPayloadOpts })
	}
	else if (providerName === 'openRouter') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({
			baseURL: 'https://openrouter.ai/api/v1',
			apiKey: thisConfig.apiKey,
			defaultHeaders: {
				'HTTP-Referer': 'https://github.com/qwzx4893-stack/Vader', // Optional, for including your app on openrouter.ai rankings.
				'X-Title': 'Vader', // Optional. Shows in rankings on openrouter.ai.
			},
			...commonPayloadOpts,
		})
	}
	else if (providerName === 'googleVertex') {
		// https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/call-vertex-using-openai-library
		const thisConfig = settingsOfProvider[providerName]
		const region = assertUrlLabel(thisConfig.region, 'Google Vertex region')
		const project = assertUrlLabel(thisConfig.project, 'Google Cloud project id', /^[a-z][a-z0-9-:.]{3,60}$/i)
		const baseURL = `https://${region}-aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/endpoints/${'openapi'}`
		const apiKey = await getGoogleApiKey()
		return new OpenAI({ baseURL: baseURL, apiKey: apiKey, ...commonPayloadOpts })
	}
	else if (providerName === 'microsoftAzure') {
		// https://learn.microsoft.com/en-us/rest/api/aifoundry/model-inference/get-chat-completions/get-chat-completions?view=rest-aifoundry-model-inference-2024-05-01-preview&tabs=HTTP
		//  https://github.com/openai/openai-node?tab=readme-ov-file#microsoft-azure-openai
		const thisConfig = settingsOfProvider[providerName]
		const endpoint = `https://${assertUrlLabel(thisConfig.project, 'Azure resource name')}.openai.azure.com/`;
		const apiVersion = thisConfig.azureApiVersion || '2025-04-01-preview';
		const options = { endpoint, apiKey: thisConfig.apiKey, apiVersion };
		return new AzureOpenAI({ ...options, ...commonPayloadOpts });
	}
	else if (providerName === 'awsBedrock') {
		/**
		  * Amazon Bedrock serves the OpenAI Chat Completions format natively, at
		  *   https://bedrock-runtime.<region>.amazonaws.com/openai/v1/chat/completions
		  * authenticated with a Bedrock API key sent as a bearer token (the same endpoint the LiteLLM project uses for its
		  * "bedrock/chat_completions/" route). It covers the model families AWS exposes there (gpt-oss, Grok and newer GPT models);
		  * other Bedrock models (Claude, Llama, ...) are only on the Converse API, which needs a gateway.
		  * An `endpoint` override keeps working for people who front Bedrock with LiteLLM or Bedrock-Access-Gateway:
		  *   • LiteLLM default → http://localhost:4000/v1
		  *   • Bedrock-Access-Gateway → https://<api-id>.execute-api.<region>.amazonaws.com/openai/
		  */
		const { endpoint, apiKey, region } = settingsOfProvider.awsBedrock

		let baseURL = endpoint || `https://bedrock-runtime.${assertUrlLabel(region, 'AWS region')}.amazonaws.com/openai/v1`

		// Normalize: make sure we end with "/v1"
		if (!baseURL.endsWith('/v1'))
			baseURL = baseURL.replace(/\/+$/, '') + '/v1'

		return new OpenAI({ baseURL, apiKey, ...commonPayloadOpts })
	}


	else if (providerName === 'deepseek') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({ baseURL: 'https://api.deepseek.com/v1', apiKey: thisConfig.apiKey, ...commonPayloadOpts })
	}
	else if (providerName === 'openAICompatible') {
		const thisConfig = settingsOfProvider[providerName]
		const headers = parseHeadersJSON(thisConfig.headersJSON)
		return new OpenAI({ baseURL: thisConfig.endpoint, apiKey: thisConfig.apiKey, defaultHeaders: headers, ...commonPayloadOpts })
	}
	else if (providerName === 'groq') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({ baseURL: 'https://api.groq.com/openai/v1', apiKey: thisConfig.apiKey, ...commonPayloadOpts })
	}
	else if (providerName === 'xAI') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({ baseURL: 'https://api.x.ai/v1', apiKey: thisConfig.apiKey, ...commonPayloadOpts })
	}
	else if (providerName === 'mistral') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({ baseURL: 'https://api.mistral.ai/v1', apiKey: thisConfig.apiKey, ...commonPayloadOpts })
	}
	// Vader addition, production-hardening provider expansion - all four are OpenAI-compatible-
	// mode endpoints with a user-editable region/endpoint setting (see modelCapabilities.ts's
	// defaultProviderSettings and docs/integrations/providers/ for sourcing).
	else if (providerName === 'minimax' || providerName === 'alibaba' || providerName === 'moonshot' || providerName === 'openCodeZen') {
		const thisConfig = settingsOfProvider[providerName]
		const baseURL = thisConfig.endpoint.replace(/\/+$/, '')
		return new OpenAI({ baseURL, apiKey: thisConfig.apiKey, ...commonPayloadOpts })
	}

	else throw new Error(`Vader providerName was invalid: ${providerName}.`)
}


const _sendOpenAICompatibleFIM = async ({ messages: { prefix, suffix, stopTokens }, onFinalMessage, onError, settingsOfProvider, modelName: modelName_, _setAborter, providerName, overridesOfModel }: SendFIMParams_Internal) => {

	const {
		modelName,
		supportsFIM,
		additionalOpenAIPayload,
	} = getModelCapabilities(providerName, modelName_, overridesOfModel)

	if (!supportsFIM) {
		if (modelName === modelName_)
			onError({ message: `Model ${modelName} does not support FIM.`, fullError: null })
		else
			onError({ message: `Model ${modelName_} (${modelName}) does not support FIM.`, fullError: null })
		return
	}

	const openai = await newOpenAICompatibleSDK({ providerName, settingsOfProvider, includeInPayload: additionalOpenAIPayload })
	// Vader fix, found in the same production-readiness pass as _sendOpenAICompatibleChat's
	// aborter fix above: this FIM/autocomplete call never wired up _setAborter at all, so a
	// pending autocomplete request could never actually be cancelled (e.g. on a fast-typing
	// user moving on before the request resolves) - only ever ending via the SDK's own 10-minute
	// default timeout.
	const abortController = new AbortController()
	_setAborter(() => abortController.abort())
	openai.completions
		.create({
			model: modelName,
			prompt: prefix,
			suffix: suffix,
			stop: stopTokens,
			max_tokens: 300,
			...additionalOpenAIPayload,
		}, { signal: abortController.signal })
		.then(async response => {
			const fullText = response.choices[0]?.text
			onFinalMessage({ fullText, fullReasoning: '', anthropicReasoning: null });
		})
		.catch(error => {
			if (error instanceof OpenAI.APIError && error.status === 401) { onError({ message: invalidApiKeyMessage(providerName), fullError: error }); }
			else { onError({ message: error + '', fullError: error }); }
		})
}


const toOpenAICompatibleTool = (toolInfo: InternalToolInfo) => {
	const { name, description, params } = toolInfo

	const paramsWithType: { [s: string]: { description: string; type: 'string' } } = {}
	for (const key in params) { paramsWithType[key] = { ...params[key], type: 'string' } }

	return {
		type: 'function',
		function: {
			name: name,
			// strict: true, // strict mode - https://platform.openai.com/docs/guides/function-calling?api-mode=chat
			description: description,
			parameters: {
				type: 'object',
				// the typed copy: `properties: params` sent every parameter without a `type`, although the typed copy above was built for exactly this
				properties: paramsWithType,
				...(requiredParamNames(toolInfo).length ? { required: requiredParamNames(toolInfo) } : {}),
				// additionalProperties: false, // only valid together with strict mode, where every parameter must be required
			},
		}
	} satisfies OpenAI.Chat.Completions.ChatCompletionTool
}

const openAITools = (chatMode: ChatMode | null, mcpTools: InternalToolInfo[] | undefined) => {
	const allowedTools = availableTools(chatMode, mcpTools)
	if (!allowedTools || Object.keys(allowedTools).length === 0) return null

	const openAITools: OpenAI.Chat.Completions.ChatCompletionTool[] = []
	for (const t in allowedTools ?? {}) {
		openAITools.push(toOpenAICompatibleTool(allowedTools[t]))
	}
	return openAITools
}


// convert LLM tool call to our tool format
const rawToolCallObjOfParamsStr = (name: string, toolParamsStr: string, id: string): RawToolCallObj | null => {
	// Arguments that are not a JSON object (cut off by the output limit, unescaped quotes, prose instead of JSON) used to make the whole call
	// disappear: the turn ended with an empty message, nothing was shown and the model was never told. The call is kept, with the text as received,
	// so the agent loop answers it with an error result the model can act on.
	if (!toolParamsStr.trim()) return { id, name, rawParams: {}, doneParams: [], isDone: true } // a tool without parameters
	let input: unknown
	try { input = JSON.parse(toolParamsStr) }
	catch (e) { return { id, name, rawParams: {}, doneParams: [], isDone: true, rawInputText: toolParamsStr } }

	if (input === null || typeof input !== 'object' || Array.isArray(input)) return { id, name, rawParams: {}, doneParams: [], isDone: true, rawInputText: toolParamsStr }

	const rawParams: RawToolParamsObj = input
	return { id, name, rawParams, doneParams: Object.keys(rawParams), isDone: true }
}


const rawToolCallObjOfAnthropicParams = (toolBlock: Anthropic.Messages.ToolUseBlock): RawToolCallObj | null => {
	const { id, name, input } = toolBlock

	if (input === null) return null
	if (typeof input !== 'object') return null

	const rawParams: RawToolParamsObj = input
	return { id, name, rawParams, doneParams: Object.keys(rawParams), isDone: true }
}


// ------------ OPENAI-COMPATIBLE ------------


const _sendOpenAICompatibleChat = async ({ messages, onText, onFinalMessage, onError, settingsOfProvider, modelSelectionOptions, modelName: modelName_, _setAborter, providerName, chatMode, separateSystemMessage, overridesOfModel, mcpTools }: SendChatParams_Internal) => {
	const {
		modelName,
		specialToolFormat,
		reasoningCapabilities,
		additionalOpenAIPayload,
	} = getModelCapabilities(providerName, modelName_, overridesOfModel)

	const { providerReasoningIOSettings } = getProviderCapabilities(providerName)

	// reasoning
	const { canIOReasoning, openSourceThinkTags } = reasoningCapabilities || {}
	const reasoningInfo = getSendableReasoningInfo('Chat', providerName, modelName_, modelSelectionOptions, overridesOfModel) // user's modelName_ here

	const includeInPayload = {
		...providerReasoningIOSettings?.input?.includeInPayload?.(reasoningInfo),
		...additionalOpenAIPayload
	}

	// tools
	const potentialTools = openAITools(chatMode, mcpTools)
	const nativeToolsObj = potentialTools && specialToolFormat === 'openai-style' ?
		{ tools: potentialTools } as const
		: {}

	// instance
	const openai: OpenAI = await newOpenAICompatibleSDK({ providerName, settingsOfProvider, includeInPayload })
	if (providerName === 'microsoftAzure') {
		// Required to select the model
		(openai as AzureOpenAI).deploymentName = modelName;
	}
	const options: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
		model: modelName,
		messages: messages as any,
		stream: true,
		...nativeToolsObj,
		...includeInPayload, // reasoning effort / budget for this model + the model's additional payload
		// max_completion_tokens: maxTokens,
	}

	// Vader fix, found in a production-readiness fault-injection test: _setAborter used to be
	// wired up only inside the .then(response => ...) callback below, i.e. only after
	// openai.chat.completions.create()'s underlying fetch had already resolved (received
	// response headers). A provider that accepts the TCP connection but never sends a response
	// at all left cancellation completely inert - calling the stored aborter did nothing, since
	// it was never set, and the request could only ever end via the SDK's own 10-minute default
	// timeout. Creating the AbortController up front and wiring _setAborter to it immediately
	// (before the request is even sent), then passing it as the request's own signal, means a
	// cancellation reaches the in-flight request the same way regardless of whether headers have
	// arrived yet - verified with productionSimE2E.mjs's 'hang' scenario.
	const abortController = new AbortController()
	_setAborter(() => abortController.abort())

	// open source models - manually parse think tokens
	const { needsManualParse: needsManualReasoningParse, nameOfFieldInDelta: nameOfReasoningFieldInDelta } = providerReasoningIOSettings?.output ?? {}
	const manuallyParseReasoning = needsManualReasoningParse && canIOReasoning && openSourceThinkTags
	if (manuallyParseReasoning) {
		const { newOnText, newOnFinalMessage } = extractReasoningWrapper(onText, onFinalMessage, openSourceThinkTags)
		onText = newOnText
		onFinalMessage = newOnFinalMessage
	}

	// manually parse out tool results if XML
	if (!specialToolFormat) {
		const { newOnText, newOnFinalMessage } = extractXMLToolsWrapper(onText, onFinalMessage, chatMode, mcpTools)
		onText = newOnText
		onFinalMessage = newOnFinalMessage
	}

	let fullReasoningSoFar = ''
	let fullTextSoFar = ''

	// Vader: accumulate EVERY tool call index the provider streams, not just index 0 - a
	// model asking for N tools in one turn used to silently have N-1 of them dropped here.
	// `toolName`/`toolId` (index 0's accumulator) are kept as their own variables just for
	// the live-progress onText callback below (which only ever shows one in-progress call,
	// and only needs the name/id, not the raw params) - the real per-index data used to
	// build the final tool calls lives in toolCallsByIndex.
	let toolName = ''
	let toolId = ''
	const toolCallsByIndex = new Map<number, { name: string, id: string, paramsStr: string }>()

	openai.chat.completions
		.create(options, { signal: abortController.signal })
		.then(async response => {
			// when receive text
			for await (const chunk of response) {
				// message
				const newText = chunk.choices[0]?.delta?.content ?? ''
				fullTextSoFar += newText

				// tool call(s)
				for (const tool of chunk.choices[0]?.delta?.tool_calls ?? []) {
					const index = tool.index ?? 0
					const acc = toolCallsByIndex.get(index) ?? { name: '', id: '', paramsStr: '' }
					acc.name += tool.function?.name ?? ''
					acc.paramsStr += tool.function?.arguments ?? ''
					acc.id += tool.id ?? ''
					toolCallsByIndex.set(index, acc)

					if (index === 0) {
						toolName = acc.name
						toolId = acc.id
					}
				}


				// reasoning
				let newReasoning = ''
				if (nameOfReasoningFieldInDelta) {
					// @ts-ignore
					newReasoning = (chunk.choices[0]?.delta?.[nameOfReasoningFieldInDelta] || '') + ''
					fullReasoningSoFar += newReasoning
				}

				// call onText
				onText({
					fullText: fullTextSoFar,
					fullReasoning: fullReasoningSoFar,
					toolCall: !toolName ? undefined : { name: toolName, rawParams: {}, isDone: false, doneParams: [], id: toolId },
				})

			}
			// on final
			if (!fullTextSoFar && !fullReasoningSoFar && toolCallsByIndex.size === 0) {
				onError({ message: 'Vader: Response from model was empty.', fullError: null })
			}
			else {
				const toolCalls = [...toolCallsByIndex.values()]
					.map(({ name, id, paramsStr }) => rawToolCallObjOfParamsStr(name, paramsStr, id))
					.filter((t): t is RawToolCallObj => t !== null)
				onFinalMessage({ fullText: fullTextSoFar, fullReasoning: fullReasoningSoFar, anthropicReasoning: null, toolCalls: toolCalls.length ? toolCalls : undefined });
			}
		})
		// when error/fail - this catches errors of both .create() and .then(for await)
		.catch(error => {
			if (error instanceof OpenAI.APIError && error.status === 401) { onError({ message: invalidApiKeyMessage(providerName), fullError: error }); }
			else { onError({ message: error + '', fullError: error }); }
		})
}



type OpenAIModel = {
	id: string;
	created: number;
	object: 'model';
	owned_by: string;
}
const _openaiCompatibleList = async ({ onSuccess: onSuccess_, onError: onError_, settingsOfProvider, providerName }: ListParams_Internal<OpenAIModel>) => {
	const onSuccess = ({ models }: { models: OpenAIModel[] }) => {
		onSuccess_({ models })
	}
	const onError = ({ error }: { error: string }) => {
		onError_({ error })
	}
	try {
		const openai = await newOpenAICompatibleSDK({ providerName, settingsOfProvider })
		openai.models.list()
			.then(async (response) => {
				const models: OpenAIModel[] = []
				models.push(...response.data)
				while (response.hasNextPage()) {
					models.push(...(await response.getNextPage()).data)
				}
				onSuccess({ models })
			})
			.catch((error) => {
				onError({ error: error + '' })
			})
	}
	catch (error) {
		onError({ error: error + '' })
	}
}




// ------------ ANTHROPIC (HELPERS) ------------
const toAnthropicTool = (toolInfo: InternalToolInfo) => {
	const { name, description, params } = toolInfo
	const paramsWithType: { [s: string]: { description: string; type: 'string' } } = {}
	for (const key in params) { paramsWithType[key] = { ...params[key], type: 'string' } }
	return {
		name: name,
		description: description,
		input_schema: {
			type: 'object',
			properties: paramsWithType,
			...(requiredParamNames(toolInfo).length ? { required: requiredParamNames(toolInfo) } : {}),
		},
	} satisfies Anthropic.Messages.Tool
}

const anthropicTools = (chatMode: ChatMode | null, mcpTools: InternalToolInfo[] | undefined) => {
	const allowedTools = availableTools(chatMode, mcpTools)
	if (!allowedTools || Object.keys(allowedTools).length === 0) return null

	const anthropicTools: Anthropic.Messages.ToolUnion[] = []
	for (const t in allowedTools ?? {}) {
		anthropicTools.push(toAnthropicTool(allowedTools[t]))
	}
	return anthropicTools
}



// ------------ ANTHROPIC ------------
const sendAnthropicChat = async ({ messages, providerName, onText, onFinalMessage, onError, settingsOfProvider, modelSelectionOptions, overridesOfModel, modelName: modelName_, _setAborter, separateSystemMessage, chatMode, mcpTools }: SendChatParams_Internal) => {
	const {
		modelName,
		specialToolFormat,
	} = getModelCapabilities(providerName, modelName_, overridesOfModel)

	const thisConfig = settingsOfProvider.anthropic
	const { providerReasoningIOSettings } = getProviderCapabilities(providerName)

	// reasoning
	const reasoningInfo = getSendableReasoningInfo('Chat', providerName, modelName_, modelSelectionOptions, overridesOfModel) // user's modelName_ here
	const includeInPayload = providerReasoningIOSettings?.input?.includeInPayload?.(reasoningInfo) || {}

	// anthropic-specific - max tokens
	const maxTokens = getReservedOutputTokenSpace(providerName, modelName_, { isReasoningEnabled: !!reasoningInfo?.isReasoningEnabled, overridesOfModel })

	// tools
	const potentialTools = anthropicTools(chatMode, mcpTools)
	const nativeToolsObj = potentialTools && specialToolFormat === 'anthropic-style' ?
		{ tools: potentialTools, tool_choice: { type: 'auto' } } as const
		: {}


	// instance
	const anthropic = new Anthropic({
		apiKey: thisConfig.apiKey,
		dangerouslyAllowBrowser: true
	});

	// cache markers on the stable prefixes (tools, system prompt, conversation so far): see anthropicCache.ts
	const cached = withPromptCaching({ system: separateSystemMessage, messages: messages as AnthropicLLMChatMessage[] & { role: string, content: any }[], tools: potentialTools && specialToolFormat === 'anthropic-style' ? potentialTools as unknown as { [k: string]: unknown }[] : undefined })
	const cachedNativeToolsObj = cached.tools ? { tools: cached.tools, tool_choice: { type: 'auto' } } as const : nativeToolsObj

	const stream = anthropic.messages.stream({
		system: (cached.system ?? undefined) as any,
		messages: cached.messages as unknown as AnthropicLLMChatMessage[],
		model: modelName,
		max_tokens: maxTokens ?? 4_096, // anthropic requires this
		...includeInPayload,
		...(cachedNativeToolsObj as any),

	})

	// manually parse out tool results if XML
	if (!specialToolFormat) {
		const { newOnText, newOnFinalMessage } = extractXMLToolsWrapper(onText, onFinalMessage, chatMode, mcpTools)
		onText = newOnText
		onFinalMessage = newOnFinalMessage
	}

	// when receive text
	let fullText = ''
	let fullReasoning = ''

	let fullToolName = ''
	let fullToolParams = ''


	const runOnText = () => {
		onText({
			fullText,
			fullReasoning,
			toolCall: !fullToolName ? undefined : { name: fullToolName, rawParams: {}, isDone: false, doneParams: [], id: 'dummy' },
		})
	}
	// there are no events for tool_use, it comes in at the end
	stream.on('streamEvent', e => {
		// start block
		if (e.type === 'content_block_start') {
			if (e.content_block.type === 'text') {
				if (fullText) fullText += '\n\n' // starting a 2nd text block
				fullText += e.content_block.text
				runOnText()
			}
			else if (e.content_block.type === 'thinking') {
				if (fullReasoning) fullReasoning += '\n\n' // starting a 2nd reasoning block
				fullReasoning += e.content_block.thinking
				runOnText()
			}
			else if (e.content_block.type === 'redacted_thinking') {
				console.log('delta', e.content_block.type)
				if (fullReasoning) fullReasoning += '\n\n' // starting a 2nd reasoning block
				fullReasoning += '[redacted_thinking]'
				runOnText()
			}
			else if (e.content_block.type === 'tool_use') {
				fullToolName += e.content_block.name ?? '' // anthropic gives us the tool name in the start block
				runOnText()
			}
		}

		// delta
		else if (e.type === 'content_block_delta') {
			if (e.delta.type === 'text_delta') {
				fullText += e.delta.text
				runOnText()
			}
			else if (e.delta.type === 'thinking_delta') {
				fullReasoning += e.delta.thinking
				runOnText()
			}
			else if (e.delta.type === 'input_json_delta') { // tool use
				fullToolParams += e.delta.partial_json ?? '' // anthropic gives us the partial delta (string) here - https://docs.anthropic.com/en/api/messages-streaming
				runOnText()
			}
		}
	})

	// on done - (or when error/fail) - this is called AFTER last streamEvent
	stream.on('finalMessage', (response) => {
		const anthropicReasoning = response.content.filter(c => c.type === 'thinking' || c.type === 'redacted_thinking')
		// Vader: take every tool_use block Anthropic returns, not just the first - Anthropic
		// natively supports multiple tool calls in one response when a model wants them.
		const tools = response.content.filter(c => c.type === 'tool_use')
		const toolCalls = tools.map(rawToolCallObjOfAnthropicParams).filter((t): t is RawToolCallObj => t !== null)

		onFinalMessage({ fullText, fullReasoning, anthropicReasoning, toolCalls: toolCalls.length ? toolCalls : undefined })
	})
	// on error
	stream.on('error', (error) => {
		if (error instanceof Anthropic.APIError && error.status === 401) { onError({ message: invalidApiKeyMessage(providerName), fullError: error }) }
		else { onError({ message: error + '', fullError: error }) }
	})
	_setAborter(() => stream.controller.abort())
}



// ------------ MISTRAL ------------
// https://docs.mistral.ai/api/#tag/fim
const sendMistralFIM = ({ messages, onFinalMessage, onError, settingsOfProvider, overridesOfModel, modelName: modelName_, _setAborter, providerName }: SendFIMParams_Internal) => {
	const { modelName, supportsFIM } = getModelCapabilities(providerName, modelName_, overridesOfModel)
	if (!supportsFIM) {
		if (modelName === modelName_)
			onError({ message: `Model ${modelName} does not support FIM.`, fullError: null })
		else
			onError({ message: `Model ${modelName_} (${modelName}) does not support FIM.`, fullError: null })
		return
	}

	const mistral = new MistralCore({ apiKey: settingsOfProvider.mistral.apiKey })
	fimComplete(mistral,
		{
			model: modelName,
			prompt: messages.prefix,
			suffix: messages.suffix,
			stream: false,
			maxTokens: 300,
			stop: messages.stopTokens,
		})
		.then(async response => {

			// unfortunately, _setAborter() does not exist
			let content = response?.ok ? response.value.choices?.[0]?.message?.content ?? '' : '';
			const fullText = typeof content === 'string' ? content
				: content.map(chunk => (chunk.type === 'text' ? chunk.text : '')).join('')

			onFinalMessage({ fullText, fullReasoning: '', anthropicReasoning: null });
		})
		.catch(error => {
			onError({ message: error + '', fullError: error });
		})
}


// ------------ OLLAMA ------------
const newOllamaSDK = ({ endpoint }: { endpoint: string }) => {
	// if endpoint is empty, normally ollama will send to 11434, but we want it to fail - the user should type it in
	if (!endpoint) throw new Error(`Ollama Endpoint was empty (please enter ${defaultProviderSettings.ollama.endpoint} in Vader if you want the default url).`)
	const ollama = new Ollama({ host: endpoint })
	return ollama
}

const ollamaList = async ({ onSuccess: onSuccess_, onError: onError_, settingsOfProvider }: ListParams_Internal<OllamaModelResponse>) => {
	const onSuccess = ({ models }: { models: OllamaModelResponse[] }) => {
		onSuccess_({ models })
	}
	const onError = ({ error }: { error: string }) => {
		onError_({ error })
	}
	try {
		const thisConfig = settingsOfProvider.ollama
		const ollama = newOllamaSDK({ endpoint: thisConfig.endpoint })
		ollama.list()
			.then((response) => {
				const { models } = response
				onSuccess({ models })
			})
			.catch((error) => {
				onError({ error: error + '' })
			})
	}
	catch (error) {
		onError({ error: error + '' })
	}
}

const sendOllamaFIM = ({ messages, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter }: SendFIMParams_Internal) => {
	const thisConfig = settingsOfProvider.ollama
	const ollama = newOllamaSDK({ endpoint: thisConfig.endpoint })

	let fullText = ''
	ollama.generate({
		model: modelName,
		prompt: messages.prefix,
		suffix: messages.suffix,
		options: {
			stop: messages.stopTokens,
			num_predict: 300, // max tokens
			// repeat_penalty: 1,
		},
		raw: true,
		stream: true, // stream is not necessary but lets us expose the
	})
		.then(async stream => {
			_setAborter(() => stream.abort())
			for await (const chunk of stream) {
				const newText = chunk.response
				fullText += newText
			}
			onFinalMessage({ fullText, fullReasoning: '', anthropicReasoning: null })
		})
		// when error/fail
		.catch((error) => {
			onError({ message: error + '', fullError: error })
		})
}

// ---------------- GEMINI NATIVE IMPLEMENTATION ----------------

const toGeminiFunctionDecl = (toolInfo: InternalToolInfo) => {
	const { name, description, params } = toolInfo
	return {
		name,
		description,
		parameters: {
			type: Type.OBJECT,
			properties: Object.entries(params).reduce((acc, [key, value]) => {
				acc[key] = {
					type: Type.STRING,
					description: value.description
				};
				return acc;
			}, {} as Record<string, Schema>),
			...(requiredParamNames(toolInfo).length ? { required: requiredParamNames(toolInfo) } : {}),
		}
	} satisfies FunctionDeclaration
}

const geminiTools = (chatMode: ChatMode | null, mcpTools: InternalToolInfo[] | undefined): GeminiTool[] | null => {
	const allowedTools = availableTools(chatMode, mcpTools)
	if (!allowedTools || Object.keys(allowedTools).length === 0) return null
	const functionDecls: FunctionDeclaration[] = []
	for (const t in allowedTools ?? {}) {
		functionDecls.push(toGeminiFunctionDecl(allowedTools[t]))
	}
	const tools: GeminiTool = { functionDeclarations: functionDecls, }
	return [tools]
}



// Implementation for Gemini using Google's native API
const sendGeminiChat = async ({
	messages,
	separateSystemMessage,
	onText,
	onFinalMessage,
	onError,
	settingsOfProvider,
	overridesOfModel,
	modelName: modelName_,
	_setAborter,
	providerName,
	modelSelectionOptions,
	chatMode,
	mcpTools,
}: SendChatParams_Internal) => {

	if (providerName !== 'gemini') throw new Error(`Sending Gemini chat, but provider was ${providerName}`)

	const thisConfig = settingsOfProvider[providerName]

	const {
		modelName,
		specialToolFormat,
		// reasoningCapabilities,
	} = getModelCapabilities(providerName, modelName_, overridesOfModel)

	// const { providerReasoningIOSettings } = getProviderCapabilities(providerName)

	// reasoning
	// const { canIOReasoning, openSourceThinkTags, } = reasoningCapabilities || {}
	const reasoningInfo = getSendableReasoningInfo('Chat', providerName, modelName_, modelSelectionOptions, overridesOfModel) // user's modelName_ here
	// const includeInPayload = providerReasoningIOSettings?.input?.includeInPayload?.(reasoningInfo) || {}

	const thinkingConfig: ThinkingConfig | undefined = !reasoningInfo?.isReasoningEnabled ? undefined
		: reasoningInfo.type === 'budget_slider_value' ?
			{ thinkingBudget: reasoningInfo.reasoningBudget }
			: undefined

	// tools
	const potentialTools = geminiTools(chatMode, mcpTools)
	const toolConfig = potentialTools && specialToolFormat === 'gemini-style' ?
		potentialTools
		: undefined

	// instance
	const genAI = new GoogleGenAI({ apiKey: thisConfig.apiKey });


	// manually parse out tool results if XML
	if (!specialToolFormat) {
		const { newOnText, newOnFinalMessage } = extractXMLToolsWrapper(onText, onFinalMessage, chatMode, mcpTools)
		onText = newOnText
		onFinalMessage = newOnFinalMessage
	}

	// when receive text
	let fullReasoningSoFar = ''
	let fullTextSoFar = ''

	let toolName = ''
	let toolId = ''
	// Vader: every functionCall the model returns, not just functionCalls[0]
	let allFunctionCalls: { name?: string, args?: Record<string, unknown>, id?: string }[] = []


	genAI.models.generateContentStream({
		model: modelName,
		config: {
			systemInstruction: separateSystemMessage,
			thinkingConfig: thinkingConfig,
			tools: toolConfig,
		},
		contents: messages as GeminiLLMChatMessage[],
	})
		.then(async (stream) => {
			_setAborter(() => { stream.return(fullTextSoFar); });

			// Process the stream
			for await (const chunk of stream) {
				// message
				const newText = chunk.text ?? ''
				fullTextSoFar += newText

				// tool call(s)
				const functionCalls = chunk.functionCalls
				if (functionCalls && functionCalls.length > 0) {
					// a function call arrives whole (never as deltas), but several calls of one turn can be spread over several stream
					// chunks: collect them all (this used to keep only the last chunk's calls, silently dropping the others)
					allFunctionCalls.push(...functionCalls)
					const functionCall = functionCalls[0] // first call only, for the live-progress display below
					toolName = functionCall.name ?? ''
					toolId = functionCall.id ?? ''
				}

				// (do not handle reasoning yet)

				// call onText
				onText({
					fullText: fullTextSoFar,
					fullReasoning: fullReasoningSoFar,
					toolCall: !toolName ? undefined : { name: toolName, rawParams: {}, isDone: false, doneParams: [], id: toolId },
				})
			}

			// on final
			if (!fullTextSoFar && !fullReasoningSoFar && allFunctionCalls.length === 0) {
				onError({ message: 'Vader: Response from model was empty.', fullError: null })
			} else {
				const toolCalls = allFunctionCalls
					.map(fc => rawToolCallObjOfParamsStr(fc.name ?? '', JSON.stringify(fc.args ?? {}), fc.id || generateUuid()))
					.filter((t): t is RawToolCallObj => t !== null)
				onFinalMessage({ fullText: fullTextSoFar, fullReasoning: fullReasoningSoFar, anthropicReasoning: null, toolCalls: toolCalls.length ? toolCalls : undefined });
			}
		})
		.catch(error => {
			const message = error?.message
			if (typeof message === 'string') {

				if (error.message?.includes('API key')) {
					onError({ message: invalidApiKeyMessage(providerName), fullError: error });
				}
				else if (error?.message?.includes('429')) {
					onError({ message: 'Rate limit reached. ' + error, fullError: error });
				}
				else
					onError({ message: error + '', fullError: error });
			}
			else {
				onError({ message: error + '', fullError: error });
			}
		})
};



type CallFnOfProvider = {
	[providerName in ProviderName]: {
		sendChat: (params: SendChatParams_Internal) => Promise<void>;
		sendFIM: ((params: SendFIMParams_Internal) => void) | null;
		list: ((params: ListParams_Internal<any>) => void) | null;
	}
}

export const sendLLMMessageToProviderImplementation = {
	anthropic: {
		sendChat: sendAnthropicChat,
		sendFIM: null,
		list: null,
	},
	openAI: {
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: null,
		list: null,
	},
	xAI: {
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: null,
		list: null,
	},
	gemini: {
		sendChat: (params) => sendGeminiChat(params),
		sendFIM: null,
		list: null,
	},
	mistral: {
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: (params) => sendMistralFIM(params),
		list: null,
	},
	ollama: {
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: sendOllamaFIM,
		list: ollamaList,
	},
	openAICompatible: {
		sendChat: (params) => _sendOpenAICompatibleChat(params), // using openai's SDK is not ideal (your implementation might not do tools, reasoning, FIM etc correctly), talk to us for a custom integration
		sendFIM: (params) => _sendOpenAICompatibleFIM(params),
		list: null,
	},
	openRouter: {
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: (params) => _sendOpenAICompatibleFIM(params),
		list: null,
	},
	vLLM: {
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: (params) => _sendOpenAICompatibleFIM(params),
		list: (params) => _openaiCompatibleList(params),
	},
	deepseek: {
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: null,
		list: null,
	},
	groq: {
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: null,
		list: null,
	},

	lmStudio: {
		// lmStudio has no suffix parameter in /completions, so sendFIM might not work
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: (params) => _sendOpenAICompatibleFIM(params),
		list: (params) => _openaiCompatibleList(params),
	},
	liteLLM: {
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: (params) => _sendOpenAICompatibleFIM(params),
		list: null,
	},
	googleVertex: {
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: null,
		list: null,
	},
	microsoftAzure: {
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: null,
		list: null,
	},
	awsBedrock: {
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: null,
		list: null,
	},

	minimax: {
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: null,
		list: null,
	},
	alibaba: {
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: null,
		list: null,
	},
	moonshot: {
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: null,
		list: null,
	},
	openCodeZen: {
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: null,
		list: null,
	},

} satisfies CallFnOfProvider


// ------------ VISION (Vader addition) ------------
// A deliberately isolated, one-off image+text->text call - see
// common/vision/visionQueryTypes.ts's doc comment for why this doesn't touch the main
// sendChat/streaming pipeline or the persisted ChatMessage/LLMChatMessage format. Reuses the
// exact same per-provider client-construction helpers (newOpenAICompatibleSDK, `new Anthropic`,
// `new GoogleGenAI`) the real chat paths above use, so there is exactly one place each
// provider's credentials are turned into a client, not two.
export const sendVisionQuery = async ({
	providerName,
	modelName: modelName_,
	settingsOfProvider,
	overridesOfModel,
	imageBase64,
	mimeType,
	prompt,
}: {
	providerName: ProviderName,
	modelName: string,
	settingsOfProvider: SettingsOfProvider,
	overridesOfModel: OverridesOfModel | undefined,
	imageBase64: string,
	mimeType: 'image/png' | 'image/jpeg',
	prompt: string,
}): Promise<string> => {

	// last real gate before an image ever leaves the app - re-checked here independently of
	// whatever already filtered the caller's model choice (e.g. the Model Router), since this
	// function is the actual network boundary (AGENTS.md: network calls live in one auditable
	// main-process place per subsystem).
	if (!modelSupportsVision(providerName, modelName_)) {
		throw new Error(`Model "${modelName_}" (${providerName}) is not recognized as vision-capable. Refusing to send image data to it.`)
	}

	const { modelName } = getModelCapabilities(providerName, modelName_, overridesOfModel)

	if (providerName === 'anthropic') {
		const thisConfig = settingsOfProvider.anthropic
		const anthropic = new Anthropic({ apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true })
		const response = await anthropic.messages.create({
			model: modelName,
			max_tokens: 1024,
			messages: [{
				role: 'user',
				content: [
					{ type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
					{ type: 'text', text: prompt },
				],
			}],
		})
		const textBlock = response.content.find(b => b.type === 'text')
		if (!textBlock || textBlock.type !== 'text') throw new Error(`Vision query to ${providerName} returned no text.`)
		return textBlock.text
	}

	if (providerName === 'gemini') {
		const thisConfig = settingsOfProvider.gemini
		const genAI = new GoogleGenAI({ apiKey: thisConfig.apiKey })
		const response = await genAI.models.generateContent({
			model: modelName,
			contents: [{
				role: 'user',
				parts: [
					{ inlineData: { mimeType, data: imageBase64 } },
					{ text: prompt },
				],
			}],
		})
		const text = response.text
		if (!text) throw new Error(`Vision query to ${providerName} returned no text.`)
		return text
	}

	// every other provider this codebase supports is reached through the OpenAI-compatible SDK
	// (openAI, openRouter, ollama, vLLM, lmStudio, liteLLM, openAICompatible, deepseek, groq,
	// xAI, mistral, microsoftAzure, awsBedrock) - the same helper the real chat path uses, and
	// the OpenAI Chat Completions image_url content-part format, which every one of these
	// backends that actually supports vision (gpt-4o, a vision-tuned OpenRouter model, a
	// llava/qwen-vl model served by Ollama/vLLM/LM Studio, ...) accepts.
	const openai = await newOpenAICompatibleSDK({ providerName, settingsOfProvider })
	const response = await openai.chat.completions.create({
		model: modelName,
		max_tokens: 1024,
		messages: [{
			role: 'user',
			content: [
				{ type: 'text', text: prompt },
				{ type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
			],
		}],
	})
	const text = response.choices[0]?.message?.content
	if (!text) throw new Error(`Vision query to ${providerName} returned no text.`)
	return text
}


/*
FIM info (this may be useful in the future with vLLM, but in most cases the only way to use FIM is if the provider explicitly supports it):

qwen2.5-coder https://ollama.com/library/qwen2.5-coder/blobs/e94a8ecb9327
<|fim_prefix|>{{ .Prompt }}<|fim_suffix|>{{ .Suffix }}<|fim_middle|>

codestral https://ollama.com/library/codestral/blobs/51707752a87c
[SUFFIX]{{ .Suffix }}[PREFIX] {{ .Prompt }}

deepseek-coder-v2 https://ollama.com/library/deepseek-coder-v2/blobs/22091531faf0
<｜fim▁begin｜>{{ .Prompt }}<｜fim▁hole｜>{{ .Suffix }}<｜fim▁end｜>

starcoder2 https://ollama.com/library/starcoder2/blobs/3b190e68fefe
<file_sep>
<fim_prefix>
{{ .Prompt }}<fim_suffix>{{ .Suffix }}<fim_middle>
<|end_of_text|>

codegemma https://ollama.com/library/codegemma:2b/blobs/48d9a8140749
<|fim_prefix|>{{ .Prompt }}<|fim_suffix|>{{ .Suffix }}<|fim_middle|>

*/
