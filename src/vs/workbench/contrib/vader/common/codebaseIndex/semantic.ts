/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Meaning-based search that costs little. The project index (bm25Index.ts) finds code by its words; a small embedding model finds it by what it means ("where do we stop too many
// requests" finds the rate limiter). Running a model over every chunk of a project is what makes such search heavy, so this file is the part that keeps it light, and it is pure
// (the model, the clock and the sleeping are given to it), so the rules are tested without a model:
//  - a chunk is embedded once per content: the vector is kept under the hash of the text, so the same text in another file, or the same file after a change elsewhere in it, costs nothing;
//  - the text sent to the model is cut to a fixed size, so no chunk costs more than another;
//  - work is done in short slices with a duty cycle: after each batch the queue rests as long as the batch took times (1/duty - 1), so the model never holds a core for long;
//  - the order is what the person is likely to ask about: files opened or changed lately first;
//  - at search time only the best words-matches that have no vector yet are embedded on the spot (a bounded few), so the first search is good before the background work has finished;
//  - vectors are stored as bytes (one byte per number, 4x smaller than floats), and there is a ceiling on how many are kept;
//  - the word ranking and the meaning ranking are joined by reciprocal rank fusion, so neither needs the other's score scale.

export const EMBED_DIMS = 384
export const MAX_EMBED_CHARS = 1200
export const MAX_VECTORS = 60_000

export type Vec = Float32Array

export function normalize(v: Vec): Vec {
	let s = 0
	for (let i = 0; i < v.length; i++) s += v[i] * v[i]
	const n = Math.sqrt(s) || 1
	const out = new Float32Array(v.length)
	for (let i = 0; i < v.length; i++) out[i] = v[i] / n
	return out
}

/** a unit vector as one signed byte per number */
export function quantize(v: Vec): Int8Array {
	const u = normalize(v)
	const q = new Int8Array(u.length)
	for (let i = 0; i < u.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(u[i] * 127)))
	return q
}

/** the cosine of a (float, unit) query and a stored byte vector */
export function cosineQ(query: Vec, q: Int8Array): number {
	let s = 0
	const n = Math.min(query.length, q.length)
	for (let i = 0; i < n; i++) s += query[i] * q[i]
	return s / 127
}

/** the text of a chunk as the model sees it: where it is, what it is called, then the code, cut to a fixed size */
export function textForEmbedding(file: string, symbol: string | undefined, code: string): string {
	const head = `${file}${symbol ? ` ${symbol}` : ''}\n`
	const body = code.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n')
	return (head + body).slice(0, MAX_EMBED_CHARS)
}

export class VectorStore {
	private readonly _v = new Map<string, Int8Array>()
	constructor(private readonly _max = MAX_VECTORS) { }

	get size(): number { return this._v.size }
	has(hash: string): boolean { return this._v.has(hash) }
	/** false when the store is full: nothing is evicted, the caller stops embedding */
	put(hash: string, v: Vec): boolean {
		if (!this._v.has(hash) && this._v.size >= this._max) return false
		this._v.set(hash, quantize(v))
		return true
	}
	/** the closest vectors to `query` (a unit float vector), best first; `allow` limits which hashes may be answered */
	topK(query: Vec, limit: number, allow?: (hash: string) => boolean): { hash: string; score: number }[] {
		const best: { hash: string; score: number }[] = []
		for (const [hash, q] of this._v) {
			if (allow && !allow(hash)) continue
			const score = cosineQ(query, q)
			if (best.length < limit) { best.push({ hash, score }); if (best.length === limit) best.sort((a, b) => a.score - b.score) }
			else if (score > best[0].score) { best[0] = { hash, score }; best.sort((a, b) => a.score - b.score) }
		}
		return best.sort((a, b) => b.score - a.score)
	}
	/** forget the vectors whose text is no longer anywhere in the project */
	gc(live: ReadonlySet<string>): number {
		let n = 0
		for (const h of [...this._v.keys()]) if (!live.has(h)) { this._v.delete(h); n++ }
		return n
	}
	toJSON(): { dims: number; hashes: string[]; data: string } {
		const hashes = [...this._v.keys()]
		const dims = this._v.size ? this._v.values().next().value!.length : EMBED_DIMS
		const bytes = new Uint8Array(hashes.length * dims)
		hashes.forEach((h, i) => { const q = this._v.get(h)!; for (let j = 0; j < dims; j++) bytes[i * dims + j] = q[j] & 0xff })
		let bin = ''
		for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192))
		return { dims, hashes, data: btoa(bin) }
	}
	/** reads saved vectors into this store; a damaged save adds nothing (the work is redone) */
	loadJSON(j: { dims: number; hashes: string[]; data: string }): void {
		let bin = ''
		try { bin = atob(j.data) } catch { return }
		if (bin.length !== j.hashes.length * j.dims) return
		j.hashes.forEach((h, i) => { if (this._v.size >= this._max && !this._v.has(h)) return; const q = new Int8Array(j.dims); for (let k = 0; k < j.dims; k++) q[k] = (bin.charCodeAt(i * j.dims + k) << 24) >> 24; this._v.set(h, q) })
	}
	static fromJSON(j: { dims: number; hashes: string[]; data: string }, max = MAX_VECTORS): VectorStore {
		const s = new VectorStore(max)
		s.loadJSON(j)
		return s
	}
}

