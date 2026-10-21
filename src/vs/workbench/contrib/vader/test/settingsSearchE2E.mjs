#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Searching Settings and the nearest places (common/settingsSearch.ts).
// Run: node src/vs/workbench/contrib/vader/test/settingsSearchE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-ssearch-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/settingsSearch.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 's.mjs'), logLevel: 'silent' });
const S = await import(pathToFileURL(path.join(tmp, 's.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const pages = [
	{ id: 'models', label: 'Models', words: 'model provider key api openai anthropic gemini endpoint', group: 'Providers' },
	{ id: 'privacy', label: 'Privacy and network', words: 'privacy network telemetry contact proxy', group: 'Network' },
	{ id: 'usage', label: 'Usage and cost', words: 'usage cost spend limit budget tokens price', group: 'Spending' },
	{ id: 'editor', label: 'Editor', words: 'autocomplete editor quick edit apply suggestions commit message', group: 'Editor' },
];

check('every word typed has to be on the page', S.matchPages(pages, 'spend limit').map(p => p.id).join() === 'usage' && S.matchPages(pages, 'limit spend').map(p => p.id).join() === 'usage' && S.matchPages(pages, 'spend zzz').length === 0);
check('nothing typed is every page', S.matchPages(pages, '  ').length === 4);
check('case and punctuation do not matter', S.matchPages(pages, 'PROXY!').map(p => p.id).join() === 'privacy');
check('a word that is nearly a word of a page leads to it', S.nearestPages(pages, 'proxi').map(p => p.id)[0] === 'privacy' && S.nearestPages(pages, 'authocomplete').map(p => p.id)[0] === 'editor', JSON.stringify(S.nearestPages(pages, 'proxi')));
check('at most two places are offered, the nearest first', S.nearestPages(pages, 'modl provder', 2).length <= 2 && S.nearestPages(pages, 'modl provder')[0].id === 'models');
check('something that is like nothing offers nothing', S.nearestPages(pages, 'qqqzzz').length === 0 && S.nearestPages(pages, 'ab').length === 0 && S.nearestPages(pages, '').length === 0);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
