/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Check, FileText, Loader2, Plug, Puzzle, Search, Wrench } from 'lucide-react'
import { useAccessor, useSkillsState } from '../util/services.js'
import type { MarketplaceItem, MarketplaceItemType } from '../../../../common/marketplace/marketplaceTypes.js'
import { trustLevelOf, TrustScore } from '../../../../common/marketplace/trustScore.js'

// The store a person browses: wide cards with an icon, a name, what it is, where it comes from, how big it is and a trust score, and
// a detail pane that says why the score is what it is before anything is installed. One component serves the skills page and the
// MCP page in Settings (wide layout, with a source rail and a detail pane) and the narrow pane in the Extensions view.
// The data comes from IUnifiedMarketplaceService; nothing here talks to a network.

const TYPE_NOUN: Record<MarketplaceItemType, string> = {
	EXTENSION: 'Extension', SKILL: 'Skill', MCP_SERVER: 'MCP server', ACP_AGENT: 'Agent', LANGUAGE_SERVER: 'Language server',
	DEBUG_ADAPTER: 'Debugger', TREE_SITTER_GRAMMAR: 'Grammar', FORMATTER: 'Formatter', JUPYTER_KERNEL: 'Jupyter kernel',
}

const ACTION_LABEL: Record<string, string> = {
	install: 'Install', update: 'Update', uninstall: 'Uninstall', enable: 'Enable', disable: 'Disable',
	configure: 'Add', connect: 'Connect', add: 'Add', download: 'Download', use_local: 'Use', review_and_install: 'Install',
}

export function formatBytes(n: number | undefined): string {
	if (n === undefined) return ''
	if (n < 1024) return `${n} B`
	if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
	return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const LEVEL_WORD = { high: 'High trust', medium: 'Read first', low: 'Risky' } as const

// The colours are written inline in each className on purpose: the build that scopes Tailwind to Vader's own UI rewrites class names
// it finds inside className attributes, not ones kept in a constant, and a rewritten name is the one the stylesheet defines.
export const TrustMeter = ({ score, large }: { score: TrustScore, large?: boolean }) => {
	const level = trustLevelOf(score.score)
	return <div className={`flex flex-col items-end gap-1 shrink-0 ${large ? 'w-24' : 'w-20'}`} title={`${LEVEL_WORD[level]}: ${score.score} out of 100`} aria-label={`Trust ${score.score} percent, ${LEVEL_WORD[level]}`}>
		<span className={`font-semibold tabular-nums leading-none ${level === 'high' ? 'text-green-500' : level === 'medium' ? 'text-yellow-500' : 'text-red-500'} ${large ? 'text-3xl' : 'text-root'}`}>{score.score}%</span>
		<div className={`rounded-full bg-black/10 dark:bg-white/10 overflow-hidden ${large ? 'h-1.5 w-16' : 'h-1 w-12'}`}>
			<div className={`h-full rounded-full ${level === 'high' ? 'bg-green-500' : level === 'medium' ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${score.score}%` }} />
		</div>
		<span className={`text-xs leading-none whitespace-nowrap ${level === 'high' ? 'text-green-500' : level === 'medium' ? 'text-yellow-500' : 'text-red-500'}`}>{LEVEL_WORD[level]}</span>
	</div>
}

const TypeIcon = ({ type }: { type: MarketplaceItemType }) => {
	const cls = 'w-5 h-5 text-vader-fg-3'
	return type === 'SKILL' ? <FileText className={cls} />
		: type === 'MCP_SERVER' ? <Plug className={cls} />
			: type === 'ACP_AGENT' ? <Bot className={cls} />
				: type === 'EXTENSION' ? <Puzzle className={cls} />
					: <Wrench className={cls} />
}

type Sort = 'trust' | 'name'

