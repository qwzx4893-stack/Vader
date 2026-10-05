/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What an agent actually does with Vader's tools: terminal, browser, MCP servers, read-only modes, instructions,
// subagents, memory. Each scenario scripts the model; the app, the tools and the files/pages/processes are real.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seq } from '../modelServer.mjs';
import { startWebFixture } from '../fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SR = (orig, repl) => `<<<<<<< ORIGINAL\n${orig}\n=======\n${repl}\n>>>>>>> UPDATED`;
const refOf = (text, pattern) => { const m = new RegExp(`${pattern}[^\\n]*?\\[ref=(e\\d+)\\]`).exec(text ?? ''); return m?.[1]; };

// ---------------------------------------------------------------- terminal (needs the pty host)
export const terminalScenarios = [
	{
		name: 'terminal: run_command asks for approval, really runs, and the output reaches the model',
		needs: ['natives'],
		fn: async (t) => {
			t.use(seq([
				{ text: 'Running it.', toolCalls: [{ name: 'run_command', args: { command: `node -e "console.log('VADER_'+(6*7))"` } }] },
				(c) => ({ text: `The command printed: ${/VADER_42/.test(c.lastToolResult ?? '') ? 'VADER_42' : '(not found)'}` }),
			]));
			await t.send('run a command that prints a computed marker');
			t.check('the command asks for approval', await t.waitApproval(30_000));
			await t.shot('terminal-approval');
			await t.approve();
			t.check('agent returns to idle', await t.idle({ timeout: 90_000 }));
			const res = t.server.chatRequests()[1]?.ctx.lastToolResult ?? '';
			t.check('the real output (computed by node, not echoed from the command text) reaches the model', /VADER_42/.test(res), res.slice(0, 300));
			t.check('the final answer shows it', (await t.ui.assistantTexts(t.page)).some(x => x.includes('VADER_42')));
		},
	},
	{
		name: 'terminal: rejecting a command means it never runs',
		needs: ['natives'],
		fn: async (t) => {
			t.use(seq([
				{ toolCalls: [{ name: 'run_command', args: { command: `node -e "require('fs').writeFileSync('should-not-exist.txt','x')"` } }] },
				{ text: 'Okay, not running it.' },
			]));
			await t.send('create a file via the terminal');
			t.check('approval is requested', await t.waitApproval(30_000));
			await t.reject();
			t.check('agent returns to idle', await t.idle({ timeout: 60_000 }));
			await t.sleep(1500);
			t.check('the command did not run (no file was created)', !t.exists('should-not-exist.txt'));
		},
	},
	{
		name: 'terminal: a command that fails reports its error output and exit code',
		needs: ['natives'],
		fn: async (t) => {
			t.use(seq([
				{ toolCalls: [{ name: 'run_command', args: { command: `node -e "console.error('VADER_BOOM'); process.exit(3)"` } }] },
				{ text: 'It failed.' },
			]));
			await t.send('run the failing command');
			const r = await t.runUntilIdle({ timeout: 90_000 });
			t.check('the command was approved and finished', r.idle && r.approvals === 1, JSON.stringify(r));
			const res = t.server.chatRequests()[1]?.ctx.lastToolResult ?? '';
			t.check('the error text reaches the model', /VADER_BOOM/.test(res), res.slice(0, 300));
		},
	},
	{
		name: 'terminal: cwd is honoured',
		needs: ['natives'],
		fn: async (t) => {
			t.use(seq([
				{ toolCalls: [{ name: 'run_command', args: { command: `node -e "console.log('CWD='+require('path').basename(process.cwd()))"`, cwd: t.abs('src') } }] },
				{ text: 'ok' },
			]));
			await t.send('print the working directory from src');
			await t.runUntilIdle({ timeout: 90_000 });
			t.check('the command ran inside src', /CWD=src/.test(t.server.chatRequests()[1]?.ctx.lastToolResult ?? ''), t.server.chatRequests()[1]?.ctx.lastToolResult);
		},
	},
	{
		name: 'agent loop: run the tests, read the code, fix the bug, re-run until green',
		needs: ['natives'],
		timeout: 240_000,
		fn: async (t) => {
			t.use(seq([
				{ text: 'Let me run the tests first.', toolCalls: [{ name: 'run_command', args: { command: 'npm test' } }] },
				(c) => /TEST FAILED/.test(c.lastToolResult ?? '') ? { text: 'They fail. Reading the implementation.', toolCalls: [{ name: 'read_file', args: { uri: t.abs('src/app.js') } }] } : { text: 'Unexpected: tests did not fail.' },
				(c) => /a - b/.test(c.lastToolResult ?? '') ? { text: 'Found it: add subtracts.', toolCalls: [{ name: 'edit_file', args: { uri: t.abs('src/app.js'), search_replace_blocks: SR('  return a - b; // BUG: should add', '  return a + b;') } }] } : { text: 'Could not see the bug.' },
				{ text: 'Re-running the tests.', toolCalls: [{ name: 'run_command', args: { command: 'npm test' } }] },
				(c) => ({ text: /TEST PASSED/.test(c.lastToolResult ?? '') ? 'All tests pass now.' : 'Tests still failing.' }),
			]));
			await t.send('the tests are failing, please fix the code');
			const r = await t.runUntilIdle({ timeout: 200_000 });
			t.check('the whole loop finished without human help beyond approvals', r.idle, JSON.stringify(r));
			t.check('the first test run failed for real', /TEST FAILED/.test(t.server.chatRequests()[1]?.ctx.lastToolResult ?? ''));
			t.check('the real code was read and edited', t.read('src/app.js').includes('return a + b;'), t.read('src/app.js'));
			t.check('the second test run passed for real', /TEST PASSED/.test(t.server.chatRequests()[4]?.ctx.lastToolResult ?? ''), t.server.chatRequests()[4]?.ctx.lastToolResult);
			t.check('the agent concluded the work', (await t.ui.assistantTexts(t.page)).some(x => x.includes('All tests pass now.')));
			t.check('five model turns were needed', t.server.chatRequests().length === 6 || t.server.chatRequests().length === 5, t.server.chatRequests().length);
		},
	},
	{
		name: 'terminal: a persistent terminal can be opened, used and closed',
		needs: ['natives'],
		timeout: 180_000,
		fn: async (t) => {
			t.use(seq([
				{ toolCalls: [{ name: 'open_persistent_terminal', args: {} }] },
				(c) => { const id = /persistentTerminalId="([^"]+)"/.exec(c.lastToolResult ?? '')?.[1] ?? 'NOT-PARSED'; return { toolCalls: [{ name: 'run_persistent_command', args: { command: `node -e "console.log('PERSIST_'+(2+3))"`, persistent_terminal_id: id } }] }; },
				{ text: 'Used the terminal.' },
			]));
			await t.send('open a persistent terminal and print something');
			const r = await t.runUntilIdle({ timeout: 150_000 });
			t.check('agent returns to idle', r.idle, JSON.stringify(r));
			const all = t.server.chatRequests().map(x => x.ctx.lastToolResult ?? '').join('\n');
			t.check('the persistent terminal produced real output', /PERSIST_5/.test(all), all.slice(0, 400));
		},
	},
];

