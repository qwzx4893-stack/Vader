/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { useAccessor, useSkillsState } from '../util/services.js'
import type { MarketplaceItem, MarketplaceItemType } from '../../../../common/marketplace/marketplaceTypes.js'
import { trustLevelOf } from '../../../../common/marketplace/trustScore.js'
import { ItemLogo, ItemPage } from '../vader-marketplace-tsx/ItemPage.js'
import { Icon, WarnTri } from '../vader-shell-tsx/icons.js'

// What this computer has, in one place (board A07): a list per kind with a switch on each, the ones that need a look first, and a banner only when
// something is waiting. The data is the marketplace's own listInstalled(); a switch and an Update button call performAction, the same as the Skills and
// MCP pages of Settings do through their own services.

type Tab = 'all' | 'skills' | 'mcp' | 'extensions' | 'agents'
type Kind = 'SKILL' | 'MCP_SERVER' | 'EXTENSION' | 'ACP_AGENT'
const KIND_OF: Partial<Record<MarketplaceItemType, Kind>> = { SKILL: 'SKILL', MCP_SERVER: 'MCP_SERVER', ACP_AGENT: 'ACP_AGENT', EXTENSION: 'EXTENSION', LANGUAGE_SERVER: 'EXTENSION', DEBUG_ADAPTER: 'EXTENSION', FORMATTER: 'EXTENSION', TREE_SITTER_GRAMMAR: 'EXTENSION', JUPYTER_KERNEL: 'EXTENSION' }
const GROUPS: { kind: Kind, title: string, tab: Tab }[] = [{ kind: 'SKILL', title: 'Skills', tab: 'skills' }, { kind: 'MCP_SERVER', title: 'MCP servers', tab: 'mcp' }, { kind: 'EXTENSION', title: 'Extensions', tab: 'extensions' }, { kind: 'ACP_AGENT', title: 'Agents', tab: 'agents' }]
const TABS: { id: Tab, label: string }[] = [{ id: 'all', label: 'All' }, { id: 'skills', label: 'Skills' }, { id: 'mcp', label: 'MCP servers' }, { id: 'extensions', label: 'Extensions' }, { id: 'agents', label: 'Agents' }]
const DOT = { high: '#4cc38a', medium: '#e2a93f', low: '#f06a6e' } as const

const keyOf = (i: MarketplaceItem) => `${i.providerId}:${i.id}`
const needsUpdate = (i: MarketplaceItem) => i.installMethod === 'update'
const needsReading = (i: MarketplaceItem) => i.type === 'SKILL' && i.trust === 'review_required'
const sizeOf = (bytes?: number) => bytes === undefined ? undefined : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** the small grey line under a name: where it came from, which version, how big, and what is wrong with it if anything */
const detailOf = (i: MarketplaceItem): string => {
	const parts: (string | undefined)[] = [i.publisher && i.source && !i.source.includes(i.publisher) ? `${i.publisher}` : undefined, i.source, i.version ? (/^v?\d/.test(i.version) ? `v${i.version.replace(/^v/, '')}` : i.version) : undefined, sizeOf(i.sizeBytes)]
	if (i.type === 'SKILL') parts.push(needsReading(i) ? 'needs review' : i.trust === 'blocked' ? 'blocked' : i.capabilities && i.capabilities.length > 0 ? `asks for ${i.capabilities.join(', ')}` : 'asks for nothing special')
	if (needsUpdate(i)) parts.push('a newer version is out')
	return [...new Set(parts.filter((p): p is string => !!p))].join(' · ')
}

