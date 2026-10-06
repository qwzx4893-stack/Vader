#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The built-in npm extension used `which-pm` (YAML parser) and `find-yarn-workspace-root` (micromatch/braces); both carry open
// denial-of-service advisories reachable from files in the opened workspace, so Vader replaced them with small local code in
// extensions/npm/src/preferred-pm.ts. This bundles the real file (with the `vscode` API replaced by a thin fs-backed stub) and
// checks that package-manager detection still gives the same answers on real directory layouts, including hostile inputs.
//
// Run: node src/vs/workbench/contrib/void/test/npmExtensionPreferredPmE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const ext = path.join(repo, 'extensions/npm');
const esbuild = createRequire(path.join(repo, 'package.json'))('esbuild');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-pm-'));
fs.writeFileSync(path.join(tmp, 'vscode-stub.mjs'), `
import fs from 'node:fs';
export const Uri = { file: p => ({ fsPath: p }) };
export const workspace = { fs: { stat: async u => { fs.statSync(u.fsPath); } } };
`);
await esbuild.build({
	entryPoints: [path.join(ext, 'src/preferred-pm.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'pm.mjs'), logLevel: 'silent',
	nodePaths: [path.join(ext, 'node_modules')], alias: { vscode: path.join(tmp, 'vscode-stub.mjs') },
	banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
const { findPreferredPM } = await import(pathToFileURL(path.join(tmp, 'pm.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const mk = (rel, files = {}) => { const d = path.join(tmp, rel); fs.mkdirSync(d, { recursive: true }); for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); } return d; };

check('npm lockfile -> npm', (await findPreferredPM(mk('a', { 'package-lock.json': '{}' }))).name === 'npm');
check('pnpm lockfile -> pnpm', (await findPreferredPM(mk('b', { 'pnpm-lock.yaml': '' }))).name === 'pnpm');
check('yarn.lock -> yarn', (await findPreferredPM(mk('c', { 'yarn.lock': '' }))).name === 'yarn');
check('bun.lock -> bun', (await findPreferredPM(mk('d', { 'bun.lock': '' }))).name === 'bun');
mk('ws', { 'package.json': JSON.stringify({ workspaces: ['packages/*'] }) });
check('a package inside a yarn workspace -> yarn', (await findPreferredPM(mk('ws/packages/app', { 'package.json': '{}' }))).name === 'yarn');
mk('ws2', { 'package.json': JSON.stringify({ workspaces: { packages: ['libs/*'] } }) });
check('workspaces given as { packages: [...] } -> yarn', (await findPreferredPM(mk('ws2/libs/x'))).name === 'yarn');
check('a folder outside every workspace pattern is not matched', (await findPreferredPM(mk('ws/other/thing'))).name !== 'yarn');
check('.modules.yaml names pnpm', (await findPreferredPM(mk('e', { 'node_modules/.modules.yaml': "layoutVersion: 5\npackageManager: pnpm@9.1.0\n" }))).name === 'pnpm');
check('.yarn-integrity -> yarn', (await findPreferredPM(mk('f', { 'node_modules/.yarn-integrity': '' }))).name === 'yarn');
check('bare node_modules -> npm', (await findPreferredPM(mk('g', { 'node_modules/x/index.js': '' }))).name === 'npm');
check('nothing at all -> npm (default)', (await findPreferredPM(mk('h'))).name === 'npm');
check('two lockfiles are reported', (await findPreferredPM(mk('i', { 'package-lock.json': '{}', 'yarn.lock': '' }))).multipleLockFilesDetected === true);

// hostile inputs: must neither hang nor throw
const evilYaml = "a: &a [x]\nb: <<: [*a,*a,*a,*a,*a,*a,*a,*a]\n".repeat(20000);
let t = Date.now(); let r1; try { r1 = await findPreferredPM(mk('j', { 'node_modules/.modules.yaml': evilYaml })); } catch (e) { r1 = e; }
check('a merge-key bomb in .modules.yaml is harmless and fast', !(r1 instanceof Error) && Date.now() - t < 1000, String(r1));
const evilGlob = '{'.repeat(50000) + 'a' + '}'.repeat(50000);
mk('k', { 'package.json': JSON.stringify({ workspaces: [evilGlob] }) });
t = Date.now(); let r2; try { r2 = await findPreferredPM(mk('k/sub')); } catch (e) { r2 = e; }
check('deeply nested braces in a workspaces pattern are harmless and fast', !(r2 instanceof Error) && Date.now() - t < 1000, String(r2));
mk('l', { 'package.json': '{"workspaces": ["*"], "pad": "' + 'x'.repeat(2_000_000) + '"}' });
t = Date.now(); let r3; try { r3 = await findPreferredPM(mk('l/sub')); } catch (e) { r3 = e; }
check('an oversized package.json is ignored', !(r3 instanceof Error) && Date.now() - t < 1000, String(r3));

console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
