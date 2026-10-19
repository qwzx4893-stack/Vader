/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useMemo, useState } from 'react'
import { useAccessor, useChatThreadsState, useOrchestrationRunsState } from '../util/services.js'
import { ParallelRuns } from './ParallelRuns.js'
import { AGENT_GROUP_ORDER, AGENT_GROUP_TITLE, AgentGroupId, latestTaskList, recentActivity } from '../../../../common/shellModel.js'
import { formatCost, formatUsd } from '../../../../common/usageAccounting.js'
import { Icon, ReviewRing, Spinner, WaitDot } from './icons.js'
import { ShellThread, useShellData } from './useShellData.js'

// All agents (board R04): every agent task in one table, grouped by where it stands, with the cost and the changes of each, and on the right what the
// chosen one has just done. The table is empty-state aware (board S09, "All agents, none running").

type Filter = 'all' | AgentGroupId

const COLS = '16px minmax(0,1fr) 156px 112px 58px 96px 70px 36px'

const Glyph = ({ t }: { t: ShellThread }) =>
	t.status === 'running' ? <Spinner /> : t.status === 'needs_you' ? <WaitDot /> : t.status === 'review' ? <ReviewRing />
		: t.status === 'error' ? <svg width='14' height='14' viewBox='0 0 15 15' aria-label='Stopped by an error' style={{ flex: 'none' }}><path d='M7.5 2.2 13.3 12.6H1.7z' fill='none' stroke='#f2a3a6' strokeWidth='1.3' strokeLinejoin='round' /></svg>
			: t.status === 'paused' ? <svg width='14' height='14' viewBox='0 0 14 14' aria-label='Paused' style={{ flex: 'none' }}><path d='M5 3.5v7M9 3.5v7' stroke='#8a8a91' strokeWidth='1.5' strokeLinecap='round' /></svg>
				: <svg width='14' height='14' viewBox='0 0 15 15' aria-label='Finished' style={{ flex: 'none' }}><path d='m4.4 7.6 2.2 2.1 4-4.2' fill='none' stroke='#5f5f5f' strokeWidth='1.3' strokeLinecap='round' strokeLinejoin='round' /></svg>

