#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Vader's Settings used the way a person uses them, in a headless browser (no window opens): the pages as they are built for the app (react/src2), with the
// policy, the usage and the settings as objects of the test page.
// Checked: the frame (back to the app, search, the pages in three groups, naming a page), and each page that is rebuilt in the shape of the boards: what it shows
// from the real services, what it changes in them, and what it says when there is nothing.
// Run: node src/vs/workbench/contrib/vader/test/settingsUiE2E.mjs        (screenshots go to the temp folder, named in the last line)

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
if (!fs.existsSync(path.join(src2, 'vader-settings-tsx/SettingsApp.tsx'))) { console.log('FAIL: run `npm run buildreact` first (react/src2 is built from react/src)'); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(repo, 'node_modules', '.vader-settings-ui-'));
const shots = path.join(os.tmpdir(), 'settings-ui-shots');
fs.mkdirSync(shots, { recursive: true });

const plugin = {
	name: 'harness',
	setup(build) {
		build.onResolve({ filter: /.*/ }, (args) => {
			if (!args.path.startsWith('.')) return null;
			const full = path.resolve(args.resolveDir, args.path).replace(/\\/g, '/');
			if (/\/util\/services\.js$/.test(full)) return { path: path.join(here, 'fixtures/settingsHarnessServices.ts') };
			if (/\/vader-settings-tsx\/Settings\.js$/.test(full) || /\/sidebar-tsx\/ErrorBoundary\.js$/.test(full) || /\/common\/vaderSettingsService\.js$/.test(full)) return { path: path.join(here, 'fixtures/settingsStubs.tsx') };
			return null;
		});
	},
};
await esbuild.build({
	entryPoints: [path.join(here, 'fixtures/settingsHarness.tsx')], bundle: true, platform: 'browser', format: 'iife', outfile: path.join(tmp, 'page.js'), logLevel: 'error',
	plugins: [plugin], jsx: 'automatic', loader: { '.json': 'json', '.css': 'css' }, define: { 'process.env.NODE_ENV': '"production"' },
	tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false, jsx: 'react-jsx' } },
});
fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="page.css"><style>html,body{margin:0;background:#0b0b0c;color:#e6e6e6}#root{width:1440px;height:862px;overflow:hidden;position:relative}</style></head><body><div id="root"></div><script src="page.js"></script></body></html>');

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

async function newPage(setup, page0) {
	const page = await browser.newPage({ viewport: { width: 1440, height: 862 } });
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
	if (setup) await page.addInitScript(setup);
	await page.goto(base);
	await page.waitForFunction(() => window.__mounted === true);
	if (page0) await page.locator(TID(`vader-settings-nav-${page0}`)).click();
	return { page, errors };
}
const shot = async (page, name) => { await page.screenshot({ path: path.join(shots, name + '.png') }); };
const log = (page) => page.evaluate(() => window.__log.slice());
/** anything cut off or spilling out of the page */
async function layoutProblems(page) {
	return page.evaluate(() => {
		const out = [];
		const root = document.querySelector('[data-testid="vader-settings-page"]');
		if (!root) return ['no settings page'];
		const main = root.querySelector('main');
		if (main && main.scrollWidth > main.clientWidth + 1) out.push(`the page is wider than itself: ${main.scrollWidth} > ${main.clientWidth}`);
		for (const b of main?.querySelectorAll('button.vader-pb, button.vader-gb') ?? []) { if (b.getBoundingClientRect().height > 40) out.push(`button label wraps: ${(b.innerText || '').slice(0, 30)}`); }
		for (const el of main?.querySelectorAll('[data-testid]') ?? []) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.right > main.getBoundingClientRect().right + 1) out.push(`spills out of the page: ${el.getAttribute('data-testid')}`); }
		return out;
	});
}

