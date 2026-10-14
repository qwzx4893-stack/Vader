#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The coding agents Vader offers (common/externalAgents/externalAgentCatalog.ts) against what their vendors publish: the Agent Client Protocol registry
// entry of each, and the commands and sign-in ids the vendors' own documentation and source give. The vendor facts below were read on 2026-10-14 from
// the pages named beside them; the check with --live asks the registry again and says which versions have moved.
// Run: node src/vs/workbench/contrib/vader/test/agentCatalogE2E.mjs [--live]

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const tmp = fs.mkdtempSync(path.join(repo, 'node_modules', '.vader-agents-'));
const load = async (rel, name) => {
	await esbuild.build({ entryPoints: [path.join(here, rel)], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, name), logLevel: 'silent' });
	return import(pathToFileURL(path.join(tmp, name)).href);
};
let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

try {
	const C = await load('../common/externalAgents/externalAgentCatalog.ts', 'c.mjs');
	const S = await load('../common/externalAgents/acpRegistrySnapshot.ts', 's.mjs');
	const acp = C.externalAgentCatalog.filter((d) => d.acp);
	const byId = (id) => C.externalAgentCatalog.find((d) => d.id === id);

	check('eight agents speak ACP and two run as the vendor ships them in a terminal', acp.length === 8 && C.externalAgentCatalog.filter((d) => d.kind === 'terminal').length === 2);
	check('every ACP agent has its registry entry in the snapshot', acp.every((d) => !!S.acpRegistrySnapshot[d.acp.registryId]), acp.filter((d) => !S.acpRegistrySnapshot[d.acp.registryId]).map((d) => d.id).join());
	check('every download in the snapshot comes from the vendor’s own release location', acp.every((d) => Object.values(S.acpRegistrySnapshot[d.acp.registryId].distribution.binary ?? {}).every((b) => C.isAllowedArchiveUrl(b.archive, d.acp.archivePrefixes))));
	check('every program a registry entry says to run is a safe relative path', acp.every((d) => Object.values(S.acpRegistrySnapshot[d.acp.registryId].distribution.binary ?? {}).every((b) => C.isSafeRelativePath(b.cmd))));
	check('every npm package a registry entry names is a plain spec, never something a shell would read', acp.every((d) => { const n = S.acpRegistrySnapshot[d.acp.registryId].distribution.npx; return !n || (C.isPlainSpec(n.package) && (n.args ?? []).every(C.isPlainSpec)); }));

	// what the vendors say (documentation and source, read 2026-10-14)
	check('Cursor: its documentation (cursor.com/docs/cli/acp) starts the agent with "agent acp"; Vader looks for "agent" first and for the older "cursor-agent" too', byId('cursor').acp.local.command === 'agent' && byId('cursor').acp.local.alternates?.includes('cursor-agent') && byId('cursor').acp.local.args.join() === 'acp');
	check('Codex: the adapter (agentclientprotocol/codex-acp, src/CodexAuthMethod.ts) names the ChatGPT sign-in "chat-gpt"', byId('codex').acp.authPreference?.[0] === 'chat-gpt');
	check('Codex: it is started with npx and no arguments, as the adapter documents', S.acpRegistrySnapshot['codex-acp'].distribution.npx && !S.acpRegistrySnapshot['codex-acp'].distribution.npx.args);
	check('Copilot: GitHub documents "copilot --acp" (stdio is the default), still a public preview', byId('copilot').acp.local.args.join() === '--acp' && S.acpRegistrySnapshot['github-copilot-cli'].distribution.npx.args.join() === '--acp' && /public preview/.test(byId('copilot').note));
	check('Copilot: the sign-in is "copilot login", and every Copilot plan includes the CLI (GitHub’s plans page)', /copilot login/.test(byId('copilot').acp.loginNote) && /free plan/i.test(byId('copilot').tagline));
	check('Mistral: the ACP program is "vibe-acp" and its browser sign-in method is "browser-auth" (mistralai/mistral-vibe, vibe/acp/auth.py)', byId('mistral-vibe').acp.local.command === 'vibe-acp' && byId('mistral-vibe').acp.authPreference?.[0] === 'browser-auth');
	check('Kimi: "kimi acp", and the agent’s own sign-in method is a terminal running "kimi login" (MoonshotAI/kimi-cli, acp/server.py)', byId('kimi').acp.local.args.join() === 'acp' && /kimi login/.test(byId('kimi').acp.loginNote));
	check('Grok Build: "grok agent stdio" (docs.x.ai), for SuperGrok and X Premium+ subscribers (x.ai/news/grok-build-cli)', byId('grok-build').acp.local.args.join() === 'agent,stdio' && /SuperGrok or X Premium\+/.test(byId('grok-build').note));
	check('OpenCode: "opencode acp" (the registry’s own entry)', byId('opencode').acp.local.args.join() === 'acp' && Object.values(S.acpRegistrySnapshot.opencode.distribution.binary).every((b) => b.args?.join() === 'acp'));
	check('Claude Code: installed with the commands code.claude.com/docs/en/setup gives, and not wired into the chat, because Anthropic’s terms allow the subscription inside the unmodified program only', byId('claude-code').terminal.install.windows === 'irm https://claude.ai/install.ps1 | iex' && byId('claude-code').terminal.install.posix === 'curl -fsSL https://claude.ai/install.sh | bash' && byId('claude-code').kind === 'terminal');

	if (process.argv.includes('--live')) {
		const live = await (await fetch('https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json')).json();
		for (const d of acp) {
			const l = live.agents.find((a) => a.id === d.acp.registryId);
			check(`LIVE ${d.id}: still in the ACP registry`, !!l);
			if (l) check(`LIVE ${d.id}: snapshot is at the registry’s version (${S.acpRegistrySnapshot[d.acp.registryId].version} vs ${l.version})`, l.version === S.acpRegistrySnapshot[d.acp.registryId].version, 'run: python build/lib/vader/genExternalAgents.py');
		}
	}
} finally {
	fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
