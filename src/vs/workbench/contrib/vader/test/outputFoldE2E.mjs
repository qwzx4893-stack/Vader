#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A long command result, folded (common/outputFold.ts).
// Run: node src/vs/workbench/contrib/vader/test/outputFoldE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-fold-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/outputFold.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'f.mjs'), logLevel: 'silent' });
const F = await import(pathToFileURL(path.join(tmp, 'f.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');

check('a short result is shown whole', (() => { const f = F.foldOutput(lines(12)); return !f.folded && f.total === 12 && f.hidden === 0 && f.text === lines(12); })());
check('a longer one keeps its head and says how many lines are not shown', (() => { const f = F.foldOutput(lines(412)); return f.folded && f.total === 412 && f.hidden === 406 && f.text === lines(6); })());
check('thirteen lines is the first that is folded', F.foldOutput(lines(13)).folded && F.foldOutput(lines(13)).hidden === 7);
check('trailing newlines and Windows line ends are not counted', F.foldOutput(lines(5) + '\n\n\n').total === 5 && F.foldOutput(lines(5).replace(/\n/g, '\r\n')).total === 5);
check('nothing at all is no lines', F.foldOutput('').total === 0 && F.foldOutput('  \n ').total === 0);
check('the words', F.lineCount(412) === '412 lines' && F.lineCount(1) === '1 line' && F.moreLines(406) === '… 406 more lines' && F.moreLines(1) === '… 1 more line');

check('a command that finished says its exit code and how long it took', JSON.stringify(F.commandEndWords({ type: 'done', exitCode: 0 }, 41200)) === '{"text":"exit 0, 41 s","tone":"ok"}' && JSON.stringify(F.commandEndWords({ type: 'done', exitCode: 1 }, 3000)) === '{"text":"exit 1, 3 s","tone":"bad"}');
check('a command under a second says so, one that was left running says that', F.commandEndWords({ type: 'done', exitCode: 0 }, 200).text === 'exit 0, <1 s' && F.commandEndWords({ type: 'timeout' }, 30000).text === 'still running after 30 s' && F.commandEndWords({ type: 'timeout' }, undefined).text === 'still running');
check('an old chat with no time still shows the exit code', F.commandEndWords({ type: 'done', exitCode: 2 }, undefined).text === 'exit 2' && F.commandEndWords(undefined, undefined).text === '');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