/** the items of a kind, found by browsing when the search box is empty and by searching when it is not; refreshed when skills or their sources change */
function useStoreItems(types: MarketplaceItemType[], query: string, includeExtensions?: boolean) {
	const accessor = useAccessor()
	const marketplace = accessor.get('IUnifiedMarketplaceService')
	const skills = useSkillsState()
	const [items, setItems] = useState<MarketplaceItem[]>([])
	const [loading, setLoading] = useState(true)
	const [failed, setFailed] = useState<string[]>([])
	const generation = useRef(0)
	const typeKey = types.join(',')
	const skillsKey = skills.map(s => `${s.id}:${s.enabled}:${s.trustState}`).join('|')

	const load = useCallback(async () => {
		const g = ++generation.current
		setLoading(true)
		try {
			const opts = { types: typeKey.split(',') as MarketplaceItemType[] }
			const res = query.trim() ? await marketplace.search(query.trim(), opts) : await marketplace.browse(opts)
			if (g !== generation.current) return
			setItems(res.items.filter(i => includeExtensions || i.type !== 'EXTENSION'))
			setFailed(res.providerOutcomes.flatMap(o => [...(o.error ? [`${o.providerId}: ${o.error}`] : []), ...(o.warnings ?? [])]))
		} finally {
			if (g === generation.current) setLoading(false)
		}
	}, [marketplace, typeKey, query, includeExtensions])

	useEffect(() => {
		const t = setTimeout(load, query ? 250 : 0) // wait for a pause in typing before asking the network
		return () => clearTimeout(t)
	}, [load, query, skillsKey])

	return { items, loading, failed, reload: load }
}

const ItemCard = ({ item, selected, busy, onSelect, onAction }: { item: MarketplaceItem, selected: boolean, busy: boolean, onSelect: () => void, onAction: () => void }) => {
	const level = item.trustScore ? trustLevelOf(item.trustScore.score) : undefined
	const label = item.installMethod ? (level === 'low' ? 'Review' : ACTION_LABEL[item.installMethod] ?? item.installMethod) : undefined
	return <div
		className={`flex items-center gap-3 px-3 py-2.5 rounded-md border cursor-pointer min-w-0 ${selected ? 'border-vader-border-1 bg-vader-bg-2' : 'border-vader-border-3 hover:bg-vader-bg-2-hover'}`}
		onClick={onSelect}
	>
		<div className='w-10 h-10 shrink-0 rounded-lg border border-vader-border-3 bg-vader-bg-2 flex items-center justify-center'><TypeIcon type={item.type} /></div>
		<div className='flex flex-col min-w-0 flex-1 gap-0.5'>
			<div className='flex items-baseline gap-2 min-w-0'>
				<span className='font-semibold text-vader-fg-1 truncate'>{item.name}</span>
				<span className='text-vader-fg-3 shrink-0'>{TYPE_NOUN[item.type]}</span>
			</div>
			<span className='text-vader-fg-2 truncate'>{item.description || 'No description'}</span>
			<div className='flex items-center gap-3 text-vader-fg-3 whitespace-nowrap overflow-hidden'>
				<span className='truncate'>{item.source}</span>
				{item.sizeBytes !== undefined ? <span>{formatBytes(item.sizeBytes)}</span> : null}
				{item.capabilities?.length ? <span className='truncate'>asks for {item.capabilities.join(', ')}</span> : null}
			</div>
		</div>
		{item.trustScore ? <TrustMeter score={item.trustScore} /> : null}
		<div className='w-20 shrink-0 flex justify-end' onClick={e => e.stopPropagation()}>
			{item.installed ? <span className='text-vader-fg-2'>Installed</span>
				: label ? <button
					disabled={busy}
					className={`px-3 py-1 rounded-sm whitespace-nowrap disabled:opacity-50 ${label === 'Review' ? 'border border-vader-border-1 text-vader-fg-1' : 'bg-vader-fg-1 text-vader-bg-1 font-medium'}`}
					onClick={label === 'Review' ? onSelect : onAction}
				>{busy ? <Loader2 className='w-3.5 h-3.5 animate-spin' /> : label}</button>
					: null}
		</div>
	</div>
}

const GROUP_TITLE: Partial<Record<MarketplaceItemType, string>> = { SKILL: 'Most trusted skills', MCP_SERVER: 'MCP servers', EXTENSION: 'Extensions for the editor', ACP_AGENT: 'Agents you can connect' }
const GROUP_ORDER: MarketplaceItemType[] = ['SKILL', 'MCP_SERVER', 'EXTENSION', 'ACP_AGENT']

