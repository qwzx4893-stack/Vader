#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The first run used the way a new person uses it, in a headless browser (no window opens): the page as it is built for the app (react/src2), with the
// provider, the computer and the folder answered by the test.
// Checked: the three steps, a key that works / is refused (401) / cannot be reached, a local model found or not, the folder and the permission cards, the
// first task (needs a model, starts the task, the person's own), Skip at every step, the step is remembered, and that nothing is cut off.
// Run: node src/vs/workbench/contrib/vader/test/onboardingUiE2E.mjs

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
if (!fs.existsSync(path.join(src2, 'vader-onboarding/VaderOnboarding.tsx'))) { console.log('FAIL: run `npm run buildreact` first (react/src2 is built from react/src)'); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(repo, 'node_modules', '.vader-onboarding-ui-'));
const shots = path.join(os.tmpdir(), 'onboarding-ui-shots');
fs.mkdirSync(shots, { recursive: true });

const plugin = {
	name: 'harness',
	setup(build) {
		build.onResolve({ filter: /.*/ }, (args) => {
			if (!args.path.startsWith('.')) return null;
			const full = path.resolve(args.resolveDir, args.path).replace(/\\/g, '/');
			if (/\/util\/services\.js$/.test(full)) return { path: path.join(here, 'fixtures/onboardingHarnessServices.ts') };
			if (/\/sidebar-tsx\/ErrorBoundary\.js$/.test(full)) return { path: path.join(here, 'fixtures/onboardingStubs.tsx') };
			return null;
		});
	},
};
await esbuild.build({
	entryPoints: [path.join(here, 'fixtures/onboardingHarness.tsx')], bundle: true, platform: 'browser', format: 'iife', outfile: path.join(tmp, 'page.js'), logLevel: 'error',
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

/** `setup` runs in the page before the first run is drawn: what the provider answers, what is found, the open folder, the step remembered */
async function newPage(setup) {
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
	if (setup) await page.addInitScript(setup);
	await page.goto(base);
	await page.waitForFunction(() => window.__mounted === true);
	return { page, errors };
}
const shot = async (page, name) => { await auditShot(page, name); await page.screenshot({ path: path.join(shots, name + '.png') }); };
const log = (page) => page.evaluate(() => window.__log.slice());
async function layoutProblems(page) {
	return page.evaluate(() => {
		const out = [];
		const root = document.querySelector('[data-testid="vader-onboarding"]');
		if (!root) return ['no first run'];
		if (root.scrollWidth > root.clientWidth + 1) out.push(`wider than itself: ${root.scrollWidth} > ${root.clientWidth}`);
		for (const b of root.querySelectorAll('button')) {
			const r = b.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			if (r.right > root.clientWidth + 1 || r.bottom > root.clientHeight + 1) out.push(`button outside: ${(b.innerText || '').slice(0, 30)}`);
		}
		for (const b of root.querySelectorAll('button.vader-pb, button.vader-gb')) { if (b.getBoundingClientRect().height > 40) out.push(`button label wraps: ${(b.innerText || '').slice(0, 30)}`); }
		return out;
	});
}

// ===================================================================== step 1: a key that works
{
	const { page, errors } = await newPage(() => { window.__answers = { openRouter: { status: 'ok', count: 312 } }; });
	check('it opens on the models step, with three ways to get a model', (await page.locator(TID('vader-onboarding-step1')).count()) === 1 && (await page.locator('[data-testid^="vader-onboarding-choice-"]').count()) === 3);
	check('the steps are named and the first is current', flat(await page.locator(TID('vader-onboarding-steps')).innerText()) === '1 Models 2 Project 3 First task' && (await page.locator(`${TID('vader-onboarding-steps')} [aria-current=step]`).innerText()).includes('Models'));
	check('the first way is chosen: a model with a key', (await page.locator(TID('vader-onboarding-key')).count()) === 1);
	check('there is no slogan on the welcome (the owner asked for none)', !/(the future|supercharge|reimagin|the best|revolution)/i.test(await page.locator(TID('vader-onboarding')).innerText()));
	check('Test and continue is off until a key is typed', await page.locator(TID('vader-onboarding-test')).isDisabled());
	await page.locator(TID('vader-onboarding-key')).fill('sk-or-abc');
	await page.locator(TID('vader-onboarding-test')).click();
	await page.waitForSelector(TID('vader-onboarding-testing'), { timeout: 3000 });
	check('while it asks the provider the page says so', (await page.locator(TID('vader-onboarding-testing')).innerText()).includes('Asking OpenRouter for its models'));
	await page.waitForSelector(TID('vader-onboarding-works'));
	check('a working key says how many models were found', (await page.locator(TID('vader-onboarding-works')).innerText()).includes('312 models found'));
	const l = await log(page);
	check('the key was saved for that provider and its models were asked for', l.includes('provider:openRouter.apiKey=sk-or-abc') && l.includes('refresh:openRouter'), l.join(','));
	await shot(page, '01-models-works');
	await page.locator(TID('vader-onboarding-key-continue')).click();
	await page.waitForSelector(TID('vader-onboarding-step2'));
	const l2 = await log(page);
	check('continuing picks the provider\'s first model for the chat and moves to the project step', l2.includes('select:Chat=openRouter/openRouter-model-0') && l2.includes('store:vader.onboardingStep=2'), l2.join(','));
	check('no layout problem and no error', (await layoutProblems(page)).length === 0 && errors.length === 0, (await layoutProblems(page)).concat(errors).join('; '));
	await page.close();
}

// ===================================================================== step 1: refused, then unreachable
{
	const { page, errors } = await newPage(() => { window.__answers = { openRouter: { status: 'error', reason: 'unauthorized', message: 'HTTP 401' } }; });
	await page.locator(TID('vader-onboarding-key')).fill('sk-or-bad ');
	await page.locator(TID('vader-onboarding-test')).click();
	await page.waitForSelector(TID('vader-onboarding-failed'));
	const f = page.locator(TID('vader-onboarding-failed'));
	check('a refused key says the provider answered 401 and what to look at', (await f.getAttribute('data-reason')) === 'unauthorized' && (await f.innerText()).includes('OpenRouter answered 401') && (await f.innerText()).includes('space at the end'));
	check('a refused key cannot be continued with', (await page.locator(TID('vader-onboarding-key-continue')).count()) === 0);
	await shot(page, '02-models-401');
	await page.evaluate(() => { window.__answers.openRouter = { status: 'error', reason: 'network', message: 'fetch failed' }; });
	await page.locator(TID('vader-onboarding-test-again')).click();
	await page.waitForFunction(() => document.querySelector('[data-testid="vader-onboarding-failed"]')?.getAttribute('data-reason') === 'network');
	check('when the provider cannot be reached it says nothing was sent and offers a local model', (await f.innerText()).includes('Could not reach OpenRouter') && (await f.innerText()).includes('Nothing was sent') && (await f.getByText('Use a local model').count()) === 1);
	await f.getByText('Use a local model').click();
	check('"Use a local model" switches to that choice', (await page.locator(TID('vader-onboarding-local-none')).count()) === 1);
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}

// ===================================================================== step 1: a model on this computer
{
	const { page } = await newPage(() => { window.__localAfterLook = { ollama: ['qwen2.5-coder:7b', 'llama3.1:8b'] }; });
	await page.locator(TID('vader-onboarding-choice-local')).click();
	await page.waitForSelector(TID('vader-onboarding-local-found'));
	check('opening this choice looks for Ollama and LM Studio by itself', ((await log(page)).filter(x => x.startsWith('look:')).length) >= 2);
	const t = await page.locator(TID('vader-onboarding-local-found')).innerText();
	check('what is found is listed with its port and models', t.includes('localhost:11434') && t.includes('qwen2.5-coder:7b') && t.includes('llama3.1:8b'), t);
	await page.locator(TID('vader-onboarding-local-use')).click();
	await page.waitForSelector(TID('vader-onboarding-step2'));
	check('using it selects its first model for the chat', (await log(page)).includes('select:Chat=ollama/qwen2.5-coder:7b'));
	await page.close();
}
{
	const { page } = await newPage();
	await page.locator(TID('vader-onboarding-choice-local')).click();
	await page.waitForSelector(TID('vader-onboarding-local-none'));
	check('when nothing is found it says where it looked', (await page.locator(TID('vader-onboarding-local-none')).innerText()).includes('11434') && (await page.locator(TID('vader-onboarding-local-none')).innerText()).includes('1234'));
	const before = (await log(page)).filter(x => x.startsWith('look:')).length;
	await page.locator(TID('vader-onboarding-local-again')).click();
	check('"Look again" asks again', (await log(page)).filter(x => x.startsWith('look:')).length > before);
	await shot(page, '03-models-local-none');
	await page.close();
}
// ===================================================================== step 1: a connected agent
{
	const { page } = await newPage(() => { window.__agents = { statuses: { codex: { id: 'codex', state: 'ready' } } }; });
	await page.locator(TID('vader-onboarding-choice-agent')).click();
	const t = await page.locator(TID('vader-onboarding-agent-panel')).innerText();
	check('an agent that can be started is offered', t.includes('codex'));
	await page.locator(`${TID('vader-onboarding-agent-panel')} button`, { hasText: 'Use it' }).click();
	await page.waitForSelector(TID('vader-onboarding-step2'));
	check('using it sets it as the connected agent', (await log(page)).includes('global:externalAgentId=codex'));
	await page.close();
}
{
	const { page } = await newPage();
	await page.locator(TID('vader-onboarding-choice-agent')).click();
	check('with no agent installed it says where to install one', (await page.locator(TID('vader-onboarding-agent-panel')).innerText()).includes('None is installed here yet'));
	await page.close();
}

// ===================================================================== step 2: the project and how much it asks
{
	const { page, errors } = await newPage(() => { window.__workspace = { folders: [{ name: 'vader-app', uri: { fsPath: 'C:\\work\\vader-app' } }] }; });
	await page.locator(TID('vader-welcome-continue')).click();
	await page.waitForSelector(TID('vader-onboarding-step2'));
	const p = await page.locator(TID('vader-onboarding-project')).innerText();
	check('the open folder is shown with its name and path', p.includes('vader-app') && p.includes('C:\\work\\vader-app'));
	check('the button says Change when a folder is open', (await page.locator(TID('vader-onboarding-change-folder')).innerText()) === 'Change');
	await page.locator(TID('vader-onboarding-change-folder')).click();
	check('Change opens the folder picker', (await log(page)).includes('command:workbench.action.files.openFolder'));
	check('three permission cards, Balanced is current and says Recommended', (await page.locator('[data-testid^="vader-onboarding-mode-"]').count()) === 3 && (await page.locator(`${TID('vader-onboarding-mode-balanced')}[aria-pressed=true]`).count()) === 1 && (await page.locator(TID('vader-onboarding-mode-balanced')).innerText()).includes('Recommended'));
	await page.locator(TID('vader-onboarding-mode-safe')).click();
	check('choosing Safe sets the real policy', (await log(page)).includes('policy:safe') && (await page.locator(`${TID('vader-onboarding-mode-safe')}[aria-pressed=true]`).count()) === 1);
	check('it says which rules hold in every mode', (await page.locator(TID('vader-onboarding-step2')).innerText()).includes('locked in every mode'));
	await page.locator(TID('vader-import-toggle')).click();
	check('Import settings lists the editors it can bring from', (await page.locator(`${TID('vader-import-editors')} button`).count()) === 7);
	await shot(page, '04-project');
	check('no layout problem and no error', (await layoutProblems(page)).length === 0 && errors.length === 0, (await layoutProblems(page)).concat(errors).join('; '));
	await page.locator(TID('vader-onboarding-back')).click();
	check('Back returns to the models step', (await page.locator(TID('vader-onboarding-step1')).count()) === 1);
	await page.close();
}
{
	const { page } = await newPage();
	await page.locator(TID('vader-welcome-continue')).click();
	const p = await page.locator(TID('vader-onboarding-project')).innerText();
	check('with no folder it says so, and offers to open one', p.includes('No folder is open') && (await page.locator(TID('vader-onboarding-change-folder')).innerText()) === 'Open a folder');
	check('with no folder it says honestly that this is a plain conversation', (await page.locator(TID('vader-onboarding-step2')).innerText()).includes('plain conversation'));
	await page.close();
}

// ===================================================================== the step is remembered (choosing a folder reloads the window)
{
	const { page } = await newPage(() => { window.__storageSeed = { 'vader.onboardingStep': '2' }; });
	check('after the window reloads it opens on the step it was on', (await page.locator(TID('vader-onboarding-step2')).count()) === 1 && (await page.locator(`${TID('vader-onboarding-steps')} [aria-current=step]`).innerText()).includes('Project'));
	await page.close();
}
{
	const { page } = await newPage();
	await page.locator(TID('vader-welcome-continue')).click();
	await page.locator(TID('vader-onboarding-continue')).click();
	await page.waitForSelector(TID('vader-onboarding-step3'));
	check('the step is stored each time it changes', (await log(page)).includes('store:vader.onboardingStep=3'));
	await page.close();
}

// ===================================================================== step 3: the first task
{
	const { page, errors } = await newPage();
	await page.locator(TID('vader-welcome-continue')).click();
	await page.locator(TID('vader-onboarding-continue')).click();
	check('four suggested tasks, each says what it may do', (await page.locator(TID('vader-onboarding-task')).count()) === 4 && (await page.locator(TID('vader-onboarding-task')).first().innerText()).includes('Read only'));
	await page.locator(TID('vader-onboarding-task')).first().click();
	await page.waitForSelector(TID('vader-onboarding-no-model'));
	check('with no model, a task does not start and the page says to choose one first', (await page.locator(TID('vader-onboarding-no-model')).innerText()).includes('Choose a model first') && !(await log(page)).some(x => x.startsWith('task:')));
	check('the first run stays open', !(await log(page)).includes('global:isOnboardingComplete=true'));
	await shot(page, '05-first-task-no-model');
	await page.locator(TID('vader-onboarding-no-model')).getByText('Add a key').click();
	check('"Add a key" goes back to the models step', (await page.locator(TID('vader-onboarding-step1')).count()) === 1);
	check('no layout problem and no error', (await layoutProblems(page)).length === 0 && errors.length === 0, (await layoutProblems(page)).concat(errors).join('; '));
	await page.close();
}
{
	const { page } = await newPage(() => { window.__answers = { openRouter: { status: 'ok', count: 3 } }; });
	await page.locator(TID('vader-onboarding-key')).fill('sk-or-abc');
	await page.locator(TID('vader-onboarding-test')).click();
	await page.waitForSelector(TID('vader-onboarding-key-continue'));
	await page.locator(TID('vader-onboarding-key-continue')).click();
	await page.locator(TID('vader-onboarding-continue')).click();
	await page.locator(TID('vader-onboarding-task')).nth(1).click();
	await page.waitForFunction(() => window.__log.some(x => x.startsWith('task:')));
	const l = await log(page);
	check('a suggested task opens a new conversation in the right mode and starts it', l.includes('global:chatMode=agent') && l.includes('new-thread') && l.some(x => x.startsWith('task:Run the tests of this project')), l.join(','));
	check('and the first run is finished and its step forgotten', l.includes('global:isOnboardingComplete=true') && l.includes('remove:vader.onboardingStep'));
	await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="vader-onboarding"]')).pointerEvents === 'none');
	check('the first run no longer takes clicks once finished', true);
	await page.close();
}
{
	const { page } = await newPage(() => { window.__answers = { openRouter: { status: 'ok', count: 3 } }; });
	await page.locator(TID('vader-onboarding-key')).fill('sk-or-abc');
	await page.locator(TID('vader-onboarding-test')).click();
	await page.waitForSelector(TID('vader-onboarding-key-continue'));
	await page.locator(TID('vader-onboarding-key-continue')).click();
	await page.locator(TID('vader-onboarding-continue')).click();
	check('Send is off until the person writes something', await page.locator(TID('vader-onboarding-own-send')).isDisabled());
	await page.locator(TID('vader-onboarding-own-task')).fill('Rename the config loader');
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => window.__log.some(x => x.startsWith('task:')));
	check('the person\'s own task starts as typed', (await log(page)).includes('task:Rename the config loader'));
	await shot(page, '06-first-task');
	await page.close();
}
{
	const { page } = await newPage();
	await page.locator(TID('vader-welcome-continue')).click();
	await page.locator(TID('vader-onboarding-continue')).click();
	await page.locator(TID('vader-import-done')).click();
	check('Skip, open Vader finishes the first run without a task', (await log(page)).includes('global:isOnboardingComplete=true') && !(await log(page)).some(x => x.startsWith('task:')));
	await page.close();
}

await browser.close();
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed\nscreenshots: ${shots}`);
process.exit(failed ? 1 : 0);
