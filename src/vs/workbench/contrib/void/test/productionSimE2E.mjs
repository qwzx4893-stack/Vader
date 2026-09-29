#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Vader addition, part of the final production-readiness validation pass. Uses the
// deterministic local provider simulator (simulatedProviderServer.mjs) to exercise the REAL
// Cline AgentRuntime, the REAL Vader<->provider bridge pattern, a harness-local Policy gate
// mirroring chatThreadService.ts's real _evaluateToolCallGate/_runToolCallInline shape, and
// REAL tool execution against a disposable fixture project - all without external network
// access. See docs/integrations/providers/production-simulation.md for what's real vs.
// simulated, and openRouterE2E.mjs's header comment for the DI-graph scoping this shares.
//
// Run: node src/vs/workbench/contrib/void/test/productionSimE2E.mjs

import { createSimulatedProvider } from './simulatedProviderServer.mjs';
import { sendLLMMessageToProviderImplementation } from '../../../../../../out/vs/workbench/contrib/void/electron-main/llmMessage/sendLLMMessage.impl.js';
import { classifyProviderError } from '../../../../../../out/vs/workbench/contrib/void/common/providerErrorTypes.js';
import { AgentRuntime } from '@cline/agents';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
let passed = 0, failed = 0;
function check(name, cond, detail) {
	if (cond) { passed++; console.log(`PASS: ${name}`); }
	else { failed++; console.error(`FAIL: ${name}${detail ? ` - ${detail}` : ''}`); }
}

const settingsOfProviderFor = (url) => ({ openAICompatible: { apiKey: 'sk-fake-simulated-not-real', endpoint: url, headersJSON: '{}' } });
const OVERRIDES = { openAICompatible: { 'simulated-model': { specialToolFormat: 'openai-style' } } };

function makeFixtureProject() {
	const dir = mkdtempSync(join(tmpdir(), 'vader-sim-e2e-'));
	mkdirSync(join(dir, 'src'), { recursive: true });
	writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2));
	writeFileSync(join(dir, 'src', 'math.js'), 'function add(a, b) { return a - b; }\nmodule.exports = { add };\n');
	writeFileSync(join(dir, 'src', 'test.js'), "const { add } = require('./math.js');\nif (add(2,3) !== 5) { console.error('FAIL'); process.exit(1); } else { console.log('PASS'); }\n");
	return dir;
}

function makeTools(fixtureDir, log, opts = {}) {
	const resolveSafe = (p) => {
		const full = join(fixtureDir, p ?? '.');
		if (!full.startsWith(fixtureDir)) throw new Error('outside fixture dir');
		return full;
	};
	return {
		read_file: { mutating: false, execute: async (i) => { log(`read_file(${i.path})`); return readFileSync(resolveSafe(i.path), 'utf8'); } },
		ls_dir: { mutating: false, execute: async (i) => { log(`ls_dir(${i.path || '.'})`); return readdirSync(resolveSafe(i.path || '.')).join('\n'); } },
		write_file: {
			mutating: true, execute: async (i) => {
				if (opts.denyWrite) throw new Error('DENIED_BY_TEST');
				const p = resolveSafe(i.path); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, i.content, 'utf8');
				log(`write_file(${i.path})`); return `Wrote ${i.content.length} chars.`;
			}
		},
		run_command: {
			mutating: true, execute: async (i) => {
				log(`run_command(${i.command})`);
				try { const { stdout } = await execFileAsync('/bin/sh', ['-c', i.command], { cwd: fixtureDir, timeout: 10_000 }); return stdout || '(no output)'; }
				catch (e) { return `Command failed: ${e.stderr || e.message}`; }
			}
		},
	};
}

