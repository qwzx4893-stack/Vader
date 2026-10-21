/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Builds the folder that the app ships for search by meaning: the small runtime (transformers.js and onnxruntime-node, only the files one platform needs) and the embedding model,
// checked against the sizes and SHA-256 hashes in model.lock.json. The result is about 45 MB for Windows plus the 24 MB model.
//
//   node build/embedding/prepare.mjs --out <folder> [--platform win32|linux|darwin] [--arch x64|arm64] [--model-cache <folder>] [--no-model]
//
// <folder> is then copied to <app>/resources/embedding (the Windows workflow does it between packaging and the installer). Nothing here runs on a person's computer.
// The runtime is installed on its own from build/embedding/package-lock.json (scripts off), not as a dependency of the editor, so the editor's install does not change.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback; };
const out = arg('out');
if (!out) { console.error('usage: node build/embedding/prepare.mjs --out <folder> [--platform p] [--arch a] [--model-cache dir] [--no-model]'); process.exit(2); }
const platform = arg('platform', process.platform);
const arch = arg('arch', process.arch);
const modelCache = arg('model-cache');
const lock = JSON.parse(fs.readFileSync(path.join(here, 'model.lock.json'), 'utf8'));

/** packages that the app never loads: the browser build of the runtime, image handling, and what only the install scripts of onnxruntime-node use */
export const EXCLUDED = [/^onnxruntime-web$/, /^sharp$/, /^@img\//, /^@types\//, /^adm-zip$/, /^global-agent$/, /^boolean$/, /^es6-error$/, /^matcher$/, /^roarr$/, /^semver-compare$/, /^serialize-error$/, /^type-fest$/, /^escape-string-regexp$/];

/** the files of onnxruntime-node that one platform needs: the binding and the main library, not the GPU providers */
export function ortFileWanted(file, platform) {
	if (file.endsWith('.node')) return true;
	if (platform === 'win32') return /^onnxruntime\.dll$/i.test(file);
	if (platform === 'linux') return /^libonnxruntime\.so(\.|$)/.test(file);
	if (platform === 'darwin') return /^libonnxruntime.*\.dylib$/.test(file);
	return false;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const size = (dir) => { let t = 0; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); t += e.isDirectory() ? size(p) : fs.statSync(p).size; } return t; };
const mb = (n) => (n / 1048576).toFixed(1);

function run(cmd, cmdArgs, cwd) {
	const r = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
	if (r.status !== 0) { console.error(`failed: ${cmd} ${cmdArgs.join(' ')}`); process.exit(1); }
}

// ---- 1. install the runtime on its own, from the lock file, with scripts off
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-embedding-'));
fs.copyFileSync(path.join(here, 'package.json'), path.join(work, 'package.json'));
fs.copyFileSync(path.join(here, 'package-lock.json'), path.join(work, 'package-lock.json'));
run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=optional', ...(platform !== process.platform || arch !== process.arch ? [`--os=${platform}`, `--cpu=${arch}`] : [])], work);
const nm = path.join(work, 'node_modules');

// ---- 2. the packages the runtime needs, walked from its own package.json
const needed = new Set();
const walk = (name) => {
	if (needed.has(name) || EXCLUDED.some(re => re.test(name))) return;
	const pj = path.join(nm, name, 'package.json');
	if (!fs.existsSync(pj)) return;
	needed.add(name);
	for (const dep of Object.keys(JSON.parse(fs.readFileSync(pj, 'utf8')).dependencies ?? {})) walk(dep);
};
walk('@huggingface/transformers');

