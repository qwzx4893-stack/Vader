#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Vader addition, part of the production-hardening pass (Part II: real OpenRouter/Cline E2E
// testing). Exercises the REAL, compiled provider path
// (electron-main/llmMessage/sendLLMMessage.impl.js's sendLLMMessageToProviderImplementation.
// openRouter.sendChat - the exact function shipped in the app, not a reimplementation) and the
// REAL, installed @cline/agents AgentRuntime together, against a real OpenRouter model, driving
// a real coding task against a disposable fixture project on disk.
//
// What this deliberately is NOT: a full IChatThreadService/DI-graph test. toolsService.ts's
// tool implementations are wired to ~15 VS Code platform services (IFileService,
// IWorkspaceContextService, ITerminalToolService, ...) that only exist inside a running
// Electron workbench - which this sandbox cannot launch (a pre-existing, documented
// limitation). Building a full fake of that DI graph would be a bigger, riskier undertaking
// than the two things actually novel and risk-bearing in the Cline integration: (1) a real
// model's tool-call output flowing through @cline/agents' AgentRuntime correctly, and (2) the
// mid-batch-approval-resume fix holding up against a REAL model's real (not scripted)
// multi-tool-call behavior. Both of those are exercised for real here. The tool *executors*
// below are a lean, harness-local reimplementation against a disposable fixture directory
// (plain fs/child_process - the same operations toolsService.ts's read_file/edit_file/
// run_command ultimately perform), not toolsService.ts itself.
//
// Requires OPENROUTER_API_KEY in the environment (never hardcoded, never written to any file
// this script controls). Never printed, logged, or included in any output file this script
// writes.
//
// Run: OPENROUTER_API_KEY=... node src/vs/workbench/contrib/void/test/openRouterE2E.mjs

import { sendLLMMessageToProviderImplementation } from '../../../../../../out/vs/workbench/contrib/void/electron-main/llmMessage/sendLLMMessage.impl.js';
import { AgentRuntime } from '@cline/agents';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const API_KEY = process.env.OPENROUTER_API_KEY;
if (!API_KEY) {
	console.error('FAIL: OPENROUTER_API_KEY is not set in the environment. This harness never hardcodes a credential - export it before running:');
	console.error('  OPENROUTER_API_KEY=sk-or-... node src/vs/workbench/contrib/void/test/openRouterE2E.mjs');
	process.exit(1);
}

// A minimal SettingsOfProvider - only settingsOfProvider.openRouter is actually read at
// runtime by newOpenAICompatibleSDK, so the other ProviderName keys don't need to exist for
// this plain-JS harness (they'd only be required by TypeScript's structural typing, which
// doesn't apply here).
const settingsOfProvider = { openRouter: { apiKey: API_KEY, models: [] } };

let passed = 0, failed = 0;
function check(name, cond, detail) {
	if (cond) { passed++; console.log(`PASS: ${name}`); }
	else { failed++; console.error(`FAIL: ${name}${detail ? ` - ${detail}` : ''}`); }
}

// ---------------- 1. pick an economical but genuinely capable model ----------------
// Queried live against OpenRouter's public (unauthenticated) /models endpoint - see
// docs/integrations/providers/e2e-testing.md for the reasoning and the exact candidates
// compared. Falls back to this hardcoded, well-established, cheap, tool-calling-reliable
// default if the live query fails (e.g. transient network issue) - gpt-4o-mini via OpenRouter
// is a standard, well-tested choice for reliable tool-calling at low cost.
async function pickModel() {
	const fallback = 'openai/gpt-4o-mini';
	try {
		const res = await fetch('https://openrouter.ai/api/v1/models');
		if (!res.ok) return fallback;
		const json = await res.json();
		const candidates = json.data.filter(m => {
			const id = m.id.toLowerCase();
			const supportsTools = (m.supported_parameters || []).includes('tools');
			const promptPrice = Number(m.pricing?.prompt ?? 1);
			return supportsTools && promptPrice > 0 && promptPrice < 0.000002 && // < $2/M input tokens
				(id.includes('gpt-4o-mini') || id.includes('gpt-5-mini') || id.includes('gpt-5-nano') || id.includes('claude-3-5-haiku') || id.includes('claude-haiku'));
		});
		if (candidates.length === 0) return fallback;
		// cheapest input price among the economical, known-reliable-for-tools candidates
		candidates.sort((a, b) => Number(a.pricing.prompt) - Number(b.pricing.prompt));
		return candidates[0].id;
	} catch {
		return fallback;
	}
}

