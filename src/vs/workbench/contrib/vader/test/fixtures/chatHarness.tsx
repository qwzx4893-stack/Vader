// The chat as it is built for the app (react/src2), mounted in a plain browser page. The conversation, the run state and the settings are objects of this page: the test
// puts the thread in the state it wants to look at (running, paused, stopped, waiting for approval, nearly full, no model) and reads what the chat did to it.
// The markdown, the apply buttons and the model picker are stand-ins; everything else is the real component. Used by test/chatUiE2E.mjs.
import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../browser/react/src2/styles.css'
import { SidebarChat } from '../../browser/react/src2/sidebar-tsx/SidebarChat'
import { notify } from './chatHarnessServices'
import { providerNames } from '../../common/vaderSettingsTypes'
import { URI } from '../../../../../base/common/uri'
import { translateText } from '../../browser/react/src2/util/i18n/translator'

const w = window as any
w.__log = [] as string[]
w.__translate = translateText
const log = (s: string) => w.__log.push(s)

// ---- settings: one provider with a key and a model, so the chat has something to ask
const settingsOfProvider: any = {}
for (const p of providerNames) settingsOfProvider[p] = { models: [], _didFillInProviderSettings: false, apiKey: '' }
settingsOfProvider.anthropic = { models: [{ modelName: 'claude-sonnet-4-5', type: 'default', isHidden: false }], _didFillInProviderSettings: true, apiKey: 'sk-ant-x' }
w.__settings = {
	settingsOfProvider, modelSelectionOfFeature: { Chat: { providerName: 'anthropic', modelName: 'claude-sonnet-4-5' }, Autocomplete: null, Apply: null, SCM: null },
	_modelOptions: [{ name: 'claude-sonnet-4-5', selection: { providerName: 'anthropic', modelName: 'claude-sonnet-4-5' } }], overridesOfModel: { anthropic: { 'claude-sonnet-4-5': { contextWindow: 100000 } } }, optionsOfModelSelection: { Chat: {}, Autocomplete: {}, Apply: {}, SCM: {} },
	globalSettings: { chatMode: 'agent', taskCopies: true, autoApprove: {}, externalAgentId: null, dailySpendLimitUsd: null, autoAcceptLLMChanges: false, isOnboardingComplete: true },
}
if (w.__noModel) { w.__settings.modelSelectionOfFeature.Chat = null; w.__settings.settingsOfProvider.anthropic = { models: [], _didFillInProviderSettings: false, apiKey: '' }; w.__settings._modelOptions = [] }
w.__policy = { state: { mode: 'balanced' } }
const settingsSvc: any = {
	get state() { return w.__settings },
	setGlobalSetting(k: string, v: any) { log(`global:${k}=${JSON.stringify(v)}`); w.__settings = { ...w.__settings, globalSettings: { ...w.__settings.globalSettings, [k]: v } }; notify() },
	setModelSelectionOfFeature(f: string, v: any) { log(`select:${f}=${v?.modelName}`) },
}

// ---- the conversation
const thread = () => ({ id: 't1', createdAt: new Date().toISOString(), lastModified: new Date().toISOString(), messages: [] as any[], filesWithUserChanges: new Set(), state: { stagingSelections: [], currCheckpointIdx: null, focusedMessageIdx: undefined, linksOfMessageIdx: {} }, queued: [] as any[] })
const T: any = thread()
w.__chat = { state: { allThreads: { t1: T }, currentThreadId: 't1' }, streamState: {} as any, paused: undefined as any, usage: undefined as any }
w.__thread = T
const setThread = (patch: any) => { w.__chat.state = { ...w.__chat.state, allThreads: { ...w.__chat.state.allThreads, t1: { ...w.__chat.state.allThreads.t1, ...patch } } }; notify() }
w.__setThread = setThread
w.__setStream = (s: any) => { w.__chat.streamState = { t1: s }; notify() }
w.__addMessages = (...m: any[]) => setThread({ messages: [...w.__chat.state.allThreads.t1.messages, ...m] })
w.__switchThread = (id: string) => {
	if (!w.__chat.state.allThreads[id]) w.__chat.state.allThreads[id] = { ...thread(), id }
	w.__chat.state = { ...w.__chat.state, currentThreadId: id }; notify()
}
w.__revisions = [] as any[]
w.__branches = [] as any[]

