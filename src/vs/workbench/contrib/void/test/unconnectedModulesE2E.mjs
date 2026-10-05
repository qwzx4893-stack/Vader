#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// "Parts that are not connected to each other". A module that registers a service, contribution, action or tool when it is
// imported does nothing unless something imports it - the reference external-agent adapter shipped that way (documented, tested
// in isolation, never loaded). This builds the real workbench and main-process module graphs (esbuild metafile) and fails when
//   1. a Vader module that registers anything (registerSingleton / registerWorkbenchContribution2 / registerAction2 / registerEditorContribution /
//      registerSettingsPaneContribution ...) is not reachable from the application entry points, or
//   2. a Vader .ts module is imported by nothing at all (dead code), except entry points the build wires up by name.
// Needs `npm run buildreact` first (CI does that).
//
// Run: node src/vs/workbench/contrib/void/test/unconnectedModulesE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const voidDir = path.join(repo, 'src/vs/workbench/contrib/void');
const esbuild = createRequire(path.join(repo, 'package.json'))('esbuild');

const build = (entry, platform) => esbuild.build({
	entryPoints: [entry], absWorkingDir: repo, bundle: true, write: false, metafile: true, format: 'esm', platform, logLevel: 'silent',
	packages: 'external', outdir: path.join(repo, '.build', 'unconnectedModulesE2E'),
	tsconfigRaw: JSON.stringify({ compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } }),
	plugins: [{ name: 'css-external', setup(b) { b.onResolve({ filter: /\.css$/ }, a => ({ path: a.path, external: true })); } }],
	loader: { '.ttf': 'file', '.svg': 'file', '.png': 'file', '.sh': 'file' },
});

const reached = new Set();
for (const [entry, platform] of [['src/vs/workbench/workbench.desktop.main.ts', 'neutral'], ['src/vs/code/electron-main/main.ts', 'node'], ['src/main.ts', 'node']]) {
	const r = await build(entry, platform);
	for (const f of Object.keys(r.metafile.inputs)) { reached.add(path.resolve(repo, f)); }
}

const files = [];
(function walk(d) {
	for (const e of fs.readdirSync(d, { withFileTypes: true })) {
		const p = path.join(d, e.name);
		if (e.isDirectory()) { if (!['node_modules', 'out', 'test', 'src2', 'react', 'clineBundle'].includes(e.name)) { walk(p); } }
		else if (/\.ts$/.test(e.name) && !e.name.endsWith('.d.ts')) { files.push(p); }
	}
})(voidDir);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
check('the module graphs were built', reached.size > 1000 && files.length > 100, `${reached.size} reached, ${files.length} Vader files`);

const REGISTERS = /\b(registerSingleton|registerWorkbenchContribution2|registerAction2|registerEditorContribution|registerEditorAction|registerSettingsPaneContribution|registerWorkbenchContribution)\s*\(/;
const unreachableRegistrars = files.filter(f => !reached.has(f) && REGISTERS.test(fs.readFileSync(f, 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')));
check('every module that registers something is loaded by the application', unreachableRegistrars.length === 0,
	unreachableRegistrars.map(f => path.relative(voidDir, f)).join(', '));

// zero importers anywhere in src (type-only importers count: they are real uses of the module)
const corpus = [];
(function walk(d) {
	for (const e of fs.readdirSync(d, { withFileTypes: true })) {
		const p = path.join(d, e.name);
		if (e.isDirectory()) { if (!['node_modules', 'out', 'src2'].includes(e.name)) { walk(p); } }
		else if (/\.(ts|tsx|mjs|js)$/.test(e.name) && !e.name.endsWith('.d.ts')) { corpus.push(p); }
	}
})(path.join(repo, 'src/vs'));
const importLines = corpus.map(f => ({ f, t: fs.readFileSync(f, 'utf8').split('\n').filter(l => /^\s*(import|export)\b.*from\s|^\s*import\s*['"]|\bimport\(|require\(/.test(l) && !/^\s*\/\//.test(l)).join('\n') }));
const dead = files.filter(f => {
	const base = path.basename(f).replace(/\.ts$/, '');
	return !importLines.some(({ f: g, t }) => g !== f && new RegExp(`/${base}(\\.js)?['"]`).test(t));
});
check('no Vader module is imported by nothing (dead code)', dead.length === 0, dead.map(f => path.relative(voidDir, f)).join(', '));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