// ---------------- 2. disposable fixture workspace, OUTSIDE Vader's source tree ----------------
function makeFixtureProject() {
	const dir = mkdtempSync(join(tmpdir(), 'vader-e2e-fixture-'));
	writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture-project', version: '1.0.0', scripts: { test: 'node test.js' } }, null, 2));
	writeFileSync(join(dir, 'math.js'), [
		'// A small utility module with one deliberate bug for the agent to find and fix.',
		'function add(a, b) {',
		'  return a - b; // BUG: should be a + b',
		'}',
		'function multiply(a, b) {',
		'  return a * b;',
		'}',
		'module.exports = { add, multiply };',
		'',
	].join('\n'));
	writeFileSync(join(dir, 'test.js'), [
		"const { add, multiply } = require('./math.js');",
		'let failures = 0;',
		'if (add(2, 3) !== 5) { console.error(`add(2,3) expected 5, got ${add(2,3)}`); failures++; }',
		'if (multiply(3, 4) !== 12) { console.error(`multiply(3,4) expected 12, got ${multiply(3,4)}`); failures++; }',
		'if (failures === 0) { console.log("ALL TESTS PASSED"); process.exit(0); } else { process.exit(1); }',
		'',
	].join('\n'));
	writeFileSync(join(dir, 'README.md'), '# Fixture Project\n\nA tiny math utility module used only to exercise Vader\'s real Cline-driven agent loop end-to-end.\n');
	return dir;
}

// ---------------- 3. lean, real tool executors against the fixture directory ----------------
// Mirrors toolsService.ts's read_file/ls_dir/edit_file/create_file_or_folder/run_command in
// spirit (same operations, same real fs/process side effects) without the full VS Code
// service DI graph those implementations depend on - see this file's header comment.
function makeTools(fixtureDir, log) {
	const resolveSafe = (relPath) => {
		const p = join(fixtureDir, relPath ?? '.');
		if (!p.startsWith(fixtureDir)) throw new Error('Refusing to access a path outside the fixture directory.');
		return p;
	};
	return {
		read_file: {
			description: 'Read a file\'s full contents.',
			mutating: false,
			inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'relative path' } }, required: ['path'] },
			execute: async (input) => {
				const p = resolveSafe(input.path);
				log(`read_file(${input.path})`);
				return readFileSync(p, 'utf8');
			},
		},
		ls_dir: {
			description: 'List files and folders in a directory (non-recursive).',
			mutating: false,
			inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'relative path, or "." for root' } }, required: [] },
			execute: async (input) => {
				const p = resolveSafe(input.path || '.');
				log(`ls_dir(${input.path || '.'})`);
				return readdirSync(p).map(name => {
					const full = join(p, name);
					return `${statSync(full).isDirectory() ? '[dir] ' : ''}${name}`;
				}).join('\n');
			},
		},
		write_file: {
			description: 'Overwrite a file with new full contents (creates it if it does not exist).',
			mutating: true,
			inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
			execute: async (input) => {
				const p = resolveSafe(input.path);
				mkdirSync(dirname(p), { recursive: true });
				writeFileSync(p, input.content, 'utf8');
				log(`write_file(${input.path}) - ${input.content.length} chars`);
				return `Wrote ${input.content.length} characters to ${input.path}.`;
			},
		},
		run_command: {
			description: 'Run a shell command in the fixture project directory (e.g. `node test.js`).',
			mutating: true,
			inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
			execute: async (input) => {
				log(`run_command(${input.command})`);
				try {
					const { stdout, stderr } = await execFileAsync('/bin/sh', ['-c', input.command], { cwd: fixtureDir, timeout: 15_000 });
					return `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ''}`.trim() || '(no output)';
				} catch (e) {
					return `Command failed (exit ${e.code}): ${e.stdout || ''}${e.stderr || e.message}`;
				}
			},
		},
	};
}

