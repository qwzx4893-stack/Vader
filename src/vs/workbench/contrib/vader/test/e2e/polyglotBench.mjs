#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// TEST-ONLY. Runs the Aider "polyglot" benchmark (225 Exercism exercises in C++, Go, Java, JavaScript, Python and Rust; https://github.com/Aider-AI/polyglot-benchmark)
// through the REAL packaged Vader app, so that the number can be set beside the figures Aider publishes for the same model on its public leaderboard.
//
// The protocol is Aider's (aider/benchmark/benchmark.py):
//   - the exercise is the whole working folder; the answer files are the "solution" files of .meta/config.json, the tests are the "test" files;
//   - attempt 1: the exercise instructions plus Aider's addendum; attempt 2 (only if the tests failed): the test output plus Aider's "tests are correct" text,
//     in the same conversation; "pass_rate_2" is the share solved within the two attempts, "pass_rate_1" the share solved by the first;
//   - the tests are run with Aider's per-language commands, in the same toolchains (a Docker image: see grader/Dockerfile), after the original test files are put back;
//   - a run is judged ONLY by the tests on the final files, never by what the model says.
// Differences from Aider's own runs (stated with every result): Vader is an agent, so it can read the tests and the folder, and it may run commands itself;
// the .meta and .docs folders are removed from the workspace (the reference solution lives in .meta).
//
// env: VADER_EXE, PW_CORE (as for suite.mjs); POLYGLOT_DIR (clone of Aider-AI/polyglot-benchmark); OPENROUTER_API_KEY; POLY_MODEL (OpenRouter id);
//      POLY_FALLBACK_MODEL (a :free id, used once POLY_BUDGET_USD is spent); POLY_BUDGET_USD (default 0 = never spend); POLY_COUNT (sample size, default 10);
//      POLY_LANGS (csv), POLY_SEED, POLY_ONLY (csv of lang/name), POLY_RUN (label; results are appended to <E2E_OUT>/<label>.jsonl and finished exercises are skipped),
//      POLY_ATTEMPT_MS (per attempt, default 360000), POLY_GRADER_IMAGE (default vader-grader).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config, makeWorkspace, runGroup, summarize } from './harness.mjs';
import { createLlmProxy } from './llmProxy.mjs';

const env = process.env;
const POLY = env.POLYGLOT_DIR;
const MODEL = env.POLY_MODEL;
if (!config.exe || !fs.existsSync(config.exe)) { console.error(`VADER_EXE missing or not found: ${config.exe}`); process.exit(2); }
if (!POLY || !fs.existsSync(POLY)) { console.error(`POLYGLOT_DIR missing: ${POLY}`); process.exit(2); }
if (!MODEL || !env.OPENROUTER_API_KEY) { console.error('POLY_MODEL and OPENROUTER_API_KEY are required'); process.exit(2); }

const LANGS = (env.POLY_LANGS ?? 'cpp,go,java,javascript,python,rust').split(',');
const COUNT = Number(env.POLY_COUNT ?? 10);
const SEED = Number(env.POLY_SEED ?? 1);
const ATTEMPT_MS = Number(env.POLY_ATTEMPT_MS ?? 300_000);
const STALL_MS = Number(env.POLY_STALL_MS ?? 90_000);
const MODE = env.POLY_MODE ?? 'edit-only';
const HIDE_TESTS = env.POLY_HIDE_TESTS !== '0';
const IMAGE = env.POLY_GRADER_IMAGE ?? 'vader-grader';
const RUN = env.POLY_RUN ?? 'polyglot';
// The app is configured with a model name Vader knows to support native tool calling (the proxy sends every request to POLY_MODEL regardless): with an unknown name on the
// OpenAI-compatible provider Vader asks for XML tool calls in text, which measures that fallback instead of the agent.
const APP_MODEL = env.POLY_APP_MODEL ?? 'gpt-4o';
fs.mkdirSync(config.out, { recursive: true });
const resultsFile = path.join(config.out, `${RUN}.jsonl`);

