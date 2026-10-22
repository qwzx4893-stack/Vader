#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 * Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Controlled service integration, NOT a packaged-app/vendor/OS-process E2E.
// Bundles the actual MCPService, MCPChannel, VaderSettingsService and MCP SDK Client.
// Only host DI identifiers, IPC and synthetic config/storage/transports are supplied here.
// No production lifecycle method, diff, queue, error handler or SDK Client is replaced.
// Transport barriers control races; setImmediate drains work, never sleeps to hide a race.
// Run: node src/vs/workbench/contrib/vader/test/mcpLifecycleE2E.mjs
// Before fixes, without checkout: append --source-ref=HEAD (only the three service sources).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const vader = path.resolve(here, '..');
const slash = p => p.replace(/\\/g, '/');
const sourceFiles = new Map([
	[slash(path.join(vader, 'common/mcpService.ts')), 'MCPService'],
	[slash(path.join(vader, 'common/vaderSettingsService.ts')), 'VaderSettingsService'],
	[slash(path.join(vader, 'electron-main/mcpChannel.ts')), undefined],
]);
const snapshots = new Map();
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 1 && args[0].startsWith('--source-ref=')),
	'usage: node mcpLifecycleE2E.mjs [--source-ref=HEAD]');
const sourceRef = args[0]?.slice('--source-ref='.length);
const sourceCommit = sourceRef ? execFileSync('git', [
	'rev-parse', '--verify', '--end-of-options', sourceRef + '^{commit}',
], { cwd: repo, encoding: 'utf8' }).trim() : undefined;
const transportImports = new Set([
	'@modelcontextprotocol/sdk/client/stdio.js',
	'@modelcontextprotocol/sdk/client/streamableHttp.js',
	'@modelcontextprotocol/sdk/client/sse.js',
]);
const decorator = name => 'export const ' + name + ' = () => {};';
const hostTokens = {
	'platform/files/common/files.js': decorator('IFileService'),
	'platform/encryption/common/encryptionService.js': decorator('IEncryptionService'),
	'platform/storage/common/storage.js': decorator('IStorageService') +
		'export const StorageScope = { APPLICATION: -1, PROFILE: 0, WORKSPACE: 1 };' +
		'export const StorageTarget = { USER: 0, MACHINE: 1 };',
	'services/path/common/pathService.js': decorator('IPathService'),
	'platform/product/common/productService.js': decorator('IProductService'),
	'services/editor/common/editorService.js': decorator('IEditorService'),
	'platform/ipc/common/mainProcessService.js': decorator('IMainProcessService'),
	'contrib/vader/common/metricsService.js': decorator('IMetricsService'),
};
const bundle = await esbuild.build({
	stdin: {
		contents: [
			"export { MCPService } from './common/mcpService.ts';",
			"export { MCPChannel, registerMCPShutdown } from './electron-main/mcpChannel.ts';",
			"export { VaderSettingsService } from './common/vaderSettingsService.ts';",
			"export { Emitter } from '../../../base/common/event.ts';",
			"export { DisposableStore } from '../../../base/common/lifecycle.ts';",
			"export { URI } from '../../../base/common/uri.ts';",
		].join('\n'),
		resolveDir: vader, loader: 'ts',
	},
	bundle: true, platform: 'node', format: 'cjs', write: false, metafile: true,
	logLevel: 'silent', nodePaths: [path.join(repo, 'node_modules')],
	tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
	plugins: [{
		name: 'controlled-host-and-transports',
		setup(build) {
			build.onResolve({ filter: /.*/ }, args => {
				if (transportImports.has(args.path)) return { path: args.path, external: true };
				if (!args.path.startsWith('.')) return;
				const full = slash(path.resolve(args.resolveDir, args.path));
				const key = Object.keys(hostTokens).find(k => full.endsWith('/' + k));
				if (key) return { path: key, namespace: 'host-token' };
			});
			build.onLoad({ filter: /.*/, namespace: 'host-token' }, args => ({
				contents: hostTokens[args.path], loader: 'js',
			}));
			build.onLoad({ filter: /(?:mcpService|mcpChannel|vaderSettingsService)\.ts$/ }, args => {
				const full = slash(args.path);
				if (!sourceFiles.has(full)) return;
				const text = sourceCommit
					? execFileSync('git', ['show', sourceCommit + ':' + slash(path.relative(repo, args.path))],
						{ cwd: repo, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
					: fs.readFileSync(args.path, 'utf8');
				snapshots.set(full, crypto.createHash('sha256').update(text).digest('hex'));
				const className = sourceFiles.get(full);
				// Export private classes for construction only; leave every method untouched.
				const needsExport = className && !new RegExp('export\\s+class\\s+' + className + '\\b').test(text);
				return {
					contents: text + (needsExport ? '\nexport { ' + className + ' };\n' : ''),
					loader: 'ts', resolveDir: path.dirname(args.path),
				};
			});
		},
	}],
});
for (const file of sourceFiles.keys()) assert(snapshots.has(file), 'actual source was not bundled: ' + file);
assert(Object.keys(bundle.metafile.inputs).some(p => /@modelcontextprotocol\/sdk\/.*client\/index\.js$/.test(slash(p))),
	'the real MCP SDK Client must be bundled');

console.log('Controlled MCP service integration; real services + SDK Client, synthetic transports/config/IPC.');
console.log('SOURCE MODE ' + (sourceCommit ? sourceRef + ' @ ' + sourceCommit + ' (three service sources; other dependencies from workspace)' : 'working tree'));
for (const [file, hash] of snapshots) console.log('SOURCE ' + slash(path.relative(repo, file)) + ' sha256=' + hash);

const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
	let resolve;
	const promise = new Promise(r => { resolve = r; });
	return { promise, resolve };
}
async function until(predicate, label) {
	for (let i = 0; i < 100; i++) {
		if (predicate()) return;
		await turn();
	}
	throw new Error('No progress at controlled boundary: ' + label);
}
async function bounded(promise, label) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out: ' + label)), 5000); }),
		]);
	} finally { clearTimeout(timer); }
}
const entry = revision => ({ command: 'fixture:' + revision, args: [] });
const config = (revision, name = 'fixture') => ({ mcpServers: revision ? { [name]: entry(revision) } : {} });
const savedOn = { fixture: { isOn: true, approvedTools: ['echo'], offTools: ['kept_off'] } };

