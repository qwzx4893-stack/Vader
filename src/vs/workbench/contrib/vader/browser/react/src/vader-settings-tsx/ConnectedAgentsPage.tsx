/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react'
import { URI } from '../../../../../../../base/common/uri.js'
import { ExternalAgentDef, externalAgentCatalog } from '../../../../common/externalAgents/externalAgentCatalog.js'
import { CustomAcpAgent, ProbeResult } from '../../../../common/externalAgents/externalAgentTypes.js'
import { SignInState } from '../../../externalAgents/externalAgentsService.js'
import { AgentLogo } from '../util/AgentLogo.js'
import { useAccessor, useExternalAgentsState, useSettingsState } from '../util/services.js'
import { Field, Note, PageHead } from './ui.js'

// Connected agents (board R11): programs from other companies that the person already pays for, used inside Vader's chat. The sign-in happens in the vendor's own
// program and its own page; Vader never sees the token. The behaviour (what is downloaded, what runs) is in browser/externalAgents/externalAgentsService.ts. Every
// install and every sign-in starts with a click, and the app shows the exact steps before it runs them. The test ids are the ones the real-app tests use.

type Row = { def: ExternalAgentDef }

/** where the agent stands, in the words of the page */
const stateWord = (def: ExternalAgentDef, state: string | undefined, sign: SignInState | undefined, inUse: boolean): { text: string, tone: 'ok' | 'plain' | 'warn' } => {
	if (inUse && state === 'ready' && sign?.state === 'in') return { text: 'In use', tone: 'ok' }
	if (inUse) return { text: 'Selected', tone: 'plain' }
	switch (state) {
		case 'ready':
			if (def.kind === 'terminal') return { text: 'Installed', tone: 'plain' }
			return sign?.state === 'in' ? { text: 'Signed in', tone: 'ok' } : sign?.state === 'out' ? { text: 'Not signed in', tone: 'warn' } : sign?.state === 'checking' ? { text: 'Checking sign-in...', tone: 'plain' } : { text: 'Installed', tone: 'plain' }
		case 'not-installed': return { text: 'Not installed', tone: 'plain' }
		case 'needs-node': return { text: 'Needs Node.js', tone: 'warn' }
		case 'unsupported': return { text: 'Not available for this computer', tone: 'plain' }
		default: return { text: 'Checking...', tone: 'plain' }
	}
}

const ProbeLine = ({ id, probe }: { id: string, probe: ProbeResult }) => probe.ok
	? <span data-testid={`vader-external-agent-${id}-probe`} data-ok='true'><Note kind='ok'><span>Works: {probe.agentName ?? 'the agent'}{probe.agentVersion ? ` ${probe.agentVersion}` : ''} answered in {((probe.ms ?? 0) / 1000).toFixed(1)} s.</span>{probe.authMethods?.length ? <span> Sign-in: {probe.authMethods.map(a => a.name).join(', ')}.</span> : null}{probe.canResume ? <span> It can continue a conversation after a restart.</span> : null}</Note></span>
	: <span data-testid={`vader-external-agent-${id}-probe`} data-ok='false'><Note kind='warn'>Test failed: {probe.error}</Note></span>