export const AgentsPage = () => {
	const accessor = useAccessor()
	const chat = accessor.get('IChatThreadService')
	const shellService = accessor.get('IVaderShellService')
	const state = useChatThreadsState()
	const data = useShellData()
	const runs = useOrchestrationRunsState()
	const [filter, setFilter] = useState<Filter>('all')
	const [q, setQ] = useState('')
	const [picked, setPicked] = useState<string | undefined>(undefined)
	const [closed, setClosed] = useState<Partial<Record<AgentGroupId, boolean>>>({})

	const query = q.trim().toLowerCase()
	const tasks = data.tasks.filter(t => !query || t.title.toLowerCase().includes(query))
	const counts: Record<AgentGroupId, number> = { needs_you: 0, running: 0, review: 0, merged: 0 }
	for (const t of data.tasks) counts[t.group]++
	const selected = data.tasks.find(t => t.id === picked) ?? tasks.find(t => t.group === 'needs_you') ?? tasks[0]
	const today = chat.getUsageToday()
	const limit = accessor.get('IVaderSettingsService').state.globalSettings.dailySpendLimitUsd ?? null

	const open = (id: string) => { chat.switchToThread(id); shellService.show('conversation') }

	const groups = useMemo(() => AGENT_GROUP_ORDER.map(id => ({ id, list: tasks.filter(t => t.group === id) })).filter(g => g.list.length > 0 && (filter === 'all' || filter === g.id)), [tasks, filter])

	const detail = selected ? (() => {
		const thread = state.allThreads[selected.id]
		const plan = thread ? latestTaskList(thread.messages) : undefined
		const acts = thread ? recentActivity(thread.messages, 3) : []
		return { plan, acts }
	})() : undefined

	return <div className='c fl' style={{ minHeight: 0 }} data-testid='vader-shell-agents-page'>
		<div className='r' style={{ height: 52, padding: '0 24px', gap: 22, flex: 'none', borderBottom: '1px solid var(--ln)' }}>
			<span className='t1' style={{ fontSize: 15, fontWeight: 600 }}>Agents</span>
			<div className='r fl' style={{ gap: 20 }}>
				<button className={filter === 'all' ? 't1' : 't3'} style={filter === 'all' ? { paddingBottom: 1, borderBottom: '1px solid var(--ac)' } : undefined} data-testid='vader-shell-agents-tab-all' onClick={() => setFilter('all')}>All <span className='t3'>{data.tasks.length}</span></button>
				{AGENT_GROUP_ORDER.filter(g => g !== 'merged').map(g => <button key={g} className={filter === g ? 't1' : 't3'} style={filter === g ? { paddingBottom: 1, borderBottom: '1px solid var(--ac)' } : undefined} data-testid={`vader-shell-agents-tab-${g}`} onClick={() => setFilter(g)}>{AGENT_GROUP_TITLE[g]} <span style={{ opacity: .7 }}>{counts[g]}</span></button>)}
			</div>
			<label className='r t3' style={{ width: 220, height: 28, padding: '0 10px', gap: 8, border: '1px solid var(--ln2)', borderRadius: 6 }}>
				<Icon k='search' small /><input className='fl' data-testid='vader-shell-agents-filter' placeholder='Filter by task' value={q} onChange={e => setQ(e.target.value)} />
			</label>
			<button className='pb' data-testid='vader-shell-agents-new' onClick={() => { chat.openNewThread(); shellService.show('conversation', 'conversation') }}><Icon k='plus' small />New agent</button>
		</div>

		{runs.length > 0 ? <div className='scroll' style={{ flex: 'none', maxHeight: '52%', borderBottom: '1px solid var(--ln)' }}><ParallelRuns /></div> : null}

		{data.tasks.length === 0 && runs.length === 0 ? <div className='c' style={{ margin: 'auto', width: 360, gap: 10 }} data-testid='vader-shell-agents-empty'>
			<span className='t1' style={{ fontSize: 17, fontWeight: 600 }}>No agents are running</span>
			<span className='t2' style={{ lineHeight: 1.55 }}>Tasks you start, and the ones you finished this week, are listed here with their cost and changes.</span>
			<span className='r' style={{ gap: 8, marginTop: 6 }}><button className='pb' onClick={() => { chat.openNewThread(); shellService.show('conversation', 'conversation') }}>Start a task</button></span>
		</div> : <div className='r fl' style={{ minHeight: 0, alignItems: 'stretch' }}>
			<div className='c fl scroll' style={{ minWidth: 0 }}>
				<div className='th' style={{ gridTemplateColumns: COLS }}><span></span><span>Task</span><span>Branch</span><span>Model</span><span>Steps</span><span>Changes</span><span>Cost</span><span style={{ textAlign: 'right' }}>Age</span></div>
				{data.needsYou.length === 0 && filter === 'all' ? <div className='r t3' style={{ height: 36, padding: '0 14px', gap: 8 }} data-testid='vader-shell-agents-calm'><span className='dot' style={{ background: '#4cc38a' }} />Nothing is waiting for you.</div> : null}
				{groups.map(g => <React.Fragment key={g.id}>
					<button className='r t3' style={{ height: 30, padding: '0 14px', gap: 8, fontSize: 12, fontWeight: 500, marginTop: 6, width: '100%' }} data-testid={`vader-shell-agents-group-${g.id}`} onClick={() => setClosed(c => ({ ...c, [g.id]: !c[g.id] }))}>
						<Icon k={closed[g.id] ? 'right' : 'down'} small />{AGENT_GROUP_TITLE[g.id]}<span style={{ opacity: .7 }}>{g.list.length}</span>
					</button>
					{closed[g.id] ? null : g.list.map(t => {
						const th = state.allThreads[t.id]
						const plan = th ? latestTaskList(th.messages) : undefined
						const cost = t.usage && t.usage.turns > 0 ? formatCost(t.usage.costUsd, t.usage.billedCostUsd) : ''
						return <button key={t.id} className={t.id === selected?.id ? 'td on' : 'td'} style={{ gridTemplateColumns: COLS, width: '100%' }} data-testid='vader-shell-agent-row' data-thread-id={t.id} data-status={t.status} onClick={() => setPicked(t.id)} onDoubleClick={() => open(t.id)}>
							<Glyph t={t} />
							<span className={g.id === 'merged' ? 't2 tr' : 't1 tr'}>{t.title}</span>
							<span className='tr t3 mo' data-testid='vader-shell-agent-branch'>{t.copy ? (t.copy.merged ? t.copy.base : t.copy.branch) : t.changedFiles.length > 0 ? 'in place' : ''}</span>
							<span className='tr t3'>{accessor.get('IVaderSettingsService').state.modelSelectionOfFeature?.Chat?.modelName ?? ''}</span>
							<span>{plan ? (plan.done >= plan.total ? 'done' : `${plan.done} of ${plan.total}`) : g.id === 'merged' || g.id === 'review' ? 'done' : ''}</span>
							<span data-testid='vader-shell-agent-changes'>{t.copy && (t.copy.added !== undefined || t.copy.removed !== undefined) && t.copy.files > 0 ? <span className='mo'><span style={{ color: '#4cc38a' }}>+{t.copy.added ?? 0}</span> <span style={{ color: '#f06a6e' }}>{'\u2212'}{t.copy.removed ?? 0}</span></span> : t.changedFiles.length > 0 || (t.copy && t.copy.files > 0) ? <span className='t2'>{t.copy && t.copy.files > 0 ? t.copy.files : t.changedFiles.length} file{(t.copy && t.copy.files > 0 ? t.copy.files : t.changedFiles.length) === 1 ? '' : 's'}</span> : <span className='t3'>no changes</span>}</span>
							<span className='t2'>{cost}</span>
							<span className='t3' style={{ textAlign: 'right' }}>{t.age}</span>
						</button>
					})}
				</React.Fragment>)}
				{tasks.length === 0 && query ? <div className='c' style={{ padding: 24, gap: 6 }}><span className='t2'>No task matches &ldquo;{q.trim()}&rdquo;.</span><button className='tx' style={{ alignSelf: 'flex-start', padding: 0 }} onClick={() => setQ('')}>Clear</button></div> : null}
			</div>

			{selected ? <div className='c' style={{ width: 320, flex: 'none', borderLeft: '1px solid var(--ln)', padding: '16px 18px', gap: 14, minHeight: 0 }} data-testid='vader-shell-agent-detail'>
				<div className='c' style={{ gap: 2 }}>
					<span className='t1' style={{ fontSize: 13.5, fontWeight: 500 }}>{selected.title}</span>
					<span className='t3'>{selected.status === 'needs_you' ? 'Waiting for you' : selected.status === 'running' ? 'Working' : selected.status === 'paused' ? 'Paused' : selected.status === 'error' ? 'Stopped by an error' : selected.status === 'review' ? 'Ready to review' : 'Finished'}</span>
				</div>
				{detail && detail.acts.length > 0 ? <div className='c' style={{ gap: 4 }}>
					<span className='hint'>Latest</span>
					{detail.acts.map((a, i) => <span key={i} className='r' style={{ gap: 10 }}><span className='t3' style={{ width: 62 }}>{a.verb}</span><span className='mo t1 tr'>{a.target}</span></span>)}
				</div> : null}
				{detail?.plan ? <div className='c' style={{ gap: 4 }}>
					<span className='hint'>Plan {detail.plan.done} of {detail.plan.total}</span>
					{detail.plan.tasks.slice(0, 6).map((t, i) => <span key={i} className={t.status === 'done' ? 't3 tr' : 't1 tr'}>{t.status === 'done' ? '✓ ' : t.status === 'in_progress' ? '○ ' : '  '}{t.text}</span>)}
				</div> : null}
				{selected.copy && !selected.copy.merged ? <div className='c' style={{ gap: 4 }} data-testid='vader-shell-agent-worktree'>
<span className='hint'>Worktree</span>
<span className='mo t1' style={{ wordBreak: 'break-all' }}>{selected.copy.worktreePath}</span>
<span className='t3'>{selected.copy.files} file{selected.copy.files === 1 ? '' : 's'} changed, branched from {selected.copy.base}</span>
</div> : selected.changedFiles.length > 0 ? <span className='t2'>{selected.changedFiles.length} file{selected.changedFiles.length === 1 ? '' : 's'} changed</span> : null}
				<span className='fl' />
				<div className='c' style={{ gap: 6 }}>
					<div className='r t3' style={{ justifyContent: 'space-between' }}><span>Spent today</span><span>{today.costUsd > 0 ? `≈ ${formatUsd(today.costUsd)}${limit ? ` of ${formatUsd(limit)}` : ''}` : 'nothing yet'}</span></div>
					{limit ? <div style={{ height: 2, background: 'var(--ln2)', borderRadius: 1 }}><div style={{ width: `${Math.min(100, (today.costUsd / limit) * 100)}%`, height: 2, background: 'var(--t2)', borderRadius: 1 }} /></div> : null}
				</div>
				<div className='r' style={{ gap: 8 }}>
					<button className='pb' data-testid='vader-shell-agent-open' onClick={() => open(selected.id)}>Open</button>
					{selected.changedFiles.length > 0 ? <button className='gb' data-testid='vader-shell-agent-review' onClick={() => { chat.switchToThread(selected.id); shellService.show('conversation', 'review') }}>Review changes</button> : null}
				</div>
			</div> : null}
		</div>}
	</div>
}
