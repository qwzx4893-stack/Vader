/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { Worker } from 'worker_threads';
import type { Embedder } from './semanticLayer.js';

// The embedding model that ships with Vader, run in a worker thread so that the editor never waits for it. Which model it is, and how it is to be used (the pooling, the words put in
// front of a question), is written in the folder's manifest.json by build/embedding/prepare.mjs from model.lock.json, so changing the model does not change this file. The model is
// CodeRankEmbed (MIT), trained on code, with 768-number vectors. The locked manifest, not this comment, specifies the artifact and precision. The worker (embedWorker.ts) loads it with transformers.js from the app's
// own folder (never the network) and one or two threads, never more. It is started when something asks for an embedding and stopped after a while without a question, so an editor
// that is not being searched holds none of its memory. A missing model returns nothing; a worker failure rejects with its cause so the index can report it while word search continues.

export type ModelManifest = { name: string; revision?: string; dtype: string; pooling: string; queryPrefix: string; docPrefix: string; dims: number; requiredFiles: string[] }

/**
 * The folder the app ships for search by meaning (build/embedding/prepare.mjs makes it): node_modules/ with the runtime, models/<name>/ with the model, manifest.json.
 * It is <app>/resources/embedding; VADER_EMBEDDING_DIR names another one (a build in progress, a test).
 */
export const embeddingDirOf = (resourcesPath: string): string => process.env.VADER_EMBEDDING_DIR || path.join(resourcesPath, 'embedding')
export const modelRootOf = (embeddingDir: string): string => path.join(embeddingDir, 'models')

/** what the folder says about its model, or undefined when the manifest is missing or not usable */
export function readManifest(embeddingDir: string): ModelManifest | undefined {
	try {
		const m = (JSON.parse(fs.readFileSync(path.join(embeddingDir, 'manifest.json'), 'utf8')) as { model?: Partial<ModelManifest> }).model
		if (!m || typeof m.name !== 'string' || typeof m.dtype !== 'string' || typeof m.pooling !== 'string' || typeof m.dims !== 'number' || !Array.isArray(m.requiredFiles)) return undefined
		if (!/^[A-Za-z0-9._-]+$/.test(m.name)) return undefined // the name becomes a folder name
		return { name: m.name, revision: m.revision, dtype: m.dtype, pooling: m.pooling, queryPrefix: m.queryPrefix ?? '', docPrefix: m.docPrefix ?? '', dims: m.dims, requiredFiles: m.requiredFiles }
	} catch { return undefined }
}

export function modelIsInstalled(embeddingDir: string): boolean {
	const m = readManifest(embeddingDir)
	if (!m) return false
	const dir = path.join(modelRootOf(embeddingDir), m.name)
	return m.requiredFiles.every(f => fs.existsSync(path.join(dir, f)))
		&& fs.existsSync(path.join(embeddingDir, 'node_modules', '@huggingface', 'transformers', 'package.json'))
}

/** threads for the model: one on a small machine, two on a bigger one; the work is spread in time too (semantic.ts), so this only bounds what one slice can take */
export const threadsFor = (cores: number): number => cores >= 8 ? 2 : 1

export const DEFAULT_IDLE_MS = 90_000

type Pending = { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }

/** one running worker, with its own table of questions waiting for answers */
type Running = { worker: Worker; pending: Map<number, Pending>; dead: boolean }

