#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The real vendor programs, not a stand-in: installs Codex, GitHub Copilot and Grok Build (npm) and OpenCode, Mistral Vibe and Kimi (GitHub release binaries) the way the Settings page does,
// starts each one, does the protocol handshake and checks what they answer. Needs the network (npm registry, GitHub releases) and runs in a throw-away
// home folder; nothing is signed in and no message is sent to a model. Run it before a release and whenever a vendor ships a new version:
//   node src/vs/workbench/contrib/vader/test/externalAgentLiveE2E.mjs [codex] [opencode] [copilot] [mistral-vibe] [grok-build] [kimi] [local]
// Agents whose download host cannot be reached from this machine (Cursor, Antigravity) are reported as skipped.

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-live-'));
// the service keeps agents under the home folder: a throw-away one, so nothing of the real one is touched
process.env.HOME = tmp; process.env.USERPROFILE = tmp;

await esbuild.build({
	stdin: {
		contents: [
			`export * from '${root}/electron-main/externalAgentMainService.ts'`,
			`export * from '${root}/common/externalAgents/externalAgentCatalog.ts'`,
			`export * from '${root}/common/externalAgents/externalAgentProtocol.ts'`,
			`export { acpRegistrySnapshot } from '${root}/common/externalAgents/acpRegistrySnapshot.ts'`,
			`export { newWriteableBufferStream } from '${root}/../../../base/common/buffer.js'`,
			`export { VSBuffer } from '${root}/../../../base/common/buffer.js'`,
		].join('\n'),
		resolveDir: root, loader: 'ts',
	},
	bundle: true, platform: 'node', format: 'cjs', outfile: path.join(tmp, 's.cjs'), logLevel: 'error',
	external: ['yauzl', 'yazl', 'electron', 'original-fs'],
	tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
	nodePaths: [path.join(repo, 'node_modules')],
});
const m = require(path.join(tmp, 's.cjs'));

let passed = 0, failed = 0, skipped = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const skip = (name, why) => { skipped++; console.log(`SKIP: ${name} - ${why}`); };

// a request service for the downloads: node's fetch, answered in the shape the service reads
const requestService = {
	async request(options) {
		const res = await fetch(options.url, { redirect: 'follow' });
		const stream = m.newWriteableBufferStream();
		(async () => { try { for await (const chunk of res.body) { stream.write(m.VSBuffer.wrap(chunk)); } stream.end(); } catch (e) { stream.error(e); stream.end(); } })();
		return { res: { statusCode: res.status, headers: { 'content-length': res.headers.get('content-length') ?? '' } }, stream };
	},
};
const logService = { warn() { }, info() { }, error() { }, trace() { }, debug() { } };
const svc = new m.ExternalAgentMainService(requestService, logService);
const statusEvents = [];
svc.onEvent(e => { if (e.type === 'status') { statusEvents.push(e); } });

const wanted = new Set(process.argv.slice(2));
const want = (id) => wanted.size === 0 || wanted.has(id);
const reachable = async (url) => { try { const r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(15_000) }); return r.status < 500; } catch { return false; } };

