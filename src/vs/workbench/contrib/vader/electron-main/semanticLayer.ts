/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Hit } from '../common/codebaseIndex/bm25Index.js';
import { blend, EmbedQueue, filePriority, fuse, isEmbeddable, missingAmongTop, normalize, textForEmbedding, VectorStore, Vec } from '../common/codebaseIndex/semantic.js';
import type { StaticEmbedder } from '../common/codebaseIndex/staticModel.js';

// Meaning-based search for one project, on top of the word index (codebaseIndexer.ts), in two tiers. The rules that keep it light are in common/codebaseIndex/semantic.ts; this is the part
// that touches the disk and the models.
//  - The quick tier is a static model (staticModel.ts): about 0.4 ms a piece, so every piece of the project has a vector within a second or two. Joined with the words by reciprocal rank
//    fusion it makes the "cheap" ranking, which answers by itself until the code model has caught up (and always, when there is no code model).
//  - The code model (the Embedder, a worker thread) is slow, so it works in the background in small slices, and the pieces that searches find among their best candidates are embedded first.
//    Its vectors lead the final ranking; the cheap ranking supplies the candidates and a small bonus (blend()).
// Both models are optional: with neither, nothing here does anything and the word search works as before.

export interface Embedder {
	embedDocs(texts: string[]): Promise<Vec[]>
	embedQuery(query: string): Promise<Vec>
	dispose(): void
}
export type EmbedderFactory = () => Promise<Embedder | undefined>
export type QuickFactory = () => Promise<StaticEmbedder | undefined>

export type ChunkRef = { start: number; end: number; symbol?: string }
/** `ready` and `waiting` are pieces with and without a code-model vector; `on` is whether that model runs (undefined until tried); `quick` is the pieces with a quick-tier vector (undefined when there is no quick tier) */
export type MeaningState = { ready: number; waiting: number; on?: boolean; quick?: number }

type Piece = { hash: string; start: number; end: number; symbol?: string }
type Loc = { file: string; start: number; end: number; symbol?: string }
const sha1 = (s: string): string => crypto.createHash('sha1').update(s).digest('hex')
const keyOf = (file: string, start: number, end: number): string => `${file}:${start}-${end}`
const MAX_QUICK_VECTORS = 200_000
const CANDIDATES = 30

export type SemanticOptions = {
	/** true while the computer should be left alone (on battery power, say) */
	hold?: () => boolean
	/** the quick tier; without it the words and the code model are all there is */
	quickFactory?: QuickFactory
	sliceMs?: number
	duty?: number
	restMs?: number
	onDemandMax?: number
	onDemandMs?: number
	queryMs?: number
	/** a cosine below this is not a match at all */
	floor?: number
	/** how long to wait before looking again when the work was held back */
	holdRetryMs?: number
	/** how long to wait before trying again after the model failed (doubles each time) */
	failRetryMs?: number
}

export class SemanticLayer {
	private _embedder: Embedder | undefined
	private _tried = false
	private _failures = 0
	private _modelStart: Promise<Embedder | undefined> | undefined
	private readonly _store = new VectorStore()
	private readonly _queue: EmbedQueue
	// the quick tier
	private _quick: StaticEmbedder | undefined
	private _quickTried = false
	private _quickStart: Promise<StaticEmbedder | undefined> | undefined
	private readonly _quickStore = new VectorStore(MAX_QUICK_VECTORS)
	private readonly _pendingQuick = new Map<string, string>() // text of pieces that wait for the quick model to be loaded
	private _draining = false
	/** the pieces of each file, in order */
	private readonly _piecesOfFile = new Map<string, Piece[]>()
	/** where each text is (the same text can be in more than one place) */
	private readonly _locs = new Map<string, Loc[]>()
	private readonly _hashOfKey = new Map<string, string>()
	private readonly _textOfHash = new Map<string, string>() // only for what is waiting for the code model
	private _loop: ReturnType<typeof setTimeout> | undefined
	private _running = false
	private _disposed = false
	private _persistTimer: ReturnType<typeof setTimeout> | undefined
	onDidChange: ((s: MeaningState) => void) | undefined
	/** what the model last failed with (for diagnosing) */
	lastError: string | undefined
	lastSlice: { embedded: number; stopped: string } | undefined