const AgentRow = ({ def }: Row) => {
	const accessor = useAccessor()
	const service = accessor.get('IExternalAgentsService')
	const settings = accessor.get('IVaderSettingsService')
	const opener = accessor.get('IOpenerService')
	const g = useSettingsState().globalSettings
	const { statuses, busy, errors, probes, signIn, opened } = useExternalAgentsState()
	const [more, setMore] = useState(false)

	const status = statuses[def.id]
	const working = busy[def.id]
	const error = errors[def.id]
	const probe = probes[def.id]
	const sign = signIn[def.id]
	const inUse = g.externalAgentId === def.id
	const ready = status?.state === 'ready'
	const isChat = def.kind === 'acp'
	const installable = !!status && !ready && status.state !== 'unsupported' && (status.state !== 'needs-node' || def.kind === 'terminal')
	const own = ready && isChat && status?.source === 'vader'      // the copy Vader downloaded (the only one it may update or delete)
	const mustConnect = ready && isChat && (!sign || sign.state === 'out' || sign.state === 'unknown')
	const canUse = ready && isChat && sign?.state === 'in'
	const word = stateWord(def, status?.state, sign, inUse)
	const version = status?.installedVersion

	return <div data-testid={`vader-external-agent-${def.id}`} data-state={status?.state ?? 'checking'} data-signed-in={sign?.state ?? ''} data-in-use={inUse ? 'true' : 'false'} style={{ borderBottom: '1px solid var(--ln)' }}>
		<div className='r' style={{ gap: 14, minHeight: 48, padding: '4px 2px' }}>
			<span className='r t2' style={{ gap: 10, width: 150, flex: 'none' }}><AgentLogo logo={def.logo} size={16} /><span className='t1 tr' style={{ fontWeight: 500 }}>{def.name}</span></span>
			<span className='t3 tr fl' title={def.tagline} style={{ fontSize: 12.5 }}>{def.tagline}</span>
			<span className='t2' data-testid={`vader-external-agent-${def.id}-state`} style={{ color: word.tone === 'ok' ? 'var(--t2)' : word.tone === 'warn' ? 'var(--wa)' : 'var(--t3)', whiteSpace: 'nowrap', fontSize: 12.5 }}>{word.tone === 'ok' ? <span style={{ color: '#4cc38a' }}>{'✓ '}</span> : ''}{word.text}</span>
			{version ? <span className='mo t3' style={{ width: 56, textAlign: 'right' }}>{version}</span> : null}
			<span className='r' style={{ gap: 8, minWidth: 96, justifyContent: 'flex-end', flex: 'none' }}>
				{working ? <span className='t3' data-testid={`vader-external-agent-${def.id}-busy`} role='status'>{working}</span> : <>
					{installable ? <button className='pb' data-testid={`vader-external-agent-${def.id}-install`} onClick={() => service.install(def.id)}>Install</button> : null}
					{mustConnect ? <button className='pb' data-testid={`vader-external-agent-${def.id}-connect`} onClick={() => service.connect(def.id)}>Connect</button> : null}
					{canUse && !inUse ? <button className='pb' data-testid={`vader-external-agent-${def.id}-use`} onClick={() => settings.setGlobalSetting('externalAgentId', def.id)}>Use</button> : null}
					{inUse ? <button className='gb' data-testid={`vader-external-agent-${def.id}-unuse`} onClick={() => settings.setGlobalSetting('externalAgentId', null)}>Use my models</button> : null}
					{ready && !isChat ? <button className='gb' data-testid={`vader-external-agent-${def.id}-open`} onClick={() => service.openInTerminal(def.id)}>{opened[def.id] ? 'Open in a terminal' : 'Connect'}</button> : null}
					{own && status?.latestVersion ? <button className='gb' data-testid={`vader-external-agent-${def.id}-update`} onClick={() => service.install(def.id)}>Update to {status.latestVersion}</button> : null}
				</>}
				{!working ? <button className='tx' aria-expanded={more} aria-label={`More about ${def.name}`} data-testid={`vader-external-agent-${def.id}-more`} onClick={() => setMore(m => !m)}>{more ? 'Less' : 'More'}</button> : null}
			</span>
		</div>
		{error ? <div style={{ padding: '0 2px 10px 50px' }} data-testid={`vader-external-agent-${def.id}-error`}><Note kind='warn'>{error}</Note></div> : null}
		{probe ? <div style={{ padding: '0 2px 10px 50px' }}><ProbeLine id={def.id} probe={probe} /></div> : null}
		{more ? <div className='c' style={{ gap: 8, padding: '0 2px 14px 50px' }}>
			{def.note ? <span className='hint' style={{ lineHeight: 1.5, maxWidth: 600 }}>{def.note}</span> : null}
			{ready && isChat && status?.source === 'local' ? <span className='hint' data-testid={`vader-external-agent-${def.id}-found`}>Found on this computer{version ? ` (version ${version})` : ''}: Vader uses it as it is, nothing is downloaded.</span> : null}
			{own ? <span className='hint' data-testid={`vader-external-agent-${def.id}-version`}>Installed by Vader, version {version}{status!.latestVersion ? <>, <span style={{ color: 'var(--ac)' }}>{status!.latestVersion} is available</span></> : ', up to date'}</span> : null}
			{def.acp && !ready ? <span className='hint' style={{ lineHeight: 1.5 }}>Sign-in: {def.acp.loginNote}</span> : null}
			{mustConnect ? <span className='hint'>{def.acp?.loginNote}</span> : null}
			<span className='r' style={{ gap: 8, flexWrap: 'wrap' }}>
				{ready && isChat ? <button className='gb' data-testid={`vader-external-agent-${def.id}-test`} onClick={() => service.testConnection(def.id)}>Test connection</button> : null}
				{ready && isChat && sign?.state === 'in' && sign.canSignOut ? <button className='gb' data-testid={`vader-external-agent-${def.id}-signout`} onClick={() => service.signOut(def.id)}>Sign out</button> : null}
				{own ? <button className='gb' data-testid={`vader-external-agent-${def.id}-remove`} onClick={() => service.uninstall(def.id)}>Remove</button> : null}
				<button className='gb' onClick={() => { void opener.open(URI.parse(def.website)) }}>Website</button>
			</span>
		</div> : null}
	</div>
}