try {
	// ---------- the four agents added in the last round: install, start, handshake, what they offer to sign in with ----------
	const generic = {
		'copilot': { name: /copilot/i, auth: (ids) => ids.includes('copilot-login'), choice: (c) => c.kind === 'terminal' && !!c.terminal.command && c.terminal.args[0] === 'login' },
		'mistral-vibe': { name: /vibe|mistral/i, auth: (ids) => ids.includes('browser-auth'), choice: (c) => c.kind === 'agent' && c.method.id === 'browser-auth' },
		'grok-build': { name: /grok/i, auth: (ids) => ids.length > 0, choice: (c) => c.kind === 'agent' },
		'kimi': { name: /kimi/i, auth: (ids) => ids.includes('login'), choice: (c) => c.kind === 'terminal' && !!c.terminal.command && c.terminal.args[0] === 'login' },
	};
	for (const [id, expect] of Object.entries(generic)) {
		if (!want(id)) { continue; }
		const def = m.externalAgentById(id);
		const dist = m.distributionOf(def);
		const key = m.platformKeyOf(process.platform, process.arch);
		const url = dist.distribution.binary?.[key]?.archive;
		if (url && !(await reachable(url))) { skip(id, 'its download host cannot be reached from this machine'); continue; }
		const t0 = Date.now();
		const installed = await svc.install(id);
		check(`${id}: the install succeeds`, installed.state === 'ready' && installed.source === 'vader', JSON.stringify(installed));
		console.log(`  (install took ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
		const probe = await svc.probe(id);
		check(`${id}: the real program starts and answers the handshake`, probe.ok === true && probe.protocolVersion === 1, JSON.stringify(probe));
		check(`${id}: it says what it is (Grok's handshake carries no name: its id then)`, expect.name.test(probe.agentName ?? id), JSON.stringify(probe));
		const ids = (probe.authMethods ?? []).map(a => a.id);
		check(`${id}: it offers the sign-in Vader expects`, expect.auth(ids), ids.join(','));
		// the sign-in choice is made from the agent's own, complete answer (the probe keeps only ids and names, so ask the program again here)
		const spec = await svc._launchSpec(id, undefined);
		const init = await new Promise((resolve) => {
			const { spawn } = require('node:child_process');
			const p = spawn(spec.command, spec.args, { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, ...spec.env } });
			let buf = ''; p.stdout.on('data', d => { buf += d; const i = buf.indexOf('\n'); if (i >= 0) { try { resolve(JSON.parse(buf.slice(0, i)).result); } catch { resolve(undefined); } p.kill('SIGKILL'); } });
			p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, auth: { terminal: true } } } }) + '\n');
			setTimeout(() => { p.kill('SIGKILL'); resolve(undefined); }, 30000);
		});
		const choice = m.chooseAuthMethod(init?.authMethods ?? [], def.acp.authPreference);
		check(`${id}: Vader's sign-in choice for it is the account one`, expect.choice(choice), JSON.stringify(choice).slice(0, 300));
		const signIn = await svc.checkSignIn(id);
		check(`${id}: asked without a sign-in it says it is not signed in (and nothing is changed)`, signIn.signedIn === false && !signIn.error, JSON.stringify(signIn));
		await svc.uninstall(id);
	}

	// ---------- Codex (npm, adapter + the platform build of Codex itself) ----------
	if (want('codex')) {
		const installed = await svc.install('codex');
		check('codex: the npm install succeeds', installed.state === 'ready', JSON.stringify(installed));
		const probe = await svc.probe('codex');
		check('codex: the real program starts and answers the handshake', probe.ok === true, JSON.stringify(probe));
		check('codex: it says what it is', /codex/i.test(probe.agentName ?? ''), JSON.stringify(probe));
		const ids = (probe.authMethods ?? []).map(a => a.id);
		check('codex: it offers the ChatGPT sign-in and an API key one', ids.includes('chat-gpt') && ids.includes('api-key'), ids.join(','));
		const choice = m.chooseAuthMethod((probe.authMethods ?? []).map(a => ({ id: a.id, name: a.name })), m.externalAgentById('codex').acp.authPreference);
		check('codex: Vader signs in with ChatGPT and not with the API key that is listed first', choice.kind === 'agent' && choice.method.id === 'chat-gpt', JSON.stringify(choice));
		const guessed = m.chooseAuthMethod([{ id: 'api-key', name: 'API Key', _meta: { 'api-key': { provider: 'openai' } } }, { id: 'chat-gpt', name: 'ChatGPT' }]);
		check('codex: even without the catalog hint, a method that needs a key is never picked by default', guessed.kind === 'agent' && guessed.method.id === 'chat-gpt', JSON.stringify(guessed));
		check('codex: it can resume a conversation', probe.canResume === true);
		const codexSign = await svc.checkSignIn('codex');
		check('codex: without a ChatGPT sign-in it reports "not signed in"', codexSign.signedIn === false && !codexSign.error, JSON.stringify(codexSign));
		// the sign-in is started with the right method (the person would complete it in the browser; here it is cancelled after it began)
		const events = [];
		const off = svc.onEvent(e => events.push(e));
		const work = fs.mkdtempSync(path.join(tmp, 'work-'));
		const turn = svc.runTurn({ sessionKey: 'live-codex', agentId: 'codex', cwd: work, text: 'hello' }).catch(e => e);
		const began = await (async () => { for (let i = 0; i < 100; i++) { if (events.some(e => e.sessionKey === 'live-codex' && e.type === 'status' && /Sign in with the page that opened \(ChatGPT\)/.test(e.message)) || events.some(e => e.type === 'session')) { return true; } await new Promise(r => setTimeout(r, 200)); } return false; })();
		check('codex: a first message starts the ChatGPT sign-in (or an existing sign-in is used)', began, events.map(e => e.type + ':' + (e.message ?? '')).join(' | ').slice(0, 300));
		await svc.closeSession('live-codex');
		await turn;
		off.dispose();
		await svc.uninstall('codex');
	}

	// ---------- OpenCode (a GitHub release binary: download, checksum, unpack, run) ----------
	if (want('opencode')) {
		if (!(await reachable('https://github.com/anomalyco/opencode/releases/download/v1.19.0/opencode-linux-x64.tar.gz'))) {
			skip('opencode', 'GitHub release downloads cannot be reached from this machine');
		} else {
			const dist = m.distributionOf(m.externalAgentById('opencode'));
			const target = dist.distribution.binary[m.platformKeyOf(process.platform, process.arch)];
			check('opencode: the registry gives a checksum for this platform', !!target?.sha256);
			const installed = await svc.install('opencode');
			check('opencode: download, checksum check and unpack succeed', installed.state === 'ready', JSON.stringify(installed));
			check('opencode: download progress is reported', statusEvents.some(e => e.sessionKey === 'install:opencode' && /Downloading/.test(e.message)) && statusEvents.some(e => /Checking/.test(e.message)));
			const probe = await svc.probe('opencode');
			check('opencode: the real program starts and answers the handshake', probe.ok === true, JSON.stringify(probe));
			check('opencode: it says what it is', /opencode/i.test(probe.agentName ?? ''), JSON.stringify(probe));
			check('opencode: it offers a sign-in method', (probe.authMethods ?? []).length > 0, JSON.stringify(probe.authMethods));
			const manifest = path.join(tmp, '.vader-editor', 'agents', 'opencode', installed.installedVersion, 'manifest.json');
			check('opencode: the install is described by a manifest the launcher reads', fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')).args.includes('acp'));
			const signIn = await svc.checkSignIn('opencode');
			check('opencode: it can start a conversation without a sign-in (its free models), so it counts as connected', signIn.signedIn === true, JSON.stringify(signIn));
			// a corrupted download must be refused: the same service, a registry whose checksum is wrong
			await svc.uninstall('opencode');
			const tampered = JSON.parse(JSON.stringify(m.acpRegistrySnapshot));
			const key = m.platformKeyOf(process.platform, process.arch);
			tampered.opencode.distribution.binary[key].sha256 = '0'.repeat(64);
			const bad = new m.ExternalAgentMainService(requestService, logService);
			bad._live = { opencode: tampered.opencode };
			const error = await bad.install('opencode').then(() => '', e => String(e.message));
			check('opencode: a download whose checksum does not match is refused and leaves nothing behind', /checksum/.test(error) && (await svc.getStatuses([])).find(s => s.id === 'opencode')?.state === 'not-installed', error);
			bad.dispose();
		}
	}

	// ---------- a program the person already has (here: the real OpenCode, put on the PATH the way a person's own install would be) ----------
	if (want('local')) {
		const url = 'https://github.com/anomalyco/opencode/releases/download/v1.19.0/opencode-linux-x64.tar.gz';
		if (process.platform !== 'linux' || !(await reachable(url))) { skip('local', 'needs Linux and the GitHub release downloads'); }
		else {
			const own = fs.mkdtempSync(path.join(tmp, 'own-opencode-'));
			const res = await fetch(url, { redirect: 'follow' });
			fs.writeFileSync(path.join(own, 'o.tgz'), Buffer.from(await res.arrayBuffer()));
			require('node:child_process').execFileSync('tar', ['-xzf', path.join(own, 'o.tgz'), '-C', own]);
			const oldPath = process.env.PATH; process.env.PATH = own + path.delimiter + oldPath;
			try {
				const before = (await svc.getStatuses([])).find(s => s.id === 'opencode');
				check('local: the real OpenCode the person already has is found, verified with a handshake and ready, with nothing downloaded', before?.state === 'ready' && before.source === 'local' && /1\.19/.test(before.installedVersion ?? ''), JSON.stringify(before));
				const ocDir = path.join(tmp, '.vader-editor', 'agents', 'opencode');
				check('local: nothing was written to Vader\'s own agents folder', !fs.existsSync(ocDir) || fs.readdirSync(ocDir).length === 0);
				const sign = await svc.checkSignIn('opencode');
				check('local: its sign-in state comes from the program itself', sign.signedIn === true, JSON.stringify(sign));
				const work = fs.mkdtempSync(path.join(tmp, 'work-'));
				const events = []; const off = svc.onEvent(e => events.push(e));
				const turn = await svc.runTurn({ sessionKey: 'live-local', agentId: 'opencode', cwd: work, text: 'hello' }).then(r => r, e => e);
				off.dispose();
				const sess = events.find(e => e.type === 'session');
				check('local: a conversation can be started on it (the model list it offers comes from the program)', !!sess && events.some(e => e.type === 'config' && e.options.some(o => o.id === 'model' && o.choices.length > 0)), JSON.stringify(events.map(e => e.type)));
				void turn; await svc.closeSession('live-local');
			} finally { process.env.PATH = oldPath; }
		}
	}

	for (const id of ['cursor', 'antigravity']) {
		if (!want(id)) { continue; }
		const dist = m.distributionOf(m.externalAgentById(id));
		const url = dist.distribution.binary?.[m.platformKeyOf(process.platform, process.arch)]?.archive;
		if (!url || !(await reachable(url))) { skip(id, 'its download host cannot be reached from this machine'); }
		else {
			const installed = await svc.install(id);
			check(`${id}: the download installs`, installed.state === 'ready', JSON.stringify(installed));
			const probe = await svc.probe(id);
			check(`${id}: the real program answers the handshake`, probe.ok === true, JSON.stringify(probe));
			await svc.uninstall(id);
		}
	}
} finally {
	svc.dispose();
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed ? 1 : 0);
