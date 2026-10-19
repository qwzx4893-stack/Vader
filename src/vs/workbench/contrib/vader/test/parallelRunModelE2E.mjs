#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A parallel run as the window shows it (common/parallelRunModel.ts).
// Run: node src/vs/workbench/contrib/vader/test/parallelRunModelE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-prun-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/parallelRunModel.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'p.mjs'), logLevel: 'silent' });
const P = await import(pathToFileURL(path.join(tmp, 'p.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const MIN = 60_000;
const task = (o) => ({ id: 't', task: 'Check the cloud providers', agentName: 'Researcher', usesWorktree: true, status: 'success', branchName: 'wt/probe-cloud', startedAt: 0, finishedAt: 6 * MIN, ...o });

check('minutes are said as a person would', P.minutesWords(10_000) === 'under a minute' && P.minutesWords(6 * MIN) === '6 min' && P.minutesWords(65 * MIN) === '1 h 5 min' && P.minutesWords(120 * MIN) === '2 h');
{
	const r = P.rowOf(task({ mergeOutcome: 'merged', changedFilePaths: ['a', 'b', 'c'] }), 7 * MIN);
	check('a task that merged says so, with its time, branch and files', r.result === 'Merged cleanly' && r.tone === 'ok' && r.sub === 'finished in 6 min' && r.branch === 'wt/probe-cloud' && r.files === '3 files' && r.helper === 'Researcher', JSON.stringify(r));
}
check('one file is singular', P.rowOf(task({ mergeOutcome: 'merged', changedFilePaths: ['a'] }), 0).files === '1 file');
check('a task with no changes says that', P.rowOf(task({ mergeOutcome: 'no_changes' }), 0).result === 'No changes');
{
	const r = P.rowOf(task({ mergeOutcome: 'conflict', conflictFiles: ['src/x.ts'] }), 0);
	check('a conflict names how many files, in a warning tone', r.result === 'Conflict in 1 file' && r.tone === 'warn' && r.kind === 'conflict');
}
check('a task still working says how long it has been', (() => { const r = P.rowOf(task({ status: 'running', finishedAt: undefined, startedAt: 0 }), 3 * MIN); return r.result === 'Working' && r.sub === 'running for 3 min'; })());
check('a task not yet started waits', P.rowOf(task({ status: 'pending', startedAt: undefined, finishedAt: undefined }), 0).result === 'Waiting');
check('a merge that failed, checks that failed, and a task that failed are said apart', P.rowOf(task({ mergeOutcome: 'merge_failed' }), 0).result === 'Could not merge' && P.rowOf(task({ mergeOutcome: 'verification_failed' }), 0).result === 'Checks failed' && P.rowOf(task({ status: 'error' }), 0).result === 'Failed');
check('a task that did not use its own copy says it worked in your folder', P.rowOf(task({ usesWorktree: false, branchName: undefined, mergeOutcome: undefined }), 0).branch === 'your folder');
check('a task with no helper named says the default one', P.rowOf(task({ agentName: null }), 0).helper === 'Default agent');
{
	const run = { id: 'r', createdAt: 0, cancelled: false, tasks: [task({}), task({}), task({}), task({ status: 'running', finishedAt: undefined })] };
	check('the run says how many are finished and how many are running', P.runSummary(run) === '3 of 4 finished, 1 running');
	check('a run with a task running is running, one with none is not', P.isRunning(run) && !P.isRunning({ ...run, tasks: run.tasks.slice(0, 3) }) && !P.isRunning({ ...run, cancelled: true }));
}
{
	const w = P.conflictWords(task({ mergeOutcome: 'conflict', conflictFiles: ['src/a/b/acpRegistrySnapshot.ts'] }));
	check('a conflict says what both sides did and the ways out, naming the file', w.title === 'Conflict in wt/probe-cloud' && w.text.startsWith('Both this task and the current branch changed the same lines of src/a/b/acpRegistrySnapshot.ts.') && /let an agent merge them/.test(w.text), w.text);
}
check('a path is cut in the middle to fit', P.middleCut('src/vs/workbench/contrib/vader/common/acpRegistrySnapshot.ts') === 'src/ … /acpRegistrySnapshot.ts' && P.middleCut('a/b.ts') === 'a/b.ts');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
