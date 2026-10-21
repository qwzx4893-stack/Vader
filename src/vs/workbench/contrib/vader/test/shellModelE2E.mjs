#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What the sidebar and All agents say about a conversation, and what the review page shows of a change: the rules, without the editor.
// Run: node src/vs/workbench/contrib/vader/test/shellModelE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-shellmodel-'));
const load = async (rel, name) => {
	await esbuild.build({ entryPoints: [path.join(here, rel)], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, name), logLevel: 'silent' });
	return import(pathToFileURL(path.join(tmp, name)).href);
};
const M = await load('../common/shellModel.ts', 'm.mjs');
const R = await load('../common/reviewModel.ts', 'r.mjs');

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

// ---- names and ages
const u = (t) => ({ role: 'user', displayContent: t });
check('a conversation is named by the first thing said, on one line', M.threadTitle({ messages: [{ role: 'assistant', displayContent: 'hi' }, u('  Fix the\n  broken   link check ')] }) === 'Fix the broken link check');
check('a long first message is cut with an ellipsis', M.threadTitle({ messages: [u('x'.repeat(200))] }).length === 80 && M.threadTitle({ messages: [u('x'.repeat(200))] }).endsWith('\u2026'));
check('a name the person gave wins, and an empty conversation is "New chat"', M.threadTitle({ messages: [u('a')], customTitle: ' Mine ' }) === 'Mine' && M.threadTitle({ messages: [] }) === 'New chat');
const now = Date.parse('2026-10-14T12:30:00Z');
const ago = (m) => new Date(now - m * 60000).toISOString();
check('ages read 2m, 14m, 1h', M.ageLabel(ago(2), now) === '2m' && M.ageLabel(ago(14), now) === '14m' && M.ageLabel(ago(60), now) === '1h' && M.ageLabel(ago(0), now) === 'now');
check('older than a day is the weekday, older than a week the date', M.ageLabel(ago(60 * 30), now) === 'Tue' && M.ageLabel(ago(60 * 24 * 12), now) === 'Oct 2', M.ageLabel(ago(60 * 30), now) + '/' + M.ageLabel(ago(60 * 24 * 12), now));
check('a bad date gives nothing', M.ageLabel('nope', now) === '');

// ---- what a conversation is
const tool = (name, type = 'success', params = {}, result = null) => ({ role: 'tool', name, type, params, result });
check('using a tool makes a conversation an agent task; plain talk is a chat', M.isAgentTask({ messages: [u('a'), tool('read_file')] }) === true && M.isAgentTask({ messages: [u('a'), { role: 'assistant' }] }) === false);
check('a conversation with a saved agent is a task even before a tool runs', M.isAgentTask({ messages: [u('a')], agentId: 'reviewer' }) === true);
check('hidden and empty conversations are not listed', M.isListed({ messages: [u('a')] }) && !M.isListed({ messages: [] }) && !M.isListed({ messages: [u('a')], isSubagentThread: true }) && !M.isListed({ messages: [u('a')], isVerificationThread: true }));
check('the files changed are the ones an edit finished on, once each', JSON.stringify(M.changedFilePaths([tool('edit_file', 'success', { uri: { fsPath: 'a.ts' } }), tool('edit_file', 'success', { uri: { fsPath: 'a.ts' } }), tool('rewrite_file', 'success', { uri: { fsPath: 'b.ts' } }), tool('edit_file', 'rejected', { uri: { fsPath: 'c.ts' } }), tool('read_file', 'success', { uri: { fsPath: 'd.ts' } })])) === '["a.ts","b.ts"]');

// ---- where it stands, for the table
check('waiting and failed go under Needs you, working and paused under Running', M.agentGroupOf('needs_you') === 'needs_you' && M.agentGroupOf('error') === 'needs_you' && M.agentGroupOf('running') === 'running' && M.agentGroupOf('paused') === 'running');
check('changes to read go under Ready to review, the rest is finished', M.agentGroupOf('review') === 'review' && M.agentGroupOf('idle') === 'merged');
check('each state has a mark in a list', M.glyphOf('running') === 'running' && M.glyphOf('needs_you') === 'needs_you' && M.glyphOf('idle') === 'none');

