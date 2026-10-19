/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react'
import { URI } from '../../../../../../../base/common/uri.js'
import { useAccessor, useCloudModelListState, useRefreshModelState, useSettingsState } from '../util/services.js'
import { ProviderLogo } from '../util/ProviderLogo.js'
import { Icon, Spinner } from '../vader-shell-tsx/icons.js'
import { ProviderName, SettingName, customSettingNamesOfProvider, displayInfoOfProviderName, displayInfoOfSettingName, localProviderNames, nonlocalProviderNames, subTextMdOfProviderName } from '../../../../common/vaderSettingsTypes.js'
import { isCloudListedProvider } from '../../../../common/cloudModelListTypes.js'
import { filterProviders } from '../../../../common/providerSearch.js'
import { getModelCapabilities } from '../../../../common/modelCapabilities.js'
import { FeatureModelSelect } from './FeatureModelSelect.js'
import { ModelOverridesDialog, OverrideTarget } from './ModelOverridesDialog.js'
import { Group, Note, PageHead, Switch } from './ui.js'

// Models (boards R09 and R28): which model each feature uses, and where the models come from. A provider with a key shows its live list of models, a local server is
// looked for by itself, and every row says what it knows: how many models, which key, whether the provider answered. Nothing is written into the app in advance.

const FIRST = ['openRouter', 'anthropic', 'openAI', 'gemini', 'groq', 'mistral'] as const
const LOCAL_PORT: { [p: string]: string } = { ollama: 'localhost:11434', lmStudio: 'localhost:1234' }
const ctx = (n: number) => n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

