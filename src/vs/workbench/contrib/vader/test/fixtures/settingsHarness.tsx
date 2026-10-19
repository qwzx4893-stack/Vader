// Vader's Settings as it is built for the app (react/src2), mounted in a plain browser page. The services are objects of this page; the test reads what the pages
// did to them. Used by test/settingsUiE2E.mjs.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Settings } from '../../browser/react/src2/vader-settings-tsx/SettingsApp'
import { notify } from './settingsHarnessServices'
import { providerNames } from '../../common/vaderSettingsTypes'
import { builtInPolicyRules } from '../../common/policy/builtInPolicyRules'
import { addToLedger, dayKey } from '../../common/usageAccounting'

const w = window as any
w.__log = [] as string[]
w.__opened = [] as string[]

const settingsOfProvider: any = {}
for (const p of providerNames) settingsOfProvider[p] = { models: [], _didFillInProviderSettings: false, apiKey: '' }
for (const p of ['anthropic', 'openRouter']) { settingsOfProvider[p]._didFillInProviderSettings = true; settingsOfProvider[p].apiKey = 'sk-test-' + p }
const mo = (providerName: string, modelName: string) => ({ name: modelName, selection: { providerName, modelName } })
w.__settings = { settingsOfProvider, modelSelectionOfFeature: { Chat: { providerName: 'anthropic', modelName: 'claude-sonnet-4-5' }, Autocomplete: null, Apply: null, SCM: null },
	_modelOptions: [mo('anthropic', 'claude-sonnet-4-5'), mo('openAI', 'gpt-5'), mo('mistral', 'codestral-latest'), mo('ollama', 'qwen2.5-coder:7b')],
	globalSettings: { autoApprove: { edits: true }, autoAcceptLLMChanges: false, includeToolLintErrors: true, dailySpendLimitUsd: 5, priceDiscountPercent: 0, modelPriceOverrides: {}, enableAutocomplete: false, showInlineSuggestions: true, syncApplyToChat: true, syncSCMToChat: true, enableFastApply: true, autoCheckUpdates: false, chatMode: 'agent', isOnboardingComplete: true }, overridesOfModel: {} }

// ---- the policy
let customRules: any[] = []
let disabled = new Set<string>()
w.__policy = { state: { mode: 'balanced' } }
const policy: any = {
	getAllRules: () => [...builtInPolicyRules.map((r: any) => ({ ...r, builtIn: true, enabled: r.locked || !disabled.has(r.id) })), ...customRules],
	setMode(m: string) { w.__log.push(`policy:${m}`); w.__policy = { state: { mode: m } }; notify() },
	setRuleEnabled(id: string, on: boolean) { w.__log.push(`rule:${id}=${on}`); on ? disabled.delete(id) : disabled.add(id); notify() },
	addCustomRule(r: any) { w.__log.push(`addrule:${r.effect}:${r.kinds.join('+')}:${r.description}`); customRules = [...customRules, { ...r, id: 'c' + customRules.length, builtIn: false, locked: false, enabled: true }]; notify() },
	removeCustomRule(id: string) { w.__log.push(`removerule:${id}`); customRules = customRules.filter(r => r.id !== id); notify() },
}

// ---- the settings service
const settingsSvc: any = {
	get state() { return w.__settings },
	setModelSelectionOfFeature(f: string, v: any) { w.__log.push(`select:${f}=${v.modelName}`); w.__settings = { ...w.__settings, modelSelectionOfFeature: { ...w.__settings.modelSelectionOfFeature, [f]: v } }; notify() },
	async setSettingOfProvider(p: string, k: string, v: any) { w.__log.push(`provider:${p}.${k}=${v}`); w.__settings = { ...w.__settings, settingsOfProvider: { ...w.__settings.settingsOfProvider, [p]: { ...w.__settings.settingsOfProvider[p], [k]: v } } }; notify() },
	resetState() { w.__log.push('settings:reset') },
	dangerousSetState(v: any) { w.__log.push(`settings:import:${Object.keys(v).length}`) },
	setGlobalSetting(k: string, v: any) { w.__log.push(`global:${k}=${JSON.stringify(v)}`); w.__settings = { ...w.__settings, globalSettings: { ...w.__settings.globalSettings, [k]: v } }; notify() },
}

