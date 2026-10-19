/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { parentPort, workerData } from 'worker_threads';

// Runs in a worker thread (localEmbedder.ts starts it). Loads the small embedding model from the app's own files, never from the network, and answers requests to embed texts.
// transformers.js is loaded by name at run time: when it is not part of the app this worker says it is not ready and the editor goes on with word search.

type Pipe = (texts: string[], o: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>

async function main(): Promise<void> {
	const port = parentPort
	if (!port) return
	let pipe: Pipe
	try {
		const moduleName = '@huggingface/transformers'
		const tf = await import(moduleName) as { pipeline: (task: string, model: string, o: object) => Promise<Pipe>; env: { localModelPath: string; allowRemoteModels: boolean; allowLocalModels: boolean } }
		tf.env.localModelPath = workerData.root
		tf.env.allowRemoteModels = false // the model is part of the app; nothing is ever fetched
		tf.env.allowLocalModels = true
		pipe = await tf.pipeline('feature-extraction', workerData.name, { dtype: 'q8', session_options: { intraOpNumThreads: workerData.threads, interOpNumThreads: 1 } })
	} catch {
		port.postMessage({ ready: false })
		return
	}
	port.postMessage({ ready: true })
	port.on('message', async (m: { id: number; texts: string[] }) => {
		try {
			const out = await pipe(m.texts, { pooling: 'cls', normalize: true })
			const dims = out.dims[out.dims.length - 1]
			const copy = new Float32Array(out.data) // a transferable copy of exactly these numbers
			port.postMessage({ id: m.id, dims, vectors: copy.buffer }, [copy.buffer])
		} catch (e) {
			port.postMessage({ id: m.id, error: e instanceof Error ? e.message : String(e) })
		}
	})
}

void main()