const AddonRow = ({ item, selected, busy, onSelect, onAction }: { item: MarketplaceItem, selected: boolean, busy: boolean, onSelect: () => void, onAction: () => void }) => {
	const level = item.trustScore ? trustLevelOf(item.trustScore.score) : undefined
	const review = !item.installed && level === 'low' && !!item.installMethod
	return <div
		className={`flex items-center gap-3 h-16 px-1 border-b border-vader-border-3 cursor-pointer min-w-0 ${selected ? 'bg-vader-bg-2 rounded-md px-2' : ''}`}
		onClick={onSelect}
	>
		<div className='w-9 h-9 shrink-0 rounded-lg border border-vader-border-3 bg-vader-bg-2 flex items-center justify-center'><TypeIcon type={item.type} /></div>
		<div className='flex flex-col min-w-0 flex-1'>
			<div className='flex items-baseline gap-2 min-w-0'>
				<span className='font-semibold text-vader-fg-1 truncate'>{item.name}</span>
				<span className='text-vader-fg-3 shrink-0'>{TYPE_NOUN[item.type]}</span>
			</div>
			<span className='text-vader-fg-3 truncate'>{item.description || 'No description'}</span>
		</div>
		{item.trustScore ? <TrustMeter score={item.trustScore} /> : null}
		<div className='w-24 shrink-0 flex justify-end' onClick={e => e.stopPropagation()}>
			{item.installed ? <span className='flex items-center gap-1.5 text-vader-fg-2' aria-label='Installed'><Check className='w-3.5 h-3.5 text-green-500' />Installed</span>
				: busy ? <span className='flex items-center gap-1.5 text-vader-fg-2'><Loader2 className='w-3.5 h-3.5 animate-spin' />Installing</span>
					: review ? <button className='px-3.5 py-1 rounded-md border border-vader-border-1 text-vader-fg-1' onClick={onSelect}>Review</button>
						: item.installMethod ? <button data-testid='vader-addon-install' className='px-3.5 py-1 rounded-md bg-vader-fg-1 text-vader-bg-1 font-medium hover:opacity-90' aria-label={`${item.metadata.openOnly ? 'Open' : 'Install'} ${item.name}`} onClick={onAction}>{item.metadata.openOnly ? 'Open' : 'Install'}</button>
							: null}
		</div>
	</div>
}

