#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Where an edit lands (common/editMatching.ts) and which block markers are understood (common/helpers/extractCodeFromResult.ts), bundled from source.
// Two defects this guards against: an exact match that was not unique edited the FIRST occurrence silently, and a match inside a line replaced the WHOLE line with the new fragment.
// Run: node src/vs/workbench/contrib/vader/test/editMatchingE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-edit-'));
const load = async (rel, name) => {
	await esbuild.build({ entryPoints: [path.join(here, rel)], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, name), logLevel: 'silent' });
	return import(pathToFileURL(path.join(tmp, name)).href);
};
const { locateEdit, normaliseBlockMarkers } = await load('../common/editMatching.ts', 'm.mjs');
const { extractSearchReplaceBlocks } = await load('../common/helpers/extractCodeFromResult.ts', 'x.mjs');

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
// what editCodeService does with a location
const apply = (file, orig, final) => { const r = locateEdit(orig, file); return typeof r === 'string' ? r : file.slice(0, r.start) + final + file.slice(r.end); };

const file = [
	'function load(opts) {',
	'\tconst opts2 = { timeout: 5000, retries: 3 }',
	'\tif (!opts) {',
	'\t\treturn null',
	'\t}',
	'\treturn fetch(opts2)',
	'}',
	'function save(data) {',
	'\tif (!data) {',
	'\t\treturn null',
	'\t}',
	'\treturn write(data)',
	'}',
].join('\n');

// ---- exact matches
check('whole lines: replaced exactly', apply(file, '\treturn fetch(opts2)', '\treturn fetch(opts2, { cache: true })').includes('\treturn fetch(opts2, { cache: true })\n}'));
check('a fragment inside a line keeps the rest of the line (it used to replace the whole line)', apply(file, 'timeout: 5000', 'timeout: 10000').includes('\tconst opts2 = { timeout: 10000, retries: 3 }'));
check('...and everything else in the file is untouched', apply(file, 'timeout: 5000', 'timeout: 10000').replace('10000', '5000') === file);
check('text that occurs twice is "Not unique", not the first occurrence', locateEdit('\t\treturn null', file) === 'Not unique');
check('...but with a line of context it is unique', typeof locateEdit('\treturn write(data)', file) === 'object' && typeof locateEdit('\tif (!data) {\n\t\treturn null', file) === 'object');
check('text that is not in the file is "Not found"', locateEdit('return undefined', file) === 'Not found');
check('multi-line exact text', apply(file, '\tif (!opts) {\n\t\treturn null\n\t}', '\tif (!opts) throw new Error("opts")').includes('\tif (!opts) throw new Error("opts")\n\treturn fetch'));
check('empty replacement deletes the matched characters only', apply('a\nb\nc', 'b', '') === 'a\n\nc');
check('Windows line ends in the search text still match an LF file', typeof locateEdit('\tif (!data) {\r\n\t\treturn null\r\n\t}', file) === 'object');
check('empty search text: only on an empty file', JSON.stringify(locateEdit('', '')) === '{"start":0,"end":0}' && locateEdit('', 'x') === 'Not found');

// ---- the one tolerant step: the same lines ignoring whitespace and typography
check('indentation written with spaces instead of tabs', apply(file, '    if (!opts) {\n        return null\n    }', '\tif (!opts) return null').includes('\tif (!opts) return null\n\treturn fetch'));
check('...it replaces the whole lines it matched', !apply(file, '    return fetch(opts2)', '\treturn go()').includes('fetch'));
check('blank lines around the search text do not matter', typeof locateEdit('\n\n\treturn write(data)\n\n', file) === 'object');
check('smart quotes in the file match straight quotes in the search text', apply('const s = “hello”\nnext', 'const s = "hello"', 'const s = "bye"') === 'const s = "bye"\nnext');
check('a non-breaking space in the file', typeof locateEdit('return  write(data)', 'x\n\treturn write(data)\ny') === 'object');
check('whitespace-insensitive but ambiguous: "Not unique"', locateEdit('if(!data){', 'if (!data) {\nx\nif ( !data ) {') === 'Not unique');
check('a changed identifier is not matched (no similarity guessing)', locateEdit('\tconst opts3 = { timeout: 5000, retries: 3 }', file) === 'Not found');
check('a fragment with other whitespace is not matched (the tolerant step works on whole lines)', locateEdit('timeout:  5000,retries', file) === 'Not found');
check('a different line count is not matched', locateEdit('\tif (!opts) {\n\t}', file) === 'Not found');

