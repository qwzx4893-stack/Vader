/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAccessor, useChatThreadsState } from '../util/services.js'
import { commandsLine, terminalActivity, terminalLabel, terminalNote } from '../../../../common/shellModel.js'
import { persistentTerminalNameOfId } from '../../../terminalToolService.js'
import { useShellData } from './useShellData.js'

// The terminals of a task (board R26, S14): the ones the agent started, with what ran in each and what they printed, the commands the task ran in all, and a line
// at the bottom where the person can type into the chosen terminal. What is typed there runs as the person, not as the agent, and the page says so.

const dot = (c: string) => <span className='dot' style={{ background: c }} />

export const TerminalView = () => {
	const accessor = useAccessor()
	const terminals = accessor.get('ITerminalToolService')
	const data = useShellData()
	const state = useChatThreadsState()
	const thread = data.all.find(t => t.id === data.currentId)
	const messages = thread ? state.allThreads[thread.id]?.messages ?? [] : []
	const activity = terminalActivity(messages)

	// persistent terminals the task used, and the ones that exist and the task did not start ("Yours")
	const ofTask = activity.terminals.filter(t => t.persistent)
	const yours = terminals.listPersistentTerminalIds().filter(id => !ofTask.some(t => t.id === id))
	const [picked, setPicked] = useState<string | undefined>()
	const currentId = picked ?? ofTask[0]?.id ?? yours[0]
	const current = ofTask.find(t => t.id === currentId)
	const [output, setOutput] = useState('')
	const [failure, setFailure] = useState<string | undefined>()
	const [line, setLine] = useState('')
	const [sending, setSending] = useState(false)
	const alive = useRef(true)
	const [, bump] = useState(0)

	const read = useCallback(async () => {
		if (!currentId) { setOutput(''); return }
		try {
			if (!terminals.persistentTerminalExists(currentId)) { setOutput(''); setFailure('This terminal was closed.'); return }
			const text = await terminals.readTerminal(currentId)
			if (alive.current) { setOutput(text); setFailure(undefined) }
		} catch (e) { if (alive.current) setFailure(e instanceof Error ? e.message : String(e)) }
	}, [terminals, currentId])
	useEffect(() => {
		alive.current = true
		void read()
		const t = setInterval(() => { void read(); bump(n => n + 1) }, 1200)
		return () => { alive.current = false; clearInterval(t) }
	}, [read])

	const exists = (id: string) => terminals.persistentTerminalExists(id)
	const send = async () => {
		const cmd = line.trim()
		if (!cmd || !currentId) return
		setSending(true)
		try { await terminals.runCommand(cmd, { type: 'persistent', persistentTerminalId: currentId }); setLine(''); await read() }
		catch (e) { setFailure(e instanceof Error ? e.message : String(e)) } finally { setSending(false) }
	}
	const stop = async () => { if (currentId) { try { await terminals.killPersistentTerminal(currentId) } catch { /* already gone */ } await read(); bump(n => n + 1) } }

	const empty = ofTask.length === 0 && yours.length === 0

	return <div className='r fl' style={{ minHeight: 0, alignItems: 'stretch' }} data-testid='vader-shell-terminal-view'>
		<div className='c' style={{ width: 260, flex: 'none', borderRight: '1px solid var(--ln)', padding: '12px 10px', minHeight: 0 }}>
			<span className='hint' style={{ padding: '0 8px 4px' }}>Terminals of this task</span>
			{ofTask.length === 0 ? <span className='t3' style={{ padding: '4px 8px' }}>The agent has not started one.</span> : null}
			{ofTask.map(t => {
				const last = t.runs[t.runs.length - 1]
				return <button key={t.id} className={t.id === currentId ? 'ag on' : 'ag'} style={{ height: 'auto', padding: '6px 10px', alignItems: 'flex-start' }} data-testid='vader-terminal-item' data-terminal-id={t.id} onClick={() => setPicked(t.id)}>
					<span style={{ paddingTop: 5 }}>{dot(!exists(t.id) ? 'rgba(255,255,255,.25)' : last?.status === 'running' ? '#6ea0ff' : last?.status === 'failed' ? '#f06a6e' : '#4cc38a')}</span>
					<span className='c fl' style={{ minWidth: 0 }}>
						<span className='tr' data-testid='vader-terminal-name'>{terminalLabel(t.runs) ?? persistentTerminalNameOfId(t.id)}</span>
						<span className='hint tr' title={last?.command}>{!exists(t.id) ? 'closed' : terminalNote(t.runs)}</span>
					</span>
				</button>
			})}
			{yours.length > 0 ? <><span className='hint' style={{ padding: '14px 8px 4px' }}>Yours</span>
				{yours.map(id => <button key={id} className={id === currentId ? 'ag on' : 'ag'} data-testid='vader-terminal-item' data-terminal-id={id} onClick={() => setPicked(id)}>{dot('rgba(255,255,255,.25)')}<span className='fl tr'>{persistentTerminalNameOfId(id)}</span></button>)}</> : null}
			<span className='fl' />
			<div className='c' style={{ padding: '10px 8px 0', gap: 3, borderTop: '1px solid var(--ln)' }} data-testid='vader-terminal-commands'>
				<span className='t1' style={{ fontWeight: 600 }}>Commands this task ran</span>
				<span className='hint' style={{ lineHeight: 1.5 }}>{commandsLine(activity)}</span>
			</div>
		</div>

		<div className='c fl' style={{ minWidth: 0, minHeight: 0 }}>
			{empty ? <div className='c' style={{ margin: 'auto', width: 400, gap: 8 }} data-testid='vader-terminal-empty'>
				<span className='t1' style={{ fontWeight: 600 }}>No terminal is open</span>
				<span className='t2' style={{ lineHeight: 1.55 }}>Commands the agent runs one at a time are shown in the conversation. A terminal it keeps open, such as a dev server, appears here.</span>
			</div> : <>
				<div className='r' style={{ height: 56, padding: '0 20px', gap: 12, flex: 'none', borderBottom: '1px solid var(--ln)' }}>
					<div className='c fl' style={{ minWidth: 0 }}>
						<span className='t1' style={{ fontWeight: 600 }}>{currentId ? (current ? terminalLabel(current.runs) : undefined) ?? persistentTerminalNameOfId(currentId) : ''}</span>
						<span className='hint tr mo'>{current?.runs[current.runs.length - 1]?.command ?? ''}</span>
					</div>
					{currentId && exists(currentId) ? <span className='r' style={{ gap: 7, border: '1px solid var(--ln2)', borderRadius: 14, padding: '3px 11px' }}>{dot('#6ea0ff')}<span className='t2'>Running</span></span> : <span className='t3'>Closed</span>}
					{currentId && exists(currentId) ? <button className='gb' data-testid='vader-terminal-stop' onClick={() => void stop()}>Stop it</button> : null}
				</div>
				<pre className='mo fl scroll' style={{ margin: 0, padding: '14px 20px', background: 'var(--g0)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.6, color: 'var(--t2)', userSelect: 'text' }} data-testid='vader-terminal-output'>{failure && !output ? failure : output || 'Nothing printed yet.'}</pre>
				<div className='r' style={{ padding: '10px 20px 14px', gap: 10, flex: 'none' }}>
					<input className='fld fl' style={{ height: 36, background: 'var(--g0)' }} data-testid='vader-terminal-input' disabled={!currentId || !exists(currentId) || sending}
						placeholder={current ? 'The agent started this terminal. Anything you type here runs as you, not as the agent.' : 'Anything you type here runs as you.'} value={line} onChange={e => setLine(e.target.value)}
						onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void send() } }} />
				</div>
			</>}
		</div>
	</div>
}
