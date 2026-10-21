/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { URI } from '../../../../../../../base/common/uri.js'
import { useAccessor, useChatThreadsState } from '../util/services.js'
import type { ConsoleLogEntry, NetworkEntry, PageErrorEntry, PageSummary } from '../../../../common/browser/browserToolServiceTypes.js'
import { browserActivity } from '../../../../common/shellModel.js'
import { Icon, Spinner } from './icons.js'
import { useShellData } from './useShellData.js'

// The page the agent opened (board R25, S14): the pages it has open, what it did there, a picture of the page as it is now, and the console, the network
// and the errors of the page. The agent's browser has no window of its own, so the picture is taken from the page every second and a half while this
// tab is open; Pause holds the agent and Open in my browser opens the same address in yours.

type Logs = { console: ConsoleLogEntry[], network: NetworkEntry[], errors: PageErrorEntry[] }
const NONE: Logs = { console: [], network: [], errors: [] }

export const BrowserView = () => {
	const accessor = useAccessor()
	const browser = accessor.get('IBrowserToolMainService')
	const chat = accessor.get('IChatThreadService')
	const opener = accessor.get('IOpenerService')
	const data = useShellData()
	const state = useChatThreadsState()
	const thread = data.all.find(t => t.id === data.currentId)
	const messages = thread ? state.allThreads[thread.id]?.messages ?? [] : []
	const did = browserActivity(messages)
	const pause = thread ? chat.getPause(thread.id) : undefined

	const [pages, setPages] = useState<PageSummary[]>([])
	const [pickedId, setPickedId] = useState<string | undefined>()
	const [shot, setShot] = useState<string | undefined>()
	const [logs, setLogs] = useState<Logs>(NONE)
	const [tab, setTab] = useState<'console' | 'network' | 'errors'>('console')
	const [failure, setFailure] = useState<string | undefined>()
	const [busy, setBusy] = useState(false)
	const alive = useRef(true)

	const open = pages.filter(p => !p.isClosed)
	const page = open.find(p => p.pageId === pickedId) ?? open.find(p => p.isActive) ?? open[0]

	const refresh = useCallback(async () => {
		try {
			const list = await browser.listPages()
			if (!alive.current) return
			setPages(list)
			const cur = list.filter(p => !p.isClosed)
			const target = cur.find(p => p.pageId === pickedId) ?? cur.find(p => p.isActive) ?? cur[0]
			if (!target) { setShot(undefined); setLogs(NONE); setFailure(undefined); return }
			const [png, c, n, e] = await Promise.all([browser.screenshot(target.pageId), browser.consoleLogs(target.pageId), browser.networkLog(target.pageId), browser.pageErrors(target.pageId)])
			if (!alive.current) return
			setShot(png ? `data:image/png;base64,${png}` : undefined)
			setLogs({ console: c, network: n, errors: e })
			setFailure(undefined)
		} catch (err) {
			if (alive.current) setFailure(err instanceof Error ? err.message : String(err))
		}
	}, [browser, pickedId])

	useEffect(() => {
		alive.current = true
		void refresh()
		const t = setInterval(() => { void refresh() }, 1500)
		return () => { alive.current = false; clearInterval(t) }
	}, [refresh])

	const reload = async () => {
		if (!page) return
		setBusy(true)
		try { await browser.reload(page.pageId); await refresh() } catch (e) { setFailure(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
	}
	const running = thread?.status === 'running' || thread?.status === 'paused'
	const counts = { console: logs.console.length, network: logs.network.length, errors: logs.errors.length }
	const rows: { time?: string, kind: string, text: string, bad?: boolean }[] = tab === 'console'
		? logs.console.map(l => ({ kind: l.type, text: l.text, bad: l.type === 'error' || l.type === 'warning' }))
		: tab === 'network' ? logs.network.map(n => ({ kind: n.method, text: `${n.status ?? 'failed'} ${n.url}${n.failureText ? ` (${n.failureText})` : ''}`, bad: n.status === null || (n.status !== null && n.status >= 400) }))
			: logs.errors.map(e => ({ kind: 'error', text: e.message, bad: true }))

	return <div className='c fl' style={{ minHeight: 0 }} data-testid='vader-shell-browser-view'>
		{/* who has the page */}
		{page && running ? <div className='r' style={{ height: 44, padding: '0 20px', gap: 12, flex: 'none', background: 'var(--g2)', borderBottom: '1px solid var(--ln)' }} data-testid='vader-browser-banner'>
			{thread?.status === 'running' ? <Spinner /> : null}
			<span className='t1' style={{ fontWeight: 500 }}>{pause ? 'The agent is paused' : 'The agent is using this page'}</span>
			<span className='hint fl tr'>It can click and type here. It cannot reach pages outside the sites it was told to visit.</span>
			{thread ? <button className='gb' data-testid='vader-browser-pause' onClick={() => pause ? chat.resumeRun(thread.id) : chat.pauseRun(thread.id)}>{pause ? 'Resume' : 'Pause'}</button> : null}
			{thread ? <button className='gb' data-testid='vader-browser-stop' onClick={() => { void accessor.get('IAgentGatewayService').cancelTask(thread.id) }}>Stop</button> : null}
		</div> : null}

		<div className='r fl' style={{ minHeight: 0, alignItems: 'stretch' }}>
			{/* the pages, and what was done there */}
			<div className='c' style={{ width: 250, flex: 'none', borderRight: '1px solid var(--ln)', padding: '12px 10px', gap: 4, minHeight: 0, overflow: 'hidden' }}>
				<span className='hint' style={{ padding: '0 8px 4px' }}>Pages the agent opened</span>
				{open.length === 0 ? <span className='t3' style={{ padding: '4px 8px' }}>None yet.</span> : null}
				{open.map(p => <button key={p.pageId} className={p.pageId === page?.pageId ? 'fr on' : 'fr'} data-testid='vader-browser-page' onClick={() => setPickedId(p.pageId)} title={p.url}>
					<span className='fl tr'>{p.title || p.url || 'Blank page'}</span>
				</button>)}
				<span className='hint' style={{ padding: '14px 8px 4px' }}>What it did here</span>
				<div className='c scroll' style={{ gap: 3, padding: '0 8px' }} data-testid='vader-browser-did'>
					{did.length === 0 ? <span className='t3'>Nothing yet.</span> : did.map((a, i) => <span key={i} className='r' style={{ gap: 8, minWidth: 0 }}><span className='t3' style={{ width: 62, flex: 'none' }}>{a.verb.split(' ')[0]}</span><span className='mo t2 tr'>{a.verb.split(' ').slice(1).join(' ')} {a.target}</span></span>)}
				</div>
			</div>

			{/* the page */}
			<div className='c fl' style={{ minWidth: 0, minHeight: 0 }}>
				<div className='r' style={{ height: 52, padding: '0 16px', gap: 10, flex: 'none' }}>
					<button className='ic' title='Reload' aria-label='Reload the page' data-testid='vader-browser-reload' disabled={!page || busy} onClick={() => void reload()}><Icon k='refresh' /></button>
					<span className='fld fl mo tr' data-testid='vader-browser-url' style={{ background: 'var(--g0)' }}>{page?.url ?? ''}</span>
					<button className='gb' data-testid='vader-browser-open-mine' disabled={!page?.url} onClick={() => { if (page?.url) { try { void opener.open(URI.parse(page.url)) } catch { /* not an address */ } } }}>Open in my browser</button>
				</div>
				<div className='fl' style={{ minHeight: 0, padding: '0 16px 16px', display: 'flex' }}>
					{failure ? <div className='c' style={{ margin: 'auto', width: 440, gap: 10 }} data-testid='vader-browser-failure'>
						<span className='t1' style={{ fontWeight: 600 }}>The agent&apos;s browser did not answer</span>
						<span className='t2' style={{ lineHeight: 1.55 }}>{failure}</span>
						<span><button className='gb' onClick={() => void refresh()}>Try again</button></span>
					</div> : !page ? <div className='c' style={{ margin: 'auto', width: 400, gap: 8 }} data-testid='vader-browser-empty'>
						<span className='t1' style={{ fontWeight: 600 }}>The agent has not opened a page in this task</span>
						<span className='t2' style={{ lineHeight: 1.55 }}>When it opens one, it appears here, with what the page printed and what it asked for.</span>
					</div> : shot ? <img data-testid='vader-browser-shot' src={shot} alt={page.title || page.url} style={{ maxWidth: '100%', maxHeight: '100%', margin: 'auto', borderRadius: 8, background: '#fff', objectFit: 'contain' }} />
						: <div className='r t3' style={{ margin: 'auto', gap: 8 }}><Spinner />Loading the page</div>}
				</div>
			</div>

			{/* what the page printed */}
			<div className='c' style={{ width: 330, flex: 'none', borderLeft: '1px solid var(--ln)', minHeight: 0 }}>
				<div className='r' style={{ height: 44, padding: '0 16px', gap: 16, flex: 'none', borderBottom: '1px solid var(--ln)' }} role='tablist'>
					{(['console', 'network', 'errors'] as const).map(t => <button key={t} role='tab' aria-selected={tab === t} data-testid={`vader-browser-tab-${t}`} className={tab === t ? 't1' : 't3'} style={tab === t ? { paddingBottom: 1, borderBottom: '1px solid var(--ac)' } : undefined} onClick={() => setTab(t)}>{t === 'console' ? 'Console' : t === 'network' ? 'Network' : 'Errors'} <span style={{ opacity: .7 }}>{counts[t]}</span></button>)}
				</div>
				<div className='c fl scroll' style={{ padding: '10px 16px', gap: 8 }} data-testid='vader-browser-log'>
					{rows.length === 0 ? <span className='t3'>Nothing here.</span> : rows.slice(-200).map((r, i) => <div key={i} className='c' style={{ gap: 1 }}><span className='mo t4' style={{ fontSize: 11 }}>{r.kind}</span><span className='mo' style={{ color: r.bad ? '#e2a93f' : 'var(--t1)', overflowWrap: 'anywhere' }}>{r.text}</span></div>)}
				</div>
			</div>
		</div>
	</div>
}