const CustomAgents = () => {
	const accessor = useAccessor()
	const service = accessor.get('IExternalAgentsService')
	const settings = accessor.get('IVaderSettingsService')
	const g = useSettingsState().globalSettings
	const { statuses, busy, probes, signIn } = useExternalAgentsState()
	const agents = g.customAcpAgents
	const [name, setName] = useState('')
	const [command, setCommand] = useState('')
	const [args, setArgs] = useState('')
	const valid = !!name.trim() && !!command.trim()
	const add = async () => { if (!valid) return; const added = await service.addCustomAgent({ name: name.trim(), command: command.trim(), args: args.split(/\s+/).filter(Boolean) }); if (added) { setName(''); setCommand(''); setArgs('') } }

	return <div className='c' style={{ marginTop: 30, gap: 4 }} data-testid='vader-external-agent-custom'>
		<span className='hint' style={{ padding: '0 2px 4px' }}>Your own agent</span>
		<span className='t2' style={{ lineHeight: 1.55, maxWidth: 600, padding: '0 2px 8px' }}>Any program that speaks the Agent Client Protocol on its standard input and output can be added. It runs with your user&rsquo;s rights, so add only programs you trust. The list at agentclientprotocol.com shows what exists.</span>
		{agents.map((a: CustomAcpAgent) => {
			const ready = statuses[a.id]?.state === 'ready'
			const sign = signIn[a.id]
			const chip = busy[a.id] ?? (ready ? (sign?.state === 'out' ? 'Not signed in' : sign?.state === 'in' ? 'Signed in' : sign?.state === 'checking' ? 'Checking sign-in...' : 'Ready') : statuses[a.id]?.state === 'missing-command' ? 'Program not found' : 'Checking...')
			return <div key={a.id} data-testid={`vader-external-agent-${a.id}`} data-signed-in={sign?.state ?? ''} style={{ borderTop: '1px solid var(--ln)', padding: '8px 2px' }}>
				<div className='r' style={{ gap: 12 }}>
					<span className='logo sm t2'><AgentLogo logo='custom' size={16} /></span>
					<span className='t1' style={{ fontWeight: 600 }}>{a.name}</span>
					<span className='mo t3 tr fl'>{[a.command, ...a.args].join(' ')}</span>
					<span className='t2'>{chip}</span>
				</div>
				<div className='r' style={{ gap: 8, padding: '8px 0 0 42px', flexWrap: 'wrap' }}>
					{ready && !busy[a.id] && sign?.state === 'out' ? <button className='pb' data-testid={`vader-external-agent-${a.id}-connect`} onClick={() => service.connect(a.id)}>Connect</button> : null}
					{g.externalAgentId === a.id ? <button className='gb' data-testid={`vader-external-agent-${a.id}-unuse`} onClick={() => settings.setGlobalSetting('externalAgentId', null)}>Use my models</button> : ready && !busy[a.id] && sign?.state !== 'out' ? <button className='pb' data-testid={`vader-external-agent-${a.id}-use`} onClick={() => settings.setGlobalSetting('externalAgentId', a.id)}>Use</button> : null}
					{ready && !busy[a.id] ? <button className='gb' data-testid={`vader-external-agent-${a.id}-test`} onClick={() => service.testConnection(a.id)}>Test connection</button> : null}
					<button className='tx' data-testid={`vader-external-agent-${a.id}-remove`} onClick={() => service.removeCustomAgent(a.id)}>Remove</button>
				</div>
				{probes[a.id] ? <div style={{ padding: '8px 0 0 42px' }}><ProbeLine id={a.id} probe={probes[a.id]!} /></div> : null}
			</div>
		})}
		<div className='r' style={{ gap: 10, alignItems: 'flex-end', borderTop: '1px solid var(--ln)', paddingTop: 12, flexWrap: 'wrap' }}>
			<Field label='Name' width={150}><input className='fld' placeholder='Name' aria-label='Name' value={name} onChange={e => setName(e.target.value)} /></Field>
			<Field label='Program' width={200}><input className='fld mo' placeholder='Program' aria-label='Program' value={command} onChange={e => setCommand(e.target.value)} /></Field>
			<Field label='Arguments' width={200}><input className='fld mo' placeholder='Arguments' aria-label='Arguments' value={args} onChange={e => setArgs(e.target.value)} /></Field>
			<button className='pb' data-testid='vader-external-agent-custom-add' disabled={!valid} onClick={() => void add()}>Add</button>
		</div>
	</div>
}

