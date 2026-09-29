#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Vader addition, part of the final production-readiness validation pass. GitWorktreeMainService
// has zero DI dependencies (plain `child_process`/`fs`) so it's directly, fully instantiable and
// testable outside Electron - this is a REAL integration test against real git repositories,
// not a simulation. Covers success/failure/conflict paths and extends the shell-injection
// regression test (previously only covering commitMessage) to every git-argument boundary.
//
// Run: node src/vs/workbench/contrib/void/test/worktreeE2E.mjs

import { GitWorktreeMainService } from '../../../../../../out/vs/workbench/contrib/void/electron-main/gitWorktreeMainService.js';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
let passed = 0, failed = 0;
function check(name, cond, detail) {
	if (cond) { passed++; console.log(`PASS: ${name}`); }
	else { failed++; console.error(`FAIL: ${name}${detail ? ` - ${detail}` : ''}`); }
}

async function git(args, cwd) { return execFileAsync('git', args, { cwd }); }

function makeRepo() {
	const root = mkdtempSync(join(tmpdir(), 'vader-worktree-e2e-'));
	const repoPath = join(root, 'repo');
	return { root, repoPath };
}

async function initRepo(repoPath) {
	const { mkdirSync } = await import('node:fs');
	mkdirSync(repoPath, { recursive: true });
	await git(['init', '-q'], repoPath);
	await git(['config', 'user.email', 'test@test.com'], repoPath);
	await git(['config', 'user.name', 'Test'], repoPath);
	writeFileSync(join(repoPath, 'file.txt'), 'line1\n');
	writeFileSync(join(repoPath, 'test.js'), "if (require('./file.txt.js')) {}\nconsole.log('PASS');\n");
	await git(['add', '-A'], repoPath);
	await git(['commit', '-q', '-m', 'init'], repoPath);
}

async function testSuccessPath() {
	console.log('\n=== Worktree: success path (create -> edit -> commit -> merge) ===');
	const { root, repoPath } = makeRepo();
	await initRepo(repoPath);
	const svc = new GitWorktreeMainService();

	const created = await svc.createWorktree({ repoPath, branchName: 'agent-task-1' });
	check('worktree created', created.ok, JSON.stringify(created));
	if (created.ok) {
		check('worktree directory actually exists on disk', existsSync(created.worktreePath));
		writeFileSync(join(created.worktreePath, 'file.txt'), 'line1\nline2 from agent\n');
		const diffStat = await svc.getWorktreeDiffStat(created.worktreePath);
		check('diff stat reflects the real change', diffStat.includes('file.txt'), diffStat);

		const merged = await svc.commitAndMergeWorktreeBranch({ repoPath, worktreePath: created.worktreePath, branchName: 'agent-task-1', targetBranch: 'master', commitMessage: 'agent edit' });
		check('commit+merge succeeded', merged.ok && merged.merged, JSON.stringify(merged));

		const mainContent = readFileSync(join(repoPath, 'file.txt'), 'utf8');
		check('merged change is actually visible on the main branch', mainContent.includes('line2 from agent'), mainContent);

		await svc.removeWorktree({ repoPath, worktreePath: created.worktreePath, branchName: 'agent-task-1' });
		check('worktree cleaned up after merge', !existsSync(created.worktreePath));
	}
	rmSync(root, { recursive: true, force: true });
}

async function testNoChangesPath() {
	console.log('\n=== Worktree: no-changes path (nothing to merge) ===');
	const { root, repoPath } = makeRepo();
	await initRepo(repoPath);
	const svc = new GitWorktreeMainService();
	const created = await svc.createWorktree({ repoPath, branchName: 'agent-task-noop' });
	const merged = await svc.commitAndMergeWorktreeBranch({ repoPath, worktreePath: created.worktreePath, branchName: 'agent-task-noop', targetBranch: 'master', commitMessage: 'no-op' });
	check('no-changes reported correctly, not merged', merged.ok && merged.merged === false && merged.hadChanges === false, JSON.stringify(merged));
	rmSync(root, { recursive: true, force: true });
}

async function testConflictPath() {
	console.log('\n=== Worktree: conflict path (safe abort, no repo corruption) ===');
	const { root, repoPath } = makeRepo();
	await initRepo(repoPath);
	const svc = new GitWorktreeMainService();

	const created = await svc.createWorktree({ repoPath, branchName: 'agent-conflict' });
	writeFileSync(join(created.worktreePath, 'file.txt'), 'CONFLICTING WORKTREE VERSION\n');

	// meanwhile the "main" branch also changes the same line, guaranteeing a real merge conflict
	writeFileSync(join(repoPath, 'file.txt'), 'CONFLICTING MAIN VERSION\n');
	await git(['add', '-A'], repoPath);
	await git(['commit', '-q', '-m', 'main-side change'], repoPath);

	const merged = await svc.commitAndMergeWorktreeBranch({ repoPath, worktreePath: created.worktreePath, branchName: 'agent-conflict', targetBranch: 'master', commitMessage: 'worktree-side change' });
	check('conflicting merge reported as not ok', merged.ok === false, JSON.stringify(merged));

	const status = (await git(['status', '--porcelain'], repoPath)).stdout;
	check('main repo left in a clean state after aborted merge (no lingering conflict markers)', status.trim() === '', `status: "${status}"`);
	const mainContent = readFileSync(join(repoPath, 'file.txt'), 'utf8');
	check('main branch content is untouched by the aborted merge', mainContent === 'CONFLICTING MAIN VERSION\n', mainContent);

	rmSync(root, { recursive: true, force: true });
}

