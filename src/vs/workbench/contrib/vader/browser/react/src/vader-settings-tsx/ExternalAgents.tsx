/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Settings > Coding agents: one card per agent whose subscription or free tier the person can use inside Vader, plus the picker in the chat box.
// The behaviour (what runs, what is downloaded) is in browser/externalAgents/externalAgentsService.ts and electron-main/externalAgentMainService.ts.

import React, { useEffect, useState } from 'react'
import { URI } from '../../../../../../../base/common/uri.js'
import { agentLogos } from '../../../../common/externalAgents/agentLogoData.js'
import { LogoNode } from '../../../../common/providerLogoData.js'
import { ExternalAgentDef, ExternalAgentLogoName, externalAgentCatalog } from '../../../../common/externalAgents/externalAgentCatalog.js'
import { ExternalAgentStatus } from '../../../../common/externalAgents/externalAgentTypes.js'
import { VaderButtonBgDarken, VaderCustomDropdownBox, VaderSimpleInputBox } from '../util/inputs.js'
import { useAccessor, useExternalAgentsState, useSettingsState } from '../util/services.js'

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

const stateText = (def: ExternalAgentDef, status: ExternalAgentStatus | undefined): string => {
	switch (status?.state) {
		case 'ready': return def.kind === 'terminal' ? 'Installed' : 'Ready'
		case 'not-installed': return 'Not installed'
		case 'needs-node': return 'Needs Node.js'
		case 'unsupported': return 'Not available for this computer'
		default: return 'Checking...'
	}
}

const AgentCard = ({ def }: { def: ExternalAgentDef }) => {
	const accessor = useAccessor()
	const service = accessor.get('IExternalAgentsService')
	const settingsService = accessor.get('IVaderSettingsService')
	const openerService = accessor.get('IOpenerService')
	const settingsState = useSettingsState()
	const { statuses, busy, errors } = useExternalAgentsState()

	const status = statuses[def.id]
	const working = busy[def.id]
	const error = errors[def.id]
	const inUse = settingsState.globalSettings.externalAgentId === def.id
	const ready = status?.state === 'ready'
	const btn = 'px-3 py-1 text-sm'

	return (
		<div className='border border-vader-border-2 rounded-md p-3 flex flex-col gap-2' data-testid={`vader-external-agent-${def.id}`} data-state={status?.state ?? 'checking'} data-in-use={inUse ? 'true' : 'false'}>
			<div className='flex items-center gap-2'>
				<AgentLogo logo={def.logo} size={22} />
				<span className='text-base font-medium'>{def.name}</span>
				<span className='ml-auto text-xs text-vader-fg-3' data-testid={`vader-external-agent-${def.id}-state`}>{inUse ? 'In use in the chat' : stateText(def, status)}</span>
			</div>
			<div className='text-sm'>{def.tagline}</div>
			{def.note && <div className='text-xs text-vader-fg-3'>{def.note}</div>}
			{def.acp && <div className='text-xs text-vader-fg-3'>Sign-in: {def.acp.loginNote} It starts the first time you send a message.</div>}
			{error && <div className='text-xs text-red-400 select-text' data-testid={`vader-external-agent-${def.id}-error`}>{error}</div>}
			<div className='flex flex-wrap items-center gap-2 mt-1'>
				{working
					? <span className='text-sm text-vader-fg-3'>{working}</span>
					: <>
						{!ready && status && status.state !== 'unsupported' && status.state !== 'needs-node' &&
							<VaderButtonBgDarken className={btn} onClick={() => service.install(def.id)}>{def.kind === 'acp' ? 'Download' : 'Install'}</VaderButtonBgDarken>}
						{!ready && status?.state === 'needs-node' && def.kind === 'terminal' &&
							<VaderButtonBgDarken className={btn} onClick={() => service.install(def.id)}>Install</VaderButtonBgDarken>}
						{ready && def.kind === 'acp' && !inUse &&
							<VaderButtonBgDarken className={btn} onClick={() => settingsService.setGlobalSetting('externalAgentId', def.id)}>Use in the chat</VaderButtonBgDarken>}
						{ready && def.kind === 'acp' && inUse &&
							<VaderButtonBgDarken className={btn} onClick={() => settingsService.setGlobalSetting('externalAgentId', null)}>Use my models instead</VaderButtonBgDarken>}
						{ready && def.kind === 'terminal' &&
							<VaderButtonBgDarken className={btn} onClick={() => service.openInTerminal(def.id)}>Open in a terminal</VaderButtonBgDarken>}
					</>}
				<VaderButtonBgDarken className={`${btn} opacity-70`} onClick={() => openerService.open(URI.parse(def.website))}>Website</VaderButtonBgDarken>
			</div>
		</div>
	)
}

