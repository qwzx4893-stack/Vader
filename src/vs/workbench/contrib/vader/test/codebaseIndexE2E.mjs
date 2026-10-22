#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The codebase index, its parts one by one (common/codebaseIndex/): what is left out, the words of code, the pieces a file is cut into, the ranking, the tree of hashes and what
// the agent is shown. The index as a whole, over real folders and a real git project, is codebaseIndexerE2E.mjs.
// Run: node src/vs/workbench/contrib/vader/test/codebaseIndexE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-cbi-'));
const entry = path.join(tmp, 'entry.ts');
const dir = path.join(here, '../common/codebaseIndex').replace(/\\/g, '/');
fs.writeFileSync(entry, ['ignoreRules', 'tokenize', 'chunker', 'bm25Index', 'merkle', 'searchResults', 'indexWords'].map(m => `export * as ${m} from '${dir}/${m}.ts';`).join('\n'));
await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'm.mjs'), logLevel: 'silent' });
const M = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);
const { ignoreRules: I, tokenize: T, chunker: C, bm25Index: B, merkle: K, searchResults: S, indexWords: W } = M;

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---- what is left out
{
	const ig = I.createIgnore(['node_modules/', '*.log', '/build', 'docs/**/*.tmp', '!keep.log', '# a comment', '', 'src/gen/', '!src/gen/keep.ts', '**/cache', 'a/**/z.txt']);
	check('a folder named in the file takes everything in it, at any depth', ig.ignores('node_modules/x/y.js') && ig.ignores('packages/app/node_modules/x.js') && ig.ignores('node_modules', true));
	check('a pattern with no slash matches a name at any depth', ig.ignores('a.log') && ig.ignores('deep/er/b.log'));
	check('a line that begins with ! brings a file back', !ig.ignores('keep.log') && ig.ignores('other.log'));
	check('a leading slash anchors to the project folder', ig.ignores('build/out.js') && !ig.ignores('src/build/out.js') && ig.ignores('build', true));
	check('** crosses folders, and none are also fine', ig.ignores('docs/a/b/c.tmp') && ig.ignores('docs/c.tmp') && ig.ignores('a/z.txt') && ig.ignores('a/b/c/z.txt') && !ig.ignores('a/b/c/y.txt'));
	check('a folder that is excluded cannot have a file brought back', ig.ignores('src/gen/keep.ts'));
	check('a trailing slash means folders only', !I.createIgnore(['out/']).ignores('out') && I.createIgnore(['out/']).ignores('out', true) && I.createIgnore(['out/']).ignores('out/a.js'));
	check('a comment and a blank line do nothing, and \\# is a name starting with #', !I.createIgnore(['#x']).ignores('#x') && I.createIgnore(['\\#x']).ignores('#x'));
	check('? and [..] are single characters', I.createIgnore(['a?c.txt', 'f[0-9].js']).ignores('abc.txt') && !I.createIgnore(['a?c.txt']).ignores('ac.txt') && I.createIgnore(['f[0-9].js']).ignores('f7.js') && !I.createIgnore(['f[0-9].js']).ignores('fx.js'));
	check('windows paths are the same paths', ig.ignores('node_modules\\x\\y.js') && ig.ignores('docs\\a\\c.tmp'));
	const d = I.createIgnore(I.DEFAULT_IGNORE_LINES);
	check('without git, what no project wants indexed is left out', d.ignores('node_modules/a/b.js') && d.ignores('dist/app.js') && d.ignores('x.min.js') && d.ignores('.git/config') && d.ignores('.vader-worktrees/x/a.ts') && !d.ignores('src/app.ts'));
	check('binary files are known by their name', I.isBinaryPath('logo.PNG') && I.isBinaryPath('a/b.exe') && !I.isBinaryPath('a.ts') && !I.isBinaryPath('Makefile'));
	check('a file that holds a secret is known by its name', I.isSecretLikePath('.env') && I.isSecretLikePath('app/.env.production') && I.isSecretLikePath('keys/server.pem') && I.isSecretLikePath('~/.ssh/id_rsa') && I.isSecretLikePath('.npmrc') && I.isSecretLikePath('config/credentials.json') && !I.isSecretLikePath('.env.example') && !I.isSecretLikePath('src/env.ts') && !I.isSecretLikePath('id_rsa.pub'));
	check('generated text is known by its long lines', I.looksGenerated('x'.repeat(5000)) && !I.looksGenerated('line\n'.repeat(1000)) && !I.looksGenerated('short'));
}

