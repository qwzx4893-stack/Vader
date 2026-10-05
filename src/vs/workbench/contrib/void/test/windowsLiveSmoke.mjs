#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Live smoke test for the PACKAGED Windows build (run by .github/workflows/windows-smoke.yml on a
// real Windows runner against the installed release, not against a dev checkout). Launches the
// installed executable, attaches Playwright over CDP (Electron apps are driven as browsers, not via
// UI Automation), and reports - in the job log, since artifact downloads are not always reachable -
// whether the workbench actually rendered, plus every renderer error and the tail of the app's own logs.
//
// Env: VADER_EXE (required), RUN_LABEL, EXTRA_ARGS, CDP_PORT, SMOKE_OUT, PW_CORE (playwright-core path),
//      SMOKE_IGNORE (extra regex of renderer messages to treat as known noise)

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_CORE || 'playwright-core');

const exe = process.env.VADER_EXE;
if (!exe || !fs.existsSync(exe)) { console.error(`VADER_EXE missing or not found: ${exe}`); process.exit(2); }
const label = process.env.RUN_LABEL || 'default';
const extraArgs = (process.env.EXTRA_ARGS || '').split(' ').filter(Boolean);
const port = Number(process.env.CDP_PORT || 9222);
const outDir = path.resolve(process.env.SMOKE_OUT || './smoke-out', label);
fs.mkdirSync(outDir, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-ud-'));
const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-ext-'));

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` - ${detail}` : ''}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const short = (s, n = 400) => String(s).replace(/\s+/g, ' ').slice(0, n);

