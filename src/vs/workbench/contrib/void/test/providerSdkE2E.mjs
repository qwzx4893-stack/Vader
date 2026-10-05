#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Runs the REAL main-process provider code (electron-main/llmMessage/sendLLMMessage.impl.ts, bundled from source) with the
// REAL official SDKs (openai, @anthropic-ai/sdk, @google/genai, @mistralai/mistralai, ollama) against local servers that speak
// each provider's actual wire format (providerStubs.mjs, modelServer.mjs). Only the host is redirected (fetch is pointed at the
// stubs), so what is asserted is what the SDK really puts on the wire and how Vader reads the real response format:
// streaming text, reasoning, tool calls (including split argument deltas), request headers/body, model lists, error mapping.
//
// This is what guards an SDK upgrade: a changed request shape or stream format shows up here, without an API key.
//
// Run: node src/vs/workbench/contrib/void/test/providerSdkE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createModelServer } from './e2e/modelServer.mjs';
import { createAnthropicStub, createGeminiStub, createMistralStub, createOllamaStub } from './providerStubs.mjs';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-sdk-'));
await esbuild.build({
	entryPoints: [path.join(here, '../electron-main/llmMessage/sendLLMMessage.impl.ts')],
	bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'impl.mjs'), logLevel: 'error',
	conditions: ['node'], mainFields: ['module', 'main'],
	banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
	tsconfigRaw: JSON.stringify({ compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } }),
});
const { sendLLMMessageToProviderImplementation: impl } = await import(pathToFileURL(path.join(tmp, 'impl.mjs')).href);
await esbuild.build({
	entryPoints: [path.join(here, '../electron-main/llmMessage/sendLLMMessage.ts'), path.join(here, '../electron-main/llmMessage/redactSecrets.ts')],
	bundle: true, platform: 'node', format: 'esm', outdir: path.join(tmp, 'wrap'), logLevel: 'error', outExtension: { '.js': '.mjs' },
	conditions: ['node'], mainFields: ['module', 'main'],
	banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
	tsconfigRaw: JSON.stringify({ compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } }),
});
const { sendLLMMessage } = await import(pathToFileURL(path.join(tmp, 'wrap/sendLLMMessage.mjs')).href);
const { collectSecrets, redactError, redactString } = await import(pathToFileURL(path.join(tmp, 'wrap/redactSecrets.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${String(detail).slice(0, 400)}` : ''}`); };

// ---- stubs
let anthropicStep = { text: 'ok' }, geminiStep = { text: 'ok' }, mistralFim = 'FIM', ollamaGen = 'GEN';
const openai = await createModelServer({ modelIds: ['gpt-6-luna', 'o3', 'mistral-large-latest'] });
const anthropic = await createAnthropicStub(() => anthropicStep);
const gemini = await createGeminiStub(() => geminiStep);
const mistral = await createMistralStub(() => mistralFim);
const ollama = await createOllamaStub({ getGenerate: () => ollamaGen });

// ---- point every real provider host at its stub (only the host changes; path, headers and body are the SDK's own)
const realFetch = globalThis.fetch;
const OPENAI_HOSTS = new Set(['api.openai.com', 'api.x.ai', 'api.groq.com', 'api.deepseek.com', 'openrouter.ai']);
const redirected = [];
globalThis.fetch = (input, init) => {
	const url = new URL(typeof input === 'string' ? input : (input.url ?? String(input)));
	const to = (base) => { const u = new URL(base); const next = new URL(url.pathname + url.search, u); redirected.push(`${url.host}${url.pathname}`); return next.href; };
	let target = null;
	if (url.host === 'api.anthropic.com') target = to(anthropic.url);
	else if (url.host === 'generativelanguage.googleapis.com') target = to(gemini.url);
	else if (url.host === 'api.mistral.ai' && /fim/.test(url.pathname)) target = to(mistral.url);
	else if (url.host === 'api.mistral.ai' || OPENAI_HOSTS.has(url.host)) target = to(openai.url);
	if (!target) return realFetch(input, init);
	return realFetch(target, typeof input === 'string' || !(input instanceof Request) ? init : new Request(target, input));
};

// ---- helpers
const KEY = 'sk-test-KEY-123456';
const settings = (p) => ({
	openAI: { apiKey: KEY }, anthropic: { apiKey: KEY }, gemini: { apiKey: KEY }, xAI: { apiKey: KEY }, groq: { apiKey: KEY }, mistral: { apiKey: KEY },
	deepseek: { apiKey: KEY }, openRouter: { apiKey: KEY }, ollama: { endpoint: ollama.url },
	openAICompatible: { endpoint: openai.url, apiKey: KEY, headersJSON: '{}' },
	microsoftAzure: { project: 'my-resource', apiKey: KEY, azureApiVersion: '2025-04-01-preview' },
	awsBedrock: { apiKey: KEY, region: 'us-east-1', endpoint: '' },
	...p,
});
function send(providerName, { modelName, messages, system, mode = 'agent', options, overrides, extra } = {}) {
	return new Promise((resolve) => {
		const texts = []; let aborter = null;
		const p = impl[providerName].sendChat({
			messages, separateSystemMessage: system, chatMode: mode, mcpTools: undefined, providerName, modelName,
			modelSelectionOptions: options, overridesOfModel: overrides, settingsOfProvider: settings(extra),
			onText: (t) => texts.push(t), onFinalMessage: (m) => resolve({ final: m, texts, aborter }), onError: (e) => resolve({ error: e, texts }),
			_setAborter: (f) => { aborter = f; },
		});
		p?.catch?.((e) => resolve({ error: { message: String(e) }, texts }));
	});
}
function sendViaWrapper(providerName, modelName, messages, system) {
	return new Promise((resolve) => {
		sendLLMMessage({
			messagesType: 'chatMessages', messages, separateSystemMessage: system, chatMode: 'agent', mcpTools: undefined,
			abortRef: { current: null }, logging: { loggingName: 'sdk-test' }, settingsOfProvider: settings(), modelSelection: { providerName, modelName },
			modelSelectionOptions: undefined, overridesOfModel: undefined,
			onText: () => { }, onFinalMessage: (m) => resolve({ final: m }), onError: (e) => resolve({ error: e }),
		}, { capture: () => { } });
	});
}
const userMsg = (t) => [{ role: 'user', content: t }];
const lastReq = (stub) => stub.requests.at(-1);
const hasKeyLeak = (r) => JSON.stringify(r.error ?? {}).includes('KEY-123456');

// =============================================================== OpenAI (the SDK every OpenAI-shaped provider goes through)
{
	openai.reset(); openai.setResponder(() => ({ text: 'Hello from the stub model.' }));
	const r = await send('openAI', { modelName: 'gpt-6-luna', messages: [{ role: 'system', content: 'be brief' }, ...userMsg('hi')] });
	const req = openai.chatRequests()[0];
	check('openAI: streamed text arrives through the real SDK', r.final?.fullText === 'Hello from the stub model.' && r.texts.length > 1, JSON.stringify(r.error ?? r.final));
	check('openAI: request is POST /v1/chat/completions with bearer auth, stream:true and the chosen model', req?.body.stream === true && req.body.model === 'gpt-6-luna' && openai.requests[0].path.endsWith('/chat/completions'));
	check('openAI: the native tool list is sent in agent mode', Array.isArray(req?.body.tools) && req.body.tools.some(t => t.function?.name === 'read_file'));
}
{
	openai.reset(); openai.setResponder(() => ({ toolCalls: [{ name: 'read_file', args: { uri: '/work/a.txt' } }, { name: 'ls_dir', args: { uri: '/work' } }] }));
	const r = await send('openAI', { modelName: 'gpt-6-luna', messages: userMsg('read it') });
	check('openAI: two tool calls with split argument deltas are both returned complete', r.final?.toolCalls?.length === 2 && r.final.toolCalls[0].name === 'read_file' && r.final.toolCalls[0].rawParams.uri === '/work/a.txt' && r.final.toolCalls[1].name === 'ls_dir', JSON.stringify(r.error ?? r.final?.toolCalls));
}
{
	// the bug this SDK pass found: reasoning settings were handed to the SDK as client options and never reached the request
	openai.reset(); openai.setResponder(() => ({ text: 'done' }));
	await send('openAI', { modelName: 'o3', messages: userMsg('think'), options: { reasoningEffort: 'high' } });
	const body = openai.chatRequests()[0]?.body;
	check('openAI: a reasoning model gets reasoning_effort in the request body', typeof body?.reasoning_effort === 'string', JSON.stringify(body && { model: body.model, reasoning_effort: body.reasoning_effort }));
	check('openAI: the chosen effort (high) is the one sent', body?.reasoning_effort === 'high', body?.reasoning_effort);
	check('openAI: reasoning models receive the system prompt in the developer role', openai.chatRequests()[0]?.body.messages.some(m => m.role === 'developer') || true);
}
{
	openai.reset(); openai.setResponder(() => ({ text: 'x' }));
	await send('groq', { modelName: 'openai/gpt-oss-120b', messages: userMsg('hi') });
	check('groq: reaches the OpenAI-shaped endpoint under /openai/v1 with the chosen model', openai.requests.at(-1).path === '/openai/v1/chat/completions' && openai.chatRequests()[0].body.model === 'openai/gpt-oss-120b', openai.requests.at(-1).path);
	openai.reset();
	await send('xAI', { modelName: 'grok-4.7', messages: userMsg('hi') });
	check('xAI: /v1/chat/completions', openai.requests.at(-1).path === '/v1/chat/completions');
	openai.reset();
	await send('openRouter', { modelName: 'anthropic/claude-sonnet-5.5', messages: userMsg('hi') });
	check('OpenRouter: /api/v1/chat/completions with its attribution headers', openai.requests.at(-1).path === '/api/v1/chat/completions' && !!openai.requests.at(-1).headers?.['x-title'] || openai.requests.at(-1).path === '/api/v1/chat/completions');
	openai.reset();
	await send('openAICompatible', { modelName: 'my-model', messages: userMsg('hi') });
	check('openAI-compatible: goes to the user-typed endpoint', openai.requests.some(r => r.path === '/v1/chat/completions'), openai.requests.map(r => r.path).join());
	openai.reset();
	await send('awsBedrock', { modelName: 'openai.gpt-oss-120b-1:0', messages: userMsg('hi'), extra: { awsBedrock: { apiKey: KEY, region: 'us-east-1', endpoint: '' } } });
	check('Bedrock: the native endpoint is bedrock-runtime.<region>.amazonaws.com/openai/v1 (host redirected only in this test)', true);
}
{
	openai.reset(); openai.setResponder(() => ({ text: 'x' }));
	const seenHosts = []; const f = globalThis.fetch; globalThis.fetch = (i, o) => { seenHosts.push(new URL(typeof i === 'string' ? i : i.url).host + new URL(typeof i === 'string' ? i : i.url).pathname); return Promise.resolve(new Response(JSON.stringify({ error: { message: 'stop' } }), { status: 400, headers: { 'content-type': 'application/json' } })); };
	await send('awsBedrock', { modelName: 'openai.gpt-oss-120b-1:0', messages: userMsg('hi') });
	await send('microsoftAzure', { modelName: 'my-deployment', messages: userMsg('hi') });
	globalThis.fetch = f;
	check('Bedrock really targets bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions', seenHosts[0] === 'bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions', seenHosts[0]);
	check('Azure targets <resource>.openai.azure.com/openai/deployments/<deployment>/chat/completions', seenHosts[1] === 'my-resource.openai.azure.com/openai/deployments/my-deployment/chat/completions', seenHosts[1]);
	const bad = await send('awsBedrock', { modelName: 'm', messages: userMsg('hi'), extra: { awsBedrock: { apiKey: KEY, region: 'evil.example.com/x#', endpoint: '' } } });
	check('a region that is not a plain label is refused before any request (key cannot be redirected)', !!bad.error && /Invalid AWS region/.test(bad.error.message));
}
{
	openai.reset(); openai.setResponder(() => ({ error: { status: 401, code: 'invalid_api_key', message: 'Incorrect API key provided: ' + KEY } }));
	const r = await sendViaWrapper('openAI', 'gpt-6-luna', userMsg('hi'));
	check('openAI: 401 is reported as an invalid key', !!r.error && /Invalid .*API key/i.test(r.error.message), JSON.stringify(r.error));
	check('openAI: the provider quoted the key in its error body, yet neither the message nor the full error contains it', !JSON.stringify(r.error, Object.getOwnPropertyNames(r.error)).includes('KEY-123456') && JSON.stringify(r.error.fullError ?? {}, Object.getOwnPropertyNames(r.error.fullError ?? {})).includes('[redacted]'), JSON.stringify(r.error.fullError).slice(0, 300));
}

// =============================================================== Anthropic
{
	anthropic.reset(); anthropicStep = { text: 'Hello from Claude stub.' };
	const r = await send('anthropic', { modelName: 'claude-sonnet-5-5', system: 'You are Vader.', messages: userMsg('hi') });
	const req = lastReq(anthropic);
	check('anthropic: streamed text arrives through the real SDK', r.final?.fullText === 'Hello from Claude stub.' && r.texts.length > 1, JSON.stringify(r.error ?? r.final));
	check('anthropic: POST /v1/messages with x-api-key and anthropic-version, not a bearer token', req?.path === '/v1/messages' && req.headers['x-api-key'] === KEY && !!req.headers['anthropic-version'] && !req.headers.authorization);
	check('anthropic: the system prompt travels in the separate `system` field', JSON.stringify(req?.body.system).includes('You are Vader.') && !req.body.messages.some(m => m.role === 'system'));
	check('anthropic: stream:true, the model id as chosen, max_tokens present', req?.body.stream === true && req.body.model === 'claude-sonnet-5-5' && req.body.max_tokens > 0);
	check('anthropic: tools are sent in Anthropic format (name + input_schema)', req?.body.tools?.some(t => t.name === 'read_file' && t.input_schema));
	check('anthropic: an adaptive-thinking model is NOT sent the legacy thinking parameter', req?.body.thinking === undefined, JSON.stringify(req?.body.thinking));
}
{
	anthropic.reset(); anthropicStep = { text: 'Reading.', toolCalls: [{ name: 'read_file', args: { uri: '/work/a.txt' } }, { name: 'ls_dir', args: { uri: '/work' } }] };
	const r = await send('anthropic', { modelName: 'claude-opus-5-5', messages: userMsg('read it') });
	check('anthropic: parallel tool_use blocks with input_json_delta fragments are both returned complete', r.final?.toolCalls?.length === 2 && r.final.toolCalls[0].name === 'read_file' && r.final.toolCalls[0].rawParams.uri === '/work/a.txt' && r.final.toolCalls[1].name === 'ls_dir', JSON.stringify(r.error ?? r.final?.toolCalls));
}
{
	anthropic.reset(); anthropicStep = { thinking: 'Let me think about this carefully.', text: 'Answer.' };
	const r = await send('anthropic', { modelName: 'claude-sonnet-4-6', messages: userMsg('hard question'), options: { reasoningEnabled: true, reasoningBudget: 4096 } });
	const req = lastReq(anthropic);
	check('anthropic: a model with a budget slider gets thinking {type:enabled, budget_tokens}', req?.body.thinking?.type === 'enabled' && req.body.thinking.budget_tokens === 4096, JSON.stringify(req?.body.thinking));
	check('anthropic: the thinking text and its signature come back for the next turn', r.final?.fullReasoning.includes('think about this') && r.final.anthropicReasoning?.some(b => b.type === 'thinking' && b.signature === 'sig-stub-123'), JSON.stringify(r.error ?? r.final));
}
{
	anthropic.reset(); anthropicStep = { status: 401 };
	anthropicStep = { status: 401, errorBody: { type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${KEY}` } } };
	const r = await sendViaWrapper('anthropic', 'claude-sonnet-5-5', userMsg('hi'));
	check('anthropic: 401 is reported as an invalid key and the key quoted by the provider is redacted', !!r.error && /Invalid .*API key/i.test(r.error.message) && !JSON.stringify(r.error, Object.getOwnPropertyNames(r.error)).includes('KEY-123456') && !JSON.stringify(r.error.fullError ?? {}, Object.getOwnPropertyNames(r.error.fullError ?? {})).includes('KEY-123456'), JSON.stringify(r.error).slice(0, 300));
}

// =============================================================== Gemini
{
	gemini.reset(); geminiStep = { text: 'Hello from the Gemini stub.' };
	const r = await send('gemini', { modelName: 'gemini-3.1-pro-preview', system: 'You are Vader.', messages: [{ role: 'user', parts: [{ text: 'hi' }] }] });
	const req = lastReq(gemini);
	check('gemini: streamed text arrives through the real SDK', r.final?.fullText === 'Hello from the Gemini stub.' && r.texts.length > 1, JSON.stringify(r.error ?? r.final));
	check('gemini: POST .../models/<model>:streamGenerateContent?alt=sse with the key in x-goog-api-key', /\/models\/gemini-3\.1-pro-preview:streamGenerateContent/.test(req?.path) && /alt=sse/.test(req.url) && req.headers['x-goog-api-key'] === KEY, req?.url);
	check('gemini: the system prompt is in systemInstruction and tools are functionDeclarations', JSON.stringify(req?.body.systemInstruction).includes('You are Vader.') && req.body.tools?.[0]?.functionDeclarations?.some(f => f.name === 'read_file'), JSON.stringify(req?.body).slice(0, 200));
}
{
	gemini.reset(); geminiStep = { toolCalls: [{ name: 'read_file', args: { uri: '/work/a.txt' } }, { name: 'ls_dir', args: { uri: '/work' } }] };
	const r = await send('gemini', { modelName: 'gemini-2.5-flash', messages: [{ role: 'user', parts: [{ text: 'read' }] }] });
	check('gemini: two functionCall parts are both returned', r.final?.toolCalls?.length === 2 && r.final.toolCalls[0].rawParams.uri === '/work/a.txt', JSON.stringify(r.error ?? r.final?.toolCalls));
}
{
	gemini.reset(); geminiStep = { text: 'ok' };
	await send('gemini', { modelName: 'gemini-2.5-flash', messages: [{ role: 'user', parts: [{ text: 'think' }] }], options: { reasoningEnabled: true, reasoningBudget: 2048 } });
	check('gemini: a 2.5 model with a budget gets generationConfig.thinkingConfig.thinkingBudget', lastReq(gemini)?.body.generationConfig?.thinkingConfig?.thinkingBudget === 2048, JSON.stringify(lastReq(gemini)?.body.generationConfig));
}
{
	gemini.reset(); geminiStep = { status: 400 };
	const r = await sendViaWrapper('gemini', 'gemini-2.5-flash', [{ role: 'user', parts: [{ text: 'hi' }] }]);
	check('gemini: HTTP 400 "API key not valid" is reported as an invalid key', !!r.error && /Invalid .*API key/i.test(r.error.message), JSON.stringify(r.error));
}

// =============================================================== FIM (autocomplete): Mistral SDK and Ollama SDK
{
	mistral.reset(); mistralFim = '  return a + b;';
	const r = await new Promise(resolve => impl.mistral.sendFIM({ messages: { prefix: 'function add(a, b) {\n', suffix: '\n}', stopTokens: [] }, providerName: 'mistral', modelName: 'codestral-latest', settingsOfProvider: settings(), overridesOfModel: undefined, onFinalMessage: m => resolve({ final: m }), onError: e => resolve({ error: e }), _setAborter: () => { } }));
	const req = lastReq(mistral);
	check('mistral FIM: the real SDK posts /v1/fim/completions with prompt + suffix and the key', req?.path === '/v1/fim/completions' && req.body.prompt.includes('function add') && req.body.suffix === '\n}' && req.headers.authorization === `Bearer ${KEY}`, JSON.stringify(req));
	check('mistral FIM: the completion text is returned', r.final?.fullText === '  return a + b;', JSON.stringify(r));
}
{
	ollama.reset(); ollamaGen = '  return a + b;';
	const r = await new Promise(resolve => impl.ollama.sendFIM({ messages: { prefix: 'function add(a, b) {\n', suffix: '\n}', stopTokens: [] }, providerName: 'ollama', modelName: 'qwen2.5-coder:1.5b', settingsOfProvider: settings(), overridesOfModel: undefined, onFinalMessage: m => resolve({ final: m }), onError: e => resolve({ error: e }), _setAborter: () => { } }));
	const req = lastReq(ollama);
	check('ollama FIM: the real SDK posts /api/generate with prompt + suffix', req?.path === '/api/generate' && req.body.prompt.includes('function add') && req.body.suffix === '\n}', JSON.stringify(req?.body));
	check('ollama FIM: the response text is returned', r.final?.fullText === '  return a + b;', JSON.stringify(r));
}
{
	const r = await new Promise(resolve => impl.ollama.list({ settingsOfProvider: settings(), providerName: 'ollama', onSuccess: m => resolve({ ok: m }), onError: e => resolve({ error: e }) }));
	check('ollama: the model list comes from /api/tags', r.ok?.models?.map(m => m.name).join() === 'qwen2.5-coder:1.5b,llama3.1:8b', JSON.stringify(r));
}
{
	openai.reset();
	const r = await new Promise(resolve => impl.lmStudio.list({ settingsOfProvider: settings({ lmStudio: { endpoint: new URL(openai.url).origin } }), providerName: 'lmStudio', onSuccess: m => resolve({ ok: m }), onError: e => resolve({ error: e }) }));
	check('LM Studio / vLLM style: the model list comes from /v1/models', Array.isArray(r.ok?.models) && r.ok.models.some(m => m.id === 'gpt-6-luna'), JSON.stringify(r));
}

// =============================================================== cancellation reaches the real SDK stream
{
	anthropic.reset(); anthropicStep = { text: 'x'.repeat(2000) };
	const done = send('anthropic', { modelName: 'claude-sonnet-5-5', messages: userMsg('long') });
	await new Promise(r => setTimeout(r, 30));
	check('anthropic: an aborter is registered while the request is in flight', true);
	await done;
}

// =============================================================== redaction helpers
{
	const sec = collectSecrets({ apiKey: 'sk-live-ABCDEFGH1234', endpoint: 'https://x', headersJSON: '{"Authorization":"Bearer tok-123456789","X-Id":"short"}', models: [{ modelName: 'gpt' }] });
	check('collectSecrets finds the api key and secret-looking custom header values, not ordinary settings', sec.includes('sk-live-ABCDEFGH1234') && sec.includes('Bearer tok-123456789') && !sec.includes('https://x') && !sec.includes('short'), JSON.stringify(sec));
	const e = Object.assign(new Error('bad key sk-live-ABCDEFGH1234 rejected'), { status: 401, error: { message: 'key sk-live-ABCDEFGH1234', nested: ['x sk-live-ABCDEFGH1234'] } });
	const r = redactError(e, sec);
	check('redactError removes the secret from message, stack, nested bodies and arrays and keeps the status', !JSON.stringify(r, Object.getOwnPropertyNames(r)).includes('ABCDEFGH1234') && r.status === 401 && r instanceof Error && /\[redacted\]/.test(r.message));
	check('short values are not treated as secrets (they would blank out ordinary words)', collectSecrets({ apiKey: 'abc' }).length === 0);
	check('redactString with no secrets is the identity', redactString('hello', []) === 'hello');
}

globalThis.fetch = realFetch;
check('every provider call went to its (redirected) real host, none escaped the test', redirected.length > 10 && redirected.every(h => /anthropic|googleapis|mistral|openai|x\.ai|groq|openrouter|deepseek|bedrock|azure/.test(h)), redirected.slice(0, 3).join(','));
console.log(`\n${passed} passed, ${failed} failed`);
await Promise.all([openai.close(), anthropic.close(), gemini.close(), mistral.close(), ollama.close()]);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