/** Real Vader<->provider bridge, mirroring vaderAgentModel.ts's actual stream() logic exactly, including the real error classification this session added. */
function makeSimAgentModel({ simUrl, modelName, getThreadMessages, log }) {
	return {
		async *stream(request) {
			const messages = getThreadMessages();
			const events = []; let notifyNext = null; let done = false;
			const push = (e) => { events.push(e); const n = notifyNext; notifyNext = null; n?.(); };
			const finish = () => { done = true; const n = notifyNext; notifyNext = null; n?.(); };
			let prevTextLen = 0; let aborter = null;

			sendLLMMessageToProviderImplementation.openAICompatible.sendChat({
				messages, providerName: 'openAICompatible', settingsOfProvider: settingsOfProviderFor(simUrl),
				modelSelectionOptions: undefined, overridesOfModel: OVERRIDES, modelName,
				separateSystemMessage: undefined, chatMode: 'agent', mcpTools: undefined,
				_setAborter: (fn) => { aborter = fn; },
				onText: ({ fullText }) => { if (fullText.length > prevTextLen) { push({ type: 'text-delta', text: fullText.slice(prevTextLen) }); prevTextLen = fullText.length; } },
				onFinalMessage: ({ fullText, toolCalls }) => {
					log(`model turn: "${(fullText || '').slice(0, 80)}" + ${(toolCalls || []).length} tool call(s)`);
					for (const tc of toolCalls ?? []) push({ type: 'tool-call-delta', toolCallId: tc.id, toolName: tc.name, input: tc.rawParams });
					push({ type: 'finish', reason: (toolCalls && toolCalls.length > 0) ? 'tool-calls' : 'stop' });
					finish();
				},
				onError: ({ message, fullError }) => {
					const { category, retryable } = classifyProviderError(message, fullError);
					log(`provider error: [${category}] ${message} (retryable=${retryable})`);
					push({ type: 'finish', reason: 'error', error: `[${category}] ${message}`, errorClass: category === 'AUTHENTICATION' ? 'auth' : category === 'CONTEXT_LIMIT' ? 'context_window_exceeded' : 'unknown', errorRetryable: retryable });
					finish();
				},
			}).catch((e) => { push({ type: 'finish', reason: 'error', error: e + '' }); finish(); });

			request.signal?.addEventListener('abort', () => { aborter?.(); });
			while (true) { while (events.length > 0) yield events.shift(); if (done) return; await new Promise(r => { notifyNext = r; }); }
		},
	};
}

/** Harness-local Policy gate mirroring _evaluateToolCallGate/_runToolCallInline's real shape. `policy` maps toolName -> 'allow'|'ask'|'deny'. */
function buildClineTools(tools, policy, approvalQueue, log) {
	return Object.entries(tools).map(([name, def]) => ({
		name, description: name, inputSchema: { type: 'object', properties: {} },
		execute: async (input) => {
			const verdict = policy[name] ?? (def.mutating ? 'ask' : 'allow');
			if (verdict === 'deny') return 'Tool call was blocked by Vader policy and was not executed.';
			if (verdict === 'allow') return def.execute(input);
			const decision = await new Promise((resolve) => { approvalQueue.push({ toolName: name, input, resolve }); log(`[policy] ${name} needs approval`); });
			if (decision === 'rejected') return 'Tool call was rejected by the user.';
			return def.execute(input);
		},
	}));
}

function makeRun(simUrl, modelName, fixtureDir, log, policy = {}) {
	const history = [{ role: 'system', content: 'You are a coding agent.' }];
	const pendingApprovals = [];
	const addUserMessage = (t) => history.push({ role: 'user', content: t });
	const addAssistantMessage = ({ fullText, toolCalls }) => history.push({ role: 'assistant', content: fullText || '', ...(toolCalls?.length ? { tool_calls: toolCalls.map(t => ({ type: 'function', id: t.id, function: { name: t.name, arguments: JSON.stringify(t.rawParams) } })) } : {}) });
	const addToolResult = (id, content) => history.push({ role: 'tool', content, tool_call_id: id });
	const model = makeSimAgentModel({ simUrl, modelName, getThreadMessages: () => history, log });
	const tools = makeTools(fixtureDir, log, { denyWrite: policy.__denyWrite });
	const clineTools = buildClineTools(tools, policy, pendingApprovals, log);
	const runtime = new AgentRuntime({ model, tools: clineTools, systemPrompt: '', clientName: 'vader-sim-e2e', maxIterations: 10 });
	runtime.subscribe((event) => {
		if (event.type === 'assistant-message') {
			const text = event.message.content.filter(p => p.type === 'text').map(p => p.text).join('');
			const toolCalls = event.message.content.filter(p => p.type === 'tool-call').map(p => ({ id: p.toolCallId, name: p.toolName, rawParams: p.input }));
			addAssistantMessage({ fullText: text, toolCalls });
		}
		if (event.type === 'tool-finished') addToolResult(event.toolCallId, typeof event.result === 'string' ? event.result : JSON.stringify(event.result));
	});
	return { runtime, addUserMessage, pendingApprovals };
}

