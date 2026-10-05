/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// TEST-ONLY. Launches the real packaged Vader app and attaches Playwright over CDP (Electron apps are driven
// as browsers). Used by the end-to-end suite; see suite.mjs.

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function loadPlaywright() {
	return require(process.env.PW_CORE || 'playwright-core');
}

/**
 * @param {{ exe: string, workspace?: string, userDataDir?: string, extensionsDir?: string, port?: number,
 *           extraArgs?: string[], env?: Record<string,string>, label?: string }} opts
 */
export async function launchApp(opts) {
	const { chromium } = loadPlaywright();
	const port = opts.port ?? (9300 + Math.floor(Math.random() * 500));
	const userDataDir = opts.userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'vader-e2e-ud-'));
	const extensionsDir = opts.extensionsDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'vader-e2e-ext-'));
	const args = [
		`--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, `--extensions-dir=${extensionsDir}`,
		'--skip-welcome', '--skip-release-notes', '--disable-telemetry', '--disable-workspace-trust', '--disable-updates',
		'--new-window', ...(opts.extraArgs ?? []),
	];
	if (opts.workspace) { args.push(opts.workspace); }
	const out = [];
	// a throwaway home directory: the app keeps part of its state in ~/.vader-editor (e.g. mcp.json) and a test must not touch the real one
	const home = opts.home ?? fs.mkdtempSync(path.join(os.tmpdir(), 'vader-e2e-home-'));
	const homeEnv = process.platform === 'win32' ? { USERPROFILE: home, HOMEDRIVE: path.parse(home).root.replace(/\\$/, ''), HOMEPATH: home.slice(path.parse(home).root.length - 1) } : { HOME: home };
	const child = spawn(opts.exe, args, { env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', ...homeEnv, ...(opts.env ?? {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
	child.stdout.on('data', d => out.push(String(d)));
	child.stderr.on('data', d => out.push(String(d)));
	let exited = null;
	child.on('exit', (code, sig) => { exited = { code, sig }; });

	let browser;
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline && !exited) {
		try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 5000 }); break; } catch { await sleep(1500); }
	}
	if (!browser) { throw new Error(`app did not expose CDP${exited ? ` (exited early: ${JSON.stringify(exited)})` : ''}\n${out.join('').slice(-1500)}`); }

	const ctx = browser.contexts()[0];
	let page;
	const t = Date.now() + 60_000;
	while (Date.now() < t && !page) {
		page = ctx.pages().find(p => /workbench/i.test(p.url()));
		if (!page) { await sleep(500); }
	}
	if (!page) { throw new Error('no workbench window appeared'); }
	await page.waitForSelector('.monaco-workbench .part', { timeout: 60_000 });

	const problems = [];
	page.on('pageerror', e => problems.push(`pageerror: ${String(e).slice(0, 400)}`));
	page.on('console', m => { if (m.type() === 'error') { problems.push(`console.error: ${m.text().slice(0, 400)}`); } });

	return {
		page, browser, port, userDataDir, extensionsDir, home, problems,
		mainOutput: () => out.join(''),
		exited: () => exited,
		/** Closes the window the way a user does (so the app flushes its state to disk), then falls back to killing it. */
		async closeGracefully(timeoutMs = 25_000) {
			try {
				await page.keyboard.press('F1');
				await page.waitForSelector('.quick-input-widget', { state: 'visible', timeout: 5000 });
				await page.keyboard.type('Close Window');
				await sleep(600);
				await page.keyboard.press('Enter');
			} catch { /* fall through to the hard close */ }
			const end = Date.now() + timeoutMs;
			while (Date.now() < end && !exited) { await sleep(300); }
			if (!exited) {
				// say what the window looked like, so a CI log is enough to see why it did not quit
				const state = await page.evaluate(() => ({ title: document.title, dialogs: [...document.querySelectorAll('.monaco-dialog-box, .quick-input-widget, .notifications-toasts .notification-list-item')].filter(e => e.offsetParent).map(e => e.innerText.replace(/\s+/g, ' ').slice(0, 160)) })).catch(e => ({ unreachable: String(e).slice(0, 100) }));
				console.log(`  [diag] app still running ${timeoutMs} ms after Close Window: ${JSON.stringify(state)}`);
			}
			const graceful = !!exited;
			await this.close();
			return graceful;
		},
		async close() {
			try { await browser.close(); } catch { /* ignore */ }
			if (process.platform === 'win32') { try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ } }
			else { try { process.kill(child.pid, 'SIGKILL'); } catch { /* ignore */ } }
			await sleep(500);
		},
	};
}
