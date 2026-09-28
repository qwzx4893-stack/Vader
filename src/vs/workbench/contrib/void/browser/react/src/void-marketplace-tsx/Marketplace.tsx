/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useAccessor } from '../util/services.js'
import type { MarketplaceItem, MarketplaceItemType } from '../../../../common/marketplace/marketplaceTypes.js'

// Vader addition, part of the Unified Capability Marketplace (docs/integrations/marketplace.md).
// Mounted as an additive ViewPane inside the EXISTING Extensions view container (see
// marketplaceViewPane.ts) - not a new window, not a redesign of the native Extensions/
// Marketplace panes. EXTENSION-type results are deliberately filtered out here: the native
// Marketplace/Installed panes already show those (unregressed, untouched), so this pane
// federates the other 8 ecosystems the native Extensions view has no coverage of at all.

const TYPE_LABEL: Record<MarketplaceItemType, string> = {
	EXTENSION: 'Extension',
	SKILL: 'Skill',
	MCP_SERVER: 'MCP Server',
	ACP_AGENT: 'ACP Agent',
	LANGUAGE_SERVER: 'Language Server',
	DEBUG_ADAPTER: 'Debug Adapter',
	TREE_SITTER_GRAMMAR: 'Grammar',
	FORMATTER: 'Formatter',
	JUPYTER_KERNEL: 'Jupyter Kernel',
}

const ACTION_LABEL: Record<string, string> = {
	install: 'Install', update: 'Update', uninstall: 'Uninstall', enable: 'Enable', disable: 'Disable',
	configure: 'Configure', connect: 'Connect', add: 'Add', download: 'Download', use_local: 'Use',
	review_and_install: 'Review & Install',
}

export const Marketplace = ({ query }: { query?: string }) => {
	const accessor = useAccessor()
	const marketplaceService = accessor.get('IUnifiedMarketplaceService')

	const [items, setItems] = useState<MarketplaceItem[]>([])
	const [loading, setLoading] = useState(false)
	const [erroredProviders, setErroredProviders] = useState<string[]>([])
	const [busyId, setBusyId] = useState<string | null>(null)
	const generationRef = useRef(0)

	const runSearch = useCallback(async (q: string) => {
		const generation = ++generationRef.current
		setLoading(true)
		try {
			const res = await marketplaceService.search(q)
			if (generation !== generationRef.current) return // a newer search started - drop this stale result
			setItems(res.items.filter(i => i.type !== 'EXTENSION'))
			setErroredProviders(res.providerOutcomes.filter(o => o.error).map(o => o.providerId))
		} finally {
			if (generation === generationRef.current) setLoading(false)
		}
	}, [marketplaceService])

	useEffect(() => { runSearch(query ?? '') }, [query, runSearch])

	const onAction = useCallback(async (item: MarketplaceItem) => {
		if (!item.installMethod) return
		setBusyId(item.id)
		try {
			await marketplaceService.performAction(item.installMethod, item)
			await runSearch(query ?? '')
		} catch (e) {
			console.error('Vader marketplace action failed', e)
		} finally {
			setBusyId(null)
		}
	}, [marketplaceService, query, runSearch])

	return <div className='p-2 text-xs flex flex-col gap-y-2'>
		<div className='text-void-fg-3'>
			Unified Capability Marketplace - Skills, MCP servers, ACP agents, language servers, debug adapters, formatters, and local Jupyter kernels. Extensions still appear in the Marketplace/Installed sections above.
		</div>
		{erroredProviders.length > 0 && <div className='text-yellow-600'>
			{erroredProviders.length} source(s) unavailable right now (offline or timed out) - showing results from the rest.
		</div>}
		{loading && items.length === 0 ? <div className='text-void-fg-3'>Searching...</div> : null}
		{!loading && items.length === 0 ? <div className='text-void-fg-3'>No results.</div> : null}
		<div className='flex flex-col gap-y-1'>
			{items.map(item => (
				<div key={`${item.providerId}:${item.id}`} className='border border-void-border-3 rounded p-2'>
					<div className='flex items-center justify-between gap-x-2'>
						<div className='flex items-center gap-x-2 min-w-0'>
							<span className='shrink-0 px-1 rounded bg-void-bg-2 text-void-fg-3 text-[10px] uppercase'>{TYPE_LABEL[item.type]}</span>
							<span className='font-medium truncate'>{item.name}</span>
							{item.version ? <span className='text-void-fg-3 shrink-0'>v{item.version}</span> : null}
						</div>
						{item.installMethod ? (
							<button
								className='shrink-0 text-void-fg-3 hover:text-void-fg-1 underline disabled:opacity-50'
								disabled={busyId === item.id}
								onClick={() => onAction(item)}
							>{busyId === item.id ? '...' : (ACTION_LABEL[item.installMethod] ?? item.installMethod)}</button>
						) : (item.installed || item.isLocal) ? (
							<span className='shrink-0 text-green-600'>{item.isLocal ? 'Local/Available' : 'Installed'}</span>
						) : null}
					</div>
					<div className='text-void-fg-3 mt-1'>{item.description}</div>
					<div className='text-void-fg-3 mt-1 flex items-center gap-x-2'>
						<span>{item.source}</span>
						{item.publisher ? <span>· {item.publisher}</span> : null}
						{item.trust === 'unknown' ? <span className='text-yellow-600'>· unverified</span> : item.trust === 'blocked' ? <span className='text-red-500'>· blocked</span> : null}
					</div>
				</div>
			))}
		</div>
	</div>
}
