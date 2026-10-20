/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { useAccessor, useSkillsState } from '../util/services.js'
import type { MarketplaceItem, MarketplaceItemType } from '../../../../common/marketplace/marketplaceTypes.js'
import { trustLevelOf } from '../../../../common/marketplace/trustScore.js'
import { TrustMeter } from './TrustMeter.js'
import { ItemLogo, ItemPage } from './ItemPage.js'
import { Icon } from '../vader-shell-tsx/icons.js'

// The list a person browses in Add-ons: rows with a logo, a name, what it is, a trust score and one white Install button; clicking a row opens the
// item's own page (ItemPage.tsx). The data comes from IUnifiedMarketplaceService; nothing here talks to a network.

const TYPE_NOUN: Record<MarketplaceItemType, string> = {
	EXTENSION: 'Extension', SKILL: 'Skill', MCP_SERVER: 'MCP server', ACP_AGENT: 'Agent', LANGUAGE_SERVER: 'Language server',
	DEBUG_ADAPTER: 'Debugger', TREE_SITTER_GRAMMAR: 'Grammar', FORMATTER: 'Formatter', JUPYTER_KERNEL: 'Jupyter kernel',
}

export { TrustMeter } from './TrustMeter.js'

/** the items of a kind, found by browsing when the search box is empty and by searching when it is not; refreshed when skills or their sources change */
function useStoreItems(types: MarketplaceItemType[], query: string, includeExtensions?: boolean, category?: string) {
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
			const opts = { types: typeKey.split(',') as MarketplaceItemType[], ...(category ? { category } : {}) }
			const res = query.trim() ? await marketplace.search(query.trim(), opts) : await marketplace.browse(opts)
			if (g !== generation.current) return
			setItems(res.items.filter(i => includeExtensions || i.type !== 'EXTENSION'))
			setFailed(res.providerOutcomes.flatMap(o => [...(o.error ? [`${o.providerId}: ${o.error}`] : []), ...(o.warnings ?? [])]))
		} finally {
			if (g === generation.current) setLoading(false)
		}
	}, [marketplace, typeKey, query, includeExtensions, category])

	useEffect(() => {
		const t = setTimeout(load, query ? 250 : 0) // wait for a pause in typing before asking the network
		return () => clearTimeout(t)
	}, [load, query, skillsKey])

	return { items, loading, failed, reload: load }
}

// the editor's own tooling (language servers, debuggers, formatters, grammars, notebook kernels) is listed with extensions: one place for what extends the editor
type GroupKey = MarketplaceItemType | 'TOOLING'
const TOOLING_TYPES: readonly MarketplaceItemType[] = ['LANGUAGE_SERVER', 'DEBUG_ADAPTER', 'FORMATTER', 'TREE_SITTER_GRAMMAR', 'JUPYTER_KERNEL']
const groupOf = (t: MarketplaceItemType): GroupKey => TOOLING_TYPES.includes(t) ? 'TOOLING' : t
const GROUP_TITLE: Partial<Record<GroupKey, string>> = { SKILL: 'Most trusted skills', MCP_SERVER: 'MCP servers', EXTENSION: 'Extensions for the editor', TOOLING: 'Language servers, debuggers and formatters', ACP_AGENT: 'Agents you can connect' }
const GROUP_ORDER: GroupKey[] = ['SKILL', 'MCP_SERVER', 'EXTENSION', 'TOOLING', 'ACP_AGENT']

const GROUP_HINT: Partial<Record<GroupKey, string>> = {
	SKILL: 'live from GitHub, skills.sh and the sources you added', MCP_SERVER: 'live from the MCP Registry, Smithery, npm and GitHub',
	EXTENSION: 'live from Open VSX and the editor tooling', TOOLING: 'live from Open VSX', ACP_AGENT: 'they work inside Vader\u2019s chat',
}
const SEE_ALL: Partial<Record<GroupKey, string>> = { SKILL: 'See all skills', MCP_SERVER: 'See all servers', EXTENSION: 'See all extensions', TOOLING: 'See all extensions', ACP_AGENT: 'See all agents' }

