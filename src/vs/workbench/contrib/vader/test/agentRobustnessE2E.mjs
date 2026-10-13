#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Three robustness fixes found by running the Aider polyglot benchmark through the real app (see test/e2e/polyglotBench.mjs), bundled from source:
//   common/toolArgAliases.ts  - a file argument written as `path`/`file_path` is understood as `uri`
//   common/loopDetection.ts   - an agent that alternates between a few calls is stopped (the "same call 8 times in a row" guard missed it)
//   common/toolNameHints.ts   - a call to a tool that does not exist is answered with the real tool names and the one that was probably meant
// Run: node src/vs/workbench/contrib/vader/test/agentRobustnessE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-robust-'));
const load = async (rel, name) => {
	await esbuild.build({ entryPoints: [path.join(here, rel)], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, name), logLevel: 'silent' });
	return import(pathToFileURL(path.join(tmp, name)).href);
};
const { withUriAlias } = await load('../common/toolArgAliases.ts', 'a.mjs');
const { RepeatedCallDetector, TextRepetitionDetector } = await load('../common/loopDetection.ts', 'l.mjs');
const { unknownToolMessage } = await load('../common/toolNameHints.ts', 'h.mjs');

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${ok ? '' : ` ${detail}`}`); };

// ---- argument aliases
check('uri given: left alone', withUriAlias({ uri: 'a.txt', path: 'b.txt' }).uri === 'a.txt');
for (const alias of ['path', 'file_path', 'filepath', 'file_name', 'filename', 'file', 'target_file', 'absolute_path']) {
	check(`${alias} is accepted as uri`, withUriAlias({ [alias]: 'src/x.ts', new_content: 'c' }).uri === 'src/x.ts');
}
check('the other arguments are kept', withUriAlias({ path: 'x', new_content: 'c' }).new_content === 'c');
check('an empty alias is ignored', withUriAlias({ path: '  ' }).uri === undefined);
check('a non-string alias is ignored', withUriAlias({ path: 5 }).uri === undefined);
check('no alias, no uri: unchanged', Object.keys(withUriAlias({ query: 'q' })).join() === 'query');
check('the input object is not modified', (() => { const p = { path: 'x' }; withUriAlias(p); return p.uri === undefined; })());
check('null/undefined input does not throw', (() => { try { withUriAlias(undefined); withUriAlias(null); return true; } catch { return false; } })());

// ---- loop detection
{
	const d = new RepeatedCallDetector();
	// the benchmark's real loop: cd build / cmake .. / cmake .. / cd .. / cd build ...
	const cycle = [['run_command', { command: 'cd build' }], ['run_command', { command: 'cmake ..' }], ['run_command', { command: 'cmake ..' }], ['run_command', { command: 'cd ..' }]];
	let stoppedAt = -1;
	for (let i = 0; i < 40 && stoppedAt < 0; i++) { const [n, a] = cycle[i % cycle.length]; if (d.push(n, a).stuck) { stoppedAt = i + 1; } }
	check('an alternating terminal loop is stopped', stoppedAt > 0, `never stopped`);
	check('...after one full window, not sooner', stoppedAt === 20, `stopped at ${stoppedAt}`);
}
{
	const d = new RepeatedCallDetector();
	// real work: 30 edits, each to another file or with other content, plus repeated test runs in between
	let stuck = false;
	for (let i = 0; i < 30; i++) {
		stuck = d.push(i % 3 === 2 ? 'run_command' : 'edit_file', i % 3 === 2 ? { command: 'npm test' } : { uri: `src/f${i}.ts`, search_replace_blocks: `v${i}` }).stuck || stuck;
	}
	check('real progress (new arguments each time) is never stopped', !stuck);
}
{
	const d = new RepeatedCallDetector();
	let stuck = false;
	for (let i = 0; i < 19; i++) { stuck = d.push('read_file', { uri: 'a.ts' }).stuck || stuck; }
	check('fewer calls than a full window are never stopped', !stuck);
	check('the 20th identical call is', d.push('read_file', { uri: 'a.ts' }).stuck);
}
check('argument order does not matter', (() => { const d = new RepeatedCallDetector(2, 1); d.push('t', { a: 1, b: 2 }); return d.push('t', { b: 2, a: 1 }).distinct === 1; })());
check('unserialisable input does not throw', (() => { const c = {}; c.self = c; try { new RepeatedCallDetector().push('t', c); return true; } catch { return false; } })());

// ---- unknown tool names
const offered = ['read_file', 'ls_dir', 'edit_file', 'rewrite_file', 'create_file_or_folder', 'run_command', 'search_for_files'];
const msg = (n) => unknownToolMessage(n, offered);
check('"shell" points at run_command', /use "run_command"/.test(msg('shell')), msg('shell'));
check('"bash" and "execute_command" too', /use "run_command"/.test(msg('bash')) && /use "run_command"/.test(msg('execute_command')));
check('"cat" points at read_file', /use "read_file"/.test(msg('cat')));
check('"grep" points at search_for_files', /use "search_for_files"/.test(msg('grep')));
check('the real tool names are listed', offered.every(n => msg('whatever').includes(n)));
check('an unrelated name gets the list but no guess', !/use "/.test(msg('frobnicate')) && msg('frobnicate').includes('run_command'));
check('no guess for a tool that is not offered (read-only mode)', !/use "run_command"/.test(unknownToolMessage('shell', ['read_file', 'ls_dir'])));
check('it names the tool that was called', msg('shell').includes('"shell"'));

// ---- untrusted instruction layers are framed (a planted line in .vaderrules or in a saved note must not read as the user's own order)
{
	const { UNTRUSTED_LAYER_FRAMING } = await load('../common/instructions/instructionsService.ts', 'i.mjs');
	for (const layer of ['workspace', 'projectMemory', 'agentMemory']) {
		check(`${layer} text is framed as possibly written by someone else`, typeof UNTRUSTED_LAYER_FRAMING[layer] === 'string' && /run commands/.test(UNTRUSTED_LAYER_FRAMING[layer]) && /send data/.test(UNTRUSTED_LAYER_FRAMING[layer]));
	}
	for (const layer of ['systemInvariants', 'policy', 'globalUser', 'agent', 'skill', 'task']) {
		check(`${layer} is not framed (the user's own text stays plain)`, UNTRUSTED_LAYER_FRAMING[layer] === undefined);
	}
}

