/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react'
import { useAccessor, useAgentsServiceState, useMCPServiceState, useSettingsState } from '../util/services.js'
import { ProviderLogo } from '../util/ProviderLogo.js'
import { PermanentAgentDefinition } from '../../../../common/agents/agentsServiceTypes.js'
import { ToolApprovalType, toolApprovalTypes } from '../../../../common/toolsServiceTypes.js'
import { ModelSelection, ProviderName } from '../../../../common/vaderSettingsTypes.js'
import { Field, Note, PageHead } from './ui.js'

// Saved agents (board R12): a saved agent is a named helper with its own instructions, its own model and its own limits. The list is on the left, the chosen one on the
// right as a form that is saved or discarded. What is limited here is enforced by the app when the agent runs (approval kinds, folders, MCP servers, tools), not
// by asking the model to behave.

type Draft = { name: string, description: string, instructions: string, model: ModelSelection | null, folders: string, allowed: ToolApprovalType[], mcp: string[] | undefined, denied: string[] }

const KIND_LABEL: { [k: string]: string } = { edits: 'Edit files', terminal: 'Run commands', 'MCP tools': 'Use MCP tools' }
const BLANK: Draft = { name: '', description: '', instructions: '', model: null, folders: '', allowed: [...toolApprovalTypes], mcp: undefined, denied: [] }

const draftOf = (a: PermanentAgentDefinition): Draft => ({ name: a.name, description: a.description, instructions: a.instructions, model: a.modelSelection, folders: (a.filesystemScopeGlobs ?? []).join(', '), allowed: [...a.allowedApprovalTypes], mcp: a.mcpServerNames ? [...a.mcpServerNames] : undefined, denied: [...a.deniedToolNames] })
const globsOf = (text: string) => { const g = text.split(',').map(s => s.trim()).filter(Boolean); return g.length ? g : undefined }
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b)

