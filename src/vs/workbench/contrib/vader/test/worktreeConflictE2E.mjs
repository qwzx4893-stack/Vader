#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A parallel task whose branch conflicts with the current branch: the conflict is reported with its files, the person can keep one side
// (the other side's non-conflicting changes are still kept), or an agent can merge the two inside the task's worktree. Real git, real
// repositories in a temporary folder; the service has no dependencies outside git itself.
// Run: node src/vs/workbench/contrib/vader/test/worktreeConflictE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-wt-conflict-'));
await esbuild.build({ entryPoints: [path.join(here, '../electron-main/gitWorktreeMainService.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'w.mjs'), logLevel: 'silent' });
const { GitWorktreeMainService } = await import(pathToFileURL(path.join(tmp, 'w.mjs')).href);
const { conflictResolutionPrompt } = await (async () => {
	await esbuild.build({ entryPoints: [path.join(here, '../common/orchestration/conflictPrompt.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'c.mjs'), logLevel: 'silent' });
	return import(pathToFileURL(path.join(tmp, 'c.mjs')).href);
})();

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const git = async (args, cwd) => (await execFileAsync('git', args, { cwd })).stdout.trim();
const svc = new GitWorktreeMainService();

/** a repo on branch main with a.txt (3 lines) and b.txt; a task worktree that changed a.txt line 2 and b.txt; then main also changes a.txt line 2 */
async function scenario(name) {
	const root = fs.mkdtempSync(path.join(tmp, `${name}-`));
	const repoPath = path.join(root, 'repo');
	fs.mkdirSync(repoPath, { recursive: true });
	await git(['init', '-q', '-b', 'main'], repoPath);
	await git(['config', 'user.email', 't@t.t'], repoPath); await git(['config', 'user.name', 'T'], repoPath);
	fs.writeFileSync(path.join(repoPath, 'a.txt'), 'one\ntwo\nthree\n');
	fs.writeFileSync(path.join(repoPath, 'b.txt'), 'b1\nb2\n');
	await git(['add', '-A'], repoPath); await git(['commit', '-q', '-m', 'init'], repoPath);
	const created = await svc.createWorktree({ repoPath, branchName: `vader/parallel/${name}` });
	if (!created.ok) throw new Error(created.reason);
	fs.writeFileSync(path.join(created.worktreePath, 'a.txt'), 'one\ntwo FROM THE TASK\nthree\n');
	fs.writeFileSync(path.join(created.worktreePath, 'b.txt'), 'b1\nb2\nb3 from the task\n');
	fs.writeFileSync(path.join(repoPath, 'a.txt'), 'one\ntwo FROM MAIN\nthree\n');
	await git(['commit', '-q', '-am', 'main changes line two'], repoPath);
	return { repoPath, worktreePath: created.worktreePath, branchName: created.branchName };
}
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const merge = (s) => svc.commitAndMergeWorktreeBranch({ ...s, targetBranch: 'main', commitMessage: 'task' });

try {
	// ---- a conflict is reported with its files, and nothing is left half done
	{
		const s = await scenario('report');
		const r = await merge(s);
		check('a conflicting merge is reported as failed with the files that conflict', r.ok === false && JSON.stringify(r.conflictFiles) === '["a.txt"]', JSON.stringify(r));
		check('the main project is left clean and unchanged', (await git(['status', '--porcelain'], s.repoPath)) === '' && read(path.join(s.repoPath, 'a.txt')).includes('FROM MAIN') && !read(path.join(s.repoPath, 'b.txt')).includes('b3'));
		check('the task keeps its work for another try', (await git(['log', '--oneline', 'main..' + s.branchName], s.repoPath)).length > 0);
		const bad = await svc.commitAndMergeWorktreeBranch({ ...s, targetBranch: 'no-such-branch', commitMessage: 'x' });
		check('a failure that is not a conflict does not claim to be one', bad.ok === false && !bad.conflictFiles, JSON.stringify(bad));
	}

	// ---- keep the current version
	{
		const s = await scenario('keep-target');
		const r = await svc.mergeWorktreeBranchPreferring({ ...s, targetBranch: 'main', prefer: 'target', commitMessage: 'task' });
		check('keeping the current version merges', r.ok === true && r.merged === true, JSON.stringify(r));
		check('where both changed the same line, the current version stays', read(path.join(s.repoPath, 'a.txt')).includes('two FROM MAIN') && !read(path.join(s.repoPath, 'a.txt')).includes('FROM THE TASK'));
		check('what only the task changed is still merged', read(path.join(s.repoPath, 'b.txt')).includes('b3 from the task'));
		check('no conflict markers anywhere', !/<<<<<<<|>>>>>>>/.test(read(path.join(s.repoPath, 'a.txt'))) && (await git(['status', '--porcelain'], s.repoPath)) === '');
	}

	// ---- keep the task's version
	{
		const s = await scenario('keep-branch');
		const r = await svc.mergeWorktreeBranchPreferring({ ...s, targetBranch: 'main', prefer: 'branch', commitMessage: 'task' });
		check('keeping the task\'s version merges', r.ok === true && r.merged === true, JSON.stringify(r));
		check('where both changed the same line, the task\'s version wins', read(path.join(s.repoPath, 'a.txt')).includes('two FROM THE TASK') && !read(path.join(s.repoPath, 'a.txt')).includes('FROM MAIN'));
		check('and its other change is merged', read(path.join(s.repoPath, 'b.txt')).includes('b3 from the task'));
	}

	// ---- a branch name that could be read as an option is refused
	{
		const s = await scenario('unsafe');
		const r = await svc.mergeWorktreeBranchPreferring({ ...s, branchName: '--upload-pack=evil', targetBranch: 'main', prefer: 'branch', commitMessage: 'x' });
		check('a branch name starting with a dash is refused before git sees it', r.ok === false && /not one Vader will pass/.test(r.reason), JSON.stringify(r));
		const r2 = await svc.startMergeInWorktree({ worktreePath: s.worktreePath, targetBranch: '-x' });
		check('so is a target branch like that', r2.ok === false);
	}

	// ---- let the agent merge: markers appear in the worktree only, then the merge goes through
	{
		const s = await scenario('agent');
		const started = await svc.startMergeInWorktree({ worktreePath: s.worktreePath, targetBranch: 'main' });
		check('the merge starts in the worktree and names the files with markers', started.ok === true && JSON.stringify(started.conflictFiles) === '["a.txt"]', JSON.stringify(started));
		check('the markers are in the worktree', /<<<<<<<[\s\S]*=======[\s\S]*>>>>>>>/.test(read(path.join(s.worktreePath, 'a.txt'))));
		check('the main project is untouched by it', (await git(['status', '--porcelain'], s.repoPath)) === '' && !read(path.join(s.repoPath, 'a.txt')).includes('<<<<<<<'));
		const early = await svc.finishMergeInWorktree({ worktreePath: s.worktreePath, commitMessage: 'merge' });
		check('finishing is refused while markers remain', early.ok === false && early.stillConflicted?.includes('a.txt'), JSON.stringify(early));
		fs.writeFileSync(path.join(s.worktreePath, 'a.txt'), 'one\ntwo FROM MAIN AND THE TASK\nthree\n'); // what the agent would write
		const done = await svc.finishMergeInWorktree({ worktreePath: s.worktreePath, commitMessage: 'merge' });
		check('once the markers are gone the merge is committed', done.ok === true, JSON.stringify(done));
		const final = await merge(s);
		check('then the task merges into the project without a conflict', final.ok === true && final.merged === true, JSON.stringify(final));
		check('the agent\'s version and the task\'s other change are both in the project', read(path.join(s.repoPath, 'a.txt')).includes('FROM MAIN AND THE TASK') && read(path.join(s.repoPath, 'b.txt')).includes('b3 from the task'));
		check('and the project is clean', (await git(['status', '--porcelain'], s.repoPath)) === '');
	}

	// ---- work an agent committed itself still merges
	{
		const root = fs.mkdtempSync(path.join(tmp, 'committed-'));
		const repoPath = path.join(root, 'repo');
		fs.mkdirSync(repoPath, { recursive: true });
		await git(['init', '-q', '-b', 'main'], repoPath); await git(['config', 'user.email', 't@t.t'], repoPath); await git(['config', 'user.name', 'T'], repoPath);
		fs.writeFileSync(path.join(repoPath, 'a.txt'), 'x\n'); await git(['add', '-A'], repoPath); await git(['commit', '-q', '-m', 'init'], repoPath);
		const c = await svc.createWorktree({ repoPath, branchName: 'vader/parallel/committed' });
		fs.writeFileSync(path.join(c.worktreePath, 'new.txt'), 'made by the agent\n');
		await git(['add', '-A'], c.worktreePath); await git(['commit', '-q', '-m', 'agent commit'], c.worktreePath);
		const r = await svc.commitAndMergeWorktreeBranch({ repoPath, worktreePath: c.worktreePath, branchName: c.branchName, targetBranch: 'main', commitMessage: 'x' });
		check('work the agent committed itself is merged, not reported as "no changes"', r.ok === true && r.merged === true && fs.existsSync(path.join(repoPath, 'new.txt')), JSON.stringify(r));
		const nothing = await svc.createWorktree({ repoPath, branchName: 'vader/parallel/nothing' });
		const r2 = await svc.commitAndMergeWorktreeBranch({ repoPath, worktreePath: nothing.worktreePath, branchName: nothing.branchName, targetBranch: 'main', commitMessage: 'x' });
		check('a task that changed nothing still says so', r2.ok === true && r2.merged === false, JSON.stringify(r2));
	}

	// ---- what the agent is told
	const prompt = conflictResolutionPrompt({ worktreePath: 'C:/wt/x', targetBranch: 'main', files: ['src/a.ts', 'src/b.ts'], task: 'Add a limiter' });
	check('the agent is told the folder, the files, and not to commit', /C:\/wt\/x/.test(prompt) && /- src\/a\.ts/.test(prompt) && /- src\/b\.ts/.test(prompt) && /Do not commit/.test(prompt) && /<<<<<<</.test(prompt));
} finally {
	fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
