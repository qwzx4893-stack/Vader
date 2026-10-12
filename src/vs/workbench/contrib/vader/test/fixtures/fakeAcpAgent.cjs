/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A stand-in for a vendor's coding agent: speaks the Agent Client Protocol over stdin/stdout, the same wire the real programs use.
// Used by externalAgentE2E.mjs (the service) and e2e/scenarios/externalAgents.mjs (the real app). argv[2] picks the behaviour:
//   basic          thinks, runs one tool, answers "turn N cwd=... you said: <prompt>"
//   permission     asks for permission before the tool and reports the answer
//   hang           starts answering and waits until cancelled
//   crash          prints to stderr and exits during the first prompt
//   auth-agent     needs a sign-in through the agent's own page (authenticate request)
//   auth-terminal  needs a sign-in that runs in a terminal

const mode = process.argv[2] || 'basic';
let buf = '', nextId = 1000, turn = 0, authed = false;
const pending = new Map();
const send = o => process.stdout.write(JSON.stringify(o) + '\n');
const ask = (method, params) => new Promise(res => { const id = nextId++; pending.set(id, res); send({ jsonrpc: '2.0', id, method, params }); });
const update = (sessionId, u) => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: u } });
const text = (sessionId, t) => update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } });
let cancelled = false, hangResolve = null;
async function handle(msg) {
	if (msg.method === 'initialize') {
		const authMethods = mode === 'auth-agent' ? [{ id: 'web', name: 'Sign in on the web', type: 'agent' }]
			: mode === 'auth-terminal' ? [{ id: 'cli', name: 'Sign in with the CLI', type: 'terminal', args: ['login'], env: { FAKE: '1' } }] : [];
		return send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods } });
	}
	if (msg.method === 'authenticate') { authed = true; return send({ jsonrpc: '2.0', id: msg.id, result: {} }); }
	if (msg.method === 'session/new') {
		if ((mode === 'auth-agent' || mode === 'auth-terminal') && !authed) return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'Authentication required' } });
		return send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'S1' } });
	}
	if (msg.method === 'session/cancel') { cancelled = true; if (hangResolve) hangResolve(); return; }
	if (msg.method === 'session/prompt') {
		turn++;
		const sid = msg.params.sessionId;
		const prompt = msg.params.prompt.map(p => p.text).join('');
		if (mode === 'crash') { process.stderr.write('boom: the fake agent crashed'); process.exit(3); }
		if (mode === 'hang') {
			text(sid, 'working...');
			await new Promise(r => { hangResolve = r; });
			return send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'cancelled' } });
		}
		update(sid, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' } });
		update(sid, { sessionUpdate: 'tool_call', toolCallId: 'T1', title: 'Read file', status: 'pending' });
		if (mode === 'permission') {
			const r = await ask('session/request_permission', { sessionId: sid, toolCall: { toolCallId: 'T1', title: 'Run rm -rf build' }, options: [
				{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject', name: 'Reject', kind: 'reject_once' }] });
			text(sid, 'permission:' + (r.outcome.outcome === 'selected' ? r.outcome.optionId : r.outcome.outcome) + ';');
		}
		update(sid, { sessionUpdate: 'tool_call_update', toolCallId: 'T1', status: 'completed' });
		text(sid, 'turn ' + turn + ' cwd=' + process.cwd() + ' you said: ' + prompt);
		return send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } });
	}
	if (msg.id !== undefined && !msg.method && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
}
process.stdin.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) handle(JSON.parse(line)); } });
