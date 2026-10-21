/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// TEST-ONLY. Helpers that drive Vader's real UI the way a person does (click, type, press keys).
// They rely on visible text and a few data-testid hooks added to the chat UI for this purpose.

import { sleep } from './app.mjs';

export const CHAT_INPUT = 'textarea[data-testid="vader-input"]'; // the placeholder changes with the mode and the state of the chat; the test id does not
const TID = (id) => `[data-testid="${id}"]`;

export async function isOnboarding(page) {
	// The onboarding is a full-screen overlay that stays in the DOM after setup and is only faded out (opacity 0, no pointer
	// events); VS Code's own Welcome page also has 'Get Started' text. So: is Vader's overlay present AND not faded out?
	const el = page.locator(TID('vader-onboarding')).first();
	if (!(await el.count())) { return false; }
	return await el.evaluate(node => {
		const s = getComputedStyle(node);
		return Number(s.opacity) > 0.5 && s.pointerEvents !== 'none';
	}).catch(() => false);
}

/** First-run flow, exactly as a new user sees it: Models (skipped here) -> Project -> First task (skipped) -> the IDE; then the provider is set up in the Settings page. */
export async function completeOnboarding(page, { baseURL, apiKey = 'sk-test-key', model, taskCopies }) {
	await page.locator(TID('vader-welcome-continue')).click({ timeout: 30_000 });
	await page.locator(TID('vader-onboarding-continue')).click({ timeout: 15_000 });
	await page.locator(TID('vader-import-done')).click({ timeout: 15_000 });
	await sleep(1200); // the welcome overlay fades out
	await configureOpenAICompatible(page, { baseURL, apiKey, model });
	// Agent mode works in a copy of the project on its own branch and the folder changes only when the person merges; the scenarios look at the files
	// in the folder, so they ask for the agent to edit it directly (the copy has its own scenario)
	if (taskCopies !== true) { await setTaskCopies(page, false); }
	await page.waitForSelector(CHAT_INPUT, { timeout: 30_000 });
}

/** Settings > Permissions > "Work in a copy of the project". */
export async function setTaskCopies(page, on) {
	await runCommand(page, 'Vader: Open Settings');
	await page.locator(TID('vader-settings-nav-permissions')).click({ timeout: 20_000 });
	const sw = page.locator(TID('vader-perm-taskcopies'));
	await sw.waitFor({ state: 'visible', timeout: 10_000 });
	if ((await sw.getAttribute('aria-checked')) !== String(on)) { await sw.click(); await sleep(300); }
	await page.locator(TID('vader-settings-close')).click();
	await sleep(300);
}

/** In the Settings page: point the OpenAI-Compatible provider at `baseURL` and add one model (this is how a user adds their first provider). */
export async function configureOpenAICompatible(page, { baseURL, apiKey = 'sk-test-key', model }) {
	await runCommand(page, 'Vader: Open Settings');
	await page.locator(TID('vader-settings-nav-models')).click({ timeout: 20_000 });
	// the providers are one list on the Models page: search for the one that takes any OpenAI-compatible address, and open it
	await page.locator(TID('vader-models-search')).fill('compatible');
	const row = page.locator('[data-testid="vader-provider-row"][data-provider="openAICompatible"]');
	await row.locator(TID('vader-provider-toggle')).click({ timeout: 20_000 });
	await row.locator('input[placeholder^="baseURL (https://my-website.com"]').first().fill(baseURL);
	await row.locator('input[placeholder^="API Key (sk-key"]').first().fill(apiKey);
	await row.locator(TID('vader-provider-add-open')).click();
	await row.locator(TID('vader-provider-add-input')).fill(model);
	await row.locator(TID('vader-provider-add')).click();
	await sleep(400);
	await page.locator(TID('vader-settings-close')).click();
	await sleep(300);
}

export async function focusChat(page) {
	const ta = page.locator(CHAT_INPUT);
	if (!(await ta.count())) { await page.keyboard.press('Control+Alt+B').catch(() => { }); }
	await ta.first().click();
	return ta.first();
}

export async function newThread(page, attempt = 0) {
	// the "New chat" button of the left navigation (or the "New Chat" button of an older header), then the shortcut, then the command.
	// Different ways of triggering it, tried in turn by the caller until the thread is actually empty (a mouse click sometimes lands
	// without taking effect right after a run). Nothing here waits longer than a few seconds for a button that is not there.
	const btn = page.locator('[data-testid="vader-shell-new-chat"], [aria-label^="New Chat"]').first();
	const there = (await btn.count()) > 0;
	if (attempt === 0 && there) { await btn.click({ timeout: 5000 }).catch(() => { }); }
	else if (attempt === 1 && there) { await btn.evaluate(e => e.click()).catch(() => { }); }
	else if (attempt === 2) { await focusChat(page); await page.keyboard.press('Control+Shift+L'); }
	else { await runCommand(page, 'Vader: New Chat').catch(() => { }); }
	await sleep(600);
}

export async function sendMessage(page, text) {
	const ta = await focusChat(page);
	await ta.fill(text);
	await page.keyboard.press('Enter');
}

export const isRunning = async (page) => (await page.locator(TID('vader-stop')).count()) > 0;
export const approvalPending = async (page) => (await page.locator(TID('vader-tool-approve')).count()) > 0;

