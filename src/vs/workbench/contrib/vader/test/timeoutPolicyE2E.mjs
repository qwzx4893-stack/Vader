#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Vader addition, part of the final production-readiness pass's timeout-policy audit. Proves two
// real fixes for subprocess/connection calls that previously had NO bound at all:
//
// 1. gitWorktreeMainService.ts's `git()` helper now passes `timeout` to `execFile` - a hung git
//    invocation (GPG pinentry, a blocking hook, lock contention) used to await forever.
// 2. mcpChannel.ts's `_createClient()` now races the connect attempt against a timeout - a
//    remote MCP server URL that accepts a connection but never completes it used to hang
//    `_refreshMCPServers()`'s entire `Promise.all` forever (blocking every OTHER server in the
//    same refresh batch too).
//
// Both scenarios use a REAL hung subprocess (a fake `git` shell script that actually sleeps; a
// real MCP stdio server process that actually never responds) - the thing being proven is that
// the real OS-level mechanism (SIGTERM via execFile's timeout; Promise.race against a real
// clock) fires, not a mock of "what a timeout should do." This test is slow by nature (it has to
// wait out real timeouts) - run it on its own, not as part of a tight fast-iteration loop.
//
// Run: node src/vs/workbench/contrib/vader/test/timeoutPolicyE2E.mjs

import { GitWorktreeMainService } from '../../../../../../out/vs/workbench/contrib/vader/electron-main/gitWorktreeMainService.js';
import { MCPChannel } from '../../../../../../out/vs/workbench/contrib/vader/electron-main/mcpChannel.js';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let passed = 0, failed = 0;
function check(name, cond, detail) {
	if (cond) { passed++; console.log(`PASS: ${name}`); }
	else { failed++; console.error(`FAIL: ${name}${detail ? ` - ${detail}` : ''}`); }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testGitTimeout() {
	console.log('=== Timeout policy: hung git subprocess is killed, not awaited forever ===');
	const fakeBinDir = path.join(__dirname, 'fixtures', 'fakebin');
	const repoDir = mkdtempSync(path.join(tmpdir(), 'vader-git-timeout-'));
	execSync('git init -q', { cwd: repoDir }); // real repo, using the REAL git (still first on PATH here)
	execSync('git config user.email test@vader.local && git config user.name Vader', { cwd: repoDir });

	const originalPath = process.env.PATH;
	try {
		// prepend the fake, hanging `git` so gitWorktreeMainService's execFile('git', ...) resolves
		// to it instead of the real binary - exactly what a hung real git would look like from the
		// caller's side, without needing to actually reproduce a GPG-prompt/lock-contention scenario
		process.env.PATH = `${fakeBinDir}${path.delimiter}${originalPath}`;

		const svc = new GitWorktreeMainService();
		const startedAt = Date.now();
		const result = await svc.createWorktree({ repoPath: repoDir, branchName: 'soak-test-branch' });
		const elapsedMs = Date.now() - startedAt;

		check('createWorktree against a hung git eventually resolves (does not hang the process)', typeof result === 'object');
		check('the call failed, reporting a timeout rather than silently succeeding', result.ok === false && /timed out/i.test(result.reason ?? ''), JSON.stringify(result));
		// GIT_TIMEOUT_MS is 60s - allow generous scheduling slack either side, but this proves the
		// call is bounded at all (a real bug here would mean this never resolves, ever)
		check('the timeout fired close to its configured bound, not immediately and not never', elapsedMs > 55_000 && elapsedMs < 90_000, `elapsedMs=${elapsedMs}`);

		await new Promise(r => setTimeout(r, 500));
		let fakeGitStillRunning = false;
		try {
			const ps = execSync('ps -eo args').toString();
			fakeGitStillRunning = ps.split('\n').some(l => l.includes('fixtures/fakebin/git') || (l.includes('sleep 300') && l.includes('bash')));
		} catch { /* treat inspection failure as "couldn't confirm it's gone", not a pass */ fakeGitStillRunning = true; }
		check('the hung fake-git process was actually SIGTERM-killed, not left running', !fakeGitStillRunning);
	} finally {
		process.env.PATH = originalPath;
		rmSync(repoDir, { recursive: true, force: true });
	}
}

async function testMcpConnectTimeout() {
	console.log('\n=== Timeout policy: hung MCP server connect does not block refreshMCPServers forever ===');
	const channel = new MCPChannel();
	const hangingFixture = path.join(__dirname, 'fixtures', 'hangingMcpServer.mjs');
	const healthyFixture = path.join(__dirname, 'fixtures', 'fixtureMcpServer.mjs');
	const hangingName = 'timeout-fixture-hanging';
	const healthyName = 'timeout-fixture-healthy';

	const startedAt = Date.now();
	// one refresh batch with BOTH a hung server and a healthy one - proving the healthy one isn't
	// starved by Promise.all waiting on the hung one once the hung one is itself bounded
	await channel.call(undefined, 'refreshMCPServers', {
		mcpConfigFileJSON: {
			mcpServers: {
				[hangingName]: { command: process.execPath, args: [hangingFixture] },
				[healthyName]: { command: process.execPath, args: [healthyFixture] },
			},
		},
		userStateOfName: { [hangingName]: { isOn: true }, [healthyName]: { isOn: true } },
		addedServerNames: [hangingName, healthyName],
		removedServerNames: [],
		updatedServerNames: [],
	});
	const elapsedMs = Date.now() - startedAt;

	const hungInfo = channel.infoOfClientId[hangingName];
	const healthyInfo = channel.infoOfClientId[healthyName];
	check('the hung server is reported as an error, not left in limbo', hungInfo?.mcpServer.status === 'error', JSON.stringify(hungInfo?.mcpServer));
	check('the error message names the real cause (a timeout), not something misleading', /timed out/i.test(hungInfo?.mcpServer && 'error' in hungInfo.mcpServer ? hungInfo.mcpServer.error : ''));
	check('the healthy server in the SAME refresh batch still connected successfully', healthyInfo?.mcpServer.status === 'success', JSON.stringify(healthyInfo?.mcpServer));
	// MCP_CONNECT_TIMEOUT_MS is 20s
	check('the whole batch resolved close to the connect-timeout bound, not hanging indefinitely', elapsedMs < 30_000, `elapsedMs=${elapsedMs}`);

	await channel.call(undefined, 'closeAllMCPServers', {});
	await new Promise(r => setTimeout(r, 500));
	let leaked = 0;
	try {
		const ps = execSync('ps -eo args').toString();
		leaked = ps.split('\n').filter(l => l.includes(hangingFixture) || l.includes(healthyFixture)).length;
	} catch { /* no matches at all */ }
	check('no leaked child process remains for either fixture after cleanup', leaked === 0, `leaked=${leaked}`);
}

async function main() {
	await testGitTimeout();
	await testMcpConnectTimeout();
	console.log(`\n${passed} passed, ${failed} failed`);
	process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(e => { console.error('HARNESS CRASHED:', e); process.exit(1); });
