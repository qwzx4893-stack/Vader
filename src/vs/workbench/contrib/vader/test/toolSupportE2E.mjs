#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A model name Vader does not know is offered the provider's native tool calling first; a server that refuses the `tools` field makes Vader fall back to XML in the prompt
// and remember it (common/toolSupport.ts, common/modelCapabilities.ts, chatThreadService `_fallBackToXmlTools`, VaderAgentModel). Here: the part that can be tested without the app,
// bundled from source: what counts as a refusal, and what an unknown, a known and an overridden model are offered.
// Run: node src/vs/workbench/contrib/vader/test/toolSupportE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-toolsupport-'));
const load = async (rel, name) => {
	await esbuild.build({ entryPoints: [path.join(here, rel)], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, name), logLevel: 'silent', tsconfigRaw: JSON.stringify({ compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } }) });
	return import(pathToFileURL(path.join(tmp, name)).href);
};
const { looksLikeToolsRejected, nativeToolFormatToTry } = await load('../common/toolSupport.ts', 't.mjs');
const { getModelCapabilities } = await load('../common/modelCapabilities.ts', 'c.mjs');

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

// ---- what a refusal of the tools looks like (messages as the servers word them)
for (const m of [
	'Error: 400 registry.ollama.ai/library/gemma:2b does not support tools',
	'404 No endpoints found that support tool use. To learn more about provider routing, visit: https://openrouter.ai/docs/provider-routing',
	'400 "auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set',
	'Error: 400 litellm.BadRequestError: model does not support function calling',
	'400 Function calling is not supported for this model',
	'Error: 400 tools is not supported with this model',
	'422 Unsupported parameter: tools is not supported for model foo',
	'400 This model does not support tool_choice',
]) check(`refusal: ${m.slice(0, 70)}`, looksLikeToolsRejected(m) === true);
for (const m of [
	'Error: 401 Incorrect API key provided: sk-xxxx',
	'429 Rate limit exceeded: too many requests, try again in 20s',
	'400 This model\'s maximum context length is 32768 tokens. However, your messages resulted in 40000 tokens',
	'Error: connect ECONNREFUSED 127.0.0.1:11434',
	'TypeError: fetch failed',
	'404 The model `foo` does not exist',
	'402 Insufficient credits. Add more using https://openrouter.ai/settings/credits',
	'500 Internal server error',
	'The model is not available right now',
	'400 Invalid tool arguments: unexpected field "x"',
	'401 Unauthorized: tools are not allowed for this key',
]) check(`not a refusal: ${m.slice(0, 70)}`, looksLikeToolsRejected(m) === false);

// ---- what each kind of model is offered
check('an unknown model on the OpenAI-compatible provider is offered native tools', getModelCapabilities('openAICompatible', 'my-local-model', undefined).specialToolFormat === 'openai-style');
check('...and is reported as unrecognised', getModelCapabilities('openAICompatible', 'my-local-model', undefined).isUnrecognizedModel === true);
check('unknown models on other OpenAI-style providers too', ['ollama', 'openRouter', 'vLLM', 'lmStudio', 'liteLLM', 'groq'].every(p => getModelCapabilities(p, 'brand-new-model-x', undefined).specialToolFormat === 'openai-style'));
check('an unknown Anthropic model is offered the Anthropic format', getModelCapabilities('anthropic', 'claude-made-up-9', undefined).specialToolFormat === 'anthropic-style');
check('an unknown Gemini model is offered the Gemini format', getModelCapabilities('gemini', 'gemini-made-up-9', undefined).specialToolFormat === 'gemini-style');
check('nativeToolFormatToTry follows the provider', nativeToolFormatToTry('anthropic') === 'anthropic-style' && nativeToolFormatToTry('gemini') === 'gemini-style' && nativeToolFormatToTry('openAI') === 'openai-style');
const o = (v) => ({ openAICompatible: { 'my-local-model': { specialToolFormat: v } } });
check('the fallback override (null) turns the native format off', getModelCapabilities('openAICompatible', 'my-local-model', o(null)).specialToolFormat === undefined);
check('an explicit format from the person is kept', getModelCapabilities('openAICompatible', 'my-local-model', o('anthropic-style')).specialToolFormat === 'anthropic-style');
check('the override survives the settings file (JSON keeps null)', JSON.parse(JSON.stringify(o(null))).openAICompatible['my-local-model'].specialToolFormat === null);
check('the override is for that model only', getModelCapabilities('openAICompatible', 'another-model', o(null)).specialToolFormat === 'openai-style');
// models Vader knows keep exactly what they had
const known = getModelCapabilities('openAICompatible', 'qwen2.5-coder', undefined);
check('a known model without native tools stays on XML', known.isUnrecognizedModel === false && known.specialToolFormat === undefined, JSON.stringify({ u: known.isUnrecognizedModel, f: known.specialToolFormat }));
check('a known model with native tools keeps them', getModelCapabilities('openAI', 'gpt-4o', undefined).specialToolFormat === 'openai-style');
check('an unknown model keeps the 32k window of the earlier fix', getModelCapabilities('openAICompatible', 'my-local-model', undefined).contextWindow === 32_000);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
