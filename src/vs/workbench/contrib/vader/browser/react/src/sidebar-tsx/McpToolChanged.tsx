/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React from 'react'
import { useAccessor, useMCPServiceState, useSettingsState } from '../util/services.js'
import { toolChangedWords } from '../../../../common/mcpToolReview.js'

// "A tool changed" (board S07): an MCP server offers a tool that was not there when it was added. The agent is not given the tool until the person answers, here in the chat
// where it would matter, or in Settings, MCP servers. The class names are written out in each className on purpose: the build that scopes Tailwind to Vader's UI prefixes
// only the names it finds written there.

const WithNames = ({ text, names }: { text: string, names: readonly string[] }) => {
	const shown = names.filter(n => text.includes(n))
	if (shown.length === 0) return <>{text}</>
	const parts = text.split(new RegExp(`(${shown.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`))
	return <>{parts.map((p, i) => shown.includes(p) ? <code key={i} className='font-mono text-[0.92em] text-vader-fg-1'>{p}</code> : <React.Fragment key={i}>{p}</React.Fragment>)}</>
}

export const McpToolChangedCard = ({ server, pending, onKeepOff, onAllow, onRemove }: { server: string, pending: readonly string[], onKeepOff: () => void, onAllow: () => void, onRemove: () => void }) => {
	const w = toolChangedWords(server, pending)
	return <div className='motion-safe:animate-card-in rounded-xl border border-vader-border-2 bg-vader-bg-1 px-4 py-3 flex flex-col gap-2' data-testid='vader-mcp-changed' data-server={server} role='alert'>
		<div className='flex items-center gap-2'>
			<svg width='14' height='14' viewBox='0 0 15 15' aria-hidden='true' className='shrink-0'><path d='M7.5 2.2 13.3 12.6H1.7z' fill='none' stroke='#e2a93f' strokeWidth='1.3' strokeLinejoin='round' /></svg>
			<span className='font-semibold text-vader-fg-1' data-testid='vader-mcp-changed-title'>{w.title}</span>
		</div>
		<div className='text-vader-fg-2 leading-relaxed' data-testid='vader-mcp-changed-body'><WithNames text={w.body} names={pending} /></div>
		<div className='flex flex-wrap gap-2 items-center'>
			<button type='button' data-testid='vader-mcp-keep-off' className='px-3 py-1 rounded-md bg-vader-fg-0 text-vader-bg-3 hover:opacity-90 text-sm font-medium' onClick={onKeepOff}>{w.keepOff}</button>
			<button type='button' data-testid='vader-mcp-allow' className='px-3 py-1 rounded-md border border-vader-border-2 text-vader-fg-1 hover:bg-vader-bg-2-hover text-sm' onClick={onAllow}>{w.allow}</button>
			<button type='button' data-testid='vader-mcp-remove' className='px-2 py-1 text-vader-fg-2 hover:text-vader-fg-1 text-sm' onClick={onRemove}>{w.remove}</button>
		</div>
	</div>
}

/** every server that has tools waiting for an answer, as cards (in the chat, above the message box) */
export const McpToolChangedArea = () => {
	const accessor = useAccessor()
	const mcp = accessor.get('IMCPService')
	const state = useMCPServiceState()
	useSettingsState() // the answer is kept in the settings: follow them
	const servers = Object.keys(state.mcpServerOfName).map(name => ({ name, pending: mcp.pendingToolsOf(name) })).filter(s => s.pending.length > 0)
	if (servers.length === 0) return null
	return <>{servers.map(s => <McpToolChangedCard key={s.name} server={s.name} pending={s.pending} onKeepOff={() => { void mcp.keepToolsOff(s.name, s.pending) }} onAllow={() => { void mcp.allowTools(s.name, s.pending) }} onRemove={() => { void mcp.removeServer(s.name) }} />)}</>
}
