#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The commands of the message box (common/slashCommands.ts): what is offered while typing, and what a typed line means.
// Run: node src/vs/workbench/contrib/vader/test/slashCommandsE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-slash-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/slashCommands.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 's.mjs'), logLevel: 'silent' });
const S = await import(pathToFileURL(path.join(tmp, 's.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const ids = (t) => (S.slashMatches(t) ?? []).map(c => c.id).join();

check('a bare slash offers every command, in the order of the board', ids('/') === 'plan,review,compact,remember,init');
check('typing narrows them by their first letters', ids('/re') === 'review,remember' && ids('/rev') === 'review' && ids('/c') === 'compact' && ids('/I') === 'init');
check('a command that does not exist offers nothing', S.slashMatches('/nope') === undefined && S.slashMatches('/plan2') === undefined);
check('text that does not begin with a slash is not a command', S.slashMatches('plan') === undefined && S.slashMatches(' /plan') === undefined && S.slashMatches('') === undefined);
check('a path is not a command', S.slashMatches('/usr/bin/env') === undefined && S.slashMatches('/src/app.ts') === undefined);
check('once a command that takes text has a space after it, only it is offered', ids('/remember use pnpm') === 'remember' && ids('/remember ') === 'remember');
check('a command that takes no text, followed by a word, is a sentence and not offered', S.slashMatches('/plan the migration') === undefined);
check('a whole line is parsed to its command and its text', S.parseSlash('/plan').command.id === 'plan' && S.parseSlash('  /compact  ').command.id === 'compact' && S.parseSlash('/remember use pnpm here').arg === 'use pnpm here' && S.parseSlash('/REMEMBER x').command.id === 'remember');
check('a sentence that starts with a command word is not one', S.parseSlash('/plan the migration') === undefined && S.parseSlash('/unknown') === undefined && S.parseSlash('plan') === undefined);
check('/remember with nothing after it parses with an empty note, so the chat can ask for one', S.parseSlash('/remember').arg === '');
check('a note is labelled by its first line, cut short', S.noteLabel('use pnpm\nnot npm') === 'use pnpm' && S.noteLabel('x'.repeat(100)).length === 60 && S.noteLabel('x'.repeat(100)).endsWith('…'));
check('/init asks for what was verified in the files, not for a guess', /verified in the files/.test(S.INIT_PROMPT) && /AGENTS\.md/.test(S.INIT_PROMPT));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
