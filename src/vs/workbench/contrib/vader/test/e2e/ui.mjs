/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// TEST-ONLY. Helpers that drive Vader's real UI the way a person does (click, type, press keys).
// They rely on visible text and a few data-testid hooks added to the chat UI for this purpose.

import { sleep } from './app.mjs';

export const CHAT_INPUT = 'textarea[placeholder^="@ to mention"]';
const TID = (id) => `[data-testid="${id}"]`;

export async function isOnboarding(page) {
	// The onboarding is a full-screen overlay that stays in the DOM after setup and is only faded out (opacity 0, no pointer
	// events); VS Code's own Welcome page also has 'Get Started' text. So: is Vader's overlay present AND not faded out?
	const el = page.locator('.vader-scope').getByText('Welcome to Vader', { exact: true }).first();
	if (!(await el.count())) { return false; }
	return await el.evaluate(node => {
		for (let e = node; e; e = e.parentElement) {
			const s = getComputedStyle(e);
			if (s.position === 'fixed' && s.zIndex === '99999') { return Number(s.opacity) > 0.5 && s.pointerEvents !== 'none'; }
		}
		return false;
	}).catch(() => false);
}

/** First-run flow, exactly as a new user sees it: Welcome -> Add a Provider (OpenAI-Compatible) -> model -> done. */
export async function completeOnboarding(page, { baseURL, apiKey = 'sk-test-key', model }) {
	await page.getByText('Get Started', { exact: true }).first().click({ timeout: 30_000 });
	await page.getByText('Cloud/Other', { exact: true }).click({ timeout: 15_000 });
	await page.locator('input[placeholder^="baseURL (https://my-website.com"]').fill(baseURL);
	await page.locator('input[placeholder^="API Key (sk-key"]').fill(apiKey);
	await page.getByText('Add a model').last().click();
	await page.getByText('Provider Na', { exact: false }).first().click();
	await page.getByText('OpenAI-Compatible', { exact: true }).last().click();
	await page.locator('input[placeholder="Model Name"]').fill(model);
	await page.getByText('Add', { exact: true }).last().click();
	await sleep(400);
	await page.getByText('Next', { exact: true }).click();
	await page.getByText('Get Started', { exact: true }).click({ timeout: 15_000 }); // "Settings and Themes" step
	await page.waitForSelector(CHAT_INPUT, { timeout: 30_000 });
}

export async function focusChat(page) {
	const ta = page.locator(CHAT_INPUT);
	if (!(await ta.count())) { await page.keyboard.press('Control+Alt+B').catch(() => { }); }
	await ta.first().click();
	return ta.first();
}

export async function newThread(page, attempt = 0) {
	// "+" in the chat header (aria-label "New Chat (Ctrl+Shift+L)"). Different ways of triggering it, tried in turn by the
	// caller until the thread is actually empty (a mouse click sometimes lands without taking effect right after a run).
	const btn = page.locator('[aria-label^="New Chat"]').first();
	if (attempt === 0 && await btn.count()) { await btn.click(); }
	else if (attempt === 1 && await btn.count()) { await btn.evaluate(e => e.click()); }
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
	return page.evaluate(() => {
		const sel = '[data-testid="vader-user-text"],[data-testid="vader-assistant-text"],[data-testid="vader-tool"],[data-testid="vader-error"]';
		return [...document.querySelectorAll(sel)].map(e => ({ kind: e.getAttribute('data-testid').replace('vader-', ''), text: (e.innerText || e.textContent || '').trim() }));
	});
}

export const assistantTexts = async (page) => (await transcript(page)).filter(m => m.kind === 'assistant-text').map(m => m.text);
export const toolHeaders = async (page) => (await transcript(page)).filter(m => m.kind === 'tool').map(m => m.text);
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

/** Switch the chat mode dropdown (Normal chat / Gather / Plan / Agent). */
export async function setMode(page, mode) {
	const current = page.locator('span.vader-truncate.vader-mr-1').filter({ hasText: /^(Normal chat|Gather|Plan|Agent)$/ }).first();
	await current.click();
	await sleep(300);
	await page.locator('span').filter({ hasText: new RegExp(`^${mode}$`) }).last().click();
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
	const t = await page.locator('span.vader-truncate.vader-mr-1').filter({ hasText: /^(Normal chat|Gather|Plan|Agent)$/ }).first().textContent().catch(() => null);
	return t?.trim() ?? null;
}
