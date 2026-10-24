#!/usr/bin/env node
// Controlled-service unit tests: no vendor executable, network, UI or credential file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = process.env.VADER_TEST_REPO ?? path.resolve(here, '../../../../../..');
const require = createRequire(path.join(repo, 'package.json'));
const { build } = require('esbuild');
const root = path.join(repo, 'src/vs/workbench/contrib/vader');
const file = path.join(root, 'browser/externalAgents/externalAgentsService.ts');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-signin-unit-'));
let service, passed = 0, failed = 0;
const check = async (name, fn) => { try { await fn(); passed++; console.log(`PASS: ${name}`); } catch (e) { failed++; console.error(`FAIL: ${name}\n${e.stack}`); } };
try {
	await build({ stdin: { contents: `export { ExternalAgentsService } from '${file.replaceAll('\\', '/')}'; export { ExternalAgentService } from '${path.join(root, 'common/externalAgents/externalAgentService.ts').replaceAll('\\', '/')}';`, resolveDir: root, loader: 'ts' },
		bundle: true, platform: 'node', format: 'cjs', outfile: path.join(tmp, 'service.cjs'), logLevel: 'error',
		tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
		plugins: [{ name: 'controlled-service-identifiers', setup(b) {
			b.onResolve({ filter: /(?:vaderSettingsService|terminalToolService)\.js$/ }, a => ({ path: a.path, namespace: 'unit-service-id' }));
			b.onLoad({ filter: /.*/, namespace: 'unit-service-id' }, a => ({ contents: `export const ${a.path.includes('terminalTool') ? 'ITerminalToolService' : 'IVaderSettingsService'} = () => {};` }));
			b.onLoad({ filter: /externalAgentsService\.ts$/ }, () => ({ contents: fs.readFileSync(file, 'utf8') + '\nexport { ExternalAgentsService };', loader: 'ts', resolveDir: path.dirname(file) }));
		} }] });
	const { ExternalAgentsService, ExternalAgentService } = require(path.join(tmp, 'service.cjs'));
	await check('the renderer IPC facade preserves install plans, consent fingerprints and forced registry checks', async () => {
		const calls = [];
		const proxy = new ExternalAgentService({ getChannel(name) {
			assert.equal(name, 'vader-channel-externalAgent');
			return { listen: () => () => ({ dispose() {} }), async call(method, args) { calls.push([method, args]); return method === 'getInstallPlan' ? { version: '3.0.0', fingerprint: 'confirmed' } : undefined; } };
		} });
		assert.equal((await proxy.getInstallPlan('cursor')).fingerprint, 'confirmed');
		await proxy.install('cursor', 'confirmed'); await proxy.checkRegistry(true);
		assert.deepEqual(calls, [['getInstallPlan', ['cursor']], ['install', ['cursor', 'confirmed']], ['checkRegistry', [true]]]);
	});
	const agent = { id: 'custom-connect-agent', name: 'Connect Agent', command: 'never-execute-fixture', args: [] };
	let checks = 0, probes = 0, connections = 0;
	const settings = { state: { globalSettings: { customAcpAgents: [agent] } }, onDidChangeState() { return { dispose() {} }; } };
	const main = {
		onEvent() { return { dispose() {} }; },
		async getStatuses() { return [{ id: agent.id, state: 'ready' }]; },
		async probe(id, custom) { assert.equal(id, agent.id); assert.equal(custom, agent); probes++; return { ok: true }; },
		async checkSignIn(id, custom) { assert.equal(id, agent.id); assert.equal(custom, agent); checks++; return { signedIn: false, canSignOut: true }; },
		async connect() { connections++; return { signedIn: true, canSignOut: true }; },
	};
	service = new ExternalAgentsService(main, settings, {}, { getWorkspace() { return { folders: [] }; } }, {}, { get() { return '{}'; } });
	await check('refresh remains passive and does not claim authentication', async () => {
		await Promise.all([service.refresh(), service.refresh()]);
		assert.equal(checks, 0); assert.equal(probes, 0); assert.equal(connections, 0); assert.equal(service.state.signIn[agent.id], undefined);
	});
	await check('explicit test preserves probe and establishes signed-out state', async () => {
		await service.testConnection(agent.id);
		assert.equal(probes, 1); assert.equal(checks, 1); assert.equal(service.state.probes[agent.id].ok, true);
		assert.equal(service.state.signIn[agent.id].state, 'out'); assert.equal(service.state.busy[agent.id], undefined);
	});
	await check('Connect uses the vendor flow and publishes signed-in state', async () => {
		await service.connect(agent.id); assert.equal(connections, 1); assert.equal(service.state.signIn[agent.id].state, 'in');
	});
	await check('failed sign-in check does not preserve an earlier signed-in state', async () => {
		main.checkSignIn = async () => ({ signedIn: false, error: 'Agent did not answer' });
		await service.testConnection(agent.id); assert.equal(service.state.signIn[agent.id].state, 'unknown');
		assert.equal(service.state.signIn[agent.id].error, 'Agent did not answer');
	});
	await check('rejected check exposes the error and releases busy state', async () => {
		main.checkSignIn = async () => { throw new Error('transport failed'); };
		await service.testConnection(agent.id); assert.equal(service.state.signIn[agent.id].state, 'unknown');
		assert.equal(service.state.signIn[agent.id].error, 'transport failed'); assert.equal(service.state.busy[agent.id], undefined);
	});
	await check('failed protocol probe does not start sign-in and clears stale authentication', async () => {
		let signInCalls = 0; main.checkSignIn = async () => { signInCalls++; return { signedIn: true }; };
		service.state = { ...service.state, signIn: { [agent.id]: { state: 'in' } } };
		main.probe = async () => ({ ok: false, error: 'protocol rejected' });
		await service.testConnection(agent.id); assert.equal(signInCalls, 0); assert.equal(service.state.signIn[agent.id].state, 'unknown');
		assert.equal(service.state.probes[agent.id].error, 'protocol rejected');
	});
	await check('connect transport failure does not claim signed-out or signed-in certainty', async () => {
		main.connect = async () => ({ signedIn: false, error: 'startup failed' });
		await service.connect(agent.id); assert.equal(service.state.signIn[agent.id].state, 'unknown');
		assert.equal(service.state.errors[agent.id], 'startup failed'); assert.equal(service.state.busy[agent.id], undefined);
	});
	await check('overlapping explicit actions cannot overwrite the active sign-in check', async () => {
		let release; main.probe = async () => ({ ok: true });
		main.checkSignIn = () => new Promise(resolve => { release = resolve; });
		let overlappingConnects = 0; main.connect = async () => { overlappingConnects++; return { signedIn: true }; };
		const pending = service.testConnection(agent.id);
		await Promise.resolve(); await Promise.resolve();
		assert.equal(service.state.signIn[agent.id].state, 'checking');
		await service.connect(agent.id); assert.equal(overlappingConnects, 0);
		release({ signedIn: false }); await pending;
		assert.equal(service.state.signIn[agent.id].state, 'out');
	});
	await check('automatic and explicit release checks share one request and expose its actual timestamp', async () => {
		let finish; let calls = 0;
		main.checkRegistry = async force => { assert.equal(force, false); calls++; return new Promise(resolve => { finish = resolve; }); };
		const first = service.checkRegistry(false), second = service.checkRegistry(true);
		assert.equal(first, second); await Promise.resolve(); assert.equal(calls, 1);
		finish({ updated: ['Codex'], checkedAt: 1234 }); await first;
		assert.deepEqual(service.state.registry, { checking: false, checkedAt: 1234, error: undefined });
	});
	await check('failed or incomplete release checks remain visible and recover on the next successful check', async () => {
		main.checkRegistry = () => { throw new Error('registry offline'); };
		await assert.rejects(service.checkRegistry(false), /registry offline/);
		assert.equal(service.state.registry.checking, false); assert.match(service.state.registry.error, /registry offline/);
		main.checkRegistry = async () => ({ updated: [], checkedAt: 2345, warning: 'Missing compatible agent release' });
		await service.checkRegistry(false); assert.match(service.state.registry.error, /Missing compatible/);
		main.checkRegistry = async () => ({ updated: [], checkedAt: 3456 });
		await service.checkRegistry(true); assert.equal(service.state.registry.error, undefined);
	});
	for (const mode of ['approved', 'cancelled', 'failed']) {
		await check(`a missing built-in agent connects only after ${mode} installation consent/result`, async () => {
			let installed = false; const calls = [];
			const builtinMain = {
				onEvent() { return { dispose() {} }; },
				async getStatuses() { return [{ id: 'codex', state: installed ? 'ready' : 'not-installed', source: 'vader' }]; },
				async getInstallPlan() { return { version: '9.0.0', package: '@agentclientprotocol/codex-acp@9.0.0', fingerprint: 'reviewed-release' }; },
				async install(_id, fingerprint) { assert.equal(fingerprint, 'reviewed-release'); calls.push('install'); if (mode === 'failed') throw new Error('download unavailable'); installed = true; },
				async connect() { calls.push('vendor-auth'); return { signedIn: true, canSignOut: true }; },
			};
			const dialogs = { async confirm(options) {
				calls.push('consent');
				assert.equal(options.custom, true, 'installation consent belongs inside the application');
				assert.match(options.detail, /npm registry|checksum/);
				assert.match(options.detail, /codex-acp@9\.0\.0/, 'consent describes the live plan rather than the embedded snapshot');
				assert.match(options.detail, /connect, test its connection, or send it a message/);
				assert.doesNotMatch(options.detail, /only runs when you send/);
				return { confirmed: mode !== 'cancelled' };
			} };
			const builtin = new ExternalAgentsService(builtinMain, { ...settings, state: { globalSettings: { customAcpAgents: [] } } }, {}, { getWorkspace() { return { folders: [] }; } }, dialogs, { get() { return '{}'; } });
			try {
				await builtin.refresh(); await builtin.connect('codex');
				assert.deepEqual(calls, mode === 'approved' ? ['consent', 'install', 'vendor-auth'] : mode === 'cancelled' ? ['consent'] : ['consent', 'install']);
				assert.equal(builtin.state.busy.codex, undefined);
				if (mode === 'approved') assert.equal(builtin.state.signIn.codex.state, 'in');
				else assert.notEqual(builtin.state.signIn.codex?.state, 'in');
				if (mode === 'failed') assert.match(builtin.state.errors.codex, /download unavailable/);
			} finally { builtin.dispose(); }
		});
	}
	await check('a terminal-agent update uses vendor installation consent without treating an existing executable as update success', async () => {
		const FakeTimers = require('@sinonjs/fake-timers'); const clock = FakeTimers.install();
		let inventory = 0, opened;
		const client = new ExternalAgentsService({ onEvent() { return { dispose() {} }; }, async getStatuses() { inventory++; return [{ id: 'claude-code', state: 'ready' }]; } },
			settings, { async openProgramTerminal(options) { opened = options; } }, { getWorkspace() { return { folders: [] }; } },
			{ async confirm(options) { assert.equal(options.title, 'Update Claude Code'); assert.equal(options.primaryButton, 'Update'); return { confirmed: true }; } }, { get() { return '{}'; } });
		try {
			await client.refresh(); await client.install('claude-code'); await clock.tickAsync(3001);
			assert.equal(inventory, 1); assert.equal(opened.name, 'Update Claude Code');
			assert.match(opened.args.join(' '), /https:\/\/claude\.ai\/install\.(ps1|sh)/);
		} finally { client.dispose(); clock.uninstall(); }
	});
} finally { service?.dispose(); fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
