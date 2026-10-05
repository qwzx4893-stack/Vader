#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The agent's search_in_file tool runs a model-supplied regular expression. This test shows the problem is real
// (an unguarded ^(a+)+$ hangs for many seconds on a 26-character line) and that the guard stops it, while ordinary patterns
// a model writes for code search still work. Uses the real helper bundled from source.
//
// Run: node src/vs/workbench/contrib/void/test/searchRegexGuardE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-rx-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/helpers/safeRegex.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'r.mjs'), logLevel: 'silent' });
const { compileModelRegex, MAX_REGEX_SOURCE_CHARS } = await import(pathToFileURL(path.join(tmp, 'r.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

// the problem is real
const evilLine = 'a'.repeat(25) + 'b';
const t0 = Date.now(); new RegExp('^(a+)+$').test(evilLine); const hangMs = Date.now() - t0;
check(`unguarded ^(a+)+$ is catastrophic (${hangMs} ms on a 26-char line)`, hangMs > 300, `${hangMs} ms`);

for (const evil of ['^(a+)+$', '(x+x+)+y', '(.*)*', '([a-z]+\\d*){2,}', '(a*)*b', '(\\w+\\s?)*$', '(a{1,}){2,}']) {
	const r = compileModelRegex(evil);
	check(`rejected: ${evil}`, !r.ok && /repeats a group|hang/.test(r.reason), JSON.stringify(r));
}
check('an over-long pattern is rejected', !compileModelRegex('a'.repeat(MAX_REGEX_SOURCE_CHARS + 1)).ok);
check('an invalid pattern is reported, not thrown', (() => { const r = compileModelRegex('(unclosed'); return !r.ok && /Invalid regular expression/.test(r.reason); })());
for (const fine of ['foo\\d+', '^import .* from', '[a-z]+@[a-z]+\\.com', 'function\\s+\\w+\\(', '(foo|bar)baz', 'TODO|FIXME', '\\bclass\\s+[A-Z]\\w*', '(\\d{3})-(\\d{4})', '^\\s*export (const|function) \\w+']) {
	const r = compileModelRegex(fine);
	check(`accepted: ${fine}`, r.ok === true, JSON.stringify(r));
}
{
	const r = compileModelRegex('(foo|bar)baz'); const t = Date.now(); const m = r.ok && r.regex.test('xxbarbaz');
	check('an accepted pattern still matches', m === true && Date.now() - t < 100);
}
console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