export async function createLocalEmbedder(opts: { embeddingDir: string; workerPath: string; cores: number; idleMs?: number; startupMs?: number; requestMs?: number }): Promise<Embedder | undefined> {
	if (!modelIsInstalled(opts.embeddingDir)) return undefined
	const manifest = readManifest(opts.embeddingDir)!
	let nextId = 1
	let running: Running | undefined
	let starting: Promise<Running | undefined> | undefined
	let startingWorker: Running | undefined
	let idleTimer: ReturnType<typeof setTimeout> | undefined
	let disposed = false
	let busy = 0

	const start = async (): Promise<Running | undefined> => {
		let worker: Worker
		worker = new Worker(opts.workerPath, { workerData: { root: modelRootOf(opts.embeddingDir), runtimeDir: opts.embeddingDir, name: manifest.name, dtype: manifest.dtype, pooling: manifest.pooling, threads: threadsFor(opts.cores) }, resourceLimits: { maxOldGenerationSizeMb: 256 } })
		const r: Running = { worker, pending: new Map(), dead: false }
		startingWorker = r
		const failAll = (e: Error): void => { r.dead = true; for (const p of r.pending.values()) p.reject(e); r.pending.clear(); if (running === r) running = undefined }
		let timer: ReturnType<typeof setTimeout> | undefined
		const ready = new Promise<void>((resolve, reject) => {
			worker.once('message', (m: { ready?: boolean; why?: string }) => m.ready ? resolve() : reject(new Error(m.why ?? 'The search model could not initialize.')))
			worker.once('error', reject)
			worker.once('exit', code => reject(new Error(`The search model worker stopped during initialization (exit ${code}).`)))
			timer = setTimeout(() => reject(new Error('The search model worker did not become ready in time.')), opts.startupMs ?? 60_000)
		})
		worker.on('message', (m: { id?: number; vectors?: ArrayBuffer; dims?: number; error?: string }) => {
			if (m.id === undefined) return
			const p = r.pending.get(m.id)
			if (!p) return
			r.pending.delete(m.id)
			if (m.error || !m.vectors || !m.dims) { p.reject(new Error(m.error ?? 'no answer')); return }
			const all = new Float32Array(m.vectors)
			const out: Float32Array[] = []
			for (let i = 0; i + m.dims <= all.length; i += m.dims) out.push(all.slice(i, i + m.dims))
			p.resolve(out)
		})
		worker.on('error', e => failAll(e instanceof Error ? e : new Error(String(e))))
		worker.on('exit', () => failAll(new Error('the embedding worker stopped')))
		try { await ready } catch (error) {
			failAll(error instanceof Error ? error : new Error(String(error)))
			await worker.terminate()
			throw error
		} finally { clearTimeout(timer); if (startingWorker === r) startingWorker = undefined }
		worker.unref()
		return r
	}

	const armIdle = (): void => {
		if (idleTimer) clearTimeout(idleTimer)
		if (disposed) return
		idleTimer = setTimeout(() => {
			idleTimer = undefined
			if (busy > 0 || !running) return
			const r = running; running = undefined; r.dead = true
			void r.worker.terminate() // nothing is waiting: the next question starts it again
		}, opts.idleMs ?? DEFAULT_IDLE_MS)
		;(idleTimer as unknown as { unref?: () => void }).unref?.()
	}

	const ensure = async (): Promise<Running> => {
		if (disposed) throw new Error('the embedder was closed')
		if (running && !running.dead) return running
		starting ??= start().finally(() => { starting = undefined })
		const r = await starting
		if (!r) throw new Error('the embedding worker could not start')
		if (disposed || r.dead) {
			await r.worker.terminate()
			throw new Error('the embedder was closed')
		}
		running = r
		return r
	}

	const ask = async (texts: string[]): Promise<Float32Array[]> => {
		busy++
		try {
			const r = await ensure()
			return await new Promise<Float32Array[]>((resolve, reject) => {
				const id = nextId++
				const timer = setTimeout(() => {
					r.dead = true
					if (running === r) running = undefined
					for (const p of r.pending.values()) p.reject(new Error('The search model did not answer in time.'))
					r.pending.clear()
					void r.worker.terminate()
				}, opts.requestMs ?? 60_000)
				r.pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v) }, reject: e => { clearTimeout(timer); reject(e) } })
				try { r.worker.postMessage({ id, texts }) } catch (error) {
					r.pending.get(id)?.reject(error instanceof Error ? error : new Error(String(error)))
					r.pending.delete(id)
				}
			})
		} finally { busy--; armIdle() }
	}

	// the first start is made now, so that a model that cannot run is found out before search relies on it
	running = await ensure()
	armIdle()

	return {
		embedDocs: texts => ask(texts.map(t => manifest.docPrefix + t)),
		embedQuery: async q => (await ask([manifest.queryPrefix + q]))[0],
		dispose: () => {
			disposed = true
			if (idleTimer) clearTimeout(idleTimer)
			const active = new Set([running, startingWorker])
			running = undefined
			for (const r of active) if (r) {
				r.dead = true
				for (const p of r.pending.values()) p.reject(new Error('the embedder was closed'))
				r.pending.clear()
				void r.worker.terminate()
			}
		},
	}
}
