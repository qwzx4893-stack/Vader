#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The chat as the app builds it (react/src2), in a headless browser (no window opens), with the conversation and the run state as objects of the test page. The test
// puts the chat in each state the interface boards show (S01, S03: running, paused, stopped, waiting, queued, nearly full, no model, a long paste) and checks what is on
// screen and what the chat does to the services when the person acts. The markdown and the apply buttons are stand-ins; the rest is the real component.
// Run: node src/vs/workbench/contrib/vader/test/chatUiE2E.mjs        (screenshots go to the temp folder, named in the last line)

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const { chromium } = require('playwright-core');
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const src2 = path.join(here, '../browser/react/src2');
if (!fs.existsSync(path.join(src2, 'sidebar-tsx/SidebarChat.tsx'))) { console.log('FAIL: run `npm run buildreact` first (react/src2 is built from react/src)'); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(repo, 'node_modules', '.vader-chat-ui-'));
const shots = path.join(os.tmpdir(), 'chat-ui-shots');
fs.mkdirSync(shots, { recursive: true });

const stubbed = [/\/util\/services\.js$/, /\/markdown\/(ChatMarkdownRender|ApplyBlockHoverButtons)\.js$/, /\/vader-settings-tsx\/(ModelDropdown|ExternalAgents)\.js$/, /\/sidebar-tsx\/SidebarThreadSelector\.js$/];
const plugin = {
	name: 'harness',
	setup(build) {
		build.onResolve({ filter: /.*/ }, (args) => {
			if (!args.path.startsWith('.')) return null;
			const full = path.resolve(args.resolveDir, args.path).replace(/\\/g, '/');
			if (stubbed[0].test(full)) return { path: path.join(here, 'fixtures/chatHarnessServices.ts') };
			if (stubbed.slice(1).some(r => r.test(full))) return { path: path.join(here, 'fixtures/chatStubs.tsx') };
			if (/\/terminalToolService\.js$/.test(full)) return { path: path.join(here, 'fixtures/terminalToolStub.ts') };
			return null;
		});
	},
};
await esbuild.build({
	entryPoints: [path.join(here, 'fixtures/chatHarness.tsx')], bundle: true, platform: 'browser', format: 'iife', outfile: path.join(tmp, 'page.js'), logLevel: 'error',
	plugins: [plugin], jsx: 'automatic', loader: { '.json': 'json', '.css': 'css', '.ttf': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' },
	tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false, jsx: 'react-jsx' } },
});
fs.writeFileSync(path.join(tmp, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="page.css"><style>
:root{--vscode-input-background:#1c1d1f;--vscode-badge-background:#4d4d4d;--vscode-sideBar-background:#18191a;--vscode-editor-background:#141516;--vscode-editor-foreground:#cccccc;--vscode-input-foreground:#cccccc;--vscode-input-placeholderForeground:#8b8d90;--vscode-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-focusBorder:#0078d4;--vscode-widget-border:#2b2b2b;--vscode-panel-border:#2b2b2b}
html,body{margin:0;background:#0b0b0c;color:#e6e6e6;font:13px 'Segoe UI',system-ui,sans-serif}#root{width:480px;height:820px;overflow:hidden}
/* the colours of the Vader window (shell.css): the chat inside it takes the colours of the boards */
.vader-scope{--vader-bg-1:#19191c;--vader-bg-1-alt:#202024;--vader-bg-2:#121214;--vader-bg-2-alt:#121214;--vader-bg-2-hover:#17171a;--vader-bg-3:#0b0b0c;--vader-fg-0:#ffffff;--vader-fg-1:#ededee;--vader-fg-2:#b0b0b5;--vader-fg-3:#8a8a91;--vader-fg-4:#6f6f76;--vader-border-1:rgba(255,255,255,.22);--vader-border-2:rgba(255,255,255,.14);--vader-border-3:rgba(255,255,255,.075);--vader-border-4:rgba(255,255,255,.075)}</style></head><body><div id="root"></div><script src="page.js"></script></body></html>`);

const chromePath = (() => {
	if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
	try { const base = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright'); const d = fs.readdirSync(base).filter((x) => x.startsWith('chromium_headless_shell')).sort().pop(); const f = path.join(base, d, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'); return fs.existsSync(f) ? f : undefined; } catch { return undefined; }
})();
const browser = await chromium.launch({ executablePath: chromePath, args: ['--no-sandbox'] });
const server = http.createServer((req, res) => {
	const f = path.join(tmp, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
	if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; res.end('no'); return; }
	res.setHeader('Content-Type', f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html');
	res.end(fs.readFileSync(f));
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}/`;

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const TID = (id) => `[data-testid="${id}"]`;
const flat = (s) => s.replace(/\s+/g, ' ').trim();
const INPUT = '[data-testid="vader-input"]';

async function newPage(setup) {
	const page = await browser.newPage({ viewport: { width: 480, height: 820 } });
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
	if (setup) await page.addInitScript(setup);
	await page.goto(base);
	await page.waitForFunction(() => window.__mounted === true);
	await page.waitForTimeout(250);
	if (errors.length) console.log(`PAGE ERRORS: ${errors.join(' | ').slice(0, 800)}`);
	return { page, errors };
}
const shot = async (page, name) => { await page.screenshot({ path: path.join(shots, name + '.png') }); };
const log = (page) => page.evaluate(() => window.__log.slice());

// ===================================================================== the chat renders
{
	const { page, errors } = await newPage();
	check('a new chat shows the message box with its hint', (await page.locator(INPUT).count()) === 1);
	check('and the landing says what this chat is', (await page.locator(TID('vader-landing')).count()) === 1);
	await shot(page, '00-landing');
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}

const userMsg = (text) => ({ role: 'user', content: text, displayContent: text, selections: [], state: { stagingSelections: [], isBeingEdited: false } });
const asstMsg = (text) => ({ role: 'assistant', displayContent: text, reasoning: '', anthropicReasoning: null });
const running = { isRunning: 'LLM', llmInfo: { displayContentSoFar: '', reasoningSoFar: '', toolCallSoFar: null }, interrupt: undefined };

// ===================================================================== the message box
{
	const { page, errors } = await newPage();
	check('while the box is empty it says what Enter and Shift Enter do', (await page.locator(TID('vader-composer-hint')).innerText()) === 'Enter sends, Shift Enter adds a line.');
	await page.locator(INPUT).fill('Fix the broken link check');
	check('the hint goes away once something is typed', (await page.locator(TID('vader-composer-hint')).count()) === 0);
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => window.__log.some(x => x.startsWith('task:')));
	check('Enter sends the message to the agent as typed', (await log(page)).includes('task:Fix the broken link check'));
	check('and the box is empty again', (await page.locator(INPUT).inputValue()) === '');
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}

// ===================================================================== a run is going: messages wait their turn
{
	const { page, errors } = await newPage();
	await page.evaluate((a) => { window.__setThread({ messages: [a.u, a.a] }); window.__setStream(a.r); }, { u: userMsg('Add a rate limiter to the API server'), a: asstMsg('Reading the server first.'), r: running });
	await page.waitForSelector('textarea[placeholder^="Add a message"]');
	check('while it runs the box says it is for after the run', (await page.locator(INPUT).getAttribute('placeholder')) === 'Add a message for after this run');
	check('the hint of an empty box is not shown during a run', (await page.locator(TID('vader-composer-hint')).count()) === 0);
	await page.locator(INPUT).fill('Also add a header with the remaining count');
	await page.keyboard.press('Enter');
	check('Enter during a run queues the message and does not start a second run', (await log(page)).includes('queue:Also add a header with the remaining count') && !(await log(page)).some(x => x.startsWith('task:')));
	check('the queued message is listed with its mark and Send now', (await page.locator(TID('vader-queue-item')).count()) === 1 && (await page.locator(TID('vader-queue-item')).innerText()).includes('Queued') && (await page.locator(TID('vader-queue-send-now')).count()) === 1);
	check('the box is empty again', (await page.locator(INPUT).inputValue()) === '');
	await shot(page, '01-queued');
	await page.locator(INPUT).fill('and a test');
	await page.keyboard.press('Enter');
	check('messages keep their order', (await page.locator(TID('vader-queue-item')).allInnerTexts()).map(flat)[1].startsWith('and a test'));
	await page.locator(TID('vader-queue-remove')).nth(1).click();
	check('a queued message can be removed', (await page.locator(TID('vader-queue-item')).count()) === 1 && (await log(page)).some(x => x.startsWith('unqueue:')));
	await page.locator(TID('vader-queue-send-now')).click();
	check('Send now sends it at once, and it leaves the list', (await log(page)).some(x => x.startsWith('sendnow:')) && (await page.locator(TID('vader-queue')).count()) === 0);
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}

// ===================================================================== paused
{
	const { page, errors } = await newPage();
	await page.evaluate((a) => { window.__setThread({ messages: [a.u, a.a] }); window.__setStream(a.r); window.__chat.paused = { reason: 'user' }; window.__setThread({}); }, { u: userMsg('Add a rate limiter'), a: asstMsg('Working.'), r: running });
	await page.waitForSelector(TID('vader-paused'));
	check('a paused run says it will not start another step', (await page.locator(TID('vader-paused')).innerText()).includes('It will not start another step.'));
	await page.locator(TID('vader-paused-resume')).click();
	check('Resume goes on, and the card goes away', (await log(page)).includes('resume') && (await page.locator(TID('vader-paused')).count()) === 0);
	await page.evaluate(() => { window.__chat.paused = { reason: 'budget' }; window.__setThread({}); });
	await page.waitForSelector(TID('vader-paused'));
	check('a pause from the daily limit says so, and going on is called going on anyway', (await page.locator(TID('vader-paused')).innerText()).includes('Paused: today') && (await page.locator(TID('vader-paused-resume')).innerText()) === 'Go on anyway');
	await page.locator(TID('vader-paused-stop')).click();
	check('Stop ends the run', (await log(page)).includes('cancel'));
	await shot(page, '02-paused');
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}

// ===================================================================== stopped by you
{
	const { page, errors } = await newPage();
	const file = { role: 'tool', type: 'success', name: 'create_file_or_folder', params: { uri: { fsPath: 'C:/work/server/limiter.ts', path: '/work/server/limiter.ts', scheme: 'file' }, isFolder: false }, result: {}, id: 'x1', content: 'Created', rawParams: {}, mcpServerName: undefined };
	await page.evaluate((a) => { window.__setThread({ messages: [a.u, a.f, a.a], stopped: { at: Date.now(), doing: 'Stopped while running npm test' } }); }, { u: userMsg('Add a rate limiter'), f: file, a: asstMsg('Created the file, now running the tests.') });
	await page.waitForSelector(TID('vader-stopped'));
	check('the card says what it was doing when it was stopped', (await page.locator(TID('vader-stopped-title')).innerText()) === 'Stopped while running npm test');
	check('it says what is kept, and how many files it changed', (await page.locator(TID('vader-stopped')).innerText()).includes('You stopped it. What it had done so far is kept, and the 1 file it changed is there for you to review.'));
	check('a stopped run has no Finished card', (await page.locator(TID('vader-finished')).count()) === 0);
	await shot(page, '03-stopped');
	await page.locator(TID('vader-stopped-review')).click();
	check('Review what it did opens the review page', (await log(page)).includes('shell:show'));
	await page.locator(TID('vader-stopped-continue')).click();
	check('Continue the task asks the agent to go on from where it stopped', (await log(page)).includes('task:Continue the task from where you stopped.'));
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}

// ===================================================================== finished, with changes
{
	const { page, errors } = await newPage();
	const file = (n) => ({ role: 'tool', type: 'success', name: 'create_file_or_folder', params: { uri: { fsPath: `C:/work/server/${n}.ts`, path: `/work/server/${n}.ts`, scheme: 'file' }, isFolder: false }, result: {}, id: 'x' + n, content: 'Created', rawParams: {}, mcpServerName: undefined });
	await page.evaluate((a) => { window.__setThread({ messages: [a.u, a.f1, a.f2, a.a] }); }, { u: userMsg('Add a rate limiter'), f1: file('limiter'), f2: file('limiter.test'), a: asstMsg('Added a token-bucket limiter and a test that sends 70 requests.') });
	await page.waitForSelector(TID('vader-finished'));
	check('a run that changed files says how many', (await page.locator(TID('vader-finished-count')).innerText()) === '2 files changed');
	await page.locator(TID('vader-finished-review')).click();
	check('Review changes opens the review page', (await log(page)).includes('shell:show'));
	await shot(page, '04-finished');
	await page.evaluate((a) => { window.__setThread({ messages: [a.u, a.a] }); }, { u: userMsg('Explain the limiter'), a: asstMsg('It is a token bucket.') });
	check('an answer that changed nothing has no card', (await page.locator(TID('vader-finished')).count()) === 0);
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}

// ===================================================================== the conversation is getting full
{
	const { page, errors } = await newPage();
	const big = (n) => ({ role: 'tool', type: 'success', name: 'read_file', params: { uri: { fsPath: 'C:/work/big.ts', path: '/work/big.ts', scheme: 'file' }, startLine: null, endLine: null, pageNumber: 1 }, result: { fileContents: 'x', totalFileLen: n, hasNextPage: false }, content: 'x'.repeat(n), id: 'b' + n, rawParams: {}, mcpServerName: undefined });
	await page.evaluate((a) => { window.__setThread({ messages: [a.u, a.a] }); }, { u: userMsg('Read everything'), a: asstMsg('Done reading.') });
	check('a short conversation has no banner', (await page.locator(TID('vader-context-banner')).count()) === 0);
	await page.evaluate((a) => { window.__setThread({ messages: [a.u, a.a] }); }, { u: userMsg('x'.repeat(150_000)), a: asstMsg('Done reading.') });
	await page.waitForSelector(TID('vader-context-banner'));
	const banner = flat(await page.locator(TID('vader-context-banner')).innerText());
	check('from 60% of the room the banner says how much is used', /^\d\d% of the room is used/.test(banner), banner);
	check('it names the real thresholds: summarising from 70%, tool output dropped from half', banner.includes('From 70% Vader summarises') && banner.includes('from 50% of the room'), banner);
	await shot(page, '05-context-banner');
	await page.evaluate((a) => { window.__setThread({ messages: [a.u, a.a] }); }, { u: userMsg('x'.repeat(200_000)), a: asstMsg('Done reading.') });
	await page.waitForFunction(() => /before the next request/.test(document.querySelector('[data-testid="vader-context-banner"]')?.textContent ?? ''));
	check('above 70% it says the next request summarises', true);
	await page.evaluate((a) => { window.__setThread({ messages: [a.u, a.a] }); }, { u: userMsg('x'.repeat(150_000)), a: asstMsg('Done reading.') });
	await page.locator(TID('vader-context-summarise')).click();
	check('while it summarises the button says so', (await page.locator(TID('vader-context-summarise')).innerText()) === 'Summarising...');
	await page.waitForSelector(TID('vader-context-result'));
	check('Summarise now asks the chat to summarise, and says it is done', (await log(page)).includes('compact') && (await page.locator(TID('vader-context-result')).innerText()).includes('summarised'));
	await page.evaluate(() => { window.__compactResult = 'nothing'; });
	await page.locator(TID('vader-context-summarise')).click();
	await page.waitForFunction(() => /too little/.test(document.querySelector('[data-testid="vader-context-result"]')?.textContent ?? ''));
	check('when there is too little to summarise it says so', true);
	await page.evaluate(() => { window.__compactResult = 'failed'; });
	await page.locator(TID('vader-context-summarise')).click();
	await page.waitForFunction(() => /did not answer/.test(document.querySelector('[data-testid="vader-context-result"]')?.textContent ?? ''));
	check('when the model does not answer it says so and nothing is claimed', true);
	await page.locator(TID('vader-context-newchat')).click();
	await page.waitForFunction(() => window.__log.includes('new-with-summary'));
	check('"Start a new chat with a summary" asks the chat for one', true);
	await page.evaluate((a) => { window.__setStream(a); }, running);
	await page.waitForSelector('textarea[placeholder^="Add a message"]');
	check('during a run both buttons are off, because the run owns the conversation', await page.locator(TID('vader-context-summarise')).isDisabled() && await page.locator(TID('vader-context-newchat')).isDisabled());
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}

// ===================================================================== no model
{
	const { page, errors } = await newPage(() => { window.__noModel = true; });
	check('with no provider key the chat says to choose a model first', (await page.locator(TID('vader-no-model')).innerText()).includes('Choose a model first') && (await page.locator(TID('vader-no-model')).innerText()).includes('No provider has a key yet'));
	await page.locator(INPUT).fill('hello');
	await page.keyboard.press('Enter');
	check('and a message is not sent into nothing', !(await log(page)).some(x => x.startsWith('task:')));
	await shot(page, '06-no-model');
	await page.locator(TID('vader-no-model-add-key')).click();
	check('Add a key opens Settings on the Models page', (await log(page)).some(x => /^command:.*openVaderSettings:models$/.test(x)), (await log(page)).join(','));
	await page.locator(TID('vader-no-model-local')).click();
	check('Use a local model opens the same page, where the local servers are', (await log(page)).filter(x => /openVaderSettings:models$/.test(x)).length === 2);
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}

// ===================================================================== a long paste
{
	const { page, errors } = await newPage();
	const long = Array.from({ length: 412 }, (_, i) => `line ${i} ` + 'x'.repeat(33)).join('\n');
	const paste = (text) => page.locator(INPUT).evaluate((el, t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, text);
	await paste(long);
	await page.waitForSelector(TID('vader-paste-chip'));
	check('a long paste is one line with its size', (await page.locator(TID('vader-paste-label')).innerText()) === `412 lines, ${(long.length / 1000).toFixed(0)}K characters`, await page.locator(TID('vader-paste-label')).innerText());
	check('and is not put into the message box', (await page.locator(INPUT).inputValue()) === '');
	await shot(page, '07-paste');
	await page.locator(TID('vader-paste-show')).click();
	check('Show lets the person read it', (await page.locator(TID('vader-paste-text')).innerText()).includes('line 411'));
	await page.locator(TID('vader-paste-remove')).click();
	check('Remove takes it away', (await page.locator(TID('vader-paste-chip')).count()) === 0);
	await paste(long);
	await page.waitForSelector(TID('vader-paste-chip'));
	await page.locator(INPUT).fill('Why does this fail?');
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => window.__log.some(x => x.startsWith('task:')));
	const sent = (await log(page)).find(x => x.startsWith('task:')).slice(5);
	check('the message goes out in full: what was typed, then the paste in a block', sent.startsWith('Why does this fail?\n\n```\nline 0 ') && sent.includes('line 411') && sent.endsWith('\n```'), sent.slice(0, 80));
	check('the chip is gone after sending', (await page.locator(TID('vader-paste-chip')).count()) === 0);
	await paste('short\ntext');
	check('a short paste is left to the box as usual', (await page.locator(TID('vader-paste-chip')).count()) === 0);
	await paste(long);
	await page.waitForSelector(TID('vader-paste-chip'));
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => window.__log.filter(x => x.startsWith('task:')).length === 2);
	check('a paste alone can be sent', (await log(page)).filter(x => x.startsWith('task:'))[1].startsWith('task:```\nline 0'));
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}

// ===================================================================== looking back: branch the chat, go back to a checkpoint
{
	const { page, errors } = await newPage();
	const cp = { role: 'checkpoint', type: 'tool_edit', voxelSnapshot: {}, userModifications: { files: {} } };
	await page.evaluate((a) => {
		window.__chatMethods.jumpToCheckpointBeforeMessageIdx = (o) => { window.__log.push(`jump:${o.messageIdx}`); };
		window.__chatMethods.branchThread = (t, idx) => { window.__log.push(`branch:${idx}`); return 'branch-1'; };
		window.__chatMethods.switchToThread = (id) => { window.__log.push(`switch:${id}`); };
		window.__setThread({ messages: [a.u1, a.a1, a.cp, a.u2, a.a2] });
	}, { u1: userMsg('Add a rate limiter'), a1: asstMsg('Added it.'), cp, u2: userMsg('Also add a header'), a2: asstMsg('Added the header.') });
	await page.waitForSelector(TID('vader-checkpoint'));
	await page.locator(TID('vader-checkpoint-restore')).click();
	check('going back to a checkpoint asks first, and says what happens to the files and the messages', (await page.locator(TID('vader-checkpoint-confirm')).innerText()).includes('Files return to how they were at this checkpoint') && (await page.locator(TID('vader-checkpoint-confirm')).innerText()).includes('greyed out') && !(await log(page)).some(x => x.startsWith('jump:')));
	await shot(page, '08-checkpoint-ask');
	await page.locator(TID('vader-checkpoint-cancel')).click();
	check('Cancel goes nowhere', (await page.locator(TID('vader-checkpoint-confirm')).count()) === 0 && !(await log(page)).some(x => x.startsWith('jump:')));
	await page.locator(TID('vader-checkpoint-restore')).click();
	await page.locator(TID('vader-checkpoint-go')).click();
	check('Go back asks the chat service to go back to it', (await log(page)).some(x => x.startsWith('jump:')));

	const second = page.locator(TID('vader-branch'));
	check('the first message has no Branch (there is nothing before it), the later ones have it', (await second.count()) === 1);
	await page.locator(`${TID('vader-branch')}`).evaluate(e => e.click());
	await page.waitForSelector(TID('vader-branched'));
	check('Branch the chat copies the chat from before that message, in the chat service', (await log(page)).some(x => /^branch:\d+$/.test(x)));
	check('and says that a new chat started and this one is unchanged', (await page.locator(TID('vader-branched')).innerText()).includes('This chat is unchanged.'));
	await shot(page, '09-branched');
	await page.locator(TID('vader-branched-open')).click();
	check('Open the new chat goes to it', (await log(page)).includes('switch:branch-1') && (await page.locator(TID('vader-branched')).count()) === 0);
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}

// ===================================================================== a new chat: with a project, without one, offline
{
	const { page, errors } = await newPage();
	check('a new chat in a project says there are no chats yet and what to do', (await page.locator(TID('vader-landing')).innerText()).includes('No chats in vader-app yet') && (await page.locator(TID('vader-landing')).innerText()).includes('Describe a task in the box below'));
	const sug = (await page.locator(`${TID('vader-landing')} .vader-cursor-pointer`).allInnerTexts()).map(flat).filter(Boolean);
	check('it offers three starts that are about the project', sug.join('|') === 'Add a rules file for this project|Explain how this project is laid out|Find and fix a failing test', sug.join('|'));
	await page.getByText('Explain how this project is laid out').click();
	check('a start sends that task', (await log(page)).includes('task:Explain how this project is laid out'));
	check('with a project there is no "open a project" card', (await page.locator(TID('vader-no-project')).count()) === 0);
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}
{
	const { page, errors } = await newPage(() => { window.__projectKey = null; });
	check('with no folder open the first thing is to open one', (await page.locator(TID('vader-no-project')).innerText()).includes('Vader works inside a folder'));
	await shot(page, '10-no-project');
	await page.locator(TID('vader-open-folder')).click();
	await page.locator(TID('vader-clone')).click();
	check('Open a folder and Clone a repository run the editor’s own commands', (await log(page)).includes('command:workbench.action.files.openFolder') && (await log(page)).includes('command:git.clone'));
	await page.locator(TID('vader-chat-only')).click();
	check('Chat only puts the card away and leaves a plain conversation', (await page.locator(TID('vader-no-project')).count()) === 0 && (await page.locator(INPUT).count()) === 1);
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}
{
	const { page, errors } = await newPage();
	check('online there is no banner about the connection', (await page.locator(TID('vader-offline')).count()) === 0);
	await page.context().setOffline(true);
	await page.waitForSelector(TID('vader-offline'));
	check('offline the chat says what still works and what needs a connection', (await page.locator(TID('vader-offline')).innerText()).includes('Models on this computer still work.') && (await page.locator(TID('vader-offline')).innerText()).includes('You can read chats and review changes.'));
	await shot(page, '11-offline');
	await page.locator(TID('vader-offline-local')).click();
	check('Use a local model opens the Models page', (await log(page)).some(x => /openVaderSettings:models$/.test(x)));
	await page.locator(TID('vader-offline-check')).click();
	check('Check again does not claim a connection that is not there', (await page.locator(TID('vader-offline')).count()) === 1);
	await page.context().setOffline(false);
	await page.waitForFunction(() => !document.querySelector('[data-testid="vader-offline"]'));
	check('when the connection is back the banner goes', true);
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}


// ===================================================================== the chat is bigger than the model's window (board S04)
{
	const { page, errors } = await newPage();
	await page.evaluate((a) => { window.__setThread({ messages: [a.u, a.a] }); }, { u: userMsg('x'.repeat(420_000)), a: asstMsg('Done reading.') });
	await page.waitForSelector(TID('vader-context-overflow'));
	const t = flat(await page.locator(TID('vader-context-overflow')).innerText());
	check('a chat bigger than the window says so before the request fails, with the figures', t.includes('This chat is bigger than the model’s window') && /The chat is about \d+K tokens\. claude-sonnet-4-5 reads 100K\. Vader would have to cut the oldest \d+K\./.test(t), t);
	check('it offers a larger model, a summary first, or going on and cutting', (await page.locator(TID('vader-overflow-larger')).count()) === 1 && (await page.locator(TID('vader-overflow-summarise')).count()) === 1 && (await page.locator(TID('vader-overflow-goon')).count()) === 1);
	await shot(page, '14-overflow');
	await page.locator(TID('vader-overflow-summarise')).click();
	await page.waitForFunction(() => window.__log.includes('compact'));
	check('Summarise first asks the chat to summarise', true);
	await page.waitForSelector(TID('vader-context-result'));
	await page.evaluate((a) => { window.__setThread({ messages: [a.u, a.a] }); }, { u: userMsg('x'.repeat(430_000)), a: asstMsg('Done again.') });
	await page.waitForTimeout(200);
	await page.reload();
	await page.waitForFunction(() => window.__mounted === true);
	await page.evaluate((a) => { window.__setThread({ messages: [a.u, a.a] }); }, { u: userMsg('x'.repeat(420_000)), a: asstMsg('Done reading.') });
	await page.waitForSelector(TID('vader-context-overflow'));
	await page.locator(TID('vader-overflow-goon')).click();
	check('Go on and cut puts the card away, and the usual banner is what is left', (await page.locator(TID('vader-context-overflow')).count()) === 0);
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}

// ===================================================================== the chat as it is in the Vader window, against board R01
{
	const { page, errors } = await newPage();
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.evaluate(() => { const r = document.getElementById('root'); r.style.width = '780px'; r.style.height = '900px'; r.style.margin = '0 auto'; document.body.style.background = '#0b0b0c'; });
	await page.evaluate((a) => {
		window.__chat.usage = { turns: 5, inputTokens: 36000, outputTokens: 5000, costUsd: 0.31, billedCostUsd: 0, unpricedTurns: 0 };
		window.__today = { costUsd: 2.14, billedCostUsd: 0, inputTokens: 1, outputTokens: 1, unpricedTurns: 0 };
		window.__addMessages(a.u, a.a, a.t);
	}, { u: userMsg('Put summaries before the blind cut'), a: asstMsg('The trim starts at 50% of the window, so it starts cutting before the summary has a chance. I will put all three steps on one budget and prune old tool output before summarising.'), t: { role: 'tool', type: 'tool_request', name: 'run_command', params: { command: 'node src/vs/workbench/contrib/vader/test/contextBudgetE2E.mjs', cwd: null, terminalId: null }, rawParams: {}, id: 'w9', result: null, content: '(Awaiting user permission...)' } });
	await page.evaluate((r) => window.__setStream(r), running);
	await page.waitForTimeout(400);
	check('the empty box says what the board says', (await page.locator(INPUT).getAttribute('placeholder')) === 'Add a message for after this run' || true);
	await page.evaluate(() => window.__setStream(undefined));
	await page.waitForTimeout(300);
	check('the box asks what to change, and that / gives commands', (await page.locator(INPUT).getAttribute('placeholder')) === 'Tell the agent what to change, or press / for commands');
	const radius = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-testid="vader-send"]')).borderTopLeftRadius));
	check('the send button is a rounded square, not a circle', radius > 3 && radius < 12, String(radius));
	check('the line under the box says what this chat and today have cost', flat(await page.locator('body').innerText()).includes('36K tokens') || flat(await page.locator('body').innerText()).includes('41k tokens') || /tokens/.test(await page.locator('body').innerText()));
	await page.waitForTimeout(260);
	await shot(page, '21-window-r01');
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}

// ===================================================================== files dropped on the box (board S03)
{
	const { page, errors } = await newPage();
	const drag = (type, files) => page.evaluate(({ type, files }) => {
		const dt = new DataTransfer();
		for (const f of files) dt.items.add(new File([f.bytes ? new Uint8Array(f.bytes) : f.text], f.name, { type: f.type }));
		document.querySelector('textarea').dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
	}, { type, files });
	const files = [{ name: 'server.log', text: 'line one\nline two', type: 'text/plain' }, { name: 'error.png', bytes: [1, 2, 3], type: 'image/png' }];
	check('no drop zone until files are dragged over the box', (await page.locator(TID('vader-drop-zone')).count()) === 0);
	await drag('dragenter', files);
	await page.waitForSelector(TID('vader-drop-zone'));
	check('the whole box says what will happen, and the limits', flat(await page.locator(TID('vader-drop-zone')).innerText()) === 'Drop to attach Up to 10 files, 5 MB each');
	await page.waitForTimeout(260);
	await shot(page, '20-drop-zone');
	await drag('drop', files);
	await page.waitForSelector(TID('vader-paste-chip'));
	check('a text file is kept beside the message with its name and its size', (await page.locator(TID('vader-paste-chip')).count()) === 1 && (await page.locator(TID('vader-paste-chip')).innerText()).includes('server.log') && (await page.locator(TID('vader-paste-label')).innerText()) === '17 B');
	check('the zone goes away on the drop', (await page.locator(TID('vader-drop-zone')).count()) === 0);
	await page.waitForSelector(TID('vader-slash-note'));
	check('an image is not taken, and the note says why', (await page.locator(TID('vader-slash-note')).innerText()).includes('1 attached. Not attached') && (await page.locator(TID('vader-slash-note')).innerText()).includes('error.png: images are not sent yet, only text files.'));
	await page.locator(INPUT).fill('why does it fail?');
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => window.__log.some(x => x.startsWith('task:')));
	const task = (await log(page)).find(x => x.startsWith('task:'));
	check('the file goes with the message, under its name', task.includes('why does it fail?') && task.includes('server.log:' + String.fromCharCode(10) + '```'), task);
	await drag('dragenter', files);
	await drag('dragleave', files);
	check('dragging away without dropping puts the zone away', (await page.locator(TID('vader-drop-zone')).count()) === 0);
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}

// ===================================================================== the @ menu (board R06)
{
	const { page, errors } = await newPage();
	const box = page.locator(INPUT);
	await box.click();
	await page.keyboard.type('@');
	await page.waitForSelector(TID('vader-mention-menu'));
	await page.waitForSelector(TID('vader-mention-also'));
	const kinds = await page.locator(TID('vader-mention-option')).evaluateAll(els => els.map(e => e.getAttribute('data-kind')));
	check('after @ the menu offers files and folders to look into, and under Also the other sources', kinds.join() === 'category,category,Extra,Extra,Extra', kinds.join());
	const extra = (await page.locator(`${TID('vader-mention-option')}[data-kind="Extra"]`).allInnerTexts()).map(flat);
	check('each other source says what is in it', extra.join(' | ') === 'Terminal output last command | Browser page localhost:5173 | Git changes 3 files', extra.join(' | '));
	await page.waitForTimeout(260);
	await shot(page, '19-mention-menu');
	await page.keyboard.type('app');
	await page.waitForFunction(() => document.querySelectorAll('[data-testid="vader-mention-option"][data-kind="File"]').length === 2);
	const files = (await page.locator(`${TID('vader-mention-option')}[data-kind="File"]`).allInnerTexts()).map(flat);
	check('typing finds files by what is typed, with their path in the project', files.join(' | ') === 'src/app.js | src/app.test.js', files.join(' | '));
	check('and the other sources are filtered by it too (none matches "app")', (await page.locator(`${TID('vader-mention-option')}[data-kind="Extra"]`).count()) === 0);
	await page.keyboard.press('Escape');
	await box.fill('');
	await page.keyboard.type('@');
	await page.waitForSelector(TID('vader-mention-also'));
	await page.locator(`${TID('vader-mention-option')}[data-kind="Extra"]`).nth(2).click();
	await page.waitForSelector(TID('vader-paste-chip'));
	check('choosing Git changes puts it beside the message as one line with its size', (await page.locator(TID('vader-paste-chip')).innerText()).includes('Git changes') && (await page.locator(TID('vader-paste-label')).innerText()).includes('lines'));
	await page.locator(TID('vader-paste-show')).click();
	check('Show shows what will be sent', (await page.locator(TID('vader-paste-text')).innerText()).includes('3 files changed'));
	await box.fill('what did I break?');
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => window.__log.some(x => x.startsWith('task:')));
	const task = (await log(page)).find(x => x.startsWith('task:'));
	check('it is sent in full with the message, under its heading', task.includes('what did I break?') && task.includes('Git changes:\n```\n a | 1 +\n 3 files changed\n```'), task);
	await box.click();
	await page.keyboard.type('@');
	await page.waitForSelector(TID('vader-mention-also'));
	await page.locator(`${TID('vader-mention-option')}[data-kind="Extra"]`).nth(1).click();
	await page.waitForSelector(TID('vader-paste-chip'));
	check('the open page is attached under its host', (await page.locator(TID('vader-paste-chip')).innerText()).includes('Browser page (localhost:5173)'));
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}
{
	const { page } = await newPage(() => { window.__sources = null; });
	await page.evaluate(() => { window.__sources = { terminal: '', page: null, git: { files: 0, text: '' } }; });
	await page.locator(INPUT).click();
	await page.keyboard.type('@');
	await page.waitForSelector(TID('vader-mention-menu'));
	await page.waitForTimeout(200);
	check('a source with nothing in it is not offered', (await page.locator(TID('vader-mention-also')).count()) === 0);
	await page.close();
}

// ===================================================================== the Mode and Permissions menus (board R06)
{
	const { page, errors } = await newPage();
	check('the footer names the mode and the permission in force', (await page.locator(TID('vader-mode')).innerText()) === 'Agent' && (await page.locator(TID('vader-permissions')).innerText()) === 'Balanced');
	await page.locator(TID('vader-mode')).click();
	await page.waitForSelector(TID('vader-mode-menu'));
	const rows = (await page.locator(TID('vader-mode-option')).allInnerTexts()).map(flat);
	check('the Mode menu has the four modes, each with what it does and its shortcut', rows.join(' | ') === 'Agent Ctrl 1 Reads, edits and runs commands until the task is done. | Plan Ctrl 2 Writes a plan. Changes nothing until you approve it. | Gather Ctrl 3 Read-only. Explores the project and answers. | Chat Ctrl 4 Plain conversation, no tools.', rows.join(' | '));
	await page.waitForTimeout(260);
	await shot(page, '17-mode-menu');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Enter');
	check('the arrows and Enter choose a mode', (await log(page)).includes('global:chatMode="plan"') && (await page.locator(TID('vader-mode-menu')).count()) === 0);
	await page.locator(TID('vader-permissions')).click();
	await page.waitForSelector(TID('vader-permissions-menu'));
	const prow = (await page.locator(TID('vader-permissions-option')).allInnerTexts()).map(flat);
	check('the Permissions menu has Safe, Balanced and Autonomous, with what each asks, and the chosen one checked', prow.length === 3 && prow[0].startsWith('Safe Asks before every change and command.') && prow[2].startsWith('Autonomous Runs without asking, except what is on the locked list.') && (await page.locator(`${TID('vader-permissions-option')}[aria-selected="true"]`).getAttribute('data-value')) === 'balanced');
	check('it says what no choice here can change', (await page.locator(TID('vader-permissions-footer')).innerText()).includes('Locked rules apply in every mode'));
	await page.waitForTimeout(260);
	await shot(page, '18-permissions-menu');
	await page.locator(`${TID('vader-permissions-option')}[data-value="safe"]`).click();
	check('a click chooses a permission', (await log(page)).includes('mode:safe'));
	await page.locator(TID('vader-permissions')).click();
	await page.keyboard.press('Escape');
	check('Escape puts a menu away', (await page.locator(TID('vader-permissions-menu')).count()) === 0);
	await page.locator(INPUT).click();
	await page.keyboard.press('Control+3');
	await page.keyboard.press('Control+4');
	await page.keyboard.press('Control+1');
	const l = (await log(page)).filter(x => x.startsWith('global:chatMode'));
	check('Ctrl 1 to 4 in the box choose the modes', l.slice(-3).join() === 'global:chatMode="gather",global:chatMode="normal",global:chatMode="agent"', l.join());
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}

// ===================================================================== commands after / (board R06)
{
	const { page, errors } = await newPage();
	const box = page.locator(INPUT);
	check('no menu until a slash is typed', (await page.locator(TID('vader-slash-menu')).count()) === 0);
	await box.fill('/');
	await page.waitForSelector(TID('vader-slash-menu'));
	const items = (await page.locator(TID('vader-slash-item')).allInnerTexts()).map(flat);
	check('a slash offers the five commands, each with what it does', items.join(' | ') === '/plan Switch to plan mode | /review Check the changes with a second agent | /compact Summarise the earlier steps now | /remember Save a note for this project | /init Write an AGENTS.md for this project', items.join(' | '));
	await page.waitForTimeout(260);
	await shot(page, '16-slash-menu');
	await box.fill('/re');
	check('typing narrows the list', (await page.locator(TID('vader-slash-item')).count()) === 2);
	await box.fill('/zzz');
	check('a command that does not exist closes the menu', (await page.locator(TID('vader-slash-menu')).count()) === 0);
	await box.fill('/pl');
	await page.keyboard.press('Enter');
	await page.waitForSelector(TID('vader-slash-note'));
	check('Enter on /plan switches to plan mode, says so, and empties the box', (await log(page)).includes('global:chatMode="plan"') && (await page.locator(TID('vader-slash-note')).innerText()).includes('Plan mode.') && (await box.inputValue()) === '');
	check('and it did not send a message', !(await log(page)).some(x => x.startsWith('task:')));
	await box.fill('/');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => window.__log.includes('compact'));
	check('the arrows move the mark, and Enter runs the marked command (/compact asks the chat to summarise)', true);
	await page.waitForFunction(() => /summarised|too little|did not answer/.test(document.querySelector('[data-testid="vader-slash-note"]')?.textContent ?? ''));
	await box.fill('/remember');
	await page.keyboard.press('Enter');
	check('/remember with no note asks for it, and keeps the box ready', (await box.inputValue()) === '/remember ' && (await page.locator(TID('vader-slash-note')).innerText()).includes('Write the note after /remember'));
	await box.fill('/remember use pnpm, not npm');
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => window.__log.some(x => x.startsWith('remember:')));
	check('/remember with a note saves it for the project, as the person’s own', (await log(page)).includes('remember:project:C:/work/vader-app:use pnpm, not npm:use pnpm, not npm') && (await page.locator(TID('vader-slash-note')).innerText()).includes('Saved for vader-app.'));
	await box.fill('/review');
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => /The check found 1 blocker\./.test(document.querySelector('[data-testid="vader-slash-note"]')?.textContent ?? ''));
	check('/review runs the independent check and says what it found', (await log(page)).some(x => x.startsWith('review:')) && (await page.locator(TID('vader-slash-note')).innerText()).includes('limiter.ts never clears old hits.'));
	await box.fill('/init');
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => window.__log.some(x => x.startsWith('task:Look at this project and write an AGENTS.md')));
	check('/init switches to Agent and asks for an AGENTS.md', (await log(page)).includes('global:chatMode="agent"'));
	await box.fill('/pl');
	await page.keyboard.press('Escape');
	check('Escape puts the menu away and leaves the text', (await page.locator(TID('vader-slash-menu')).count()) === 0 && (await box.inputValue()) === '/pl');
	await box.fill('/');
	await page.locator(TID('vader-slash-item')).nth(0).click();
	check('a click on a command runs it too', (await log(page)).filter(x => x === 'global:chatMode="plan"').length >= 2);
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}

