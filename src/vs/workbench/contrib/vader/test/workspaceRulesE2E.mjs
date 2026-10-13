#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A project's rules file: `.vaderrules`, else `AGENTS.md` (the convention of Codex, OpenCode, Cursor, Copilot, Cline...), else `CLAUDE.md`
// (common/instructions/workspaceRulesFiles.ts), bundled from source, plus the checks on where it is wired.
// Run: node src/vs/workbench/contrib/vader/test/workspaceRulesE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-rules-'));
const load = async (rel, name) => {
	await esbuild.build({ entryPoints: [path.join(here, rel)], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, name), logLevel: 'silent' });
	return import(pathToFileURL(path.join(tmp, name)).href);
};
const R = await load('../common/instructions/workspaceRulesFiles.ts', 'r.mjs');
const P = await load('../common/policy/builtInPolicyRules.ts', 'p.mjs');
const I = await load('../common/instructions/instructionsService.ts', 'i.mjs');

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const read = (rel) => fs.readFileSync(path.join(here, rel), 'utf8');

check('the files, in the order they are tried', R.WORKSPACE_RULES_FILES.join() === '.vaderrules,AGENTS.md,CLAUDE.md');
check('Vader\'s own file wins over the shared ones', R.WORKSPACE_RULES_FILES[0] === '.vaderrules');
check('a short file is passed on unchanged', R.limitWorkspaceRules('Use tabs.\nRun npm test.') === 'Use tabs.\nRun npm test.');
const long = 'x'.repeat(R.MAX_WORKSPACE_RULES_CHARS + 5000);
const cut = R.limitWorkspaceRules(long);
check('a very long file is cut, and says so', cut.length < long.length && cut.startsWith('x'.repeat(1000)) && /longer than Vader reads/.test(cut));
check('a file exactly at the limit is not cut', R.limitWorkspaceRules('y'.repeat(R.MAX_WORKSPACE_RULES_CHARS)).length === R.MAX_WORKSPACE_RULES_CHARS);

// the agent must not rewrite these files unasked (they steer every later turn, and a cloned repository's author wrote them)
const rule = P.builtInPolicyRules.find(r => JSON.stringify(r).includes('.vaderrules'));
const globs = JSON.stringify(rule ?? {});
check('the policy rule that asks before editing .vaderrules covers AGENTS.md and CLAUDE.md too', !!rule && globs.includes('**/AGENTS.md') && globs.includes('**/CLAUDE.md'), globs.slice(0, 200));

// the text is framed as possibly written by someone else, whichever file it came from
check('the workspace layer is still framed as untrusted', typeof I.UNTRUSTED_LAYER_FRAMING.workspace === 'string' && /run commands/.test(I.UNTRUSTED_LAYER_FRAMING.workspace));

const conv = read('../browser/convertToLLMMessageService.ts'), contrib = read('../browser/convertToLLMMessageWorkbenchContrib.ts');
check('the prompt builder reads all three names and limits the size', /for \(const filename of WORKSPACE_RULES_FILES\)/.test(conv) && /limitWorkspaceRules\(/.test(conv));
check('the file watcher and the model loader use the same list (a file created later is picked up)', (contrib.match(/WORKSPACE_RULES_FILES/g) ?? []).length >= 3 && !/\['\.vaderrules'\]/.test(contrib));
check('no place still reads only .vaderrules', !/\['\.vaderrules'\]/.test(conv));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