	constructor(private readonly _file: string, private readonly _factory: EmbedderFactory, private readonly _o: SemanticOptions = {}) {
		this._queue = new EmbedQueue(this._store, { batch: 4, duty: _o.duty ?? 0.4 }) // 4 at a time: a question waits for at most the batch in flight (about 1.3 s with a code model)
	}

	get state(): MeaningState {
		return { ready: this._store.size, waiting: this._queue.pending, on: this._tried ? !!this._embedder : undefined, quick: this._o.quickFactory && !(this._quickTried && !this._quick) ? this._quickStore.size : undefined }
	}

	private get _quickWanted(): boolean { return !!this._o.quickFactory && !(this._quickTried && !this._quick) }

	/** has this file's pieces been noted (a file in an index read from disk is not, until it is looked at again); with a quick tier, also that its pieces have quick vectors */
	knows(rel: string): boolean {
		const ps = this._piecesOfFile.get(rel)
		if (!ps) return false
		return !this._quickWanted || ps.every(p => this._quickStore.has(p.hash))
	}

	/** the code model, started once: everyone who asks while it is starting gets the same answer when it is ready */
	private _model(): Promise<Embedder | undefined> {
		if (!this._modelStart) {
			this._modelStart = (async () => {
				try { this._embedder = await this._factory() } catch { this._embedder = undefined }
				this._tried = true
				return this._embedder
			})()
		}
		return this._modelStart
	}

	private _quickModel(): Promise<StaticEmbedder | undefined> {
		if (!this._o.quickFactory) return Promise.resolve(undefined)
		if (!this._quickStart) {
			this._quickStart = (async () => {
				try { this._quick = await this._o.quickFactory!() } catch { this._quick = undefined }
				this._quickTried = true
				return this._quick
			})()
		}
		return this._quickStart
	}

	// ---- keeping track of what is in the project

	/** a file was (re)indexed: its pieces are noted, they get quick vectors, and the ones that have no code-model vector are queued */
	onFile(rel: string, text: string, chunks: readonly ChunkRef[], mtimeMs: number, size: number): void {
		this._forget(rel)
		if (!isEmbeddable(rel)) { this._piecesOfFile.set(rel, []); this._changed(); return } // known, and nothing in it is embedded
		const lines = text.replace(/\r\n/g, '\n').split('\n')
		const pieces: Piece[] = []
		const now = Date.now()
		const todo: { hash: string; text: string; priority: number }[] = []
		for (const c of chunks) {
			const body = textForEmbedding(rel, c.symbol, lines.slice(c.start - 1, c.end).join('\n'))
			const hash = sha1(body)
			pieces.push({ hash, start: c.start, end: c.end, symbol: c.symbol })
			this._note(rel, { hash, start: c.start, end: c.end, symbol: c.symbol })
			if (this._o.quickFactory && !this._quickStore.has(hash)) {
				if (this._quick) this._quickStore.put(hash, this._quick.embed(body)) // 0.4 ms
				else if (!this._quickTried) this._pendingQuick.set(hash, body)
			}
			if (!this._store.has(hash)) { todo.push({ hash, text: body, priority: filePriority(mtimeMs, now, size) }); this._textOfHash.set(hash, body) }
		}
		this._piecesOfFile.set(rel, pieces)
		if (this._pendingQuick.size > 0) void this._drainQuick()
		if (todo.length) { this._queue.add(todo); this._wake() }
		this._changed()
	}

