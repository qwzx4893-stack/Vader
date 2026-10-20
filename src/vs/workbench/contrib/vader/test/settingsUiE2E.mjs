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
import { auditShot } from './fixtures/uiAudit.mjs';

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
fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="page.css"><style>html,body{margin:0;background:#0b0b0c;color:#e6e6e6}#root{width:1440px;height:900px;overflow:hidden;position:relative}</style></head><body><div id="root"></div><script src="page.js"></script></body></html>');

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
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
	if (setup) await page.addInitScript(setup);
	await page.goto(base);
	await page.waitForFunction(() => window.__mounted === true);
	await page.waitForTimeout(150);
	if (errors.length) console.log(`PAGE ERRORS: ${errors.join(' | ').slice(0, 600)}`);
	if (page0) await page.locator(TID(`vader-settings-nav-${page0}`)).click();
	return { page, errors };
}
const shot = async (page, name) => { await auditShot(page, name); await page.screenshot({ path: path.join(shots, name + '.png') }); };
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
	check('a search that matches nothing says what was searched', (await page.locator(TID('vader-settings-nomatch')).innerText()) === 'No setting called “zzzz”.');
	await page.locator(TID('vader-settings-search')).fill('proxi');
	await page.waitForSelector(TID('vader-settings-nearest'));
	check('a word that is nearly a setting offers the nearest places', (await page.locator(TID('vader-settings-nearest-page')).first().innerText()).includes('Privacy and network'));
	await page.locator(TID('vader-settings-nearest-page')).first().click();
	check('a click on one goes there and clears the search', (await page.locator(TID('vader-settings-main-privacy')).count()) === 1 && (await page.locator(TID('vader-settings-search')).inputValue()) === '');
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
	await page.locator(TID('vader-perm-taskcopies')).click();
	check('working in a copy of the project is its own switch, in a group of its own', (await log(page)).includes('global:taskCopies=true') && (await page.getByText('Where the agent works').count()) === 1);
	check('today’s spending is an estimate, with the approximate sign', /^≈ \$/.test(await page.locator(TID('vader-perm-today')).innerText()), await page.locator(TID('vader-perm-today')).innerText());
	await page.locator(TID('vader-perm-limit')).fill('8');
	await page.keyboard.press('Enter');
	check('the daily limit is saved as a number, and the box says what was set', (await log(page)).includes('global:dailySpendLimitUsd=8') && (await page.locator(TID('vader-perm-limit-saved')).innerText()).includes('Daily limit set to $8.00'));
	await page.locator(TID('vader-perm-limit')).fill('five');
	await page.keyboard.press('Enter');
	check('a limit that is not a number is refused in words, and nothing is written', (await page.locator(TID('vader-perm-limit-problem')).innerText()) === 'Enter a number, like 5 or 12.50.' && !(await log(page)).includes('global:dailySpendLimitUsd=NaN') && (await page.locator(TID('vader-perm-limit')).inputValue()) === 'five' && (await page.locator(TID('vader-perm-limit')).getAttribute('aria-invalid')) === 'true');
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
	check('a discount above 100 is refused in words and the text stays', (await page.locator(TID('vader-usage-discount-problem')).innerText()).includes('0 to 100') && (await page.locator(TID('vader-usage-discount')).inputValue()) === '250' && !(await log(page)).includes('global:priceDiscountPercent=250'));
	await page.locator(TID('vader-usage-own-model')).fill('some-model');
	await page.locator(TID('vader-usage-own-in')).fill('cheap');
	await page.locator(TID('vader-usage-own-out')).fill('1');
	await page.locator(TID('vader-usage-own-add')).click();
	check('a price that is not a number is refused and names which one', (await page.locator(TID('vader-usage-own-problem')).innerText()).includes('Input: Enter the price per million tokens'));
	await page.locator(TID('vader-usage-limit')).fill('twelve');
	await page.keyboard.press('Enter');
	check('the same for the limit on this page', (await page.locator(TID('vader-usage-limit-problem')).count()) === 1);
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
	check('the next edit is off by default and has its own switch that says it costs requests', (await page.locator(`${TID('vader-editor-next-edit')}[aria-checked=false]`).count()) === 1 && (await page.locator('[data-testid=vader-settings-editor]').innerText()).includes('at most 20 a minute'));
	await page.locator(TID('vader-editor-next-edit')).click();
	check('turning it on writes the real setting', (await log(page)).includes('global:nextEdit=true'));
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
	await page.locator(TID('vader-editor-reset')).click();
	check('Reset these settings asks first, and says what is not touched', (await page.locator(TID('vader-editor-reset-confirm')).innerText()).includes('keys and your chats are not touched'));
	await page.locator(`${TID('vader-editor-reset-confirm')} button`, { hasText: 'Cancel' }).click();
	check('Cancel changes nothing', (await page.locator(TID('vader-editor-reset-confirm')).count()) === 0 && !(await log(page)).includes('global:enableAutocomplete=false'));
	await page.locator(TID('vader-editor-reset')).click();
	await page.locator(TID('vader-editor-reset-do')).click();
	const lg = await log(page);
	check('Reset puts each of the editor settings back to how a new install has it', lg.includes('global:enableAutocomplete=false') && lg.includes('global:syncApplyToChat=true') && lg.includes('global:syncSCMToChat=true') && lg.includes('global:enableFastApply=true') && lg.includes('global:showInlineSuggestions=true') && lg.includes('global:includeToolLintErrors=true'), lg.join(','));
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
	check('a project with no .vaderignore says so, and offers to create one', (await page.locator(TID('vader-privacy-ignore-detail')).innerText()).includes('None in this project') && (await page.locator(TID('vader-privacy-ignore-create')).count()) === 1);
	await page.locator(TID('vader-privacy-ignore-create')).click();
	await page.waitForSelector(TID('vader-privacy-ignore-open'));
	check('Create writes the file with its explanation and opens it', (await log(page)).includes('create:.vaderignore') && (await log(page)).some(x => x.startsWith('command:vscode.open')) && (await page.locator(TID('vader-privacy-ignore-detail')).innerText()).startsWith('0 patterns.'));
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
	check('before any check it says so, and that nothing is installed without a click', (await page.locator(TID('vader-about-result')).innerText()).includes('Not checked yet in this session') && (await page.locator(TID('vader-about-result')).innerText()).includes('Nothing is installed without your click'));
	await page.locator(TID('vader-about-check')).click();
	await page.waitForFunction(() => document.querySelector('[data-testid="vader-about-result"]')?.textContent?.includes('Checked just now'));
	check('Check for updates asks the update service and says its answer here', (await log(page)).includes('update:check:true') && (await page.locator(TID('vader-about-result')).innerText()).includes('Vader 0.1.0 is up to date.'));
	check('no card is shown when there is no update', (await page.locator('[data-testid^="vader-update-"]').count()) === 0);
	await page.locator(TID('vader-settings-about-autocheck')).click();
	check('the automatic check is the real setting', (await log(page)).includes('global:autoCheckUpdates=true'));
	await page.locator(TID('vader-about-releases')).click();
	check('All releases opens the releases page', (await page.evaluate(() => window.__opened)).some(u => u.endsWith('/releases')));
	check('no layout problem and no error', (await layoutProblems(page)).length === 0 && errors.length === 0, (await layoutProblems(page)).concat(errors).join('; '));
	await page.close();
}

