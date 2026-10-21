/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react'
import { useAccessor, useIsDark, useSettingsState, useShellState } from '../util/services.js'
import { SidebarChat } from '../sidebar-tsx/SidebarChat.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import type { ConversationTab } from '../../../vaderShellService.js'
import { Icon } from './icons.js'
import { chatToMarkdown, exportFileName } from '../../../../common/chatExport.js'
import { friendlyModelName } from '../../../../common/modelPickerGroups.js'
import { useShellData } from './useShellData.js'
import { ReviewView } from './ReviewView.js'
import { BrowserView } from './BrowserView.js'
import { TerminalView } from './TerminalView.js'

// One conversation (boards R01 and R03): its name, what it is, the buttons that act on it, and below them the conversation itself or one of its other
// tabs (the review of what the agent changed, the page it opened, the terminals it started).

const TABS: { id: ConversationTab, label: string }[] = [
	{ id: 'conversation', label: 'Conversation' }, { id: 'review', label: 'Review' }, { id: 'browser', label: 'Browser' }, { id: 'terminal', label: 'Terminal' },
]

export const ChatEmbed = () => {
	const isDark = useIsDark()
	return <div className='@@vader-scope' style={{ height: '100%', width: '100%' }}>
		<div className={isDark ? 'dark' : ''} style={{ height: '100%', width: '100%', display: 'flex', justifyContent: 'center' }}>
			<div className='bg-vader-bg-2 text-vader-fg-1' style={{ width: '100%', maxWidth: 780, height: '100%' }} data-testid='vader-shell-chat'>
				<ErrorBoundary><SidebarChat /></ErrorBoundary>
			</div>
		</div>
	</div>
}

/** a question with two answers, over the window: what will happen, and what stays */
const Ask = ({ title, text, yes, onYes, onNo, testId, danger }: { title: string, text: string, yes: string, onYes: () => void, onNo: () => void, testId: string, danger?: boolean }) =>
	<div role='alertdialog' aria-modal='true' aria-label={title} data-testid={testId} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onNo() } }} onMouseDown={e => { if (e.target === e.currentTarget) onNo() }}
		style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
		<div className='c' style={{ width: 400, padding: '20px 22px', gap: 10, background: 'var(--g2)', border: '1px solid var(--ln2)', borderRadius: 14, boxShadow: '0 16px 40px rgba(0,0,0,.55)' }}>
			<span className='t1' style={{ fontWeight: 600, fontSize: 16 }}>{title}</span>
			<span className='t2' style={{ lineHeight: 1.55 }}>{text}</span>
			<span className='r' style={{ gap: 8, justifyContent: 'flex-end', paddingTop: 6 }}>
				<button className='gb' data-testid={`${testId}-no`} autoFocus onClick={onNo}>Cancel</button>
				<button className='pb' data-testid={`${testId}-yes`} style={danger ? { background: '#f06a6e', color: '#000' } : undefined} onClick={onYes}>{yes}</button>
			</span>
		</div>
	</div>