// ---- Aider's text, verbatim (aider/benchmark/prompts.py)
const addendum = (files) => `\n####\n\nUse the above instructions to modify the supplied files: ${files}\nDon't change the names of existing functions or classes, as they may be referenced from other code like unit tests, etc.\nOnly use standard libraries, don't suggest installing any packages.\n`;
const failureAddendum = (files) => `\n####\n\nSee the testing errors above.\nThe tests are correct, don't try and change them.\nFix the code in ${files} to resolve the errors.\n`;

const TEST_CMD = {
	'.py': 'pytest',
	'.rs': 'cargo test -- --include-ignored',
	'.go': 'go test ./...',
	'.js': '/grader/npm-test.sh',
	'.cpp': '/grader/cpp-test.sh',
	'.java': 'sh ./gradlew test',
};

// ---- the exercise list and a reproducible, language-proportional sample
function listExercises() {
	const all = [];
	for (const lang of LANGS) {
		const base = path.join(POLY, lang, 'exercises', 'practice');
		if (!fs.existsSync(base)) { continue; }
		for (const name of fs.readdirSync(base).sort()) {
			if (fs.existsSync(path.join(base, name, '.meta', 'config.json'))) { all.push({ lang, name, id: `${lang}/${name}`, dir: path.join(base, name) }); }
		}
	}
	return all;
}
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function sample(all, n, seed) {
	if (env.POLY_ONLY) { const want = new Set(env.POLY_ONLY.split(',')); return all.filter(e => want.has(e.id)); }
	if (n >= all.length) { return all; }
	const rand = rng(seed);
	const shuffled = [...all].map(e => ({ e, k: rand() })).sort((a, b) => a.k - b.k).map(x => x.e);
	const byLang = {};
	for (const e of shuffled) { (byLang[e.lang] ??= []).push(e); }
	// largest-remainder allocation so the sample keeps the languages' shares of the full set
	const quotas = LANGS.filter(l => byLang[l]).map(l => ({ l, q: (byLang[l].length / all.length) * n }));
	const take = Object.fromEntries(quotas.map(x => [x.l, Math.floor(x.q)]));
	let rest = n - Object.values(take).reduce((a, b) => a + b, 0);
	for (const x of [...quotas].sort((a, b) => (b.q - Math.floor(b.q)) - (a.q - Math.floor(a.q)))) { if (rest-- > 0) { take[x.l]++; } }
	return LANGS.flatMap(l => (byLang[l] ?? []).slice(0, take[l] ?? 0));
}

const done = new Set();
if (fs.existsSync(resultsFile)) { for (const line of fs.readFileSync(resultsFile, 'utf8').split('\n')) { try { const r = JSON.parse(line); if (r.id && r.finished) { done.add(r.id); } } catch { /* skip */ } } }
const chosen = sample(listExercises(), COUNT, SEED);
// POLY_SHARD="i/N": several copies of this script (each with its own app window) share the work; they all append to the same results file
const [shardI, shardN] = (env.POLY_SHARD ?? '0/1').split('/').map(Number);
const todo = chosen.filter((e, i) => !done.has(e.id) && i % shardN === shardI);
console.log(`polyglot: ${chosen.length} exercises in the sample (${[...new Set(chosen.map(e => e.lang))].map(l => `${l} ${chosen.filter(e => e.lang === l).length}`).join(', ')}); ${done.size} already done in ${resultsFile}; ${todo.length} to run`);

// ---- running one exercise
function prepareWorkspace(ex, t) {
	const cfg = JSON.parse(fs.readFileSync(path.join(ex.dir, '.meta', 'config.json'), 'utf8'));
	const files = cfg.files ?? {};
	const testFiles = files.test ?? [];
	const exampleFiles = files.example ?? [];
	let instructions = '';
	const doc = (n) => { const p = path.join(ex.dir, '.docs', n); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };
	instructions += doc('introduction.md') + doc('instructions.md') + doc('instructions.append.md');
	// copy the exercise, minus .meta (reference solution) and .docs (the instructions go in the message)
	fs.cpSync(ex.dir, t.ws, { recursive: true, filter: s => { const rel = path.relative(ex.dir, s).split(path.sep)[0]; return rel !== '.meta' && rel !== '.docs'; } });
	const ignore = new Set(['CMakeLists.txt', 'Cargo.toml', ...testFiles, ...exampleFiles]);
	const solution = (files.solution ?? []).filter(f => !ignore.has(f) && fs.existsSync(path.join(t.ws, f)));
	// Aider's model never sees the tests (only the instructions and the stub, then the failing output): by default they are taken out of the workspace while the agent works,
	// and put back by the grader. POLY_HIDE_TESTS=0 leaves them in (an agent that can read the tests solves more: that is a different, easier measurement).
	if (HIDE_TESTS) { for (const f of testFiles) { try { fs.rmSync(path.join(t.ws, f), { force: true }); } catch { /* absent */ } } }
	const fileList = solution.map(f => path.basename(f)).join(' ');
	return { cfg, testFiles, solution, fileList, instructions: instructions + addendum(fileList) };
}

