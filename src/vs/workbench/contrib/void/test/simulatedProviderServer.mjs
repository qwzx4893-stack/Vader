#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Vader addition, part of the final production-readiness validation pass. TEST-ONLY
// infrastructure - never imported by any production code path, never registered as a Vader
// provider, and not shipped in any packaged build (it lives under test/, like
// clineRuntimeSmoke.mjs and openRouterE2E.mjs, which are excluded from the build the same way).
//
// A minimal, deterministic, local HTTP server speaking the same wire protocol Vader's real
// OpenAI-compatible transport (electron-main/llmMessage/sendLLMMessage.impl.js's
// newOpenAICompatibleSDK/_sendOpenAICompatibleChat, via the official `openai` npm SDK) actually
// speaks - POST /v1/chat/completions (streaming SSE and non-streaming), GET /v1/models. This
// lets Vader's REAL, unmodified provider networking/streaming/parsing code be exercised end to
// end without any external network access, addressing the OpenRouter network block by testing
// the thing that's actually novel and at-risk (Vader's own code), not a third party's uptime.
//
// This is a DETERMINISTIC SIMULATION, not a real model - it never generates text, only replays
// a scripted queue of exact responses/faults. It proves Vader's architecture (streaming parsing,
// tool-call handling, error handling, retries, cancellation, resource cleanup) is correct; it
// proves nothing about any real model's actual intelligence or a real provider's production
// reliability. Every consumer of this file must keep that distinction explicit (see
// docs/integrations/providers/production-simulation.md).

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

/**
 * @typedef {
 *   | { type: 'text', text: string }
 *   | { type: 'tool_calls', calls: { name: string, arguments: object }[] }
 *   | { type: 'http_error', status: number, code?: string, message?: string }
 *   | { type: 'rate_limit', retryAfterSeconds?: number }
 *   | { type: 'context_limit' }
 *   | { type: 'model_not_found' }
 *   | { type: 'auth_error' }
 *   | { type: 'malformed' }
 *   | { type: 'connection_reset' }
 *   | { type: 'hang' }
 *   | { type: 'truncated_stream', text: string }
 *   | { type: 'delay_then', ms: number, then: object }
 * } Scenario
 */

function sseChunk(res, obj) {
	res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

function openAIErrorBody(status, code, message) {
	return JSON.stringify({ error: { message, type: code, code, status } });
}

/**
 * Creates a local, deterministic OpenAI-compatible chat-completions server.
 * @param {Scenario[]} scenarios - popped in order, one per /v1/chat/completions request. If the
 *   queue is exhausted, defaults to a plain `{type:'text', text:'(default simulated response)'}`.
 * @returns {Promise<{ url: string, requests: any[], close: () => Promise<void> }>}
 */
export function createSimulatedProvider(scenarios = []) {
	const queue = [...scenarios];
	const requests = []; // every request body this server received - inspectable by tests

	const handleScenario = async (req, res, body, scenario) => {
		if (scenario.type === 'delay_then') {
			await new Promise(r => setTimeout(r, scenario.ms));
			return handleScenario(req, res, body, scenario.then);
		}
		if (scenario.type === 'connection_reset') {
			req.socket.destroy();
			return;
		}
		if (scenario.type === 'hang') {
			// deliberately never respond - the caller must time out or cancel
			return;
		}
		if (scenario.type === 'malformed') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end('{ this is not valid JSON,,,');
			return;
		}
		if (scenario.type === 'http_error') {
			res.writeHead(scenario.status, { 'Content-Type': 'application/json' });
			res.end(openAIErrorBody(scenario.status, scenario.code ?? 'error', scenario.message ?? 'Simulated error'));
			return;
		}
		if (scenario.type === 'rate_limit') {
			res.writeHead(429, { 'Content-Type': 'application/json', ...(scenario.retryAfterSeconds ? { 'Retry-After': String(scenario.retryAfterSeconds) } : {}) });
			res.end(openAIErrorBody(429, 'rate_limit_exceeded', 'Rate limit exceeded (simulated).'));
			return;
		}
		if (scenario.type === 'context_limit') {
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(openAIErrorBody(400, 'context_length_exceeded', "This model's maximum context length is exceeded (simulated)."));
			return;
		}
		if (scenario.type === 'model_not_found') {
			res.writeHead(404, { 'Content-Type': 'application/json' });
			res.end(openAIErrorBody(404, 'model_not_found', 'The model does not exist (simulated).'));
			return;
		}
		if (scenario.type === 'auth_error') {
			res.writeHead(401, { 'Content-Type': 'application/json' });
			res.end(openAIErrorBody(401, 'invalid_api_key', 'Incorrect API key provided (simulated).'));
			return;
		}
		if (scenario.type === 'truncated_stream') {
			res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
			const id = `chatcmpl-${randomUUID()}`;
			sseChunk(res, { id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: scenario.text.slice(0, 3) } }] });
			// abruptly end the response without a [DONE] or finish_reason - a truncated stream
			res.socket.destroy();
			return;
		}

		const isStream = !!body.stream;
		const id = `chatcmpl-${randomUUID()}`;
		const created = Math.floor(Date.now() / 1000);
		const model = body.model ?? 'simulated-model';

		if (scenario.type === 'tool_calls') {
			const tool_calls = scenario.calls.map((c, i) => ({ index: i, id: `call_${randomUUID()}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) } }));
			if (isStream) {
				res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
				sseChunk(res, { id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: tool_calls.map(tc => ({ ...tc, function: { ...tc.function } })) }, finish_reason: null }] });
				sseChunk(res, { id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
				res.write('data: [DONE]\n\n');
				res.end();
			} else {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ id, object: 'chat.completion', created, model, choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
			}
			return;
		}

		// default / 'text'
		const text = scenario.text ?? '(default simulated response)';
		if (isStream) {
			res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
			sseChunk(res, { id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
			// stream word-by-word so real incremental parsing is exercised, not just one blob
			const words = text.split(' ');
			for (let i = 0; i < words.length; i++) {
				sseChunk(res, { id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: (i > 0 ? ' ' : '') + words[i] }, finish_reason: null }] });
			}
			sseChunk(res, { id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
			res.write('data: [DONE]\n\n');
			res.end();
		} else {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ id, object: 'chat.completion', created, model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
		}
	};

	const server = createServer((req, res) => {
		if (req.method === 'GET' && req.url === '/v1/models') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ object: 'list', data: [{ id: 'simulated-model', object: 'model' }] }));
			return;
		}
		if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
			res.writeHead(404);
			res.end();
			return;
		}
		const chunks = [];
		req.on('data', c => chunks.push(c));
		req.on('end', () => {
			let body = {};
			try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* handled as empty body */ }
			requests.push(body);
			const scenario = queue.shift() ?? { type: 'text', text: '(default simulated response)' };
			handleScenario(req, res, body, scenario).catch(e => {
				try { res.writeHead(500); res.end(String(e)); } catch { /* socket already gone */ }
			});
		});
	});

	return new Promise((resolve, reject) => {
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			resolve({
				url: `http://127.0.0.1:${port}/v1`,
				requests,
				push: (s) => queue.push(s),
				close: () => new Promise((res) => server.close(() => res())),
			});
		});
		server.on('error', reject);
	});
}
