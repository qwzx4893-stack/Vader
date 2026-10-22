// A stand-in for electron-main/embedWorker.ts, speaking the same messages, for test/localEmbedderE2E.mjs.
import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
const marker = (n) => fs.existsSync(path.join(workerData.root, workerData.name, n));

if (marker('NOT_READY')) { parentPort.postMessage({ ready: false }); }
else if (marker('DIES_AT_START')) { process.exit(1); }
else if (marker('HANG_AT_START')) { setInterval(() => {}, 1000); }
else {
	fs.appendFileSync(path.join(workerData.root, workerData.name, 'STARTS'), 'x'); // one mark for every start of this worker
	parentPort.postMessage({ ready: true });
	parentPort.on('message', ({ id, texts }) => {
		if (texts.some(t => t === 'HANG')) return;
		if (texts.some(t => t === 'FAIL')) { parentPort.postMessage({ id, error: 'the model failed' }); return; }
		if (texts.some(t => t === 'DIE')) { process.exit(1); }
		const dims = 4;
		const v = new Float32Array(texts.length * dims);
		texts.forEach((t, i) => { v[i * dims] = t.length; v[i * dims + 1] = workerData.threads; v[i * dims + 2] = i; });
		parentPort.postMessage({ id, dims, vectors: v.buffer }, [v.buffer]);
	});
}
