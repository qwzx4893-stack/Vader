/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// TEST-ONLY. Scenario runner for the real-app end-to-end suite: owns the model server, a fixture workspace,
// the launched app and per-scenario isolation, and records every check with evidence.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, sleep } from './app.mjs';
import { createModelServer } from './modelServer.mjs';
import * as ui from './ui.mjs';

export const config = {
	exe: process.env.VADER_EXE,
	natives: process.env.E2E_NATIVES !== '0', // false on a machine without the built native modules (terminal needs node-pty)
	network: process.env.E2E_NETWORK !== '0', // false where the public internet (open-vsx.org) is not reachable
	only: process.env.E2E_ONLY ? new RegExp(process.env.E2E_ONLY, 'i') : null,
	out: path.resolve(process.env.E2E_OUT || './e2e-out'),
	extraArgs: (process.env.E2E_ARGS || '').split(' ').filter(Boolean),
	scenarioTimeout: Number(process.env.E2E_SCENARIO_TIMEOUT || 120_000),
};

export const results = []; // { group, name, status: 'pass'|'fail'|'skip', checks: [], error?, ms }
const log = (...a) => console.log(...a);

export const FIXTURE = {
	'notes.txt': 'hello world\nsecond line\n',
	'src/app.js': 'function add(a, b) {\n  return a - b; // BUG: should add\n}\nmodule.exports = { add };\n',
	'test.js': "const { add } = require('./src/app.js');\nif (add(2, 3) !== 5) { console.log('TEST FAILED: add(2,3) =', add(2, 3)); process.exit(1); }\nconsole.log('TEST PASSED');\n",
	'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', scripts: { test: 'node test.js' } }, null, 2) + '\n',
	'README.md': '# Demo project\n\nUsed by the Vader end-to-end suite.\n',
};

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 'e2e', GIT_AUTHOR_EMAIL: 'e2e@example.com', GIT_COMMITTER_NAME: 'e2e', GIT_COMMITTER_EMAIL: 'e2e@example.com' } }).toString();