const Row = ({ item, busy, onOpen, onAct, onSwitch }: { item: MarketplaceItem, busy: boolean, onOpen: () => void, onAct: (action: 'update') => void, onSwitch: (on: boolean) => void }) => {
	const level = item.trustScore ? trustLevelOf(item.trustScore.score) : undefined
	const on = item.enabled
	return <div className='r' style={{ gap: 13, minHeight: 60, borderBottom: '1px solid var(--ln)', padding: '8px 4px', cursor: 'pointer' }} data-testid='vader-installed-row' role='link' tabIndex={0} onClick={onOpen} onKeyDown={e => { if (e.key === 'Enter') onOpen() }}>
		<ItemLogo item={item} size={38} plain />
		<div className='c fl' style={{ gap: 2, minWidth: 0 }}>
			<span className='nm tr' data-testid='vader-installed-name'>{item.name}</span>
			<span className='hint tr'>{detailOf(item)}</span>
		</div>
		<span className='r' style={{ gap: 16, flex: 'none' }} onClick={e => e.stopPropagation()}>
			{needsReading(item) ? <button className='pb' style={{ height: 28, padding: '0 14px' }} data-testid='vader-installed-read' onClick={onOpen}>Read</button>
				: needsUpdate(item) ? <button className='pb' style={{ height: 28, padding: '0 14px' }} data-testid='vader-installed-update' disabled={busy} onClick={() => onAct('update')}>{busy ? 'Updating' : 'Update'}</button> : null}
			{item.trustScore && level ? <span className='r t2' style={{ gap: 7, width: 52 }} title={`Trust ${item.trustScore.score} out of 100`} data-testid='vader-installed-score'><span className='dot' style={{ background: DOT[level] }} />{item.trustScore.score}%</span> : null}
			{on !== undefined ? <button role='switch' aria-checked={on} aria-label={`${on ? 'Turn off' : 'Turn on'} ${item.name}`} data-testid='vader-installed-switch' className={on ? 'sw' : 'sw off'} disabled={busy || needsReading(item)} title={needsReading(item) ? 'Read it first: it changed at its source, so it stays off until you do' : undefined} onClick={() => onSwitch(!on)}><i /></button> : <span style={{ width: 26 }} />}
		</span>
	</div>
}

