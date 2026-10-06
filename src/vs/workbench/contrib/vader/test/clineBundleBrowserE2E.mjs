#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Proves the generated browser/agentRuntime/clineBundle/index.js works where it actually runs: a
// sandboxed renderer with NO Node. The packaged Windows build once opened to a blank window because
// the renderer imported the bare specifier '@cline/agents'; a Node-based smoke test could never see
// that. This loads the bundle into headless Chromium (no require/process/Buffer) and runs the real
// AgentRuntime scenarios from clineRuntimeSmoke.mjs against it.
//
// Run: npm run buildcline && node src/vs/workbench/contrib/vader/test/clineBundleBrowserE2E.mjs
// Env: CHROME_PATH (optional Chromium executable)

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.resolve(here, '../browser/agentRuntime/clineBundle/index.js');
if (!fs.existsSync(bundle)) { console.error('Missing clineBundle/index.js - run `npm run buildcline` first.'); process.exit(2); }

// Reuse the existing scenarios, swapping the Node-only parts for browser equivalents.
let smoke = fs.readFileSync(path.join(here, 'clineRuntimeSmoke.mjs'), 'utf8')
	.replace("import { AgentRuntime } from '@cline/agents';", "import { AgentRuntime } from './bundle.js';")
	.replace(/import \{ execFileSync \}.*\n/, '').replace(/import \{ fileURLToPath \}.*\n/, '').replace(/import \{ dirname, resolve \}.*\n/, '')
	.replace(/\n\{\n\tconst __dirname[\s\S]*?\n\}\n/, '\n')
	.replaceAll('process.exit(failed > 0 ? 1 : 0);', 'globalThis.__result = { passed, failed };')
	.replace("console.error('Smoke test crashed:', e); process.exit(1);", "console.error('Smoke test crashed:', e); globalThis.__result = { passed, failed: failed + 1, crashed: String(e) };")
	.replace('console.error(`FAIL', 'console.log(`FAIL');
if (/\bprocess\.|node:/.test(smoke)) { console.error('Smoke scenarios still reference Node APIs; update the transform.'); process.exit(2); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-cline-e2e-'));
fs.copyFileSync(bundle, path.join(dir, 'bundle.js'));
fs.writeFileSync(path.join(dir, 'smoke.mjs'), smoke);
fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><script type="module" src="./smoke.mjs"></script>');

const server = http.createServer((req, res) => {
	const f = path.join(dir, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
	if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
	res.setHeader('content-type', f.endsWith('.html') ? 'text/html' : 'text/javascript');
	res.end(fs.readFileSync(f));
}).listen(0);

let passed = 0, failed = 0;
const check = (name, ok, detail) => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

function findChromium() {
	if (process.env.CHROME_PATH) { return process.env.CHROME_PATH; }
	const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
	try {
		for (const d of fs.readdirSync(root).filter(n => /^chromium-\d+$/.test(n)).sort().reverse()) {
			for (const rel of ['chrome-linux/chrome', 'chrome-win/chrome.exe', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
				const f = path.join(root, d, rel); if (fs.existsSync(f)) { return f; }
			}
		}
	} catch { /* fall through to Playwright's own lookup */ }
	return undefined;
}

const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (/^(PASS|FAIL):/.test(m.text())) { console.log(`  [runtime] ${m.text()}`); } });
await page.goto('about:blank');
check('environment has no Node globals (process/require/Buffer)', await page.evaluate(() => typeof process === 'undefined' && typeof require === 'undefined' && typeof Buffer === 'undefined'));
await page.goto(`http://localhost:${server.address().port}/`);
const result = await page.waitForFunction(() => globalThis.__result, null, { timeout: 90_000 }).then(h => h.jsonValue(), () => undefined);
check('bundle loads without a module-resolution or load error', errors.length === 0, errors.join(' | '));
check('AgentRuntime scenarios ran to completion', !!result && !result.crashed, result?.crashed ?? 'timed out');
check('all AgentRuntime scenarios pass in the browser', !!result && result.failed === 0 && result.passed > 0, JSON.stringify(result));
const text = fs.readFileSync(bundle, 'utf8');
check("bundle contains no bare module imports left for the renderer to resolve", !/(^|;|\})\s*(import|export)[^;'"]*from\s*['"][^./'"]/.test(text) && !/\bimport\(['"][^./'"]/.test(text));

await browser.close(); server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