const CustomAgents = () => {
	const accessor = useAccessor()
	const settingsService = accessor.get('IVaderSettingsService')
	const settingsState = useSettingsState()
	const { statuses } = useExternalAgentsState()
	const agents = settingsState.globalSettings.customAcpAgents
	const [name, setName] = useState('')
	const [command, setCommand] = useState('')
	const [args, setArgs] = useState('')
	const valid = !!name.trim() && !!command.trim()

	const add = () => {
		if (!valid) { return }
		const id = `custom-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent'}`
		const next = [...agents.filter(a => a.id !== id), { id, name: name.trim(), command: command.trim(), args: args.split(/\s+/).filter(Boolean) }]
		settingsService.setGlobalSetting('customAcpAgents', next)
		setName(''); setCommand(''); setArgs('')
	}
	const remove = (id: string) => {
		settingsService.setGlobalSetting('customAcpAgents', agents.filter(a => a.id !== id))
		if (settingsState.globalSettings.externalAgentId === id) { settingsService.setGlobalSetting('externalAgentId', null) }
	}

	return (
		<div className='mt-6' data-testid='vader-external-agent-custom'>
			<h3 className='text-lg mb-1 flex items-center gap-2'><AgentLogo logo='custom' size={18} />Your own agent</h3>
			<div className='text-xs text-vader-fg-3 mb-3 max-w-[620px]'>Any program that speaks the Agent Client Protocol (ACP) on its standard input and output can be added. It runs with your user's rights, so add only programs you trust. The agent list at agentclientprotocol.com shows what exists.</div>
			{agents.map(a => (
				<div key={a.id} className='flex items-center gap-2 py-1 text-sm' data-testid={`vader-external-agent-${a.id}`}>
					<AgentLogo logo='custom' size={16} />
					<span>{a.name}</span>
					<code className='text-xs text-vader-fg-3 truncate'>{[a.command, ...a.args].join(' ')}</code>
					<span className='text-xs text-vader-fg-3 ml-auto'>{statuses[a.id]?.state === 'ready' ? 'Ready' : statuses[a.id]?.state === 'missing-command' ? 'Program not found' : 'Checking...'}</span>
					{statuses[a.id]?.state === 'ready' && (settingsState.globalSettings.externalAgentId === a.id
						? <VaderButtonBgDarken className='px-3 py-0.5 text-sm' onClick={() => settingsService.setGlobalSetting('externalAgentId', null)}>Use my models instead</VaderButtonBgDarken>
						: <VaderButtonBgDarken className='px-3 py-0.5 text-sm' onClick={() => settingsService.setGlobalSetting('externalAgentId', a.id)}>Use in the chat</VaderButtonBgDarken>)}
					<VaderButtonBgDarken className='px-3 py-0.5 text-sm' onClick={() => remove(a.id)}>Remove</VaderButtonBgDarken>
				</div>
			))}
			<div className='flex flex-wrap items-center gap-2 mt-2'>
				<div className='w-40'><VaderSimpleInputBox value={name} onChangeValue={setName} placeholder='Name' compact data-testid='vader-external-agent-custom-name' /></div>
				<div className='w-48'><VaderSimpleInputBox value={command} onChangeValue={setCommand} placeholder='Program (e.g. my-agent)' compact data-testid='vader-external-agent-custom-command' /></div>
				<div className='w-48'><VaderSimpleInputBox value={args} onChangeValue={setArgs} placeholder='Arguments (e.g. --acp)' compact data-testid='vader-external-agent-custom-args' /></div>
				<VaderButtonBgDarken className='px-3 py-1 text-sm' disabled={!valid} onClick={add}>Add</VaderButtonBgDarken>
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
			<h4 className='text-vader-fg-3 mb-4 max-w-[640px]'>Already pay for Codex, Cursor or Claude, or want a free tier? Use that account here. Vader starts the vendor's own program and you sign in on the vendor's own page; Vader never sees your password or token. The agent keeps its own tools and its own permission rules, and its usage is counted on your account with the vendor.</h4>
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

/** In the chat box: switch between your Vader models and a coding agent whose account you connected. Hidden until an agent is ready. */
export const ExternalAgentChatPicker = ({ className }: { className: string }) => {
	const accessor = useAccessor()
	const service = accessor.get('IExternalAgentsService')
	const settingsService = accessor.get('IVaderSettingsService')
	const settingsState = useSettingsState()
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
	)
}
