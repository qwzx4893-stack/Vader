#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A task's own copy of the project (common/taskCopyModel.ts): names, paths, failures and the words on the cards.
// Run: node src/vs/workbench/contrib/vader/test/taskCopyModelE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-tcopy-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/taskCopyModel.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'm.mjs'), logLevel: 'silent' });
const M = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

// names
check('a branch is named from what was asked, with a short tail from the thread', M.branchNameFor('Add a rate limiter to the API', 'a1b2c3d4') === 'agent/rate-limiter-api-a1b2', M.branchNameFor('Add a rate limiter to the API', 'a1b2c3d4'));
check('a message with nothing to name it from still gets a safe branch', M.branchNameFor('???', 'zz') === 'agent/task-zz');
check('the branch name is one git takes (no spaces, dots at the start, or dashes first)', /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(M.branchNameFor('Fix: the "login" bug!! (urgent)', 'Q9-X')) && !M.branchNameFor('x  y', 'q').includes('..'));
check('the card shows the branch without its tail', M.branchLabel('agent/rate-limiter-a1b2') === 'agent/rate-limiter');

// paths
check('a path in the folder moves to the same place in the copy (Windows paths, any slashes)', M.remapPath('C:\\proj\\app\\src\\a.ts', 'C:\\proj\\app', 'C:\\proj\\.vader-worktrees\\agent-x') === 'C:\\proj\\.vader-worktrees\\agent-x\\src\\a.ts');
check('...and on POSIX', M.remapPath('/home/me/app/src/a.ts', '/home/me/app', '/home/me/.vader-worktrees/agent-x') === '/home/me/.vader-worktrees/agent-x/src/a.ts');
check('the folder itself moves to the copy root', M.remapPath('/home/me/app', '/home/me/app/', '/w/x/') === '/w/x');
check('a Windows drive letter is matched whatever its case', M.remapPath('c:/Proj/App/a.ts', 'C:\\proj\\app', 'D:\\w') === 'D:\\w\\a.ts');
check('a path outside the folder is left alone', M.remapPath('/etc/hosts', '/home/me/app', '/w') === '/etc/hosts');
check('a sibling folder with the same beginning is not inside', !M.isInside('/home/me/app-two/a.ts', '/home/me/app') && M.isInside('/home/me/app/a.ts', '/home/me/app'));
check('a path in the copy goes back to the folder', M.unmapPath('/w/x/src/a.ts', '/w/x', '/home/me/app') === '/home/me/app/src/a.ts');
check('commands and writes count as editing, reads do not', M.EDITING_TOOLS.has('edit_file') && M.EDITING_TOOLS.has('run_command') && !M.EDITING_TOOLS.has('read_file'));
check('the agent is told where its copy is and not to switch branches', M.copyInstructions('/w/x', 'agent/x-1').includes('/w/x') && M.copyInstructions('/w/x', 'agent/x-1').includes('do not run git commands that switch branches'));

// failures
{
	const reason = 'error: Your local changes to the following files would be overwritten by merge:\n\tserver/app.ts\n\tserver/limiter.ts\nPlease commit your changes or stash them before you merge.\nAborting';
	const c = M.classifyMergeFailure(reason);
	check('git refusing to overwrite local changes is not a conflict, and names the files', c.kind === 'local-changes' && c.files.join() === 'server/app.ts,server/limiter.ts', JSON.stringify(c));
}
check('any other failure is just a failure', M.classifyMergeFailure('fatal: refusing to merge unrelated histories').kind === 'other');
check('untracked files that would be overwritten are the same kind', M.classifyMergeFailure('error: The following untracked working tree files would be overwritten by merge:\n\tnotes.md\nAborting').kind === 'local-changes');

// words
const s = { branchName: 'agent/rate-limiter-a1b2', baseBranch: 'main', files: 3, conflictFiles: ['server/app.ts', 'server/limiter.ts'] };
{
	const w = M.ownCopyWords(s, 'vader-app');
	check('the own-copy card says branch, base, count and what it means', w.branch === 'agent/rate-limiter' && w.from === 'from main, 3 files' && w.body === 'The agent edits a copy of vader-app on its own branch. Your folder does not change until you accept.', JSON.stringify(w));
	check('one file is singular', M.ownCopyWords({ ...s, files: 1 }, 'x').from === 'from main, 1 file');
}
check('merged says where and that the copy is gone', M.mergedWords(s).title === 'Merged into main' && M.mergedWords(s).body === 'agent/rate-limiter was merged into main without conflicts. The copy was removed.');
{
	const w = M.conflictWords(s);
	check('a conflict names both files and offers three ways out', w.title === 'This task conflicts with main' && w.body === 'Both changed server/app.ts and server/limiter.ts.' && w.keepMine === 'Keep my version' && w.askAgent === 'Ask an agent to merge');
	check('many conflicted files are counted after three', M.conflictWords({ ...s, conflictFiles: ['a', 'b', 'c', 'd', 'e'] }).body === 'Both changed a, b, c and 2 more.');
}
{
	const f = M.mergeFailedWords({ ...s, failure: { kind: 'local-changes', reason: '', files: ['server/app.ts'] } });
	check('a merge stopped by local changes says so and offers to stash', f.title === 'Could not merge agent/rate-limiter' && f.body === 'git said: your local changes to server/app.ts would be overwritten. This is not a conflict between tasks.' && f.retry === 'Stash my changes and retry');
	check('another failure says nothing was merged and offers to try again', M.mergeFailedWords({ ...s, failure: { kind: 'other', reason: 'x', files: [] } }).retry === 'Try again');
}
check('discard says exactly what disappears', M.discardWords(s).body === 'agent/rate-limiter and its 3 changed files will be deleted. Your folder is not touched.' && M.discardWords({ ...s, files: 1 }).body.includes('its 1 changed file will'));
check('uncommitted changes say that the task will not see them', M.dirtyWords(4, 'vader-app').body === '4 files in vader-app are changed. The task starts from the last commit, so it will not see them.' && M.dirtyWords(1, 'x').body.includes('is changed') && M.dirtyWords(1, 'x').body.endsWith('see it.'));
check('a folder that is not a git project offers the fix and the way out', M.notGitWords().start === 'Start git here' && M.notGitWords().useChat === 'Use Chat');
check('an agent merge says what is merged into what', M.agentMergingWords(s).title === 'Merging main into agent/rate-limiter' && M.agentMergingWords(s).footer === 'You review the result before it reaches main.');
check('progress rows say resolved or resolving per file', JSON.stringify(M.mergeProgressRows(['a', 'b'], ['a'])) === JSON.stringify([{ name: 'a', state: 'resolved' }, { name: 'b', state: 'resolving' }]));
check('files are counted from a diff stat', M.filesInDiffStat(' a.ts | 2 +-\n b.ts | 1 +\n 2 files changed, 2 insertions(+), 1 deletion(-)') === 2 && M.filesInDiffStat(' a.ts | 2 +-\n b.ts | 1 +') === 2 && M.filesInDiffStat('') === 0);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
