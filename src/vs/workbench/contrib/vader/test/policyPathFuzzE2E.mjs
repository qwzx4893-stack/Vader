#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Fuzz (seeded, so a failure repeats): thousands of spellings of protected files (case, trailing dots/spaces, ::$DATA, ./ // .. detours, slashes, 8.3-free tricks) through the real policy pipeline.
// Every spelling that resolves to the protected file on Windows must be asked about (or denied); a spelling that is allowed is a bypass.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../../..').split(String.fromCharCode(92)).join('/'); // the repository root
const require = createRequire(root + '/package.json');
const esbuild = require('esbuild');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-fuzz-'));
const entry = path.join(tmp, 'e.ts');
const base = root + '/src/vs/workbench/contrib/vader';
fs.writeFileSync(entry, `export { builtInPolicyRules, ruleMatches } from '${base}/common/policy/policyService.ts';
export { policyRequestOfToolCall } from '${base}/common/policy/toolPolicyRequest.ts';
export { withResolvedPaths } from '${base}/common/policy/realPaths.ts';
export { URI } from '${root}/src/vs/base/common/uri.ts';`);
await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'p.mjs'), logLevel: 'silent', tsconfigRaw: JSON.stringify({ compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } }) });
const { builtInPolicyRules, ruleMatches, policyRequestOfToolCall, withResolvedPaths, URI } = await import(pathToFileURL(path.join(tmp, 'p.mjs')).href);

const verdict = (req) => { for (const r of builtInPolicyRules) { if (r.effect === 'deny' && ruleMatches(r, req)) { return 'deny'; } } for (const r of builtInPolicyRules) { if (r.effect === 'ask' && ruleMatches(r, req)) { return 'ask'; } } return 'allow'; };
const viaFileTool = async (tool, p) => { const req = policyRequestOfToolCall(tool, { uri: URI.file(p) }, true, undefined, undefined); return verdict({ ...req, filePaths: await withResolvedPaths(async (u) => u, req.filePaths) }); };

let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296; const pick = (a) => a[Math.floor(rnd() * a.length)];
const caseMix = (s) => [...s].map(c => rnd() < 0.3 ? (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()) : c).join('');
const decorate = (seg, isLast) => { let s = caseMix(seg); if (rnd() < 0.25) { s += pick(['.', '..', '...', ' ', '. ', ' .', '  ']); } if (isLast && rnd() < 0.2) { s += pick(['::$DATA', ':stream', ':s:$DATA']); } return s; };
const sep = () => pick(['/', '\\', '//', '\\\\', '/./', '\\.\\', '/', '/']);
const detour = () => pick(['', '', '', 'x/../', 'x\\..\\', './', '.\\', 'a/b/../../']);
const targets = [
	{ name: 'tasks', segs: ['.vscode', 'tasks.json'], tools: ['edit_file', 'rewrite_file', 'create_file_or_folder', 'delete_file_or_folder'] },
	{ name: 'hook', segs: ['.git', 'hooks', 'pre-commit'], tools: ['edit_file', 'create_file_or_folder'] },
	{ name: 'ssh', segs: ['Users', 'me', '.ssh', 'id_rsa'], tools: ['read_file', 'edit_file'] },
	{ name: 'env', segs: ['proj', '.env'], tools: ['read_file', 'edit_file'] },
	{ name: 'system', segs: ['Windows', 'System32', 'cmd.exe'], tools: ['edit_file', 'delete_file_or_folder'], deny: true },
];
let n = 0, bad = []; const N = 4000;
for (let i = 0; i < N; i++) {
	const t = pick(targets);
	let p = pick(['c:', 'C:', 'c:/proj', 'D:/work/proj', 'c:/Users/me/proj']);
	if (t.name === 'ssh' || t.name === 'system' || t.name === 'env') { p = pick(['c:', 'C:']) + (t.name === 'env' ? '/proj' : ''); }
	const segs = t.name === 'ssh' ? t.segs : t.segs;
	p += sep() + detour();
	segs.forEach((s, k) => { p += decorate(s, k === segs.length - 1) + (k < segs.length - 1 ? sep() + detour() : ''); });
	// the file tool refuses network-share and extended-length prefixes before the policy runs, so those are not generated
	const tool = pick(t.tools);
	const v = await viaFileTool(tool, p); n++;
	const ok = t.deny ? v === 'deny' : v !== 'allow';
	if (!ok) { bad.push(`${v.toUpperCase()}  ${tool}  ${JSON.stringify(p)}`); }
}
console.log(`${bad.length === 0 ? 'PASS' : 'FAIL'}: ${n} generated spellings of protected files, ${bad.length} bypassed`);
for (const b of bad.slice(0, 25)) { console.log('  ' + b); }
fs.rmSync(tmp, { recursive: true, force: true });
// Measured on the code before the fixes (git 9d3f9602): 1264 of the same 4000 spellings got through, among them deletes of a system file the locked rule is meant to block.
process.exit(bad.length ? 1 : 0);