// ===================================================================== the frame
{
	const { page, errors } = await newPage();
	const nav = page.locator('nav[aria-label="Settings pages"]');
	check('the pages are in three groups named Models, Agent, Workspace', (await nav.locator('.vader-nvh').allInnerTexts()).join('|') === 'Models|Agent|Workspace');
	check('the pages are the ones of the boards, in order', (await nav.locator('button').allInnerTexts()).join('|') === 'Models|Model router|Connected agents|Permissions|Usage and cost|Saved agents|Skills|MCP servers|Memory and instructions|Editor extensions|Editor|Privacy and network|Data and backup|About and updates');
	check('it opens on Models and says which page is current', (await page.locator(`${TID('vader-settings-nav-models')}[aria-current=page]`).count()) === 1);
	check('there is a way back to the app', (await page.locator(TID('vader-settings-close')).innerText()).includes('Back to the app'));
	await page.locator(TID('vader-settings-close')).click();
	check('it closes Settings through the app\'s own command', (await log(page)).includes('command:vader.toggleSettings') || (await log(page)).some(x => /command:.*[Ss]ettings/.test(x)), (await log(page)).join(','));
	await page.locator(TID('vader-settings-search')).fill('budget');
	check('the search keeps the pages that match what was typed', (await nav.locator('button').allInnerTexts()).join('|') === 'Usage and cost', (await nav.locator('button').allInnerTexts()).join('|'));
	await page.locator(TID('vader-settings-search')).fill('zzzz');
	check('a search that matches nothing says so', (await nav.innerText()).includes('Nothing in Settings matches that.'));
	await page.locator(TID('vader-settings-search')).fill('');
	await page.evaluate(() => window.dispatchEvent(new CustomEvent('vader-settings-goto', { detail: { page: 'usage' } })));
	await page.waitForSelector(`${TID('vader-settings-nav-usage')}[aria-current=page]`, { timeout: 3000 }).catch(() => { });
	check('the app can open Settings on a named page', (await page.locator(`${TID('vader-settings-nav-usage')}[aria-current=page]`).count()) === 1);
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}

// ===================================================================== Permissions
{
	const { page, errors } = await newPage(undefined, 'permissions');
	check('three modes, the policy\'s current one is chosen', (await page.locator('[data-testid^="vader-perm-mode-"]').count()) === 3 && (await page.locator(`${TID('vader-perm-mode-balanced')}[aria-checked=true]`).count()) === 1);
	await page.locator(TID('vader-perm-mode-autonomous')).click();
	check('choosing a mode sets the real policy', (await log(page)).includes('policy:autonomous') && (await page.locator(`${TID('vader-perm-mode-autonomous')}[aria-checked=true]`).count()) === 1);
	const ap = await page.locator(TID('vader-perm-approval')).first().innerText();
	check('a command allowed in this project is listed with its project and when', ap.includes('npm test -- --runInBand') && ap.includes('vader-app') && ap.includes('Command, allowed'), ap);
	await page.locator(TID('vader-perm-revoke')).click();
	check('Revoke removes it, and the page says what happens next', (await log(page)).includes('revoke:k1') && (await page.getByText('Nothing yet. When the agent asks to run a command').count()) === 1);
	check('Edit files is on, Run commands is off, as the settings say', (await page.locator(`${TID('vader-perm-kind-edits')}[aria-checked=true]`).count()) === 1 && (await page.locator(`${TID('vader-perm-kind-terminal')}[aria-checked=false]`).count()) === 1);
	await page.locator(TID('vader-perm-kind-terminal')).click();
	check('turning one on writes the real setting and keeps the others', (await log(page)).some(x => x.startsWith('global:autoApprove=') && x.includes('"terminal":true') && x.includes('"edits":true')), (await log(page)).join(','));
	await page.locator(TID('vader-perm-autoaccept')).click();
	check('accepting changes as they are made is its own switch', (await log(page)).includes('global:autoAcceptLLMChanges=true'));
	check('today’s spending is an estimate, with the approximate sign', /^≈ \$/.test(await page.locator(TID('vader-perm-today')).innerText()), await page.locator(TID('vader-perm-today')).innerText());
	await page.locator(TID('vader-perm-limit')).fill('8');
	await page.keyboard.press('Enter');
	check('the daily limit is saved as a number', (await log(page)).includes('global:dailySpendLimitUsd=8'));
	await page.locator(TID('vader-perm-limit')).fill('');
	await page.keyboard.press('Enter');
	check('an empty limit means no limit', (await log(page)).includes('global:dailySpendLimitUsd=null'));
	const locked = await page.locator(TID('vader-perm-locked')).count();
	check('the locked rules are listed, each with its lock and none with a switch', locked >= 3 && (await page.locator(`${TID('vader-perm-locked')} [role=switch]`).count()) === 0 && (await page.locator(`${TID('vader-perm-locked')} svg`).count()) === locked, String(locked));
	check('what the locked rules do is said: refuse or ask', (await page.locator(TID('vader-perm-locked')).first().innerText()).match(/deny|ask/) !== null);
	const askId = await page.locator(TID('vader-perm-asking')).first().locator('[role=switch]').getAttribute('data-testid');
	await page.locator(`[data-testid="${askId}"]`).click();
	check('a rule that only asks can be turned off', (await log(page)).some(x => /^rule:vader\.ask\.[a-z-]+=false$/.test(x)), (await log(page)).join(','));
	await page.locator(TID('vader-perm-add-rule')).click();
	await page.locator(TID('vader-perm-new-create')).click();
	check('a rule without a reason is refused and says what is missing', (await page.locator(TID('vader-perm-new-problem')).innerText()).includes('what the rule is for'));
	await page.locator(TID('vader-perm-new-what')).fill('Ask before deleting a build folder');
	await page.locator(TID('vader-perm-new-pattern')).fill('(a+)+$');
	await page.locator(TID('vader-perm-new-create')).click();
	check('a pattern that could hang the window is refused', (await page.locator(TID('vader-perm-new-problem')).count()) === 1 && !(await log(page)).some(x => x.startsWith('addrule:')), (await log(page)).join(','));
	await page.locator(TID('vader-perm-new-pattern')).fill('rm -rf build');
	await page.locator(TID('vader-perm-new-create')).click();
	check('a good rule is added to the engine and listed under My own rules', (await log(page)).includes('addrule:ask:terminal-command:Ask before deleting a build folder') && (await page.locator(TID('vader-perm-custom')).count()) === 1);
	await shot(page, '01-permissions');
	check('no layout problem and no error', (await layoutProblems(page)).length === 0 && errors.length === 0, (await layoutProblems(page)).concat(errors).join('; '));
	await page.close();
}
{
	const { page } = await newPage(() => { window.__projectKey = null; }, 'permissions');
	check('with no folder open it says approvals need one', (await page.getByText('Open a folder to keep approvals for it.').count()) === 1);
	await page.close();
}

