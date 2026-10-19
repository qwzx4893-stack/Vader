#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What the chat says about a run: how it was stopped, the messages that wait, how full the conversation is, a long paste (common/runStateModel.ts): the rules, without the editor.
// Run: node src/vs/workbench/contrib/vader/test/runStateModelE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-runstate-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/runStateModel.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'm.mjs'), logLevel: 'silent' });
const M = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);
const B = await (async () => { await esbuild.build({ entryPoints: [path.join(here, '../common/contextBudget.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'b.mjs'), logLevel: 'silent' }); return import(pathToFileURL(path.join(tmp, 'b.mjs')).href); })();

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

// ---- stopped by you
check('a command that was running is named in what it says', M.stoppedWhile({ phase: 'tool', toolName: 'run_command', command: 'npm test' }) === 'Stopped while running npm test');
check('a long command is cut on one line', M.stoppedWhile({ phase: 'tool', toolName: 'run_command', command: 'node ' + 'x'.repeat(200) }).length < 90);
check('a tool without a command is named by what it does', M.stoppedWhile({ phase: 'tool', toolName: 'edit_file' }) === 'Stopped while editing a file' && M.stoppedWhile({ phase: 'tool', toolName: 'something_new' }) === 'Stopped while using a tool');
check('stopping while it wrote, while it waited for approval, and between steps each say so', M.stoppedWhile({ phase: 'writing' }) === 'Stopped while writing an answer' && M.stoppedWhile({ phase: 'awaiting_approval', command: 'rm -rf build' }) === 'Stopped while asking to run rm -rf build' && M.stoppedWhile({ phase: 'awaiting_approval' }) === 'Stopped while waiting for your answer' && M.stoppedWhile({ phase: 'idle' }) === 'Stopped between two steps');
check('the queue is sent only after a run that finished on its own', M.shouldSendQueued('finished', 1) && !M.shouldSendQueued('stopped', 1) && !M.shouldSendQueued('error', 3) && !M.shouldSendQueued('finished', 0));

// ---- the messages that wait
let q = M.enqueue(undefined, '  Also add a header  ', 'a');
check('a message is added trimmed, at the end', q.length === 1 && q[0].text === 'Also add a header');
check('an empty message is not added', M.enqueue(q, '   ', 'b').length === 1);
q = M.enqueue(q, 'second', 'b');
check('messages keep their order', q.map(m => m.id).join() === 'a,b');
const { next, rest } = M.takeNext(q);
check('the first one is the next to send, and the others stay', next.id === 'a' && rest.length === 1 && rest[0].id === 'b');
check('taking from an empty queue gives nothing', M.takeNext(undefined).next === undefined && M.takeNext([]).rest.length === 0);
check('a message can be removed by its id', M.removeQueued(q, 'a').map(m => m.id).join() === 'b' && M.removeQueued(undefined, 'a').length === 0);
let full = [];
for (let i = 0; i < 9; i++) full = M.enqueue(full, 'm' + i, 'i' + i);
check('no more than five wait at once, and the chat can tell', full.length === M.MAX_QUEUED_MESSAGES && M.queueIsFull(full) && !M.queueIsFull(q));

// ---- how full
const W = 200_000;
const budgetChars = B.inputBudgetChars(W, null);
check('a conversation that takes half the room is roomy: nothing is said', M.contextStage(M.contextShare(budgetChars * 0.5 - B.systemOverheadChars(W), W)) === 'roomy' && M.contextBanner(0.5) === undefined);
const at = (f) => M.contextShare(Math.round(budgetChars * f - B.systemOverheadChars(W)), W);
check('the share counts the room a request may use, with the system prompt in it', Math.abs(at(0.6) - 0.6) < 0.001 && Math.abs(at(0.9) - 0.9) < 0.001, `${at(0.6)} ${at(0.9)}`);
check('from 60% the chat says it is filling, from 70% that the next request summarises', M.contextStage(0.6) === 'filling' && M.contextStage(0.69) === 'filling' && M.contextStage(0.7) === 'summarising' && M.contextStage(0.95) === 'summarising');
check('a chat inside the window has no overflow to say', M.contextOverflow(Math.round(budgetChars * 0.9 - B.systemOverheadChars(W)), W, null, 'm') === undefined);
{
	const o = M.contextOverflow(budgetChars * 2, W, null, 'llama3.1 8B');
	check('a chat bigger than the window says so with the figures of the model', o && o.title === 'This chat is bigger than the model’s window' && o.windowTokens === W && o.cutTokens > 0 && o.body === `The chat is about ${M.kTokens(o.usedTokens)} tokens. llama3.1 8B reads ${M.kTokens(W)}. Vader would have to cut the oldest ${M.kTokens(o.cutTokens)}.`, JSON.stringify(o));
	check('tokens are said in thousands', M.kTokens(62000) === '62K' && M.kTokens(900) === '900' && M.kTokens(32768) === '33K');
}
check('the banner names the real figures: 70% to summarise, half of the room for tool output', /From 70% Vader summarises/.test(M.contextBanner(0.62).body) && /from 50% of the room/.test(M.contextBanner(0.62).body) && /^62% of the room/.test(M.contextBanner(0.62).title));
check('above the summary threshold it says the next request summarises', /summarises the older messages before the next request/.test(M.contextBanner(0.8).body));
check('a model with no known window has no share', M.contextShare(10_000, 0) === 0 && M.contextShare(10_000, NaN) === 0);
check('the share never goes below zero and may pass 100%', M.contextShare(0, 8000) > 0 && M.contextShare(10_000_000, 8000) > 1);

check('the size of a conversation is what was said and what the tools returned', M.messageChars([{ role: 'user', displayContent: 'abcd' }, { role: 'assistant', displayContent: 'ef' }, { role: 'tool', content: 'x'.repeat(10) }, { role: 'checkpoint' }]) === 16);
check('a tool result that was dropped counts as nothing, and a summary counts', M.messageChars([{ role: 'tool', content: 'x'.repeat(500), outputPruned: true }, { role: 'compacted_summary', summary: 'abc' }]) === 3);

// ---- a long paste
check('a few lines are not folded', !M.shouldFoldPaste('one\ntwo\nthree') && !M.shouldFoldPaste('x'.repeat(1000)));
check('more than twelve lines is folded, and so is more than 1,500 characters', M.shouldFoldPaste(Array.from({ length: 13 }, (_, i) => 'l' + i).join('\n')) && M.shouldFoldPaste('x'.repeat(1501)));
check('windows line endings count as lines', M.shouldFoldPaste(Array.from({ length: 13 }, (_, i) => 'l' + i).join('\r\n')) && M.describePaste('a\r\nb\r\nc').lines === 3);
check('the label says lines and size like 412 lines, 18K characters', M.describePaste(Array.from({ length: 412 }, () => 'x'.repeat(43)).join('\n')).label === '412 lines, 18K characters' && M.describePaste('a\nb').label === '2 lines, 3 characters' && M.describePaste('x'.repeat(1500)).label === '1 line, 1.5K characters');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
