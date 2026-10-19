/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useRef, useState } from 'react'
import Severity from '../../../../../../../base/common/severity.js'
import { useAccessor, useSettingsState } from '../util/services.js'
import { redactSettingsForExport, mergeImportedSettings } from '../../../../common/helpers/settingsPortability.js'
import { providerNames } from '../../../../common/vaderSettingsTypes.js'
import { transferEditorTypes } from '../../../extensionTransferTypes.js'
import { EditorSwitchButton } from './EditorSwitch.js'
import { Group, Line, PageHead, Note } from './ui.js'

// Data and backup (board R30): everything is stored on this computer. Chats and settings can be exported to a file and imported from one (an export leaves out API
// keys and custom headers, so the file is safe to share), the theme and extensions can be brought over from another editor, and chats or keys can be cleared.
// Clearing asks a second time, in the same place, and says what stays.

const sizeLabel = (bytes: number) => bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : bytes >= 1000 ? `${Math.round(bytes / 1000)} KB` : `${bytes} B`

const Confirm = ({ label, confirmLabel, onConfirm, testId, danger }: { label: string, confirmLabel: string, onConfirm: () => void, testId: string, danger?: boolean }) => {
	const [sure, setSure] = useState(false)
	return sure
		? <span className='r' style={{ gap: 8 }}><button className='gb' style={{ color: 'var(--delt)' }} data-testid={`${testId}-confirm`} onClick={() => { setSure(false); onConfirm() }}>{confirmLabel}</button><button className='tx' onClick={() => setSure(false)}>Keep it</button></span>
		: <button className='gb' style={danger ? { color: 'var(--delt)' } : undefined} data-testid={testId} onClick={() => setSure(true)}>{label}</button>
}

