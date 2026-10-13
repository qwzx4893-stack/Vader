/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A map of a repository: its most important files and, for each, the definitions other files depend on, fitted to a size budget. The model gets the shape of a large project
// without reading it. The idea is Aider's repo map (Apache-2.0, aider/repomap.py): definitions and the places that mention them form a graph between files, PageRank
// orders the files, and the output is cut to a token budget. Implemented here from the idea, not from its code, and without a parser: definitions are found by line patterns for the
// common languages (the way ctags-based maps worked before tree-sitter), which is less exact but has no wasm to load, no native module and no language that fails to parse.
// Pure and deterministic: the tool in browser/toolsService.ts only lists and reads the files.

export type RepoFile = { path: string, text: string }
export type RepoDefinition = { name: string, kind: string, line: number, text: string, depth: number }

const MAX_LINE_CHARS = 300 // longer lines are minified code or data, not a definition
const MAX_DEFS_PER_FILE = 400
const MAX_DEFINERS = 4 // a name defined in more files than this (`get`, `render`, `main`) says nothing about which file matters
const PAGERANK_ITERATIONS = 25
const DAMPING = 0.85
const FOCUS_BOOST = 10
const COMMON_WORD_SHARE = 0.12 // a name found in more than this share of the files (and in at least MIN_FILES_FOR_COMMON) is ignored as a pointer
const MIN_FILES_FOR_COMMON = 25
const CONTAINER_KINDS = new Set(['class', 'interface', 'struct', 'trait', 'enum', 'type', 'namespace', 'module', 'object', 'impl', 'record', 'protocol'])

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'else', 'do', 'try', 'with', 'throw', 'await', 'typeof', 'sizeof', 'super', 'this', 'constructor', 'match', 'elif', 'when', 'using', 'lock', 'foreach', 'defined'])

type Pattern = { re: RegExp, kind: (m: RegExpExecArray) => string, name: (m: RegExpExecArray) => string, topLevelOnly?: boolean }

