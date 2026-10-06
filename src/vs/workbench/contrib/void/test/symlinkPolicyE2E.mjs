#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The Policy Engine and agent scopes match globs against the path a tool call names. Found by attacking the file tools the way a
// prompt-injected model would: (1) a path through a symbolic link inside the workspace (`docs/credentials`, `docs` -> `~/.aws`)
// matched none of the secret-file rules, (2) `..` segments were never collapsed (`/ws/src/../../etc/shadow` slipped past the locked
// system-file deny), (3) a permanent agent with a filesystem scope could not touch ANY file, in scope or not.
// This test uses the REAL rules, the REAL resolver and the REAL scope check (bundled from source) and REAL symbolic links on disk.
//
// Run: node src/vs/workbench/contrib/void/test/symlinkPolicyE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-symlink-'));
const bundle = async (entry, name) => {
	await esbuild.build({ entryPoints: [path.join(here, entry)], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, name), logLevel: 'silent' });
	return import(pathToFileURL(path.join(tmp, name)).href);
};
const { builtInPolicyRules, ruleMatches } = await bundle('../common/policy/policyService.ts', 'policy.mjs');
const { withResolvedPaths, normalizeDotSegments } = await bundle('../common/policy/realPaths.ts', 'real.mjs');
const { agentScopeCheck } = await bundle('../common/agents/agentScope.ts', 'scope.mjs');
const { URI } = await bundle('../../../../base/common/uri.ts', 'uri.mjs');

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

// the same function the app injects (IFileService.realpath), backed by the real file system
const realpath = async (uri) => URI.file(fs.realpathSync(uri.fsPath));
const rules = (effect) => builtInPolicyRules.filter(r => r.effect === effect);
const verdict = (kind, paths) => rules('deny').some(r => ruleMatches(r, { kind, toolName: 'edit_file', filePaths: paths })) ? 'deny'
	: rules('ask').some(r => ruleMatches(r, { kind, toolName: 'edit_file', filePaths: paths })) ? 'ask' : 'allow';
const gate = async (kind, p) => verdict(kind, await withResolvedPaths(realpath, [p]));

// ---- a workspace with links that lead to places the rules protect
const home = path.join(tmp, 'home'); const ws = path.join(tmp, 'work', 'project');
fs.mkdirSync(path.join(home, '.aws'), { recursive: true }); fs.mkdirSync(path.join(home, '.ssh'), { recursive: true });
fs.mkdirSync(path.join(ws, 'src'), { recursive: true }); fs.mkdirSync(path.join(ws, '.vscode'), { recursive: true });
fs.writeFileSync(path.join(home, '.aws', 'credentials'), '[default]\naws_secret_access_key = X\n');
fs.writeFileSync(path.join(home, '.ssh', 'id_rsa'), 'KEY');
fs.writeFileSync(path.join(ws, 'src', 'app.js'), '1');
fs.writeFileSync(path.join(ws, 'README.md'), '#');
let linksWork = true;
try {
	fs.symlinkSync(path.join(home, '.aws'), path.join(ws, 'docs'), 'junction'); // a directory link (a junction on Windows: no privilege needed)
	fs.symlinkSync(path.join(home, '.ssh'), path.join(ws, 'keys'), 'junction');
	fs.symlinkSync(path.join(home, '.aws', 'credentials'), path.join(ws, 'notes.txt'), 'file'); // a file link
} catch (e) { linksWork = false; console.log(`SKIP symlink checks: cannot create links here (${e.code})`); }

if (linksWork) {
	// the bug: the written path alone matches no secret rule
	check('as written, docs/credentials matches no secret rule (the gap a symlink used to open)', verdict('file-read', [path.join(ws, 'docs', 'credentials')]) === 'allow');
	check('a read of docs/credentials (docs -> ~/.aws) now asks', await gate('file-read', path.join(ws, 'docs', 'credentials')) === 'ask');
	check('a read through a FILE link (notes.txt -> ~/.aws/credentials) now asks', await gate('file-read', path.join(ws, 'notes.txt')) === 'ask');
	check('writing a NEW file inside a linked directory (keys/authorized_keys -> ~/.ssh) now asks', await gate('file-write', path.join(ws, 'keys', 'authorized_keys')) === 'ask');
	check('deleting through a link asks', await gate('file-delete', path.join(ws, 'keys', 'id_rsa')) === 'ask');
	check('an ordinary file in the workspace is still allowed', await gate('file-read', path.join(ws, 'src', 'app.js')) === 'allow');
	check('a new ordinary file in the workspace is still allowed', await gate('file-write', path.join(ws, 'src', 'new.js')) === 'allow');
	check('a path that does not exist at all (nothing to resolve) is judged as written', await gate('file-write', path.join(tmp, 'nowhere', 'x', 'y.txt')) === 'allow');

	// link loops must terminate
	fs.symlinkSync(path.join(ws, 'loop-b'), path.join(ws, 'loop-a'), 'junction'); fs.symlinkSync(path.join(ws, 'loop-a'), path.join(ws, 'loop-b'), 'junction');
	const t0 = Date.now(); const loopPaths = await withResolvedPaths(realpath, [path.join(ws, 'loop-a', 'x.txt')]);
	check('a link loop does not hang or throw', Date.now() - t0 < 2000 && loopPaths.includes(path.join(ws, 'loop-a', 'x.txt')));
}

