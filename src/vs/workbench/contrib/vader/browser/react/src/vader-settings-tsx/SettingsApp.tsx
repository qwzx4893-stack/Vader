/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react'
import { useAccessor } from '../util/services.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import { VADER_TOGGLE_SETTINGS_ACTION_ID } from '../../../actionIDs.js'
import { Icon } from '../vader-shell-tsx/icons.js'
import { PermissionsPage } from './PermissionsPage.js'
import { UsagePage } from './UsagePage.js'
import { SavedAgentsPage } from './SavedAgentsPage.js'
import { EditorPage } from './EditorPage.js'
import { PrivacyPage } from './PrivacyPage.js'
import { ExtensionsPage } from './ExtensionsPage.js'
import { AboutPage } from './AboutPage.js'
import { DataPage } from './DataPage.js'
import { ModelsPage } from './ModelsPage.js'
import { ConnectedAgentsPage } from './ConnectedAgentsPage.js'
import { SkillsPage } from './SkillsPage.js'
import { McpPage } from './McpPage.js'
import { MemoryPage } from './MemoryPage.js'
import { LanguagePage } from './LanguagePage.js'
import { matchPages, nearestPages } from '../../../../common/settingsSearch.js'
import '../vader-shell-tsx/shell.css'
import { WindowStrip } from '../vader-shell-tsx/WindowStrip.js'
import { projectNameOf } from '../../../../common/threadProjects.js'

// Vader's Settings in the shape of the interface boards (R08 to R30): a column on the left with a way back to the app, a search, and the pages in three groups
// (Models, Agent, Workspace); the page on the right. Opening Settings from elsewhere can name the page (the event below), and the search filters the pages.

export type SettingsPage = 'models' | 'agents' | 'permissions' | 'usage' | 'saved' | 'skills' | 'mcp' | 'memory' | 'extensions' | 'editor' | 'privacy' | 'language' | 'data' | 'about'

const GROUPS: { title: string, items: { id: SettingsPage, label: string, words: string }[] }[] = [
	{ title: 'Models', items: [
		{ id: 'models', label: 'Models', words: 'model provider key api openai anthropic gemini openrouter ollama lm studio local autocomplete apply commit endpoint' },
		{ id: 'agents', label: 'Connected agents', words: 'coding agent codex copilot cursor opencode claude acp terminal' },
	] },
	{ title: 'Agent', items: [
		{ id: 'permissions', label: 'Permissions', words: 'approve permission safe balanced autonomous ask rules locked allow project' },
		{ id: 'usage', label: 'Usage and cost', words: 'usage cost spend limit budget tokens price estimate billed daily' },
		{ id: 'saved', label: 'Saved agents', words: 'saved permanent agent instructions helper reviewer' },
		{ id: 'skills', label: 'Skills', words: 'skill store install trust sources github skillnet' },
		{ id: 'mcp', label: 'MCP servers', words: 'mcp server tools registry' },
		{ id: 'memory', label: 'Memory and instructions', words: 'memory instructions rules agents.md vaderrules system message' },
	] },
	{ title: 'Workspace', items: [
		{ id: 'extensions', label: 'Editor extensions', words: 'extension marketplace open vsx vsix' },
		{ id: 'editor', label: 'Editor', words: 'autocomplete editor quick edit apply fast suggestions commit message' },
		{ id: 'privacy', label: 'Privacy and network', words: 'privacy network telemetry contact proxy' },
		{ id: 'language', label: 'Language', words: 'language arabic english chinese translate right to left rtl العربية 中文' },
		{ id: 'data', label: 'Data and backup', words: 'export import backup chats switch editor reset logs' },
		{ id: 'about', label: 'About and updates', words: 'update version release licence credits onboarding' },
	] },
]

// the width of the column of each page, as the boards draw it (R08 to R30): most are 820; Models 780, Connected agents 800, Usage and MCP 860; the pages that are two columns
// (Saved agents, Skills, Memory) use the whole width, left-aligned, with 40 at each side
const PAGE_WIDTH: Partial<Record<SettingsPage, number>> = { models: 780, agents: 800, usage: 860, mcp: 860 }
const WIDE_PAGES = new Set<SettingsPage>(['saved', 'skills', 'memory'])

export const OPEN_SETTINGS_PAGE_EVENT = 'vader-settings-goto'

