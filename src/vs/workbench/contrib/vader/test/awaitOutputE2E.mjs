#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Waiting for a background terminal (common/awaitOutput.ts), with a pretend terminal and a pretend clock.
// Run: node src/vs/workbench/contrib/vader/test/awaitOutputE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-await-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/awaitOutput.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'm.mjs'), logLevel: 'silent' });
const A = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

/** a terminal that prints `script` lines at given times, on a clock that only moves when the wait sleeps */
const world = (initial, script) => {
	let t = 0, text = initial;
	return { io: { read: async () => { for (const [at, add] of script) if (t >= at && !add.done) { text += add.text; add.done = true; } return text; }, sleep: async (ms) => { t += ms; }, now: () => t }, at: () => t };
};
const line = (at, text) => [at, { text }];

{
	const w = world('$ npm run dev\n', [line(2000, 'compiling...\n'), line(3000, 'ready - started server on http://localhost:3000\n')]);
	const r = await A.awaitOutput(w.io, { re: /ready - started server on (\S+)/, timeoutMs: 30000 });
	check('it returns when the pattern appears, with what was printed since', r.reason === 'matched' && r.match.includes('localhost:3000') && r.output.includes('compiling') && !r.output.includes('npm run dev'), JSON.stringify(r));
	check('and does not wait the whole time', r.waitedMs <= 3600, String(r.waitedMs));
}
{
	const w = world('ready - started earlier\n', []);
	const r = await A.awaitOutput(w.io, { re: /ready/, timeoutMs: 3000 });
	check('a message that was already there does not end the wait', r.reason === 'timeout' && r.output === '', JSON.stringify(r));
}
{
	const w = world('', [line(1000, 'building 1/3\n'), line(2000, 'building 2/3\n'), line(3000, 'built in 3s\n')]);
	const r = await A.awaitOutput(w.io, { timeoutMs: 60000 });
	check('without a pattern it returns when the output has been quiet for five seconds', r.reason === 'quiet' && r.output.includes('built in 3s') && r.waitedMs >= 8000 && r.waitedMs < 9500, JSON.stringify(r));
}
{
	const w = world('', []);
	const r = await A.awaitOutput(w.io, { timeoutMs: 6000 });
	check('a terminal that prints nothing is a timeout, not "quiet"', r.reason === 'timeout' && r.waitedMs >= 6000 && r.waitedMs < 7000, JSON.stringify(r));
}
{
	const w = world('', Array.from({ length: 40 }, (_, i) => line(500 * (i + 1), `tick ${i}\n`)));
	const r = await A.awaitOutput(w.io, { timeoutMs: 10000 });
	check('output that keeps coming runs to the time limit and says it may still be running', r.reason === 'timeout' && A.awaitWords(r, 'T1', null).includes('was still printing'));
}
{
	const big = 'x'.repeat(30000);
	const w = world('', [line(500, big + '\nDONE\n')]);
	const r = await A.awaitOutput(w.io, { re: /DONE/, timeoutMs: 5000 });
	check('a long output is cut to its end', r.output.length <= A.MAX_AWAIT_OUTPUT_CHARS + 10 && r.output.endsWith('DONE\n') && r.output.startsWith('...'));
}
{
	// the buffer scrolled: what was there first is gone, so the new text does not start with it
	let t = 0, calls = 0;
	const io = { read: async () => (calls++ === 0 ? 'old line one\nold line two\n' : 'old line two\nlistening on 8080\n'), sleep: async (ms) => { t += ms; }, now: () => t };
	const r = await A.awaitOutput(io, { re: /listening on (\d+)/, timeoutMs: 5000 });
	check('when the terminal has scrolled, everything it shows now is taken as new', r.reason === 'matched' && r.match === 'listening on 8080');
}
check('output since the call is what is after the old text, or all of it', A.freshOutput('abc', 'abcdef') === 'def' && A.freshOutput('abc', 'xyz') === 'xyz' && A.freshOutput('', 'a') === 'a');
check('a pattern that is fine is taken', A.parsePattern('ready|listening on \\d+').ok && A.parsePattern('^\\$ $').ok);
check('a pattern that is not valid, too long, or built to run for ages is refused with the reason', !A.parsePattern('(').ok && A.parsePattern('(').reason.includes('not a valid') && !A.parsePattern('a'.repeat(201)).ok && !A.parsePattern('(a+)+$').ok && !A.parsePattern('(x*)*y').ok);
{
	const m = A.awaitWords({ reason: 'matched', output: 'ok\n', match: 'ready', waitedMs: 2300 }, 'terminal-2', 'ready');
	check('what the agent is told says which terminal, what matched and how long', m.startsWith('Terminal terminal-2 printed a line matching /ready/ after 2.3s ("ready").') && m.includes('New output:\nok'));
	check('a wait that found nothing says the terminal may still be running', A.awaitWords({ reason: 'timeout', output: '', waitedMs: 30000 }, 'T', 'ready').includes('may still be running') && A.awaitWords({ reason: 'timeout', output: '', waitedMs: 30000 }, 'T', 'ready').includes('(no new output)'));
}
check('the limits are the ones the tool says', A.MAX_AWAIT_SECONDS === 120 && A.DEFAULT_AWAIT_SECONDS === 30 && A.QUIET_SECONDS === 5);

console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
