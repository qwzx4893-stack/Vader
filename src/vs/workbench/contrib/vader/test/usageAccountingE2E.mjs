#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What a task cost: token counts read from the provider's answer, priced, and added up per task and per day (common/usageAccounting.ts).
// Two parts: the arithmetic, and the real OpenAI-compatible transport reading counts from a streamed answer (against the local simulated provider).
// Run: node src/vs/workbench/contrib/vader/test/usageAccountingE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSimulatedProvider } from './simulatedProviderServer.mjs';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const tmp = fs.mkdtempSync(path.join(repo, 'node_modules', '.vader-usage-'));
const load = async (rel, name, extra = {}) => {
	await esbuild.build({ entryPoints: [path.join(here, rel)], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, name), logLevel: 'silent', ...extra });
	return import(pathToFileURL(path.join(tmp, name)).href);
};

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const near = (a, b) => Math.abs(a - b) < 1e-9;

try {
	const U = await load('../common/usageAccounting.ts', 'u.mjs');

	// ---- the arithmetic
	const price = { input: 3, output: 15, cache_read: 0.3 };
	check('a turn is priced per million tokens', near(U.costOfUsage({ inputTokens: 1_000_000, outputTokens: 100_000 }, price, false), 3 + 1.5));
	check('cached input is priced at the cache rate', near(U.costOfUsage({ inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 800_000 }, price, false), 0.2 * 3 + 0.8 * 0.3));
	check('a model with no cache rate pays the input rate for cached tokens', near(U.costOfUsage({ inputTokens: 1000, outputTokens: 0, cachedInputTokens: 500 }, { input: 2, output: 8 }, false), 1000 * 2 / 1e6));
	check('a local model is free, not unknown', U.costOfUsage({ inputTokens: 5000, outputTokens: 900 }, { input: 0, output: 0 }, true) === 0);
	check('a cloud model with no price is unknown, never zero', U.costOfUsage({ inputTokens: 5000, outputTokens: 900 }, { input: 0, output: 0 }, false) === undefined && U.costOfUsage({ inputTokens: 1, outputTokens: 1 }, undefined, false) === undefined);
	check('cached tokens cannot exceed the input', U.normalizeUsage({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 99 }).cachedInputTokens === 10);
	check('counts that are not numbers are not usage', U.normalizeUsage({ inputTokens: 'x', outputTokens: 5 }) === undefined && U.normalizeUsage({ inputTokens: -1, outputTokens: 5 }) === undefined && U.normalizeUsage(undefined) === undefined && U.normalizeUsage({ inputTokens: NaN, outputTokens: 1 }) === undefined);

	let t = U.addTurnToThreadUsage(undefined, { inputTokens: 1000, outputTokens: 200 }, 0.01);
	t = U.addTurnToThreadUsage(t, { inputTokens: 2000, outputTokens: 300, cachedInputTokens: 500 }, undefined);
	t = U.addTurnToThreadUsage(t, undefined, undefined);
	check('a task adds its turns up', t.turns === 3 && t.inputTokens === 3000 && t.outputTokens === 500 && t.cachedInputTokens === 500 && near(t.costUsd, 0.01));
	check('a turn that could not be priced is counted, not hidden', t.unpricedTurns === 1);
	check('a turn without token counts is counted, not guessed', t.turnsWithoutUsage === 1);

	// ---- the day
	const d1 = U.dayKey(new Date(2026, 9, 14, 23, 59));
	check('a day is the local calendar day', d1 === '2026-10-14' && U.dayKey(new Date(2026, 0, 5)) === '2026-01-05');
	let ledger = {};
	ledger = U.addToLedger(ledger, d1, { inputTokens: 100, outputTokens: 50 }, 0.25);
	ledger = U.addToLedger(ledger, d1, { inputTokens: 100, outputTokens: 50 }, undefined);
	ledger = U.addToLedger(ledger, '2026-10-15', { inputTokens: 1, outputTokens: 1 }, 0.5);
	check('the day adds up, and each day is its own', near(U.spentOn(ledger, d1), 0.25) && ledger[d1].inputTokens === 200 && ledger[d1].unpricedTurns === 1 && near(U.spentOn(ledger, '2026-10-15'), 0.5) && U.spentOn(ledger, '2020-01-01') === 0);
	let long = {};
	for (let i = 1; i <= 90; i++) long = U.addToLedger(long, `2026-${i <= 31 ? '07' : i <= 62 ? '08' : '09'}-${String(((i - 1) % 31) + 1).padStart(2, '0')}`, { inputTokens: 1, outputTokens: 1 }, 0.01);
	check('the ledger keeps about two months and no more', Object.keys(long).length <= 62);
	check('a stored ledger is read back, and nonsense is dropped', JSON.stringify(U.parseLedger({ '2026-10-14': { costUsd: 1, inputTokens: 2, outputTokens: 3 }, bad: { costUsd: 1 }, '2026-10-15': 'x' })) === '{"2026-10-14":{"costUsd":1,"inputTokens":2,"outputTokens":3,"unpricedTurns":0}}' && JSON.stringify(U.parseLedger(null)) === '{}');

	// ---- the limit
	check('no limit means no state', U.budgetState(100, null) === 'none' && U.budgetState(100, 0) === 'none');
	check('the limit warns at 80% and stops at 100%', U.budgetState(7.9, 10) === 'ok' && U.budgetState(8, 10) === 'near' && U.budgetState(9.99, 10) === 'near' && U.budgetState(10, 10) === 'over');
	check('money and tokens read well', U.formatUsd(0.314) === '$0.31' && U.formatUsd(0.004) === '<$0.01' && U.formatUsd(0) === '$0.00' && U.formatTokens(1234) === '1K' && U.formatTokens(2_500_000) === '2.5M' && U.formatTokens(87) === '87');

	// ---- the real transport reads counts from a streamed answer
	const impl = await load('../electron-main/llmMessage/sendLLMMessage.impl.ts', 'impl.mjs', { packages: 'external' });
	const send = (provider, url, sim) => new Promise((resolve) => {
		const settingsOfProvider = provider === 'ollama' ? { ollama: { endpoint: url.replace(/\/v1$/, '') } } : { openAICompatible: { apiKey: 'sk-fake', endpoint: url, headersJSON: '{}' } };
		impl.sendLLMMessageToProviderImplementation[provider].sendChat({
			messages: [{ role: 'user', content: 'hi' }], providerName: provider, settingsOfProvider, modelSelectionOptions: undefined,
			overridesOfModel: { [provider]: { 'simulated-model': { specialToolFormat: 'openai-style' } } }, modelName: 'simulated-model',
			separateSystemMessage: undefined, chatMode: 'agent', mcpTools: undefined, _setAborter: () => { },
			onText: () => { }, onFinalMessage: (r) => resolve({ ok: true, ...r }), onError: (e) => resolve({ ok: false, message: e.message }),
		}).catch((e) => resolve({ ok: false, message: String(e) }));
	});
	const sim = await createSimulatedProvider([
		{ type: 'text', text: 'hello there world', usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, prompt_tokens_details: { cached_tokens: 40 } } },
		{ type: 'text', text: 'no counts here' },
		{ type: 'text', text: 'local answer', usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } },
	]);
	const a = await send('openAICompatible', sim.url);
	check('counts a provider sends unasked are read', a.ok && a.usage?.inputTokens === 120 && a.usage?.outputTokens === 30 && a.usage?.cachedInputTokens === 40, JSON.stringify(a));
	check('the text still arrives whole', a.fullText === 'hello there world', a.fullText);
	check('a provider outside the short list is not sent stream_options', sim.requests[0].stream_options === undefined);
	const b = await send('openAICompatible', sim.url);
	check('an answer without counts has no usage, not a guess', b.ok && b.usage === undefined && b.fullText === 'no counts here', JSON.stringify(b));
	const c = await send('ollama', sim.url);
	check('a listed provider is asked for the counts', sim.requests[2]?.stream_options?.include_usage === true, JSON.stringify(sim.requests[2]?.stream_options));
	check('and they are read', c.ok && c.usage?.inputTokens === 7 && c.usage?.outputTokens === 3, JSON.stringify(c));
	await sim.close();
} finally {
	fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
