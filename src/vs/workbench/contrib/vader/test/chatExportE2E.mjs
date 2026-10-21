#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A conversation as a Markdown file (common/chatExport.ts): what was said, one line per thing done, the files changed, a file name that is safe.
// Run: node src/vs/workbench/contrib/vader/test/chatExportE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-chatexport-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/chatExport.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'm.mjs'), logLevel: 'silent' });
const M = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const tool = (name, type, params) => ({ role: 'tool', name, type, params });
const uri = (p) => ({ uri: { fsPath: p } });
const md = M.chatToMarkdown({ messages: [
	{ role: 'user', displayContent: 'Add a rate limiter to the API server.' },
	{ role: 'assistant', displayContent: 'I will read the server first.' },
	tool('read_file', 'success', uri('C:\\work\\server\\app.ts')),
	tool('create_file_or_folder', 'success', uri('C:\\work\\server\\limiter.ts')),
	tool('run_command', 'success', { command: 'npm test -- --runInBand' }),
	tool('run_command', 'rejected', { command: 'rm -rf dist' }),
	tool('edit_file', 'tool_request', uri('C:\\work\\server\\app.ts')),
	{ role: 'checkpoint' },
	{ role: 'assistant', displayContent: 'Added a token-bucket limiter.' },
	tool('edit_file', 'success', uri('C:\\work\\server\\app.ts')),
	tool('edit_file', 'success', uri('C:\\work\\server\\app.ts')),
] }, { title: '  Rate limiter\nfor the API server ', exportedOn: new Date('2026-10-15T10:00:00Z') });

check('the title is the first line and the date is said', md.startsWith('# Rate limiter for the API server\n') && md.includes('Exported from Vader on 2026-10-15.'));
check('it says keys and settings are not in the file', md.includes('API keys and settings are not part of a conversation'));
check('what the person said and what Vader said are under their own headings', md.includes('## You\n\nAdd a rate limiter to the API server.') && md.includes('## Vader\n\nI will read the server first.'));
check('each thing the agent did is one line', md.includes('- Read `C:/work/server/app.ts`') && md.includes('- Created `C:/work/server/limiter.ts`') && md.includes('- Ran `npm test -- --runInBand`'));
check('a command the person rejected says so', md.includes('- Ran `rm -rf dist` (you rejected it)'));
check('a request that was still waiting is not written as something that happened', !/Edited `C:\/work\/server\/app.ts` \(/.test(md) && md.split('Edited `C:/work/server/app.ts`').length === 3);
check('files changed are listed once, in order, and only the ones that were changed', /## Files changed\n\n- `C:\/work\/server\/limiter.ts`\n- `C:\/work\/server\/app.ts`\n$/.test(md), md.slice(-160));
check('a checkpoint is not in the file', !md.includes('checkpoint'));
check('a summary of earlier messages is kept, and said to be one', M.chatToMarkdown({ messages: [{ role: 'compacted_summary', summary: 'The user wants a limiter.' }] }, { title: 't', exportedOn: new Date(0) }).includes('_Earlier messages were summarised:_\n\nThe user wants a limiter.'));
check('a backtick in a command cannot break the line', M.toolLine(tool('run_command', 'success', { command: 'echo `date`' })) === "Ran `echo 'date'`");
check('a tool the file does not know is named in words', M.toolLine(tool('open_persistent_terminal', 'success', {})) === 'Used open persistent terminal');
check('the file name comes from the title and is safe on any system', M.exportFileName('Rate limiter: API/server?') === 'Rate-limiter-APIserver.md' && M.exportFileName('   ') === 'chat.md' && M.exportFileName('..hidden') === 'hidden.md' && M.exportFileName('x'.repeat(200)).length === 63);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
