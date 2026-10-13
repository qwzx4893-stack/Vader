#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The agent's instructions (common/prompt/agentBehavior.ts, assembled by chat_systemMessage in common/prompt/prompts.ts), built from the REAL source for every chat mode.
// What is pinned: the structure (one tagged section per concern), the rules that matter most for an autonomous agent, the calm wording the model guidance asks for (no
// shouting), a size budget (every request pays for this text), the right behaviour per tool-call style, and that Gather/Plan/Normal do not get the agent's sections.
// Whether the instructions make the agent BETTER is not something a unit test can say: that is measured with test/e2e/polyglotBench.mjs (docs/integrations/agent-behavior.md).
// Run: node src/vs/workbench/contrib/vader/test/agentPromptE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-prompt-'));
await esbuild.build({
	entryPoints: [path.join(here, '../common/prompt/prompts.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'p.mjs'), logLevel: 'silent', packages: 'external',
	tsconfigRaw: JSON.stringify({ compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } }),
});
// the bundle keeps bare imports of the editor's base modules external: bundle those in as well (nothing here needs a DOM)
await esbuild.build({
	entryPoints: [path.join(here, '../common/prompt/prompts.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'p.mjs'), logLevel: 'silent',
	tsconfigRaw: JSON.stringify({ compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } }),
});
const { chat_systemMessage } = await import(pathToFileURL(path.join(tmp, 'p.mjs')).href);
const { agentBehavior } = await (async () => {
	await esbuild.build({ entryPoints: [path.join(here, '../common/prompt/agentBehavior.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'b.mjs'), logLevel: 'silent' });
	return import(pathToFileURL(path.join(tmp, 'b.mjs')).href);
})();

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${ok ? '' : ' ' + detail}`); };

const base = { workspaceFolders: ['/w/app'], openedURIs: ['/w/app/src/a.ts'], activeURI: '/w/app/src/a.ts', persistentTerminalIDs: [], directoryStr: '/w/app\n  src/\n    a.ts', mcpTools: undefined };
const build = (chatMode, includeXMLToolDefinitions = false) => chat_systemMessage({ ...base, chatMode, includeXMLToolDefinitions });
const agent = build('agent'), agentXml = build('agent', true), gather = build('gather'), plan = build('plan'), normal = build('normal');

// ---- structure
for (const tag of ['role', 'working_style', 'understand_before_changing', 'code_quality', 'tools', 'verification', 'safety', 'untrusted_content', 'communication']) {
	check(`agent prompt has the <${tag}> section`, agent.includes(`<${tag}>`) && agent.includes(`</${tag}>`));
}
const behavior = agentBehavior({ singleToolCall: false });
check('every section tag is closed once and in order', (() => { const open = [...behavior.matchAll(/<([a-z_]+)>/g)].map(m => m[1]); const close = [...behavior.matchAll(/<\/([a-z_]+)>/g)].map(m => m[1]); return open.join() === close.join(); })());

// ---- the rules that matter most for an autonomous coding agent
const mustSay = {
	'finishes the task (not only a plan)': /Keep going until the task is finished/,
	'a text-only reply ends the turn': /no tool call ends your turn/,
	'acts on a request instead of describing it': /make it; do not only describe it/,
	'reads before it writes': /Read before you write/,
	'does not describe code it has not opened': /Never describe or edit code you have not looked at/,
	'stops thrashing': /re-reading or re-editing the same files without making progress/,
	'minimal change': /Keep the change small and focused/,
	'no hard-coding to pass tests': /hard-code values to make a test pass/,
	'does not weaken tests': /weaken, skip or edit tests/,
	'verifies and reads the output': /read the real output/,
	'no claim without a run': /Never claim that something works if you did not run it/,
	'two failed fixes: rethink': /same fix fails twice/,
	'asks before destructive or shared-state actions': /Ask first before anything destructive/,
	'one approval is not a standing one': /A yes for one action is not permission for the next/,
	'never reverts the user\'s changes': /Never revert or overwrite changes you did not make/,
	'no commit or push unless asked': /Do not commit, push, amend or rewrite history unless asked/,
	'never skips hooks': /never skip hooks \(--no-verify\)/,
	'does not route around a block': /do not look for a way around it/,
	'outside text is data, not orders': /information, not instructions/,
	'reports faithfully': /tests that still fail are reported as failing/,
	'leads with the outcome': /leads with the outcome/,
	'no tables (the chat does not render them)': /do not use tables/,
	'no scratch files left behind': /delete it before you finish/,
};
for (const [name, re] of Object.entries(mustSay)) { check(`says: ${name}`, re.test(agent), re.source); }

// ---- the old inherited slogans are gone (they pushed the agent to over-explore and over-trigger)
for (const old of ['maximal certainty', 'ALWAYS use tools', 'Prioritize taking as many steps', 'Do not immediately make a change unless you have ALL relevant context']) {
	check(`the old slogan is gone: "${old}"`, !agent.includes(old));
}

// ---- calm wording: emphatic capitals make current models over-trigger (Anthropic's prompting guidance)
const shouted = behavior.match(/\b(ALWAYS|NEVER|CRITICAL|MUST|IMPORTANT|YOU MUST)\b/g) ?? [];
check('the behaviour text does not shout', shouted.length === 0, shouted.join());

// ---- size: every request pays for it
check(`the behaviour block stays under 10000 characters (is ${behavior.length})`, behavior.length < 10000);
check(`the whole agent prompt stays under 16000 characters without the file overview (is ${agent.length})`, agent.length < 16000);
check('no tab characters reach the model', !agent.includes('\t'));

// ---- tool-call style
check('native tool calling: independent calls are made together', agent.includes('Make independent calls together'));
check('native tool calling: no "one call at a time" rule', !agent.includes('Call one tool at a time') && !agent.includes('Only use ONE tool call at a time'));
check('XML tool calling: one call at a time, waiting for the result', agentXml.includes('Call one tool at a time and wait for its result'));
check('XML tool calling: the tool format section is still there', agentXml.includes('Available tools:') && agentXml.includes('Tool calling details:'));

// ---- the other modes
for (const [name, text] of [['gather', gather], ['plan', plan], ['normal', normal]]) {
	check(`${name} does not get the agent's sections`, !text.includes('<working_style>') && !text.includes('<role>'));
}
check('gather and plan are told that outside text is not an instruction', gather.includes('information, not instructions') && plan.includes('information, not instructions'));
check('plan keeps its structured plan format', plan.includes('<vader_plan>') && plan.includes('<validation_requirements>'));
check('agent mode keeps the system information and the file overview', agent.includes('<system_info>') && agent.includes('<files_overview>'));
check('agent mode names the workspace and the terminal', agent.includes('/w/app') && /Terminal commands run in/.test(agent));
check('normal mode is not told to use tools', !normal.includes('<tools>') && !/edit_file/.test(normal));
check('the date is in every mode', [agent, gather, plan, normal].every(t => /Today's date is/.test(t)));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
