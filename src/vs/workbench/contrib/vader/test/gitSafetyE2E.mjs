#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A folder with a prepared .git/config (core.fsmonitor, diff.external, a hook, gpg.program) must not be able to run a program when Vader runs git by
// itself. Builds such a repository, shows that plain git DOES run the programs (so the test is meaningful), then runs the same commands with
// electron-main/safeGit.ts's arguments, which must run none of them.
// Run: node src/vs/workbench/contrib/vader/test/gitSafetyE2E.mjs

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-gitsafe-'));
await esbuild.build({ entryPoints: [path.join(here, '../electron-main/safeGit.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(tmp, 's.cjs'), logLevel: 'silent' });
const { safeGitConfigArgs, SAFE_DIFF_FLAGS } = require(path.join(tmp, 's.cjs'));

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
if (process.platform === 'win32') { console.log('PASS: (marker programs use sh; nothing to test on Windows runners)'); process.exit(0); }

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_TERMINAL_PROMPT: '0' };
const git = (cwd, args) => { try { return execFileSync('git', args, { cwd, env, stdio: 'pipe' }).toString(); } catch (e) { return String(e.stdout ?? ''); } };

function hostileRepo(label) {
	const dir = fs.mkdtempSync(path.join(tmp, `repo-${label}-`));
	git(dir, ['init', '-q']); fs.writeFileSync(path.join(dir, 'f'), 'a\n'); git(dir, ['add', 'f']); git(dir, ['commit', '-qm', 'init']);
	fs.writeFileSync(path.join(dir, 'f'), 'a\nb\n');
	const marker = (n) => path.join(dir, `PWNED_${n}`);
	// git's config syntax eats quotes, so each "program" is a small script file
	const script = (n) => { const f = path.join(dir, '.git', `evil-${n}.sh`); fs.writeFileSync(f, `#!/bin/sh\ntouch '${marker(n)}'\necho\n`, { mode: 0o755 }); return f; };
	fs.writeFileSync(path.join(dir, '.git', 'config'), fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8') +
		`[core]\n\tfsmonitor = ${script('fsmonitor')}\n[diff]\n\texternal = ${script('extdiff')}\n[gpg]\n\tprogram = ${script('gpg')}\n[commit]\n\tgpgsign = true\n`);
	fs.mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true });
	for (const h of ['pre-commit', 'post-commit', 'post-checkout', 'commit-msg', 'prepare-commit-msg', 'post-merge']) {
		fs.writeFileSync(path.join(dir, '.git', 'hooks', h), `#!/bin/sh\ntouch '${marker('hook-' + h)}'\n`, { mode: 0o755 });
	}
	return { dir, pwned: () => fs.readdirSync(dir).filter(f => f.startsWith('PWNED_')) };
}

const commands = [
	['diff', '--stat'], ['diff', '--unified=0', '--no-color', '--', 'f'], ['diff', '--numstat', '-z'], ['diff', '--staged', '--name-only'],
	['status', '--porcelain'], ['branch', '--show-current'], ['log', '--pretty=format:%h', '-n', '5'],
];

// the control: plain git runs the repository's programs
{
	const r = hostileRepo('control');
	for (const c of commands) git(r.dir, c);
	check('control: plain git in such a repository DOES run programs from its config', r.pwned().length > 0, 'the test repository is not hostile enough, so the checks below prove nothing');
}

// Vader's wrapper: none of the read commands starts a program
{
	const r = hostileRepo('safe-read');
	const isDiff = (c) => c[0] === 'diff';
	for (const c of commands) git(r.dir, [...safeGitConfigArgs(), c[0], ...(isDiff(c) ? SAFE_DIFF_FLAGS : []), ...c.slice(1)]);
	check('Vader git read commands start no program from the repository config', r.pwned().length === 0, r.pwned().join(', '));
}

// worktree + commit + merge: neither hooks nor gpg.program run
{
	const r = hostileRepo('safe-write');
	const wt = path.join(tmp, 'wt-' + Date.now());
	git(r.dir, [...safeGitConfigArgs(), 'worktree', 'add', '-b', 'agent-x', wt]);
	check('the worktree was created', fs.existsSync(wt));
	fs.writeFileSync(path.join(wt, 'new.txt'), 'x');
	git(wt, [...safeGitConfigArgs(), 'add', '-A']);
	git(wt, [...safeGitConfigArgs(), 'commit', '-m', 'agent work']);
	git(r.dir, [...safeGitConfigArgs(), 'merge', '--no-ff', 'agent-x', '-m', 'merge']);
	const log = git(r.dir, [...safeGitConfigArgs(), 'log', '--oneline']);
	check('the commit really happened (the arguments do not break git)', /agent work/.test(log), log);
	check('creating a worktree, committing and merging start no hook and no gpg program', r.pwned().length === 0 && fs.readdirSync(wt).filter(f => f.startsWith('PWNED_')).length === 0, r.pwned().join(', '));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
