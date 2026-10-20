/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { AddonsMark, SettingsMark } from './marks.js'
import '../styles.css'
import '../vader-shell-tsx/shell.css'
import { useAccessor, useIsDark } from '../util/services.js'
import type { MarketplaceItem, MarketplaceItemType } from '../../../../common/marketplace/marketplaceTypes.js'
import { Icon } from '../vader-shell-tsx/icons.js'
import { InstalledPage } from './InstalledPage.js'
import { StoreSort, StoreView } from '../vader-marketplace-tsx/Store.js'
import { VADER_OPEN_SETTINGS_ACTION_ID } from '../../../actionIDs.js'
import { CATEGORIES, CategoryKind } from '../../../../common/marketplace/categories.js'

// The page behind "Add-ons" in the title bar of the chat: where a person finds skills, MCP servers, editor extensions and agents.
// It is reached from the main interface, not from Settings. What is already installed is managed where it always was (the Skills and MCP
// pages in Settings list and switch the ones this computer has); this page is for finding and adding.
// Layout: one search box, a tab per kind, rows two to a line with a round install button, and the details of the chosen row on the right.

type Tab = 'all' | 'skills' | 'mcp' | 'extensions' | 'agents'

const TAB_TYPES: Record<Tab, MarketplaceItemType[]> = {
	all: ['SKILL', 'MCP_SERVER', 'EXTENSION', 'LANGUAGE_SERVER', 'DEBUG_ADAPTER', 'FORMATTER', 'TREE_SITTER_GRAMMAR', 'JUPYTER_KERNEL', 'ACP_AGENT'],
	skills: ['SKILL'],
	mcp: ['MCP_SERVER'],
	extensions: ['EXTENSION', 'LANGUAGE_SERVER', 'DEBUG_ADAPTER', 'FORMATTER', 'TREE_SITTER_GRAMMAR', 'JUPYTER_KERNEL'],
	agents: ['ACP_AGENT'],
}
const TABS: { id: Tab, label: string }[] = [{ id: 'all', label: 'All' }, { id: 'skills', label: 'Skills' }, { id: 'mcp', label: 'MCP servers' }, { id: 'extensions', label: 'Extensions' }, { id: 'agents', label: 'Agents' }]
const TAB_OF_TYPE: Partial<Record<MarketplaceItemType, Tab>> = { SKILL: 'skills', MCP_SERVER: 'mcp', EXTENSION: 'extensions', ACP_AGENT: 'agents' }
const PLACEHOLDER: Record<Tab, string> = {
	all: 'Search skills, MCP servers, extensions and agents', skills: 'Search skills', mcp: 'Search the official MCP Registry', extensions: 'Search extensions on Open VSX', agents: 'Search agents',
}

// The drop-downs beside the search box (boards A02 to A05): what a tab can be narrowed by differs, and only what the loaded items really have is offered
type Choice = { id: string, label: string }
type Narrow = { name: string, options: Choice[], accept: (item: MarketplaceItem, id: string) => boolean }
const SORTS: Record<'trusted' | 'name' | 'installs', Choice> = { trusted: { id: 'trusted', label: 'most trusted' }, name: { id: 'name', label: 'name, A to Z' }, installs: { id: 'installs', label: 'most installed' } }
const SORT_OF_TAB: Partial<Record<Tab, StoreSort[]>> = { skills: ['trusted', 'name'], mcp: ['trusted', 'name'], extensions: ['installs', 'trusted', 'name'] }
const Note = ({ children }: { children: React.ReactNode }) => <div className='r hint' style={{ gap: 8, alignItems: 'flex-start', lineHeight: 1.5 }} data-testid='vader-addons-note'><span style={{ display: 'flex', paddingTop: 2 }}><Icon k='info' small /></span><span>{children}</span></div>
const runsOf = (i: MarketplaceItem): string => { const t = (i.metadata.setup as { transport?: string } | undefined)?.transport; return t === 'remote' || t === 'hosted' ? 'hosted' : t === 'local' || t === 'docker' ? 'local' : 'unknown' }
const sourcesOf = (i: MarketplaceItem): string[] => (i.source || '').split(' · ').map(x => x.trim()).filter(Boolean).map(x => x.startsWith('GitHub topic') ? 'GitHub topic' : x.startsWith('GitHub:') ? 'GitHub' : x)

