#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Isolated service regressions; network and time are controlled ONLY in this test.
// This does not establish public-provider connectivity or installed-app behavior.
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-addons-live-'));
const originalFetch = globalThis.fetch;
let passed = 0, failed = 0;
const test = async (name, run) => {
	try { await run(); passed++; console.log(`PASS: ${name}`); }
	catch (e) { failed++; console.error(`FAIL: ${name}\n${e.stack}`); }
	finally { mock.timers.reset(); globalThis.fetch = originalFetch; }
};
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const item = (id, providerId = 'test') => ({ id, providerId, name: id, description: '', type: 'SKILL', source: 'test source', installed: false, installMethod: null, trust: 'unknown', metadata: {} });
const provider = (id, search) => ({ id, displayName: id, itemType: 'SKILL', cacheTtlMs: 1000, search, browse: search, listInstalled: async () => [] });
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const load = async (rel, name) => {
	await esbuild.build({ entryPoints: [path.join(here, rel)], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, name), logLevel: 'silent', plugins: [{
		name: 'registration-only', setup(build) {
			build.onResolve({ filter: /platform\/instantiation\/common\/extensions\.js$/ }, () => ({ path: 'registration', namespace: 'stub' }));
			build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const registerSingleton = () => {}; export const InstantiationType = { Delayed: 1 };' }));
		},
	}] });
	return import(pathToFileURL(path.join(tmp, name)).href);
};

