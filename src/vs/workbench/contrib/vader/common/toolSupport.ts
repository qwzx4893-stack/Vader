/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A model name Vader does not know (a fine-tune, a new release, a local tag, a gateway alias) used to be sent tools as XML written into the prompt. A weak model then answers
// with JSON text and nothing runs (found by the benchmark: the same model failed twice that way and passed under a name Vader knows). Now such a model is first offered the
// provider's native tool calling, like every model of the same provider that is known. If the server refuses the `tools` field, Vader falls back to XML once and remembers it
// for that model (an override `specialToolFormat: null`, in the person's settings).

import type { ProviderName } from './vaderSettingsTypes.js';

export type NativeToolFormat = 'openai-style' | 'anthropic-style' | 'gemini-style'

/** The native tool format to try for a model name that is not recognised. Anthropic and Gemini have their own wire formats; every other provider speaks the OpenAI one. */
export const nativeToolFormatToTry = (providerName: ProviderName): NativeToolFormat =>
	providerName === 'anthropic' ? 'anthropic-style' : providerName === 'gemini' ? 'gemini-style' : 'openai-style'

// What servers say when a model cannot take tools (Ollama: "does not support tools"; OpenRouter: "No endpoints found that support tool use"; vLLM: "tool choice requires
// --enable-auto-tool-choice"; LM Studio, llama.cpp, LiteLLM and others word it their own way). The message must mention tools or functions AND a refusal.
const REFUSAL = /(does not|doesn'?t|do not|don'?t|not|n'?t|cannot|can'?t|no)\b[^.\n]{0,40}\b(support|supported|available|enabled|allowed|capable|endpoints?)\b/i
const ABOUT_TOOLS = /\b(tools?|tool[_ -]?(use|calls?|choice)|functions?|function[_ -]?calling)\b/i

export const looksLikeToolsRejected = (errorMessage: string): boolean => {
	if (/enable-auto-tool-choice|tool-call-parser/i.test(errorMessage)) { return true }
	if (/\b(401|402|403|429)\b|api key|unauthori[sz]ed|rate limit|quota|insufficient/i.test(errorMessage)) { return false } // a key, credit or rate problem is never about tools
	return ABOUT_TOOLS.test(errorMessage) && REFUSAL.test(errorMessage)
}
