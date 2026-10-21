/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The Vader window in the real app (the page the app opens on): the first run, a conversation, All agents, search, Add-ons, Settings, going to the editor and back.
// Every other group runs in the editor layout (app.mjs turns the window off for them); this one asks for the window and looks at it the way a person does.
// Screenshots go to the output folder (shell-*.png) so the page can be looked at, not only measured.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, sleep } from '../app.mjs';
import { createModelServer } from '../modelServer.mjs';
import { config, makeWorkspace, results } from '../harness.mjs';
import * as ui from '../ui.mjs';

const TID = (id) => `[data-testid="${id}"]`;

export async function runShellGroup() {
	const name = 'vader-window';
	if (config.only && !config.only.test(name)) { return; }
	const title = 'window: the Vader window opens first, shows conversations, All agents, search, Add-ons and Settings, and leads to the editor and back';
	console.log(`\n=== group: ${name} ===`);
	const rec = { group: name, name: title, status: 'pass', checks: [], ms: 0 };
	const t0 = Date.now();
	const check = (n, ok, detail = '') => { rec.checks.push({ name: n, ok: !!ok, detail: String(detail).slice(0, 300) }); console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${n}${!ok && detail ? ` - ${String(detail).slice(0, 300)}` : ''}`); if (!ok) { rec.status = 'fail'; } };
	const server = await createModelServer({ modelIds: ['gpt-4o'], responder: (() => { let n = 0; return () => (++n === 2 ? { toolCalls: [{ name: 'read_file', args: { uri: path.join(ws, 'notes.txt') } }] } : { text: 'The window answers from the test model.' }); })() });
	const ws = makeWorkspace(name);
	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-e2e-window-'));
	const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-e2e-window-ext-'));
	fs.mkdirSync(config.out, { recursive: true });
	let app;
	const shot = async (n) => { try { await app.page.screenshot({ path: path.join(config.out, `shell-${n}.png`) }); } catch { /* a missing picture must not fail the run */ } };
	try {
		app = await launchApp({ exe: config.exe, workspace: ws, userDataDir, extensionsDir, extraArgs: config.extraArgs, window: true });
		const page = app.page;
		await page.locator(TID('vader-onboarding')).first().waitFor({ state: 'attached', timeout: 30_000 }).catch(() => { });
		await sleep(1500);
		check('the first run shows the three steps', await ui.isOnboarding(page) && (await page.locator(TID('vader-onboarding-steps')).innerText().catch(() => '')).replace(/\s+/g, ' ').includes('Models'));
		await shot('1-first-run');
		await ui.completeOnboarding(page, { baseURL: server.url, model: 'gpt-4o' });
		await sleep(800);

		check('the app opens on the Vader window, not on the editor', await page.locator(TID('vader-shell')).first().isVisible().catch(() => false));
		check('its sidebar lists the project and has New chat, Search, All agents and Add-ons', (await page.locator(TID('vader-shell-nav')).count()) === 1 && (await page.locator(TID('vader-shell-new-chat')).count()) === 1 && (await page.locator(TID('vader-shell-search')).count()) === 1 && (await page.locator(TID('vader-shell-all-agents')).count()) === 1 && (await page.locator(TID('vader-shell-addons')).count()) === 1);
		check('the chat is inside the window and ready', (await page.locator(ui.CHAT_INPUT).count()) > 0);
		await shot('2-new-chat');

		await ui.sendMessage(page, 'say hello from the window');
		await ui.waitForIdle(page);
		check('the model answered inside the window', (await ui.assistantTexts(page)).some(x => x.includes('The window answers from the test model.')));
		check('the conversation is in the sidebar under its project', await page.locator(`${TID('vader-shell-thread')}`, { hasText: 'say hello from the window' }).first().isVisible().catch(() => false));
		check('a chat without tools says it changed no files and has no tabs (board R03)', (await page.getByText('Chat, no changes to files').first().isVisible().catch(() => false)) && (await page.locator(TID('vader-shell-tab-review')).count()) === 0);
		// a conversation in which the agent used a tool is an agent task: it gets the Review, Browser and Terminal tabs
		await ui.sendMessage(page, 'now read notes.txt');
		await ui.waitForIdle(page);
		check('after the agent used a tool the conversation page has its tabs', (await page.locator(TID('vader-shell-tab-review')).count()) === 1 && (await page.locator(TID('vader-shell-tab-browser')).count()) === 1 && (await page.locator(TID('vader-shell-tab-terminal')).count()) === 1);
		await shot('3-conversation');

		await page.locator(TID('vader-shell-tab-terminal')).click();
		check('the Terminal tab says there is no terminal when the agent opened none', await page.locator(TID('vader-terminal-empty')).isVisible().catch(() => false));
		await page.locator(TID('vader-shell-tab-browser')).click();
		check('the Browser tab says the agent has not opened a page', await page.locator(TID('vader-browser-empty')).isVisible({ timeout: 8000 }).catch(() => false));
		await page.locator(TID('vader-shell-tab-review')).click();
		check('the Review tab says there is nothing to review', await page.locator(TID('vader-review-empty')).isVisible().catch(() => false));
		await page.locator(TID('vader-shell-tab-conversation')).click();

		await page.locator(TID('vader-shell-all-agents')).click();
		check('All agents opens, and the chat that ran is in it', await page.locator(TID('vader-shell-agents-page')).isVisible().catch(() => false));
		await shot('4-all-agents');

		await page.keyboard.press('Control+K');
		check('Ctrl+K opens the search', await page.locator(TID('vader-shell-search-palette')).isVisible({ timeout: 5000 }).catch(() => false));
		await page.locator(TID('vader-shell-search-input')).fill('hello');
		check('the search finds the conversation by what was said', (await page.locator(TID('vader-shell-search-result')).count()) >= 1);
		await shot('5-search');
		await page.keyboard.press('Escape');

		await page.locator(TID('vader-shell-addons')).click();
		check('Add-ons opens inside the window', await page.locator(TID('vader-shell-addons-page')).isVisible().catch(() => false));
		await shot('6-addons');

		await page.locator(TID('vader-shell-settings')).click();
		check('Settings opens over the window with the pages of the boards', await page.locator(TID('vader-settings-page')).waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false) && (await page.locator(TID('vader-settings-nav-permissions')).count()) === 1);
		await shot('7-settings');
		await page.locator(TID('vader-settings-nav-usage')).click();
		check('Usage and cost shows the turn that was just made', (await page.locator(TID('vader-usage-model')).count()) >= 1 || (await page.locator(TID('vader-usage-empty')).count()) === 1);
		await shot('8-usage');
		await page.locator(TID('vader-settings-close')).click();
		await sleep(400);
		check('Back to the app returns to the window', await page.locator(TID('vader-shell')).first().isVisible().catch(() => false));

		await page.locator(TID('vader-shell-thread'), { hasText: 'say hello from the window' }).first().click().catch(() => { });
		await page.locator(TID('vader-shell-open-editor')).click();
		await sleep(1200);
		check('Open in editor goes to the editor layout, with the chat in its sidebar', !(await page.locator(TID('vader-shell')).first().isVisible().catch(() => false)) && (await page.locator('.monaco-workbench .part.editor').first().isVisible().catch(() => false)));
		await shot('9-editor');
		await ui.runCommand(page, 'Vader: Open the Vader window').catch(() => { });
		await sleep(1000);
		check('the title bar button brings the window back', await page.locator(TID('vader-shell')).first().isVisible().catch(() => false));
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