const DetailPane = ({ item, busy, refining, error, onAction, onActionAndEnable, onClose }: { item: MarketplaceItem, busy: boolean, refining?: boolean, error?: string, onAction: () => void, onActionAndEnable?: () => void, onClose: () => void }) => {
	const listedBy = Array.isArray(item.metadata.sourcesListing) ? (item.metadata.sourcesListing as string[]).join(', ') : ''
	const instructions = typeof item.metadata.instructions === 'string' ? item.metadata.instructions : ''
	const stars = typeof item.metadata.stars === 'number' ? item.metadata.stars : undefined
	return <div className='flex flex-col gap-4 p-4 border-l border-vader-border-3 min-w-0 overflow-y-auto'>
		<div className='flex items-start gap-3'>
			<div className='w-12 h-12 shrink-0 rounded-lg border border-vader-border-3 bg-vader-bg-2 flex items-center justify-center'><TypeIcon type={item.type} /></div>
			<div className='flex flex-col min-w-0 flex-1'>
				<span className='text-xl font-semibold text-vader-fg-1 break-words'>{item.name}</span>
				<span className='text-vader-fg-2'>{item.publisher ?? item.source}</span>
				<span className='text-vader-fg-3'>{[item.source, item.sizeBytes !== undefined ? formatBytes(item.sizeBytes) : '', stars !== undefined ? `${stars.toLocaleString()} stars` : '', item.version ? `v${item.version}` : ''].filter(Boolean).join(' · ')}</span>
			</div>
			{item.trustScore ? <TrustMeter score={item.trustScore} large /> : null}
			<button className='text-vader-fg-3 hover:text-vader-fg-1' aria-label='Close details' onClick={onClose}>✕</button>
		</div>
		<div className='flex items-center gap-2'>
			{item.installed ? <span className='text-vader-fg-2'>Installed</span>
				: item.installMethod ? <button disabled={busy} className='px-3 py-1 rounded-sm bg-vader-fg-1 text-vader-bg-1 font-medium disabled:opacity-50' onClick={onAction}>
					{busy ? 'Working...' : item.type === 'SKILL' ? 'Install, switched off' : ACTION_LABEL[item.installMethod] ?? item.installMethod}
				</button> : null}
			{!item.installed && item.type === 'SKILL' && item.installMethod && onActionAndEnable ? <button disabled={busy} className='px-3 py-1 rounded-sm border border-vader-border-1 text-vader-fg-1 disabled:opacity-50' title='Install it and switch it on. You can still read it afterwards.' onClick={onActionAndEnable}>Install and switch on</button> : null}
			{error ? <span className='text-red-500'>{error}</span> : null}
		</div>
		<div className='text-vader-fg-2 leading-relaxed'>{item.description || 'This source gives no description.'}</div>
		{item.trustScore ? <div className='flex flex-col'>
			<div className='text-vader-fg-3 pb-1'>Why {item.trustScore.score}%</div>
			{item.trustScore.factors.map((f, i) => <div key={i} className='flex items-center justify-between gap-3 py-1.5 border-t border-vader-border-3'>
				<span className='text-vader-fg-2'>{f.label}</span>
				<span className={f.points > 0 && i > 0 ? 'text-green-500' : f.points < 0 ? 'text-red-500' : 'text-vader-fg-2'}>{f.points > 0 && i > 0 ? `+${f.points}` : f.points < 0 ? `−${-f.points}` : f.points}</span>
			</div>)}
			<div className='text-vader-fg-3 pt-2'>{refining ? 'Asking the sources again for the latest numbers...' : item.metadata.refined ? 'Scored just now from what the sources say today.' : 'Scored from what the listing says. Open the details to ask the sources again.'}{listedBy ? ` Found in: ${listedBy}.` : ''}</div>
			<div className='text-vader-fg-3'>This is a guide to what to read first, not a safety check. Vader still asks before the agent runs anything.</div>
		</div> : null}
		{item.capabilities?.length ? <div className='text-vader-fg-2'>It mentions: {item.capabilities.join(', ')}. The agent still asks before it uses any of these.</div> : null}
		{instructions ? <div className='flex flex-col gap-1 min-h-0'>
			<span className='text-vader-fg-3'>SKILL.md</span>
			<pre className='text-sm whitespace-pre-wrap break-words p-3 rounded-md border border-vader-border-3 bg-vader-bg-1 max-h-72 overflow-y-auto'>{instructions.slice(0, 3000)}{instructions.length > 3000 ? '\n...' : ''}</pre>
		</div> : null}
	</div>
}

