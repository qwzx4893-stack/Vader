#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What a number typed into Settings means (common/settingsInput.ts): a value that cannot be used is refused with words, nothing is guessed.
// Run: node src/vs/workbench/contrib/vader/test/settingsInputE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-settingsinput-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/settingsInput.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'm.mjs'), logLevel: 'silent' });
const M = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const money = (t, allowEmpty = true) => M.parseMoney(t, { allowEmpty });

check('5, 12.50, $5 and "5,50" are amounts', money('5').value === 5 && money('12.50').value === 12.5 && money('$5').value === 5 && money(' $ 7 ').value === 7 && money('5,50').value === 5.5 && money('.5').value === 0.5);
check('the words five, 5 dollars and 1e3 are not amounts', !money('five').ok && !money('5 dollars').ok && !money('1e3').ok && !money('-3').ok);
check('the message says what to type', money('five').message === 'Enter a number, like 5 or 12.50.');
check('an empty box is no limit where that is allowed, and a mistake where it is not', money('').ok && money('').value === null && !money('', false).ok);
check('zero is refused as a limit and the message says how to have none', !money('0').ok && /turn it off/.test(money('0').message));
check('a percent is 0 to 100, an empty box is 0', M.parsePercent('20').value === 20 && M.parsePercent('20%').value === 20 && M.parsePercent('').value === 0 && M.parsePercent('0').value === 0);
check('250 and "twenty" are not percents', !M.parsePercent('250').ok && !M.parsePercent('twenty').ok && /0 to 100/.test(M.parsePercent('250').message));
check('a price can be zero (a free model) but not empty, negative or text', M.parsePrice('0').value === 0 && M.parsePrice('0.25').value === 0.25 && !M.parsePrice('').ok && !M.parsePrice('-1').ok && !M.parsePrice('cheap').ok);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