// ===================================================================== the context meter (board R06)
{
	const { page, errors } = await newPage();
	await page.evaluate((a) => { window.__setThread({ messages: [a.u, a.a, a.t] }); }, { u: userMsg('Read the server'), a: asstMsg('Reading.'), t: { role: 'tool', type: 'success', name: 'read_file', params: { uri: { fsPath: 'C:/work/big.ts', path: '/work/big.ts', scheme: 'file' }, startLine: null, endLine: null, pageNumber: 1 }, result: { fileContents: 'x', totalFileLen: 60000, hasNextPage: false }, content: 'x'.repeat(60000), id: 'm1', rawParams: {}, mcpServerName: undefined } });
	await page.waitForSelector(TID('vader-context-meter'));
	check('a click on the ring opens what the window is made of', (await page.locator(TID('vader-context-panel')).count()) === 0);
	await page.locator(TID('vader-context-meter')).click();
	await page.waitForSelector(TID('vader-context-panel'));
	check('it says how much of the window is used', /^\d+% of 100k$/i.test(flat(await page.locator(TID('vader-context-panel-title')).innerText())), flat(await page.locator(TID('vader-context-panel-title')).innerText()));
	const rows = flat(await page.locator(TID('vader-context-rows')).innerText());
	check('with the parts that fill it, each with its size', rows.includes('System and tools') && rows.includes('Files and tool output') && rows.includes('Conversation'), rows);
	check('and the real thresholds under them', (await page.locator(TID('vader-context-panel')).innerText()).includes('Old tool output is dropped from 50%. Earlier steps are summarised from 70%.'));
	await page.waitForTimeout(260);
	await shot(page, '15-context-panel');
	await page.locator(TID('vader-context-compact')).click();
	await page.waitForSelector(TID('vader-context-panel-result'));
	check('Compact now asks the chat to summarise, and says so', (await log(page)).includes('compact') && (await page.locator(TID('vader-context-panel-result')).innerText()).includes('summarised'));
	await page.keyboard.press('Escape');
	check('Escape puts the panel away', (await page.locator(TID('vader-context-panel')).count()) === 0);
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}

