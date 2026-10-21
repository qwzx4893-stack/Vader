/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useMemo, useState } from 'react'
import { URI } from '../../../../../../../base/common/uri.js'
import { StorageScope } from '../../../../../../../platform/storage/common/storage.js'
import { useAccessor, useSettingsState, useSkillsState } from '../util/services.js'
import { VADER_OPEN_ADDONS_ACTION_ID } from '../../../actionIDs.js'
import { computeTrust, skillAsks, trustLevelOf } from '../../../../common/marketplace/trustScore.js'
import { ADDON_SOURCES, AddonSourceKind, isSourceOn } from '../../../../common/marketplace/addonSources.js'
import { parseTrustHistory, TRUST_HISTORY_STORAGE_KEY } from '../../../../common/marketplace/trustHistory.js'
import { SkillRecord } from '../../../../common/skills/skillServiceTypes.js'
import { Icon } from '../vader-shell-tsx/icons.js'
import { ProviderLogo } from '../util/ProviderLogo.js'
import { PUBLISHER_MARK } from '../vader-marketplace-tsx/ItemPage.js'
import { Note, PageHead, Switch } from './ui.js'

// Skills (board R15): the skills this computer has. Switch them on and off, read them, mark them trusted or block them, remove them. Every skill starts off and
// "needs review": it is written instructions the agent follows, so it is read before it is trusted. A skill that changes at its source goes back to needing review.
// The trust number is computed from live facts (who published it, what it asks for, what its text says); the reasons are listed, and your own decision always wins.

