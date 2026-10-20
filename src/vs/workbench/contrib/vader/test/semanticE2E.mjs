#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The light-weight half of meaning-based search (common/codebaseIndex/semantic.ts), with a pretend model and a pretend clock.
// Run: node src/vs/workbench/contrib/vader/test/semanticE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-semantic-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/codebaseIndex/semantic.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'm.mjs'), logLevel: 'silent' });
const S = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);
await esbuild.build({ entryPoints: [path.join(here, '../common/codebaseIndex/staticModel.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'sm.mjs'), logLevel: 'silent' });
const SM = await import(pathToFileURL(path.join(tmp, 'sm.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

// a pretend model: words that mean the same go to the same direction
const CONCEPT = { limit: 0, throttle: 0, limiter: 0, bucket: 0, requests: 0, rate: 0, parse: 1, json: 1, decode: 1, config: 1, render: 2, button: 2, draw: 2, widget: 2, sql: 3, database: 3, query: 3, table: 3 };
const embedText = (t) => { const v = new Float32Array(S.EMBED_DIMS); for (const w of t.toLowerCase().split(/[^a-z]+/)) { if (w in CONCEPT) v[CONCEPT[w]] += 1; else if (w) v[8 + (w.length * 7 + w.charCodeAt(0)) % 300] += 0.15; } return v; };

// ---- vectors
{
	const v = S.normalize(new Float32Array([3, 4]));
	check('a vector is made a unit vector', Math.abs(v[0] - 0.6) < 1e-6 && Math.abs(v[1] - 0.8) < 1e-6);
	const q = S.quantize(new Float32Array([3, 4]));
	check('and stored as one signed byte per number', q instanceof Int8Array && q.length === 2 && q[0] === 76 && q[1] === 102);
	check('the cosine from the bytes is close to the real one', Math.abs(S.cosineQ(S.normalize(new Float32Array([3, 4])), q) - 1) < 0.01 && Math.abs(S.cosineQ(S.normalize(new Float32Array([4, -3])), q)) < 0.02);
	check('a zero vector does not make NaN', !Number.isNaN(S.normalize(new Float32Array(4))[0]) && S.cosineQ(S.normalize(new Float32Array(4)), S.quantize(new Float32Array(4))) === 0);
}
check('the model is shown the file, the name and the code, cut to a fixed size', (() => { const t = S.textForEmbedding('src/a.ts', 'limit', 'const   x =  1\n\n\n\nreturn x'); return t === 'src/a.ts limit\nconst x = 1\nreturn x' && S.textForEmbedding('f', undefined, 'x'.repeat(5000)).length === S.MAX_EMBED_CHARS; })());

// ---- the store
{
	const st = new S.VectorStore(3);
	check('a vector is put once per hash and the store says it has it', st.put('h1', embedText('rate limiter')) && st.has('h1') && st.size === 1);
	st.put('h2', embedText('parse json config')); st.put('h3', embedText('render a button'));
	check('a full store refuses a new one and does not evict', st.put('h4', embedText('sql query')) === false && !st.has('h4') && st.size === 3);
	check('but updating one it has is fine', st.put('h1', embedText('request throttle')) === true);
	const q = S.normalize(embedText('throttle requests'));
	const top = st.topK(q, 2);
	check('the nearest vector by meaning comes first', top[0].hash === 'h1' && top[0].score > 0.9 && top.length === 2 && top[1].score < top[0].score, JSON.stringify(top));
	check('a filter limits what may be answered', st.topK(q, 3, h => h !== 'h1')[0].hash !== 'h1');
	check('vectors for text that is gone are forgotten', st.gc(new Set(['h1', 'h3'])) === 1 && !st.has('h2') && st.size === 2);
	const back = S.VectorStore.fromJSON(JSON.parse(JSON.stringify(st.toJSON())));
	check('the store survives being saved and loaded, with the same answers', back.size === 2 && back.topK(q, 1)[0].hash === 'h1' && Math.abs(back.topK(q, 1)[0].score - st.topK(q, 1)[0].score) < 1e-9);
	check('a damaged save loads as empty instead of failing', S.VectorStore.fromJSON({ dims: 384, hashes: ['a', 'b'], data: 'AAAA' }).size === 0 && S.VectorStore.fromJSON({ dims: 4, hashes: ['a'], data: '%%%' }).size === 0);
	const j = new S.VectorStore(); for (let i = 0; i < 500; i++) j.put('k' + i, embedText('word' + i + ' limit'));
	check('500 vectors of 768 numbers take about 510 KB saved, not 1.5 MB of floats', JSON.stringify(j.toJSON()).length < 600_000, String(JSON.stringify(j.toJSON()).length));
}

// ---- fusing the two rankings
{
	const r = S.fuse([{ ids: ['a', 'b', 'c'] }, { ids: ['c', 'd', 'a'] }]);
	check('what both lists rank high is first, and what only one has is kept', r[0].id === 'a' && r.map(x => x.id).sort().join('') === 'abcd', JSON.stringify(r));
	check('a heavier list counts more', S.fuse([{ ids: ['x', 'y'], weight: 1 }, { ids: ['y', 'x'], weight: 3 }])[0].id === 'y');
	check('an empty list changes nothing', S.fuse([{ ids: ['x', 'y'] }, { ids: [] }]).map(a => a.id).join('') === 'xy');
}

// ---- which files are embedded
check('source code is embedded; data, text, tests, generated and vendored files are not',
	['src/a.ts', 'src\b\c.py', 'lib/x.go', 'app/Main.java', 'a.tsx'].every(S.isEmbeddable) &&
	['README.md', 'package.json', 'data.csv', 'src/a.test.ts', 'src/a.spec.js', 'test/helper.ts', 'src/__tests__/a.ts', 'dist/a.js', 'node_modules/x/index.js', 'a.min.js', 'types.d.ts', 'src/fooE2E.mjs', 'build/x.ts', 'logo.png'].every(f => !S.isEmbeddable(f)));

// ---- joining the two rankings: meaning leads, words add a small bonus
{
	const dense = [{ id: 'a', score: 0.8 }, { id: 'b', score: 0.7 }, { id: 'c', score: 0.5 }];
	const words = [{ id: 'c', score: 12 }, { id: 'a', score: 6 }, { id: 'z', score: 3 }];
	const r = S.blend(dense, words);
	check('a piece the words like most does not jump over a piece that is much nearer by meaning', r[0].id === 'a' && r[1].id === 'b' && r.map(x => x.id).includes('c'), JSON.stringify(r));
	check('what only the words found is kept, ranked near the tenth meaning match', r.some(x => x.id === 'z') && S.blend(dense, [{ id: 'z', score: 9 }], { priorRank: 2 }).find(x => x.id === 'z').score > 0.7);
	check('with no meaning ranking the words decide, in their own order', S.blend([], words).map(x => x.id).join('') === 'caz', S.blend([], words).map(x => x.id).join(''));
	const close = S.blend([{ id: 'p', score: 0.601 }, { id: 'q', score: 0.60 }], [{ id: 'q', score: 10 }, { id: 'p', score: 1 }]);
	check('between two pieces equally near by meaning, the words break the tie', close[0].id === 'q');
	const aware = S.blend([{ id: 'a', score: 0.8 }, { id: 'b', score: 0.4 }], [{ id: 'z', score: 9 }, { id: 'y', score: 8 }], { embedded: id => id === 'z' });
	const at = (id) => aware.findIndex(x => x.id === id);
	check('a word match without a vector is put near the top; one that has a vector but is not among the nearest is not (it sits at the end of the nearest)', aware[0].id === 'a' && at('y') < at('b') && at('z') > at('y'), aware.map(x => x.id).join(''));
	check('the list is cut to the limit and empty input gives nothing', S.blend(dense, words, { limit: 2 }).length === 2 && S.blend([], []).length === 0);
}

// ---- the queue, with a clock that moves only when the model works or the queue rests
const world = (msPerChunk) => {
	let t = 0; const calls = [];
	return { calls, io: { embed: async (texts) => { calls.push(texts.length); t += texts.length * msPerChunk; return texts.map(embedText); }, now: () => t, sleep: async (ms) => { t += ms; }, hold: undefined }, at: () => t };
};
const todo = (n, base = 0) => Array.from({ length: n }, (_, i) => ({ hash: 'c' + (base + i), text: 'limit chunk ' + (base + i), priority: 1 }));
{
	const st = new S.VectorStore(); const q = new S.EmbedQueue(st, { batch: 8, duty: 0.25 });
	check('the same text is queued once, and what already has a vector is not queued', q.add(todo(20)) === 20 && q.add(todo(5)) === 0 && (st.put('z', embedText('x')), q.add([{ hash: 'z', text: 'x', priority: 1 }]) === 0));
	const w = world(10);
	const s = await q.runSlice(w.io, 1_000_000);
	check('everything is embedded in batches', s.embedded === 20 && s.stopped === 'empty' && st.size === 21 && w.calls.join(',') === '8,8,4', w.calls.join(','));
	check('the work is spread by the duty cycle: the queue rests three times as long as it works at duty 0.25', Math.abs(s.restedMs - 3 * (8 * 10 + 8 * 10)) <= 3 * 0 + 1 || s.restedMs === 3 * 160, `busy ${s.busyMs} rested ${s.restedMs}`);
	check('so the model is busy about a quarter of the time while there is work', s.busyMs / (s.busyMs + s.restedMs + 0.0001) > 0.2 && s.busyMs / (s.busyMs + s.restedMs) < 0.35, `${s.busyMs}/${s.restedMs}`);
}
{
	const st = new S.VectorStore(); const q = new S.EmbedQueue(st, { batch: 4, duty: 1 });
	q.add([{ hash: 'old', text: 'old', priority: 1 }, { hash: 'new', text: 'new', priority: 9 }, { hash: 'mid', text: 'mid', priority: 5 }]);
	const seen = []; const w = world(1); const io = { ...w.io, embed: async (t) => { seen.push(...t); return t.map(embedText); } };
	await q.runSlice(io, 1000);
	check('the files changed lately are embedded first', seen.join(',') === 'new,mid,old', seen.join(','));
	q.add([{ hash: 'a', text: 'a', priority: 1 }]); q.add([{ hash: 'a', text: 'a', priority: 7 }]);
	check('queueing again with a higher priority raises it', q.pending === 1);
}
{
	const st = new S.VectorStore(); const q = new S.EmbedQueue(st, { batch: 5, duty: 1 }); q.add(todo(50));
	const w = world(10);
	const s = await q.runSlice(w.io, 100);
	check('a slice stops when its time is spent and keeps the rest for the next', s.stopped === 'budget' && s.embedded > 0 && s.embedded < 50 && q.pending === 50 - s.embedded, JSON.stringify(s));
	const s2 = await q.runSlice(w.io, 100_000);
	check('and the next slice finishes it', s2.stopped === 'empty' && st.size === 50);
}
{
	let held = true; const st = new S.VectorStore(); const q = new S.EmbedQueue(st); q.add(todo(3)); const w = world(1);
	const s = await q.runSlice({ ...w.io, hold: () => held }, 1000);
	check('nothing is done while the computer should be left alone (battery, typing)', s.stopped === 'held' && s.embedded === 0 && w.calls.length === 0);
	held = false;
	check('and it goes on when that is over', (await q.runSlice({ ...w.io, hold: () => held }, 1000)).embedded === 3);
}
{
	const st = new S.VectorStore(5); const q = new S.EmbedQueue(st, { batch: 2, duty: 1 }); q.add(todo(10)); const w = world(1);
	const s = await q.runSlice(w.io, 1000);
	check('at the ceiling it stops cleanly and says so', s.stopped === 'full' && st.size === 5);
	const bad = new S.EmbedQueue(new S.VectorStore()); bad.add(todo(2));
	check('a model that fails stops the slice without losing the queue', (await bad.runSlice({ ...w.io, embed: async () => { throw new Error('model gone'); } }, 1000)).stopped === 'failed' && bad.pending === 2);
	const q2 = new S.EmbedQueue(new S.VectorStore()); q2.add(todo(4)); q2.forget(new Set(['c1', 'c2']));
	check('chunks that no longer exist are dropped from the queue', q2.pending === 2);
}

// ---- search time
{
	const st = new S.VectorStore(); for (const h of ['a', 'c']) st.put(h, embedText('x'));
	check('only the best word matches without a vector are embedded on the spot, a few of them', S.missingAmongTop(['a', 'b', 'c', 'd', 'e', 'b'], st, 2).join(',') === 'b,d' && S.missingAmongTop(['a', 'c'], st, 5).length === 0);
}
{
	const now = 1_000_000_000_000, day = 86_400_000;
	check('a file changed today comes before one untouched for a year, and a small one before a large', S.filePriority(now - 1000, now, 5000) > S.filePriority(now - 365 * day, now, 5000) && S.filePriority(now, now, 1000) > S.filePriority(now, now, 400_000));
}

// ---- the whole idea: a question in other words finds the code by meaning, and the words still count
{
	const chunks = { 'limiter.ts': 'export function throttle(requests) { bucket.take() }', 'config.ts': 'function decode(json) { return parse(json) }', 'button.tsx': 'function draw() { render(widget) }', 'db.ts': 'run the sql query on the database table', 'notes.md': 'rate limit notes: we use a bucket' };
	const st = new S.VectorStore(); const q = new S.EmbedQueue(st); const byHash = {};
	q.add(Object.entries(chunks).map(([f, c]) => { byHash['h:' + f] = f; return { hash: 'h:' + f, text: S.textForEmbedding(f, undefined, c), priority: 1 }; }));
	await q.runSlice(world(1).io, 10_000);
	const question = 'where do we stop too many requests per client';
	const dense = st.topK(S.normalize(embedText(question)), 3).map(h => byHash[h.hash]);
	check('a question in other words finds the code by what it means', dense[0] === 'limiter.ts' || dense[0] === 'notes.md', dense.join(','));
	const wordsOnly = Object.keys(chunks).filter(f => f !== dense[0]); // the words of the question find nothing useful: the right file is not in that ranking at all
	const fused = S.fuse([{ ids: wordsOnly }, { ids: [dense[0]] }]).map(x => x.id);
	check('fused with a words ranking that missed the file, the meaning ranking still puts it in the top two', fused.slice(0, 2).includes(dense[0]), fused.join(','));
	const fused2 = S.fuse([{ ids: [dense[0], 'x.ts'] }, { ids: [dense[0]] }]).map(x => x.id);
	check('and a file both rankings like is first', fused2[0] === dense[0]);
}

// ---- the quick tier: a static table read from a .safetensors file, tokens looked up and averaged
{
	const f16 = (x) => { // a float as 16 bits (the values used here are small and exact)
		const dv = new DataView(new ArrayBuffer(4)); dv.setFloat32(0, x); const b = dv.getUint32(0); const sign = (b >>> 16) & 0x8000; const e = ((b >>> 23) & 0xff) - 127 + 15; const m = (b >>> 13) & 0x3ff;
		return x === 0 ? sign : sign | (e << 10) | m;
	};
	const rows = [[1, 0, 0, 0], [0, 1, 0, 0], [0.5, 0.5, 0, 0], [0, 0, 1, 0], [0, 0, 0, 0]]; // token 4 is "unknown"
	const flat = rows.flat().map(f16);
	const header = Buffer.from(JSON.stringify({ embeddings: { dtype: 'F16', shape: [5, 4], data_offsets: [0, flat.length * 2] } }));
	const file = Buffer.alloc(8 + header.length + flat.length * 2);
	file.writeBigUInt64LE(BigInt(header.length), 0); header.copy(file, 8); flat.forEach((h, i) => file.writeUInt16LE(h, 8 + header.length + i * 2));
	const table = SM.parseSafetensors(new Uint8Array(file));
	check('a safetensors file with one 16-bit table is read: rows, numbers per row and the values', table && table.rows === 5 && table.dims === 4 && SM.halfToFloat()[table.data[8]] === 0.5 && SM.halfToFloat()[table.data[0]] === 1, JSON.stringify(table && { r: table.rows, d: table.dims }));
	check('a damaged file, a table of another type or shape, or a wrong size is refused, not misread', SM.parseSafetensors(new Uint8Array(5)) === undefined && SM.parseSafetensors(new Uint8Array(file.subarray(0, file.length - 4))) === undefined
		&& (() => { const h2 = Buffer.from(JSON.stringify({ embeddings: { dtype: 'F32', shape: [5, 4], data_offsets: [0, 80] } })); const f2 = Buffer.alloc(8 + h2.length + 80); f2.writeBigUInt64LE(BigInt(h2.length), 0); h2.copy(f2, 8); return SM.parseSafetensors(new Uint8Array(f2)); })() === undefined);
	check('16-bit floats are read right: 1, -2, 0.5, and a small value', Math.abs(SM.halfToFloat()[0x3c00] - 1) < 1e-9 && SM.halfToFloat()[0xc000] === -2 && SM.halfToFloat()[0x3800] === 0.5 && Math.abs(SM.halfToFloat()[0x0400] - Math.pow(2, -14)) < 1e-12);
	const words = { a: 0, b: 1, ab: 2, c: 3, zzz: 4 };
	const emb = new SM.StaticEmbedder(table, text => text.split(' ').filter(Boolean).map(w => words[w] ?? -1), { unkId: 4 });
	const v = emb.embed('a b');
	check('the vector of a text is the average of its tokens, scaled to length one', Math.abs(v[0] - Math.SQRT1_2) < 1e-3 && Math.abs(v[1] - Math.SQRT1_2) < 1e-3 && Math.abs(Math.hypot(...v) - 1) < 1e-6, [...v].join(','));
	check('unknown tokens, words not in the table and an empty text do not count, and do not make NaN', Math.abs(emb.embed('a zzz nonsense')[0] - 1) < 1e-3 && emb.embed('').every(x => x === 0) && emb.embed('zzz').every(x => x === 0));
	check('a long text is cut to the token limit', (() => { const e2 = new SM.StaticEmbedder(table, () => [0, 0, 0, 1, 1, 1, 1], { maxTokens: 3 }); const x = e2.embed('x'); return Math.abs(x[0] - 1) < 1e-3 && Math.abs(x[1]) < 1e-3; })());
	check('two texts about the same thing are nearer than two about different things', (() => { const dot = (p, q) => p.reduce((s, x, i) => s + x * q[i], 0); return dot(emb.embed('a ab'), emb.embed('b ab')) > dot(emb.embed('a'), emb.embed('c')); })());
}
{
	// pieces a search has just found are wanted first
	const st = new S.VectorStore(); const q = new S.EmbedQueue(st, { batch: 1, duty: 1 });
	q.add([{ hash: 'recent', text: 'recent', priority: 100 }, { hash: 'old', text: 'old', priority: 1 }, { hash: 'found', text: 'found', priority: 0 }]);
	q.bump(['found', 'not-queued']);
	q.add([{ hash: 'second', text: 'second', priority: 0 }, { hash: 'first', text: 'first', priority: 0 }]); q.bump(['first', 'second']); // best first: the order given is kept
	const seen = []; const w = world(1);
	await q.runSlice({ ...w.io, embed: async (t) => { seen.push(...t); return t.map(embedText); } }, 1000);
	check('what a search found goes ahead of the pieces of recent files, and an unknown piece is ignored', seen.join(',') === 'found,first,second,recent,old', seen.join(','));
}

console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
