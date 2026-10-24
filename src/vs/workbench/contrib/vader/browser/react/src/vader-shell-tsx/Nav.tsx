/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react'
import { useAccessor, useShellState } from '../util/services.js'
import { VADER_OPEN_SETTINGS_ACTION_ID } from '../../../actionIDs.js'
import { glyphOf } from '../../../../common/shellModel.js'
import { Icon, ReviewRing, Spinner, WaitDot, Gap } from './icons.js'
import { ShellThread, useShellData } from './useShellData.js'
import { platformOf } from './WindowStrip.js'

// The left side of the window (boards R01 and R03): new chat, search, all agents, what needs you, the projects with their conversations, the
// conversations that belong to no project, and Add-ons and Settings at the bottom.

const Glyph = ({ t }: { t: ShellThread }) => {
	const g = glyphOf(t.status)
	return g === 'running' ? <Spinner /> : g === 'needs_you' ? <WaitDot /> : g === 'review' ? <ReviewRing />
		: g === 'error' ? <svg width='14' height='14' viewBox='0 0 14 14' aria-label='Stopped by an error' style={{ flex: 'none' }}><circle cx='7' cy='7' r='3.2' fill='#f06a6e' /></svg>
			: g === 'paused' ? <svg width='14' height='14' viewBox='0 0 14 14' aria-label='Paused' style={{ flex: 'none' }}><path d='M5 3.5v7M9 3.5v7' stroke='#8a8a91' strokeWidth='1.5' strokeLinecap='round' /></svg>
				: <Gap />
}

export const ThreadRow = ({ t, selected, nested, onOpen }: { t: ShellThread, selected: boolean, nested?: boolean, onOpen: (id: string) => void }) =>
	<button
		className={selected ? 'ag on' : 'ag'}
		style={nested ? { paddingLeft: 30 } : undefined}
		data-testid='vader-shell-thread'
		data-thread-id={t.id}
		data-status={t.status}
		aria-current={selected ? 'true' : undefined}
		title={t.title}
		onClick={() => onOpen(t.id)}
	>
		<Glyph t={t} />
		<span className='fl tr'>{t.title}</span>
		<span className='m'>{t.age}</span>
	</button>

/** how many of the add-ons on this computer have an update waiting (an extension whose gallery lists a newer version); nothing is shown while there are none */
const useAddonUpdates = (): number => {
	const accessor = useAccessor()
	const marketplace = accessor.get('IUnifiedMarketplaceService')
	const [count, setCount] = useState(0)
	useEffect(() => {
		let live = true
		let looking = false
		const look = async () => {
			if (looking) return
			looking = true
			try {
				const items = await marketplace?.listInstalled?.()
				if (live && Array.isArray(items)) setCount(items.filter(i => i.installMethod === 'update').length)
			} catch { /* a source that cannot be asked is not an update */ }
			finally { looking = false }
		}
		void look()
		const timer = setInterval(() => { void look() }, 10 * 60_000)
		return () => { live = false; clearInterval(timer) }
	}, [marketplace])
	return count
}

export const Nav = () => {
	const accessor = useAccessor()
	const chat = accessor.get('IChatThreadService')
	const commands = accessor.get('ICommandService')
	const shellService = accessor.get('IVaderShellService')
	const shell = useShellState()
	const data = useShellData()
	const updates = useAddonUpdates()
	const [closed, setClosed] = useState<Record<string, boolean | undefined>>({})
	const [openError, setOpenError] = useState<string>()
	useEffect(() => { setClosed(c => ({ ...c, [data.currentProjectKey ?? '__chats__']: false })) }, [data.currentProjectKey])

	const open = (id: string) => {
		setOpenError(undefined)
		void shellService.openThread(id).catch(e => setOpenError(e instanceof Error ? e.message : 'The project did not open. Try again or choose another folder.'))
	}
	const onConversation = shell.page === 'conversation'
	const projects = data.groups.filter(g => g.key !== null)
	const chats = data.groups.find(g => g.key === null)
	const isOpen = (key: string | null) => closed[key ?? '__chats__'] === undefined ? key === data.currentProjectKey : !closed[key ?? '__chats__']
	const toggle = (key: string | null) => setClosed(c => ({ ...c, [key ?? '__chats__']: isOpen(key) }))

	return <div className='c' style={{ width: 264, flex: 'none', padding: `${platformOf() === 'other' ? 8 : 2}px 8px 10px`, overflow: 'hidden' }} data-testid='vader-shell-nav'>
		<button className='nv t1' data-testid='vader-shell-new-chat' onClick={() => { chat.openNewThread(); shellService.show('conversation', 'conversation') }}>
			<Icon k='plus' /><span className='fl'>New chat</span><span className='t4 sm'>Ctrl N</span>
		</button>
		<button className='nv' data-testid='vader-shell-search' onClick={() => shellService.setSearchOpen(true)}>
			<Icon k='search' /><span className='fl'>Search</span><span className='t4 sm'>Ctrl K</span>
		</button>
		<button className={shell.page === 'agents' ? 'nv on' : 'nv'} data-testid='vader-shell-all-agents' onClick={() => shellService.show('agents')}>
			<Icon k='menu' /><span className='fl'>All agents</span><span className='t4 sm'>{data.tasks.length}</span>
		</button>

		<div className='c fl scroll' style={{ minHeight: 0 }}>
			{openError ? <div role='alert' data-testid='vader-shell-project-error' className='hint' style={{ padding: '4px 10px' }}>{openError}</div> : null}
			{data.needsYou.length > 0 ? <>
				<div className='nvh'>Needs you</div>
				{data.needsYou.map(t => <ThreadRow key={t.id} t={t} selected={onConversation && t.id === data.currentId} onOpen={open} />)}
			</> : null}

			<div className='nvh'>Projects</div>
			{projects.length === 0 ? <div className='hint' style={{ padding: '4px 10px' }}>Open a folder to work in a project.</div> : null}
			{projects.map(g => <React.Fragment key={g.key}>
				<button className='ag t1' style={{ fontWeight: 500 }} data-testid='vader-shell-project' aria-expanded={isOpen(g.key)} title={g.key ?? undefined} onClick={() => toggle(g.key)}>
					<Icon k={isOpen(g.key) ? 'down' : 'right'} /><span className='fl tr'>{g.name}</span><span className='m'>{g.threads.length}</span>
				</button>
				{isOpen(g.key) ? g.threads.map(t => <ThreadRow key={t.id} t={t} nested selected={onConversation && t.id === data.currentId} onOpen={open} />) : null}
			</React.Fragment>)}

			{chats ? <>
				<div className='nvh'>Chats</div>
				{chats.threads.map(t => <ThreadRow key={t.id} t={t} selected={onConversation && t.id === data.currentId} onOpen={open} />)}
			</> : null}
		</div>

		<div className='hl' style={{ margin: '6px 2px' }} />
		<button className={shell.page === 'addons' ? 'nv on' : 'nv'} data-testid='vader-shell-addons' onClick={() => shellService.show('addons')}>
			<Icon k='grid' /><span className='fl'>Add-ons</span>
			{updates > 0 ? <span className='sm' data-testid='vader-shell-addons-updates' title={`${updates} update${updates === 1 ? '' : 's'}`} style={{ background: 'var(--g3)', borderRadius: 9, padding: '0 7px', color: 'var(--t2)' }}>{updates}</span> : null}
		</button>
		<button className='nv' data-testid='vader-shell-settings' onClick={() => { void commands.executeCommand(VADER_OPEN_SETTINGS_ACTION_ID) }}>
			<Icon k='gear' /><span className='fl'>Settings</span>
		</button>
	</div>
}