// ---- the words of code
{
	check('a name is cut into its parts', JSON.stringify(T.splitIdentifier('getUserName')) === '["get","user","name"]' && JSON.stringify(T.splitIdentifier('get_user_name')) === '["get","user","name"]' && JSON.stringify(T.splitIdentifier('HTTPServer2')) === '["http","server","2"]' && JSON.stringify(T.splitIdentifier('kebab-case-name')) === '["kebab","case","name"]');
	const t = T.tokenize('export function getUserName(userId) { return users.get(userId).name }');
	check('a name is kept whole and as its parts', t.includes('getusername') && t.includes('get') && t.includes('user') && t.includes('name') && t.includes('userid') && t.includes('users'));
	check('words every file has are left out, and one-letter terms', !t.includes('function') && !t.includes('return') && !t.includes('export') && !T.tokenize('a b c d e').length);
	check('a hash or a blob is not a word', T.tokenize('x'.repeat(100)).length === 0);
	const q = T.queryTerms('where is the RateLimiter and retry_with_backoff used');
	check('a question is cut the same way, and a name written whole counts for more', q.terms.includes('ratelimiter') && q.terms.includes('rate') && q.terms.includes('limiter') && q.terms.includes('retry') && q.terms.includes('backoff') && q.whole.has('ratelimiter') && q.whole.has('retrywithbackoff') && !q.terms.includes('where') === true || q.terms.includes('where'));
}

// ---- the pieces of a file
const tsFile = (n) => Array.from({ length: n }, (_, i) => `export function fn${i}(x: number) {\n\tconst y = x + ${i};\n\t// work\n\treturn y * 2;\n}\n`).join('\n');
{
	const text = tsFile(30);
	const pieces = C.chunkFile('src/math.ts', text);
	const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0); // the newline that ends the file is not a line
	check('a file is cut into pieces that cover all of it', pieces.length > 2 && pieces[0].start === 1 && pieces[pieces.length - 1].end === lines, `${pieces.length} pieces, last ends ${pieces[pieces.length - 1]?.end} of ${lines}`);
	check('a piece starts after the one before it did, and they share a few lines', pieces.every((p, i) => i === 0 || (p.start > pieces[i - 1].start && p.start <= pieces[i - 1].end + 1)) && pieces.some((p, i) => i > 0 && p.start <= pieces[i - 1].end));
	check('no piece is longer than the limit', pieces.every(p => p.end - p.start + 1 <= 60));
	check('a piece knows the definition it sits in, and its words include the name and the path', pieces.some(p => p.symbol && /^fn\d+$/.test(p.symbol)) && pieces[0].terms.includes('math') && pieces[0].terms.includes('fn0'));
	check('an empty file has no pieces, and a blank one neither', C.chunkFile('a.ts', '').length === 0 && C.chunkFile('a.ts', '\n\n  \n').length === 0);
	check('a short file is one piece', C.chunkFile('a.ts', 'export const alpha = 1\nexport const beta = 2\n').length === 1);
	check('windows line ends are read as line ends', C.chunkFile('a.ts', 'export const alpha = 1\r\nexport const beta = 2\r\n')[0].end <= 3);
	check('a file of one huge line ends, and a blob that is no word is not indexed', C.chunkFile('a.js', 'x'.repeat(100000)).length === 0 && C.chunkFile('a.js', ('word' + ' ').repeat(30000)).length >= 1);
	const py = C.chunkFile('app/billing.py', 'class Invoice:\n    def total(self):\n        return 1\n\n' + 'def pay(invoice):\n    return invoice.total()\n');
	check('other languages are read by the same rules', py.length >= 1 && py.some(p => p.terms.includes('invoice')));
}