async function fixture(initialConfig, saved = savedOn, plans = {}) {
	const world = {
		transports: [], pending: new Set(), ipcErrors: [], diagnostics: [],
		reads: 0, events: [], timers: new Set(), renderers: [], gates: [], fileWork: new Set(),
		raw: JSON.stringify(initialConfig), watchers: 0,
	};
	const live = () => world.transports.filter(t => t.started && !t.closed);
	class ControlledTransport {
		constructor(params) {
			this.key = typeof params === 'string' || params instanceof URL ? new URL(params).pathname.slice(1) : params.command;
			this.plan = plans[this.key] ?? {};
			if (this.plan.closeGate) world.gates.push(this.plan.closeGate);
			this.started = false;
			this.closed = false;
			world.transports.push(this);
		}
		async start() {
			this.started = true;
			if (this.plan.gate) {
				world.gates.push(this.plan.gate);
				await this.plan.gate.promise;
			}
			if (this.closed) throw new Error('fixture transport closed during start');
			if (this.plan.startError) throw new Error(this.plan.startError);
		}
		async send(message) {
			if (this.closed) throw new Error('fixture transport is closed');
			if (message.id === undefined) return; // initialized/cancel notifications
			let result;
			let error;
			switch (message.method) {
				case 'initialize':
					result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} },
						serverInfo: { name: 'controlled-fixture', version: '1.0.0' } };
					break;
				case 'tools/list':
					if (this.plan.listError) error = { code: -32603, message: this.plan.listError };
					else result = { tools: [{ name: 'echo', description: this.key,
						inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] };
					break;
				case 'tools/call':
					if (this.plan.callError) error = { code: -32603, message: this.plan.callError };
					else result = { content: [{ type: 'text', text: this.key + ':' + (message.params.arguments?.text ?? '') }] };
					break;
				default:
					error = { code: -32601, message: 'Unsupported fixture method: ' + message.method };
			}
			queueMicrotask(() => {
				if (!this.closed) this.onmessage?.({ jsonrpc: '2.0', id: message.id, ...(error ? { error } : { result }) });
				if (message.method === 'tools/list' && this.plan.closeAfterList) void this.close();
			});
		}
		async close() {
			if (this.closed) return;
			this.closeStarted = true;
			if (this.plan.closeGate) await this.plan.closeGate.promise;
			this.closed = true;
			this.onclose?.();
		}
	}
	const transportModule = {
		StdioClientTransport: ControlledTransport,
		StreamableHTTPClientTransport: ControlledTransport,
		SSEClientTransport: ControlledTransport,
		getDefaultEnvironment: () => ({}),
	};
	const module = { exports: {} };
	const denied = /^(?:node:)?(?:child_process|http|https|net|tls|dgram|electron)$/;
	const sandbox = {
		module, exports: module.exports,
		require: id => {
			if (transportImports.has(id)) return transportModule;
			assert(!denied.test(id), 'external process/network module reached: ' + id);
			return require(id);
		},
		process, Buffer, URL, URLSearchParams, TextEncoder, TextDecoder, performance, structuredClone,
		AbortController, AbortSignal, queueMicrotask, setImmediate, clearImmediate,
		fetch: () => { throw new Error('Network is forbidden in this test'); },
		setTimeout: (fn, ms, ...args) => {
			const timer = setTimeout(() => { world.timers.delete(timer); fn(...args); }, ms);
			world.timers.add(timer);
			return timer;
		},
		clearTimeout: timer => { world.timers.delete(timer); clearTimeout(timer); },
		console: Object.fromEntries(['log', 'warn', 'error', 'info', 'debug', 'trace'].map(level => [
			level, (...args) => world.diagnostics.push(args.map(a => String(a)).join(' ')),
		])),
	};
	vm.runInNewContext(bundle.outputFiles[0].text, sandbox, { filename: 'mcp-lifecycle-controlled.cjs' });
	const { MCPService, MCPChannel, registerMCPShutdown, DisposableStore, VaderSettingsService, Emitter, URI } = module.exports;
	const changes = new Emitter();
	const configUri = URI.joinPath(URI.file('/fixture-mcp-home'), '.fixture-vader', 'mcp.json');
	const files = {
		onDidFilesChange: listener => changes.event(event => {
			const work = Promise.resolve().then(() => listener(event));
			world.fileWork.add(work);
			work.then(
				() => world.fileWork.delete(work),
				error => { world.fileWork.delete(work); world.ipcErrors.push(error); },
			);
		}),
		watch: uri => {
			assert.equal(uri.toString(), configUri.toString());
			world.watchers++;
			return { dispose() { world.watchers--; } };
		},
		stat: async uri => {
			assert.equal(uri.toString(), configUri.toString());
			return { type: 1 };
		},
		readFile: async uri => {
			// Managed settings and all other host files are absent. Never touch real files.
			if (uri.toString() !== configUri.toString()) throw new Error('No synthetic config at this URI');
			world.reads++;
			return { value: { toString: () => world.raw } };
		},
		writeFile: async (uri, buffer) => {
			assert.equal(uri.toString(), configUri.toString());
			world.raw = buffer.toString();
			changes.fire({ contains: candidate => candidate.toString() === configUri.toString() });
		},
		createFile: async () => { throw new Error('The synthetic MCP config already exists'); },
	};
	// The actual settings service owns merging, initialization and persistence semantics.
	// Its host storage/encryption contain synthetic data only; no user settings are read.
	const stored = new Map();
	const settings = new VaderSettingsService({
		get: key => stored.get(key),
		store: (key, value) => stored.set(key, value),
		remove: key => stored.delete(key),
	}, {
		encrypt: async value => value, decrypt: async value => value,
	}, { capture() {} }, files);
	await settings.waitForInitState;
	for (const [name, state] of Object.entries(saved)) await settings.setMCPServerState(name, structuredClone(state));
	if (plans.__timeoutMs) MCPChannel.MCP_CONNECT_TIMEOUT_MS = plans.__timeoutMs;
	const channel = new MCPChannel();
	const listeners = ['onAdd_server', 'onUpdate_server', 'onDelete_server'].map(name =>
		channel.listen(undefined, name)(event => world.events.push({ name, event })));
	const ipc = {
		listen: name => channel.listen(undefined, name),
		call: (name, params) => {
			const promise = Promise.resolve().then(() => channel.call(undefined, name, params));
			world.pending.add(promise);
			promise.then(
				() => world.pending.delete(promise),
				error => { world.pending.delete(promise); world.ipcErrors.push(error); },
			);
			return promise;
		},
	};
	const addRenderer = () => {
		const service = new MCPService(files, { userHome: async () => URI.file('/fixture-mcp-home') },
			{ dataFolderName: '.fixture-vader' },
			{ openEditor: async () => { throw new Error('Inventory must never open an editor'); } },
			{ getChannel: name => { assert.equal(name, 'vader-channel-mcp'); return ipc; } }, settings);
		world.renderers.push(service);
		return service;
	};
	const service = addRenderer();
	async function settle() {
		// Flush actual promise/IPC/event work. Held transports must be released first.
		for (let i = 0, quiet = 0; i < 100; i++) {
			await turn();
			if (world.pending.size === 0 && world.fileWork.size === 0) {
				if (++quiet === 3) {
					assert.deepEqual(world.ipcErrors, [], 'unexpected rejected IPC call');
					return;
				}
			} else quiet = 0;
		}
		throw new Error('Controlled service integration did not settle');
	}
	const write = value => {
		world.raw = typeof value === 'string' ? value : JSON.stringify(value);
		changes.fire({ contains: candidate => candidate.toString() === configUri.toString() });
	};
	const roundTrip = async (expected, text = 'ping', renderer = service) => {
		const server = renderer.state.mcpServerOfName.fixture;
		assert.equal(server?.status, 'success', 'newest server must be available');
		assert.equal(server.tools.length, 1);
		const response = await renderer.callMCPTool({ serverName: 'fixture', toolName: server.tools[0].name, params: { text } });
		assert.equal(response.result.text, expected + ':' + text, 'tool execution must use newest transport');
	};
	const close = async () => {
		world.gates.forEach(g => g.resolve());
		try {
			await bounded(settle(), 'drain before cleanup');
			world.renderers.forEach(r => r.dispose());
			await bounded(channel.call(undefined, 'closeAllMCPServers', {}), 'normal channel cleanup');
			assert.equal(live().length, 0, 'normal cleanup must close ALL clients, including superseded ones');
		} finally {
			// Rescue leaked test doubles only AFTER asserting. Never count rescue as a pass.
			world.renderers.forEach(r => r.dispose());
			await Promise.all(world.transports.map(t => t.close()));
			listeners.forEach(d => d.dispose());
			changes.dispose();
			settings.dispose();
			for (const timer of world.timers) clearTimeout(timer);
			world.timers.clear();
		}
	};
	await until(() => world.watchers > 0 && world.reads > 0, 'renderer config watcher/read');
	return { world, service, settings, channel, live, write, settle, roundTrip, addRenderer, close, registerMCPShutdown, DisposableStore, Emitter };
}