// ---- usage: fourteen days of use by three models, so the page has something to say
const today = new Date()
const dayAgo = (n: number) => dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n))
let ledger: any = {}
const son = { providerName: 'anthropic', modelName: 'claude-sonnet-4-5', isLocal: false }
const ds = { providerName: 'openRouter', modelName: 'deepseek/deepseek-v3.2', isLocal: false }
const qw = { providerName: 'ollama', modelName: 'qwen3-coder', isLocal: true }
const acme = { providerName: 'openAI-compatible', modelName: 'acme-internal-70b', isLocal: false }
for (let i = 0; i < 12; i++) ledger = addToLedger(ledger, dayAgo(i), { inputTokens: 900_000 + i * 20_000, outputTokens: 90_000 }, 1.2 + (i % 4) * 0.3, 'estimate', son)
ledger = addToLedger(ledger, dayAgo(0), { inputTokens: 640_000, outputTokens: 71_000 }, 3.12, 'billed', ds)
ledger = addToLedger(ledger, dayAgo(1), { inputTokens: 212_000, outputTokens: 40_000 }, 0, 'free', qw)
ledger = addToLedger(ledger, dayAgo(2), { inputTokens: 88_000, outputTokens: 9_000 }, undefined, 'unpriced', acme)
w.__ledger = w.__ledger ?? ledger
let approvals: any[] = [{ key: 'k1', label: 'npm test -- --runInBand', kind: 'command', addedAt: Date.parse('2026-10-12T10:00:00Z') }]
const chat: any = {
	onDidChangeUsage: () => ({ dispose() { } }), onDidChangeProjectApprovals: () => ({ dispose() { } }),
	getCurrentProjectKey: () => w.__projectKey === undefined ? 'C:\\work\\vader-app' : w.__projectKey,
	listProjectApprovals: () => approvals,
	revokeProjectApproval(_k: string, key: string) { w.__log.push(`revoke:${key}`); approvals = approvals.filter(a => a.key !== key); notify() },
	getUsageLedger: () => w.__ledger,
	getUsageToday: () => w.__ledger[dayKey(new Date())] ?? { costUsd: 0, billedCostUsd: 0, inputTokens: 0, outputTokens: 0, unpricedTurns: 0 },
}
const commands: any = { async executeCommand(id: string, ...a: any[]) { w.__log.push(`command:${id}${a.length ? ':' + a.join(',') : ''}`) } }
const opener: any = { async open(u: any) { w.__opened.push(String(u)) } }

// ---- the model router: three models are set up; Automatic answers from a fixed table the way the real router scores them
const MODELS: any[] = [
	{ providerName: 'anthropic', modelName: 'claude-sonnet-4-5', isLocal: false, costPerMillionInputTokens: 3, costPerMillionOutputTokens: 15 },
	{ providerName: 'openAI', modelName: 'gpt-5', isLocal: false, costPerMillionInputTokens: 1.25, costPerMillionOutputTokens: 10 },
	{ providerName: 'ollama', modelName: 'qwen2.5-coder:7b', isLocal: true, costPerMillionInputTokens: 0, costPerMillionOutputTokens: 0 },
	{ providerName: 'openAI-compatible', modelName: 'acme-internal-70b', isLocal: false, costPerMillionInputTokens: 0, costPerMillionOutputTokens: 0 },
]
const sel = (m: any) => ({ providerName: m.providerName, modelName: m.modelName })
const AUTO: any = { subagent: MODELS[0], research: MODELS[1], browser: MODELS[0], summarization: MODELS[2], verification: MODELS[1] }
w.__router = { state: { mode: 'manual', categoryOverrides: {} } }
const router: any = {
	listConfiguredModels: () => w.__noModels ? [] : MODELS,
	describeModel: (s: any) => MODELS.find(m => m.modelName === s.modelName) ?? { ...s, isLocal: false, costPerMillionInputTokens: 0, costPerMillionOutputTokens: 0 },
	getCategoryOverride: (c: string) => w.__router.state.categoryOverrides[c] ?? null,
	setCategoryOverride(c: string, v: any) { w.__log.push(`override:${c}=${v ? v.modelName : 'null'}`); const o = { ...w.__router.state.categoryOverrides }; v ? o[c] = v : delete o[c]; w.__router = { state: { ...w.__router.state, categoryOverrides: o } }; notify() },
	setMode(m: string) { w.__log.push(`router:${m}`); w.__router = { state: { ...w.__router.state, mode: m } }; notify() },
	resolveModel(c: string) { if (w.__noModels) return null; if (w.__router.state.mode === 'auto') return sel(AUTO[c]); return w.__router.state.categoryOverrides[c] ?? sel(MODELS[0]) },
}

