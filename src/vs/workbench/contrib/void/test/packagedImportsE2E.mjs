#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Regression test for "the packaged app dies at startup with ERR_MODULE_NOT_FOUND".
//
// The packaged app keeps node_modules inside node_modules.asar and resolves bare specifiers through a
// hook that `bootstrap-esm` registers at runtime. Static `import 'pkg'` statements in the main-process
// bundles are linked before that hook exists, so the only bare specifiers a bundle may import
// statically are Node built-ins, `electron`, and packages that ship as real files in node_modules
// (build/gulpfile.vscode.ts keeps a few out of the archive). Anything else must be bundled in.
//
// Usage: node packagedImportsE2E.mjs [outDir]    (default: out-vscode-min; run after the bundle/package step)

import { builtinModules } from 'node:module';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const outDir = path.resolve(repo, process.argv[2] || 'out-vscode-min');
const esbuild = createRequire(path.join(repo, 'package.json'))('esbuild');

const builtins = new Set(builtinModules.flatMap(m => [m, `node:${m}`]).concat(['original-fs', 'node:original-fs', 'electron']));
// Shipped as real files under resources/app/node_modules (see the createAsar exclusion list).
const realNodeModules = ['@vscode/sandbox-runtime', '@pondwader/socks5-server', 'shell-quote', 'zod', 'vsda'];
const allowed = (spec) => spec.startsWith('<') || builtins.has(spec) || spec.startsWith('electron/') || realNodeModules.some(m => spec === m || spec.startsWith(m + '/'));

// Entry bundles that Electron's main process loads before any resolve hook exists.
const entries = ['main.js', 'cli.js', 'bootstrap-fork.js'];
let failed = 0;
for (const entry of entries) {
	const file = path.join(outDir, entry);
	if (!fs.existsSync(file)) { console.error(`FAIL: ${file} not found (run the bundle step first)`); failed++; continue; }
	// Re-bundle with everything external: the metafile then lists exactly the static + dynamic specifiers the file imports.
	const result = await esbuild.build({ entryPoints: [file], bundle: true, packages: 'external', platform: 'node', format: 'esm', write: false, metafile: true, logLevel: 'silent' });
	const imports = Object.values(result.metafile.inputs).flatMap(i => i.imports);
	const staticBare = [...new Set(imports.filter(i => i.external && i.kind === 'import-statement' && !allowed(i.path)).map(i => i.path))];
	if (staticBare.length) {
		failed++;
		console.error(`FAIL: ${entry} statically imports packages that the packaged app cannot resolve at startup: ${staticBare.join(', ')}`);
	} else {
		console.log(`PASS: ${entry} has no unresolvable static bare imports (${imports.filter(i => i.external).length} external specifiers, all built-ins/electron/real node_modules)`);
	}
}
process.exit(failed ? 1 : 0);