const tests = [];
const test = (name, run) => tests.push({ name, run });
async function using(initial, saved, plans, run) {
	const f = await fixture(initial, saved, plans);
	let primary;
	try { await run(f); } catch (error) { primary = error; }
	try { await f.close(); } catch (error) {
		primary = primary ? new AggregateError([primary, error], primary.message + '; cleanup: ' + error.message) : error;
	}
	if (primary) {
		primary.serviceDiagnostics = f.world.diagnostics.join('\n');
		throw primary;
	}
}

test('healthy control performs an actual initialize/listTools/callTool round trip', () =>
	using(config('control'), savedOn, {}, async f => {
		await f.settle();
		assert.equal(f.live().length, 1, 'fixture must establish one real SDK Client connection');
		await f.roundTrip('fixture:control');
	}));

test('saved disabled server preserves isOn/approvedTools and never starts a transport', () =>
	using(config('disabled'), { fixture: { isOn: false, approvedTools: ['approved_only'], offTools: ['kept_off'] } }, {}, async f => {
		await f.settle();
		assert.deepEqual({
			isOn: f.settings.state.mcpUserStateOfName.fixture.isOn,
			approvedTools: Array.from(f.settings.state.mcpUserStateOfName.fixture.approvedTools ?? []),
			offTools: Array.from(f.settings.state.mcpUserStateOfName.fixture.offTools ?? []),
			started: f.world.transports.filter(t => t.started).length,
		}, { isOn: false, approvedTools: ['approved_only'], offTools: ['kept_off'], started: 0 });
		assert.equal(f.service.state.mcpServerOfName.fixture?.status, 'offline');
		assert.equal(f.service.getMCPTools(), undefined);
	}));