const AddonRow = ({ item, selected, busy, onSelect, onAction }: { item: MarketplaceItem, selected: boolean, busy: boolean, onSelect: () => void, onAction: () => void }) => {
	const level = item.trustScore ? trustLevelOf(item.trustScore.score) : undefined
	const review = !item.installed && level === 'low' && !!item.installMethod
	return <div
		className='r'
		style={{ gap: 13, height: 66, borderBottom: '1px solid var(--ln)', padding: '0 4px', minWidth: 0, cursor: 'pointer', ...(selected ? { background: 'var(--g2)', borderRadius: 6 } : {}) }}
		data-testid='vader-addon-row'
		role='link'
		tabIndex={0}
		onKeyDown={e => { if (e.key === 'Enter') onSelect() }}
		onClick={onSelect}
	>
		<ItemLogo item={item} size={38} />
		<div className='c fl' style={{ gap: 1, minWidth: 0 }}>
			<div className='r' style={{ gap: 8 }}>
				<span className='nm tr' data-testid='vader-addon-name'>{item.name}</span>
				<span className='hint' style={{ flex: 'none' }}>{TYPE_NOUN[item.type]}</span>
			</div>
			<span className='t3 tr' style={{ fontSize: 12.5 }}>{item.description || (item.source ? `Found in ${item.source}` : 'No description')}</span>
		</div>
		{item.trustScore ? <TrustMeter score={item.trustScore} /> : null}
		<span style={{ width: 92, display: 'flex', justifyContent: 'flex-end', flex: 'none' }} onClick={e => e.stopPropagation()}>
			{item.installed ? <span className='r t2' style={{ gap: 6 }} aria-label='Installed'><span style={{ color: '#4cc38a', display: 'flex' }}><Check className='w-3.5 h-3.5' /></span>Installed</span>
				: busy ? <span className='r t2' style={{ gap: 6 }}><Loader2 className='w-3.5 h-3.5 animate-spin' />Installing</span>
					: review ? <button className='gb' style={{ height: 28, padding: '0 14px' }} onClick={onSelect}>Review</button>
						: item.installMethod ? <button data-testid='vader-addon-install' className='pb' style={{ height: 28, padding: '0 14px' }} aria-label={`${typeof item.metadata.actionLabel === 'string' ? item.metadata.actionLabel : item.metadata.openOnly ? 'Open' : 'Install'} ${item.name}`} onClick={onAction}>{typeof item.metadata.actionLabel === 'string' ? item.metadata.actionLabel : item.metadata.openOnly ? 'Open' : 'Install'}</button>
							: null}
		</span>
	</div>
}

