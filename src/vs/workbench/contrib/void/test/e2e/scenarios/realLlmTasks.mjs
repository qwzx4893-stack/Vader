/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A small CAPABILITY eval for the real agent: coding tasks given in plain language to a real model (in CI a small one served by Ollama, so it needs
// no API key), graded by what ends up on disk - not by what the model says and not by the order of its tool calls. Each task is tried several times,
// because one run says little about an LLM: pass@k (at least one success) shows what the agent CAN do, pass^k (all succeed) is the figure that matters
// for something people depend on. Results are information plus a JSON file; the only hard check is that the app stays healthy throughout.
//
// With a small model the numbers are low and noisy; they are a baseline that moves when the harness, the prompts or the tool layer change, and the
// same file runs unchanged against a stronger model by setting REAL_LLM_MODEL / REAL_LLM_BASEURL.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { seq } from '../modelServer.mjs';

const ATTEMPTS = Number(process.env.AGENT_BENCH_ATTEMPTS ?? 2);
const PER_ATTEMPT_MS = Number(process.env.AGENT_BENCH_ATTEMPT_MS ?? 300_000);

const node = (t, ...args) => execFileSync(process.execPath, args, { cwd: path.dirname(t.abs('test.js')), stdio: 'pipe', timeout: 20_000 }).toString();

const FIXTURE_APP = 'function add(a, b) {\n  return a - b; // BUG: should add\n}\nmodule.exports = { add };\n';

export const TASKS = [
	{
		id: 'create-file',
		prompt: 'Create a file named hello.txt in the project root containing exactly the text VADER.',
		setup: (t) => { try { fs.rmSync(t.abs('hello.txt')); } catch { /* absent */ } },
		grade: (t) => t.exists('hello.txt') && t.read('hello.txt').trim() === 'VADER',
	},
	{
		id: 'fix-bug',
		prompt: 'The test in test.js fails. Fix the bug in src/app.js so that `node test.js` passes.',
		setup: (t) => t.write('src/app.js', FIXTURE_APP),
		grade: (t) => { try { return /TEST PASSED/.test(node(t, 'test.js')); } catch { return false; } },
	},
	{
		id: 'write-function',
		prompt: "Create greet.js that exports a function greet(name) returning 'Hello, ' followed by the name.",
		setup: (t) => { try { fs.rmSync(t.abs('greet.js')); } catch { /* absent */ } },
		grade: (t) => { try { return node(t, '-e', "console.log(require('./greet.js').greet('Ann'))").trim() === 'Hello, Ann'; } catch { return false; } },
	},
	{
		id: 'transform-file',
		prompt: 'Read notes.txt and create out.txt with the same content in UPPERCASE.',
		setup: (t) => { try { fs.rmSync(t.abs('out.txt')); } catch { /* absent */ } },
		grade: (t) => t.exists('out.txt') && t.read('out.txt').trim() === t.read('notes.txt').trim().toUpperCase(),
	},
];

export const realLlmTaskScenarios = [
	{
		name: 'real model tasks: plain-language coding tasks graded by the resulting files (pass@k and pass^k)',
		timeout: TASKS.length * ATTEMPTS * (PER_ATTEMPT_MS + 60_000) + 120_000,
		fn: async (t) => {
			const rows = [];
			let healthy = true;
			for (const task of TASKS) {
				const outcomes = [];
				for (let k = 1; k <= ATTEMPTS; k++) {
					task.setup(t);
					await t.ui.newThread(t.page);
					await t.sleep(800);
					const t0 = Date.now();
					await t.send(task.prompt);
					const r = await t.runUntilIdle({ timeout: PER_ATTEMPT_MS });
					if (!r.idle) { healthy = false; }
					let ok = false;
					try { ok = !!task.grade(t); } catch { ok = false; }
					outcomes.push(ok);
					t.info(`${task.id} attempt ${k}: ${ok ? 'PASS' : 'fail'}`, ok, `${Math.round((Date.now() - t0) / 1000)} s, approvals ${r.approvals}, idle ${r.idle}`);
				}
				rows.push({ task: task.id, attempts: outcomes.length, passes: outcomes.filter(Boolean).length, pass_at_k: outcomes.some(Boolean), pass_hat_k: outcomes.every(Boolean) });
			}
			const n = rows.length;
			const summary = {
				model: process.env.REAL_LLM_MODEL ?? '(unset)', attempts_per_task: ATTEMPTS, tasks: n,
				pass_at_k: `${rows.filter(r => r.pass_at_k).length}/${n}`, pass_hat_k: `${rows.filter(r => r.pass_hat_k).length}/${n}`,
				mean_attempt_success: Number((rows.reduce((a, r) => a + r.passes, 0) / (n * ATTEMPTS)).toFixed(3)), rows,
			};
			t.info(`agent bench: pass@${ATTEMPTS} ${summary.pass_at_k}, pass^${ATTEMPTS} ${summary.pass_hat_k}, mean attempt success ${summary.mean_attempt_success}`, true, JSON.stringify(rows).slice(0, 250));
			try { fs.writeFileSync(path.join(process.env.E2E_OUT || '.', 'agent-bench.json'), JSON.stringify(summary, null, 2)); } catch { /* informational */ }
			t.check('the app stayed responsive through every attempt (each run reached idle)', healthy);
		},
	},
];

// ------------------------------------------------------------------------------------------------------------------------------------------
// The same tasks with a perfect, scripted "model" (the tool calls a competent model would make). This is the CEILING of the tool layer: if the
// agent harness itself loses an edit, mangles a path, mishandles an approval or reports success without writing the file, a task fails here even
// though the "model" did everything right. The real-model run above can then only be limited by the model. Deterministic, needs no key, runs in CI.

const SR = (orig, repl) => `<<<<<<< ORIGINAL\n${orig}\n=======\n${repl}\n>>>>>>> UPDATED`;

const ORACLE = {
	'create-file': (t) => [
		{ toolCalls: [{ name: 'create_file_or_folder', args: { uri: t.abs('hello.txt') } }] },
		{ toolCalls: [{ name: 'rewrite_file', args: { uri: t.abs('hello.txt'), new_content: 'VADER\n' } }] },
		{ text: 'Created hello.txt.' },
	],
	'fix-bug': (t) => [
		{ toolCalls: [{ name: 'read_file', args: { uri: t.abs('src/app.js') } }] },
		{ toolCalls: [{ name: 'edit_file', args: { uri: t.abs('src/app.js'), search_replace_blocks: SR('  return a - b; // BUG: should add', '  return a + b;') } }] },
		{ text: 'Fixed: add now adds.' },
	],
	'write-function': (t) => [
		{ toolCalls: [{ name: 'create_file_or_folder', args: { uri: t.abs('greet.js') } }] },
		{ toolCalls: [{ name: 'rewrite_file', args: { uri: t.abs('greet.js'), new_content: "function greet(name) {\n  return 'Hello, ' + name;\n}\nmodule.exports = { greet };\n" } }] },
		{ text: 'Created greet.js.' },
	],
	'transform-file': (t) => [
		{ toolCalls: [{ name: 'read_file', args: { uri: t.abs('notes.txt') } }] },
		{ toolCalls: [{ name: 'create_file_or_folder', args: { uri: t.abs('out.txt') } }] },
		{ toolCalls: [{ name: 'rewrite_file', args: { uri: t.abs('out.txt'), new_content: t.read('notes.txt').toUpperCase() } }] },
		{ text: 'Wrote out.txt.' },
	],
};

export const oracleTaskScenarios = TASKS.map(task => ({
	name: `agent tasks (scripted perfect model): ${task.id} is completed end to end through the real tools`,
	timeout: 180_000,
	fn: async (t) => {
		task.setup(t);
		t.use(seq(ORACLE[task.id](t)));
		await t.send(task.prompt);
		const r = await t.runUntilIdle({ timeout: 120_000 });
		t.check('the run ends', r.idle, JSON.stringify(r));
		t.check('the task is solved on disk', !!task.grade(t));
		t.check('no error is shown in the chat', (await t.ui.errorTexts(t.page)).length === 0);
	},
}));