export const ConversationPage = () => {
	const accessor = useAccessor()
	const chat = accessor.get('IChatThreadService')
	const shellService = accessor.get('IVaderShellService')
	const settings = accessor.get('IVaderSettingsService')
	const settingsState = useSettingsState()
	const shell = useShellState()
	const data = useShellData()
	const cur = data.all.find(t => t.id === data.currentId)
	const pause = cur ? chat.getPause(cur.id) : undefined
	// the model that did this conversation's work; for one that has not run yet, the one chosen now
	const sel = cur?.model ?? settingsState.modelSelectionOfFeature?.Chat
	const model = sel ? friendlyModelName(sel.providerName, sel.modelName).text : undefined
	const isTask = !!cur?.isTask
	const mode = settingsState.globalSettings.chatMode
	// looking back through a chat: its name, a file of it, deleting it
	const [menu, setMenu] = useState(false)
	const [renaming, setRenaming] = useState(false)
	const [draft, setDraft] = useState('')
	const [asking, setAsking] = useState<'export' | 'delete' | undefined>()
	useEffect(() => { setRenaming(false); setMenu(false); setAsking(undefined) }, [cur?.id])
	const startRename = () => { setDraft(cur?.title && cur.title !== 'New chat' ? cur.title : ''); setRenaming(true); setMenu(false) }
	const saveRename = () => { if (cur) chat.renameThread(cur.id, draft); setRenaming(false) }
	const exportChat = () => {
		const thread = cur ? chat.state.allThreads[cur.id] : undefined
		if (!cur || !thread) return
		const url = URL.createObjectURL(new Blob([chatToMarkdown(thread as never, { title: cur.title, exportedOn: new Date() })], { type: 'text/markdown' }))
		const a = document.createElement('a'); a.href = url; a.download = exportFileName(cur.title); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10_000)
		setAsking(undefined)
	}
	const title = () => renaming
		? <input className='fld' autoFocus data-testid='vader-shell-rename-input' aria-label='Chat name' placeholder='Chat name' value={draft} style={{ width: 320, height: 28 }} onChange={e => setDraft(e.target.value)} onBlur={saveRename}
			onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveRename() } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setRenaming(false) } }} />
		: <span className='t1 tr' style={{ fontWeight: 600, fontSize: 14, maxWidth: 420, minWidth: 40 }} data-testid='vader-shell-conversation-title' title='Double-click to rename' onDoubleClick={cur ? startRename : undefined}>{cur?.title ?? 'New chat'}</span>

	return <div className='c fl' style={{ minHeight: 0 }} data-testid='vader-shell-conversation' data-tab={shell.tab}>
		<div className='r' style={{ height: 44, padding: '0 20px', gap: 12, flex: 'none', borderBottom: '1px solid var(--ln)' }}>
			{isTask || !cur ? <>
				{title()}
				{cur?.copy?.branch ? <span className='mo t3 tr narrow-hide' title='The branch this task works on' data-testid='vader-shell-conversation-branch'>{cur.copy.branch}</span> : null}
				{model ? <span className='t3 tr narrow-hide'>{model}</span> : null}
			</> : <>
				<span className='r t3 narrow-hide' style={{ gap: 8 }}><Icon k='folder' /><span>{data.currentProjectName}</span></span>
				<span className='t3 narrow-hide'>/</span>
				{title()}
			</>}
			<span className='fl' />
			{isTask ? <div className='r' style={{ gap: 2 }} role='tablist'>
				{TABS.map(t => <button key={t.id} role='tab' aria-selected={shell.tab === t.id} data-testid={`vader-shell-tab-${t.id}`} className={shell.tab === t.id ? 'tx t1' : 'tx'} style={shell.tab === t.id ? { background: 'var(--g3)' } : undefined} onClick={() => shellService.setTab(t.id)}>{t.label}</button>)}
			</div> : cur && cur.messageCount > 0 ? <span className='hint tr narrow-hide'>Chat, no changes to files</span> : null}
			{!isTask && cur && cur.messageCount > 0 && mode !== 'agent' ? <button className='tx t1' data-testid='vader-shell-turn-into-task' onClick={() => settings.setGlobalSetting('chatMode', 'agent')}>Turn into agent task</button> : null}
			<button className='tx' data-testid='vader-shell-open-editor' onClick={() => shellService.openEditor()}><span className='narrow-hide'>Open in editor</span><span className='narrow-only'>Editor</span></button>
			{cur && (cur.status === 'running' || cur.status === 'paused') ? <button className='tx' data-testid='vader-shell-pause' onClick={() => pause ? chat.resumeRun(cur.id) : chat.pauseRun(cur.id)}>{pause ? 'Resume' : 'Pause'}</button> : null}
			{cur && cur.messageCount > 0 ? <span style={{ position: 'relative' }}>
				<button className='ic' aria-label='More about this chat' aria-expanded={menu} data-testid='vader-shell-more' onClick={() => setMenu(m => !m)}><Icon k='more' /></button>
				{menu ? <>
					<div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onMouseDown={() => setMenu(false)} />
					<div className='pop c' role='menu' style={{ position: 'absolute', right: 0, top: 32, zIndex: 41, width: 190, padding: 4 }}>
						<button className='opt' role='menuitem' data-testid='vader-shell-rename' onClick={startRename}>Rename</button>
						<button className='opt' role='menuitem' data-testid='vader-shell-export' onClick={() => { setAsking('export'); setMenu(false) }}>Export as Markdown</button>
						<button className='opt' role='menuitem' data-testid='vader-shell-delete' style={{ color: 'var(--delt)' }} onClick={() => { setAsking('delete'); setMenu(false) }}>Delete chat</button>
					</div>
				</> : null}
			</span> : null}
		</div>
		{asking === 'export' ? <Ask testId='vader-shell-export-ask' title='Export this chat' text='Saves the conversation and the files it changed as a Markdown file. API keys and settings are not part of a conversation, so they are not in it.' yes='Save file' onYes={exportChat} onNo={() => setAsking(undefined)} /> : null}
		{asking === 'delete' && cur ? <Ask testId='vader-shell-delete-ask' danger title={`Delete \u201C${cur.title}\u201D?`} text='The conversation is removed from this computer. Files it changed are not touched, and what it cost stays counted in Usage and cost.' yes='Delete chat' onYes={() => { chat.deleteThread(cur.id); setAsking(undefined) }} onNo={() => setAsking(undefined)} /> : null}
		<div className='c fl' style={{ minHeight: 0 }}>
			{shell.tab === 'review' && isTask ? <ReviewView /> : shell.tab === 'browser' && isTask ? <BrowserView /> : shell.tab === 'terminal' && isTask ? <TerminalView /> : <ChatEmbed />}
		</div>
	</div>
}