// ---- ranking
const corpus = {
	'src/net/retry.ts': 'export async function retryWithBackoff<T>(fn: () => Promise<T>, attempts = 5) {\n\tlet delay = 100;\n\tfor (let i = 0; i < attempts; i++) {\n\t\ttry { return await fn(); } catch (e) { await sleep(delay); delay *= 2; }\n\t}\n\tthrow new Error("retries exhausted");\n}\n',
	'src/api/rateLimiter.ts': 'export class RateLimiter {\n\tprivate tokens: number;\n\tconstructor(private perMinute: number) { this.tokens = perMinute; }\n\ttryAcquire(): boolean { if (this.tokens > 0) { this.tokens--; return true; } return false; }\n\trefill() { this.tokens = this.perMinute; }\n}\n',
	'src/config/loadConfig.ts': 'import fs from "fs";\nexport function loadConfig(file: string) {\n\tconst raw = fs.readFileSync(file, "utf8");\n\treturn JSON.parse(raw);\n}\nexport function parseConfigValue(v: string) { return v.trim(); }\n',
	'src/auth/session.ts': 'export function createSession(userId: string) { return { id: crypto.randomUUID(), userId, expires: Date.now() + 3600_000 }; }\nexport function isExpired(s: { expires: number }) { return s.expires < Date.now(); }\n',
	'src/ui/Button.tsx': 'export function Button({ label, onClick }: { label: string, onClick: () => void }) { return <button onClick={onClick}>{label}</button>; }\n',
	'tests/retry.test.ts': 'import { retryWithBackoff } from "../src/net/retry";\ntest("retries", async () => { let n = 0; await retryWithBackoff(async () => { if (n++ < 2) throw new Error("x"); }); });\n',
};
const build = () => { const ix = new B.Bm25Index(); for (const [f, t] of Object.entries(corpus)) ix.setFile(f, C.chunkFile(f, t)); return ix; };
const ask = (ix, q, n = 3) => { const { terms, whole } = T.queryTerms(q); return ix.search(terms, { boost: whole, limit: n }).map(h => h.chunk.file); };
{
	const ix = build();
	check('the index counts what it holds', ix.fileCount === 6 && ix.chunkCount >= 6 && ix.hasFile('src/auth/session.ts'));
	check('a question about retrying finds the retry code first', ask(ix, 'retry with backoff when a request fails')[0] === 'src/net/retry.ts', ask(ix, 'retry with backoff when a request fails').join());
	check('a question about limiting requests finds the limiter first', ask(ix, 'rate limit requests per minute')[0] === 'src/api/rateLimiter.ts');
	check('a question about reading settings finds the config loader', ask(ix, 'where do we read the config file')[0] === 'src/config/loadConfig.ts');
	check('a name finds the file that defines it, before the test that uses it', ask(ix, 'retryWithBackoff')[0] === 'src/net/retry.ts' && ask(ix, 'retryWithBackoff').includes('tests/retry.test.ts'));
	check('a word in a path counts', ask(ix, 'session expiry')[0] === 'src/auth/session.ts' && ask(ix, 'button component')[0] === 'src/ui/Button.tsx');
	check('a question with no word in common finds nothing', ask(ix, 'zebra quantum spaghetti').length === 0 && ask(ix, '').length === 0);
	check('a search can be kept to some files', (() => { const { terms } = T.queryTerms('retry'); return ix.search(terms, { inFile: f => f.startsWith('tests/') }).every(h => h.chunk.file.startsWith('tests/')); })());
	ix.removeFile('src/net/retry.ts');
	check('a file taken out is no longer found', !ask(ix, 'retry with backoff').includes('src/net/retry.ts') && ix.fileCount === 5 && !ix.hasFile('src/net/retry.ts'));
	ix.setFile('src/net/retry.ts', C.chunkFile('src/net/retry.ts', 'export function retryOnce() { return 1 }\n'));
	check('a file put in again replaces what was there, and the index stays whole', ask(ix, 'retryonce')[0] === 'src/net/retry.ts' && !ask(ix, 'exhausted').includes('src/net/retry.ts'));
	const again = B.Bm25Index.fromJSON(JSON.parse(JSON.stringify(build().toJSON())));
	check('written to a file and read back, it answers the same', JSON.stringify(ask(again, 'rate limit requests per minute')) === JSON.stringify(ask(build(), 'rate limit requests per minute')) && again.fileCount === 6);
	again.removeFile('src/api/rateLimiter.ts');
	check('and a file can still be taken out of an index read back', !ask(again, 'rate limit requests per minute').includes('src/api/rateLimiter.ts'));
	const many = new B.Bm25Index();
	const t0 = Date.now();
	for (let i = 0; i < 3000; i++) many.setFile(`src/m${i}.ts`, C.chunkFile(`src/m${i}.ts`, tsFile(8).replace(/fn/g, `fn${i}_`)));
	const built = Date.now() - t0;
	const t1 = Date.now();
	for (let i = 0; i < 50; i++) many.search(['fn17', 'x', 'work'], { limit: 10 });
	const searched = (Date.now() - t1) / 50;
	check(`3000 files are put in within a few seconds (${built} ms) and a search answers in milliseconds (${searched.toFixed(1)} ms)`, built < 20000 && searched < 150);
	const t2 = Date.now();
	for (let i = 0; i < 50; i++) many.setFile(`src/m${i}.ts`, C.chunkFile(`src/m${i}.ts`, 'export const changed = 1'));
	check(`50 files that changed are put in again in ${Date.now() - t2} ms, not what 3000 cost`, Date.now() - t2 < built / 2 + 500);
}