// ---- the plan and the latest actions
const list = '[x] Find why the cut runs first\n[~] Write contextBudget.ts\n[ ] Add a test';
const plan = M.latestTaskList([u('go'), tool('update_task_list', 'success', {}, { text: '[ ] one' }), tool('edit_file'), tool('update_task_list', 'success', {}, { text: list, total: 3, done: 1 })]);
check('the plan is the last list the agent wrote', plan && plan.total === 3 && plan.done === 1 && plan.tasks[1].status === 'in_progress');
check('no list written means no plan', M.latestTaskList([u('go'), tool('read_file')]) === undefined);
const acts = M.recentActivity([tool('read_file', 'success', { uri: { fsPath: 'C:\\p\\a.ts' } }), tool('edit_file', 'success', { uri: { fsPath: 'C:\\p\\contextBudget.ts' } }), tool('run_command', 'tool_request', { command: 'node t.mjs' })], 3);
check('the latest actions read as a verb and a short target, oldest first', JSON.stringify(acts) === '[{"verb":"Read","target":"a.ts"},{"verb":"Edited","target":"contextBudget.ts"},{"verb":"Ran","target":"node t.mjs"}]', JSON.stringify(acts));
check('the task list itself is not listed as an action', M.recentActivity([tool('update_task_list', 'success', {}, { text: list })], 3).length === 0);

// ---- the review page
const ed = (code, start, orig, ostart) => ({ type: 'edit', code, startLine: start, originalCode: orig, originalStartLine: ostart });
check('an edit counts the lines it added and removed', JSON.stringify(R.diffCounts(ed('a\nb\nc', 10, 'x', 10))) === '{"added":3,"removed":1}');
check('an insertion only adds and a deletion only removes', R.diffCounts({ type: 'insertion', code: 'a\nb', startLine: 1, originalStartLine: 1 }).removed === 0 && R.diffCounts({ type: 'deletion', originalCode: 'a\nb\nc', originalStartLine: 5, startLine: 5 }).added === 0);
check('a file adds up its changes', JSON.stringify(R.fileCounts([ed('a', 1, 'x', 1), { type: 'insertion', code: 'q\nr', startLine: 9, originalStartLine: 9 }])) === '{"added":3,"removed":1}');
const file = ['l1', 'l2', 'l3', 'NEW A', 'NEW B', 'l6', 'l7', 'l8'];
const rows = R.hunkRows(ed('NEW A\nNEW B', 4, 'old', 4), file, 2);
check('a change shows two lines before, what went, what came, two lines after', rows.map(r => r.kind[0] + r.n).join(' ') === 'c2 c3 d4 a4 a5 c6 c7', rows.map(r => r.kind[0] + r.n).join(' '));
check('lines around a change at the top or bottom of the file are not invented', R.hunkRows(ed('X', 1, 'y', 1), ['X', 'b'], 3).map(r => r.kind[0] + r.n).join(' ') === 'd1 a1 c2');
check('a big change and a lock file are folded, a small one is not', R.isFolded('src/a.ts', 500) && R.isFolded('package-lock.json', 3) && R.isFolded('src/generated/schema.ts', 3) && !R.isFolded('src/a.ts', 40));
const groups = R.groupByFolder([{ path: 'C:\\work\\app\\browser\\a.ts' }, { path: 'C:\\work\\app\\browser\\b.ts' }, { path: 'C:\\work\\app\\common\\c.ts' }, { path: 'C:\\work\\app\\README.md' }], 'c:/work/app');
check('changed files are grouped by folder, relative to the project', groups.map(g => `${g.folder || '.'}:${g.files.length}`).join(' ') === 'browser:2 common:1 .:1', groups.map(g => g.folder).join('|'));
check('a path inside the project is written relative, one outside is kept', R.relativePath('C:\\work\\app\\src\\a.ts', 'C:\\work\\app') === 'src/a.ts' && R.relativePath('D:\\x\\y.ts', 'C:\\work\\app') === 'D:/x/y.ts');
check('a GitHub remote gives the pull request page of the branch', R.pullRequestPageUrl('https://github.com/qwzx4893-stack/Vader.git', 'agent/rate-limiter') === 'https://github.com/qwzx4893-stack/Vader/compare/agent/rate-limiter?expand=1' && R.pullRequestPageUrl('git@github.com:me/app.git', 'fix') === 'https://github.com/me/app/compare/fix?expand=1');
check('another host, no remote or no branch gives no page', R.pullRequestPageUrl('https://gitlab.com/a/b.git', 'x') === undefined && R.pullRequestPageUrl('', 'x') === undefined && R.pullRequestPageUrl('https://github.com/a/b', '') === undefined);
check('the commit button says what it will commit', R.commitSummary(3, 112, 6) === '3 changed files, +112 \u22126' && R.commitSummary(1, 2, 0) === '1 changed file, +2 \u22120' && R.commitSummary(0, 0, 0) === 'No changes to commit');

