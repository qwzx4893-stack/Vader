/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { Bm25Index, SerializedIndex } from '../common/codebaseIndex/bm25Index.js';
import { chunkFile } from '../common/codebaseIndex/chunker.js';
import { buildMerkle, diffMerkle, MerkleNode } from '../common/codebaseIndex/merkle.js';
import { createIgnore, DEFAULT_IGNORE_LINES, IgnoreMatcher, isBinaryPath, isSecretLikePath, looksGenerated, MAX_INDEXED_FILE_BYTES } from '../common/codebaseIndex/ignoreRules.js';
import { queryTerms } from '../common/codebaseIndex/tokenize.js';
import { clipSnippet, formatResults, selectResults } from '../common/codebaseIndex/searchResults.js';
import type { IndexState, IndexStatus, SearchOutcome } from '../common/codebaseIndex/codebaseIndexTypes.js';

// The index of one project, kept on this computer. It lists the project's files (git says which exist and are not ignored; without git, the folder is walked with the usual
// exclusions), hashes each one (a file whose size and time are as they were is not read again), compares the tree of hashes with the one saved last time to find exactly the files
// that changed, and cuts and indexes only those. The index is saved to a file in the app's data folder and read back on the next start. Nothing here leaves the computer: the
// text of a file that holds a secret (.env, keys) is never read, and a search returns lines from the files as they are on disk now.

export type { IndexState, IndexStatus, SearchOutcome }

type Stat = { hash: string; size: number; mtimeMs: number }
type Snapshot = { v: 1; root: string; files: [string, string, number, number][]; index: SerializedIndex }

const sha256 = (s: string | Buffer): string => crypto.createHash('sha256').update(s).digest('hex')
export const MAX_INDEXED_FILES = 20_000
const GIT_TIMEOUT_MS = 30_000
const FRESH_MS = 20_000
const PERSIST_DELAY_MS = 2_500
const WATCH_DELAY_MS = 800
const posix = (p: string): string => p.replace(/\\/g, '/')
const GIT_PROJECT_EXTRA_IGNORES = ['.vader-worktrees/', '.vader/', 'node_modules/', '*.min.js', '*.min.css', '*.map', '*.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']

const git = (args: string[], cwd: string): Promise<string> => new Promise((resolve, reject) => {
	// the repository's own configuration cannot start a program from here (same arguments as safeGit.ts)
	execFile('git', ['-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', ...args], { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout) => err ? reject(err) : resolve(stdout))
})

export class CodebaseIndexer {
	private _index = new Bm25Index()
	private _stats = new Map<string, Stat>()
	private _tree: MerkleNode | undefined
	private _state: IndexState = { status: 'idle', files: 0, chunks: 0, rootHash: '', updatedAt: 0, truncated: false }
	private _syncing: Promise<void> | undefined
	private _persistTimer: ReturnType<typeof setTimeout> | undefined
	private _watcher: fs.FSWatcher | undefined
	private _pending = new Set<string>()
	private _watchTimer: ReturnType<typeof setTimeout> | undefined
	private _lastSync = 0
	private _disposed = false
	private _loaded = false
	/** told whenever the state changes */
	onDidChange: ((s: IndexState) => void) | undefined

	constructor(readonly root: string, private readonly storeDir: string) { }

	get state(): IndexState { return this._state }
	private _set(patch: Partial<IndexState>): void { this._state = { ...this._state, ...patch }; this.onDidChange?.(this._state) }

	private get _snapshotPath(): string { return path.join(this.storeDir, `index-${sha256(path.resolve(this.root).toLowerCase()).slice(0, 16)}.json`) }

	// ---- the saved index

	private async _load(): Promise<void> {
		if (this._loaded) return
		this._loaded = true
		try {
			const snap = JSON.parse(await fs.promises.readFile(this._snapshotPath, 'utf8')) as Snapshot
			if (snap.v !== 1 || path.resolve(snap.root).toLowerCase() !== path.resolve(this.root).toLowerCase()) return
			this._index = Bm25Index.fromJSON(snap.index)
			this._stats = new Map(snap.files.map(([p, hash, size, mtimeMs]) => [p, { hash, size, mtimeMs }]))
			this._tree = buildMerkle([...this._stats].map(([p, s]) => ({ path: p, hash: s.hash, size: s.size })), sha256)
			this._set({ files: this._index.fileCount, chunks: this._index.chunkCount, rootHash: this._tree.hash, status: 'ready', updatedAt: Date.now() })
		} catch { /* no saved index, or one that cannot be read: it is built again */ }
	}

