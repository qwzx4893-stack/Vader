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
import { VADER_TOGGLE_SETTINGS_ACTION_ID } from '../../../actionIDs.js'
import { Ask, Group, Line, PageHead, Note } from './ui.js'
import { Backup, BACKUP_TEXT, BACKUP_TITLE, backupFileName, BackupRule, buildBackup, deleteChatsWords, parseBackup, planRestore, RestorePlan, restoreWords } from '../../../../common/backupModel.js'

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
	const openEditorSetting = async (id: string) => {
		await commands.executeCommand(VADER_TOGGLE_SETTINGS_ACTION_ID)
		accessor.get('IVaderShellService').openEditor()
		await commands.executeCommand(id)
	}
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
	// a backup of what is Vader's own, in one file; restoring only adds (common/backupModel.ts)
	const agentsService = accessor.get('IAgentsService')
	const policy = accessor.get('IPolicyService')
	const [dialog, setDialog] = useState<{ kind: 'backup' } | { kind: 'restore', backup: Backup, plan: RestorePlan, fileName: string } | { kind: 'delete' } | undefined>()
	const backupFile = useRef<HTMLInputElement>(null)
	const savedAgents = () => (agentsService.state?.agents ?? []) as readonly { name: string }[]
	const customRules = () => policy.getAllRules().filter((r: { builtIn: boolean }) => !r.builtIn) as unknown as BackupRule[]
	const saveBackup = () => {
		const now = new Date()
		const backup = buildBackup({ chats: chats.state.allThreads as never, agents: savedAgents() as never, rules: customRules(), settings: redactSettingsForExport(settings.state as any) }, now)
		const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
		const a = document.createElement('a'); a.href = url; a.download = backupFileName(now); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10_000)
		setDialog(undefined)
		setMessage({ kind: 'ok', text: `Saved ${backupFileName(now)}: ${threadCount} chat${threadCount === 1 ? '' : 's'}, ${savedAgents().length} saved agent${savedAgents().length === 1 ? '' : 's'}, your rules and settings, without keys` })
	}
	const chooseBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		e.target.value = ''
		if (!file) return
		const reader = new FileReader()
		reader.onload = () => {
			const parsed = parseBackup(String(reader.result))
			if (!parsed.ok) { setMessage({ kind: 'warn', text: `${file.name} was not restored. ${parsed.reason}` }); return }
			const plan = planRestore(parsed.backup, { chatIds: new Set(Object.keys(chats.state.allThreads)), agentNames: new Set(savedAgents().map(a => a.name)), ruleDescriptions: new Set(customRules().map(r => r.description)) })
			const words = restoreWords(plan, file.name)
			if (words.nothing) { setMessage({ kind: 'ok', text: `${file.name}: ${words.text}` }); return }
			setDialog({ kind: 'restore', backup: parsed.backup, plan, fileName: file.name })
		}
		reader.readAsText(file)
	}
	const restore = (backup: Backup, plan: RestorePlan) => {
		const added: Record<string, unknown> = {}
		for (const id of plan.addChatIds) added[id] = backup.chats[id]
		if (plan.addChatIds.length > 0) chats.dangerousSetState({ ...chats.state, allThreads: { ...chats.state.allThreads, ...added } } as any)
		for (const a of plan.addAgents) agentsService.createAgent(a as never, 'user')
		for (const r of plan.addRules) policy.addCustomRule(r as never)
		setDialog(undefined)
		setMessage({ kind: 'ok', text: `Restored ${plan.addChatIds.length} chat${plan.addChatIds.length === 1 ? '' : 's'}, ${plan.addAgents.length} saved agent${plan.addAgents.length === 1 ? '' : 's'} and ${plan.addRules.length} rule${plan.addRules.length === 1 ? '' : 's'}. Nothing that was here was changed.` })
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

		<input ref={backupFile} type='file' accept='.json' hidden data-testid='vader-data-backup-file' onChange={chooseBackup} />
		{dialog?.kind === 'backup' ? <Ask testId='vader-data-backup-ask' title={BACKUP_TITLE} text={BACKUP_TEXT} yes='Save file' onYes={saveBackup} onNo={() => setDialog(undefined)} /> : null}
		{dialog?.kind === 'restore' ? <Ask testId='vader-data-restore-ask' title={restoreWords(dialog.plan, dialog.fileName).title} text={restoreWords(dialog.plan, dialog.fileName).text} yes='Restore' onYes={() => restore(dialog.backup, dialog.plan)} onNo={() => setDialog(undefined)} /> : null}
		{dialog?.kind === 'delete' ? <Ask testId='vader-data-delete-ask' danger title={deleteChatsWords(threadCount).title} text={deleteChatsWords(threadCount).text} yes={threadCount === 1 ? 'Delete chat' : 'Delete all chats'} onYes={() => { chats.resetState(); setDialog(undefined); setMessage({ kind: 'ok', text: 'All chats were deleted' }) }} onNo={() => setDialog(undefined)} /> : null}

		<Group title='Back up and restore' first>
			<Line first title='Everything of yours in one file' detail='Chats, saved agents, your rules and settings. Restoring only adds what is not here yet.' right={<span className='r' style={{ gap: 8 }}><button className='pb' data-testid='vader-data-backup' onClick={() => setDialog({ kind: 'backup' })}>Back up...</button><button className='gb' data-testid='vader-data-restore' onClick={() => backupFile.current?.click()}>Restore...</button></span>} />
			<Line title='Chats and agent tasks' detail={`${threadCount} chat${threadCount === 1 ? '' : 's'}, ${sizeLabel(chatBytes)}. Export to a file, or import from one.`} right={<span className='r' style={{ gap: 8 }}><button className='gb' data-testid='vader-data-export-chats' onClick={() => download('chats')}>Export</button><button className='gb' data-testid='vader-data-import-chats' onClick={() => chatsFile.current?.click()}>Import</button></span>} />
			<Line title='Settings' detail='Without keys, safe to share in a bug report' right={<span className='r' style={{ gap: 8 }}><button className='gb' data-testid='vader-data-export-settings' onClick={() => download('settings')}>Export</button><button className='gb' data-testid='vader-data-import-settings' onClick={() => settingsFile.current?.click()}>Import</button></span>} />
		</Group>

		<Group title='Coming from another editor'>
			<Line first title='Bring over the theme, keybindings and extensions' detail='Nothing is changed in the other editor. Keys and chats are not copied.' />
			<div data-testid='vader-data-editors' style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 10, padding: '4px 0 12px' }}>{transferEditorTypes.map(e => <EditorSwitchButton key={e} fromEditor={e} />)}</div>
		</Group>

		<Group title='Clear'>
			<Line first title='Delete all chats' detail='Saved agents, rules and settings stay.' right={<button className='gb' style={{ color: 'var(--delt)' }} data-testid='vader-data-delete-chats' disabled={threadCount === 0} onClick={() => setDialog({ kind: 'delete' })}>Delete chats...</button>} />
			<Line title='Remove every saved key' detail='Erases the keys from this computer. The providers keep their own copies.' right={<Confirm label='Remove keys...' confirmLabel='Remove every key' testId='vader-data-remove-keys' danger onConfirm={removeKeys} />} />
			<Line title='Reset settings' detail='Back to what a new install has. Chats stay.' right={<Confirm label='Reset settings...' confirmLabel='Reset settings' testId='vader-data-reset-settings' onConfirm={() => { settings.resetState(); setMessage({ kind: 'ok', text: 'Settings were reset' }) }} />} />
		</Group>

		<Group title='The editor itself'>
			<Line first title='Editor settings, keyboard shortcuts and theme' right={<span className='r' style={{ gap: 8 }}>
				<button className='gb' onClick={() => { void openEditorSetting('workbench.action.openSettings') }}>Settings</button>
				<button className='gb' onClick={() => { void openEditorSetting('workbench.action.openGlobalKeybindings') }}>Keyboard</button>
				<button className='gb' onClick={() => { void commands.executeCommand('workbench.action.selectTheme') }}>Theme</button></span>} />
			<Line title='Logs' detail='For a bug report' right={<button className='gb' data-testid='vader-data-logs' onClick={() => { void nativeHost.showItemInFolder(environment.logsHome.fsPath) }}>Open the logs folder</button>} />
			<Line title='The welcome screen' right={<button className='gb' data-testid='vader-data-welcome' onClick={() => settings.setGlobalSetting('isOnboardingComplete', false)}>Show it again</button>} />
		</Group>
	</div>
}