// ---- a command the agent stopped waiting for is still running
{
	const act = M.terminalActivity([tool('open_persistent_terminal', 'success', {}, { persistentTerminalId: '1' }), tool('run_persistent_command', 'success', { command: 'npm run dev', persistentTerminalId: '1' }, { result: 'ready', resolveReason: { type: 'timeout' } }), tool('run_persistent_command', 'success', { command: 'echo hi', persistentTerminalId: '1' }, { result: 'hi', resolveReason: { type: 'done', exitCode: 0 } })]);
	check('a persistent command that timed out is running, one that ended is done', act.terminals[0].runs[0].status === 'running' && act.terminals[0].runs[1].status === 'done' && act.ran === 2);
}

// ---- what a terminal is called, and what it says about itself
{
	const L = (...cmds) => M.terminalLabel(cmds.map(command => ({ command })));
	check('a terminal is called by what runs in it', L('npm run dev') === 'dev server' && L('npm test') === 'tests' && L('npm run build') === 'build' && L('pnpm install') === 'install' && L('npx eslint .') === 'checks' && L('git status') === 'git', [L('npm run dev'), L('npm test'), L('npm run build'), L('pnpm install'), L('npx eslint .'), L('git status')].join('|'));
	check('a command it does not know is called by its program, and an empty terminal has no name', L('python3 script.py') === 'python3' && L('C:\\tools\\mytool.exe --flag') === 'mytool' && M.terminalLabel([]) === undefined && L('') === undefined, [L('python3 script.py'), L('C:\\tools\\mytool.exe --flag')].join('|'));
	const R = (status, exitCode) => [{ command: 'x', status, exitCode }];
	check('the note says whether it is kept open or how it ended', M.terminalNote([]) === 'kept open by the agent' && M.terminalNote(R('running')) === 'running, kept open by the agent' && M.terminalNote(R('done', 0)) === 'finished, exit 0' && M.terminalNote(R('failed', 2)) === 'failed, exit 2' && M.terminalNote(R('waiting')) === 'waiting for you to allow it' && M.terminalNote(R('rejected')) === 'you rejected the last command');
}

// ---- the helpers a task started
{
	const subs = M.subAgents([
		tool('delegate_research_task', 'success', { task: 'How the summary is measured' }, { threadId: 'a', conclusion: 'x', changedFilePaths: [], stalledAwaitingApproval: false, hadError: false }),
		tool('run_verification_agent', 'running_now', { objective: 'Check the result' }),
		tool('delegate_subagent_task', 'success', { task: 'Write the tests', agentName: 'Reviewer' }, { threadId: 'b', conclusion: 'x', changedFilePaths: [], stalledAwaitingApproval: false, hadError: true }),
		tool('delegate_parallel_tasks', 'success', { specs: [{ task: 'Probe cloud', agentName: null, usesWorktree: true }, { task: 'Probe local', agentName: 'Researcher', usesWorktree: false }] }),
		tool('delegate_browser_task', 'rejected', { task: 'never ran' }),
		tool('read_file', 'success', { uri: { fsPath: 'C:\\p\\a.ts' } }),
	]);
	check('each helper the agent started is listed, in order, with its kind', subs.map(s => `${s.kind}:${s.label}`).join('|') === 'research:How the summary is measured|verify:Check the result|Reviewer:Write the tests|parallel:Probe cloud|Researcher:Probe local', subs.map(s => `${s.kind}:${s.label}`).join('|'));
	check('what is still working says so, what ended with an error says so, the rest is done', subs.map(s => s.state).join(',') === 'done,running,failed,done,done');
	check('a helper the person refused is not listed, nor is any other tool', !subs.some(s => s.label === 'never ran'));
	check('a long task is cut to one line', M.subAgents([tool('delegate_research_task', 'success', { task: 'x'.repeat(200) })])[0].label.length <= 70);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
