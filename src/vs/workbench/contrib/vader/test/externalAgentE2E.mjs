#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The external-agent layer end to end, against a fake agent that speaks the Agent Client Protocol over stdin/stdout (the same wire a real vendor
// program uses): the conversation turn, the permission questions, cancel, sign-in, a crashing agent, session reuse, plus the rules that decide what
// may be downloaded and run (registry document filter, archive hosts, plain package specs) and the catalog's own invariants.
// Run: node src/vs/workbench/contrib/vader/test/externalAgentE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const require = createRequire(path.join(repo, 'package.json'));
const esbuild = require('esbuild');
const root = path.join(here, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-extagent-'));

await esbuild.build({
	stdin: {
		contents: [
			`export * from '${root}/electron-main/externalAgentMainService.ts'`,
			`export * from '${root}/common/externalAgents/externalAgentCatalog.ts'`,
			`export { agentLogos } from '${root}/common/externalAgents/agentLogoData.ts'`,
			`export { acpRegistrySnapshot } from '${root}/common/externalAgents/acpRegistrySnapshot.ts'`,
		].join('\n'),
		resolveDir: root, loader: 'ts',
	},
	bundle: true, platform: 'node', format: 'cjs', outfile: path.join(tmp, 's.cjs'), logLevel: 'error',
	external: ['yauzl', 'yazl', 'electron', 'original-fs'],
	tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
	nodePaths: [path.join(repo, 'node_modules')],
});
const m = require(path.join(tmp, 's.cjs'));

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

const agentFile = path.join(here, 'fixtures', 'fakeAcpAgent.cjs');

const logService = { warn() { }, info() { }, error() { }, trace() { }, debug() { } };
const svc = new m.ExternalAgentMainService({ request: async () => { throw new Error('no network in this test'); } }, logService);
const events = [];
svc.onEvent(e => events.push(e));
const workDir = fs.mkdtempSync(path.join(tmp, 'work-'));
const custom = (mode) => ({ id: 'custom-' + mode, name: 'Fake ' + mode, command: process.execPath, args: [agentFile, mode] });
const turn = (mode, key, textIn = 'hello') => svc.runTurn({ sessionKey: key, agentId: 'custom-' + mode, custom: custom(mode), cwd: workDir, text: textIn });
const eventsOf = (key, type) => events.filter(e => e.sessionKey === key && (!type || e.type === type));

try {
	// ---------- status ----------
	{
		const st = await svc.getStatuses([custom('basic'), { id: 'custom-missing', name: 'Nope', command: 'definitely-not-a-program-xyz', args: [] }]);
		check('a custom agent whose program exists is ready', st.find(s => s.id === 'custom-basic')?.state === 'ready');
		check('a custom agent whose program is missing says so', st.find(s => s.id === 'custom-missing')?.state === 'missing-command');
		check('every catalog agent gets a status', m.externalAgentCatalog.every(d => st.some(s => s.id === d.id)));
	}

	// ---------- a normal turn ----------
	{
		const r = await turn('basic', 'k-basic', 'fix the bug');
		check('turn ends with end_turn', r.stopReason === 'end_turn', JSON.stringify(r));
		const said = eventsOf('k-basic', 'text').map(e => e.text).join('');
		check('the prompt reaches the agent', said.includes('you said: fix the bug'), said);
		check('the agent works in the folder it was given', said.includes('cwd=' + fs.realpathSync(workDir)) || said.includes('cwd=' + workDir), said);
		check('thoughts are relayed', eventsOf('k-basic', 'thought').some(e => e.text === 'thinking'));
		const tools = eventsOf('k-basic', 'tool');
		check('tool calls are relayed with their progress', tools.length === 2 && tools[0].title === 'Read file' && tools[1].status === 'completed', JSON.stringify(tools));
	}

	// ---------- the same conversation keeps one agent process ----------
	{
		await turn('basic', 'k-basic', 'again');
		const said = eventsOf('k-basic', 'text').map(e => e.text).join('');
		check('a second message reuses the same agent session', said.includes('turn 2 '), said);
		await svc.closeSession('k-basic');
		await turn('basic', 'k-basic', 'fresh');
		check('after closing, the next message starts a new agent', /turn 1 cwd=\S+ you said: fresh/.test(eventsOf('k-basic', 'text').map(e => e.text).join('')));
		await svc.closeSession('k-basic');
	}

	// ---------- permission questions ----------
	for (const [label, answer, expect] of [['allow', 'allow', 'permission:allow;'], ['reject', 'reject', 'permission:reject;'], ['dismiss', null, 'permission:cancelled;']]) {
		const key = 'k-perm-' + label;
		const off = svc.onEvent(e => { if (e.sessionKey === key && e.type === 'permission') { void svc.answerPermission(e.requestId, answer); } });
		const r = await turn('permission', key);
		off.dispose();
		const asked = eventsOf(key, 'permission')[0];
		check(`permission (${label}): the question carries the agent's title and options`, asked?.title === 'Run rm -rf build' && asked.options.length === 2 && asked.options[0].id === 'allow', JSON.stringify(asked));
		check(`permission (${label}): the answer reaches the agent`, r.stopReason === 'end_turn' && eventsOf(key, 'text').map(e => e.text).join('').includes(expect), eventsOf(key, 'text').map(e => e.text).join(''));
		await svc.closeSession(key);
	}

	// ---------- cancel ----------
	{
		const key = 'k-cancel';
		const running = turn('hang', key);
		while (!eventsOf(key, 'text').length) { await new Promise(r => setTimeout(r, 20)); }
		await svc.cancel(key);
		const r = await Promise.race([running, new Promise((_, rej) => setTimeout(() => rej(new Error('cancel did not end the turn')), 8000))]);
		check('cancel ends the turn with "cancelled"', r.stopReason === 'cancelled', JSON.stringify(r));
		await svc.closeSession(key);
	}

	// ---------- an unanswered permission question is released by cancel ----------
	{
		const key = 'k-perm-cancel';
		const running = turn('permission', key);
		while (!eventsOf(key, 'permission').length) { await new Promise(r => setTimeout(r, 20)); }
		await svc.cancel(key);
		const r = await running;
		check('cancelling while a question is open answers it as dismissed', r.stopReason === 'end_turn' && eventsOf(key, 'text').map(e => e.text).join('').includes('permission:cancelled;'));
		await svc.closeSession(key);
	}

	// ---------- sign-in ----------
	{
		const key = 'k-auth-agent';
		const r = await turn('auth-agent', key);
		check('an agent that signs in through its own page continues the turn afterwards', r.stopReason === 'end_turn');
		check('the person is told to use the page that opened', eventsOf(key, 'status').some(e => /Sign in/.test(e.message)));
		await svc.closeSession(key);
	}
	{
		const key = 'k-auth-term';
		let error = '';
		try { await turn('auth-terminal', key); } catch (e) { error = String(e.message ?? e); }
		check('a terminal sign-in is reported as such', error.includes('SIGN_IN_IN_TERMINAL'), error);
		const ev = eventsOf(key, 'auth-terminal')[0];
		check('the terminal sign-in event names the program, its arguments and environment', ev && ev.command === process.execPath && ev.args.includes('login') && ev.env.FAKE === '1', JSON.stringify(ev));
		await svc.closeSession(key);
	}

	// ---------- a crashing agent ----------
	{
		let error = '';
		try { await turn('crash', 'k-crash'); } catch (e) { error = String(e.message ?? e); }
		check('a crashing agent is reported, with what it printed', error.includes('stopped') && error.includes('boom'), error);
		await svc.closeSession('k-crash');
	}

	// ---------- an agent that cannot start ----------
	{
		let error = '';
		try { await svc.runTurn({ sessionKey: 'k-nostart', agentId: 'custom-x', custom: { id: 'custom-x', name: 'X', command: path.join(tmp, 'no-such-program'), args: [] }, cwd: workDir, text: 'hi' }); } catch (e) { error = String(e.message ?? e); }
		check('a program that cannot be started gives a readable error', error.includes('Could not start'), error);
	}

	// ---------- a catalog agent that was not downloaded yet ----------
	{
		let error = '';
		try { await svc.runTurn({ sessionKey: 'k-cat', agentId: 'opencode', cwd: workDir, text: 'hi' }); } catch (e) { error = String(e.message ?? e); }
		check('a downloaded-binary agent that is not downloaded says to download it', /not been downloaded|no build for this computer/.test(error), error);
		let terminalError = '';
		try { await svc.runTurn({ sessionKey: 'k-term', agentId: 'claude-code', cwd: workDir, text: 'hi' }); } catch (e) { terminalError = String(e.message ?? e); }
		check('a terminal-only agent is refused for chat turns', terminalError.length > 0, terminalError);
	}
} finally {
	svc.dispose();
}

// ---------- what may be downloaded and run ----------
const archive = (url) => ({ archive: url, cmd: './bin/agent', sha256: 'a'.repeat(64) });
const docOf = (agent) => ({ agents: [agent] });
const goodBinary = { id: 'opencode', version: '1.2.3', distribution: { binary: { 'windows-x86_64': archive('https://github.com/sst/opencode/releases/download/v1.2.3/o.zip') } } };
{
	const ok = m.acceptRegistryDocument(docOf(goodBinary));
	check('registry: a valid binary entry for a known agent is accepted', ok.opencode?.version === '1.2.3');
	check('registry: an agent id Vader does not list is ignored', Object.keys(m.acceptRegistryDocument(docOf({ ...goodBinary, id: 'evil-agent' }))).length === 0);
	check('registry: an archive from an unknown host is rejected', !m.acceptRegistryDocument(docOf({ ...goodBinary, distribution: { binary: { 'windows-x86_64': archive('https://evil.example.com/o.zip') } } })).opencode);
	check('registry: an archive over http is rejected', !m.acceptRegistryDocument(docOf({ ...goodBinary, distribution: { binary: { 'windows-x86_64': archive('http://github.com/o.zip') } } })).opencode);
	check('registry: a command that climbs out of the install folder is rejected', !m.acceptRegistryDocument(docOf({ ...goodBinary, distribution: { binary: { 'windows-x86_64': { ...archive('https://github.com/o.zip'), cmd: '../../evil.exe' } } } })).opencode);
	check('registry: a malformed checksum is rejected', !m.acceptRegistryDocument(docOf({ ...goodBinary, distribution: { binary: { 'windows-x86_64': { ...archive('https://github.com/o.zip'), sha256: 'zz' } } } })).opencode);
	check('registry: a version that is not a plain number is rejected', !m.acceptRegistryDocument(docOf({ ...goodBinary, version: '1.2.3; rm -rf /' })).opencode);
	check('registry: an npm package with shell characters is rejected', !m.acceptRegistryDocument(docOf({ id: 'codex-acp', version: '1.0.0', distribution: { npx: { package: '@x/y@1.0.0 && calc', args: [] } } }))['codex-acp']);
	check('registry: an npm argument with shell characters is rejected', !m.acceptRegistryDocument(docOf({ id: 'codex-acp', version: '1.0.0', distribution: { npx: { package: '@x/y@1.0.0', args: ['$(calc)'] } } }))['codex-acp']);
	check('registry: a plain npm package is accepted', !!m.acceptRegistryDocument(docOf({ id: 'codex-acp', version: '1.0.0', distribution: { npx: { package: '@x/y@1.0.0', args: ['--acp'] } } }))['codex-acp']);
	check('registry: uvx entries are not offered', !m.acceptRegistryDocument(docOf({ id: 'codex-acp', version: '1.0.0', distribution: { uvx: { package: 'x' } } }))['codex-acp']);
	check('registry: garbage documents give nothing', Object.keys(m.acceptRegistryDocument(null)).length === 0 && Object.keys(m.acceptRegistryDocument({ agents: 'x' })).length === 0);
}
{
	check('archive hosts: github release assets are allowed', m.isAllowedArchiveUrl('https://github.com/a/b/releases/download/v1/x.zip'));
	check('archive hosts: credentials in the address are refused', !m.isAllowedArchiveUrl('https://user:pw@github.com/x.zip'));
	check('archive hosts: look-alike hosts are refused', !m.isAllowedArchiveUrl('https://github.com.evil.example/x.zip') && !m.isAllowedArchiveUrl('https://evilgithub.com/x.zip'));
	check('plain specs: package names pass, shell syntax does not', m.isPlainSpec('@scope/pkg@1.2.3') && ['a b', 'a;b', 'a|b', '$(x)', 'a`b`', 'a&b', 'a>b', ''].every(s => !m.isPlainSpec(s)));
	check('safe paths: relative paths pass, escapes and absolute paths do not', m.isSafeRelativePath('./dist/agent.exe') && ['../x', 'a/../../x', '/etc/passwd', 'C:\\x', '\\\\server\\share'].every(p => !m.isSafeRelativePath(p)));
	check('platform keys map Node names to the registry names', m.platformKeyOf('win32', 'x64') === 'windows-x86_64' && m.platformKeyOf('darwin', 'arm64') === 'darwin-aarch64' && m.platformKeyOf('freebsd', 'x64') === undefined);
}

// ---------- the catalog's own invariants ----------
{
	const ids = m.externalAgentCatalog.map(d => d.id);
	check('catalog: ids are unique', new Set(ids).size === ids.length);
	check('catalog: every chat agent (acp) has a registry snapshot with a launchable distribution', m.externalAgentCatalog.filter(d => d.kind === 'acp').every(d => {
		const dist = m.acpRegistrySnapshot[d.acp.registryId]; return dist && (dist.distribution.npx || dist.distribution.binary);
	}));
	check('catalog: every snapshot entry passes the same rules as a live registry document', Object.entries(m.acpRegistrySnapshot).every(([id, v]) => !!m.acceptRegistryDocument(docOf({ id, version: v.version, distribution: v.distribution }))[id]));
	check('catalog: every terminal agent names its program and both install commands', m.externalAgentCatalog.filter(d => d.kind === 'terminal').every(d => d.terminal.command && d.terminal.install.windows && d.terminal.install.posix));
	check('catalog: every agent has a logo', m.externalAgentCatalog.every(d => m.agentLogos[d.logo]?.els.length > 0) && !!m.agentLogos.custom);
	check('catalog: every website is https', m.externalAgentCatalog.every(d => d.website.startsWith('https://')));
	check('catalog: install commands only use the vendors\' own addresses', m.externalAgentCatalog.filter(d => d.kind === 'terminal').every(d => {
		const urls = [d.terminal.install.windows, d.terminal.install.posix].join(' ').match(/https?:\/\/[^\s|"']+/g) ?? [];
		return urls.every(u => /^https:\/\/(claude\.ai|antigravity\.google)\//.test(u));
	}));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
