/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react'
import { URI } from '../../../../../../../base/common/uri.js'
import { useAccessor, useMemoryState, useSettingsState } from '../util/services.js'
import { VADER_TOGGLE_SETTINGS_ACTION_ID } from '../../../actionIDs.js'
import { WORKSPACE_RULES_FILES } from '../../../../common/instructions/workspaceRulesFiles.js'
import { PageHead, Switch } from './ui.js'

// Memory and instructions (board R18): what the agent is told before it starts, in order, and what it chose to remember along the way. The person can read and remove
// all of it. The rules files are the ones the app really reads from the project (.vaderrules, AGENTS.md, CLAUDE.md), found by looking in the folder, not assumed.

type Found = { name: string, uri: URI, size: number }
const kb = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : n >= 1000 ? `${(n / 1000).toFixed(1)} KB` : `${n} B`

export const MemoryPage = () => {
	const accessor = useAccessor()
	const settings = accessor.get('IVaderSettingsService')
	const memory = accessor.get('IMemoryService')
	const agents = accessor.get('IAgentsService')
	const chat = accessor.get('IChatThreadService')
	const files = accessor.get('IFileService')
	const workspace = accessor.get('IWorkspaceContextService')
	const commands = accessor.get('ICommandService')
	const shell = accessor.get('IVaderShellService')
	const g = useSettingsState().globalSettings
	const mem = useMemoryState()

	const folder = workspace.getWorkspace().folders[0]
	const [found, setFound] = useState<Found[] | undefined>()
	useEffect(() => {
		let alive = true
		if (!folder) { setFound([]); return }
		void Promise.all(WORKSPACE_RULES_FILES.map(async (name): Promise<Found | undefined> => {
			const uri = URI.joinPath(folder.uri, name)
			try { const s = await files.resolve(uri, { resolveMetadata: true }); return s.isFile ? { name, uri, size: s.size ?? 0 } : undefined } catch { return undefined }
		})).then(r => { if (alive) setFound(r.filter((x): x is Found => !!x)) })
		return () => { alive = false }
	}, [files, folder?.uri.toString()]) // eslint-disable-line react-hooks/exhaustive-deps

	const [text, setText] = useState(g.aiInstructions ?? '')
	const [tab, setTab] = useState<'project' | 'agent'>('project')
	const [savedAt, setSavedAt] = useState<number | undefined>()
	const dirty = text !== (g.aiInstructions ?? '')
	const thread = chat.getCurrentThread()
	const agent = thread.agentId ? agents.getAgent(thread.agentId) : undefined
	const records = tab === 'project' ? mem.project : mem.agent
	const agentNameOf = (id: string) => agents.getAgent(id)?.name ?? 'deleted agent'

	const openFile = (uri: URI) => { void commands.executeCommand(VADER_TOGGLE_SETTINGS_ACTION_ID); shell.openEditor(); void commands.executeCommand('vscode.open', uri) }

	return <div data-testid='vader-settings-memory'>
		<PageHead title='Memory and instructions' desc='What the agent is told before it starts, and what it chose to remember along the way. You can read and remove all of it.' />
		<div className='r' style={{ gap: 28, alignItems: 'flex-start', maxWidth: 800 }}>
			<div className='c' style={{ minWidth: 0, flex: '1 1 0' }}>
				<span className='t1' style={{ fontWeight: 600 }}>Instructions</span>
				<span className='hint' style={{ padding: '2px 0 8px' }}>Told to the agent in this order, the most specific last.</span>
				<div data-testid='vader-memory-layers'>
					{[
						{ n: 1, title: 'Your instructions for every project', detail: g.aiInstructions?.trim() ? `${g.aiInstructions.trim().length} characters` : 'Empty', action: 'Edit', onClick: () => document.querySelector<HTMLTextAreaElement>('[data-testid="vader-memory-text"]')?.focus() },
						...(found ?? []).map((f, i) => ({ n: 2 + i, title: f.name, detail: `Found in ${folder?.name}, ${kb(f.size)}`, action: 'Open', onClick: () => openFile(f.uri) })),
						...(found && found.length === 0 ? [{ n: 2, title: 'A rules file for this project', detail: folder ? 'None found. Put .vaderrules, AGENTS.md or CLAUDE.md at the root of the project.' : 'Open a folder first.', action: '', onClick: () => { } }] : []),
						...(agent ? [{ n: 2 + (found?.length ?? 0), title: 'The agent you started this chat as', detail: agent.name, action: '', onClick: () => { } }] : []),
					].map(r => <div key={r.title} className='r' data-testid='vader-memory-layer' style={{ gap: 14, minHeight: 52, padding: '8px 2px', borderTop: '1px solid var(--ln)' }}>
						<span className='t4' style={{ width: 12 }}>{r.n}</span>
						<div className='c fl' style={{ minWidth: 0, gap: 1 }}><span className='t1' style={{ fontWeight: 500 }}>{r.title}</span><span className='hint'>{r.detail}</span></div>
						{r.action ? <button className='tx' data-testid='vader-memory-layer-action' onClick={r.onClick}>{r.action}</button> : null}
					</div>)}
				</div>

				<span className='t1' style={{ fontWeight: 600, margin: '26px 0 8px' }}>Your instructions for every project</span>
				<textarea className='ta' data-testid='vader-memory-text' rows={5} aria-label='Your instructions for every project' style={{ resize: 'vertical', userSelect: 'text' }} placeholder="What the agent should always do or know, in your own words" value={text} onChange={e => { setText(e.target.value); setSavedAt(undefined) }} />
				<div className='r' style={{ gap: 10, paddingTop: 10 }}>
					<button className='pb' data-testid='vader-memory-save' disabled={!dirty} onClick={() => { settings.setGlobalSetting('aiInstructions', text); setSavedAt(Date.now()) }}>Save</button>
					{dirty ? <button className='tx' onClick={() => setText(g.aiInstructions ?? '')}>Discard changes</button> : savedAt ? <span className='hint' data-testid='vader-memory-saved'>Saved. It applies to the next message.</span> : null}
				</div>
				<div className='r' style={{ gap: 14, padding: '18px 0 0' }}>
					<div className='c fl' style={{ gap: 1 }}><span className='t1'>Send only my instructions</span><span className='hint' style={{ lineHeight: 1.45 }}>When on, Vader adds nothing to the system message except what you wrote above. The safety rules that block dangerous actions still apply.</span></div>
					<Switch on={!!g.disableSystemMessage} label='Send only my instructions' testId='vader-memory-disable-system' onChange={v => settings.setGlobalSetting('disableSystemMessage', v)} />
				</div>
			</div>

			<div className='c' style={{ minWidth: 0, flex: '1 1 0' }}>
				<div className='r' style={{ paddingBottom: 8 }}><span className='t1 fl' style={{ fontWeight: 600 }}>What the agent remembers</span>{mem.project.length > 0 ? <button className='tx' data-testid='vader-memory-clear' onClick={() => memory.clearScope('project')}>Clear project memory</button> : null}</div>
				<div className='r' role='tablist' style={{ gap: 18, borderBottom: '1px solid var(--ln)', height: 36 }}>
					{([['project', 'This project', mem.project.length], ['agent', 'Saved agents', mem.agent.length]] as const).map(([id, label, n]) => <button key={id} role='tab' aria-selected={tab === id} data-testid={`vader-memory-tab-${id}`} className={tab === id ? 'tb on' : 'tb'} style={{ margin: 0, height: 36 }} onClick={() => setTab(id)}>{label} <span className='t4' style={{ marginLeft: 4 }}>{n}</span></button>)}
				</div>
				{records.length === 0 ? <span className='t3' style={{ padding: '16px 0', lineHeight: 1.55 }} data-testid='vader-memory-empty'>{tab === 'project' ? 'Nothing yet. When the agent learns something that will matter next time, it writes it here.' : 'Nothing yet. A saved agent keeps its own notes here.'}</span>
					: records.map(m => <div key={m.id} className='r' data-testid='vader-memory-record' style={{ gap: 12, padding: '12px 0', borderBottom: '1px solid var(--ln)', alignItems: 'flex-start' }}>
						<div className='c fl' style={{ minWidth: 0, gap: 2 }}><span className='t1' style={{ fontWeight: 600 }}>{m.label}</span><span className='hint' style={{ lineHeight: 1.5 }}>{m.content}</span>{tab === 'agent' ? <span className='hint'>{agentNameOf(m.scopeKey)}</span> : null}</div>
						<button className='tx' data-testid='vader-memory-remove' onClick={() => memory.remove(m.id)}>Remove</button>
					</div>)}
				<p className='hint' style={{ margin: '16px 0 0', lineHeight: 1.55 }}>Memory only holds what was written with the remember tool, by the agent or by you.</p>
			</div>
		</div>
	</div>
}