test('channel itself must not connect an explicitly disabled entry', () =>
	using(config(null), {}, {}, async f => {
		await f.settle();
		await f.channel.call(undefined, 'refreshMCPServers', {
			mcpConfigFileJSON: config('channel-off'),
			userStateOfName: { fixture: { isOn: false, approvedTools: ['approved_only'] } },
			addedServerNames: ['fixture'], removedServerNames: [], updatedServerNames: [],
		});
		await f.settle();
		assert.equal(f.world.transports.filter(t => t.started).length, 0, 'isOn=false must prevent connecting, not merely label it offline');
		assert.equal(f.live().length, 0);
	}));

test('identical parsed config, including whitespace-only saves, never restarts or renames tools', () =>
	using(config('same'), savedOn, {}, async f => {
		await f.settle();
		await f.roundTrip('fixture:same');
		const before = f.service.state.mcpServerOfName.fixture.tools[0].name;
		const transports = f.world.transports.slice();
		const reads = f.world.reads;
		f.write(JSON.stringify(config('same'), null, 4) + '\n');
		await until(() => f.world.reads > reads, 'identical config reread');
		await f.settle();
		assert.equal(f.world.transports.length, transports.length, 'identical config created another transport');
		assert.equal(f.live()[0], transports[0], 'identical config replaced the live client');
		assert.equal(f.service.state.mcpServerOfName.fixture.tools[0].name, before);
		await f.roundTrip('fixture:same');
	}));