/** [text](url) and `code` in the one-line notes the settings types carry, as text and links the person can open */
const Notes = ({ text, onOpen }: { text: string, onOpen: (url: string) => void }) => {
	const parts: React.ReactNode[] = []
	const re = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|`([^`]+)`/g
	let last = 0, m: RegExpExecArray | null, i = 0
	while ((m = re.exec(text))) {
		if (m.index > last) parts.push(text.slice(last, m.index))
		if (m[1]) parts.push(<button key={i++} className='tx' style={{ height: 'auto', padding: 0, color: 'var(--ac)' }} onClick={() => onOpen(m![2])}>{m[1]}</button>)
		else parts.push(<span key={i++} className='mo'>{m[3]}</span>)
		last = m.index + m[0].length
	}
	if (last < text.length) parts.push(text.slice(last))
	return <>{parts}</>
}

const ProviderBody = ({ p, onOverrides }: { p: ProviderName, onOverrides: (t: OverrideTarget) => void }) => {
	const accessor = useAccessor()
	const settings = accessor.get('IVaderSettingsService')
	const refresh = accessor.get('IRefreshModelService')
	const opener = accessor.get('IOpenerService')
	const state = useSettingsState()
	const cloud = useCloudModelListState()
	const local = useRefreshModelState()
	const of = state.settingsOfProvider[p] as any
	const listed = isCloudListedProvider(p)
	const isLocal = (localProviderNames as readonly string[]).includes(p)
	const names = customSettingNamesOfProvider(p) as SettingName[]
	const models: { modelName: string, type: 'default' | 'autodetected' | 'custom', isHidden: boolean }[] = of.models
	const shownCount = models.filter(m => !m.isHidden).length
	const list = listed ? cloud[p as keyof typeof cloud] as any : undefined

	const [replacing, setReplacing] = useState<{ [name: string]: boolean }>({})
	const [test, setTest] = useState<{ at: number, ms?: number } | undefined>()
	const [adding, setAdding] = useState(false)
	const [newName, setNewName] = useState('')
	const [addProblem, setAddProblem] = useState<string | undefined>()
	const [expand, setExpand] = useState(false)
	const [query, setQuery] = useState('')
	useEffect(() => { if (test && test.ms === undefined && list && list.status !== 'loading' && list.status !== 'idle') setTest({ at: test.at, ms: Math.round(performance.now() - test.at) }) }, [list?.status]) // eslint-disable-line react-hooks/exhaustive-deps

	const runTest = () => { setTest({ at: performance.now() }); void refresh.refreshCloudModels(p as any) }
	const addModel = () => {
		const name = newName.trim()
		if (!name) return
		if (models.some(m => m.modelName === name)) { setAddProblem('This model is already in the list.'); return }
		settings.addModel(p, name); setNewName(''); setAddProblem(undefined); setAdding(false)
	}
	const visible = models.filter(m => !query.trim() || m.modelName.toLowerCase().includes(query.trim().toLowerCase()))
	const rows = expand || query.trim() ? visible : visible.slice(0, 12)

	return <div className='c' data-testid='vader-provider-body' data-provider={p} style={{ gap: 14, padding: '4px 2px 20px 34px' }}>
		<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 12 }}>
			{names.map(n => {
				const { title, placeholder, isPasswordField } = displayInfoOfSettingName(p, n)
				const value = of[n] as string
				const isKey = isPasswordField && !!value && !replacing[n]
				return <label key={n} className='c' style={{ gap: 5 }}><span className='hint'>{title}</span>
					<span className='fld r' style={{ gap: 8 }}>
						{isKey ? <><span className='mo fl tr' data-testid={`vader-provider-${n}-masked`}>{value.slice(0, 5)}{'•'.repeat(8)}{value.slice(-4)}</span><button className='tx' style={{ height: 22, padding: '0 4px' }} data-testid={`vader-provider-${n}-replace`} onClick={() => setReplacing(r => ({ ...r, [n]: true }))}>Replace</button></>
							: <input className={isPasswordField ? 'fl mo' : 'fl'} data-testid={`vader-provider-${n}`} type={isPasswordField ? 'password' : 'text'} autoComplete='off' spellCheck={false} aria-label={title} placeholder={`${title} (${placeholder})`} value={value} onChange={e => { void settings.setSettingOfProvider(p, n, e.target.value) }} onBlur={() => setReplacing(r => ({ ...r, [n]: false }))} />}
					</span></label>
			})}
		</div>
		<span className='hint' style={{ lineHeight: 1.5 }}><Notes text={subTextMdOfProviderName(p)} onOpen={u => { void opener.open(URI.parse(u)) }} /></span>

		<div className='r' style={{ gap: 10, flexWrap: 'wrap' }}>
			{listed ? <button className='pb' data-testid='vader-provider-test' disabled={list?.status === 'loading' || !of._didFillInProviderSettings} onClick={runTest}>Test connection</button> : null}
			{listed || isLocal ? <button className='gb' data-testid='vader-provider-refresh' disabled={list?.status === 'loading' || (isLocal && local[p as keyof typeof local]?.state === 'refreshing')} onClick={() => { if (listed) void refresh.refreshCloudModels(p as any); else refresh.startRefreshingModels(p as any, { enableProviderOnSuccess: true, doNotFire: false }) }}>Refresh models</button> : null}
			{list?.status === 'loading' ? <span className='r t2' style={{ gap: 8 }} data-testid='vader-provider-status' data-status='loading'><Spinner />Asking the provider for its models</span> : null}
			{list?.status === 'ok' ? <span data-testid='vader-provider-status' data-status='ok'><Note kind='ok'>Works: {list.count} model{list.count === 1 ? '' : 's'}{test?.ms !== undefined ? `, ${test.ms} ms` : ''}</Note></span> : null}
			{list?.status === 'error' ? <span data-testid='vader-provider-status' data-status='error' data-reason={list.reason}><Note kind='warn'>{list.message}{list.reason === 'unauthorized' ? '' : list.reason === 'unsupported' ? ' Add the model you use by name.' : ' No models are listed until the provider answers. You can still add one by name.'}</Note></span> : null}
			{!listed && !isLocal ? <span className='hint' data-testid='vader-no-live-list'>{p === 'openAICompatible' ? 'This endpoint has no model catalogue here: add the models it serves by name.' : 'This provider publishes no list of models that Vader can ask for: add the model or deployment you use by name.'}</span> : null}
		</div>

		<div className='c' style={{ gap: 2 }}>
			<div className='r' style={{ gap: 12, paddingBottom: 6 }}>
				<span className='hint fl' data-testid='vader-provider-picker-count'>Shown in the picker: {shownCount} of {models.length}</span>
				{models.length > 12 ? <label className='srch' style={{ width: 200, height: 28 }}><Icon k='search' small /><input className='fl' data-testid='vader-provider-model-filter' placeholder='Filter models' aria-label='Filter models' value={query} onChange={e => setQuery(e.target.value)} /></label> : null}
			</div>
			{models.length === 0 ? <span className='t3' style={{ padding: '8px 0' }}>{of._didFillInProviderSettings ? 'No model yet.' : 'Add the key first, and its models appear here.'}</span> : null}
			{rows.map(m => {
				const hasOverrides = !!state.overridesOfModel?.[p]?.[m.modelName]
				const caps = getModelCapabilities(p, m.modelName, state.overridesOfModel)
				return <div key={m.modelName} className='r' data-testid='vader-provider-model' data-model={m.modelName} style={{ gap: 12, minHeight: 32 }}>
					<Switch on={!m.isHidden} label={`Show ${m.modelName} in the picker`} testId='vader-provider-model-switch' onChange={() => settings.toggleModelHidden(p, m.modelName)} />
					<span className='mo fl tr' style={{ color: m.isHidden ? 'var(--t3)' : 'var(--t1)' }}>{m.modelName}</span>
					{m.type !== 'default' ? <span className='hint'>{m.type === 'custom' ? 'added by you' : 'found here'}</span> : null}
					<button className='tx' style={{ height: 24, padding: '0 6px', color: hasOverrides ? 'var(--ac)' : undefined }} data-testid='vader-provider-model-defaults' title='What Vader assumes about this model' onClick={() => onOverrides({ modelName: m.modelName, providerName: p, type: m.type })}>{hasOverrides ? 'Defaults changed' : 'Defaults'}</button>
					{caps.contextWindow ? <span className='mo t3' style={{ width: 48, textAlign: 'right' }}>{ctx(caps.contextWindow)}</span> : <span style={{ width: 48 }} />}
					{m.type === 'custom' ? <button className='ic' style={{ width: 24, height: 24 }} aria-label={`Delete ${m.modelName}`} data-testid='vader-provider-model-delete' onClick={() => settings.deleteModel(p, m.modelName)}><Icon k='x' small /></button> : <span style={{ width: 24 }} />}
				</div>
			})}
			{!expand && !query.trim() && visible.length > rows.length ? <button className='tx' style={{ alignSelf: 'flex-start', padding: 0 }} data-testid='vader-provider-show-all' onClick={() => setExpand(true)}>Show all {visible.length}</button> : null}
			{adding ? <div className='r' style={{ gap: 8, paddingTop: 8 }}>
				<input className='fld fl mo' autoFocus data-testid='vader-provider-add-input' aria-label='Model name' placeholder='Model Name' value={newName} onChange={e => { setNewName(e.target.value); setAddProblem(undefined) }} onKeyDown={e => { if (e.key === 'Enter') addModel(); if (e.key === 'Escape') setAdding(false) }} />
				<button className='pb' data-testid='vader-provider-add' disabled={!newName.trim()} onClick={addModel}>Add</button><button className='tx' onClick={() => { setAdding(false); setAddProblem(undefined) }}>Cancel</button>
			</div> : <button className='tx' style={{ alignSelf: 'flex-start', padding: 0, marginTop: 6 }} data-testid='vader-provider-add-open' onClick={() => setAdding(true)}>+ Add a model by name</button>}
			{addProblem ? <Note kind='warn' testId='vader-provider-add-problem'>{addProblem}</Note> : null}
		</div>
	</div>
}

export const ModelsPage = () => {
	const accessor = useAccessor()
	const settings = accessor.get('IVaderSettingsService')
	const refresh = accessor.get('IRefreshModelService')
	const state = useSettingsState()
	const cloud = useCloudModelListState()
	const local = useRefreshModelState()
	const g = state.globalSettings
	const [query, setQuery] = useState('')
	const [open, setOpen] = useState<string | undefined>()
	const [showAll, setShowAll] = useState(false)
	const [overrides, setOverrides] = useState<OverrideTarget | null>(null)
	const set = (k: any, v: any) => settings.setGlobalSetting(k, v)

	const has = (p: ProviderName) => !!(state.settingsOfProvider[p] as any)._didFillInProviderSettings
	const cloudAll = nonlocalProviderNames as ProviderName[]
	const searching = query.trim().length > 0
	const matched = searching ? filterProviders(cloudAll, query) : cloudAll
	const priority = (p: ProviderName) => { const i = (FIRST as readonly string[]).indexOf(p); return i < 0 ? 99 : i }
	const withKey = matched.filter(has).sort((a, b) => priority(a) - priority(b))
	const firstOnes = (FIRST as readonly string[]).map(x => matched.find(p => p === x)).filter((p): p is ProviderName => !!p && !has(p))
	const rest = matched.filter(p => !has(p) && !firstOnes.includes(p))
	const shown = searching || showAll ? [...withKey, ...firstOnes, ...rest] : [...withKey, ...firstOnes]
	const hidden = rest.length

	const keyEnding = (p: ProviderName) => { const k = (state.settingsOfProvider[p] as any).apiKey as string | undefined; return k && k.length > 4 ? `key ending ${k.slice(-4)}` : k ? 'key saved' : '' }
	const summary = (p: ProviderName) => {
		const n = (state.settingsOfProvider[p] as any).models.length
		return has(p) ? `${n} model${n === 1 ? '' : 's'}${keyEnding(p) ? ', ' + keyEnding(p) : ''}` : 'No key yet'
	}
	const stateOf = (p: ProviderName): { text: string, color: string, spin?: boolean } | undefined => {
		if (!has(p)) return undefined
		if (!isCloudListedProvider(p)) return undefined
		const s = (cloud as any)[p]
		if (!s) return undefined
		if (s.status === 'loading') return { text: 'Checking', color: 'var(--ac)', spin: true }
		if (s.status === 'ok') return { text: 'Live', color: '#4cc38a' }
		if (s.status === 'error') return { text: s.reason === 'unauthorized' ? 'Key refused' : 'Not answering', color: '#f06a6e' }
		return undefined
	}
	const localRow = (p: ProviderName) => {
		const of = state.settingsOfProvider[p] as any
		const n = of.models.length
		const st = (local as any)[p]?.state as string | undefined
		const running = n > 0 || st === 'finished'
		const where = of.endpoint || LOCAL_PORT[p]
		const detail = p === 'vLLM' && !of.endpoint ? 'Not set up. Give it the address of your server.' : running ? `${n} model${n === 1 ? '' : 's'}${where ? ', ' + String(where).replace(/^https?:\/\//, '') : ''}` : `Not found${where ? ' on ' + String(where).replace(/^https?:\/\//, '') : ''}. Start its local server, then look again.`
		return { running, detail, refreshing: st === 'refreshing' }
	}

	return <div data-testid='vader-settings-models'>
		<PageHead title='Models' desc='Where the models come from, and which one each feature uses. A provider with a key shows its live list of models in the chat. Nothing is written into the app in advance.' />

		<Group title='What each feature uses' first>
			<div data-testid='vader-models-features'>
				<div className='r' style={{ gap: 14, minHeight: 44, borderTop: '1px solid var(--ln)' }}><span className='t1 fl'>Chat</span>{g.externalAgentId ? <span className='t2' data-testid='vader-models-chat-agent'>A connected agent answers the chat</span> : <FeatureModelSelect feature='Chat' testId='vader-models-chat' />}</div>
				<div className='r' style={{ gap: 14, minHeight: 44, borderTop: '1px solid var(--ln)' }}><span className='c fl'><span className='t1'>Autocomplete</span><span className='hint'>suggestions while you type</span></span><FeatureModelSelect feature='Autocomplete' testId='vader-models-autocomplete' special={{ label: 'Off', active: !g.enableAutocomplete, onPick: () => set('enableAutocomplete', false) }} onModel={() => set('enableAutocomplete', true)} /></div>
				<div className='r' style={{ gap: 14, minHeight: 44, borderTop: '1px solid var(--ln)' }}><span className='c fl'><span className='t1'>Apply edits</span><span className='hint'>Ctrl K and the Apply button</span></span><FeatureModelSelect feature='Apply' testId='vader-models-apply' special={{ label: 'Same as chat', active: g.syncApplyToChat, onPick: () => set('syncApplyToChat', true) }} onModel={() => set('syncApplyToChat', false)} /></div>
				<div className='r' style={{ gap: 14, minHeight: 44, borderTop: '1px solid var(--ln)', borderBottom: '1px solid var(--ln)' }}><span className='c fl'><span className='t1'>Commit messages</span><span className='hint'>the button in Source Control</span></span><FeatureModelSelect feature='SCM' testId='vader-models-scm' special={{ label: 'Same as chat', active: g.syncSCMToChat, onPick: () => set('syncSCMToChat', true) }} onModel={() => set('syncSCMToChat', false)} /></div>
			</div>
		</Group>

		<Group title='On this computer' right={<span className='r' style={{ gap: 8 }}><span className='hint'>Look for local models automatically</span><Switch on={g.autoRefreshModels} label='Look for local models automatically' testId='vader-models-auto-local' onChange={v => set('autoRefreshModels', v)} /></span>}>
			{(localProviderNames as readonly ProviderName[]).map((p, i) => {
				const r = localRow(p)
				const isOpen = open === p
				return <div key={p} data-testid='vader-provider-row' data-provider={p} style={{ borderTop: i === 0 ? '1px solid var(--ln)' : undefined, borderBottom: '1px solid var(--ln)' }}>
					<div className='r' style={{ gap: 14, minHeight: 52, padding: '0 2px' }}>
						<button className='r fl' style={{ gap: 14, minWidth: 0, alignSelf: 'stretch' }} aria-expanded={isOpen} data-testid='vader-provider-toggle' onClick={() => setOpen(isOpen ? undefined : p)}>
							<span className='t3' style={{ width: 20 }}><ProviderLogo providerName={p} size={16} /></span><span className='t1' style={{ fontWeight: 600, width: 100 }}>{displayInfoOfProviderName(p).title}</span><span className='t2 fl tr' data-testid='vader-provider-summary'>{r.detail}</span>
						</button>
						<span className='r' style={{ gap: 7 }}>{r.refreshing ? <Spinner /> : <span className='dot' style={{ background: r.running ? '#4cc38a' : 'var(--t4)' }} />}<span className='t2'>{r.refreshing ? 'Looking' : r.running ? 'Running' : 'Not running'}</span></span>
						{p !== 'vLLM' ? <button className='gb' data-testid='vader-provider-look' disabled={r.refreshing} onClick={() => refresh.startRefreshingModels(p as any, { enableProviderOnSuccess: true, doNotFire: false })}>{r.running ? 'Refresh' : 'Look again'}</button> : <button className='gb' data-testid='vader-provider-set-address' onClick={() => setOpen(isOpen ? undefined : p)}>Set an address</button>}
					</div>
					{isOpen ? <ProviderBody p={p} onOverrides={setOverrides} /> : null}
				</div>
			})}
		</Group>

		<Group title='Cloud providers' right={<label className='srch' style={{ width: 240 }}><Icon k='search' small /><input data-testid='vader-models-search' className='fl' aria-label='Search providers' placeholder={`Search ${cloudAll.length} providers`} value={query} onChange={e => setQuery(e.target.value)} /></label>}>
			{shown.length === 0 ? <span className='t3' style={{ padding: '12px 2px', lineHeight: 1.55 }} data-testid='vader-models-nomatch'>No provider matches &ldquo;{query}&rdquo;. Any other OpenAI-compatible service can be added with the OpenAI-Compatible provider.</span> : null}
			{shown.map((p, i) => {
				const st = stateOf(p)
				const isOpen = open === p
				return <div key={p} data-testid='vader-provider-row' data-provider={p} data-has-key={has(p) ? 'true' : 'false'} style={{ borderTop: i === 0 ? '1px solid var(--ln)' : undefined, borderBottom: '1px solid var(--ln)' }}>
					<div className='r' style={{ gap: 14, minHeight: 46, padding: '0 2px' }}>
						<button className='r fl' style={{ gap: 14, minWidth: 0, alignSelf: 'stretch' }} aria-expanded={isOpen} data-testid='vader-provider-toggle' onClick={() => setOpen(isOpen ? undefined : p)}>
							<span className='t3' style={{ width: 20 }}><ProviderLogo providerName={p} size={16} /></span><span className='t1' style={{ fontWeight: 600, width: 130 }}>{displayInfoOfProviderName(p).title}</span><span className='t2 fl tr' data-testid='vader-provider-summary'>{summary(p)}</span>
						</button>
						{st ? <span className='r' style={{ gap: 7 }} data-testid='vader-provider-state'>{st.spin ? <Spinner /> : <span className='dot' style={{ background: st.color }} />}<span className='t2'>{st.text}</span></span> : null}
						{!has(p) ? <button className='gb' data-testid='vader-provider-add-key' onClick={() => setOpen(isOpen ? undefined : p)}>Add a key</button> : <button className='tx' aria-label={isOpen ? 'Close' : 'Open'} onClick={() => setOpen(isOpen ? undefined : p)}><Icon k={isOpen ? 'up' : 'down'} small /></button>}
					</div>
					{isOpen ? <ProviderBody p={p} onOverrides={setOverrides} /> : null}
				</div>
			})}
			{!searching && !showAll && hidden > 0 ? <div className='r' style={{ minHeight: 46, padding: '0 2px', borderBottom: '1px solid var(--ln)', gap: 12 }}><span className='t3 fl tr'>and {hidden} more: {rest.slice(0, 8).map(p => displayInfoOfProviderName(p).title).join(', ')}...</span><button className='tx' data-testid='vader-models-show-all' onClick={() => setShowAll(true)}>Show all</button></div> : null}
		</Group>
		{overrides ? <ModelOverridesDialog target={overrides} onClose={() => setOverrides(null)} /> : null}
	</div>
}
