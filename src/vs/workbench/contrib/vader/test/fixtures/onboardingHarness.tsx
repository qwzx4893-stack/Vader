// The first run as it is built for the app (react/src2), mounted in a plain browser page. The services it asks are objects of this page; the test
// (test/onboardingUiE2E.mjs) sets what the provider answers and what is found on the computer, and reads back what the first run did.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { VaderOnboarding } from '../../browser/react/src2/vader-onboarding/VaderOnboarding'
import { notify } from './onboardingHarnessServices'
import { providerNames, localProviderNames } from '../../common/vaderSettingsTypes'

const w = window as any
w.__log = [] as string[]

const settingsOfProvider: any = {}
for (const p of providerNames) settingsOfProvider[p] = { models: [], _didFillInProviderSettings: false, apiKey: '' }
w.__settings = { settingsOfProvider, modelSelectionOfFeature: { Chat: null }, globalSettings: { isOnboardingComplete: false, chatMode: 'agent', externalAgentId: null } }

/** what asking a provider for its models answers: set by the test, one answer per provider */
w.__answers = w.__answers ?? {}
w.__cloud = {} as any
w.__local = {} as any
for (const p of localProviderNames) w.__local[p] = { state: 'finished' }
w.__agents = w.__agents ?? { statuses: {} }
w.__policy = { state: { mode: 'balanced' } }

const settingsSvc: any = {
	setGlobalSetting(k: string, v: any) { w.__log.push(`global:${k}=${v}`); w.__settings = { ...w.__settings, globalSettings: { ...w.__settings.globalSettings, [k]: v } }; notify() },
	async setSettingOfProvider(p: string, k: string, v: any) { w.__log.push(`provider:${p}.${k}=${v}`); w.__settings.settingsOfProvider[p] = { ...w.__settings.settingsOfProvider[p], [k]: v, _didFillInProviderSettings: !!v }; notify() },
	setModelSelectionOfFeature(f: string, s: any) { w.__log.push(`select:${f}=${s.providerName}/${s.modelName}`); w.__settings = { ...w.__settings, modelSelectionOfFeature: { ...w.__settings.modelSelectionOfFeature, [f]: s } }; notify() },
}
const refreshSvc: any = {
	async refreshCloudModels(p: string) {
		w.__log.push(`refresh:${p}`)
		w.__cloud = { ...w.__cloud, [p]: { status: 'loading' } }; notify()
		await new Promise(r => setTimeout(r, 250))
		const a = w.__answers[p] ?? { status: 'error', reason: 'network', message: 'fetch failed' }
		if (a.status === 'ok') w.__settings.settingsOfProvider[p] = { ...w.__settings.settingsOfProvider[p], models: Array.from({ length: a.count }, (_, i) => ({ modelName: `${p}-model-${i}`, isHidden: false })) }
		w.__cloud = { ...w.__cloud, [p]: a }; notify()
	},
	startRefreshingModels(p: string) { w.__log.push(`look:${p}`); w.__lookCount = (w.__lookCount ?? 0) + 1; if (w.__localAfterLook?.[p]) { w.__settings.settingsOfProvider[p] = { ...w.__settings.settingsOfProvider[p], models: w.__localAfterLook[p].map((m: string) => ({ modelName: m, isHidden: false })) }; notify() } },
}
const policySvc: any = { setMode(m: string) { w.__log.push(`policy:${m}`); w.__policy = { state: { mode: m } }; notify() } }
const storage: any = { _m: new Map<string, string>(Object.entries(w.__storageSeed ?? {}) as [string, string][]), get(k: string) { return this._m.get(k) }, store(k: string, v: string) { this._m.set(k, v); w.__log.push(`store:${k}=${v}`) }, remove(k: string) { this._m.delete(k); w.__log.push(`remove:${k}`) } }
w.__storage = storage
const commands: any = { async executeCommand(id: string) { w.__log.push(`command:${id}`) } }
w.__opened = [] as string[]
const opener: any = { async open(u: any) { w.__opened.push(String(u)) } }
const chat: any = { state: { currentThreadId: 'new-thread' }, openNewThread() { w.__log.push('new-thread') } }
const gateway: any = { async startTask(a: any) { w.__log.push(`task:${a.userMessage}`) } }
const workspace: any = { getWorkspace: () => w.__workspace ?? { folders: [] } }
w.__accessor = {
	get: (name: string) => ({ IVaderSettingsService: settingsSvc, IPolicyService: policySvc, IStorageService: storage, ICommandService: commands, IOpenerService: opener, IChatThreadService: chat, IAgentGatewayService: gateway, IRefreshModelService: refreshSvc, IWorkspaceContextService: workspace, IMetricsService: { capture: () => { } } } as any)[name],
}

createRoot(document.getElementById('root')!).render(<VaderOnboarding />)
w.__mounted = true