// ===================================================================== the project index (common/codebaseIndex/)
{
	const { page, errors } = await newPage(() => { window.__workspaceFolders = [{ uri: { fsPath: 'c:/work/vader-app' } }]; }, 'privacy');
	const words = async (id) => (await page.locator(TID(id)).innerText()).replace(/\s+/g, ' ').trim();
	check('the page has a switch for the index, which says it stays on this computer and never reads secrets', (await page.locator(TID('vader-privacy-index')).count()) === 1 && (await page.locator(TID('vader-settings-privacy')).innerText()).includes('no word of it is sent anywhere') && (await page.locator(TID('vader-settings-privacy')).innerText()).includes('never read'));
	check('before the index has said anything it says it is starting', (await words('vader-privacy-index-title')) === 'Starting');
	await page.evaluate(() => window.__setIndexState({ status: 'ready', files: 1234, chunks: 8900, rootHash: 'x', updatedAt: Date.now() - 120000, truncated: false }));
	await page.waitForTimeout(80);
	check('a ready index says what it holds and how old it is', (await words('vader-privacy-index-title')) === '1,234 files in 8,900 pieces' && (await words('vader-privacy-index-detail')).startsWith('Updated 2 min ago. Kept on this computer'));
	await page.waitForTimeout(200);
	await shot(page, 'privacy-index');
	await page.locator(TID('vader-privacy-index-rebuild')).click();
	check('Rebuild asks the main process to build it again', (await log(page)).includes('index:rebuild'));
	await page.evaluate(() => window.__setIndexState({ status: 'indexing', files: 100, chunks: 500, rootHash: 'x', updatedAt: Date.now(), truncated: false, progress: { done: 200, total: 1200 } }));
	await page.waitForTimeout(80);
	check('while it builds the page says how far, and Rebuild waits', (await words('vader-privacy-index-title')).startsWith('Indexing: 200 of 1,200') && await page.locator(TID('vader-privacy-index-rebuild')).isDisabled());
	await page.locator(TID('vader-privacy-index')).click();
	check('the switch is the real setting', (await log(page)).includes('global:codebaseIndex=false'));
	await page.waitForTimeout(80);
	check('and turned off, the page says nothing is stored and there is no Rebuild', (await words('vader-privacy-index-title')) === 'The project index is off' && (await page.locator(TID('vader-privacy-index-rebuild')).count()) === 0);
	check('no layout problem and no error', (await layoutProblems(page)).length === 0 && errors.length === 0, (await layoutProblems(page)).concat(errors).join('; '));
	await page.close();
}
{
	const { page } = await newPage(() => { window.__workspaceFolders = []; }, 'privacy');
	check('with no folder open it says so', (await page.locator(TID('vader-privacy-index-title')).innerText()) === 'No folder is open');
	await page.close();
}

// ===================================================================== MCP: a tool changed (board S07)
{
	const { page, errors } = await newPage(() => { window.__pending = { GitHub: ['delete_repository'] }; window.__mcpOverride = { state: { mcpServerOfName: { GitHub: { status: 'success', command: 'npx @github/mcp', tools: [{ name: 'GitHub_create_issue' }, { name: 'GitHub_delete_repository' }] } } } }; }, 'mcp');
	await page.waitForSelector(TID('vader-mcp-changed'));
	check('a server with a new tool shows the question under its row', (await page.locator(`${TID('vader-mcp-server')} ${TID('vader-mcp-changed-title')}`).innerText()) === 'GitHub added a tool');
	await page.locator(TID('vader-mcp-expand')).click();
	check('and the new tool is marked among the tools it offers', (await page.locator('[data-state="new"]').count()) === 1);
	await page.locator(TID('vader-mcp-keep-off')).click();
	check('Keep it off is the real answer, and the card goes', (await log(page)).includes('mcp:off:GitHub:delete_repository') && (await page.locator(TID('vader-mcp-changed')).count()) === 0);
	check('the tool kept off is shown struck through among the tools', (await page.locator('[data-state="off"]').count()) === 1);
	await page.locator('[data-state="off"]').click();
	check('and a click on it allows it after all', (await log(page)).includes('mcp:allow:GitHub:delete_repository'));
	check('no layout problem and no error', (await layoutProblems(page)).length === 0 && errors.length === 0, (await layoutProblems(page)).concat(errors).join('; '));
	await page.close();
}