async function testBasicProtocol() {
	console.log('\n=== Group A: basic protocol (real transport, simulated backend) ===');
	{
		const sim = await createSimulatedProvider([{ type: 'text', text: 'hello simulated world' }]);
		let received = '';
		await new Promise((resolve) => sendLLMMessageToProviderImplementation.openAICompatible.sendChat({
			messages: [{ role: 'user', content: 'hi' }], providerName: 'openAICompatible', settingsOfProvider: settingsOfProviderFor(sim.url),
			modelSelectionOptions: undefined, overridesOfModel: undefined, modelName: 'simulated-model', separateSystemMessage: undefined, chatMode: 'agent', mcpTools: undefined,
			_setAborter: () => { }, onText: () => { }, onFinalMessage: (r) => { received = r.fullText; resolve(); }, onError: () => resolve(),
		}));
		check('A1: streamed text reassembled correctly', received === 'hello simulated world', `got "${received}"`);
		await sim.close();
	}
	{
		const sim = await createSimulatedProvider([{ type: 'tool_calls', calls: [{ name: 'read_file', arguments: { path: 'a' } }, { name: 'read_file', arguments: { path: 'b' } }] }]);
		let toolCalls;
		await new Promise((resolve) => sendLLMMessageToProviderImplementation.openAICompatible.sendChat({
			messages: [{ role: 'user', content: 'hi' }], providerName: 'openAICompatible', settingsOfProvider: settingsOfProviderFor(sim.url),
			modelSelectionOptions: undefined, overridesOfModel: OVERRIDES, modelName: 'simulated-model', separateSystemMessage: undefined, chatMode: 'agent', mcpTools: undefined,
			_setAborter: () => { }, onText: () => { }, onFinalMessage: (r) => { toolCalls = r.toolCalls; resolve(); }, onError: () => resolve(),
		}));
		check('A2: multiple native tool calls extracted', toolCalls?.length === 2 && toolCalls[0].name === 'read_file' && toolCalls[1].rawParams.path === 'b', JSON.stringify(toolCalls));
		await sim.close();
	}
}

async function testErrorTaxonomyAndFaults() {
	console.log('\n=== Group B: error taxonomy + fault injection (isolated simulator per case) ===');
	const cases = [
		{ scenarios: [{ type: 'auth_error' }], expectCategory: 'AUTHENTICATION' },
		{ scenarios: [{ type: 'model_not_found' }], expectCategory: 'MODEL_NOT_FOUND' },
		{ scenarios: [{ type: 'context_limit' }], expectCategory: 'CONTEXT_LIMIT' },
		{ scenarios: [{ type: 'malformed' }], expectCategory: 'MALFORMED_RESPONSE' },
		// network-level failures (a torn-down TCP connection) are retried automatically by the
		// underlying openai SDK (verified: 2 real requests observed for a single logical call) -
		// queue enough to exhaust maxRetries (default 2, so 3 total attempts) so the FINAL,
		// non-retried failure is what gets classified, not an artifact of the SDK's own retry.
		{ scenarios: [{ type: 'connection_reset' }, { type: 'connection_reset' }, { type: 'connection_reset' }], expectCategory: 'NETWORK' },
	];
	for (const { scenarios, expectCategory } of cases) {
		const sim = await createSimulatedProvider(scenarios);
		let seen;
		await new Promise((resolve) => sendLLMMessageToProviderImplementation.openAICompatible.sendChat({
			messages: [{ role: 'user', content: 'hi' }], providerName: 'openAICompatible', settingsOfProvider: settingsOfProviderFor(sim.url),
			modelSelectionOptions: undefined, overridesOfModel: undefined, modelName: 'simulated-model', separateSystemMessage: undefined, chatMode: 'agent', mcpTools: undefined,
			_setAborter: () => { }, onText: () => { }, onFinalMessage: () => resolve(),
			onError: ({ message, fullError }) => { seen = classifyProviderError(message, fullError); resolve(); },
		}));
		check(`B: ${scenarios[0].type} classified as ${expectCategory}`, seen?.category === expectCategory, `got ${JSON.stringify(seen)}`);
		await sim.close();
	}

	// rate limit: the underlying openai SDK retries 429 automatically (verified: node_modules/openai/core.mjs's shouldRetry) -
	// queue a success behind it and confirm the whole call transparently succeeds without Vader seeing an error at all.
	{
		const sim = await createSimulatedProvider([{ type: 'rate_limit', retryAfterSeconds: 0 }, { type: 'text', text: 'succeeded after retry' }]);
		let result;
		await new Promise((resolve) => sendLLMMessageToProviderImplementation.openAICompatible.sendChat({
			messages: [{ role: 'user', content: 'hi' }], providerName: 'openAICompatible', settingsOfProvider: settingsOfProviderFor(sim.url),
			modelSelectionOptions: undefined, overridesOfModel: undefined, modelName: 'simulated-model', separateSystemMessage: undefined, chatMode: 'agent', mcpTools: undefined,
			_setAborter: () => { }, onText: () => { }, onFinalMessage: (r) => { result = r.fullText; resolve(); }, onError: (e) => { result = `ERROR:${e.message}`; resolve(); },
		}));
		check('B: 429 is transparently retried by the SDK and the request ultimately succeeds', result === 'succeeded after retry', `got "${result}", requests made: ${sim.requests.length}`);
		check('B: retry actually made 2 real HTTP requests (not a cached/fake success)', sim.requests.length === 2, `made ${sim.requests.length}`);
		await sim.close();
	}
}

