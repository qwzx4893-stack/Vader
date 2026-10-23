#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The whole Vader window as a person sees it: the real shell with the real chat inside it, at the size of the boards (1440 x 900), in a headless browser (no window opens).
// Only the markdown with its code editors and the apply buttons are stand-ins here; they have their own tests.
// Run: node src/vs/workbench/contrib/vader/test/windowUiE2E.mjs        (screenshots go to the temp folder, named in the last line)

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
if (!fs.existsSync(path.join(src2, 'vader-shell-tsx/Shell.tsx'))) { console.log('FAIL: run `npm run buildreact` first (react/src2 is built from react/src)'); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(repo, 'node_modules', '.vader-window-ui-'));
const shots = path.join(os.tmpdir(), 'window-ui-shots');
fs.mkdirSync(shots, { recursive: true });

const stubs = {
	'workbench/common/contributions.js': 'export const registerWorkbenchContribution2 = () => {}; export const WorkbenchPhase = { BlockRestore: 1, Eventually: 4 };',
	'common/skills/skillService.js': 'const d = () => () => {}; export const ISkillService = d;',
	'common/mcpService.js': 'const d = () => () => {}; export const IMCPService = d;',
	'common/vaderSettingsService.js': 'const d = () => () => {}; export const IVaderSettingsService = d;',
	'platform/quickinput/common/quickInput.js': 'const d = () => () => {}; export const IQuickInputService = d;',
	'platform/opener/common/opener.js': 'const d = () => () => {}; export const IOpenerService = d;',
	'platform/commands/common/commands.js': 'const d = () => () => {}; export const ICommandService = d;',
	'contrib/extensions/common/extensions.js': 'const d = () => () => {}; export const IExtensionsWorkbenchService = d;',
	'services/extensionManagement/common/extensionManagement.js': 'const d = () => () => {}; export const IWorkbenchExtensionEnablementService = d; export const EnablementState = { EnabledGlobally: 1, DisabledGlobally: 2 };',
	'platform/extensionManagement/common/extensionManagement.js': 'export const SortBy = { InstallCount: "InstallCount" };',
	'common/externalAgents/externalAgentTypes.js': 'const d = () => () => {}; export const IExternalAgentMainService = d;',
	'common/marketplace/marketplaceTypes.js': 'const d = () => () => {}; export const IUnifiedMarketplaceService = d;',
	'common/discovery/discoveryServiceTypes.js': 'const d = () => () => {}; export const IDiscoveryMainService = d;',
	'platform/instantiation/common/extensions.js': 'export const registerSingleton = (id, ctor) => { if (/Unified/.test(ctor && ctor.name)) globalThis.__UnifiedCtor = ctor; }; export const InstantiationType = { Delayed: 1, Eager: 0 };',
};
const stubbed = [/\/markdown\/ChatMarkdownRender\.js$/, /\/vader-settings-tsx\/ExternalAgents\.js$/, /\/sidebar-tsx\/SidebarThreadSelector\.js$/, /\/util\/BlockCodeExport\.js$/];
const plugin = {
	name: 'harness',
	setup(build) {
		build.onResolve({ filter: /.*/ }, (args) => {
			if (!args.path.startsWith('.')) return null;
			const full = path.resolve(args.resolveDir, args.path).replace(/\\/g, '/');
			if (/\/util\/services\.js$/.test(full) || /fixtures\/(shell|chat)HarnessServices(\.js|\.ts)?$/.test(full)) return { path: path.join(here, 'fixtures/windowHarnessServices.ts') };
			if (stubbed.some(r => r.test(full)) && !/fixtures\//.test(args.resolveDir.replace(/\\/g, '/'))) return { path: path.join(here, 'fixtures/chatStubs.tsx') };
			if (/\/terminalToolService\.js$/.test(full)) return { path: path.join(here, 'fixtures/terminalToolStub.ts') };
			// the editor's services the add-ons providers import are stood in for, for those files only (the rest of the window needs the real ones)
			if (/\/contrib\/vader\/browser\/marketplace(\/|$)/.test(args.resolveDir.replace(/\\/g, '/'))) for (const k of Object.keys(stubs)) if (full.endsWith('/' + k.replace(/\.js$/, '')) || full.endsWith('/' + k)) return { path: k, namespace: 'stub' };
			return null;
		});
		build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
	},
};
await esbuild.build({
	entryPoints: [path.join(here, 'fixtures/windowHarness.tsx')], bundle: true, platform: 'browser', format: 'iife', outfile: path.join(tmp, 'page.js'), logLevel: 'error',
	plugins: [plugin], jsx: 'automatic', loader: { '.json': 'json', '.css': 'css', '.ttf': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"', 'process.env.VADER_LANG': JSON.stringify(process.env.VADER_LANG ?? 'en'), 'process.env.VADER_PREVIEW': '""' },
	tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false, jsx: 'react-jsx' } },
});
fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="page.css"><style>html,body{margin:0;background:#0b0b0c;color:#e6e6e6}#root{width:1440px;height:900px;overflow:hidden}</style></head><body><div id="root"></div><script src="page.js"></script></body></html>');

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
const shot = async (page, name) => { await auditShot(page, name); await page.screenshot({ path: path.join(shots, name + '.png'), animations: 'disabled' }); };

{
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
	await page.goto(base);
	await page.waitForFunction(() => window.__mounted === true);
	await page.waitForTimeout(400);
	await shot(page, '01-conversation');
	if (errors.length) console.log('PAGE ERRORS:', errors.join(' | ').slice(0, 1200));
	await page.evaluate(() => { const el = document.querySelector('[data-testid="vader-messages"]').parentElement; el.scrollTop = 0; });
	await page.waitForTimeout(100);
	await shot(page, '02-conversation-top');
	check('the window opens with the chat inside it and no error in the console', errors.length === 0, errors.join(' | ').slice(0, 600));
	// the other pages of the window, as the real components draw them
	const view = async (name, fn) => { await page.evaluate(fn); await page.waitForTimeout(350); await shot(page, name); };
	await view('03-all-agents', () => window.__shell.show('agents'));
	await view('04-addons', () => window.__shell.show('addons'));
	await page.locator('[data-testid=vader-addon-row] [data-testid=vader-addon-name]').first().click();
	await page.waitForTimeout(500); await shot(page, '04b-addon-page');
	await page.locator('[data-testid=vader-item-back]').click(); await page.waitForTimeout(300);
	for (const [tab, name] of [['skills', '04c-addons-skills'], ['mcp', '04d-addons-mcp'], ['extensions', '04e-addons-extensions'], ['agents', '04f-addons-agents']]) {
		await page.locator(`[data-testid=vader-addons-tab-${tab}]`).click(); await page.waitForTimeout(500); await shot(page, name);
		await page.locator('[data-testid=vader-addon-row] [data-testid=vader-addon-name]').first().click(); await page.waitForTimeout(500); await shot(page, name + '-page');
		await page.locator('[data-testid=vader-item-back]').click(); await page.waitForTimeout(300);
	}
	await page.locator('[data-testid=vader-addons-tab-all]').click();
	await page.locator('[data-testid=vader-addons-installed]').click(); await page.waitForTimeout(500); await shot(page, '04g-addons-installed');
	await page.locator('[data-testid=vader-installed-back]').click(); await page.locator('[data-testid=vader-addons-installed]').waitFor()
	await view('05-review', () => { window.__chat.switchToThread('t-wait'); window.__shell.show('conversation', 'review'); });
	await view('06-browser', () => { window.__chat.switchToThread('t-run1'); window.__shell.show('conversation', 'browser'); });
	await view('07-terminal', () => window.__shell.show('conversation', 'terminal'));
	await view('08-chat-of-run', () => window.__shell.show('conversation', 'conversation'));
	await view('09-new-chat', () => {
		const c = window.__chat;
		c.state = { ...c.state, allThreads: { ...c.state.allThreads, 't-new': { id: 't-new', createdAt: new Date().toISOString(), lastModified: new Date().toISOString(), messages: [], state: {}, filesWithUserChanges: new Set(), projectFolders: ['c:/work/vader-app'] } }, currentThreadId: 't-new' };
		window.__shell.show('conversation', 'conversation');
	});
	await view('10-error', () => {
		const c = window.__chat;
		c.switchToThread('t-chat');
		c.streamState = { ...c.streamState, 't-chat': { isRunning: undefined, error: { message: '429 Too Many Requests: slow down', fullError: Object.assign(new Error('429 Too Many Requests: slow down'), { status: 429 }) } } };
		window.__notify();
	});
	// the run states of the conversation (boards S01, S03, S12), on the open task
	await page.evaluate(() => { window.__back = () => { const c = window.__chat; c.streamState = {}; c.switchToThread('t-wait'); window.__shell.show('conversation', 'conversation'); const t = c.state.allThreads['t-wait']; c.state = { ...c.state, allThreads: { ...c.state.allThreads, 't-wait': { ...t, stopped: undefined } } }; window.__notify(); }; });
	await view('17-parallel-run', () => {
		const MIN = 60000, now = Date.parse('2026-10-14T12:30:00Z');
		const t = (id, task, agent, branch, extra) => ({ id, task, agentName: agent, usesWorktree: true, status: 'success', branchName: branch, startedAt: now - 20 * MIN, finishedAt: now - 14 * MIN, repoPath: 'C:/work/vader-app', ...extra });
		window.__runs = [{ id: 'run1', createdAt: now - 26 * MIN, cancelled: false, tasks: [
			t('a', 'Check the cloud providers live model lists', 'Researcher', 'wt/probe-cloud', { mergeOutcome: 'merged', changedFilePaths: ['x', 'y', 'z'] }),
			t('b', 'Check the local providers (Ollama, LM Studio)', 'Researcher', 'wt/probe-local', { mergeOutcome: 'merged', changedFilePaths: ['x'] }),
			t('c', 'Check the coding-agent registry versions', 'Reviewer', 'wt/probe-acp', { mergeOutcome: 'conflict', conflictFiles: ['src/vs/workbench/contrib/vader/common/externalAgents/acpRegistrySnapshot.ts'], changedFilePaths: ['q'] }),
			t('d', 'Write the summary table into the docs', 'Docs writer', 'wt/probe-docs', { status: 'running', finishedAt: undefined, startedAt: now - 3 * MIN }),
		] }];
		window.__shell.show('agents'); window.__notify();
	});
	await view('18-all-agents-clean', () => { window.__runs = []; window.__notify(); });
	await view('11-running', () => { window.__back(); window.__chat.state.allThreads['t-wait'].messages.pop(); window.__chat.streamState = { 't-wait': { isRunning: 'tool' } }; window.__notify(); });
	await view('12-paused', () => { window.__back(); window.__chat.state.allThreads['t-wait'].messages.pop(); window.__chat.streamState = { 't-wait': { isRunning: 'LLM' } }; window.__chat._pause['t-wait'] = { reason: 'user' }; window.__notify(); });
	await view('13-finished', () => { window.__back(); delete window.__chat._pause['t-wait']; const t = window.__chat.state.allThreads['t-wait']; t.messages.pop(); t.messages.push({ role: 'assistant', displayContent: 'The budget now comes from one place. Both the cut and the summary use it.', reasoning: '', anthropicReasoning: null }); window.__notify(); });
	await view('14-stopped', () => { window.__back(); const c = window.__chat; const t = c.state.allThreads['t-wait']; t.messages.pop(); c.state = { ...c.state, allThreads: { ...c.state.allThreads, 't-wait': { ...t, stopped: { at: Date.now(), doing: 'editing convertToLLMMessageService.ts' } } } }; window.__notify(); });
	await page.locator('[data-testid="vader-input"]').fill('/');
	await page.waitForTimeout(250); await shot(page, '15-slash-menu');
	await page.locator('[data-testid="vader-input"]').fill('Explain ');
	await page.keyboard.type('@');
	await page.waitForTimeout(350); await shot(page, '16-at-menu');
	// Explicitly illustrative isolated fixtures requested by the owner. These do not
	// populate production data or establish real provider connectivity.
	await page.keyboard.press('Escape');
	await page.evaluate(() => {
		const c = window.__chat;
		const id = 't-ui-preview';
		const now = new Date().toISOString();
		c.state = { ...c.state, currentThreadId: id, allThreads: { ...c.state.allThreads, [id]: {
			id, createdAt: now, lastModified: now, projectFolders: ['c:/work/vader-app'], filesWithUserChanges: new Set(), state: {},
			messages: [
				{ role: 'user', content: 'Check the project and add tests for the rate limiter.', displayContent: 'Check the project and add tests for the rate limiter.', selections: [], state: {} },
				{ role: 'assistant', displayContent: 'I checked the request handler and the token bucket. The tests now cover exhausted quotas, independent accounts, and cancellation.\n\nYou can review the changes before applying them to the project.', reasoning: 'I compared the request path with the existing tests, checked how the quota is updated, and kept each account independent.', anthropicReasoning: null },
			],
		} } };
		c.streamState = {};
		const selection = { providerName: 'openRouter', modelName: 'nvidia/nemotron-3-super-120b-a12b:free' };
		window.__settings = { ...window.__settings,
			settingsOfProvider: { ...window.__settings.settingsOfProvider, openRouter: { ...window.__settings.settingsOfProvider.anthropic, apiKey: 'isolated-fixture', _didFillInProviderSettings: true, models: [{ modelName: selection.modelName, isHidden: false }] } },
			_modelOptions: [{ name: selection.modelName, selection }],
			modelSelectionOfFeature: { ...window.__settings.modelSelectionOfFeature, Chat: selection },
			overridesOfModel: { openRouter: { [selection.modelName]: { contextWindow: 262144 } } },
			globalSettings: { ...window.__settings.globalSettings, chatMode: 'normal' },
		};
		window.__shell.show('conversation', 'conversation'); window.__notify();
	});
	await page.locator('[data-testid=vader-reasoning-toggle]').waitFor({ state: 'visible' });
	await page.locator('[data-testid=vader-reasoning-toggle]').click();
	await page.locator('[data-testid=vader-assistant-text]').hover();
	await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid=vader-copy-answer]').parentElement).opacity === '1');
	const actionStyle = await page.locator('[data-testid=vader-copy-answer]').evaluate(el => {
		const s = getComputedStyle(el); return { border: s.borderTopColor, background: s.backgroundColor, height: el.getBoundingClientRect().height, width: el.getBoundingClientRect().width };
	});
	check('copy is a small transparent icon without a painted button background or border', actionStyle.background === 'rgba(0, 0, 0, 0)' && actionStyle.border === 'rgba(0, 0, 0, 0)' && actionStyle.height === 28 && actionStyle.width === 28);
	check('message actions use icons with accessible names instead of visible labels', await page.locator('[data-testid=vader-copy-answer]').evaluate(el => !!el.querySelector('svg') && el.textContent.trim() === '' && el.getAttribute('aria-label') === 'Copy'));
	const answer = page.locator('[data-testid=vader-assistant-text] [data-testid=md]').first();
	// Start on actual first-line glyphs, rather than the empty gap between paragraphs.
	const bounds = await answer.evaluate(el => {
		const node = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
		const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, Math.min(38, node.textContent.length));
		const r = range.getClientRects()[0]; return { x: r.x, y: r.y, width: r.width, height: r.height };
	});
	await page.mouse.move(bounds.x + 1, bounds.y + bounds.height / 2);
	await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width - 1, bounds.y + bounds.height / 2, { steps: 8 }); await page.mouse.up();
	const selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? '');
	check('assistant prose can actually be selected with the mouse', selectedText.includes('checked'), JSON.stringify(selectedText));
	await page.evaluate(() => window.getSelection()?.removeAllRanges());
	await shot(page, '17-preview-message-and-thinking');
	check('the routed model caption is compact while its full id stays in the tooltip',
		(await page.locator('[data-testid=vader-picker-caption]').innerText()) === 'NVIDIA Nemotron 3 Super'
		&& (await page.locator('[data-testid=vader-picker-button]').getAttribute('title')).includes('120b-a12b:free'));
	await page.locator('[data-testid=vader-context-meter]').click();
	await page.locator('[data-testid=vader-context-panel]').waitFor({ state: 'visible' });
	const consumed = await page.locator('[data-testid=vader-context-meter]').innerText();
	await page.evaluate(async () => {
		const s = window.__settings; const id = s.modelSelectionOfFeature.Chat.modelName;
		window.__settings = { ...s, overridesOfModel: { ...s.overridesOfModel, openRouter: { [id]: { ...s.overridesOfModel.openRouter[id], reservedOutputTokenSpace: 131072 } } } };
		window.__notify(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	});
	check('reserving more answer space does not inflate reported consumed context', (await page.locator('[data-testid=vader-context-meter]').innerText()) === consumed);
	await shot(page, '18-preview-context-usage');
	check('the context popover is informational only', await page.locator('[data-testid=vader-context-panel] input,[data-testid=vader-context-panel] [role=slider],[data-testid=vader-context-panel] button').count() === 0);
	await page.keyboard.press('Escape');
	await page.locator('[data-testid=vader-project-picker]').click();
	await page.locator('[data-testid=vader-project-picker-option]').first().waitFor({ state: 'visible' });
	await shot(page, '19-preview-project-picker');
	await page.keyboard.press('Escape');
	check('keyboard focus uses a neutral outline instead of the editor blue', await page.locator('[data-testid=vader-project-picker]').evaluate(el => getComputedStyle(el).outlineColor === 'rgb(176, 176, 181)'));
	await page.evaluate(() => {
		const c = window.__chat; const id = c.state.currentThreadId;
		c.streamState = { [id]: { isRunning: 'LLM', llmInfo: { displayContentSoFar: '', reasoningSoFar: 'Checking the final edge cases.', toolCallSoFar: null } } };
		window.__notify();
	});
	await page.locator('[data-testid=vader-loading]').first().waitFor({ state: 'visible' });
	await shot(page, '20-preview-loading');
	await page.evaluate(() => {
		const c = window.__chat, id = 't-first-open'; const now = new Date().toISOString();
		c.state = { ...c.state, currentThreadId: id, allThreads: { [id]: { id, createdAt: now, lastModified: now, messages: [], state: { stagingSelections: [] }, filesWithUserChanges: new Set() } } };
		c.streamState = {}; c.getCurrentProjectKey = () => null; c.listProjectGroups = () => [];
		c.getUsageToday = () => ({ costUsd: 0, billedCostUsd: 0, inputTokens: 0, outputTokens: 0, unpricedTurns: 0 });
		window.__shell.listProjects = async () => ({ projects: [], historyUnavailable: false });
		window.__notify();
	});
	await page.locator('[data-testid=vader-landing-title]').waitFor();
	const projectBounds = await page.locator('[data-testid=vader-project-picker]').boundingBox();
	const inputBounds = await page.locator('[data-testid=vader-input]').boundingBox();
	check('first open offers one project selector above the input and no duplicated opening card', projectBounds.y < inputBounds.y && await page.locator('[data-testid=vader-open-folder],[data-testid=vader-no-project]').count() === 0);
	await shot(page, '21-preview-first-open');
	await page.evaluate(() => {
		const c = window.__chat, id = c.state.currentThreadId;
		c.streamState = { [id]: { isRunning: undefined, isPreparing: true } };
		window.__notify(); window.__shell.show('agents');
	});
	await page.waitForFunction(() => !document.querySelector('[data-testid=vader-input]'));
	await page.evaluate(() => window.__shell.show('conversation', 'conversation'));
	await page.locator('[data-testid=vader-input]').waitFor();
	await page.locator('[data-testid=vader-input]').fill('A newer draft after returning');
	check('returning to an unmounted conversation retains service-owned preparation and keeps Send disabled', await page.locator('[data-testid=vader-send]').isDisabled());
	await page.evaluate(() => { window.__chat.streamState = {}; window.__notify(); });
	await page.waitForFunction(() => !document.querySelector('[data-testid=vader-send]').disabled);
	check('settled service preparation re-enables Send without losing the returned draft', await page.locator('[data-testid=vader-input]').inputValue() === 'A newer draft after returning');
	check('no error in the console on any page', errors.length === 0, errors.join(' | ').slice(0, 600));
	await page.close();
}

await browser.close();
server.close();
if (!process.env.KEEP) fs.rmSync(tmp, { recursive: true, force: true }); else console.log('kept', tmp);
console.log(`\n${passed} passed, ${failed} failed\nscreenshots: ${shots}`);
process.exit(failed ? 1 : 0);