export const Settings = () => {
	const accessor = useAccessor()
	const commands = accessor.get('ICommandService')
	const [page, setPage] = useState<SettingsPage>('models')
	const [query, setQuery] = useState('')
	const needle = query.trim().toLowerCase()
	const allPages = GROUPS.flatMap(g => g.items.map(it => ({ id: it.id, label: it.label, words: it.words, group: g.title })))
	const found = new Set(matchPages(allPages, query).map(p => p.id))
	const groups = needle ? GROUPS.map(g => ({ ...g, items: g.items.filter(it => found.has(it.id)) })).filter(g => g.items.length > 0) : GROUPS
	const nearest = needle && groups.length === 0 ? nearestPages(allPages, query) : []

	useEffect(() => {
		// the page asked for before this one was drawn (the first time Settings opens) is waiting on the window
		const w = window as unknown as { vaderSettingsPendingPage?: string }
		const go = (p: string | undefined) => { if (GROUPS.some(g => g.items.some(i => i.id === p))) setPage(p as SettingsPage); w.vaderSettingsPendingPage = undefined }
		go(w.vaderSettingsPendingPage)
		const on = (e: Event) => go((e as CustomEvent<{ page?: string }>).detail?.page)
		window.addEventListener(OPEN_SETTINGS_PAGE_EVENT, on)
		return () => window.removeEventListener(OPEN_SETTINGS_PAGE_EVENT, on)
	}, [])

	const body = (() => {
		if (page === 'permissions') return <PermissionsPage goto={setPage} />
		if (page === 'usage') return <UsagePage />
		if (page === 'saved') return <SavedAgentsPage />
		if (page === 'editor') return <EditorPage />
		if (page === 'privacy') return <PrivacyPage />
		if (page === 'extensions') return <ExtensionsPage />
		if (page === 'about') return <AboutPage />
		if (page === 'data') return <DataPage />
		if (page === 'language') return <LanguagePage />
		if (page === 'models') return <ModelsPage />
		if (page === 'agents') return <ConnectedAgentsPage />
		if (page === 'skills') return <SkillsPage />
		if (page === 'mcp') return <McpPage />
		return <MemoryPage />
	})()

	const projectKey = accessor.get('IChatThreadService').getCurrentProjectKey()
	return <div className='shell' data-testid='vader-settings-page'>
		<WindowStrip title={<>{projectKey ? <><span>{projectNameOf(projectKey)}</span><span className='t3' style={{ padding: '0 8px' }}>/</span></> : null}<span className='t1'>Settings</span></>} />
		<div className='r fl' style={{ alignItems: 'stretch', minHeight: 0 }}>
		<aside className='c' style={{ width: 248, flex: 'none', padding: '6px 8px', minHeight: 0 }}>
			<button className='nv' data-testid='vader-settings-close' onClick={() => { void commands.executeCommand(VADER_TOGGLE_SETTINGS_ACTION_ID) }} ><Icon k='left' small />Back to the app</button>
			<label className='srch' style={{ margin: '6px 2px 4px', height: 30 }}><Icon k='search' small /><input data-testid='vader-settings-search' className='fl' placeholder='Search settings' aria-label='Search settings' value={query} onChange={e => setQuery(e.target.value)} /></label>
			<nav className='c fl scroll' aria-label='Settings pages'>
				{needle && groups.length === 0 ? <span className='t3' style={{ padding: '8px 10px', lineHeight: 1.5 }} data-testid='vader-settings-nomatch'>No setting called &ldquo;{query.trim()}&rdquo;.</span> : null}
				{nearest.length > 0 ? <div className='c' data-testid='vader-settings-nearest' style={{ gap: 2 }}>
					<span className='nvh'>Nearest places</span>
					{nearest.map(p => <button key={p.id} className='nv' data-testid='vader-settings-nearest-page' onClick={() => { setQuery(''); setPage(p.id as SettingsPage) }}><span className='fl tr' style={{ textAlign: 'left' }}>{p.label}</span><span className='t4' style={{ fontSize: 12 }}>{p.group}</span></button>)}
				</div> : null}
				{groups.map(g => <React.Fragment key={g.title}>
					<span className='nvh'>{g.title}</span>
					{g.items.map(it => <button key={it.id} className={page === it.id ? 'nv on' : 'nv'} data-testid={`vader-settings-nav-${it.id}`} aria-current={page === it.id ? 'page' : undefined} onClick={() => setPage(it.id)}>{it.label}</button>)}
				</React.Fragment>)}
			</nav>
		</aside>
		<main className='main-sheet fl scroll' data-testid={`vader-settings-main-${page}`} style={{ minHeight: 0, overflowY: 'auto' }}>
			<div style={WIDE_PAGES.has(page) ? { padding: '26px 40px 96px', width: '100%' } : { maxWidth: (PAGE_WIDTH[page] ?? 820) + 48, margin: '0 auto', padding: '30px 24px 96px', width: '100%' }}>
				<div key={page} className='pg'><ErrorBoundary>{body}</ErrorBoundary></div>
			</div>
		</main>
		</div>
	</div>
}
