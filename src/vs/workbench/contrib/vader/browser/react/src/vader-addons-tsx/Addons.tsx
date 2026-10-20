/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useState } from 'react'
import { Search } from 'lucide-react'
import { AddonsMark, SettingsMark } from './marks.js'
import '../styles.css'
import '../vader-shell-tsx/shell.css'
import { useAccessor, useIsDark } from '../util/services.js'
import type { MarketplaceItemType } from '../../../../common/marketplace/marketplaceTypes.js'
import { StoreView } from '../vader-marketplace-tsx/Store.js'
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

export const Addons = () => {
	const isDark = useIsDark()
	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')
	const [tab, setTab] = useState<Tab>('all')
	const [query, setQuery] = useState('')
	const [installedOnly, setInstalledOnly] = useState(false)
	const [category, setCategory] = useState<string | null>(null)
	const [pageOpen, setPageOpen] = useState(false)
	const kindOfTab: CategoryKind | undefined = tab === 'skills' ? 'skill' : tab === 'mcp' ? 'mcp' : tab === 'extensions' ? 'extension' : undefined
	const sections = kindOfTab ? CATEGORIES[kindOfTab] : []

	// the page's own pages (a skill, a server) are written with the editor-wide utility classes, which only apply inside the Vader scope; it adds no box of its own
	return <div className={`@@vader-scope ${isDark ? 'dark' : ''}`} style={{ display: 'contents' }}><div className='shell addons-shell' data-testid='vader-addons-page'>
		<div className='c fl' style={{ minHeight: 0, minWidth: 0 }}>
			<div className='c' style={{ padding: '22px 32px 0', flex: 'none', gap: 14, ...(pageOpen ? { display: 'none' } : {}) }}>
				<div className='r' style={{ gap: 12 }}>
					<span className='ttl'>Add-ons</span><span className='t3' style={{ marginLeft: 6 }}>Skills, MCP servers, extensions and agents</span><span className='fl' />
					<button className='gb' style={{ height: 30, ...(installedOnly ? { background: 'var(--g3)' } : {}) }} data-testid='vader-addons-installed' aria-pressed={installedOnly} onClick={() => setInstalledOnly(v => !v)}>Installed</button>
					<button className='ic' title='Settings: where add-ons come from, and the ones you have' aria-label='Open Settings' onClick={() => commandService.executeCommand(VADER_OPEN_SETTINGS_ACTION_ID)}><SettingsMark size={15} strokeWidth={1.4} /></button>
				</div>
				<div className='r' style={{ gap: 12 }}>
					<label className='srch' style={{ width: 540, height: 34 }}>
						<Search className='w-4 h-4' style={{ width: 15, height: 15, flex: 'none' }} />
						<input data-testid='vader-addons-search' className='fl' placeholder={PLACEHOLDER[tab]} aria-label={PLACEHOLDER[tab]} value={query} onChange={e => setQuery(e.target.value)} />
					</label>
					<span className='fl' />
					<span className='r hint narrow-hide' style={{ gap: 14 }}>
						<span className='r' style={{ gap: 6 }}><span className='dot' style={{ background: '#4cc38a' }} />80 to 100 high trust</span>
						<span className='r' style={{ gap: 6 }}><span className='dot' style={{ background: '#e2a93f' }} />50 to 79 read first</span>
						<span className='r' style={{ gap: 6 }}><span className='dot' style={{ background: '#f06a6e' }} />under 50 risky</span>
					</span>
				</div>
				<div className='r' style={{ borderBottom: '1px solid var(--ln)' }} role='tablist'>
					{TABS.map(t => <button key={t.id} role='tab' aria-selected={tab === t.id} data-testid={`vader-addons-tab-${t.id}`} className={tab === t.id ? 'tb on' : 'tb'} onClick={() => { setTab(t.id); setCategory(null) }}>{t.label}</button>)}
					<span className='fl' />
				</div>
			</div>
			{sections.length > 0 && !pageOpen ? <div className='r' style={{ flexWrap: 'wrap', gap: 8, padding: '12px 32px 0', flex: 'none' }} data-testid='vader-addons-sections'>
				<button className={category === null ? 'gb' : 'tx'} style={category === null ? { background: 'var(--g3)' } : { border: '1px solid var(--ln)' }} onClick={() => setCategory(null)}>All</button>
				{sections.map(c => <button key={c.id} data-testid={`vader-addons-section-${c.id}`} className={category === c.id ? 'gb' : 'tx'} style={category === c.id ? { background: 'var(--g3)' } : { border: '1px solid var(--ln)' }} onClick={() => setCategory(c.id)}>{c.label}</button>)}
			</div> : null}
			<div className='c fl' style={{ padding: pageOpen ? '20px 32px 0' : '8px 32px 0', minHeight: 0 }}>
				<StoreView
					key={`${tab}:${category ?? ''}`}
					category={category ?? undefined}
					onPageChange={setPageOpen}
					types={TAB_TYPES[tab]}
					query={query}
					includeExtensions
					installedOnly={installedOnly}
					grouped={tab === 'all'}
					onSeeAll={t => { const next = TAB_OF_TYPE[t]; if (next) setTab(next) }}
				/>
			</div>
		</div>
	</div></div>
}
