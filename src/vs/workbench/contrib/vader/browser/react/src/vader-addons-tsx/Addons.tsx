/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useState } from 'react'
import { Search } from 'lucide-react'
import { AddonsMark, SettingsMark } from './marks.js'
import '../styles.css'
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

	return <div className={`@@vader-scope ${isDark ? 'dark' : ''}`} style={{ height: '100%', width: '100%', display: 'flex' }} data-testid='vader-addons-page'>
		<div className='flex flex-col w-full h-full bg-vader-bg-1 text-vader-fg-1 text-root min-w-0'>
			<div className={`flex flex-col gap-3 px-8 pt-6 shrink-0 ${pageOpen ? 'hidden' : ''}`}>
				<div className='flex items-center gap-3'>
					<AddonsMark size={22} strokeWidth={1.5} className='text-vader-fg-2' />
					<h2 className='text-2xl font-semibold'>Add-ons</h2>
					<span className='text-vader-fg-3'>Skills, MCP servers, extensions and agents</span>
					<span className='flex-1' />
					<button
						data-testid='vader-addons-installed'
						className={`px-3 py-1 rounded-md border ${installedOnly ? 'border-vader-border-1 bg-vader-bg-3 text-vader-fg-1' : 'border-vader-border-2 text-vader-fg-2'}`}
						aria-pressed={installedOnly}
						onClick={() => setInstalledOnly(v => !v)}
					>Installed</button>
					<button className='p-1.5 rounded-md text-vader-fg-3 hover:text-vader-fg-1' title='Settings: where add-ons come from, and the ones you have' aria-label='Open Settings' onClick={() => commandService.executeCommand(VADER_OPEN_SETTINGS_ACTION_ID)}><SettingsMark size={16} /></button>
				</div>
				<label className='flex items-center gap-2 px-3 py-2 rounded-lg border border-vader-border-2 bg-vader-bg-2 max-w-[560px]'>
					<Search className='w-4 h-4 text-vader-fg-3' />
					<input data-testid='vader-addons-search' className='flex-1 bg-transparent outline-none text-vader-fg-1' placeholder={PLACEHOLDER[tab]} value={query} onChange={e => setQuery(e.target.value)} />
				</label>
				<div className='flex items-end justify-between border-b border-vader-border-3'>
					<div className='flex' role='tablist'>
						{TABS.map(t => <button key={t.id} role='tab' aria-selected={tab === t.id} data-testid={`vader-addons-tab-${t.id}`} className={`px-1 py-2 mr-5 border-b ${tab === t.id ? 'border-vader-fg-1 text-vader-fg-1' : 'border-transparent text-vader-fg-3'}`} onClick={() => { setTab(t.id); setCategory(null) }}>{t.label}</button>)}
					</div>
					<div className='pb-2 flex items-center gap-4 text-vader-fg-3 text-sm'>
						<span className='flex items-center gap-1.5'><span className='w-2 h-2 rounded-full bg-green-500' />80 to 100 high trust</span>
						<span className='flex items-center gap-1.5'><span className='w-2 h-2 rounded-full bg-yellow-500' />50 to 79 read first</span>
						<span className='flex items-center gap-1.5'><span className='w-2 h-2 rounded-full bg-red-500' />under 50 risky</span>
					</div>
				</div>
			</div>
			{sections.length > 0 && !pageOpen ? <div className='flex flex-wrap gap-2 px-8 pt-3 shrink-0' data-testid='vader-addons-sections'>
				<button className={`px-3 py-1 rounded-full border text-sm ${category === null ? 'border-vader-border-1 bg-vader-bg-3 text-vader-fg-1' : 'border-vader-border-3 text-vader-fg-2'}`} onClick={() => setCategory(null)}>All</button>
				{sections.map(c => <button key={c.id} data-testid={`vader-addons-section-${c.id}`} className={`px-3 py-1 rounded-full border text-sm ${category === c.id ? 'border-vader-border-1 bg-vader-bg-3 text-vader-fg-1' : 'border-vader-border-3 text-vader-fg-2'}`} onClick={() => setCategory(c.id)}>{c.label}</button>)}
			</div> : null}
			<div className='flex flex-1 min-h-0 px-8 pt-3 pb-4'>
				<StoreView
					key={`${tab}:${category ?? ''}`}
					category={category ?? undefined}
					onPageChange={setPageOpen}
					types={TAB_TYPES[tab]}
					layout='rows'
					query={query}
					includeExtensions
					installedOnly={installedOnly}
					grouped={tab === 'all'}
					onSeeAll={t => { const next = TAB_OF_TYPE[t]; if (next) setTab(next) }}
				/>
			</div>
		</div>
	</div>
}