export const DataPage = () => {
	const accessor = useAccessor()
	const settings = accessor.get('IVaderSettingsService')
	const chats = accessor.get('IChatThreadService')
	const notifications = accessor.get('INotificationService')
	const commands = accessor.get('ICommandService')
	const environment = accessor.get('IEnvironmentService')
	const nativeHost = accessor.get('INativeHostService')
	useSettingsState()
	const settingsFile = useRef<HTMLInputElement>(null)
	const chatsFile = useRef<HTMLInputElement>(null)
	const [message, setMessage] = useState<{ kind: 'ok' | 'warn', text: string } | undefined>()

	const threadCount = Object.keys(chats.state.allThreads).length
	const chatBytes = JSON.stringify(chats.state).length

	const download = (kind: 'chats' | 'settings') => {
		// API keys and custom headers are left out of the settings: the file is made to be shared (bug reports, a colleague's computer)
		const text = JSON.stringify(kind === 'chats' ? chats.state : redactSettingsForExport(settings.state as any), null, 2)
		const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
		const a = document.createElement('a'); a.href = url; a.download = kind === 'chats' ? 'vader-chats.json' : 'vader-settings.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10_000)
		setMessage({ kind: 'ok', text: kind === 'chats' ? `Exported ${threadCount} chats` : 'Exported the settings, without keys' })
	}
	const upload = (kind: 'chats' | 'settings') => (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		e.target.value = ''
		if (!file) return
		const reader = new FileReader()
		reader.onload = () => {
			try {
				const json = JSON.parse(reader.result as string)
				// keys already on this computer stay for providers whose endpoint is unchanged; a file can never move them to another server
				if (kind === 'chats') chats.dangerousSetState(json as any)
				else settings.dangerousSetState(mergeImportedSettings(json, settings.state as any) as any)
				setMessage({ kind: 'ok', text: kind === 'chats' ? 'Chats imported' : 'Settings imported. Keys on this computer were kept.' })
				notifications.info(kind === 'chats' ? 'Chats imported' : 'Settings imported')
			} catch (err) {
				setMessage({ kind: 'warn', text: `${file.name} could not be read as ${kind === 'chats' ? 'chats' : 'settings'}: ${err instanceof Error ? err.message : String(err)}` })
				notifications.notify({ message: `Failed to import ${kind}`, source: String(err), severity: Severity.Error })
			}
		}
		reader.readAsText(file)
	}
	const removeKeys = () => {
		for (const p of providerNames) { if (settings.state.settingsOfProvider[p]?.apiKey) void settings.setSettingOfProvider(p, 'apiKey' as any, '') }
		setMessage({ kind: 'ok', text: 'Every saved key was removed from this computer' })
	}

	return <div data-testid='vader-settings-data'>
		<PageHead title='Data and backup' desc='Everything is stored on this computer. API keys and custom headers are left out of an export, so the file is safe to share.' />
		<input ref={chatsFile} type='file' accept='.json' hidden data-testid='vader-data-chats-file' onChange={upload('chats')} />
		<input ref={settingsFile} type='file' accept='.json' hidden data-testid='vader-data-settings-file' onChange={upload('settings')} />
		{message ? <div style={{ marginBottom: 14 }}><Note kind={message.kind} testId='vader-data-message'>{message.text}</Note></div> : null}

		<Group title='Back up and restore' first>
			<Line first title='Chats and agent tasks' detail={`${threadCount} chat${threadCount === 1 ? '' : 's'}, ${sizeLabel(chatBytes)}. Export to a file, or import from one.`} right={<span className='r' style={{ gap: 8 }}><button className='gb' data-testid='vader-data-export-chats' onClick={() => download('chats')}>Export</button><button className='gb' data-testid='vader-data-import-chats' onClick={() => chatsFile.current?.click()}>Import</button></span>} />
			<Line title='Settings' detail='Without keys, safe to share in a bug report' right={<span className='r' style={{ gap: 8 }}><button className='gb' data-testid='vader-data-export-settings' onClick={() => download('settings')}>Export</button><button className='gb' data-testid='vader-data-import-settings' onClick={() => settingsFile.current?.click()}>Import</button></span>} />
		</Group>

		<Group title='Coming from another editor'>
			<Line first title='Bring over the theme, keybindings and extensions' detail='Nothing is changed in the other editor. Keys and chats are not copied.' />
			<div data-testid='vader-data-editors' style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 10, padding: '4px 0 12px' }}>{transferEditorTypes.map(e => <EditorSwitchButton key={e} fromEditor={e} />)}</div>
		</Group>

		<Group title='Clear'>
			<Line first title='Delete all chats' detail='Saved agents, rules and settings stay.' right={<Confirm label='Delete chats...' confirmLabel='Delete all chats' testId='vader-data-delete-chats' danger onConfirm={() => { chats.resetState(); setMessage({ kind: 'ok', text: 'All chats were deleted' }) }} />} />
			<Line title='Remove every saved key' detail='Erases the keys from this computer. The providers keep their own copies.' right={<Confirm label='Remove keys...' confirmLabel='Remove every key' testId='vader-data-remove-keys' danger onConfirm={removeKeys} />} />
			<Line title='Reset settings' detail='Back to what a new install has. Chats stay.' right={<Confirm label='Reset settings...' confirmLabel='Reset settings' testId='vader-data-reset-settings' onConfirm={() => { settings.resetState(); setMessage({ kind: 'ok', text: 'Settings were reset' }) }} />} />
		</Group>

		<Group title='The editor itself'>
			<Line first title='Editor settings, keyboard shortcuts and theme' right={<span className='r' style={{ gap: 8 }}>
				<button className='gb' onClick={() => { void commands.executeCommand('workbench.action.openSettings') }}>Settings</button>
				<button className='gb' onClick={() => { void commands.executeCommand('workbench.action.openGlobalKeybindings') }}>Keyboard</button>
				<button className='gb' onClick={() => { void commands.executeCommand('workbench.action.selectTheme') }}>Theme</button></span>} />
			<Line title='Logs' detail='For a bug report' right={<button className='gb' data-testid='vader-data-logs' onClick={() => { void nativeHost.showItemInFolder(environment.logsHome.fsPath) }}>Open the logs folder</button>} />
			<Line title='The welcome screen' right={<button className='gb' data-testid='vader-data-welcome' onClick={() => settings.setGlobalSetting('isOnboardingComplete', false)}>Show it again</button>} />
		</Group>
	</div>
}
