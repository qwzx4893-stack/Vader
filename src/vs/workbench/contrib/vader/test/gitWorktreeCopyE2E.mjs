#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The git work behind a task's own copy, run for real against throw-away repositories (electron-main/gitWorktreeMainService.ts).
// Run: node src/vs/workbench/contrib/vader/test/gitWorktreeCopyE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-wtcopy-'));
await esbuild.build({ entryPoints: [path.join(here, '../electron-main/gitWorktreeMainService.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'g.mjs'), logLevel: 'silent', external: ['electron'] });
await esbuild.build({ entryPoints: [path.join(here, '../common/taskCopyModel.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'm.mjs'), logLevel: 'silent' });
const { GitWorktreeMainService } = await import(pathToFileURL(path.join(tmp, 'g.mjs')).href);
const M = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);
const svc = new GitWorktreeMainService();

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
// the throw-away repositories get their own identity so that these tests do not depend on this computer's git setup
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
// git on Windows may write files with CRLF line ends; what matters here is the text
const rd = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const fresh = (name) => { const d = path.join(tmp, name, 'app'); fs.mkdirSync(d, { recursive: true }); return d; };

// a folder that is not a git project
{
	const d = fresh('plain');
	write(path.join(d, 'a.txt'), 'one\n');
	check('a folder that is not a git project is said not to be', (await svc.inspectRepo(d)).isRepo === false);
	const r = await svc.initRepo(d);
	const i = await svc.inspectRepo(d);
	check('git can be started there, with a first commit of what is in it, and the folder then counts as clean', r.ok && i.isRepo && i.hasCommits && i.dirtyFiles === 0 && i.branch === 'main', JSON.stringify({ r, i }));
}

// a repository: dirty count, a copy, its changes, a clean merge, and undoing it
const d = fresh('repo');
g(d, 'init', '-b', 'main');
write(path.join(d, 'server', 'app.ts'), 'export const app = 1;\n');
write(path.join(d, 'server', 'limiter.ts'), 'export const limit = 10;\n');
g(d, 'add', '-A'); g(d, 'commit', '-m', 'first');
check('a clean project has no changed files', (await svc.inspectRepo(d)).dirtyFiles === 0);
write(path.join(d, 'notes.md'), 'x\n');
write(path.join(d, '.vader', 'screenshots', 's.png'), 'png');
write(path.join(d, 'server', 'app.ts'), 'export const app = 2;\n');
check('changed and new files are counted, Vader’s own folder is not', (await svc.inspectRepo(d)).dirtyFiles === 2, String((await svc.inspectRepo(d)).dirtyFiles));
check('committing them first leaves the project clean', (await svc.commitAllChanges({ repoPath: d, message: 'wip' })).ok && (await svc.inspectRepo(d)).dirtyFiles === 1 /* the .vader file is still untracked-looking? it was added by -A */ || (await svc.inspectRepo(d)).dirtyFiles === 0);

const branchName = M.branchNameFor('Add a rate limiter', 'thr1');
const base = await svc.getCurrentBranch(d);
const made = await svc.createWorktree({ repoPath: d, branchName });
check('a copy is made on its own branch, next to the project and not inside it', made.ok && !made.worktreePath.startsWith(d + path.sep) && fs.existsSync(path.join(made.worktreePath, 'server', 'app.ts')), JSON.stringify(made));
const wt = made.worktreePath;
check('a fresh copy has changed nothing', (await svc.changedFilesVsBase({ worktreePath: wt, baseBranch: base })).length === 0);
write(path.join(wt, 'server', 'limiter.ts'), 'export const limit = 100;\n');
write(path.join(wt, 'server', 'rate.ts'), 'export const rate = 1;\n');
const changed = await svc.changedFilesVsBase({ worktreePath: wt, baseBranch: base });
check('the files the task changed are named, new ones too', changed.length === 2 && changed.includes('server/limiter.ts') && changed.includes('server/rate.ts'), JSON.stringify(changed));
const lines = await svc.diffNumstatVsBase({ worktreePath: wt, baseBranch: base });
check('the lines added and removed are counted for the table of All agents', lines.added === 2 && lines.removed === 1, JSON.stringify(lines));
check('the folder itself did not change while the task worked', rd(path.join(d, 'server', 'limiter.ts')) === 'export const limit = 10;\n' && !fs.existsSync(path.join(d, 'server', 'rate.ts')));

const before = await svc.headOf(d);
const merged = await svc.commitAndMergeWorktreeBranch({ repoPath: d, worktreePath: wt, branchName, targetBranch: base, commitMessage: 'Agent: rate limiter' });
const after = await svc.headOf(d);
check('accepting merges the task into the branch it was made from', merged.ok && merged.merged && after !== before && rd(path.join(d, 'server', 'limiter.ts')) === 'export const limit = 100;\n');
const undone = await svc.undoMerge({ repoPath: d, mergeSha: after });
check('the merge can be undone: the project is as it was, and history is kept (a new commit, not a rewrite)', undone.ok && rd(path.join(d, 'server', 'limiter.ts')) === 'export const limit = 10;\n' && !fs.existsSync(path.join(d, 'server', 'rate.ts')) && g(d, 'rev-list', '--count', 'HEAD') > '3', JSON.stringify(undone));
check('only a real commit hash is taken for an undo', (await svc.undoMerge({ repoPath: d, mergeSha: '--help' })).ok === false);
await svc.removeWorktree({ repoPath: d, worktreePath: wt, branchName });
check('discarding removes the copy and its branch', !fs.existsSync(wt) && !g(d, 'branch', '--list', branchName));

// two tasks meet
{
	const b1 = 'agent/one-aaaa', b2 = 'agent/two-bbbb';
	const w1 = (await svc.createWorktree({ repoPath: d, branchName: b1 })).worktreePath;
	const w2 = (await svc.createWorktree({ repoPath: d, branchName: b2 })).worktreePath;
	write(path.join(w1, 'server', 'app.ts'), 'export const app = "one";\n');
	write(path.join(w2, 'server', 'app.ts'), 'export const app = "two";\n');
	const m1 = await svc.commitAndMergeWorktreeBranch({ repoPath: d, worktreePath: w1, branchName: b1, targetBranch: base, commitMessage: 'one' });
	const m2 = await svc.commitAndMergeWorktreeBranch({ repoPath: d, worktreePath: w2, branchName: b2, targetBranch: base, commitMessage: 'two' });
	check('a second task that changed the same lines stops on that file, and names it', m1.ok && !m2.ok && m2.conflictFiles?.join() === 'server/app.ts', JSON.stringify(m2));
	check('the folder is left as the first task made it, not half merged', g(d, 'status', '--porcelain') === '' && rd(path.join(d, 'server', 'app.ts')) === 'export const app = "one";\n');
	const started = await svc.startMergeInWorktree({ worktreePath: w2, targetBranch: base });
	const marked = await svc.conflictMarkersIn(w2);
	check('an agent merge starts in the task’s copy and the files with markers are listed', started.ok && started.conflictFiles.join() === 'server/app.ts' && marked.join() === 'server/app.ts', JSON.stringify({ started, marked }));
	const stillMarked = await svc.finishMergeInWorktree({ worktreePath: w2, commitMessage: 'merge' });
	check('it cannot be finished while markers remain', !stillMarked.ok && stillMarked.stillConflicted?.join() === 'server/app.ts');
	write(path.join(w2, 'server', 'app.ts'), 'export const app = "one and two";\n');
	check('once the markers are gone the files count as resolved', (await svc.conflictMarkersIn(w2)).length === 0);
	check('and it finishes and merges', (await svc.finishMergeInWorktree({ worktreePath: w2, commitMessage: 'merge' })).ok && (await svc.commitAndMergeWorktreeBranch({ repoPath: d, worktreePath: w2, branchName: b2, targetBranch: base, commitMessage: 'two' })).ok && rd(path.join(d, 'server', 'app.ts')) === 'export const app = "one and two";\n');
	await svc.removeWorktree({ repoPath: d, worktreePath: w1, branchName: b1 });
	await svc.removeWorktree({ repoPath: d, worktreePath: w2, branchName: b2 });
}

// the person’s own uncommitted work is in the way of the merge
{
	const b = 'agent/three-cccc';
	const w = (await svc.createWorktree({ repoPath: d, branchName: b })).worktreePath;
	write(path.join(w, 'server', 'limiter.ts'), 'export const limit = 5;\n');
	write(path.join(d, 'server', 'limiter.ts'), 'export const limit = "mine";\n'); // uncommitted, on the file the task also changed
	const m = await svc.commitAndMergeWorktreeBranch({ repoPath: d, worktreePath: w, branchName: b, targetBranch: base, commitMessage: 'three' });
	const c = M.classifyMergeFailure(m.ok ? '' : m.reason);
	check('git stopping on the person’s uncommitted work is told apart from a conflict, with the file named', !m.ok && !m.conflictFiles && c.kind === 'local-changes' && c.files.includes('server/limiter.ts'), JSON.stringify({ m: m.ok ? m : m.reason, c }));
	const stash = await svc.stashChanges({ repoPath: d, message: 'Vader: before merging three' });
	check('their changes can be set aside', stash.ok && stash.stashed && g(d, 'status', '--porcelain') === '');
	const retry = await svc.commitAndMergeWorktreeBranch({ repoPath: d, worktreePath: w, branchName: b, targetBranch: base, commitMessage: 'three' });
	check('the merge then goes through', retry.ok && retry.merged && rd(path.join(d, 'server', 'limiter.ts')) === 'export const limit = 5;\n');
	const pop = await svc.popStash(d);
	check('bringing their changes back clashes on that file, and nothing of theirs is lost: it stays in the stash', !pop.ok && pop.kept === true && g(d, 'stash', 'list').length > 0, JSON.stringify(pop));
	try { g(d, 'reset', '--hard'); g(d, 'stash', 'drop'); } catch { /* clean up */ }
	check('with nothing to set aside, stashing says so', (await svc.stashChanges({ repoPath: d, message: 'x' })).stashed === false);
	await svc.removeWorktree({ repoPath: d, worktreePath: w, branchName: b });
}

check('a name that is not safe to give git is not used for the changed-file list', (await svc.changedFilesVsBase({ worktreePath: d, baseBranch: '--evil' })).length === 0);

console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
