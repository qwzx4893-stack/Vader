/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Settings > Coding Agents: one card per agent whose subscription or free tier the person can use inside Vader, plus the picker in the chat box.
// The behaviour (what runs, what is downloaded) is in browser/externalAgents/externalAgentsService.ts and electron-main/externalAgentMainService.ts.

import React, { useEffect, useState } from 'react'
import { URI } from '../../../../../../../base/common/uri.js'
import { agentLogos } from '../../../../common/externalAgents/agentLogoData.js'
import { LogoNode } from '../../../../common/providerLogoData.js'
import { ExternalAgentDef, ExternalAgentLogoName, externalAgentCatalog } from '../../../../common/externalAgents/externalAgentCatalog.js'
import { AgentConfigOption, CustomAcpAgent, ExternalAgentStatus, ProbeResult } from '../../../../common/externalAgents/externalAgentTypes.js'
import { VaderButtonBgDarken, VaderCustomDropdownBox, VaderSimpleInputBox } from '../util/inputs.js'
import { useAccessor, useChatThreadsState, useExternalAgentsState, useSettingsState } from '../util/services.js'
import { SignInState } from '../../../externalAgents/externalAgentsService.js'

const build = (node: LogoNode, i: number): React.ReactNode => {
	const [tag, attrs, children] = node
	return React.createElement(tag, { key: i, ...attrs }, ...children.map(build))
}

/** The agent's mark in the text colour, built with createElement (no innerHTML), like the provider logos. */
export const AgentLogo = ({ logo, size = 20 }: { logo: ExternalAgentLogoName, size?: number }) => {
	const data = agentLogos[logo]
	return (
		<svg className='inline-block flex-none' xmlns='http://www.w3.org/2000/svg' viewBox={data.vb} width={size} height={size} fill='currentColor' aria-hidden='true' data-agent-logo={logo}>
			{data.els.map(build)}
		</svg>
	)
}

const PrimaryButton = ({ children, onClick, disabled, testId }: { children: React.ReactNode, onClick: () => void, disabled?: boolean, testId?: string }) => (
	<button
		data-testid={testId}
		disabled={disabled}
		onClick={onClick}
		className={`bg-[#0e70c0] px-3 py-1 text-sm text-white rounded-sm ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[#1177cb] cursor-pointer'}`}
	>{children}</button>
)

const SecondaryButton = ({ children, onClick, testId, disabled }: { children: React.ReactNode, onClick: () => void, testId?: string, disabled?: boolean }) => (
	<VaderButtonBgDarken className='px-3 py-1 text-sm' onClick={onClick} disabled={disabled}><span data-testid={testId}>{children}</span></VaderButtonBgDarken>
)

/** the words next to the agent's name: where it stands */
const chipText = (def: ExternalAgentDef, status: ExternalAgentStatus | undefined, sign: SignInState | undefined, inUse: boolean): string => {
	if (inUse) { return 'In use in the chat' }
	switch (status?.state) {
		case 'ready':
			if (def.kind === 'terminal') { return 'Installed' }
			return sign?.state === 'in' ? 'Connected' : sign?.state === 'out' ? 'Not connected' : sign?.state === 'unknown' ? 'Ready' : 'Checking sign-in...'
		case 'not-installed': return 'Not installed'
		case 'needs-node': return 'Needs Node.js'
		case 'unsupported': return 'Not available for this computer'
		default: return 'Checking...'
	}
}

const ProbeLine = ({ id, probe }: { id: string, probe: ProbeResult }) => probe.ok
	? <div className='text-xs text-green-500 select-text' data-testid={`vader-external-agent-${id}-probe`} data-ok='true'>
		Works: {probe.agentName ?? 'the agent'}{probe.agentVersion ? ` ${probe.agentVersion}` : ''} answered in {((probe.ms ?? 0) / 1000).toFixed(1)} s.
		{probe.authMethods?.length ? ` Sign-in: ${probe.authMethods.map(a => a.name).join(', ')}.` : ''}
		{probe.canResume ? ' It can continue a conversation after a restart.' : ''}
	</div>
	: <div className='text-xs text-red-400 select-text' data-testid={`vader-external-agent-${id}-probe`} data-ok='false'>Test failed: {probe.error}</div>