// ---- block markers
const canonical = '<<<<<<< ORIGINAL\nlet a = 1\n=======\nlet a = 2\n>>>>>>> UPDATED';
const b0 = extractSearchReplaceBlocks(canonical);
check('canonical block', b0.length === 1 && b0[0].state === 'done' && b0[0].orig === 'let a = 1' && b0[0].final === 'let a = 2');
for (const [name, text] of [
	['SEARCH / REPLACE', '<<<<<<< SEARCH\nlet a = 1\n=======\nlet a = 2\n>>>>>>> REPLACE'],
	['four < and four >', '<<<< ORIGINAL\nlet a = 1\n=======\nlet a = 2\n>>>> UPDATED'],
	['spaces after the markers', '<<<<<<< ORIGINAL  \nlet a = 1\n=======\nlet a = 2\n>>>>>>> UPDATED   '],
	['Windows line ends', '<<<<<<< ORIGINAL\r\nlet a = 1\r\n=======\r\nlet a = 2\r\n>>>>>>> UPDATED\r\n'],
	['lower case', '<<<<<<< search\nlet a = 1\n=======\nlet a = 2\n>>>>>>> replace'],
	['inside a code fence with a lead-in', 'Here is the edit:\n```\n<<<<<<< SEARCH\nlet a = 1\n=======\nlet a = 2\n>>>>>>> REPLACE\n```'],
]) {
	const b = extractSearchReplaceBlocks(text);
	check(`${name} is understood`, b.length === 1 && b[0].state === 'done' && b[0].orig === 'let a = 1' && b[0].final === 'let a = 2', JSON.stringify(b));
}
{
	const two = extractSearchReplaceBlocks('<<<<<<< SEARCH\nA\n=======\nB\n>>>>>>> REPLACE\n\n<<<<<<< SEARCH\nC\n=======\nD\n>>>>>>> REPLACE');
	check('several blocks in the other spelling', two.length === 2 && two[1].orig === 'C' && two[1].final === 'D');
	const md = extractSearchReplaceBlocks('<<<<<<< ORIGINAL\nTitle\n=====\ntext\n=======\nTitle\n=====\nnew text\n>>>>>>> UPDATED');
	check('a Markdown heading underline inside the text is not taken for the divider', md.length === 1 && md[0].orig === 'Title\n=====\ntext' && md[0].final === 'Title\n=====\nnew text', JSON.stringify(md));
	check('text without any block still gives no block', extractSearchReplaceBlocks('I would change the function like this.').length === 0);
}
// streaming: as text arrives character by character, the blocks only grow and a block never goes backwards
for (const text of [canonical, '<<<<<<< SEARCH\nlet a = 1\n=======\nlet a = 2\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nB\n=======\nC\n>>>>>>> REPLACE']) {
	const rank = { writingOriginal: 0, writingFinal: 1, done: 2 };
	let prev = [], ok = true, why = '';
	for (let n = 1; n <= text.length; n++) {
		const cur = extractSearchReplaceBlocks(text.slice(0, n));
		if (cur.length < prev.length) { ok = false; why = `shrank at ${n}`; break; }
		for (let i = 0; i < prev.length; i++) if (rank[cur[i].state] < rank[prev[i].state]) { ok = false; why = `block ${i} went back at ${n}`; break; }
		prev = cur;
	}
	check('streaming: blocks never shrink or go backwards', ok, why);
}
check('a half-written closing marker is not taken for the end', extractSearchReplaceBlocks('<<<<<<< SEARCH\nA\n=======\nB\n>>>>').every(b => b.state !== 'done'));
check('markers are normalised only when the text has any', normaliseBlockMarkers('plain text') === 'plain text');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