const mainOut = [];
const child = spawn(exe, [
	`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, `--extensions-dir=${extDir}`,
	'--skip-welcome', '--skip-release-notes', '--disable-telemetry', '--disable-workspace-trust', ...extraArgs,
], { env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', ELECTRON_ENABLE_STACK_DUMPING: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', d => mainOut.push(String(d)));
child.stderr.on('data', d => mainOut.push(String(d)));
let exited = null;
child.on('exit', (code, sig) => { exited = { code, sig }; });

// Messages that are known to be harmless. Each is still printed (as "known noise"), just not counted as a failure.
//  - zod 4 probes for JIT support with `try { Function('') } catch {}`; Trusted Types blocks it, zod falls back.
//  - a fresh profile has no extensions folder yet.
const knownNoise = [/This document requires 'TrustedScript' assignment/, /Unable to resolve nonexistent file '[^']*[\\/]extensions'/];
if (process.env.SMOKE_IGNORE) { knownNoise.push(new RegExp(process.env.SMOKE_IGNORE)); }
const rendererProblems = [];
function watchPage(page) {
	page.on('console', m => { if (m.type() === 'error' && !/^Request Autofill\./.test(m.text())) { rendererProblems.push(`console.error: ${short(m.text())}`); } });
	page.on('pageerror', e => rendererProblems.push(`pageerror: ${short(e)}`));
	page.on('requestfailed', r => rendererProblems.push(`requestfailed: ${r.url().slice(0, 160)} ${r.failure()?.errorText}`));
}

async function connect() {
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline && !exited) {
		try { return await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 5000 }); } catch { await sleep(1500); }
	}
	return undefined;
}

async function main() {
	console.log(`::group::[${label}] launch ${exe} ${extraArgs.join(' ')}`);
	const browser = await connect();
	check('app process stays alive and exposes CDP', !!browser, exited ? `exited early: ${JSON.stringify(exited)}` : '');
	console.log('::endgroup::');
	if (!browser) { return; }

	const ctx = browser.contexts()[0];
	ctx.pages().forEach(watchPage);
	ctx.on('page', watchPage);

	let page;
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline && !page) {
		page = ctx.pages().find(p => /workbench/i.test(p.url()));
		if (!page) { await sleep(1000); }
	}
	try {
		const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
		console.log('CDP targets:', targets.map(t => `${t.type}:${t.url.slice(0, 120)}`).join(' | '));
	} catch { /* diagnostic only */ }
	check('workbench window target exists', !!page, page ? page.url().slice(0, 120) : `pages: ${ctx.pages().map(p => p.url().slice(0, 80)).join(', ')}`);
	if (!page) { return; }

	// Give the workbench time to bootstrap, but poll for the signal instead of a fixed sleep.
	const rendered = await page.waitForSelector('.monaco-workbench .part', { timeout: 60_000 }).then(() => true, () => false);
	await sleep(3000);
	await page.screenshot({ path: path.join(outDir, 'window.png') }).catch(() => { });

	const dom = await page.evaluate(() => ({
		title: document.title,
		readyState: document.readyState,
		bodyBg: getComputedStyle(document.body).backgroundColor,
		workbench: !!document.querySelector('.monaco-workbench'),
		parts: document.querySelectorAll('.monaco-workbench .part').length,
		statusbar: !!document.querySelector('.statusbar'),
		sidebar: !!document.querySelector('.sidebar'),
		styleSheets: document.styleSheets.length,
		scripts: [...document.scripts].map(s => s.src.split('/').slice(-2).join('/')).slice(0, 8),
		text: document.body.innerText.slice(0, 300),
		html: document.body.innerHTML.length,
	})).catch(e => ({ error: String(e) }));
	console.log('DOM:', JSON.stringify(dom));
	fs.writeFileSync(path.join(outDir, 'dom.json'), JSON.stringify(dom, null, 2));

	check('workbench parts rendered (not a blank/gray window)', rendered && dom.parts >= 3, `parts=${dom.parts} bodyBg=${dom.bodyBg} htmlLen=${dom.html}`);
	check('window title mentions Vader', /vader/i.test(dom.title || ''), `title="${dom.title}"`);

	if (rendered) {
		await page.keyboard.press('F1');
		const palette = await page.waitForSelector('.quick-input-widget', { state: 'visible', timeout: 15_000 }).then(() => true, () => false);
		check('command palette opens (UI responds to input)', palette);
		if (palette) {
			await page.keyboard.type('Vader');
			await sleep(1500);
			const entries = await page.$$eval('.quick-input-list .monaco-list-row', els => els.map(e => e.textContent.trim().slice(0, 80)).slice(0, 15));
			console.log('Palette entries for "Vader":', JSON.stringify(entries));
			check('Vader commands are registered in the palette', entries.some(e => /vader|void/i.test(e)), `${entries.length} entries`);
			await page.keyboard.press('Escape');
		}
	}

	await sleep(3000);
	const allProblems = [...new Set(rendererProblems)];
	const uniqueProblems = allProblems.filter(p => !knownNoise.some(re => re.test(p)));
	allProblems.filter(p => !uniqueProblems.includes(p)).forEach(p => console.log('  known noise (ignored):', p.slice(0, 160)));
	check('no renderer errors / failed requests after attach', uniqueProblems.length === 0, `${uniqueProblems.length} problem(s)`);
	uniqueProblems.slice(0, 30).forEach(p => console.log('  renderer problem:', p));
	await browser.close().catch(() => { });
}

function dumpLogs() {
	console.log(`::group::[${label}] application logs (user-data-dir/logs)`);
	const files = [];
	const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : e.name.endsWith('.log') && files.push(p); } };
	try { walk(path.join(userData, 'logs')); } catch { console.log('(no logs directory)'); }
	const interesting = /error|fail|cannot|exception|uncaught|ENOENT|MODULE_NOT_FOUND|denied/i;
	for (const f of files.slice(0, 40)) {
		const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
		const hits = lines.filter(l => interesting.test(l)).slice(0, 12);
		if (hits.length) { console.log(`--- ${path.relative(userData, f)} (${hits.length} notable line(s))`); hits.forEach(l => console.log('  ' + l.slice(0, 300))); }
		fs.copyFileSync(f, path.join(outDir, path.relative(userData, f).replace(/[\\/]/g, '__')));
	}
	console.log('--- main process stdout/stderr (notable lines)');
	mainOut.join('').split(/\r?\n/).filter(l => interesting.test(l)).slice(0, 40).forEach(l => console.log('  ' + l.slice(0, 300)));
	fs.writeFileSync(path.join(outDir, 'main-output.txt'), mainOut.join(''));
	console.log('::endgroup::');
}

let crashed = false;
try { await main(); } catch (e) { crashed = true; check('smoke harness ran to completion', false, String(e).slice(0, 300)); }
dumpLogs();
try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* best effort */ }
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ label, results }, null, 2));
const failed = results.filter(r => !r.ok).length;
console.log(`\n[${label}] ${results.length - failed} passed, ${failed} failed${crashed ? ' (harness crashed)' : ''}`);
process.exit(failed ? 1 : 0);
