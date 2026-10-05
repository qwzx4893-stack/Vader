/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// TEST-ONLY. A local, protocol-faithful stand-in for an OpenAI-compatible model endpoint, used to drive
// the REAL packaged Vader app through its UI without needing an API key.
//
// What it is: the same wire protocol the official `openai` SDK (which Vader's provider code uses) speaks -
// `POST /v1/chat/completions` (SSE streaming and plain JSON), `POST /v1/completions` (fill-in-the-middle),
// `GET /v1/models` - with the details real servers produce: token-sized content deltas, a role-only first
// chunk, tool-call deltas whose JSON arguments arrive split across many chunks, `finish_reason`, the optional
// trailing usage chunk, and `[DONE]`.
//
// What it is not: a model. It never invents text. Each test supplies a responder that looks at the request
// (messages, tools, tool results) and returns exactly what a model would have said or which tools it would
// have called. That makes the whole agent loop - tool execution, approvals, policy denial, retries, UI
// updates - testable with exact assertions. Realism against genuine model output is covered separately by
// running the same app against a real local LLM (see ollamaSuite / the windows-e2e workflow).

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

/** Small deterministic PRNG so chunk sizes are irregular (like real tokens) but reproducible. */
function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6D2B79F5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function tokenize(text, rand) {
	const out = [];
	let i = 0;
	while (i < text.length) {
		const n = 1 + Math.floor(rand() * 6);
		out.push(text.slice(i, i + n));
		i += n;
	}
	return out;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * @typedef {{ role: string, content?: any, tool_calls?: any[], tool_call_id?: string, name?: string }} ChatMessage
 * @typedef {{
 *   messages: ChatMessage[], tools: any[], model: string, body: any,
 *   lastUser: string, lastUserFull: string, toolResults: { name?: string, content: string, tool_call_id?: string }[],
 *   lastToolResult: string | undefined, assistantTurns: number, requestIndex: number, system: string,
 *   lastMessage: ChatMessage | undefined, lastMessageText: string, allText: string
 * }} Ctx
 * @typedef {
 *   | { text: string, toolCalls?: { name: string, args?: object }[], msPerChunk?: number }
 *   | { toolCalls: { name: string, args?: object }[], text?: string, msPerChunk?: number }
 *   | { error: { status: number, code?: string, message?: string } }
 *   | { hang: true }
 *   | { reset: true }
 *   | { stallAfter: string }
 * } Step
 */

function textOf(content) {
	if (typeof content === 'string') { return content; }
	if (Array.isArray(content)) { return content.map(p => typeof p === 'string' ? p : (p?.text ?? '')).join(''); }
	return '';
}

function buildCtx(body, requestIndex) {
	const messages = body.messages ?? [];
	const users = messages.filter(m => m.role === 'user');
	const lastUserFull = users.length ? textOf(users[users.length - 1].content) : '';
	// Vader wraps the user's text with selections/context; tests match with `includes`, and `lastUser` is trimmed.
	const lastUser = lastUserFull.trim();
	// tool results that came AFTER the last assistant turn that made tool calls
	let lastAssistantIdx = -1;
	messages.forEach((m, i) => { if (m.role === 'assistant') { lastAssistantIdx = i; } });
	const toolResults = messages.slice(lastAssistantIdx + 1).filter(m => m.role === 'tool').map(m => ({ name: m.name, content: textOf(m.content), tool_call_id: m.tool_call_id }));
	// Also support models/clients that send tool results as user messages (Anthropic-style conversion)
	const system = messages.filter(m => m.role === 'system' || m.role === 'developer').map(m => textOf(m.content)).join('\n');
	const lastMessage = messages[messages.length - 1];
	return {
		lastMessage, lastMessageText: lastMessage ? textOf(lastMessage.content) : '',
		allText: messages.map(m => textOf(m.content)).join('\n'),
		messages, tools: body.tools ?? [], model: body.model, body, lastUser, lastUserFull, toolResults,
		lastToolResult: toolResults.length ? toolResults[toolResults.length - 1].content : undefined,
		assistantTurns: messages.filter(m => m.role === 'assistant').length, requestIndex, system,
	};
}

/**
 * Creates the server. `responder(ctx)` returns a Step (or a Promise of one). It can be swapped at any time with
 * `setResponder`. `fimResponder({prompt, suffix, body})` returns a string for /v1/completions.
 */
export function createModelServer({ responder, fimResponder, seed = 1234, modelIds = ['vader-test-model'] } = {}) {
	let currentResponder = responder ?? (() => ({ text: 'OK' }));
	let currentFim = fimResponder ?? (() => '');
	const requests = []; // { path, body, ctx?, at }
	const rand = mulberry32(seed);
	const sockets = new Set();

	const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

	async function streamStep(res, body, step) {
		const id = `chatcmpl-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
		const created = Math.floor(Date.now() / 1000);
		const model = body.model ?? modelIds[0];
		const base = { id, object: 'chat.completion.chunk', created, model, system_fingerprint: 'fp_vader_test' };
		const msPerChunk = step.msPerChunk ?? 0;
		res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
		sse(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, logprobs: null, finish_reason: null }] });

		if (step.text) {
			const toks = tokenize(step.text, rand);
			for (let i = 0; i < toks.length; i++) {
				sse(res, { ...base, choices: [{ index: 0, delta: { content: toks[i] }, logprobs: null, finish_reason: null }] });
				if (step.stallAfter !== undefined && step.text.slice(0, toks.slice(0, i + 1).join('').length).includes(step.stallAfter)) { return 'stalled'; }
				if (msPerChunk) { await sleep(msPerChunk); }
			}
		}
		if (step.toolCalls?.length) {
			for (let i = 0; i < step.toolCalls.length; i++) {
				const tc = step.toolCalls[i];
				const callId = `call_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
				const args = JSON.stringify(tc.args ?? {});
				sse(res, { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: callId, type: 'function', function: { name: tc.name, arguments: '' } }] }, logprobs: null, finish_reason: null }] });
				for (const part of tokenize(args, rand)) {
					sse(res, { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: i, function: { arguments: part } }] }, logprobs: null, finish_reason: null }] });
					if (msPerChunk) { await sleep(msPerChunk); }
				}
			}
		}
		sse(res, { ...base, choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: step.toolCalls?.length ? 'tool_calls' : 'stop' }] });
		if (body.stream_options?.include_usage) {
			sse(res, { ...base, choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
		}
		res.write('data: [DONE]\n\n');
		res.end();
		return 'done';
	}

	function jsonStep(res, body, step) {
		const id = `chatcmpl-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
		const tool_calls = step.toolCalls?.map(tc => ({ id: `call_${randomUUID().replace(/-/g, '').slice(0, 24)}`, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) } }));
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({
			id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: body.model ?? modelIds[0],
			choices: [{ index: 0, message: { role: 'assistant', content: step.text ?? null, ...(tool_calls?.length ? { tool_calls } : {}) }, finish_reason: tool_calls?.length ? 'tool_calls' : 'stop' }],
			usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
		}));
	}

	const server = createServer((req, res) => {
		const url = (req.url ?? '').split('?')[0];
		if (req.method === 'GET' && url.endsWith('/models')) {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ object: 'list', data: modelIds.map(id => ({ id, object: 'model', created: 0, owned_by: 'vader-test' })) }));
			return;
		}
		if (req.method !== 'POST') { res.writeHead(404); res.end(); return; }
		const chunks = [];
		req.on('data', c => chunks.push(c));
		req.on('end', async () => {
			let body = {};
			try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* empty */ }
			const entry = { path: url, body, at: Date.now() };
			requests.push(entry);
			try {
				if (url.endsWith('/chat/completions')) {
					const ctx = buildCtx(body, requests.filter(r => r.path.endsWith('/chat/completions')).length - 1);
					entry.ctx = ctx;
					const step = await currentResponder(ctx);
					entry.step = step;
					if (step?.error) {
						const { status, code = 'error', message = 'error' } = step.error;
						res.writeHead(status, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: { message, type: code, code } }));
						return;
					}
					if (step?.hang) { return; }
					if (step?.reset) { req.socket.destroy(); return; }
					if (body.stream) { await streamStep(res, body, step ?? { text: 'OK' }); } else { jsonStep(res, body, step ?? { text: 'OK' }); }
					return;
				}
				if (url.endsWith('/completions')) {
					const text = await currentFim({ prompt: body.prompt ?? '', suffix: body.suffix ?? '', body });
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ id: `cmpl-${randomUUID().slice(0, 12)}`, object: 'text_completion', created: Math.floor(Date.now() / 1000), model: body.model ?? modelIds[0], choices: [{ text, index: 0, logprobs: null, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
					return;
				}
				res.writeHead(404); res.end();
			} catch (e) {
				try { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: String(e) } })); } catch { /* socket gone */ }
			}
		});
	});
	server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

	return new Promise((resolve, reject) => {
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			resolve({
				url: `http://127.0.0.1:${port}/v1`,
				port,
				requests,
				chatRequests: () => requests.filter(r => r.path.endsWith('/chat/completions')),
				setResponder: (fn) => { currentResponder = fn; },
				setFim: (fn) => { currentFim = fn; },
				reset: () => { requests.length = 0; },
				close: () => new Promise(r => { for (const s of sockets) { s.destroy(); } server.close(() => r()); }),
			});
		});
	});
}

/**
 * Convenience: build a responder from ordered rules. The first rule whose `when(ctx)` is truthy answers;
 * `reply` is a Step or a function of ctx. Falls through to `fallback`.
 */
export function rules(list, fallback = () => ({ text: 'OK' })) {
	return (ctx) => {
		for (const r of list) {
			if (r.when(ctx)) { return typeof r.reply === 'function' ? r.reply(ctx) : r.reply; }
		}
		return typeof fallback === 'function' ? fallback(ctx) : fallback;
	};
}

/** Responder that answers request N (0-based, counted from the last server.reset()) with step N; the last step repeats. */
export function seq(steps) {
	return (ctx) => {
		const step = steps[Math.min(ctx.requestIndex, steps.length - 1)];
		return typeof step === 'function' ? step(ctx) : step;
	};
}