const AgentCard = ({ def }: { def: ExternalAgentDef }) => {
	const accessor = useAccessor()
	const service = accessor.get('IExternalAgentsService')
	const settingsService = accessor.get('IVaderSettingsService')
	const openerService = accessor.get('IOpenerService')
	const settingsState = useSettingsState()
	const { statuses, busy, errors, probes, signIn, opened } = useExternalAgentsState()
	const [more, setMore] = useState(false)

	const status = statuses[def.id]
	const working = busy[def.id]
	const error = errors[def.id]
	const probe = probes[def.id]
	const sign = signIn[def.id]
	const inUse = settingsState.globalSettings.externalAgentId === def.id
	const ready = status?.state === 'ready'
	const isChat = def.kind === 'acp'
	const installable = !!status && !ready && status.state !== 'unsupported' && (status.state !== 'needs-node' || def.kind === 'terminal')
	const own = ready && isChat && status?.source === 'vader'      // the copy Vader downloaded (the only one it may update or delete)
	const mustConnect = ready && isChat && sign?.state === 'out'
	const canUse = ready && isChat && (sign?.state === 'in' || sign?.state === 'unknown')

	return (
		<div className='border border-vader-border-2 rounded-md p-3 flex flex-col gap-2' data-testid={`vader-external-agent-${def.id}`} data-state={status?.state ?? 'checking'} data-signed-in={sign?.state ?? ''} data-in-use={inUse ? 'true' : 'false'}>
			<div className='flex items-center gap-2'>
				<AgentLogo logo={def.logo} size={22} />
				<span className='text-base font-medium'>{def.name}</span>
				<span className='text-[10px] uppercase tracking-wide text-vader-fg-3 border border-vader-border-2 rounded px-1' title={isChat ? 'Its conversation appears in the Vader chat' : 'Runs unchanged in a Vader terminal'}>{isChat ? 'Chat' : 'Terminal'}</span>
				<span className={`ml-auto text-xs ${sign?.state === 'in' || inUse ? 'text-green-500' : 'text-vader-fg-3'}`} data-testid={`vader-external-agent-${def.id}-state`}>{chipText(def, status, sign, inUse)}</span>
			</div>
			<div className='text-sm'>{def.tagline}</div>
			{def.note && <div className='text-xs text-vader-fg-3'>{def.note}</div>}
			{ready && isChat && status?.source === 'local' && <div className='text-xs text-vader-fg-3' data-testid={`vader-external-agent-${def.id}-found`}>Found on this computer{status.installedVersion ? ` (version ${status.installedVersion})` : ''}: Vader uses it as it is, nothing is downloaded.</div>}
			{own && <div className='text-xs text-vader-fg-3' data-testid={`vader-external-agent-${def.id}-version`}>
				Installed by Vader · version {status!.installedVersion}{status!.latestVersion ? <> · <span className='text-[#4aa3ff]'>{status!.latestVersion} is available</span></> : ' · up to date'}
			</div>}
			{def.acp && !ready && <div className='text-xs text-vader-fg-3'>Sign-in: {def.acp.loginNote}</div>}
			{mustConnect && <div className='text-xs text-vader-fg-3'>{def.acp?.loginNote}</div>}
			{probe && <ProbeLine id={def.id} probe={probe} />}
			{error && <div className='text-xs text-red-400 select-text' data-testid={`vader-external-agent-${def.id}-error`}>{error}</div>}
			<div className='flex flex-wrap items-center gap-2 mt-1'>
				{working
					? <span className='text-sm text-vader-fg-3 flex items-center gap-2' data-testid={`vader-external-agent-${def.id}-busy`} role='status'>{working}</span>
					: <>
						{installable && <PrimaryButton testId={`vader-external-agent-${def.id}-install`} onClick={() => service.install(def.id)}>Install</PrimaryButton>}
						{mustConnect && <PrimaryButton testId={`vader-external-agent-${def.id}-connect`} onClick={() => service.connect(def.id)}>Connect</PrimaryButton>}
						{canUse && !inUse && <PrimaryButton testId={`vader-external-agent-${def.id}-use`} onClick={() => settingsService.setGlobalSetting('externalAgentId', def.id)}>Use in the chat</PrimaryButton>}
						{canUse && inUse && <SecondaryButton onClick={() => settingsService.setGlobalSetting('externalAgentId', null)}>Use my models instead</SecondaryButton>}
						{ready && !isChat && <PrimaryButton testId={`vader-external-agent-${def.id}-open`} onClick={() => service.openInTerminal(def.id)}>{opened[def.id] ? 'Open in a terminal' : 'Connect'}</PrimaryButton>}
						{own && status?.latestVersion && <SecondaryButton testId={`vader-external-agent-${def.id}-update`} onClick={() => service.install(def.id)}>Update to {status.latestVersion}</SecondaryButton>}
					</>}
				<SecondaryButton onClick={() => openerService.open(URI.parse(def.website))}>Website</SecondaryButton>
				{ready && isChat && !working && <button className='text-sm px-2 py-1 text-vader-fg-3 hover:text-vader-fg-1' aria-expanded={more} aria-label={`More actions for ${def.name}`} data-testid={`vader-external-agent-${def.id}-more`} onClick={() => setMore(m => !m)}>{more ? 'Less' : 'More'}</button>}
			</div>
			{more && ready && isChat && !working && (
				<div className='flex flex-wrap items-center gap-2 pt-1 border-t border-vader-border-2'>
					<SecondaryButton testId={`vader-external-agent-${def.id}-test`} onClick={() => service.testConnection(def.id)}>Test connection</SecondaryButton>
					{sign?.state === 'in' && sign.canSignOut && <SecondaryButton testId={`vader-external-agent-${def.id}-signout`} onClick={() => service.signOut(def.id)}>Sign out</SecondaryButton>}
					{own && <SecondaryButton testId={`vader-external-agent-${def.id}-remove`} onClick={() => service.uninstall(def.id)}>Remove</SecondaryButton>}
				</div>
			)}
		</div>
	)
}

