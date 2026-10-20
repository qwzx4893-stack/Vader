/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { Worker } from 'worker_threads';
import type { Embedder } from './semanticLayer.js';

// The small embedding model that ships with Vader, run in a worker thread so that the editor never waits for it. The model is Snowflake arctic-embed-xs (Apache 2.0): 22 million
// parameters, 6 layers, 384-number vectors, about 23 MB in its 8-bit form. The worker (embedWorker.ts) loads it with transformers.js from the app's own folder (never the network)
// and one or two threads, never more. If the folder is not in the app, or the worker cannot start, this gives back nothing and search stays on words.

export const EMBED_MODEL_NAME = 'snowflake-arctic-embed-xs'
/** the model was trained to be asked questions with this in front, and the documents without it */
export const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: '

/**
 * The folder the app ships for search by meaning (build/embedding/prepare.mjs makes it): node_modules/ with the runtime, models/<name>/ with the model.
 * It is <app>/resources/embedding; VADER_EMBEDDING_DIR names another one (a build in progress, a test).
 */
export const embeddingDirOf = (resourcesPath: string): string => process.env.VADER_EMBEDDING_DIR || path.join(resourcesPath, 'embedding')
export const modelRootOf = (embeddingDir: string): string => path.join(embeddingDir, 'models')

export function modelIsInstalled(embeddingDir: string): boolean {
	const dir = path.join(modelRootOf(embeddingDir), EMBED_MODEL_NAME)
	return ['onnx/model_quantized.onnx', 'tokenizer.json', 'tokenizer_config.json', 'config.json'].every(f => fs.existsSync(path.join(dir, f)))
		&& fs.existsSync(path.join(embeddingDir, 'node_modules', '@huggingface', 'transformers', 'package.json'))
}

/** threads for the model: one on a small machine, two on a bigger one; the work is spread in time too (semantic.ts), so this only bounds what one slice can take */
export const threadsFor = (cores: number): number => cores >= 8 ? 2 : 1

type Pending = { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }

export async function createLocalEmbedder(opts: { embeddingDir: string; workerPath: string; cores: number }): Promise<Embedder | undefined> {
	if (!modelIsInstalled(opts.embeddingDir)) return undefined
	let worker: Worker
	try {
		worker = new Worker(opts.workerPath, { workerData: { root: modelRootOf(opts.embeddingDir), runtimeDir: opts.embeddingDir, name: EMBED_MODEL_NAME, threads: threadsFor(opts.cores) }, resourceLimits: { maxOldGenerationSizeMb: 256 } })
	} catch { return undefined }
	const pending = new Map<number, Pending>()
	let nextId = 1
	let dead = false
	const failAll = (e: Error): void => { dead = true; for (const p of pending.values()) p.reject(e); pending.clear() }
	const ready = new Promise<boolean>(resolve => {
		worker.once('message', (m: { ready?: boolean }) => resolve(!!m.ready))
		worker.once('error', () => resolve(false))
		worker.once('exit', () => resolve(false))
	})
	worker.on('message', (m: { id?: number; vectors?: ArrayBuffer; dims?: number; error?: string }) => {
		if (m.id === undefined) return
		const p = pending.get(m.id)
		if (!p) return
		pending.delete(m.id)
		if (m.error || !m.vectors || !m.dims) { p.reject(new Error(m.error ?? 'no answer')); return }
		const all = new Float32Array(m.vectors)
		const out: Float32Array[] = []
		for (let i = 0; i + m.dims <= all.length; i += m.dims) out.push(all.slice(i, i + m.dims))
		p.resolve(out)
	})
	worker.on('error', e => failAll(e instanceof Error ? e : new Error(String(e))))
	worker.on('exit', () => failAll(new Error('the embedding worker stopped')))
	if (!(await ready)) { try { await worker.terminate() } catch { /* gone */ } return undefined }
	worker.unref()

	const ask = (texts: string[]): Promise<Float32Array[]> => new Promise((resolve, reject) => {
		if (dead) { reject(new Error('the embedding worker stopped')); return }
		const id = nextId++
		pending.set(id, { resolve, reject })
		worker.postMessage({ id, texts })
	})
	return {
		embedDocs: texts => ask(texts),
		embedQuery: async q => (await ask([QUERY_PREFIX + q]))[0],
		dispose: () => { dead = true; void worker.terminate() },
	}
}