const ownerOf = (url: string | undefined) => { try { if (!url) return undefined; const u = new URL(url); return u.hostname === 'github.com' ? u.pathname.split('/').filter(Boolean)[0] : undefined } catch { return undefined } }
const repoOf = (url: string | undefined) => { try { if (!url) return undefined; const u = new URL(url); return u.hostname === 'github.com' ? u.pathname.split('/').filter(Boolean).slice(0, 2).join('/') : u.host } catch { return undefined } }
const LEVEL_COLOR = { high: '#4cc38a', medium: '#e2a93f', low: '#f06a6e' } as const
const asksOf = (s: SkillRecord) => { const c = s.requestedCapabilities; const l = [c.fs && 'Files', c.terminal && 'Terminal', c.network && 'Network', c.mcp && 'MCP'].filter(Boolean) as string[]; return l.length ? l.join(', ') : 'Nothing special' }
const ago = (t: number) => { const d = Math.floor((Date.now() - t) / 86_400_000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 7 ? `${d} days ago` : new Date(t).toLocaleDateString() }

const SourcesTab = () => {
	const accessor = useAccessor()
	const skills = accessor.get('ISkillService')
	const opener = accessor.get('IOpenerService')
	const settings = accessor.get('IVaderSettingsService')
	const off = useSettingsState().globalSettings.addonSourcesOff ?? []
	useSkillsState() // sources changes fire the same event as skills do
	const repos = skills.listSources()
	const [text, setText] = useState('')
	const [problem, setProblem] = useState('')
	const add = () => { if (!text.trim()) return; if (skills.addSource(text)) { setText(''); setProblem('') } else setProblem('That is not a GitHub repository. Use owner/repo or an address that starts with https://github.com/.') }
	const kinds: AddonSourceKind[] = ['skill']
	return <div className='c' style={{ gap: 26 }} data-testid='vader-skills-sources'>
		<div className='c'>
			<span className='t1' style={{ fontWeight: 600 }}>Where Add-ons looks</span>
			<span className='hint' style={{ padding: '2px 0 8px', maxWidth: 560, lineHeight: 1.5 }}>Add-ons asks these live sources when you open it or search. A source you switch off is not asked; what you installed from it stays. Only your search words are sent, never anything from your project.</span>
			{ADDON_SOURCES.filter(s => kinds.includes(s.kind)).map(s => <div key={s.id} className='r' data-testid='vader-skills-source' style={{ gap: 14, minHeight: 48, padding: '6px 0', borderTop: '1px solid var(--ln)' }}>
				<div className='c fl' style={{ minWidth: 0 }}><span className='t1'>{s.label}</span><span className='hint'>{s.hint} <span className='mo'>{s.host}</span></span></div>
				{s.fixed ? <span className='hint'>Always on</span> : <Switch on={isSourceOn(off, s.id)} label={`Ask ${s.label}`} testId={`vader-skills-source-${s.id}`} onChange={v => settings.setGlobalSetting('addonSourcesOff', v ? off.filter((x: string) => x !== s.id) : [...off.filter((x: string) => x !== s.id), s.id])} />}
			</div>)}
		</div>
		<div className='c'>
			<span className='t1' style={{ fontWeight: 600 }}>GitHub repositories of skills</span>
			<span className='hint' style={{ padding: '2px 0 8px', maxWidth: 560, lineHeight: 1.5 }}>Add-ons lists every skill it finds in these repositories. Add your own below.</span>
			{repos.length === 0 ? <span className='t3' style={{ padding: '10px 0', borderTop: '1px solid var(--ln)' }}>No repositories yet. Add one below.</span> : null}
			{repos.map(r => <div key={r} className='r' data-testid='vader-skills-repo' style={{ gap: 10, minHeight: 44, borderTop: '1px solid var(--ln)' }}><span className='mo t1 fl'>{r}</span><button className='tx' onClick={() => { void opener.open(URI.parse(`https://github.com/${r}`)) }}>Open on GitHub</button><button className='tx' data-testid='vader-skills-repo-remove' onClick={() => skills.removeSource(r)}>Remove</button></div>)}
			<div className='r' style={{ gap: 8, paddingTop: 12, borderTop: '1px solid var(--ln)' }}>
				<input className='fld fl' data-testid='vader-skills-repo-input' aria-label='Repository' placeholder='A GitHub address' value={text} onChange={e => { setText(e.target.value); setProblem('') }} onKeyDown={e => { if (e.key === 'Enter') add() }} />
				<button className='pb' data-testid='vader-skills-repo-add' disabled={!text.trim()} onClick={add}>Add repository</button>
			</div>
			{problem ? <div style={{ paddingTop: 8 }}><Note kind='warn' testId='vader-skills-repo-problem'>{problem}</Note></div> : null}
		</div>
	</div>
}

export const SkillsPage = () => {
	const accessor = useAccessor()
	const service = accessor.get('ISkillService')
	const commands = accessor.get('ICommandService')
	const skills = useSkillsState()
	const [tab, setTab] = useState<'installed' | 'sources'>('installed')
	const [filter, setFilter] = useState('')
	const [open, setOpen] = useState<string | undefined>()
	// what the trust monitor saw the first time it scored each skill; it scores them again from live data every few hours
	const history = useMemo(() => { try { return parseTrustHistory(JSON.parse(accessor.get('IStorageService').get(TRUST_HISTORY_STORAGE_KEY, StorageScope.APPLICATION) ?? 'null')) } catch { return {} } }, [accessor, skills])
	const needle = filter.trim().toLowerCase()
	const shown = skills.filter(s => !needle || (s.name + ' ' + s.description + ' ' + (repoOf(s.source.repositoryUrl) ?? '')).toLowerCase().includes(needle))

	return <div data-testid='vader-settings-skills'>
		<PageHead title='Skills' desc='The skills this computer has: switch them on and off, read them, remove them. To find new ones, use Add-ons in the sidebar.' right={<button className='gb' data-testid='vader-skills-browse' onClick={() => { void commands.executeCommand(VADER_OPEN_ADDONS_ACTION_ID) }}>Browse skills in Add-ons<Icon k='right' small /></button>} />
		<div className='r' role='tablist' style={{ gap: 20, borderBottom: '1px solid var(--ln)', height: 38, marginBottom: 14 }}>
			{([['installed', `Installed${skills.length ? ' ' + skills.length : ''}`], ['sources', 'Sources']] as const).map(([id, label]) => <button key={id} role='tab' aria-selected={tab === id} data-testid={`vader-skills-tab-${id}`} className={tab === id ? 'tb on' : 'tb'} style={{ margin: 0 }} onClick={() => setTab(id)}>{label}</button>)}
		</div>

		{tab === 'sources' ? <SourcesTab /> : skills.length === 0 ? <div className='c' style={{ gap: 6, padding: '18px 0' }} data-testid='vader-skills-empty'><span className='t1' style={{ fontWeight: 600 }}>No skill is installed</span><span className='t2' style={{ lineHeight: 1.55, maxWidth: 520 }}>A skill is written instructions the agent follows when a task matches. Find some in Add-ons. Each one starts switched off, and you read it before you trust it.</span><span><button className='pb' onClick={() => { void commands.executeCommand(VADER_OPEN_ADDONS_ACTION_ID) }}>Open Add-ons</button></span></div> : <>
			<div className='r' style={{ gap: 14, paddingBottom: 10 }}>
				<span className='hint fl' style={{ lineHeight: 1.5 }}>A skill that changes at its source is switched back to &ldquo;needs review&rdquo; until you read it again.</span>
				<label className='srch' style={{ width: 240 }}><Icon k='search' small /><input data-testid='vader-skills-filter' className='fl' placeholder='Filter installed' aria-label='Filter installed skills' value={filter} onChange={e => setFilter(e.target.value)} /></label>
			</div>
			<div className='th' style={{ gridTemplateColumns: '44px minmax(0,1fr) 190px 130px 58px 78px', padding: '0 2px', borderBottom: '1px solid var(--ln)' }}><span /><span>Skill</span><span>Trust</span><span>Asks for</span><span>On</span><span /></div>
			{shown.length === 0 ? <span className='t3' style={{ padding: '14px 2px' }} data-testid='vader-skills-nomatch'>No installed skill matches that.</span> : null}
			{shown.map(s => {
				const trust = computeTrust({ kind: 'skill', name: s.name, publisher: ownerOf(s.source.repositoryUrl), instructions: s.instructions, userTrustState: s.trustState })
				const level = trustLevelOf(trust.score)
				const blocked = s.trustState === 'blocked'
				const h = history['skills:' + s.id]
				const isOpen = open === s.id
				const asks = skillAsks(s.instructions)
				return <div key={s.id} data-testid='vader-skills-row' data-skill={s.name} data-trust={s.trustState} style={{ borderBottom: '1px solid var(--ln)' }}>
					<div className='td' style={{ gridTemplateColumns: '44px minmax(0,1fr) 190px 130px 58px 78px', height: 64, padding: '0 2px', borderBottom: 0 }}>
						<span className='logo sm'>{PUBLISHER_MARK[(ownerOf(s.source.repositoryUrl) ?? '').toLowerCase()] ? <ProviderLogo providerName={PUBLISHER_MARK[(ownerOf(s.source.repositoryUrl) ?? '').toLowerCase()]} size={16} /> : <Icon k='file' />}</span>
						<button className='c' style={{ minWidth: 0, gap: 1 }} aria-expanded={isOpen} data-testid='vader-skills-expand' onClick={() => setOpen(isOpen ? undefined : s.id)}>
							<span className='t1' style={{ fontWeight: 600 }}>{s.name}</span>
							<span className='hint tr'>{repoOf(s.source.repositoryUrl) ?? 'written by the agent'}{s.source.version ? ` · ${s.source.version}` : ''}, installed {ago(s.installedAt)}</span>
						</button>
						<span className='r' style={{ gap: 8 }}><span className='dot' style={{ background: blocked ? '#f06a6e' : s.trustState === 'trusted' ? '#4cc38a' : '#e2a93f' }} /><span className='t2' data-testid='vader-skills-trust'>{s.trustState === 'trusted' ? 'Trusted' : blocked ? 'Blocked' : 'Needs review'} {blocked ? '' : `${trust.score}%`}</span></span>
						<span className='t2 tr'>{asksOf(s)}</span>
						<span><Switch on={s.enabled && !blocked} label={`${s.name} on`} testId='vader-skills-switch' onChange={v => { if (!blocked) service.setEnabled(s.id, v) }} /></span>
						<span className='r' style={{ justifyContent: 'flex-end' }}>{s.trustState === 'review_required'
							? <button className='gb' data-testid='vader-skills-read' onClick={() => setOpen(isOpen ? undefined : s.id)}>{isOpen ? 'Close' : 'Read'}</button>
							: blocked ? <button className='tx' data-testid='vader-skills-remove-row' onClick={() => { service.remove(s.id); setOpen(undefined) }}>Remove</button>
								: <button className='tx' data-testid='vader-skills-pin-row' title='A pinned skill is always given to the agent when it is on' aria-pressed={!!s.pinned} onClick={() => service.setPinned(s.id, !s.pinned)}>{s.pinned ? 'Unpin' : 'Pin'}</button>}</span>
					</div>
					{isOpen ? <div className='c' data-testid='vader-skills-detail' style={{ gap: 12, padding: '4px 2px 16px 58px' }}>
						<span className='t2' style={{ lineHeight: 1.5 }}>{s.description}</span>
						<div className='c' style={{ gap: 4 }}>
							<span className='hint'>Trust {trust.score}%, {level === 'high' ? 'high trust' : level === 'medium' ? 'read it first' : 'risky'}. Why:</span>
							{trust.factors.map(f => <span key={f.label} className='r' style={{ gap: 10 }} data-testid='vader-skills-factor'><span className='mo t3' style={{ width: 34, textAlign: 'right', color: f.points < 0 ? LEVEL_COLOR.low : f.points > 0 ? LEVEL_COLOR.high : undefined }}>{f.points > 0 ? '+' : ''}{f.points}</span><span className='t2'>{f.label}</span></span>)}
							{h ? <span className='hint' style={{ paddingTop: 4 }}>{h.score !== h.first ? `Scored ${h.score}% on ${new Date(h.at).toLocaleDateString()} from live data; it was ${h.first}% the first time.${h.against.length ? ' Against it: ' + h.against.slice(0, 3).join('; ') + '.' : ''}` : `Scored again from live data on ${new Date(h.at).toLocaleDateString()}: ${h.score}%.`}</span> : null}
						</div>
						<span className='hint'>Asks for: {[asks.fs && 'files', asks.terminal && 'the terminal', asks.network && 'the network', asks.mcp && 'MCP tools'].filter(Boolean).join(', ') || 'nothing special'}. The words of the skill, as the agent reads them:</span>
						<pre className='mo ta' data-testid='vader-skills-text' style={{ margin: 0, maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'text' }}>{s.instructions}</pre>
						<div className='r' style={{ gap: 8, flexWrap: 'wrap' }}>
							{s.trustState !== 'trusted' && !blocked ? <button className='pb' data-testid='vader-skills-trust-it' onClick={() => service.setTrustState(s.id, 'trusted')}>Mark trusted</button> : null}
							{s.trustState === 'trusted' ? <button className='gb' data-testid='vader-skills-revoke' onClick={() => service.setTrustState(s.id, 'review_required')}>Revoke trust</button> : null}
							{blocked ? <button className='gb' data-testid='vader-skills-unblock' onClick={() => service.setTrustState(s.id, 'review_required')}>Unblock</button> : <button className='gb' data-testid='vader-skills-block' onClick={() => service.setTrustState(s.id, 'blocked')}>Block</button>}
							<button className='gb' data-testid='vader-skills-pin' onClick={() => service.setPinned(s.id, !s.pinned)}>{s.pinned ? 'Unpin' : 'Pin'}</button>
							<button className='tx' style={{ color: 'var(--delt)' }} data-testid='vader-skills-remove' onClick={() => { service.remove(s.id); setOpen(undefined) }}>Remove</button>
						</div>
					</div> : null}
				</div>
			})}
			{skills.some(s => s.trustState === 'blocked') ? <span className='hint' style={{ paddingTop: 12 }}>A blocked skill is never given to the agent and cannot be switched on.</span> : null}
		</>}
	</div>
}