try {
	const { UnifiedMarketplaceService } = await load('../browser/marketplace/unifiedMarketplaceService.ts', 'marketplace.mjs');
	const { DiscoveryMainService } = await load('../electron-main/discoveryMainService.ts', 'discovery.mjs');

	await test('providers start concurrently and fast results publish before a slow provider', async () => {
		const svc = new UnifiedMarketplaceService(), slow = deferred(), progress = [], started = [];
		svc.registerProvider(provider('fast', async () => { started.push('fast'); return [item('fast', 'fast')]; }));
		svc.registerProvider(provider('slow', async () => { started.push('slow'); return slow.promise; }));
		const pending = svc.search('word', { onProgress: r => progress.push(r) });
		await flush();
		assert.deepEqual(started, ['fast', 'slow']);
		assert.deepEqual(progress.at(-1).items.map(i => i.id), ['fast']);
		slow.resolve([item('slow', 'slow')]);
		assert.equal((await pending).items.length, 2);
	});

	await test('a provider ignoring cancellation still hits the search deadline; late results cannot poison the cache', async () => {
		mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100_000 });
		const svc = new UnifiedMarketplaceService(), hung = deferred();
		svc.registerProvider(provider('test', () => hung.promise));
		const pending = svc.search('word');
		await flush(); mock.timers.tick(15_000); await flush();
		const result = await pending;
		assert.match(result.providerOutcomes[0].error, /too long/);
		hung.resolve([item('late')]); await flush();
		svc.registerProvider(provider('test', async () => { throw new Error('offline'); }));
		assert.equal((await svc.search('word')).items.length, 0);
	});

	await test('browse also imposes a deadline on providers ignoring cancellation', async () => {
		mock.timers.enable({ apis: ['setTimeout'] });
		const svc = new UnifiedMarketplaceService(); svc.registerProvider(provider('test', () => new Promise(() => {})));
		const pending = svc.browse(); await flush(); mock.timers.tick(30_000); await flush();
		assert.match((await pending).providerOutcomes[0].error, /too long/);
	});

	await test('expired cached results show immediately and survive an offline refresh with honest stale status', async () => {
		mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100_000 });
		const svc = new UnifiedMarketplaceService();
		svc.registerProvider(provider('test', async () => [item('saved')]));
		await svc.search('word'); mock.timers.tick(1001);
		svc.registerProvider(provider('test', async () => { throw new Error('offline'); }));
		const progress = [], result = await svc.search('word', { onProgress: r => progress.push(r) });
		assert.equal(progress[0].items[0].id, 'saved');
		assert.equal(result.items[0].id, 'saved');
		assert.equal(result.providerOutcomes[0].stale, true);
		assert.equal(result.providerOutcomes[0].cachedAtMs, 100_000);
		assert.match(result.providerOutcomes[0].error, /offline/);
	});

	await test('fresh cache is labelled; explicit refresh bypasses it; changed sources cannot reuse old rows', async () => {
		const svc = new UnifiedMarketplaceService(); let calls = 0;
		svc.registerProvider(provider('test', async () => [item(`result-${++calls}`)]));
		await svc.search('word', { cacheScope: 'old' });
		assert.ok((await svc.search('word', { cacheScope: 'old' })).providerOutcomes[0].cachedAtMs);
		assert.equal(calls, 1);
		assert.equal((await svc.search('word', { cacheScope: 'old', refresh: true })).items[0].id, 'result-2');
		assert.equal((await svc.search('word', { cacheScope: 'new' })).items[0].id, 'result-3');
	});

	await test('concurrent callers do not invalidate one another with a service-global generation', async () => {
		const svc = new UnifiedMarketplaceService(); svc.registerProvider(provider('test', async q => [item(q)]));
		const [a, b] = await Promise.all([svc.search('first'), svc.search('second')]);
		assert.equal(a.items[0].id, 'first'); assert.equal(b.items[0].id, 'second');
	});

	await test('aborted requests publish no progress and cannot cache their late result', async () => {
		const svc = new UnifiedMarketplaceService(), gate = deferred(), controller = new AbortController(), progress = [];
		svc.registerProvider(provider('test', () => gate.promise));
		const pending = svc.search('word', { signal: controller.signal, onProgress: r => progress.push(r) });
		await flush(); controller.abort(); await pending;
		gate.resolve([item('late')]); await flush();
		assert.equal(progress.length, 0);
		svc.registerProvider(provider('test', async () => { throw new Error('offline'); }));
		assert.equal((await svc.search('word')).items.length, 0);
	});

	await test('identical simultaneous discovery requests share a fetch; failure is retried', async () => {
		const svc = new DiscoveryMainService(), gate = deferred(); let calls = 0;
		globalThis.fetch = async () => { calls++; await gate.promise; return json({ extensions: [] }); };
		const a = svc.searchOpenVsx('python', undefined, 'relevance'), b = svc.searchOpenVsx('python', undefined, 'relevance');
		await flush(); assert.equal(calls, 1); gate.resolve(); await Promise.all([a, b]);
		await svc.searchOpenVsx('python', undefined, 'relevance'); assert.equal(calls, 1);
		globalThis.fetch = async () => { calls++; return new Response('', { status: 503 }); };
		await assert.rejects(svc.searchOpenVsx('other', undefined, 'relevance'), /503/);
		globalThis.fetch = async () => { calls++; return json({ extensions: [] }); };
		await svc.searchOpenVsx('other', undefined, 'relevance'); assert.equal(calls, 3);
	});

	await test('SkillNet has a strict Add-ons path and preserves the advisory tool contract', async () => {
		const svc = new DiscoveryMainService(); globalThis.fetch = async () => new Response('', { status: 503 });
		await assert.rejects(svc.querySkillNet('pdf'), /503/);
		assert.deepEqual(await svc.searchSkillNet('pdf'), []);
	});

	await test('current Smithery namespace/slug listings parse without requiring the removed qualifiedName field', async () => {
		const svc = new DiscoveryMainService();
		globalThis.fetch = async () => json({ skills: [{ namespace: 'publisher', slug: 'testing', displayName: 'Testing', listed: true, gitUrl: 'https://github.com/publisher/skills/tree/main/testing', externalStars: 17 }] });
		const rows = await svc.searchSmitherySkills('');
		assert.equal(rows.length, 1); assert.equal(rows[0].qualifiedName, 'publisher/testing'); assert.equal(rows[0].stars, 17);
	});

	await test('MCP Registry asks for latest versions before applying the page limit and deduplicates defensively', async () => {
		const svc = new DiscoveryMainService(); let requested;
		globalThis.fetch = async url => { requested = new URL(url); return json({ servers: [
			{ server: { name: 'org/server', version: '1' }, _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: false } } },
			{ server: { name: 'org/server', version: '2' } }, { server: { name: 'org/server', version: '2' } },
		] }); };
		const rows = await svc.queryMcpRegistry('database');
		assert.equal(requested.pathname, '/v0.1/servers'); assert.equal(requested.searchParams.get('version'), 'latest');
		assert.equal(requested.searchParams.get('search'), 'database'); assert.equal(rows.length, 1); assert.equal(rows[0].version, '2');
	});

	await test('GitHub downloads have one budget, at most six concurrent requests and retain real folder names on a partial read', async () => {
		mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100_000 });
		const svc = new DiscoveryMainService(); let running = 0, maximum = 0, apiCalls = 0, rawCalls = 0;
		globalThis.fetch = async (url, opts) => {
			if (url.includes('/git/trees/')) { apiCalls++; return json({ tree: Array.from({ length: 20 }, (_, i) => ({ path: `skills/skill-${i}/SKILL.md`, type: 'blob', size: 50 })) }); }
			if (url.includes('api.github.com')) { apiCalls++; return json({ default_branch: 'main', stargazers_count: 10, full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' }); }
			rawCalls++; running++; maximum = Math.max(maximum, running);
			return await new Promise((_, reject) => {
				const abort = () => { running--; reject(new Error('aborted')); };
				if (opts.signal.aborted) abort(); else opts.signal.addEventListener('abort', abort, { once: true });
			});
		};
		const a = svc.listGithubSkills('owner/repo'), b = svc.listGithubSkills('owner/repo');
		await flush(); assert.equal(apiCalls, 2); assert.equal(maximum, 6);
		mock.timers.tick(9_000); await flush();
		const [listing, same] = await Promise.all([a, b]);
		assert.deepEqual(listing, same); assert.equal(rawCalls, 6); assert.equal(running, 0);
		assert.equal(listing.entries.length, 20); assert.match(listing.error, /20 skill instruction files/);
		assert.equal(listing.entries[0].name, 'skill-0'); assert.equal(listing.entries[0].instructions, '');
		assert.equal(listing.entries[0].repositoryUrl, 'https://github.com/owner/repo/tree/main/skills/skill-0');
	});

	// Opt-in public API smoke: no key, workspace content, intercepted fetch, or canned answer.
	if (process.argv.includes('--live')) {
		await test('LIVE: real DiscoveryMainService returns current listings from public connected sources', async () => {
			const svc = new DiscoveryMainService();
			const probes = [
				['MCP Registry', () => svc.queryMcpRegistry('')],
				['skills.sh', () => svc.searchSkillsSh('testing')],
				['Smithery servers', () => svc.searchSmithery('')],
				['Smithery skills', () => svc.searchSmitherySkills('')],
				['SkillsMP', () => svc.searchSkillsMp('testing')],
				['npm', () => svc.searchNpmMcp('')],
				['GitHub topic', () => svc.searchGithubTopic('agent-skills', '')],
				['Docker', () => svc.searchDockerMcp('')],
				['Open VSX', () => svc.searchOpenVsx('python', undefined, 'relevance')],
			];
			const answers = await Promise.all(probes.map(async ([name, run]) => {
				const start = Date.now();
				try {
					const rows = await run();
					console.log(`LIVE ${name}: ${rows.length} parsed rows, ${Date.now() - start}ms`);
					return { name, ok: rows.length > 0 };
				} catch (e) {
					console.error(`LIVE ${name}: ${e.message}, ${Date.now() - start}ms`);
					return { name, ok: false };
				}
			}));
			assert.deepEqual(answers.filter(a => !a.ok), []);
		});
	}
} finally {
	globalThis.fetch = originalFetch;
	mock.timers.reset();
	fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