export function makeWorkspace(label) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vader-e2e-ws-${label}-`));
	writeFixture(dir);
	try { git(dir, 'init', '-q'); git(dir, 'config', 'core.autocrlf', 'false'); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'initial'); } catch (e) { log('  (git unavailable for fixture workspace:', String(e).slice(0, 80), ')'); }
	return dir;
}

export function writeFixture(dir) {
	for (const [rel, content] of Object.entries(FIXTURE)) {
		const p = path.join(dir, ...rel.split('/'));
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, content);
	}
}

/** Put the workspace back to the committed fixture state and remove anything a scenario created. */
export function resetWorkspace(dir) {
	try { git(dir, 'reset', '--hard', '-q'); git(dir, 'clean', '-fdxq'); } catch { writeFixture(dir); }
}

/**
 * Runs a group of scenarios against one launched app (one provider/model configured through onboarding).
 * @param {{ name: string, model: string, scenarios: Scenario[], userDataDir?: string, workspace?: string, keepOpen?: boolean }} group
 */
export async function runGroup(group) {
	const only = config.only;
	const selected = group.scenarios.filter(s => !only || only.test(`${group.name} ${s.name}`));
	if (!selected.length) { return; }
	log(`\n=== group: ${group.name} (model "${group.model}") ===`);
	const server = await createModelServer({ modelIds: [group.model] });
	const ws = group.workspace ?? makeWorkspace(group.name);
	let app;
	try {
		app = await launchApp({ exe: config.exe, workspace: ws, userDataDir: group.userDataDir, extraArgs: config.extraArgs, label: group.name });
		const { page } = app;
		await sleep(1500);
		if (await ui.isOnboarding(page)) { await ui.completeOnboarding(page, { baseURL: group.baseURL ?? server.url, apiKey: group.apiKey, model: group.model }); }
		await sleep(800);

		for (const s of selected) {
			await runScenario({ group, s, server, ws, app });
		}
	} catch (e) {
		log(`FAIL: group "${group.name}" could not start - ${String(e).slice(0, 600)}`);
		for (const s of selected) { results.push({ group: group.name, name: s.name, status: 'fail', checks: [], error: `group failed to start: ${String(e).slice(0, 300)}`, ms: 0 }); }
	} finally {
		if (app && !group.keepOpen) { await app.close(); }
		await server.close();
	}
	return { app, server, ws };
}

async function runScenario({ group, s, server, ws, app }) {
	const { page } = app;
	const rec = { group: group.name, name: s.name, status: 'pass', checks: [], ms: 0 };
	const t0 = Date.now();
	const dir = path.join(config.out, group.name.replace(/\W+/g, '_'), s.name.replace(/\W+/g, '_').slice(0, 80));
	fs.mkdirSync(dir, { recursive: true });

	if (s.needs?.includes('natives') && !config.natives) {
		rec.status = 'skip'; rec.error = 'needs native modules (node-pty) that are not built on this machine';
		log(`SKIP: ${s.name} - ${rec.error}`);
		results.push(rec); return;
	}

	if (s.needs?.includes('network') && !config.network) {
		rec.status = 'skip'; rec.error = 'needs the public internet (E2E_NETWORK=0)';
		log(`SKIP: ${s.name} - ${rec.error}`);
		results.push(rec); return;
	}

	// isolation: clean workspace, new empty chat thread, fresh request log, default responder
	resetWorkspace(ws);
	server.reset(); server.setResponder(() => ({ text: 'OK' })); server.setFim(() => '');
	await ui.dismissNotifications(page);
	await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
	let cleanThread = false;
	for (let attempt = 0; attempt < 4 && !cleanThread; attempt++) {
		await ui.newThread(page, attempt);
		await sleep(300);
		const tr = await ui.transcript(page);
		cleanThread = tr.length === 0;
		if (!cleanThread && process.env.E2E_DEBUG) { await page.screenshot({ path: path.join(dir, `isolation-${attempt}.png`) }).catch(() => { }); const b = page.locator('[aria-label^="New Chat"]'); log(`  [debug] new-chat buttons: ${await b.count()} first visible=${await b.first().isVisible()} enabled=${await b.first().isEnabled()} box=${JSON.stringify(await b.first().boundingBox())}`); }
		if (!cleanThread && process.env.E2E_DEBUG) { log(`  [debug] attempt ${attempt}: thread has ${tr.length} items: ${JSON.stringify(tr.map(x => x.kind + ':' + x.text.slice(0, 30)))}`); }
	}
	if (!cleanThread) { log('  (warning: could not get an empty chat thread for this scenario)'); }
	// every scenario starts in Agent mode unless it says otherwise
	if ((await ui.getMode(page)) !== (s.mode ?? 'Agent')) { await ui.setMode(page, s.mode ?? 'Agent').catch(() => { }); }

	const problemsBefore = app.problems.length;
	const t = {
		page, app, server, ws, dir,
		/** Informational: logged and kept in the results, but never fails the scenario (for behaviour that depends on a real, unscripted model). */
		info(name, ok, detail = '') { rec.checks.push({ name: `[info] ${name}`, ok: true, detail: `${ok ? 'yes' : 'no'} ${String(detail).slice(0, 300)}` }); log(`  INFO ${ok ? 'yes' : 'no '}: ${name}${detail ? ` - ${String(detail).slice(0, 200)}` : ''}`); return !!ok; },
		check(name, ok, detail = '') { rec.checks.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) }); log(`  ${ok ? 'PASS' : 'FAIL'}: ${name}${detail && !ok ? ` - ${String(detail).slice(0, 300)}` : ''}`); if (!ok) { rec.status = 'fail'; } return !!ok; },
		use: (responder) => server.setResponder(responder),
		useFim: (fn) => server.setFim(fn),
		send: (text) => ui.sendMessage(page, text),
		idle: (opts) => ui.waitForIdle(page, opts),
		runUntilIdle: (opts) => ui.runUntilIdle(page, opts),
		setMode: (m) => ui.setMode(page, m),
		approve: () => ui.approve(page), reject: () => ui.reject(page), waitApproval: (ms) => ui.waitForApproval(page, ms),
		transcript: () => ui.transcript(page),
		read: (rel) => fs.readFileSync(path.join(ws, ...rel.split('/')), 'utf8'),
		exists: (rel) => fs.existsSync(path.join(ws, ...rel.split('/'))),
		write: (rel, c) => { const p = path.join(ws, ...rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); },
		abs: (rel) => path.join(ws, ...rel.split('/')),
		shot: (n) => page.screenshot({ path: path.join(dir, `${n}.png`) }).catch(() => { }),
		sleep,
		ui,
		waitFor: async (fn, ms = 15_000, step = 250) => { const e = Date.now() + ms; while (Date.now() < e) { try { if (await fn()) { return true; } } catch { /* retry */ } await sleep(step); } return false; },
	};

	log(`- ${s.name}`);
	let timer;
	try {
		await Promise.race([
			s.fn(t),
			new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`scenario timed out after ${config.scenarioTimeout}ms`)), s.timeout ?? config.scenarioTimeout); }),
		]);
	} catch (e) {
		rec.status = 'fail'; rec.error = String(e?.stack ?? e).slice(0, 800);
		log(`  FAIL: scenario threw - ${String(e?.message ?? e).slice(0, 300)}`);
	} finally { clearTimeout(timer); }

	rec.ms = Date.now() - t0;
	if (rec.status === 'fail') {
		await t.shot('failure');
		await logFailureDiagnostics({ ui, page, server, app, problemsBefore, log });
		try {
			fs.writeFileSync(path.join(dir, 'transcript.json'), JSON.stringify(await ui.transcript(page).catch(() => []), null, 2));
			fs.writeFileSync(path.join(dir, 'model-requests.json'), JSON.stringify(server.requests.map(r => ({ path: r.path, step: r.step, messages: r.body?.messages?.map(m => ({ role: m.role, content: String(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).slice(0, 1500), tool_calls: m.tool_calls })), tools: r.body?.tools?.map(x => x.function?.name) })), null, 2));
			fs.writeFileSync(path.join(dir, 'renderer-problems.txt'), app.problems.slice(problemsBefore).join('\n'));
		} catch { /* best effort */ }
	}
	results.push(rec);
	log(`  => ${rec.status.toUpperCase()} (${rec.ms} ms)`);
}

export function summarize() {
	const pass = results.filter(r => r.status === 'pass').length;
	const fail = results.filter(r => r.status === 'fail').length;
	const skip = results.filter(r => r.status === 'skip').length;
	const checks = results.reduce((n, r) => n + r.checks.length, 0);
	const checksFailed = results.reduce((n, r) => n + r.checks.filter(c => !c.ok).length, 0);
	fs.mkdirSync(config.out, { recursive: true });
	fs.writeFileSync(path.join(config.out, 'results.json'), JSON.stringify({ results, totals: { pass, fail, skip, checks, checksFailed } }, null, 2));
	log(`\n==== ${pass} scenarios passed, ${fail} failed, ${skip} skipped; ${checks - checksFailed}/${checks} checks passed ====`);
	for (const r of results.filter(r => r.status === 'fail')) { log(`  FAILED: [${r.group}] ${r.name}${r.error ? ` - ${r.error.split('\n')[0].slice(0, 200)}` : ''}`); }
	for (const r of results.filter(r => r.status === 'skip')) { log(`  SKIPPED: [${r.group}] ${r.name} - ${r.error}`); }
	return fail === 0;
}

/** Printed into the console log so a failure on a CI machine can be understood without downloading artifacts. */
export async function logFailureDiagnostics({ ui, page, server, app, problemsBefore = 0, log = console.log }) {
	try {
		const tr = await ui.transcript(page).catch(() => []);
		log(`  [diag] model requests: ${server?.requests?.map(r => r.path.split('/').slice(-2).join('/')).join(', ') || '(none)'}`);
		log(`  [diag] chat transcript: ${JSON.stringify(tr.map(x => `${x.kind}:${String(x.text).replace(/\s+/g, ' ').slice(0, 90)}`)).slice(0, 700)}`);
		const probs = app.problems.slice(problemsBefore);
		if (probs.length) { log(`  [diag] renderer problems (${probs.length}): ${probs.slice(0, 6).map(p => p.slice(0, 220)).join(' || ')}`); }
		const main = app.mainOutput().split(/\r?\n/).filter(l => /error|exception|ERR_|fail|mcp|spawn/i.test(l) && !/DEP0040|trace-deprecation/.test(l)).slice(-8);
		if (main.length) { log(`  [diag] app log: ${main.map(l => l.slice(0, 220)).join(' || ')}`); }
	} catch (e) { log(`  [diag] could not collect diagnostics: ${String(e).slice(0, 120)}`); }
}
