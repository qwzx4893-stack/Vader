/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Runs against a REAL model (a small one served by Ollama's OpenAI-compatible endpoint in CI). Nothing is scripted, so
// only properties that hold for any working model are hard checks; tool use by a tiny model is reported as information.

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
			t.info('the answer contains PONG', /pong/i.test(texts.join(' ')), texts.join(' ').slice(0, 100));
		},
	},
	{
		name: 'real model: a follow-up question uses the conversation history',
		timeout: 600_000,
		fn: async (t) => {
			await t.send('My favourite colour is turquoise. Just say OK.');
			await t.idle({ timeout: 540_000 });
			await t.send('What is my favourite colour? Answer in one word.');
			t.check('the agent returns to idle', await t.idle({ timeout: 540_000 }));
			const texts = await t.ui.assistantTexts(t.page);
			t.check('two answers are shown', texts.length >= 2, texts.length);
			t.info('the second answer remembers the colour', /turquoise/i.test(texts[texts.length - 1] ?? ''), texts[texts.length - 1]);
		},
	},
	{
		name: 'real model: asked to read a file, the agent tries the tool and the run stays healthy',
		timeout: 900_000,
		fn: async (t) => {
			await t.send(`Use the read_file tool to read ${t.abs('notes.txt')} and tell me its first line.`);
			const r = await t.runUntilIdle({ timeout: 840_000 });
			t.check('the agent returns to idle (no hang on approvals or tool results)', r.idle, JSON.stringify(r));
			const headers = await t.ui.toolHeaders(t.page);
			const texts = (await t.ui.assistantTexts(t.page)).join(' ');
			t.info('the model produced a tool call', headers.length > 0, headers.join(','));
			t.info('the final answer contains the file content', /hello world/i.test(texts), texts.slice(0, 120));
		},
	},
];
