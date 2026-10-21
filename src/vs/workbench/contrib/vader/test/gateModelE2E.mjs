#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What the safety gate says when it asks and when it refuses (common/gateModel.ts), and the look at a message for a key before it leaves (common/secretScan.ts).
// Run: node src/vs/workbench/contrib/vader/test/gateModelE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-gate-'));
const load = async (rel, name) => { await esbuild.build({ entryPoints: [path.join(here, rel)], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, name), logLevel: 'silent' }); return import(pathToFileURL(path.join(tmp, name)).href); };
const G = await load('../common/gateModel.ts', 'g.mjs');
const S = await load('../common/secretScan.ts', 's.mjs');

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const base = { mode: 'balanced', projectName: 'vader-app', canRemember: true };
const ask = (o) => G.gateSpecOfRequest({ ...base, ...o });
const block = (o) => G.gateSpecOfBlock({ ...base, ...o });

// ---- what is asked
const cmd = ask({ toolName: 'run_command', params: { command: 'npm test -- limiter' } });
check('a command asks "Run a command?", says where, and shows the exact line', cmd.title === 'Run a command?' && cmd.text === 'In vader-app. It can write files.' && cmd.code === 'npm test -- limiter' && cmd.kind === 'command');
check('a command offers Allow once, Allow in this project and Reject', cmd.actions.join() === 'allow-once,allow-project,reject');
check('where the project cannot remember it, there is no Allow in this project', !ask({ toolName: 'run_command', params: { command: 'ls' }, canRemember: false }).actions.includes('allow-project'));
check('a long command says the whole of it is shown', !!ask({ toolName: 'run_command', params: { command: 'x'.repeat(120) } }).note);
const out = ask({ toolName: 'read_file', params: { uri: { fsPath: 'C:/Users/me/.ssh/config' } }, gate: { by: 'policy', effect: 'ask', ruleId: 'vader.ask.outside-project-read', reason: 'x' } });
check('reading outside the project is asked, names the file and the project, and is once only', out.title === 'Read a file outside this project?' && out.text === 'C:\\Users\\me\\.ssh\\config is not inside vader-app. Only this once.' && out.actions.join() === 'allow-once,reject');
const net = ask({ toolName: 'browser_navigate', params: { url: 'https://api.stripe.com/v1/prices' }, gate: { by: 'policy', effect: 'ask', ruleId: 'vader.ask.network-new-host', reason: 'x' } });
check('a web address names the address, says the host is new, and can be allowed for the project', net.title === 'Call a web address?' && net.code === 'https://api.stripe.com/v1/prices' && net.note === 'api.stripe.com is not on this project\u2019s list of sites.' && net.actions.join() === 'allow-once,allow-host,reject');
const mcp = ask({ toolName: 'GitHub_create_pull_request', params: {}, mcpServerName: 'GitHub' });
check('an MCP tool names the server and the tool', mcp.title === 'Use a tool from GitHub?' && mcp.code === 'create_pull_request' && mcp.kind === 'mcp');
const skill = ask({ toolName: 'install_skill', params: { name: 'react-perf', repositoryUrl: 'https://github.com/frontend-lab/skills.git', instructions: 'x'.repeat(3100) }, gate: { by: 'policy', effect: 'ask', ruleId: 'vader.ask.install-capability', reason: 'installs' } });
check('installing a skill names it, where it is from and its size, and offers to install it switched off', skill.kind === 'skill' && skill.skill.name === 'react-perf' && skill.skill.source === 'github.com/frontend-lab/skills' && skill.skill.sizeKb === 3 && skill.actions.join() === 'install-off,read-first,reject');
const pkg = ask({ toolName: 'run_command', params: { command: 'npm install left-pad' }, gate: { by: 'policy', effect: 'ask', ruleId: 'vader.custom.abc', reason: 'installs' } });
check('a rule of the person\u2019s own is named as theirs, and a package install says so', pkg.title === 'Install a package?' && /Your rule \u201Cinstalls\u201D always asks/.test(pkg.text) && pkg.actions.join() === 'allow-once,reject,change-rule');
const sudo = ask({ toolName: 'run_command', params: { command: 'sudo rm x' }, gate: { by: 'policy', effect: 'ask', ruleId: 'vader.ask.sudo', reason: 'This command requests elevated (sudo/administrator) privileges.' } });
check('a built-in rule that always asks says so, even in Autonomous mode', /always asks, even in Autonomous mode/.test(sudo.text) && sudo.ruleId === 'vader.ask.sudo' && sudo.code === 'sudo rm x');
check('a file change names the file with Windows backslashes', ask({ toolName: 'edit_file', params: { uri: { fsPath: 'C:/work/app.ts' } } }).code === 'C:\\work\\app.ts');