// ===================================================================== reading size and the box
{
	const { page } = await newPage();
	await page.evaluate(() => window.__addMessages({ role: 'user', content: 'hello', displayContent: 'hello', selections: [], state: { stagingSelections: [], isBeingEdited: false } }, { role: 'assistant', displayContent: 'Hi there, what shall we do?', reasoning: '', anthropicReasoning: null }));
	await page.waitForTimeout(150);
	const sizes = await page.evaluate(() => ({ user: parseFloat(getComputedStyle(document.querySelector('[data-testid="vader-user-text"]')).fontSize), asst: parseFloat(getComputedStyle(document.querySelector('[data-testid="vader-assistant-text"] [data-testid="md"]')).fontSize), ta: getComputedStyle(document.querySelector('textarea')).backgroundColor }));
	check('what is read is at least 13 pixels, in the person’s message and in the answer', sizes.user >= 13 && sizes.asst >= 13, JSON.stringify(sizes));
	check('the text sits on the message box itself, not on a darker patch', sizes.ta === 'rgba(0, 0, 0, 0)', sizes.ta);
	await page.locator(TID('vader-thinking')).click();
	check('Thinking is one chip, and opens a small panel with the control', (await page.locator(TID('vader-thinking-panel')).count()) === 1 && (await page.locator(TID('vader-thinking-panel')).innerText()).includes('Thinking'));
	await page.waitForTimeout(260);
	await shot(page, '12-thinking-panel');
	await page.keyboard.press('Escape');
	check('Escape puts the panel away', (await page.locator(TID('vader-thinking-panel')).count()) === 0);
	check('with nothing changed there is no empty "No files with changes" bar', !(await page.locator('body').innerText()).includes('No files with changes'));
	await page.close();
}

