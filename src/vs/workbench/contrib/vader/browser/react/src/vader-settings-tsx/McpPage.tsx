/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useState } from 'react'
import { useAccessor, useMCPServiceState, useSettingsState } from '../util/services.js'
import { VADER_OPEN_ADDONS_ACTION_ID } from '../../../actionIDs.js'
import { Icon, Spinner } from '../vader-shell-tsx/icons.js'
import { Note, PageHead, Switch } from './ui.js'
import { explainStart, startingHint, toolsLine } from '../../../../common/mcpStateWords.js'
import { McpToolChangedCard } from '../sidebar-tsx/McpToolChanged.js'

// MCP servers (board R16): the servers the agent can use. A server runs on this computer or talks to a service, and each tool it offers goes through the safety gate.
// State is what the app's MCP service reports (running, starting, stopped, failed with the real error); the switch is the real on/off of that server.

const STATE: { [s: string]: { label: string, color: string } } = {
	success: { label: 'Running', color: '#4cc38a' }, loading: { label: 'Starting', color: '#6ea0ff' }, offline: { label: 'Stopped', color: 'var(--t4)' }, error: { label: 'Failed', color: '#f06a6e' },
}
/** tools are named "<server>_<tool>" by the service; the person reads the tool's own name */
const toolName = (n: string) => n.split('_').slice(1).join('_') || n

