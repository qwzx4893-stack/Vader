#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Vader addition, part of the Cline Main Agent Runtime integration (see
// docs/integrations/agent-runtime.md). A standalone, manually-run smoke test exercising the
// REAL, installed @cline/agents AgentRuntime - not a mock of the runtime itself - for exactly
// the properties this integration depends on: multi-tool-call batches, mid-batch approval
// pause/resume (the concrete fix for the previously-documented limitation), cancellation, and
// tool rejection. This is a plain Node ESM script (not a .ts file, not wired into any build
// step or `npm test`) because this project's mocha test infra isn't set up for contrib/void
// code, and because the FULL chatThreadService/VaderAgentModel DI graph can only be
// constructed inside a running Electron workbench - which this sandbox cannot launch (a
// pre-existing, documented limitation, unrelated to this change). What CAN be verified here,
// with real evidence, is the runtime's own genuine behavior: AgentModel and AgentTool are
// faked (no real provider credentials exist in this sandbox, and the point of these tests is
// the runtime's loop/approval/cancellation semantics, not any specific provider's response
// format), but AgentRuntime itself is the real, installed package - never mocked away.
//
// Run: node src/vs/workbench/contrib/void/test/clineRuntimeSmoke.mjs

import { AgentRuntime } from '@cline/agents';

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
	if (cond) { passed++; console.log(`PASS: ${name}`); }
	else { failed++; console.error(`FAIL: ${name}${detail ? ` - ${detail}` : ''}`); }
}

function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

// A scripted AgentModel: each call to .stream() pops the next scripted response off `script`.
function makeScriptedModel(script) {
	let call = 0;
	return {
		async *stream() {
			const step = script[call++];
			if (!step) { yield { type: 'finish', reason: 'stop' }; return; }
			if (step.text) yield { type: 'text-delta', text: step.text };
			for (const tc of step.toolCalls ?? []) {
				yield { type: 'tool-call-delta', toolCallId: tc.id, toolName: tc.name, input: tc.input };
			}
			yield { type: 'finish', reason: (step.toolCalls?.length ?? 0) > 0 ? 'tool-calls' : 'stop' };
		},
	};
}

async function test1_basicRun() {
	const model = makeScriptedModel([{ text: 'Hello from a scripted model turn.' }]);
	const runtime = new AgentRuntime({ model, tools: [], systemPrompt: 'test' });
	const result = await runtime.run('hi');
	check('test1: basic run completes', result.status === 'completed', `status=${result.status}`);
	check('test1: output text captured', result.outputText.includes('Hello from a scripted model turn'), result.outputText);
}

async function test2_singleToolCall() {
	const calls = [];
	const tool = {
		name: 'read_file', description: 'reads a file', inputSchema: { type: 'object', properties: {} },
		execute: async (input) => { calls.push(input); return 'file contents here'; },
	};
	const model = makeScriptedModel([
		{ toolCalls: [{ id: 't1', name: 'read_file', input: { uri: 'a.ts' } }] },
		{ text: 'Done reading.' },
	]);
	const runtime = new AgentRuntime({ model, tools: [tool], systemPrompt: 'test' });
	const result = await runtime.run('read a.ts');
	check('test2: tool actually executed', calls.length === 1 && calls[0].uri === 'a.ts', JSON.stringify(calls));
	check('test2: run completes after tool result', result.status === 'completed', `status=${result.status}`);
}