const CustomAgents = () => {
	const accessor = useAccessor()
	const service = accessor.get('IExternalAgentsService')
	const settingsService = accessor.get('IVaderSettingsService')
	const settingsState = useSettingsState()
	const { statuses, busy, probes, signIn } = useExternalAgentsState()
	const agents = settingsState.globalSettings.customAcpAgents
	const [name, setName] = useState('')
	const [command, setCommand] = useState('')
	const [args, setArgs] = useState('')
	const valid = !!name.trim() && !!command.trim()

	const add = async () => {
		if (!valid) { return }
		const added = await service.addCustomAgent({ name: name.trim(), command: command.trim(), args: args.split(/\s+/).filter(Boolean) })
		if (added) { setName(''); setCommand(''); setArgs('') }
	}

	return (
		<div className='mt-6' data-testid='vader-external-agent-custom'>
			<h3 className='text-lg mb-1 flex items-center gap-2'><AgentLogo logo='custom' size={18} />Your own agent</h3>
			<div className='text-xs text-vader-fg-3 mb-3 max-w-[620px]'>Any program that speaks the Agent Client Protocol (ACP) on its standard input and output can be added. It runs with your user's rights, so add only programs you trust. The agent list at agentclientprotocol.com shows what exists.</div>
			{agents.map((a: CustomAcpAgent) => {
				const ready = statuses[a.id]?.state === 'ready'
				const sign = signIn[a.id]
				const chip = busy[a.id] ?? (ready ? (sign?.state === 'out' ? 'Not connected' : sign?.state === 'in' ? 'Connected' : sign?.state === 'checking' ? 'Checking sign-in...' : 'Ready') : statuses[a.id]?.state === 'missing-command' ? 'Program not found' : 'Checking...')
				return (
					<div key={a.id} className='py-1 text-sm' data-testid={`vader-external-agent-${a.id}`} data-signed-in={sign?.state ?? ''}>
						<div className='flex items-center gap-2 min-w-0'>
							<AgentLogo logo='custom' size={16} />
							<span className='shrink-0'>{a.name}</span>
							<code className='text-xs text-vader-fg-3 truncate min-w-0'>{[a.command, ...a.args].join(' ')}</code>
							<span className='text-xs text-vader-fg-3 ml-auto shrink-0'>{chip}</span>
						</div>
						<div className='flex flex-wrap items-center gap-2 pl-6 pt-1'>
							{ready && !busy[a.id] && sign?.state === 'out' && <SecondaryButton testId={`vader-external-agent-${a.id}-connect`} onClick={() => service.connect(a.id)}>Connect</SecondaryButton>}
							{ready && !busy[a.id] && sign?.state !== 'out' && (settingsState.globalSettings.externalAgentId === a.id
								? <SecondaryButton onClick={() => settingsService.setGlobalSetting('externalAgentId', null)}>Use my models instead</SecondaryButton>
								: <SecondaryButton testId={`vader-external-agent-${a.id}-use`} onClick={() => settingsService.setGlobalSetting('externalAgentId', a.id)}>Use in the chat</SecondaryButton>)}
							{ready && !busy[a.id] && <SecondaryButton testId={`vader-external-agent-${a.id}-test`} onClick={() => service.testConnection(a.id)}>Test connection</SecondaryButton>}
							<SecondaryButton testId={`vader-external-agent-${a.id}-remove`} onClick={() => service.removeCustomAgent(a.id)}>Remove</SecondaryButton>
						</div>
						{probes[a.id] && <div className='pl-6'><ProbeLine id={a.id} probe={probes[a.id]!} /></div>}
					</div>
				)
			})}
			<div className='flex flex-wrap items-center gap-2 mt-2'>
				<div className='w-40'><VaderSimpleInputBox value={name} onChangeValue={setName} placeholder='Name' compact data-testid='vader-external-agent-custom-name' /></div>
				<div className='w-48'><VaderSimpleInputBox value={command} onChangeValue={setCommand} placeholder='Program (e.g. my-agent)' compact data-testid='vader-external-agent-custom-command' /></div>
				<div className='w-48'><VaderSimpleInputBox value={args} onChangeValue={setArgs} placeholder='Arguments (e.g. --acp)' compact data-testid='vader-external-agent-custom-args' /></div>
				<SecondaryButton disabled={!valid} onClick={add}>Add</SecondaryButton>
			</div>
		</div>
	)
}

