#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 * Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Node regression at the actual revision / preparation / runtime-error methods, extracted
// with the TypeScript AST. Storage, directory reads and the running agent are controlled
// dependencies; this is not an installed-app, provider or filesystem rollback test.
// Run: node src/vs/workbench/contrib/vader/test/messageRevisionE2E.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-message-revision-'));
let passed = 0, failed = 0;
const check = async (name, fn) => {
	try { await fn(); passed++; console.log(`PASS: ${name}`); }
	catch (e) { failed++; console.error(`FAIL: ${name}\n${e.stack ?? e}`); }
};
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const checkpoint = () => ({ role: 'checkpoint', type: 'user_edit', vaderFileSnapshotOfURI: {}, userModifications: { vaderFileSnapshotOfURI: {} } });

try {
	const load = async (rel, name) => {
		const outfile = path.join(tmp, name + '.mjs');
		await esbuild.build({ entryPoints: [path.join(here, rel)], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' });
		return import(pathToFileURL(outfile).href);
	};
	const prompt = await load('../common/prompt/prompts.ts', 'prompts');
	const skills = await load('../common/skillMatch.ts', 'skills');
	// Optional prior-source snapshot makes the same regression reproducible against
	// the pre-fix bytes without modifying the checkout. Default: the current service.
	const sourcePath = process.env.VADER_REVISION_SOURCE ?? path.join(here, '../browser/chatThreadService.ts');
	const source = fs.readFileSync(sourcePath, 'utf8');
	console.log(`Source: ${sourcePath} (sha256 ${createHash('sha256').update(source).digest('hex')})`);
	const ast = ts.createSourceFile('chatThreadService.ts', source, ts.ScriptTarget.Latest, true);
	const cls = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'ChatThreadService');
	assert.ok(cls, 'actual ChatThreadService class exists');
	const names = ['editUserMessageAndStreamResponse', 'addUserMessageAndStreamResponse', '_addUserMessageAndStreamResponse', '_setStreamState', '_runChatAgent', '_addMessageToThread', '_addUserCheckpoint', '_addCheckpoint', '_setThreadState', '_patchThread'];
	const methods = names.map(name => {
		const member = cls.members.find(n => n.name?.getText(ast) === name);
		assert.ok(member, `actual ${name} exists`);
		return member.getText(ast);
	}).join('\n');
	// Include guard declarations when present so the same behavioral tests can also
	// run against the saved pre-guard source; no substitute implementation is used.
	const preparation = cls.members.filter(n => ['_preparingThreads', '_switchingProject', '_withThreadPreparation', 'assertCanSwitchProject', 'withProjectSwitch'].includes(n.name?.getText(ast))).map(n => n.getText(ast)).join('\n');
	const defaults = ast.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === 'defaultMessageState'));
	assert.ok(defaults, 'actual message-state defaults exist');
	const js = ts.transpileModule(`${defaults.getText(ast)}\nclass RevisionService { ${preparation}\n${methods} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
	const RevisionService = new Function('chat_userMessageContent', 'selectSkills', 'toUsed', 'getErrorMessage', `${js}\nreturn RevisionService;`)(prompt.chat_userMessageContent, skills.selectSkills, skills.toUsed, e => e instanceof Error ? e.message : String(e));

	const fixture = ({ first = false } = {}) => {
		const service = new RevisionService();
		const read = deferred(), started = deferred(), runtime = deferred();
		const calls = [], saved = [], detached = [], events = [];
		const selections = [{ type: 'Folder', uri: { fsPath: '/project/context' }, state: { wasAddedAsCurrentFile: false } }];
		const images = [{ id: 'img', name: 'diagram.png', mimeType: 'image/png', data: 'retained-image-bytes' }];
		const user = { role: 'user', content: 'original request context', displayContent: 'original prompt', selections, images, state: { stagingSelections: selections, isBeingEdited: true } };
		const history = [...(first ? [] : [checkpoint()]), user, { role: 'assistant', displayContent: 'old reply', reasoning: '', anthropicReasoning: null }, { ...checkpoint(), type: 'tool_edit', fileOps: { created: ['/project/already-written.txt'], createdFolders: [], deleted: [] } }];
		const thread = { id: 'original', messages: history, projectFolders: ['/project'], state: { stagingSelections: [], currCheckpointIdx: first ? null : 0, focusedMessageIdx: first ? 0 : 1, composerAttachments: [{ id: 'draft', text: 'unsent composer draft' }] }, stopped: { doing: 'previous run stopped' }, customTitle: 'keep title', filesWithUserChanges: new Set(['/project/already-written.txt']) };
		const other = { id: 'other', messages: [], state: { stagingSelections: [], composerAttachments: [{ id: 'other-draft' }] } };
		service.state = { currentThreadId: 'original', allThreads: { original: thread, other } };
		service.streamState = {};
		service._onDidChangeStreamState = { fire({ threadId }) { events.push({ threadId, state: service.streamState[threadId] && { ...service.streamState[threadId] } }); } };
		service._setState = patch => { calls.push('publish'); service.state = { ...service.state, ...patch }; };
		service._storeAllThreads = threads => { calls.push('store'); saved.push(JSON.parse(JSON.stringify(threads))); };
		service._directoryStringService = {
			async getDirectoryStrTool(uri) { calls.push(['directory', uri.fsPath]); started.resolve(); return read.promise; },
			async getAllURIsInDirectory() { return []; },
		};
		service._fileService = { async readFile() { throw Error('unexpected file read'); } };
		service._skillService = { listActive: () => [{ id: 'skill', name: 'revision', description: 'review revision history', pinned: true }] };
		service._currentModelSelectionProps = () => ({ modelSelection: { providerName: 'test', modelName: 'controlled' }, modelSelectionOptions: undefined });
		service._computeNewCheckpointInfo = () => ({ vaderFileSnapshotOfURI: {} });
		service._runChatAgentImpl = async id => { calls.push(['runtime', id]); service._setStreamState(id, { isRunning: 'LLM' }); await runtime.promise; };
		service._wrapRunAgentToNotify = (promise, id) => { calls.push(['wrap', id]); detached.push(promise); promise.catch(() => {}); };
		service.abortRunning = async id => { calls.push(['abort', id]); service._setStreamState(id, undefined); service._addUserCheckpoint({ threadId: id }); };
		// Observe detached legacy preparation failures during the pre-fix run, so the test can
		// report the failed await/history assertions instead of dying on an unhandled rejection.
		const add = service._addUserMessageAndStreamResponse.bind(service);
		service._addUserMessageAndStreamResponse = (...args) => { const promise = add(...args); detached.push(promise); promise.catch(() => {}); return promise; };
		const invoke = () => service.editUserMessageAndStreamResponse({ threadId: 'original', messageIdx: first ? 0 : 1, userMessage: 'edited revision prompt' });
		const send = () => service.addUserMessageAndStreamResponse({ threadId: 'original', userMessage: 'new turn prompt', _chatSelections: selections, images });
		return { service, read, started, runtime, calls, saved, detached, events, thread, other, history, user, selections, images, invoke, send };
	};

	for (const first of [false, true]) await check(`delayed preparation rejection preserves original history and editable draft (user index ${first ? 0 : 1})`, async () => {
		const f = fixture({ first });
		let settled = false;
		const attempt = f.invoke(); attempt.then(() => { settled = true; }, () => { settled = true; });
		await f.started.promise; await nextTurn();
		const pending = !settled;
		const untouchedDuringRead = f.service.state.allThreads.original === f.thread;
		const error = Error('delayed directory preparation failed');
		f.read.reject(error);
		const [result] = await Promise.allSettled([attempt, ...f.detached]);
		assert.equal(pending, true, 'revision must await preparation');
		assert.equal(untouchedDuringRead, true, 'do not unmount the editor by truncating before preparation');
		assert.equal(result.status, 'rejected'); assert.equal(result.reason, error);
		assert.equal(f.service.state.allThreads.original, f.thread);
		assert.equal(f.service.state.allThreads.original.messages, f.history);
		assert.equal(f.user.state.isBeingEdited, true); assert.equal(f.user.state.stagingSelections, f.selections);
		assert.equal(f.service.state.allThreads.other, f.other); assert.equal(f.saved.length, 0);
		assert.equal(f.calls.some(c => Array.isArray(c) && c[0] === 'runtime'), false);
	});

	for (const first of [false, true]) await check(`successful preparation replaces only the selected suffix, retains context/images, and does not wait for the answer (index ${first ? 0 : 1})`, async () => {
		const f = fixture({ first });
		const attempt = f.invoke(); await f.started.promise;
		f.service.state = { ...f.service.state, currentThreadId: 'other', allThreads: { ...f.service.state.allThreads, original: { ...f.thread, customTitle: 'renamed during preparation' } } };
		f.read.resolve('REAL DIRECTORY CONTEXT 7841');
		await attempt; // runtime.promise deliberately remains pending
		const updated = f.service.state.allThreads.original;
		assert.equal(updated.messages.length, 2);
		assert.equal(updated.messages[0].role, 'checkpoint');
		if (!first) assert.equal(updated.messages[0], f.history[0]);
		const message = updated.messages[1];
		assert.equal(message.role, 'user'); assert.equal(message.displayContent, 'edited revision prompt');
		assert.match(message.content, /REAL DIRECTORY CONTEXT 7841/); assert.match(message.content, /SELECTIONS/);
		assert.deepEqual(message.selections, f.selections); assert.equal(message.images, f.images);
		assert.equal(message.skillsUsed[0].id, 'skill'); assert.equal(message.state.isBeingEdited, false);
		assert.equal(updated.state.composerAttachments, f.thread.state.composerAttachments);
		assert.equal(updated.state.currCheckpointIdx, null); assert.equal(updated.stopped, undefined);
		assert.equal(updated.customTitle, 'renamed during preparation');
		assert.equal(updated.filesWithUserChanges, f.thread.filesWithUserChanges);
		assert.equal(f.service.state.currentThreadId, 'other'); assert.equal(f.service.state.allThreads.other, f.other);
		assert.equal(f.saved.at(-1).original.messages.at(-1).displayContent, 'edited revision prompt');
		assert.equal(f.service.streamState.original.isRunning, 'LLM');
		assert.equal(f.calls.filter(c => Array.isArray(c) && c[0] === 'runtime').length, 1);
		f.runtime.resolve(); await Promise.all(f.detached);
	});

	await check('a later skill preparation failure also preserves history and propagates unchanged', async () => {
		const f = fixture(); const error = Error('skill catalog unavailable');
		f.service._skillService.listActive = () => { throw error; };
		const attempt = f.invoke(); const rejection = assert.rejects(attempt, e => e === error);
		await f.started.promise; f.read.resolve('context');
		await Promise.allSettled(f.detached); await rejection;
		assert.equal(f.service.state.allThreads.original, f.thread); assert.equal(f.saved.length, 0);
	});

	await check('model preparation failure keeps the original editor and history recoverable', async () => {
		const f = fixture(); const error = Error('model resolution failed');
		f.service._currentModelSelectionProps = () => { throw error; };
		const attempt = f.invoke(); const rejection = assert.rejects(attempt, e => e === error);
		await f.started.promise; f.read.resolve('context'); await Promise.allSettled(f.detached); await rejection;
		assert.equal(f.service.state.allThreads.original, f.thread); assert.equal(f.saved.length, 0);
		assert.equal(f.user.state.isBeingEdited, true);
	});

	for (const change of ['history', 'deleted', 'new-run']) await check(`preparation cannot overwrite a concurrent ${change}`, async () => {
		const f = fixture(); const attempt = f.invoke(); const rejection = assert.rejects(attempt, /changed|available|running|finish/i);
		await f.started.promise;
		let modelCalled = false;
		f.service._currentModelSelectionProps = () => { modelCalled = true; return {}; };
		if (change === 'history') f.service.state.allThreads.original = { ...f.thread, messages: [...f.history, { role: 'assistant', displayContent: 'concurrent answer' }] };
		if (change === 'deleted') delete f.service.state.allThreads.original;
		if (change === 'new-run') f.service.streamState.original = { isRunning: 'LLM', marker: 'newer run' };
		const current = f.service.state.allThreads.original;
		f.read.resolve('context'); await Promise.allSettled(f.detached); await rejection;
		assert.equal(f.service.state.allThreads.original, current);
		assert.equal(f.calls.some(c => Array.isArray(c) && c[0] === 'runtime'), false);
		assert.equal(modelCalled, false, 'stale preparation must not persist model metadata');
		assert.equal(f.saved.length, 0);
	});

	await check('runtime rejection remains a stream error with new history and executed work retained', async () => {
		const f = fixture(); const error = Error('provider failed after execution began');
		const attempt = f.invoke(); await f.started.promise; f.read.resolve('context'); await attempt;
		const revised = f.service.state.allThreads.original.messages[1];
		f.service.state.allThreads.original = { ...f.service.state.allThreads.original, messages: [...f.service.state.allThreads.original.messages, { role: 'assistant', displayContent: 'partial new answer' }] };
		f.runtime.reject(error); await Promise.all(f.detached);
		const current = f.service.state.allThreads.original;
		assert.equal(current.messages[1], revised);
		assert.equal(current.messages.some(m => m.displayContent === 'partial new answer'), true);
		assert.equal(current.messages.some(m => m.displayContent === 'old reply'), false);
		assert.equal(current.filesWithUserChanges, f.thread.filesWithUserChanges);
		assert.equal(f.service.streamState.original.error.fullError, error);
		assert.equal(f.service.streamState.original.error.message, error.message);
	});

	await check('existing run cancellation is awaited and its completed checkpoint is not rolled back on preparation failure', async () => {
		const f = fixture(); const abort = deferred();
		f.service.streamState.original = { isRunning: 'LLM' };
		const cancel = f.service.abortRunning;
		f.service.abortRunning = async id => { await abort.promise; await cancel(id); };
		const attempt = f.invoke(); const rejection = assert.rejects(attempt, /preparation failed/);
		const untouchedBeforeCancellation = f.calls.length === 0;
		abort.resolve(); await f.started.promise;
		const afterAbort = f.service.state.allThreads.original;
		f.read.reject(Error('preparation failed')); await Promise.allSettled(f.detached); await rejection;
		assert.equal(untouchedBeforeCancellation, true, 'no history/read changes until cancellation completes');
		assert.equal(f.service.state.allThreads.original, afterAbort);
		assert.equal(afterAbort.messages.at(-1).role, 'checkpoint'); assert.equal(afterAbort.messages.includes(f.user), true);
	});

	await check('persistence failure rejects without publishing the replacement or starting execution', async () => {
		const f = fixture(); const error = Error('storage failed');
		f.service._storeAllThreads = () => { throw error; };
		const attempt = f.invoke(); const rejection = assert.rejects(attempt, e => e === error);
		await f.started.promise; f.read.resolve('context'); await Promise.allSettled(f.detached); await rejection;
		assert.equal(f.service.state.allThreads.original, f.thread);
		assert.equal(f.calls.some(c => Array.isArray(c) && c[0] === 'runtime'), false);
	});

	for (const first of ['send', 'invoke']) for (const second of ['send', 'invoke']) await check(`service preparation guard rejects ${first} → ${second} duplicates after UI remount and stream reset`, async () => {
		const f = fixture(); f.thread.state.currCheckpointIdx = null;
		const original = f[first](); await f.started.promise;
		const visibleWhilePreparing = f.service.streamState.original?.isPreparing;
		// Navigation discards all component refs; a new caller observes the same service.
		f.service.state = { ...f.service.state, currentThreadId: 'other' };
		f.service._setStreamState('original', undefined);
		const visibleAfterReset = f.service.streamState.original?.isPreparing;
		const remountedCaller = second === 'send'
			? () => f.service.addUserMessageAndStreamResponse({ threadId: 'original', userMessage: 'duplicate new turn', _chatSelections: f.selections })
			: () => f.service.editUserMessageAndStreamResponse({ threadId: 'original', messageIdx: 1, userMessage: 'duplicate revision' });
		const duplicate = remountedCaller(); duplicate.catch(() => {});
		f.read.resolve('context');
		const [accepted, rejected] = await Promise.allSettled([original, duplicate]);
		assert.equal(visibleWhilePreparing, true); assert.equal(visibleAfterReset, true);
		assert.equal(accepted.status, 'fulfilled'); assert.equal(rejected.status, 'rejected');
		assert.match(rejected.reason.message, /already being prepared/);
		assert.equal(f.calls.filter(c => Array.isArray(c) && c[0] === 'directory').length, 1);
		assert.equal(f.calls.filter(c => Array.isArray(c) && c[0] === 'runtime').length, 1);
		assert.equal(f.calls.some(c => Array.isArray(c) && c[0] === 'abort'), false);
		assert.equal(f.service._preparingThreads.size, 0);
		assert.equal(f.service.streamState.original.isRunning, 'LLM'); assert.equal(f.service.streamState.original.isPreparing, undefined);
		assert.equal(f.events[0].state.isPreparing, true); assert.equal(f.events.at(-1).state.isPreparing, undefined);
		assert.equal(f.saved.some(snapshot => JSON.stringify(snapshot).includes('isPreparing')), false, 'preparation state is not persisted');
		f.runtime.resolve(); await Promise.all(f.detached);
	});

	for (const method of ['send', 'invoke']) await check(`${method} preparation rejection clears the owned guard and permits another request`, async () => {
		const f = fixture(); f.thread.state.currCheckpointIdx = null;
		const original = f[method](); const rejection = assert.rejects(original, /delayed failure/);
		await f.started.promise; f.service._setStreamState('original', undefined);
		f.read.reject(Error('delayed failure')); await rejection; await Promise.allSettled(f.detached);
		assert.equal(f.service._preparingThreads.size, 0); assert.equal(f.service.streamState.original?.isPreparing, undefined);
		assert.equal(f.service.streamState.original, undefined);
		assert.equal(f.events[0].state.isPreparing, true); assert.equal(f.events.at(-1).state, undefined);
		f.service._directoryStringService.getDirectoryStrTool = async () => 'recovered context';
		await f[method](); assert.equal(f.service.streamState.original.isRunning, 'LLM');
		assert.equal(f.service.streamState.original.isPreparing, undefined);
		f.runtime.resolve(); await Promise.allSettled(f.detached);
	});

	await check('stream updates retain the preparation marker and finally preserves the latest runtime error', async () => {
		const f = fixture(); const held = deferred(); const error = Error('runtime error during preparation');
		const attempt = f.service._withThreadPreparation('original', () => held.promise);
		for (const state of [
			{ isRunning: 'LLM', llmInfo: { displayContentSoFar: 'text', reasoningSoFar: '', toolCallSoFar: null }, interrupt: Promise.resolve(() => {}) },
			{ isRunning: 'tool', toolInfo: { id: 'tool' }, interrupt: Promise.resolve(() => {}) },
			{ isRunning: 'awaiting_user' }, { isRunning: 'idle', interrupt: 'not_needed' }, undefined,
		]) {
			f.service._setStreamState('original', state);
			assert.equal(f.service.streamState.original.isPreparing, true);
			assert.equal(f.service.streamState.original.isRunning, state?.isRunning);
		}
		f.service._setStreamState('original', { isRunning: undefined, error: { message: error.message, fullError: error } });
		held.resolve(); await attempt;
		assert.equal(f.service.streamState.original.error.fullError, error);
		assert.equal(f.service.streamState.original.isPreparing, undefined);
		assert.equal(f.service._preparingThreads.size, 0);
	});

	await check('independent thread preparation can complete while the original thread remains locked', async () => {
		const f = fixture(); const held = deferred();
		const original = f.service._withThreadPreparation('original', () => held.promise);
		assert.equal(await f.service._withThreadPreparation('other', async () => 'other result'), 'other result');
		assert.equal(f.service.streamState.original.isPreparing, true); assert.equal(f.service.streamState.other, undefined);
		assert.equal(f.service._preparingThreads.has('original'), true); assert.equal(f.service._preparingThreads.has('other'), false);
		held.resolve(); await original;
		assert.equal(f.service._preparingThreads.size, 0);
	});

	for (const method of ['send', 'invoke']) await check(`${method} rejects during a project mutation before touching history, storage or context`, async () => {
		const f = fixture(), held = deferred();
		const switching = f.service.withProjectSwitch(() => held.promise);
		try {
			// A rejected second owner must not release the first owner's lock.
			await assert.rejects(f.service.withProjectSwitch(async () => assert.fail('second workspace mutation ran')), /project is opening/i);
			await assert.rejects(f[method](), /project is opening/i);
			assert.equal(f.service.state.allThreads.original, f.thread);
			assert.equal(f.service.state.allThreads.original.messages, f.history);
			assert.deepEqual(f.calls, []); assert.deepEqual(f.saved, []); assert.deepEqual(f.events, []);
			assert.equal(f.service._preparingThreads.size, 0); assert.deepEqual(f.service.streamState, {});
		} finally { held.resolve(); await switching; }
		const accepted = f[method](); await f.started.promise; f.read.resolve('context after project mutation'); await accepted;
		assert.equal(f.service.streamState.original.isRunning, 'LLM');
		f.runtime.resolve(); await Promise.allSettled(f.detached);
	});

	await check('a normal new turn still awaits interruption of an existing runtime rather than rejecting it as duplicate preparation', async () => {
		const f = fixture(); const stopped = deferred(); f.thread.state.currCheckpointIdx = null;
		f.service._setStreamState('original', { isRunning: 'LLM' });
		const cancel = f.service.abortRunning;
		f.service.abortRunning = async id => { await stopped.promise; await cancel(id); };
		const attempt = f.send();
		assert.equal(f.service.streamState.original.isPreparing, true);
		assert.equal(f.calls.length, 0, 'context read waits for normal interruption');
		stopped.resolve(); await f.started.promise;
		assert.equal(f.service.streamState.original.isPreparing, true);
		f.read.resolve('context after interruption'); await attempt;
		assert.equal(f.calls.filter(c => Array.isArray(c) && c[0] === 'abort').length, 1);
		assert.equal(f.service.state.allThreads.original.messages.at(-1).displayContent, 'new turn prompt');
		assert.equal(f.service.streamState.original.isRunning, 'LLM');
		assert.equal(f.service.streamState.original.isPreparing, undefined);
		f.runtime.resolve(); await Promise.all(f.detached);
	});
} catch (e) { failed++; console.error(e.stack ?? e); }
finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
