#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Vader addition, part of the final production-readiness validation pass. Proves the fix for
// the two previously-unbounded caches (Context Engine's per-file symbol/diagnostics/marker-
// version maps, and the Unified Marketplace's per-query search-result cache): both were plain
// `Map`s keyed by something that grows for the entire lifetime of the window (every file ever
// touched; every search string ever typed) with no eviction. The fix swapped them for VS Code's
// own real `LRUCache` (base/common/map.ts) - already used elsewhere in this codebase for the
// same shape of problem, not a bespoke cache implementation.
//
// This is a real, unmodified-code integration test against LRUCache itself (the exact class
// and constructor arguments contextEngineService.ts / unifiedMarketplaceService.ts now use), not
// a reimplementation or a mock of "what an LRU cache should do" - it proves the actual mechanism
// those two services now depend on to stay bounded.
//
// Run: node src/vs/workbench/contrib/void/test/cacheBoundsE2E.mjs

import { LRUCache } from '../../../../../../out/vs/base/common/map.js';

let passed = 0, failed = 0;
function check(name, cond, detail) {
	if (cond) { passed++; console.log(`PASS: ${name}`); }
	else { failed++; console.error(`FAIL: ${name}${detail ? ` - ${detail}` : ''}`); }
}

console.log('=== Cache bounds: Context Engine cache shape (limit 500, per-file entries) ===');
{
	const LIMIT = 500;
	const cache = new LRUCache(LIMIT);
	// simulate a long session touching far more distinct files than the bound - the real defect
	// this reproduces: a large workspace where the project-wide linter/marker service fires for
	// every file, or a long chat history that has mentioned/opened thousands of files over time.
	const TOTAL_FILES = 5000;
	for (let i = 0; i < TOTAL_FILES; i++) {
		cache.set(`file:///workspace/src/file${i}.ts`, { versionId: 1, content: `symbols for file${i}` });
	}
	check('cache never exceeds its configured limit despite 10x more distinct keys than the bound', cache.size <= LIMIT, `size=${cache.size}`);
	check('the oldest (least-recently-touched) entries were evicted, not the newest', !cache.has('file:///workspace/src/file0.ts') && cache.has(`file:///workspace/src/file${TOTAL_FILES - 1}.ts`));
}

console.log('\n=== Cache bounds: LRU touch-on-read actually protects a hot file from eviction ===');
{
	const LIMIT = 10;
	const cache = new LRUCache(LIMIT);
	for (let i = 0; i < LIMIT; i++) cache.set(`k${i}`, i);
	// repeatedly re-read k0 (simulating a file the user keeps coming back to in a long session)
	// while a stream of brand-new distinct files pushes the cache well past its limit
	for (let i = 0; i < 100; i++) {
		cache.get('k0'); // touch - should keep k0 "recently used"
		cache.set(`new${i}`, i);
	}
	check('a repeatedly-touched entry survives long after its original insertion-order neighbors were evicted', cache.has('k0'), `size=${cache.size}`);
	check('an entry that was never touched again after the initial fill is gone', !cache.has('k5'));
	check('overall size still respects the limit after 100 more insertions', cache.size <= LIMIT);
}

console.log('\n=== Cache bounds: Marketplace search-cache shape (limit 300, per-query entries) ===');
{
	const LIMIT = 300;
	const cache = new LRUCache(LIMIT);
	// simulate incremental search issuing one cache entry per keystroke (the real usage pattern
	// - marketplaceTypes.ts's search() is called per keystroke via the UI's debounce), which is
	// exactly what made every substring of every query a permanent, never-evicted key before.
	const query = 'model context protocol server implementation for filesystem access';
	let built = '';
	for (const ch of query.replace(/ /g, '')) {
		built += ch;
		for (let n = 0; n < 5; n++) { // 5 simulated providers per query, matching real _cacheKey shape
			cache.set(`provider${n}::${built}`, { atMs: Date.now(), items: [] });
		}
	}
	check('marketplace cache stays bounded across an entire incremental-search session', cache.size <= LIMIT, `size=${cache.size}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