const known: any = {
	getCurrentThread: () => w.__chat.state.allThreads[w.__chat.state.currentThreadId],
	setThreadComposerState(id: string, patch: any) {
		const t = w.__chat.state.allThreads[id];
		if (!t) return;
		w.__chat.state = { ...w.__chat.state, allThreads: { ...w.__chat.state.allThreads, [id]: { ...t, state: { ...t.state, ...patch } } } };
		notify();
	},
	setCurrentThreadState(p: any) {
		log(`threadstate:${Object.keys(p).join(',')}`)
		const id = w.__chat.state.currentThreadId, t = w.__chat.state.allThreads[id]
		w.__chat.state = { ...w.__chat.state, allThreads: { ...w.__chat.state.allThreads, [id]: { ...t, state: { ...t.state, ...p } } } }; notify()
	},
	setCurrentlyFocusedMessageIdx() { },
	getCurrentMessageState(idx: number) { return known.getCurrentThread()?.messages[idx]?.state ?? { stagingSelections: [], isBeingEdited: false } },
	setCurrentMessageState(idx: number, patch: any) {
		const id = w.__chat.state.currentThreadId, t = w.__chat.state.allThreads[id]
		if (t?.messages[idx]?.role !== 'user') return
		w.__chat.state = { ...w.__chat.state, allThreads: { ...w.__chat.state.allThreads, [id]: { ...t, messages: t.messages.map((m: any, i: number) => i === idx ? { ...m, state: { ...m.state, ...patch } } : m) } } }; notify()
	},
	focusCurrentChat() { log(`focus:${w.__chat.state.currentThreadId}`) },
	branchThread(id: string, end: number) {
		if (w.__branchFailure) return undefined
		const t = w.__chat.state.allThreads[id]
		if (!t || end <= 0) return undefined
		const branchId = `branch-${w.__branches.length + 1}`
		const messages = t.messages.slice(0, end)
		w.__branches.push({ threadId: id, end, messages }); log(`branch:${end}`)
		w.__chat.state = { ...w.__chat.state, allThreads: { ...w.__chat.state.allThreads, [branchId]: { ...thread(), id: branchId, messages } } }; notify()
		return branchId
	},
	getThreadUsage: () => w.__chat.usage, getUsageToday: () => w.__today ?? ({ costUsd: 0, billedCostUsd: 0, inputTokens: 0, outputTokens: 0, unpricedTurns: 0 }),
	onDidChangeUsage: () => ({ dispose() { } }), onDidChangeProjectApprovals: () => ({ dispose() { } }),
	getPause: () => w.__chat.paused, pauseRun() { log('pause'); w.__chat.paused = { reason: 'user' }; notify() }, resumeRun() { log('resume'); w.__chat.paused = undefined; notify() },
	getCurrentProjectKey: () => w.__projectKey === undefined ? 'C:/work/vader-app' : w.__projectKey, listProjectGroups: () => w.__groups ?? [], getThreadStatus: () => 'idle', switchToThread(id: string) { log(`switch:${id}`) }, canRememberForProject: () => w.__canRemember ?? true,
	approveLatestToolRequest() { log('approve') }, rejectLatestToolRequest() { log('reject') }, clearThreadPlan() { }, addNewStagingSelection() { }, popStagingSelections() { },
	openNewThread() { log('new-thread') },
	queueMessage(_t: string, text: string) { log(`queue:${text}`); const th = w.__chat.state.allThreads.t1; if ((th.queued ?? []).length >= 5) return false; setThread({ queued: [...(th.queued ?? []), { id: 'q' + (th.queued ?? []).length + text.length, text }] }); return true },
	removeQueuedMessage(_t: string, id: string) { log(`unqueue:${id}`); setThread({ queued: (w.__chat.state.allThreads.t1.queued ?? []).filter((m: any) => m.id !== id) }) },
	async sendQueuedMessageNow(_t: string, id: string) { log(`sendnow:${id}`); setThread({ queued: (w.__chat.state.allThreads.t1.queued ?? []).filter((m: any) => m.id !== id) }) },
	async compactThreadNow() { log('compact'); await new Promise(r => setTimeout(r, 150)); return w.__compactResult ?? 'done' },
	async startNewChatWithSummary() { log('new-with-summary'); return w.__summaryResult ?? true },
}
const chat: any = new Proxy({}, {
	get: (_t, k: string) => {
		if (k === 'state') return w.__chat.state
		if (k === 'streamState') return w.__chat.streamState
		if (known[k]) return known[k]
		if (w.__chatMethods?.[k]) return w.__chatMethods[k]
		return (...a: any[]) => { log(`chat.${k}(${a.map(x => typeof x === 'string' ? x : '').join(',')})`); return undefined }
	},
})
w.__chatMethods = {}
const gateway: any = {
	async startTask(a: any) { log(`task:${a.userMessage}`); if (a.images?.length) log(`images:${a.images.length}:${a.images[0].mimeType}:${a.images[0].name}`); if (w.__onTask) await w.__onTask(a) }, async cancelTask() { log('cancel'); if (w.__onCancel) await w.__onCancel() }, dismissError() { log('dismiss-error') },
	async reviseTask(a: any) {
		log(`revise:${a.fromMessageIdx}:${a.userMessage}`)
		const target = w.__chat.state.allThreads[a.threadId]?.messages[a.fromMessageIdx]
		w.__revisions.push({ ...a, selections: target?.state?.stagingSelections, images: target?.images })
		if (w.__onRevise) await w.__onRevise(a)
	},
	approveToolRequest(_t: string, o?: any) { log(`approve:${o?.rememberForProject ? 'project' : 'once'}`) }, rejectToolRequest() { log('reject-tool') },
}
const commands: any = { async executeCommand(id: string, ...a: any[]) { log(`command:${id}${a.length ? ':' + a.join(',') : ''}`) } }
const keybinding: any = { lookupKeybinding: () => ({ getLabel: () => 'Ctrl+L' }) }
const metrics: any = { capture() { } }
const language: any = { guessLanguageIdByFilepathOrFirstLine: () => 'typescript' }
const shell: any = { state: { mode: 'window', page: 'conversation', tab: 'conversation', searchOpen: false }, setTab(t: string) { log(`shell:tab:${t}`) }, show() { log('shell:show') }, openFile(p?: string) { log(`shell:file:${p ?? ''}`) }, openEditor() { log('shell:editor') } }
w.__shell = shell
shell.listProjects = async () => ({ projects: [{ key: 'C:/work/vader-app', name: 'vader-app', folders: ['C:/work/vader-app'] }], historyUnavailable: false })
shell.pickContextFiles = async () => (w.__pickedContextFiles ?? []).map((p: string) => URI.file(p))
shell.selectProject = async (folders: string[]) => { w.__projectKey = folders[0] ?? null; log(`project:${folders.join(',')}`); notify() }
shell.newProject = async () => { log('project:new') }
const empty: any = new Proxy({}, { get: () => () => undefined })
const fileUris = ['/src/app.js', '/src/app.test.js', '/src/server/limiter.ts'].map(x => URI.file('/work/vader-app' + x))
const toolsSvc: any = { stringOfResult: { run_command: (_p: any, r: any) => r.result, run_persistent_command: (_p: any, r: any) => r.result }, callTool: { async search_pathnames_only(a: any) { log(`search:${a.query}`); return { result: Promise.resolve({ uris: fileUris.filter(u => !a.query || (u.path.split('/').pop() ?? '').includes(a.query)) }) } } } }
const workspaceBase: any = { getWorkspace: () => ({ folders: [{ uri: URI.file('/work/vader-app') }] }) }
const workspaceSvc: any = new Proxy(workspaceBase, { get: (t, k: string) => k in t ? t[k] : () => undefined })
w.__sources = { terminal: 'npm test\n12 passing\n1 failing', page: { pageId: 'p1', url: 'http://localhost:5173/app', title: 'My app', isActive: true, isClosed: false }, git: { files: 3, text: ' a | 1 +\n 3 files changed' } }
const terminalSvc: any = { get activeInstance() { return w.__sources.terminal ? { xterm: { getContentsAsText: () => w.__sources.terminal } } : undefined } }
const browserSvc: any = { async listPages() { return w.__sources.page ? [w.__sources.page] : [] }, async snapshot() { return { ...w.__sources.page, snapshotText: '- heading "Hello"' } } }
w.__files = {} as Record<string, string>
const fileSvc = {
	async stat(u: any) { if (!(u.path in w.__files)) throw new Error('File unavailable'); return { isDirectory: false, size: w.__files[u.path].length }; },
	async readFile(u: any) { if (!(u.path in w.__files)) throw new Error('File unavailable'); return { value: { toString: () => w.__files[u.path] } }; },
}
const modelSvc: any = { getModel: (u: any) => (u.path in w.__files ? { getValue: () => w.__files[u.path] } : null) }
// Isolated clipboard test double; production uses the workbench clipboard service.
const clipboardSvc = { async writeText(text: string) { log('clipboard:attempt'); if (w.__onClipboard) await w.__onClipboard(text); if (w.__clipboardFailure) throw new Error('Clipboard unavailable'); w.__copiedText = text; log('clipboard:write') } }
const reviewSvc: any = { async changesForContext() { return w.__sources.git } }
const tcListeners = new Set<() => void>()
const tcFire = () => { tcListeners.forEach(f => f()); notify() }
w.__taskCopy = { state: undefined, question: undefined }
const taskCopySvc: any = {
	onDidChange: (fn: () => void) => { tcListeners.add(fn); return { dispose: () => { tcListeners.delete(fn) } } },
	getState: () => w.__taskCopy.state, getQuestion: () => w.__taskCopy.question,
	answerQuestion(_t: string, a: string) { log(`tc-answer:${a}`); w.__taskCopy.question = undefined; tcFire() },
	async merge() { log('tc-merge') }, async stashAndRetry() { log('tc-stash') }, async resolveConflict(_t: string, c: string) { log(`tc-resolve:${c}`) }, async undoMerge() { log('tc-undo') },
	async discard() { log('tc-discard'); w.__taskCopy.state = undefined; tcFire() }, dismiss() { log('tc-dismiss'); w.__taskCopy.state = undefined; tcFire() },
}
w.__setTaskCopy = (state: any, question?: any) => { w.__taskCopy = { state, question }; tcFire() }
const memorySvc: any = { write(o: any) { log(`remember:${o.scope}:${o.scopeKey}:${o.label}:${o.content}`); return { id: 'm1' } } }
const verifySvc: any = { async runIndependentVerification(o: any) { log(`review:${o.objective}`); await new Promise(r => setTimeout(r, 120)); return { evidence: {}, verdict: { passed: false, findings: [{ severity: 'blocker', description: 'x' }], summary: 'limiter.ts never clears old hits.' } } } }
w.__mcpServers = {}
w.__pending = {} as Record<string, string[]>
const mcpSvc: any = { pendingToolsOf: (n: string) => w.__pending[n] ?? [], async allowTools(n: string, names: string[]) { log(`mcp:allow:${n}:${names.join(',')}`); w.__pending[n] = []; notify() }, async keepToolsOff(n: string, names: string[]) { log(`mcp:off:${n}:${names.join(',')}`); w.__pending[n] = []; notify() }, async removeServer(n: string) { log(`mcp:remove:${n}`) } }
w.__accessor = { get: (name: string) => ({ IClipboardService: clipboardSvc, IFileService: fileSvc, IMCPService: mcpSvc, IChatThreadService: chat, IModelService: modelSvc, IToolsService: toolsSvc, IWorkspaceContextService: workspaceSvc, ITerminalService: terminalSvc, IBrowserToolMainService: browserSvc, IVaderReviewService: reviewSvc, ITaskCopyService: taskCopySvc, IMemoryService: memorySvc, IPolicyService: { setMode(m: string) { log(`mode:${m}`); w.__policy = { state: { mode: m } }; notify() } }, IVerificationService: verifySvc, IAgentGatewayService: gateway, IVaderSettingsService: settingsSvc, ICommandService: commands, IKeybindingService: keybinding, IMetricsService: metrics, ILanguageService: language, IVaderShellService: shell } as any)[name] ?? empty }

createRoot(document.getElementById('root')!).render(<div className='vader-scope' style={{ width: '100%', height: 820, display: 'flex', flexDirection: 'column', background: 'var(--vscode-sideBar-background, #18191a)' }}><SidebarChat /></div>)
w.__mounted = true
