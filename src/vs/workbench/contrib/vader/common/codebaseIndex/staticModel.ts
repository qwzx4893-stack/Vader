/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The cheap tier of search by meaning: a static embedding model (Model2Vec, potion-code-16M-v2, MIT, distilled from the code model CodeRankEmbed). It has no network to run: a piece of
// text is cut into tokens, each token has a row in a table of 256 numbers, the rows are averaged and the average is scaled to length one. That takes about 0.4 ms for a piece of code
// (the code model takes a quarter of a second), so every piece of a project has a vector within a second or two of being indexed, and a question is embedded in well under a millisecond.
// This file is the pure part: reading the table and averaging. The tokenizer is given to it (staticEmbedder.ts loads it).

export type StaticTable = { rows: number; dims: number; /** the table as 16-bit floats, row after row */ data: Uint16Array }

/** the 65,536 values a 16-bit float can have, as 32-bit floats, so that reading the table is a lookup */
let f16Values: Float32Array | undefined
export function halfToFloat(): Float32Array {
	if (f16Values) return f16Values
	const t = new Float32Array(65536)
	for (let h = 0; h < 65536; h++) {
		const s = (h & 0x8000) >> 15, e = (h & 0x7C00) >> 10, f = h & 0x03FF
		t[h] = e === 0 ? (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024) : e === 31 ? (f ? NaN : (s ? -Infinity : Infinity)) : (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024)
	}
	return (f16Values = t)
}

/** the table in a .safetensors file that holds one 16-bit tensor named "embeddings" (what Model2Vec writes), or undefined when the file is something else or damaged */
export function parseSafetensors(buf: Uint8Array): StaticTable | undefined {
	if (buf.length < 16) return undefined
	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
	const headerLen = Number(view.getBigUint64(0, true))
	if (!Number.isFinite(headerLen) || headerLen <= 0 || 8 + headerLen > buf.length) return undefined
	let header: { embeddings?: { dtype?: string; shape?: number[]; data_offsets?: number[] } }
	try { header = JSON.parse(new TextDecoder().decode(buf.subarray(8, 8 + headerLen))) } catch { return undefined }
	const t = header.embeddings
	if (!t || t.dtype !== 'F16' || !t.shape || t.shape.length !== 2 || !t.data_offsets || t.data_offsets.length !== 2) return undefined
	const [rows, dims] = t.shape
	const [from, to] = t.data_offsets
	if (rows <= 0 || dims <= 0 || to - from !== rows * dims * 2 || 8 + headerLen + to > buf.length) return undefined
	// a copy, so that it starts on an even byte (Buffer.slice, which a file read gives, is a view, not a copy, so the Uint8Array method is called on purpose)
	const bytes = Uint8Array.prototype.slice.call(buf, 8 + headerLen + from, 8 + headerLen + to) as Uint8Array
	return { rows, dims, data: new Uint16Array(bytes.buffer, 0, rows * dims) }
}

export class StaticEmbedder {
	private readonly _values = halfToFloat()

	/** `encode` turns text into token numbers (no special tokens added); a token number outside the table, or `unkId`, is left out */
	constructor(private readonly _table: StaticTable, private readonly _encode: (text: string) => number[], private readonly _o: { unkId?: number; maxTokens?: number } = {}) { }

	get dims(): number { return this._table.dims }

	embed(text: string): Float32Array {
		const { rows, dims, data } = this._table
		let ids = this._encode(text)
		const max = this._o.maxTokens ?? 512
		if (ids.length > max) ids = ids.slice(0, max)
		const out = new Float32Array(dims)
		let used = 0
		for (const id of ids) {
			if (id < 0 || id >= rows || id === this._o.unkId) continue
			const o = id * dims
			for (let d = 0; d < dims; d++) out[d] += this._values[data[o + d]]
			used++
		}
		if (used === 0) return out
		let s = 0
		for (let d = 0; d < dims; d++) { out[d] /= used; s += out[d] * out[d] }
		const norm = Math.sqrt(s) || 1
		for (let d = 0; d < dims; d++) out[d] /= norm
		return out
	}
}
