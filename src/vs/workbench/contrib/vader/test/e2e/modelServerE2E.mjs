#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Proves the test model server is a faithful stand-in: the OFFICIAL `openai` SDK (what Vader's provider
// code uses) must parse everything it emits exactly as it would parse a real OpenAI response. If this
// passes, UI tests driven by the server exercise Vader's real client path.

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModelServer, rules } from './modelServer.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../..');
const OpenAI = createRequire(path.join(repo, 'package.json'))('openai');
const Client = OpenAI.default ?? OpenAI;

let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { (ok ? passed++ : failed++); console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` - ${detail}` : ''}`); };

const server = await createModelServer({
	responder: rules([
		{ when: c => c.lastUser.includes('tool please'), reply: { text: 'Running it.', toolCalls: [{ name: 'run_command', args: { command: 'echo "hi there" && ls -la', cwd: '/tmp/x y' } }, { name: 'read_file', args: { uri: 'C:\\a\\b.txt' } }] } },
		{ when: c => c.lastUser.includes('boom'), reply: { error: { status: 401, code: 'invalid_api_key', message: 'Incorrect API key provided' } } },
		{ when: c => c.lastUser.includes('limit'), reply: { error: { status: 429, code: 'rate_limit_exceeded', message: 'slow down' } } },
	], { text: 'Hello! This is a streamed reply with unicode: مرحبا ✓ and a "quote".' }),
	fimResponder: ({ prompt, suffix }) => `/*fim:${prompt.length}:${suffix.length}*/`,
});
const client = new Client({ baseURL: server.url, apiKey: 'sk-test' });

try {
	// 1. streamed text, reassembled by the SDK
	{
		const stream = await client.chat.completions.create({ model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: true, stream_options: { include_usage: true } });
		let text = '', chunks = 0, finish = null, usage = null;
		for await (const part of stream) { chunks++; const d = part.choices[0]?.delta; if (d?.content) { text += d.content; } if (part.choices[0]?.finish_reason) { finish = part.choices[0].finish_reason; } if (part.usage) { usage = part.usage; } }
		check('streamed text is reassembled exactly (incl. unicode and quotes)', text === 'Hello! This is a streamed reply with unicode: مرحبا ✓ and a "quote".', JSON.stringify(text));
		check('text arrives as many small chunks like real tokens', chunks > 10, `${chunks} chunks`);
		check('finish_reason stop and trailing usage chunk', finish === 'stop' && usage?.total_tokens === 120);
	}
	// 2. streamed tool calls: arguments are split across chunks and must assemble into valid JSON
	{
		const stream = await client.chat.completions.create({ model: 'm', messages: [{ role: 'user', content: 'tool please' }], stream: true, tools: [{ type: 'function', function: { name: 'run_command', parameters: { type: 'object', properties: {} } } }] });
		const calls = {}; let text = '', finish = null, deltas = 0;
		for await (const part of stream) {
			const d = part.choices[0]?.delta; if (d?.content) { text += d.content; }
			for (const tc of d?.tool_calls ?? []) { deltas++; const c = (calls[tc.index] ??= { name: '', args: '' }); if (tc.function?.name) { c.name += tc.function.name; } if (tc.function?.arguments) { c.args += tc.function.arguments; } }
			if (part.choices[0]?.finish_reason) { finish = part.choices[0].finish_reason; }
		}
		check('tool-call finish_reason is tool_calls', finish === 'tool_calls');
		check('text and two parallel tool calls arrive', text === 'Running it.' && Object.keys(calls).length === 2);
		check('tool-call arguments were split across several deltas yet parse as the exact JSON', deltas > 4 && JSON.parse(calls[0].args).command === 'echo "hi there" && ls -la' && JSON.parse(calls[0].args).cwd === '/tmp/x y' && JSON.parse(calls[1].args).uri === 'C:\\a\\b.txt', `${deltas} deltas`);
	}
	// 3. non-streaming
	{
		const r = await client.chat.completions.create({ model: 'm', messages: [{ role: 'user', content: 'tool please' }] });
		check('non-streaming tool call response', r.choices[0].finish_reason === 'tool_calls' && r.choices[0].message.tool_calls.length === 2 && r.choices[0].message.content === 'Running it.');
	}
	// 4. errors surface as the SDK's typed errors, as with a real provider
	{
		let e1; try { await client.chat.completions.create({ model: 'm', messages: [{ role: 'user', content: 'boom' }] }); } catch (e) { e1 = e; }
		check('401 becomes OpenAI.APIError with status 401', e1 instanceof OpenAI.APIError && e1.status === 401, String(e1?.message).slice(0, 60));
		let e2; try { await client.chat.completions.create({ model: 'm', messages: [{ role: 'user', content: 'limit' }], maxRetries: 0 }, { maxRetries: 0 }); } catch (e) { e2 = e; }
		check('429 becomes RateLimitError', e2 instanceof OpenAI.RateLimitError, String(e2?.constructor?.name));
	}
	// 5. models + FIM
	{
		const m = await client.models.list();
		check('GET /models lists the model', m.data.some(x => x.id === 'vader-test-model'));
		const f = await client.completions.create({ model: 'm', prompt: 'abc', suffix: 'de' });
		check('POST /completions (fill-in-the-middle)', f.choices[0].text === '/*fim:3:2*/');
	}
	// 6. server records what the client sent (tests assert on it)
	{
		const sent = server.chatRequests().filter(r => r.ctx.lastUser === 'hi');
		check('server records the request the client sent', sent.length === 1 && sent[0].body.stream === true);
	}
} finally { await server.close(); }
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
