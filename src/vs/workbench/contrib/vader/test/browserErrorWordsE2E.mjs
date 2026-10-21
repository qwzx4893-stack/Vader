#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What the chat says when the agent's browser fails (common/browserErrorWords.ts).
// Run: node src/vs/workbench/contrib/vader/test/browserErrorWordsE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-browserwords-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/browserErrorWords.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'b.mjs'), logLevel: 'silent' });
const B = await import(pathToFileURL(path.join(tmp, 'b.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

check('a closed or crashed page says the agent opens a new one', B.explainBrowserError('Browser page "p1" is closed (it may have crashed or been closed by the site itself) - open a new one with browser_new_page.').title === 'The page stopped responding');
check('a reference that went stale says the page changed', B.explainBrowserError('This element reference is no longer valid - the page likely navigated, reloaded, or changed since your last snapshot. Call browser_snapshot again (original error: x)').title === 'The page changed under the agent');
{
	const w = B.explainBrowserError('page.goto: Timeout 30000ms exceeded.\nCall log: navigating to "http://localhost:5173"');
	check('a page that did not load names the real wait', w && w.title === 'The page did not load in time' && w.text.includes('up to 30 seconds'), JSON.stringify(w));
}
check('a click that timed out is not called a page that did not load', B.explainBrowserError('locator.click: Timeout 10000ms exceeded.') === null);
check('anything else gets no words, only its own message', B.explainBrowserError('net::ERR_CONNECTION_REFUSED') === null && B.explainBrowserError('') === null);

// ---- a field the agent must not type into
check('a password field is a secret', B.isSecretField({ type: 'password' }) && B.isSecretField({ type: 'PASSWORD' }));
check('a one-time code, a card number and its security code are secrets by what the page says they are', B.isSecretField({ type: 'text', autocomplete: 'one-time-code' }) && B.isSecretField({ type: 'text', autocomplete: 'cc-number' }) && B.isSecretField({ type: 'text', autocomplete: 'section-pay cc-csc' }));
check('a field named like a password is one, whatever its type', B.isSecretField({ type: 'text', name: 'user_password' }) && B.isSecretField({ type: 'text', label: 'Security code' }) && B.isSecretField({ type: 'text', id: 'cvv' }) && B.isSecretField({ type: 'text', label: 'Card number' }));
check('an ordinary field is not', !B.isSecretField({ type: 'text', name: 'email', autocomplete: 'email', label: 'Email address' }) && !B.isSecretField({ type: 'search', name: 'q' }) && !B.isSecretField({}));
check('a refusal to type into one is explained as a sign-in page, with the agent not entering a password', B.explainBrowserError(B.SECRET_FIELD_REFUSAL)?.title === 'This page asks you to sign in' && B.explainBrowserError(B.SECRET_FIELD_REFUSAL).text === 'The agent will not enter a password. Sign in yourself, then let it go on.');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