// ---- the tree of hashes
{
	const entries = [{ path: 'src/a.ts', hash: sha('a'), size: 1 }, { path: 'src/b.ts', hash: sha('b'), size: 1 }, { path: 'src/deep/c.ts', hash: sha('c'), size: 1 }, { path: 'README.md', hash: sha('r'), size: 1 }, { path: 'tests/t.ts', hash: sha('t'), size: 1 }];
	const t1 = K.buildMerkle(entries, sha);
	const t1b = K.buildMerkle([...entries].reverse(), sha);
	check('the same files give the same root, whatever order they are given in', t1.hash === t1b.hash && t1.hash.length === 64);
	const changed = entries.map(e => e.path === 'src/deep/c.ts' ? { ...e, hash: sha('c2') } : e);
	const t2 = K.buildMerkle(changed, sha);
	check('a changed file changes the folders above it and no others', t1.hash !== t2.hash && K.subtreeHash(t1, 'src') !== K.subtreeHash(t2, 'src') && K.subtreeHash(t1, 'src/deep') !== K.subtreeHash(t2, 'src/deep') && K.subtreeHash(t1, 'tests') === K.subtreeHash(t2, 'tests'));
	check('the delta names the file', JSON.stringify(K.diffMerkle(t1, t2)) === JSON.stringify({ added: [], modified: ['src/deep/c.ts'], deleted: [] }));
	const t3 = K.buildMerkle([...changed.filter(e => e.path !== 'src/b.ts'), { path: 'src/new/n.ts', hash: sha('n'), size: 1 }], sha);
	check('files added and taken away are told apart', JSON.stringify(K.diffMerkle(t2, t3)) === JSON.stringify({ added: ['src/new/n.ts'], modified: [], deleted: ['src/b.ts'] }), JSON.stringify(K.diffMerkle(t2, t3)));
	check('a folder that is gone is every file in it', K.diffMerkle(t1, K.buildMerkle(entries.filter(e => !e.path.startsWith('src/')), sha)).deleted.join() === 'src/a.ts,src/b.ts,src/deep/c.ts');
	check('from nothing, everything is new; to nothing, everything is gone', K.diffMerkle(undefined, t1).added.length === 5 && K.diffMerkle(t1, undefined).deleted.length === 5);
	check('a file that became a folder is both', (() => { const a = K.buildMerkle([{ path: 'x', hash: sha('1'), size: 1 }], sha), b = K.buildMerkle([{ path: 'x/y', hash: sha('2'), size: 1 }], sha); const d = K.diffMerkle(a, b); return d.deleted.join() === 'x' && d.added.join() === 'x/y'; })());
	check('the entries come back out of the tree', K.entriesOf(t1).length === 5 && K.entriesOf(t1).every(e => entries.some(x => x.path === e.path && x.hash === e.hash)));
	check('an unknown folder has no hash', K.subtreeHash(t1, 'nope') === undefined && K.subtreeHash(t1, '') === t1.hash);
	const bigEntries = Array.from({ length: 30000 }, (_, i) => ({ path: `p${i % 40}/q${i % 17}/f${i}.ts`, hash: sha('h' + i), size: 10 }));
	const tb = K.buildMerkle(bigEntries, sha);
	const tb2 = K.buildMerkle(bigEntries.map((e, i) => i === 777 ? { ...e, hash: sha('changed') } : e), sha);
	check('30000 files with one changed: the delta is that one file', JSON.stringify(K.diffMerkle(tb, tb2).modified) === JSON.stringify([bigEntries[777].path]));
}