export const McpPage = () => {
	const accessor = useAccessor()
	const mcp = accessor.get('IMCPService')
	const commands = accessor.get('ICommandService')
	const state = useMCPServiceState()
	const settings = useSettingsState()
	const [open, setOpen] = useState<string | undefined>()
	const [problem, setProblem] = useState<string | undefined>()
	const entries = Object.entries(state.mcpServerOfName)
	const reveal = async () => { try { await mcp.revealMCPConfigFile(); setProblem(undefined) } catch (e) { setProblem(e instanceof Error ? e.message : String(e)) } }

	return <div data-testid='vader-settings-mcp'>
		<PageHead title='MCP servers' desc='The servers the agent can use. A server runs on this computer or talks to a service, and each tool it offers goes through the safety gate.'
			right={<span className='r' style={{ gap: 8 }}><button className='gb' data-testid='vader-mcp-find' onClick={() => { void commands.executeCommand(VADER_OPEN_ADDONS_ACTION_ID) }}>Find servers in Add-ons<Icon k='right' small /></button><button className='pb' data-testid='vader-mcp-add' onClick={() => void reveal()}>Add by hand</button></span>} />
		{problem ? <div style={{ marginBottom: 12 }}><Note kind='warn' testId='vader-mcp-problem'>The config file could not be opened: {problem}</Note></div> : null}
		{state.error ? <div className='c' style={{ gap: 6, padding: '14px 0', borderTop: '1px solid var(--ln)' }} data-testid='vader-mcp-error'><span className='t1' style={{ fontWeight: 600 }}>The MCP config could not be read</span><span className='t2' style={{ lineHeight: 1.55 }}>{state.error}</span><span><button className='gb' onClick={() => void reveal()}>Open the config file</button></span></div>
			: entries.length === 0 ? <div className='c' style={{ gap: 6, padding: '18px 0', borderTop: '1px solid var(--ln)', borderBottom: '1px solid var(--ln)' }} data-testid='vader-mcp-empty'><span className='t1' style={{ fontWeight: 600 }}>No server is set up</span><span className='t2' style={{ lineHeight: 1.55, maxWidth: 520 }}>Servers from the official MCP registry are in Add-ons, with a trust score and the reasons for it. Adding one writes its entry to your MCP config file, after asking for any key it needs. You can also write an entry by hand.</span></div>
				: <>
					<div className='th' style={{ gridTemplateColumns: '38px minmax(0,1fr) 130px 56px', padding: '0 2px', borderBottom: '1px solid var(--ln)' }}><span /><span>Server</span><span>State</span><span style={{ textAlign: 'right' }}>On</span></div>
					{entries.map(([name, server]) => {
						const on = settings.mcpUserStateOfName[name]?.isOn ?? false
						const st = STATE[server.status] ?? STATE.offline
						const tools = server.tools ?? []
						const isOpen = open === name
						const pending = mcp.pendingToolsOf(name)
						const keptOff = settings.mcpUserStateOfName[name]?.offTools ?? []
						return <div key={name} data-testid='vader-mcp-server' data-server={name} data-status={server.status} style={{ borderBottom: '1px solid var(--ln)' }}>
							<div className='td' style={{ gridTemplateColumns: '38px minmax(0,1fr) 130px 56px', height: 58, padding: '0 2px', borderBottom: 0 }}>
								<span className='logo sm'><Icon k='plug' /></span>
								<button className='c' style={{ minWidth: 0, gap: 1 }} aria-expanded={isOpen} data-testid='vader-mcp-expand' onClick={() => setOpen(isOpen ? undefined : name)}>
									<span className='t1' style={{ fontWeight: 600 }}>{name}</span>
									<span className='hint tr mo'>{server.command ? server.command : 'remote server'}{server.status === 'success' ? ` · ${tools.length} tool${tools.length === 1 ? '' : 's'}` : ''}</span>
								</button>
								<span className='r' style={{ gap: 8 }}>{server.status === 'loading' ? <Spinner /> : <span className='dot' style={{ background: st.color }} />}<span className='t2'>{st.label}</span></span>
								<span className='r' style={{ justifyContent: 'flex-end' }}><Switch on={on} label={`${name} on`} testId='vader-mcp-switch' onChange={() => { void mcp.toggleServerIsOn(name, !on) }} /></span>
							</div>
							{server.status === 'loading' && startingHint(server.command) ? <div style={{ padding: '0 2px 12px 52px' }}><span className='hint' data-testid='vader-mcp-starting'>{startingHint(server.command)}</span></div> : null}
							{server.error ? (() => {
								const w = explainStart(name, server.command, server.error)
								return <div className='c' style={{ gap: 8, padding: '0 2px 14px 52px' }} data-testid='vader-mcp-failed'>
									<span className='t1' style={{ fontWeight: 600 }} data-testid='vader-mcp-failed-title'>{w.title}</span>
									<span className='t2' style={{ lineHeight: 1.55, maxWidth: 560 }} data-testid='vader-mcp-failed-text'>{w.text}</span>
									<div style={{ maxWidth: 560 }}><Note kind='warn' testId='vader-mcp-server-error'>{server.error}</Note></div>
									<span className='r' style={{ gap: 8 }}>
										<button className='gb' data-testid='vader-mcp-edit' onClick={() => void reveal()}>Edit the command</button>
										<button className='gb' data-testid='vader-mcp-retry' onClick={() => { void mcp.toggleServerIsOn(name, false).then(() => mcp.toggleServerIsOn(name, true)) }}>Try again</button>
									</span>
								</div>
							})() : null}
							{pending.length > 0 ? <div style={{ padding: '0 2px 14px 52px', maxWidth: 620 }}><McpToolChangedCard server={name} pending={pending} onKeepOff={() => { void mcp.keepToolsOff(name, pending) }} onAllow={() => { void mcp.allowTools(name, pending) }} onRemove={() => { void mcp.removeServer(name) }} /></div> : null}
							{isOpen ? <div className='c' style={{ gap: 8, padding: '0 2px 14px 52px' }} data-testid='vader-mcp-tools'>
								<span className='hint'>Tools it offers</span>
								{tools.length === 0 ? <span className='t3'>{on ? 'None yet.' : 'Switch it on to see its tools.'}</span> : <><div className='r' style={{ gap: 6, flexWrap: 'wrap' }}>{tools.map(t => <span key={t.name} role={keptOff.includes(toolName(t.name)) ? 'button' : undefined} tabIndex={keptOff.includes(toolName(t.name)) ? 0 : undefined} data-testid='vader-mcp-tool' onClick={keptOff.includes(toolName(t.name)) ? () => { void mcp.allowTools(name, [toolName(t.name)]) } : undefined} title={pending.includes(toolName(t.name)) ? 'New: waiting for your answer' : keptOff.includes(toolName(t.name)) ? 'Kept off. Click to allow it' : t.description} data-state={pending.includes(toolName(t.name)) ? 'new' : keptOff.includes(toolName(t.name)) ? 'off' : 'on'} className='mo t2' style={{ border: '1px solid var(--ln2)', borderRadius: 5, padding: '2px 7px', opacity: pending.includes(toolName(t.name)) || keptOff.includes(toolName(t.name)) ? .55 : 1, textDecoration: keptOff.includes(toolName(t.name)) ? 'line-through' : undefined }}>{toolName(t.name)}</span>)}</div><span className='hint' data-testid='vader-mcp-tools-line'>{toolsLine(tools.length)}</span></>}
							</div> : null}
						</div>
					})}
					<p className='hint' style={{ margin: '16px 0 0', maxWidth: 560, lineHeight: 1.55 }}>A tool a server adds after you set it up is not given to the agent until you look at it and allow it. Ask before an MCP tool runs, or allow it, on the Permissions page.</p>
				</>}
	</div>
}
