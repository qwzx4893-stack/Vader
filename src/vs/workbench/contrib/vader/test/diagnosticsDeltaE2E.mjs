#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Only the problems a task introduced (common/verification/diagnosticsDelta.ts).
// Run: node src/vs/workbench/contrib/vader/test/diagnosticsDeltaE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-delta-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/verification/diagnosticsDelta.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'm.mjs'), logLevel: 'silent' });
const D = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

// ---- reading the output of tools
const tsc = `src/net/retry.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.\nsrc/api/limiter.ts(40,17): error TS2345: Argument of type 'undefined' is not assignable.\n\nFound 2 errors in 2 files.`;
{
	const p = D.parseProblems(tsc);
	check('tsc errors are read with file, line, code and message', p.length === 2 && p[0].file === 'src/net/retry.ts' && p[0].line === 12 && p[0].code === 'TS2322' && p[0].message.startsWith("Type 'string'"), JSON.stringify(p));
}
check('tsc in its pretty form too', D.parseProblems('src/a.ts:3:7 - error TS2304: Cannot find name \'x\'.')[0]?.code === 'TS2304');
check('colours in the output do not matter', D.parseProblems('\u001b[31msrc/a.ts(1,1): error TS1005: \';\' expected.\u001b[0m')[0]?.code === 'TS1005');
check('gcc, clang, go, mypy and eslint (unix) lines are read', D.parseProblems('main.c:10:5: error: expected ; before return')[0]?.file === 'main.c' && D.parseProblems('./main.go:7:2: undefined: foo')[0]?.file === 'main.go' && D.parseProblems('app/x.py:12: error: Incompatible types [assignment]')[0]?.line === 12 && D.parseProblems('/p/a.js:3:1: error Unexpected var [Error/no-var]').length >= 0);
check('rust errors are read from their arrow line', (() => { const p = D.parseProblems('error[E0308]: mismatched types\n  --> src/main.rs:12:5\n   |\n12 |     let x: u8 = "a";\n\nerror: aborting due to 1 previous error'); return p.length === 1 && p[0].code === 'E0308' && p[0].file === 'src/main.rs' && p[0].line === 12; })());
check('pyright lines are read', D.parseProblems('  /p/app.py:12:5 - error: "x" is not defined')[0]?.line === 12 || D.parseProblems('/p/app.py:12:5 - error: "x" is not defined')[0]?.line === 12);
check('eslint stylish output is read, the file from the line above', (() => { const p = D.parseProblems('/p/src/a.js\n  3:5  error  \'x\' is defined but never used  no-unused-vars\n  9:1  warning  Unexpected console  no-console\n\n2 problems'); return p.length === 1 && p[0].file === '/p/src/a.js' && p[0].code === 'no-unused-vars'; })());
check('failing tests are read: jest, pytest, go, TAP', D.parseProblems('FAIL src/a.test.ts\n  ✕ retries three times (12 ms)').length === 2 && D.parseProblems('FAILED tests/test_a.py::test_x - AssertionError').some(p => p.message === 'tests/test_a.py::test_x') && D.parseProblems('--- FAIL: TestRetry (0.00s)')[0]?.message === 'TestRetry' && D.parseProblems('not ok 3 - parses config')[0]?.message === 'parses config');
check('output with no problem in it has none', D.parseProblems('built in 41s\nall good').length === 0 && D.parseProblems('').length === 0);
check('the same problem twice on one line is one problem', D.parseProblems(tsc + '\n' + tsc).length === 2);

// ---- the same problem in another run
{
	const a = D.parseProblems("src/a.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.")[0];
	const b = D.parseProblems("src/a.ts(14,5): error TS2322: Type 'string' is not assignable to type 'number'.")[0];
	check('a problem is the same problem when a few lines were added above it', D.problemKey(a) === D.problemKey(b));
	check('a different message or file or code is another problem', D.problemKey(a) !== D.problemKey(D.parseProblems("src/b.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.")[0]) && D.problemKey(a) !== D.problemKey(D.parseProblems("src/a.ts(10,5): error TS2345: Type 'string' is not assignable to type 'number'.")[0]));
	check('a count inside the words is folded', D.problemKey(D.parseProblems("src/a.ts(1,1): error TS2554: Expected 2 arguments, but got 3.")[0]) === D.problemKey(D.parseProblems("src/a.ts(9,1): error TS2554: Expected 2 arguments, but got 1.")[0]));
}

// ---- judging a check
const out = (name, passed, output) => ({ name, passed, exitCode: passed ? 0 : 1, output });
{
	const base = out('typecheck', false, tsc);
	const after = out('typecheck', false, tsc.replace('(12,5)', '(15,5)'));
	const v = D.judgeCheck(after, base);
	check('a check that failed the same way before is not the task’s doing', !v.regression && v.existing === 2 && v.reason.includes('nothing new'), JSON.stringify(v));
}
{
	const v = D.judgeCheck(out('typecheck', false, tsc + "\nsrc/new.ts(1,1): error TS2304: Cannot find name 'y'."), out('typecheck', false, tsc));
	check('a new problem is', v.regression && v.newProblems.length === 1 && v.newProblems[0].file === 'src/new.ts' && v.existing === 2 && v.reason === '1 new problem', JSON.stringify(v));
}
check('a check that passed before and fails now is the task’s doing', D.judgeCheck(out('test', false, 'FAIL src/a.test.ts'), out('test', true, '')).regression);
check('a check that fails with output nobody can read is the task’s doing, to be safe', D.judgeCheck(out('build', false, 'Segmentation fault'), out('build', false, 'Segmentation fault')).regression);
check('a check not run on the project as it was is the task’s doing, to be safe', D.judgeCheck(out('build', false, 'x'), undefined).regression);
check('a check that passes is nothing', !D.judgeCheck(out('build', true, ''), undefined).regression);
{
	const base = out('test', false, 'FAIL src/old.test.ts\n  ✕ old thing (3 ms)');
	const same = D.judgeCheck(out('test', false, 'FAIL src/old.test.ts\n  ✕ old thing (9 ms)'), base);
	const worse = D.judgeCheck(out('test', false, 'FAIL src/old.test.ts\n  ✕ old thing (9 ms)\nFAIL src/new.test.ts\n  ✕ new thing'), base);
	check('a test that failed before is not new, and one that fails now and not before is', !same.regression && worse.regression && worse.newProblems.some(p => p.message === 'new thing'), JSON.stringify([same, worse]));
}
{
	const ok = [D.judgeCheck(out('typecheck', false, tsc), out('typecheck', false, tsc)), D.judgeCheck(out('test', true, ''), undefined)];
	check('the words for a merge let through say what was already there', D.deltaSummary(ok).startsWith('Checks that fail (typecheck) failed the same way before this task: 2 problems that were already there, none new.'), D.deltaSummary(ok));
	const bad = [D.judgeCheck(out('typecheck', false, tsc + "\nsrc/new.ts(1,1): error TS2304: Cannot find name 'y'."), out('typecheck', false, tsc))];
	check('the words for a refusal name the new problems', D.deltaSummary(bad).includes('typecheck: 1 new problem (src/new.ts:1 Cannot find name') && D.deltaSummary([D.judgeCheck(out('b', true, ''), undefined)]) === '');
}

console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
