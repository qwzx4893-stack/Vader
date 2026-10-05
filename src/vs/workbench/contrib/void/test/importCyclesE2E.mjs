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

const vaderCycles = cycles.filter(c => c.some(f => f.includes('contrib/void/')));
console.log(`${Object.keys(edges).length} modules in the workbench graph, ${cycles.length} import cycle(s), ${vaderCycles.length} involving Vader code`);
for (const c of vaderCycles) {
	console.error(`FAIL: import cycle between ${c.length} modules:\n${c.map(f => '  ' + f.replace('src/vs/workbench/contrib/void/', 'void/')).join('\n')}`);
}
process.exit(vaderCycles.length ? 1 : 0);
