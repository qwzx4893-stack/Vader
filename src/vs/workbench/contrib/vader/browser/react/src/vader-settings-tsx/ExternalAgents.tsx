/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The picker in the chat box for a coding agent whose account the person connected (the page that connects them is ConnectedAgentsPage.tsx).
// The behaviour (what runs, what is downloaded) is in browser/externalAgents/externalAgentsService.ts and electron-main/externalAgentMainService.ts.

import React, { useEffect } from 'react'
import { ExternalAgentLogoName, externalAgentCatalog } from '../../../../common/externalAgents/externalAgentCatalog.js'
import { AgentConfigOption } from '../../../../common/externalAgents/externalAgentTypes.js'
import { VaderCustomDropdownBox } from '../util/inputs.js'
import { useAccessor, useChatThreadsState, useExternalAgentsState, useSettingsState } from '../util/services.js'

export { AgentLogo } from '../util/AgentLogo.js'

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