// ===================================================================== set by your organisation (board S10)
{
	const { page, errors } = await newPage(() => { window.__managed = { autoCheckUpdates: false, dailySpendLimitUsd: 5, taskCopies: true }; }, 'privacy');
	const row = page.locator(`${TID('vader-settings-privacy')} [data-locked="true"]`);
	check('a setting the organisation locked shows its value with the lock mark, not a switch to turn', (await row.count()) === 1 && (await row.locator(TID('vader-locked-detail')).innerText()) === 'Set to off by your organisation' && (await row.locator(TID('vader-locked-control')).count()) === 1 && await row.locator('button[role=switch]').isDisabled());
	check('...and says whom to ask', (await page.locator(TID('vader-locked-note')).innerText()) === 'Ask the person who manages Vader for your team to change it.');
	check('the switch that would have changed it is not there to click', (await page.locator(TID('vader-settings-privacy-autocheck')).count()) === 0);
	await page.waitForTimeout(200);
	await shot(page, 'locked-privacy');
	await page.locator(TID('vader-settings-nav-permissions')).click();
	await page.waitForTimeout(150);
	const lockedRows = page.locator(`${TID('vader-settings-permissions')} [data-locked="true"]`);
	check('the others of the page that are locked say so too, a number as its number', (await lockedRows.count()) === 2 && (await lockedRows.allInnerTexts()).some(t => t.includes('Set to on by your organisation')) && (await lockedRows.allInnerTexts()).some(t => t.includes('Set to 5 by your organisation')), (await lockedRows.allInnerTexts()).join(' | '));
	check('one that is not locked is as it was', (await page.locator(TID('vader-perm-lint')).count()) === 1);
	check('no layout problem and no error', (await layoutProblems(page)).length === 0 && errors.length === 0, (await layoutProblems(page)).concat(errors).join('; '));
	await page.close();
}
{
	const { page } = await newPage(undefined, 'privacy');
	check('with nothing locked there is no lock mark and the switch is there', (await page.locator('[data-locked="true"]').count()) === 0 && (await page.locator(TID('vader-settings-privacy-autocheck')).count()) === 1);
	await page.close();
}

