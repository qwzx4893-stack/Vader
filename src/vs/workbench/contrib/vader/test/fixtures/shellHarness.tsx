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
w.__accessor = {
	get: (name: string) => ({ IChatThreadService: w.__chat, IVaderShellService: shell, ICommandService: commands, IToolsService: tools, IVaderSettingsService: settingsSvc } as any)[name],
}
Date.now = () => NOW

createRoot(document.getElementById('root')!).render(<Shell />)
w.__mounted = true
