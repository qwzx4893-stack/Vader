#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The agent's task list (common/taskList.ts, tool `update_task_list`), bundled from source: how the list a model writes is read, what it is told back, and that the tool is wired
// into every place a tool has to be (prompt, parameter check, execution, result text, chat title) and kept out of the old-output pruning.
// Run: node src/vs/workbench/contrib/vader/test/taskListE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-tasks-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/taskList.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 't.mjs'), logLevel: 'silent' });
const T = await import(pathToFileURL(path.join(tmp, 't.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const statuses = (t) => T.parseTaskList(t).map(x => x.status[0]).join('');

// ---- reading what the model wrote
check('the three marks', statuses('[x] a\n[~] b\n[ ] c') === 'dip');
check('bullets and numbers in front are dropped', T.parseTaskList('- [x] first\n2. [~] second\n* [ ] third').map(t => t.text).join('|') === 'first|second|third');
check('other ways of writing the marks', statuses(['[X] a', '[-] b', '[✓] c', '(x) d', '(~) e', '( ) f', '☐ g', '☑ h', '✅ i'].join('\n')) === 'diddippdd');
check('a line without a mark is a pending task', statuses('Find the bug\nFix it') === 'pp');
check('blank lines and Windows line ends', T.parseTaskList('[x] a\r\n\r\n[ ] b\r\n').length === 2);
check('a mark with no text is dropped', T.parseTaskList('[x]\n[ ] real').length === 1);
check('long tasks are shortened', T.parseTaskList('[ ] ' + 'x'.repeat(1000))[0].text.length === T.MAX_TASK_CHARS);
check('the list is stored as the model wrote it, normalised', T.formatTaskList(T.parseTaskList('- [X] a\n[-] b\nc')) === '[x] a\n[~] b\n[ ] c');
check('a list round-trips', (() => { const l = '[x] a\n[~] b\n[ ] c'; return T.formatTaskList(T.parseTaskList(l)) === l; })());

// ---- what the model is told back
const r1 = T.taskListResultText(T.parseTaskList('[x] a\n[~] b\n[ ] c'));
check('the result shows the list and the count', r1.includes('Task list updated (1 of 3 done)') && r1.includes('[~] b'));
check('a healthy list gets no nagging', !/Note:|All tasks|No task/.test(r1));
check('two tasks in progress: told to keep one', /more than one task is marked in progress/.test(T.taskListResultText(T.parseTaskList('[~] a\n[~] b'))));
check('nothing in progress: told to mark one', /No task is marked in progress/.test(T.taskListResultText(T.parseTaskList('[x] a\n[ ] b'))));
check('all done: told to check and report', /All tasks are done/.test(T.taskListResultText(T.parseTaskList('[x] a\n[x] b'))));
check('the summary counts', JSON.stringify(T.summariseTaskList(T.parseTaskList('[x] a\n[~] b\n[ ] c\n[ ] d'))) === '{"total":4,"done":1,"inProgress":1,"pending":2}');

// ---- wired everywhere a tool has to be (the compiler checks the exhaustive maps; these are the rest)
const read = (rel) => fs.readFileSync(path.join(here, rel), 'utf8');
const prompts = read('../common/prompt/prompts.ts'), svc = read('../browser/toolsService.ts'), types = read('../common/toolsServiceTypes.ts'), chat = read('../browser/react/src/sidebar-tsx/SidebarChat.tsx'), thread = read('../browser/chatThreadService.ts'), behavior = read('../common/prompt/agentBehavior.ts');
check('the tool is described to the model', /update_task_list: \{\s*name: 'update_task_list'/.test(prompts));
check('...its parameter is checked, executed and turned into text', /update_task_list: \(params: RawToolParamsObj\)/.test(svc) && /update_task_list: async \(\{ tasks \}\)/.test(svc) && /update_task_list: \(params, result\)/.test(svc));
check('...it has a title in the chat', /'update_task_list': \{ done: 'Updated the task list'/.test(chat));
check('...it needs no approval (it changes nothing but the conversation)', !/'update_task_list': '(edits|terminal|MCP tools)'/.test(types));
check('...old task lists are not pruned from the context', /m\.name !== 'update_task_list'/.test(thread));
check('...the instructions say when to use it', /update_task_list/.test(behavior));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
