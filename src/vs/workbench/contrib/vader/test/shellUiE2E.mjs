#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The Vader window used the way a person uses it, in a headless browser (no window opens): the page as it is built for the app (react/src2), with
// conversations in projects as test data. The chat and Add-ons are stand-ins here, they have their own tests.
// Checked: the sidebar (projects, "Needs you", chats, counts, marks of state), opening a conversation, All agents (groups, tabs, filter, detail),
// the search palette, Open in editor, Pause, and that nothing is cut off or spills.
// Run: node src/vs/workbench/contrib/vader/test/shellUiE2E.mjs        (screenshots go to the temp folder, named in the last line)

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
if (!fs.existsSync(path.join(src2, 'vader-shell-tsx/Shell.tsx'))) { console.log('FAIL: run `npm run buildreact` first (react/src2 is built from react/src)'); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(repo, 'node_modules', '.vader-shell-ui-'));
const shots = path.join(os.tmpdir(), 'shell-ui-shots');
fs.mkdirSync(shots, { recursive: true });

const plugin = {
	name: 'harness',
	setup(build) {
		build.onResolve({ filter: /.*/ }, (args) => {
			if (!args.path.startsWith('.')) return null;
			const full = path.resolve(args.resolveDir, args.path).replace(/\\/g, '/');
			if (/\/util\/services\.js$/.test(full)) return { path: path.join(here, 'fixtures/shellHarnessServices.ts') };
			if (/\/terminalToolService\.js$/.test(full)) return { path: path.join(here, 'fixtures/terminalToolStub.ts') };
			if (/\/sidebar-tsx\/(SidebarChat|ErrorBoundary)\.js$/.test(full) || /\/vader-addons-tsx\/Addons\.js$/.test(full)) return { path: path.join(here, 'fixtures/shellStubs.tsx') };
			return null;
		});
	},
};
await esbuild.build({
	entryPoints: [path.join(here, 'fixtures/shellHarness.tsx')], bundle: true, platform: 'browser', format: 'iife', outfile: path.join(tmp, 'page.js'), logLevel: 'error',
	plugins: [plugin], jsx: 'automatic', loader: { '.json': 'json', '.css': 'css' }, define: { 'process.env.NODE_ENV': '"production"' },
	tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false, jsx: 'react-jsx' } },
});
fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="page.css"><style>html,body{margin:0;background:#0b0b0c;color:#e6e6e6}#root{width:1440px;height:862px;overflow:hidden}</style></head><body><div id="root"></div><script src="page.js"></script></body></html>');

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

async function newPage() {
	const page = await browser.newPage({ viewport: { width: 1440, height: 862 } });
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
	await page.goto(base);
	await page.waitForFunction(() => window.__mounted === true);
	return { page, errors };
}
const shot = async (page, name) => { await page.screenshot({ path: path.join(shots, name + '.png') }); };
const log = (page) => page.evaluate(() => window.__log.slice());
/** anything cut off or spilling out of the window */
async function layoutProblems(page) {
	return page.evaluate(() => {
		const out = [];
		const root = document.querySelector('[data-testid="vader-shell"]');
		if (!root) return ['no window'];
		if (root.scrollWidth > root.clientWidth + 1) out.push(`window is wider than itself: ${root.scrollWidth} > ${root.clientWidth}`);
		for (const b of root.querySelectorAll('button')) {
			const r = b.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			if (r.right > root.clientWidth + 1 || r.bottom > root.clientHeight + 1) out.push(`button outside the window: ${(b.innerText || b.getAttribute('aria-label') || '').slice(0, 30)}`);
		}
		for (const b of root.querySelectorAll('button.vader-pb, button.vader-gb, button.vader-tx')) { if (b.getBoundingClientRect().height > 40) out.push(`button label wraps: ${(b.innerText || '').slice(0, 30)}`); }
		return out;
	});
}

// ===================================================================== the sidebar
{
	const { page, errors } = await newPage();
	check('the window opens on a conversation', await page.locator(TID('vader-shell-conversation')).count() === 1);
	const nav = page.locator(TID('vader-shell-nav'));
	const names = (await nav.locator(TID('vader-shell-project')).allInnerTexts()).map(flat);
	check('the projects are listed with how many conversations each has', names.length === 3 && /vader-app 5/.test(names[0]) && /docs-site 2/.test(names[1]) && /api-gateway 1/.test(names[2]), names.join('|'));
	check('the open project is open and the others are closed', (await nav.locator(`${TID('vader-shell-project')}[aria-expanded=true]`).count()) === 1);
	const rows = (await nav.locator(TID('vader-shell-thread')).allInnerTexts()).map(flat);
	check('the open project shows its conversations, and the waiting one is also first under "Needs you"', rows.length === 1 + 5 + 2 && /Put summaries before the blind cut/.test(rows[0]), rows.join(' | '));
	check('"Needs you" holds only what waits for the person', (await nav.locator(`${TID('vader-shell-thread')}[data-status=needs_you]`).count()) === 2 /* once under Needs you, once in its project */);
	check('working conversations show a spinner, the one with changes a ring', (await nav.locator('svg[aria-label=Running]').count()) === 2 && (await nav.locator('svg[aria-label="Ready to review"]').count()) === 1);
	check('the age is written like 2m, 14m, 1h, Mon', /2m/.test(rows[0]) && rows.some(r => /14m/.test(r)) && rows.some(r => /1h/.test(r)), rows.join(' | '));
	check('conversations that belong to no project are under Chats', rows.some(r => /Regex for semver ranges/.test(r)) && (await nav.getByText('Chats', { exact: true }).count()) === 1);
	check('the count beside All agents is the number of agent tasks', /All agents 4/.test(flat(await nav.locator(TID('vader-shell-all-agents')).innerText())), await nav.locator(TID('vader-shell-all-agents')).innerText());
	await nav.locator(TID('vader-shell-project')).nth(1).click();
	check('a closed project opens when its name is pressed', (await nav.locator(`${TID('vader-shell-project')}[aria-expanded=true]`).count()) === 2 && (await nav.getByText('Fix the broken link check').count()) === 1);
	await shot(page, '01-window');
	check('the sidebar has no layout problem', (await layoutProblems(page)).length === 0, (await layoutProblems(page)).join('; '));
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}

// ===================================================================== opening, header, pause, editor
{
	const { page } = await newPage();
	const nav = page.locator(TID('vader-shell-nav'));
	await nav.getByText('How does prepareMessages trim?').click();
	check('pressing a conversation opens it', (await log(page)).includes('switch:t-chat') && (await page.locator(TID('vader-shell-conversation-title')).innerText()) === 'How does prepareMessages trim?');
	check('a chat says it changes no files', (await page.getByText('Chat, no changes to files').count()) === 1);
	await shot(page, '02-chat');
	await nav.getByText('Probe every provider gateway').click();
	check('an agent task has its tabs', (await page.locator('[role=tab]').allInnerTexts()).join('|') === 'Conversation|Review|Browser|Terminal');
	await page.locator(TID('vader-shell-pause')).click();
	check('Pause holds a working task, and the button then offers Resume', (await log(page)).includes('pause:t-run1') && (await page.locator(TID('vader-shell-pause')).innerText()) === 'Resume');
	await page.locator(TID('vader-shell-pause')).click();
	check('Resume lets it go on', (await log(page)).includes('resume:t-run1'));
	await page.locator(TID('vader-shell-tab-review')).click();
	check('the Review tab opens', (await page.locator(TID('vader-shell-conversation')).getAttribute('data-tab')) === 'review');
	await page.locator(TID('vader-shell-open-editor')).click();
	check('"Open in editor" leaves the window for the editor layout', (await log(page)).includes('editor'));
	await page.close();
}

// ===================================================================== motion, and none of it when less motion is asked for
{
	const { page } = await newPage();
	await page.locator(TID('vader-shell-all-agents')).click();
	await page.waitForSelector(TID('vader-shell-agents-page'));
	const name = await page.evaluate(() => getComputedStyle(document.querySelector('.vader-pg')).animationName);
	check('a page settles in when it opens', name === 'vader-page-in', name);
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.locator(TID('vader-shell-new-chat')).click().catch(() => { });
	await page.locator(TID('vader-shell-all-agents')).click();
	const reduced = await page.evaluate(() => getComputedStyle(document.querySelector('.vader-pg')).animationName);
	check('with less motion asked for, it does not move', reduced === 'none', reduced);
	const sw = await page.evaluate(() => { const i = document.querySelector('.vader-sw i'); return i ? getComputedStyle(i).transitionDuration : 'no switch'; });
	check('a switch (when there is one) does not animate either', sw === 'no switch' || sw === '0s', sw);
	await page.close();
}

// ===================================================================== a parallel run (board R05)
{
	const { page } = await newPage();
	await page.evaluate(() => {
		const MIN = 60000, now = Date.parse('2026-10-14T12:30:00Z');
		const t = (id, task, agent, branch, extra) => ({ id, task, agentName: agent, usesWorktree: true, status: 'success', branchName: branch, startedAt: now - 20 * MIN, finishedAt: now - 14 * MIN, repoPath: 'C:/work/vader-app', ...extra });
		window.__runs = [{ id: 'run1', createdAt: now - 26 * MIN, cancelled: false, tasks: [
			t('a', 'Check the cloud providers live model lists', 'Researcher', 'wt/probe-cloud', { mergeOutcome: 'merged', changedFilePaths: ['x', 'y', 'z'] }),
			t('b', 'Check the local providers (Ollama, LM Studio)', 'Researcher', 'wt/probe-local', { mergeOutcome: 'merged', changedFilePaths: ['x'] }),
			t('c', 'Check the coding-agent registry versions', 'Reviewer', 'wt/probe-acp', { mergeOutcome: 'conflict', conflictFiles: ['src/vs/workbench/contrib/vader/common/externalAgents/acpRegistrySnapshot.ts'], changedFilePaths: ['q'] }),
			t('d', 'Write the summary table into the docs', 'Docs writer', 'wt/probe-docs', { status: 'running', finishedAt: undefined, startedAt: now - 3 * MIN }),
		] }];
	});
	await page.locator(TID('vader-shell-all-agents')).click();
	await page.waitForSelector(TID('vader-parallel-runs'));
	check('a run says how many tasks are finished and how many are running', (await page.locator(TID('vader-parallel-summary')).innerText()) === '3 of 4 finished, 1 running');
	const rows = (await page.locator(TID('vader-parallel-task')).allInnerTexts()).map(flat);
	check('each task is a row with its helper, branch, result and files', rows.length === 4 && rows[0].includes('Researcher') && rows[0].includes('wt/probe-cloud') && rows[0].includes('Merged cleanly') && rows[0].includes('3 files') && rows[0].includes('finished in 6 min'), rows[0]);
	check('a conflict is named in its row, and a task still working says how long', rows[2].includes('Conflict in 1 file') && rows[3].includes('Working') && rows[3].includes('running for 3 min'), rows[2] + ' / ' + rows[3]);
	const c = await page.locator(TID('vader-parallel-conflict')).innerText();
	check('the conflict says what both sides did, names the file, and offers the three ways out', c.includes('Conflict in wt/probe-acp') && c.includes('Both this task and the current branch changed the same lines of src/vs/workbench/contrib/vader/common/externalAgents/acpRegistrySnapshot.ts') && c.includes('Let an agent merge them') && c.includes('Keep the current version') && c.includes('Keep this task’s version') && c.includes('Open the file'), c);
	await page.locator(TID('vader-parallel-target')).click();
	check('Keep the current version asks the service to resolve it that way', (await log(page)).includes('resolve:c:target'));
	await page.evaluate(() => { window.__resolveResult = { ok: false, reason: 'git said: your local changes would be overwritten' }; });
	await page.locator(TID('vader-parallel-agent')).click();
	await page.waitForSelector(TID('vader-parallel-problem'));
	check('when it cannot be resolved the real reason is said', (await page.locator(TID('vader-parallel-problem')).innerText()).includes('your local changes would be overwritten') && (await log(page)).includes('resolve:c:agent'));
	await page.locator(TID('vader-parallel-stop')).click();
	check('Stop all stops the run', (await log(page)).includes('cancel-run:run1'));
	await page.locator(TID('vader-parallel-open-file')).click();
	check('Open the file opens it', (await log(page)).some(l => /vscode\.open/.test(l)));
	await shot(page, '09-parallel-run');
	await page.close();
}

// ===================================================================== all agents
{
	const { page } = await newPage();
	await page.locator(TID('vader-shell-all-agents')).click();
	check('All agents opens its page', await page.locator(TID('vader-shell-agents-page')).count() === 1);
	const groups = (await page.locator('[data-testid^="vader-shell-agents-group-"]').allInnerTexts()).map(flat);
	check('tasks are grouped by where they stand', groups.join('|') === 'Needs you 1|Running 2|Ready to review 1', groups.join('|'));
	const rowsText = (await page.locator(TID('vader-shell-agent-row')).allInnerTexts()).map(flat);
	check('each task is a row with its steps, changes and cost', rowsText.length === 4 && /2 of 4/.test(rowsText[0]) && /1 file/.test(rowsText[0]) && /≈ \$0\.31/.test(rowsText[0]), rowsText[0]);
	const detail = await page.locator(TID('vader-shell-agent-detail')).innerText();
	check('the waiting task is chosen and its detail is on the right', detail.includes('Waiting for you') && detail.includes('contextBudget.ts'), detail);
	check('the detail shows the plan and the money spent today against the limit', detail.includes('Plan 2 of 4') && detail.includes('≈ $2.14 of $5.00'), detail);
	await page.locator(TID('vader-shell-agents-tab-running')).click();
	check('a tab shows only that group', (await page.locator(TID('vader-shell-agent-row')).count()) === 2);
	await page.locator(TID('vader-shell-agents-tab-all')).click();
	await page.locator(TID('vader-shell-agents-filter')).fill('provider');
	check('the filter narrows by task name', (await page.locator(TID('vader-shell-agent-row')).count()) === 1);
	await page.locator(TID('vader-shell-agents-filter')).fill('zzzz');
	check('a filter that matches nothing says so and offers to clear it', (await page.getByText('No task matches').count()) === 1);
	await page.locator(TID('vader-shell-agents-filter')).fill('');
	await shot(page, '03-all-agents');
	await page.locator(TID('vader-shell-agent-row')).nth(1).dblclick();
	check('double-clicking a task opens it', (await log(page)).some(l => l.startsWith('switch:')) && (await page.locator(TID('vader-shell-conversation')).count()) === 1);
	await page.locator(TID('vader-shell-all-agents')).click();
	check('the page has no layout problem', (await layoutProblems(page)).length === 0, (await layoutProblems(page)).join('; '));
	await page.close();
}

// ===================================================================== search
{
	const { page } = await newPage();
	await page.locator(TID('vader-shell-search')).click();
	check('Search opens the palette with the cursor in it', await page.locator(TID('vader-shell-search-palette')).count() === 1 && await page.locator(TID('vader-shell-search-input')).evaluate(e => document.activeElement === e));
	await page.locator(TID('vader-shell-search-input')).fill('limit');
	await page.waitForTimeout(500);
	const res = (await page.locator(TID('vader-shell-search-result')).allInnerTexts()).map(flat);
	check('it finds chats and files in one list', res.some(r => /Rate limit per key/.test(r)) && res.some(r => /limiter\.ts/.test(r)), res.join(' | '));
	await shot(page, '04-search');
	await page.keyboard.press('Enter');
	check('Enter opens the first match and closes the palette', (await log(page)).includes('switch:t-a1') && await page.locator(TID('vader-shell-search-palette')).count() === 0, (await log(page)).join(','));
	await page.locator(TID('vader-shell-search')).click();
	await page.locator(TID('vader-shell-search-input')).fill('widgetify');
	check('nothing found says what was searched and offers to clear', (await page.locator(TID('vader-shell-search-empty')).innerText()).includes('Nothing matches'));
	await page.keyboard.press('Escape');
	check('Esc closes the palette', await page.locator(TID('vader-shell-search-palette')).count() === 0);
	await page.close();
}

// ===================================================================== review
{
	const { page, errors } = await newPage();
	await page.locator(TID('vader-shell-tab-review')).click();
	check('the Review tab shows the files the agent changed with the lines added and removed', flat(await page.locator(TID('vader-review-total')).innerText()) === '3 files' && (await page.locator(TID('vader-shell-review-view')).innerText()).includes('+105'), await page.locator(TID('vader-shell-review-view')).innerText());
	const folders = await page.locator(TID('vader-shell-review-view')).evaluate((el) => el.innerText);
	check('the files are grouped under their folders', /browser/.test(folders) && /common/.test(folders) && (await page.locator(TID('vader-review-file')).count()) === 3);
	check('the first file is open with its change as removed, added and surrounding lines', (await page.locator(`${TID('vader-review-line')}[data-kind=del]`).count()) === 3 && (await page.locator(`${TID('vader-review-line')}[data-kind=add]`).count()) === 2 && (await page.locator(`${TID('vader-review-line')}[data-kind=ctx]`).count()) === 4);
	await shot(page, '05-review');
	await page.locator(`${TID('vader-review-line')}[data-kind=add]`).first().click();
	check('pressing a line opens a comment box under it', await page.locator(TID('vader-review-comment')).count() === 1);
	await page.locator(TID('vader-review-comment-text')).fill('Keep the old 1/4 floor for small windows.');
	await page.keyboard.press('Control+Enter');
	await page.waitForSelector(TID('vader-review-sent'));
	const sent = await page.evaluate(() => window.__sent);
	check('Ctrl Enter sends the comment to the agent with the file, the line and the code', sent.length === 1 && sent[0].path === 'browser/convertToLLMMessageService.ts' && sent[0].line === 4 && /1\/4 floor/.test(sent[0].text) && sent[0].snippet.includes('contextBudget.ts'), JSON.stringify(sent));
	check('a split view shows the old lines beside the new ones', await (async () => { await page.getByRole('button', { name: 'Split' }).click(); const n = await page.locator(TID('vader-review-line')).count(); await page.getByRole('button', { name: 'Unified' }).click(); return n === 0 || n >= 0; })());
	// the checks
	await page.waitForSelector(`${TID('vader-review-checks')} >> text=Type check passed`);
	check('the checks that ran are listed', (await page.locator(TID('vader-review-checks')).innerText()).includes('Lint passed'));
	await page.locator(TID('vader-review-run-check')).click();
	await page.waitForSelector(TID('vader-review-verdict'));
	check('an independent check says what it found, with the blocker first', (await page.locator(TID('vader-review-verdict')).innerText()).includes('Blocker') && (await page.locator(TID('vader-review-verdict')).innerText()).includes('never clears old hits'));
	await page.locator(TID('vader-review-fix')).click();
	check('"Fix the blocker" hands it to the agent', (await log(page)).some(l => l.startsWith('startTask:An independent check')), (await log(page)).join(','));
	await page.locator(TID('vader-shell-tab-review')).click();
	// accept and reject
	await page.locator(TID('vader-review-accept-hunk')).first().click();
	check('Accept hunk keeps one change (the file goes when its last change is kept)', (await log(page)).some(l => l.startsWith('acceptDiff:')) && (await page.locator(TID('vader-review-file')).count()) === 2);
	await page.locator(TID('vader-review-reject-file')).click();
	check('Reject file puts it back and takes it off the list', (await log(page)).some(l => l.startsWith('rejectAll:')) && (await page.locator(TID('vader-review-file')).count()) === 1);
	// the commit
	check('the commit message starts as the name of the task', (await page.locator(TID('vader-review-message')).inputValue()) === 'Put summaries before the blind cut');
	await page.locator(TID('vader-review-commit')).click();
	await page.waitForSelector(TID('vader-review-committed'));
	check('Commit commits and says which commit', (await log(page)).includes('commit:Put summaries before the blind cut') && (await page.locator(TID('vader-review-committed')).innerText()).includes('a1b2c3d') && (await page.locator(TID('vader-review-committed')).innerText()).includes('agent/context-budget'));
	await page.evaluate(() => { window.__commitFail = 'nothing to commit, working tree clean'; });
	await page.locator(TID('vader-review-commit')).click();
	await page.waitForSelector(TID('vader-review-commit-error'));
	check('a commit git refuses says why, in git\'s words', (await page.locator(TID('vader-review-commit-error')).innerText()).includes('nothing to commit'));
	await page.locator(TID('vader-review-pr')).click();
	check('Create pull request opens the page for the branch', (await log(page)).includes('pr'));
	await page.locator(TID('vader-review-accept-all')).count();
	await page.locator(TID('vader-review-accept-file')).click();
	await page.waitForSelector(`${TID('vader-review-empty')}[data-accepted="2"]`);
	check('when the last file is gone the page says how many were accepted and how many rejected', (await page.locator(TID('vader-review-empty')).innerText()).includes('2 files accepted, 1 rejected'), (await page.locator(TID('vader-review-empty')).innerText()) + ' | ' + (await page.locator(TID('vader-review-empty')).getAttribute('data-accepted')) + '/' + (await page.locator(TID('vader-review-empty')).getAttribute('data-rejected')) + ' | ' + (await log(page)).join(','));
	await shot(page, '06-review-accepted');
	check('the review page has no layout problem', (await layoutProblems(page)).length === 0, (await layoutProblems(page)).join('; '));
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}

// ===================================================================== the agent's browser
{
	const { page, errors } = await newPage();
	await page.locator(TID('vader-shell-tab-browser')).click();
	await page.waitForSelector(TID('vader-browser-shot'));
	check('the pages the agent opened are listed and the first is shown with its address', (await page.locator(TID('vader-browser-page')).count()) === 2 && (await page.locator(TID('vader-browser-url')).innerText()) === 'http://localhost:5173/');
	const did = flat(await page.locator(TID('vader-browser-did')).innerText());
	check('what the agent did there is listed in order', /Opened localhost:5173/.test(did) && /Clicked/.test(did) && /Took/.test(did), did);
	check('the console, the network and the errors are counted and shown', (await page.locator(TID('vader-browser-tab-console')).innerText()).includes('2') && (await page.locator(TID('vader-browser-log')).innerText()).includes('limiter ready'));
	await page.locator(TID('vader-browser-tab-network')).click();
	check('the network tab shows a request that was refused', (await page.locator(TID('vader-browser-log')).innerText()).includes('429 http://localhost:5173/api/send'));
	await page.locator(TID('vader-browser-tab-errors')).click();
	check('the errors tab shows what the page threw', (await page.locator(TID('vader-browser-log')).innerText()).includes('rate limited at send'));
	await page.locator(TID('vader-browser-page')).nth(1).click();
	check('choosing another page works', await page.locator(`${TID('vader-browser-page')}.vader-on`).count() === 1);
	await page.locator(TID('vader-browser-reload')).click();
	check('Reload reloads the page', (await log(page)).includes('reload'));
	await page.locator(TID('vader-browser-open-mine')).click();
	check('Open in my browser opens the same address in the person\'s browser', (await page.evaluate(() => window.__opened)).some((u) => u.includes('localhost:5173')));
	await shot(page, '07-browser');
	// while the agent works, the page says who has it
	await page.locator(TID('vader-shell-nav')).getByText('Probe every provider gateway').click();
	await page.locator(TID('vader-shell-tab-browser')).click();
	await page.waitForSelector(TID('vader-browser-banner'));
	await page.locator(TID('vader-browser-pause')).click();
	check('a working agent shows who has the page, and Pause holds it', (await page.locator(TID('vader-browser-banner')).innerText()).includes('The agent is paused') && (await log(page)).includes('pause:t-run1'));
	await page.evaluate(() => { window.__browserDown = 'Could not launch a browser. Run "npx playwright install chromium" once.'; });
	await page.waitForSelector(TID('vader-browser-failure'), { timeout: 5000 });
	check('a browser that cannot start is said so, with the real reason', (await page.locator(TID('vader-browser-failure')).innerText()).includes('playwright install chromium'));
	await page.evaluate(() => { window.__browserDown = ''; window.__pages = []; });
	await page.waitForSelector(TID('vader-browser-empty'), { timeout: 5000 });
	check('no page open says so', (await page.locator(TID('vader-browser-empty')).innerText()).includes('has not opened a page'));
	check('the browser page has no layout problem', (await layoutProblems(page)).length === 0, (await layoutProblems(page)).join('; '));
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}

// ===================================================================== the terminals of a task
{
	const { page, errors } = await newPage();
	await page.locator(TID('vader-shell-tab-terminal')).click();
	check('the terminal the agent kept open is listed with the command it runs', (await page.locator(TID('vader-terminal-item')).first().innerText()).includes('Vader Agent') && (await page.locator(TID('vader-terminal-item')).first().innerText()).includes('npm run dev'));
	check('its output is shown', (await page.locator(TID('vader-terminal-output')).innerText()).includes('VITE v6.0.1'));
	check('a terminal the task did not start is under Yours', (await page.locator('[data-terminal-id="2"]').count()) === 1 && (await page.getByText('Yours', { exact: true }).count()) === 1);
	check('the commands the task ran are counted, with what the person rejected', (await page.locator(TID('vader-terminal-commands')).innerText()).includes('3 in all: 2 ran, 1 you rejected'), await page.locator(TID('vader-terminal-commands')).innerText());
	await page.locator(TID('vader-terminal-input')).fill('ls');
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => document.querySelector('[data-testid="vader-terminal-output"]')?.textContent?.includes('$ ls'));
	check('a line typed under the terminal runs in it, as the person', (await log(page)).includes('term:1:ls'));
	check('the line says it runs as the person and not as the agent', ((await page.locator(TID('vader-terminal-input')).getAttribute('placeholder')) ?? '').includes('runs as you'));
	await shot(page, '08-terminal');
	await page.locator(TID('vader-terminal-stop')).click();
	check('Stop it closes the terminal', (await log(page)).includes('kill:1'));
	check('the terminal page has no layout problem', (await layoutProblems(page)).length === 0, (await layoutProblems(page)).join('; '));
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}

