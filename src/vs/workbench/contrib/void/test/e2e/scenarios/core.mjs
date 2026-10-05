/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Core chat / agent scenarios for a model with NATIVE (OpenAI-style) tool calling - the path a real user takes
// with GPT/Claude-class models. Each scenario scripts the "model" and asserts on what the real app did.

import { seq } from '../modelServer.mjs';

const SR = (orig, repl) => `<<<<<<< ORIGINAL\n${orig}\n=======\n${repl}\n>>>>>>> UPDATED`;

export const coreScenarios = [
	{
		name: 'chat: a streamed reply is rendered and the request is well formed',
		fn: async (t) => {
			t.use(() => ({ text: 'Hello! I am the test model. `code` and **bold** work.' }));
			await t.send('hi there');
			t.check('agent returns to idle', await t.idle());
			const texts = await t.ui.assistantTexts(t.page);
			t.check('assistant reply is rendered in the chat', texts.some(x => x.includes('Hello! I am the test model.')), JSON.stringify(texts));
			const reqs = t.server.chatRequests();
			t.check('exactly one model request was made', reqs.length === 1, reqs.length);
			const r = reqs[0];
			t.check('request streams to the configured model', r.body.stream === true && r.body.model === 'gpt-4o', `${r.body.stream} ${r.body.model}`);
			t.check('the system prompt is sent as a system message', r.ctx.system.length > 500, r.ctx.system.length);
			t.check('the user text reaches the model', r.ctx.lastUserFull.includes('hi there'));
			const names = r.ctx.tools.map(x => x.function?.name);
			t.check('Agent mode offers file and terminal tools natively', ['read_file', 'edit_file', 'run_command'].every(n => names.includes(n)), names.join(','));
		},
	},
	{
		name: 'chat: multi-turn conversation keeps history',
		fn: async (t) => {
			t.use((c) => ({ text: c.assistantTurns === 0 ? 'First answer.' : 'Second answer.' }));
			await t.send('first question'); await t.idle();
			await t.send('second question'); await t.idle();
			const reqs = t.server.chatRequests();
			t.check('two requests were made', reqs.length === 2, reqs.length);
			t.check('the second request contains the first exchange', reqs[1]?.ctx.allText.includes('first question') && reqs[1]?.ctx.allText.includes('First answer.'));
			const texts = await t.ui.assistantTexts(t.page);
			t.check('both replies are shown in order', texts.length >= 2 && texts[0].includes('First answer.') && texts[1].includes('Second answer.'), JSON.stringify(texts));
		},
	},
	{
		name: 'agent: read_file tool call is executed and its result reaches the model',
		fn: async (t) => {
			const file = t.abs('notes.txt');
			t.use(seq([
				{ text: 'Let me read it.', toolCalls: [{ name: 'read_file', args: { uri: file } }] },
				(c) => ({ text: `The file begins with: ${(c.lastToolResult ?? '').split('\n').find(l => l.includes('hello')) ?? '(no result)'}` }),
			]));
			await t.send('what is in notes.txt?');
			t.check('agent returns to idle', await t.idle());
			const headers = await t.ui.toolHeaders(t.page);
			t.check('a "Read file" tool call is shown in the chat', headers.some(h => /read file/i.test(h)), JSON.stringify(headers));
			const reqs = t.server.chatRequests();
			t.check('the model was called a second time with the tool result', reqs.length === 2, reqs.length);
			t.check('the tool result contains the real file content', (reqs[1]?.ctx.lastToolResult ?? '').includes('hello world'), reqs[1]?.ctx.lastToolResult);
			const texts = await t.ui.assistantTexts(t.page);
			t.check('the final answer uses the file content', texts.some(x => x.includes('hello world')), JSON.stringify(texts));
		},
	},
	{
		name: 'agent: two tool calls in one turn both run',
		fn: async (t) => {
			t.use(seq([
				{ toolCalls: [{ name: 'read_file', args: { uri: t.abs('notes.txt') } }, { name: 'read_file', args: { uri: t.abs('README.md') } }] },
				{ text: 'Read both.' },
			]));
			await t.send('read notes.txt and README.md');
			t.check('agent returns to idle', await t.idle());
			const reqs = t.server.chatRequests();
			t.check('model got both results in the next request', reqs[1]?.ctx.toolResults.length === 2, reqs[1]?.ctx.toolResults.length);
			const joined = (reqs[1]?.ctx.toolResults ?? []).map(r => r.content).join('\n');
			t.check('results are the two real files', joined.includes('hello world') && joined.includes('Demo project'), joined.slice(0, 200));
			t.check('two tool calls are shown', (await t.ui.toolHeaders(t.page)).length === 2);
			const asst = reqs[1]?.ctx.messages.find(m => m.role === 'assistant' && m.tool_calls?.length);
			t.check('both calls are listed on the assistant message in the history', asst?.tool_calls?.length === 2, asst?.tool_calls?.length);
		},
	},
	{
		name: 'agent: ls_dir and search tools work',
		fn: async (t) => {
			t.use(seq([
				{ toolCalls: [{ name: 'ls_dir', args: { uri: t.ws } }, { name: 'search_pathnames_only', args: { query: 'app' } }] },
				{ text: 'Listed.' },
			]));
			await t.send('what files are here?');
			t.check('agent returns to idle', await t.idle());
			const res = (t.server.chatRequests()[1]?.ctx.toolResults ?? []).map(r => r.content).join('\n');
			t.check('directory listing includes the fixture files', res.includes('notes.txt') && res.includes('package.json'), res.slice(0, 300));
			t.check('path search finds src/app.js', /app\.js/.test(res), res.slice(0, 300));
		},
	},
	{
		name: 'agent: edit_file applies a search/replace edit after approval',
		fn: async (t) => {
			const file = t.abs('src/app.js');
			t.use(seq([
				{ text: 'Fixing the bug.', toolCalls: [{ name: 'edit_file', args: { uri: file, search_replace_blocks: SR('  return a - b; // BUG: should add', '  return a + b;') } }] },
				{ text: 'The add function is fixed.' },
			]));
			await t.send('fix the bug in src/app.js');
			const asked = await t.waitApproval(20_000);
			t.check('the edit asks for approval first', asked);
			await t.shot('edit-approval');
			if (asked) { await t.approve(); }
			t.check('agent returns to idle', await t.idle({ allowApproval: false, timeout: 60_000 }));
			// Vader applies the edit to the open document; wait for the file on disk to change (auto-save / apply)
			const changed = await t.waitFor(() => t.read('src/app.js').includes('return a + b;'), 20_000);
			await t.shot('edit-applied');
			t.check('the file on disk contains the fix', changed, t.read('src/app.js'));
			t.check('the buggy line is gone', !t.read('src/app.js').includes('a - b'));
			const texts = await t.ui.assistantTexts(t.page);
			t.check('the final message is shown', texts.some(x => x.includes('is fixed')), JSON.stringify(texts));
		},
	},
	{
		name: 'agent: two edits that each need approval in one turn are both applied (no hang)',
		fn: async (t) => {
			t.use(seq([
				{ toolCalls: [
					{ name: 'edit_file', args: { uri: t.abs('src/app.js'), search_replace_blocks: SR('  return a - b; // BUG: should add', '  return a + b;') } },
					{ name: 'edit_file', args: { uri: t.abs('notes.txt'), search_replace_blocks: SR('second line', 'second line (edited)') } },
				] },
				{ text: 'Both files edited.' },
			]));
			await t.send('fix both files');
			let approvals = 0;
			for (let i = 0; i < 3; i++) { if (await t.waitApproval(i === 0 ? 20_000 : 12_000)) { approvals++; await t.approve(); await t.sleep(600); } else { break; } }
			t.check('each edit asked for approval in turn', approvals === 2, approvals);
			t.check('agent returns to idle (does not hang)', await t.idle({ timeout: 60_000 }));
			t.check('first file was edited', await t.waitFor(() => t.read('src/app.js').includes('return a + b;'), 20_000), t.read('src/app.js'));
			t.check('second file was edited', await t.waitFor(() => t.read('notes.txt').includes('second line (edited)'), 20_000), t.read('notes.txt'));
			const reqs = t.server.chatRequests();
			const assistantWithCalls = reqs[1]?.ctx.messages.find(m => m.role === 'assistant' && m.tool_calls?.length);
			t.check('the history sent back lists BOTH tool calls on the assistant message', assistantWithCalls?.tool_calls?.length === 2, assistantWithCalls?.tool_calls?.length);
			t.check('and carries both tool results', reqs[1]?.ctx.toolResults.length === 2, reqs[1]?.ctx.toolResults.length);
			const ids = new Set(assistantWithCalls?.tool_calls?.map(c => c.id));
			t.check('every tool result answers a call the assistant actually made', (reqs[1]?.ctx.toolResults ?? []).every(r => ids.has(r.tool_call_id)));
		},
	},
	{
		name: 'agent: rejecting an edit leaves the file untouched',
		fn: async (t) => {
			const file = t.abs('src/app.js');
			const before = t.read('src/app.js');
			t.use(seq([
				{ toolCalls: [{ name: 'edit_file', args: { uri: file, search_replace_blocks: SR('  return a - b; // BUG: should add', '  return a * b;') } }] },
				(c) => ({ text: `Understood, I will not change it. (${/reject|denied|cancel/i.test(c.lastMessageText) ? 'saw rejection' : 'no rejection seen'})` }),
			]));
			await t.send('change add to multiply');
			const asked = await t.waitApproval(20_000);
			t.check('the edit asks for approval first', asked);
			if (asked) { await t.reject(); }
			t.check('agent returns to idle', await t.idle({ timeout: 60_000 }));
			await t.sleep(1000);
			t.check('the file is unchanged', t.read('src/app.js') === before, t.read('src/app.js'));
		},
	},
	{
		name: 'agent: create_file_or_folder and rewrite_file write real files',
		fn: async (t) => {
			const f = t.abs('docs/new.txt');
			t.use(seq([
				{ toolCalls: [{ name: 'create_file_or_folder', args: { uri: f } }] },
				{ toolCalls: [{ name: 'rewrite_file', args: { uri: f, new_content: 'created by the agent\nline 2\n' } }] },
				{ text: 'Created and written.' },
			]));
			await t.send('create docs/new.txt');
			// approvals may be requested for each write
			for (let i = 0; i < 4; i++) { if (await t.waitApproval(i === 0 ? 20_000 : 6_000)) { await t.approve(); } else { break; } }
			t.check('agent returns to idle', await t.idle({ timeout: 60_000 }));
			const ok = await t.waitFor(() => t.exists('docs/new.txt') && t.read('docs/new.txt').includes('created by the agent'), 20_000);
			t.check('the new file exists on disk with the written content', ok, t.exists('docs/new.txt') ? t.read('docs/new.txt') : 'missing');
		},
	},
	{
		name: 'policy: a destructive command is blocked before it can run',
		fn: async (t) => {
			const canary = t.abs('canary.txt');
			t.write('canary.txt', 'still here');
			t.use(seq([
				{ toolCalls: [{ name: 'run_command', args: { command: process.platform === 'win32' ? 'Remove-Item -Recurse -Force C:\\' : 'rm -rf /' } }] },
				(c) => ({ text: `I could not run that. Tool said: ${c.lastToolResult ?? c.lastMessageText}` }),
			]));
			await t.send('delete everything');
			// a hard-blocked command must never even ask for approval
			const asked = await t.waitApproval(6_000);
			t.check('no approval prompt is ever shown for a hard-blocked command', !asked);
			t.check('agent returns to idle', await t.idle({ timeout: 60_000 }));
			const reqs = t.server.chatRequests();
			t.check('the model is told the call was blocked', /block|denied|policy|reject/i.test(reqs[1]?.ctx.lastToolResult ?? reqs[1]?.ctx.lastMessageText ?? ''), reqs[1]?.ctx.lastToolResult);
			t.check('the workspace is intact', t.read('canary.txt') === 'still here' && t.exists('notes.txt'));
		},
	},
	{
		name: 'stop: cancelling a streaming reply returns the UI to idle and the app stays usable',
		fn: async (t) => {
			const long = 'This is a long streamed answer. '.repeat(80);
			t.use((c) => c.lastUser.includes('again') ? ({ text: 'Back to normal.' }) : ({ text: long, msPerChunk: 40 }));
			await t.send('write a long essay');
			const started = await t.waitFor(() => t.ui.isRunning(t.page), 15_000);
			t.check('the stop button appears while streaming', started);
			await t.sleep(1200);
			await t.page.locator('[data-testid="vader-stop"]').first().click();
			t.check('the UI returns to idle after stopping', await t.idle({ timeout: 20_000 }));
			const texts = await t.ui.assistantTexts(t.page);
			const partial = (texts[0] ?? '').length;
			t.check('only part of the text was shown', partial > 0 && partial < long.length - 200, `${partial} of ${long.length}`);
			await t.send('again please'); await t.idle();
			const after = await t.ui.assistantTexts(t.page);
			t.check('a new message after stopping works', after.some(x => x.includes('Back to normal.')), JSON.stringify(after.map(x => x.slice(0, 40))));
		},
	},
	{
		name: 'errors: a rejected API key shows a clear error and the next message recovers',
		fn: async (t) => {
			t.use((c) => c.lastUser.includes('retry') ? ({ text: 'Recovered fine.' }) : ({ error: { status: 401, code: 'invalid_api_key', message: 'Incorrect API key provided: sk-test-key' } }));
			await t.send('hello');
			t.check('agent returns to idle', await t.idle({ timeout: 60_000 }));
			const errs = await t.ui.errorTexts(t.page);
			t.check('an error box is shown', errs.length > 0, JSON.stringify(errs));
			t.check('the error explains the key problem', errs.some(e => /api key|invalid|401|authentication/i.test(e)), errs[0]);
			await t.send('retry now'); await t.idle();
			t.check('the next message works', (await t.ui.assistantTexts(t.page)).some(x => x.includes('Recovered fine.')));
		},
	},
	{
		name: 'errors: rate limit and dropped connection are reported, not hung',
		timeout: 180_000,
		fn: async (t) => {
			t.use(() => ({ error: { status: 429, code: 'rate_limit_exceeded', message: 'Rate limit reached' } }));
			await t.send('first');
			t.check('agent returns to idle after a 429', await t.idle({ timeout: 90_000 }));
			t.check('a 429 is reported to the user', (await t.ui.errorTexts(t.page)).length > 0);
			t.server.reset();
			t.use(() => ({ reset: true }));
			await t.send('second');
			t.check('agent returns to idle after a dropped connection', await t.idle({ timeout: 90_000 }));
			t.check('a dropped connection is reported to the user', (await t.ui.errorTexts(t.page)).length > 0);
		},
	},
];