// ===================================================================== updating Vader (board S11)
{
	const { page, errors } = await newPage(undefined, 'about');
	const offer = { version: '1.4.0', tag: 'v1.4.0', releaseUrl: 'https://github.com/qwzx4893-stack/Vader/releases/tag/v1.4.0', summary: 'Adds Add-ons, a cost line that says where its number comes from, and a new welcome. 18 fixes.', asset: { name: 'Vader-Setup-x64-1.4.0.exe', size: 119 * 1024 * 1024, url: 'https://github.com/x' } };
	const set = async (st) => { await page.evaluate((x) => window.__setUpdate(x), st); await page.waitForTimeout(60); };
	const words = async (id) => (await page.locator(TID(id)).first().innerText()).replace(/\s+/g, ' ').trim();

	await set({ kind: 'available', offer });
	check('a newer release is offered with what changed, and three choices', (await words('vader-update-title')) === 'Vader 1.4.0 is ready' && (await words('vader-update-body')).startsWith('Adds Add-ons, a cost line') && (await page.locator(`${TID('vader-update-available')} button`).allInnerTexts()).join('|') === 'Download|Read what changed|Later');
	await page.waitForTimeout(200);
	await shot(page, 'update-available');
	await page.locator(TID('vader-update-download')).click();
	check('Download asks the main process to download it', (await log(page)).includes('update:download'));
	await page.locator(TID('vader-update-changed')).click();
	check('Read what changed opens the release page', (await page.evaluate(() => window.__opened)).includes('https://github.com/qwzx4893-stack/Vader/releases/tag/v1.4.0'));
	await page.locator(TID('vader-update-later')).click();
	check('Later puts the offer away', (await log(page)).includes('update:dismiss') && (await page.locator('[data-testid^="vader-update-"]').count()) === 0);
	await set({ kind: 'available', offer: { ...offer, asset: undefined } });
	check('a release with no installer for this computer offers its page', (await words('vader-update-download')) === 'Open the release page');
	await page.locator(TID('vader-update-download')).click();
	check('...and opens it, without downloading anything', (await page.evaluate(() => window.__opened)).filter(u => u.endsWith('/tag/v1.4.0')).length === 2 && (await log(page)).filter(x => x === 'update:download').length === 1);

	await set({ kind: 'downloading', offer, done: 74 * 1024 * 1024, total: 119 * 1024 * 1024 });
	check('a download says how much of how much, with a bar', (await words('vader-update-title')) === 'Downloading Vader 1.4.0' && (await words('vader-update-progress')) === '74 MB of 119 MB' && (await page.locator(`${TID('vader-update-bar')}`).evaluate(e => e.style.width)) === '62%');
	await page.waitForTimeout(250);
	await shot(page, 'update-downloading');
	await page.locator(TID('vader-update-cancel')).click();
	check('Cancel stops it', (await log(page)).includes('update:cancel'));

	await page.evaluate(() => { window.__running = 2; });
	await set({ kind: 'ready', offer, file: 'C:\\tmp\\Vader-Setup.exe' });
	check('the restart question says how many tasks it would stop, and offers to wait', (await words('vader-update-title')) === 'Restart to finish the update' && (await words('vader-update-body')) === '2 tasks are running. Restart when they are done, or now: they stop and can be continued after.' && (await page.locator(`${TID('vader-update-ready')} button`).allInnerTexts()).join('|') === 'Restart when tasks finish|Restart now');
	await page.waitForTimeout(200);
	await shot(page, 'update-ready');
	await page.locator(TID('vader-update-when-done')).click();
	check('Restart when tasks finish waits, says so, and can be called off', (await log(page)).includes('update:when-idle') && (await words('vader-update-body')) === 'Waiting for the tasks to finish. Vader restarts then.' && (await page.locator(TID('vader-update-stop-waiting')).count()) === 1);
	await page.locator(TID('vader-update-stop-waiting')).click();
	check('...and not waiting any more', (await log(page)).includes('update:stop-waiting') && (await page.locator(TID('vader-update-when-done')).count()) === 1);
	await page.locator(TID('vader-update-now')).click();
	check('Restart now installs at once', (await log(page)).includes('update:now'));
	await page.evaluate(() => { window.__running = 0; window.__installResult = { ok: false, reason: 'The downloaded file is gone. Download it again.' }; });
	await set({ kind: 'ready', offer, file: 'C:\\tmp\\Vader-Setup.exe' });
	check('with nothing running there is nothing to wait for', (await words('vader-update-body')).startsWith('Nothing is running.') && (await page.locator(TID('vader-update-when-done')).count()) === 0);
	await page.locator(TID('vader-update-now')).click();
	await page.waitForSelector(TID('vader-update-problem'));
	check('an install that cannot start says why and stays', (await words('vader-update-problem')) === 'The downloaded file is gone. Download it again.');

	await set({ kind: 'failed', offer, done: 74 * 1024 * 1024, reason: '', current: '0.1.0' });
	check('a failed download says where it stopped and that the running version is fine', (await words('vader-update-title')) === 'Could not download the update' && (await words('vader-update-body')) === 'The download stopped at 74 MB. You are still on 0.1.0, which works as before.' && (await page.locator(`${TID('vader-update-failed')} button`).allInnerTexts()).join('|') === 'Try again|Download it from the website');
	await page.waitForTimeout(200);
	await shot(page, 'update-failed');
	await page.locator(TID('vader-update-retry')).click();
	check('Try again downloads again', (await log(page)).filter(x => x === 'update:download').length >= 2);
	await page.locator(TID('vader-update-website')).click();
	check('Download it from the website opens the release page', (await page.evaluate(() => window.__opened)).filter(u => u.endsWith('/tag/v1.4.0')).length >= 3);
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
	await page.waitForSelector(TID('vader-switch-found'));
	check('an editor is looked at first, and what it has is offered as a list, not brought over silently', (await log(page)).includes('inspect:Cursor') && !(await log(page)).some(l => l.startsWith('transfer:')) && (await page.locator(TID('vader-switch-found')).innerText()).includes('Cursor settings found') && (await page.locator(TID('vader-switch-found')).innerText()).includes('Keys and chats are not copied.'));
	const parts = (await page.locator(TID('vader-switch-found') + ' label').allInnerTexts()).map(flat);
	check('each part says what it is, with how many extensions', parts.join(' | ') === 'Theme and keybindings | Extensions list (12) | Snippets', parts.join(' | '));
	await shot(page, 'switch-found');
	await page.locator(TID('vader-switch-part-snippets')).uncheck();
	await page.locator(TID('vader-switch-import')).click();
	await page.waitForSelector(TID('vader-switch-done'));
	check('Import brings over only what is ticked', (await log(page)).includes('transfer:Cursor:theme+extensions') && (await page.locator(TID('vader-switch-done')).innerText()).includes('Cursor: theme and keybindings, extensions list'));
	await page.locator('[data-editor="Cursor"]').click();
	await page.waitForSelector(TID('vader-switch-found'));
	await page.locator(TID('vader-switch-notnow')).click();
	check('Not now changes nothing', (await page.locator(TID('vader-switch-found')).count()) === 0 && (await log(page)).filter(l => l.startsWith('transfer:')).length === 1);
	await page.locator('[data-editor="Trae"]').click();
	await page.waitForSelector(TID('vader-switch-failed'));
	check('an editor that is not there says so', (await page.locator(TID('vader-switch-failed')).innerText()).includes('Trae was not found on this computer'));
	// ---- the backup of everything, and its restore
	await page.locator(TID('vader-data-backup')).click();
	check('Back up says what is in it and what is not, before anything is saved', (await page.locator(TID('vader-data-backup-ask-title')).innerText()) === 'Back up your data' && (await page.locator(TID('vader-data-backup-ask-text')).innerText()).includes('Not included: API keys and the contents of your projects.'));
	await shot(page, 'data-backup-ask');
	await page.locator(TID('vader-data-backup-ask-no')).click();
	check('Cancel saves nothing', !downloads.some(d => /^vader-backup-/.test(d.suggestedFilename())));
	await page.locator(TID('vader-data-backup')).click();
	await page.locator(TID('vader-data-backup-ask-yes')).click();
	await page.waitForTimeout(800);
	const backupDownload = downloads.find((d) => /^vader-backup-\d{4}-\d{2}-\d{2}\.json$/.test(d.suggestedFilename()));
	const backupText = backupDownload ? fs.readFileSync(await backupDownload.path(), 'utf8') : '';
	check('Save file gives one file with the chats, the agents, the rules and the settings, and no key', !!backupDownload && JSON.parse(backupText).format === 'vader-backup' && Object.keys(JSON.parse(backupText).chats).length === 3 && !backupText.includes('sk-test-'), backupText.slice(0, 120));
	check('and says what was saved', (await page.locator(TID('vader-data-message')).innerText()).includes('Saved vader-backup-'));
	const theirs = { format: 'vader-backup', version: 1, createdAt: '2026-10-01T00:00:00Z', chats: { t1: { id: 't1', messages: [] }, n1: { id: 'n1', messages: [] }, n2: { id: 'n2', messages: [] } }, agents: [{ name: 'Brand new agent', description: 'd', instructions: 'i' }], rules: [{ description: 'asks before installs', effect: 'ask', kinds: ['terminal-command'] }], settings: {} };
	await page.locator(TID('vader-data-backup-file')).setInputFiles({ name: 'vader-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(theirs)) });
	await page.waitForSelector(TID('vader-data-restore-ask'));
	check('Restore says what will be added and what stays as it is, before it does anything', (await page.locator(TID('vader-data-restore-ask-title')).innerText()) === 'Restore from vader-backup.json?' && (await page.locator(TID('vader-data-restore-ask-text')).innerText()).startsWith('2 chats, 1 saved agent and 1 rule will be added. 1 chat that is already here is kept as it is.') && !(await log(page)).includes('chats:import:5'));
	await shot(page, 'data-restore-ask');
	await page.locator(TID('vader-data-restore-ask-yes')).click();
	check('Restore adds the chats, the agent and the rule, and keeps the chat that was already here', (await log(page)).includes('chats:import:5') && (await log(page)).includes('agent:create:Brand new agent') && (await log(page)).some(l => l.startsWith('addrule:ask:terminal-command:asks before installs')));
	check('and says what it did', (await page.locator(TID('vader-data-message')).innerText()).includes('Restored 2 chats, 1 saved agent and 1 rule.'));
	await page.locator(TID('vader-data-backup-file')).setInputFiles({ name: 'other.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
	await page.waitForFunction(() => /other\.json was not restored/.test(document.querySelector('[data-testid="vader-data-message"]')?.textContent ?? ''));
	check('a file that is not a backup is refused with the reason, and nothing is asked', (await page.locator(TID('vader-data-message')).innerText()).includes('It is not a Vader backup.') && (await page.locator(TID('vader-data-restore-ask')).count()) === 0);
	await page.locator(TID('vader-data-delete-chats')).click();
	check('deleting chats asks first, says how many, that it cannot be undone and what stays, and deletes nothing yet', !(await log(page)).includes('chats:reset') && (await page.locator(TID('vader-data-delete-ask-title')).innerText()) === 'Delete all 3 chats?' && (await page.locator(TID('vader-data-delete-ask-text')).innerText()) === 'This cannot be undone. Saved agents, rules and settings stay.');
	await page.locator(TID('vader-data-delete-ask-no')).click();
	check('Cancel deletes nothing', !(await log(page)).includes('chats:reset') && (await page.locator(TID('vader-data-delete-ask')).count()) === 0);
	await page.locator(TID('vader-data-delete-chats')).click();
	await page.locator(TID('vader-data-delete-ask-yes')).click();
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

// ===================================================================== Models
{
	const { page, errors } = await newPage(undefined, 'models');
	check('the chat model is the one that is set', (await page.locator(TID('vader-models-chat')).inputValue()) === 'anthropic/claude-sonnet-4-5');
	check('suggestions are Off until a model is chosen for them', (await page.locator(TID('vader-models-autocomplete')).inputValue()) === '');
	await page.locator(TID('vader-models-autocomplete')).selectOption('mistral/codestral-latest');
	check('choosing a model for suggestions sets it and turns them on', (await log(page)).includes('select:Autocomplete=codestral-latest') && (await log(page)).includes('global:enableAutocomplete=true'));
	check('applying edits follows the chat unless another model is chosen', (await page.locator(TID('vader-models-apply')).inputValue()) === '');
	await page.locator(TID('vader-models-apply')).selectOption('openAI/gpt-5');
	check('choosing a model for applying sets it and stops following the chat', (await log(page)).includes('select:Apply=gpt-5') && (await log(page)).includes('global:syncApplyToChat=false'));
	await page.locator(TID('vader-models-apply')).selectOption('');
	check('and Same as chat brings the switch back', (await log(page)).includes('global:syncApplyToChat=true'));

	const local = page.locator(`${TID('vader-provider-row')}[data-provider=ollama]`);
	check('Ollama is Running and says how many models and where', (await local.innerText()).includes('3 models, localhost:11434') && (await local.innerText()).includes('Running'));
	const lm = page.locator(`${TID('vader-provider-row')}[data-provider=lmStudio]`);
	check('a local server that is not found says where it looked and what to do', (await lm.innerText()).includes('Not found on localhost:1234') && (await lm.innerText()).includes('Not running'));
	await lm.locator(TID('vader-provider-look')).click();
	check('Look again asks the app to look again', (await log(page)).includes('look:lmStudio'));
	check('vLLM with no address says it is not set up', (await page.locator(`${TID('vader-provider-row')}[data-provider=vLLM]`).innerText()).includes('Not set up'));
	await page.locator(TID('vader-models-auto-local')).click();
	check('the automatic look for local models is its own switch', (await log(page)).includes('global:autoRefreshModels=false'));

	const rows = await page.locator(`${TID('vader-provider-row')}[data-has-key]`).evaluateAll(e => e.map(x => x.getAttribute('data-provider') + ':' + x.getAttribute('data-has-key')));
	check('cloud providers with a key come first, then the usual ones to add a key to', rows.slice(0, 6).join('|') === 'openRouter:true|anthropic:true|openAI:false|gemini:false|groq:false|mistral:false', rows.join('|'));
	check('a provider with a key says how many models and which key', (await page.locator(`${TID('vader-provider-row')}[data-provider=openRouter] ${TID('vader-provider-summary')}`).innerText()) === '4 models, key ending uter', await page.locator(`${TID('vader-provider-row')}[data-provider=openRouter] ${TID('vader-provider-summary')}`).innerText());
	check('one without a key says so and offers to add one', (await page.locator(`${TID('vader-provider-row')}[data-provider=openAI] ${TID('vader-provider-summary')}`).innerText()) === 'No key yet' && (await page.locator(`${TID('vader-provider-row')}[data-provider=openAI] ${TID('vader-provider-add-key')}`).count()) === 1);
	check('the rest are one line, and Show all opens the whole list', (await page.locator(TID('vader-models-show-all')).count()) === 1);

	const or = page.locator(`${TID('vader-provider-row')}[data-provider=openRouter]`);
	await or.locator(TID('vader-provider-toggle')).click();
	check('opening a provider shows its key masked, with Replace', /^sk-te•+uter$/.test(await or.locator(TID('vader-provider-apiKey-masked')).innerText()) && (await or.locator(TID('vader-provider-apiKey-replace')).count()) === 1);
	check('the picker count says how many models are shown', (await or.locator(TID('vader-provider-picker-count')).innerText()) === 'Shown in the picker: 3 of 4');
	await or.locator(TID('vader-provider-test')).click();
	await or.locator('[data-status=ok]').waitFor();
	check('Test connection asks the provider and says how many models and how long', /^Works: 312 models, \d+ ms$/.test(flat(await or.locator(TID('vader-provider-status')).innerText()).replace(/^✓\s*/, '')), await or.locator(TID('vader-provider-status')).innerText());
	check('every model has its own switch and its context size', (await or.locator(`${TID('vader-provider-model')}[data-model="openai/gpt-5"] .vader-mo`).count()) >= 1);
	await or.locator(`${TID('vader-provider-model')}[data-model="openai/gpt-5"] ${TID('vader-provider-model-switch')}`).click();
	check('a switch hides the model from the picker', (await log(page)).includes('togglemodel:openRouter:openai/gpt-5') && (await or.locator(TID('vader-provider-picker-count')).innerText()) === 'Shown in the picker: 2 of 4');
	await or.locator(TID('vader-provider-add-open')).click();
	await or.locator(TID('vader-provider-add-input')).fill('openai/gpt-5');
	await or.locator(TID('vader-provider-add')).click();
	check('adding a model that is already there is refused', (await or.locator(TID('vader-provider-add-problem')).innerText()).includes('already in the list'));
	await or.locator(TID('vader-provider-add-input')).fill('mistralai/devstral');
	await or.locator(TID('vader-provider-add')).click();
	check('a new model is added by name and can be deleted', (await log(page)).includes('addmodel:openRouter:mistralai/devstral') && (await or.locator(`${TID('vader-provider-model')}[data-model="mistralai/devstral"] ${TID('vader-provider-model-delete')}`).count()) === 1);
	await or.locator(`${TID('vader-provider-model')}[data-model="mistralai/devstral"] ${TID('vader-provider-model-delete')}`).click();
	check('deleting a model written by hand removes it', (await log(page)).includes('deletemodel:openRouter:mistralai/devstral'));
	await or.locator(`${TID('vader-provider-model')}[data-model="openai/gpt-5"] ${TID('vader-provider-model-defaults')}`).click();
	check('Defaults opens what Vader assumes about the model', (await page.locator(TID('vader-overrides-dialog')).count()) === 1);
	await page.locator(TID('vader-overrides-switch')).click();
	await page.locator(TID('vader-overrides-text')).fill('{ not json');
	await page.locator(TID('vader-overrides-save')).click();
	check('JSON that does not parse is refused with a reason', (await page.locator(TID('vader-overrides-problem')).innerText()).includes('not valid JSON'));
	await page.locator(TID('vader-overrides-text')).fill('{ "contextWindow": 8000, "bogus": 1 }');
	await page.locator(TID('vader-overrides-save')).click();
	check('a good override keeps only the keys Vader reads', (await log(page)).includes('overrides:openRouter:openai/gpt-5:{"contextWindow":8000}') && (await page.locator(TID('vader-overrides-dialog')).count()) === 0, (await log(page)).filter(x => x.startsWith('overrides')).join(','));

	const oa = page.locator(`${TID('vader-provider-row')}[data-provider=openAI]`);
	await oa.locator(TID('vader-provider-add-key')).click();
	await oa.locator(TID('vader-provider-apiKey')).pressSequentially('sk-proj-abcdef');
	check('typing a key one character at a time keeps the field a field, and writes the whole key for that provider', (await log(page)).some(x => x === 'provider:openAI.apiKey=sk-proj-abcdef'), (await log(page)).filter(x => x.startsWith('provider:openAI')).join(','));
	await oa.locator(TID('vader-provider-body')).click({ position: { x: 4, y: 4 } });
	check('a saved key is shown masked with Replace and Remove, and the page says where it is kept', (await oa.locator(TID('vader-provider-apiKey-masked')).count()) === 1 && (await oa.locator(TID('vader-provider-apiKey-remove')).count()) === 1 && (await oa.locator(TID('vader-provider-key-note')).innerText()).includes('the provider keeps its own copy'));
	await oa.locator(TID('vader-provider-test')).click();
	await oa.locator('[data-status=error]').waitFor();
	check('a provider that cannot be reached says so, and nothing is made up', (await oa.locator(TID('vader-provider-status')).innerText()).includes('Could not reach the provider'));

	await page.locator(TID('vader-models-search')).fill('groq');
	check('searching keeps only the providers that match', (await page.locator(`${TID('vader-provider-row')}[data-has-key]`).count()) === 1);
	await page.locator(TID('vader-models-search')).fill('zzzzq');
	check('a search with no match says how to add any other service', (await page.locator(TID('vader-models-nomatch')).innerText()).includes('OpenAI-Compatible'));
	await page.locator(TID('vader-models-search')).fill('');
	await page.locator(TID('vader-models-show-all')).click();
	check('Show all lists every cloud provider', (await page.locator(`${TID('vader-provider-row')}[data-has-key]`).count()) > 30);
	await shot(page, '07-models');
	check('no layout problem and no error', (await layoutProblems(page)).length === 0 && errors.length === 0, (await layoutProblems(page)).concat(errors).join('; '));
	await page.close();
}

// ===================================================================== Connected agents
{
	const { page, errors } = await newPage(undefined, 'agents');
	const state = (id) => page.locator(`${TID(`vader-external-agent-${id}`)} ${TID(`vader-external-agent-${id}-state`)}`).innerText();
	check('an agent that is signed in says so, with its version', (await state('codex')).includes('Signed in') && (await page.locator(TID('vader-external-agent-codex')).innerText()).includes('2.2.2'));
	check('one that is found but not signed in says so', (await state('opencode')).includes('Not signed in'));
	check('one that is not installed says so, and one that needs Node.js says that', (await state('cursor')) === 'Not installed' && (await state('copilot')) === 'Needs Node.js');
	check('the agents are in two groups: in the chat, and in a terminal', (await page.locator(TID('vader-settings-external-agents')).innerText()).includes('In a terminal') && (await page.locator(TID('vader-external-agent-claude-code')).count()) === 1);
	await page.locator(TID('vader-external-agent-cursor-install')).click();
	check('Install asks the app to install it (which shows the exact steps first)', (await log(page)).includes('agent:install:cursor'));
	await page.locator(TID('vader-external-agent-opencode-connect')).click();
	check('Connect starts the vendor’s own sign-in', (await log(page)).includes('agent:connect:opencode'));
	check('an agent that needs Node.js has no Install button to press in vain', (await page.locator(TID('vader-external-agent-copilot-install')).count()) === 0);
	await page.locator(TID('vader-external-agent-codex-update')).click();
	check('a newer version is offered by number', (await log(page)).includes('agent:install:codex'));
	await page.locator(TID('vader-external-agent-codex-use')).click();
	check('Use sets it as the agent of the chat', (await log(page)).includes('global:externalAgentId="codex"'));
	await page.evaluate(() => { });
	await page.locator(TID('vader-external-agent-codex-more')).click();
	await page.locator(TID('vader-external-agent-codex-test')).click();
	await page.waitForSelector(TID('vader-external-agent-codex-probe'));
	check('Test connection says what answered and how long it took', (await page.locator(TID('vader-external-agent-codex-probe')).innerText()).includes('Works: Codex 2.2.2 answered in 0.8 s'));
	check('an agent Vader installed can be removed, and one found here cannot', (await page.locator(TID('vader-external-agent-codex-remove')).count()) === 1);
	await page.locator(TID('vader-external-agents-check')).click();
	check('Check for newer versions asks the registry', (await log(page)).includes('agents:check'));
	const custom = page.locator(TID('vader-external-agent-custom'));
	check('adding an agent of your own needs a name and a program', await custom.locator(TID('vader-external-agent-custom-add')).isDisabled());
	await custom.locator('input[placeholder="Name"]').fill('My agent');
	await custom.locator('input[placeholder^="Program"]').fill('my-agent');
	await custom.locator('input[placeholder^="Arguments"]').fill('--acp --quiet');
	await custom.locator(TID('vader-external-agent-custom-add')).click();
	check('it is handed to the app with its program and arguments split', (await log(page)).includes('agent:add:My agent:my-agent:--acp --quiet'));
	check('the page says it runs with your rights, so add only programs you trust', (await custom.innerText()).includes('runs with your user'));
	await shot(page, '08-connected-agents');
	check('no layout problem and no error', (await layoutProblems(page)).length === 0 && errors.length === 0, (await layoutProblems(page)).concat(errors).join('; '));
	await page.close();
}

// ===================================================================== MCP servers
{
	const { page, errors } = await newPage(undefined, 'mcp');
	const rows = (await page.locator(TID('vader-mcp-server')).evaluateAll(e => e.map(x => x.getAttribute('data-server') + ':' + x.getAttribute('data-status'))));
	check('every server is listed with the state the service reports', rows.join('|') === 'GitHub:success|Linear:success|acme-internal:error', rows.join('|'));
	check('a running server says how many tools it offers', (await page.locator(`${TID('vader-mcp-server')}[data-server=GitHub]`).innerText()).includes('2 tools') && (await page.locator(`${TID('vader-mcp-server')}[data-server=GitHub]`).innerText()).includes('Running'));
	check('a server that failed shows the real error', (await page.locator(`${TID('vader-mcp-server')}[data-server=acme-internal] ${TID('vader-mcp-server-error')}`).innerText()).includes('spawn ENOENT'));
	check('and says in words what is wrong and what to do, as the board does', (await page.locator(TID('vader-mcp-failed-title')).innerText()) === 'acme-internal did not start' && (await page.locator(TID('vader-mcp-failed-text')).innerText()) === '`node` was not found. Install Node.js, or give the full path to it.');
	await page.locator(TID('vader-mcp-edit')).click();
	check('Edit the command opens the config file', (await log(page)).includes('mcp:reveal'));
	await page.locator(TID('vader-mcp-retry')).click();
	await page.waitForFunction(() => window.__log.includes('mcp:toggle:acme-internal=true'));
	check('Try again switches the server off and on again', (await log(page)).indexOf('mcp:toggle:acme-internal=false') >= 0 && (await log(page)).indexOf('mcp:toggle:acme-internal=false') < (await log(page)).indexOf('mcp:toggle:acme-internal=true'));
	await shot(page, 'mcp-failed');
	check('the switch follows what is on', (await page.locator(`${TID('vader-mcp-server')}[data-server=GitHub] ${TID('vader-mcp-switch')}[aria-checked=true]`).count()) === 1 && (await page.locator(`${TID('vader-mcp-server')}[data-server=Linear] ${TID('vader-mcp-switch')}[aria-checked=false]`).count()) === 1);
	await page.locator(`${TID('vader-mcp-server')}[data-server=Linear] ${TID('vader-mcp-switch')}`).click();
	check('a switch turns the server on in the service', (await log(page)).includes('mcp:toggle:Linear=true'));
	await page.locator(`${TID('vader-mcp-server')}[data-server=GitHub] ${TID('vader-mcp-expand')}`).click();
	check('opening a server shows its tools by their own names', (await page.locator(TID('vader-mcp-tools')).innerText()).includes('create_issue') && (await page.locator(TID('vader-mcp-tools')).innerText()).includes('list_prs'));
	await page.locator(TID('vader-mcp-add')).click();
	check('Add by hand opens the config file', (await log(page)).includes('mcp:reveal'));
	await page.locator(TID('vader-mcp-find')).click();
	check('Find servers opens Add-ons', (await log(page)).some(x => /^command:.*Addons|^command:.*addons/i.test(x)), (await log(page)).join(','));
	await shot(page, '09-mcp');
	check('no layout problem and no error', (await layoutProblems(page)).length === 0 && errors.length === 0, (await layoutProblems(page)).concat(errors).join('; '));
	await page.close();
}
{
	const { page } = await newPage(() => { window.__mcpOverride = { state: { mcpServerOfName: {} } }; }, 'mcp');
	check('with no server it says so and where servers come from', (await page.locator(TID('vader-mcp-empty')).innerText()).includes('No server is set up') && (await page.locator(TID('vader-mcp-empty')).innerText()).includes('trust score'));
	await page.close();
}

// ===================================================================== Memory and instructions
{
	const { page, errors } = await newPage(undefined, 'memory');
	await page.waitForFunction(() => document.querySelectorAll('[data-testid="vader-memory-layer"]').length >= 3);
	const layers = (await page.locator(TID('vader-memory-layer')).allInnerTexts()).map(flat);
	check('the instructions are listed in order: yours first, then the rules files found in the project', layers[0].includes('Your instructions for every project') && layers[0].includes('Empty') && layers[1].includes('.vaderrules') && layers[1].includes('Found in vader-app, 480 B') && layers[2].includes('AGENTS.md') && layers[2].includes('1.2 KB'), layers.join(' | '));
	check('a rules file that is not there is not listed', !layers.some(l => l.includes('CLAUDE.md')));
	await page.locator(TID('vader-memory-text')).fill('Reply in the language I write in.');
	await page.locator(TID('vader-memory-save')).click();
	check('Save writes the instructions and says when they apply', (await log(page)).includes('global:aiInstructions="Reply in the language I write in."') && (await page.locator(TID('vader-memory-saved')).innerText()).includes('next message'));
	await page.locator(TID('vader-memory-layer-action')).nth(1).click();
	const l = await log(page);
	check('Open on a rules file leaves Settings, goes to the editor and opens that file', l.some(x => /^command:.*Settings/i.test(x)) && l.includes('shell:editor') && l.some(x => x.startsWith('command:vscode.open')), l.join(','));
	await page.locator(TID('vader-memory-disable-system')).click();
	check('sending only your instructions is its own switch, with an honest note', (await log(page)).includes('global:disableSystemMessage=true') && (await page.locator(TID('vader-settings-memory')).innerText()).includes('safety rules that block dangerous actions still apply'));
	check('the project memory is listed with counts on the tabs', (await page.locator(TID('vader-memory-record')).count()) === 2 && (await page.locator(TID('vader-memory-tab-project')).innerText()).includes('2') && (await page.locator(TID('vader-memory-tab-agent')).innerText()).includes('1'));
	await page.locator(TID('vader-memory-remove')).first().click();
	check('Remove deletes one record', (await log(page)).includes('memory:remove:m1') && (await page.locator(TID('vader-memory-record')).count()) === 1);
	await page.locator(TID('vader-memory-tab-agent')).click();
	check('a saved agent’s memory is under its own tab, with the agent named', (await page.locator(TID('vader-memory-record')).innerText()).includes('Reviewer prefers short reports') && (await page.locator(TID('vader-memory-record')).innerText()).includes('Reviewer'));
	await page.locator(TID('vader-memory-tab-project')).click();
	await page.locator(TID('vader-memory-clear')).click();
	check('Clear project memory clears that scope, and the page then says it is empty', (await log(page)).includes('memory:clear:project') && (await page.locator(TID('vader-memory-empty')).count()) === 1);
	await shot(page, '10-memory');
	check('no layout problem and no error', (await layoutProblems(page)).length === 0 && errors.length === 0, (await layoutProblems(page)).concat(errors).join('; '));
	await page.close();
}
{
	const { page } = await newPage(() => { window.__workspaceFolders = []; }, 'memory');
	await page.waitForSelector(TID('vader-memory-layer'));
	check('with no folder open it says to open one', (await page.locator(TID('vader-settings-memory')).innerText()).includes('Open a folder first.'));
	await page.close();
}

// ===================================================================== Skills
{
	const { page, errors } = await newPage(undefined, 'skills');
	const rows = await page.locator(TID('vader-skills-row')).evaluateAll(e => e.map(x => x.getAttribute('data-skill') + ':' + x.getAttribute('data-trust')));
	check('the installed skills are listed with their trust decision', rows.join('|') === 'frontend-design:trusted|log-triage:review_required|old-deploy-helper:blocked', rows.join('|'));
	const trust = (n) => page.locator(`${TID('vader-skills-row')}[data-skill="${n}"] ${TID('vader-skills-trust')}`).innerText();
	check('trust says its word and a computed number, and a blocked skill has no number', /^Trusted \d+%$/.test(await trust('frontend-design')) && /^Needs review \d+%$/.test(await trust('log-triage')) && (await trust('old-deploy-helper')).trim() === 'Blocked', `${await trust('frontend-design')} | ${await trust('log-triage')} | ${await trust('old-deploy-helper')}`);
	check('what a skill asks for is read from its text', (await page.locator(`${TID('vader-skills-row')}[data-skill="log-triage"]`).innerText()).includes('Files, Terminal, Network') && (await page.locator(`${TID('vader-skills-row')}[data-skill="frontend-design"]`).innerText()).includes('Nothing special'));
	await page.locator(`${TID('vader-skills-row')}[data-skill="log-triage"] ${TID('vader-skills-switch')}`).click();
	check('the switch turns a skill on', (await log(page)).includes('skill:enabled:s2=true'));
	await page.locator(`${TID('vader-skills-row')}[data-skill="old-deploy-helper"] ${TID('vader-skills-switch')}`).click();
	check('a blocked skill cannot be switched on', !(await log(page)).includes('skill:enabled:s3=true'));
	await page.locator(`${TID('vader-skills-row')}[data-skill="log-triage"] ${TID('vader-skills-read')}`).click();
	const detail = page.locator(TID('vader-skills-detail'));
	check('Read shows the reasons for the number and the words the agent reads', (await detail.locator(TID('vader-skills-factor')).count()) >= 1 && (await detail.locator(TID('vader-skills-text')).innerText()).includes('tail -n 200'));
	await detail.locator(TID('vader-skills-trust-it')).click();
	check('Mark trusted is the person’s own decision, written to the skill', (await log(page)).includes('skill:trust:s2=trusted'));
	await detail.locator(TID('vader-skills-block')).click();
	check('Block blocks it, and Unblock puts it back to needing review', (await log(page)).includes('skill:trust:s2=blocked') && (await detail.locator(TID('vader-skills-unblock')).count()) === 1);
	await detail.locator(TID('vader-skills-pin')).click();
	check('Pin is its own button', (await log(page)).includes('skill:pin:s2=true'));
	await detail.locator(TID('vader-skills-remove')).click();
	check('Remove removes it', (await log(page)).includes('skill:remove:s2') && (await page.locator(TID('vader-skills-row')).count()) === 2);
	await page.locator(TID('vader-skills-filter')).fill('zzzz');
	check('a filter with no match says so', (await page.locator(TID('vader-skills-nomatch')).count()) === 1);
	await page.locator(TID('vader-skills-filter')).fill('front');
	check('and one that matches keeps that skill', (await page.locator(TID('vader-skills-row')).count()) === 1);
	await page.locator(TID('vader-skills-tab-sources')).click();
	check('Sources lists where Add-ons looks and the repositories of skills', (await page.locator(TID('vader-skills-source')).count()) >= 1 && (await page.locator(TID('vader-skills-repo')).count()) === 2);
	await page.locator(TID('vader-skills-repo-input')).fill('not a repo');
	await page.locator(TID('vader-skills-repo-add')).click();
	check('something that is not a GitHub repository is refused and says how to write one', (await page.locator(TID('vader-skills-repo-problem')).innerText()).includes('owner/repo'));
	await page.locator(TID('vader-skills-repo-input')).fill('acme/skills');
	await page.locator(TID('vader-skills-repo-add')).click();
	check('a repository is added', (await log(page)).includes('skill:source:add:acme/skills') && (await page.locator(TID('vader-skills-repo')).count()) === 3);
	await page.locator(TID('vader-skills-repo-remove')).first().click();
	check('and removed', (await log(page)).some(x => x.startsWith('skill:source:remove:')));
	await shot(page, '11-skills');
	check('no layout problem and no error', (await layoutProblems(page)).length === 0 && errors.length === 0, (await layoutProblems(page)).concat(errors).join('; '));
	await page.close();
}
{
	const { page } = await newPage(() => { window.__skillsOverride = []; }, 'skills');
	check('with no skill it says what a skill is and where to find some', (await page.locator(TID('vader-skills-empty')).innerText()).includes('No skill is installed') && (await page.locator(TID('vader-skills-empty')).innerText()).includes('Add-ons'));
	await page.close();
}

// every page, once, at the size of the boards (1440 by 900), for the side-by-side look against them (named qa-<page>)
{
	const { page } = await newPage();
	await page.setViewportSize({ width: 1440, height: 900 });
	for (const id of ['models', 'router', 'agents', 'permissions', 'usage', 'saved', 'skills', 'mcp', 'memory', 'extensions', 'editor', 'privacy', 'data', 'about']) {
		await page.locator(TID(`vader-settings-nav-${id}`)).click();
		await page.waitForTimeout(320);
		await shot(page, `qa-${id}`);
	}
	await page.close();
}

await browser.close();
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed\nscreenshots: ${shots}`);
process.exit(failed ? 1 : 0);