/** reciprocal rank fusion: each list contributes weight / (k + rank); lists need no common scale */
export function fuse(lists: { ids: readonly string[]; weight?: number }[], k = 60): { id: string; score: number }[] {
	const score = new Map<string, number>()
	for (const l of lists) l.ids.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + (l.weight ?? 1) / (k + rank + 1)))
	return [...score.entries()].map(([id, s]) => ({ id, score: s })).sort((a, b) => b.score - a.score)
}

export type Todo = { hash: string; text: string; priority: number }

export type QueueIO = {
	/** vectors for the texts, in order */
	embed: (texts: string[]) => Promise<Vec[]>
	now: () => number
	sleep: (ms: number) => Promise<void>
	/** true while the computer should be left alone (on battery, busy, the person is typing) */
	hold?: () => boolean
}
export type QueueOptions = { batch?: number; duty?: number; maxBatchMs?: number }
export type SliceStats = { embedded: number; busyMs: number; restedMs: number; stopped: 'empty' | 'held' | 'full' | 'budget' | 'failed' }

export class EmbedQueue {
	private readonly _todo = new Map<string, Todo>()
	constructor(private readonly _store: VectorStore, private readonly _o: QueueOptions = {}) { }

	get pending(): number { return this._todo.size }

	/** queue chunks that have no vector; the same text is queued once, and the higher priority wins */
	add(items: readonly Todo[]): number {
		let n = 0
		for (const t of items) {
			if (this._store.has(t.hash)) continue
			const old = this._todo.get(t.hash)
			if (old) { if (t.priority > old.priority) old.priority = t.priority; continue }
			this._todo.set(t.hash, { ...t }); n++
		}
		return n
	}
	forget(live: ReadonlySet<string>): void { for (const h of [...this._todo.keys()]) if (!live.has(h)) this._todo.delete(h) }

	/** embed for at most `budgetMs` of work (plus the rests the duty cycle asks for), highest priority first */
	async runSlice(io: QueueIO, budgetMs: number): Promise<SliceStats> {
		const batch = this._o.batch ?? 8
		const duty = Math.min(1, Math.max(0.05, this._o.duty ?? 0.3))
		const stats: SliceStats = { embedded: 0, busyMs: 0, restedMs: 0, stopped: 'empty' }
		const start = io.now()
		while (this._todo.size > 0) {
			if (io.hold?.()) { stats.stopped = 'held'; return stats }
			if (io.now() - start >= budgetMs) { stats.stopped = 'budget'; return stats }
			const next = [...this._todo.values()].sort((a, b) => b.priority - a.priority).slice(0, batch)
			const t0 = io.now()
			let vecs: Vec[]
			try { vecs = await io.embed(next.map(n => n.text)) } catch { stats.stopped = 'failed'; return stats }
			const took = io.now() - t0
			stats.busyMs += took
			for (let i = 0; i < next.length; i++) {
				if (!this._store.put(next[i].hash, vecs[i])) { stats.stopped = 'full'; return stats }
				this._todo.delete(next[i].hash)
				stats.embedded++
			}
			const rest = Math.round(took * (1 / duty - 1))
			if (rest > 0 && this._todo.size > 0) { await io.sleep(rest); stats.restedMs += rest }
		}
		return stats
	}
}

/** the chunks among the best word matches that have no vector yet: at most `n`, in rank order, those to embed while the person waits */
export function missingAmongTop(topHashes: readonly string[], store: VectorStore, n: number): string[] {
	const out: string[] = []
	for (const h of topHashes) { if (!store.has(h) && !out.includes(h)) out.push(h); if (out.length >= n) break }
	return out
}

/** the order in which files are embedded: lately changed first, small before large (a small file is cheap and often a config or an entry point) */
export function filePriority(mtimeMs: number, now: number, sizeBytes: number): number {
	const ageDays = Math.max(0, (now - mtimeMs) / 86_400_000)
	return 100 / (1 + ageDays) + 10 / (1 + sizeBytes / 20_000)
}