// ---------------------------------------------------------------- browser tool
export const browserScenarios = [
	{
		name: 'browser: navigate, read the page, click a button and type into a field',
		timeout: 180_000,
		fn: async (t) => {
			const web = await startWebFixture();
			try {
				t.use(seq([
					{ toolCalls: [{ name: 'browser_navigate', args: { url: web.url } }] },
					(c) => ({ toolCalls: [{ name: 'browser_click', args: { ref: refOf(c.lastToolResult, 'button "Increment"') ?? 'MISSING' } }] }),
					(c) => ({ toolCalls: [{ name: 'browser_type', args: { ref: refOf(c.lastToolResult, 'textbox "Your name"') ?? 'MISSING', text: 'Vader', submit: 'true' } }] }),
					(c) => ({ text: `Final page state: ${/Hello, Vader!/.test(c.lastToolResult ?? '') ? 'greeted Vader' : 'no greeting'}; ${/counter is 1/.test(c.lastToolResult ?? '') ? 'counter=1' : 'counter?'}` }),
				]));
				await t.send(`open ${web.url}, click Increment, then greet me as Vader`);
				const r = await t.runUntilIdle({ timeout: 150_000 });
				t.check('agent returns to idle', r.idle, JSON.stringify(r));
				const reqs = t.server.chatRequests();
				const nav = reqs[1]?.ctx.lastToolResult ?? '';
				t.check('navigation returned the real page (title and heading)', /Vader Fixture/.test(nav) && /Fixture heading/.test(nav), nav.slice(0, 300));
				t.check('the snapshot lists the Increment button with a usable ref', !!refOf(nav, 'button "Increment"'), nav.slice(0, 400));
				t.check('after the click the page really changed (counter is 1)', /counter is 1/.test(reqs[2]?.ctx.lastToolResult ?? ''), (reqs[2]?.ctx.lastToolResult ?? '').slice(0, 300));
				t.check('typing and submitting really ran the page script (greeting shown)', /Hello, Vader!/.test(reqs[3]?.ctx.lastToolResult ?? ''), (reqs[3]?.ctx.lastToolResult ?? '').slice(0, 300));
				t.check('the final answer reflects the live page', (await t.ui.assistantTexts(t.page)).some(x => x.includes('greeted Vader') && x.includes('counter=1')));
			} finally { await web.close(); }
		},
	},
	{
		name: 'browser: console errors, page errors and screenshots are available to the agent',
		timeout: 180_000,
		fn: async (t) => {
			const web = await startWebFixture();
			try {
				t.use(seq([
					{ toolCalls: [{ name: 'browser_navigate', args: { url: web.url } }] },
					{ toolCalls: [{ name: 'browser_console_logs', args: {} }, { name: 'browser_page_errors', args: {} }, { name: 'browser_screenshot', args: {} }] },
					{ text: 'Inspected.' },
				]));
				await t.send('check the page for errors and take a screenshot');
				const r = await t.runUntilIdle({ timeout: 150_000 });
				t.check('agent returns to idle', r.idle, JSON.stringify(r));
				const res = (t.server.chatRequests()[2]?.ctx.toolResults ?? []).map(x => x.content).join('\n---\n');
				t.check('the page\'s console.error is reported', /fixture console error/.test(res), res.slice(0, 500));
				t.check('the uncaught page error is reported', /fixture page error/.test(res), res.slice(0, 500));
				t.check('the screenshot tool reports a saved image', /png|screenshot/i.test(res), res.slice(0, 500));
			} finally { await web.close(); }
		},
	},
	{
		name: 'browser: pages on local disk and other non-web URLs are refused',
		timeout: 120_000,
		fn: async (t) => {
			t.write('secret.html', '<html><body>LOCAL-SECRET</body></html>');
			const fileUrl = process.platform === 'win32' ? `file:///${t.abs('secret.html').replace(/\\/g, '/')}` : `file://${t.abs('secret.html')}`;
			t.use(seq([
				{ toolCalls: [{ name: 'browser_navigate', args: { url: fileUrl } }] },
				{ toolCalls: [{ name: 'browser_navigate', args: { url: 'javascript:alert(1)' } }] },
				{ text: 'Both were refused.' },
			]));
			await t.send('open the local file in the browser');
			const r = await t.runUntilIdle({ timeout: 100_000 });
			t.check('agent returns to idle', r.idle, JSON.stringify(r));
			const all = t.server.chatRequests().map(x => x.ctx.lastToolResult ?? '').join('\n');
			t.check('the file contents never reach the model', !/LOCAL-SECRET/.test(all), all.slice(0, 300));
			t.check('the model is told the URL was refused', /not allowed|refus|blocked|only opens http|only http|scheme/i.test(t.server.chatRequests()[1]?.ctx.lastToolResult ?? ''), t.server.chatRequests()[1]?.ctx.lastToolResult);
		},
	},
];

