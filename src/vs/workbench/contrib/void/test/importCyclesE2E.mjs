#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Regression test for "installed app opens a blank window: TypeError: i is not a function".
//
// Services are injected with decorators such as `@IToolsService`, and a decorator runs when its class
// is defined. In the bundled workbench every module runs in dependency order, so if two modules import
// each other (directly or through the prebuilt React bundles) one of them runs first and sees the
// other's service id as `undefined`. Which side loses depends on bundle order, so a cycle that worked
// for years can break after an unrelated upgrade. Service ids therefore have to live in modules that
// the implementation (and anything that imports the React bundles) can depend on without a cycle.
//
// This builds the real workbench entry's module graph (esbuild metafile, no output) and fails if any
// Vader module takes part in an import cycle. Needs `npm run buildreact` first (CI does that).

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const esbuild = createRequire(path.join(repo, 'package.json'))('esbuild');

const result = await esbuild.build({
	entryPoints: ['src/vs/workbench/workbench.desktop.main.ts'],
	absWorkingDir: repo, bundle: true, write: false, metafile: true, format: 'esm', platform: 'neutral', logLevel: 'silent',
	packages: 'external', outdir: path.join(repo, '.build', 'importCyclesE2E'),
	tsconfigRaw: JSON.stringify({ compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } }),
	plugins: [{ name: 'css-external', setup(b) { b.onResolve({ filter: /\.css$/ }, a => ({ path: a.path, external: true })); } }],
	loader: { '.ttf': 'file', '.svg': 'file', '.png': 'file', '.sh': 'file' },
});

const edges = {};
for (const [file, info] of Object.entries(result.metafile.inputs)) {
	edges[file] = info.imports.filter(i => i.kind === 'import-statement' && !i.external).map(i => i.path);
}

// Tarjan's strongly connected components.
let counter = 0;
const stack = [], onStack = new Set(), index = {}, low = {}, cycles = [];
const visit = (v) => {
	index[v] = low[v] = counter++;
	stack.push(v); onStack.add(v);
	for (const w of edges[v] || []) {
		if (!(w in index)) { visit(w); low[v] = Math.min(low[v], low[w]); }
		else if (onStack.has(w)) { low[v] = Math.min(low[v], index[w]); }
	}
	if (low[v] === index[v]) {
		const component = [];
		let w;
		do { w = stack.pop(); onStack.delete(w); component.push(w); } while (w !== v);
		if (component.length > 1) { cycles.push(component); }
	}
};
for (const v of Object.keys(edges)) { if (!(v in index)) { visit(v); } }

// Second check, same graph: a module that registers a service/action/contribution does nothing unless something
// imports it. Moving ids out of implementation files (to break cycles) can silently drop the only import that
// pulled the implementation in, and the app then fails at runtime with "depends on ... which is NOT registered".
const reached = new Set(Object.keys(result.metafile.inputs));
const voidRoot = path.join(repo, 'src/vs/workbench/contrib/void');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory()
	? (['node_modules', 'test', 'out', 'src', 'src2', 'electron-main', 'node'].includes(e.name) ? [] : walk(path.join(d, e.name)))
	: [path.join(d, e.name)]);
// Known dead code that registers but is not wired in (also unreachable before the upgrade).
const knownUnwired = new Set(['browser/_dummyContrib.ts', 'browser/_markerCheckService.ts', 'browser/contextGatheringService.ts', 'browser/vaderNativeExternalAgentAdapter.ts']);
const unreached = walk(voidRoot)
	.filter(f => /\.ts$/.test(f))
	.filter(f => /registerSingleton\(|registerAction2\(|registerWorkbenchContribution2?\(|Registry\.as/.test(fs.readFileSync(f, 'utf8')))
	.map(f => path.relative(voidRoot, f).split(path.sep).join('/'))
	.filter(rel => !reached.has('src/vs/workbench/contrib/void/' + rel) && !knownUnwired.has(rel));
for (const rel of unreached) { console.error(`FAIL: ${rel} registers something but nothing in the workbench imports it`); }

// Third check: runtime service-dependency cycles. Distinct from import cycles: here module order is fine, but
// service A's constructor asks for B while B's (transitively) asks for A, which InstantiationService rejects with
// "Cyclic dependency" the first time anything needs A. Built from the source: every registerSingleton(IX, Class)
// and the @IY decorators in Class's constructor.
const sources = walk(voidRoot).filter(f => /\.ts$/.test(f)).map(f => ({ f, text: fs.readFileSync(f, 'utf8') }));
const registered = new Map(); // service id -> { cls, text }
for (const { text } of sources) {
	for (const m of text.matchAll(/registerSingleton\(\s*(\w+)\s*,\s*(\w+)\s*,/g)) { registered.set(m[1], { cls: m[2], text }); }
}
const serviceDeps = new Map();
for (const [id, { cls, text }] of registered) {
	const header = new RegExp(`class\\s+${cls}\\b[^{]*\\{`).exec(text);
	const start = header ? text.indexOf('constructor(', header.index + header[0].length) : -1;
	if (start < 0) { serviceDeps.set(id, []); continue; }
	let depth = 1, i = start + 'constructor('.length;
	const begin = i;
	while (depth && i < text.length) { depth += (text[i] === '(') - (text[i] === ')'); i++; }
	serviceDeps.set(id, [...text.slice(begin, i).matchAll(/@(I\w+)/g)].map(m => m[1]).filter(d => registered.has(d)));
}
let n = 0; const sIndex = new Map(), sLow = new Map(), sStack = [], sOn = new Set(), serviceCycles = [];
const sVisit = (v) => {
	sIndex.set(v, n); sLow.set(v, n); n++; sStack.push(v); sOn.add(v);
	for (const w of serviceDeps.get(v) || []) {
		if (!sIndex.has(w)) { sVisit(w); sLow.set(v, Math.min(sLow.get(v), sLow.get(w))); }
		else if (sOn.has(w)) { sLow.set(v, Math.min(sLow.get(v), sIndex.get(w))); }
	}
	if (sLow.get(v) === sIndex.get(v)) {
		const comp = []; let w;
		do { w = sStack.pop(); sOn.delete(w); comp.push(w); } while (w !== v);
		if (comp.length > 1 || (serviceDeps.get(v) || []).includes(v)) { serviceCycles.push(comp); }
	}
};
for (const v of serviceDeps.keys()) { if (!sIndex.has(v)) { sVisit(v); } }
for (const c of serviceCycles) {
	console.error(`FAIL: service dependency cycle (constructor injection): ${c.join(' <-> ')}\n` + c.map(s => `  ${s} -> ${(serviceDeps.get(s) || []).filter(d => c.includes(d)).join(', ')}`).join('\n'));
}
console.log(`${registered.size} registered Vader services, ${serviceCycles.length} constructor-injection cycle(s)`);

const vaderCycles = cycles.filter(c => c.some(f => f.includes('contrib/void/')));
console.log(`${Object.keys(edges).length} modules in the workbench graph, ${cycles.length} import cycle(s), ${vaderCycles.length} involving Vader code`);
for (const c of vaderCycles) {
	console.error(`FAIL: import cycle between ${c.length} modules:\n${c.map(f => '  ' + f.replace('src/vs/workbench/contrib/void/', 'void/')).join('\n')}`);
}
process.exit(vaderCycles.length || unreached.length || serviceCycles.length ? 1 : 0);
