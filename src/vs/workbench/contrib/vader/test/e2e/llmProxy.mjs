/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// TEST-ONLY. A local OpenAI-compatible proxy in front of OpenRouter for benchmark runs. The app talks to it as it would to any provider; the proxy
//   - adds `usage: { include: true }` so OpenRouter reports the real cost of every request, and logs tokens/cost/latency per request (JSONL),
//   - keeps a running total and, once `budgetUsd` is spent, swaps the paid model for `fallbackModel` (a :free model) so a run never overspends,
//   - retries 429/5xx (the free tier is rate limited) with backoff, so a rate limit does not look like an agent failure,
//   - never writes the API key anywhere (it is read from the environment by the caller).
// The model the APP is configured with stays the same for the whole run; `served` in the log says which model really answered.

import fs from 'node:fs';
import http from 'node:http';

export async function createLlmProxy({ apiKey, upstream = 'https://openrouter.ai/api/v1', model, fallbackModel, budgetUsd = 0, logFile, maxRetries = 6, transform }) {
	if (!apiKey) { throw new Error('createLlmProxy: apiKey is required'); }
	const state = { spentUsd: 0, requests: 0, promptTokens: 0, completionTokens: 0, byModel: {}, retries: 0, failures: 0, lastActivityAt: Date.now(), inFlight: 0, swapped: 0 };
	const log = (o) => { if (logFile) { try { fs.appendFileSync(logFile, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n'); } catch { /* best effort */ } } };
	const sleep = (ms) => new Promise(r => setTimeout(r, ms));
	const refuse = (res, message) => { res.writeHead(429, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message, code: 429 } })); log({ kind: 'refused', message }); };
	const paidAllowed = () =>!!model && !model.endsWith(':free') && state.spentUsd < budgetUsd;

	const server = http.createServer(async (req, res) => {
		const chunks = [];
		state.lastActivityAt = Date.now();
		state.inFlight++; // a request that is waiting for the model (including its 429 back-off) is the model's time, not the agent stalling
		res.on('close', () => { state.inFlight--; state.lastActivityAt = Date.now(); });
		for await (const c of req) { chunks.push(c); }
		const raw = Buffer.concat(chunks);
		const url = new URL(req.url, 'http://x');
		const target = upstream + url.pathname.replace(/^\/v1/, '');
		const isChat = req.method === 'POST' && /\/chat\/completions$/.test(url.pathname);
		let body = raw;
		let served = null;
		if (isChat) {
			try {
				const j = JSON.parse(raw.toString('utf8'));
				if (transform) { state.swapped += transform(j) || 0; } // e.g. promptSwap.mjs: the source tree's instructions in place of the installed app's
				const wantsPaid = !!model && !model.endsWith(':free');
				if (state.dailyFreeExhausted && (!wantsPaid || !paidAllowed()) && (fallbackModel ?? model ?? '').endsWith(':free')) { return refuse(res, 'proxy: the free-model daily quota is exhausted'); }
				if (wantsPaid && !paidAllowed() && !fallbackModel) { state.budgetExhausted = true; return refuse(res, 'proxy: the benchmark budget is spent'); } // never spend past the budget
				served = paidAllowed() ? (model ?? j.model) : (fallbackModel ?? model ?? j.model);
				j.model = served;
				j.usage = { include: true };
				if (j.stream) { j.stream_options = { ...(j.stream_options ?? {}), include_usage: true }; }
				body = Buffer.from(JSON.stringify(j));
			} catch { /* forward as is */ }
		}
		const headers = { 'content-type': req.headers['content-type'] ?? 'application/json', authorization: `Bearer ${apiKey}`, 'x-title': 'Vader benchmark', 'http-referer': 'https://github.com/qwzx4893-stack/Vader' };
		const t0 = Date.now();
		let upstreamRes;
		for (let attempt = 0; ; attempt++) {
			try {
				upstreamRes = await fetch(target, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
			} catch (e) {
				if (attempt >= maxRetries) { state.failures++; res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: `proxy: upstream unreachable: ${e.message}` } })); log({ kind: 'error', served, message: e.message }); return; }
				state.retries++; await sleep(Math.min(30_000, 1500 * 2 ** attempt)); continue;
			}
			if (upstreamRes.status === 429) {
				// the daily free quota: waiting does not help and every retry is counted against it, so say so at once
				const peek = await upstreamRes.clone().text().catch(() => '');
				if (/free-models-per-day|daily/i.test(peek)) { state.dailyFreeExhausted = true; log({ kind: 'daily-free-quota-exhausted', served }); break; }
			}
			if ((upstreamRes.status === 429 || upstreamRes.status >= 500) && attempt < maxRetries) {
				state.retries++;
				const ra = Number(upstreamRes.headers.get('retry-after'));
				await upstreamRes.arrayBuffer().catch(() => { });
				await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(60_000, ra * 1000) : Math.min(30_000, 2000 * 2 ** attempt));
				continue;
			}
			break;
		}
		const outHeaders = { 'content-type': upstreamRes.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-cache' };
		res.writeHead(upstreamRes.status, outHeaders);
		let tail = '';
		let whole = '';
		const reader = upstreamRes.body?.getReader();
		if (reader) {
			for (; ;) {
				const { done, value } = await reader.read();
				if (done) { break; }
				res.write(value); state.lastActivityAt = Date.now();
				const s = Buffer.from(value).toString('utf8');
				if (isChat) { tail = (tail + s).slice(-6000); if (!outHeaders['content-type'].includes('event-stream')) { whole += s; } }
			}
		}
		res.end();
		if (isChat) {
			const src = whole || tail;
			const m = (re) => { const all = [...src.matchAll(re)]; return all.length ? Number(all[all.length - 1][1]) : 0; };
			const cost = m(/"cost":\s*([0-9.eE+-]+)/g);
			const pt = m(/"prompt_tokens":\s*(\d+)/g);
			const ct = m(/"completion_tokens":\s*(\d+)/g);
			state.requests++; state.spentUsd += cost; state.promptTokens += pt; state.completionTokens += ct;
			state.byModel[served] = (state.byModel[served] ?? 0) + 1;
			log({ kind: 'chat', served, status: upstreamRes.status, ms: Date.now() - t0, promptTokens: pt, completionTokens: ct, costUsd: cost, spentUsd: Number(state.spentUsd.toFixed(6)) });
		}
	});
	await new Promise(r => server.listen(0, '127.0.0.1', r));
	const port = server.address().port;
	return { url: `http://127.0.0.1:${port}/v1`, state, close: () => new Promise(r => server.close(() => r())) };
}
