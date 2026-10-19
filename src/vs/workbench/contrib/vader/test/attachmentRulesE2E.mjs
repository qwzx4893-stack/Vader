#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Files dropped on the message box (common/attachmentRules.ts).
// Run: node src/vs/workbench/contrib/vader/test/attachmentRulesE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-attach-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/attachmentRules.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'a.mjs'), logLevel: 'silent' });
const A = await import(pathToFileURL(path.join(tmp, 'a.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const f = (name, size, type) => ({ name, size, type });

check('sizes are said as a person would', A.sizeWords(512) === '512 B' && A.sizeWords(84 * 1024) === '84 KB' && A.sizeWords(212 * 1024) === '212 KB' && A.sizeWords(1.5 * 1024 * 1024) === '1.5 MB' && A.sizeWords(5 * 1024 * 1024) === '5 MB' && A.sizeWords(40 * 1024 * 1024) === '40 MB', [A.sizeWords(1.5 * 1024 * 1024), A.sizeWords(5 * 1024 * 1024)].join());
check('the limits are those the drop zone says', A.dropHint() === 'Up to 10 files, 5 MB each' && A.DROP_TITLE === 'Drop to attach');

{
	const v = A.checkDrop([f('server.log', 212 * 1024), f('limiter.ts', 3000, 'text/typescript')], 0);
	check('text files are taken', v.accepted.map(x => x.name).join() === 'server.log,limiter.ts' && v.refused.length === 0);
}
{
	const v = A.checkDrop([f('error.png', 84 * 1024, 'image/png'), f('photo.JPG', 10), f('logo.svg', 10)], 0);
	check('images are refused, and the reason says images are not sent yet', v.accepted.length === 0 && v.refused.length === 3 && v.refused.every(r => /images are not sent yet/.test(r.why)));
}
check('other binary files are refused as not text', A.checkDrop([f('a.zip', 5), f('b.pdf', 5), f('c.exe', 5)], 0).refused.every(r => r.why === 'it is not a text file'));
check('an empty file is refused', A.checkDrop([f('empty.txt', 0)], 0).refused[0].why === 'it is empty');
{
	const v = A.checkDrop([f('big.log', 6 * 1024 * 1024)], 0);
	check('a file over the limit says its size and the limit', v.refused[0].why === 'it is 6 MB, and the limit is 5 MB', v.refused[0].why);
	check('exactly the limit is taken', A.checkDrop([f('ok.log', 5 * 1024 * 1024)], 0).accepted.length === 1);
}
{
	const many = Array.from({ length: 12 }, (_, i) => f(`f${i}.txt`, 10));
	const v = A.checkDrop(many, 0);
	check('no more than ten files for one message', v.accepted.length === 10 && v.refused.length === 2 && /10 files is the most/.test(v.refused[0].why));
	const w = A.checkDrop([f('a.txt', 1), f('b.txt', 1), f('c.txt', 1)], 8);
	check('what is already attached counts', w.accepted.length === 2 && w.refused.length === 1);
}
check('a file that was read and has binary content is recognised', A.looksBinary('ab\u0000cd') && A.looksBinary('�'.repeat(10) + 'x'.repeat(100)) && !A.looksBinary('plain text with a � once ' + 'x'.repeat(200)) && !A.looksBinary(''));
{
	const v = A.checkDrop([f('ok.txt', 10), f('error.png', 5, 'image/png')], 0);
	check('the note says how many were attached and what was not, and why', A.dropNote(v) === '1 attached. Not attached — error.png: images are not sent yet, only text files..' || A.dropNote(v) === '1 attached. Not attached — error.png: images are not sent yet, only text files.', A.dropNote(v));
	check('nothing refused, nothing to say', A.dropNote(A.checkDrop([f('a.txt', 1)], 0)) === undefined);
	const many = A.checkDrop(Array.from({ length: 6 }, (_, i) => f(`i${i}.png`, 1, 'image/png')), 0);
	check('a long list of refusals is cut to three, and the count of the rest is said', /3 more were not attached\./.test(A.dropNote(many)));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