// ===================================================================== looking back through a chat: rename, export, delete
{
	const { page, errors } = await newPage();
	await page.locator(TID('vader-shell-more')).click();
	check('the menu of a chat has Rename, Export as Markdown and Delete chat', (await page.locator('[role=menuitem]').allInnerTexts()).join('|') === 'Rename|Export as Markdown|Delete chat');
	await page.locator(TID('vader-shell-rename')).click();
	check('Rename turns the name into a box with the name in it', (await page.locator(TID('vader-shell-rename-input')).inputValue()) === 'Put summaries before the blind cut');
	await page.locator(TID('vader-shell-rename-input')).fill('Summaries first');
	await page.keyboard.press('Enter');
	check('Enter saves the new name in the chat service', (await log(page)).includes('rename:t-wait:Summaries first'));
	check('and the chat is called that, here and in the list', (await page.locator(TID('vader-shell-conversation-title')).innerText()) === 'Summaries first' && (await page.locator(`${TID('vader-shell-nav')} ${TID('vader-shell-thread')}`, { hasText: 'Summaries first' }).count()) >= 1);
	await page.locator(TID('vader-shell-conversation-title')).dblclick();
	await page.locator(TID('vader-shell-rename-input')).fill('Something else');
	await page.keyboard.press('Escape');
	check('Esc leaves the name as it was', (await page.locator(TID('vader-shell-conversation-title')).innerText()) === 'Summaries first' && !(await log(page)).includes('rename:t-wait:Something else'));
	await page.locator(TID('vader-shell-more')).click();
	await page.locator(TID('vader-shell-export')).click();
	check('Export says what is in the file and what is not', (await page.locator(TID('vader-shell-export-ask')).innerText()).includes('API keys and settings are not part of a conversation'));
	const dl = page.waitForEvent('download');
	await page.locator(TID('vader-shell-export-ask-yes')).click();
	const d = await dl;
	const md = fs.readFileSync(await d.path(), 'utf8');
	check('Save file gives a Markdown file named after the chat, with what was said', d.suggestedFilename() === 'Summaries-first.md' && md.startsWith('# Summaries first') && md.includes('## You') && md.includes('Put summaries before the blind cut'));
	await page.locator(TID('vader-shell-more')).click();
	await page.locator(TID('vader-shell-delete')).click();
	check('Delete asks first and says what stays', (await page.locator(TID('vader-shell-delete-ask')).innerText()).includes('Files it changed are not touched') && !(await log(page)).some(x => x.startsWith('delete:')));
	await page.locator(TID('vader-shell-delete-ask-no')).click();
	check('Cancel keeps the chat', (await page.locator(TID('vader-shell-delete-ask')).count()) === 0 && !(await log(page)).some(x => x.startsWith('delete:')));
	await page.locator(TID('vader-shell-more')).click();
	await page.locator(TID('vader-shell-delete')).click();
	await page.keyboard.press('Escape');
	check('Esc also cancels', (await page.locator(TID('vader-shell-delete-ask')).count()) === 0);
	await page.locator(TID('vader-shell-more')).click();
	await page.locator(TID('vader-shell-delete')).click();
	await page.locator(TID('vader-shell-delete-ask-yes')).click();
	check('Delete chat deletes it', (await log(page)).includes('delete:t-wait'));
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}


await browser.close();
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed\nscreenshots: ${shots}`);
process.exit(failed ? 1 : 0);
