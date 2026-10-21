/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import * as fs from 'fs'
import * as path from 'path'
import { pathToFileURL } from 'url'
import { parentPort, workerData } from 'worker_threads';

// Runs in a worker thread (localEmbedder.ts starts it). Loads the small embedding model from the app's own files, never from the network, and answers requests to embed texts.
// transformers.js is loaded from the app's embedding folder at run time: when it is not there this worker says it is not ready and the editor goes on with word search.

type Pipe = (texts: string[], o: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>

async function main(): Promise<void> {
	const port = parentPort
	if (!port) return
	let pipe: Pipe
	try {
		// the runtime is in the app's embedding folder, not among the editor's own packages: its package.json says which file is the entry
		const pkgDir = path.join(workerData.runtimeDir, 'node_modules', '@huggingface', 'transformers')
		const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as { exports?: { node?: { import?: { default?: string } | string } } }
		const imp = pkg.exports?.node?.import
		const entry = path.join(pkgDir, (typeof imp === 'string' ? imp : imp?.default) ?? 'dist/transformers.node.mjs')
		const tf = await import(pathToFileURL(entry).href) as { pipeline: (task: string, model: string, o: object) => Promise<Pipe>; env: { localModelPath: string; allowRemoteModels: boolean; allowLocalModels: boolean } }
		tf.env.localModelPath = workerData.root
		tf.env.allowRemoteModels = false // the model is part of the app; nothing is ever fetched
		tf.env.allowLocalModels = true
		pipe = await tf.pipeline('feature-extraction', workerData.name, { dtype: workerData.dtype, session_options: { intraOpNumThreads: workerData.threads, interOpNumThreads: 1, enableCpuMemArena: false, enableMemPattern: false } })
	} catch (e) {
		port.postMessage({ ready: false, why: e instanceof Error ? e.message : String(e) }) // the host does not need the reason; it is for whoever looks into why search by meaning is off
		return
	}
	port.postMessage({ ready: true })
	port.on('message', async (m: { id: number; texts: string[] }) => {
		try {
			const out = await pipe(m.texts, { pooling: workerData.pooling, normalize: true })
			const dims = out.dims[out.dims.length - 1]
			const copy = new Float32Array(out.data) // a transferable copy of exactly these numbers
			port.postMessage({ id: m.id, dims, vectors: copy.buffer }, [copy.buffer])
		} catch (e) {
			port.postMessage({ id: m.id, error: e instanceof Error ? e.message : String(e) })
		}
	})
}

void main()
