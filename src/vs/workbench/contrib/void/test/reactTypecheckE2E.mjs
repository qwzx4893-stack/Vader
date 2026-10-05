#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Type-checks the chat/settings UI sources. The UI bundle is built without type checking and the main
// `tsc -p src/tsconfig.json` project does not include it, so real errors sat there unseen: 28 tools Vader added had no
// entry in the chat's tool tables, which made every message about them render as nothing (no result, and no
// Approve/Reject buttons for tools that needed approval).
//
// The React project also pulls in VS Code sources it cannot fully type (CSS imports, a Node namespace); only errors located
// in the UI sources themselves are reported, minus those two known-benign kinds.
//
// Run: node src/vs/workbench/contrib/void/test/reactTypecheckE2E.mjs

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const win = process.platform === 'win32';
const tsc = path.join(repo, 'node_modules', '.bin', win ? 'tsc.cmd' : 'tsc'); // the repo's own (native) TypeScript
const r = spawnSync(tsc, ['-p', 'src/vs/workbench/contrib/void/browser/react/tsconfig.json', '--noEmit'], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: win });
const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
const lines = out.split('\n');
// Guard against a false green: this project always reports a few known-benign errors, so a run with a non-zero exit
// and no `error TS` lines at all means the compiler did not actually run.
if (r.error || (r.status !== 0 && !/error TS\d+/.test(out))) {
	console.error(`FAIL: the TypeScript compiler did not run properly (status ${r.status}): ${String(r.error ?? out).slice(0, 400)}`);
	process.exit(1);
}
const own = lines.filter(l => l.startsWith('src/vs/workbench/contrib/void/browser/react/src/') && !/TS2882|TS2503/.test(l));
if (own.length) {
	own.forEach(l => console.error(`FAIL: ${l.slice(0, 400)}`));
	console.error(`\n${own.length} type error(s) in the chat/settings UI sources`);
	process.exit(1);
}
console.log('PASS: the chat/settings UI sources type-check (tool tables are complete, props match)');