// ---------------------------------------------------------------- MCP
export const mcpScenarios = [
	{
		name: 'mcp: a configured stdio MCP server is started and its tool can be called',
		timeout: 240_000,
		fn: async (t) => {
			const cfgDir = path.join(t.app.home, '.vader-editor');
			fs.mkdirSync(cfgDir, { recursive: true });
			const server = process.env.E2E_MCP_FIXTURE || path.resolve(here, '../../fixtures/fixtureMcpServer.mjs'); // CI machines without a full checkout point this at a copy next to an installed SDK
			fs.writeFileSync(path.join(cfgDir, 'mcp.json'), JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [server] } } }, null, 2));
			const find = (c) => c.tools.map(x => x.function?.name).find(n => /echo/i.test(n ?? ''));
			t.use((c) => { const n = find(c); return n ? (c.toolResults.length ? { text: `MCP said: ${c.lastToolResult}` } : { toolCalls: [{ name: n, args: { text: 'hello mcp' } }] }) : { text: 'NO-ECHO-TOOL-YET' }; });
			let offered = false;
			for (let attempt = 0; attempt < 8 && !offered; attempt++) {
				await t.sleep(4000);
				await t.ui.newThread(t.page); await t.sleep(300);
				t.server.reset();
				await t.send('use the echo tool from the MCP server');
				await t.runUntilIdle({ timeout: 60_000 });
				offered = (await t.ui.assistantTexts(t.page)).some(x => x.includes('MCP said'));
			}
			t.check('the MCP tool appears among the tools offered to the model', offered, JSON.stringify(t.server.chatRequests()[0]?.ctx.tools.map(x => x.function?.name)));
			const res = t.server.chatRequests().map(x => x.ctx.lastToolResult ?? '').join('\n');
			t.check('the server really executed the call (echo: hello mcp)', /echo: hello mcp/.test(res), res.slice(0, 300));
		},
	},
];

