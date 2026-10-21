#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The codebase index over real folders (electron-main/codebaseIndexer.ts): a folder that is not a git project, a git project, a change, a file taken away, the saved index read
// back, a file whose size and time did not move, secrets, and the watcher. The parts of the index one by one are codebaseIndexE2E.mjs.
// Run: node src/vs/workbench/contrib/vader/test/codebaseIndexerE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-cbx-'));
await esbuild.build({ entryPoints: [path.join(here, '../electron-main/codebaseIndexer.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'm.mjs'), logLevel: 'silent' });
const { CodebaseIndexer } = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const write = (root, rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const files = (ix, q, opts) => ix.search(q, opts).then(r => r.results.map(x => x.file));
const store = path.join(tmp, 'store');

const LIMITER = 'export class RateLimiter {\n\tprivate tokens: number;\n\tconstructor(private perMinute: number) { this.tokens = perMinute; }\n\ttryAcquire(): boolean { if (this.tokens > 0) { this.tokens--; return true; } return false; }\n}\n';
const RETRY = 'export async function retryWithBackoff(fn: () => Promise<void>) {\n\tlet delay = 100;\n\tfor (let i = 0; i < 5; i++) { try { return await fn(); } catch { await sleep(delay); delay *= 2; } }\n}\n';

// ---- a folder that is not a git project
const plain = path.join(tmp, 'plain');
write(plain, 'src/api/rateLimiter.ts', LIMITER);
write(plain, 'src/net/retry.ts', RETRY);
write(plain, 'src/config.ts', 'export function loadConfig(file: string) { return JSON.parse(file); }\n');
write(plain, 'node_modules/dep/index.js', 'module.exports = function zzNodeModulesMarker() { return "x" }\n');
write(plain, '.env', 'API_KEY=sk-live-VERYSECRETVALUE123\n');
write(plain, 'secrets.json', '{ "token": "VERYSECRETVALUE123" }\n');
write(plain, 'logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]).toString('latin1'));
write(plain, 'data.bin', 'abc\0def\0'.repeat(50));
write(plain, 'bundle.js', ('var a=1;'.repeat(100) + '\n').repeat(40));
write(plain, 'big.txt', 'word '.repeat(200000));
write(plain, 'src/skip.ts', 'export const zzHiddenMarker = "from-vaderignore"\n');
write(plain, '.vaderignore', 'src/skip.ts\n');
write(plain, '.gitignore', 'ignored/\n');
write(plain, 'ignored/x.ts', 'export const zzGitHiddenMarker = 1\n');
{
	const ix = new CodebaseIndexer(plain, store);
	await ix.sync();
	check('a folder that is not a git project is indexed, and says how much', ix.state.status === 'ready' && ix.state.files === 5 && ix.state.chunks >= 5 && ix.state.rootHash.length === 64, JSON.stringify(ix.state));
	check('a search finds the code by what it does', (await files(ix, 'rate limit tokens per minute'))[0] === 'src/api/rateLimiter.ts' && (await files(ix, 'retry with backoff'))[0] === 'src/net/retry.ts');
	check('what is in node_modules, a .gitignore, a .vaderignore is not in the index', !(await files(ix, 'zzNodeModulesMarker')).length && !(await files(ix, 'zzGitHiddenMarker')).length && !(await files(ix, 'zzHiddenMarker')).length);
	const secret = await ix.search('VERYSECRETVALUE123');
	check('the text of a file that holds a secret is never read, so no search can show it', secret.results.length === 0 && !secret.text.includes('sk-live'), JSON.stringify(secret.results));
	check('binary files, text with a NUL byte, minified files and files too big are not indexed (the five files are the three sources and the two ignore files)', ix.state.files === 5 && !(await files(ix, 'word')).includes('big.txt'));
	const r = await ix.search('rate limiter');
	check('the answer shows the lines of the file as they are, with where they are', r.text.includes('src/api/rateLimiter.ts:1-5') && r.text.includes('class RateLimiter') && r.results[0].start === 1);
	check('a search can be kept to a folder, given as a relative or an absolute path', (await files(ix, 'retry limit config', { directories: ['src/net'] })).every(f => f.startsWith('src/net/')) && (await files(ix, 'retry', { directories: [path.join(plain, 'src', 'net')] })).length === 1);
	const first = ix.state.rootHash;

	// a file whose size and time did not move is not read again: that is what makes a start on a big project cheap
	const retryPath = path.join(plain, 'src/net/retry.ts');
	const stat = fs.statSync(retryPath);
	const same = RETRY.replace('delay *= 2', 'delay *= 3'); // same length
	fs.writeFileSync(retryPath, same); fs.utimesSync(retryPath, stat.atime, stat.mtime);
	await ix.rebuildFreshForTest?.();
	ix._lastSync = 0; await ix.sync();
	check('a file whose size and time are as they were is not read again', ix.state.rootHash === first);
	fs.writeFileSync(retryPath, RETRY.replace('delay *= 2', 'delay *= 2; // jittered\n\tjitterMarker()'));
	ix._lastSync = 0; await ix.sync();
	check('a file that changed is read again, and the tree of hashes moves', ix.state.rootHash !== first && (await files(ix, 'jitterMarker'))[0] === 'src/net/retry.ts');
	write(plain, 'src/net/cache.ts', 'export function cacheLookupHelper(key: string) { return key }\n');
	ix._lastSync = 0; await ix.sync();
	check('a new file is found', (await files(ix, 'cacheLookupHelper'))[0] === 'src/net/cache.ts' && ix.state.files === 6);
	fs.rmSync(path.join(plain, 'src/net/cache.ts'));
	ix._lastSync = 0; await ix.sync();
	check('a file taken away is gone from the index', !(await files(ix, 'cacheLookupHelper')).length && ix.state.files === 5);
	check('the hash of a folder is known, and differs from the project', ix.hashOf('src') !== undefined && ix.hashOf('src') !== ix.hashOf('') && ix.hashOf('nope') === undefined);
	await ix.dispose();

	// the saved index is read back
	const again = new CodebaseIndexer(plain, store);
	const loaded = await files(again, 'rate limit tokens', { waitMs: 100 });
	check('the saved index is read back on the next start and answers at once', loaded[0] === 'src/api/rateLimiter.ts' && again.state.files >= 5, JSON.stringify(again.state));
	await again.dispose();
	check('a different folder does not take another folder’s index', (() => { const other = path.join(tmp, 'plain2'); fs.mkdirSync(other, { recursive: true }); return new CodebaseIndexer(other, store)._snapshotPath !== again._snapshotPath; })());
}

// ---- a git project
const repo = path.join(tmp, 'repo');
fs.mkdirSync(repo, { recursive: true });
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (...a) => execFileSync('git', a, { cwd: repo, env, encoding: 'utf8' });
g('init', '-b', 'main');
write(repo, 'src/app.ts', 'export function startServer(port: number) { return port }\n');
write(repo, 'build/release.js', 'export function packageRelease(version) { return version }\n');
write(repo, '.gitignore', 'dist/\nlocal.ts\n');
g('add', '-A'); g('commit', '-m', 'first');
write(repo, 'dist/out.js', 'export function zzBuiltArtifactMarker() {}\n');
write(repo, 'local.ts', 'export function zzScratchpadMarker() {}\n');
write(repo, 'src/untracked.ts', 'export function untrackedHelper() { return 1 }\n');
{
	const ix = new CodebaseIndexer(repo, store);
	await ix.sync();
	check('in a git project, git says which files exist: tracked and new files, not ignored ones', (await files(ix, 'startServer'))[0] === 'src/app.ts' && (await files(ix, 'untrackedHelper'))[0] === 'src/untracked.ts' && !(await files(ix, 'zzBuiltArtifactMarker')).length && !(await files(ix, 'zzScratchpadMarker')).length, JSON.stringify([await files(ix, 'startServer'), await files(ix, 'untrackedHelper'), await files(ix, 'zzBuiltArtifactMarker'), await files(ix, 'zzScratchpadMarker'), ix.state]));
	check('a tracked folder is code whatever it is called', (await files(ix, 'packageRelease'))[0] === 'build/release.js');
	fs.rmSync(path.join(repo, 'src/app.ts'));
	ix._lastSync = 0; await ix.sync();
	check('a tracked file deleted from disk is dropped, not read', !(await files(ix, 'startServer')).length);

	// the watcher
	ix.watch();
	const before = ix.state.updatedAt;
	write(repo, 'src/watched.ts', 'export function watchedMarker() { return 7 }\n');
	let seen = false;
	for (let i = 0; i < 40 && !seen; i++) { await wait(150); seen = ix.state.updatedAt > before && ix.state.files >= 3; }
	const hit = (await ix.search('watchedMarker', { waitMs: 50 })).results.map(r => r.file);
	check('with the watcher on, a file written is in the index within seconds, without anyone asking', hit[0] === 'src/watched.ts', JSON.stringify({ seen, hit, state: ix.state }));
	await ix.dispose();
}

// ---- a rebuild, and a bigger project
{
	const ix = new CodebaseIndexer(plain, store);
	await ix.sync();
	await ix.rebuild();
	check('a rebuild forgets the saved index and builds it again', ix.state.status === 'ready' && ix.state.files === 5);
	await ix.dispose();
	const big = path.join(tmp, 'big');
	for (let i = 0; i < 3000; i++) write(big, `pkg${i % 30}/mod${i}.ts`, `export function task${i}Handler(input: number) {\n\tconst value = input * ${i};\n\treturn value + ${i};\n}\n`);
	const bx = new CodebaseIndexer(big, store);
	const t0 = Date.now();
	await bx.sync();
	const first = Date.now() - t0;
	bx._lastSync = 0;
	const t1 = Date.now();
	await bx.sync();
	const second = Date.now() - t1;
	check(`3000 files: the first build took ${first} ms, and a second look at an unchanged project ${second} ms because nothing is read again`, bx.state.files === 3000 && second < first && second < 4000, `${first} / ${second}`);
	check('and a name is found among them', (await files(bx, 'task1234Handler'))[0] === 'pkg4/mod1234.ts');
	await bx.dispose();
}

console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
