#!/usr/bin/env node
// Opt-in offline native-model integration. Uses actual installed assets, never downloads.
// VADER_EMBEDDING_DIR=<resources>/embedding node .../embedWorkerRuntimeE2E.mjs
// This bundles only the worker and host into a disposable temp directory, not the app.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
assert(process.env.VADER_EMBEDDING_DIR, 'Explicit offline model directory required');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-real-worker-'));
const keepAlive = setInterval(() => {}, 1000);
const deadline = setTimeout(() => { console.error('FAIL: native model exceeded 120 seconds'); process.exit(1); }, 120000);
let embedder;
let peakRss = 0;
const sample = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 100);
try {
	for (const [source, dest] of [['embedWorker.ts', 'worker.mjs'], ['localEmbedder.ts', 'host.mjs'], ['staticEmbedder.ts', 'static.mjs']]) {
		await esbuild.build({ entryPoints: [path.join(here, '../electron-main', source)], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, dest), logLevel: 'silent' });
	}
	const { createLocalEmbedder, readManifest } = await import(pathToFileURL(path.join(tmp, 'host.mjs')).href);
	const { createStaticEmbedder, readStaticManifest } = await import(pathToFileURL(path.join(tmp, 'static.mjs')).href);
	const quick = await createStaticEmbedder(process.env.VADER_EMBEDDING_DIR);
	assert(quick, 'The real installed quick-tier assets must be available');
	const quickVectors = ['function cancelTask(task) { task.abort(); }', 'cancel a running task'].map(text => quick.embed(text));
	for (const vector of quickVectors) {
		assert.equal(vector.length, readStaticManifest(process.env.VADER_EMBEDDING_DIR).dims);
		assert([...vector].every(Number.isFinite));
		assert(Math.abs(Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0)) - 1) < 0.01, 'Quick-tier vectors must be nonzero and normalized');
	}
	const started = performance.now();
	embedder = await createLocalEmbedder({ embeddingDir: process.env.VADER_EMBEDDING_DIR, workerPath: path.join(tmp, 'worker.mjs'), cores: 8 });
	assert(embedder, 'Installed assets must be available');
	const loadedMs = performance.now() - started;
	const vectors = [...await embedder.embedDocs(['function cancelTask(task) { task.abort(); }', 'function sum(a, b) { return a + b; }']), await embedder.embedQuery('cancel a running task')];
	const dims = readManifest(process.env.VADER_EMBEDDING_DIR).dims;
	for (const vector of vectors) {
		assert.equal(vector.length, dims);
		assert([...vector].every(Number.isFinite));
		const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
		assert(Math.abs(norm - 1) < 0.01, 'Vectors must be normalized');
	}
	console.log(JSON.stringify({ status: 'PASS', boundary: 'isolated actual quick tier and source inference worker with installed offline models; NOT packaged-app startup or retrieval quality benchmark', quickVectors: quickVectors.length, vectors: vectors.length, dims, threads: 2, loadedMs: Math.round(loadedMs), elapsedMs: Math.round(performance.now() - started), peakProcessRssMiB: Math.round(peakRss / 1048576) }));
} finally {
	embedder?.dispose();
	clearInterval(keepAlive); clearInterval(sample); clearTimeout(deadline);
	fs.rmSync(tmp, { recursive: true, force: true });
}
