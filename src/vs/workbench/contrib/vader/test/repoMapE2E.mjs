#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The repository map (common/repoMap.ts, tool `repo_map`), bundled from source: definitions found per language, files ranked by who depends on them, output fitted to a budget,
// and the whole thing run on Vader's own source tree (the last check is the one that matters: the map must put the files everything depends on first).
// Run: node src/vs/workbench/contrib/vader/test/repoMapE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-repomap-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/repoMap.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'r.mjs'), logLevel: 'silent' });
const R = await import(pathToFileURL(path.join(tmp, 'r.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const names = (file, text) => R.extractDefinitions(file, text).map(d => `${d.kind}:${d.name}`).join(' ');
const fileOrder = (text) => [...text.matchAll(/^(\S+):$/gm)].map(m => m[1]);

// ---- definitions, language by language
check('TypeScript', names('a.ts', 'export class Foo extends Bar {\n\tprivate x = 1\n\tasync run(a: number): Promise<void> {\n\t}\n\tstatic make(): Foo {\n\t}\n}\nexport const limit = 5\nexport interface Opts { a: string }\nexport type Id = string\nfunction helper() {}\nexport default function main() {}\nconst local = 3\n') === 'class:Foo method:run method:make const:limit interface:Opts type:Id function:helper function:main const:local', names('a.ts', 'export class Foo extends Bar {\n\tprivate x = 1\n\tasync run(a: number): Promise<void> {\n\t}\n\tstatic make(): Foo {\n\t}\n}\nexport const limit = 5\nexport interface Opts { a: string }\nexport type Id = string\nfunction helper() {}\nexport default function main() {}\nconst local = 3\n'));
check('...a call that ends in a brace is not a method', names('a.ts', 'class A {\n\tfoo() {\n\t\tif (x) {\n\t\t\twhile (y) {\n\t\t\t}\n\t\t}\n\t}\n}') === 'class:A method:foo', names('a.ts', 'class A {\n\tfoo() {\n\t\tif (x) {\n\t\t\twhile (y) {\n\t\t\t}\n\t\t}\n\t}\n}'));
check('...a local variable inside a function is not a definition', names('a.ts', 'function f() {\n\tconst inner = 2\n\treturn inner\n}') === 'function:f');
check('Python', names('a.py', 'class Foo(Base):\n    def run(self):\n        pass\n\nasync def go():\n    pass\n# def commented():\n') === 'class:Foo def:run def:go');
check('Go', names('a.go', 'package x\nfunc Top() {}\nfunc (s *Server) Handle(w int) {}\ntype Server struct {\n}\ntype Reader interface {\n}\n') === 'func:Top func:Handle struct:Server interface:Reader', names('a.go', 'package x\nfunc Top() {}\nfunc (s *Server) Handle(w int) {}\ntype Server struct {\n}\ntype Reader interface {\n}\n'));
check('Rust', names('a.rs', 'pub struct Point { x: i32 }\nimpl Point {\n    pub fn new() -> Self { }\n    pub(crate) async fn go(&self) {}\n}\npub trait Draw {}\nenum Kind {}\n') === 'struct:Point impl:Point fn:new fn:go trait:Draw enum:Kind', names('a.rs', 'pub struct Point { x: i32 }\nimpl Point {\n    pub fn new() -> Self { }\n    pub(crate) async fn go(&self) {}\n}\npub trait Draw {}\nenum Kind {}\n'));
check('Java', names('A.java', 'public class Service {\n    private final int n;\n    public static void main(String[] args) {\n    }\n    public List<String> names() {\n    }\n}\ninterface Repo {}\n') === 'class:Service method:main method:names interface:Repo', names('A.java', 'public class Service {\n    private final int n;\n    public static void main(String[] args) {\n    }\n    public List<String> names() {\n    }\n}\ninterface Repo {}\n'));
check('C#', names('A.cs', 'public sealed class Foo {\n    public async Task<int> RunAsync(int a) {\n    }\n}\n') === 'class:Foo method:RunAsync', names('A.cs', 'public sealed class Foo {\n    public async Task<int> RunAsync(int a) {\n    }\n}\n'));
check('Kotlin', names('A.kt', 'data class User(val n: String)\nfun greet(u: User) {}\nprivate suspend fun load() {}\nobject Cache\n') === 'class:User fun:greet fun:load object:Cache', names('A.kt', 'data class User(val n: String)\nfun greet(u: User) {}\nprivate suspend fun load() {}\nobject Cache\n'));
check('Ruby', names('a.rb', 'module Util\n  class Parser\n    def parse(x)\n    end\n    def self.build\n    end\n  end\nend\n') === 'module:Util class:Parser def:parse def:build');
check('PHP', names('a.php', 'class Repo {\n    public function find($id) {}\n    private static function make() {}\n}\n') === 'class:Repo function:find function:make');
check('C', names('a.c', '#include <stdio.h>\nstruct node { int v; };\nstatic int add(int a, int b)\n{\n}\nvoid run(void) {\n}\nint x = foo(3);\n') === 'struct:node func:add func:run', names('a.c', '#include <stdio.h>\nstruct node { int v; };\nstatic int add(int a, int b)\n{\n}\nvoid run(void) {\n}\nint x = foo(3);\n'));
check('C++', names('a.cpp', 'namespace app {\nclass Engine {\n};\n}\nvoid Engine::start() {\n}\n') === 'namespace:app class:Engine func:start', names('a.cpp', 'namespace app {\nclass Engine {\n};\n}\nvoid Engine::start() {\n}\n'));
check('a file type without patterns gives nothing', names('a.md', '# Title\nclass X {}') === '' && names('a.json', '{"function f": 1}') === '');
check('a minified line is ignored', names('a.js', 'function a(){' + 'x'.repeat(400) + '}') === '');
check('line numbers and depth', (() => { const d = R.extractDefinitions('a.ts', 'export class A {\n\tfoo() {\n\t}\n}'); return d[0].line === 1 && d[0].depth === 0 && d[1].line === 2 && d[1].depth === 1; })());

// ---- ranking on a small project: `core.ts` is used by everything
{
	const files = [
		{ path: 'src/core.ts', text: 'export function computeBudgetChars() {}\nexport class Engine {\n\trun() {\n\t}\n}\n' },
		{ path: 'src/a.ts', text: "import { computeBudgetChars, Engine } from './core'\nexport function usesA() { computeBudgetChars(); new Engine() }\n" },
		{ path: 'src/b.ts', text: "import { Engine } from './core'\nexport function usesB() { return new Engine() }\n" },
		{ path: 'src/c.ts', text: "import { usesB } from './b'\nexport function usesC() { return usesB() }\n" },
		{ path: 'src/lonely.ts', text: 'export function nobodyCallsMe() {}\n' },
		{ path: 'README.md', text: '# readme' },
	];
	const r = R.buildRepoMap(files, { maxChars: 4000 });
	const order = fileOrder(r.text);
	check('the file everything uses comes first', order[0] === 'src/core.ts', order.join(','));
	check('a file nobody uses comes last', order[order.length - 1] === 'src/lonely.ts', order.join(','));
	check('non-code files are not in the map', !r.text.includes('README') && r.mappedFiles === 5 && r.totalFiles === 6);
	check('each file lists its definitions with line numbers', /src\/core\.ts:\n\s+1: export function computeBudgetChars/.test(r.text) && /2: export class Engine/.test(r.text), r.text.slice(0, 200));
	const f = R.buildRepoMap(files, { maxChars: 4000, focusPaths: ['src/lonely.ts'] });
	check('a focus file moves up', fileOrder(f.text).indexOf('src/lonely.ts') < order.indexOf('src/lonely.ts'));
	check('a focus file may be given by the end of its path', fileOrder(R.buildRepoMap(files, { maxChars: 4000, focusPaths: ['lonely.ts'] }).text)[0] === 'src/lonely.ts');
	check('the same input gives the same map', R.buildRepoMap(files, { maxChars: 4000 }).text === r.text);
	check('Windows paths are shown with slashes', R.buildRepoMap([{ path: 'src\\x.ts', text: 'export function xx() {}' }], { maxChars: 500 }).text.startsWith('src/x.ts:'));
	check('an empty project gives an empty map', R.buildRepoMap([], { maxChars: 500 }).text === '');
	// a folder as focus: everything under it moves up, and its files get more lines
	const proj = [
		{ path: 'src/core/engine.ts', text: 'export class Engine {}\nexport function start() {}\n' },
		{ path: 'src/app/main.ts', text: "import { Engine, start } from '../core/engine'\nexport function boot() { start(); new Engine() }\n" },
		{ path: 'src/auth/login.ts', text: 'export function loginUser() {}\n' },
		{ path: 'src/auth/session.ts', text: 'export function openSession() {}\n' },
	];
	const folder = fileOrder(R.buildRepoMap(proj, { maxChars: 4000, focusPaths: ['src/auth/'] }).text);
	check('a folder as focus puts the files under it first', folder.slice(0, 2).sort().join() === 'src/auth/login.ts,src/auth/session.ts', folder.join());
	check('...a folder name without the full path works too', fileOrder(R.buildRepoMap(proj, { maxChars: 4000, focusPaths: ['auth'] }).text).slice(0, 2).every(p => p.includes('/auth/')));
}
// ---- the tool is wired everywhere a tool has to be
{
	const read = (rel) => fs.readFileSync(path.join(here, rel), 'utf8');
	const prompts = read('../common/prompt/prompts.ts'), svc = read('../browser/toolsService.ts'), chat = read('../browser/react/src/sidebar-tsx/SidebarChat.tsx'), types = read('../common/toolsServiceTypes.ts'), behavior = read('../common/prompt/agentBehavior.ts');
	check('the tool is described to the model', /repo_map: \{\s*name: 'repo_map'/.test(prompts));
	check('...its parameters are checked, it runs and its result becomes text', /repo_map: \(params: RawToolParamsObj\)/.test(svc) && /repo_map: async \(\{ focus, maxTokens \}\)/.test(svc) && /repo_map: \(params, result\)/.test(svc));
	check('...it only reads: no approval needed', !/'repo_map': '(edits|terminal|MCP tools)'/.test(types));
	check('...it has a title in the chat', /'repo_map': \{ done: 'Mapped the project'/.test(chat));
	check('...it is bounded: file count, file size, time', /REPO_MAP_MAX_FILES = \d+/.test(svc) && /REPO_MAP_MAX_FILE_BYTES = [\d_]+/.test(svc) && /REPO_MAP_TIME_BUDGET_MS = [\d_]+/.test(svc));
	check('...the instructions say when to start with it', /start with repo_map/.test(behavior));
	check('the file search pattern covers the mapped extensions', R.REPO_MAP_INCLUDE_GLOB.startsWith('**/*.{') && ['ts', 'py', 'go', 'rs', 'java', 'cpp'].every(e => R.REPO_MAP_INCLUDE_GLOB.includes(e)));
}
// ---- the budget
{
	const files = Array.from({ length: 300 }, (_, i) => ({ path: `src/m${i}.ts`, text: Array.from({ length: 20 }, (_, j) => `export function fn${i}x${j}Handler() {}`).join('\n') + (i > 0 ? `\nfn${i - 1}x0Handler()` : '') }));
	for (const budget of [1000, 4000, 12000]) {
		const r = R.buildRepoMap(files, { maxChars: budget });
		check(`budget ${budget}: the map fits`, r.text.length <= budget + 400 /* the footer */, `${r.text.length}`);
		check(`budget ${budget}: it says how many files it left out`, r.shownFiles < 300 && /more source files/.test(r.text));
	}
}
// ---- Vader's own source
{
	const root = path.join(here, '..');
	const base = path.join(here, '../../../../../..');
	const files = [];
	const skip = new Set(['node_modules', 'out', 'clineBundle', 'src2', 'fixtures']);
	const walk = (dir) => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const f = path.join(dir, e.name);
			if (e.isDirectory()) { if (!skip.has(e.name)) walk(f); }
			else if (/\.(ts|tsx)$/.test(e.name) && fs.statSync(f).size < 400_000) files.push({ path: path.relative(base, f), text: fs.readFileSync(f, 'utf8') });
		}
	};
	walk(root);
	const t0 = Date.now();
	const r = R.buildRepoMap(files, { maxChars: 10_000 });
	const ms = Date.now() - t0;
	const order = fileOrder(r.text);
	console.log(`(${files.length} files, ${r.mappedFiles} mapped, ${r.shownFiles} shown, ${r.text.length} chars, ${ms} ms; first files: ${order.slice(0, 10).map(p => p.split('/').pop()).join(', ')})`);
	check('Vader\'s own source: the map is built in a few seconds', ms < 5000, `${ms} ms`);
	check('...it fits its budget', r.text.length <= 10_000 + 400);
	const top = order.slice(0, 15).map(p => p.split('/').pop());
	const central = ['chatThreadService.ts', 'toolsServiceTypes.ts', 'modelCapabilities.ts', 'prompts.ts', 'vaderSettingsTypes.ts', 'vaderSettingsService.ts', 'sendLLMMessageTypes.ts', 'chatThreadServiceTypes.ts', 'toolsService.ts', 'convertToLLMMessageService.ts', 'editCodeService.ts'];
	const hits = central.filter(n => top.includes(n));
	check('...the files the rest depends on are among the first 15 (at least 4 of the 11 listed: the map shows 15 files and the project has grown new central modules)', hits.length >= 4, `found ${hits.join(', ')} in ${top.join(', ')}`);
	check('...test scripts and one-off helpers are not', !top.some(n => /E2E|loopDetection|toolNameHints/.test(n)), top.join(', '));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