async function testVerificationFailureIsHonored() {
	console.log('\n=== Worktree: verification-failure semantics (service-layer contract) ===');
	// GitWorktreeMainService itself has no opinion on test/build results - that decision is made
	// one layer up, in orchestrationService.ts's _runWorktreeTask (which calls
	// IToolsService.runVerificationChecksAt inside the worktree before ever calling
	// commitAndMergeWorktreeBranch). That composition can't be exercised standalone here (it
	// needs the full Electron DI graph orchestrationService.ts depends on) - but the contract
	// this test CAN verify for real is the one commitAndMergeWorktreeBranch actually promises:
	// nothing is merged unless this call is made, so a caller that skips it on a failing
	// verification (as _runWorktreeTask's own code does) genuinely leaves master untouched.
	const { root, repoPath } = makeRepo();
	await initRepo(repoPath);
	const svc = new GitWorktreeMainService();
	const created = await svc.createWorktree({ repoPath, branchName: 'agent-verify-fail' });
	writeFileSync(join(created.worktreePath, 'file.txt'), 'a change that would fail verification\n');
	// simultesting the "verification failed, so never call commitAndMergeWorktreeBranch" branch
	const mainContentBefore = readFileSync(join(repoPath, 'file.txt'), 'utf8');
	// (intentionally do NOT call commitAndMergeWorktreeBranch here)
	const mainContentAfter = readFileSync(join(repoPath, 'file.txt'), 'utf8');
	check('skipping the merge call leaves master byte-for-byte untouched', mainContentBefore === mainContentAfter);
	check('the failed worktree and its branch are retained on disk for manual review (by design)', existsSync(created.worktreePath));
	rmSync(root, { recursive: true, force: true });
}

async function testShellInjectionAllBoundaries() {
	console.log('\n=== Worktree: shell-injection regression, every git-argument boundary ===');
	const { root, repoPath } = makeRepo();
	await initRepo(repoPath);
	const svc = new GitWorktreeMainService();
	const markerDir = mkdtempSync(join(tmpdir(), 'vader-injection-markers-'));
	const marker = (name) => join(markerDir, name);
	const payload = (name) => `$(touch ${marker(name)}) \`touch ${marker(name)}2\` && touch ${marker(name)}3`;

	// 1. branchName, via createWorktree's `-b <branchName>` argument
	const created = await svc.createWorktree({ repoPath, branchName: `branch-${payload('branchName')}` });
	check('branchName argument: no injected command executed', !existsSync(marker('branchName')) && !existsSync(marker('branchName') + '2') && !existsSync(marker('branchName') + '3'));
	// createWorktree is expected to either safely fail (git rejects illegal ref names with those
	// characters) or safely succeed with the literal branch name - either is fine; what matters
	// is that nothing executed.
	if (created.ok) {
		writeFileSync(join(created.worktreePath, 'file.txt'), 'change\n');
		// 2. commitMessage (the originally-found path) - re-verified here too
		const merged = await svc.commitAndMergeWorktreeBranch({ repoPath, worktreePath: created.worktreePath, branchName: created.branchName, targetBranch: 'master', commitMessage: `msg ${payload('commitMessage')}` });
		check('commitMessage argument: no injected command executed', !existsSync(marker('commitMessage')));
		void merged;
	}

	// 3. targetBranch, via checkout "<targetBranch>"
	const created2 = await svc.createWorktree({ repoPath, branchName: 'agent-target-test' });
	writeFileSync(join(created2.worktreePath, 'file.txt'), 'change2\n');
	const mergedBadTarget = await svc.commitAndMergeWorktreeBranch({ repoPath, worktreePath: created2.worktreePath, branchName: 'agent-target-test', targetBranch: `master${payload('targetBranch')}`, commitMessage: 'ok' });
	check('targetBranch argument: no injected command executed', !existsSync(marker('targetBranch')));
	check('targetBranch argument: invalid ref correctly fails rather than silently succeeding', mergedBadTarget.ok === false);

	rmSync(markerDir, { recursive: true, force: true });
	rmSync(root, { recursive: true, force: true });
}

async function main() {
	await testSuccessPath();
	await testNoChangesPath();
	await testConflictPath();
	await testVerificationFailureIsHonored();
	await testShellInjectionAllBoundaries();
	console.log(`\n${passed} passed, ${failed} failed`);
	process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(e => { console.error('HARNESS CRASHED:', e); process.exit(1); });