function gradeInDocker(ex, ws, testFiles) {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'poly-grade-'));
	try {
		fs.cpSync(ws, tmp, { recursive: true, filter: s => path.basename(s) !== '.git' });
		for (const f of ['CMakeLists.txt', 'Cargo.toml']) { // Aider never lets the model touch these two build files
			const src = path.join(ex.dir, f); if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(tmp, f)); }
		}
		for (const f of testFiles) { // the original tests are put back, as Aider does
			const dst = path.join(tmp, f); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(path.join(ex.dir, f), dst);
			if (f.endsWith('.java')) { fs.writeFileSync(dst, fs.readFileSync(dst, 'utf8').replace(/@Disabled\([^)]*\)\s*\n/g, '')); }
		}
		const ext = [...new Set(testFiles.map(f => path.extname(f)))].find(e => TEST_CMD[e]);
		const cmd = ext && TEST_CMD[ext];
		if (!cmd) { return { ok: false, output: `no test command for ${testFiles.join(',')}`, error: true }; }
		const args = ['run', '--rm', '--memory=3g', '-v', `${tmp}:/work/${ex.name}`, '-w', `/work/${ex.name}`, '-v', 'vader-gradle:/root/.gradle', IMAGE, 'bash', '-c', cmd];
		try {
			const out = execFileSync('docker', args, { stdio: 'pipe', timeout: 300_000, maxBuffer: 64 * 1024 * 1024 }).toString();
			return { ok: true, output: out };
		} catch (e) {
			const out = `${e.stdout ?? ''}${e.stderr ?? ''}` || String(e.message);
			return { ok: false, output: e.killed ? `Tests timed out!\n${out}` : out, timedOut: !!e.killed };
		}
	} finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ } }
}