	private _schedulePersist(): void {
		if (this._persistTimer) clearTimeout(this._persistTimer)
		this._persistTimer = setTimeout(() => { void this._persist() }, PERSIST_DELAY_MS)
		;(this._persistTimer as unknown as { unref?: () => void }).unref?.()
	}

	private async _persist(): Promise<void> {
		if (this._disposed) return
		try {
			await fs.promises.mkdir(this.storeDir, { recursive: true })
			const snap: Snapshot = { v: 1, root: this.root, files: [...this._stats].map(([p, s]) => [p, s.hash, s.size, s.mtimeMs]), index: this._index.toJSON() }
			const tmp = this._snapshotPath + '.tmp'
			await fs.promises.writeFile(tmp, JSON.stringify(snap))
			await fs.promises.rename(tmp, this._snapshotPath) // whole or not at all
		} catch { /* the index still works from memory; it is written again at the next change */ }
	}

	/** forgets the saved index and builds it again from nothing */
	async rebuild(): Promise<void> {
		this._index = new Bm25Index(); this._stats = new Map(); this._tree = undefined
		try { await fs.promises.rm(this._snapshotPath, { force: true }) } catch { /* not there */ }
		await this.sync(true)
	}

	// ---- which files

	private async _ignoreMatcher(): Promise<IgnoreMatcher> {
		const lines = [...DEFAULT_IGNORE_LINES]
		for (const f of ['.gitignore', '.vaderignore']) { try { lines.push(...(await fs.promises.readFile(path.join(this.root, f), 'utf8')).split('\n')) } catch { /* none */ } }
		return createIgnore(lines)
	}

	private async _listFiles(): Promise<{ files: string[]; truncated: boolean }> {
		let listed: string[] | undefined
		let viaGit = false
		try {
			if ((await git(['rev-parse', '--is-inside-work-tree'], this.root)).trim() === 'true') {
				const out = await git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'], this.root)
				listed = out.split('\0').filter(Boolean).map(posix)
				viaGit = true
			}
		} catch { /* not a git project, or git is not installed */ }
		if (!listed) {
			const matcher = await this._ignoreMatcher()
			listed = []
			const walk = async (rel: string): Promise<void> => {
				if (listed!.length > MAX_INDEXED_FILES * 3) return
				let entries: fs.Dirent[]
				try { entries = await fs.promises.readdir(path.join(this.root, rel), { withFileTypes: true }) } catch { return }
				for (const e of entries) {
					const r = rel ? `${rel}/${e.name}` : e.name
					if (e.isSymbolicLink()) continue
					if (e.isDirectory()) { if (!matcher.ignores(r, true)) await walk(r) }
					else if (e.isFile() && !matcher.ignores(r)) listed!.push(r)
				}
			}
			await walk('')
		}
		// in a git project git has said what exists, and a tracked folder is real code whatever it is called (a `build/` of scripts); only what is never code is dropped, and what the person put in .vaderignore
		const extra = createIgnore([...(viaGit ? GIT_PROJECT_EXTRA_IGNORES : DEFAULT_IGNORE_LINES), ...(await this._readLines('.vaderignore'))])
		const files = listed.filter(p => !extra.ignores(p) && !isBinaryPath(p) && !isSecretLikePath(p)).sort()
		return files.length > MAX_INDEXED_FILES ? { files: files.slice(0, MAX_INDEXED_FILES), truncated: true } : { files, truncated: false }
	}

	private async _readLines(name: string): Promise<string[]> {
		try { return (await fs.promises.readFile(path.join(this.root, name), 'utf8')).split('\n') } catch { return [] }
	}

	// ---- reading and indexing one file