test('a second renderer inventory cannot overwrite and orphan an existing client', () =>
	using(config('shared'), savedOn, {}, async f => {
		await f.settle();
		const before = f.world.transports.length;
		const second = f.addRenderer();
		await f.settle();
		assert.equal(f.world.transports.length, before, 'second renderer restarted the same server');
		assert.equal(f.live().length, 1, 'second renderer left duplicate live clients');
		await f.roundTrip('fixture:shared', 'second window', second);
	}));

test('a second renderer receives disabled state without starting any transport', () =>
	using(config('off'), { fixture: { ...savedOn.fixture, isOn: false } }, {}, async f => {
		await f.settle();
		const second = f.addRenderer();
		await f.settle();
		assert.equal(second.state.mcpServerOfName.fixture?.status, 'offline');
		assert.equal(f.world.transports.length, 0);
	}));

test('enabling an already enabled server republishes tools without reconnecting', () =>
	using(config('enabled'), savedOn, {}, async f => {
		await f.settle();
		const count = f.world.transports.length;
		await f.service.toggleServerIsOn('fixture', true);
		await f.service.toggleServerIsOn('fixture', true);
		await f.settle();
		assert.equal(f.world.transports.length, count);
		await f.roundTrip('fixture:enabled');
	}));

test('delete overlapping a pending add wins and leaves no live or published server', async () => {
	const gate = deferred();
	await using(config('pending-delete'), savedOn, { 'fixture:pending-delete': { gate } }, async f => {
		await until(() => f.live().length === 1, 'pending add reaches transport barrier');
		f.write(config(null));
		await turn(); // deliver deletion while the first start remains held
		gate.resolve();
		await f.settle();
		assert.equal(f.live().length, 0, 'deleted pending add leaked a live transport');
		assert.equal(f.service.state.mcpServerOfName.fixture, undefined, 'deleted server was republished');
		assert.equal(f.service.getMCPTools(), undefined);
	});
});

test('overlapping replacements execute the newest config and close superseded clients', async () => {
	const gate = deferred();
	await using(config('old'), savedOn, { 'fixture:old': { gate } }, async f => {
		await until(() => f.live().length === 1, 'old config reaches transport barrier');
		f.write(config('middle'));
		await turn();
		f.write(config('newest'));
		await turn();
		gate.resolve();
		await f.settle();
		assert.equal(f.live().length, 1, 'superseded clients remain live');
		assert.equal(f.live()[0].key, 'fixture:newest');
		assert(f.world.transports.filter(t => t.key !== 'fixture:newest').every(t => !t.started || t.closed),
			'every superseded started transport must be closed');
		await f.roundTrip('fixture:newest');
	});
});