const clip = (s, n = 7000) => { s = s.replace(/\x1b\[[0-9;]*m/g, ''); return s.length > n ? '...\n' + s.slice(-n) : s; };

const proxyLog = path.join(config.out, `${RUN}-requests.jsonl`);
// POLY_PROMPT=source: measure the INSTALLED app with the agent instructions and tool descriptions of the SOURCE tree (promptSwap.mjs), to compare instructions without a rebuild
const PROMPT = env.POLY_PROMPT ?? 'app';
const promptSwap = PROMPT === 'source' ? await (await import('./promptSwap.mjs')).loadPromptSwap(env.VADER_SRC ?? process.cwd()) : null;
const proxy = await createLlmProxy({ apiKey: env.OPENROUTER_API_KEY, model: MODEL, fallbackModel: env.POLY_FALLBACK_MODEL, budgetUsd: Number(env.POLY_BUDGET_USD ?? 0), logFile: proxyLog, transform: promptSwap?.swap });
console.log(`proxy: ${proxy.url} (model ${MODEL}; fallback ${env.POLY_FALLBACK_MODEL ?? 'none'}; paid budget $${env.POLY_BUDGET_USD ?? 0})`);

const scenarios = todo.map(ex => ({
	name: `polyglot ${ex.id}`,
	timeout: 2 * (ATTEMPT_MS + 120_000) + 600_000,
	fn: async (t) => {
		if (proxy.state.budgetExhausted || proxy.state.dailyFreeExhausted) { t.info(`${ex.id}: skipped, the budget or the free daily quota is spent`, true); return; }
		const before = { ...proxy.state, byModel: { ...proxy.state.byModel } };
		const prep = prepareWorkspace(ex, t);
		const rec = { id: ex.id, lang: ex.lang, name: ex.name, model: MODEL, attempts: [], finished: false };
		const t0 = Date.now();
		let message = prep.instructions;
		for (let k = 1; k <= 2; k++) {
			const a0 = Date.now();
			if (k === 2) { await t.sleep(500); }
			// everything the app itself reports while this attempt runs: renderer errors, main-process log lines, and (below) what the chat shows
			const problemsFrom = t.app.problems.length;
			const mainFrom = t.app.mainOutput().length;
			await t.send(message);
			// wait for the agent to finish, but give up when it passes the time limit OR when the model has not been asked anything for STALL_MS
			// (a terminal command that never returns, or a loop that no longer calls the model): both are findings, and neither should cost a whole timeout
			// POLY_MODE=edit-only (default, Aider's protocol: the model only edits files, the tests are run by the benchmark): file edits are approved, every other request
			// (terminal, project checks...) is rejected, as the model could not run anything in Aider either. POLY_MODE=agent approves everything (the full product).
			const r = { idle: false, approvals: 0, rejections: 0, reason: 'time' };
			for (let w0 = Date.now(), idleSince = 0; ;) {
				if (await t.ui.approvalPending(t.page)) {
					idleSince = 0;
					const tools = (await t.transcript()).filter(x => x.kind === 'tool');
					const header = String(tools[tools.length - 1]?.text ?? '');
					if (MODE === 'agent' || /\b(edit|edited|write|wrote|rewrite|rewrote|creat)/i.test(header.split('\n')[0])) { await t.approve(); r.approvals++; } else { await t.reject(); r.rejections++; }
					await t.sleep(500); continue;
				}
				if (await t.ui.isRunning(t.page)) { idleSince = 0; } else if (!idleSince) { idleSince = Date.now(); } else if (Date.now() - idleSince >= 1500) { r.idle = true; r.reason = 'idle'; break; }
				if (Date.now() - w0 >= ATTEMPT_MS) { r.reason = 'time'; break; }
				if (proxy.state.inFlight === 0 && Date.now() - Math.max(proxy.state.lastActivityAt, w0) > STALL_MS) { r.reason = 'stall'; break; }
				await t.sleep(200);
			}
			const stuck = r.idle ? null : { reason: r.reason, screen: await t.page.locator('body').innerText().then(s => s.replace(/\s+/g, ' ').slice(-1800)).catch(() => null) };
			if (stuck) { // the agent kept working past the time limit: keep the evidence, then press Stop so the next step starts from a quiet app
				await t.shot(`${ex.lang}-${ex.name}-attempt${k}-STUCK`);
				await t.page.locator('[data-testid="vader-stop"]').first().click({ timeout: 5000 }).catch(() => { });
				await t.sleep(2500);
			}
			const g = gradeInDocker(ex, t.ws, prep.testFiles);
			const obs = { stuck, rendererProblems: t.app.problems.slice(problemsFrom).map(p => p.slice(0, 300)), mainLog: t.app.mainOutput().slice(mainFrom).split(/\r?\n/).filter(l => /error|exception|ERR_|fail|spawn|unhandled|crash|EPERM|ENOENT/i.test(l) && !/DEP0040|trace-deprecation/.test(l)).slice(0, 20).map(l => l.slice(0, 300)) };
			try { // the full chat of this attempt, to tell a model failure from a product failure afterwards
				const tr = await t.transcript();
				const tools = tr.filter(x => x.kind === 'tool');
				const toolErrors = tools.filter(x => /\bError\b|failed|rejected|No Search\/Replace|not found|invalid|denied|timed out/i.test(String(x.text)));
				const last = [...tr].reverse().find(x => x.kind === 'assistant-text' && String(x.text).trim());
				obs.tools = tools.length; obs.toolErrors = toolErrors.length; obs.toolErrorSamples = toolErrors.slice(0, 5).map(x => String(x.text).replace(/\s+/g, ' ').slice(0, 220));
				obs.endedWithToolLikeText = !!(last && /^\s*(\{|<tool_call|<[a-z_]+>)/.test(String(last.text)) && /"command"|"uri"|"name"|<tool_call|<[a-z_]+>/.test(String(last.text)));
				obs.finalMessage = last ? String(last.text).replace(/\s+/g, ' ').slice(0, 240) : null;
				const dir = path.join(config.out, `${RUN}-transcripts`); fs.mkdirSync(dir, { recursive: true });
				fs.writeFileSync(path.join(dir, `${ex.lang}-${ex.name}-attempt${k}.json`), JSON.stringify({ obs, transcript: tr, testOutput: clip(g.output, 4000), files: Object.fromEntries(prep.solution.map(f => [f, fs.existsSync(path.join(t.ws, f)) ? fs.readFileSync(path.join(t.ws, f), 'utf8').slice(0, 6000) : null])) }, null, 1));
				if (!g.ok) { await t.shot(`${ex.lang}-${ex.name}-attempt${k}`); }
			} catch { /* diagnostics only */ }
			rec.attempts.push({ pass: g.ok, idle: !!r.idle, approvals: r.approvals ?? null, rejections: r.rejections ?? 0, stopReason: r.reason, ms: Date.now() - a0, timedOut: !!g.timedOut, graderError: !!g.error, obs });
			t.info(`${ex.id} attempt ${k}: ${g.ok ? 'PASS' : 'fail'}`, g.ok, `${Math.round((Date.now() - a0) / 1000)} s, idle ${r.idle}`);
			if (g.ok) { break; }
			if (k === 1) { rec.firstFailure = clip(g.output, 1500); }
			message = clip(g.output) + failureAddendum(prep.fileList);
		}
		if (proxy.state.requests - before.requests === 0) { t.info(`${ex.id}: NOT recorded, no request reached this run's proxy (the window was not this run's app)`, true); return; }
		if (proxy.state.budgetExhausted || proxy.state.dailyFreeExhausted) { t.info(`${ex.id}: NOT recorded, the money or the free quota ran out while it was running`, true); return; }
		rec.pass1 = !!rec.attempts[0]?.pass;
		rec.pass2 = rec.attempts.some(a => a.pass);
		rec.ms = Date.now() - t0;
		rec.rateLimitRetries = proxy.state.retries - before.retries; // 429/5xx answers from the model provider that the proxy waited out
	rec.requests = proxy.state.requests - before.requests;
		rec.promptTokens = proxy.state.promptTokens - before.promptTokens;
		rec.completionTokens = proxy.state.completionTokens - before.completionTokens;
		rec.costUsd = Number((proxy.state.spentUsd - before.spentUsd).toFixed(6));
		rec.served = Object.fromEntries(Object.entries(proxy.state.byModel).map(([m, n]) => [m, n - (before.byModel[m] ?? 0)]).filter(([, n]) => n > 0));
		rec.finished = true;
		fs.appendFileSync(resultsFile, JSON.stringify(rec) + '\n');
		t.check('the app stayed responsive through both attempts', rec.attempts.every(a => a.idle));
	},
}));

if (scenarios.length) {
	const ws = makeWorkspace('polyglot');
	// an empty project: the fixture files of the regular suite would sit beside every exercise
	for (const f of fs.readdirSync(ws)) { if (f !== '.git') { fs.rmSync(path.join(ws, f), { recursive: true, force: true }); } }
	fs.writeFileSync(path.join(ws, 'README.md'), '# workspace\n');
	execFileSync('git', ['add', '-A'], { cwd: ws }); execFileSync('git', ['-c', 'user.name=b', '-c', 'user.email=b@x', 'commit', '-q', '-m', 'empty'], { cwd: ws });
	await runGroup({ name: 'polyglot', model: APP_MODEL, baseURL: proxy.url, apiKey: 'via-proxy', workspace: ws, scenarios });
}

// ---- the report over everything finished in the results file for this sample
if (!fs.existsSync(resultsFile)) { console.log('no exercise finished in this process (the app window closed or could not start); nothing to report'); await proxy.close(); summarize(); process.exit(1); }
const rows = fs.readFileSync(resultsFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.finished && chosen.some(c => c.id === r.id));
const latest = Object.values(Object.fromEntries(rows.map(r => [r.id, r])));
const n = latest.length;
const wilson = (k, n) => { if (!n) { return [0, 0]; } const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [Math.max(0, (c - m) / d) * 100, Math.min(1, (c + m) / d) * 100]; };
const k1 = latest.filter(r => r.pass1).length, k2 = latest.filter(r => r.pass2).length;
const byLang = Object.fromEntries(LANGS.map(l => { const r = latest.filter(x => x.lang === l); return [l, r.length ? `${r.filter(x => x.pass2).length}/${r.length}` : '-']; }));
const summary = {
	run: RUN, model: MODEL, app_model_alias: APP_MODEL, exercises: n, sample_of: 225, pass_rate_1: n ? Number((100 * k1 / n).toFixed(1)) : 0, pass_rate_2: n ? Number((100 * k2 / n).toFixed(1)) : 0,
	pass_rate_2_ci95: wilson(k2, n).map(x => Number(x.toFixed(1))), by_language_pass2: byLang,
	requests: latest.reduce((a, r) => a + (r.requests ?? 0), 0), prompt_tokens: latest.reduce((a, r) => a + (r.promptTokens ?? 0), 0), completion_tokens: latest.reduce((a, r) => a + (r.completionTokens ?? 0), 0),
	cost_usd: Number(latest.reduce((a, r) => a + (r.costUsd ?? 0), 0).toFixed(4)), seconds_per_exercise: n ? Math.round(latest.reduce((a, r) => a + r.ms, 0) / n / 1000) : 0,
	served_models: latest.reduce((m, r) => { for (const [k, v] of Object.entries(r.served ?? {})) { m[k] = (m[k] ?? 0) + v; } return m; }, {}),
	not_idle_attempts: latest.reduce((a, r) => a + r.attempts.filter(x => !x.idle).length, 0),
	observed: { // what the app did wrong by itself, independent of whether the answer was right
		attempts: latest.reduce((a, r) => a + r.attempts.length, 0),
		tool_calls: latest.reduce((a, r) => a + r.attempts.reduce((b, x) => b + (x.obs?.tools ?? 0), 0), 0),
		tool_calls_with_errors: latest.reduce((a, r) => a + r.attempts.reduce((b, x) => b + (x.obs?.toolErrors ?? 0), 0), 0),
		attempts_ended_with_tool_call_written_as_text: latest.reduce((a, r) => a + r.attempts.filter(x => x.obs?.endedWithToolLikeText).length, 0),
		attempts_with_renderer_errors: latest.reduce((a, r) => a + r.attempts.filter(x => x.obs?.rendererProblems?.length).length, 0),
		attempts_with_main_process_errors: latest.reduce((a, r) => a + r.attempts.filter(x => x.obs?.mainLog?.length).length, 0),
	},
	mode: MODE, tests_hidden_from_agent: HIDE_TESTS, instructions: PROMPT === 'source' ? 'source tree (promptSwap)' : 'installed app', requests_with_swapped_instructions: proxy.state.swapped,
	method: `Aider polyglot protocol, 2 attempts, tests in Docker; Vader is an agent (reads the folder and the tests); ${MODE === 'edit-only' ? 'commands the agent asks to run are rejected (Aider models cannot run code either)' : 'the agent may run commands on this Windows machine, which lacks the C++/Go/Rust/Java toolchains'}; .meta/.docs removed from the workspace; CMakeLists.txt/Cargo.toml restored before grading`,
};
fs.writeFileSync(path.join(config.out, `${RUN}-summary.json`), JSON.stringify(summary, null, 2));
console.log('\nPOLYGLOT SUMMARY\n' + JSON.stringify(summary, null, 2));
const exhausted = !!(proxy.state.budgetExhausted || proxy.state.dailyFreeExhausted);
if (exhausted) { console.log('STOPPED EARLY: the paid budget or the free daily quota is spent; the exercises not finished are not in the results.'); }
await proxy.close();
summarize();
process.exit(exhausted ? 3 : 0); // 3 = out of money/quota: a wrapper must not retry
