/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Hit } from '../common/codebaseIndex/bm25Index.js';
import { EmbedQueue, filePriority, fuse, missingAmongTop, normalize, textForEmbedding, VectorStore, Vec } from '../common/codebaseIndex/semantic.js';

// Meaning-based search for one project, on top of the word index (codebaseIndexer.ts). The rules that keep it light are in common/codebaseIndex/semantic.ts; this is the part that touches the
// disk and a model. The model is optional: when there is none (it is not installed, or it failed to start) nothing here does anything and the word search works as before.
// The model is told to work off the main thread (the Embedder's job), in small slices with rests between them, and not at all while the computer is on battery.

export interface Embedder {
	embedDocs(texts: string[]): Promise<Vec[]>
	embedQuery(query: string): Promise<Vec>
	dispose(): void
}
export type EmbedderFactory = () => Promise<Embedder | undefined>

export type ChunkRef = { start: number; end: number; symbol?: string }
export type MeaningState = { ready: number; waiting: number; on?: boolean }

type Piece = { hash: string; start: number; end: number; symbol?: string }
type Loc = { file: string; start: number; end: number; symbol?: string }
const sha1 = (s: string): string => crypto.createHash('sha1').update(s).digest('hex')
const keyOf = (file: string, start: number, end: number): string => `${file}:${start}-${end}`

export type SemanticOptions = {
	/** true while the computer should be left alone (on battery power, say) */
	hold?: () => boolean
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
}

export class SemanticLayer {
	private _embedder: Embedder | undefined
	private _tried = false
	private readonly _store = new VectorStore()
	private readonly _queue: EmbedQueue
	/** the pieces of each file, in order */
	private readonly _piecesOfFile = new Map<string, Piece[]>()
	/** where each text is (the same text can be in more than one place) */
	private readonly _locs = new Map<string, Loc[]>()
	private readonly _hashOfKey = new Map<string, string>()
	private readonly _textOfHash = new Map<string, string>() // only for what is waiting
	private _loop: ReturnType<typeof setTimeout> | undefined
	private _running = false
	private _disposed = false
	private _persistTimer: ReturnType<typeof setTimeout> | undefined
	onDidChange: ((s: MeaningState) => void) | undefined

	constructor(private readonly _file: string, private readonly _factory: EmbedderFactory, private readonly _o: SemanticOptions = {}) {
		this._queue = new EmbedQueue(this._store, { batch: 8, duty: _o.duty ?? 0.3 })
	}

	get state(): MeaningState { return { ready: this._store.size, waiting: this._queue.pending, on: this._tried ? !!this._embedder : undefined } }

	/** has this file's pieces been noted (a file in an index read from disk is not, until it is looked at again) */
	knows(rel: string): boolean { return this._piecesOfFile.has(rel) }

	private async _model(): Promise<Embedder | undefined> {
		if (!this._tried) {
			this._tried = true
			try { this._embedder = await this._factory() } catch { this._embedder = undefined }
		}
		return this._embedder
	}

	// ---- keeping track of what is in the project