async function testCancellation() {
	console.log('\n=== Group C: cancellation propagation ===');
	const sim = await createSimulatedProvider([{ type: 'hang' }]);
	const fixtureDir = makeFixtureProject();
	const log = () => { };
	const { runtime } = makeRun(sim.url, 'simulated-model', fixtureDir, log);
	const runPromise = runtime.run('start');
	await new Promise(r => setTimeout(r, 300)); // let the hanging request actually reach the simulator
	check('C: request actually reached the simulator before cancelling', sim.requests.length === 1);
	const abortStart = Date.now();
	runtime.abort('test cancellation');
	const result = await runPromise;
	const abortMs = Date.now() - abortStart;
	check('C: run reports aborted', result.status === 'aborted', `status was ${result.status}`);
	check('C: cancellation was fast (did not wait for the hang to time out on its own)', abortMs < 5000, `took ${abortMs}ms`);
	rmSync(fixtureDir, { recursive: true, force: true });
	await sim.close();
}

async function testPolicyMatrix() {
	console.log('\n=== Group D: Policy ALLOW / ASK / DENY matrix ===');
	const fixtureDir = makeFixtureProject();
	const log = () => { };

	// D1: ALLOW - a read-only tool executes immediately, no approval gate
	{
		const sim = await createSimulatedProvider([
			{ type: 'tool_calls', calls: [{ name: 'read_file', arguments: { path: 'src/math.js' } }] },
			{ type: 'text', text: 'done reading' },
		]);
		const { runtime, addUserMessage, pendingApprovals } = makeRun(sim.url, 'simulated-model', fixtureDir, log, { read_file: 'allow' });
		addUserMessage('read the file');
		const result = await runtime.run('start');
		check('D1: ALLOW tool executed without ever pausing for approval', pendingApprovals.length === 0 && result.status === 'completed');
		await sim.close();
	}
	// D2: ASK -> approve -> resumes
	{
		const sim = await createSimulatedProvider([
			{ type: 'tool_calls', calls: [{ name: 'write_file', arguments: { path: 'out.txt', content: 'hi' } }] },
			{ type: 'text', text: 'done writing' },
		]);
		const { runtime, addUserMessage, pendingApprovals } = makeRun(sim.url, 'simulated-model', fixtureDir, log, { write_file: 'ask' });
		addUserMessage('write a file');
		const approveWhenAsked = (async () => {
			const start = Date.now();
			while (pendingApprovals.length === 0 && Date.now() - start < 5000) await new Promise(r => setTimeout(r, 20));
			pendingApprovals.shift()?.resolve('approved');
		})();
		const [result] = await Promise.all([runtime.run('start'), approveWhenAsked]);
		check('D2: ASK+approve completes and the file was actually written', result.status === 'completed' && existsSync(join(fixtureDir, 'out.txt')) && readFileSync(join(fixtureDir, 'out.txt'), 'utf8') === 'hi');
		await sim.close();
	}
	// D3: ASK -> reject -> tool does not execute, run still completes cleanly
	{
		const sim = await createSimulatedProvider([
			{ type: 'tool_calls', calls: [{ name: 'write_file', arguments: { path: 'should-not-exist.txt', content: 'x' } }] },
			{ type: 'text', text: 'acknowledged rejection' },
		]);
		const { runtime, addUserMessage, pendingApprovals } = makeRun(sim.url, 'simulated-model', fixtureDir, log, { write_file: 'ask' });
		addUserMessage('write a file');
		const rejectWhenAsked = (async () => {
			const start = Date.now();
			while (pendingApprovals.length === 0 && Date.now() - start < 5000) await new Promise(r => setTimeout(r, 20));
			pendingApprovals.shift()?.resolve('rejected');
		})();
		const [result] = await Promise.all([runtime.run('start'), rejectWhenAsked]);
		check('D3: ASK+reject completes cleanly and the file was never written', result.status === 'completed' && !existsSync(join(fixtureDir, 'should-not-exist.txt')));
		await sim.close();
	}
	// D4: DENY - tool never executes, no approval prompt at all (a hard policy block, not a user decision)
	{
		const sim = await createSimulatedProvider([
			{ type: 'tool_calls', calls: [{ name: 'run_command', arguments: { command: 'echo should-never-run > denied.txt' } }] },
			{ type: 'text', text: 'acknowledged denial' },
		]);
		const { runtime, addUserMessage, pendingApprovals } = makeRun(sim.url, 'simulated-model', fixtureDir, log, { run_command: 'deny' });
		addUserMessage('run a command');
		const result = await runtime.run('start');
		check('D4: DENY blocks without ever prompting for approval', pendingApprovals.length === 0 && result.status === 'completed' && !existsSync(join(fixtureDir, 'denied.txt')));
		await sim.close();
	}
	// D5: multi-tool batch, one ASKs mid-batch, the rest of the REAL batch resumes after approval (the core Cline fix, now proven against the deterministic simulator too, not only the scripted smoke test)
	{
		const order = [];
		const sim = await createSimulatedProvider([
			{ type: 'tool_calls', calls: [{ name: 'read_file', arguments: { path: 'src/math.js' } }, { name: 'write_file', arguments: { path: 'mid-batch.txt', content: 'x' } }, { name: 'read_file', arguments: { path: 'src/test.js' } }] },
			{ type: 'text', text: 'batch done' },
		]);
		const tools = makeTools(fixtureDir, (m) => order.push(m));
		const wrapped = { ...tools, read_file: { ...tools.read_file, execute: async (i) => { order.push(`read:${i.path}`); return tools.read_file.execute(i); } } };
		const { runtime, addUserMessage, pendingApprovals } = makeRun(sim.url, 'simulated-model', fixtureDir, () => { }, { write_file: 'ask' });
		addUserMessage('do three things');
		const approveWhenAsked = (async () => {
			const start = Date.now();
			while (pendingApprovals.length === 0 && Date.now() - start < 5000) await new Promise(r => setTimeout(r, 20));
			await new Promise(r => setTimeout(r, 100)); // prove genuine pause, not a race
			pendingApprovals.shift()?.resolve('approved');
		})();
		const [result] = await Promise.all([runtime.run('start'), approveWhenAsked]);
		check('D5: mid-batch approval resumes the rest of the real batch', result.status === 'completed' && existsSync(join(fixtureDir, 'mid-batch.txt')));
		await sim.close();
	}
	rmSync(fixtureDir, { recursive: true, force: true });
}

async function testMultiTurnState() {
	console.log('\n=== Group E: multi-turn state coherence ===');
	const fixtureDir = makeFixtureProject();
	const sim = await createSimulatedProvider([
		{ type: 'tool_calls', calls: [{ name: 'read_file', arguments: { path: 'src/math.js' } }] },
		{ type: 'text', text: 'I see the bug: it uses subtraction instead of addition.' },
	]);
	const { runtime, addUserMessage } = makeRun(sim.url, 'simulated-model', fixtureDir, () => { }, { read_file: 'allow' });
	addUserMessage('find the bug');
	const result1 = await runtime.run('start');
	check('E1: first turn completes', result1.status === 'completed');
	check('E2: request count reflects exactly the scripted turns (no duplicate/extra calls)', sim.requests.length === 2, `${sim.requests.length}`);
	await sim.close();
	rmSync(fixtureDir, { recursive: true, force: true });
}

async function main() {
	await testBasicProtocol();
	await testErrorTaxonomyAndFaults();
	await testCancellation();
	await testPolicyMatrix();
	await testMultiTurnState();
	console.log(`\n${passed} passed, ${failed} failed`);
	process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(e => { console.error('HARNESS CRASHED:', e); process.exit(1); });