// ---- what is refused
const cred = block({ toolName: 'read_file', params: { uri: { fsPath: '~/.ssh/id_rsa' } }, gate: { by: 'policy', effect: 'deny', ruleId: 'vader.deny.credential-files', reason: 'Blocked: a credential file.' } });
check('a credential file is refused by a locked rule, in its words, with the rule\u2019s id and what the agent was told', cred.tone === 'blocked' && cred.title === 'Blocked: credential file' && /is never allowed\. This rule cannot be switched off in any mode\./.test(cred.text) && cred.ruleId === 'vader.deny.credential-files' && /looking for another way/.test(cred.note));
const rm = block({ toolName: 'run_command', params: { command: 'rm -rf ~' }, gate: { by: 'policy', effect: 'deny', ruleId: 'vader.deny.destructive-fs', reason: 'Blocked: command looks like it would recursively delete a root, home, system or drive directory, or wipe a filesystem/disk.' } });
check('a destructive command says what it would have done, never allowed even in Autonomous mode, and shows the command', /delete a system or home folder/.test(rm.title) && /never allowed, even in Autonomous mode/.test(rm.text) && rm.code === 'rm -rf ~');
const scope = block({ toolName: 'edit_file', params: { uri: { fsPath: 'C:/work/package.json' } }, gate: { by: 'agent-scope', effect: 'deny', reason: 'Agent "Reviewer" is not permitted to perform edits actions.' } });
check('an agent\u2019s own limit is named, with what it tried, and leads to the agent\u2019s settings', scope.kind === 'agent-scope' && /Reviewer is not permitted to perform edits actions\./.test(scope.text) && scope.code === 'C:\\work\\package.json' && scope.actions.join() === 'open-agent-settings');
const ro = block({ toolName: 'run_command', params: { command: 'npm install' }, gate: { by: 'read-only', effect: 'deny', reason: 'Blocked: Gather is read-only - this tool could modify the project.' } });
check('a read-only mode says what was not run and offers Agent mode', ro.kind === 'read-only' && ro.title === 'Gather is read-only' && /npm install was not run/.test(ro.text) && ro.actions.join() === 'switch-agent');

// ---- a key in the text
const KEY = 'sk-' + 'a1b2c3d4e5f6'.repeat(4) + 'a91f';
const hits = S.findSecrets(`please use ${KEY} for the call`);
check('an OpenAI-style key is found, named, and shown only by its ends', hits.length === 1 && hits[0].kind === 'an OpenAI key' && hits[0].masked === 'sk-a1\u2026a91f' && !hits[0].masked.includes('b2c3'), JSON.stringify(hits));
check('Anthropic and OpenRouter keys are named by their own kind, not as OpenAI keys', S.findSecrets('sk-ant-' + 'A'.repeat(30))[0].kind === 'an Anthropic key' && S.findSecrets('sk-or-v1-' + 'a'.repeat(30))[0].kind === 'an OpenRouter key');
check('GitHub, AWS, Google, Slack and private-key shapes are found', S.findSecrets('ghp_' + 'a'.repeat(36))[0].kind === 'a GitHub token' && S.findSecrets('AKIA' + 'A'.repeat(16))[0].kind === 'an AWS access key' && S.findSecrets('AIza' + 'a'.repeat(35))[0].kind === 'a Google API key' && S.findSecrets('xoxb-1234567890-abcdef')[0].kind === 'a Slack token' && S.findSecrets('-----BEGIN RSA PRIVATE KEY-----')[0].kind === 'a private key');
check('ordinary text, a short sk- word and a long random word are not keys', S.findSecrets('the task-runner skips sk-12 and aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').length === 0);
check('two keys are two hits, in the order they appear, and one key is one hit', S.findSecrets(`${KEY} then ghp_${'b'.repeat(36)}`).length === 2 && S.findSecrets(`${KEY}`).length === 1);
check('the text can be shown with each key hidden', !S.redactSecrets(`use ${KEY} now`).includes('b2c3') && S.redactSecrets(`use ${KEY} now`).startsWith('use sk-a1\u2026a91f now'));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
