#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What an edit did to the problems of a file (common/lintDelta.ts): only what it introduced is reported, the wait ends when the editor's list has settled, and a streak of edits that
// keep leaving problems is told to the agent. Pure, with a pretend clock.
// Run: node src/vs/workbench/contrib/vader/test/lintDeltaE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-lint-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/lintDelta.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'm.mjs'), logLevel: 'silent' });
const D = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const L = (code, message, line) => ({ code, message, startLineNumber: line, endLineNumber: line });

// ---- what is new
{
	const before = [L('6133', "'a' is declared but never used", 3), L('2304', "Cannot find name 'x'", 10)];
	const same = D.splitLintDelta(before, before);
	check('the same problems after the edit are old, none are new', same.fresh.length === 0 && same.old === 2 && same.fixed === 0);
	const shifted = D.splitLintDelta(before, [L('6133', "'a' is declared but never used", 8), L('2304', "Cannot find name 'x'", 15)]);
	check('lines that moved because lines were added above are still the same problems', shifted.fresh.length === 0 && shifted.old === 2);
	const added = D.splitLintDelta(before, [...before, L('2322', "Type 'string' is not assignable to type 'number'", 12)]);
	check('a new problem is reported as new, the old ones are counted', added.fresh.length === 1 && added.fresh[0].code === '2322' && added.old === 2 && added.fixed === 0);
	const fixedOne = D.splitLintDelta(before, [before[0]]);
	check('a problem that is gone was fixed by the edit', fixedOne.fresh.length === 0 && fixedOne.old === 1 && fixedOne.fixed === 1);
	const both = D.splitLintDelta(before, [before[1], L('1005', "';' expected", 4)]);
	check('one fixed and one introduced at once', both.fresh.length === 1 && both.fixed === 1 && both.old === 1);
	const dup = D.splitLintDelta([L('6133', 'unused', 2), L('6133', 'unused', 9)], [L('6133', 'unused', 2), L('6133', 'unused', 9), L('6133', 'unused', 20)]);
	check('the same message three times where it was twice: one is new', dup.fresh.length === 1 && dup.old === 2);
	check('spaces and line breaks inside a message do not make it a different problem', D.splitLintDelta([L('x', 'a   b\n c', 1)], [L('x', 'a b c', 5)]).fresh.length === 0);
	check('a different code with the same words is a different problem', D.splitLintDelta([L('1', 'm', 1)], [L('2', 'm', 1)]).fresh.length === 1);
	const none = D.splitLintDelta([], []);
	check('no problems before and after is nothing to say', none.fresh.length === 0 && none.old === 0 && none.fixed === 0);
}

// ---- waiting for the list to settle
const world = (script) => { // script: [time, signature] sorted; the signature is what the editor shows at and after that time
	let t = 0;
	return { io: { signature: () => { let s = script[0][1]; for (const [at, sig] of script) if (t >= at) s = sig; return s; }, now: () => t, sleep: async (ms) => { t += ms; } }, at: () => t };
};
{
	const w = world([[0, 'before'], [500, 'after']]);
	const r = await D.settleLints(w.io, 'before');
	check('when the list changes and then stays still, the wait ends soon after: it settled', r === 'settled' && w.at() >= 900 && w.at() <= 1100, `${r} at ${w.at()}`);
}
{
	const w = world([[0, 'same']]);
	const r = await D.settleLints(w.io, 'same');
	check('when the list does not change at all, the wait is the two seconds it always was', r === 'unchanged' && w.at() >= 2000 && w.at() <= 2200, `${r} at ${w.at()}`);
}
{
	const w = world(Array.from({ length: 80 }, (_, i) => [i * 100, 's' + i]));
	const r = await D.settleLints(w.io, 'before');
	check('a list that keeps moving is waited for at most four seconds', r === 'timeout' && w.at() >= 4000 && w.at() <= 4200, `${r} at ${w.at()}`);
}
{
	const w = world([[0, 'before'], [300, 'a'], [600, 'b'], [900, 'b']]);
	const r = await D.settleLints(w.io, 'before');
	check('several quick changes in a row are one: it settles after the last', r === 'settled' && w.at() >= 1000 && w.at() <= 1200, `${r} at ${w.at()}`);
	const w2 = world([[0, 'before'], [200, 'x'], [300, 'before']]);
	check('a list that went back to where it was is settled too (it did change)', await D.settleLints(w2.io, 'before') === 'settled');
	const w3 = world([[0, 'b']]);
	check('the timings can be changed', await D.settleLints(w3.io, 'b', { noChangeMs: 300 }) === 'unchanged' && w3.at() <= 400);
}

// ---- a streak of edits that leave problems
{
	const s = new D.LintStreak();
	check('edits that leave problems are counted in a row, per file, and a clean edit starts over', s.record('a.ts', true) === 1 && s.record('a.ts', true) === 2 && s.record('b.ts', true) === 1 && s.record('a.ts', true) === 3 && s.record('a.ts', false) === 0 && s.record('a.ts', true) === 1 && s.limit === 3);
}

// ---- what the agent is told
const stringify = (items) => items.map((i, n) => `Error ${n + 1}: ${i.message}`).join('\n');
{
	check('without a delta (the setting is off or nothing was read) nothing is said', D.lintReport(undefined, { stringify }) === '');
	const clean = D.lintReport({ fresh: [], old: 0, fixed: 0 }, { stringify });
	check('a clean edit says so', clean === ' No new problems.');
	const clean2 = D.lintReport({ fresh: [], old: 30, fixed: 2 }, { stringify });
	check('a clean edit in a file with problems of its own says that they are not shown, and what it fixed', clean2.includes('No new problems') && clean2.includes('30 problems that were already in this file are not shown') && clean2.includes('this change fixed 2'), clean2);
	const one = D.lintReport({ fresh: [L('1', 'Cannot find name y', 3)], old: 1, fixed: 0 }, { stringify });
	check('new problems are listed with how many, and what was there before is only counted, in the right grammar', one.includes('Problems this change introduced (1):') && one.includes('Error 1: Cannot find name y') && one.includes('1 problem that was already in this file is not shown') && clean2.includes('30 problems that were already in this file are not shown'), one);
	const streak = D.lintReport({ fresh: [L('1', 'm', 1)], old: 0, fixed: 0 }, { stringify, streak: 3 });
	check('on the third edit in a row that leaves problems the agent is told to stop and rethink', streak.includes('3rd edit in a row') && streak.includes('Stop trying small variations'), streak);
	check('before that it is not told', !D.lintReport({ fresh: [L('1', 'm', 1)], old: 0, fixed: 0 }, { stringify, streak: 2 }).includes('in a row'));
}

console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