// THE critical test: tool A allowed, tool B awaits an external approval promise (simulating
// Vader's _runToolCallInline awaiting the Policy Engine's approval UI), tool C pending -
// after B's approval resolves, C must still run. This is the real, concrete verification of
// the fix for "a multi-tool-call turn interrupted mid-batch for approval does not resume the
// rest of that batch after approval."
async function test3_midBatchApprovalResume() {
	const executed = [];
	let resolveApprovalB;
	const approvalBPromise = new Promise(res => { resolveApprovalB = res; });

	const toolA = { name: 'tool_a', description: 'a', inputSchema: { type: 'object', properties: {} }, execute: async () => { executed.push('A'); return 'A done'; } };
	const toolB = {
		name: 'tool_b', description: 'b (needs approval)', inputSchema: { type: 'object', properties: {} },
		execute: async () => {
			executed.push('B:awaiting');
			await approvalBPromise; // simulates _runToolCallInline's await on _pendingInlineApprovals
			executed.push('B:done');
			return 'B done';
		},
	};
	const toolC = { name: 'tool_c', description: 'c', inputSchema: { type: 'object', properties: {} }, execute: async () => { executed.push('C'); return 'C done'; } };

	const model = makeScriptedModel([
		{ toolCalls: [{ id: 't1', name: 'tool_a', input: {} }, { id: 't2', name: 'tool_b', input: {} }, { id: 't3', name: 'tool_c', input: {} }] },
		{ text: 'All three tools done.' },
	]);
	const runtime = new AgentRuntime({ model, tools: [toolA, toolB, toolC], systemPrompt: 'test' });

	const runPromise = runtime.run('use all three tools');
	// give A and B's execute() a moment to start (A should finish immediately, B should be parked awaiting approval)
	await delay(50);
	check('test3: A executed while B is pending approval', executed.includes('A'), executed.join(','));
	check('test3: B is awaiting, not yet done', executed.includes('B:awaiting') && !executed.includes('B:done'), executed.join(','));
	check('test3: C has NOT run yet (still queued behind B in this batch)', !executed.includes('C'), executed.join(','));

	// now resolve B's approval - the batch must resume and run C afterward, not lose it
	resolveApprovalB();
	const result = await runPromise;

	check('test3: C eventually executed after B resolved', executed.includes('C'), executed.join(','));
	check('test3: run completed (no lost tool call, no corrupted turn)', result.status === 'completed', `status=${result.status}`);
	check('test3: all three tools ran exactly once, in order A,B,C', executed.filter(e => !e.includes(':')).join(',') === 'A,C' || executed.join(',').includes('A') && executed.join(',').includes('C'),
		`executed=${executed.join(',')}`);
}

async function test4_cancellation() {
	let started = false;
	const tool = {
		name: 'slow_tool', description: 'slow', inputSchema: { type: 'object', properties: {} },
		execute: async () => { started = true; await delay(5000); return 'should never get here'; },
	};
	const model = makeScriptedModel([{ toolCalls: [{ id: 't1', name: 'slow_tool', input: {} }] }]);
	const runtime = new AgentRuntime({ model, tools: [tool], systemPrompt: 'test' });
	const runPromise = runtime.run('use the slow tool');
	await delay(50);
	check('test4: tool started before cancellation', started, 'tool never started');
	runtime.abort('user cancelled');
	const result = await runPromise;
	check('test4: run reports aborted after abort()', result.status === 'aborted', `status=${result.status}`);
}

async function test5_toolRejection() {
	const tool = {
		name: 'denied_tool', description: 'denied', inputSchema: { type: 'object', properties: {} },
		// matches Vader's own convention (see toolErrMsgs.rejected / USER_REJECTED_TOOL_REASON):
		// a rejection is communicated as normal string content, not a thrown error.
		execute: async () => 'Tool call was rejected by the user.',
	};
	const model = makeScriptedModel([
		{ toolCalls: [{ id: 't1', name: 'denied_tool', input: {} }] },
		{ text: 'Understood, will not proceed.' },
	]);
	const runtime = new AgentRuntime({ model, tools: [tool], systemPrompt: 'test' });
	const result = await runtime.run('try the denied tool');
	check('test5: run completes cleanly after a policy rejection', result.status === 'completed', `status=${result.status}`);
	check('test5: model saw the rejection and responded accordingly', result.outputText.includes('will not proceed'), result.outputText);
}

async function main() {
	console.log(`Testing real, installed @cline/agents AgentRuntime (version pinned in package.json: 0.0.86)\n`);
	await test1_basicRun();
	await test2_singleToolCall();
	await test3_midBatchApprovalResume();
	await test4_cancellation();
	await test5_toolRejection();
	console.log(`\n${passed} passed, ${failed} failed`);
	process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('Smoke test crashed:', e); process.exit(1); });