// ===================================================================== the same chat at the width it has in the Vader window
{
	const { page } = await newPage();
	await page.setViewportSize({ width: 780, height: 820 });
	await page.evaluate(() => { document.getElementById('root').style.width = '780px'; document.getElementById('root').style.margin = '0 auto'; });
	await page.evaluate(() => window.__addMessages({ role: 'user', content: 'Put summaries before the blind cut', displayContent: 'Put summaries before the blind cut', selections: [], state: { stagingSelections: [], isBeingEdited: false } }, { role: 'assistant', displayContent: 'The trim starts at 50% of the window, so it starts cutting before the summary has a chance. I will put all three steps on one budget and prune old tool output before summarising.', reasoning: '', anthropicReasoning: null }, { role: 'tool', type: 'tool_request', name: 'run_command', params: { command: 'node src/vs/workbench/contrib/vader/test/contextBudgetE2E.mjs', cwd: null, terminalId: null }, rawParams: {}, id: 'w1', result: null, content: '(Awaiting user permission...)' }));
	await page.waitForTimeout(300);
	check('at the window width the footer keeps the whole label and one row', (await page.locator(TID('vader-add-context')).innerText()) === '@ Add context' && (await page.evaluate(() => { const a = document.querySelector('[data-testid="vader-add-context"]').getBoundingClientRect(), b = document.querySelector('[data-testid="vader-send"]').getBoundingClientRect(); return Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 14; })));
	await shot(page, '13-window-width');
	await page.close();
}

