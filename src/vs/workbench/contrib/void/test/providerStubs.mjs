/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// TEST-ONLY. Local servers that speak the REAL wire formats of the providers whose official SDKs Vader uses, so the
// real SDK + real Vader code can be exercised end to end without a key:
//   anthropic  POST /v1/messages (server-sent events: message_start / content_block_* / message_delta / message_stop)
//   gemini     POST /v1beta/models/{m}:streamGenerateContent?alt=sse (SSE of candidates/parts) and :generateContent
//   mistral    POST /v1/fim/completions (JSON), POST /v1/chat/completions (SSE, OpenAI shape)
//   ollama     GET /api/tags, POST /api/generate
// Each stub records every request (path, headers, parsed body) so a test can assert what the SDK really sent, and answers
// with whatever the test scripts. See providerSdkE2E.mjs.

import http from 'node:http';

const sse = (res, event, data) => { res.write(`${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`); };
const chunksOf = (text, n = 6) => { const out = []; for (let i = 0; i < text.length; i += n) { out.push(text.slice(i, i + n)); } return out; };

function serve(handler) {
	const requests = [];
	const server = http.createServer((req, res) => {
		const parts = [];
		req.on('data', c => parts.push(c));
		req.on('end', async () => {
			let body = null;
			const raw = Buffer.concat(parts).toString('utf8');
			try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
			const entry = { method: req.method, url: req.url, path: (req.url ?? '').split('?')[0], headers: req.headers, body };
			requests.push(entry);
			try { await handler(entry, res); } catch (e) { res.writeHead(500); res.end(String(e)); }
		});
	});
	return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
		url: `http://127.0.0.1:${server.address().port}`, port: server.address().port, requests,
		reset: () => { requests.length = 0; },
		close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }),
	})));
}

/** step: { text?, thinking?, toolCalls?: [{ name, args }], status?, errorBody?, stallAfterText?: boolean } */
export async function createAnthropicStub(getStep) {
	return serve((req, res) => {
		if (req.method === 'GET' && req.path.endsWith('/v1/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [], has_more: false })); return; }
		const step = getStep(req);
		if (step.status && step.status !== 200) {
			res.writeHead(step.status, { 'content-type': 'application/json' });
			res.end(JSON.stringify(step.errorBody ?? { type: 'error', error: { type: step.status === 401 ? 'authentication_error' : 'api_error', message: 'stub error' } }));
			return;
		}
		res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
		sse(res, 'message_start', { type: 'message_start', message: { id: 'msg_stub', type: 'message', role: 'assistant', model: req.body?.model ?? 'claude-stub', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 25, output_tokens: 1 } } });
		let index = 0;
		if (step.thinking) {
			sse(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
			for (const c of chunksOf(step.thinking)) { sse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: c } }); }
			sse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'sig-stub-123' } });
			sse(res, 'content_block_stop', { type: 'content_block_stop', index }); index++;
		}
		if (step.text) {
			sse(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
			for (const c of chunksOf(step.text)) { sse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: c } }); }
			sse(res, 'content_block_stop', { type: 'content_block_stop', index }); index++;
		}
		for (const tc of step.toolCalls ?? []) {
			sse(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: `toolu_${index}`, name: tc.name, input: {} } });
			for (const c of chunksOf(JSON.stringify(tc.args ?? {}), 5)) { sse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: c } }); }
			sse(res, 'content_block_stop', { type: 'content_block_stop', index }); index++;
		}
		sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: step.toolCalls?.length ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } });
		sse(res, 'message_stop', { type: 'message_stop' });
		res.end();
	});
}

export async function createGeminiStub(getStep) {
	return serve((req, res) => {
		const step = getStep(req);
		if (step.status && step.status !== 200) {
			res.writeHead(step.status, { 'content-type': 'application/json' });
			res.end(JSON.stringify(step.errorBody ?? { error: { code: step.status, message: step.status === 400 ? 'API key not valid. Please pass a valid API key.' : 'stub error', status: step.status === 400 ? 'INVALID_ARGUMENT' : 'INTERNAL' } }));
			return;
		}
		const parts = [];
		if (step.thinking) { for (const c of chunksOf(step.thinking, 8)) { parts.push({ text: c, thought: true }); } }
		if (step.text) { for (const c of chunksOf(step.text)) { parts.push({ text: c }); } }
		for (const tc of step.toolCalls ?? []) { parts.push({ functionCall: { name: tc.name, args: tc.args ?? {} } }); }
		const usageMetadata = { promptTokenCount: 30, candidatesTokenCount: 12, totalTokenCount: 42 };
		if (/:streamGenerateContent/.test(req.path)) {
			res.writeHead(200, { 'content-type': 'text/event-stream' });
			parts.forEach((p, i) => {
				const last = i === parts.length - 1;
				res.write(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [p] }, index: 0, ...(last ? { finishReason: 'STOP' } : {}) }], ...(last ? { usageMetadata } : {}), modelVersion: 'gemini-stub' })}\r\n\r\n`);
			});
			res.end();
		} else {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP', index: 0 }], usageMetadata }));
		}
	});
}

export async function createMistralStub(getFim) {
	return serve((req, res) => {
		if (req.path.endsWith('/fim/completions')) {
			const text = getFim(req);
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ id: 'fim-1', object: 'chat.completion', model: req.body?.model, created: 1, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }));
			return;
		}
		res.writeHead(404); res.end();
	});
}

export async function createOllamaStub({ models = ['qwen2.5-coder:1.5b', 'llama3.1:8b'], getGenerate = () => '' } = {}) {
	return serve((req, res) => {
		if (req.method === 'GET' && req.path === '/api/tags') {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ models: models.map(name => ({ name, model: name, modified_at: '2026-01-01T00:00:00Z', size: 1, digest: 'd', details: { family: 'x' } })) }));
			return;
		}
		if (req.path === '/api/generate') {
			res.writeHead(200, { 'content-type': 'application/x-ndjson' });
			res.end(JSON.stringify({ model: req.body?.model, created_at: '2026-01-01T00:00:00Z', response: getGenerate(req), done: true, done_reason: 'stop' }) + '\n');
			return;
		}
		res.writeHead(404); res.end();
	});
}
