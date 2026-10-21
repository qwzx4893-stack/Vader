#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The rules behind the gate cards of boards S02 and R07: a read outside the project asks, a page on a new host asks, a private key is refused outright.
// Run: node src/vs/workbench/contrib/vader/test/policyGateRulesE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-gaterules-'));
const common = path.join(here, '../common').replace(/\\/g, '/');
await esbuild.build({
	stdin: { contents: `export { builtInPolicyRules } from '${common}/policy/builtInPolicyRules.ts'; export { ruleMatches } from '${common}/policy/policyService.ts'; export { policyRequestOfToolCall } from '${common}/policy/toolPolicyRequest.ts'; export { URI } from '${path.join(here, '../../../../base/common/uri.ts').replace(/\\/g, '/')}';`, resolveDir: here, loader: 'ts' },
	bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'p.mjs'), logLevel: 'silent', external: ['electron'],
});
const { builtInPolicyRules, ruleMatches, policyRequestOfToolCall, URI } = await import(pathToFileURL(path.join(tmp, 'p.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const verdict = (req) => {
	if (!req) return 'allow';
	for (const r of builtInPolicyRules) if (r.effect === 'deny' && ruleMatches(r, req)) return 'deny:' + r.id;
	for (const r of builtInPolicyRules) if (r.effect === 'ask' && ruleMatches(r, req)) return 'ask:' + r.id;
	return 'allow';
};
const roots = ['C:/work/vader-app'];
const known = (h) => ['localhost', '127.0.0.1', 'docs.example.com'].includes(h);
const tool = (name, params) => verdict(policyRequestOfToolCall(name, params, true, undefined, undefined, { workspaceRoots: roots, isKnownHost: known }));

check('reading a file inside the project is not asked', tool('read_file', { uri: URI.file('C:/work/vader-app/src/app.ts') }) === 'allow');
check('reading a file outside the project asks, by the rule that says so', tool('read_file', { uri: URI.file('C:/Users/me/notes.txt') }) === 'ask:vader.ask.outside-project-read');
check('a folder next to the project is outside it (a name that only starts the same)', tool('ls_dir', { uri: URI.file('C:/work/vader-app-old'), pageNumber: 1 }) === 'ask:vader.ask.outside-project-read');
check('listing a folder inside the project is not asked', tool('ls_dir', { uri: URI.file('C:/work/vader-app/src'), pageNumber: 1 }) === 'allow' && tool('get_dir_tree', { uri: URI.file('C:/work/vader-app') }) === 'allow');
check('the case of a Windows path does not move a file out of the project', tool('read_file', { uri: URI.file('c:/WORK/Vader-App/src/app.ts') }) === 'allow');
check('searching with no folder named is not a read of anywhere', tool('search_for_files', { query: 'x', isRegex: false, searchInFolder: null, pageNumber: 1 }) === 'allow');
check('searching in a folder outside the project asks', tool('search_for_files', { query: 'x', isRegex: false, searchInFolder: URI.file('C:/Users/me'), pageNumber: 1 }) === 'ask:vader.ask.outside-project-read');
check('with no folder open nothing is "outside", so a plain chat is not asked about every file', verdict(policyRequestOfToolCall('read_file', { uri: URI.file('C:/Users/me/notes.txt') }, true, undefined, undefined, { workspaceRoots: [] })) === 'allow');
check('a page on a host that is new to the project asks', tool('browser_navigate', { url: 'https://api.stripe.com/v1/prices', pageId: null }) === 'ask:vader.ask.network-new-host');
check('localhost and a host the project allows are not asked', tool('browser_navigate', { url: 'http://localhost:5173/', pageId: null }) === 'allow' && tool('browser_navigate', { url: 'https://docs.example.com/a', pageId: null }) === 'allow');
check('an address that is not valid is left to the tool to refuse', tool('browser_navigate', { url: 'not a url', pageId: null }) === 'allow');
check('a private SSH key is refused outright, in a file tool and in a command', tool('read_file', { uri: URI.file('C:/Users/me/.ssh/id_rsa') }).startsWith('deny:vader.deny.credential-files') && tool('run_command', { command: 'cat ~/.ssh/id_ed25519' }).startsWith('deny:vader.deny.credential-files'));
check('so are AWS credentials and git credentials', tool('read_file', { uri: URI.file('C:/Users/me/.aws/credentials') }).startsWith('deny:') && tool('read_file', { uri: URI.file('C:/Users/me/.git-credentials') }).startsWith('deny:'));
check('a public key and a .env file are not refused (the .env asks)', tool('read_file', { uri: URI.file('C:/work/vader-app/.ssh/id_rsa.pub') }) !== 'deny:vader.deny.credential-files' && tool('read_file', { uri: URI.file('C:/work/vader-app/.env') }) === 'ask:vader.ask.secrets-and-keys');
const locked = builtInPolicyRules.find(r => r.id === 'vader.deny.credential-files');
check('the credential rule is locked, so no setting can switch it off', locked.locked === true && locked.effect === 'deny');
const rd = builtInPolicyRules.find(r => r.id === 'vader.ask.outside-project-read');
check('the outside read and the new host are rules that Autonomous mode may skip, and the person may switch off', rd.neverBypassAutonomous === false && rd.locked === false && builtInPolicyRules.find(r => r.id === 'vader.ask.network-new-host').neverBypassAutonomous === false);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
