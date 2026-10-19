#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What the chat says when an edit could not be applied (common/editErrorWords.ts).
// Run: node src/vs/workbench/contrib/vader/test/editErrorWordsE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-editwords-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/editErrorWords.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'e.mjs'), logLevel: 'silent' });
const E = await import(pathToFileURL(path.join(tmp, 'e.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

// the messages as editCodeService.ts raises them
const notFound = 'The edit was not applied. The text in ORIGINAL must EXACTLY match lines of code in the file, but there was no match for:\n```\n"x"\n```. Ensure you have the latest version of the file, and ensure the ORIGINAL code matches a code excerpt exactly.';
const notUnique = 'The edit was not applied. The text in ORIGINAL must be unique in the file being edited, but the following ORIGINAL code appears multiple times in the file:\n```\n"x"\n```. Ensure you have the latest version';
const overlap = 'The edit was not applied. The text in the ORIGINAL blocks must not overlap, but the following ORIGINAL code had overlap with another ORIGINAL string:\n```\n"x"\n```.';

check('text that is no longer in the file says so and that nothing was written', E.explainEditError(notFound).title === 'The change did not fit' && E.explainEditError(notFound).text === 'The lines the model wanted to replace are no longer in the file. Nothing was written.');
check('text that appears more than once says that', E.explainEditError(notUnique).kind === 'not-unique' && /more than once/.test(E.explainEditError(notUnique).text));
check('two changes on the same lines say that', E.explainEditError(overlap).kind === 'overlap' && /overlap/.test(E.explainEditError(overlap).text));
check('any other error gets no words', E.explainEditError('Error applying Search/Replace blocks: File does not exist.') === null && E.explainEditError('') === null && E.explainEditError('The edit was not applied. Something else') === null);
check('the messages sent to the agent say what to do', E.TRY_AGAIN_MESSAGE.includes('Read the file again') && E.rewriteMessage('limiter.ts') === 'The last edit to limiter.ts was not applied. Rewrite the whole file with the change instead of editing parts of it.');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
