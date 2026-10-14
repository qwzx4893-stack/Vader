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

await browser.close();
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed\nscreenshots: ${shots}`);
process.exit(failed ? 1 : 0);