	/** the text of a file worth indexing, or undefined when it is not (too big, binary, generated) */
	private async _readText(rel: string, size: number): Promise<string | undefined> {
		if (size === 0 || size > MAX_INDEXED_FILE_BYTES) return undefined
		let buf: Buffer
		try { buf = await fs.promises.readFile(path.join(this.root, rel)) } catch { return undefined }
		if (buf.subarray(0, 8000).includes(0)) return undefined // a NUL byte: not text
		const text = buf.toString('utf8')
		return looksGenerated(text) ? undefined : text
	}

	private async _indexFile(rel: string, st: fs.Stats): Promise<void> {
		const text = await this._readText(rel, st.size)
		if (text === undefined) { this._index.removeFile(rel); this._stats.set(rel, { hash: sha256(`${st.size}:${st.mtimeMs}`), size: st.size, mtimeMs: st.mtimeMs }); return }
		this._stats.set(rel, { hash: sha256(text), size: st.size, mtimeMs: st.mtimeMs })
		this._index.setFile(rel, chunkFile(rel, text))
	}

	// ---- keeping it up to date

	/** brings the index up to date with the folder as it is now (a file that has not changed is not read) */
	sync(force = false): Promise<void> {
		if (this._syncing) return this._syncing
		this._syncing = this._sync(force).finally(() => { this._syncing = undefined })
		return this._syncing
	}

	private async _sync(force: boolean): Promise<void> {
		if (this._disposed) return
		await this._load()
		if (!force && this._lastSync && Date.now() - this._lastSync < 1000) return
		this._set({ status: 'indexing', message: undefined })
		try {
			const { files, truncated } = await this._listFiles()
			const seen = new Set(files)
			// what is on disk now, against what the saved tree says: only the files whose size or time moved are read
			const fresh = new Map<string, Stat>()
			const toRead: { rel: string; st: fs.Stats }[] = []
			for (const rel of files) {
				let st: fs.Stats
				try { st = await fs.promises.stat(path.join(this.root, rel)) } catch { seen.delete(rel); continue }
				if (!st.isFile()) { seen.delete(rel); continue }
				const old = this._stats.get(rel)
				if (old && old.size === st.size && Math.abs(old.mtimeMs - st.mtimeMs) < 1) fresh.set(rel, old)
				else toRead.push({ rel, st })
			}
			const gone = [...this._stats.keys()].filter(p => !seen.has(p))
			let done = 0
			for (const g of gone) { this._index.removeFile(g); this._stats.delete(g) }
			for (const { rel, st } of toRead) {
				if (this._disposed) return
				await this._indexFile(rel, st)
				done++
				if (done % 100 === 0) this._set({ progress: { done, total: toRead.length }, files: this._index.fileCount, chunks: this._index.chunkCount })
			}
			const before = this._tree
			this._tree = buildMerkle([...this._stats].map(([p, s]) => ({ path: p, hash: s.hash, size: s.size })), sha256)
			const delta = diffMerkle(before, this._tree)
			this._lastSync = Date.now()
			this._set({ status: 'ready', files: this._index.fileCount, chunks: this._index.chunkCount, rootHash: this._tree.hash, updatedAt: Date.now(), truncated, progress: undefined })
			if (delta.added.length + delta.modified.length + delta.deleted.length > 0 || force) this._schedulePersist()
		} catch (e) {
			this._set({ status: 'error', message: e instanceof Error ? e.message : String(e), progress: undefined })
		}
	}

	/** a few files changed (what the watcher saw): only those are looked at */
	private async _syncFiles(rels: string[]): Promise<void> {
		if (this._syncing) { await this._syncing }
		await this._load()
		const matcher = await this._ignoreMatcher()
		let changed = false
		for (const rel of rels) {
			const r = posix(rel)
			if (!r || matcher.ignores(r) || isBinaryPath(r) || isSecretLikePath(r)) continue
			let st: fs.Stats | undefined
			try { st = await fs.promises.stat(path.join(this.root, r)) } catch { st = undefined }
			if (!st) { if (this._stats.has(r)) { this._index.removeFile(r); this._stats.delete(r); changed = true } continue }
			if (st.isDirectory()) { changed = true; this._lastSync = 0; continue } // a folder appeared or moved: the next search looks at the whole project
			if (!st.isFile()) continue
			const old = this._stats.get(r)
			if (old && old.size === st.size && Math.abs(old.mtimeMs - st.mtimeMs) < 1) continue
			await this._indexFile(r, st)
			changed = true
		}
		if (changed) {
			this._tree = buildMerkle([...this._stats].map(([p, s]) => ({ path: p, hash: s.hash, size: s.size })), sha256)
			this._set({ files: this._index.fileCount, chunks: this._index.chunkCount, rootHash: this._tree.hash, updatedAt: Date.now() })
			this._schedulePersist()
		}
	}

