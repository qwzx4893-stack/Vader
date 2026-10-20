// The whole Vader window with the real chat inside it: the shell harness (conversations in projects, review, browser, terminals), plus what the chat asks of the
// app (settings with a model, the run state, the usage, the policy mode). Only the markdown with its code editors, the apply buttons and the model picker are
// stand-ins (chatStubs.tsx). Used by test/windowUiE2E.mjs.
import './shellHarness'
import { URI } from '../../../../../base/common/uri'
import { notify } from './windowHarnessServices'
import { providerNames } from '../../common/vaderSettingsTypes'
import { addonsServices } from './addonsHarnessSetup'

const w = window as any
const log = (s: string) => w.__log.push(s)

// ---- settings: one provider with a key and a model, so the chat has something to ask
const settingsOfProvider: any = {}
for (const p of providerNames) settingsOfProvider[p] = { models: [], _didFillInProviderSettings: false, apiKey: '' }
settingsOfProvider.anthropic = { models: [{ modelName: 'claude-sonnet-4-5', type: 'default', isHidden: false }], _didFillInProviderSettings: true, apiKey: 'sk-ant-x' }
const settings: any = {
	settingsOfProvider, modelSelectionOfFeature: { Chat: { providerName: 'anthropic', modelName: 'claude-sonnet-4-5' }, Autocomplete: null, Apply: null, SCM: null },
	_modelOptions: [{ name: 'claude-sonnet-4-5', selection: { providerName: 'anthropic', modelName: 'claude-sonnet-4-5' } }], overridesOfModel: { anthropic: { 'claude-sonnet-4-5': { contextWindow: 100000 } } }, optionsOfModelSelection: { Chat: {}, Autocomplete: {}, Apply: {}, SCM: {} },
	globalSettings: { chatMode: 'agent', taskCopies: true, autoApprove: {}, externalAgentId: null, dailySpendLimitUsd: 5, autoAcceptLLMChanges: false, isOnboardingComplete: true },
}
w.__settings = settings
w.__policy = { state: { mode: 'balanced' } }
const settingsSvc: any = {
	get state() { return w.__settings },
	setGlobalSetting(k: string, v: any) { log(`global:${k}=${JSON.stringify(v)}`); if (k === 'uiLanguage') { w.__setLang?.(v) } w.__settings = { ...w.__settings, globalSettings: { ...w.__settings.globalSettings, [k]: v } }; notify() },
	setModelSelectionOfFeature(f: string, v: any) { log(`select:${f}=${v?.modelName}`) },
}

// ---- the chat service: what the shell harness has, plus what the chat asks
const chat = w.__chat
const thread = () => chat.state.allThreads[chat.state.currentThreadId]
const setThread = (patch: any) => { const t = thread(); chat.state = { ...chat.state, allThreads: { ...chat.state.allThreads, [t.id]: { ...t, ...patch } } }; notify() }
Object.assign(chat, {
	getCurrentThread: thread,
	setCurrentThreadState(p: any) { const t = thread(); setThread({ state: { stagingSelections: [], currCheckpointIdx: null, focusedMessageIdx: undefined, linksOfMessageIdx: {}, ...t.state, ...p } }) },
	setCurrentlyFocusedMessageIdx() { }, getCurrentMessageState: () => ({ stagingSelections: [], isBeingEdited: false }), setCurrentMessageState() { }, focusCurrentChat() { },
	onDidChangeUsage: () => ({ dispose() { } }), onDidChangeProjectApprovals: () => ({ dispose() { } }),
	canRememberForProject: () => true,
	approveLatestToolRequest() { log('approve') }, rejectLatestToolRequest() { log('reject') }, clearThreadPlan() { }, addNewStagingSelection() { }, popStagingSelections() { },
	queueMessage() { return true }, removeQueuedMessage() { }, async sendQueuedMessageNow() { },
	async compactThreadNow() { return 'done' }, async startNewChatWithSummary() { return true },
})
const gateway: any = {
	async startTask(a: any) { log(`task:${a.userMessage}`) }, async cancelTask() { log('cancel') }, dismissError() { },
	async reviseTask(a: any) { log(`revise:${a.fromMessageIdx}:${a.userMessage}`) },
	approveToolRequest(_t: string, o?: any) { log(`approve:${o?.rememberForProject ? 'project' : 'once'}`) }, rejectToolRequest() { log('reject-tool') },
}
const keybinding: any = { lookupKeybinding: () => ({ getLabel: () => 'Ctrl+L' }) }
const metrics: any = { capture() { } }
const language: any = { guessLanguageIdByFilepathOrFirstLine: () => 'typescript' }
const empty: any = new Proxy({}, { get: () => () => undefined })
const memorySvc: any = { write(o: any) { log(`remember:${o.scope}:${o.label}`); return { id: 'm1' } } }
const fileUris = ['/src/app.js', '/src/app.test.js', '/src/server/limiter.ts'].map(x => URI.file('/work/vader-app' + x))
const toolsSvc: any = { stringOfResult: { run_command: (_p: any, r: any) => r.result, run_persistent_command: (_p: any, r: any) => r.result }, callTool: { async search_pathnames_only(a: any) { return { result: Promise.resolve({ uris: fileUris.filter(u => !a.query || (u.path.split('/').pop() ?? '').includes(a.query)) }) } } } }
const terminalSvc: any = { get activeInstance() { return undefined } }
const mcpSvc: any = { pendingToolsOf: () => [], async allowTools() { }, async keepToolsOff() { }, async removeServer() { } }

