#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What the chat says when a connected agent needs its sign-in or stops (common/externalAgentWords.ts).
// Run: node src/vs/workbench/contrib/vader/test/externalAgentWordsE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-agentwords-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/externalAgentWords.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'a.mjs'), logLevel: 'silent' });
const A = await import(pathToFileURL(path.join(tmp, 'a.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

{
	const c = A.cardForAgentError('Codex needs you to sign in. A terminal opened for it: finish the sign-in there, then send your message again.', 'Codex');
	check('a sign-in that is needed names the agent and says Vader does not ask for the password', c && c.title === 'Codex is not signed in' && c.text.includes('Vader does not ask for that password.') && c.againLabel === 'I signed in', JSON.stringify(c));
}
{
	const c = A.cardForAgentError('The agent stopped by itself (exit code 1).\nsome output', 'Codex');
	check('a program that stopped says how, and that the chat is kept', c && c.title === 'Codex closed unexpectedly' && c.text === 'Its process exited with code 1. The chat so far is kept.' && c.againLabel === 'Start it again', JSON.stringify(c));
}
check('a signal is said as such', A.cardForAgentError('The agent stopped by itself (SIGKILL).', 'Codex').text === 'Its process was ended by SIGKILL. The chat so far is kept.');
check('without a chosen agent it is still said', A.cardForAgentError('The agent stopped by itself (exit code 2).', undefined).title === 'The agent closed unexpectedly');
check('any other error is left to the general card', A.cardForAgentError('rate limit', 'Codex') === null && A.cardForAgentError('', 'Codex') === null);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
