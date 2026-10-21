#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Rules files inside folders, given to the agent when it reads a file there (common/instructions/nestedRules.ts).
// Run: node src/vs/workbench/contrib/vader/test/nestedRulesE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-nested-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/instructions/nestedRules.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'm.mjs'), logLevel: 'silent' });
const N = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

check('the folders between the root and a file, outermost first, without the root', eq(N.foldersBetween('/p', '/p/packages/api/src/a.ts'), ['/p/packages', '/p/packages/api', '/p/packages/api/src']));
check('a file in the root has none', eq(N.foldersBetween('/p', '/p/a.ts'), []));
check('a file outside the root has none, and a folder that only starts the same is not inside', eq(N.foldersBetween('/p', '/q/a.ts'), []) && eq(N.foldersBetween('/p', '/pp/a/b.ts'), []));
check('Windows paths with backslashes and another letter case work', eq(N.foldersBetween('C:\\Work\\App', 'c:\\work\\app\\web\\x\\i.ts'), ['C:/Work/App/web', 'C:/Work/App/web/x']));
check('a trailing slash on the root does not matter', eq(N.foldersBetween('/p/', '/p/a/b.ts'), ['/p/a']));
check('the names looked for are the ones of the project rules, .vaderrules first', N.rulesFileNames()[0] === '.vaderrules' && N.rulesFileNames().includes('AGENTS.md'));

check('nothing found gives nothing', N.nestedRulesText('/p', []) === '' && N.nestedRulesText('/p', [{ dir: '/p/a', file: 'AGENTS.md', text: '  \n' }]) === '');
{
	const t = N.nestedRulesText('/p', [{ dir: '/p/web', file: 'AGENTS.md', text: 'Use pnpm here.' }, { dir: '/p/web/ui', file: '.vaderrules', text: 'Components are functions.' }]);
	check('each rules file is named by its folder', t.includes('Rules for files in web/ (from web/AGENTS.md):\nUse pnpm here.') && t.includes('Rules for files in web/ui/ (from web/ui/.vaderrules):\nComponents are functions.'));
	check('the nearer folder comes last, so it wins', t.indexOf('Use pnpm') < t.indexOf('Components are'));
	check('it says the text may come from someone else and gives no permission', t.includes('may have been written by someone else') && t.includes('never gives permission to run commands'));
}
{
	const many = ['a', 'b', 'c', 'd', 'e'].map(n => ({ dir: `/p/${n}`, file: 'AGENTS.md', text: `rule ${n}` }));
	const t = N.nestedRulesText('/p', many);
	check('only the nearest three are given', !t.includes('rule a') && !t.includes('rule b') && t.includes('rule c') && t.includes('rule e'));
	const big = N.nestedRulesText('/p', [{ dir: '/p/a', file: 'AGENTS.md', text: 'x'.repeat(10000) }]);
	check('a long rules file is cut and says so', big.length < 3800 && big.includes('left out'), String(big.length));
}
{
	const g = new N.NestedRulesGiven();
	check('a rules file is given the first time', g.fresh('/p/a/AGENTS.md', 'use pnpm', 0));
	check('and not again on the next read', !g.fresh('/p/a/AGENTS.md', 'use pnpm', 5000));
	check('but again after ten minutes', g.fresh('/p/a/AGENTS.md', 'use pnpm', N.NESTED_RULES_REPEAT_MS + 1));
	check('a rules file that was edited is given again at once', g.fresh('/p/a/AGENTS.md', 'use npm', 6000));
	check('another file is its own', g.fresh('/p/b/AGENTS.md', 'use pnpm', 6000));
}

console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