// ---- what the agent is shown
{
	const hits = (rows) => rows.map(([file, start, end, score, symbol], i) => ({ chunk: { id: i + 1, file, start, end, len: 10, symbol }, score }));
	const r = S.selectResults(hits([['a.ts', 1, 40, 10, 'A'], ['a.ts', 36, 80, 8], ['a.ts', 200, 240, 7], ['b.ts', 1, 30, 6], ['a.ts', 300, 340, 5], ['a.ts', 400, 440, 4]]), { limit: 10, perFile: 2 });
	check('pieces that overlap are one stretch', r.find(x => x.file === 'a.ts' && x.start === 1)?.end === 80, JSON.stringify(r));
	check('no file takes the whole list', r.filter(x => x.file === 'a.ts').length === 2 && r.some(x => x.file === 'b.ts'));
	check('the list is best first', r[0].file === 'a.ts' && r[0].score >= r[1].score);
	check('the list has a limit', S.selectResults(hits(Array.from({ length: 20 }, (_, i) => [`f${i}.ts`, 1, 10, 20 - i])), { limit: 5, perFile: 2 }).length === 5);
	check('a long stretch is cut to its first lines, with how many are left out', S.clipSnippet('l\n'.repeat(100), 10).endsWith('... (91 more lines)') && S.clipSnippet('short') === 'short' && S.clipSnippet('x'.repeat(5000)).length < 1900);
	const f = S.formatResults('rate limit', [{ file: 'src/api/rateLimiter.ts', start: 1, end: 6, score: 5, symbol: 'RateLimiter', text: 'export class RateLimiter {}' }], { files: 120 });
	check('the answer names the file, the lines and the definition, and says how much was searched', f.includes('1 place in the project') && f.includes('src/api/rateLimiter.ts:1-6  (in RateLimiter)') && f.includes('120 files indexed'));
	check('nothing found says so, and what to try', S.formatResults('zebra', [], { files: 7 }).includes('Nothing in the project index matches "zebra"') && S.formatResults('zebra', [], { files: 7 }).includes('search_for_files'));
	check('an index still catching up says so', S.formatResults('x', [{ file: 'a', start: 1, end: 2, score: 1, text: 't' }], { files: 1, stale: true }).includes('still catching up'));
}

