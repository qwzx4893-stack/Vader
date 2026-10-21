#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Search by meaning inside the real indexer (electron-main/codebaseIndexer.ts + semanticLayer.ts), over a real folder, with a pretend model that knows which words mean the same.
// Checked: a question in other words finds the code, the same text is embedded once, a model that is missing or fails leaves the word search as it was, the vectors are saved and
// read back, an index that was read from disk is brought into the meaning layer, being on battery pauses the work, and the model is not run on every search.
// Run: node src/vs/workbench/contrib/vader/test/semanticIndexerE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-sem-'));
await esbuild.build({ entryPoints: [path.join(here, '../electron-main/codebaseIndexer.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'm.mjs'), logLevel: 'silent' });
const { CodebaseIndexer } = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const write = (root, rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await wait(25); } return false; };

// the pretend model: words that mean the same go to the same direction
const CONCEPT = { limit: 0, throttle: 0, limiter: 0, bucket: 0, requests: 0, rate: 0, tokens: 0, stop: 0, many: 0, parse: 1, json: 1, decode: 1, config: 1, render: 2, button: 2, draw: 2, widget: 2, sql: 3, database: 3, query: 3, table: 3, retry: 4, backoff: 4, again: 4 };
const embedText = (t) => { const v = new Float32Array(384); for (const w of t.toLowerCase().split(/[^a-z]+/)) { if (w in CONCEPT) v[CONCEPT[w]] += 1; else if (w) v[8 + (w.length * 7 + w.charCodeAt(0)) % 300] += 0.1; } return v; };
const model = () => { const m = { docCalls: 0, docTexts: 0, queryCalls: 0, disposed: false, async embedDocs(t) { m.docCalls++; m.docTexts += t.length; return t.map(embedText); }, async embedQuery(q) { m.queryCalls++; return embedText(q); }, dispose() { m.disposed = true; } }; return m; };
const opts = { sliceMs: 200, duty: 1, restMs: 10, holdRetryMs: 100, queryMs: 2000, onDemandMs: 2000 };

const project = path.join(tmp, 'p');
write(project, 'src/guard.ts', 'export function throttle(requests: Request[]) {\n  // a bucket of tokens per client, refilled every minute\n  return bucket.take(requests.length)\n}\n');
write(project, 'src/config.ts', 'export function decode(json: string) {\n  return parse(json)\n}\n');
write(project, 'src/button.tsx', 'export function draw() {\n  return render(widget)\n}\n');
write(project, 'src/db.ts', 'export function run() {\n  return database.query(sql)\n}\n');
write(project, 'src/net.ts', 'export async function again(fn) {\n  for (let i = 0; i < 5; i++) { try { return await fn() } catch { await sleep(2 ** i) } }\n}\n');

const store = path.join(tmp, 'store');
const m1 = model();
{
	const ix = new CodebaseIndexer(project, store, async () => m1, opts);
	await ix.sync();
	const ready = await until(() => ix.state.meaning?.ready >= 5 || false, 8000) || true;
	await until(async () => (await ix.search('zzz')).stale === false && m1.docTexts >= 5);
	const r = await ix.search('how do we stop too many hits');
	check('a question in other words finds the code by what it means', r.results[0]?.file === 'src/guard.ts', JSON.stringify(r.results.map(x => x.file)));
	const wordsOnly = new CodebaseIndexer(project, path.join(tmp, 'store-words'));
	await wordsOnly.sync();
	const w = await wordsOnly.search('how do we stop too many hits');
	check('and the same question without the model does not put that file first', w.results[0]?.file !== 'src/guard.ts' || w.results.length === 0, JSON.stringify(w.results.map(x => x.file)));
	const q = await ix.search('how to retry again with backoff');
	check('another question, another file', q.results[0]?.file === 'src/net.ts', JSON.stringify(q.results.map(x => x.file)));
	const before = m1.docTexts;
	await ix.search('parse the json config');
	await ix.search('render a button widget');
	check('searching does not run the model over the chunks again: only the question is embedded', m1.docTexts === before && m1.queryCalls >= 4, `${m1.docTexts} vs ${before}`);
	check('every piece of the project has a vector, none waits', await until(() => ix.state.meaning && ix.state.meaning.ready >= 5 && ix.state.meaning.waiting === 0, 4000), JSON.stringify(ix.state.meaning));
	await ix.dispose();
	check('the model is told to stop when the index is closed', m1.disposed === true);
}
check('the vectors were saved with the index', fs.readdirSync(store).some(f => f.startsWith('vectors-')));

// ---- the same text is embedded once
{
	const m = model();
	write(project, 'src/copy.ts', fs.readFileSync(path.join(project, 'src/guard.ts'), 'utf8')); // the same code in another file: the text sent is the same except the path, so it is a different piece
	const ix = new CodebaseIndexer(project, path.join(tmp, 'store-dup'), async () => m, opts);
	await ix.sync();
	await until(() => m.docTexts >= 6);
	await wait(300);
	const first = m.docTexts;
	await ix.rebuild();
	await wait(600);
	check('building the index again does not embed what already has a vector', m.docTexts === first, `${m.docTexts} vs ${first}`);
	fs.rmSync(path.join(project, 'src/copy.ts'));
	await ix.dispose();
}

// ---- a saved index is read back, and files that were in it before the meaning layer existed are brought in
{
	const m = model();
	const storeB = path.join(tmp, 'store-b');
	const words = new CodebaseIndexer(project, storeB); // an index made without a model
	await words.sync(); await words.dispose();
	const ix = new CodebaseIndexer(project, storeB, async () => m, opts);
	await ix.sync();
	await until(() => m.docTexts >= 5);
	const r = await ix.search('stop too many requests');
	check('an index that was saved without a model is given meaning when a model appears (no file changed)', m.docTexts >= 5 && r.results[0]?.file === 'src/guard.ts', `${m.docTexts} ${JSON.stringify(r.results.map(x => x.file))}`);
	await ix.dispose();
	const m3 = model();
	const again = new CodebaseIndexer(project, storeB, async () => m3, opts);
	await again.sync(); await wait(300);
	const r3 = await again.search('stop too many requests');
	check('the next start reads the vectors and embeds nothing again', m3.docTexts === 0 && r3.results[0]?.file === 'src/guard.ts', `${m3.docTexts}`);
	await again.dispose();
}

// ---- no model, a model that fails, a model that is slow
{
	const none = new CodebaseIndexer(project, path.join(tmp, 'store-n1'), async () => undefined, opts);
	await none.sync();
	check('without a model the word search works as it did', (await none.search('rate limit tokens bucket')).results[0]?.file === 'src/guard.ts' && none.state.meaning === undefined);
	await none.dispose();
	const broken = { async embedDocs() { throw new Error('model gone') }, async embedQuery() { throw new Error('model gone') }, dispose() { } };
	const b = new CodebaseIndexer(project, path.join(tmp, 'store-n2'), async () => broken, opts);
	await b.sync(); await wait(200);
	const r = await b.search('bucket tokens');
	check('a model that fails leaves the word results, with no error', r.results[0]?.file === 'src/guard.ts');
	await b.dispose();
	const throwing = new CodebaseIndexer(project, path.join(tmp, 'store-n3'), async () => { throw new Error('cannot start') }, opts);
	await throwing.sync();
	check('a model that cannot start is the same as none', (await throwing.search('bucket tokens')).results[0]?.file === 'src/guard.ts');
	await throwing.dispose();
	const slow = { async embedDocs(t) { await wait(5000); return t.map(embedText) }, async embedQuery(q) { await wait(5000); return embedText(q) }, dispose() { } };
	const s = new CodebaseIndexer(project, path.join(tmp, 'store-n4'), async () => slow, { ...opts, queryMs: 150, onDemandMs: 150 });
	await s.sync();
	const t0 = Date.now();
	const r2 = await s.search('bucket tokens');
	check('a model that is too slow does not hold a search up: the word results come back after the time limit', Date.now() - t0 < 1500 && r2.results[0]?.file === 'src/guard.ts', `${Date.now() - t0}ms`);
	await s.dispose();
}

// ---- a big project takes many slices, and all of them are done
{
	const big = path.join(tmp, 'big');
	for (let i = 0; i < 40; i++) write(big, `src/f${i}.ts`, `export function limit${i}() {
  return bucket.take(${i})
}
`);
	const m = model(); const slowM = { ...m, async embedDocs(t) { await wait(20); m.docTexts += t.length; return t.map(embedText); }, embedQuery: m.embedQuery, dispose() { } };
	const ix = new CodebaseIndexer(big, path.join(tmp, 'store-big'), async () => slowM, { ...opts, sliceMs: 30, duty: 1, restMs: 5 });
	await ix.sync();
	check('a project that needs many slices is embedded to the end', await until(() => m.docTexts >= 40, 20_000), String(m.docTexts));
	await ix.dispose();
}

// ---- a model that is slow to start, with a search made while it starts (the work must not be lost)
{
	const m = model();
	const ix = new CodebaseIndexer(project, path.join(tmp, 'store-race'), async () => { await wait(300); return m; }, opts);
	await ix.sync();
	await ix.search('stop too many hits'); // asks for the model while the background work is asking for it too
	check('a search made while the model is starting does not stop the background work', await until(() => m.docTexts >= 5 && ix.state.meaning && ix.state.meaning.waiting === 0, 8000), JSON.stringify(ix.state.meaning));
	await ix.dispose();
}

// ---- a model that stumbles at first is tried again
{
	const m = model(); let fails = 2;
	const flaky = { ...m, async embedDocs(t) { if (fails-- > 0) throw new Error('out of memory'); return m.embedDocs(t); }, embedQuery: m.embedQuery, dispose() { } };
	const ix = new CodebaseIndexer(project, path.join(tmp, 'store-flaky'), async () => flaky, { ...opts, failRetryMs: 50 });
	await ix.sync();
	check('a model that fails twice and then works still gets the project embedded', await until(() => m.docTexts >= 5, 10_000), String(m.docTexts));
	await ix.dispose();
	const dead = { async embedDocs() { throw new Error('never'); }, async embedQuery() { return embedText('x'); }, dispose() { } };
	let n = 0; const counting = { ...dead, async embedDocs() { n++; throw new Error('never'); } };
	const ix2 = new CodebaseIndexer(project, path.join(tmp, 'store-dead'), async () => counting, { ...opts, failRetryMs: 10 });
	await ix2.sync(); await wait(1500);
	check('a model that always fails is given up on after five tries, not hammered forever', n >= 3 && n <= 6, String(n));
	await ix2.dispose();
}

// ---- the quick tier: every piece has a vector at once, it answers alone when there is no code model, and it is saved
const quickModel = () => { const q = { docs: 0, queries: 0, embed(t) { if (t.length > 40 && t.includes('\n')) q.docs++; else q.queries++; const v = new Float32Array(16); for (const w of t.toLowerCase().split(/[^a-z]+/)) { if (w in CONCEPT) v[CONCEPT[w]] += 1; else if (w) v[8 + (w.length % 8)] += 0.05; } const n = Math.hypot(...v) || 1; return v.map(x => x / n); }, dims: 16 }; return q; };
{
	const q = quickModel();
	const ix = new CodebaseIndexer(project, path.join(tmp, 'store-quick'), async () => undefined, { ...opts, quickFactory: async () => q });
	await ix.sync();
	check('every piece of the project has a quick vector without waiting for any code model', await until(() => ix.state.meaning && ix.state.meaning.quick >= 5, 6000), JSON.stringify(ix.state.meaning));
	const r = await ix.search('how do we stop too many hits');
	check('with no code model the quick tier alone finds the code by what it means', r.results[0]?.file === 'src/guard.ts' && ix.state.meaning.on === false, JSON.stringify(r.results.map(x => x.file)));
	const w = await ix.search('bucket tokens');
	check('and a search by exact words still finds it', w.results[0]?.file === 'src/guard.ts');
	await ix.dispose();
	const q2 = quickModel();
	const again = new CodebaseIndexer(project, path.join(tmp, 'store-quick'), async () => undefined, { ...opts, quickFactory: async () => q2 });
	await again.sync(); await wait(300);
	const r2 = await again.search('how do we stop too many hits');
	check('the next start reads the quick vectors from disk and does not make them again', q2.docs === 0 && r2.results[0]?.file === 'src/guard.ts', `docs embedded again: ${q2.docs}`);
	await again.dispose();
}
{
	const q = quickModel(); const m = model();
	const ix = new CodebaseIndexer(project, path.join(tmp, 'store-both'), async () => m, { ...opts, quickFactory: async () => q });
	await ix.sync();
	await until(() => m.docTexts >= 5 && ix.state.meaning && ix.state.meaning.waiting === 0 && ix.state.meaning.quick >= 5, 8000);
	const r = await ix.search('how do we stop too many hits');
	check('with both tiers a question in other words finds the code, and the state counts both', r.results[0]?.file === 'src/guard.ts' && ix.state.meaning.on === true && ix.state.meaning.quick >= 5 && ix.state.meaning.ready >= 5, JSON.stringify(ix.state.meaning));
	const r2 = await ix.search('retry again with backoff');
	check('another question, another file', r2.results[0]?.file === 'src/net.ts', JSON.stringify(r2.results.map(x => x.file)));
	await ix.dispose();
}
{
	const none = new CodebaseIndexer(project, path.join(tmp, 'store-qnone'), async () => undefined, { ...opts, quickFactory: async () => undefined });
	await none.sync();
	check('a quick tier that is not installed is the same as none', (await none.search('bucket tokens')).results[0]?.file === 'src/guard.ts' && none.state.meaning?.quick === undefined);
	await none.dispose();
	const bad = new CodebaseIndexer(project, path.join(tmp, 'store-qbad'), async () => undefined, { ...opts, quickFactory: async () => { throw new Error('table damaged'); } });
	await bad.sync();
	check('a quick tier that fails to load leaves the words as they were', (await bad.search('bucket tokens')).results[0]?.file === 'src/guard.ts');
	await bad.dispose();
}
{
	// a search puts the pieces it found first in the code model's queue: with many pieces and a slow model, the piece a question is about is embedded before the rest
	const big = path.join(tmp, 'big2');
	for (let i = 0; i < 30; i++) write(big, `src/f${i}.ts`, `export function other${i}() {\n  return render(${i})\n}\n`);
	write(big, 'src/target.ts', 'export function throttle(requests) {\n  return bucket.take(requests.length)\n}\n');
	{ const old = new Date(Date.now() - 3 * 365 * 86_400_000); fs.utimesSync(path.join(big, 'src/target.ts'), old, old); } // a file untouched for years: by its age alone it would be the last to be embedded
	const seen = []; const q = quickModel(); const m0 = model();
	const slowM = { ...m0, async embedDocs(t) { await wait(80); seen.push(...t.map(x => x.split('\n')[0])); return t.map(embedText); }, embedQuery: m0.embedQuery, dispose() { } };
	const ix = new CodebaseIndexer(big, path.join(tmp, 'store-bump'), async () => slowM, { ...opts, quickFactory: async () => q, onDemandMax: 0, sliceMs: 40 });
	await ix.sync();
	await ix.search('how do we stop too many hits'); // finds src/target.ts by meaning in the quick tier
	await until(() => seen.some(x => x.includes('target.ts')), 8000);
	const at = seen.findIndex(x => x.includes('target.ts'));
	check('the piece a question is about is embedded by the code model before most of the project', at >= 0 && at < 12, `position ${at} of ${seen.length} embedded so far`);
	await ix.dispose();
}

// ---- on battery nothing is embedded
{
	const m = model(); let held = true;
	const ix = new CodebaseIndexer(project, path.join(tmp, 'store-h'), async () => m, { ...opts, hold: () => held });
	await ix.sync(); await wait(500);
	check('while the computer is on battery the model is not run in the background', m.docTexts === 0, String(m.docTexts));
	held = false;
	await until(() => m.docTexts >= 5, 10_000);
	check('and the work starts when it is plugged in', m.docTexts >= 5, String(m.docTexts));
	await ix.dispose();
}

console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
