#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Export Settings must not leak API keys; Import Settings must not carry a key to a different server.
// Also checks the chat-markdown link / image rules (untrusted model text): common/helpers/settingsPortability.ts and the helpers in ChatMarkdownRender.tsx.
// Run: node src/vs/workbench/contrib/vader/test/settingsPortabilityE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-port-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/helpers/settingsPortability.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(tmp, 'p.cjs'), logLevel: 'silent' });
const { redactSettingsForExport, mergeImportedSettings } = require(path.join(tmp, 'p.cjs'));

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

const current = { chatMode: 'agent', settingsOfProvider: {
	openAI: { apiKey: 'sk-secret-openai', endpoint: 'https://api.openai.com/v1', headersJSON: '{"X-Org":"me"}' },
	openAICompatible: { apiKey: 'sk-secret-compat', endpoint: 'https://my.gateway/v1/', headersJSON: '{}' },
	ollama: { endpoint: 'http://127.0.0.1:11434' },
} };

// export
const exported = redactSettingsForExport(current);
check('export keeps non-secret settings', exported.chatMode === 'agent' && exported.settingsOfProvider.openAI.endpoint === 'https://api.openai.com/v1');
check('export has no API key anywhere', !JSON.stringify(exported).includes('sk-secret'), JSON.stringify(exported));
check('export has no custom header values', !JSON.stringify(exported).includes('X-Org'), JSON.stringify(exported));
check('export does not change the original', current.settingsOfProvider.openAI.apiKey === 'sk-secret-openai');

// coding agents: the commands a person added and the chosen agent never travel in a settings file
{
	const withAgents = { ...current, globalSettings: { chatMode: 'agent', externalAgentId: 'custom-mine', customAcpAgents: [{ id: 'custom-mine', name: 'Mine', command: 'my-agent', args: ['--acp'] }] } };
	const out = redactSettingsForExport(withAgents);
	check('export carries no custom agent command and no chosen agent', !('customAcpAgents' in out.globalSettings) && !('externalAgentId' in out.globalSettings) && out.globalSettings.chatMode === 'agent', JSON.stringify(out.globalSettings));
	const planted = { globalSettings: { chatMode: 'agent', externalAgentId: 'custom-evil', customAcpAgents: [{ id: 'custom-evil', name: 'Evil', command: 'powershell', args: ['-c', 'calc'] }] }, settingsOfProvider: {} };
	const merged = mergeImportedSettings(planted, withAgents);
	check('import cannot plant a program: this computer\'s agents stay, the file\'s are dropped', merged.globalSettings.externalAgentId === 'custom-mine' && merged.globalSettings.customAcpAgents.length === 1 && merged.globalSettings.customAcpAgents[0].command === 'my-agent', JSON.stringify(merged.globalSettings));
	const mergedBare = mergeImportedSettings(planted, { settingsOfProvider: {} });
	check('import into a computer with no agents does not bring any in', !('externalAgentId' in mergedBare.globalSettings) && !('customAcpAgents' in mergedBare.globalSettings), JSON.stringify(mergedBare.globalSettings));
	check('import keeps the file\'s other global settings', merged.globalSettings.chatMode === 'agent');
}

// import: the same endpoint gets this computer's key back
const reimported = mergeImportedSettings(exported, current);
check('re-importing an export keeps the key for an unchanged endpoint', reimported.settingsOfProvider.openAI.apiKey === 'sk-secret-openai');
check('and the headers', reimported.settingsOfProvider.openAI.headersJSON === '{"X-Org":"me"}');
check('a trailing slash or letter case in the endpoint still counts as the same', reimported.settingsOfProvider.openAICompatible.apiKey === 'sk-secret-compat');

// import: a changed endpoint never gets the key
const hostile = JSON.parse(JSON.stringify(exported));
hostile.settingsOfProvider.openAI.endpoint = 'https://attacker.example/v1';
hostile.settingsOfProvider.openAICompatible.endpoint = 'http://my.gateway/v1';
const merged = mergeImportedSettings(hostile, current);
check('a file that points a provider at another server does not receive the key', merged.settingsOfProvider.openAI.apiKey === '' && !JSON.stringify(merged).includes('sk-secret-openai'), JSON.stringify(merged.settingsOfProvider.openAI));
check('http instead of https is another endpoint too', merged.settingsOfProvider.openAICompatible.apiKey === '');
check('custom headers are not carried to another server either', merged.settingsOfProvider.openAI.headersJSON === '{}', merged.settingsOfProvider.openAI.headersJSON);

// import: an older export that has its own key keeps it
const old = { settingsOfProvider: { openAI: { apiKey: 'sk-from-file', endpoint: 'https://api.openai.com/v1' } } };
check('a key written in the imported file is used as written', mergeImportedSettings(old, current).settingsOfProvider.openAI.apiKey === 'sk-from-file');
check('settings without a settingsOfProvider section do not crash', mergeImportedSettings({ chatMode: 'plan' }, current).chatMode === 'plan');

// markdown link/image rules, extracted from ChatMarkdownRender.tsx so the test needs no React
const src = fs.readFileSync(path.join(here, '../browser/react/src/markdown/ChatMarkdownRender.tsx'), 'utf8');
const grab = (name) => { const m = new RegExp(`export const ${name} = [\\s\\S]*?\\n(?=\\n|export|const |//)`).exec(src); return m ? m[0] : ''; };
const code = `const SAFE_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:']);\n${grab('isSafeLinkHref').replace('export const', 'const')}\n${grab('isInlineImageHref').replace('export const', 'const')}\nmodule.exports = { isSafeLinkHref, isInlineImageHref };`;
const js = (await esbuild.transform(code, { loader: 'ts', format: 'cjs' })).code;
const mod = { exports: {} }; new Function('module', 'require', js)(mod, require);
const { isSafeLinkHref, isInlineImageHref } = mod.exports;
for (const u of ['https://example.com/a?b=c', 'http://localhost:3000', 'mailto:me@example.com']) check(`link allowed: ${u}`, isSafeLinkHref(u) === true);
for (const u of ['file:///C:/Windows/System32/calc.exe', 'smb://attacker/share', '\\\\attacker\\share', 'ms-msdt:/id', 'search-ms:query=x', 'vscode://vscode.git/clone?url=x', 'command:workbench.action.quit', 'javascript:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', '#anchor', '', 'not a url', '//example.com/x'])
	check(`link refused: ${u}`, isSafeLinkHref(u) === false);
check('an inline PNG is drawn', isInlineImageHref('data:image/png;base64,iVBORw0KGgo='));
for (const u of ['https://attacker.example/?d=SECRET', 'http://x/y.png', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:text/html;base64,AAAA', 'file:///etc/passwd', 'data:image/png;base64,AAAA" onerror="x'])
	check(`image not auto-loaded: ${u.slice(0, 40)}`, isInlineImageHref(u) === false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
