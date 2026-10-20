#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Loading the quick tier from the app's embedding folder (electron-main/staticEmbedder.ts): the manifest, the files, the tokenizer package found through its package.json, and the
// refusals. The folder here is a small stand-in; with VADER_EMBEDDING_DIR set to a real one (build/embedding/prepare.mjs) the last block also runs the real model.
// Run: node src/vs/workbench/contrib/vader/test/staticEmbedderE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-static-'));
await esbuild.build({ entryPoints: [path.join(here, '../electron-main/staticEmbedder.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'm.mjs'), logLevel: 'silent' });
const M = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

const f16 = (x) => { const dv = new DataView(new ArrayBuffer(4)); dv.setFloat32(0, x); const b = dv.getUint32(0); const sign = (b >>> 16) & 0x8000; const e = ((b >>> 23) & 0xff) - 127 + 15; const m = (b >>> 13) & 0x3ff; return x === 0 ? sign : sign | (e << 10) | m; };
const safetensors = (rows) => {
	const flat = rows.flat().map(f16);
	const header = Buffer.from(JSON.stringify({ embeddings: { dtype: 'F16', shape: [rows.length, rows[0].length], data_offsets: [0, flat.length * 2] } }));
	const file = Buffer.alloc(8 + header.length + flat.length * 2);
	file.writeBigUInt64LE(BigInt(header.length), 0); header.copy(file, 8); flat.forEach((h, i) => file.writeUInt16LE(h, 8 + header.length + i * 2));
	return file;
};
/** a folder like the one prepare.mjs makes, with a tokenizer package that splits on spaces */
function folder(name, o = {}) {
	const dir = path.join(tmp, name);
	const model = path.join(dir, 'models', 'fake-static');
	fs.mkdirSync(model, { recursive: true });
	fs.writeFileSync(path.join(model, 'model.safetensors'), o.table ?? safetensors([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 0]]));
	fs.writeFileSync(path.join(model, 'tokenizer.json'), JSON.stringify({ model: { type: 'WordPiece', unk_token: '[UNK]', vocab: { a: 0, b: 1, c: 2, '[UNK]': 3 } } }));
	fs.writeFileSync(path.join(model, 'config.json'), '{}');
	const pkg = path.join(dir, 'node_modules', '@huggingface', 'tokenizers');
	fs.mkdirSync(path.join(pkg, 'dist'), { recursive: true });
	fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@huggingface/tokenizers', exports: { '.': { types: './types/x.d.ts', node: { require: './dist/t.cjs', import: './dist/t.mjs' }, default: './dist/web.js' } } }));
	fs.writeFileSync(path.join(pkg, 'dist', 't.mjs'), "export class Tokenizer { constructor(json) { this.v = json.model.vocab } encode(text) { return { ids: text.split(' ').filter(Boolean).map(w => this.v[w] ?? this.v['[UNK]']) } } }");
	fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ static: { name: o.name ?? 'fake-static', dims: o.dims ?? 4, requiredFiles: ['model.safetensors', 'tokenizer.json', 'config.json'] } }));
	return dir;
}

check('the entry of a package is the Node import entry of its exports, else import, default or main', M.esmEntryOf({ exports: { '.': { node: { import: './a.mjs', require: './a.cjs' }, default: './w.js' } } }) === './a.mjs'
	&& M.esmEntryOf({ exports: { '.': { node: { import: { types: 't', default: './b.mjs' } } } } }) === './b.mjs' && M.esmEntryOf({ exports: { '.': { import: './c.mjs' } } }) === './c.mjs'
	&& M.esmEntryOf({ exports: './d.js' }) === './d.js' && M.esmEntryOf({ main: './e.js' }) === './e.js' && M.esmEntryOf({}) === undefined);
check('a folder without a manifest, or whose manifest has no quick tier, or names a folder outside models/, has none', M.readStaticManifest(path.join(tmp, 'nothing')) === undefined && (() => { const d = path.join(tmp, 'm1'); fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ model: {} })); return M.readStaticManifest(d); })() === undefined
	&& (() => { const d = path.join(tmp, 'm2'); fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ static: { name: '../evil', dims: 4, requiredFiles: [] } })); return M.readStaticManifest(d); })() === undefined);
check('without its files or its tokenizer package nothing is created', (await M.createStaticEmbedder(path.join(tmp, 'nothing'))) === undefined && (() => { const d = folder('nopkg'); fs.rmSync(path.join(d, 'node_modules'), { recursive: true }); return M.staticModelIsInstalled(d); })() === false);
{
	const d = folder('ok');
	check('with the files and the tokenizer package the folder counts as installed', M.staticModelIsInstalled(d) === true);
	const e = await M.createStaticEmbedder(d);
	check('an embedder is made, with the table\'s dimensions', !!e && e.dims === 4);
	const v = e.embed('a b');
	check('it embeds as the table says: the average of the rows of the tokens, scaled to length one', Math.abs(v[0] - Math.SQRT1_2) < 1e-3 && Math.abs(v[1] - Math.SQRT1_2) < 1e-3 && Math.abs(v[2]) < 1e-6, [...v].join(','));
	check('a word the tokenizer does not know is the unknown token and is left out', Math.abs(e.embed('a nonsense')[0] - 1) < 1e-3);
}
check('a table whose dimensions are not the manifest\'s is refused', (await M.createStaticEmbedder(folder('dims', { dims: 8 }))) === undefined);
check('a damaged table is refused instead of embedding nonsense', (await M.createStaticEmbedder(folder('bad', { table: Buffer.from('not a safetensors file at all, just some text') }))) === undefined);

if (process.env.VADER_EMBEDDING_DIR && M.staticModelIsInstalled(process.env.VADER_EMBEDDING_DIR)) {
	const e = await M.createStaticEmbedder(process.env.VADER_EMBEDDING_DIR);
	const dot = (p, q) => p.reduce((s, x, i) => s + x * q[i], 0);
	const limiter = e.embed('src/api/rateLimiter.ts RateLimiter\nexport class RateLimiter { tryAcquire() { if (this.tokens > 0) { this.tokens--; return true } return false } }');
	const retry = e.embed('src/net/retry.ts retryWithBackoff\nexport async function retryWithBackoff(fn) { let delay = 100; for (let i = 0; i < 5; i++) { try { return await fn() } catch { await sleep(delay); delay *= 2 } } }');
	const q = e.embed('limit how many requests a client can make');
	check('the real model: 256 numbers, length one, and a question about rate limits is nearer the rate limiter than the retry code', e.dims === 256 && Math.abs(Math.hypot(...limiter) - 1) < 1e-4 && dot(q, limiter) > dot(q, retry), `${dot(q, limiter).toFixed(3)} vs ${dot(q, retry).toFixed(3)}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
