/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Scenarios for models WITHOUT native tool calling (most open-source / locally hosted models). Vader describes the
// tools in the prompt and parses XML tool calls out of the streamed text; results come back as user messages.

import { seq } from '../modelServer.mjs';

const SR = (orig, repl) => `<<<<<<< ORIGINAL\n${orig}\n=======\n${repl}\n>>>>>>> UPDATED`;
const xml = (name, params = {}) => `<${name}>\n${Object.entries(params).map(([k, v]) => `<${k}>${v}</${k}>`).join('\n')}\n</${name}>`;

export const xmlScenarios = [
	{
		name: 'xml: the prompt describes the tools in text and no native tools are sent',
		fn: async (t) => {
			t.use(() => ({ text: 'ok' }));
			await t.send('hello');
			t.check('agent returns to idle', await t.idle());
			const r = t.server.chatRequests()[0];
			t.check('no native `tools` parameter is sent', !r.body.tools || r.body.tools.length === 0, JSON.stringify(r.body.tools?.length));
			const all = r.ctx.allText;
			const names = ['read_file', 'edit_file', 'rewrite_file', 'run_command', 'ls_dir'];
			t.check('the prompt lists the file and terminal tools with their XML format', names.every(n => all.includes(`<${n}>`)), names.filter(n => !all.includes(`<${n}>`)).join(','));
			t.check('the policy engine rules are part of the prompt', /policy engine/i.test(all));
		},
	},
	{
		name: 'xml: a read_file tool call written as XML is executed and the result comes back',
		fn: async (t) => {
			t.use(seq([
				{ text: `I will read the file.\n${xml('read_file', { uri: t.abs('notes.txt') })}` },
				(c) => ({ text: `It says: ${c.lastMessageText.includes('hello world') ? 'hello world' : '(missing)'}` }),
			]));
			await t.send('read notes.txt');
			t.check('agent returns to idle', await t.idle());
			t.check('a "Read file" tool call is shown', (await t.ui.toolHeaders(t.page)).some(h => /read file/i.test(h)));
			const reqs = t.server.chatRequests();
			t.check('the model was called again with the tool result', reqs.length === 2, reqs.length);
			t.check('the result is delivered as a tool-result block with the real file content', /<read_file_result>/.test(reqs[1]?.ctx.lastMessageText ?? '') && (reqs[1]?.ctx.lastMessageText ?? '').includes('hello world'), (reqs[1]?.ctx.lastMessageText ?? '').slice(0, 200));
			t.check('the final answer is shown', (await t.ui.assistantTexts(t.page)).some(x => x.includes('It says: hello world')));
		},
	},
	{
		name: 'xml: edit_file written as XML needs approval and changes the file',
		fn: async (t) => {
			t.use(seq([
				{ text: `Fixing it.\n${xml('edit_file', { uri: t.abs('src/app.js'), search_replace_blocks: SR('  return a - b; // BUG: should add', '  return a + b;') })}` },
				{ text: 'Done.' },
			]));
			await t.send('fix src/app.js');
			t.check('approval is requested', await t.waitApproval(20_000));
			await t.approve();
			t.check('agent returns to idle', await t.idle({ timeout: 60_000 }));
			t.check('the file was fixed on disk', await t.waitFor(() => t.read('src/app.js').includes('return a + b;'), 20_000), t.read('src/app.js'));
		},
	},
	{
		name: 'xml: when a model writes several tool calls, the first runs and the run still completes cleanly',
		fn: async (t) => {
			// the prompt tells these models to STOP and WAIT after one tool call, so only the first is executed by design
			t.use(seq([
				{ text: `Reading both.\n${xml('read_file', { uri: t.abs('notes.txt') })}\n${xml('read_file', { uri: t.abs('README.md') })}` },
				{ text: 'Done reading.' },
			]));
			await t.send('read notes.txt and README.md');
			t.check('agent returns to idle', await t.idle());
			const reqs = t.server.chatRequests();
			const back = reqs[1]?.ctx.allText ?? '';
			t.check('the first call ran and its result reaches the model', back.includes('hello world'));
			t.check('the prompt tells the model to stop and wait after a tool call', /STOP and WAIT/i.test(reqs[0]?.ctx.allText ?? ''));
			t.check('exactly one tool call is shown', (await t.ui.toolHeaders(t.page)).length === 1);
			t.check('the conversation finishes normally', (await t.ui.assistantTexts(t.page)).some(x => x.includes('Done reading.')));
		},
	},
	{
		name: 'xml: an invalid tool call (missing parameter) is reported back instead of crashing',
		fn: async (t) => {
			t.use(seq([
				{ text: `Reading.\n<read_file>\n</read_file>` },
				(c) => ({ text: `Handled: ${/invalid|missing|param/i.test(c.lastMessageText) ? 'got an error message' : 'no error message'}` }),
			]));
			await t.send('read a file');
			t.check('agent returns to idle', await t.idle());
			const reqs = t.server.chatRequests();
			t.check('the model is told the call was invalid', /invalid|missing|param|required/i.test(reqs[1]?.ctx.lastMessageText ?? ''), (reqs[1]?.ctx.lastMessageText ?? '').slice(0, 200));
		},
	},
	{
		name: 'xml: a very long tool result is truncated for the model rather than breaking the run',
		fn: async (t) => {
			t.write('big.txt', 'line of text number xxxxxxxxxxxxxxxx\n'.repeat(40_000)); // ~1.4 MB
			t.use(seq([
				{ text: `Reading.\n${xml('read_file', { uri: t.abs('big.txt') })}` },
				{ text: 'Finished reading the big file.' },
			]));
			await t.send('read big.txt');
			t.check('agent returns to idle', await t.idle({ timeout: 90_000 }));
			const sent = (t.server.chatRequests()[1]?.ctx.lastMessageText ?? '').length;
			t.check('the second request stays within a sane size', sent > 0 && sent < 700_000, sent);
			t.check('the run completes', (await t.ui.assistantTexts(t.page)).some(x => x.includes('Finished reading')));
		},
	},
];

// A model name Vader does not recognise (a local model with a custom id). It used to get a 4k context window, which cut
// the tool list to a few read-only tools mid-sentence; all tools must be present now.
export const unknownModelScenarios = [
	{
		name: 'unknown model name: the full tool list is in the prompt and tools work',
		fn: async (t) => {
			t.use(seq([
				{ text: `Reading.\n${xml('read_file', { uri: t.abs('notes.txt') })}` },
				(c) => ({ text: c.lastMessageText.includes('hello world') ? 'Got the file.' : 'No file.' }),
			]));
			await t.send('read notes.txt');
			t.check('agent returns to idle', await t.idle());
			const all = t.server.chatRequests()[0]?.ctx.allText ?? '';
			const needed = ['read_file', 'edit_file', 'rewrite_file', 'create_file_or_folder', 'run_command', 'search_for_files'];
			t.check('the editing and terminal tools are in the prompt (not trimmed away)', needed.every(n => all.includes(`<${n}>`)), needed.filter(n => !all.includes(`<${n}>`)).join(','));
			t.check('the prompt is not cut off mid-description', !/\.\.\.\s*<\/SYSTEM_MESSAGE>/.test(all));
			t.check('the tool call worked end to end', (await t.ui.assistantTexts(t.page)).some(x => x.includes('Got the file.')));
		},
	},
];