fs.rmSync(out, { recursive: true, force: true });
const outNm = path.join(out, 'node_modules');
const skipFile = (rel) => /\.(map|md)$|\.d\.ts$/.test(rel) || /(^|\/)(types|test|tests|docs)\//.test(rel) || /(^|\/)dist\/(transformers\.web|transformers\.js$|transformers\.min\.js$|ort-wasm)/.test(rel)
const copyTree = (src, dst, base = '') => {
	fs.mkdirSync(dst, { recursive: true });
	for (const e of fs.readdirSync(src, { withFileTypes: true })) {
		const rel = base ? `${base}/${e.name}` : e.name;
		if (e.isDirectory()) { copyTree(path.join(src, e.name), path.join(dst, e.name), rel); continue; }
		if (skipFile(rel)) continue;
		fs.copyFileSync(path.join(src, e.name), path.join(dst, e.name));
	}
};
for (const name of needed) {
	if (name === 'onnxruntime-node') {
		const src = path.join(nm, name), dst = path.join(outNm, name);
		for (const d of ['dist', 'lib']) if (fs.existsSync(path.join(src, d))) copyTree(path.join(src, d), path.join(dst, d));
		fs.copyFileSync(path.join(src, 'package.json'), path.join(dst, 'package.json'));
		const bin = path.join(src, 'bin', 'napi-v6', platform, arch);
		if (!fs.existsSync(bin)) { console.error(`onnxruntime-node has no binary for ${platform}/${arch}`); process.exit(1); }
		fs.mkdirSync(path.join(dst, 'bin', 'napi-v6', platform, arch), { recursive: true });
		for (const f of fs.readdirSync(bin)) if (ortFileWanted(f, platform)) fs.copyFileSync(path.join(bin, f), path.join(dst, 'bin', 'napi-v6', platform, arch, f));
		continue;
	}
	copyTree(path.join(nm, name), path.join(outNm, name));
}
// transformers.js imports `sharp` (image decoding) when it loads, and this runtime only embeds text, so a stand-in that fails loudly if it is ever called takes its place:
// the real package and its native files (about 20 MB) are not shipped.
fs.mkdirSync(path.join(outNm, 'sharp'), { recursive: true });
fs.writeFileSync(path.join(outNm, 'sharp', 'package.json'), JSON.stringify({ name: 'sharp', version: '0.0.0-vader-stub', main: 'index.js', description: 'Stand-in: the embedding runtime handles text only.' }, null, 1));
fs.writeFileSync(path.join(outNm, 'sharp', 'index.js'), "module.exports = function sharp() { throw new Error('Image processing is not part of the embedding runtime.'); };");
needed.add('sharp (stand-in)');

// the licences of what is shipped travel with it
for (const name of needed) for (const f of fs.existsSync(path.join(nm, name)) ? fs.readdirSync(path.join(nm, name)) : []) if (/^licen[cs]e/i.test(f) || /^notice/i.test(f)) { fs.mkdirSync(path.join(outNm, name), { recursive: true }); fs.copyFileSync(path.join(nm, name, f), path.join(outNm, name, f)); }

// ---- 3. the models, checked byte for byte against the lock: the code model (lock) and the quick tier (lock.static)
async function fetchModel(spec) {
	const dir = path.join(out, 'models', spec.name);
	for (const [file, want] of Object.entries(spec.files)) {
		let buf;
		const cached = modelCache && path.join(modelCache, spec.name, file);
		if (cached && fs.existsSync(cached)) buf = fs.readFileSync(cached);
		if (!buf || buf.length !== want.bytes || sha256(buf) !== want.sha256) {
			const url = `${spec.source}/resolve/${spec.revision}/${file}`;
			console.log(`fetching ${url}`);
			const res = await fetch(url);
			if (!res.ok) { console.error(`${url}: ${res.status}`); process.exit(1); }
			buf = Buffer.from(await res.arrayBuffer());
		}
		if (buf.length !== want.bytes || sha256(buf) !== want.sha256) { console.error(`${file} does not match the lock (got ${buf.length} bytes, sha256 ${sha256(buf)})`); process.exit(1); }
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), buf);
	}
	fs.writeFileSync(path.join(dir, 'LICENSE-NOTE.txt'), `${spec.name}
Source: ${spec.source} (revision ${spec.revision})
Original: ${spec.original}
License: ${spec.license}
Provenance: ${spec.provenance}
`);
	return dir;
}
const modelDir = path.join(out, 'models', lock.name);
if (!args.includes('--no-model')) {
	await fetchModel(lock);
	await fetchModel(lock.static);
}

fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ model: { name: lock.name, revision: lock.revision, ...lock.runtime }, static: { name: lock.static.name, revision: lock.static.revision, ...lock.static.runtime }, platform, arch, packages: [...needed].sort() }, null, 1));
fs.rmSync(work, { recursive: true, force: true });
console.log(`embedding folder ready: ${out}\n  packages: ${[...needed].sort().join(', ')}\n  runtime ${mb(size(outNm))} MB${args.includes('--no-model') ? '' : `, code model ${mb(size(modelDir))} MB, quick tier ${mb(size(path.join(out, 'models', lock.static.name)))} MB`}`);