export const StoreView = ({ types, layout, query: externalQuery, showSearch, searchPlaceholder, includeExtensions, installedOnly, grouped, onSeeAll }: {
	types: MarketplaceItemType[], layout: 'wide' | 'narrow' | 'rows', query?: string, showSearch?: boolean, searchPlaceholder?: string,
	/** rows layout: also list extensions (the Settings pages never do) */
	includeExtensions?: boolean, installedOnly?: boolean,
	/** rows layout: one short list per kind, each with a "See all" link that calls onSeeAll(kind) */
	grouped?: boolean, onSeeAll?: (type: MarketplaceItemType) => void,
}) => {
	const accessor = useAccessor()
	const marketplace = accessor.get('IUnifiedMarketplaceService')
	const [typed, setTyped] = useState('')
	const query = showSearch ? typed : externalQuery ?? ''
	const { items, loading, failed, reload } = useStoreItems(types, query, includeExtensions)
	const [sort, setSort] = useState<Sort>('trust')
	const [source, setSource] = useState<string | null>(null)
	const [selectedKey, setSelectedKey] = useState<string | null>(null)
	const [busyKey, setBusyKey] = useState<string | null>(null)
	const [errorOf, setErrorOf] = useState<Record<string, string>>({})

	const keyOf = (i: MarketplaceItem) => `${i.providerId}:${i.id}`
	const sources = useMemo(() => {
		const counts = new Map<string, number>()
		for (const i of items) counts.set(i.source, (counts.get(i.source) ?? 0) + 1)
		return [...counts.entries()].sort((a, b) => b[1] - a[1])
	}, [items])
	const shown = useMemo(() => {
		const list = (source ? items.filter(i => i.source === source) : items.slice()).filter(i => !installedOnly || i.installed)
		if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name))
		else list.sort((a, b) => (Number(b.installed) - Number(a.installed)) || ((b.trustScore?.score ?? -1) - (a.trustScore?.score ?? -1)))
		return list
	}, [items, source, sort, installedOnly])
	const [refined, setRefined] = useState<Record<string, MarketplaceItem>>({})
	const [refining, setRefining] = useState<string | null>(null)
	const selectedListed = selectedKey ? shown.find(i => keyOf(i) === selectedKey) : undefined
	const selected = selectedListed ? (refined[selectedKey!] ?? selectedListed) : undefined
	useEffect(() => {
		if (!selectedListed || !selectedKey || refined[selectedKey]) return
		let live = true
		setRefining(selectedKey)
		marketplace.refine(selectedListed).then(r => { if (live) setRefined(prev => ({ ...prev, [selectedKey]: r })) }).finally(() => { if (live) setRefining(null) })
		return () => { live = false }
	}, [selectedKey, selectedListed, refined, marketplace])

	const act = useCallback(async (item: MarketplaceItem) => {
		if (!item.installMethod) return
		const key = keyOf(item)
		setBusyKey(key)
		setErrorOf(e => { const { [key]: _drop, ...rest } = e; return rest })
		try {
			await marketplace.performAction(item.installMethod, item)
			setRefined({})
			await reload()
		} catch (e) {
			setErrorOf(prev => ({ ...prev, [key]: e instanceof Error ? e.message : String(e) }))
		} finally {
			setBusyKey(null)
		}
	}, [marketplace, reload])

	// install a skill and switch it on in one step; a skill with a low score never gets this shortcut
	const actAndEnable = useCallback(async (item: MarketplaceItem) => {
		await act(item)
		const skillService = accessor.get('ISkillService')
		const url = String(item.metadata.repositoryUrl ?? item.id)
		const installed = skillService.list().find(s => s.source.repositoryUrl === url)
		if (installed) skillService.setEnabled(installed.id, true)
	}, [act, accessor])

	if (layout === 'rows') {
		const rowOf = (item: MarketplaceItem) => <AddonRow key={keyOf(item)} item={item} selected={keyOf(item) === selectedKey} busy={busyKey === keyOf(item)} onSelect={() => setSelectedKey(keyOf(item) === selectedKey ? null : keyOf(item))} onAction={() => act(item)} />
		const groups = grouped && !query.trim() ? GROUP_ORDER.map(t => ({ type: t, list: shown.filter(i => i.type === t) })).filter(g => g.list.length > 0) : []
		return <div className='flex min-w-0 min-h-0 flex-1 text-root'>
			<div className='flex flex-col gap-4 min-w-0 flex-1 overflow-y-auto pr-2'>
				{failed.length > 0 ? <div className='text-yellow-600'>{failed.length === 1 ? 'One source' : `${failed.length} sources`} could not be read just now: {failed.join(' ')}</div> : null}
				{loading && items.length === 0 ? <div className='text-vader-fg-3 py-6'>Loading...</div> : null}
				{!loading && shown.length === 0 ? <div className='text-vader-fg-3 py-6'>{query.trim() ? `Nothing matches "${query.trim()}". Searched every source that is turned on.` : installedOnly ? 'Nothing is installed yet.' : 'Nothing to show yet.'}</div> : null}
				{grouped && groups.length > 0 ? groups.map(g => <div key={g.type} className='flex flex-col'>
					<div className='flex items-center gap-3 h-9'><span className='font-semibold text-vader-fg-1'>{GROUP_TITLE[g.type] ?? TYPE_NOUN[g.type]}</span><span className='flex-1' />{onSeeAll ? <button className='text-vader-fg-2 hover:text-vader-fg-1' onClick={() => onSeeAll(g.type)}>See all</button> : null}</div>
					<div className='grid gap-x-10' style={{ gridTemplateColumns: selected ? 'minmax(0,1fr)' : 'repeat(2,minmax(0,1fr))' }}>{g.list.slice(0, 4).map(rowOf)}</div>
				</div>) : <div className='grid gap-x-10' style={{ gridTemplateColumns: selected ? 'minmax(0,1fr)' : 'repeat(2,minmax(0,1fr))' }}>{shown.map(rowOf)}</div>}
			</div>
			{selected ? <div className='shrink-0' style={{ width: 460 }}><DetailPane item={selected} busy={busyKey === keyOf(selected)} refining={refining === selectedKey} error={errorOf[keyOf(selected)]} onAction={() => act(selected)} onActionAndEnable={selected.trustScore && selected.trustScore.level !== 'low' ? () => actAndEnable(selected) : undefined} onClose={() => setSelectedKey(null)} /></div> : null}
		</div>
	}

	const wide = layout === 'wide'
	return <div className='flex flex-col gap-3 min-w-0 text-root'>
		{showSearch ? <label className='flex items-center gap-2 px-3 py-1.5 rounded-md border border-vader-border-2 bg-vader-bg-1'>
			<Search className='w-3.5 h-3.5 text-vader-fg-3' />
			<input className='flex-1 bg-transparent outline-none text-vader-fg-1' placeholder={searchPlaceholder ?? 'Search'} value={typed} onChange={e => setTyped(e.target.value)} />
			{loading ? <Loader2 className='w-3.5 h-3.5 animate-spin text-vader-fg-3' /> : null}
		</label> : null}
		{failed.length > 0 ? <div className='text-yellow-600'>{failed.length === 1 ? 'One source' : `${failed.length} sources`} could not be read just now: {failed.join(' ')}</div> : null}
		<div className={wide ? 'grid gap-4' : 'flex flex-col gap-2'} style={wide ? { gridTemplateColumns: selected ? '180px minmax(0,1fr) 380px' : '180px minmax(0,1fr)' } : undefined}>
			{wide ? <div className='flex flex-col gap-1 text-vader-fg-2'>
				<span className='text-vader-fg-3 px-2 pb-1'>Sort by</span>
				<button className={`text-left px-2 py-1 rounded-sm ${sort === 'trust' ? 'bg-vader-bg-2 text-vader-fg-1' : ''}`} onClick={() => setSort('trust')}>Most trusted</button>
				<button className={`text-left px-2 py-1 rounded-sm ${sort === 'name' ? 'bg-vader-bg-2 text-vader-fg-1' : ''}`} onClick={() => setSort('name')}>Name</button>
				{sources.length > 1 ? <>
					<span className='text-vader-fg-3 px-2 pt-4 pb-1'>Source</span>
					<button className={`text-left px-2 py-1 rounded-sm ${source === null ? 'bg-vader-bg-2 text-vader-fg-1' : ''}`} onClick={() => setSource(null)}>All sources <span className='text-vader-fg-3'>{items.length}</span></button>
					{sources.map(([s, n]) => <button key={s} className={`text-left px-2 py-1 rounded-sm truncate ${source === s ? 'bg-vader-bg-2 text-vader-fg-1' : ''}`} onClick={() => setSource(s)}>{s} <span className='text-vader-fg-3'>{n}</span></button>)}
				</> : null}
			</div> : null}
			<div className='flex flex-col gap-2 min-w-0'>
				{loading && items.length === 0 ? <div className='text-vader-fg-3 py-6'>Loading...</div> : null}
				{!loading && shown.length === 0 ? <div className='text-vader-fg-3 py-6'>{query.trim() ? `Nothing matches "${query.trim()}".` : 'Nothing to show yet.'}</div> : null}
				{shown.map(item => <React.Fragment key={keyOf(item)}>
					<ItemCard item={item} selected={keyOf(item) === selectedKey} busy={busyKey === keyOf(item)} onSelect={() => setSelectedKey(keyOf(item) === selectedKey ? null : keyOf(item))} onAction={() => act(item)} />
					{!wide && keyOf(item) === selectedKey ? <DetailPane item={item} busy={busyKey === keyOf(item)} error={errorOf[keyOf(item)]} onAction={() => act(item)} onActionAndEnable={item.trustScore && item.trustScore.level !== 'low' ? () => actAndEnable(item) : undefined} onClose={() => setSelectedKey(null)} /> : null}
				</React.Fragment>)}
			</div>
			{wide && selected ? <DetailPane item={selected} busy={busyKey === keyOf(selected)} error={errorOf[keyOf(selected)]} onAction={() => act(selected)} onActionAndEnable={selected.trustScore && selected.trustScore.level !== 'low' ? () => actAndEnable(selected) : undefined} onClose={() => setSelectedKey(null)} /> : null}
		</div>
	</div>
}
