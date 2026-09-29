#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Vader addition, part of the final production-readiness validation pass's soak/long-run
// testing (many iterations of a realistic cycle, watching for the specific failure mode a
// single pass can't show: state that grows a little on every cycle and never comes back down).
// Both scenarios below run the REAL, zero-DI, unmodified services outside Electron
// (BrowserToolMainService, MCPChannel) - no mocking of the thing under test, only of what's
// external to Vader (a local static page server; a local real MCP stdio server).
//
// Run: node src/vs/workbench/contrib/void/test/soakE2E.mjs

import { BrowserToolMainService } from '../../../../../../out/vs/workbench/contrib/void/electron-main/browserToolMainService.js';
import { MCPChannel } from '../../../../../../out/vs/workbench/contrib/void/electron-main/mcpChannel.js';
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let passed = 0, failed = 0;
function check(name, cond, detail) {
	if (cond) { passed++; console.log(`PASS: ${name}`); }
	else { failed++; console.error(`FAIL: ${name}${detail ? ` - ${detail}` : ''}`); }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function soakBrowserPages() {
	console.log('=== Soak: browser page open/close cycles (real Playwright, ~120 pages) ===');
	const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><body>soak</body></html>'); });
	await new Promise(r => server.listen(0, '127.0.0.1', r));
	const { port } = server.address();
	const svc = new BrowserToolMainService();

	try {
		// MAX_CLOSED_PAGES_RETAINED is 10 (browserToolMainService.ts) - run well past it, closing
		// every page immediately (the case measured earlier to *also* run the retention-cap
		// eviction path, since Playwright's 'close' event fires before page.close() resolves).
		const CYCLES = 120;
		for (let i = 0; i < CYCLES; i++) {
			const { pageId } = await svc.newPage();
			await svc.navigate(`http://127.0.0.1:${port}/`, pageId);
			await svc.closePage(pageId);
		}
		const finalList = await svc.listPages();
		check(
			`after ${CYCLES} open/close cycles, retained page-map entries stay bounded (<= MAX_CLOSED_PAGES_RETAINED)`,
			finalList.length <= 10,
			`retained=${finalList.length}`
		);

		// mixed workload: some pages stay open across the soak, proving the cap only evicts
		// *closed* entries and never touches a still-open page.
		const keepOpen = [];
		for (let i = 0; i < 5; i++) keepOpen.push((await svc.newPage()).pageId);
		for (let i = 0; i < 50; i++) {
			const { pageId } = await svc.newPage();
			await svc.closePage(pageId);
		}
		const mixedList = await svc.listPages();
		const stillOpenCount = mixedList.filter(p => !p.isClosed).length;
		check('all 5 intentionally-kept-open pages survived a further 50-cycle soak', stillOpenCount === 5, `open=${stillOpenCount}`);
		check('total retained (open + capped-closed) stays bounded after the mixed soak', mixedList.length <= 5 + 10, `total=${mixedList.length}`);
	} finally {
		await svc.closeAll();
		await new Promise(r => server.close(r));
	}
}

async function soakMcp() {
	console.log('\n=== Soak: MCP connect/disconnect cycles (real @modelcontextprotocol/sdk client+server) ===');
	const channel = new MCPChannel();
	const fixturePath = path.join(__dirname, 'fixtures', 'fixtureMcpServer.mjs');
	const serverName = 'soak-fixture';

	const configFor = (present) => ({
		mcpConfigFileJSON: { mcpServers: present ? { [serverName]: { command: process.execPath, args: [fixturePath] } } : {} },
		userStateOfName: present ? { [serverName]: { isOn: true } } : {},
		addedServerNames: present ? [serverName] : [],
		removedServerNames: present ? [] : [serverName],
		updatedServerNames: [],
	});

	// Deliberately NOT `pgrep -f "<fixturePath>"`: pgrep matches against every process's full
	// command line, including its OWN - since the search pattern is passed as a literal pgrep
	// argument, pgrep always finds itself (a real false-positive discovered while writing this
	// test, not a leak). `ps -eo pid,args` doesn't embed the search text in its own argv, so
	// filtering its output in JS (not via a second shelled-out grep, same self-match trap) can't
	// self-match.
	const countFixtureProcesses = () => {
		const out = execSync('ps -eo pid,args', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
		return out.split('\n').filter(line => line.includes(fixturePath)).length;
	};

	const CYCLES = 15;
	let toolCallsOk = 0;
	for (let i = 0; i < CYCLES; i++) {
		await channel.call(undefined, 'refreshMCPServers', configFor(true));
		const info = channel.infoOfClientId[serverName];
		if (info?.mcpServer.status === 'success') {
			try {
				const res = await channel.call(undefined, 'callTool', { serverName, toolName: info.mcpServer.tools[0].name, params: { text: `cycle ${i}` } });
				if (res?.text === `echo: cycle ${i}`) toolCallsOk++;
			} catch { /* counted via toolCallsOk staying low */ }
		}
		await channel.call(undefined, 'refreshMCPServers', configFor(false));
	}
	check(`all ${CYCLES} real MCP tool calls round-tripped correctly across separate connect cycles`, toolCallsOk === CYCLES, `ok=${toolCallsOk}/${CYCLES}`);
	check('infoOfClientId has no leaked entries after the soak (every cycle removed what it added)', Object.keys(channel.infoOfClientId).length === 0, JSON.stringify(Object.keys(channel.infoOfClientId)));

	// give the OS a moment to reap exited children before checking
	await new Promise(r => setTimeout(r, 500));
	const remaining = countFixtureProcesses();
	check('no orphaned fixture MCP server child processes remain after the soak', remaining === 0, `remaining=${remaining}`);
}

async function main() {
	await soakBrowserPages();
	await soakMcp();
	console.log(`\n${passed} passed, ${failed} failed`);
	process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(e => { console.error('HARNESS CRASHED:', e); process.exit(1); });
