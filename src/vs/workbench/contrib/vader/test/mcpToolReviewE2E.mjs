#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// "A tool changed" (common/mcpToolReview.ts): which tools of an MCP server the agent is given, which wait for an answer, and the words.
// Run: node src/vs/workbench/contrib/vader/test/mcpToolReviewE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-mcpreview-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/mcpToolReview.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'm.mjs'), logLevel: 'silent' });
const M = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const cur = ['create_pull_request', 'list_issues', 'search_code', 'get_file_contents'];

{
	const r = M.reviewTools(undefined, cur);
	check('a server never looked at gives all its tools and asks nothing: the person is adding it', r.firstLook && r.allowed.length === 4 && r.pending.length === 0);
}
{
	const r = M.reviewTools({ approvedTools: cur }, cur);
	check('a server that offers what it offered is unchanged', !r.firstLook && r.allowed.length === 4 && r.pending.length === 0 && r.off.length === 0);
}
{
	const r = M.reviewTools({ approvedTools: cur }, [...cur, 'delete_repository']);
	check('a tool that was not there waits, and is not given to the agent', r.pending.join() === 'delete_repository' && r.allowed.length === 4 && !r.allowed.includes('delete_repository'));
}
{
	const r = M.reviewTools({ approvedTools: cur, offTools: ['search_code'] }, cur);
	check('a tool the person keeps off is not given', r.off.join() === 'search_code' && !r.allowed.includes('search_code') && r.allowed.length === 3);
}
check('a tool the server no longer offers is simply gone', M.reviewTools({ approvedTools: cur }, cur.slice(0, 2)).allowed.length === 2);
{
	const st = M.allowTools({ approvedTools: cur, offTools: ['delete_repository'] }, ['delete_repository']);
	check('allowing a tool approves it and takes it off the off list', st.approvedTools.includes('delete_repository') && st.offTools.length === 0 && M.reviewTools(st, [...cur, 'delete_repository']).allowed.includes('delete_repository'));
	const k = M.keepToolsOff({ approvedTools: cur }, ['delete_repository']);
	check('keeping it off answers the question and keeps it from the agent', k.offTools.join() === 'delete_repository' && M.reviewTools(k, [...cur, 'delete_repository']).pending.length === 0 && !M.reviewTools(k, [...cur, 'delete_repository']).allowed.includes('delete_repository'));
	check('and it can be allowed later', M.allowTools(k, ['delete_repository']).offTools.length === 0);
}
{
	const w = M.toolChangedWords('GitHub', ['delete_repository']);
	check('one new tool is said the way the board says it', w.title === 'GitHub added a tool' && w.body === 'The server now offers delete_repository. It was not there when you added the server.' && w.keepOff === 'Keep it off' && w.allow === 'Allow it' && w.remove === 'Remove the server');
	const m = M.toolChangedWords('GitHub', ['a', 'b', 'c']);
	check('several are counted and named', m.title === 'GitHub added 3 tools' && m.body === 'The server now offers a, b and c. They were not there when you added the server.' && m.allow === 'Allow them');
}
check('a call to a tool that is new, or kept off, is refused with the reason; any other is not', M.toolCallRefusal({ approvedTools: cur }, 'GitHub', 'delete_repository').includes('has not been allowed yet') && M.toolCallRefusal({ approvedTools: cur, offTools: ['list_issues'] }, 'GitHub', 'list_issues').includes('kept off') && M.toolCallRefusal({ approvedTools: cur }, 'GitHub', 'list_issues') === undefined && M.toolCallRefusal(undefined, 'GitHub', 'anything') === undefined);

console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
