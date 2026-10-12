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
// the service keeps installed agents under the home folder: a throw-away one
process.env.HOME = path.join(tmp, 'home'); process.env.USERPROFILE = path.join(tmp, 'home');
fs.mkdirSync(process.env.HOME, { recursive: true });

await esbuild.build({
	stdin: {
		contents: [
			`export * from '${root}/electron-main/externalAgentMainService.ts'`,
			`export * from '${root}/common/externalAgents/externalAgentCatalog.ts'`,
			`export * from '${root}/common/externalAgents/externalAgentProtocol.ts'`,
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


	// ---------- a conversation that outlives the process: resume, load, and a resume that fails ----------
	{
		const key = 'k-res';
		await turn('resumable', key, 'first');
		const session1 = eventsOf(key, 'session')[0];
		check('a new conversation reports its id and that nothing was resumed', session1?.sessionId?.startsWith('S-') && session1.resumed === false, JSON.stringify(session1));
		const tool = eventsOf(key, 'tool')[0];
		check('tool calls carry their kind and the files they touch', tool?.kind === 'read' && tool.paths?.[0] === '/work/src/a.ts', JSON.stringify(tool));
		await svc.closeSession(key);
		events.length = 0;
		await svc.runTurn({ sessionKey: key, agentId: 'custom-resumable', custom: custom('resumable'), cwd: workDir, text: 'second', resumeSessionId: session1.sessionId });
		const session2 = eventsOf(key, 'session')[0];
		const said = eventsOf(key, 'text').map(e => e.text).join('');
		check('with the earlier id the agent picks the conversation up again (session/resume)', session2?.resumed === true && session2.sessionId === session1.sessionId, JSON.stringify(session2));
		check('the resumed agent remembers where it was (turn counter continues)', said.includes('turn 6') && said.includes('resumed=' + session1.sessionId), said);
		await svc.closeSession(key);

		events.length = 0;
		await svc.runTurn({ sessionKey: key, agentId: 'custom-loadable', custom: custom('loadable'), cwd: workDir, text: 'again', resumeSessionId: 'S-old-1' });
		const said2 = eventsOf(key, 'text').map(e => e.text).join('');
		check('an agent that can only load a session (session/load) resumes too', eventsOf(key, 'session')[0]?.resumed === true && said2.includes('resumed=S-old-1'), said2);
		check('the old conversation it replays while loading is not shown again', !said2.includes('OLD-HISTORY-REPLAY'), said2);
		await svc.closeSession(key);

		events.length = 0;
		await svc.runTurn({ sessionKey: key, agentId: 'custom-resumable', custom: custom('resumable'), cwd: workDir, text: 'fresh', resumeSessionId: 'gone-forever' });
		check('an id the agent no longer knows starts a new conversation and says so', eventsOf(key, 'session')[0]?.resumed === false && eventsOf(key, 'text').map(e => e.text).join('').includes('turn 1'));
		await svc.closeSession(key);

		events.length = 0;
		await svc.runTurn({ sessionKey: key, agentId: 'custom-basic', custom: custom('basic'), cwd: workDir, text: 'x', resumeSessionId: 'S1' });
		check('an agent that cannot resume simply starts a new conversation', eventsOf(key, 'session')[0]?.resumed === false);
		await svc.closeSession(key);
	}

	// ---------- the settings an agent offers (its model, its mode) ----------
	{
		const key = 'k-config';
		await turn('resumable', key, 'hi');
		const cfg = eventsOf(key, 'config').at(-1);
		const model = cfg?.options.find(o => o.id === 'model');
		check('the agent\'s model choices are offered', model?.type === 'select' && model.value === 'fast' && model.choices.map(c => c.name).join() === 'Fast,Smart' && model.category === 'model', JSON.stringify(cfg));
		check('an agent that offers modes gets a mode choice too', cfg?.options.find(o => o.id === '__mode')?.choices.length === 2);
		await svc.setConfigOption(key, 'model', 'smart');
		check('changing the model is passed to the agent and confirmed', eventsOf(key, 'config').at(-1).options.find(o => o.id === 'model').value === 'smart');
		await svc.setConfigOption(key, '__mode', 'code');
		await turn('resumable', key, 'again');
		const said = eventsOf(key, 'text').map(e => e.text).join('');
		check('the next message runs with the chosen model and mode', said.includes('model=smart') && said.includes('mode=code'), said);
		let noSession = '';
		try { await svc.setConfigOption('k-none', 'model', 'x'); } catch (e) { noSession = String(e.message); }
		check('changing a setting before the agent runs says to send a message first', /send a message first/.test(noSession), noSession);
		await svc.closeSession(key);
	}

	// ---------- signing in picks the account method, not the first one listed ----------
	{
		const key = 'k-multi';
		const r = await turn('multi-auth', key);
		check('"API Key" is listed first but the sign-in uses the account method (ChatGPT) and the turn continues', r.stopReason === 'end_turn' && eventsOf(key, 'status').some(e => /ChatGPT/.test(e.message)), JSON.stringify(eventsOf(key, 'status')));
		await svc.closeSession(key);
	}

	// ---------- an agent that exits by itself is started again by the next message ----------
	{
		const key = 'k-die';
		await turn('die-after', key, 'one');
		await new Promise(r => setTimeout(r, 400));
		events.length = 0;
		const r = await turn('die-after', key, 'two');
		check('after the process ended on its own, the next message starts it again', r.stopReason === 'end_turn' && eventsOf(key, 'text').map(e => e.text).join('').includes('turn 1'));
		await svc.closeSession(key);
	}

	// ---------- one message at a time per chat ----------
	{
		const key = 'k-busy';
		const first = turn('hang', key);
		while (!eventsOf(key, 'text').length) { await new Promise(r => setTimeout(r, 20)); }
		let error = '';
		try { await turn('hang', key); } catch (e) { error = String(e.message); }
		check('a second message while the agent is still working is refused with a clear message', /still working/.test(error), error);
		await svc.cancel(key); await first; await svc.closeSession(key);
	}

	// ---------- many chats: the oldest idle agent makes room ----------
	{
		const keys = ['k-m1', 'k-m2', 'k-m3', 'k-m4', 'k-m5'];
		for (const k of keys) { await turn('basic', k); }
		check('no more than four agents run at once; the longest idle one was stopped', svc._sessions.size <= 4 && !svc._sessions.has('k-m1') && svc._sessions.has('k-m5'), [...svc._sessions.keys()].join());
		for (const k of keys) { await svc.closeSession(k); }
	}

	// ---------- stopping an agent stops what it started ----------
	if (process.platform !== 'win32') {
		const key = 'k-tree';
		await turn('spawner', key);
		const pid = Number(/child=(\d+);/.exec(eventsOf(key, 'text').map(e => e.text).join(''))?.[1]);
		const alive = (p) => { try { process.kill(p, 0); return true; } catch { return false; } };
		check('the agent started a child process', pid > 0 && alive(pid), String(pid));
		await svc.closeSession(key);
		let gone = false;
		for (let i = 0; i < 30 && !gone; i++) { await new Promise(r => setTimeout(r, 100)); gone = !alive(pid); }
		check('closing the chat stopped the child process too (no orphans)', gone, `pid ${pid} still running`);
		if (!gone) { try { process.kill(pid, 'SIGKILL'); } catch { } }
	}

	// ---------- "Test connection" ----------
	{
		const ok = await svc.probe('custom-resumable', custom('resumable'));
		check('probe: a working agent reports its name, version and protocol', ok.ok && ok.agentName === 'Fake Agent' && ok.agentVersion === '9.9.9' && ok.protocolVersion === 1, JSON.stringify(ok));
		check('probe: it says whether the conversation can be resumed', ok.canResume === true && (await svc.probe('custom-basic', custom('basic'))).canResume === false);
		check('probe: it lists the sign-in methods without signing in', (await svc.probe('custom-multi', custom('multi-auth'))).authMethods?.map(a => a.id).join() === 'api-key,chat-gpt');
		const missing = await svc.probe('custom-x', { id: 'custom-x', name: 'X', command: 'definitely-not-a-program-xyz', args: [] });
		check('probe: a missing program is reported, not thrown', missing.ok === false && /Could not find/.test(missing.error), JSON.stringify(missing));
		const stops = await svc.probe('custom-y', { id: 'custom-y', name: 'Y', command: process.execPath, args: ['-e', 'process.stderr.write("not an agent"); process.exit(2)'] });
		check('probe: a program that is not an ACP agent is reported with what it printed', stops.ok === false && /not an agent/.test(stops.error), JSON.stringify(stops));
		const notInstalled = await svc.probe('opencode');
		check('probe: an agent that is not downloaded says so', notInstalled.ok === false && /not been downloaded/.test(notInstalled.error), JSON.stringify(notInstalled));
	}

	// ---------- what is installed on disk ----------
	{
		const agents = path.join(process.env.HOME, '.vader-editor', 'agents');
		const put = (id, version, manifest, files) => {
			const dir = path.join(agents, id, version);
			fs.mkdirSync(dir, { recursive: true });
			for (const f of files) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), 'x'); }
			if (manifest) { fs.writeFileSync(path.join(dir, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest)); }
		};
		const statusOf = async (id) => (await svc.getStatuses([])).find(s => s.id === id);
		put('opencode', '1.0.0', { id: 'opencode', version: '1.0.0', kind: 'binary', command: 'opencode', args: ['acp'] }, ['opencode']);
		let st = await statusOf('opencode');
		check('an installed agent is ready and shows its version', st.state === 'ready' && st.installedVersion === '1.0.0', JSON.stringify(st));
		check('an install older than the version Vader knows is marked as updatable', st.latestVersion === m.acpRegistrySnapshot.opencode.version, JSON.stringify(st));
		put('opencode', '1.10.0', { id: 'opencode', version: '1.10.0', kind: 'binary', command: 'opencode', args: ['acp'] }, ['opencode']);
		check('the newest install wins (1.10.0 is newer than 1.9.x, not older)', (await statusOf('opencode')).installedVersion === '1.10.0');
		fs.rmSync(path.join(agents, 'opencode'), { recursive: true });
		put('opencode', '9.9.9', '{ this is not json', ['opencode']);
		check('a half-finished install (broken manifest) is not "ready"', (await statusOf('opencode')).state === 'not-installed');
		fs.rmSync(path.join(agents, 'opencode'), { recursive: true });
		put('opencode', '9.9.9', { id: 'opencode', version: '9.9.9', kind: 'binary', command: '../../../evil', args: [] }, []);
		check('a manifest that points outside its folder is ignored', (await statusOf('opencode')).state === 'not-installed');
		fs.rmSync(path.join(agents, 'opencode'), { recursive: true });
		put('opencode', '9.9.9', { id: 'opencode', version: '9.9.9', kind: 'binary', command: 'missing-file', args: [] }, []);
		check('a manifest whose program is gone is not "ready"', (await statusOf('opencode')).state === 'not-installed');
		const gone = await svc.uninstall('opencode');
		check('uninstall removes the folder', gone.state === 'not-installed' && !fs.existsSync(path.join(agents, 'opencode')));
	}

	// ---------- an agent that cannot start ----------
	{
		let error = '';
		try { await svc.runTurn({ sessionKey: 'k-nostart', agentId: 'custom-x', custom: { id: 'custom-x', name: 'X', command: path.join(tmp, 'no-such-program'), args: [] }, cwd: workDir, text: 'hi' }); } catch (e) { error = String(e.message ?? e); }
		check('a program that cannot be found gives a readable error', /Could not (find|start)/.test(error), error);
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


// ---------- the sign-in choice, with the answers real agents gave ----------
{
	const geminiMethods = [{ id: 'oauth-personal', name: 'Log in with Google' }, { id: 'gemini-api-key', name: 'Gemini API key', _meta: { 'api-key': { provider: 'google' } } }, { id: 'vertex-ai', name: 'Vertex AI' }, { id: 'gateway', name: 'AI API Gateway', _meta: { gateway: { protocol: 'google' } } }];
	const codexMethods = [{ id: 'api-key', name: 'API Key', _meta: { 'api-key': { provider: 'openai' } } }, { id: 'chat-gpt', name: 'ChatGPT' }];
	check('auth: Gemini CLI -> "Log in with Google"', m.chooseAuthMethod(geminiMethods, ['oauth-personal']).method?.id === 'oauth-personal' && m.chooseAuthMethod(geminiMethods).method?.id === 'oauth-personal');
	check('auth: Codex -> ChatGPT, although "API Key" comes first', m.chooseAuthMethod(codexMethods, ['chat-gpt']).method?.id === 'chat-gpt' && m.chooseAuthMethod(codexMethods).method?.id === 'chat-gpt');
	check('auth: only key-based methods -> no guess, the names are reported', (() => { const c = m.chooseAuthMethod([{ id: 'k', name: 'API Key' }, { id: 'v', name: 'Vertex AI' }]); return c.kind === 'none' && c.offered.length === 2; })());
	check('auth: the agent\'s own page is preferred to a terminal login', m.chooseAuthMethod([{ id: 't', name: 'CLI', type: 'terminal' }, { id: 'a', name: 'Browser' }]).method.id === 'a' && m.chooseAuthMethod([{ id: 't', name: 'CLI', type: 'terminal' }]).kind === 'terminal');
	check('auth: no methods at all -> none', m.chooseAuthMethod([]).kind === 'none');
	check('auth-required errors are recognised by code and by wording', m.isAuthRequiredError({ code: -32000 }) && m.isAuthRequiredError(new Error('Authentication required')) && m.isAuthRequiredError(new Error('You are not logged in')) && !m.isAuthRequiredError(new Error('rate limited')));
}
{
	const flat = m.flattenConfigOptions([
		{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'a', options: [{ group: 'g1', name: 'Group', options: [{ value: 'a', name: 'A' }, { value: 'b', name: 'B' }] }, { value: 'c', name: 'C' }] },
		{ id: 'think', name: 'Thinking', type: 'boolean', currentValue: true },
		{ id: 'empty', name: 'Empty', type: 'select', currentValue: '', options: [] },
		{ name: 'no id' },
	]);
	check('config options: groups are flattened, booleans kept, empty and malformed options dropped', flat.length === 2 && flat[0].choices.map(c => c.value).join() === 'a,b,c' && flat[1].type === 'boolean' && flat[1].value === true, JSON.stringify(flat));
	check('config options: nothing offered -> nothing shown', m.flattenConfigOptions(null).length === 0 && m.modesAsConfigOption(null) === undefined);
	check('npm bin: the program of a package is found and kept inside the package', m.npmBinScript({ name: '@scope/x', bin: { x: 'dist/i.js' } }) === 'dist/i.js' && m.npmBinScript({ name: 'y', bin: 'cli.js' }) === 'cli.js' && m.npmBinScript({ name: 'z', bin: { a: '1.js', b: '2.js' } }) === undefined && m.npmBinScript({ name: 'w', bin: '../../evil.js' }) === undefined && m.npmBinScript({ name: 'v' }) === undefined);
	check('tool paths: from locations and diffs, at most five', m.pathsOfToolCall({ locations: [{ path: '/a' }], content: [{ type: 'diff', path: '/b' }, { type: 'text' }] }).join() === '/a,/b' && m.pathsOfToolCall({ locations: Array.from({ length: 9 }, (_, i) => ({ path: '/p' + i })) }).length === 5);
}
{
	const good = (id, archive) => ({ agents: [{ id, version: '1.0.0', distribution: { binary: { 'linux-x86_64': { archive, cmd: './x' } } } }] });
	check('registry: OpenCode may only come from OpenCode\'s own GitHub releases', !!m.acceptRegistryDocument(good('opencode', 'https://github.com/anomalyco/opencode/releases/download/v1/x.tgz')).opencode && !m.acceptRegistryDocument(good('opencode', 'https://github.com/someone-else/opencode/releases/download/v1/x.tgz')).opencode);
	check('registry: Cursor only from downloads.cursor.com, Antigravity only from dl.google.com/agy-extensions', !!m.acceptRegistryDocument(good('cursor', 'https://downloads.cursor.com/lab/1/x.tgz')).cursor && !m.acceptRegistryDocument(good('cursor', 'https://github.com/a/b/x.tgz')).cursor
		&& !!m.acceptRegistryDocument(good('antigravity-acp', 'https://dl.google.com/agy-extensions/releases/linux/x.zip'))['antigravity-acp'] && !m.acceptRegistryDocument(good('antigravity-acp', 'https://dl.google.com/other/x.zip'))['antigravity-acp']);
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
