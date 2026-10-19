#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The checkpoint list of a chat and what each step changed (common/checkpointModel.ts).
// Run: node src/vs/workbench/contrib/vader/test/checkpointModelE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-cp-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/checkpointModel.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'c.mjs'), logLevel: 'silent' });
const C = await import(pathToFileURL(path.join(tmp, 'c.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const L = (...l) => l.join('\n');

check('equal texts changed nothing', JSON.stringify(C.lineDiffCounts('a\nb', 'a\nb')) === '{"added":0,"removed":0}');
check('lines added at the end', JSON.stringify(C.lineDiffCounts(L('a', 'b'), L('a', 'b', 'c', 'd'))) === '{"added":2,"removed":0}');
check('a line replaced is one removed and one added', JSON.stringify(C.lineDiffCounts(L('a', 'b', 'c'), L('a', 'X', 'c'))) === '{"added":1,"removed":1}');
check('a moved block is not counted as unchanged lines that were not there', JSON.stringify(C.lineDiffCounts(L('a', 'b', 'c', 'd'), L('a', 'c', 'd'))) === '{"added":0,"removed":1}');
check('a new file is all added, a deleted one all removed', JSON.stringify(C.lineDiffCounts('', L('x', 'y'))) === '{"added":2,"removed":0}' && JSON.stringify(C.lineDiffCounts(L('x', 'y'), '')) === '{"added":0,"removed":2}');
check('inserting in the middle is found even when the ends are the same', JSON.stringify(C.lineDiffCounts(L('1', '2', '3', '4', '5', '6'), L('1', '2', 'a', 'b', '3', '4', '5', '6'))) === '{"added":2,"removed":0}');
{ const big = Array.from({ length: 3000 }, (_, i) => `l${i}`); const other = big.map((x, i) => i % 2 ? x : 'z' + x); const t0 = Date.now(); const d = C.lineDiffCounts(big.join('\n'), other.join('\n')); check('a big change is counted quickly, and as lines', Date.now() - t0 < 3000 && d.added > 0 && d.removed > 0, String(Date.now() - t0)); }

const cp = (type, snap) => ({ role: 'checkpoint', type, vaderFileSnapshotOfURI: snap });
const snap = (code) => ({ entireFileCode: code });
const msgs = [
	cp('user_edit', {}),
	{ role: 'user', displayContent: 'Add a rate limiter to the API server' },
	{ role: 'tool', name: 'read_file', params: { uri: { fsPath: '/w/server.ts' } } },
	cp('tool_edit', { '/w/limiter.ts': snap('') }),
	{ role: 'tool', name: 'rewrite_file', params: { uri: { fsPath: '/w/limiter.ts' } } },
	cp('tool_edit', { '/w/limiter.ts': snap(L('a', 'b')), }),
	{ role: 'tool', name: 'edit_file', params: { uri: { fsPath: '/w/limiter.ts' } } },
	cp('user_edit', { '/w/limiter.ts': snap(L('a', 'b', 'c')) }),
];
const now = { '/w/limiter.ts': L('a', 'b', 'c') };
const steps = C.stepsOfThread(msgs, (p) => now[p]);
check('every checkpoint is a step, numbered from 1', steps.map(s => s.n).join() === '1,2,3,4' && steps.map(s => s.messageIdx).join() === '0,3,5,7');
check('a step is named for what it did, or for the message it comes before', steps.map(s => s.label).join(' | ') === 'Before “Add a rate limiter to the API server” | Wrote limiter.ts | Edited limiter.ts | The end of the last run', steps.map(s => s.label).join(' | '));
check('a step that kept no files changed nothing', steps[0].added === 0 && steps[0].removed === 0 && C.changeWords(0, 0) === 'no changes');
check('a file is compared with the next checkpoint that kept it', steps[1].added === 2 && steps[1].removed === 0 && steps[1].files[0].path === '/w/limiter.ts');
check('the step before a later checkpoint that kept the file is compared with it', steps[2].added === 1 && steps[2].removed === 0);
check('the last step is compared with what the file is now, and left out when it cannot be read', steps[3].added === 0 && C.stepsOfThread(msgs.slice(0, 7), () => undefined).length === 3 && C.stepsOfThread([cp('tool_edit', { '/w/x.ts': snap('a') })], () => undefined)[0].files.length === 0 && C.stepsOfThread([cp('tool_edit', { '/w/x.ts': snap('a') })], () => 'a\nb')[0].added === 1);
{
	const c = C.compareSteps(steps, 1, 3);
	check('comparing two checkpoints adds up the steps between them, by file', c.files.length === 1 && c.added === 2 && c.removed === 0, JSON.stringify(c));
	check('the order of the two does not matter', JSON.stringify(C.compareSteps(steps, 3, 1)) === JSON.stringify(c));
}
check('changes are said as the board says them', C.changeWords(12, 1) === '+12 −1' && C.changeWords(48, 0) === '+48' && C.changeWords(0, 3) === '−3');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