const MODS_JS = '(?:(?:public|private|protected|static|readonly|abstract|override|async|get|set|declare)\\s+)*'
const JS: Pattern[] = [
	{ re: /^(\s*)(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(function\*?|class|interface|enum|namespace)\s+([A-Za-z_$][\w$]*)/, kind: m => m[2], name: m => m[3] },
	{ re: /^(\s*)(?:export\s+)(?:default\s+)?(?:declare\s+)?(const|let|var|type)\s+([A-Za-z_$][\w$]*)/, kind: m => m[2], name: m => m[3] },
	{ re: /^()(const|let|var|type)\s+([A-Za-z_$][\w$]*)\s*[=:<]/, kind: m => m[2], name: m => m[3], topLevelOnly: true },
	{ re: new RegExp('^(\\s{1,8})' + MODS_JS + '([A-Za-z_$][\\w$]*)\\s*(?:<[^>()]*>)?\\([^)]*\\)\\s*(?::\\s*[^={;]+)?\\s*\\{\\s*$'), kind: () => 'method', name: m => m[2] },
]
const PY: Pattern[] = [{ re: /^(\s*)(?:async\s+)?(def|class)\s+(\w+)/, kind: m => m[2], name: m => m[3] }]
const GO: Pattern[] = [
	{ re: /^()func\s+(?:\([^)]*\)\s*)?(\w+)/, kind: () => 'func', name: m => m[2] },
	{ re: /^()type\s+(\w+)\s+(struct|interface)/, kind: m => m[3], name: m => m[2] },
]
const RUST: Pattern[] = [{ re: /^(\s*)(?:pub(?:\([^)]*\))?\s+)?(?:(?:async|unsafe|const|extern(?:\s+"[^"]*")?)\s+)*(fn|struct|enum|trait|mod|type|impl)\s+(?:<[^>]*>\s*)?([A-Za-z_]\w*)/, kind: m => m[2], name: m => m[3] }]
const JVM: Pattern[] = [
	{ re: /^(\s*)(?:(?:public|private|protected|internal|static|final|abstract|sealed|open|data|partial|override|suspend|inline|value|async|actual|expect)\s+)*(class|interface|enum|record|struct|object|trait|protocol|extension)\s+(\w+)/, kind: m => m[2], name: m => m[3] },
	{ re: /^(\s*)(?:(?:public|private|protected|internal|static|final|abstract|override|open|suspend|inline|async|virtual|synchronized|native|operator)\s+)*(?:fun|func)\s+(?:<[^>]*>\s*)?(?:[\w.<>?]+\.)?(\w+)/, kind: () => 'fun', name: m => m[2] },
	{ re: /^(\s+)(?:(?:public|private|protected|internal|static|final|abstract|override|virtual|async|synchronized|native)\s+)+[\w<>\[\],.? ]+?\s+(\w+)\s*\(/, kind: () => 'method', name: m => m[2] },
]
const RUBY: Pattern[] = [{ re: /^(\s*)(def|class|module)\s+(?:self\.)?(\w+[?!]?)/, kind: m => m[2], name: m => m[3] }]
const PHP: Pattern[] = [{ re: /^(\s*)(?:(?:public|private|protected|static|abstract|final)\s+)*(function|class|interface|trait)\s+&?(\w+)/, kind: m => m[2], name: m => m[3] }]
const C: Pattern[] = [
	{ re: /^()(?:template\s*<[^>]*>\s*)?(class|struct|enum|namespace|union)\s+(\w+)/, kind: m => m[2], name: m => m[3] },
	{ re: /^()[A-Za-z_][\w:<>,*&~ \t]*?\b([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:override\s*)?\{?\s*$/, kind: () => 'func', name: m => m[2], topLevelOnly: true },
]

const PATTERNS_OF_EXT: Record<string, Pattern[]> = {
	ts: JS, tsx: JS, js: JS, jsx: JS, mjs: JS, cjs: JS, mts: JS, cts: JS,
	py: PY, pyi: PY,
	go: GO,
	rs: RUST,
	java: JVM, kt: JVM, kts: JVM, cs: JVM, scala: JVM, swift: JVM, dart: JVM,
	rb: RUBY,
	php: PHP,
	c: C, h: C, cc: C, cpp: C, cxx: C, hpp: C, hh: C, hxx: C, m: C, mm: C,
}

/** The file pattern that selects the languages the map covers, for a file search. */
export const REPO_MAP_INCLUDE_GLOB = '**/*.{' + Object.keys(PATTERNS_OF_EXT).join(',') + '}'

export const isMappedFile = (filePath: string): boolean => !!PATTERNS_OF_EXT[extensionOf(filePath)]
const extensionOf = (p: string) => { const i = p.lastIndexOf('.'); return i < 0 ? '' : p.slice(i + 1).toLowerCase() }

/** Definitions found in one file, in file order. Languages without a pattern set give none. */
export const extractDefinitions = (filePath: string, text: string): RepoDefinition[] => {
	const patterns = PATTERNS_OF_EXT[extensionOf(filePath)]
	if (!patterns) { return [] }
	const defs: RepoDefinition[] = []
	const lines = text.split('\n')
	for (let i = 0; i < lines.length && defs.length < MAX_DEFS_PER_FILE; i++) {
		const line = lines[i].replace(/\r$/, '')
		if (line.length > MAX_LINE_CHARS || line.trim().length < 3) { continue }
		const trimmed = line.trimStart()
		if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith('/*')) { continue } // comments, preprocessor lines, attributes
		for (const p of patterns) {
			const m = p.re.exec(line)
			if (!m) { continue }
			const name = p.name(m)
			if (!name || KEYWORDS.has(name)) { continue }
			const indent = line.length - trimmed.length
			if (p.topLevelOnly && indent > 0) { continue }
			const tabs = (line.slice(0, indent).match(/\t/g) ?? []).length
			const depth = tabs > 0 ? tabs : Math.floor((indent - tabs) / 2)
			defs.push({ name, kind: p.kind(m), line: i + 1, text: trimmed.replace(/\s*\{\s*$/, '').replace(/\s+/g, ' ').slice(0, 110), depth })
			break
		}
	}
	return defs
}

const IDENT = /[A-Za-z_][A-Za-z0-9_]{2,}/g
export const countIdentifiers = (text: string): Map<string, number> => {
	const counts = new Map<string, number>()
	for (const id of text.match(IDENT) ?? []) { counts.set(id, (counts.get(id) ?? 0) + 1) }
	return counts
}

// a long compound name (`computeBudgetChars`, `repo_map_tool`) points at one thing; a short common word does not
const isSpecific = (id: string) => id.length >= 8 && (/[a-z][A-Z]/.test(id) || id.includes('_') || /^[A-Z][a-z]+[A-Z]/.test(id))

export type RepoMapOptions = {
	/** characters of output (about 4 per token) */
	maxChars: number
	/** files the person or the task is about: they rank higher, and their definitions are listed fully */
	focusPaths?: readonly string[]
}

export type RepoMapResult = { text: string, totalFiles: number, mappedFiles: number, shownFiles: number }

export const buildRepoMap = (files: readonly RepoFile[], opts: RepoMapOptions): RepoMapResult => {
	const norm = (p: string) => p.replace(/\\/g, '/')
	const code = files.filter(f => isMappedFile(f.path)).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) // sorted: the same project gives the same map
	const n = code.length
	if (n === 0) { return { text: '', totalFiles: files.length, mappedFiles: 0, shownFiles: 0 } }

	const defsOf = code.map(f => extractDefinitions(f.path, f.text))
	const idsOf = code.map(f => countIdentifiers(f.text))

	// who defines which name
	const definers = new Map<string, number[]>()
	defsOf.forEach((defs, fi) => { for (const d of defs) { const a = definers.get(d.name); if (!a) { definers.set(d.name, [fi]) } else if (!a.includes(fi)) { a.push(fi) } } })

	// edges: file -> files that define what it mentions; and how often each definition is mentioned from OTHER files
	const out: Map<number, number>[] = code.map(() => new Map())
	const mentionedBy = new Map<string, number>() // `${fileIdx}\u0000${name}` -> weighted mentions from other files
	// a word found in a large share of all files (`type`, `name`, `value`, `string`) is language, not a pointer to one definition
	const filesWith = new Map<string, number>()
	for (const ids of idsOf) { for (const id of ids.keys()) { filesWith.set(id, (filesWith.get(id) ?? 0) + 1) } }
	const commonAbove = Math.max(MIN_FILES_FOR_COMMON, n * COMMON_WORD_SHARE)
	idsOf.forEach((ids, fi) => {
		for (const [id, count] of ids) {
			const ds = definers.get(id)
			if (!ds || ds.length > MAX_DEFINERS || (filesWith.get(id) ?? 0) > commonAbove) { continue }
			const w = Math.sqrt(count) * (isSpecific(id) ? 5 : 1) * (id.startsWith('_') ? 0.1 : 1)
			for (const dj of ds) {
				if (dj === fi) { continue }
				out[fi].set(dj, (out[fi].get(dj) ?? 0) + w / ds.length)
				const k = dj + '\u0000' + id
				mentionedBy.set(k, (mentionedBy.get(k) ?? 0) + w / ds.length)
			}
		}
	})

	// PageRank, teleporting towards the focus files
	const focus = new Set((opts.focusPaths ?? []).map(norm))
	const isFocus = (p: string) => focus.has(p) || [...focus].some(fp => { const dir = fp.replace(/\/+$/, ''); return p.endsWith('/' + fp) || fp.endsWith('/' + p) || p.startsWith(dir + '/') || p.includes('/' + dir + '/') })
	const tele = code.map(f => isFocus(norm(f.path)) ? FOCUS_BOOST : 1)
	const teleSum = tele.reduce((a, b) => a + b, 0)
	const teleP = tele.map(t => t / teleSum)
	const outSum = out.map(m => { let s = 0; for (const w of m.values()) { s += w } return s })
	let rank = teleP.slice()
	for (let it = 0; it < PAGERANK_ITERATIONS; it++) {
		const next = teleP.map(p => (1 - DAMPING) * p)
		let dangling = 0
		for (let i = 0; i < n; i++) {
			if (outSum[i] === 0) { dangling += rank[i]; continue }
			for (const [j, w] of out[i]) { next[j] += DAMPING * rank[i] * (w / outSum[i]) }
		}
		for (let i = 0; i < n; i++) { next[i] += DAMPING * dangling * teleP[i] }
		rank = next
	}

	const order = code.map((_, i) => i).sort((a, b) => (rank[b] - rank[a]) || (code[a].path < code[b].path ? -1 : 1))

	const renderFile = (fi: number, maxDefs: number): string => {
		const defs = defsOf[fi]
		const scored = defs.map((d, idx) => ({ d, idx, score: (mentionedBy.get(fi + '\u0000' + d.name) ?? 0) + (d.depth === 0 ? 0.5 : 0) + (CONTAINER_KINDS.has(d.kind) ? 2 : 0) - d.depth * 0.1 }))
		const chosen = scored.sort((a, b) => b.score - a.score || a.idx - b.idx).slice(0, maxDefs).sort((a, b) => a.idx - b.idx)
		const body = chosen.map(({ d }) => `${String(d.line).padStart(5)}: ${'  '.repeat(Math.min(d.depth, 3))}${d.text}`)
		const omitted = defs.length - chosen.length
		return `${norm(code[fi].path)}:\n${body.join('\n')}${omitted > 0 ? `\n      ... (${omitted} more)` : ''}\n`
	}

	const parts: string[] = []
	let used = 0
	let shown = 0
	for (let r = 0; r < order.length; r++) {
		const fi = order[r]
		if (defsOf[fi].length === 0) { continue }
		const isFocus = tele[fi] > 1
		const wanted = isFocus ? 25 : r < 15 ? 10 : r < 60 ? 5 : 2
		let block = renderFile(fi, wanted)
		if (used + block.length > opts.maxChars) {
			block = renderFile(fi, 2)
			if (used + block.length > opts.maxChars) { if (r > 30) { break } else { continue } }
		}
		parts.push(block)
		used += block.length
		shown++
	}
	const rest = order.filter(fi => defsOf[fi].length > 0).length - shown
	const footer = rest > 0 ? `\n(${rest} more source files with definitions are not shown; ask for the map with focus on a file or folder to see more of it)\n` : ''
	return { text: parts.join('\n') + footer, totalFiles: files.length, mappedFiles: n, shownFiles: shown }
}
