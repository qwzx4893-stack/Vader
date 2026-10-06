/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Builds index.js: a single self-contained ESM bundle of the real @cline/agents runtime (and its
// dependencies), imported by ../clineRuntimeAdapter.ts like the React bundles under ../react/out.
//
// Why this exists: the workbench renderer is sandboxed and resolves no bare module specifiers, and
// build/lib/optimize.ts marks every bare package external, so `import '@cline/agents'` survived
// into the packaged workbench and threw "Failed to resolve module specifier" at startup, leaving a
// blank window. Bundling it here removes the bare import.
//
// Run: npm run buildcline   (CI runs it before compile, next to buildreact)

import * as esbuild from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../../../../..');
const builtins = new Set([...builtinModules, ...builtinModules.map(m => `node:${m}`)]);

// nanoid is resolved separately below: its default (node) entry needs Buffer, its browser entry does not.
const BUNDLED = /^(@cline\/|zod(\/|$))/;

const entry = `export { AgentRuntime } from '@cline/agents';\n`;

// Stubs are ESM modules with explicit named exports (discovered from esbuild's own "No matching
// export" errors below). Every stub value is a callable proxy: loading never throws, since dead-but-
// present code (Node built-ins, optional provider/telemetry SDKs) may run harmlessly at load time,
// but the first real use of each stubbed path logs a warning so a genuinely reached call is visible.
const stubSource = (name, exportNames) => `
const warned = new Set();
const mk = (p) => new Proxy(function () { }, {
	get: (_t, k) => (k === 'then' || typeof k === 'symbol') ? undefined : (k === 'default' ? root : mk(p + '.' + String(k))),
	apply: () => { if (!warned.has(p)) { warned.add(p); console.warn('[vader] renderer stub used: ' + p); } return mk(p + '()'); },
	construct: () => { if (!warned.has(p)) { warned.add(p); console.warn('[vader] renderer stub used: new ' + p); } return mk(p + '#new'); },
});
const root = mk(${JSON.stringify(name)});
export default root;
${exportNames.map((n, i) => `export const ${/^[A-Za-z_$][\w$]*$/.test(n) ? n : `__n${i}`} = mk(${JSON.stringify(`${name}.${n}`)});`).join('\n')}
`;

const stubExports = new Map(); // stub module name -> names imported from it

const stubPlugin = {
	name: 'renderer-stubs',
	setup(build) {
		build.onResolve({ filter: /.*/ }, async (args) => {
			if (args.pluginData?.skip || args.kind === 'entry-point') { return undefined; }
			if (builtins.has(args.path)) { return { path: args.path, namespace: 'vader-stub' }; }
			if (/^[./]/.test(args.path)) { return undefined; }
			// Vader supplies its own AgentModel and tools, so @cline/llms's provider/telemetry SDK trees
			// (aws, sap, langfuse, opentelemetry, ai-sdk, ...) are never reached; bundling them cost ~9 MB.
			// Anything outside this allowlist is stubbed.
			if (args.path === 'nanoid') { return { path: path.join(repoRoot, 'node_modules/nanoid/index.browser.js') }; }
			if (!BUNDLED.test(args.path)) { return { path: args.path, namespace: 'vader-stub' }; }
			const r = await build.resolve(args.path, { resolveDir: args.resolveDir, kind: args.kind, importer: args.importer, pluginData: { skip: true } });
			return r.errors.length ? { path: args.path, namespace: 'vader-stub' } : undefined;
		});
		build.onLoad({ filter: /.*/, namespace: 'vader-stub' }, (args) => ({ contents: stubSource(args.path, [...(stubExports.get(args.path) ?? [])]), loader: 'js' }));
	},
};

// The sandboxed renderer has no global Buffer; @cline/llms uses Buffer.from/byteLength/isView.
const bufferEntry = path.join(repoRoot, 'node_modules/buffer/index.js');
if (!fs.existsSync(bufferEntry)) { console.error(`clineBundle: ${bufferEntry} not found (needed as a Buffer polyfill)`); process.exit(1); }
const bufferShim = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vader-cline-')), 'buffer-shim.js');
fs.writeFileSync(bufferShim, `import { Buffer } from ${JSON.stringify(bufferEntry.replace(/\\/g, '/'))};\nexport { Buffer };\n`);

const options = {
	inject: [bufferShim],
	stdin: { contents: entry, resolveDir: repoRoot, sourcefile: 'cline-entry.js' },
	bundle: true,
	format: 'esm',
	platform: 'neutral',
	target: 'es2022',
	// Neutral platform so esbuild adds no implicit 'browser' condition: @cline/llms's browser build omits exports @cline/agents imports.
	conditions: ['import', 'default'],
	mainFields: ['module', 'main'],
	define: { 'process.env.NODE_ENV': '"production"' },
	banner: { js: `var process = globalThis.process ?? { env: {}, versions: {}, platform: 'win32', cwd: () => '/', nextTick: (f, ...a) => queueMicrotask(() => f(...a)), emitWarning() { } };` },
	plugins: [stubPlugin],
	treeShaking: true,
	minify: true,
	legalComments: 'none',
	metafile: true,
	outfile: path.join(here, 'index.js'),
	logLevel: 'silent',
};

let result;
for (let pass = 0; pass < 25 && !result; pass++) {
	try {
		result = await esbuild.build(options);
	} catch (e) {
		let learned = 0;
		for (const err of e.errors ?? []) {
			const m = /No matching export in "vader-stub:(.+?)" for import "(.+?)"/.exec(err.text);
			if (m) { const set = stubExports.get(m[1]) ?? new Set(); if (!set.has(m[2])) { set.add(m[2]); stubExports.set(m[1], set); learned++; } }
		}
		if (!learned) { console.error(e.message); process.exit(1); }
	}
}
if (!result) { console.error('clineBundle: could not converge on stub exports'); process.exit(1); }

const out = fs.statSync(path.join(here, 'index.js')).size;
const pkgs = new Set();
for (const i of Object.keys(result.metafile.inputs)) { const m = i.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/); if (m) { pkgs.add(m[1]); } }
console.log(`clineBundle/index.js: ${(out / 1024).toFixed(0)} KB, ${pkgs.size} packages: ${[...pkgs].sort().join(', ')}`);