// ---------------------------------------------------------------- modes, instructions, delegation, memory
export const agentScenarios = [
	{
		name: 'mode: Gather is read-only - edits are refused and mutating tools are not even offered',
		fn: async (t) => {
			await t.setMode('Gather');
			const before = t.read('src/app.js');
			t.use(seq([
				{ toolCalls: [{ name: 'edit_file', args: { uri: t.abs('src/app.js'), search_replace_blocks: SR('  return a - b; // BUG: should add', '  return a + b;') } }] },
				{ text: 'I was not allowed to edit.' },
			]));
			await t.send('fix the bug');
			await t.runUntilIdle({ timeout: 60_000, approveEach: false });
			const names = (t.server.chatRequests()[0]?.ctx.tools ?? []).map(x => x.function?.name);
			t.check('read tools are offered', names.includes('read_file'), names.join(','));
			t.check('edit and terminal tools are NOT offered in Gather mode', !names.includes('edit_file') && !names.includes('run_command'), names.join(','));
			await t.sleep(800);
			t.check('the file was not modified', t.read('src/app.js') === before);
			await t.setMode('Agent');
		},
	},
	{
		name: 'instructions: a .vaderrules file in the workspace is included in what the model is told',
		fn: async (t) => {
			t.write('.vaderrules', 'Always mention the codeword PINEAPPLE-77 when you describe the project.');
			await t.sleep(2500); // file watcher latency
			t.use(() => ({ text: 'ok' }));
			await t.send('describe this project');
			await t.idle();
			const sys = t.server.chatRequests()[0]?.ctx.system ?? '';
			t.check('the workspace rule reaches the model', sys.includes('PINEAPPLE-77'), sys.slice(0, 200));
			t.check('the policy engine summary is also there', /policy engine/i.test(sys));
		},
	},
	{
		name: 'subagent: delegate_subagent_task runs a separate task on the model and returns its result',
		timeout: 180_000,
		fn: async (t) => {
			t.use((c) => {
				if (c.lastUserFull.includes('SUBTASK-MARKER')) { return { text: 'SUBAGENT-RESULT-4711: the answer is forty-two.' }; }
				if (c.toolResults.length) { return { text: `The subagent reported: ${c.lastToolResult}` }; }
				return { toolCalls: [{ name: 'delegate_subagent_task', args: { task: 'SUBTASK-MARKER find the answer to everything' } }] };
			});
			await t.send('delegate finding the answer to a subagent');
			const r = await t.runUntilIdle({ timeout: 150_000 });
			t.check('agent returns to idle', r.idle, JSON.stringify(r));
			const reqs = t.server.chatRequests();
			t.check('the model was called for the subtask as well as for the parent', reqs.some(x => x.ctx.lastUserFull.includes('SUBTASK-MARKER')) && reqs.length >= 3, reqs.length);
			t.check('the subagent result came back to the parent', (await t.ui.assistantTexts(t.page)).some(x => x.includes('SUBAGENT-RESULT-4711')));
		},
	},
	{
		name: 'memory: the remember tool stores a fact and it is offered back in a later chat',
		timeout: 180_000,
		fn: async (t) => {
			t.use((c) => {
				if (c.toolResults.length) { return { text: 'Remembered.' }; }
				if (c.lastUser.includes('what do you know')) { return { text: /ZEBRA-FACT-9/.test(c.allText) ? 'I recall: ZEBRA-FACT-9' : 'I recall nothing.' }; }
				return { toolCalls: [{ name: 'remember', args: { content: 'The deploy key rotation fact is ZEBRA-FACT-9.', label: 'zebra', scope: 'project' } }] };
			});
			await t.send('remember the zebra fact');
			await t.runUntilIdle({ timeout: 60_000 });
			await t.ui.newThread(t.page); await t.sleep(600);
			t.server.reset();
			await t.send('what do you know?');
			await t.runUntilIdle({ timeout: 60_000 });
			t.check('the stored fact is part of the next conversation\'s context', (await t.ui.assistantTexts(t.page)).some(x => x.includes('ZEBRA-FACT-9')), JSON.stringify(await t.ui.assistantTexts(t.page)));
		},
	},
	{
		name: 'verification: run_verification runs the project checks and reports real failures',
		needs: ['natives'],
		timeout: 180_000,
		fn: async (t) => {
			t.use(seq([{ toolCalls: [{ name: 'run_verification', args: {} }] }, { text: 'Verified.' }]));
			await t.send('run the project checks');
			const r = await t.runUntilIdle({ timeout: 150_000 });
			t.check('agent returns to idle', r.idle, JSON.stringify(r));
			const res = t.server.chatRequests()[1]?.ctx.lastToolResult ?? '';
			t.check('the test script ran and its failure is reported', /fail|TEST FAILED|exit/i.test(res) && /test/i.test(res), res.slice(0, 400));
		},
	},
];
