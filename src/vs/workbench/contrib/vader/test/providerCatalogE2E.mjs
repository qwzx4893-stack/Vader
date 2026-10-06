#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Guards the hosted-provider table against going stale or wrong, using the REAL modelCapabilities.ts bundled from source:
//  - every model Vader offers by default is recognised with the right tool format and a real context window
//  - model names newer than the table still get a modern family's capabilities (not the "unknown model" default)
//  - the endpoints the main process talks to are exactly the documented ones
// Facts come from the LiteLLM catalog (see common/providerModelData.ts); the endpoint list below is the reviewed one in
// docs/integrations/providers/README.md.
//
// Run: node src/vs/workbench/contrib/vader/test/providerCatalogE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-prov-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/modelCapabilities.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'mc.mjs'), logLevel: 'silent' });
const mc = await import(pathToFileURL(path.join(tmp, 'mc.mjs')).href);
const { defaultModelsOfProvider, getModelCapabilities } = mc;

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

// ---- 1. every default model of a hosted provider is recognised and usable for an agent
const expectedToolFormat = { anthropic: 'anthropic-style', gemini: 'gemini-style' };
for (const provider of ['openAI', 'anthropic', 'gemini', 'xAI', 'groq', 'mistral', 'deepseek', 'openRouter', 'moonshot', 'minimax', 'alibaba']) {
	const bad = [];
	for (const name of defaultModelsOfProvider[provider]) {
		const c = getModelCapabilities(provider, name, undefined);
		const want = expectedToolFormat[provider] ?? 'openai-style';
		if (c.isUnrecognizedModel) bad.push(`${name}: unrecognised`);
		else if (c.specialToolFormat !== want) bad.push(`${name}: tools=${c.specialToolFormat}`);
		else if (c.contextWindow < 100_000) bad.push(`${name}: window ${c.contextWindow}`);
	}
	check(`${provider}: all ${defaultModelsOfProvider[provider].length} default models are recognised with ${expectedToolFormat[provider] ?? 'openai-style'} tools and a >=100k window`, bad.length === 0, bad.join('; '));
}
check('no default list is empty for the hosted providers', ['openAI', 'anthropic', 'gemini', 'xAI', 'groq', 'mistral', 'deepseek', 'openRouter'].every(p => defaultModelsOfProvider[p].length >= 2));

// ---- 2. known-wrong values that used to be in the table
check('o3 has its real 200k context window (it used to say 1,047,576)', getModelCapabilities('openAI', 'o3', undefined).contextWindow === 200_000);
check('retired models are no longer offered by default', !defaultModelsOfProvider.anthropic.includes('claude-3-5-sonnet-latest') && !defaultModelsOfProvider.gemini.includes('gemini-2.5-pro-exp-03-25') && !defaultModelsOfProvider.openAI.includes('o4-mini') && !defaultModelsOfProvider.openAI.includes('gpt-4.1-nano'));

// ---- 3. adaptive-only Claude models must not be sent the legacy thinking parameter
for (const n of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-opus-4-8']) {
	check(`${n} offers no budget slider (adaptive thinking only)`, getModelCapabilities('anthropic', n, undefined).reasoningCapabilities === false);
}
check('claude-sonnet-4-6 keeps the budget slider', getModelCapabilities('anthropic', 'claude-sonnet-4-6', undefined).reasoningCapabilities?.reasoningSlider?.type === 'budget_slider');

// ---- 4. names newer than the table fall back to the right family, and the name sent to the API stays what the user picked
const family = [
	['anthropic', 'claude-opus-5-9', 'anthropic-style'], ['anthropic', 'claude-haiku-4-5-20251001', 'anthropic-style'], ['anthropic', 'claude-mythos-6', 'anthropic-style'],
	['openAI', 'gpt-6.9-turbo', 'openai-style'], ['openAI', 'gpt-5.9-codex', 'openai-style'], ['openAI', 'o5', 'openai-style'],
	['gemini', 'gemini-3.9-flash', 'gemini-style'], ['gemini', 'gemini-2.5-flash-preview-09-2026', 'gemini-style'],
	['xAI', 'grok-4.9', 'openai-style'], ['deepseek', 'deepseek-v4.9-flash', 'openai-style'], ['mistral', 'mistral-small-2999', 'openai-style'],
	['mistral', 'devstral-2999', 'openai-style'], ['groq', 'openai/gpt-oss-300b', 'openai-style'],
	['openRouter', 'anthropic/claude-opus-5.9', 'openai-style'], ['openRouter', 'openai/gpt-6.9', 'openai-style'], ['openRouter', 'google/gemini-3.9-pro', 'openai-style'],
];
for (const [provider, name, tools] of family) {
	const c = getModelCapabilities(provider, name, undefined);
	check(`${provider}/${name}: recognised as a ${tools} model, name sent unchanged`, !c.isUnrecognizedModel && c.specialToolFormat === tools && c.modelName === name && c.contextWindow >= 100_000, JSON.stringify({ rec: !c.isUnrecognizedModel, tools: c.specialToolFormat, model: c.modelName, ctx: c.contextWindow }));
}
check('a really unknown name is still treated as unknown (not silently given a family)', getModelCapabilities('openAI', 'my-finetune', undefined).isUnrecognizedModel === true);
check('codestral keeps FIM support for autocomplete', getModelCapabilities('mistral', 'codestral-latest', undefined).supportsFIM === true);

// ---- 5. the hosts the main process sends keys to are exactly the reviewed ones
const impl = fs.readFileSync(path.join(here, '../electron-main/llmMessage/sendLLMMessage.impl.ts'), 'utf8');
const listing = fs.readFileSync(path.join(here, '../electron-main/llmMessage/modelListing.ts'), 'utf8');
// every literal `baseURL: '<https url>'` in the chat implementation, i.e. the places an API key is sent to a fixed host
const baseUrls = [...impl.matchAll(/baseURL:\s*'(https?:\/\/[^']+)'/g)].map(m => m[1]).sort();
const reviewedBaseUrls = ['https://api.deepseek.com/v1', 'https://api.groq.com/openai/v1', 'https://api.mistral.ai/v1', 'https://api.x.ai/v1', 'https://openrouter.ai/api/v1'].sort();
check('chat requests to fixed hosts go to exactly the reviewed base URLs', JSON.stringify(baseUrls) === JSON.stringify(reviewedBaseUrls), baseUrls.join(', '));
const reviewedList = ['https://api.openai.com', 'https://api.anthropic.com', 'https://generativelanguage.googleapis.com', 'https://api.x.ai', 'https://api.groq.com', 'https://api.mistral.ai', 'https://api.deepseek.com', 'https://openrouter.ai'].sort();
const listHosts = [...new Set([...listing.matchAll(/'(https:\/\/[a-z0-9.-]+)\//g)].map(m => m[1]))].sort();
check('model-list requests to fixed hosts go only to the reviewed provider hosts', JSON.stringify(listHosts) === JSON.stringify(reviewedList), listHosts.join(', '));
check('Bedrock defaults to the native OpenAI-compatible endpoint', /bedrock-runtime\.\$\{[^}]+\}\.amazonaws\.com\/openai\/v1/.test(impl));
check('region / resource / project values are validated before they reach a URL', (impl.match(/assertUrlLabel\(/g) ?? []).length >= 4);

console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