	/** the quick vectors of what waited for the quick model to load, a few hundred at a time so that the editor is not held */
	private async _drainQuick(): Promise<void> {
		if (this._draining) return
		this._draining = true
		try {
			const q = await this._quickModel()
			if (!q) { this._pendingQuick.clear(); return }
			while (this._pendingQuick.size > 0 && !this._disposed) {
				let n = 0
				for (const [hash, body] of this._pendingQuick) {
					this._pendingQuick.delete(hash)
					if (this._locs.has(hash) && !this._quickStore.has(hash)) this._quickStore.put(hash, q.embed(body))
					if (++n >= 200) break
				}
				this._changed()
				await new Promise<void>(r => setImmediate(r))
			}
			this._schedulePersist()
		} finally { this._draining = false }
	}

	private _note(file: string, p: Piece): void {
		const loc: Loc = { file, start: p.start, end: p.end, symbol: p.symbol }
		const list = this._locs.get(p.hash)
		if (list) list.push(loc); else this._locs.set(p.hash, [loc])
		this._hashOfKey.set(keyOf(file, p.start, p.end), p.hash)
	}

	private _forget(rel: string): void {
		const pieces = this._piecesOfFile.get(rel)
		if (!pieces) return
		this._piecesOfFile.delete(rel)
		for (const p of pieces) {
			const list = (this._locs.get(p.hash) ?? []).filter(l => l.file !== rel)
			if (list.length) this._locs.set(p.hash, list); else { this._locs.delete(p.hash); this._textOfHash.delete(p.hash); this._pendingQuick.delete(p.hash) }
			this._hashOfKey.delete(keyOf(rel, p.start, p.end))
		}
		this._queue.forget(new Set(this._locs.keys()))
	}

	onFileRemoved(rel: string): void { this._forget(rel); this._changed() }

	/** the project index has been rebuilt from nothing: the pieces are noted again as files are read; vectors are kept, they belong to the text */
	reset(): void { this._piecesOfFile.clear(); this._locs.clear(); this._hashOfKey.clear(); this._textOfHash.clear(); this._pendingQuick.clear(); this._queue.forget(new Set()) }

	// ---- the background work of the code model

	private _wake(delay?: number): void {
		if (this._loop || this._running || this._disposed) return
		this._loop = setTimeout(() => { this._loop = undefined; void this._work() }, delay ?? this._o.restMs ?? 500)
		;(this._loop as unknown as { unref?: () => void }).unref?.()
	}

	private async _work(): Promise<void> {
		if (this._running || this._disposed) return
		this._running = true
		let again: number | undefined // when to look again; scheduled after `_running` is cleared, or _wake would ignore it
		try {
			const model = await this._model()
			if (!model) return // nothing to run: the quick tier and the words are all there is
			const stats = await this._queue.runSlice({
				embed: t => model.embedDocs(t), now: () => Date.now(),
				sleep: ms => new Promise(r => { const h = setTimeout(r, ms); (h as unknown as { unref?: () => void }).unref?.() }),
				hold: this._o.hold,
			}, this._o.sliceMs ?? 3000)
			for (const h of [...this._textOfHash.keys()]) if (this._store.has(h)) this._textOfHash.delete(h)
			this._changed()
			if (stats.embedded > 0) this._schedulePersist()
			this.lastSlice = { embedded: stats.embedded, stopped: stats.stopped }
			if (stats.stopped === 'failed') this.lastError = stats.error
			if (stats.stopped === 'failed') this._failures++; else if (stats.embedded > 0) this._failures = 0
			if (stats.stopped === 'held') again = this._o.holdRetryMs ?? 30_000 // the computer may be plugged in later
			else if (stats.stopped === 'failed') { if (this._failures < 5) again = Math.min(60_000, (this._o.failRetryMs ?? 2000) * 2 ** (this._failures - 1)) } // a model that stumbles is tried again, later each time, and given up on after five in a row
			else if (this._queue.pending > 0 && stats.stopped !== 'full') again = this._o.restMs ?? 500
		} finally {
			this._running = false
			if (again !== undefined) this._wake(again)
		}
	}

