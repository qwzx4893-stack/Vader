/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Runs against a REAL model (a small one served by Ollama's OpenAI-compatible endpoint in CI). Nothing is scripted, so
// Required behavior is checked, including errors, history and actual tool/file results. Returning to idle alone is not success.

import { randomUUID } from 'node:crypto';

export const realLlmScenarios = [
	{
		name: 'real model: a plain question gets a streamed answer and the run finishes cleanly',
		timeout: 600_000,
		fn: async (t) => {
			await t.send('Reply with exactly the single word PONG and nothing else.');
			const idle = await t.idle({ timeout: 540_000 });
			t.check('the agent returns to idle', idle);
			const texts = await t.ui.assistantTexts(t.page);
			const errors = await t.ui.errorTexts(t.page);
			t.check('no error is shown in the chat', errors.length === 0, errors.join(' | '));
			t.check('the model answered with some text', texts.join('').trim().length > 0, JSON.stringify(texts));
			t.check('the answer contains PONG', /\bpong\b/i.test(texts.join(' ')), texts.join(' ').slice(0, 100));
		},
	},
	{
		name: 'real model: a follow-up question uses the conversation history',
		timeout: 600_000,
		fn: async (t) => {
			await t.send('My favourite colour is turquoise. Just say OK.');
			t.check('the first turn returns to idle', await t.idle({ timeout: 540_000 }));
			t.check('the first turn has no provider error', (await t.ui.errorTexts(t.page)).length === 0);
			await t.send('What is my favourite colour? Answer in one word.');
			t.check('the agent returns to idle', await t.idle({ timeout: 540_000 }));
			const texts = await t.ui.assistantTexts(t.page);
			t.check('two answers are shown', texts.length >= 2, texts.length);
			t.check('the follow-up has no provider error', (await t.ui.errorTexts(t.page)).length === 0);
			t.check('the second answer remembers the colour', /turquoise/i.test(texts[texts.length - 1] ?? ''), texts[texts.length - 1]);
		},
	},
	{
		name: 'real model: asked to read a file, the agent tries the tool and the run stays healthy',
		timeout: 900_000,
		fn: async (t) => {
			const marker = `file-proof-${randomUUID()}`;
			t.write('notes.txt', `${marker}\nsecond line\n`);
			await t.send(`Use the read_file tool to read ${t.abs('notes.txt')} and tell me its first line.`);
			const r = await t.runUntilIdle({ timeout: 840_000 });
			t.check('the agent returns to idle (no hang on approvals or tool results)', r.idle, JSON.stringify(r));
			const headers = await t.ui.toolHeaders(t.page);
			const texts = (await t.ui.assistantTexts(t.page)).join(' ');
			t.check('the tool turn has no provider error', (await t.ui.errorTexts(t.page)).length === 0);
			t.check('the model produced a tool call', headers.length > 0, headers.join(','));
			t.check('the final answer contains the unpredictable file content', texts.includes(marker), texts.slice(0, 180));
		},
	},
];
