#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// First-class providers for the other model vendors (common/vendorProviderData.ts, generated from the models.dev catalog). They are all driven by one
// table, so the properties that matter are checked for EVERY one of them with the real code, bundled from source:
//   - the table is sane (https gateway, key page, unique titles, models with real facts) and every provider is reachable from settings/UI helpers without throwing
//   - a chat request through the real OpenAI SDK reaches the vendor's own endpoint setting with that vendor's key, streams, and carries tools where the catalog says so
//   - a bad endpoint (http to a remote host, a template placeholder, garbage) is refused before any request leaves
//   - vendors with an OpenAI-style /models route list their real models on their own endpoint, with the key as a bearer token and without leaking it
//   - the provider search finds what people type (qwen, kimi, nvidia ...)
// Provider hosts are not reachable from the build environment, so the gateway URLs themselves are recorded from vendor documentation
// (see the generator); this test proves everything Vader does with them.
//
// Run: node src/vs/workbench/contrib/vader/test/vendorProvidersE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createModelServer } from './e2e/modelServer.mjs';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-vendors-'));
const bundle = async (entry, name, node = true) => {
	await esbuild.build({
		entryPoints: [path.join(here, entry)], bundle: true, platform: node ? 'node' : 'neutral', format: 'esm', outfile: path.join(tmp, name), logLevel: 'error',
		conditions: ['node'], mainFields: ['module', 'main'],
		banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
		tsconfigRaw: JSON.stringify({ compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } }),
	});
	return import(pathToFileURL(path.join(tmp, name)).href);
};
const { sendLLMMessageToProviderImplementation: impl } = await bundle('../electron-main/llmMessage/sendLLMMessage.impl.ts', 'impl.mjs');
const { listCloudModels } = await bundle('../electron-main/llmMessage/modelListing.ts', 'listing.mjs');
const { vendorProviders, vendorProviderNames, vendorLiveListedNames } = await bundle('../common/vendorProviderData.ts', 'data.mjs');
const types = await bundle('../common/vaderSettingsTypes.ts', 'types.mjs');
const caps = await bundle('../common/modelCapabilities.ts', 'caps.mjs');
const { cloudListedProviderNames } = await bundle('../common/cloudModelListTypes.ts', 'cloud.mjs');
const { filterProviders } = await bundle('../common/providerSearch.ts', 'search.mjs');

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${String(detail).slice(0, 300)}` : ''}`); };
const KEY = 'sk-VENDOR-KEY-1234567890';

// ================================================================ the table
check(`${vendorProviderNames.length} vendor providers are defined`, vendorProviderNames.length >= 25, vendorProviderNames.length);
const existing = types.providerNames.filter(p => !vendorProviderNames.includes(p));
const titles = types.providerNames.map(p => types.displayInfoOfProviderName(p).title);
check('every provider (old and new) has a unique display title', new Set(titles).size === titles.length, titles.filter((t, i) => titles.indexOf(t) !== i).join(', '));
check('the original providers are all still there', ['anthropic', 'openAI', 'gemini', 'xAI', 'groq', 'mistral', 'deepseek', 'openRouter', 'ollama', 'vLLM', 'lmStudio', 'liteLLM', 'openAICompatible', 'googleVertex', 'microsoftAzure', 'awsBedrock', 'minimax', 'alibaba', 'moonshot', 'openCodeZen'].every(p => existing.includes(p)), existing.join());
for (const must of ['together', 'fireworks', 'cerebras', 'cohere', 'zai', 'perplexity', 'nvidia', 'huggingface', 'deepinfra', 'nebius', 'cloudflare', 'siliconflow', 'vercel', 'sambanova', 'hyperbolic', 'githubModels'])
	check(`${must} is a first-class provider`, vendorProviderNames.includes(must));