// ---- text that repeats itself (a small model chanting one sentence, in its answer or its reasoning)
{
	const feed = (text, step = 7) => { const d = new TextRepetitionDetector(); for (let n = step; n <= text.length + step; n += step) { const r = d.update(text.slice(0, Math.min(n, text.length))); if (r.stuck) return { at: Math.min(n, text.length), sample: r.sample }; } return null; };
	const chant = 'I will now try again with the same approach. '.repeat(200);
	const hit = feed(chant);
	check('a sentence repeated over and over is caught', !!hit);
	check('...within about 15 repeats of it, not at the end of a long answer', hit && hit.at < 15 * 45, `at ${hit?.at}`);
	check('a good answer followed by a loop is caught', !!feed('Here is what I found in the project. The login page sets the redirect in router.ts, then the guard checks the session. ' + chant));
	check('...also when it loops in two alternating sentences', !!feed('Let me check the file. Now let me read it again. '.repeat(120)));
	// real text must never be flagged: prose, tables, rules, indentation, and a whole source tree
	check('long dashes, equals signs and spaces are ignored', ['-'.repeat(6000), '='.repeat(6000), ' '.repeat(6000), '| --- | --- | --- |\n'.repeat(300)].every(t => !feed(t)));
	let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
	const words = ('the of and to in is that for it as was with be by on not he this are or his from at which but have an had they you were their one all we can her has there been if more when will would who so no').split(' ');
	const prose = Array.from({ length: 8000 }, () => words[Math.floor(rnd() * words.length)]).join(' ');
	check('90,000 characters of varied prose are not flagged', !feed(prose, 40));
	const files = [];
	const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'out') walk(f); } else if (/\.(ts|tsx|md)$/.test(e.name)) files.push(f); } };
	walk(path.join(here, '..')); walk(path.join(here, '../../../../../../docs'));
	const flagged = files.filter(f => feed(fs.readFileSync(f, 'utf8'), 200));
	check(`${files.length} source and doc files: none looks like a loop`, flagged.length === 0, flagged.slice(0, 3).join(', '));
	// a new, shorter text starts afresh; and memory stays bounded on a very long answer that ends in a loop
	const d = new TextRepetitionDetector(); d.update('x'.repeat(10)); check('a shorter text is a new text', !d.update('short').stuck);
	check('a loop after 300,000 characters of varied text is still caught', !!feed(prose + prose + prose + chant, 997));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
