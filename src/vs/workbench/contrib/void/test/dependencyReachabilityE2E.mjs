#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Vader addition, part of the final production-readiness pass's dependency-reachability
// investigation (docs/integrations/dependency-audit.md). `npm audit` flags a real, unpatched
// vulnerability in `undici@5.29.0`, nested under `dify-ai-provider`, itself a dependency of
// `@cline/llms` (a dependency of `@cline/agents`, which Vader depends on directly). The open
// question this test answers empirically: does Vader's OWN code ever actually exercise that
// path, or is it dead weight pulled in transitively but never executed?
//
// Answer, proven here rather than assumed from reading @cline/llms's minified bundle: Vader
// implements its own `AgentModel` (VaderAgentModel, using the raw `openai`/`@anthropic-ai/sdk`/
// `@google/genai` SDKs directly - see docs/integrations/agent-runtime.md) and never asks
// `@cline/llms` to construct any of its OWN built-in providers. `dify-ai-provider` (along with
// `@jerome-benoit/sap-ai-provider` and `ai-sdk-provider-opencode-sdk`, two more of `@cline/llms`'s
// optional provider integrations) is lazy-loaded, gated behind a runtime provider-id switch
// (`case "dify": ...`) that only resolves the module when something explicitly requests that
// provider by id - and nothing in Vader's codebase ever does (`grep -rin "dify"
// src/vs/workbench/contrib/void/` turns up zero real matches, only "modify" substrings).
//
// This test runs the REAL clineRuntimeSmoke.mjs suite (14 real AgentRuntime scenarios: basic
// runs, tool execution, concurrent tool batches, cancellation, policy rejection) as a child
// process with a Node ESM loader hook (node:module `register()`/`--import`, Node 22) attached,
// which records every module URL actually loaded that matches the vulnerable-provider packages.
// Zero matches across a full, real usage cycle is direct evidence of non-reachability, not an
// inference. (The undici vulnerability itself is additionally fixed regardless, via a
// `dify-ai-provider`>`undici` override in package.json - defense in depth, since the override
// was available at zero behavioral risk precisely because nothing calls this path.)
//
// Run: node src/vs/workbench/contrib/void/test/dependencyReachabilityE2E.mjs

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let passed = 0, failed = 0;
function check(name, cond, detail) {
	if (cond) { passed++; console.log(`PASS: ${name}`); }
	else { failed++; console.error(`FAIL: ${name}${detail ? ` - ${detail}` : ''}`); }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const loaderPath = path.join(__dirname, 'fixtures', 'traceUnreachableProviderLoader.mjs');
const smokeTestPath = path.join(__dirname, 'clineRuntimeSmoke.mjs');

async function main() {
	console.log('=== Dependency reachability: vulnerable @cline/llms optional providers, under real usage ===');

	const child = spawn(process.execPath, ['--import', loaderPath, smokeTestPath], { cwd: path.join(__dirname, '..', '..', '..', '..', '..', '..'), stdio: ['ignore', 'pipe', 'pipe'] });
	let stdout = '', stderr = '';
	child.stdout.on('data', d => { stdout += d; });
	child.stderr.on('data', d => { stderr += d; });
	const exitCode = await new Promise(resolve => child.on('close', resolve));

	check('the real clineRuntimeSmoke.mjs suite ran successfully under the tracing loader', exitCode === 0, `exitCode=${exitCode}, stdout tail: ${stdout.slice(-300)}`);
	check('clineRuntimeSmoke.mjs itself reported all scenarios passing (tracing didn\'t change behavior)', /14 passed, 0 failed/.test(stdout), stdout.slice(-300));

	const traceLines = stderr.split('\n').filter(l => l.startsWith('TRACE-LOAD:'));
	check(
		'dify-ai-provider / sap-ai-provider / ai-sdk-provider-opencode-sdk were never loaded during a full real AgentRuntime usage cycle',
		traceLines.length === 0,
		traceLines.join(', ') || '(none)'
	);

	console.log(`\n${passed} passed, ${failed} failed`);
	process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(e => { console.error('HARNESS CRASHED:', e); process.exit(1); });
