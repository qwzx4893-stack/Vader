#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What the MCP page says about a server that did not start (common/mcpStateWords.ts).
// Run: node src/vs/workbench/contrib/vader/test/mcpStateWordsE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-mcpwords-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/mcpStateWords.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'm.mjs'), logLevel: 'silent' });
const M = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

check('the program is the first word of the command, without its folder or extension', M.executableOf('npx -y @github/mcp') === 'npx' && M.executableOf('C:/nodejs/NPX.cmd x') === 'npx' && M.executableOf('/usr/bin/python3 server.py') === 'python3' && M.executableOf('') === undefined && M.executableOf(undefined) === undefined);
{
	const w = M.explainStart('Playwright', 'npx @playwright/mcp', 'spawn npx ENOENT');
	check('a program that is not found is named, with what to install', w.title === 'Playwright did not start' && w.text === '`npx` was not found. Install Node.js, or give the full path to it.', w.text);
}
check('the same for the other runners', M.explainStart('x', 'uvx tool', 'spawn uvx ENOENT').text.includes('Install uv') && M.explainStart('x', 'docker run y', "'docker' is not recognized as an internal or external command").text.includes('Install Docker'));
check('a program that is not a known runner is still named', M.explainStart('x', 'acme-server --stdio', 'spawn acme-server ENOENT').text === '`acme-server` was not found. Install it, or give the full path to it.');
check('a timeout says the first start can be slow', /first start can take a moment/.test(M.explainStart('x', 'npx a', 'Connection timed out after 30000ms').text));
check('a refused key says to check it', /refused the key or token/.test(M.explainStart('x', undefined, 'HTTP 401 Unauthorized').text) && /refused the key or token/.test(M.explainStart('x', undefined, 'Bad credentials').text));
check('a program that may not run says so', /did not allow/.test(M.explainStart('x', 'a', 'spawn a EACCES').text));
check('an address that cannot be reached says so', /could not be reached/.test(M.explainStart('x', undefined, 'getaddrinfo ENOTFOUND example.invalid').text));
check('an error that is not recognised is not guessed at', M.explainStart('x', 'a', 'Segmentation fault').text === 'It stopped when it was started. The error it gave is below.');
check('the starting hint is only for programs that download', M.startingHint('npx -y x') !== undefined && M.startingHint('uvx x') !== undefined && M.startingHint('docker run y') !== undefined && M.startingHint('node server.js') === undefined && M.startingHint(undefined) === undefined);
check('the tools line says the gate is in front of every use', M.toolsLine(4) === '4 tools. Each use goes through the safety gate.' && M.toolsLine(1) === '1 tool. Each use goes through the safety gate.');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
