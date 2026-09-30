#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Regression test for a command-injection hole in electron-main/voidSCMMainService.ts: git commands
// used to be built as shell strings containing file names from the opened repository, so a file named
// `x";touch PWNED;"y` executed commands when a commit message was generated. This bundles the REAL
// service with esbuild and runs it against a hostile repo and a normal one.
//
// Run: node src/vs/workbench/contrib/void/test/scmInjectionE2E.mjs

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-scm-'));

let passed = 0, failed = 0;
const check = (name, ok, detail) => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

await esbuild.build({ entryPoints: [path.join(here, '../electron-main/voidSCMMainService.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'scm.mjs'), logLevel: 'silent' });
const { VoidSCMService } = await import(pathToFileURL(path.join(tmp, 'scm.mjs')).href);
const svc = new VoidSCMService();

function makeRepo(name) {
	const dir = path.join(tmp, name);
	fs.mkdirSync(dir);
	git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t.t'); git(dir, 'config', 'user.name', 't'); git(dir, 'config', 'commit.gpgsign', 'false');
	fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'init commit');
	return dir;
}

// 1. hostile file names must never execute anything
const hostile = makeRepo('hostile');
const evilNames = ['x";touch PWNED1;"y', 'a$(touch PWNED2)b', 'c`touch PWNED3`d', "e';touch PWNED4;'f"];
for (const n of evilNames) { fs.writeFileSync(path.join(hostile, n), 'hi\n'); }
fs.appendFileSync(path.join(hostile, 'a.txt'), 'two\n');
git(hostile, 'add', '-A');
let out = '', err;
try { out = await svc.gitSampledDiffs(hostile); } catch (e) { err = e; }
const created = fs.readdirSync(hostile).filter(f => /^PWNED\d$/.test(f));
check('no injected command ran for any hostile file name', created.length === 0, `created: ${created.join(', ')}`);
check('hostile file names are diffed correctly (exact names preserved)', !err && evilNames.every(n => out.includes(`==== ${n} ====`)), err ? String(err.message).slice(0, 120) : out.slice(0, 200));

// 2. normal behaviour
const normal = makeRepo('normal');
fs.appendFileSync(path.join(normal, 'a.txt'), 'two\nthree\n');
fs.writeFileSync(path.join(normal, 'b.txt'), 'new\n');
git(normal, 'add', '-A');
const diffs = await svc.gitSampledDiffs(normal);
check('sampled diffs include changed files', diffs.includes('==== a.txt ====') && diffs.includes('==== b.txt ===='));
check('sampled diff content is present', diffs.includes('+two') && diffs.includes('+new'));
check('gitStat reports the changes', /a\.txt/.test(await svc.gitStat(normal)));
check('gitBranch returns the branch', (await svc.gitBranch(normal)).length > 0);
check('gitLog returns the commit line', /\|init commit\|/.test(await svc.gitLog(normal)));

// 3. renamed file keeps its new name
git(normal, 'commit', '-qm', 'second'); git(normal, 'mv', 'b.txt', 'renamed.txt'); fs.appendFileSync(path.join(normal, 'renamed.txt'), 'x\n'); git(normal, 'add', '-A');
check('renames use the new name', (await svc.gitSampledDiffs(normal)).includes('==== renamed.txt ===='));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
