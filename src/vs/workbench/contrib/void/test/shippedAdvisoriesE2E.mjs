#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Gate: nothing with a HIGH or CRITICAL known advisory may be in what Vader ships.
//
// `npm audit` reports every package in the repository, including build tooling (gulp, mocha, tailwind...) that never reaches
// a user. What matters is the runtime (production) dependency tree minus what the installer leaves out (build/.moduleignore).
// This test audits exactly that and fails on any high/critical advisory that is neither excluded from the installer nor
// listed, with a written reason, in build/advisory-exceptions.json (and an exception that no longer applies is also a failure,
// so the list cannot rot).
//
// Needs network access to the npm registry. Run: node src/vs/workbench/contrib/void/test/shippedAdvisoriesE2E.mjs

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');
let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

// packages the installer leaves out ("name/**" lines of build/.moduleignore)
const ignored = fs.readFileSync(path.join(root, 'build/.moduleignore'), 'utf8').split(/\r?\n/).map(l => l.trim())
	.filter(l => l && !l.startsWith('#') && l.endsWith('/**') && !l.includes('/node_modules/')).map(l => l.slice(0, -3));
const isIgnored = (name) => ignored.some(g => name === g || name.startsWith(g + '/') || (g.endsWith('*') && name.startsWith(g.slice(0, -1))));

const exceptionsFile = path.join(root, 'build/advisory-exceptions.json');
const exceptions = fs.existsSync(exceptionsFile) ? JSON.parse(fs.readFileSync(exceptionsFile, 'utf8')) : [];

let audit;
try {
	audit = JSON.parse(execFileSync('npm', ['audit', '--omit=dev', '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }));
} catch (e) {
	audit = JSON.parse(e.stdout || '{}'); // npm audit exits non-zero when it finds something
}
if (!audit.vulnerabilities) { check('npm audit produced a report', false, 'no output (offline?)'); process.exit(1); }

const severe = Object.entries(audit.vulnerabilities).filter(([, v]) => v.severity === 'high' || v.severity === 'critical');
console.log(`production tree: ${Object.keys(audit.vulnerabilities).length} packages with advisories, ${severe.length} high/critical; installer leaves out ${ignored.length} package patterns`);

const unexplained = [];
const usedExceptions = new Set();
for (const [name, v] of severe) {
	if (isIgnored(name)) { continue; }
	// a vulnerable package whose only vulnerable path runs through an excluded package is also not shipped
	const viaNames = v.via.filter(x => typeof x === 'string');
	if (viaNames.length && viaNames.every(n => isIgnored(n) || severe.some(([s]) => s === n && isIgnored(s)))) { continue; }
	const ex = exceptions.find(x => x.package === name);
	if (ex) { usedExceptions.add(name); continue; }
	unexplained.push(`${v.severity} ${name} ${v.range} (${v.via.filter(x => typeof x !== 'string').map(x => x.title).slice(0, 1).join('; ') || 'via ' + viaNames.join(', ')})`);
}
check('no high/critical advisory in what ships (excluded packages and documented exceptions aside)', unexplained.length === 0, '\n  ' + unexplained.join('\n  '));
for (const ex of exceptions) {
	check(`exception "${ex.package}" is still needed and carries a reason`, usedExceptions.has(ex.package) && typeof ex.reason === 'string' && ex.reason.length > 40, usedExceptions.has(ex.package) ? 'reason missing/too short' : 'no longer reported - remove it');
}
check('the excluded high/critical packages really are excluded from the installer', severe.filter(([n]) => isIgnored(n)).every(([n]) => isIgnored(n)));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
