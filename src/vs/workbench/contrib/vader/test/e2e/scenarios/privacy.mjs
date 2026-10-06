/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Privacy: an editor that runs an AI agent over a user's code must not talk to anyone the user did not configure. The app is
// started with Chromium's net-log on (it records every URL request of every process, including the browser-process ones the
// page cannot see: component updater, connectivity checks, push registration), is used the way a user would (onboarding, a chat,
// settings, the command palette, a long idle) and every request is checked: only the local model server the user set up and
// the app's own internal schemes are allowed. Before the Chromium background-network switches in src/main.ts were added, a
// freshly started Vader contacted redirector.gvt1.com, www.google.com and android.clients.google.com.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, sleep } from '../app.mjs';
import { createModelServer } from '../modelServer.mjs';
import { config, makeWorkspace, results } from '../harness.mjs';
import * as ui from '../ui.mjs';

const INTERNAL_SCHEMES = /^(vscode-file|vscode-webview|vscode-resource|devtools|chrome|chrome-extension|chrome-untrusted|data|blob|file|about|ws|wss):/i;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export function externalHostsInNetLog(text) {
	const hosts = new Map();
	for (const m of text.matchAll(/"url":"((?:https?|wss?):\/\/[^"\\]+)/g)) {
		let u; try { u = new URL(m[1]); } catch { continue; }
		if (LOCAL_HOSTS.has(u.hostname) || INTERNAL_SCHEMES.test(m[1])) { continue; }
		hosts.set(u.host, (hosts.get(u.host) ?? 0) + 1);
	}
	return hosts;
}

export async function runPrivacyGroup() {
	const name = 'privacy';
	if (config.only && !config.only.test(name)) { return; }
	console.log(`\n=== group: ${name} ===`);
	const rec = { group: name, name: 'privacy: a started, configured and used app makes no request to any host the user did not configure', status: 'pass', checks: [], ms: 0 };
	const t0 = Date.now();
	const check = (n, ok, detail = '') => { rec.checks.push({ name: n, ok: !!ok, detail: String(detail).slice(0, 400) }); console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${n}${!ok && detail ? ` - ${String(detail).slice(0, 400)}` : ''}`); if (!ok) { rec.status = 'fail'; } };
	const server = await createModelServer({ modelIds: ['gpt-4o'], responder: () => ({ text: 'Hello from the local test model.' }) });
	const ws = makeWorkspace(name);
	const netlog = path.join(os.tmpdir(), `vader-netlog-${Date.now()}.json`);
	let app;
	try {
		app = await launchApp({ exe: config.exe, workspace: ws, extraArgs: [...config.extraArgs, `--log-net-log=${netlog}`] });
		await sleep(1500);
		await ui.completeOnboarding(app.page, { baseURL: server.url, model: 'gpt-4o' });
		await ui.sendMessage(app.page, 'say hello');
		await ui.waitForIdle(app.page);
		await ui.runCommand(app.page, 'Vader: Open Settings');
		await sleep(1500);
		await app.page.keyboard.press('Control+Shift+G'); await sleep(800);
		await app.page.keyboard.press('Control+Shift+F'); await sleep(800);
		await ui.openFile(app.page, 'notes.txt');
		// background networking in Chromium starts after the first minute of life on some platforms: stay up long enough to see it
		await sleep(Number(process.env.E2E_PRIVACY_IDLE_MS ?? 75_000));
		check('the chat worked against the local server', (await ui.assistantTexts(app.page)).some(x => x.includes('Hello from the local test model.')));
		await app.closeGracefully();
		await sleep(1000);
		const text = fs.existsSync(netlog) ? fs.readFileSync(netlog, 'utf8') : '';
		check('the network log was written and is not empty', text.length > 1000, `${text.length} bytes`);
		const external = externalHostsInNetLog(text);
		check('no request went to a host the user did not configure', external.size === 0, [...external].map(([h, n]) => `${h} x${n}`).join(', '));
	} catch (e) {
		rec.status = 'fail'; rec.error = String(e?.stack ?? e).slice(0, 600); console.log(`  FAIL: ${String(e?.message ?? e).slice(0, 300)}`);
	} finally {
		if (app) { await app.close(); }
		await server.close();
		try { fs.rmSync(netlog, { force: true }); } catch { /* ignore */ }
	}
	rec.ms = Date.now() - t0;
	results.push(rec);
	console.log(`  => ${rec.status.toUpperCase()} (${rec.ms} ms)`);
}
