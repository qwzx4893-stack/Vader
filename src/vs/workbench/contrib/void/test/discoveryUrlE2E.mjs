#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Repository URLs from SkillNet/the MCP registry are untrusted. Tests common/discovery/githubSkillUrl.ts.
// Run: node src/vs/workbench/contrib/void/test/discoveryUrlE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-disc-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/discovery/githubSkillUrl.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(tmp, 'g.cjs'), logLevel: 'silent' });
const { rawSkillInstructionUrls } = require(path.join(tmp, 'g.cjs'));

let passed = 0, failed = 0;
const check = (name, ok) => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); };

for (const u of ['https://evil.test/?github.com/o/r', 'https://evil.test/github.com/o/r', 'https://github.com.evil.test/o/r', 'http://github.com/o/r', 'https://user:pw@github.com/o/r', 'https://github.com:8443/o/r',
	'https://github.com/o', 'https://github.com/o/r/blob/main/x', 'https://github.com/o/../r', 'https://github.com/o/r/tree/ma%2Fin/x', 'git@github.com:o/r.git', 'javascript:1', 'https://github.com/o/r/tree/main/a b'])
	check(`rejects ${u}`, rawSkillInstructionUrls(u) === null);
// URL parsing resolves dot segments first, so traversal attempts can only land on another repository under github.com.
for (const u of ['https://github.com/o/r/tree/main/../../../etc', 'https://github.com/o/r/tree/main/%2e%2e/%2e%2e/x'])
	check(`traversal stays inside raw.githubusercontent.com: ${u}`, (rawSkillInstructionUrls(u) ?? []).every(x => /^https:\/\/raw\.githubusercontent\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\//.test(x)));
const ok = rawSkillInstructionUrls('https://github.com/acme/skills');
check('plain repo url maps to raw.githubusercontent.com on main', ok && ok[0] === 'https://raw.githubusercontent.com/acme/skills/main/SKILL.md' && ok.length === 4);
const sub = rawSkillInstructionUrls('https://github.com/acme/skills/tree/v2/tools/pdf/');
check('tree url keeps ref and subpath', sub && sub[0] === 'https://raw.githubusercontent.com/acme/skills/v2/tools/pdf/SKILL.md');
check('.git suffix is stripped', rawSkillInstructionUrls('https://github.com/acme/skills.git')[0].includes('/acme/skills/main/'));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