w.__files = {} as Record<string, string>
// ---- the open task as board R01 shows it: the question with the files it names, what the agent read, what it said, its plan, an edit, a checkpoint, a command waiting
// for a yes. What the agent did in its browser and terminals (for the other tabs) moves to the second task.
if (!process.env.VADER_PREVIEW) {
	const t = chat.state.allThreads['t-wait']
	const run1 = chat.state.allThreads['t-run1']
	const NL = String.fromCharCode(10)
	const moved = t.messages.filter((m: any) => m.role === 'tool' && (/^browser_/.test(m.name) || /persistent/.test(m.name) || (m.name === 'run_command' && m.type !== 'tool_request')))
	let n = 0
	const tool = (name: string, type: string, params: any, result: any, extra: any = {}) => ({ role: 'tool', type, name, params, rawParams: params, id: 'tc-' + (n++), result, content: '', ...extra })
	const furi = (p: string) => URI.file('c:/work/vader-app/' + p)
	const read = (p: string) => tool('read_file', 'success', { uri: furi(p), startLine: null, endLine: null, pageNumber: 1 }, { fileContents: 'x', totalFileLen: 1, hasNextPage: false })
	const block = ['<<<<<<< ORIGINAL', '\treservedOutputTokenSpace = Math.max(', '\t\tcontextWindow * 1 / 2, // reserve at least 1/4 of the token window', '\t\treservedOutputTokenSpace ?? 4_096 // defaults to 4096', '\t)', '=======', '\t// the budget comes from common/contextBudget.ts, shared with the summary', '\tconst charsNeedToTrim = totalLen - inputBudgetChars(contextWindow, reserved)', '>>>>>>> UPDATED'].join(NL)
	const sel = (p: string) => ({ type: 'File', uri: furi(p), language: 'typescript', state: { wasAddedAsCurrentFile: false } })
	t.messages = [
		{ role: 'user', content: 'Compaction runs after the blind trim has already cut my messages to 120 characters each. Find out why, and make the summary come first.', displayContent: 'Compaction runs after the blind trim has already cut my messages to 120 characters each. Find out why, and make the summary come first.', selections: [sel('contextBudget.ts'), sel('chatThreadService.ts')], state: { stagingSelections: [], isBeingEdited: false } },
		read('contextBudget.ts'), read('chatThreadService.ts'), tool('search_for_files', 'success', { query: 'prepareMessages', searchInFolder: null, isRegex: false, pageNumber: 1 }, { uris: [furi('chatThreadService.ts')], hasNextPage: false }),
		{ role: 'assistant', displayContent: 'The cut and the summary use different yardsticks. prepareMessages reserves half of the window for the answer, so it starts trimming at 50%. The summary only starts at 70%, and it counts every tool result as at most 2,000 characters, so a thread full of file reads looks small to it. I will put all three steps on one budget and prune old tool output before summarising.', reasoning: '', anthropicReasoning: null },
		tool('update_task_list', 'success', {}, { text: '[x] Find why the cut runs first' + NL + '[x] Read both thresholds' + NL + '[~] Write contextBudget.ts and use it in both places' + NL + '[ ] Add a test that fails on the old thresholds', total: 4, done: 2 }),
		tool('edit_file', 'success', { uri: furi('browser/convertToLLMMessageService.ts'), searchReplaceBlocks: block }, {}),
		{ role: 'checkpoint', type: 'tool_edit', vaderFileSnapshotOfURI: {}, userModifications: { vaderFileSnapshotOfURI: {} } },
		tool('run_command', 'tool_request', { command: 'node src/vs/workbench/contrib/vader/test/contextBudgetE2E.mjs', cwd: null, terminalId: 'z' }, null),
	]
	run1.messages.push(...moved.map((m: any) => ({ ...m, id: 'tc-' + (n++), rawParams: m.params, content: m.content ?? '' })))
	// every other task: its messages as the chat needs them (a read has its text, a tool has an id and the params as written)
	for (const th of Object.values<any>(chat.state.allThreads)) {
		th.messages = th.messages.map((m: any) => {
			if (m.role === 'user') return { selections: [], state: { stagingSelections: [], isBeingEdited: false }, ...m }
			if (m.role === 'assistant') return { reasoning: '', anthropicReasoning: null, ...m }
			if (m.role !== 'tool') return m
			const uri = m.params?.uri && typeof m.params.uri.fsPath === 'string' && !m.params.uri.scheme ? URI.file(m.params.uri.fsPath) : m.params?.uri
			const params = { ...m.params, ...(uri ? { uri } : {}) }
			const result = m.result ?? (m.name === 'read_file' ? { fileContents: '', totalFileLen: 0, hasNextPage: false } : m.name === 'edit_file' ? {} : m.result)
			return { id: 'tc-' + (n++), rawParams: params, content: '', ...m, params, result }
		})
	}
	w.__files['c:/work/vader-app/browser/convertToLLMMessageService.ts'] = ['const { messages, systemMessage } = args', '', 'reservedOutputTokenSpace = Math.max(', '\t// the budget comes from common/contextBudget.ts, shared with the summary', '\tconst charsNeedToTrim = totalLen - inputBudgetChars(contextWindow, reserved)', 'let remainingCharsToTrim = charsNeedToTrim'].join(NL)
}
const prev = w.__accessor
w.__accessor = {
	get: (name: string) => ({
		IMCPService: mcpSvc, ITerminalService: terminalSvc, IMemoryService: memorySvc, IKeybindingService: keybinding, IMetricsService: metrics, ILanguageService: language,
		IPolicyService: { setMode(m: string) { log(`mode:${m}`); w.__policy = { state: { mode: m } }; notify() } },
		IWorkspaceContextService: { getWorkspace: () => ({ folders: [{ uri: URI.file('c:/work/vader-app') }] }), isInsideWorkspace: (u: any) => String(u.fsPath).toLowerCase().split(String.fromCharCode(92)).join('/').startsWith('c:/work/vader-app') },
		IUnifiedMarketplaceService: addonsServices.service, ISkillService: addonsServices.skillSvc,
		IVaderModelService: { async getModelSafe(u: any) { const t = w.__files?.[String(u.fsPath).split(String.fromCharCode(92)).join('/')]; return { model: t === undefined ? null : { getValue: () => t, getLanguageId: () => 'typescript' }, editorModel: null } } },
		IVaderCommandBarService: { getStreamState: () => 'idle-has-changes' }, IClipboardService: { async writeText() { } },
		IToolsService: toolsSvc, IAgentGatewayService: gateway, IVaderSettingsService: settingsSvc,
	} as any)[name] ?? prev.get(name) ?? empty,
}
w.__skills = addonsServices.installedSkills
w.__notify = notify
w.__noModel = false

