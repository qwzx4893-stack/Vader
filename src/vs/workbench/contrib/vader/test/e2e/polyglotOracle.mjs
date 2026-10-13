#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// TEST-ONLY. The ceiling of the polyglot grader: every selected exercise is graded with its REFERENCE solution (.meta "example" files copied over the "solution" files).
// All of them must pass; one that does not is a grader/toolchain problem (not a model problem) and must be understood before any model result is believed.
// env: POLYGLOT_DIR, POLY_ONLY (csv of lang/name) or POLY_COUNT + POLY_SEED, POLY_LANGS, POLY_GRADER_IMAGE

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const POLY = process.env.POLYGLOT_DIR;
const IMAGE = process.env.POLY_GRADER_IMAGE ?? 'vader-grader';
const LANGS = (process.env.POLY_LANGS ?? 'cpp,go,java,javascript,python,rust').split(',');
const TEST_CMD = { '.py': 'pytest', '.rs': 'cargo test -- --include-ignored', '.go': 'go test ./...', '.js': '/grader/npm-test.sh', '.cpp': '/grader/cpp-test.sh', '.java': 'sh ./gradlew test' };

let list = [];
for (const lang of LANGS) {
	const base = path.join(POLY, lang, 'exercises', 'practice');
	for (const name of fs.readdirSync(base).sort()) { if (fs.existsSync(path.join(base, name, '.meta', 'config.json'))) { list.push({ lang, name, dir: path.join(base, name) }); } }
}
if (process.env.POLY_ONLY) { const want = new Set(process.env.POLY_ONLY.split(',')); list = list.filter(e => want.has(`${e.lang}/${e.name}`)); }
else if (process.env.POLY_FIRST) { const per = Number(process.env.POLY_FIRST); list = LANGS.flatMap(l => list.filter(e => e.lang === l).slice(0, per)); }

let bad = 0;
for (const ex of list) {
	const cfg = JSON.parse(fs.readFileSync(path.join(ex.dir, '.meta', 'config.json'), 'utf8'));
	const sol = cfg.files?.solution ?? [], example = cfg.files?.example ?? [], tests = cfg.files?.test ?? [];
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'poly-oracle-'));
	let ok = false, out = '';
	const t0 = Date.now();
	try {
		fs.cpSync(ex.dir, tmp, { recursive: true, filter: s => { const r = path.relative(ex.dir, s).split(path.sep)[0]; return r !== '.meta' && r !== '.docs'; } });
		sol.forEach((s, i) => { if (example[i]) { fs.mkdirSync(path.dirname(path.join(tmp, s)), { recursive: true }); fs.copyFileSync(path.join(ex.dir, example[i]), path.join(tmp, s)); } });
		// Java references may be several classes: .meta/src/reference/java/* belongs in src/main/java/*
		for (const e of example) { const m = e.split('\\').join('/').match(/^\.meta\/src\/reference\/java\/(.+)$/); if (m) { const dst = path.join(tmp, 'src', 'main', 'java', m[1]); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(path.join(ex.dir, e), dst); } }
		for (const f of tests) { if (f.endsWith('.java')) { const p = path.join(tmp, f); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/@Disabled\([^)]*\)\s*\n/g, '')); } }
		const ext = [...new Set(tests.map(f => path.extname(f)))].find(e => TEST_CMD[e]);
		try { out = execFileSync('docker', ['run', '--rm', '--memory=3g', '-v', `${tmp}:/work/${ex.name}`, '-w', `/work/${ex.name}`, '-v', 'vader-gradle:/root/.gradle', IMAGE, 'bash', '-c', TEST_CMD[ext]], { stdio: 'pipe', timeout: 300_000, maxBuffer: 64 * 1024 * 1024 }).toString(); ok = true; }
		catch (e) { out = `${e.stdout ?? ''}${e.stderr ?? ''}` || String(e.message); }
	} finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ } }
	if (!ok) { bad++; }
	console.log(`${ok ? 'PASS' : 'FAIL'} ${ex.lang}/${ex.name} (${Math.round((Date.now() - t0) / 1000)} s)${ok ? '' : '\n' + out.split('\n').slice(-15).join('\n')}`);
}
console.log(`oracle: ${list.length - bad}/${list.length} reference solutions pass`);
process.exit(bad ? 1 : 0);
