#!/usr/bin/env node
// Actual FileService watch setup and provider error propagation with a synthetic provider.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const base = path.resolve(here, '../../../..');
const bundle = await esbuild.build({ stdin: { contents: "export { FileService } from './platform/files/common/fileService.ts';export { URI } from './base/common/uri.ts';export { Emitter, Event } from './base/common/event.ts';", resolveDir: base, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent', tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } } });
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require, process, console, Error, URL, performance, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Buffer }, { filename: 'file-watch-controlled.cjs' });
const { FileService, URI, Emitter, Event } = module.exports;
const changes = new Emitter(), failures = new Emitter();
const errors = [], logged = [];
const service = new FileService({ error: e => logged.push(String(e)), trace() {}, warn() {}, info() {}, debug() {} });
let fail = true, active = 0;
const registration = service.registerProvider('fixture', { capabilities: 1024, onDidChangeFile: changes.event, onDidChangeCapabilities: Event.None, onDidWatchError: failures.event,
	watch() { if (fail) throw new Error('fixture asynchronous setup failure'); active++; return { dispose() { active-- } }; } });
service.onDidWatchError(e => errors.push(e.message));
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
try {
	const failed = service.watch(URI.parse('fixture:/project'), { recursive: true, excludes: [] });
	await flush();
	assert.deepEqual(errors, ['fixture asynchronous setup failure']);
	assert(logged.some(e => e.includes('fixture asynchronous setup failure')));
	failed.dispose();
	fail = false;
	const a = service.watch(URI.parse('fixture:/project'), { recursive: true, excludes: [] });
	const b = service.watch(URI.parse('fixture:/project'), { recursive: true, excludes: [] });
	await flush();
	assert.equal(active, 1);
	failures.fire('fixture provider watch stopped');
	assert.equal(errors.at(-1), 'fixture provider watch stopped');
	a.dispose(); assert.equal(active, 1);
	b.dispose(); assert.equal(active, 0);
	console.log('PASS: async setup error is observable, provider errors propagate, retry works and shared watchers dispose correctly');
} finally { registration.dispose(); service.dispose(); changes.dispose(); failures.dispose(); }