export const InstalledPage = ({ onBack }: { onBack: () => void }) => {
	const accessor = useAccessor()
	const marketplace = accessor.get('IUnifiedMarketplaceService')
	const skills = useSkillsState()
	const [items, setItems] = useState<MarketplaceItem[]>([])
	const [loading, setLoading] = useState(true)
	const [tab, setTab] = useState<Tab>('all')
	const [filter, setFilter] = useState('')
	const [attentionOnly, setAttentionOnly] = useState(false)
	const [busyKey, setBusyKey] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [openKey, setOpenKey] = useState<string | null>(null)
	const skillsKey = skills.map(s => `${s.id}:${s.enabled}:${s.trustState}`).join('|')

	const load = useCallback(async () => {
		try { setItems((await marketplace.listInstalled()).filter(i => i.installed && KIND_OF[i.type])) } finally { setLoading(false) }
	}, [marketplace])
	useEffect(() => { void load() }, [load, skillsKey])

	const updates = items.filter(needsUpdate)
	const toRead = items.filter(needsReading)
	const attention = updates.length + toRead.length
	const shown = useMemo(() => {
		const q = filter.trim().toLowerCase()
		return items.filter(i => (tab === 'all' || GROUPS.find(g => g.tab === tab)?.kind === KIND_OF[i.type]) && (!q || `${i.name} ${i.source} ${i.publisher ?? ''}`.toLowerCase().includes(q)) && (!attentionOnly || needsUpdate(i) || needsReading(i)))
	}, [items, tab, filter, attentionOnly])

	const run = async (item: MarketplaceItem, action: 'update' | 'enable' | 'disable') => {
		setBusyKey(keyOf(item)); setError(null)
		try { await marketplace.performAction(action, item); await load() } catch (e) { setError(`Could not ${action === 'update' ? 'update' : action === 'enable' ? 'turn on' : 'turn off'} ${item.name}: ${e instanceof Error ? e.message : String(e)}`) } finally { setBusyKey(null) }
	}

	const opened = openKey ? items.find(i => keyOf(i) === openKey) : undefined
	if (opened) {
		return <div className='c fl' style={{ minHeight: 0, minWidth: 0, padding: '20px 32px 0' }}>
			<ItemPage item={opened} busy={busyKey === keyOf(opened)} error={error ?? undefined} onAction={() => { if (opened.installMethod) void marketplace.performAction(opened.installMethod, opened).then(load) }} onBack={() => setOpenKey(null)} />
		</div>
	}

	const bannerText = [
		updates.length > 0 ? `${plural(updates.length, 'update')} ${updates.length === 1 ? 'is' : 'are'} waiting.` : undefined,
		toRead.length > 0 ? `${toRead.length === 1 ? 'A skill' : `${toRead.length} skills`} that changed at ${toRead.length === 1 ? 'its' : 'their'} source stay${toRead.length === 1 ? 's' : ''} switched off until you read ${toRead.length === 1 ? 'it' : 'them'} again.` : undefined,
	].filter(Boolean).join(' ')

	return <div className='c fl' style={{ minHeight: 0, minWidth: 0 }} data-testid='vader-installed-page'>
		<div className='c' style={{ padding: '22px 32px 0', flex: 'none', gap: 14 }}>
			<div className='r' style={{ gap: 12 }}>
				<button className='ic' aria-label='Back to Add-ons' data-testid='vader-installed-back' onClick={onBack}><Icon k='left' small /></button>
				<span className='ttl'>Installed</span><span className='fl' />
				<label className='srch' style={{ width: 260, height: 32 }}>
					<Search style={{ width: 14, height: 14, flex: 'none' }} />
					<input data-testid='vader-installed-filter' className='fl' placeholder='Filter installed' aria-label='Filter installed' value={filter} onChange={e => setFilter(e.target.value)} />
				</label>
			</div>
			{attention > 0 ? <div className='r' role='status' data-testid='vader-installed-banner' style={{ gap: 12, minHeight: 44, padding: '0 14px', borderRadius: 8, border: '1px solid rgba(226,169,63,.35)', background: 'rgba(226,169,63,.07)' }}>
				<WarnTri />
				<span className='fl'>{bannerText}</span>
				<button className='gb' style={{ height: 28 }} data-testid='vader-installed-review' aria-pressed={attentionOnly} onClick={() => setAttentionOnly(v => !v)}>{attentionOnly ? 'Show all' : 'Review updates'}</button>
			</div> : null}
			<div className='r' style={{ borderBottom: '1px solid var(--ln)' }} role='tablist'>
				{TABS.map(t => <button key={t.id} role='tab' aria-selected={tab === t.id} data-testid={`vader-installed-tab-${t.id}`} className={tab === t.id ? 'tb on' : 'tb'} onClick={() => setTab(t.id)}>{t.label}</button>)}
				<span className='fl' />
			</div>
		</div>
		<div className='c fl scroll' style={{ padding: '8px 32px 24px', overflowY: 'auto', minHeight: 0, gap: 6 }}>
			{error ? <div role='alert' data-testid='vader-installed-error' className='r' style={{ gap: 10, color: 'var(--delt)', padding: '8px 0' }}><span className='fl'>{error}</span><button className='tx' onClick={() => setError(null)}>Dismiss</button></div> : null}
			{loading ? <div className='t3' style={{ padding: '24px 0' }}>Loading...</div> : null}
			{!loading && shown.length === 0 ? <div className='t3' style={{ padding: '24px 0' }}>{filter.trim() ? `Nothing installed matches "${filter.trim()}".` : attentionOnly ? 'Nothing is waiting.' : items.length === 0 ? 'Nothing is installed yet. Find skills, MCP servers, extensions and agents on the Add-ons page.' : 'Nothing of this kind is installed.'}</div> : null}
			{GROUPS.map(g => {
				const list = shown.filter(i => KIND_OF[i.type] === g.kind)
				if (list.length === 0) return null
				return <div key={g.kind} className='c' style={{ marginTop: 10 }}>
					<div className='r' style={{ height: 34, gap: 8 }}><span className='t1' data-testid='vader-installed-group' style={{ fontWeight: 600 }}>{g.title}</span><span className='t3'>{list.length}</span></div>
					{list.map(i => <Row key={keyOf(i)} item={i} busy={busyKey === keyOf(i)} onOpen={() => setOpenKey(keyOf(i))} onAct={a => void run(i, a)} onSwitch={on => void run(i, on ? 'enable' : 'disable')} />)}
				</div>
			})}
		</div>
	</div>
}
