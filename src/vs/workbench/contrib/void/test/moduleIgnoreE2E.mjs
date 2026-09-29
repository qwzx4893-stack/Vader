#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Vader addition. Proves build/.moduleignore's exclusion of @cline/llms's unreachable optional
// providers (dify-ai-provider, @jerome-benoit/sap-ai-provider, ai-sdk-provider-opencode-sdk, and
// their exclusively-owned dependency trees: @opentelemetry, @aws-sdk, @langfuse, @ai-sdk) - ~90MB
// found while investigating why Windows packaging was taking far longer than expected. Reachability
// was already proven separately (see dependencyReachabilityE2E.mjs's real module-load tracer);
// this test proves the actual build mechanism that excludes them from the packaged app - the
// real util.cleanNodeModules() function against real Vinyl file objects, exactly how
// gulpfile.vscode.js's packageTask() invokes it - not a reimplementation of the exclusion logic.
//
// Run: node src/vs/workbench/contrib/void/test/moduleIgnoreE2E.mjs

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const util = require(path.join(repoRoot, 'build/lib/util.js'));
const Vinyl = require('vinyl');

let passed = 0, failed = 0;
function check(name, cond, detail) {
	if (cond) { passed++; console.log(`PASS: ${name}`); }
	else { failed++; console.error(`FAIL: ${name}${detail ? ` - ${detail}` : ''}`); }
}

const SHOULD_BE_EXCLUDED = [
	'node_modules/dify-ai-provider/package.json',
	'node_modules/@jerome-benoit/sap-ai-provider/package.json',
	'node_modules/ai-sdk-provider-opencode-sdk/package.json',
	'node_modules/@opentelemetry/api/package.json',
	'node_modules/@aws-sdk/credential-providers/package.json',
	'node_modules/@langfuse/core/package.json',
	'node_modules/@ai-sdk/provider/package.json',
];
const SHOULD_SURVIVE = [
	'node_modules/@cline/agents/package.json',
	'node_modules/@modelcontextprotocol/sdk/package.json',
	'node_modules/zod/package.json',
];

async function main() {
	const stream = util.cleanNodeModules(path.join(repoRoot, 'build/.moduleignore'));
	const survived = new Set();
	stream.on('data', (f) => survived.add(path.relative(repoRoot, f.path)));
	const ended = new Promise((resolve) => stream.on('end', resolve));

	for (const p of [...SHOULD_BE_EXCLUDED, ...SHOULD_SURVIVE]) {
		stream.write(new Vinyl({ cwd: repoRoot, base: repoRoot, path: path.join(repoRoot, p), contents: Buffer.from('x') }));
	}
	stream.end();
	await ended;

	for (const p of SHOULD_BE_EXCLUDED) {
		check(`${p} is excluded from packaging (dead code, proven unreachable)`, !survived.has(p));
	}
	for (const p of SHOULD_SURVIVE) {
		check(`${p} still survives packaging (actually needed)`, survived.has(p));
	}

	console.log(`\n${passed} passed, ${failed} failed`);
	process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(e => { console.error('HARNESS CRASHED:', e); process.exit(1); });
