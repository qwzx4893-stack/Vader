#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The host side of the embedding worker (electron-main/localEmbedder.ts): finding the model in the app, starting the worker thread, matching answers to questions, and what happens when the
// worker fails, dies or is stopped. The worker here is a stand-in that speaks the same messages; the real model is not part of this test.
// Run: node src/vs/workbench/contrib/vader/test/localEmbedderE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-emb-'));
await esbuild.build({ entryPoints: [path.join(here, '../electron-main/localEmbedder.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'm.mjs'), logLevel: 'silent' });
const E = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);
const worker = path.join(here, 'fixtures/fakeEmbedWorker.mjs');

const keepAlive = setInterval(() => { }, 1000); // the worker is unref'd (the app's own event loop keeps the process alive; here nothing else does)
let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const MODEL = 'fake-model';
const resources = (name, extra = {}) => {
	const dir = path.join(tmp, 'res-' + name);
	const required = ['onnx/model.onnx', 'tokenizer.json', 'tokenizer_config.json', 'config.json'];
	for (const f of required) { const p = path.join(dir, 'models', MODEL, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); }
	fs.mkdirSync(path.join(dir, 'node_modules', '@huggingface', 'transformers'), { recursive: true }); fs.writeFileSync(path.join(dir, 'node_modules', '@huggingface', 'transformers', 'package.json'), '{}');
	fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ model: { name: MODEL, revision: 'r1', dtype: 'fp32', pooling: 'cls', queryPrefix: 'Q: ', docPrefix: '', dims: 4, requiredFiles: required, ...extra } }));
	return dir;
};

const slashes = (p) => p.split(path.sep).join('/');
check('the folder is <resources>/embedding unless VADER_EMBEDDING_DIR says otherwise', slashes(E.embeddingDirOf('/r')) === '/r/embedding' && slashes(E.modelRootOf('/e')) === '/e/models');
{
	const r = resources('man');
	const m = E.readManifest(r);
	check('the folder says which model it holds and how to use it', m && m.name === MODEL && m.pooling === 'cls' && m.queryPrefix === 'Q: ' && m.docPrefix === '' && m.dims === 4 && m.requiredFiles.length === 4, JSON.stringify(m));
	const bad = (model) => { const d = path.join(tmp, 'res-bad-' + Math.random()); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ model })); return E.readManifest(d); };
	check('a manifest that is damaged, incomplete, or names a folder outside the models folder is not used', E.readManifest(path.join(tmp, 'nowhere')) === undefined && bad({ name: '../evil', dtype: 'fp32', pooling: 'cls', dims: 4, requiredFiles: [] }) === undefined && bad({ name: 'x' }) === undefined && bad(undefined) === undefined);
}
check('one thread on a small machine, two on a bigger one, never more', E.threadsFor(2) === 1 && E.threadsFor(4) === 1 && E.threadsFor(8) === 2 && E.threadsFor(64) === 2);
check('without the model files in the app there is no embedder, and nothing is started', E.modelIsInstalled(path.join(tmp, 'empty')) === false && (await E.createLocalEmbedder({ embeddingDir: path.join(tmp, 'empty'), workerPath: worker, cores: 4 })) === undefined);
check('with the files, the model is found', E.modelIsInstalled(resources('a')) === true);

{
	const e = await E.createLocalEmbedder({ embeddingDir: resources('a'), workerPath: worker, cores: 8 });
	check('with the files and a worker that is ready there is an embedder', !!e);
	const docs = await e.embedDocs(['abc', 'hello world']);
	check('texts are embedded in order, one vector each, as floats', docs.length === 2 && docs[0] instanceof Float32Array && docs[0].length === 4 && docs[0][0] === 3 && docs[1][0] === 11 && docs[1][2] === 1, JSON.stringify(docs.map(d => [...d])));
	check('the worker is told how many threads to use', docs[0][1] === 2);
	const q = await e.embedQuery('stop requests');
	check('a question goes with the prefix, and a document does not', q[0] === 'Q: '.length + 'stop requests'.length && docs[0][0] === 3);
	const many = await Promise.all([e.embedDocs(['a']), e.embedDocs(['bb']), e.embedDocs(['ccc'])]);
	check('answers go to the right question when several are in flight', many.map(m => m[0][0]).join(',') === '1,2,3');
	let err; try { await e.embedDocs(['FAIL']); } catch (x) { err = x; }
	check('an error from the model reaches the one who asked, and the worker goes on', err && /the model failed/.test(err.message) && (await e.embedDocs(['ok']))[0][0] === 2, String(err));
	let died; const pending = e.embedDocs(['DIE']).catch(x => { died = x; });
	await pending;
	check('a worker that dies fails what was waiting, and the next question is answered by a worker started again', !!died && (await e.embedDocs(['xy']))[0][0] === 2);
	e.dispose();
}
{
	const e = await E.createLocalEmbedder({ embeddingDir: resources('b'), workerPath: worker, cores: 4 });
	e.dispose();
	check('after dispose nothing can be asked', await e.embedDocs(['x']).then(() => false, () => true));
}
{
	const r1 = resources('nr'); fs.writeFileSync(path.join(r1, 'models', MODEL, 'NOT_READY'), '');
	check('a worker that reports it could not load the model gives no embedder', (await E.createLocalEmbedder({ embeddingDir: r1, workerPath: worker, cores: 4 })) === undefined);
	const r2 = resources('ds'); fs.writeFileSync(path.join(r2, 'models', MODEL, 'DIES_AT_START'), '');
	check('a worker that dies while starting gives no embedder', (await E.createLocalEmbedder({ embeddingDir: r2, workerPath: worker, cores: 4 })) === undefined);
}
{
	// the document prefix from the manifest goes in front of every document
	const e = await E.createLocalEmbedder({ embeddingDir: resources('dp', { docPrefix: 'D: ' }), workerPath: worker, cores: 4 });
	check('the document prefix of the manifest goes in front of documents, not questions', (await e.embedDocs(['abc']))[0][0] === 6 && (await e.embedQuery('abc'))[0] === 6);
	e.dispose();
}
{
	// the worker is stopped when nothing has been asked for a while, and started again by the next question
	const r = resources('idle');
	const starts = () => fs.existsSync(path.join(r, 'models', MODEL, 'STARTS')) ? fs.readFileSync(path.join(r, 'models', MODEL, 'STARTS'), 'utf8').length : 0;
	const e = await E.createLocalEmbedder({ embeddingDir: r, workerPath: worker, cores: 4, idleMs: 150 });
	check('the worker is started once at the beginning', starts() === 1, String(starts()));
	await new Promise(r2 => setTimeout(r2, 500));
	check('after the idle time it is stopped, holding no memory', starts() === 1);
	const v = await e.embedDocs(['abcd']);
	check('the next question starts it again and is answered', starts() === 2 && v[0][0] === 4, String(starts()));
	const slow = Promise.all([e.embedDocs(['a']), e.embedDocs(['bb'])]);
	check('questions that are in flight are not cut off by the idle timer', (await slow).length === 2 && starts() === 2);
	e.dispose();
}
check('a worker file that does not exist gives no embedder instead of an error', (await E.createLocalEmbedder({ embeddingDir: resources('c'), workerPath: path.join(tmp, 'nope.mjs'), cores: 4 })) === undefined);

console.log(`\n${passed} passed, ${failed} failed`);
clearInterval(keepAlive);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