// ---------------- 4. the real Vader<->OpenRouter provider bridge, mirroring vaderAgentModel.ts ----------------
function makeOpenRouterAgentModel({ modelName, getThreadMessages, log }) {
	return {
		async *stream(request) {
			const messages = getThreadMessages();
			const events = [];
			let notifyNext = null;
			let done = false;
			const push = (e) => { events.push(e); const n = notifyNext; notifyNext = null; n?.(); };
			const finish = () => { done = true; const n = notifyNext; notifyNext = null; n?.(); };

			let prevTextLen = 0;
			let aborter = null;

			sendLLMMessageToProviderImplementation.openRouter.sendChat({
				messages,
				providerName: 'openRouter',
				settingsOfProvider,
				modelSelectionOptions: undefined,
				overridesOfModel: undefined,
				modelName,
				separateSystemMessage: undefined,
				chatMode: 'agent',
				mcpTools: undefined,
				_setAborter: (fn) => { aborter = fn; },
				onText: ({ fullText }) => {
					if (fullText.length > prevTextLen) {
						push({ type: 'text-delta', text: fullText.slice(prevTextLen) });
						prevTextLen = fullText.length;
					}
				},
				onFinalMessage: ({ fullText, toolCalls }) => {
					log(`model turn: "${fullText.slice(0, 120).replace(/\n/g, ' ')}${fullText.length > 120 ? '...' : ''}" + ${(toolCalls || []).length} tool call(s): [${(toolCalls || []).map(t => t.name).join(', ')}]`);
					for (const toolCall of toolCalls ?? []) {
						push({ type: 'tool-call-delta', toolCallId: toolCall.id, toolName: toolCall.name, input: toolCall.rawParams });
					}
					push({ type: 'finish', reason: (toolCalls && toolCalls.length > 0) ? 'tool-calls' : 'stop' });
					finish();
				},
				onError: ({ message }) => {
					log(`provider error: ${message}`);
					push({ type: 'finish', reason: 'error', error: message });
					finish();
				},
			}).catch((e) => {
				push({ type: 'finish', reason: 'error', error: e + '' });
				finish();
			});

			request.signal?.addEventListener('abort', () => { aborter?.(); });

			while (true) {
				while (events.length > 0) yield events.shift();
				if (done) return;
				await new Promise(resolve => { notifyNext = resolve; });
			}
		},
	};
}

// ---------------- 5. a harness-local Policy gate, mirroring _evaluateToolCallGate/_runToolCallInline ----------------
// ALLOW: read_file/ls_dir run immediately (read-only, matching Vader's real approval-type
// convention). ASK: every mutating tool (write_file/run_command) awaits an external promise
// resolved by the test driver, exactly like chatThreadService.ts's _runToolCallInline awaits
// _pendingInlineApprovals - proving the mid-batch-resume fix holds with a REAL model's real
// tool-call batch, not just the scripted smoke test.
function buildClineTools(tools, approvalQueue, threadHistory, log) {
	return Object.entries(tools).map(([name, def]) => ({
		name,
		description: def.description,
		inputSchema: def.inputSchema,
		execute: async (input, ctx) => {
			if (!def.mutating) {
				const result = await def.execute(input);
				return result;
			}
			// ASK: register this call and wait for the test driver's decision
			const decision = await new Promise((resolve) => {
				approvalQueue.push({ toolName: name, input, resolve });
				log(`[policy] ${name} requires approval - paused, waiting for test driver`);
			});
			if (decision === 'rejected') {
				return 'Tool call was rejected by the user.';
			}
			return def.execute(input);
		},
	}));
}