	private _changed(): void { this.onDidChange?.(this.state) }

	// ---- searching

	/**
	 * The ranking of a search. The words and the quick tier make the cheap ranking; the code model's vectors lead where there are any (blend() in semantic.ts) and the pieces it has
	 * not seen yet, among the best cheap candidates, are put first in its queue. On any trouble, the cheap ranking, or the word ranking as it was.
	 */
	async rerank(query: string, hits: readonly Hit[], limit = 80): Promise<Hit[]> {
		const quick = await this._quickModel()
		const model = await this._model()
		if (!quick && !model) return [...hits]
		try {
			const byKey = new Map<string, Hit>(hits.map(h => [keyOf(h.chunk.file, h.chunk.start, h.chunk.end), h]))
			const locOfKey = new Map<string, Loc>()
			let cheap: { id: string; score: number }[] = hits.map(h => ({ id: keyOf(h.chunk.file, h.chunk.start, h.chunk.end), score: h.score }))
			if (quick && this._quickStore.size > 0) {
				const near = this._quickStore.topK(quick.embed(query), 40, h => this._locs.has(h))
				const nearKeys: string[] = []
				for (const d of near) for (const l of this._locs.get(d.hash) ?? []) { const k = keyOf(l.file, l.start, l.end); if (!locOfKey.has(k)) { locOfKey.set(k, l); nearKeys.push(k) } }
				cheap = fuse([{ ids: cheap.map(c => c.id) }, { ids: nearKeys }], 60).slice(0, 60)
			}
			const hitFor = (key: string, score: number): Hit | undefined => {
				const old = byKey.get(key)
				if (old) return { chunk: old.chunk, score }
				const l = locOfKey.get(key) ?? this._locOf(key)
				return l ? { chunk: { id: -1, file: l.file, start: l.start, end: l.end, len: 0, symbol: l.symbol }, score } : undefined
			}
			const fromCheap = (): Hit[] => cheap.map(c => hitFor(c.id, c.score * 1000)).filter((h): h is Hit => !!h).slice(0, limit)
			if (!model || this._store.size + this._queue.pending === 0) return quick ? fromCheap() : [...hits]

			try {
				// the best cheap candidates that have no code-model vector yet are wanted now: first in the background queue (before waiting for anything, so that a search that is answered
				// by the cheap ranking still makes the next one better)
				const candHashes = cheap.slice(0, CANDIDATES).map(c => this._hashOfKey.get(c.id)).filter((h): h is string => !!h)
				this._queue.bump(candHashes)
				// the question's vector waits behind the batch the worker is in the middle of (about a second with a code model); if it is not back soon the cheap ranking answers
				const qv = normalize(await this._within(model.embedQuery(query), this._o.queryMs ?? 700))
				const max = this._o.onDemandMax ?? 0 // pieces embedded while the search waits: none by default, the background queue is where they are made
				const need = missingAmongTop(candHashes.slice(0, max * 3), this._store, max).filter(h => this._textOfHash.has(h))
				if (need.length) {
					try {
						const vecs = await this._within(model.embedDocs(need.map(h => this._textOfHash.get(h)!)), this._o.onDemandMs ?? 1500)
						need.forEach((h, i) => { if (this._store.put(h, vecs[i])) this._textOfHash.delete(h) })
						this._queue.forget(new Set([...this._locs.keys()].filter(h => !this._store.has(h))))
						this._schedulePersist()
					} catch { /* too slow or failed: those pieces are ranked by the cheap ranking only */ }
				}
				const floor = this._o.floor ?? 0.2
				const dense = this._store.topK(qv, 40, h => this._locs.has(h)).filter(d => d.score >= floor)
				if (dense.length === 0) return quick ? fromCheap() : [...hits]
				const denseScored: { id: string; score: number }[] = []
				for (const d of dense) for (const l of this._locs.get(d.hash) ?? []) { const k = keyOf(l.file, l.start, l.end); if (!locOfKey.has(k)) locOfKey.set(k, l); if (!denseScored.some(x => x.id === k)) denseScored.push({ id: k, score: d.score }) }
				const embedded = (key: string): boolean => { const h = this._hashOfKey.get(key); return !!h && this._store.has(h) }
				return blend(denseScored, cheap, { limit, embedded }).map(f => hitFor(f.id, f.score * 1000)).filter((h): h is Hit => !!h)
			} catch { return quick ? fromCheap() : [...hits] } // the code model was too slow or failed: the cheap ranking stands
		} catch { return [...hits] }
	}

