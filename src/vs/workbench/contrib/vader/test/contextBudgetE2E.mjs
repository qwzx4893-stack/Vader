#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// How a growing conversation is kept inside the model's window: prune old tool output, then summarise, and only then the blind cut (common/contextBudget.ts).
// The bug this guards against: the blind cut started at HALF of the window (a reserve of half the window for the answer) while the careful summary started at 70% of the window
// and measured tool results as at most 2,000 characters, so the blind cut, which shrinks a message to 120 characters, ran first.
// Run: node src/vs/workbench/contrib/vader/test/contextBudgetE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-budget-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/contextBudget.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'b.mjs'), logLevel: 'silent' });
const B = await import(pathToFileURL(path.join(tmp, 'b.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

// ---- the yardstick
const windows = [8_192, 32_768, 128_000, 200_000, 1_000_000];
const reserves = [undefined, null, 4_096, 8_192, 32_768, 64_000];
const oldBudget = (cw, r) => Math.max((cw - Math.max(cw / 2, r ?? 4_096)) * 4, 5_000) // what the blind cut used before
let order = true, notStricter = true, floor = true;
for (const cw of windows) for (const r of reserves) {
	const budget = B.inputBudgetChars(cw, r);
	if (!(B.PRUNE_START_FRACTION < B.SUMMARISE_FRACTION && B.SUMMARISE_FRACTION < 1)) order = false;
	if (budget < oldBudget(cw, r)) notStricter = false;
	if (budget < 5_000) floor = false;
}
check('prune starts before summary, summary before the blind cut', order);
check('the budget is never smaller than the old one (the blind cut starts later, not sooner)', notStricter);
check('the budget keeps the 5,000-character floor', floor);
check('a quarter of the window is the reserve when the model asks for less', B.outputReserveTokens(128_000, 8_192) === 32_000);
check('...and the model\'s own figure wins when it is larger', B.outputReserveTokens(128_000, 64_000) === 64_000);
check('the old rule reserved half the window: a 128k window cut at 64k tokens, now at 96k', oldBudget(128_000, 8_192) === 256_000 && B.inputBudgetChars(128_000, 8_192) === 384_000);

// ---- a plan for a thread full of file reads
const user = (n = 200) => ({ role: 'user', size: n })
const asst = (n = 300) => ({ role: 'assistant', size: n })
const read = (n = 12_000, name = 'read_file') => ({ role: 'tool', size: n, prunable: true, toolName: name })
const opts = { contextWindow: 128_000, reservedOutputTokenSpace: 8_192 } // budget 384,000 characters

{
	const small = [user(), asst(), read(2_000), asst()]
	const p = B.planContextReduction(small, opts)
	check('a small thread: nothing is done', p.pruneIndexes.length === 0 && !p.summarise && p.freedChars === 0)
}
{
	// 1 user message + 40 reads of 12k = 480k characters: well over the budget
	const msgs = [user()]; for (let i = 0; i < 40; i++) { msgs.push(asst(), read()) }
	msgs.push(user(), asst(), read()) // the current exchange
	const p = B.planContextReduction(msgs, opts)
	check('a thread over the budget is pruned', p.pruneIndexes.length > 0, JSON.stringify(p));
	check('the newest reads stay (about a quarter of the budget)', !p.pruneIndexes.includes(msgs.length - 1) && !p.pruneIndexes.includes(msgs.length - 3));
	const kept = msgs.map((m, i) => ({ m, i })).filter(x => x.m.prunable && !p.pruneIndexes.includes(x.i)).reduce((n, x) => n + x.m.size, 0);
	check('what stays is at least the protected share', kept >= opts.contextWindow * 0 + p.budgetChars * B.PRUNE_PROTECT_FRACTION, `kept ${kept}`);
	check('only tool output is pruned', p.pruneIndexes.every(i => msgs[i].role === 'tool'));
	check('the oldest reads go first', Math.max(...p.pruneIndexes) < Math.min(...msgs.map((m, i) => ({ m, i })).filter(x => x.m.prunable && !p.pruneIndexes.includes(x.i)).map(x => x.i)));
	check('pruning alone brings 480k under the summary threshold (no model call needed)', !p.summarise && p.totalAfterPrune < p.budgetChars * B.SUMMARISE_FRACTION, `after ${p.totalAfterPrune}`);
	// run it again on the result: nothing more to do
	const after = msgs.map((m, i) => p.pruneIndexes.includes(i) ? { role: 'tool', size: B.prunedOutputNote('read_file', m.size).length } : m);
	const again = B.planContextReduction(after, opts);
	check('pruning is idempotent: the result needs no further pruning', again.pruneIndexes.length === 0 && !again.summarise);
}
{
	// the last messages are protected even when they are the huge part; with ONE long request (a single user message) older output is still pruned
	const msgs = [user()]; for (let i = 0; i < 12; i++) { msgs.push(asst(), read(40_000)) }
	const p = B.planContextReduction(msgs, opts)
	check('output in the last messages is never pruned', p.pruneIndexes.every(i => i < msgs.length - B.PRUNE_PROTECT_LAST_MESSAGES), JSON.stringify(p.pruneIndexes));
	check('one long request (a single user message) is still pruned', p.pruneIndexes.length > 0);
}
{
	// just over half, but pruning would free too little to be worth breaking the provider's prompt cache
	const msgs = [user(), asst(), read(20_000), asst(), read(20_000), user(), asst(), read(20_000), asst(), read(130_000), asst(), read(10_000)]
	const p = B.planContextReduction(msgs, opts)
	check('small gains are not worth pruning', p.pruneIndexes.length === 0 || p.freedChars >= p.budgetChars * B.PRUNE_MIN_FREED_FRACTION, JSON.stringify(p));
}
{
	const msgs = [user(), asst(), read(300), asst(), read(200_000), user(), asst(), read(200_000)]
	const p = B.planContextReduction(msgs, opts)
	check('a short output is not worth replacing', !p.pruneIndexes.includes(2));
}
{
	// many small messages, no tool output at all: pruning cannot help, the summary must take over
	const msgs = []; for (let i = 0; i < 300; i++) { msgs.push(user(300), asst(600)) }
	const p = B.planContextReduction(msgs, opts)
	check('without tool output the summary is asked for before the budget is reached', p.pruneIndexes.length === 0 && p.summarise && p.totalChars < p.budgetChars, JSON.stringify(p));
}

// ---- the property that was broken: while a long session grows, the blind cut never has to fire
for (const [cw, r] of [[32_768, 4_096], [128_000, 8_192], [200_000, 32_000], [1_000_000, 64_000]]) {
	let msgs = [user()]
	let worst = 0, summaries = 0, prunes = 0
	const budget = B.inputBudgetChars(cw, r)
	const overhead = B.systemOverheadChars(cw)
	for (let step = 0; step < 600; step++) {
		if (step % 15 === 0) msgs.push(user(400))
		msgs.push(asst(500), read(step % 5 === 0 ? 30_000 : 6_000))
		// what _maybeCompactThread does before every model call
		const p = B.planContextReduction(msgs, { contextWindow: cw, reservedOutputTokenSpace: r })
		if (p.pruneIndexes.length) { prunes++; msgs = msgs.map((m, i) => p.pruneIndexes.includes(i) ? { role: 'tool', size: B.prunedOutputNote(m.toolName, m.size).length } : m) }
		if (p.summarise && msgs.length > 12) { summaries++; const tail = msgs.slice(-6); msgs = [{ role: 'compacted_summary', size: 4_000 }, ...tail] }
		const sent = overhead + msgs.reduce((n, m) => n + m.size, 0)
		worst = Math.max(worst, sent)
	}
	check(`${cw / 1000}k window: 600 steps, the request never exceeded the budget (the blind cut never fires)`, worst <= budget, `worst ${worst} > budget ${budget}`);
	check(`${cw / 1000}k window: pruning did the work (${prunes} prunes, ${summaries} summaries)`, prunes > 0);
}

// ---- the converter really uses the shared yardstick (static check of the source)
{
	const src = fs.readFileSync(path.join(here, '../browser/convertToLLMMessageService.ts'), 'utf8');
	check('the converter no longer reserves half of the window', !/contextWindow \* 1 \/ 2/.test(src));
	check('the converter takes its budget from contextBudget', /inputBudgetChars\(contextWindow, reservedOutputTokenSpace\)/.test(src));
	check('the converter sends a note for a pruned result', /m\.outputPruned \? prunedOutputNote\(/.test(src));
	const svc = fs.readFileSync(path.join(here, '../browser/chatThreadService.ts'), 'utf8');
	check('the summary decision uses the shared plan, not a 2,000-character estimate', /planContextReduction\(/.test(svc) && !/truncate\(m\.content, 2000\)\.length/.test(svc) && !/COMPACTION_SAFETY_MARGIN_FRACTION/.test(svc));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