	/** a file was (re)indexed: its pieces are noted and the ones that have no vector are queued */
	onFile(rel: string, text: string, chunks: readonly ChunkRef[], mtimeMs: number, size: number): void {
		this._forget(rel)
		const lines = text.replace(/\r\n/g, '\n').split('\n')
		const pieces: Piece[] = []
		const now = Date.now()
		const todo: { hash: string; text: string; priority: number }[] = []
		for (const c of chunks) {
			const body = textForEmbedding(rel, c.symbol, lines.slice(c.start - 1, c.end).join('\n'))
			const hash = sha1(body)
			pieces.push({ hash, start: c.start, end: c.end, symbol: c.symbol })
			this._note(rel, { hash, start: c.start, end: c.end, symbol: c.symbol })
			if (!this._store.has(hash)) { todo.push({ hash, text: body, priority: filePriority(mtimeMs, now, size) }); this._textOfHash.set(hash, body) }
		}
		this._piecesOfFile.set(rel, pieces)
		if (todo.length) { this._queue.add(todo); this._wake() }
		this._changed()
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
			if (list.length) this._locs.set(p.hash, list); else { this._locs.delete(p.hash); this._textOfHash.delete(p.hash) }
			this._hashOfKey.delete(keyOf(rel, p.start, p.end))
		}
		this._queue.forget(new Set(this._locs.keys()))
	}

	onFileRemoved(rel: string): void { this._forget(rel); this._changed() }

	/** the project index has been rebuilt from nothing: the pieces are noted again as files are read; vectors are kept, they belong to the text */
	reset(): void { this._piecesOfFile.clear(); this._locs.clear(); this._hashOfKey.clear(); this._textOfHash.clear(); this._queue.forget(new Set()) }

	// ---- the background work

	private _wake(delay?: number): void {
		if (this._loop || this._running || this._disposed) return
		this._loop = setTimeout(() => { this._loop = undefined; void this._work() }, delay ?? this._o.restMs ?? 1500)
		;(this._loop as unknown as { unref?: () => void }).unref?.()
	}

	private async _work(): Promise<void> {
		if (this._running || this._disposed) return
		this._running = true
		let again: number | undefined // when to look again; scheduled after `_running` is cleared, or _wake would ignore it
		try {
			const model = await this._model()
			if (!model) return // nothing to run: word search is all there is
			const stats = await this._queue.runSlice({
				embed: t => model.embedDocs(t), now: () => Date.now(),
				sleep: ms => new Promise(r => { const h = setTimeout(r, ms); (h as unknown as { unref?: () => void }).unref?.() }),
				hold: this._o.hold,
			}, this._o.sliceMs ?? 400)
			for (const h of [...this._textOfHash.keys()]) if (this._store.has(h)) this._textOfHash.delete(h)
			this._changed()
			if (stats.embedded > 0) this._schedulePersist()
			if (stats.stopped === 'held') again = this._o.holdRetryMs ?? 30_000 // the computer may be plugged in later
			else if (this._queue.pending > 0 && stats.stopped !== 'full' && stats.stopped !== 'failed') again = this._o.restMs ?? 1500
		} finally {
			this._running = false
			if (again !== undefined) this._wake(again)
		}
	}

	private _changed(): void { this.onDidChange?.(this.state) }

	// ---- searching

	/** the word ranking joined with the meaning ranking; on any trouble, the word ranking as it was */
	async rerank(query: string, hits: readonly Hit[], limit = 80): Promise<Hit[]> {
		const model = await this._model()
		if (!model || this._store.size + this._queue.pending === 0) return [...hits]
		try {
			const qv = normalize(await this._within(model.embedQuery(query), this._o.queryMs ?? 2500))
			// the best word matches that have no vector yet are embedded now, a bounded few, so the first search is good before the background work has caught up
			const max = this._o.onDemandMax ?? 24
			const topHashes = hits.slice(0, max).map(h => this._hashOfKey.get(keyOf(h.chunk.file, h.chunk.start, h.chunk.end))).filter((h): h is string => !!h)
			const need = missingAmongTop(topHashes, this._store, max).filter(h => this._textOfHash.has(h))
			if (need.length) {
				try {
					const vecs = await this._within(model.embedDocs(need.map(h => this._textOfHash.get(h)!)), this._o.onDemandMs ?? 2500)
					need.forEach((h, i) => { if (this._store.put(h, vecs[i])) this._textOfHash.delete(h) })
					this._queue.forget(new Set([...this._locs.keys()].filter(h => !this._store.has(h))))
					this._schedulePersist()
				} catch { /* too slow or failed: those chunks are ranked by their words only */ }
			}
			const floor = this._o.floor ?? 0.2
			const dense = this._store.topK(qv, 40, h => this._locs.has(h)).filter(d => d.score >= floor)
			const denseKeys: string[] = []
			const locOfKey = new Map<string, Loc>()
			for (const d of dense) for (const l of this._locs.get(d.hash) ?? []) { const k = keyOf(l.file, l.start, l.end); if (!locOfKey.has(k)) { locOfKey.set(k, l); denseKeys.push(k) } }
			if (denseKeys.length === 0) return [...hits]
			const wordKeys = hits.map(h => keyOf(h.chunk.file, h.chunk.start, h.chunk.end))
			const byKey = new Map<string, Hit>(hits.map((h, i) => [wordKeys[i], h]))
			const out: Hit[] = []
			for (const f of fuse([{ ids: wordKeys }, { ids: denseKeys, weight: 1.1 }])) {
				const old = byKey.get(f.id)
				if (old) { out.push({ chunk: old.chunk, score: f.score * 1000 }); continue }
				const l = locOfKey.get(f.id)
				if (l) out.push({ chunk: { id: -1, file: l.file, start: l.start, end: l.end, len: 0, symbol: l.symbol }, score: f.score * 1000 })
			}
			return out.slice(0, limit)
		} catch { return [...hits] }
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
			const j = JSON.parse(await fs.promises.readFile(this._file, 'utf8')) as { v: 1; store: ReturnType<VectorStore['toJSON']>; files: [string, [string, number, number, string?][]][] }
			if (j.v !== 1) return
			this._store.loadJSON(j.store)
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
			// only files whose every piece has a vector are saved as known; the others are looked at again next time, so nothing waits forever without being in the queue
			const files: [string, [string, number, number, string?][]][] = []
			for (const [file, pieces] of this._piecesOfFile) {
				if (!pieces.every(p => this._store.has(p.hash))) continue
				files.push([file, pieces.map(p => [p.hash, p.start, p.end, p.symbol])])
			}
			this._store.gc(new Set(this._locs.keys()))
			await fs.promises.mkdir(path.dirname(this._file), { recursive: true })
			const tmp = this._file + '.tmp'
			await fs.promises.writeFile(tmp, JSON.stringify({ v: 1, store: this._store.toJSON(), files }))
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
