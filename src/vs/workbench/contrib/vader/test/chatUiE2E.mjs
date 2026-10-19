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
const INPUT = 'textarea[placeholder^="@ to mention"], textarea[placeholder^="Add a message"]';

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

await browser.close();
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed\nscreenshots: ${shots}`);
process.exit(failed ? 1 : 0);
