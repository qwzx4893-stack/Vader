// The Vader window as it is built for the app (react/src2), mounted in a plain browser page. The conversations, the shell service and the settings
// are objects of this page; the chat and Add-ons are stand-ins (they have their own tests). Used by test/shellUiE2E.mjs.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Shell } from '../../browser/react/src2/vader-shell-tsx/Shell'
import { notify } from './shellHarnessServices'
import { deriveThreadStatus, endsWithToolRequest, changedFilesSinceLastUserMessage } from '../../common/threadStatus'
import { groupThreadsByProject } from '../../common/threadProjects'

const w = window as any
const NOW = Date.parse('2026-10-14T12:30:00Z')
const iso = (minsAgo: number) => new Date(NOW - minsAgo * 60000).toISOString()

const user = (text: string) => ({ role: 'user', displayContent: text, content: text })
const asst = (text: string) => ({ role: 'assistant', displayContent: text })
const tool = (name: string, type: string, params: any = {}, result: any = null) => ({ role: 'tool', name, type, params, result })
const edit = (path: string) => tool('edit_file', 'success', { uri: { fsPath: path } })

// [id, minutesAgo, project, messages, running?]
const T: any[] = [
	['t-wait', 2, 'c:/work/vader-app', [user('Put summaries before the blind cut'), asst('I will put all three steps on one budget.'), tool('update_task_list', 'success', {}, { text: '[x] Find why the cut runs first\n[x] Read both thresholds\n[~] Write contextBudget.ts\n[ ] Add a test', total: 4, done: 2 }), edit('c:/work/vader-app/contextBudget.ts'), tool('run_command', 'tool_request', { command: 'node test/contextBudgetE2E.mjs' })]],
	['t-run1', 14, 'c:/work/vader-app', [user('Probe every provider gateway'), tool('read_file', 'success', { uri: { fsPath: 'c:/work/vader-app/providers.ts' } })], 'LLM'],
	['t-run2', 9, 'c:/work/vader-app', [user('Stop a model that repeats itself'), tool('read_file', 'success', { uri: { fsPath: 'c:/work/vader-app/loop.ts' } })], 'LLM'],
	['t-chat', 60, 'c:/work/vader-app', [user('How does prepareMessages trim?'), asst('It works in two passes, and the order is what surprises people.')]],
	['t-review', 70, 'c:/work/vader-app', [user('Read AGENTS.md as workspace rules'), edit('c:/work/vader-app/AGENTS.md'), asst('Done.')]],
	['t-d1', 300, 'c:/work/docs-site', [user('Fix the broken link check'), asst('ok')]],
	['t-d2', 400, 'c:/work/docs-site', [user('Add a page for the CLI'), asst('ok')]],
	['t-a1', 1500, 'c:/work/api-gateway', [user('Rate limit per key'), asst('ok')]],
	['t-c1', 3000, null, [user('Regex for semver ranges'), asst('Use a pattern like this.')]],
	['t-c2', 3100, null, [user('Compare two SQL indexes'), asst('Check the plan first.')]],
]

