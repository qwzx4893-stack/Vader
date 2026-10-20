#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The Add-ons page, used the way a person uses it, in a headless browser (no window opens): the page as it is built for the app (react/src2), the real
// providers and the real federating service behind it, and saved real answers from the sources. Needs `npm run buildreact` to have been run.
// Checked: the look (tabs without counts, a white Install button), opening an item by its card and not by its button, the page of each kind,
// sections, search, a source that fails, installs of each kind, the Installed switch, the keyboard, and that nothing is cut off or spills.
// Run: node src/vs/workbench/contrib/vader/test/addonsUiE2E.mjs        (screenshots go to the temp folder, named in the last line)

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const { chromium } = require('playwright-core');
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const src2 = path.join(here, '../browser/react/src2');
if (!fs.existsSync(path.join(src2, 'vader-marketplace-tsx/ItemPage.tsx'))) { console.log('FAIL: run `npm run buildreact` first (react/src2 is built from react/src)'); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(repo, 'node_modules', '.vader-ui-'));
const shots = path.join(os.tmpdir(), 'addons-ui-shots');
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
	'platform/instantiation/common/extensions.js': 'export const registerSingleton = (id, ctor) => { globalThis.__UnifiedCtor = ctor; }; export const InstantiationType = { Delayed: 1, Eager: 0 };',
};
const plugin = {
	name: 'harness',
	setup(build) {
		build.onResolve({ filter: /.*/ }, (args) => {
			if (!args.path.startsWith('.')) return null;
			const full = path.resolve(args.resolveDir, args.path).replace(/\\/g, '/');
			if (/\/util\/services\.js$/.test(full)) return { path: path.join(here, 'fixtures/addonsHarnessServices.ts') };
			for (const k of Object.keys(stubs)) if (full.endsWith('/' + k.replace(/\.js$/, '')) || full.endsWith('/' + k)) return { path: k, namespace: 'stub' };
			return null;
		});
		build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
	},
};
await esbuild.build({
	entryPoints: [path.join(here, 'fixtures/addonsHarness.tsx')], bundle: true, platform: 'browser', format: 'iife', outfile: path.join(tmp, 'page.js'), logLevel: 'error',
	plugins: [plugin], jsx: 'automatic', loader: { '.json': 'json', '.css': 'css' }, define: { 'process.env.NODE_ENV': '"production"' },
	tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false, jsx: 'react-jsx' } },
});
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="page.css"><style>
:root{--vscode-input-background:#1c1d1f;--vscode-badge-background:#4d4d4d;--vscode-sideBar-background:#18191a;--vscode-editor-background:#141516;--vscode-editor-foreground:#cccccc;--vscode-input-foreground:#cccccc;--vscode-input-placeholderForeground:#8b8d90;--vscode-list-deemphasizedForeground:#8c8c8c;--vscode-charts-yellow:#e2a93f;--vscode-commandCenter-activeBorder:rgba(255,255,255,.4);--vscode-commandCenter-border:rgba(255,255,255,.12);--vscode-commandCenter-inactiveBorder:rgba(255,255,255,.07);--vscode-editorGroup-border:rgba(255,255,255,.07);--vscode-tab-activeForeground:#e6e6e6}
html,body{margin:0;background:#1e1e1e;color:#e6e6e6;font:13px 'Segoe UI',system-ui,sans-serif}#root{width:1280px;height:800px;overflow:hidden}</style></head><body><div id="root"></div><script src="page.js"></script></body></html>`;
fs.writeFileSync(path.join(tmp, 'index.html'), html);

const chromePath = (() => {
	if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
	try { const base = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright'); const d = fs.readdirSync(base).filter((x) => x.startsWith('chromium_headless_shell')).sort().pop(); const f = path.join(base, d, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'); return fs.existsSync(f) ? f : undefined; } catch { return undefined; } // elsewhere Playwright finds its own browser
})();
const browser = await chromium.launch({ executablePath: chromePath, args: ['--no-sandbox'] });
const http = await import('node:http');
const server = http.createServer((req, res) => {
	const f = path.join(tmp, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
	if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; res.end('no'); return; }
	res.setHeader('Content-Type', f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html');
	res.end(fs.readFileSync(f));
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port + '/';

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${String(detail).slice(0, 300)}` : ''}`); };

const newPage = async ({ fail = {}, delay = 0 } = {}) => {
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
	await page.addInitScript(([f, d]) => { window.__fail = f; window.__delay = d; }, [fail, delay]);
	// icons come from open-vsx.org in the app; here they are answered with a one-pixel picture
	await page.route('https://open-vsx.org/**', (r) => r.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') }));
	await page.goto(baseUrl + 'index.html');
	await page.waitForFunction(() => window.__mounted === true, null, { timeout: 15000 });
	return { page, errors };
};
const pathToUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
const rows = (page) => page.locator('[data-testid=vader-addon-row]');
const waitRows = async (page, min = 1, timeout = 20000) => { await page.waitForFunction((m) => document.querySelectorAll('[data-testid=vader-addon-row]').length >= m, min, { timeout }); };
const tab = (page, id) => page.locator(`[data-testid=vader-addons-tab-${id}]`);
let shotN = 0;
const shot = async (page, name) => { const f = path.join(shots, `${String(++shotN).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: f }); };

/** nothing cut off or spilling, in the part of the page that is on screen */
const layoutProblems = (page) => page.evaluate(() => {
	const out = [];
	const root = document.getElementById('root');
	const rr = root.getBoundingClientRect();
	const describe = (el) => `${el.tagName.toLowerCase()} "${(el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`;
	if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${window.innerWidth})`);
	for (const el of root.querySelectorAll('*')) {
		const cs = getComputedStyle(el);
		if (cs.display === 'none' || cs.visibility === 'hidden') continue;
		const r = el.getBoundingClientRect();
		if (r.width === 0 && r.height === 0) continue;
		const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
		if (hasText && cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== 'visible') out.push(`text cut off sideways in ${describe(el)}`);
		if (hasText && (r.right > rr.right + 1 || r.left < rr.left - 1)) out.push(`outside the page: ${describe(el)}`);
		if (el.tagName === 'BUTTON' && r.height > 44) out.push(`button label wraps: ${describe(el)}`);
		if (el.tagName === 'IMG' && el.complete && el.naturalWidth === 0 && el.getAttribute('src')) out.push(`image did not load: ${el.getAttribute('src').slice(0, 50)}`);
	}
	return [...new Set(out)].slice(0, 8);
});

try {
	// ===================================================================== the page and its look
	{
		const { page, errors } = await newPage();
		await waitRows(page, 6);
		const tabs = await page.locator('[role=tablist] [role=tab]').allInnerTexts();
		check('the tabs are All, Skills, MCP servers, Extensions, Agents, and none shows a count', tabs.join('|') === 'All|Skills|MCP servers|Extensions|Agents' && !tabs.some((t) => /\d/.test(t)), tabs.join('|'));
		const installs = page.locator('[data-testid=vader-addon-install]');
		const nInstall = await installs.count();
		const look = await installs.first().evaluate((b) => { const cs = getComputedStyle(b); return { bg: cs.backgroundColor, color: cs.color, text: b.textContent }; });
		const lum = (c) => { const m = c.startsWith('color(') ? c.match(/[0-9.]+/g).slice(0, 3).map((x) => Number(x) * 255) : c.match(/[0-9.]+/g).slice(0, 3).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
		check('Install is a white button with black text', nInstall >= 4 && look.text === 'Install' && lum(look.bg) > 0.8 && lum(look.color) < 0.25, nInstall + ' ' + JSON.stringify(look));
		check('there is no round plus button any more', (await page.locator('button[aria-label^="Add "]').count()) === 0);
		const sectionsTitles = await page.locator('[data-testid=vader-addons-group-title]').allInnerTexts();
		check('the front page has one short list for each kind: skills, MCP servers, extensions, tooling, agents', ['Most trusted skills', 'MCP servers', 'Extensions for the editor', 'Agents you can connect'].every((t) => sectionsTitles.includes(t)), sectionsTitles.join('|'));
		const legend = await page.getByText('80 to 100 high trust').count();
		check('the trust legend is there', legend === 1);
		check('every row has a trust figure with its word, except agents', (await page.locator('[data-testid=vader-addon-row] [aria-label^="Trust"]').count()) >= 6);
		check('the logos: a letter for what has none, and none of them is broken', (await page.locator('[data-testid=vader-item-logo]').count()) >= 8);
		check('the page has no layout problem', (await layoutProblems(page)).length === 0, (await layoutProblems(page)).join('; '));
		await shot(page, 'home');
		check('no error in the page console', errors.length === 0, errors.join(' | '));
		await page.close();
	}

	// ===================================================================== a skill: its own page
	{
		const { page, errors } = await newPage();
		await tab(page, 'skills').click();
		await waitRows(page, 6);
		const first = rows(page).first();
		const name = (await first.locator('[data-testid=vader-addon-name]').first().innerText()).trim();
		await first.locator('[data-testid=vader-addon-name]').first().click();
		await page.waitForSelector('[data-testid=vader-item-page]');
		const kind = await page.locator('[data-testid=vader-item-page]').getAttribute('data-kind');
		check('clicking the card (not the button) opens the skill’s own page', kind === 'skill' && (await page.locator('[data-testid=vader-item-page] h2').innerText()).trim() === name);
		check('the page has its logo and its Install button', (await page.locator('[data-testid=vader-item-page] [data-testid=vader-item-logo]').count()) === 1 && (await page.locator('[data-testid=vader-item-install]').count()) === 1);
		check('the header of the list is out of the way while the page is open', !(await page.locator('[role=tablist]').first().isVisible()));
		const tabsInPage = await page.locator('[data-testid^=vader-item-tab-]').allInnerTexts();
		check('a skill’s page has Overview, SKILL.md and Why NN%', tabsInPage.length === 3 && tabsInPage[0] === 'Overview' && tabsInPage[1] === 'SKILL.md' && /^Why \d+%$/.test(tabsInPage[2]), tabsInPage.join('|'));
		check('the overview says what the skill asks for', (await page.getByText('What it asks for').count()) === 1 && (await page.getByText('Runs commands').count()) === 1);
		check('the facts are listed beside it', (await page.locator('[data-testid=vader-item-facts] >> text=Publisher').count()) === 1 && (await page.locator('[data-testid=vader-item-facts] >> text=Found in').count()) === 1);
		await page.locator('[data-testid=vader-item-tab-instructions]').click();
		await page.waitForSelector('[data-testid=vader-item-instructions]');
		await page.waitForFunction(() => document.querySelector('[data-testid=vader-item-instructions] pre') || /fetched|Reading/.test(document.body.innerText), null, { timeout: 8000 });
		check('SKILL.md shows the text the agent would follow', (await page.locator('[data-testid=vader-item-instructions] pre').count()) === 1 || (await page.getByText(/Reading the skill|not been fetched/).count()) === 1);
		await page.locator('[data-testid^=vader-item-tab-why]').click();
		await page.waitForSelector('[data-testid=vader-item-why]');
		await page.waitForFunction(() => /Scored (just now|from)/.test(document.body.innerText), null, { timeout: 10000 });
		const factors = await page.locator('[data-testid=vader-item-why] > div').count();
		check('Why lists every reason with its points and says the score is live', factors >= 3 && (await page.getByText(/Scored (just now|from)/).count()) >= 1, factors + ' ' + (await page.locator('[data-testid=vader-item-why]').innerText()).slice(0, 200));
		check('the skill page has no layout problem', (await layoutProblems(page)).length === 0, (await layoutProblems(page)).join('; '));
		await shot(page, 'skill-page');
		const relatedRows = page.locator('[data-testid=vader-item-related-row]');
		check('the page offers more of the same kind, never itself', (await relatedRows.count()) >= 1 && (await relatedRows.allInnerTexts()).every((t) => !t.startsWith(name)));
		const nextName = (await relatedRows.first().locator('span.vader-font-medium').first().innerText()).trim();
		await relatedRows.first().click();
		await page.waitForFunction((n) => document.querySelector('[data-testid=vader-item-page] h2')?.textContent?.trim() === n, nextName, { timeout: 5000 });
		check('choosing one of them opens its page in place', (await page.locator('[data-testid=vader-item-page] h2').innerText()).trim() === nextName && nextName !== name);
		check('the page that opened has its tab bar and Back still leads to the list', (await page.locator('[data-testid=vader-item-tab-overview]').count()) === 1);
		await page.locator('[data-testid=vader-item-back]').click();
		await waitRows(page, 6);
		if (process.env.DEBUG_UI) console.log(await page.evaluate(() => { const tl = [...document.querySelectorAll('[role=tablist]')].map((t) => t.className + ' vis=' + (t.getBoundingClientRect().height)); return tl.join(' ## ') + ' || ' + document.querySelector('[data-testid=vader-addons-page]').innerText.split(String.fromCharCode(10)).join(' / ').slice(0, 250); }));
		await tab(page, 'skills').waitFor({ state: 'visible', timeout: 5000 });
		check('Back returns to the same list with its tabs', (await tab(page, 'skills').isVisible()) && (await rows(page).count()) >= 6);
		check('no error in the page console', errors.length === 0, errors.join(' | '));
		await page.close();
	}

	// ===================================================================== installing
	{
		const { page } = await newPage();
		await tab(page, 'skills').click();
		await waitRows(page, 6);
		const target = rows(page).filter({ has: page.locator('[data-testid=vader-addon-install]') }).first();
		const tname = (await target.locator('[data-testid=vader-addon-name]').first().innerText()).trim();
		await target.locator('[data-testid=vader-addon-install]').click();
		await page.waitForFunction((n) => (window.__installed || []).includes(`skill:${n}`) || document.querySelector('[data-testid=vader-addon-error]'), tname, { timeout: 15000 });
		check('installing from a row does not fail', (await page.locator('[data-testid=vader-addon-error]').count()) === 0, await page.locator('[data-testid=vader-addon-error]').allInnerTexts());
		check('the Install button installs and does not open the page', (await page.locator('[data-testid=vader-item-page]').count()) === 0);
		await page.waitForFunction((n) => { const rs = [...document.querySelectorAll('[data-testid=vader-addon-row]')]; const r = rs.find((x) => x.querySelector('[data-testid=vader-addon-name]')?.textContent.trim() === n); return r && /Installed/.test(r.innerText); }, tname, { timeout: 15000 });
		check('the row then says Installed', true);
		await page.getByRole('button', { name: 'Installed', exact: true }).click();
		await page.waitForTimeout(400);
		const only = await rows(page).count();
		check('the Installed switch lists only what is installed', only === 1 && /Installed/.test(await rows(page).first().innerText()), String(only));
		await page.getByRole('button', { name: 'Installed', exact: true }).click();
		await tab(page, 'skills').click();
		await waitRows(page, 6);
		// install from the page, with the second button that also switches the skill on
		const second = rows(page).filter({ has: page.locator('[data-testid=vader-addon-install]') }).first();
		const sname = (await second.locator('[data-testid=vader-addon-name]').first().innerText()).trim();
		await second.locator('[data-testid=vader-addon-name]').first().click();
		await page.waitForSelector('[data-testid=vader-item-install-enable]', { timeout: 10000 });
		await page.locator('[data-testid=vader-item-install-enable]').click();
		await page.waitForFunction((n) => (window.__installed || []).includes(`skill:${n}`) && (window.__installed || []).some((x) => /^enable:.*:true$/.test(x)), sname, { timeout: 15000 });
		check('"Install and switch on" on the page installs the skill and switches it on', true);
		await page.waitForFunction(() => /Installed/.test(document.querySelector('[data-testid=vader-item-install-card]')?.innerText ?? ''), null, { timeout: 15000 });
		check('the page then says Installed', true);
		await page.close();
	}

	// ===================================================================== an MCP server
	{
		const { page, errors } = await newPage();
		await tab(page, 'mcp').click();
		await waitRows(page, 5);
		const names = await rows(page).locator('[data-testid=vader-addon-name]').allInnerTexts();
		check('the MCP tab lists servers from several sources', names.length >= 5, names.join(','));
		const chips = await page.locator('[data-testid=vader-addons-sections] button').allInnerTexts();
		check('the MCP tab has its own sections', chips[0] === 'All' && chips.includes('Code and Git') && chips.includes('Databases') && chips.includes('Chat and tickets'), chips.join('|'));
		const smith = rows(page).filter({ has: page.locator('[data-testid=vader-addon-name]', { hasText: /^GitHub$/ }) }).first();
		await smith.locator('[data-testid=vader-addon-name]').first().click();
		await page.waitForSelector('[data-testid=vader-item-page][data-kind=mcp]');
		const tabsInPage = await page.locator('[data-testid^=vader-item-tab-]').allInnerTexts();
		check('an MCP server’s page has Overview, Setup and Why NN%', tabsInPage[0] === 'Overview' && tabsInPage[1] === 'Setup' && /^Why/.test(tabsInPage[2]), tabsInPage.join('|'));
		await page.locator('[data-testid=vader-item-tab-setup]').click();
		await page.waitForSelector('[data-testid=vader-item-setup]');
		const entry = await page.locator('[data-testid=vader-item-entry]').innerText();
		check('Setup shows how it runs and the exact entry that would be written into mcp.json', /url|command/.test(entry) && (await page.getByText('What is written into your mcp.json').count()) === 1, entry);
		check('the MCP page has no layout problem', (await layoutProblems(page)).length === 0, (await layoutProblems(page)).join('; '));
		await shot(page, 'mcp-page');
		await page.locator('[data-testid=vader-item-install]').click();
		await page.waitForFunction(() => (window.__installed || []).some((x) => x.startsWith('mcp:')), null, { timeout: 15000 });
		const wrote = await page.evaluate(() => JSON.stringify(window.__mcpEntry));
		check('installing writes the entry the page showed', /server\.smithery\.ai|"command"/.test(wrote) && (!/smithery/.test(wrote) || /Bearer test-secret/.test(wrote)), wrote);
		check('no error in the page console', errors.length === 0, errors.join(' | '));
		await page.close();
	}

	// ===================================================================== sections
	{
		const { page } = await newPage();
		await tab(page, 'skills').click();
		await waitRows(page, 6);
		const before = await rows(page).count();
		await page.locator('[data-testid=vader-addons-section-documents]').click();
		await page.waitForFunction(() => document.querySelectorAll('[data-testid=vader-addon-row]').length > 0 && (window.__calls.skillsSh || []).includes('pdf'), null, { timeout: 15000 });
		const docNames = await rows(page).locator('[data-testid=vader-addon-name]').allInnerTexts();
		check('choosing "Documents and files" asks the sources for it and lists documents (pdf is there)', docNames.some((n) => /pdf|docx|xlsx/i.test(n)), docNames.join(','));
		check('a section shows fewer rows than "All" and says nothing about counts', docNames.length > 0 && docNames.length <= before + 12);
		await page.locator('[data-testid=vader-addons-section-testing]').click();
		await page.waitForTimeout(600);
		const testNames = await rows(page).locator('[data-testid=vader-addon-name]').allInnerTexts();
		check('another section lists other skills', testNames.join() !== docNames.join(), testNames.join(','));
		await page.getByRole('button', { name: 'All', exact: true }).first().click();
		await waitRows(page, 6);
		check('"All" brings the whole list back', (await rows(page).count()) >= 6);
		await tab(page, 'extensions').click();
		await waitRows(page, 3);
		const extChips = await page.locator('[data-testid=vader-addons-sections] button').allInnerTexts();
		check('the Extensions tab has Open VSX’s own sections', ['Programming languages', 'Linters', 'Formatters', 'Debuggers', 'Themes'].every((c) => extChips.includes(c)), extChips.join('|'));
		await page.locator('[data-testid=vader-addons-section-linters]').click();
		await page.waitForFunction(() => (window.__calls.openVsx || []).some((c) => c[1] === 'Linters'), null, { timeout: 15000 });
		check('choosing "Linters" asks Open VSX for its Linters category', true);
		await shot(page, 'extensions-linters');
		check('sections have no layout problem', (await layoutProblems(page)).length === 0, (await layoutProblems(page)).join('; '));
		await page.close();
	}

	// ===================================================================== an extension and an agent
	{
		const { page, errors } = await newPage();
		await tab(page, 'extensions').click();
		await waitRows(page, 3);
		await rows(page).first().locator('[data-testid=vader-addon-name]').first().click();
		await page.waitForSelector('[data-testid=vader-item-page][data-kind=extension]');
		check('an extension’s page has its icon, rating, installs and version up top', (await page.locator('[data-testid=vader-item-stats]').count()) === 1 && /installs/.test(await page.locator('[data-testid=vader-item-stats]').innerText()) && (await page.locator('[data-testid=vader-item-page] img[data-testid=vader-item-logo]').count()) === 1);
		const t = await page.locator('[data-testid^=vader-item-tab-]').allInnerTexts();
		check('an extension’s page has Details and Why NN%', t[0] === 'Details' && /^Why/.test(t[1]), t.join('|'));
		check('the extension page has no layout problem', (await layoutProblems(page)).length === 0, (await layoutProblems(page)).join('; '));
		await shot(page, 'extension-page');
		await page.locator('[data-testid=vader-item-install]').click();
		await page.waitForFunction(() => (window.__installed || []).some((x) => x.startsWith('ext:')), null, { timeout: 15000 });
		check('installing an extension asks the editor to install it by its identifier', true);
		await page.close();

		const a = await newPage();
		await tab(a.page, 'agents').click();
		await waitRows(a.page, 10);
		const agentNames = await rows(a.page).locator('[data-testid=vader-addon-name]').allInnerTexts();
		check('the Agents tab lists all ten agents Vader can connect', agentNames.length === 10 && ['Codex', 'Cursor', 'GitHub Copilot', 'OpenCode', 'Mistral Vibe', 'Grok Build', 'Kimi Code', 'Antigravity', 'Claude Code', 'Freebuff'].every((n) => agentNames.includes(n)), agentNames.join(','));
		check('an agent has no sections and no trust figure (its vendor, not a stranger, publishes it)', (await a.page.locator('[data-testid=vader-addons-sections]').count()) === 0 && (await rows(a.page).locator('[aria-label^="Trust"]').count()) === 0);
		const claude = rows(a.page).filter({ hasText: 'Claude Code' });
		check('the terminal agent’s button says "Set up" and the one that cannot run here says nothing', /Set up/.test(await claude.innerText()) && !/Install/.test(await rows(a.page).filter({ hasText: 'GitHub Copilot' }).innerText()));
		await rows(a.page).filter({ hasText: 'Cursor' }).locator('[data-testid=vader-addon-name]').first().click();
		await a.page.waitForSelector('[data-testid=vader-item-page][data-kind=agent]');
		check('an agent’s page has three steps, the plan note and the vendor’s own logo', (await a.page.locator('[data-testid=vader-item-step-list] > div').count()) === 3 && (await a.page.getByText('Plan, limits and cost').count()) === 1 && (await a.page.locator('svg[data-agent-logo=cursor]').count()) >= 1);
		check('the agent’s facts say who counts the cost', (await a.page.getByText('Counted by the vendor on your plan, not by Vader').count()) === 1);
		check('the agent page has no layout problem', (await layoutProblems(a.page)).length === 0, (await layoutProblems(a.page)).join('; '));
		await shot(a.page, 'agent-page');
		await a.page.locator('[data-testid=vader-item-install]').click();
		await a.page.waitForFunction(() => (window.__installed || []).includes('agent:cursor'), null, { timeout: 15000 });
		check('Install on an agent downloads it through the main-process service', true);
		await a.page.locator('[data-testid=vader-item-back]').click();
		await waitRows(a.page, 10);
		await claude.locator('[data-testid=vader-addon-install]').click();
		await a.page.waitForFunction(() => (window.__cmds || []).includes('workbench.action.openVaderSettings'), null, { timeout: 8000 });
		check('"Set up" opens Settings, where the command is shown first', true);
		check('no error in the page console', errors.length === 0 && a.errors.length === 0, [...errors, ...a.errors].join(' | '));
		await a.page.close();
	}

	// ===================================================================== search, failures, keyboard, See all
	{
		const { page } = await newPage();
		await waitRows(page, 6);
		await page.locator('[data-testid=vader-addons-search]').fill('pdf');
		await page.waitForFunction(() => (window.__calls.skillsSh || []).includes('pdf') && (window.__calls.smithery || []).includes('pdf'), null, { timeout: 15000 });
		await page.waitForTimeout(500);
		const found = await rows(page).locator('[data-testid=vader-addon-name]').allInnerTexts();
		check('a search asks every source for the words and lists what they found', found.some((n) => /pdf/i.test(n)) && found.length >= 3, found.join(','));
		await shot(page, 'search-pdf');
		await page.locator('[data-testid=vader-addons-search]').fill('');
		await waitRows(page, 6);
		await page.close();

		const f = await newPage({ fail: { searchSmithery: 'HTTP 503', searchGithubTopic: 'GitHub is limiting requests from this computer for now (it allows 60 an hour without a key). Try again in a few minutes.' } });
		await tab(f.page, 'mcp').click();
		await waitRows(f.page, 3);
		await f.page.waitForTimeout(1500);
		if (process.env.DEBUG_UI) { console.log((await f.page.locator('[data-testid=vader-addons-page]').innerText()).split(String.fromCharCode(10)).slice(0, 30).join(' / ')); await shot(f.page, 'debug-failing'); }
		const warn = await f.page.getByText(/could not be read just now/).first().innerText({ timeout: 4000 }).catch(() => 'NOT SHOWN');
		check('sources that fail are named on the page while the rest still show', /Smithery did not answer \(HTTP 503\)/.test(warn) && /GitHub is limiting requests/.test(warn) && (await rows(f.page).count()) >= 3, warn);
		await shot(f.page, 'sources-failing');
		await f.page.close();

		const k = await newPage();
		await k.page.locator('[data-testid=vader-addons-tab-skills]').click();
		await waitRows(k.page, 6);
		await rows(k.page).first().focus();
		await k.page.keyboard.press('Enter');
		await k.page.waitForSelector('[data-testid=vader-item-page]');
		check('the keyboard opens an item (Enter on a focused row)', true);
		await k.page.locator('[data-testid=vader-item-back]').focus();
		await k.page.keyboard.press('Enter');
		await waitRows(k.page, 6);
		check('and Back works from the keyboard', true);
		await k.page.locator('[data-testid=vader-addons-tab-all]').click();
		await waitRows(k.page, 6);
		await k.page.getByRole('button', { name: 'See all' }).first().click();
		await k.page.waitForFunction(() => document.querySelector('[data-testid=vader-addons-tab-skills]')?.getAttribute('aria-selected') === 'true', null, { timeout: 5000 });
		check('"See all" on the front page goes to that kind’s tab', true);
		await k.page.close();

		const slow = await newPage({ delay: 1500 });
		await slow.page.locator('[data-testid=vader-addons-tab-mcp]').click();
		await slow.page.waitForTimeout(300);
		check('while the sources are still answering the page says it is loading', (await slow.page.getByText('Loading...').count()) === 1);
		await slow.page.close();
	}
} finally {
	await browser.close();
	server.close();
	fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed\nscreenshots: ${shots}`);
process.exitCode = failed ? 1 : 0;