test('a real config change replaces a settled server and executes its new command', () =>
	using(config('before'), savedOn, {}, async f => {
		await f.settle();
		await f.roundTrip('fixture:before');
		const old = f.live()[0];
		f.write(config('after'));
		await f.settle();
		assert(old.closed, 'replaced transport was not closed');
		assert.equal(f.live().length, 1);
		await f.roundTrip('fixture:after');
	}));

test('invalid JSON reports a parsing error without closing the last healthy server; recovery is usable', () =>
	using(config('valid'), savedOn, {}, async f => {
		await f.settle();
		const old = f.live()[0];
		f.write('{"mcpServers":');
		await f.settle();
		assert.match(f.service.state.error ?? '', /pars|JSON|syntax/i);
		assert.equal(f.live().length, 1);
		assert.equal(f.live()[0], old);
		await f.roundTrip('fixture:valid');
		f.write(config('valid'));
		await f.settle();
		assert.equal(f.service.state.error, undefined);
		await f.roundTrip('fixture:valid');
	}));

for (const [stage, failure] of [['startError', 'fixture start rejected'], ['listError', 'fixture tools list rejected']]) {
	test(stage + ' surfaces as an actionable error, closes resources, and permits recovery', () =>
		using(config('broken'), savedOn, { 'fixture:broken': { [stage]: failure } }, async f => {
			await f.settle();
			const server = f.service.state.mcpServerOfName.fixture;
			assert.equal(server?.status, 'error', 'failure cannot remain loading or look successful');
			assert((server.error ?? '').includes(failure), 'the actual transport/protocol failure must be visible');
			assert.equal(f.live().length, 0, 'failed connection retained live resources');
			assert.equal(f.service.getMCPTools(), undefined);
			f.write(config('recovered'));
			await f.settle();
			await f.roundTrip('fixture:recovered');
			assert.equal(f.live().length, 1);
		}));
}

test('tool protocol errors reject with the real cause instead of returning success', () =>
	using(config('call-error'), savedOn, { 'fixture:call-error': { callError: 'fixture tool rejected' } }, async f => {
		await f.settle();
		const server = f.service.state.mcpServerOfName.fixture;
		assert.equal(server?.status, 'success');
		await assert.rejects(() => f.service.callMCPTool({
			serverName: 'fixture', toolName: server.tools[0].name, params: { text: 'fail' },
		}), /fixture tool rejected/);
		assert.equal(f.live().length, 1, 'a tool error should not spawn/reconnect a server');
	}));

test('a server crash invalidates its cached client and a second window reconnects', () =>
	using(config('crash'), savedOn, {}, async f => {
		await f.settle();
		await f.live()[0].close();
		assert.equal(f.service.state.mcpServerOfName.fixture.status, 'error');
		assert.equal(f.service.getMCPTools(), undefined);
		const other = f.addRenderer();
		await f.settle();
		assert.equal(f.live().length, 1);
		await f.roundTrip('fixture:crash', 'reconnected', other);
	}));

test('timeout cancels HTTP fallback so a late failure cannot start an orphan SSE transport', async () => {
	const gate = deferred();
	await using({ mcpServers: { fixture: { url: new URL('https://fixture.invalid/hung') } } }, savedOn,
		{ __timeoutMs: 30, hung: { gate } }, async f => {
			await bounded(new Promise(resolve => {
				const listeners = [];
				const complete = event => { if (event?.response.newServer?.status === 'error' || f.service.state.mcpServerOfName.fixture?.status === 'error') { listeners.forEach(d => d.dispose()); resolve(); } };
				for (const name of ['onAdd_server', 'onUpdate_server']) listeners.push(f.channel.listen(undefined, name)(complete));
				complete();
			}), 'actual connect timeout event');
			await f.settle();
			assert.equal(f.service.state.mcpServerOfName.fixture?.status, 'error');
			gate.resolve();
			await f.settle();
			assert.equal(f.world.transports.length, 1, 'cancelled HTTP must not create SSE');
			assert.equal(f.live().length, 0);
		});
});

test('a server closing just after tools/list cannot be published as healthy', () =>
	using(config('early-close'), savedOn, { 'fixture:early-close': { closeAfterList: true } }, async f => {
		await f.settle();
		assert.equal(f.live().length, 0);
		assert.equal(f.service.state.mcpServerOfName.fixture.status, 'error');
		assert.equal(f.service.getMCPTools(), undefined);
	}));

