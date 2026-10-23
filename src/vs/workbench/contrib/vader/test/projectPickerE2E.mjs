#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Node unit/service boundaries only. Does not run a browser or establish native editor behavior.
// Run: node src/vs/workbench/contrib/vader/test/projectPickerE2E.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const ts = require('typescript');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-project-picker-'));
let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log(`PASS: ${name}`); };
const load = async (rel, name, plugins = []) => {
	const outfile = path.join(tmp, name + '.mjs');
	await esbuild.build({ entryPoints: [path.join(here, rel)], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent', plugins });
	return import(pathToFileURL(outfile).href);
};
try {
	const M = await load('../common/projectPickerModel.ts', 'model');
	const G = await load('../common/threadProjects.ts', 'groups');
	await check('no folders or history produces no fabricated projects', () => assert.deepEqual(M.projectChoices([], [], [], []), []));
	await check('current folder, conversation projects and actual history are ordered and deduplicated', () => {
		const rows = M.projectChoices(['C:\\work\\app\\'], [['c:/work/app'], ['/work/api']], ['/work/recent', '/work/api'], []);
		assert.deepEqual(rows.map(r => r.key), ['c:/work/app', '/work/api', '/work/recent']);
	});
	await check('multi-root conversations keep every actual folder and colliding names gain a parent', () => {
		const rows = M.projectChoices(['/a/web', '/a/api'], [['/b/web']], [], []);
		assert.deepEqual(rows[0].folders, ['/a/web', '/a/api']);
		assert.deepEqual(rows.map(r => r.name), ['a / web', 'b / web']);
	});
	await check('isolated task copies resolve to the public project, including editor history', () => {
		const rows = M.projectChoices(['/tmp/task-copy'], [['/projects/app']], ['/tmp/task-copy'], [{ repoPath: '/projects/app', worktreePath: '/tmp/task-copy' }]);
		assert.equal(rows.length, 1); assert.equal(rows[0].key, '/projects/app');
		assert.deepEqual(rows[0].folders, ['/projects/app']);
	});
	await check('long paths retain their full identity and hidden conversation scopes are not merged', () => {
		const key = '/projects/' + 'nested/'.repeat(60) + 'app';
		assert.equal(M.projectChoices([], [[key]], [], [])[0].key, key);
		const groups = G.groupThreadsByProject([{ id: 'old', lastModified: '1', messageCount: 1 }, { id: 'hidden', lastModified: '2', messageCount: 1, projectFolders: ['/hidden'], hidden: true }]);
		assert.equal(groups.length, 1); assert.equal(groups[0].key, null);
	});
	await check('drafts with real file context or hidden tasks cannot be recycled', () => {
		const empty = { messages: [], state: { stagingSelections: [] } };
		assert.equal(M.reusableProjectDraft(empty), true);
		assert.equal(M.reusableProjectDraft({ ...empty, state: { stagingSelections: [{}] } }), false);
		assert.equal(M.reusableProjectDraft({ ...empty, isSubagentThread: true }), false);
		assert.equal(M.reusableProjectDraft({ ...empty, isVerificationThread: true }), false);
	});

	// Compile the actual service, substituting DI registration only. The workspace/file/dialog
	// dependencies below are explicit test doubles, not a claim of native integration.
	const di = `export const IConfigurationService=()=>{}, IWorkspaceContextService=()=>{}, IWorkspacesService=()=>{}, IWorkspaceEditingService=()=>{}, IFileDialogService=()=>{}, IFileService=()=>{}, IChatThreadService=()=>{}, ITaskCopyService=()=>{};
export const Registry={as:()=>({registerConfiguration(){}})}, ConfigurationScope={APPLICATION:1}, Extensions={Configuration:'test'}, InstantiationType={Delayed:1}; export function registerSingleton(){};
export const isRecentFolder=r=>!!r.folderUri;`;
	const servicePlugin = { name: 'test-di', setup(build) {
		build.onResolve({ filter: /(?:configuration\/common\/configuration(?:Registry)?|registry\/common\/platform|instantiation\/common\/extensions|workspace\/common\/workspace|workspaces\/common\/workspaces|workspaces\/common\/workspaceEditing|dialogs\/common\/dialogs|files\/common\/files|chatThreadService|taskCopyService)\.js$/ }, args => ({ path: args.path, namespace: 'test-di' }));
		build.onLoad({ filter: /.*/, namespace: 'test-di' }, () => ({ contents: di, loader: 'js' }));
		build.onLoad({ filter: /vaderShellService\.ts$/ }, args => ({ contents: fs.readFileSync(args.path, 'utf8') + '\nexport { VaderShellService };', loader: 'ts' }));
	} };
	const { VaderShellService } = await load('../browser/vaderShellService.ts', 'service', [servicePlugin]);
	const { URI } = await load('../../../../base/common/uri.ts', 'uri');
	const fixture = () => {
		let folders = ['/project/one'];
		let selection;
		let failHistory = false, cancelSwitch = false;
		const calls = [];
		const chat = {
			state: { currentThreadId: 'one', allThreads: {
				one: { id: 'one', projectFolders: ['/project/one'], lastModified: '1' },
				two: { id: 'two', projectFolders: ['/project/two'], lastModified: '2' },
			} }, streamState: {},
			listProjectGroups: () => [{ key: '/project/one', threadIds: ['one'] }, { key: '/project/two', threadIds: ['two'] }],
			switchToThread(id) { calls.push(['thread', id]); chat.state.currentThreadId = id; },
			openNewThread() { calls.push(['new']); },
		};
		const service = new VaderShellService({ getValue: () => true },
			{ getWorkspace: () => ({ folders: folders.map(p => ({ uri: URI.file(p) })) }), onDidChangeWorkspaceFolders: () => ({ dispose() {} }) },
			{ async getRecentlyOpened() { if (failHistory) throw Error('history unavailable'); return { workspaces: [{ folderUri: URI.file('/recent') }, { workspace: { configPath: URI.file('/saved.code-workspace') } }], files: [] }; } },
			{ async updateFolders(index, count, added, report) { calls.push(['workspace', index, count, report]); if (!cancelSwitch) folders = added.map(a => a.uri.fsPath.replace(/\\/g, '/')); } },
			{ showOpenDialog: async () => selection },
			{ async stat(uri) { if (uri.fsPath.endsWith('missing')) throw Error('missing'); return { isDirectory: true }; } }, chat, { getState: () => undefined });
		return { service, chat, calls, get folders() { return folders; }, set selection(v) { selection = v; }, set failHistory(v) { failHistory = v; }, set cancelSwitch(v) { cancelSwitch = v; } };
	};
	await check('history read failures retain actual known projects and report unavailability', async () => {
		const f = fixture(); f.failHistory = true;
		const r = await f.service.listProjects(); assert.equal(r.historyUnavailable, true); assert.deepEqual(r.projects.map(p => p.key), ['/project/one', '/project/two']); f.service.dispose();
	});
	await check('selecting an existing project changes real workspace dependency before continuing its conversation', async () => {
		const f = fixture(); await f.service.selectProject(['/project/two']);
		assert.deepEqual(f.folders, ['/project/two']); assert.deepEqual(f.calls, [['workspace', 0, 1, true], ['thread', 'two']]); f.service.dispose();
	});
	await check('Chat (no project) opens an empty workspace and a real chat', async () => {
		const f = fixture(); await f.service.selectProject([]);
		assert.deepEqual(f.folders, []); assert.deepEqual(f.calls.at(-1), ['new']); f.service.dispose();
	});
	await check('New project cancellation leaves workspace and conversation untouched', async () => {
		const f = fixture(); await f.service.newProject(); assert.deepEqual(f.calls, []); f.service.dispose();
	});
	await check('New project uses the selected native folder and requests a new conversation', async () => {
		const f = fixture(); f.selection = [URI.file('/chosen')]; await f.service.newProject();
		assert.deepEqual(f.folders, ['/chosen']); assert.deepEqual(f.calls.at(-1), ['new']); f.service.dispose();
	});
	await check('a canceled editor workspace transition never switches the conversation', async () => {
		const f = fixture(); f.cancelSwitch = true; await assert.rejects(f.service.selectProject(['/project/two']), /did not open/);
		assert.equal(f.chat.state.currentThreadId, 'one'); f.service.dispose();
	});
	await check('unavailable folders fail before any workspace mutation', async () => {
		const f = fixture(); await assert.rejects(f.service.selectProject(['/missing'])); assert.deepEqual(f.calls, []); f.service.dispose();
	});
	await check('active tasks prevent workspace switching without interrupting or relabeling them', async () => {
		const f = fixture(); f.chat.streamState.one = { isRunning: 'LLM' };
		await assert.rejects(f.service.openThread('two'), /Stop the running task/); assert.deepEqual(f.calls, []); f.service.dispose();
	});
	await check('native file dialog cancellation and selected URIs remain real results', async () => {
		const f = fixture(); assert.equal(await f.service.pickContextFiles(), undefined);
		f.selection = [URI.file('/context.txt')]; assert.equal((await f.service.pickContextFiles())[0].fsPath, URI.file('/context.txt').fsPath); f.service.dispose();
	});

	const P = await load('../common/prompt/prompts.ts', 'prompts');
	await check('persisted file chips restore URIs and real file contents enter request context', async () => {
		const file = path.join(tmp, 'context.txt'); fs.writeFileSync(file, 'real attachment content 4937');
		const stored = JSON.stringify([{ type: 'File', uri: URI.file(file), language: 'plaintext', state: { wasAddedAsCurrentFile: false } }]);
		const selections = JSON.parse(stored, (_key, value) => value?.$mid === 1 ? URI.from(value) : value);
		const request = await P.chat_userMessageContent('Read this', selections, { fileService: { readFile: async uri => ({ value: fs.readFileSync(uri.fsPath) }) }, directoryStrService: {} });
		assert.match(request, /real attachment content 4937/); assert.match(request, /SELECTIONS/); assert.match(request, /Read this/);
	});
	// Exercise actual composer persistence methods with an isolated storage/state seam, using
	// the TypeScript AST rather than a copied implementation. This does not instantiate the runtime.
	const source = fs.readFileSync(path.join(here, '../browser/chatThreadService.ts'), 'utf8');
	const ast = ts.createSourceFile('chat.ts', source, ts.ScriptTarget.Latest, true);
	const cls = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'ChatThreadService');
	const names = ['setThreadComposerState', 'setCurrentThreadState', '_currentWorkspaceFolders', '_adoptCurrentProject', 'openNewThread'];
	const methods = cls.members.filter(n => names.includes(n.name?.getText(ast))).map(n => n.getText(ast)).join('\n');
	const factory = ast.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === 'newThreadObject')).getText(ast);
	const compiled = ts.transpileModule(`import { randomUUID as generateUuid } from 'node:crypto'; import { reusableProjectDraft } from './model.mjs'; ${factory}\nexport class ComposerPersistence { ${methods} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
	const seamPath = path.join(tmp, 'persistence.mjs'); fs.writeFileSync(seamPath, compiled);
	const { ComposerPersistence } = await import(pathToFileURL(seamPath).href);
	await check('file draft updates persist to the originating thread even after switching conversations', () => {
		const store = new ComposerPersistence(); let saved;
		store.state = { currentThreadId: 'other', allThreads: { original: { state: {} }, other: { state: {} } } };
		store._setThreadState = (id, patch) => Object.assign(store.state.allThreads[id].state, patch);
		store._storeAllThreads = threads => { saved = JSON.parse(JSON.stringify(threads)); };
		store.setThreadComposerState('original', { stagingSelections: [{ uri: URI.file('/context.txt') }], composerAttachments: [{ id: 'file', text: 'attached' }] });
		assert.equal(saved.original.state.composerAttachments[0].text, 'attached'); assert.deepEqual(saved.other.state, {});
		store.setThreadComposerState('original', { stagingSelections: [] }); assert.deepEqual(saved.original.state.stagingSelections, []);
		store.setThreadComposerState('deleted', { composerAttachments: [] }); assert.deepEqual(saved.other.state, {});
	});
	await check('New chat retains the current workspace for both a fresh thread and a reused empty draft', () => {
		const chat = new ComposerPersistence(); let saved;
		chat.state = { currentThreadId: 'prior', allThreads: { prior: { id: 'prior', messages: [{}], state: { stagingSelections: [] }, projectFolders: ['/previous'] } } };
		chat._workspaceContextService = { getWorkspace: () => ({ folders: [{ uri: URI.file('/current/project') }] }) };
		chat._setState = patch => Object.assign(chat.state, patch);
		chat._storeAllThreads = threads => { saved = JSON.parse(JSON.stringify(threads)); };
		chat.switchToThread = id => { chat.state.currentThreadId = id; };
		chat.openNewThread(); const fresh = chat.state.currentThreadId;
		assert.deepEqual(saved[fresh].projectFolders, [URI.file('/current/project').fsPath]);
		chat.state.currentThreadId = 'prior'; chat.state.allThreads[fresh].projectFolders = ['/older'];
		chat.openNewThread(); assert.equal(chat.state.currentThreadId, fresh);
		assert.deepEqual(saved[fresh].projectFolders, [URI.file('/current/project').fsPath]);
		assert.deepEqual(saved.prior.projectFolders, ['/previous']);
	});
	const T = await load('../browser/react/src/util/i18n/translator.ts', 'translation');
	await check('composer accessible label has the established Arabic and Chinese translations', () => {
		assert.equal(T.translateText('Describe the task', 'ar'), 'صف المهمة'); assert.equal(T.translateText('Describe the task', 'zh'), '描述任务');
	});
	console.log(`\n${passed} passed, 0 failed`);
} catch (e) { console.error(e); process.exitCode = 1; }
finally { fs.rmSync(tmp, { recursive: true, force: true }); }