	/** keeps the index current as files change; where the system cannot watch a folder tree, a search brings it up to date instead */
	watch(): void {
		if (this._watcher || this._disposed) return
		try {
			this._watcher = fs.watch(this.root, { recursive: true, persistent: false }, (_ev, filename) => {
				if (!filename) return
				const f = posix(String(filename))
				if (f.startsWith('.git/') || f.includes('/node_modules/') || f.startsWith('node_modules/') || f.startsWith('.vader-worktrees/')) return
				this._pending.add(f)
				if (this._watchTimer) clearTimeout(this._watchTimer)
				this._watchTimer = setTimeout(() => {
					const batch = [...this._pending]; this._pending.clear()
					void (batch.length > 400 ? this.sync() : this._syncFiles(batch)).catch(() => { })
				}, WATCH_DELAY_MS)
				;(this._watchTimer as unknown as { unref?: () => void }).unref?.()
			})
			this._watcher.on('error', () => { try { this._watcher?.close() } catch { /* closed */ } this._watcher = undefined })
		} catch { this._watcher = undefined }
	}

	// ---- searching

	async search(query: string, opts: { directories?: readonly string[]; limit?: number; waitMs?: number } = {}): Promise<SearchOutcome> {
		await this._load()
		const building = this._index.chunkCount === 0 || this._state.status === 'indexing'
		if (this._index.chunkCount === 0 || Date.now() - this._lastSync > FRESH_MS) {
			const run = this.sync()
			// the first time, the person waits for the index; later it is already there and the search is not held up by catching up with recent changes
			if (this._index.chunkCount === 0) await Promise.race([run, new Promise(r => setTimeout(r, opts.waitMs ?? 20_000))])
		}
		const { terms, whole } = queryTerms(query)
		const dirs = (opts.directories ?? []).map(d => posix(path.isAbsolute(d) ? path.relative(this.root, d) : d).replace(/^\.\/?|\/+$/g, '')).filter(d => d !== '' && !d.startsWith('..'))
		const inFile = dirs.length ? (f: string) => dirs.some(d => f === d || f.startsWith(d + '/')) : undefined
		const hits = this._index.search(terms, { boost: whole, inFile, limit: 80 })
		const found = selectResults(hits, { limit: opts.limit ?? 8, perFile: 2 })
		const withText = []
		const cache = new Map<string, string[]>()
		for (const f of found) {
			let lines = cache.get(f.file)
			if (!lines) { try { lines = (await fs.promises.readFile(path.join(this.root, f.file), 'utf8')).replace(/\r\n/g, '\n').split('\n') } catch { lines = [] } cache.set(f.file, lines) }
			if (lines.length === 0) continue // the file is gone since it was indexed
			const end = Math.min(f.end, lines.length)
			withText.push({ ...f, end, text: clipSnippet(lines.slice(f.start - 1, end).join('\n')) })
		}
		const stale = building || this._state.status === 'indexing'
		return { text: formatResults(query, withText, { files: this._index.fileCount, stale, scopedTo: dirs }), results: withText.map(({ file, start, end, score }) => ({ file, start, end, score })), files: this._index.fileCount, stale }
	}

	/** the hash of the whole project, or of one folder of it */
	hashOf(dir = ''): string | undefined {
		if (!this._tree) return undefined
		let node: MerkleNode | undefined = this._tree
		for (const part of posix(dir).split('/').filter(Boolean)) { node = node.children?.get(part); if (!node) return undefined }
		return node.hash
	}

	async dispose(): Promise<void> {
		this._disposed = true
		if (this._watchTimer) clearTimeout(this._watchTimer)
		if (this._persistTimer) { clearTimeout(this._persistTimer); this._disposed = false; await this._persist(); this._disposed = true }
		try { this._watcher?.close() } catch { /* closed */ }
		this._watcher = undefined
	}
}