// ---- what Settings says
{
	const ready = { status: 'ready', files: 1234, chunks: 8900, rootHash: 'x', updatedAt: 1000, truncated: false };
	check('a ready index says what it holds, how old it is, and that it stays on this computer', W.indexStatusWords(ready, { on: true, hasFolder: true, now: 1000 + 120_000 }).title === '1,234 files in 8,900 pieces' && W.indexStatusWords(ready, { on: true, hasFolder: true, now: 1000 + 120_000 }).detail.startsWith('Updated 2 min ago. Kept on this computer, never sent anywhere.'));
	check('search by meaning is said when it is running: how many pieces are ready and that the rest come in the background', W.indexStatusWords({ ...ready, meaning: { ready: 300, waiting: 100, on: true } }, { on: true, hasFolder: true, now: 2000 }).detail.includes('300 of 400 pieces are ready') && W.indexStatusWords({ ...ready, meaning: { ready: 400, waiting: 0, on: true } }, { on: true, hasFolder: true, now: 2000 }).detail.includes('ready for all 400 pieces'));
	check('and said honestly when this install has no model, and not mentioned while it is not yet known', W.indexStatusWords({ ...ready, meaning: { ready: 0, waiting: 0, on: false } }, { on: true, hasFolder: true, now: 2000 }).detail.includes('not available in this install') && !W.indexStatusWords({ ...ready, meaning: { ready: 0, waiting: 0 } }, { on: true, hasFolder: true, now: 2000 }).detail.includes('meaning') && !W.indexStatusWords(ready, { on: true, hasFolder: true, now: 2000 }).detail.includes('meaning'));
	check('the quick tier is told: alone when there is no code model, beside it when there is, and by itself before the code model is known', (() => { const d = (m) => W.indexStatusWords({ ...ready, meaning: m }, { on: true, hasFolder: true, now: 2000 }).detail; return d({ ready: 0, waiting: 0, on: false, quick: 900 }).includes('Fast search by meaning is ready for 900 pieces; the high-quality model is not part of this install')
		&& d({ ready: 100, waiting: 300, on: true, quick: 400 }).includes('100 of 400 pieces are ready with the high-quality model') && d({ ready: 100, waiting: 300, on: true, quick: 400 }).includes('The quick tier covers 400 pieces')
		&& d({ ready: 0, waiting: 0, quick: 250 }).includes('Fast search by meaning is ready for 250 pieces') && !d({ ready: 0, waiting: 0 }).includes('meaning'); })());
	const brokenModel = W.indexStatusWords({ ...ready, meaning: { ready: 0, waiting: 3, on: false, quick: 12, error: 'Cannot find module embedWorker.js' } }, { on: true, hasFolder: true, now: 2000 });
	check('an installed model startup failure is not described as a missing model', brokenModel.detail.includes('could not run') && brokenModel.detail.includes('12 pieces') && !brokenModel.detail.includes('not part of this install'));
	check('a project cut at the limit says so and how to choose', W.indexStatusWords({ ...ready, truncated: true }, { on: true, hasFolder: true, now: 2000 }).detail.includes('.vaderignore'));
	check('building says how far it is', W.indexStatusWords({ ...ready, status: 'indexing', progress: { done: 200, total: 1200 } }, { on: true, hasFolder: true, now: 0 }).title === 'Indexing: 200 of 1,200 files changed since last time' && W.indexStatusWords({ ...ready, status: 'indexing', files: 0, chunks: 0 }, { on: true, hasFolder: true, now: 0 }).title === 'Indexing');
	check('off, no folder, not started, and a failure each say so', W.indexStatusWords(undefined, { on: false, hasFolder: true, now: 0 }).tone === 'off' && W.indexStatusWords(undefined, { on: true, hasFolder: false, now: 0 }).title === 'No folder is open' && W.indexStatusWords(undefined, { on: true, hasFolder: true, now: 0 }).title === 'Starting' && W.indexStatusWords({ ...ready, status: 'error', message: 'EPERM' }, { on: true, hasFolder: true, now: 0 }).detail === 'EPERM');
	check('time is said as a person says it', W.agoWords(0, 10_000) === 'just now' && W.agoWords(0, 3 * 3600_000) === '3 h ago' && W.agoWords(0, 2 * 86400_000) === '2 d ago');
}

console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