/** a closed box with "Name: value" that opens a short list under it; Escape or a click elsewhere closes it */
const Pick = ({ name, value, options, onChange, width, testId }: { name: string, value: string, options: Choice[], onChange: (id: string) => void, width: number, testId: string }) => {
	const [open, setOpen] = useState(false)
	const ref = useRef<HTMLSpanElement>(null)
	useEffect(() => {
		if (!open) return
		const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
		const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
		document.addEventListener('mousedown', away); document.addEventListener('keydown', esc)
		return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
	}, [open])
	const current = options.find(o => o.id === value) ?? options[0]
	return <span ref={ref} style={{ position: 'relative', display: 'flex', width, flex: 'none' }}>
		<button className='fld' style={{ width: '100%', gap: 8 }} aria-haspopup='listbox' aria-expanded={open} data-testid={testId} onClick={() => setOpen(v => !v)}>
			<span className='fl tr'>{name}: {current?.label}</span><ChevronDown className='t3' style={{ width: 14, height: 14, flex: 'none' }} />
		</button>
		{open ? <div className='menu' role='listbox' data-testid={`${testId}-menu`}>
			{options.map(o => <button key={o.id} role='option' aria-checked={o.id === value} aria-selected={o.id === value} data-testid={`${testId}-${o.id}`} onClick={() => { onChange(o.id); setOpen(false) }}>
				<span style={{ width: 14, display: 'flex' }}>{o.id === value ? <Check style={{ width: 13, height: 13 }} /> : null}</span>{o.label}
			</button>)}
		</div> : null}
	</span>
}

