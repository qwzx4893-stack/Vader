#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// "Model in the loop". Runs the REAL packaged Vader app on a real project and, instead of a scripted model or an API key, hands every request the app
// sends to its model endpoint to a person or an AI agent that answers it - exactly as a keyed model would: it sees the system prompt, the tool list
// with descriptions, the conversation and every tool result, and replies with text and/or tool calls. Whatever is confusing, missing, broken or
// unsafe from the model's side of the wire, and whatever the app does wrong with a competent answer, shows up in the session log.
//
// Protocol (all files in BRIDGE_DIR):
//   task.txt          written by the driver before starting: the user's message to Vader
//   system.txt        the system prompt of the first request
//   tools.json        the tools offered (name, description, parameters)
//   req-N.json        request N: { index, newMessages: [{role, content|tool_calls}], toolResultsOnly, ... }  (written by the bridge)
//   resp-N.json       the answer to request N, written by the driver: { "text": "...", "toolCalls": [{ "name": "...", "args": {...} }] }
//                     or { "error": { "status": 429, "message": "..." } }
//   log.jsonl         one line per event: request, response, approval, idle, problems
//   DONE.json         written when the run ended: { transcript, approvals, problems, files }
//
// Env: VADER_EXE (required), PW_CORE, BRIDGE_DIR (default /tmp/bridge), BRIDGE_WORKSPACE (a real project; copied, never modified in place),
//      BRIDGE_MODEL (default gpt-4o: native tool calling; use qwen2.5-coder to test the XML tool format), E2E_ARGS (e.g. --no-sandbox)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launchApp, sleep } from './app.mjs';
import { createModelServer } from './modelServer.mjs';
import * as ui from './ui.mjs';

const dir = path.resolve(process.env.BRIDGE_DIR || '/tmp/bridge');
const model = process.env.BRIDGE_MODEL || 'gpt-4o';
const exe = process.env.VADER_EXE;
if (!exe || !fs.existsSync(exe)) { console.error(`VADER_EXE missing or not found: ${exe}`); process.exit(2); }
fs.mkdirSync(dir, { recursive: true });
for (const f of fs.readdirSync(dir)) { if (/^(req|resp)-\d+\.json$|^log\.jsonl$|^DONE\.json$|^system\.txt$|^tools\.json$/.test(f)) { fs.rmSync(path.join(dir, f)); } }
const log = (o) => fs.appendFileSync(path.join(dir, 'log.jsonl'), JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n');
const text = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => typeof p === 'string' ? p : (p?.text ?? '')).join('') : '';
const clip = (s, n = 12000) => s.length > n ? s.slice(0, n) + `\n...[${s.length - n} more characters]` : s;

// ---- the workspace: a copy of a real project, with git, so file changes can be diffed afterwards
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-bridge-ws-'));
if (process.env.BRIDGE_WORKSPACE) { fs.cpSync(process.env.BRIDGE_WORKSPACE, ws, { recursive: true, filter: s => !s.includes('node_modules') && !s.includes(`${path.sep}.git${path.sep}`) }); }
else { fs.writeFileSync(path.join(ws, 'README.md'), '# empty project\n'); }
const git = (...a) => execFileSync('git', a, { cwd: ws, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 'b', GIT_AUTHOR_EMAIL: 'b@x', GIT_COMMITTER_NAME: 'b', GIT_COMMITTER_EMAIL: 'b@x' } }).toString();
git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'start');
console.log(`workspace: ${ws}`);

// ---- the model endpoint: every chat request waits for a driver's answer
let seen = 0;
const server = await createModelServer({
	modelIds: [model],
	responder: async (ctx) => {
		const n = ctx.requestIndex;
		if (n === 0) {
			fs.writeFileSync(path.join(dir, 'system.txt'), ctx.system);
			fs.writeFileSync(path.join(dir, 'tools.json'), JSON.stringify((ctx.tools ?? []).map(t => ({ name: t.function?.name ?? t.name, description: t.function?.description ?? t.description, parameters: t.function?.parameters ?? t.input_schema })), null, 1));
		}
		const fresh = ctx.messages.slice(seen).filter(m => m.role !== 'system' && m.role !== 'developer');
		seen = ctx.messages.length;
		const req = {
			index: n, totalMessages: ctx.messages.length, toolsOffered: (ctx.tools ?? []).length,
			newMessages: fresh.map(m => ({ role: m.role, ...(m.tool_calls ? { tool_calls: m.tool_calls.map(c => ({ name: c.function?.name, arguments: c.function?.arguments })) } : {}), content: clip(text(m.content)) })),
		};
		fs.writeFileSync(path.join(dir, `req-${n}.json`), JSON.stringify(req, null, 1));
		log({ event: 'request', index: n, newMessages: req.newMessages.length });
		const file = path.join(dir, `resp-${n}.json`);
		const deadline = Date.now() + 45 * 60_000;
		while (!fs.existsSync(file)) {
			if (Date.now() > deadline) { return { error: { status: 500, message: 'bridge: no answer within 45 minutes' } }; }
			await sleep(150);
		}
		await sleep(100);
		const step = JSON.parse(fs.readFileSync(file, 'utf8'));
		log({ event: 'response', index: n, text: step.text?.slice(0, 200), toolCalls: (step.toolCalls ?? []).map(c => c.name) });
		return step;
	},
});

const app = await launchApp({ exe, workspace: ws, extraArgs: (process.env.E2E_ARGS || '').split(' ').filter(Boolean), label: 'bridge' });
const { page } = app;
await sleep(1500);
if (await ui.isOnboarding(page)) { await ui.completeOnboarding(page, { baseURL: server.url, apiKey: undefined, model }); }
await sleep(800);
await ui.dismissNotifications(page);
if ((await ui.getMode(page)) !== 'Agent') { await ui.setMode(page, 'Agent').catch(() => { }); }

const taskFile = path.join(dir, 'task.txt');
while (!fs.existsSync(taskFile)) { await sleep(300); }
const task = fs.readFileSync(taskFile, 'utf8').trim();
console.log(`task: ${task}`);
log({ event: 'task', task });
await ui.sendMessage(page, task);

// approve everything the app asks for, but record each approval with what was being approved
let approvals = 0;
const t0 = Date.now();
for (; ;) {
	const r = await ui.runUntilIdle(page, { timeout: 30_000, approveEach: false });
	if (r.pending) {
		approvals++;
		const headers = await ui.toolHeaders(page).catch(() => []);
		log({ event: 'approval', n: approvals, lastToolHeader: headers.at(-1) });
		await ui.approve(page);
		await sleep(500);
		continue;
	}
	if (r.idle) { break; }
	if (Date.now() - t0 > 60 * 60_000) { log({ event: 'timeout' }); break; }
}
await sleep(1000);
await page.screenshot({ path: path.join(dir, 'final.png') }).catch(() => { });
const transcript = await ui.transcript(page);
let diff = ''; try { git('add', '-A'); diff = git('diff', '--cached', '--stat') + '\n' + git('diff', '--cached'); } catch { /* none */ }
fs.writeFileSync(path.join(dir, 'DONE.json'), JSON.stringify({ approvals, requests: server.chatRequests().length, problems: app.problems.slice(0, 20), errors: await ui.errorTexts(page).catch(() => []), transcript: transcript.map(x => `${x.kind}: ${x.text.slice(0, 400)}`), diffStat: diff.slice(0, 20000) }, null, 1));
log({ event: 'done', approvals });
console.log('DONE');
await app.close(); await server.close();
process.exit(0);