/** one short word of what limits an agent, for its row in the list */
const limitOf = (a: PermanentAgentDefinition): string => {
	const acts = a.allowedApprovalTypes.filter(t => t === 'edits' || t === 'terminal')
	if (acts.length === 0) return 'read only'
	const g = a.filesystemScopeGlobs
	if (g?.length) { const first = g[0].replace(/\/\*\*.*$/, '').replace(/^\*\*\//, ''); return /\.[a-z]+$/i.test(first) || first.includes('*') ? 'some files only' : `only ${first}` }
	return ''
}

export const SavedAgentsPage = () => {
	const accessor = useAccessor()
	const agents = accessor.get('IAgentsService')
	const router = accessor.get('IModelRouterService')
	const chat = accessor.get('IChatThreadService')
	const state = useAgentsServiceState()
	const mcp = useMCPServiceState()
	useSettingsState()
	const [pickedId, setPickedId] = useState<string | undefined>()
	const [creating, setCreating] = useState(false)
	const current = creating ? undefined : state.agents.find(a => a.id === pickedId) ?? state.agents[0]
	const [draft, setDraft] = useState<Draft>(BLANK)
	const [problem, setProblem] = useState('')
	const [confirmDelete, setConfirmDelete] = useState(false)
	const [toolText, setToolText] = useState('')
	const saved = current ? draftOf(current) : BLANK
	const dirty = creating ? !same(draft, BLANK) : !same(draft, saved)

	// the form follows the agent that is chosen
	useEffect(() => { setDraft(creating ? BLANK : current ? draftOf(current) : BLANK); setProblem(''); setConfirmDelete(false) }, [creating, current?.id]) // eslint-disable-line react-hooks/exhaustive-deps
	const thread = chat.getCurrentThread()
	const configured = router.listConfiguredModels()
	const servers = Object.keys(mcp.mcpServerOfName)
	const set = (p: Partial<Draft>) => { setDraft(d => ({ ...d, ...p })); setProblem('') }

	const save = () => {
		if (!draft.name.trim()) { setProblem('Give the agent a name.'); return }
		if (!draft.instructions.trim()) { setProblem('Write what it should always do. An agent without instructions is the main agent.'); return }
		const patch = { name: draft.name.trim(), description: draft.description.trim(), instructions: draft.instructions.trim(), modelSelection: draft.model, allowedApprovalTypes: draft.allowed, deniedToolNames: draft.denied, mcpServerNames: draft.mcp, filesystemScopeGlobs: globsOf(draft.folders) }
		if (creating) { const a = agents.createAgent(patch, 'user'); setCreating(false); setPickedId(a.id) }
		else if (current) agents.updateAgent(current.id, patch)
	}
	const key = (m: ModelSelection | null) => m ? `${m.providerName}/${m.modelName}` : ''

	return <div data-testid='vader-settings-saved'>
		<PageHead title='Saved agents' desc='A saved agent is a named helper with its own instructions, its own model and its own limits. You can start a task as one, or let the main agent hand work to it.' />
		<div className='r' style={{ gap: 36, alignItems: 'flex-start' }}>
			<div className='c' style={{ width: 300, flex: 'none' }}>
				<div className='r' style={{ paddingBottom: 8 }}><span className='t1' style={{ fontWeight: 600 }}>Saved agents</span><span className='fl' /><button className='gb' data-testid='vader-saved-new' onClick={() => { setDraft(BLANK); setCreating(true); setPickedId(undefined) }}>New agent</button></div>
				{state.agents.length === 0 && !creating ? <span className='t3' style={{ lineHeight: 1.55, padding: '10px 0' }} data-testid='vader-saved-empty'>No saved agents yet. Make one for something you ask for again and again, such as reviewing a change or writing release notes.</span> : null}
				{state.agents.map(a => <button key={a.id} className={!creating && current?.id === a.id ? 'ag on' : 'ag'} data-testid='vader-saved-item' data-agent-id={a.id} style={{ height: 'auto', padding: '9px 12px', borderRadius: 0, borderTop: '1px solid var(--ln)', alignItems: 'flex-start' }} onClick={() => { setCreating(false); setPickedId(a.id) }}>
					<span className='c fl' style={{ minWidth: 0 }}><span className='t1' style={{ fontWeight: 600 }}>{a.name}</span><span className='hint tr'>{a.description || (a.createdBy === 'main-agent' ? 'Made by the main agent' : '')}</span></span>
					<span className='hint'>{limitOf(a)}</span>
				</button>)}
			</div>

			{creating || current ? <div className='c fl' style={{ gap: 16, minWidth: 0 }} data-testid='vader-saved-form'>
				<div className='r' style={{ gap: 12 }}>
					<span className='t1 fl' style={{ fontWeight: 600 }}>{creating ? 'New agent' : current!.name}</span>
					{!creating && current ? <>
						<button className='tx' data-testid='vader-saved-use' onClick={() => chat.setThreadAgentId(thread.id, thread.agentId === current.id ? null : current.id)}>{thread.agentId === current.id ? 'In use in this chat' : 'Use in this chat'}</button>
						<button className='tx' data-testid='vader-saved-duplicate' onClick={() => { const a = agents.createAgent({ name: `${current.name} copy`, description: current.description, instructions: current.instructions, modelSelection: current.modelSelection, allowedApprovalTypes: current.allowedApprovalTypes, deniedToolNames: current.deniedToolNames, mcpServerNames: current.mcpServerNames, filesystemScopeGlobs: current.filesystemScopeGlobs }, 'user'); setPickedId(a.id) }}>Duplicate</button>
						{confirmDelete ? <button className='tx' data-testid='vader-saved-delete-confirm' style={{ color: 'var(--delt)' }} onClick={() => { agents.deleteAgent(current.id); setPickedId(undefined); setConfirmDelete(false) }}>Delete for good</button> : <button className='tx' data-testid='vader-saved-delete' style={{ color: 'var(--delt)' }} onClick={() => setConfirmDelete(true)}>Delete</button>}
					</> : null}
				</div>
				<Field label='Name'><input className='fld' data-testid='vader-saved-name' value={draft.name} onChange={e => set({ name: e.target.value })} /></Field>
				<Field label='What it does'><input className='fld' data-testid='vader-saved-desc' value={draft.description} placeholder='One sentence, shown in the list' onChange={e => set({ description: e.target.value })} /></Field>
				<Field label='Instructions'><textarea className='ta' data-testid='vader-saved-instructions' rows={5} style={{ resize: 'vertical', userSelect: 'text' }} value={draft.instructions} onChange={e => set({ instructions: e.target.value })} /></Field>
				<div className='r' style={{ gap: 14, alignItems: 'flex-end' }}>
					<Field label='Model' width='50%'>
						<span className='fld r' style={{ gap: 8 }}>{draft.model ? <ProviderLogo providerName={draft.model.providerName as ProviderName} size={14} /> : null}
							<select className='fl' data-testid='vader-saved-model' aria-label='Model' value={key(draft.model)} style={{ background: 'transparent', color: 'var(--t1)', border: 0, outline: 0, minWidth: 0 }} onChange={e => { const v = e.target.value; if (!v) { set({ model: null }); return } const i = v.indexOf('/'); set({ model: { providerName: v.slice(0, i) as ProviderName, modelName: v.slice(i + 1) } }) }}>
								<option value='' style={{ background: '#19191c' }}>The model the task would use anyway</option>
								{draft.model && !configured.some(c => key(c) === key(draft.model)) ? <option value={key(draft.model)} style={{ background: '#19191c' }}>{draft.model.modelName} (not set up)</option> : null}
								{configured.map(c => <option key={key(c)} value={key(c)} style={{ background: '#19191c' }}>{c.modelName}</option>)}
							</select></span>
					</Field>
					<Field label='Folders it may touch'><input className='fld mo' data-testid='vader-saved-folders' placeholder='src/**, docs/** (empty: the whole project)' value={draft.folders} onChange={e => set({ folders: e.target.value })} /></Field>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.25fr) minmax(0,1fr)', gap: 18 }}>
					<div className='c' style={{ gap: 8 }}>
						<span className='hint'>May ask to</span>
						{[...toolApprovalTypes].map(t => { const on = draft.allowed.includes(t); return <button key={t} role='checkbox' aria-checked={on} data-testid={`vader-saved-allow-${t.replace(/\s+/g, '-')}`} className='r' style={{ gap: 9 }} onClick={() => set({ allowed: on ? draft.allowed.filter(x => x !== t) : [...draft.allowed, t] })}><span className={on ? 'chk on' : 'chk'}>{on ? <svg className='i' viewBox='0 0 24 24' style={{ width: 11, height: 11, stroke: '#000', strokeWidth: 3 }}><path d='m5 12.5 4.5 4.5L19 7.5' /></svg> : null}</span><span className={on ? 't1' : 't3'}>{KIND_LABEL[t] ?? t}</span></button> })}
					</div>
					<div className='c' style={{ gap: 8 }}>
						<span className='hint'>MCP servers it can use</span>
						<button role='checkbox' aria-checked={draft.mcp === undefined} data-testid='vader-saved-mcp-any' className='r' style={{ gap: 9 }} onClick={() => set({ mcp: draft.mcp === undefined ? [] : undefined })}><span className={draft.mcp === undefined ? 'chk on' : 'chk'}>{draft.mcp === undefined ? <svg className='i' viewBox='0 0 24 24' style={{ width: 11, height: 11, stroke: '#000', strokeWidth: 3 }}><path d='m5 12.5 4.5 4.5L19 7.5' /></svg> : null}</span><span className={draft.mcp === undefined ? 't1' : 't3'}>Any server that is on</span></button>
						{draft.mcp !== undefined ? (servers.length === 0 ? <span className='hint'>No server is set up.</span> : servers.map(s => { const on = draft.mcp!.includes(s); return <button key={s} role='checkbox' aria-checked={on} data-testid='vader-saved-mcp' className='r' style={{ gap: 9 }} onClick={() => set({ mcp: on ? draft.mcp!.filter(x => x !== s) : [...draft.mcp!, s] })}><span className={on ? 'chk on' : 'chk'}>{on ? <svg className='i' viewBox='0 0 24 24' style={{ width: 11, height: 11, stroke: '#000', strokeWidth: 3 }}><path d='m5 12.5 4.5 4.5L19 7.5' /></svg> : null}</span><span className={on ? 't1' : 't3'}>{s}</span></button> })) : null}
					</div>
					<div className='c' style={{ gap: 8 }}>
						<span className='hint'>Tools it may never call</span>
						{draft.denied.map(t => <span key={t} className='r' style={{ gap: 8 }}><span className='fld mo fl' style={{ height: 28 }} data-testid='vader-saved-denied'>{t}</span><button className='ic' aria-label={`Allow ${t} again`} onClick={() => set({ denied: draft.denied.filter(x => x !== t) })}>{'×'}</button></span>)}
						<span className='c' style={{ gap: 6, alignItems: 'flex-start' }}><input className='fld mo' style={{ height: 28, width: '100%' }} data-testid='vader-saved-denied-input' placeholder='tool name' value={toolText} onChange={e => setToolText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && toolText.trim()) { set({ denied: [...new Set([...draft.denied, toolText.trim()])] }); setToolText('') } }} /><button className='tx' style={{ padding: 0 }} data-testid='vader-saved-denied-add' disabled={!toolText.trim()} onClick={() => { set({ denied: [...new Set([...draft.denied, toolText.trim()])] }); setToolText('') }}>+ Add a tool</button></span>
					</div>
				</div>
				{problem ? <Note kind='warn' testId='vader-saved-problem'>{problem}</Note> : null}
				<div className='r' style={{ gap: 10 }}><button className='pb' data-testid='vader-saved-save' disabled={!dirty} onClick={save}>{creating ? 'Create agent' : 'Save'}</button><button className='tx' data-testid='vader-saved-discard' disabled={!dirty && !creating} onClick={() => { if (creating) { setCreating(false) } else setDraft(saved); setProblem('') }}>{creating ? 'Cancel' : 'Discard changes'}</button></div>
			</div> : null}
		</div>
	</div>
}