// ---- `..` segments
check('normalizeDotSegments collapses ..', normalizeDotSegments('/ws/src/../../etc/shadow') === '/etc/shadow');
check('normalizeDotSegments keeps a relative leading ..', normalizeDotSegments('../a/./b') === '../a/b');
check('normalizeDotSegments handles Windows paths', normalizeDotSegments('c:\\work\\proj\\..\\..\\Windows\\x.dll') === 'c:\\Windows\\x.dll');
check('normalizeDotSegments cannot climb above the root', normalizeDotSegments('/../../etc') === '/etc');
check('the locked system-file deny is no longer walked around with ..', verdict('file-write', await withResolvedPaths(async () => undefined, ['/work/project/src/../../../etc/shadow'])) === 'deny');
check('...and the same path as written alone was NOT denied (the old behaviour)', verdict('file-write', ['/work/project/src/../../../etc/shadow']) !== 'deny');
check('a provider that cannot resolve links still gets the lexical form', (await withResolvedPaths(async () => undefined, ['/a/b/../c'])).includes('/a/c'));

// ---- the resolver never hangs or throws
{
	const t = Date.now(); const r = await withResolvedPaths(() => new Promise(() => { }), ['/some/path']);
	check(`a file system that never answers costs at most a few seconds (${Date.now() - t} ms) and keeps the original path`, Date.now() - t < 4500 && r.length === 1 && r[0] === '/some/path');
	const r2 = await withResolvedPaths(async () => { throw new Error('boom'); }, ['/some/path']);
	check('a file system that always fails leaves the original path', r2.length === 1 && r2[0] === '/some/path');
}

// ---- autorun/config files and the wider credential list (rules)
const askWrite = (p) => verdict('file-write', [p]) === 'ask';
for (const p of ['/w/p/.vscode/tasks.json', '/w/p/.vscode/settings.json', '/w/p/.vscode/launch.json', '/w/p/.git/hooks/pre-commit', '/w/p/.git/config', '/w/p/.husky/pre-push', '/w/p/.envrc', '/w/p/.devcontainer/devcontainer.json', '/w/p/mcp.json', '/w/p/.vaderrules', '/home/me/.bashrc', '/home/me/.zshrc', '/home/me/.profile', '/home/me/.config/fish/config.fish', 'c:/Users/me/Documents/PowerShell/Microsoft.PowerShell_profile.ps1'])
	check(`writing ${p} asks (it can run code later)`, askWrite(p));
for (const p of ['/w/p/src/index.ts', '/w/p/package.json', '/w/p/.vscode/extensions.json', '/w/p/README.md', '/w/p/.github/workflows/ci.yml'])
	check(`writing ${p} does not ask`, !askWrite(p));
for (const p of ['/home/me/.git-credentials', '/home/me/.config/gh/hosts.yml', '/home/me/.config/gcloud/credentials.db', '/home/me/.azure/accessTokens.json', '/home/me/.gnupg/private-keys-v1.d/x.key', '/home/me/.pgpass', '/home/me/.pypirc', '/w/p/infra/prod.tfvars', '/w/p/id_ecdsa', '/w/p/release.jks'])
	check(`reading ${p} asks (credential file)`, verdict('file-read', [p]) === 'ask');
check('the autorun rule can be switched off by the user (not locked), unlike the hard denies', builtInPolicyRules.find(r => r.id === 'vader.ask.autorun-config')?.locked === false);
check('...but is never bypassed by autonomous agents', builtInPolicyRules.find(r => r.id === 'vader.ask.autorun-config')?.neverBypassAutonomous === true);

// ---- agent filesystem scope (it denied every file, in scope or not)
const roots = ['/work/project'];
const scope = (globs, paths, r = roots) => agentScopeCheck(globs, paths, r).ok;
check('no scope: everything is allowed', scope(undefined, ['/anything']) && scope([], ['/anything']));
check('a relative glob allows a file inside it', scope(['src/**'], ['/work/project/src/a/b.ts']));
check('...and denies a file outside it', !scope(['src/**'], ['/work/project/README.md']));
check('**/*.md allows markdown anywhere', scope(['**/*.md'], ['/work/project/docs/x/y.md']) && !scope(['**/*.md'], ['/work/project/src/a.ts']));
check('several globs: any one is enough', scope(['src/**', 'docs/**'], ['/work/project/docs/a.md']));
check('an absolute glob works', scope(['/srv/data/**'], ['/srv/data/x.csv']) && !scope(['/srv/data/**'], ['/srv/other/x.csv']));
check('a Windows drive glob works, case-insensitively', scope(['c:/work/**'], ['C:\\Work\\a.txt'], []));
check('./src/** is the same as src/**', scope(['./src/**'], ['/work/project/src/a.ts']));
check('a path outside every workspace folder is out of a relative scope', !scope(['src/**'], ['/etc/passwd']));
check('EVERY path must be in scope (written and resolved): a link inside src that leads out is denied', !scope(['src/**'], ['/work/project/src/link/key', '/home/me/.ssh/key']));
check('..-walking out of the scope is caught once the path is normalised', !scope(['src/**'], await withResolvedPaths(async () => undefined, ['/work/project/src/../README.md'])));
check('a second workspace folder is honoured', scope(['src/**'], ['/other/src/a.ts'], ['/work/project', '/other']));
check('a glob of only whitespace allows nothing', !scope(['  '], ['/work/project/a']));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