export const ConnectedAgentsPage = () => {
	const accessor = useAccessor()
	const service = accessor.get('IExternalAgentsService')
	const notifications = accessor.get('INotificationService')
	const g = useSettingsState().globalSettings
	const [checking, setChecking] = useState(false)
	const customKey = JSON.stringify(g.customAcpAgents)
	useEffect(() => { service.refresh() }, [service, customKey])
	const check = async () => {
		setChecking(true)
		try { const updated = await service.checkRegistry(); notifications.info(updated.length ? `Newer versions found for: ${updated.join(', ')}.` : 'The agents are up to date.') }
		catch (e) { notifications.warn(`Could not read the agent list: ${e instanceof Error ? e.message : String(e)}`) }
		setChecking(false)
	}
	const chat = externalAgentCatalog.filter(d => d.kind === 'acp')
	const terminal = externalAgentCatalog.filter(d => d.kind === 'terminal')

	return <div data-testid='vader-settings-external-agents'>
		<PageHead title='Connected agents' desc='Programs from other companies that you already pay for, used inside Vader’s chat. You sign in with your own account in the vendor’s program. Vader never sees the token. The agent keeps its own tools and permission rules, and its usage is counted on your account.' />
		<div className='r' style={{ paddingBottom: 8 }}><span className='hint fl'>In the chat</span><span className='hint narrow-hide' style={{ marginRight: 8 }}>Versions from the public agent registry</span><button className='tx' data-testid='vader-external-agents-check' disabled={checking} onClick={() => void check()}>{checking ? 'Checking...' : 'Check for newer versions'}</button></div>
		<div style={{ borderTop: '1px solid var(--ln)' }}>{chat.map(def => <AgentRow key={def.id} def={def} />)}</div>
		<div className='hint' style={{ padding: '26px 2px 8px' }}>In a terminal</div>
		<div style={{ borderTop: '1px solid var(--ln)' }}>{terminal.map(def => <AgentRow key={def.id} def={def} />)}</div>
		<CustomAgents />
	</div>
}
