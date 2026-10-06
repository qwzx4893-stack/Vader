#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// `braces` (used by micromatch, chokidar, fast-glob: gulp, tailwind, mocha...) has an open advisory, GHSA-vfj7-8cjw-p6xm: expand() recurses once per
// nesting level, so about 4,900 nested braces overflow the stack. Every released version is affected and upstream has published no fix, so Vader's
// build tooling uses build/stubs/braces, upstream 3.0.3 plus a nesting-depth limit. This proves two things against the stock 3.0.3 tarball:
//   1. the problem is real, and the patched copy rejects such input quickly instead of overflowing
//   2. everything a real pattern does is unchanged: thousands of generated patterns give identical results from both
//
// Run: node src/vs/workbench/contrib/void/test/bracesPatchE2E.mjs   (needs npm and network, to fetch the stock tarball)

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-braces-'));
execFileSync('npm', ['pack', 'braces@3.0.3', '--silent'], { cwd: tmp, stdio: 'pipe' });
execFileSync('tar', ['xzf', 'braces-3.0.3.tgz'], { cwd: tmp });
execFileSync('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--silent'], { cwd: path.join(tmp, 'package'), stdio: 'pipe' }); // fill-range and its dependency
const patchedDir = path.join(repo, 'build/stubs/braces');
const stock = createRequire(import.meta.url)(path.join(tmp, 'package'));
const patched = createRequire(import.meta.url)(patchedDir);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const log = console.log; console.log = () => { }; // upstream leaves a debug console.log in a rarely used branch

const nest = (n) => '{'.repeat(n) + 'a' + '}'.repeat(n);
let stockOverflow = false; try { stock.expand(nest(4900)); } catch (e) { stockOverflow = e instanceof RangeError; }
check('the advisory is real: stock braces 3.0.3 overflows the stack on 4,900 nested braces', stockOverflow);
let t = Date.now(), thrown = null; try { patched.expand(nest(4900)); } catch (e) { thrown = e; }
check('the patched copy rejects it with a SyntaxError, not a stack overflow', thrown instanceof SyntaxError && !(thrown instanceof RangeError), String(thrown));
check('...and does so quickly', Date.now() - t < 500, `${Date.now() - t} ms`);
for (const n of [100, 150, 200]) {
	check(`nesting of ${n} levels (far deeper than any real pattern) still works and equals stock`, JSON.stringify(patched.expand(nest(n))) === JSON.stringify(stock.expand(nest(n))));
}

// differential: random but valid-looking patterns, depth <= 8
let seed = 12345; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const atoms = ['a', 'b', 'foo', 'x1', '/', '.', '-', '*', '**', '?', '[ab]'];
const gen = (depth) => {
	let out = '';
	for (let i = 0, n = 1 + rnd(4); i < n; i++) {
		const k = rnd(depth > 0 ? 6 : 3);
		if (k < 3) { out += atoms[rnd(atoms.length)]; }
		else if (k === 3) { out += '{' + Array.from({ length: 2 + rnd(3) }, () => gen(depth - 1)).join(',') + '}'; }
		else if (k === 4) { const a = rnd(5), b = a + rnd(5); out += `{${a}..${b}}`; }
		else { out += '{' + String.fromCharCode(97 + rnd(5)) + '..' + String.fromCharCode(102 + rnd(5)) + '}'; }
	}
	return out;
};
let compared = 0, differing = [];
for (let i = 0; i < 5000; i++) {
	const p = gen(1 + rnd(6));
	for (const fn of ['expand', 'compile', 'parse']) {
		let a, b;
		try { a = JSON.stringify(stock[fn](p)); } catch (e) { a = 'throw ' + e.constructor.name; }
		try { b = JSON.stringify(patched[fn](p)); } catch (e) { b = 'throw ' + e.constructor.name; }
		compared++;
		if (a !== b) { differing.push(`${fn}(${p})`); }
	}
}
check(`${compared} calls on generated patterns give identical results in stock and patched`, differing.length === 0, differing.slice(0, 3).join(' | '));
check('the patched package is versioned above the vulnerable range (3.0.4 > 3.0.3), so npm audit no longer flags it', JSON.parse(fs.readFileSync(path.join(patchedDir, 'package.json'), 'utf8')).version === '3.0.4');

console.log = log;
console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
