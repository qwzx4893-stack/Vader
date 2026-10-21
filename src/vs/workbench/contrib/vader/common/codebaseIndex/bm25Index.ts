/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// An index of code by its words, in memory and written to one file. Each file is cut into chunks (common/codebaseIndex/chunker.ts); each chunk is a document, and a search ranks
// documents with BM25 (the ranking the search engines used before neural ones, and still the strongest plain-text baseline): a term that few chunks have counts for more than one
// that many have, and a chunk is not rewarded for being long. A file that changed is taken out and put in again by itself, so keeping the index up to date costs what the change
// costs, not what the project costs. Pure: no files here, only the structure.

export type Chunk = { readonly id: number; readonly file: string; readonly start: number; readonly end: number; readonly len: number; readonly symbol?: string }
export type ChunkInput = { start: number; end: number; terms: readonly string[]; symbol?: string }
export type Hit = { chunk: Chunk; score: number }

const K1 = 1.2
const B = 0.75

export type SerializedIndex = { v: 1; files: string[]; chunks: [number, number, number, number, number, string][]; postings: { [term: string]: number[] } }

export class Bm25Index {
	private readonly _chunks = new Map<number, Chunk>()
	private readonly _postings = new Map<string, [number, number][]>() // term -> [chunk id, term frequency]
	private readonly _chunksOfFile = new Map<string, number[]>()
	private readonly _termsOfFile = new Map<string, Set<string>>()
	private _totalLen = 0
	private _nextId = 1

	get chunkCount(): number { return this._chunks.size }
	get fileCount(): number { return this._chunksOfFile.size }
	hasFile(file: string): boolean { return this._chunksOfFile.has(file) }
	files(): string[] { return [...this._chunksOfFile.keys()] }
	chunk(id: number): Chunk | undefined { return this._chunks.get(id) }
	chunksOf(file: string): Chunk[] { return (this._chunksOfFile.get(file) ?? []).map(id => this._chunks.get(id)!).filter(Boolean) }

	/** puts a file in, replacing what was there for it */
	setFile(file: string, inputs: readonly ChunkInput[]): void {
		this.removeFile(file)
		if (inputs.length === 0) return
		const ids: number[] = []
		const fileTerms = new Set<string>()
		for (const input of inputs) {
			const id = this._nextId++
			const tf = new Map<string, number>()
			for (const t of input.terms) tf.set(t, (tf.get(t) ?? 0) + 1)
			const len = input.terms.length
			this._chunks.set(id, { id, file, start: input.start, end: input.end, len, symbol: input.symbol })
			this._totalLen += len
			for (const [t, n] of tf) {
				let list = this._postings.get(t)
				if (!list) { list = []; this._postings.set(t, list) }
				list.push([id, n])
				fileTerms.add(t)
			}
			ids.push(id)
		}
		this._chunksOfFile.set(file, ids)
		this._termsOfFile.set(file, fileTerms)
	}

	removeFile(file: string): void {
		const ids = this._chunksOfFile.get(file)
		if (!ids) return
		const gone = new Set(ids)
		for (const t of this._termsOfFile.get(file) ?? []) {
			const list = this._postings.get(t)
			if (!list) continue
			const kept = list.filter(([id]) => !gone.has(id))
			if (kept.length === 0) this._postings.delete(t); else this._postings.set(t, kept)
		}
		for (const id of ids) { const c = this._chunks.get(id); if (c) this._totalLen -= c.len; this._chunks.delete(id) }
		this._chunksOfFile.delete(file)
		this._termsOfFile.delete(file)
	}

	/**
	 * The chunks that best answer the terms, best first. `boost` raises the weight of a term (a name written whole in the question); `inFiles`, when given, keeps only chunks of
	 * those files. A chunk has to have at least one term; a chunk that has more of the different terms ranks above one that repeats a single term.
	 */
	search(terms: readonly string[], opts: { boost?: ReadonlySet<string>; inFile?: (file: string) => boolean; limit?: number } = {}): Hit[] {
		const n = this._chunks.size
		if (n === 0 || terms.length === 0) return []
		const avg = this._totalLen / n || 1
		const scores = new Map<number, { score: number; matched: number }>()
		for (const term of terms) {
			const list = this._postings.get(term)
			if (!list) continue
			const idf = Math.log(1 + (n - list.length + 0.5) / (list.length + 0.5))
			const weight = opts.boost?.has(term) ? 2 : 1
			for (const [id, tf] of list) {
				const c = this._chunks.get(id)
				if (!c) continue
				if (opts.inFile && !opts.inFile(c.file)) continue
				const s = weight * idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * c.len / avg))
				const cur = scores.get(id)
				if (cur) { cur.score += s; cur.matched++ } else scores.set(id, { score: s, matched: 1 })
			}
		}
		const hits: Hit[] = []
		for (const [id, v] of scores) {
			// a chunk that answers more of the question is worth more than its plain sum
			const coverage = 1 + 0.35 * (v.matched - 1) / Math.max(1, terms.length - 1)
			hits.push({ chunk: this._chunks.get(id)!, score: v.score * coverage })
		}
		hits.sort((a, b) => b.score - a.score || a.chunk.id - b.chunk.id)
		return hits.slice(0, opts.limit ?? 50)
	}

	toJSON(): SerializedIndex {
		const files = [...this._chunksOfFile.keys()]
		const fileIdx = new Map(files.map((f, i) => [f, i]))
		const chunks: SerializedIndex['chunks'] = []
		for (const c of this._chunks.values()) chunks.push([c.id, fileIdx.get(c.file)!, c.start, c.end, c.len, c.symbol ?? ''])
		const postings: SerializedIndex['postings'] = {}
		for (const [t, list] of this._postings) { const flat: number[] = []; for (const [id, tf] of list) flat.push(id, tf); postings[t] = flat }
		return { v: 1, files, chunks, postings }
	}

	static fromJSON(data: SerializedIndex): Bm25Index {
		const ix = new Bm25Index()
		for (const [id, fi, start, end, len, symbol] of data.chunks) {
			const file = data.files[fi]
			ix._chunks.set(id, { id, file, start, end, len, symbol: symbol || undefined })
			ix._totalLen += len
			const ids = ix._chunksOfFile.get(file)
			if (ids) ids.push(id); else ix._chunksOfFile.set(file, [id])
			if (id >= ix._nextId) ix._nextId = id + 1
		}
		for (const [t, flat] of Object.entries(data.postings)) {
			const list: [number, number][] = []
			for (let i = 0; i + 1 < flat.length; i += 2) {
				const id = flat[i]
				list.push([id, flat[i + 1]])
				const c = ix._chunks.get(id)
				if (c) { let s = ix._termsOfFile.get(c.file); if (!s) { s = new Set(); ix._termsOfFile.set(c.file, s) } s.add(t) }
			}
			ix._postings.set(t, list)
		}
		return ix
	}
}