for (const k of vendorProviderNames) {
	const v = vendorProviders[k];
	const bad = [];
	try { const u = new URL(v.endpoint); if (u.protocol !== 'https:') bad.push('endpoint not https'); } catch { bad.push('endpoint invalid'); }
	try { if (new URL(v.keyUrl).protocol !== 'https:') bad.push('key page not https'); } catch { bad.push('key page invalid'); }
	if (/\/chat\/completions\/?$/.test(v.endpoint) || /\/$/.test(v.endpoint)) bad.push('endpoint must be a base URL without /chat/completions or a trailing slash');
	if (!v.title || !v.keyPlaceholder) bad.push('missing title or key placeholder');
	for (const [id, f] of Object.entries(v.models)) { if (!(f.ctx > 0) || typeof f.tools !== 'boolean') bad.push(`model ${id} has no real facts`); }
	check(`${k}: the table entry is sane (https gateway, key page, model facts)`, bad.length === 0, bad.join('; '));
}

// ================================================================ model lists are the provider's own: no hand-written names for a provider that can list them
{
	const withNames = cloudListedProviderNames.filter(p => types.defaultSettingsOfProvider[p].models.length > 0);
	check(`${cloudListedProviderNames.length} providers that can list their models start with none (the key decides what appears)`, withNames.length === 0, withNames.join(','));
	const kept = Object.keys(types.defaultSettingsOfProvider).filter(p => !cloudListedProviderNames.includes(p) && types.defaultSettingsOfProvider[p].models.length > 0);
	const noRoute = vendorProviderNames.filter(k => !vendorProviders[k].liveList);
	check(`the ${noRoute.length} vendors without a list route keep their catalogue so they stay usable`, noRoute.length > 0 && noRoute.every(k => kept.includes(k)), noRoute.filter(k => !kept.includes(k)).join(','));
}

