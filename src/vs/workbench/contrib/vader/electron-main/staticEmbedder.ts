/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { parseSafetensors, StaticEmbedder } from '../common/codebaseIndex/staticModel.js';

// Loads the cheap tier of search by meaning from the app's embedding folder (build/embedding/prepare.mjs makes it): a Model2Vec static model, whose tokenizer comes from the small
// `@huggingface/tokenizers` package that is already part of the runtime. Nothing is fetched. It runs on the main thread: a piece takes about 0.4 ms and the table is read once.

export type StaticManifest = { name: string; dims: number; requiredFiles: string[] }

/** what the folder's manifest says about its static model, or undefined when it has none */
export function readStaticManifest(embeddingDir: string): StaticManifest | undefined {
	try {
		const m = (JSON.parse(fs.readFileSync(path.join(embeddingDir, 'manifest.json'), 'utf8')) as { static?: Partial<StaticManifest> }).static
		if (!m || typeof m.name !== 'string' || typeof m.dims !== 'number' || !Array.isArray(m.requiredFiles)) return undefined
		if (!/^[A-Za-z0-9._-]+$/.test(m.name)) return undefined // the name becomes a folder name
		return { name: m.name, dims: m.dims, requiredFiles: m.requiredFiles }
	} catch { return undefined }
}

/** the file to import for a package, from its package.json: the Node `import` entry of "exports", else its `import` or `default`, else `main` */
export function esmEntryOf(pkg: { exports?: unknown; main?: string }): string | undefined {
	const pick = (v: unknown): string | undefined => typeof v === 'string' ? v : (v && typeof v === 'object') ? pick((v as Record<string, unknown>)['default']) : undefined
	const dot = pkg.exports && typeof pkg.exports === 'object' ? (pkg.exports as Record<string, unknown>)['.'] ?? pkg.exports : pkg.exports
	if (dot && typeof dot === 'object') {
		const d = dot as Record<string, unknown>
		const node = d['node'] && typeof d['node'] === 'object' ? d['node'] as Record<string, unknown> : undefined
		return pick(node?.['import']) ?? pick(d['import']) ?? pick(d['default']) ?? pkg.main
	}
	return pick(dot) ?? pkg.main
}

export function staticModelIsInstalled(embeddingDir: string): boolean {
	const m = readStaticManifest(embeddingDir)
	if (!m) return false
	const dir = path.join(embeddingDir, 'models', m.name)
	return m.requiredFiles.every(f => fs.existsSync(path.join(dir, f))) && fs.existsSync(path.join(embeddingDir, 'node_modules', '@huggingface', 'tokenizers', 'package.json'))
}

export async function createStaticEmbedder(embeddingDir: string): Promise<StaticEmbedder | undefined> {
	if (!staticModelIsInstalled(embeddingDir)) return undefined
	const m = readStaticManifest(embeddingDir)!
	try {
		const pkgDir = path.join(embeddingDir, 'node_modules', '@huggingface', 'tokenizers')
		const entry = esmEntryOf(JSON.parse(await fs.promises.readFile(path.join(pkgDir, 'package.json'), 'utf8')))
		if (!entry) return undefined
		const lib = await import(pathToFileURL(path.join(pkgDir, entry)).href) as { Tokenizer: new (json: object, config: object) => { encode(text: string, o: { add_special_tokens: boolean }): { ids: number[] } } }
		const dir = path.join(embeddingDir, 'models', m.name)
		const tokJson = JSON.parse(await fs.promises.readFile(path.join(dir, 'tokenizer.json'), 'utf8')) as { model?: { vocab?: Record<string, number>; unk_token?: string } }
		const tokenizer = new lib.Tokenizer(tokJson, {})
		const table = parseSafetensors(await fs.promises.readFile(path.join(dir, 'model.safetensors')))
		if (!table || table.dims !== m.dims) return undefined
		const unkId = tokJson.model?.unk_token !== undefined ? tokJson.model.vocab?.[tokJson.model.unk_token] : undefined
		return new StaticEmbedder(table, text => tokenizer.encode(text, { add_special_tokens: false }).ids, { unkId })
	} catch { return undefined }
}