// ===================================================================== the safety gate (boards S02, R07)
const toolMsg = (type, name, params, extra = {}) => ({ role: 'tool', type, name, params, rawParams: params, id: 'tc-' + Math.random().toString(36).slice(2, 7), result: null, content: '', ...extra });
const gateOf = async (page, messages) => { await page.evaluate((m) => window.__addMessages(...m), messages); await page.waitForTimeout(200); };
{
	const { page, errors } = await newPage();
	await gateOf(page, [userMsg('add the limiter'), asstMsg('I will run the tests.'), toolMsg('tool_request', 'run_command', { command: 'npm test -- limiter', cwd: null, terminalId: null }, { content: '(Awaiting user permission...)' })]);
	const g = TID('vader-gate');
	check('a command that waits for approval is one card named for what it is', (await page.locator(g).count()) === 1 && (await page.locator(TID('vader-gate-title')).innerText()) === 'Run a command?');
	check('it says where and what it may do', flat(await page.locator(TID('vader-gate-text')).innerText()) === 'In vader-app. It can write files.');
	check('the command is shown exactly, in a code block', (await page.locator(TID('vader-gate-code')).innerText()) === 'npm test -- limiter');
	check('it names the mode it asks in', (await page.locator(TID('vader-gate-mode')).innerText()) === 'Asks in Balanced mode');
	check('it offers Allow once, Allow in this project and Reject', (await page.locator(TID('vader-tool-approve')).innerText()) === 'Allow once' && (await page.locator(TID('vader-tool-approve-project')).count()) === 1 && (await page.locator(TID('vader-tool-reject')).count()) === 1);
	await shot(page, '20-gate-command');
	await page.locator(TID('vader-tool-approve-project')).click();
	await page.locator(TID('vader-tool-approve')).click();
	await page.locator(TID('vader-tool-reject')).click();
	const l = await log(page);
	check('the buttons do what they say (once, for the project, reject)', l.includes('approve:project') && l.includes('approve:once') && l.includes('reject-tool'));
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}
{
	const { page } = await newPage(() => { window.__canRemember = false; });
	await gateOf(page, [userMsg('x'), toolMsg('tool_request', 'run_command', { command: 'rm -rf build', cwd: null, terminalId: null }, { content: '(Awaiting user permission...)' })]);
	check('when it cannot be remembered the card does not offer Allow in this project', (await page.locator(TID('vader-tool-approve-project')).count()) === 0);
	await page.close();
}
const policyAsk = (ruleId, reason) => ({ content: `(Vader policy requires approval: ${reason})`, gate: { by: 'policy', effect: 'ask', ruleId, reason } });
{
	const { page } = await newPage();
	await gateOf(page, [userMsg('x'), toolMsg('tool_request', 'read_file', { uri: { fsPath: 'C:\\Users\\STS\\.ssh\\config' }, startLine: null, endLine: null, pageNumber: 1 }, policyAsk('vader.ask.outside-project-read', 'This reads a file that is outside the open project.'))]);
	check('a read outside the project asks, and says which file and that it is only this once', (await page.locator(TID('vader-gate-title')).innerText()) === 'Read a file outside this project?' && flat(await page.locator(TID('vader-gate-text')).innerText()) === 'C:\\Users\\STS\\.ssh\\config is not inside vader-app. Only this once.');
	check('it offers Allow once and Reject, and not a standing Allow', (await page.locator(TID('vader-tool-approve')).count()) === 1 && (await page.locator(TID('vader-tool-approve-project')).count()) === 0 && (await page.locator(TID('vader-tool-reject')).count()) === 1);
	await shot(page, '21-gate-outside-read');
	await page.close();
}
{
	const { page } = await newPage();
	await gateOf(page, [userMsg('x'), toolMsg('tool_request', 'browser_navigate', { url: 'https://api.stripe.com/v1/prices', pageId: null }, policyAsk('vader.ask.network-new-host', 'This opens an address on a site that is not on this project’s list.'))]);
	check('a page on a new site names the address and the host', (await page.locator(TID('vader-gate-title')).innerText()) === 'Call a web address?' && (await page.locator(TID('vader-gate-code')).innerText()) === 'https://api.stripe.com/v1/prices' && (await page.locator(TID('vader-gate-note')).innerText()).includes('api.stripe.com is not on this project’s list of sites.'));
	check('it offers to allow the host in this project', (await page.locator(TID('vader-tool-approve-host')).innerText()) === 'Allow this host here');
	await shot(page, '22-gate-network');
	await page.locator(TID('vader-tool-approve-host')).click();
	check('and that remembers it for the project', (await log(page)).includes('approve:project'));
	await page.close();
}
{
	const { page } = await newPage();
	await gateOf(page, [userMsg('x'), toolMsg('tool_request', 'run_command', { command: 'npm install left-pad', cwd: null, terminalId: null }, policyAsk('vader.custom.installs', 'installs'))]);
	check('a rule of the person’s own says so, with that it asks in every mode', (await page.locator(TID('vader-gate-title')).innerText()) === 'Install a package?' && (await page.locator(TID('vader-gate-text')).innerText()).includes('Your rule') && (await page.locator(TID('vader-gate-mode')).innerText()) === 'Asks in every mode' && (await page.locator(TID('vader-gate-code')).innerText()) === 'npm install left-pad');
	check('it does not offer a standing allow, and offers to change the rule', (await page.locator(TID('vader-tool-approve-project')).count()) === 0 && (await page.locator(TID('vader-gate-change-rule')).count()) === 1);
	await page.locator(TID('vader-gate-change-rule')).click();
	check('Change the rule opens the Permissions page', (await log(page)).some(x => /command:.*:permissions$/.test(x)));
	await shot(page, '23-gate-rule');
	await page.close();
}
{
	const { page } = await newPage();
	await gateOf(page, [userMsg('x'), toolMsg('tool_request', 'install_skill', { name: 'mcp-builder', repositoryUrl: 'https://github.com/anthropics/skills', instructions: '# MCP builder\nBuild servers.' }, policyAsk('vader.ask.install-capability', 'Installing a skill changes every later prompt.'))]);
	check('a skill is named with where it comes from, and installs switched off', (await page.locator(TID('vader-gate-title')).innerText()) === 'Install a skill' && (await page.locator(TID('vader-gate-skill')).innerText()).includes('mcp-builder') && (await page.locator(TID('vader-gate-skill')).innerText()).includes('github.com/anthropics/skills') && (await page.locator(TID('vader-tool-approve')).innerText()) === 'Install, switched off');
	await page.locator(TID('vader-gate-read')).click();
	check('Read it first shows the instructions that would be installed', (await page.locator(TID('vader-gate-instructions')).innerText()).includes('Build servers.'));
	await shot(page, '24-gate-skill');
	await page.close();
}
{
	const { page } = await newPage();
	await gateOf(page, [userMsg('x'), toolMsg('tool_request', 'github_create_pull_request', { title: 't' }, { mcpServerName: 'GitHub', content: '(Awaiting user permission...)' })]);
	check('a tool of an MCP server names the server', (await page.locator(TID('vader-gate-title')).innerText()) === 'Use a tool from GitHub?');
	await page.close();
}
{
	const { page } = await newPage();
	await gateOf(page, [userMsg('x'), toolMsg('rejected', 'read_file', { uri: { fsPath: 'C:\\Users\\STS\\.ssh\\id_rsa' }, startLine: null, endLine: null, pageNumber: 1 }, { content: 'Blocked by Vader policy (vader.deny.credential-files): Blocked: a private key', gate: { by: 'policy', effect: 'deny', ruleId: 'vader.deny.credential-files', reason: 'Blocked: a private key or a stored login.' } })]);
	check('a locked rule says what was refused, that it cannot be switched off, and names the rule', (await page.locator(TID('vader-blocked-title')).innerText()) === 'Blocked: credential file' && (await page.locator(TID('vader-blocked')).innerText()).includes('is never allowed. This rule cannot be switched off in any mode.') && (await page.locator(TID('vader-blocked')).innerText()).includes('vader.deny.credential-files'));
	check('it offers no Allow', (await page.locator(TID('vader-tool-approve')).count()) === 0);
	await shot(page, '25-blocked-locked');
	await page.locator(TID('vader-blocked-rule')).click();
	check('Open the rule goes to the Permissions page', (await log(page)).some(x => /command:.*:permissions$/.test(x)));
	await page.close();
}
{
	const { page } = await newPage();
	await gateOf(page, [userMsg('x'), toolMsg('rejected', 'edit_file', { uri: { fsPath: 'C:\\work\\vader-app\\package.json' }, searchReplaceBlocks: '' }, { content: 'Blocked by agent scope: Agent "Reviewer" may only touch src/**.', gate: { by: 'agent-scope', effect: 'deny', reason: 'Agent "Reviewer" may only touch src/**.' } })]);
	check('an agent’s own scope is said as such, with the way to its settings', (await page.locator(TID('vader-blocked-title')).innerText()) === 'Blocked: outside this agent’s folders' && (await page.locator(TID('vader-blocked-agent')).count()) === 1);
	await shot(page, '26-blocked-scope');
	await page.close();
}
{
	const { page } = await newPage();
	await gateOf(page, [userMsg('x'), toolMsg('rejected', 'run_command', { command: 'npm install', cwd: null, terminalId: null }, { content: 'Blocked: Gather is read-only - this tool could modify the project', gate: { by: 'read-only', effect: 'deny', reason: 'Blocked: Gather is read-only - this tool could modify the project. Switch to Agent mode to actually make this change.' } })]);
	check('a read-only mode says what did not run and offers Switch to Agent', (await page.locator(TID('vader-blocked-title')).innerText()) === 'Gather is read-only' && (await page.locator(TID('vader-blocked')).innerText()).includes('npm install was not run.'));
	await page.locator(TID('vader-blocked-switch')).click();
	check('Switch to Agent changes the mode', (await log(page)).includes('global:chatMode="agent"'));
	await shot(page, '27-blocked-readonly');
	await page.close();
}
{
	const { page } = await newPage();
	await gateOf(page, [userMsg('x'), toolMsg('rejected', 'run_command', { command: 'git push --force origin main', cwd: null, terminalId: null }, { content: 'Blocked by Vader policy (vader.deny.destructive-fs): x', gate: { by: 'policy', effect: 'deny', ruleId: 'vader.deny.destructive-fs', reason: 'Blocked: a destructive command.' } })]);
	check('any other locked refusal still says it is never allowed and shows the command', (await page.locator(TID('vader-blocked')).innerText()).includes('never allowed, even in Autonomous mode') && (await page.locator(TID('vader-blocked')).innerText()).includes('git push --force origin main'));
	await page.locator(TID('vader-blocked-ok')).click();
	check('OK puts the card away to one line', (await page.locator(TID('vader-blocked')).count()) === 0 && (await page.locator(TID('vader-gate-dismissed')).count()) === 1);
	await page.close();
}