export const Addons = () => {
	const isDark = useIsDark()
	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')
	const [tab, setTab] = useState<Tab>('all')
	const [query, setQuery] = useState('')
	const [installedOpen, setInstalledOpen] = useState(false)
	const [category, setCategory] = useState<string | null>(null)
	const [pageOpen, setPageOpen] = useState(false)
	const [loaded, setLoaded] = useState<MarketplaceItem[]>([])
	const [narrowId, setNarrowId] = useState('all')
	const [sort, setSort] = useState<StoreSort>('trusted')
	const kindOfTab: CategoryKind | undefined = tab === 'skills' ? 'skill' : tab === 'mcp' ? 'mcp' : tab === 'extensions' ? 'extension' : undefined
	const sections = kindOfTab ? CATEGORIES[kindOfTab] : []
	const narrow = useMemo<Narrow | null>(() => {
		const any = (label: string): Choice => ({ id: 'all', label })
		if (tab === 'skills') return { name: 'Source', options: [any('all'), ...[...new Set(loaded.flatMap(sourcesOf))].sort().map(n => ({ id: n, label: n }))], accept: (i, id) => sourcesOf(i).includes(id) }
		if (tab === 'mcp') return { name: 'Runs', options: [any('anywhere'), { id: 'local', label: 'on this computer' }, { id: 'hosted', label: 'hosted' }], accept: (i, id) => runsOf(i) === id }
		if (tab === 'extensions') return { name: 'Category', options: [any('all'), ...sections.map(c => ({ id: c.id, label: c.label }))], accept: () => true }
		if (tab === 'agents') return { name: 'Needs', options: [any('any'), { id: 'sign-in', label: 'a vendor sign-in' }, { id: 'terminal', label: 'a terminal' }], accept: (i, id) => (i.metadata.kind === 'terminal') === (id === 'terminal') }
		return null
	}, [tab, loaded, sections])
	const accept = useMemo(() => narrow && narrowId !== 'all' && tab !== 'extensions' ? (i: MarketplaceItem) => narrow.accept(i, narrowId) : undefined, [narrow, narrowId, tab])
	const sorts = SORT_OF_TAB[tab]
	const onLoaded = useCallback((items: MarketplaceItem[]) => setLoaded(items), [])
	const openTab = (t: Tab) => { setTab(t); setCategory(null); setNarrowId('all'); setSort(SORT_OF_TAB[t]?.[0] ?? 'trusted'); setLoaded([]) }
	const legend = <span className='r hint narrow-hide' style={{ gap: 14, marginLeft: 'auto' }}>
		<span className='r' style={{ gap: 6 }}><span className='dot' style={{ background: '#4cc38a' }} />80 to 100 high trust</span>
		<span className='r' style={{ gap: 6 }}><span className='dot' style={{ background: '#e2a93f' }} />50 to 79 read first</span>
		<span className='r' style={{ gap: 6 }}><span className='dot' style={{ background: '#f06a6e' }} />under 50 risky</span>
	</span>

	// the page's own pages (a skill, a server) are written with the editor-wide utility classes, which only apply inside the Vader scope; it adds no box of its own
	return <div className={`@@vader-scope ${isDark ? 'dark' : ''}`} style={{ display: 'contents' }}><div className='shell addons-shell' data-testid='vader-addons-page'>
		{installedOpen ? <InstalledPage onBack={() => setInstalledOpen(false)} /> : <div className='c fl' style={{ minHeight: 0, minWidth: 0 }}>
			<div className='c' style={{ padding: '22px 32px 0', flex: 'none', gap: 14, ...(pageOpen ? { display: 'none' } : {}) }}>
				<div className='r' style={{ gap: 12 }}>
					<span className='ttl'>Add-ons</span><span className='t3' style={{ marginLeft: 6 }}>Skills, MCP servers, extensions and agents</span><span className='fl' />
					<button className='gb' style={{ height: 30 }} data-testid='vader-addons-installed' onClick={() => setInstalledOpen(true)}>Installed</button>
					<button className='ic' title='Settings: where add-ons come from, and the ones you have' aria-label='Open Settings' onClick={() => commandService.executeCommand(VADER_OPEN_SETTINGS_ACTION_ID)}><SettingsMark size={15} strokeWidth={1.4} /></button>
				</div>
				<div className='r' style={{ gap: 12 }}>
					<label className='srch' style={{ width: 540, height: 34 }}>
						<Search className='w-4 h-4' style={{ width: 15, height: 15, flex: 'none' }} />
						<input data-testid='vader-addons-search' className='fl' placeholder={PLACEHOLDER[tab]} aria-label={PLACEHOLDER[tab]} value={query} onChange={e => setQuery(e.target.value)} />
					</label>
					<span className='fl' />
					{narrow ? <Pick testId='vader-addons-narrow' name={narrow.name} width={tab === 'mcp' ? 200 : 170} value={tab === 'extensions' ? (category ?? 'all') : narrowId} options={narrow.options} onChange={id => tab === 'extensions' ? setCategory(id === 'all' ? null : id) : setNarrowId(id)} /> : null}
					{sorts ? <Pick testId='vader-addons-sort' name='Sort' width={tab === 'extensions' ? 200 : 190} value={sort} options={sorts.map(k => SORTS[k])} onChange={id => setSort(id as StoreSort)} /> : null}
					{tab === 'all' ? legend : null}
				</div>
				<div className='r' style={{ borderBottom: '1px solid var(--ln)' }} role='tablist'>
					{TABS.map(t => <button key={t.id} role='tab' aria-selected={tab === t.id} data-testid={`vader-addons-tab-${t.id}`} className={tab === t.id ? 'tb on' : 'tb'} onClick={() => openTab(t.id)}>{t.label}</button>)}
					<span className='fl' />
				</div>
			</div>
			{sections.length > 0 && !pageOpen ? <div className='r' style={{ flexWrap: 'wrap', gap: 8, padding: '12px 32px 0', flex: 'none' }} data-testid='vader-addons-sections'>
				{[{ id: null as string | null, label: 'All' }, ...sections].map(c => <button key={c.id ?? 'all'} data-testid={c.id ? `vader-addons-section-${c.id}` : undefined} aria-pressed={category === c.id} style={{ height: 26, padding: '0 11px', borderRadius: 13, whiteSpace: 'nowrap', border: `1px solid ${category === c.id ? 'var(--ln2)' : 'var(--ln)'}`, background: category === c.id ? 'var(--g3)' : 'transparent', color: category === c.id ? 'var(--t1)' : 'var(--t2)' }} onClick={() => setCategory(c.id)}>{c.label}</button>)}
				{legend}
			</div> : null}
			<div className='c fl' style={{ padding: pageOpen ? '20px 32px 0' : '8px 32px 0', minHeight: 0 }}>
				<StoreView
					key={`${tab}:${category ?? ''}`}
					category={category ?? undefined}
					onPageChange={setPageOpen}
					types={TAB_TYPES[tab]}
					query={query}
					includeExtensions
										accept={accept}
					sort={sort}
					onLoaded={onLoaded}
					before={tab === 'agents' ? <Note>An agent you connect runs with your own account for it. Its usage and cost are not counted by Vader; they appear in that product’s own usage page.</Note> : undefined}
					after={tab === 'mcp' ? <Note>A server runs on your computer or talks to a service. Adding one asks you first, and its tools go through the safety gate like any other.</Note> : undefined}
					grouped={tab === 'all'}
					onSeeAll={t => { const next = TAB_OF_TYPE[t]; if (next) openTab(next) }}
				/>
			</div>
		</div>}
	</div></div>
}
