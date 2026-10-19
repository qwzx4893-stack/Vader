#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Settings set by an organisation (common/managedSettings.ts): the file, what is accepted, what is ignored, and the words.
// Run: node src/vs/workbench/contrib/vader/test/managedSettingsE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-managed-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/managedSettings.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'm.mjs'), logLevel: 'silent' });
const M = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

check('the file is looked for where only an administrator can write', M.managedSettingsPath('win32', { programData: 'D:\\PD\\' }) === 'D:\\PD\\Vader\\managed-settings.json' && M.managedSettingsPath('win32') === 'C:\\ProgramData\\Vader\\managed-settings.json' && M.managedSettingsPath('darwin') === '/Library/Application Support/Vader/managed-settings.json' && M.managedSettingsPath('linux') === '/etc/vader/managed-settings.json');
{
	const r = M.parseManagedSettings(JSON.stringify({ locked: { autoCheckUpdates: false, taskCopies: true, dailySpendLimitUsd: 5, priceDiscountPercent: 10 } }));
	check('switches and numbers are taken as they are', r.locked.autoCheckUpdates === false && r.locked.taskCopies === true && r.locked.dailySpendLimitUsd === 5 && r.locked.priceDiscountPercent === 10 && r.ignored.length === 0, JSON.stringify(r));
}
check('a limit can be locked to none', M.parseManagedSettings('{"locked":{"dailySpendLimitUsd":null}}').locked.dailySpendLimitUsd === null);
{
	const r = M.parseManagedSettings(JSON.stringify({ locked: { autoCheckUpdates: 'no', nonsense: true, taskCopies: false, autoApprove: { edits: true }, dailySpendLimitUsd: 'x' } }));
	check('a value of the wrong kind, an unknown setting and a setting made of parts are ignored one by one, and the rest still applies', r.locked.taskCopies === false && Object.keys(r.locked).length === 1 && r.ignored.length === 4, JSON.stringify(r));
}
check('a file that is not JSON locks nothing and says why', Object.keys(M.parseManagedSettings('{ nope').locked).length === 0 && M.parseManagedSettings('{ nope').ignored[0].includes('not valid JSON'));
check('a file without a locked section locks nothing', Object.keys(M.parseManagedSettings('{"other":1}').locked).length === 0 && Object.keys(M.parseManagedSettings('[]').locked).length === 0);
check('a number that is not finite is not a number', Object.keys(M.parseManagedSettings('{"locked":{"priceDiscountPercent":1e999}}').locked).length === 0);
check('the words under a locked setting say what it is set to, and who set it', M.lockedDetail(false) === 'Set to off by your organisation' && M.lockedDetail(true) === 'Set to on by your organisation' && M.lockedDetail(5) === 'Set to 5 by your organisation' && M.lockedDetail(null) === 'Set to none by your organisation' && M.LOCKED_NOTE === 'Ask the person who manages Vader for your team to change it.');
{
	const user = { autoCheckUpdates: true, taskCopies: false, chatMode: 'agent' };
	const out = M.withManaged(user, { autoCheckUpdates: false });
	check('the stored settings are the person\u2019s with each locked one at the organisation\u2019s value', out.autoCheckUpdates === false && out.taskCopies === false && out.chatMode === 'agent' && user.autoCheckUpdates === true);
}

console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
