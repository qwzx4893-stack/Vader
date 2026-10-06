#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Gate: nothing with a known advisory of ANY severity may be in what Vader ships - and, since the build-tooling pass, nor in the development trees
// (gulp, tailwind, mocha, the build/ and test/ packages): every lockfile in the repository is audited with its development dependencies too.
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

// Every package.json that has its own lockfile and ships: the root, each built-in extension (they carry their own node_modules into the
// installer) and the remote server packages. This used to audit only the root and missed high advisories in the extensions.
const lockDirs = ['.', 'remote', 'remote/web'];
for (const e of fs.readdirSync(path.join(root, 'extensions'), { withFileTypes: true })) {
	if (e.isDirectory() && fs.existsSync(path.join(root, 'extensions', e.name, 'package-lock.json'))) { lockDirs.push(`extensions/${e.name}`); }
}
// extensions that exist only for testing the editor are not part of the product
const NOT_SHIPPED = new Set(['extensions/vscode-api-tests', 'extensions/vscode-colorize-tests', 'extensions/vscode-colorize-perf-tests', 'extensions/vscode-test-resolver']);

const auditOf = (dir) => {
	const cwd = path.join(root, dir);
	const args = ['audit', '--omit=dev', '--json', ...(dir === '.' ? [] : ['--package-lock-only'])];
	try {
		return JSON.parse(execFileSync('npm', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }));
	} catch (e) {
		return JSON.parse(e.stdout || '{}'); // npm audit exits non-zero when it finds something
	}
};

let audited = 0;
const unexplained = [];
const usedExceptions = new Set();
let excludedFromInstaller = 0;
for (const dir of lockDirs) {
	if (NOT_SHIPPED.has(dir)) { continue; }
	const audit = auditOf(dir);
	if (!audit.vulnerabilities) { check(`npm audit produced a report for ${dir}`, false, 'no output (offline?)'); continue; }
	audited++;
	for (const [name, v] of Object.entries(audit.vulnerabilities)) {
		if (dir === '.' && isIgnored(name)) { excludedFromInstaller++; continue; }
		// a vulnerable package whose only vulnerable path runs through an excluded package is also not shipped
		const viaNames = v.via.filter(x => typeof x === 'string');
		if (dir === '.' && viaNames.length && viaNames.every(n => isIgnored(n))) { excludedFromInstaller++; continue; }
		const ex = exceptions.find(x => x.package === name && (x.in ?? '.') === dir);
		if (ex) { usedExceptions.add(`${dir}:${name}`); continue; }
		unexplained.push(`${dir}: ${v.severity} ${name} ${v.range} (${v.via.filter(x => typeof x !== 'string').map(x => x.title).slice(0, 1).join('; ') || 'via ' + viaNames.join(', ')})`);
	}
}
console.log(`audited the production dependencies of ${audited} shipped packages; the installer leaves out ${ignored.length} package patterns (${excludedFromInstaller} advisory entries fall inside them)`);
check('every shipped package.json with a lockfile was audited', audited >= 30, `${audited}`);
check('no known advisory (any severity) in what ships, excluded packages and documented exceptions aside', unexplained.length === 0, '\n  ' + unexplained.join('\n  '));
for (const ex of exceptions) {
	check(`exception "${ex.package}" (${ex.in ?? '.'}) is still needed and carries a reason`, usedExceptions.has(`${ex.in ?? '.'}:${ex.package}`) && typeof ex.reason === 'string' && ex.reason.length > 40, 'stale or without a reason');
}

// ---- the development trees: build tooling and tests. Several of their advisories have no upstream fix (braces, extract-zip, sprintf-js, node-forge...), so
// Vader patches or replaces those packages (build/stubs, package.json overrides). Everything must be at zero here; an exception needs a written reason.
const allLockDirs = [];
const findLocks = (dir, depth) => {
	if (depth > 3) { return; }
	for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
		if (!e.isDirectory() || ['node_modules', '.git', 'out', '.build', 'stubs', 'dist'].includes(e.name)) { continue; }
		const rel = dir === '.' ? e.name : `${dir}/${e.name}`;
		if (fs.existsSync(path.join(root, rel, 'package-lock.json'))) { allLockDirs.push(rel); }
		findLocks(rel, depth + 1);
	}
};
if (fs.existsSync(path.join(root, 'package-lock.json'))) { allLockDirs.push('.'); }
for (const top of ['build', 'test', 'extensions', 'remote']) { if (fs.existsSync(path.join(root, top))) { if (fs.existsSync(path.join(root, top, 'package-lock.json'))) { allLockDirs.push(top); } findLocks(top, 0); } }
const devFindings = [];
for (const dir of allLockDirs) {
	const cwd = path.join(root, dir);
	let a; try { a = JSON.parse(execFileSync('npm', ['audit', '--json', '--package-lock-only'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })); } catch (e) { a = JSON.parse(e.stdout || '{}'); }
	for (const [name, v] of Object.entries(a.vulnerabilities ?? {})) {
		if (exceptions.some(x => x.package === name && (x.in ?? '.') === dir)) { continue; }
		devFindings.push(`${dir}: ${v.severity} ${name} ${v.range}`);
	}
}
console.log(`audited ${allLockDirs.length} lockfiles including development dependencies`);
check('every lockfile in the repository, development dependencies included, is free of known advisories', devFindings.length === 0, '\n  ' + devFindings.join('\n  '));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
