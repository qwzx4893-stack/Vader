/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Restart behaviour: what a person expects to still be there after closing and reopening the app.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, sleep } from '../app.mjs';
import { createModelServer } from '../modelServer.mjs';
import { config, makeWorkspace, results } from '../harness.mjs';
import * as ui from '../ui.mjs';

export async function runPersistenceGroup() {
	const name = 'persistence';
	if (config.only && !config.only.test(name)) { return; }
	console.log(`\n=== group: ${name} ===`);
	if (!config.natives) {
		// state is stored with the native sqlite module; without it nothing can be saved, so this cannot be tested here
		console.log('SKIP: restart persistence - needs native modules (@vscode/sqlite3) that are not built on this machine');
		results.push({ group: name, name: 'restart: provider, model and chat history survive closing and reopening the app', status: 'skip', checks: [], error: 'needs native modules (@vscode/sqlite3)', ms: 0 });
		return;
	}
	const rec = { group: name, name: 'restart: provider, model and chat history survive closing and reopening the app', status: 'pass', checks: [], ms: 0 };
	const t0 = Date.now();
	const check = (n, ok, detail = '') => { rec.checks.push({ name: n, ok: !!ok, detail: String(detail).slice(0, 300) }); console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${n}${!ok && detail ? ` - ${String(detail).slice(0, 300)}` : ''}`); if (!ok) { rec.status = 'fail'; } };
	const server = await createModelServer({ modelIds: ['gpt-4o'], responder: (c) => ({ text: c.lastUser.includes('remember') ? 'You told me to remember: blue.' : 'Nice to meet you.' }) });
	const ws = makeWorkspace(name);
	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-e2e-persist-'));
	const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-e2e-persist-ext-'));
	let app;
	try {
		app = await launchApp({ exe: config.exe, workspace: ws, userDataDir, extensionsDir, extraArgs: config.extraArgs });
		await sleep(1500);
		check('first run shows the onboarding', await ui.isOnboarding(app.page));
		await ui.completeOnboarding(app.page, { baseURL: server.url, model: 'gpt-4o' });
		await ui.sendMessage(app.page, 'please remember the colour blue');
		await ui.waitForIdle(app.page);
		const before = await ui.assistantTexts(app.page);
		check('a conversation took place', before.some(x => x.includes('remember: blue')), JSON.stringify(before));
		await sleep(1500); // let the thread be written out
		const graceful = await app.closeGracefully();
		check('the app exits cleanly when the window is closed', graceful, `exit=${JSON.stringify(app.exited())} log tail: ${app.mainOutput().split(/\r?\n/).filter(l => !/DEP0040|trace-deprecation/.test(l)).slice(-6).join(' | ').slice(0, 500)}`);

		server.reset();
		app = await launchApp({ exe: config.exe, workspace: ws, userDataDir, extensionsDir, extraArgs: config.extraArgs });
		await sleep(2500);
		check('second run does NOT show the onboarding again', !(await ui.isOnboarding(app.page)), (await app.page.locator('.void-scope').first().innerText().catch(() => '')).slice(0, 200));
		const hasChat = await app.page.locator(ui.CHAT_INPUT).count();
		check('the chat is ready without any setup', hasChat > 0);
		// the previous conversation is in the thread list
		await app.page.locator('[aria-label^="View Past Chats"]').first().click();
		await sleep(800);
		const body = await app.page.evaluate(() => document.body.innerText);
		check('the earlier chat is listed under previous threads', /please remember the colour blue/.test(body), body.slice(-300));
		await app.page.getByText('please remember the colour blue').first().click();
		await sleep(800);
		check('opening it shows the earlier messages', (await ui.assistantTexts(app.page)).some(x => x.includes('remember: blue')));
		// and the saved provider still works
		await ui.sendMessage(app.page, 'hello again');
		await ui.waitForIdle(app.page);
		check('the saved provider and API key still work after the restart', (await ui.assistantTexts(app.page)).some(x => x.includes('Nice to meet you.')) && server.chatRequests().length >= 1);
		const req = server.chatRequests()[0];
		check('the history of the reopened chat is sent to the model', req?.ctx.allText.includes('remember the colour blue'));
	} catch (e) {
		rec.status = 'fail'; rec.error = String(e?.stack ?? e).slice(0, 600); console.log(`  FAIL: ${String(e?.message ?? e).slice(0, 300)}`);
	} finally {
		if (app) { await app.close(); }
		await server.close();
	}
	rec.ms = Date.now() - t0;
	results.push(rec);
	console.log(`  => ${rec.status.toUpperCase()} (${rec.ms} ms)`);
}
