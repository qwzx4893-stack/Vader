#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The model picker as the app builds it (react/src2), in a headless browser (no window opens): in each state the board S04 shows (the providers, a live list, a search
// that finds nothing, providers with no key, a list being asked for, a list that could not be fetched) and what a click does.
// Run: node src/vs/workbench/contrib/vader/test/pickerUiE2E.mjs        (screenshots go to the temp folder, named in the last line)

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
if (!fs.existsSync(path.join(here, '../browser/react/src2/vader-settings-tsx/ProviderModelPicker.tsx'))) { console.log('FAIL: run `npm run buildreact` first (react/src2 is built from react/src)'); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(repo, 'node_modules', '.vader-picker-ui-'));
const shots = path.join(os.tmpdir(), 'picker-ui-shots');
fs.mkdirSync(shots, { recursive: true });

await esbuild.build({
	entryPoints: [path.join(here, 'fixtures/pickerHarness.tsx')], bundle: true, platform: 'browser', format: 'iife', outfile: path.join(tmp, 'page.js'), logLevel: 'error',
	jsx: 'automatic', loader: { '.json': 'json', '.css': 'css', '.ttf': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' },
	tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false, jsx: 'react-jsx' } },
});
fs.writeFileSync(path.join(tmp, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="page.css"><style>
:root{--vscode-input-background:#1c1d1f;--vscode-badge-background:#4d4d4d;--vscode-sideBar-background:#18191a;--vscode-editor-background:#141516;--vscode-editor-foreground:#cccccc;--vscode-input-foreground:#cccccc;--vscode-input-placeholderForeground:#8b8d90}
html,body{margin:0;background:#0b0b0c;color:#e6e6e6;font:13px 'Segoe UI',system-ui,sans-serif}
.vader-scope{--vader-bg-1:#19191c;--vader-bg-1-alt:#202024;--vader-bg-2:#121214;--vader-bg-2-alt:#121214;--vader-bg-2-hover:#202024;--vader-bg-3:#0b0b0c;--vader-fg-0:#ffffff;--vader-fg-1:#ededee;--vader-fg-2:#b0b0b5;--vader-fg-3:#9a9aa1;--vader-fg-4:#878791;--vader-border-1:rgba(255,255,255,.22);--vader-border-2:rgba(255,255,255,.14);--vader-border-3:rgba(255,255,255,.075);--vader-border-4:rgba(255,255,255,.075)}</style></head><body><div id="root"></div><script src="page.js"></script></body></html>`);

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

async function show(props, size = { width: 520, height: 700 }) {
	const page = await browser.newPage({ viewport: size });
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
	await page.goto(base);
	await page.waitForFunction(() => window.__mounted === true);
	await page.evaluate((p) => window.__show(p), props);
	await page.waitForTimeout(150);
	return { page, errors };
}
const shot = async (page, name) => { await auditShot(page, name); await page.screenshot({ path: path.join(shots, name + '.png') }); };
const log = (page) => page.evaluate(() => window.__log.slice());
const open = async (page) => { await page.locator(TID('vader-picker-button')).click(); await page.waitForSelector(TID('vader-picker')); await page.waitForTimeout(250); };

const anthropic = ['anthropic', 'Anthropic', ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5']];
const openrouter = ['openRouter', 'OpenRouter', ['deepseek/deepseek-v3.2', 'qwen/qwen3-coder', ...Array.from({ length: 14 }, (_, i) => `vendor${i}/model-${i}`)]];
const ollama = ['ollama', 'Ollama', ['qwen3-coder:30b', 'llama3.1:8b', 'gemma3:4b']];
const keyless = [{ providerName: 'openAI', providerTitle: 'OpenAI' }, { providerName: 'gemini', providerTitle: 'Gemini' }, { providerName: 'groq', providerTitle: 'Groq' }];

// ===================================================================== several providers: the providers, the chosen one open
{
	const { page, errors } = await show({ options: [anthropic, openrouter, ollama], selected: ['anthropic', 'claude-sonnet-4-5'], withoutKey: keyless, addableCount: 48, local: ['ollama'] });
	check('the button says the chosen model as a name', (await page.locator(TID('vader-picker-button')).innerText()) === 'Claude Sonnet 4.5');
	await open(page);
	check('opening asks the lists that are old to refresh', (await log(page)).includes('opened'));
	check('the search says how many models it searches', (await page.locator(TID('vader-picker-search')).getAttribute('placeholder')) === 'Search 22 models');
	const provs = await page.locator(TID('vader-picker-provider')).allInnerTexts();
	check('the providers are listed with how many models each has, and a local one says it is on this computer', provs.map(flat).join(' | ') === 'Anthropic 3 | OpenRouter 16 | Ollama 3, on this computer', provs.map(flat).join(' | '));
	check('the chosen provider is open, with the chosen model marked', (await page.locator(TID('vader-picker-model')).count()) === 3 && (await page.locator(`${TID('vader-picker-model')}[aria-selected="true"]`).innerText()) === 'Claude Sonnet 4.5');
	check('a name Anthropic ids are shown as names', (await page.locator(TID('vader-picker-model')).allInnerTexts()).map(flat).join(' | ') === 'Claude Sonnet 4.5 | Claude Opus 4.1 | Claude Haiku 4.5');
	check('providers without a key are offered, each with Add, and not hidden', (await page.locator(TID('vader-picker-unkeyed')).innerText()).includes('OpenAI') && (await page.locator(TID('vader-picker-add')).count()) === 3 && (await page.locator(TID('vader-picker-unkeyed')).innerText()).includes('No key yet'));
	check('and the line under them says how many more can be added', flat(await page.locator(TID('vader-picker-addable')).innerText()) === '48 providers can be added. Models appear as soon as a key works.');
	await shot(page, '01-providers');
	await page.locator(TID('vader-picker-add')).nth(1).click();
	check('Add on a provider goes to the page of providers and keys, for that provider', (await log(page)).includes('addkey:gemini') && (await page.locator(TID('vader-picker')).count()) === 0);
	await open(page);
	await page.locator(TID('vader-picker-provider')).nth(1).click();
	check('a click on a provider opens its models, and closes the one that was open', (await page.locator(TID('vader-picker-model')).count()) === 16);
	await page.locator(TID('vader-picker-model')).nth(0).click();
	check('choosing a model says which one, and closes the picker', (await log(page)).includes('choose:openRouter/deepseek/deepseek-v3.2') && (await page.locator(TID('vader-picker')).count()) === 0);
	check('no error in the page console', errors.length === 0, errors.join(' | '));
	await page.close();
}

// ===================================================================== a search across providers, and one that finds nothing
{
	const { page } = await show({ options: [anthropic, openrouter, ollama], selected: ['anthropic', 'claude-sonnet-4-5'], withoutKey: [keyless[0], keyless[1]], addableCount: 48 });
	await open(page);
	await page.locator(TID('vader-picker-search')).fill('qwen');
	check('a search finds the models of every provider, under their provider', (await page.locator(TID('vader-picker-model')).count()) === 2);
	await page.locator(TID('vader-picker-search')).fill('sonnet 9');
	check('nothing found says what was searched, and which providers have no key', (await page.locator(TID('vader-picker-nomatch')).innerText()).includes('No model named “sonnet 9”.') && (await page.locator(TID('vader-picker-nomatch')).innerText()).includes('Searched 3 providers with a key. OpenAI and Gemini have no key yet.'));
	await shot(page, '02-nothing-matches');
	await page.locator(TID('vader-picker-add-key')).click();
	check('Add a key opens the providers and keys page', (await log(page)).includes('addkey:'));
	await open(page);
	await page.locator(TID('vader-picker-search')).fill('zzzz');
	await page.locator(TID('vader-picker-clear')).click();
	check('Clear the search brings the list back', (await page.locator(TID('vader-picker-nomatch')).count()) === 0 && (await page.locator(TID('vader-picker-search')).inputValue()) === '');
	await page.close();
}

// ===================================================================== one provider: its live list, flat, said when it was fetched
{
	const { page } = await show({ options: [openrouter], selected: ['openRouter', 'deepseek/deepseek-v3.2'], providerStates: [{ providerName: 'openRouter', providerTitle: 'OpenRouter', status: 'ok', fetchedAt: 1_000_000 - 5_000 }] });
	await open(page);
	check('a live list is flat, ids as the provider writes them', (await page.locator(TID('vader-picker-provider')).count()) === 0 && (await page.locator(TID('vader-picker-model')).count()) === 16);
	check('the footer says whose list it is and how fresh', flat(await page.locator(TID('vader-picker-footer')).innerText()).startsWith('OpenRouter, fetched just now'));
	await shot(page, '03-live-list');
	await page.close();
}

// ===================================================================== the list is being asked for: the saved one stays
{
	const { page } = await show({ options: [anthropic, openrouter], selected: ['anthropic', 'claude-sonnet-4-5'], providerStates: [{ providerName: 'openRouter', providerTitle: 'OpenRouter', status: 'loading' }, { providerName: 'anthropic', providerTitle: 'Anthropic', status: 'ok' }] });
	await open(page);
	await page.locator(TID('vader-picker-provider')).nth(1).click();
	check('while the list is asked for, the saved models stay and say so', (await page.locator(TID('vader-picker-saved')).count()) === 16 && (await page.locator(TID('vader-picker-asking')).innerText()).includes('Asking OpenRouter…'));
	check('it says when lists are fetched and kept', (await page.locator(TID('vader-picker-loading-note')).innerText()).includes('fetched when you open the picker and cached for 10 minutes'));
	await shot(page, '04-asking');
	await page.close();
}

// ===================================================================== the list could not be fetched: said, with a way to try again
{
	const { page } = await show({ options: [anthropic, openrouter], selected: ['openRouter', 'qwen/qwen3-coder'], providerStates: [{ providerName: 'openRouter', providerTitle: 'OpenRouter', status: 'error' }, { providerName: 'anthropic', providerTitle: 'Anthropic', status: 'ok' }] });
	await open(page);
	check('a list that could not be fetched says which provider did not answer', flat(await page.locator(TID('vader-picker-failed')).innerText()) === 'OpenRouter did not answer Try again');
	check('and that sending still works', (await page.locator(TID('vader-picker-failed-note')).innerText()).includes('You can still send; only a model that is gone would fail.'));
	await shot(page, '05-failed');
	await page.locator(TID('vader-picker-retry')).click();
	check('Try again asks that provider again', (await log(page)).includes('retry:openRouter'));
	await page.close();
}

// ===================================================================== the keyboard, and reduced motion
{
	const { page } = await show({ options: [anthropic, openrouter], selected: ['anthropic', 'claude-sonnet-4-5'] });
	await open(page);
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown');
	check('the arrows move between the rows', (await page.evaluate(() => document.activeElement?.getAttribute('data-picker-row') !== null)));
	await page.keyboard.press('Escape');
	check('Escape closes the picker', (await page.locator(TID('vader-picker')).count()) === 0);
	await page.close();
}
{
	const page = await browser.newPage({ viewport: { width: 520, height: 700 }, reducedMotion: 'reduce' });
	await page.goto(base);
	await page.waitForFunction(() => window.__mounted === true);
	await page.evaluate((p) => window.__show(p), { options: [anthropic, openrouter], selected: ['anthropic', 'claude-sonnet-4-5'], open: true });
	await page.waitForSelector(TID('vader-picker'));
	check('with reduced motion the picker does not animate in', (await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="vader-picker"]')).animationName)) === 'none');
	await page.close();
}

await browser.close();
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed\nscreenshots: ${shots}`);
process.exit(failed ? 1 : 0);
