/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A tree of hashes over the project: a file's hash is the hash of its text, a folder's hash is the hash of its children's names and hashes. Two trees are compared from the top:
// where a folder's hash is the same on both sides, nothing in it changed and nothing in it is looked at; only the folders whose hash differs are opened. A project of a hundred
// thousand files where one file changed is compared by opening about as many folders as that file is deep. The hash function is given by the caller (the main process has
// `crypto`; a test has its own). Pure.

export type FileEntry = { path: string; hash: string; size: number }
export type MerkleNode = { name: string; path: string; dir: boolean; hash: string; size: number; children?: Map<string, MerkleNode> }
export type MerkleDelta = { added: string[]; modified: string[]; deleted: string[] }

type Hasher = (text: string) => string

export function buildMerkle(entries: readonly FileEntry[], hash: Hasher): MerkleNode {
	const root: MerkleNode = { name: '', path: '', dir: true, hash: '', size: 0, children: new Map() }
	for (const e of entries) {
		const parts = e.path.replace(/\\/g, '/').split('/').filter(Boolean)
		let node = root
		for (let i = 0; i < parts.length - 1; i++) {
			let next = node.children!.get(parts[i])
			if (!next) { next = { name: parts[i], path: parts.slice(0, i + 1).join('/'), dir: true, hash: '', size: 0, children: new Map() }; node.children!.set(parts[i], next) }
			node = next
		}
		const name = parts[parts.length - 1]
		node.children!.set(name, { name, path: parts.join('/'), dir: false, hash: e.hash, size: e.size })
	}
	seal(root, hash)
	return root
}

function seal(node: MerkleNode, hash: Hasher): void {
	if (!node.dir) return
	const names = [...node.children!.keys()].sort()
	let text = '', size = 0
	for (const n of names) {
		const c = node.children!.get(n)!
		seal(c, hash)
		text += `${c.dir ? 'd' : 'f'}:${n}:${c.hash}\n`
		size += c.size
	}
	node.hash = hash(text)
	node.size = size
}

/** what changed from `before` to `after`, opening only the folders whose hash differs */
export function diffMerkle(before: MerkleNode | undefined, after: MerkleNode | undefined): MerkleDelta {
	const delta: MerkleDelta = { added: [], modified: [], deleted: [] }
	const all = (n: MerkleNode, into: string[]) => { if (!n.dir) into.push(n.path); else for (const c of n.children!.values()) all(c, into) }
	const walk = (a: MerkleNode | undefined, b: MerkleNode | undefined) => {
		if (a && !b) { all(a, delta.deleted); return }
		if (!a && b) { all(b, delta.added); return }
		if (!a || !b) return
		if (a.hash === b.hash) return
		if (!a.dir && !b.dir) { delta.modified.push(b.path); return }
		if (a.dir !== b.dir) { all(a, delta.deleted); all(b, delta.added); return } // a file became a folder, or the other way
		for (const name of new Set([...a.children!.keys(), ...b.children!.keys()])) walk(a.children!.get(name), b.children!.get(name))
	}
	walk(before, after)
	delta.added.sort(); delta.modified.sort(); delta.deleted.sort()
	return delta
}

/** the hash of a folder ('' is the whole project), or undefined when there is no such folder */
export function subtreeHash(root: MerkleNode, dir: string): string | undefined {
	let node: MerkleNode | undefined = root
	for (const part of dir.replace(/\\/g, '/').split('/').filter(Boolean)) {
		node = node.children?.get(part)
		if (!node) return undefined
	}
	return node.hash
}

/** the folders and files as a list of entries again (what a persisted snapshot holds) */
export function entriesOf(root: MerkleNode): FileEntry[] {
	const out: FileEntry[] = []
	const walk = (n: MerkleNode) => { if (!n.dir) out.push({ path: n.path, hash: n.hash, size: n.size }); else for (const c of n.children!.values()) walk(c) }
	walk(root)
	return out
}