/** Waits until the agent has stopped (no stop button, no pending approval) for a stable moment. */
export async function waitForIdle(page, { timeout = 60_000, stableMs = 1500, allowApproval = false } = {}) {
	const t0 = Date.now();
	let idleSince = 0;
	while (Date.now() - t0 < timeout) {
		const busy = (await isRunning(page)) || (!allowApproval && (await approvalPending(page)));
		if (busy) { idleSince = 0; } else if (!idleSince) { idleSince = Date.now(); } else if (Date.now() - idleSince >= stableMs) { return true; }
		await sleep(200);
	}
	return false;
}

export async function waitForApproval(page, timeout = 30_000) {
	try { await page.locator(TID('vader-tool-approve')).first().waitFor({ state: 'visible', timeout }); return true; } catch { return false; }
}
export async function approve(page) { await page.locator(TID('vader-tool-approve')).first().click(); }
export async function reject(page) { await page.locator(TID('vader-tool-reject')).first().click(); }

/** Everything in the chat, in on-screen order. */
export async function transcript(page) {
	// reads and searches that follow one another are folded into one line ("Explored 2 files"): open each fold, so that its calls are in the list
	const opened = await page.locator(TID('vader-explored-toggle')).evaluateAll(els => els.filter(e => e.getAttribute('aria-expanded') === 'false').map(e => e.click()).length).catch(() => 0);
	if (opened) { await sleep(200); }
	return page.evaluate(() => {
		const sel = '[data-testid="vader-user-text"],[data-testid="vader-assistant-text"],[data-testid="vader-tool"],[data-testid="vader-plan"],[data-testid="vader-error"]';
		return [...document.querySelectorAll(sel)].map(e => ({ kind: e.getAttribute('data-testid').replace('vader-', ''), text: (e.innerText || e.textContent || '').trim() }));
	});
}

export const assistantTexts = async (page) => (await transcript(page)).filter(m => m.kind === 'assistant-text').map(m => m.text);
// the list of tasks the agent keeps is drawn as a card of its own ("Plan 1 of 3"), not as a tool line
export const toolHeaders = async (page) => (await transcript(page)).filter(m => m.kind === 'tool' || m.kind === 'plan').map(m => m.text);
export const errorTexts = async (page) => (await transcript(page)).filter(m => m.kind === 'error').map(m => m.text);

export async function waitForText(page, text, { timeout = 30_000, scope = 'body' } = {}) {
	try { await page.locator(scope).getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout }); return true; } catch { return false; }
}

/** Runs a command-palette command by its visible title. */
export async function runCommand(page, title) {
	await page.keyboard.press('F1');
	await page.waitForSelector('.quick-input-widget', { state: 'visible', timeout: 10_000 });
	await page.keyboard.type(title);
	await sleep(700);
	await page.keyboard.press('Enter');
	await sleep(500);
}

/** Opens a file in the editor via Quick Open. */
export async function openFile(page, name) {
	await page.keyboard.press('Control+P');
	await page.waitForSelector('.quick-input-widget', { state: 'visible', timeout: 10_000 });
	await page.keyboard.type(name);
	await sleep(700);
	await page.keyboard.press('Enter');
	await sleep(1200);
}

export async function dismissNotifications(page) {
	await page.evaluate(() => document.querySelectorAll('.notifications-toasts .codicon-close, .notification-toast .codicon-close').forEach(e => e.click())).catch(() => { });
}

/** Text of visible notification toasts (used to catch things like "installation appears to be corrupt"). */
export async function toastTexts(page) {
	return page.evaluate(() => [...document.querySelectorAll('.notifications-toasts .notification-list-item-message')].map(e => e.textContent.trim()));
}

/** The chat modes by the name a scenario uses and by the value the menu carries. */
const MODE_VALUE = { 'Normal chat': 'normal', 'Chat': 'normal', 'Gather': 'gather', 'Plan': 'plan', 'Agent': 'agent' };

/** Switch the chat mode menu in the message box (Chat / Gather / Plan / Agent). */
export async function setMode(page, mode) {
	await page.locator(TID('vader-mode')).first().click({ timeout: 5000 });
	await sleep(300);
	await page.locator(`${TID('vader-mode-option')}[data-value="${MODE_VALUE[mode] ?? mode.toLowerCase()}"]`).first().click({ timeout: 5000 });
	await sleep(400);
}

/** Keeps approving tool requests until the agent is idle. Returns how many approvals it gave. */
export async function runUntilIdle(page, { timeout = 90_000, approveEach = true } = {}) {
	const t0 = Date.now();
	let approvals = 0, idleSince = 0;
	while (Date.now() - t0 < timeout) {
		if (await approvalPending(page)) {
			idleSince = 0;
			if (approveEach) { await approve(page); approvals++; await sleep(500); } else { return { approvals, idle: false, pending: true }; }
			continue;
		}
		if (await isRunning(page)) { idleSince = 0; } else if (!idleSince) { idleSince = Date.now(); } else if (Date.now() - idleSince >= 1500) { return { approvals, idle: true }; }
		await sleep(200);
	}
	return { approvals, idle: false };
}

export async function getMode(page) {
	const t = await page.locator(TID('vader-mode')).first().textContent({ timeout: 3000 }).catch(() => null);
	return t?.trim() ?? null;
}
