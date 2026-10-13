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
		check('second run does NOT show the onboarding again', !(await ui.isOnboarding(app.page)), await app.page.locator('.vader-scope').getByText('Get Started', { exact: true }).first().evaluate(e => `${document.querySelectorAll('.vader-scope').length} scopes; context: ${(e.closest('[class*="vader-"]')?.parentElement?.parentElement?.innerText ?? e.innerText).replace(/\s+/g, ' ').slice(0, 220)}`).catch(() => 'no Get Started text'));
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

/**
 * A person installing a new build over an earlier one: nothing the earlier build stored is used (the welcome screen shows, the old chat does not come back, the old
 * keys are removed from disk), and a chat that was closed while a tool request still waited for approval opens ready for a new message instead of stuck on it.
 */
export async function runUpgradeGroup() {
	const name = 'persistence';
	if (config.only && !config.only.test(name)) { return; }
	const title = 'upgrade: data left by an earlier build is not inherited, and a chat closed mid-approval opens ready to use';
	console.log(`\n=== group: ${name} (upgrade) ===`);
	if (!config.natives) {
		console.log('SKIP: upgrade - needs native modules (@vscode/sqlite3) that are not built on this machine');
		results.push({ group: name, name: title, status: 'skip', checks: [], error: 'needs native modules (@vscode/sqlite3)', ms: 0 });
		return;
	}
	const rec = { group: name, name: title, status: 'pass', checks: [], ms: 0 };
	const t0 = Date.now();
	const check = (n, ok, detail = '') => { rec.checks.push({ name: n, ok: !!ok, detail: String(detail).slice(0, 300) }); console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${n}${!ok && detail ? ` - ${String(detail).slice(0, 300)}` : ''}`); if (!ok) { rec.status = 'fail'; } };
	let asked = 0;
	const server = await createModelServer({
		modelIds: ['gpt-4o'],
		responder: () => (++asked === 1
			? { text: 'I will edit the file.', toolCalls: [{ name: 'edit_file', args: { uri: path.join(ws, 'src', 'app.js'), search_replace_blocks: '<<<<<<< ORIGINAL\nfunction add\n=======\nfunction add\n>>>>>>> UPDATED' } }] }
			: { text: 'Ready for the next message.' }),
	});
	const ws = makeWorkspace('upgrade');
	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-e2e-upgrade-'));
	const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-e2e-upgrade-ext-'));
	const dbFile = path.join(userDataDir, 'User', 'globalStorage', 'state.vscdb');
	const withDb = async (fn) => {
		const { DatabaseSync } = await import('node:sqlite');
		const db = new DatabaseSync(dbFile);
		try { return fn(db); } finally { db.close(); }
	};
	let app;
	try {
		// run 1: set up, leave a tool request waiting for approval, close the window
		app = await launchApp({ exe: config.exe, workspace: ws, userDataDir, extensionsDir, extraArgs: config.extraArgs });
		await sleep(1500);
		await ui.completeOnboarding(app.page, { baseURL: server.url, model: 'gpt-4o' });
		await ui.sendMessage(app.page, 'please change the add function');
		check('a tool request is waiting for approval', await ui.waitForApproval(app.page, 40_000));
		await sleep(2000); // let the thread be written out
		await app.closeGracefully();

		// run 2: the same data, reopened. The unanswered request must not hold the chat.
		server.reset(); asked = 1;
		app = await launchApp({ exe: config.exe, workspace: ws, userDataDir, extensionsDir, extraArgs: config.extraArgs });
		await sleep(2500);
		await app.page.locator('[aria-label^="View Past Chats"]').first().click();
		await sleep(800);
		await app.page.getByText('please change the add function').first().click();
		await sleep(1200);
		check('the earlier chat reopens without an approval still waiting', !(await ui.approvalPending(app.page)));
		await ui.sendMessage(app.page, 'are you still there?');
		await ui.waitForIdle(app.page);
		check('and a new message can be sent and answered', (await ui.assistantTexts(app.page)).some(x => x.includes('Ready for the next message.')), JSON.stringify(await ui.assistantTexts(app.page)));
		await sleep(1500);
		await app.closeGracefully();

		// run 3: what an earlier build left behind (its welcome state, its chats) is under the old keys only
		await withDb(db => {
			db.prepare("DELETE FROM ItemTable WHERE key IN ('vader.settingsServiceStorageIII','vader.chatThreadStorageIII')").run();
			const ins = db.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)');
			ins.run('vader.settingsServiceStorageII', JSON.stringify({ globalSettings: { isOnboardingComplete: true } }));
			ins.run('vader.chatThreadStorageII', JSON.stringify({ stale: { id: 'stale', messages: [{ role: 'user', content: 'a chat from the earlier build', displayContent: 'a chat from the earlier build' }] } }));
		});
		app = await launchApp({ exe: config.exe, workspace: ws, userDataDir, extensionsDir, extraArgs: config.extraArgs });
		await sleep(2500);
		check('with only an earlier build\'s data present, the welcome screen shows', await ui.isOnboarding(app.page));
		check('the earlier build\'s chat does not come back', !(await app.page.evaluate(() => document.body.innerText)).includes('a chat from the earlier build'));
		await app.closeGracefully();
		const left = await withDb(db => db.prepare("SELECT key FROM ItemTable WHERE key IN ('vader.settingsServiceStorageII','vader.chatThreadStorageII')").all().map(r => r.key));
		check('the earlier build\'s stored data (including its encrypted keys) is removed from disk', left.length === 0, left.join(','));
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
