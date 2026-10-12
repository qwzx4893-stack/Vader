/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Coding agents the person already has an account with (Settings > Coding Agents), in the real app. The agent is a stand-in that speaks the
// Agent Client Protocol (fixtures/fakeAcpAgent.cjs) added as "your own agent", so the whole path is real except the vendor:
// UI -> settings -> chat -> IPC -> main process -> the agent's process -> events -> chat, including the permission question and stop.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(here, '..', '..', 'fixtures', 'fakeAcpAgent.cjs');

const openAgentsTab = async (t) => {
	await t.ui.runCommand(t.page, 'Vader: Open Settings');
	await t.page.getByText('Coding Agents', { exact: true }).first().click({ timeout: 20_000 });
	await t.sleep(600);
};
const section = (t) => t.page.locator('[data-testid="vader-settings-external-agents"]');
const card = (t, id) => t.page.locator(`[data-testid="vader-external-agent-${id}"]`).first();

/** adds a custom agent that runs the stand-in in `mode`, through the form on the page */
const addFake = async (t, name, mode) => {
	await openAgentsTab(t);
	const custom = t.page.locator('[data-testid="vader-external-agent-custom"]');
	await custom.locator('input[placeholder="Name"]').fill(name);
	await custom.locator('input[placeholder^="Program"]').fill(process.execPath);
	await custom.locator('input[placeholder^="Arguments"]').fill(`${FAKE} ${mode}`);
	await custom.getByRole('button', { name: 'Add', exact: true }).click();
	const id = 'custom-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
	await t.waitFor(async () => (await card(t, id).getAttribute('data-testid').catch(() => null)) !== null, 10_000);
	return id;
};
const useInChat = async (t, id) => {
	await openAgentsTab(t);
	await t.waitFor(async () => (await card(t, id).innerText().catch(() => '')).includes('Ready'), 20_000);
	await card(t, id).getByRole('button', { name: 'Use in the chat' }).click();
};
const cleanUp = async (t, id) => {
	await openAgentsTab(t);
	await card(t, id).getByRole('button', { name: 'Remove' }).click().catch(() => { });
};
const closeSettings = async (t) => { await t.page.locator('[data-testid="vader-settings-close"]').click({ timeout: 10_000 }).catch(() => { }); await t.sleep(400); };