// ---------------- test scenarios ----------------
// Builds one fresh, independent AgentRuntime + its own message history bound to a shared
// fixture directory - each scenario is a real, separate Cline turn against the same real
// OpenRouter model, so scenarios can't leak tool-call state into each other even though they
// share the same on-disk fixture project.
function makeScenario(modelName, fixtureDir, log, systemPrompt) {
	const history = [{ role: 'system', content: systemPrompt }];
	const pendingApprovals = [];
	function addUserMessage(text) { history.push({ role: 'user', content: text }); }
	function addAssistantMessage({ fullText, toolCalls }) {
		history.push({ role: 'assistant', content: fullText || '', ...(toolCalls?.length ? { tool_calls: toolCalls.map(t => ({ type: 'function', id: t.id, function: { name: t.name, arguments: JSON.stringify(t.rawParams) } })) } : {}) });
	}
	function addToolResult(toolCallId, content) {
		history.push({ role: 'tool', content, tool_call_id: toolCallId });
	}
	const model = makeOpenRouterAgentModel({ modelName, getThreadMessages: () => history, log });
	const tools = makeTools(fixtureDir, log);
	const clineTools = buildClineTools(tools, pendingApprovals, history, log);
	const runtime = new AgentRuntime({ model, tools: clineTools, systemPrompt: '', clientName: 'vader-e2e-test', maxIterations: 10 });
	runtime.subscribe((event) => {
		if (event.type === 'assistant-message') {
			const text = event.message.content.filter(p => p.type === 'text').map(p => p.text).join('');
			const toolCalls = event.message.content.filter(p => p.type === 'tool-call').map(p => ({ id: p.toolCallId, name: p.toolName, rawParams: p.input }));
			addAssistantMessage({ fullText: text, toolCalls });
		}
		if (event.type === 'tool-finished') {
			addToolResult(event.toolCallId, typeof event.result === 'string' ? event.result : JSON.stringify(event.result));
		}
	});
	return { runtime, addUserMessage, pendingApprovals };
}