// ---- saved agents
let agentList: any[] = [
	{ id: 'a1', name: 'Reviewer', description: 'Reads a diff and reports blockers', instructions: 'You review changes against the request.', modelSelection: sel(MODELS[0]), allowedApprovalTypes: ['terminal', 'MCP tools'], deniedToolNames: ['create_pull_request'], mcpServerNames: ['GitHub'], filesystemScopeGlobs: ['src/**'], createdBy: 'user', createdAt: 1 },
	{ id: 'a2', name: 'Release notes', description: 'Made by the main agent on Tue', instructions: 'Write release notes.', modelSelection: null, allowedApprovalTypes: [], deniedToolNames: [], createdBy: 'main-agent', createdAt: 2 },
]
w.__agentsSvc = { state: { agents: agentList } }
const setAgents = (l: any[]) => { agentList = l; w.__agentsSvc = { state: { agents: l } }; notify() }
const agentsSvc: any = {
	createAgent(i: any, by: string) { const a = { id: 'n' + agentList.length, ...i, modelSelection: i.modelSelection ?? null, createdBy: by, createdAt: 3 }; w.__log.push(`agent:create:${i.name}`); setAgents([...agentList, a]); return a },
	updateAgent(id: string, p: any) { w.__log.push(`agent:update:${id}:${JSON.stringify(p)}`); setAgents(agentList.map(a => a.id === id ? { ...a, ...p } : a)) },
	deleteAgent(id: string) { w.__log.push(`agent:delete:${id}`); setAgents(agentList.filter(a => a.id !== id)) },
}
let threadAgent: string | null = null
chat.getCurrentThread = () => ({ id: 't1', agentId: threadAgent })
chat.setThreadAgentId = (_t: string, id: string | null) => { w.__log.push(`useagent:${id}`); threadAgent = id; notify() }

// ---- MCP
w.__mcp = { state: { mcpServerOfName: { GitHub: { status: 'success', command: 'npx @github/mcp', tools: [{ name: 'GitHub_create_issue' }, { name: 'GitHub_list_prs' }] }, Linear: { status: 'success', tools: [] }, 'acme-internal': { status: 'error', error: 'spawn ENOENT', command: 'node C:\tools\acme-mcp\index.js' } } } }

// ---- the app's own services that the pages use
chat.state = { allThreads: { t1: { id: 't1', messages: [] }, t2: { id: 't2', messages: [] }, t3: { id: 't3', messages: [] } }, currentThreadId: 't1' }
chat.resetState = () => { w.__log.push('chats:reset') }
chat.dangerousSetState = (v: any) => { w.__log.push(`chats:import:${Object.keys(v.allThreads ?? {}).length}`) }
const product: any = { vaderVersion: '0.1.0', version: '1.136.2', commit: '0123456789abcdef', date: '2026-10-14T10:00:00Z', extensionsGallery: { serviceUrl: 'https://open-vsx.org/vscode/gallery' } }
let verify = false
const config: any = { getValue: (k: string) => k === 'extensions.verifySignature' ? verify : undefined, async updateValue(k: string, v: any) { w.__log.push(`config:${k}=${v}`); verify = v; configListeners.forEach(l => l({ affectsConfiguration: (x: string) => x === k })) }, onDidChangeConfiguration: (l: any) => { configListeners.add(l); return { dispose() { configListeners.delete(l) } } } }
const configListeners = new Set<any>()
const notifications: any = { info: (m: string) => w.__log.push(`notify:${m}`), notify: (n: any) => w.__log.push(`notify-error:${n.message}`) }
const env: any = { logsHome: { fsPath: 'C:\\logs' } }
const nativeHost: any = { async showItemInFolder(p: string) { w.__log.push(`folder:${p}`) } }
const transfer: any = { async transferExtensions(_os: any, from: string) { w.__log.push(`transfer:${from}`); return from === 'Trae' ? 'Trae was not found at C:\\Users\\me\\AppData\\Roaming\\Trae.' : undefined } }
w.__accessor = { get: (name: string) => ({ IProductService: product, IConfigurationService: config, INotificationService: notifications, IEnvironmentService: env, INativeHostService: nativeHost, IExtensionTransferService: transfer, IPolicyService: policy, IVaderSettingsService: settingsSvc, IChatThreadService: chat, ICommandService: commands, IOpenerService: opener, IModelRouterService: router, IAgentsService: agentsSvc } as any)[name] }

createRoot(document.getElementById('root')!).render(<Settings />)
w.__mounted = true