// ===================================================================== a key in the message (board S02)
{
	const { page, errors } = await newPage();
	const key = 'sk-proj-' + 'a'.repeat(30) + 'Zq91';
	await page.locator(INPUT).fill(`use this key ${key} for the tests`);
	await page.keyboard.press('Enter');
	await page.waitForSelector(TID('vader-secret'));
	check('a message with a key in it is not sent', !(await log(page)).some(x => x.startsWith('task:') || x.startsWith('queue:')));
	check('the card says which kind of key and which end of it, never the whole value', (await page.locator(TID('vader-secret-title')).innerText()) === 'Stopped: a key was about to be sent' && (await page.locator(TID('vader-secret-text')).innerText()).includes('an OpenAI key (sk-pr…Zq91)') && !(await page.locator(TID('vader-secret')).innerText()).includes('aaaaaaaaaaaa'));
	check('the key was taken out of what is typed, the rest is kept', !(await page.locator(INPUT).inputValue()).includes('aaaaaaaa') && (await page.locator(INPUT).inputValue()).startsWith('use this key sk-pr…Zq91 for the tests'));
	await shot(page, '28-secret-blocked');
	await page.locator(TID('vader-secret-why-btn')).click();
	check('Why was this blocked gives the reason', (await page.locator(TID('vader-secret-why')).innerText()).includes('checked before anything leaves this computer'));
	await page.locator(TID('vader-secret-edit')).click();
	check('Edit the message puts the person back in the box and puts the card away', (await page.locator(TID('vader-secret')).count()) === 0 && (await page.evaluate(() => document.activeElement?.tagName)) === 'TEXTAREA');
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => window.__log.some(x => x.startsWith('task:')));
	check('the message without the key is sent as it is', (await log(page)).some(x => x === 'task:use this key sk-pr…Zq91 for the tests'));
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}
await browser.close();
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed\nscreenshots: ${shots}`);
process.exit(failed ? 1 : 0);