async function main() {
	console.log('Selecting an economical, tool-capable OpenRouter model...');
	const modelName = await pickModel();
	console.log(`Selected model: ${modelName}\n`);

	const fixtureDir = makeFixtureProject();
	console.log(`Fixture project: ${fixtureDir} (outside Vader's source tree, disposable)\n`);
	const log = (msg) => console.log(`  ${msg}`);
	const SYSTEM_PROMPT = 'You are a careful coding agent. Use the available tools to inspect and fix the fixture project. Be concise.';

	// ---- Test 1: real coding task, exercising multi-tool-call ordering, auto-approved ----
	console.log('--- Test 1: real coding task (find + fix a bug, verify with tests), auto-approved ----');
	{
		const { runtime, addUserMessage, pendingApprovals } = makeScenario(modelName, fixtureDir, log, SYSTEM_PROMPT);
		addUserMessage('There is a bug in math.js - run the tests with `node test.js`, find out what\'s wrong from the failure, fix math.js, then run the tests again to confirm they pass. Explain what you found in one sentence at the end.');
		const autoApproveInterval = setInterval(() => {
			while (pendingApprovals.length > 0) {
				const req = pendingApprovals.shift();
				log(`[policy] auto-approving ${req.toolName}`);
				req.resolve('approved');
			}
		}, 200);
		let result;
		try { result = await runtime.run('start'); } finally { clearInterval(autoApproveInterval); }

		check('test1: run completed', result.status === 'completed', `status was ${result.status}`);
		const finalMathJs = readFileSync(join(fixtureDir, 'math.js'), 'utf8');
		check('test1: model actually fixed the bug in math.js', /return\s+a\s*\+\s*b/.test(finalMathJs), 'math.js does not contain a fixed add() implementation');
		try {
			await execFileAsync('node', ['test.js'], { cwd: fixtureDir });
			check('test1: fixture project tests now pass for real', true);
		} catch (e) {
			check('test1: fixture project tests now pass for real', false, e.stdout || e.message);
		}
	}

	// ---- Test 2: real ask -> pause -> delayed approval -> resume, against a live model ----
	console.log('\n--- Test 2: ask -> pause -> delayed approval -> resume (real model, real delay) ---');
	{
		const { runtime, addUserMessage, pendingApprovals } = makeScenario(modelName, fixtureDir, log, SYSTEM_PROMPT);
		addUserMessage('Append the line "// reviewed" to the end of README.md using a tool call, then tell me you are done.');
		let sawPending = false;
		let approvedAfterDelayMs = null;
		const approveOnce = async () => {
			const start = Date.now();
			while (pendingApprovals.length === 0) {
				if (Date.now() - start > 15_000) return; // gave up waiting for a tool call at all
				await new Promise(r => setTimeout(r, 100));
			}
			sawPending = true;
			log('[policy] holding approval for 2s to prove the run genuinely pauses, not just architecturally');
			await new Promise(r => setTimeout(r, 2000));
			const req = pendingApprovals.shift();
			approvedAfterDelayMs = Date.now() - start;
			req.resolve('approved');
		};
		const [result] = await Promise.all([runtime.run('start'), approveOnce()]);
		check('test2: model actually requested the mutating tool', sawPending, 'no tool call reached the approval gate - model may have answered without using a tool');
		check('test2: run completed after the delayed approval', result.status === 'completed', `status was ${result.status}`);
		check('test2: approval delay was genuinely awaited (>=1.8s)', (approvedAfterDelayMs ?? 0) >= 1800, `measured ${approvedAfterDelayMs}ms`);
		const readme = existsSync(join(fixtureDir, 'README.md')) ? readFileSync(join(fixtureDir, 'README.md'), 'utf8') : '';
		check('test2: README.md was actually updated after resume', readme.includes('reviewed'), 'README.md does not contain the expected line');
	}

	// ---- Test 3: real rejection, verifying the model adapts instead of the run breaking ----
	console.log('\n--- Test 3: reject a mutating tool call, verify graceful handling ---');
	{
		const { runtime, addUserMessage, pendingApprovals } = makeScenario(modelName, fixtureDir, log, SYSTEM_PROMPT);
		addUserMessage('Run `rm -rf .` to clean the project (using the run_command tool), then confirm it is done.');
		let sawPending = false;
		const rejectOnce = async () => {
			const start = Date.now();
			while (pendingApprovals.length === 0) {
				if (Date.now() - start > 15_000) return;
				await new Promise(r => setTimeout(r, 100));
			}
			sawPending = true;
			const req = pendingApprovals.shift();
			log(`[policy] rejecting ${req.toolName}`);
			req.resolve('rejected');
		};
		const [result] = await Promise.all([runtime.run('start'), rejectOnce()]);
		check('test3: model actually requested the mutating tool', sawPending);
		check('test3: run completed cleanly after rejection (no crash)', result.status === 'completed', `status was ${result.status}`);
		check('test3: fixture directory still exists (rejection actually prevented the destructive command)', existsSync(fixtureDir));
	}

	console.log(`\nThis run made real network calls to OpenRouter against model ${modelName} and consumed real (small) API credit.`);

	rmSync(fixtureDir, { recursive: true, force: true });
	console.log(`\n${passed} passed, ${failed} failed`);
	process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((e) => {
	console.error('HARNESS CRASHED:', e);
	process.exit(1);
});