// ===================================================================== Usage and cost
{
	const { page, errors } = await newPage(undefined, 'usage');
	check('today is an estimate and says how many tokens', /^≈ \$\d/.test(flat(await page.locator(`${TID('vader-usage-today')} span`).nth(1).innerText())) && (await page.locator(TID('vader-usage-today')).innerText()).includes('tokens in'));
	check('the last 14 days are one bar each, today is the last', (await page.locator(TID('vader-usage-bar')).count()) === 14);
	const models = await page.locator(TID('vader-usage-model')).allInnerTexts();
	check('every model used is listed with its tokens and cost', models.length === 4 && models.some(t => t.includes('claude-sonnet-4-5')) && models.some(t => t.includes('deepseek/deepseek-v3.2')), models.map(flat).join(' | '));
	const bySource = async (s) => flat(await page.locator(`${TID('vader-usage-model')}[data-source=${s}]`).first().innerText());
	check('an estimate says so and has the approximate sign', /≈ \$/.test(await bySource('estimate')) && (await bySource('estimate')).includes('Estimate'));
	check('what the provider billed says so and has no approximate sign', !/≈/.test(await bySource('billed')) && (await bySource('billed')).includes('Billed by provider'));
	check('a local model is free and says it runs here', (await bySource('free')).includes('Free') && (await bySource('free')).includes('runs here'));
	check('a model with no known price is never free: it offers to set one', (await bySource('unpriced')).includes('Set a price') && (await bySource('unpriced')).includes('No price known'));
	check('and the page says its cost is not in the totals', (await page.locator(TID('vader-usage-unpriced')).innerText()).includes('never counted as free'));
	check('the daily limit shows the limit that is set', (await page.locator(TID('vader-usage-limit')).inputValue()) === '5.00' && (await page.locator(`${TID('vader-usage-limit-switch')}[aria-checked=true]`).count()) === 1);
	await page.locator(TID('vader-usage-limit-switch')).click();
	check('turning the limit off writes no limit', (await log(page)).includes('global:dailySpendLimitUsd=null') && await page.locator(TID('vader-usage-limit')).isDisabled());
	await page.locator(TID('vader-usage-limit-switch')).click();
	check('turning it on again brings back the amount that was typed', (await log(page)).includes('global:dailySpendLimitUsd=5'));
	check('the providers whose key is set have a page that shows the real bill', (await page.locator(TID('vader-usage-provider-page')).count()) === 2);
	await page.locator(TID('vader-usage-provider-page')).first().click();
	check('it opens in the person’s browser', (await page.evaluate(() => window.__opened)).some(u => /^https:\/\//.test(u)));
	await page.locator(TID('vader-usage-set-price')).click();
	check('Set a price opens the own prices with the model filled in', (await page.locator(TID('vader-usage-own-model')).inputValue()) === 'acme-internal-70b');
	await page.locator(TID('vader-usage-own-in')).fill('0.9');
	await page.locator(TID('vader-usage-own-out')).fill('0.9');
	await page.locator(TID('vader-usage-own-add')).click();
	check('the own price is saved per million tokens', (await log(page)).some(x => x.startsWith('global:modelPriceOverrides=') && x.includes('acme-internal-70b') && x.includes('"input":0.9')), (await log(page)).join(','));
	await page.locator(TID('vader-usage-discount')).fill('20');
	await page.keyboard.press('Enter');
	check('a flat discount is saved as a percent', (await log(page)).includes('global:priceDiscountPercent=20'));
	await page.locator(TID('vader-usage-discount')).fill('250');
	await page.keyboard.press('Enter');
	check('a discount above 100 is not accepted', (await log(page)).filter(x => x === 'global:priceDiscountPercent=0').length >= 1);
	await shot(page, '02-usage');
	check('no layout problem and no error', (await layoutProblems(page)).length === 0 && errors.length === 0, (await layoutProblems(page)).concat(errors).join('; '));
	await page.close();
}
{
	const { page } = await newPage(() => { window.__ledger = {}; }, 'usage');
	await page.waitForSelector(TID('vader-usage-empty'));
	check('with nothing used, the page says so and shows no table rows', (await page.locator(TID('vader-usage-empty')).innerText()).includes('Nothing used yet') && (await page.locator(TID('vader-usage-model')).count()) === 0);
	await page.close();
}

// ===================================================================== Model router
{
	const { page, errors } = await newPage(undefined, 'router');
	check('five jobs are listed, each with what it is', (await page.locator(TID('vader-router-job')).count()) === 5 && (await page.locator(TID('vader-router-job')).first().innerText()).includes('Tasks handed off to a helper agent'));
	check('the mode in use is chosen', (await page.locator(`${TID('vader-router-mode-manual')}[aria-checked=true]`).count()) === 1);
	check('in Choose myself a job uses the Chat model unless another is picked', (await page.locator(TID('vader-router-select')).first().inputValue()) === '(Chat model)');
	await page.locator(TID('vader-router-select')).nth(4).selectOption('openAI/gpt-5');
	check('picking a model for a job sets it in the router', (await log(page)).includes('override:verification=gpt-5'));
	check('and the table shows its price per million tokens', (await page.locator(`${TID('vader-router-job')}[data-category=verification] ${TID('vader-router-cost')}`).innerText()) === '$1.25 / $10');
	await page.locator(TID('vader-router-select')).nth(4).selectOption('(Chat model)');
	check('going back to the Chat model clears the choice', (await log(page)).includes('override:verification=null'));
	await page.locator(TID('vader-router-mode-auto')).click();
	check('Automatic is set in the router, and the page says what it does', (await log(page)).includes('router:auto') && (await page.locator(TID('vader-router-explain')).innerText()).includes('It never picks a provider you have not set up'));
	const used = await page.locator(TID('vader-router-model')).allInnerTexts();
	check('in Automatic the table shows the model each job uses right now', used.map(flat).join('|') === 'claude-sonnet-4-5|gpt-5|claude-sonnet-4-5|qwen2.5-coder:7b|gpt-5', used.map(flat).join('|'));
	check('a local model is free and says so', (await page.locator(`${TID('vader-router-job')}[data-category=summarization] ${TID('vader-router-cost')}`).innerText()) === 'free, local');
	check('in Automatic there is nothing to change by mistake', (await page.locator(TID('vader-router-select')).count()) === 0);
	await shot(page, '03-router');
	check('no layout problem and no error', (await layoutProblems(page)).length === 0 && errors.length === 0, (await layoutProblems(page)).concat(errors).join('; '));
	await page.close();
}
{
	const { page } = await newPage(() => { window.__noModels = true; }, 'router');
	check('with no model set up the router says so and shows no table', (await page.locator(TID('vader-router-none')).innerText()).includes('No model is set up yet') && (await page.locator(TID('vader-router-job')).count()) === 0);
	await page.close();
}

// ===================================================================== Saved agents
{
	const { page, errors } = await newPage(undefined, 'saved');
	const rows = (await page.locator(TID('vader-saved-item')).allInnerTexts()).map(flat);
	check('the saved agents are listed with what they do and what limits them', rows.length === 2 && rows[0].includes('Reviewer') && rows[0].includes('only src') && rows[1].includes('Release notes') && rows[1].includes('read only'), rows.join(' | '));
	check('the first one is open in the form with its real values', (await page.locator(TID('vader-saved-name')).inputValue()) === 'Reviewer' && (await page.locator(TID('vader-saved-folders')).inputValue()) === 'src/**' && (await page.locator(TID('vader-saved-model')).inputValue()) === 'anthropic/claude-sonnet-4-5');
	check('what it may ask to do shows as ticks: not edit, yes commands', (await page.locator(`${TID('vader-saved-allow-edits')}[aria-checked=false]`).count()) === 1 && (await page.locator(`${TID('vader-saved-allow-terminal')}[aria-checked=true]`).count()) === 1);
	check('its MCP servers and the tool it may never call are shown', (await page.locator(`${TID('vader-saved-mcp')}[aria-checked=true]`).innerText()) === 'GitHub' && (await page.locator(TID('vader-saved-denied')).innerText()) === 'create_pull_request');
	check('nothing to save until something changes', await page.locator(TID('vader-saved-save')).isDisabled());
	await page.locator(TID('vader-saved-allow-edits')).click();
	await page.locator(TID('vader-saved-name')).fill('Code reviewer');
	check('a change makes Save available', await page.locator(TID('vader-saved-save')).isEnabled());
	await page.locator(TID('vader-saved-discard')).click();
	check('Discard changes puts the saved values back', (await page.locator(TID('vader-saved-name')).inputValue()) === 'Reviewer' && (await page.locator(`${TID('vader-saved-allow-edits')}[aria-checked=false]`).count()) === 1);
	await page.locator(TID('vader-saved-name')).fill('Code reviewer');
	await page.locator(TID('vader-saved-allow-edits')).click();
	await page.locator(TID('vader-saved-denied-input')).fill('delete_branch');
	await page.keyboard.press('Enter');
	await page.locator(TID('vader-saved-save')).click();
	const upd = (await log(page)).find(x => x.startsWith('agent:update:a1:')) ?? '';
	check('Save writes the real agent: name, the new kind, the new denied tool, the folders as a list', upd.includes('"name":"Code reviewer"') && upd.includes('"allowedApprovalTypes":["terminal","MCP tools","edits"]') && upd.includes('"deniedToolNames":["create_pull_request","delete_branch"]') && upd.includes('"filesystemScopeGlobs":["src/**"]'), upd);
	await page.locator(TID('vader-saved-use')).click();
	check('Use in this chat sets the agent of the current chat', (await log(page)).includes('useagent:a1') && (await page.locator(TID('vader-saved-use')).innerText()).includes('In use'));
	await page.locator(TID('vader-saved-duplicate')).click();
	check('Duplicate makes a copy and opens it', (await log(page)).includes('agent:create:Code reviewer copy') && (await page.locator(TID('vader-saved-item')).count()) === 3);
	await page.locator(TID('vader-saved-delete')).click();
	check('Delete asks once more before it deletes', !(await log(page)).some(x => x.startsWith('agent:delete:')) && (await page.locator(TID('vader-saved-delete-confirm')).count()) === 1);
	await page.locator(TID('vader-saved-delete-confirm')).click();
	check('and then deletes it', (await log(page)).some(x => x.startsWith('agent:delete:')) && (await page.locator(TID('vader-saved-item')).count()) === 2);
	await page.locator(TID('vader-saved-new')).click();
	check('a new agent cannot be created before something is written', await page.locator(TID('vader-saved-save')).isDisabled());
	await page.locator(TID('vader-saved-name')).fill('Docs writer');
	await page.locator(TID('vader-saved-desc')).fill('Writes and fixes Markdown');
	await page.locator(TID('vader-saved-save')).click();
	check('a missing instruction is named', (await page.locator(TID('vader-saved-problem')).innerText()).includes('Write what it should always do'));
	await page.locator(TID('vader-saved-instructions')).fill('Only touch Markdown files.');
	await page.locator(TID('vader-saved-folders')).fill('docs/**, *.md');
	await page.locator(TID('vader-saved-save')).click();
	check('a new agent is created with its folders as a list and is opened', (await log(page)).some(x => x.startsWith('agent:create:Docs writer')) && (await page.locator(TID('vader-saved-name')).inputValue()) === 'Docs writer' && (await page.locator(TID('vader-saved-item')).count()) === 3);
	await shot(page, '04-saved-agents');
	check('no layout problem and no error', (await layoutProblems(page)).length === 0 && errors.length === 0, (await layoutProblems(page)).concat(errors).join('; '));
	await page.close();
}

// ===================================================================== Editor
{
	const { page, errors } = await newPage(undefined, 'editor');
	check('suggestions are off by default and the model choice is hidden while they are off', (await page.locator(`${TID('vader-editor-autocomplete')}[aria-checked=false]`).count()) === 1 && (await page.locator(TID('vader-editor-model-autocomplete')).count()) === 0);
	await page.locator(TID('vader-editor-autocomplete')).click();
	check('turning them on writes the real setting and shows the model for them', (await log(page)).includes('global:enableAutocomplete=true') && (await page.locator(TID('vader-editor-model-autocomplete')).count()) === 1);
	check('only models that can fill in the middle are offered for suggestions', (await page.locator(`${TID('vader-editor-model-autocomplete')} option`).allInnerTexts()).filter(t => t !== 'Choose a model').join('|') === 'codestral-latest');
	await page.locator(TID('vader-editor-model-autocomplete')).selectOption('mistral/codestral-latest');
	check('choosing one sets the model of that feature', (await log(page)).includes('select:Autocomplete=codestral-latest'));
	await page.locator(TID('vader-editor-selection')).click();
	check('Add to chat and Edit next to selected code has its own switch', (await log(page)).includes('global:showInlineSuggestions=false'));
	check('applying uses the chat model, and the model of its own appears only when that is turned off', (await page.locator(TID('vader-editor-model-apply')).count()) === 0);
	await page.locator(TID('vader-editor-sync-apply')).click();
	check('turning it off shows the model for Ctrl K and applying', (await log(page)).includes('global:syncApplyToChat=false') && (await page.locator(TID('vader-editor-model-apply')).count()) === 1);
	await page.locator(TID('vader-editor-fast-apply')).click();
	check('rewriting only the changed lines is its own switch', (await log(page)).includes('global:enableFastApply=false'));
	await page.locator(TID('vader-editor-lint')).click();
	check('errors after an edit is its own switch', (await log(page)).includes('global:includeToolLintErrors=false'));
	await page.locator(TID('vader-editor-sync-scm')).click();
	check('commit messages follow the same pattern', (await log(page)).includes('global:syncSCMToChat=false') && (await page.locator(TID('vader-editor-model-scm')).count()) === 1);
	await shot(page, '05-editor');
	check('no layout problem and no error', (await layoutProblems(page)).length === 0 && errors.length === 0, (await layoutProblems(page)).concat(errors).join('; '));
	await page.close();
}

// ===================================================================== Privacy and network
{
	const { page, errors } = await newPage(undefined, 'privacy');
	const contacts = (await page.locator(TID('vader-privacy-contact')).allInnerTexts()).map(flat);
	check('everyone Vader can contact is listed with why, and the host', contacts.length === 6 && contacts[0].includes('Your model provider') && contacts.some(c => c.includes('open-vsx.org')) && contacts.some(c => c.includes('registry.modelcontextprotocol.io')), contacts.join(' | '));
	check('the page says there is no analytics, no crash reporter and no account', (await page.locator(TID('vader-settings-privacy')).innerText()).includes('no crash reporter, no account'));
	check('the release check says it is off until the person turns it on', contacts.find(c => c.startsWith('Release check')).includes('Only when you press'));
	await page.locator(TID('vader-settings-privacy-autocheck')).click();
	check('turning the automatic check on is the real setting, and the list changes its wording', (await log(page)).includes('global:autoCheckUpdates=true') && (await page.locator(TID('vader-privacy-contact')).nth(3).innerText()).includes('Now on'));
	await page.locator(TID('vader-privacy-verified')).click();
	check('"How this is verified" opens the document', (await page.evaluate(() => window.__opened)).some(u => u.endsWith('docs/integrations/privacy.md')));
	check('no layout problem and no error', (await layoutProblems(page)).length === 0 && errors.length === 0, (await layoutProblems(page)).concat(errors).join('; '));
	await page.close();
}

// ===================================================================== Editor extensions
{
	const { page, errors } = await newPage(undefined, 'extensions');
	check('the marketplace is named from the product, and what is missing is said', (await page.locator(TID('vader-settings-gallery')).innerText()).includes('open-vsx.org') && (await page.locator(TID('vader-settings-extensions')).innerText()).includes('Remote-SSH'));
	await page.locator(TID('vader-ext-browse')).click();
	await page.locator(TID('vader-ext-vsix')).click();
	check('the buttons run the editor\u2019s own commands', (await log(page)).includes('command:workbench.view.extensions') && (await log(page)).includes('command:workbench.extensions.action.installVSIX'));
	check('requiring signed extensions is off and says why', (await page.locator(`${TID('vader-settings-verify-signature')}[aria-checked=false]`).count()) === 1 && (await page.locator(TID('vader-settings-extensions')).innerText()).includes('does not sign extensions'));
	await page.locator(TID('vader-settings-verify-signature')).click();
	await page.waitForSelector(`${TID('vader-settings-verify-signature')}[aria-checked=true]`, { timeout: 3000 }).catch(() => { });
	check('turning it on writes the editor\u2019s setting and the switch follows it', (await log(page)).includes('config:extensions.verifySignature=true') && (await page.locator(`${TID('vader-settings-verify-signature')}[aria-checked=true]`).count()) === 1);
	check('no layout problem and no error', (await layoutProblems(page)).length === 0 && errors.length === 0, (await layoutProblems(page)).concat(errors).join('; '));
	await page.close();
}

// ===================================================================== About and updates
{
	const { page, errors } = await newPage(undefined, 'about');
	check('the version of Vader and of VS Code it is built on are shown', (await page.locator(TID('vader-settings-version')).innerText()) === 'Version 0.1.0 \u00B7 built on VS Code 1.136.2');
	check('the commit is cut to ten characters', (await page.locator(TID('vader-settings-about')).innerText()).includes('0123456789') && !(await page.locator(TID('vader-settings-about')).innerText()).includes('0123456789a'));
	await page.locator(TID('vader-about-check')).click();
	check('Check for updates runs the app\u2019s own command', (await log(page)).includes('command:vader.vaderCheckUpdate'));
	check('and says where the answer will appear, not a made-up result', (await page.locator(TID('vader-settings-about')).innerText()).includes('Its result is the message in the corner'));
	await page.locator(TID('vader-settings-about-autocheck')).click();
	check('the automatic check is the real setting', (await log(page)).includes('global:autoCheckUpdates=true'));
	await page.locator(TID('vader-about-releases')).click();
	check('All releases opens the releases page', (await page.evaluate(() => window.__opened)).some(u => u.endsWith('/releases')));
	check('it says Vader does not update itself', (await page.locator(TID('vader-settings-about')).innerText()).includes('does not update itself'));
	check('no layout problem and no error', (await layoutProblems(page)).length === 0 && errors.length === 0, (await layoutProblems(page)).concat(errors).join('; '));
	await page.close();
}

// ===================================================================== Data and backup
{
	const { page, errors } = await newPage(undefined, 'data');
	check('the chats are counted', (await page.locator(TID('vader-settings-data')).innerText()).includes('3 chats'));
	const downloads = [];
	page.on('download', (d) => { downloads.push(d); });
	await page.locator(TID('vader-data-export-settings')).click();
	await page.waitForFunction(() => document.querySelector('[data-testid="vader-data-message"]')?.textContent?.includes('Exported the settings'), null, { timeout: 5000 }).catch(() => { });
	await page.waitForTimeout(800);
	const settingsDownload = downloads.find((d) => d.suggestedFilename() === 'vader-settings.json');
	check('exporting settings gives a file with no key in it', !!settingsDownload && !fs.readFileSync(await settingsDownload.path(), 'utf8').includes('sk-test-'), `downloads: ${downloads.map((d) => d.suggestedFilename()).join(',')} | errors: ${errors.join(' | ')}`);
	check('and says what it exported', (await page.locator(TID('vader-data-message')).innerText()).includes('without keys'));
	await page.locator(TID('vader-data-export-chats')).click();
	await page.waitForTimeout(800);
	check('exporting chats gives the chats file', downloads.some((d) => d.suggestedFilename() === 'vader-chats.json'));
	await page.locator(TID('vader-data-chats-file')).setInputFiles({ name: 'chats.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ allThreads: { a: {}, b: {} }, currentThreadId: 'a' })) });
	await page.waitForFunction(() => window.__log.some(x => x.startsWith('chats:import')));
	check('importing chats hands the file to the chat service and says so', (await log(page)).includes('chats:import:2') && (await page.locator(TID('vader-data-message')).innerText()).includes('Chats imported'));
	await page.locator(TID('vader-data-chats-file')).setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{ not json') });
	await page.waitForFunction(() => document.querySelector('[data-testid="vader-data-message"]')?.textContent?.includes('could not be read'));
	check('a file that is not JSON is refused with the file name and the reason', (await page.locator(TID('vader-data-message')).innerText()).includes('broken.json could not be read as chats'));
	check('one button per editor to bring things over from', (await page.locator(TID('vader-switch-editor')).count()) === 7);
	await page.locator('[data-editor="Cursor"]').click();
	await page.waitForSelector(TID('vader-switch-done'));
	check('bringing things over from an editor says it is done', (await log(page)).includes('transfer:Cursor') && (await page.locator(TID('vader-switch-done')).innerText()).includes('Cursor'));
	await page.locator('[data-editor="Trae"]').click();
	await page.waitForSelector(TID('vader-switch-failed'));
	check('when it fails, the real reason is shown', (await page.locator(TID('vader-switch-failed')).innerText()).includes('Trae was not found'));
	await page.locator(TID('vader-data-delete-chats')).click();
	check('deleting chats asks a second time and deletes nothing yet', !(await log(page)).includes('chats:reset') && (await page.locator(TID('vader-data-delete-chats-confirm')).count()) === 1);
	await page.locator(TID('vader-data-delete-chats-confirm')).click();
	check('and then deletes them', (await log(page)).includes('chats:reset'));
	await page.locator(TID('vader-data-remove-keys')).click();
	await page.locator(TID('vader-data-remove-keys-confirm')).click();
	const l = await log(page);
	check('removing the keys clears the key of every provider that had one, and only those', l.includes('provider:anthropic.apiKey=') && l.includes('provider:openRouter.apiKey=') && l.filter(x => x.startsWith('provider:') && x.endsWith('apiKey=')).length === 2, l.join(','));
	await page.locator(TID('vader-data-reset-settings')).click();
	await page.locator(TID('vader-data-reset-settings-confirm')).click();
	check('resetting settings asks first, then resets', (await log(page)).includes('settings:reset'));
	await page.locator(TID('vader-data-logs')).click();
	check('Open the logs folder shows the real logs folder', (await log(page)).includes('folder:C:\\logs'));
	await page.locator(TID('vader-data-welcome')).click();
	check('Show the welcome again clears the first-run flag', (await log(page)).includes('global:isOnboardingComplete=false'));
	await shot(page, '06-data');
	check('no layout problem and no error', (await layoutProblems(page)).length === 0 && errors.length === 0, (await layoutProblems(page)).concat(errors).join('; '));
	await page.close();
}

await browser.close();
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed\nscreenshots: ${shots}`);
process.exit(failed ? 1 : 0);