	private _locOf(key: string): Loc | undefined {
		const h = this._hashOfKey.get(key)
		return h ? (this._locs.get(h) ?? []).find(l => keyOf(l.file, l.start, l.end) === key) : undefined
	}

	private _within<T>(p: Promise<T>, ms: number): Promise<T> {
		return new Promise((resolve, reject) => {
			const h = setTimeout(() => reject(new Error('too slow')), ms)
			p.then(v => { clearTimeout(h); resolve(v) }, e => { clearTimeout(h); reject(e) })
		})
	}

	// ---- saving

	async load(): Promise<void> {
		try {
			const j = JSON.parse(await fs.promises.readFile(this._file, 'utf8')) as { v: 1; store: ReturnType<VectorStore['toJSON']>; quick?: ReturnType<VectorStore['toJSON']>; files: [string, [string, number, number, string?][]][] }
			if (j.v !== 1) return
			this._store.loadJSON(j.store)
			if (j.quick) this._quickStore.loadJSON(j.quick)
			for (const [file, pieces] of j.files) {
				const ps: Piece[] = pieces.map(([hash, start, end, symbol]) => ({ hash, start, end, symbol }))
				this._piecesOfFile.set(file, ps)
				for (const p of ps) this._note(file, p)
			}
		} catch { /* no saved vectors: they are made again */ }
		this._changed()
	}

	private _schedulePersist(): void {
		if (this._persistTimer || this._disposed) return
		this._persistTimer = setTimeout(() => { this._persistTimer = undefined; void this.persist() }, 4000)
		;(this._persistTimer as unknown as { unref?: () => void }).unref?.()
	}

	async persist(): Promise<void> {
		try {
			// a file is saved as known only when every piece has what it is going to get: a code-model vector, or (when there is no code model) a quick one, so that nothing waits forever
			// without being in the queue; the others are looked at again next time
			const noCode = this._tried && !this._embedder
			const done = (h: string): boolean => this._store.has(h) || (noCode && this._quickStore.has(h))
			const files: [string, [string, number, number, string?][]][] = []
			for (const [file, pieces] of this._piecesOfFile) {
				if (!pieces.every(p => done(p.hash))) continue
				files.push([file, pieces.map(p => [p.hash, p.start, p.end, p.symbol])])
			}
			const live = new Set(this._locs.keys())
			this._store.gc(live)
			this._quickStore.gc(live)
			await fs.promises.mkdir(path.dirname(this._file), { recursive: true })
			const tmp = this._file + '.tmp'
			await fs.promises.writeFile(tmp, JSON.stringify({ v: 1, store: this._store.toJSON(), ...(this._quickStore.size ? { quick: this._quickStore.toJSON() } : {}), files }))
			await fs.promises.rename(tmp, this._file)
		} catch { /* the vectors still work from memory */ }
	}

	async dispose(): Promise<void> {
		this._disposed = true
		if (this._loop) clearTimeout(this._loop)
		if (this._persistTimer) { clearTimeout(this._persistTimer); this._persistTimer = undefined; this._disposed = false; await this.persist(); this._disposed = true }
		try { this._embedder?.dispose() } catch { /* gone */ }
	}
}
