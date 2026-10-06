#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Regression test for how a chat thread is turned back into the messages a provider receives, with the REAL
// converters bundled from source. A live run found that when a model made several tool calls in one turn only the
// first was listed on the assistant message, so the follow-up request referred to calls the assistant never made
// (OpenAI-compatible APIs reject that with HTTP 400).
//
// Run: node src/vs/workbench/contrib/vader/test/convertMessagesE2E.mjs [path/to/convertToLLMMessageService.ts]

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const entry = process.argv[2] ? path.resolve(process.argv[2]) : path.join(here, '../browser/convertToLLMMessageService.ts');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-convert-'));
await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'c.mjs'), logLevel: 'silent', packages: 'external', tsconfigRaw: JSON.stringify({ compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } }) });
const { prepareMessages_openai_tools, prepareMessages_anthropic_tools } = await import(pathToFileURL(path.join(tmp, 'c.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const clone = (x) => JSON.parse(JSON.stringify(x));
const tool = (id, name, params, content) => ({ role: 'tool', id, name, rawParams: params, content });
const turn = [
	{ role: 'user', content: 'read both files' },
	{ role: 'assistant', content: 'Reading.' },
	tool('call_A', 'read_file', { uri: '/a' }, 'contents of a'),
	tool('call_B', 'read_file', { uri: '/b' }, 'contents of b'),
];

// ---- OpenAI-style
{
	const out = prepareMessages_openai_tools(clone(turn));
	const asst = out.find(m => m.role === 'assistant');
	check('openai: both tool calls are listed on the assistant message', asst?.tool_calls?.length === 2 && asst.tool_calls.map(c => c.id).join() === 'call_A,call_B', JSON.stringify(asst?.tool_calls));
	check('openai: tool arguments are JSON strings of the parameters', asst?.tool_calls?.[1]?.function?.arguments === '{"uri":"/b"}');
	const tools = out.filter(m => m.role === 'tool');
	check('openai: one tool message per call, matching ids, in order', tools.length === 2 && tools[0].tool_call_id === 'call_A' && tools[1].tool_call_id === 'call_B');
	check('openai: every tool message answers a call the assistant made', tools.every(t => asst.tool_calls.some(c => c.id === t.tool_call_id)));
}
{
	const out = prepareMessages_openai_tools(clone([{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }, tool('c1', 'read_file', { uri: '/x' }, 'rx'), { role: 'assistant', content: 'next' }, tool('c2', 'ls_dir', {}, 'rl'), { role: 'assistant', content: 'end' }]));
	const asst = out.filter(m => m.role === 'assistant');
	check('openai: each turn keeps its own calls (1 then 1)', asst[0].tool_calls?.length === 1 && asst[0].tool_calls[0].id === 'c1' && asst[1].tool_calls?.length === 1 && asst[1].tool_calls[0].id === 'c2' && !asst[2].tool_calls);
}
{
	const out = prepareMessages_openai_tools(clone([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }]));
	check('openai: a plain conversation is unchanged', out.length === 2 && !out[1].tool_calls);
}

// ---- Anthropic-style
{
	const out = prepareMessages_anthropic_tools(clone(turn), false);
	const asst = out.find(m => m.role === 'assistant');
	const uses = Array.isArray(asst?.content) ? asst.content.filter(b => b.type === 'tool_use') : [];
	check('anthropic: both tool_use blocks are on the assistant message', uses.length === 2 && uses.map(u => u.id).join() === 'call_A,call_B', JSON.stringify(asst?.content));
	const userMsgs = out.filter(m => m.role === 'user');
	const resultMsg = userMsgs[userMsgs.length - 1];
	const results = Array.isArray(resultMsg.content) ? resultMsg.content.filter(b => b.type === 'tool_result') : [];
	check('anthropic: both results are in ONE user message right after the assistant message', out[out.length - 1] === resultMsg && results.length === 2 && results.map(r => r.tool_use_id).join() === 'call_A,call_B', JSON.stringify(out.map(m => m.role)));
	check('anthropic: every result answers a tool_use that was made', results.every(r => uses.some(u => u.id === r.tool_use_id)));
}
{
	const out = prepareMessages_anthropic_tools(clone([{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }, tool('c1', 'read_file', { uri: '/x' }, 'rx'), { role: 'assistant', content: 'b' }, tool('c2', 'ls_dir', {}, 'rl')]), false);
	check('anthropic: separate turns stay separate (user, assistant, user(result), assistant, user(result))', out.map(m => m.role).join() === 'user,assistant,user,assistant,user', out.map(m => m.role).join());
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
