#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The backup file and its restore (common/backupModel.ts).
// Run: node src/vs/workbench/contrib/vader/test/backupModelE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-backup-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/backupModel.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'b.mjs'), logLevel: 'silent' });
const B = await import(pathToFileURL(path.join(tmp, 'b.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

const chat = (id) => ({ id, messages: [{ role: 'user', content: 'x' }] });
const when = new Date('2026-10-19T10:00:00Z');
const made = B.buildBackup({ chats: { a: chat('a'), b: chat('b'), c: chat('c') }, agents: [{ name: 'Reviewer', instructions: 'x' }, { name: 'Docs writer' }, { name: 'Researcher' }], rules: [{ description: 'asks before installs', effect: 'ask', kinds: ['terminal-command'] }], settings: { globalSettings: {} } }, when);
const text = JSON.stringify(made);

check('the file is named for the day', B.backupFileName(when) === 'vader-backup-2026-10-19.json');
{
	const p = B.parseBackup(text);
	check('what was written reads back', p.ok && Object.keys(p.backup.chats).length === 3 && p.backup.agents.length === 3 && p.backup.rules.length === 1 && p.backup.createdAt === '2026-10-19T10:00:00.000Z');
}
check('a file that is not JSON is said not to be a backup', B.parseBackup('not json').reason.startsWith('It is not a backup file'));
check('JSON that is not a backup is refused', B.parseBackup('{"a":1}').reason === 'It is not a Vader backup.' && B.parseBackup('[]').reason === 'It is not a Vader backup.' && B.parseBackup('null').reason === 'It is not a Vader backup.');
check('a backup from a newer Vader says to update', /newer Vader/.test(B.parseBackup(JSON.stringify({ ...made, version: 2 })).reason) && /not one this Vader knows/.test(B.parseBackup(JSON.stringify({ ...made, version: 'x' })).reason));
{
	const p = B.parseBackup(JSON.stringify({ ...made, chats: { a: chat('a'), bad: { id: 5 }, worse: 'x' }, agents: [{ name: 'ok' }, { nope: 1 }, 'x'], rules: [{ description: 'r', effect: 'ask', kinds: [] }, { description: 'bad', effect: 'allow', kinds: [] }] }));
	check('pieces that are not what they should be are left out, the rest is kept', p.ok && Object.keys(p.backup.chats).join() === 'a' && p.backup.agents.length === 1 && p.backup.rules.length === 1);
}
{
	const plan = B.planRestore(B.parseBackup(text).backup, { chatIds: new Set(['b']), agentNames: new Set(['Reviewer']), ruleDescriptions: new Set() });
	check('only what is not here is added, what is here is kept', plan.addChatIds.join() === 'a,c' && plan.keptChats === 1 && plan.addAgents.map(a => a.name).join() === 'Docs writer,Researcher' && plan.keptAgents === 1 && plan.addRules.length === 1 && plan.keptRules === 0);
	const w = B.restoreWords(plan, 'vader-backup.json');
	check('the question says what will be added and what stays, and that nothing is overwritten', w.title === 'Restore from vader-backup.json?' && w.text === '2 chats, 2 saved agents and 1 rule will be added. 1 chat, 1 saved agent that are already here are kept as they are. Nothing here is overwritten.' && !w.nothing, w.text);
}
{
	const same = B.planRestore(B.parseBackup(text).backup, { chatIds: new Set(['a', 'b', 'c']), agentNames: new Set(['Reviewer', 'Docs writer', 'Researcher']), ruleDescriptions: new Set(['asks before installs']) });
	const w = B.restoreWords(same, 'f.json');
	check('a backup that is already all here says so and adds nothing', w.nothing && w.text === 'Everything in it is already here, so nothing would be added.');
	check('an empty backup says there is nothing in it', B.restoreWords(B.planRestore(B.parseBackup(JSON.stringify(B.buildBackup({ chats: {}, agents: [], rules: [], settings: {} }, when))).backup, { chatIds: new Set(), agentNames: new Set(), ruleDescriptions: new Set() }), 'f.json').text === 'There is nothing in it to restore.');
}
check('one chat added reads right', B.restoreWords({ addChatIds: ['a'], keptChats: 0, addAgents: [], keptAgents: 0, addRules: [], keptRules: 0 }, 'f').text === '1 chat will be added. Nothing here is overwritten.');
check('the backup says what is in it and what is not', B.BACKUP_TITLE === 'Back up your data' && B.BACKUP_TEXT.includes('Not included: API keys and the contents of your projects.'));
check('deleting says how many, that it cannot be undone and what stays', B.deleteChatsWords(24).title === 'Delete all 24 chats?' && B.deleteChatsWords(1).title === 'Delete this chat?' && B.deleteChatsWords(24).text === 'This cannot be undone. Saved agents, rules and settings stay.');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