export const ExternalAgentsSection = () => {
	const accessor = useAccessor()
	const service = accessor.get('IExternalAgentsService')
	const notificationService = accessor.get('INotificationService')
	const settingsState = useSettingsState()
	const [checking, setChecking] = useState(false)
	const customKey = JSON.stringify(settingsState.globalSettings.customAcpAgents)

	useEffect(() => { service.refresh() }, [service, customKey])

	const checkRegistry = async () => {
		setChecking(true)
		try {
			const updated = await service.checkRegistry()
			notificationService.info(updated.length ? `Newer versions found for: ${updated.join(', ')}.` : 'The agents are up to date.')
		} catch (e) {
			notificationService.warn(`Could not read the agent list: ${e instanceof Error ? e.message : String(e)}`)
		}
		setChecking(false)
	}

	return (
		<div data-testid='vader-settings-external-agents'>
			<h2 className='text-3xl mb-2'>Coding Agents</h2>
			<h4 className='text-vader-fg-3 mb-4 max-w-[640px]'>Already pay for Codex, Cursor, Copilot, Claude or Antigravity, or want a free tier? Use that account here. Vader starts the vendor's own program and you sign in on the vendor's own page; Vader never sees your password or token. The agent keeps its own tools and its own permission rules, and its usage is counted on your account with the vendor.</h4>
			<div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
				{externalAgentCatalog.map(def => <AgentCard key={def.id} def={def} />)}
			</div>
			<div className='mt-3'>
				<VaderButtonBgDarken className='px-3 py-1 text-sm opacity-80' disabled={checking} onClick={checkRegistry}>{checking ? 'Checking...' : 'Check for newer agent versions'}</VaderButtonBgDarken>
			</div>
			<CustomAgents />
		</div>
	)
}