const allThreads: any = {}
const stream: any = {}
for (const [id, mins, proj, messages, running] of T) {
	allThreads[id] = { id, createdAt: iso(mins + 5), lastModified: iso(mins), messages, state: {}, filesWithUserChanges: new Set(), projectFolders: proj ? [proj] : undefined }
	if (running) stream[id] = { isRunning: running }
}
w.__chat = {
	state: { allThreads, currentThreadId: 't-wait' },
	streamState: stream,
	_pause: {} as any,
	listProjectGroups() {
		return groupThreadsByProject(Object.values(allThreads).map((t: any) => ({ id: t.id, lastModified: t.lastModified, messageCount: t.messages.length, projectFolders: t.projectFolders })), 'c:/work/vader-app')
	},
	getCurrentProjectKey: () => 'c:/work/vader-app',
	getThreadStatus(id: string) {
		const t = allThreads[id]
		return deriveThreadStatus({ isRunning: stream[id]?.isRunning, isPaused: !!this._pause[id], hasError: false, endsWithToolRequest: endsWithToolRequest(t.messages), changedFilesSinceLastUserMessage: changedFilesSinceLastUserMessage(t.messages) })
	},
	getThreadUsage: (id: string) => id === 't-wait' ? { turns: 3, inputTokens: 41000, outputTokens: 2000, cachedInputTokens: 0, costUsd: 0.31, billedCostUsd: 0, unpricedTurns: 0, turnsWithUsage: 3 } : undefined,
	getUsageToday: () => ({ costUsd: 2.14, billedCostUsd: 0, inputTokens: 150420, outputTokens: 21880, unpricedTurns: 0 }),
	switchToThread(id: string) { this.state = { ...this.state, currentThreadId: id }; w.__log.push(`switch:${id}`); notify() },
	openNewThread() { w.__log.push('new'); notify() },
	getPause(id: string) { return this._pause[id] },
	pauseRun(id: string) { this._pause[id] = { reason: 'user' }; w.__log.push(`pause:${id}`); notify() },
	resumeRun(id: string) { delete this._pause[id]; w.__log.push(`resume:${id}`); notify() },
}
w.__log = [] as string[]
w.__settings = { modelSelectionOfFeature: { Chat: { providerName: 'anthropic', modelName: 'Sonnet 4.5' } }, globalSettings: { chatMode: 'agent', dailySpendLimitUsd: 5 } }
const shell: any = {
	state: { mode: 'window', page: 'conversation', tab: 'conversation', searchOpen: false },
	show(page = this.state.page, tab = page === 'conversation' ? this.state.tab : 'conversation') { this.state = { ...this.state, mode: 'window', page, tab, searchOpen: false }; notify() },
	openEditor() { this.state = { ...this.state, mode: 'editor' }; w.__log.push('editor'); notify() },
	setTab(tab: string) { this.state = { ...this.state, page: 'conversation', tab }; notify() },
	setSearchOpen(open: boolean) { this.state = { ...this.state, searchOpen: open }; notify() },
}
w.__shell = shell
const commands: any = { async executeCommand(id: string) { w.__log.push(`cmd:${id}`) } }
const tools: any = { callTool: { async search_pathnames_only({ query }: any) { return { result: Promise.resolve({ uris: ['src/limiter.ts', 'src/app.ts'].filter(p => p.includes(query)).map(p => ({ fsPath: 'c:/work/vader-app/' + p })) }) } } } }
const settingsSvc: any = { state: w.__settings, setGlobalSetting(k: string, v: any) { w.__settings.globalSettings[k] = v; w.__log.push(`setting:${k}=${v}`); notify() } }
// ---- the editor's pending edits, as the review page reads them
const uriOf = (p: string) => ({ fsPath: p, toString: () => 'file:///' + p })
const ROOT = 'c:/work/vader-app'
const fileText: { [p: string]: string[] } = {
	[ROOT + '/browser/convertToLLMMessageService.ts']: ['const { messages, systemMessage } = args', '', 'reservedOutputTokenSpace = Math.max(', '// the budget comes from common/contextBudget.ts', 'const charsNeedToTrim = totalLen - inputBudgetChars(contextWindow, reserved)', 'let remainingCharsToTrim = charsNeedToTrim', '', 'if (charsNeedToTrim > 0) {', '  pruneOldToolOutput(messages)', '}'],
	[ROOT + '/browser/chatThreadService.ts']: ['a', 'b', 'c', 'd', 'e', 'f'],
	[ROOT + '/common/contextBudget.ts']: Array.from({ length: 98 }, (_, i) => `export const line${i + 1} = ${i + 1}`),
}
let diffId = 1
const mk = (path: string, d: any) => ({ diffid: diffId++, diffareaid: 1, ...d, _path: path })
const diffs: { [id: number]: any } = {}
const cb: any = { stateOfURI: {}, sortedURIs: [] }
const addFile = (path: string, ds: any[]) => {
	const made = ds.map(d => mk(path, d)); made.forEach(d => { diffs[d.diffid] = d })
	cb.stateOfURI[path] = { sortedDiffIds: made.map(d => String(d.diffid)), sortedDiffZoneIds: ['1'], isStreaming: false, diffIdx: null }
	cb.sortedURIs = [...cb.sortedURIs, uriOf(path)]
}
const NL = String.fromCharCode(10)
const L = (...lines: string[]) => lines.join(NL)
addFile(ROOT + '/browser/convertToLLMMessageService.ts', [{ type: 'edit', originalCode: L('contextWindow * 1 / 2, // reserve at least 1/4', 'reservedOutputTokenSpace ?? 4_096 // defaults to 4096', ')'), originalStartLine: 300, code: L('// the budget comes from common/contextBudget.ts', 'const charsNeedToTrim = totalLen - inputBudgetChars(contextWindow, reserved)'), startLine: 4, endLine: 5 }])
addFile(ROOT + '/browser/chatThreadService.ts', [{ type: 'insertion', originalStartLine: 2, code: L('x', 'y', 'z'), startLine: 2, endLine: 4 }, { type: 'edit', originalCode: 'e', originalStartLine: 5, code: L('E1', 'E2'), startLine: 5, endLine: 6 }])
addFile(ROOT + '/common/contextBudget.ts', [{ type: 'insertion', originalStartLine: 1, code: fileText[ROOT + '/common/contextBudget.ts'].join(NL), startLine: 1, endLine: 98 }])
const removeFile = (path: string) => {
	for (const id of cb.stateOfURI[path]?.sortedDiffIds ?? []) delete diffs[Number(id)]
	delete cb.stateOfURI[path]; cb.sortedURIs = cb.sortedURIs.filter((u: any) => u.fsPath !== path); notify()
}
w.__cb = cb
const editSvc: any = {
	diffOfId: diffs,
	acceptDiff({ diffid }: any) { w.__log.push(`acceptDiff:${diffid}`); const d = diffs[diffid]; if (!d) return; const st = cb.stateOfURI[d._path]; st.sortedDiffIds = st.sortedDiffIds.filter((x: string) => x !== String(diffid)); delete diffs[diffid]; if (st.sortedDiffIds.length === 0) removeFile(d._path); else notify() },
	rejectDiff({ diffid }: any) { w.__log.push(`rejectDiff:${diffid}`); this.acceptDiff({ diffid }) },
	acceptOrRejectAllDiffAreas({ uri, behavior }: any) { w.__log.push(`${behavior}All:${uri.fsPath}`); removeFile(uri.fsPath) },
}
const modelSvc: any = { getModel: (u: any) => fileText[u.fsPath] ? { getValue: () => fileText[u.fsPath].join(NL) } : null }
w.__sent = [] as any[]
chatAddReviewComment()
function chatAddReviewComment() { w.__chat.addReviewComment = async (threadId: string, c: any) => { w.__sent.push({ threadId, ...c }); return true } }
const gatewaySvc: any = { async startTask(o: any) { w.__log.push(`startTask:${String(o.userMessage).slice(0, 40)}`) } }
w.__evidence = { gitDiffStat: '', diagnosticsSummary: '', checksDetected: true, checks: [{ name: 'Type check', command: 'tsc', passed: true, exitCode: 0, outputTail: '' }, { name: 'Lint', command: 'eslint', passed: true, exitCode: 0, outputTail: '' }] }
w.__verdict = { passed: false, summary: 'Needs changes', findings: [{ severity: 'blocker', description: 'limiter.ts:21 never clears old hits, so a key stays blocked.', location: 'limiter.ts:21' }, { severity: 'info', description: 'No test covers a burst of requests.' }] }
const verifySvc: any = { async gatherEvidence() { await new Promise(r => setTimeout(r, 50)); return w.__evidence }, async runIndependentVerification() { await new Promise(r => setTimeout(r, 50)); return { evidence: w.__evidence, verdict: w.__verdict } } }
w.__commitFail = ''
const reviewSvc: any = {
	async commit(m: string) { if (w.__commitFail) throw new Error(w.__commitFail); w.__log.push(`commit:${m}`); return 'a1b2c3d' },
	async repoInfo() { return { branch: 'agent/context-budget', pullRequestUrl: w.__noRemote ? undefined : 'https://github.com/o/r/compare/agent/context-budget?expand=1' } },
	async openPullRequestPage() { w.__log.push('pr'); return true },
}
const workspaceSvc: any = { getWorkspace: () => ({ folders: [{ uri: { fsPath: ROOT } }] }) }
// ---- what the agent did in its browser and its terminals
allThreads['t-wait'].messages.splice(2, 0,
	tool('browser_navigate', 'success', { url: 'http://localhost:5173/', pageId: null }),
	tool('browser_click', 'success', { ref: 'button Send 70 requests', pageId: null }),
	tool('browser_screenshot', 'success', { pageId: null }),
	tool('open_persistent_terminal', 'success', { cwd: null }, { persistentTerminalId: '1' }),
	tool('run_persistent_command', 'success', { command: 'npm run dev', persistentTerminalId: '1' }, { result: 'ready', resolveReason: { type: 'timeout' } }),
	tool('run_command', 'success', { command: 'npm test', cwd: null, terminalId: 'x' }, { result: '48 passed', resolveReason: { type: 'done', exitCode: 0 } }),
	tool('run_command', 'rejected', { command: 'rm -rf dist', cwd: null, terminalId: 'y' }),
)
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
w.__pages = [{ pageId: 'p1', url: 'http://localhost:5173/', title: 'Rate limiter demo', isActive: true, isClosed: false }, { pageId: 'p2', url: 'http://localhost:5173/docs', title: 'API docs', isActive: false, isClosed: false }]
w.__browserDown = ''
const browserSvc: any = {
	async listPages() { if (w.__browserDown) throw new Error(w.__browserDown); return w.__pages },
	async screenshot() { return PNG },
	async consoleLogs() { return [{ type: 'log', text: 'limiter ready, 60 per minute' }, { type: 'error', text: 'Uncaught (in promise) Error: rate limited at send (app.js:48)' }] },
	async networkLog() { return [{ url: 'http://localhost:5173/api', method: 'GET', status: 200, failureText: null }, { url: 'http://localhost:5173/api/send', method: 'POST', status: 429, failureText: null }] },
	async pageErrors() { return [{ message: 'rate limited at send (app.js:48)' }] },
	async reload() { w.__log.push('reload'); return {} },
}
const term: any = {
	_out: { '1': ['> npm run dev', 'VITE v6.0.1  ready in 412 ms', '  Local:   http://localhost:5173/'].join(NL) } as any, _alive: { '1': true, '2': true } as any,
	listPersistentTerminalIds: () => Object.keys(term._alive).filter(k => term._alive[k]),
	persistentTerminalExists: (id: string) => !!term._alive[id],
	async readTerminal(id: string) { return term._out[id] ?? '' },
	async runCommand(c: string, o: any) { w.__log.push(`term:${o.persistentTerminalId}:${c}`); term._out[o.persistentTerminalId] += NL + '$ ' + c },
	async killPersistentTerminal(id: string) { w.__log.push(`kill:${id}`); term._alive[id] = false },
}
w.__opened = [] as string[]
const opener: any = { async open(u: any) { w.__opened.push(String(u)) } }
w.__accessor = {
	get: (name: string) => ({ IChatThreadService: w.__chat, IVaderShellService: shell, ICommandService: commands, IToolsService: tools, IVaderSettingsService: settingsSvc, IEditCodeService: editSvc, IModelService: modelSvc, IAgentGatewayService: gatewaySvc, IVerificationService: verifySvc, IVaderReviewService: reviewSvc, IWorkspaceContextService: workspaceSvc, IBrowserToolMainService: browserSvc, ITerminalToolService: term, IOpenerService: opener } as any)[name],
}
Date.now = () => NOW

createRoot(document.getElementById('root')!).render(<Shell />)
w.__mounted = true