export const externalAgentScenarios = [
	{
		name: 'external agents: every agent has a card with its logo, and the terminal ones offer install / open',
		fn: async (t) => {
			await openAgentsTab(t);
			const ids = ['codex', 'opencode', 'cursor', 'gemini', 'claude-code', 'antigravity', 'freebuff'];
			for (const id of ids) { t.check(`the ${id} card is shown`, await card(t, id).isVisible().catch(() => false)); }
			t.check('each card shows a logo', (await section(t).locator('[data-agent-logo]').count()) >= ids.length, String(await section(t).locator('[data-agent-logo]').count()));
			t.check('the card text says whose account is used and who counts the usage', /OpenAI/.test(await card(t, 'codex').innerText()) && /Anthropic/.test(await card(t, 'claude-code').innerText()));
			t.check('the Claude Code card says it runs unchanged in a terminal and is not wired into the chat', /unmodified Claude Code/.test(await card(t, 'claude-code').innerText()));
			await t.waitFor(async () => !/Checking/.test(await card(t, 'claude-code').innerText()), 15_000);
			const cc = await card(t, 'claude-code').innerText();
			t.check('a terminal agent that is not installed offers Install and not "Use in the chat"', /Install/.test(cc) && !/Use in the chat/.test(cc), cc);
			t.check('a terminal agent can never be chosen for the chat', (await section(t).getByRole('button', { name: 'Use in the chat' }).count()) === 0 || !(await card(t, 'freebuff').innerText()).includes('Use in the chat'));
			await t.shot('external-agents-settings');
			await closeSettings(t);
		},
	},
	{
		name: 'external agents: pick an agent, chat with it, answer its permission question, switch back to models',
		timeout: 120_000,
		fn: async (t) => {
			// the permission question is an ordinary dialog; the default dialog style is the operating system's own window, which a page driver cannot see
			const userDir = path.join(t.app.userDataDir, 'User');
			fs.mkdirSync(userDir, { recursive: true });
			fs.writeFileSync(path.join(userDir, 'settings.json'), JSON.stringify({ 'window.dialogStyle': 'custom' }));
			await t.sleep(1500);
			const id = await addFake(t, 'Fake Agent', 'permission');
			await useInChat(t, id);
			t.check('the card shows the agent is in use', await t.waitFor(async () => /Use my models instead/.test(await card(t, id).innerText()), 10_000), await card(t, id).innerText());
			await closeSettings(t);

			await t.ui.newThread(t.page);
			t.check('the chat shows the agent picker', await t.page.locator('[data-testid="vader-external-agent-picker"]').isVisible().catch(() => false));
			t.check('the model box is replaced by the agent (no model is needed)', (await t.page.locator('[data-testid="vader-external-agent-picker"]').innerText()).includes('Fake Agent'));
			const before = t.server.chatRequests().length;
			await t.send('please list the files');

			const dialog = t.page.locator('.monaco-dialog-box');
			t.check('the agent\'s permission question is asked in a dialog with its own title and options', await dialog.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false));
			const dialogText = await dialog.innerText().catch(() => '');
			t.check('the dialog names the agent and what it wants to do', /Fake Agent/.test(dialogText) && /Run rm -rf build/.test(dialogText), dialogText);
			t.check('the dialog offers the agent\'s own options', await dialog.getByRole('button', { name: 'Allow once' }).isVisible().catch(() => false) && await dialog.getByRole('button', { name: 'Reject' }).isVisible().catch(() => false));
			await dialog.getByRole('button', { name: 'Allow once' }).click();

			t.check('the turn finishes', await t.idle({ timeout: 40_000 }));
			const texts = (await t.ui.assistantTexts(t.page)).join('\n');
			t.check('the answer from the agent is in the chat', /you said: please list the files/.test(texts), texts);
			t.check('the agent received the permission answer', texts.includes('permission:allow;'), texts);
			t.check('the work the agent did is shown', /Read file/.test(texts), texts);
			t.check('no request was made to any Vader model', t.server.chatRequests().length === before, `${t.server.chatRequests().length} vs ${before}`);

			// a second message continues the same agent conversation
			await t.send('and again');
			const dialog2 = t.page.locator('.monaco-dialog-box');
			await dialog2.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => { });
			await dialog2.getByRole('button', { name: 'Reject' }).click().catch(() => { });
			t.check('the second turn finishes', await t.idle({ timeout: 40_000 }));
			const texts2 = (await t.ui.assistantTexts(t.page)).join('\n');
			t.check('the second message reached the same agent session (turn 2) and the rejection was passed on', texts2.includes('turn 2') && texts2.includes('permission:reject;'), texts2);

			// back to the models
			await t.page.locator('[data-testid="vader-external-agent-picker"]').click();
			await t.page.getByText('My models', { exact: true }).last().click();
			await t.sleep(600);
			t.use(() => ({ text: 'Answer from the model.' }));
			await t.ui.newThread(t.page);
			await t.send('hello model');
			t.check('after switching back, the next message goes to the configured model', await t.idle() && (await t.ui.assistantTexts(t.page)).some(x => x.includes('Answer from the model.')));
			await cleanUp(t, id);
			await closeSettings(t);
		},
	},
	{
		name: 'external agents: stopping a running agent ends the turn and the chat is usable again',
		timeout: 90_000,
		fn: async (t) => {
			const id = await addFake(t, 'Slow Agent', 'hang');
			await useInChat(t, id);
			await closeSettings(t);
			await t.ui.newThread(t.page);
			await t.send('start something long');
			t.check('the agent starts answering', await t.ui.waitForText(t.page, 'working...', { timeout: 30_000 }));
			t.check('the stop button is shown while it works', await t.ui.isRunning(t.page));
			await t.page.locator('[data-testid="vader-stop"]').first().click();
			t.check('the chat returns to idle after Stop', await t.idle({ timeout: 20_000 }));
			t.check('what the agent had said so far is kept', (await t.ui.assistantTexts(t.page)).some(x => x.includes('working...')));
			await cleanUp(t, id);
			await closeSettings(t);
		},
	},
	{
		name: 'external agents: an agent that stops by itself is explained, and a missing folder or program is reported',
		timeout: 90_000,
		fn: async (t) => {
			const id = await addFake(t, 'Broken Agent', 'crash');
			await useInChat(t, id);
			await closeSettings(t);
			await t.ui.newThread(t.page);
			await t.send('do it');
			t.check('the turn ends', await t.idle({ timeout: 40_000 }));
			const errors = (await t.ui.errorTexts(t.page)).join('\n');
			t.check('the error says the agent stopped and shows what it printed', /stopped/.test(errors) && /boom/.test(errors), errors);
			await cleanUp(t, id);
			await closeSettings(t);
		},
	},
];
