#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The retry in VaderAgentModel (browser/agentRuntime/vaderAgentModel.ts), bundled from source with fake services: when the server refuses the native tools of a model Vader does
// not know, the request is sent again once (the caller has switched the model to XML tools by then); every other failure is reported as before.
// Run: node src/vs/workbench/contrib/vader/test/nativeToolFallbackE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-fallback-'));
await esbuild.build({ entryPoints: [path.join(here, '../browser/agentRuntime/vaderAgentModel.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'm.mjs'), logLevel: 'silent', packages: 'external', tsconfigRaw: JSON.stringify({ compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } }) });
const { VaderAgentModel } = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

// a fake provider: each call to sendLLMMessage plays the next scripted outcome
const makeModel = (outcomes, hooks = {}) => {
	const sent = [];
	const llm = {
		sendLLMMessage: (p) => {
			sent.push({ overrides: p.overridesOfModel });
			const o = outcomes[sent.length - 1] ?? { text: 'done' };
			queueMicrotask(() => {
				if (o.error) { if (o.textFirst) p.onText({ fullText: o.textFirst, fullReasoning: '' }); p.onError({ message: o.error, fullError: null }); return; }
				p.onText({ fullText: o.text, fullReasoning: '' });
				p.onFinalMessage({ fullText: o.text, fullReasoning: '', toolCalls: o.toolCalls ?? [] });
			});
			return 'req-' + sent.length;
		},
		abort: () => { },
	};
	const convert = { prepareLLMChatMessages: async () => ({ messages: [], separateSystemMessage: undefined }) };
	const model = new VaderAgentModel(llm, convert, {
		getThreadMessages: () => [], maybeCompactThread: async () => { }, chatMode: 'agent', agentId: null,
		modelSelection: { providerName: 'openAICompatible', modelName: 'my-local-model' }, modelSelectionOptions: undefined,
		overridesOfModel: { stale: true }, loggingName: 'test', ...hooks,
	});
	return { model, sent };
};
const run = async (model) => { const ev = []; for await (const e of model.stream({ messages: [], tools: [], signal: undefined })) ev.push(e); return ev; };
const finish = (ev) => ev.filter(e => e.type === 'finish');

{
	const { model, sent } = makeModel([{ text: 'hello' }], { onNativeToolsRejected: async () => { throw new Error('must not be asked'); } });
	const ev = await run(model);
	check('no error: one request, the text comes through', sent.length === 1 && ev.some(e => e.type === 'text-delta' && e.text === 'hello') && finish(ev)[0].reason === 'stop');
}
{
	let asked = 0, switched = false;
	const { model, sent } = makeModel([{ error: '400 registry.ollama.ai/library/x does not support tools' }, { text: 'xml now' }], {
		onNativeToolsRejected: async (msg) => { asked++; switched = /does not support tools/.test(msg); return true; },
		getOverridesOfModel: () => ({ fresh: true }),
	});
	const ev = await run(model);
	check('the server refuses the tools: the hook is asked once, with the server\'s message', asked === 1 && switched);
	check('...the request is sent again', sent.length === 2);
	check('...with the settings as they are after the switch (not the stale ones)', sent[1].overrides.fresh === true && sent[0].overrides.fresh === true);
	check('...the refusal is never shown, the second answer is', ev.some(e => e.type === 'text-delta' && e.text === 'xml now') && finish(ev).length === 1 && finish(ev)[0].reason === 'stop');
}
{
	const { model, sent } = makeModel([{ error: '400 does not support tools' }, { text: 'never' }], { onNativeToolsRejected: async () => false });
	const ev = await run(model);
	check('the hook says no: the error is reported and nothing is retried', sent.length === 1 && finish(ev).length === 1 && finish(ev)[0].reason === 'error');
}
{
	let asked = 0;
	const { model, sent } = makeModel([{ error: '400 does not support tools', textFirst: 'partial answer' }], { onNativeToolsRejected: async () => { asked++; return true; } });
	const ev = await run(model);
	check('an error after some output is not a refusal of the tools: reported at once, no retry', asked === 0 && sent.length === 1 && finish(ev)[0].reason === 'error');
}
{
	const { model, sent } = makeModel([{ error: '400 does not support tools' }, { error: '500 server error' }, { text: 'never' }], { onNativeToolsRejected: async () => true });
	const ev = await run(model);
	check('a second failure is reported, never a third request', sent.length === 2 && finish(ev).length === 1 && finish(ev)[0].reason === 'error');
}
{
	const { model, sent } = makeModel([{ error: '401 Incorrect API key' }], {});
	const ev = await run(model);
	check('without the hook (sub-agents, tests) an error is reported as before', sent.length === 1 && finish(ev)[0].reason === 'error');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