type PickerOption = { id: string | null, name: string, logo: ExternalAgentLogoName | null }

const ORDER = ['model', 'mode', 'thought_level']

/** The agent's own settings for this chat (its model, its mode, how hard it thinks), as the agent offers them. */
const AgentConfigPickers = ({ threadId, className }: { threadId: string, className: string }) => {
	const accessor = useAccessor()
	const service = accessor.get('IExternalAgentsService')
	const { configOfThread } = useExternalAgentsState()
	const options = (configOfThread[threadId] ?? [])
		.filter((o: AgentConfigOption) => o.type === 'select' && (o.choices?.length ?? 0) > 1)
		.sort((a, b) => (ORDER.indexOf(a.category ?? '') + 1 || 9) - (ORDER.indexOf(b.category ?? '') + 1 || 9))
		.slice(0, 3)
	return <>
		{options.map(o => {
			const choices = [...(o.choices ?? [])]
			const selected = choices.find(c => c.value === o.value) ?? choices[0]
			return (
				<span key={o.id} data-testid={`vader-agent-config-${o.id}`} title={o.description ?? o.name}>
					<VaderCustomDropdownBox
						options={choices}
						selectedOption={selected}
						onChangeOption={(c: { value: string }) => service.setConfigOption(threadId, o.id, c.value)}
						getOptionDisplayName={(c: { name: string }) => c.name}
						getOptionDropdownName={(c: { name: string }) => c.name}
						getOptionDropdownDetail={(c: { description?: string }) => c.description ?? o.name}
						getOptionsEqual={(a: { value: string }, b: { value: string }) => a.value === b.value}
						className={className}
						matchInputWidth={false}
					/>
				</span>
			)
		})}
	</>
}

/** In the chat box: switch between your Vader models and a coding agent whose account you connected. Hidden until an agent is ready. */
export const ExternalAgentChatPicker = ({ className }: { className: string }) => {
	const accessor = useAccessor()
	const service = accessor.get('IExternalAgentsService')
	const settingsService = accessor.get('IVaderSettingsService')
	const settingsState = useSettingsState()
	const threadId = useChatThreadsState().currentThreadId
	const { statuses } = useExternalAgentsState()
	useEffect(() => { service.refresh() }, [service])

	const selectedId = settingsState.globalSettings.externalAgentId
	const customs = settingsState.globalSettings.customAcpAgents
	const ready: PickerOption[] = [
		...externalAgentCatalog.filter(d => d.kind === 'acp' && statuses[d.id]?.state === 'ready').map(d => ({ id: d.id, name: d.name, logo: d.logo })),
		...customs.filter(c => statuses[c.id]?.state === 'ready').map(c => ({ id: c.id, name: c.name, logo: 'custom' as const })),
	]
	if (ready.length === 0 && !selectedId) { return null }

	const options: PickerOption[] = [{ id: null, name: 'My models', logo: null }, ...ready]
	const selected = options.find(o => o.id === selectedId) ?? (selectedId ? { id: selectedId, name: externalAgentCatalog.find(d => d.id === selectedId)?.name ?? customs.find(c => c.id === selectedId)?.name ?? selectedId, logo: null } : options[0])

	return (
		<>
			<span data-testid='vader-external-agent-picker'>
				<VaderCustomDropdownBox
					options={options}
					selectedOption={selected}
					onChangeOption={(o: PickerOption) => settingsService.setGlobalSetting('externalAgentId', o.id)}
					getOptionDisplayName={(o: PickerOption) => selectedId === o.id ? o.name : o.id === null ? 'My models' : o.name}
					getOptionDropdownName={(o: PickerOption) => o.name}
					getOptionDropdownDetail={(o: PickerOption) => o.id === null ? 'Your own keys and local models' : 'Your account with the vendor'}
					getOptionsEqual={(a: PickerOption, b: PickerOption) => a.id === b.id}
					className={className}
					matchInputWidth={false}
				/>
			</span>
			{selectedId && <AgentConfigPickers threadId={threadId} className={className} />}
		</>
	)
}