test('shutdown skips previously queued replacements instead of starting more processes', async () => {
	const gate = deferred();
	await using(config('held'), savedOn, { 'fixture:held': { gate } }, async f => {
		await until(() => f.world.transports.length === 1, 'first connection admitted');
		// A second renderer may enqueue an update while the first renderer is connecting.
		const replacement = f.channel.call(undefined, 'refreshMCPServers', { mcpConfigFileJSON: config('queued'), userStateOfName: savedOn, addedServerNames: [], removedServerNames: [], updatedServerNames: ['fixture'] });
		const shutdown = f.channel.shutdown();
		gate.resolve();
		await Promise.all([replacement, shutdown]);
		await f.settle();
		assert.equal(f.world.transports.length, 1, 'queued replacement must not start during shutdown');
		assert.equal(f.live().length, 0);
	});
});

test('shutdown during an active replacement close prevents its next transport starting', async () => {
	const closeGate = deferred();
	await using(config('closing-old'), savedOn, { 'fixture:closing-old': { closeGate } }, async f => {
		await f.settle();
		const old = f.live()[0];
		const replacement = f.channel.call(undefined, 'refreshMCPServers', { mcpConfigFileJSON: config('must-not-start'), userStateOfName: savedOn, addedServerNames: [], removedServerNames: [], updatedServerNames: ['fixture'] });
		await until(() => old.closeStarted, 'replacement is closing old transport');
		const shutdown = f.channel.shutdown();
		closeGate.resolve();
		await Promise.all([replacement, shutdown]);
		await f.settle();
		assert.equal(f.world.transports.length, 1);
		assert.equal(f.live().length, 0);
	});
});

test('application disposal cannot remove the later shutdown join listener', () =>
	using(config('join-order'), savedOn, {}, async f => {
		await f.settle();
		const resources = new f.DisposableStore(), lifecycle = new f.Emitter();
		const errors = [], joins = [];
		// Application.registerListeners installs this before registering channels.
		lifecycle.event(() => resources.dispose());
		f.registerMCPShutdown(f.channel, { onWillShutdown: lifecycle.event }, resources, e => errors.push(e));
		lifecycle.fire({ join(id, promise) { joins.push({ id, promise }); } });
		assert.equal(joins.length, 1, 'join must survive earlier Application.dispose');
		assert.equal(joins[0].id, 'vader-mcp');
		await joins[0].promise;
		assert.equal(f.live().length, 0);
		assert.deepEqual(errors, []);
		lifecycle.dispose();
	}));

test('shutdown waits for connections to close and refuses new work', () =>
	using(config('shutdown'), savedOn, {}, async f => {
		await f.settle();
		await f.channel.shutdown();
		assert.equal(f.live().length, 0);
		await assert.rejects(() => f.channel.call(undefined, 'toggleMCPServer', { serverName: 'fixture', isOn: true }), /shutting down/);
	}));

let passed = 0;
let failed = 0;
const unhandled = [];
const onUnhandled = error => unhandled.push(error);
process.on('unhandledRejection', onUnhandled);
try {
	for (const { name, run } of tests) {
		const previous = unhandled.length;
		try {
			await bounded(run(), name);
			await turn();
			assert.equal(unhandled.length, previous, 'unhandled async rejection: ' + unhandled.slice(previous).map(String).join('; '));
			passed++;
			console.log('PASS: ' + name);
		} catch (error) {
			failed++;
			console.error('FAIL: ' + name + '\n' + (error.stack ?? error) +
				(error.serviceDiagnostics ? '\nService diagnostics:\n' + error.serviceDiagnostics : ''));
		}
	}
} finally {
	process.off('unhandledRejection', onUnhandled);
}
console.log('\n' + passed + ' passed, ' + failed + ' failed (' + tests.length + ' controlled integration cases).');
console.log('No vendor process, transport subprocess, network connection, user config or credential was used.');
for (const [file, hash] of snapshots) {
	if (sourceCommit) continue;
	const current = crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8')).digest('hex');
	if (current !== hash) console.log('NOTE: source changed during this run; results apply to printed snapshot hash: ' + file);
}
process.exitCode = failed ? 1 : 0;