export const StoreView = ({ types, query, includeExtensions, installedOnly, grouped, onSeeAll, category, onPageChange }: {
	types: MarketplaceItemType[], query?: string,
	/** also list extensions */
	includeExtensions?: boolean, installedOnly?: boolean,
	/** one short list per kind, each with a "See all" link that calls onSeeAll(kind) */
	grouped?: boolean, onSeeAll?: (type: MarketplaceItemType) => void,
	/** one section of the page (an id from common/marketplace/categories.ts) */
	category?: string,
	/** called with true when an item's own page opens and false when it closes */
	onPageChange?: (open: boolean) => void,
}) => {
	const accessor = useAccessor()
	const marketplace = accessor.get('IUnifiedMarketplaceService')
	const q = query ?? ''
	const { items, loading, failed, reload } = useStoreItems(types, q, includeExtensions, category)
	const [selectedKey, setSelectedKey] = useState<string | null>(null)
	const [busyKey, setBusyKey] = useState<string | null>(null)
	const [errorOf, setErrorOf] = useState<Record<string, string>>({})

	const keyOf = (i: MarketplaceItem) => `${i.providerId}:${i.id}`
	const shown = useMemo(() => {
		const list = items.slice().filter(i => !installedOnly || i.installed).filter(i => !category || ((i.metadata.categories as string[] | undefined) ?? []).includes(category))
		list.sort((a, b) => (Number(b.installed) - Number(a.installed)) || ((b.trustScore?.score ?? -1) - (a.trustScore?.score ?? -1)))
		return list
	}, [items, installedOnly, category])
	const [refined, setRefined] = useState<Record<string, MarketplaceItem>>({})
	const [refining, setRefining] = useState<string | null>(null)
	// a page opened from "More in this section" may be an item the current filters hide from the list, so it is looked up among everything loaded
	const selectedListed = selectedKey ? (shown.find(i => keyOf(i) === selectedKey) ?? items.find(i => keyOf(i) === selectedKey)) : undefined
	// other items of the same kind, the ones in the same section first, best score first
	const relatedOf = (item: MarketplaceItem) => {
		const mine = (item.metadata.categories as string[] | undefined) ?? []
		const same = items.filter(i => i.type === item.type && keyOf(i) !== keyOf(item) && i.name !== item.name)
		const rank = (i: MarketplaceItem) => (((i.metadata.categories as string[] | undefined) ?? []).some(c => mine.includes(c)) ? 1000 : 0) + (i.trustScore?.score ?? 0)
		return same.sort((a, b) => rank(b) - rank(a)).slice(0, 4)
	}
	const selected = selectedListed ? (refined[selectedKey!] ?? selectedListed) : undefined
	useEffect(() => {
		if (!selectedListed || !selectedKey || refined[selectedKey]) return
		let live = true
		setRefining(selectedKey)
		marketplace.refine(selectedListed).then(r => { if (live) setRefined(prev => ({ ...prev, [selectedKey]: r })) }).finally(() => setRefining(cur => cur === selectedKey ? null : cur))
		return () => { live = false }
	}, [selectedKey, selectedListed, refined, marketplace])

	useLayoutEffect(() => { onPageChange?.(!!selectedKey) }, [selectedKey, onPageChange])

	// An item changes identity when it is installed (a skill listed by its address becomes an installed skill with an id of its own; a server found in a
	// registry becomes the entry of the config file). The page that is open must stay open and show the installed one, not fall back to the list.
	const lastSelected = useRef<MarketplaceItem | undefined>(undefined)
	useEffect(() => { if (selectedListed) lastSelected.current = selectedListed }, [selectedListed])
	useEffect(() => {
		const last = lastSelected.current
		if (!selectedKey || selectedListed || !last) return
		const sameThing = items.find(i => i.installed && i.type === last.type && (i.name.toLowerCase() === last.name.toLowerCase() || (!!last.metadata.serverKey && i.id === last.metadata.serverKey) || (!!last.metadata.repositoryUrl && i.metadata.repositoryUrl === last.metadata.repositoryUrl)))
		if (sameThing) setSelectedKey(keyOf(sameThing))
	}, [items, selectedKey, selectedListed])

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

	const rowOf = (item: MarketplaceItem) => <AddonRow key={keyOf(item)} item={item} selected={keyOf(item) === selectedKey} busy={busyKey === keyOf(item)} onSelect={() => setSelectedKey(keyOf(item) === selectedKey ? null : keyOf(item))} onAction={() => act(item)} />
	const groups = grouped && !q.trim() ? GROUP_ORDER.map(t => ({ type: t, list: shown.filter(i => groupOf(i.type) === t) })).filter(g => g.list.length > 0) : []
	if (selected) {
		return <ItemPage
			item={selected} related={relatedOf(selected)} onOpenRelated={i => setSelectedKey(keyOf(i))}
			busy={busyKey === keyOf(selected)} refining={refining === selectedKey} error={errorOf[keyOf(selected)]}
			onAction={() => act(selected)} onActionAndEnable={selected.trustScore && selected.trustScore.level !== 'low' ? () => actAndEnable(selected) : undefined}
			onBack={() => setSelectedKey(null)}
		/>
	}
	return <div className='flex min-w-0 min-h-0 flex-1 text-root'>
		<div className='flex flex-col min-w-0 flex-1 overflow-y-auto scroll' style={{ gap: 18, paddingBottom: 24 }}>
			{failed.length > 0 ? <div className='text-yellow-600'>{failed.length === 1 ? 'One source' : `${failed.length} sources`} could not be read just now: {failed.join(' ')}</div> : null}
			{Object.entries(errorOf).map(([k, msg]) => <div key={k} data-testid='vader-addon-error' role='alert' className='flex items-start gap-3 text-red-500'><span className='flex-1'>Could not add {items.find(i => keyOf(i) === k)?.name ?? 'it'}: {msg}</span><button className='text-vader-fg-2 hover:text-vader-fg-1 shrink-0' onClick={() => setErrorOf(e => { const { [k]: _drop, ...rest } = e; return rest })}>Dismiss</button></div>)}
			{loading && items.length === 0 ? <div className='text-vader-fg-3 py-6'>Loading...</div> : null}
			{!loading && shown.length === 0 ? <div className='text-vader-fg-3 py-6'>{q.trim() ? `Nothing matches "${q.trim()}". Searched every source that is turned on.` : installedOnly ? 'Nothing is installed yet.' : 'Nothing to show yet.'}</div> : null}
			{grouped && groups.length > 0 ? groups.map(g => <div key={g.type} className='flex flex-col' style={{ gap: 2 }}>
				<div className='r' style={{ height: 34, gap: 12 }}><span className='t1' data-testid='vader-addons-group-title' style={{ fontWeight: 600, fontSize: 14 }}>{GROUP_TITLE[g.type]}</span><span className='hint tr narrow-hide'>{GROUP_HINT[g.type]}</span><span className='fl' />{onSeeAll ? <button className='tx' style={{ color: 'var(--t2)' }} data-testid='vader-addons-see-all' onClick={() => onSeeAll(g.type === 'TOOLING' ? 'EXTENSION' : g.type)}>{SEE_ALL[g.type] ?? 'See all'}<Icon k='right' small /></button> : null}</div>
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', columnGap: 40 }}>{g.list.slice(0, 4).map(rowOf)}</div>
			</div>) : <div className='grid gap-x-10' style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }}>{shown.map(rowOf)}</div>}
		</div>
	</div>
}
