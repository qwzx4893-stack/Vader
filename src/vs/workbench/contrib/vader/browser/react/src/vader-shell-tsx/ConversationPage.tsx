/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React from 'react'
import { useAccessor, useIsDark, useSettingsState, useShellState } from '../util/services.js'
import { SidebarChat } from '../sidebar-tsx/SidebarChat.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import type { ConversationTab } from '../../../vaderShellService.js'
import { Icon } from './icons.js'
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
	const model = settingsState.modelSelectionOfFeature?.Chat?.modelName
	const isTask = !!cur?.isTask
	const mode = settingsState.globalSettings.chatMode

	return <div className='c fl' style={{ minHeight: 0 }} data-testid='vader-shell-conversation' data-tab={shell.tab}>
		<div className='r' style={{ height: 44, padding: '0 20px', gap: 12, flex: 'none', borderBottom: '1px solid var(--ln)' }}>
			{isTask || !cur ? <>
				<span className='t1 tr' style={{ fontWeight: 600, maxWidth: 420 }} data-testid='vader-shell-conversation-title'>{cur?.title ?? 'New chat'}</span>
				{model ? <span className='t3 tr'>{model}</span> : null}
			</> : <>
				<span className='r t3' style={{ gap: 8 }}><Icon k='folder' /><span>{data.currentProjectName}</span></span>
				<span className='t3'>/</span>
				<span className='t1 tr' style={{ fontWeight: 600, maxWidth: 420 }} data-testid='vader-shell-conversation-title'>{cur.title}</span>
			</>}
			<span className='fl' />
			{isTask ? <div className='r' style={{ gap: 2 }} role='tablist'>
				{TABS.map(t => <button key={t.id} role='tab' aria-selected={shell.tab === t.id} data-testid={`vader-shell-tab-${t.id}`} className={shell.tab === t.id ? 'tx t1' : 'tx'} style={shell.tab === t.id ? { background: 'var(--g3)' } : undefined} onClick={() => shellService.setTab(t.id)}>{t.label}</button>)}
			</div> : cur && cur.messageCount > 0 ? <span className='hint'>Chat, no changes to files</span> : null}
			{!isTask && cur && cur.messageCount > 0 && mode !== 'agent' ? <button className='tx t1' data-testid='vader-shell-turn-into-task' onClick={() => settings.setGlobalSetting('chatMode', 'agent')}>Turn into agent task</button> : null}
			<button className='tx' data-testid='vader-shell-open-editor' onClick={() => shellService.openEditor()}>Open in editor</button>
			{cur && (cur.status === 'running' || cur.status === 'paused') ? <button className='tx' data-testid='vader-shell-pause' onClick={() => pause ? chat.resumeRun(cur.id) : chat.pauseRun(cur.id)}>{pause ? 'Resume' : 'Pause'}</button> : null}
		</div>
		<div className='c fl' style={{ minHeight: 0 }}>
			{shell.tab === 'review' && isTask ? <ReviewView /> : shell.tab === 'browser' && isTask ? <BrowserView /> : shell.tab === 'terminal' && isTask ? <TerminalView /> : <ChatEmbed />}
		</div>
	</div>
}