// ================================================================ every provider has its real logo, as safe one-colour data
{
	const { providerLogos } = await bundle('../common/providerLogoData.ts', 'logos.mjs');
	const names = Object.keys(types.defaultSettingsOfProvider);
	const missing = names.filter(n => !providerLogos[n]);
	check(`all ${names.length} providers have a logo`, missing.length === 0, missing.join(','));
	const extra = Object.keys(providerLogos).filter(n => !names.includes(n));
	check('no logo belongs to an unknown provider', extra.length === 0, extra.join(','));
	const ALLOWED_TAGS = new Set(['g', 'path', 'circle', 'rect', 'ellipse', 'polygon', 'polyline', 'line', 'mask', 'defs', 'clipPath']);
	const bad = [];
	let drawn = 0;
	const walk = (n, who) => { const [tag, attrs, kids] = n; if (!ALLOWED_TAGS.has(tag)) bad.push(`${who}: <${tag}>`); for (const [k, v] of Object.entries(attrs)) { if (/^on|href|style|script/i.test(k) || /javascript:|<|>/i.test(v) || (k === 'fill' && !/^(none|currentColor|#fff|#000)$/.test(v))) bad.push(`${who}: ${k}=${v}`); } if (tag === 'path' || tag === 'circle' || tag === 'rect' || tag === 'polygon') drawn++; kids.forEach(c => walk(c, who)); };
	for (const [name, lg] of Object.entries(providerLogos)) { if (!/^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/.test(lg.vb) || lg.els.length === 0) bad.push(`${name}: viewBox/els`); lg.els.forEach(e => walk(e, name)); }
	check('every logo is plain drawing data: allowed shapes only, one colour, no scripts, links or styles', bad.length === 0 && drawn >= names.length, bad.slice(0, 5).join(' | '));
}

// ================================================================ settings and UI helpers never throw, for every provider
for (const k of vendorProviderNames) {
	let err = '';
	try {
		const d = types.displayInfoOfProviderName(k); const s = types.subTextMdOfProviderName(k);
		const key = types.displayInfoOfSettingName(k, 'apiKey'); const ep = types.displayInfoOfSettingName(k, 'endpoint');
		if (!d.title || !s.includes(vendorProviders[k].keyUrl) || !key.placeholder || ep.title !== 'Endpoint' || ep.placeholder !== vendorProviders[k].endpoint) err = JSON.stringify({ d, s: s.slice(0, 60), key, ep });
		const def = types.defaultSettingsOfProvider[k];
		if (!def || def.endpoint !== vendorProviders[k].endpoint || def.apiKey !== '' || def.models.length !== (vendorProviders[k].liveList ? 0 : Object.keys(vendorProviders[k].models).length)) err ||= 'default settings (a live-listed vendor starts with no models, a vendor without a list route keeps its catalogue)';
		if (!types.customSettingNamesOfProvider(k).includes('endpoint') || !types.customSettingNamesOfProvider(k).includes('apiKey')) err ||= 'setting names';
	} catch (e) { err = String(e.message); }
	check(`${k}: title, key hint, endpoint field and default settings are all defined`, !err, err);
}

// ================================================================ capabilities from the catalog facts
for (const k of vendorProviderNames) {
	const bad = [];
	for (const [id, f] of Object.entries(vendorProviders[k].models)) {
		const c = caps.getModelCapabilities(k, id, undefined);
		if (c.isUnrecognizedModel) bad.push(`${id} unrecognised`);
		if (c.contextWindow !== f.ctx) bad.push(`${id} ctx`);
		if (!!c.specialToolFormat !== f.tools) bad.push(`${id} tools`);
		if (caps.modelSupportsVision(k, id) !== f.vision) bad.push(`${id} vision`);
	}
	check(`${k}: every default model gets its catalog context window, tool format and vision flag`, bad.length === 0, bad.slice(0, 3).join('; '));
}
{
	const c = caps.getModelCapabilities('together', 'some-model-not-in-the-catalog', undefined);
	check('a model that is not in the catalog still works with sane defaults (32k window, XML tools)', c.isUnrecognizedModel && c.contextWindow >= 32000 && !c.specialToolFormat);
}

// ================================================================ search
const all = types.providerNames;
check('search: empty query returns every provider', filterProviders(all, '').length === all.length);
check('search: "qwen" finds Alibaba Cloud', filterProviders(all, 'qwen').includes('alibaba'));
check('search: "kimi" finds Moonshot', filterProviders(all, 'kimi').includes('moonshot'));
check('search: "nvidia" finds NVIDIA NIM', filterProviders(all, 'nvidia').includes('nvidia'));
check('search: "glm" finds Z.AI', filterProviders(all, 'glm').includes('zai'));
check('search: "claude" finds Anthropic', filterProviders(all, 'claude').includes('anthropic'));
check('search: several words must all match', filterProviders(all, 'together ai').join() === 'together');
check('search: nonsense finds nothing', filterProviders(all, 'zzzz-nothing').length === 0);

// ================================================================ the real SDK against a stub OpenAI server
const stub = await createModelServer({ modelIds: ['m'] });
const send = (providerName, modelName, endpoint) => new Promise((resolve) => {
	let aborter = null; const texts = [];
	const settings = { [providerName]: { apiKey: KEY, endpoint } };
	const p = impl[providerName].sendChat({
		messages: [{ role: 'user', content: 'hi' }], separateSystemMessage: 'be brief', chatMode: 'agent', mcpTools: undefined, providerName, modelName,
		modelSelectionOptions: undefined, overridesOfModel: undefined, settingsOfProvider: settings,
		onText: (t) => texts.push(t), onFinalMessage: (m) => resolve({ final: m, texts }), onError: (e) => resolve({ error: e, texts }),
		_setAborter: (f) => { aborter = f; },
	});
	p?.catch?.((e) => resolve({ error: { message: String(e) }, texts }));
});
for (const k of vendorProviderNames) {
	stub.reset(); stub.setResponder(() => ({ text: `hello from ${k}` }));
	const modelName = Object.keys(vendorProviders[k].models)[0] ?? 'custom-model-id';
	const r = await send(k, modelName, stub.url);
	const req = stub.chatRequests()[0];
	const hasTools = Array.isArray(req?.body.tools) && req.body.tools.some(t => t.function?.name === 'read_file');
	const wantTools = !!vendorProviders[k].models[modelName]?.tools; // a model the catalog does not list (sambanova and hyperbolic ship no list: it comes live) uses the XML tool format
	check(`${k}: a chat request streams through the real SDK to the endpoint setting, with the key, the model and ${wantTools ? 'native tools' : 'no native tools'}`,
		r.final?.fullText === `hello from ${k}` && req?.path.endsWith('/chat/completions') && req.headers.authorization === `Bearer ${KEY}` && req.body.model === modelName && req.body.stream === true && (wantTools ? hasTools : !hasTools),
		JSON.stringify(r.error ?? { path: req?.path, auth: !!req?.headers.authorization, model: req?.body.model, hasTools }));
}
// endpoint safety: nothing may leave for a bad endpoint
{
	stub.reset();
	const cases = [
		['http to a remote host', 'together', 'http://api.together.xyz/v1', /https/i],
		['a template placeholder left in', 'cloudflare', vendorProviders.cloudflare.endpoint, /ACCOUNT_ID/],
		['not a URL', 'fireworks', 'not a url', /not a valid URL/],
		['a file URL', 'nvidia', 'file:///etc/passwd', /https/i],
	];
	for (const [what, k, ep, re] of cases) {
		const r = await send(k, 'x', ep);
		check(`${k}: ${what} is refused with a clear message and no request is sent`, !!r.error && re.test(r.error.message) && stub.requests.length === 0 && !JSON.stringify(r.error).includes(KEY), JSON.stringify(r.error ?? r.final));
	}
	const ok = await send('cloudflare', 'x', 'https://api.cloudflare.com/client/v4/accounts/0123abcd/ai/v1');
	check('cloudflare: a real account id is accepted by the endpoint check (the request then fails on the network, not on validation)', !!ok.error && !/ACCOUNT_ID|valid URL|https/i.test(ok.error.message), JSON.stringify(ok.error));
}
await stub.close();

// ================================================================ live model lists
check('every vendor with a /models route is in the live-list set, and nobody else', cloudListedProviderNames.filter(p => vendorProviderNames.includes(p)).sort().join() === [...vendorLiveListedNames].sort().join());
{
	const seen = [];
	let body = { object: 'list', data: [{ id: 'chat-model-b', created: 2 }, { id: 'chat-model-a', created: 5 }, { id: 'text-embedding-x', created: 9 }] };
	const server = http.createServer((req, res) => { seen.push({ url: req.url, auth: req.headers.authorization }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); });
	await new Promise(r => server.listen(0, '127.0.0.1', r));
	const base = `http://127.0.0.1:${server.address().port}`;
	for (const k of vendorLiveListedNames) {
		seen.length = 0;
		const settings = { [k]: { apiKey: KEY, endpoint: `${base}/v9` } };
		const r = await listCloudModels(k, settings);
		check(`${k}: lists models from GET {its endpoint}/models with the key as a bearer token, newest first, chat models only`,
			r.ok && r.models.join() === 'chat-model-a,chat-model-b' && seen.length === 1 && seen[0].url === '/v9/models' && seen[0].auth === `Bearer ${KEY}` && !JSON.stringify(r).includes(KEY), JSON.stringify({ r, seen }));
	}
	// Together answers with a bare array
	body = [{ id: 'meta-llama/x', created: 1 }, { id: 'qwen/y', created: 3 }];
	const t = await listCloudModels('together', { together: { apiKey: KEY, endpoint: `${base}/v1` } });
	check('together: a bare JSON array (its real answer shape) is understood too', t.ok && t.models.join() === 'qwen/y,meta-llama/x', JSON.stringify(t));
	const none = await listCloudModels('perplexity', { perplexity: { apiKey: KEY, endpoint: base } });
	check('a vendor without a /models route reports "unsupported" instead of calling out', !none.ok && none.reason === 'unsupported');
	await new Promise(r => server.close(r));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
