/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { displayInfoOfProviderName, FeatureName, featureNames, isFeatureNameDisabled, localProviderNames, ModelSelection, modelSelectionsEqual, nonlocalProviderNames, ProviderName, providerNames, SettingsOfProvider } from '../../../../../../../workbench/contrib/vader/common/vaderSettingsTypes.js'
import { useSettingsState, useRefreshModelState, useAccessor, useCloudModelListState } from '../util/services.js'
import { isCloudListedProvider } from '../../../../common/cloudModelListTypes.js'
import { _VaderSelectBox } from '../util/inputs.js'
import { ProviderModelPicker } from './ProviderModelPicker.js'
import { SelectBox } from '../../../../../../../base/browser/ui/selectBox/selectBox.js'
import { IconWarning } from '../sidebar-tsx/SidebarChat.js'
import { VADER_OPEN_SETTINGS_ACTION_ID, VADER_TOGGLE_SETTINGS_ACTION_ID } from '../../../actionIDs.js'
import { modelFilterOfFeatureName, ModelOption } from '../../../../../../../workbench/contrib/vader/common/vaderSettingsService.js'
import { WarningBox } from './WarningBox.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'

const optionsEqual = (m1: ModelOption[], m2: ModelOption[]) => {
	if (m1.length !== m2.length) return false
	for (let i = 0; i < m1.length; i++) {
		if (!modelSelectionsEqual(m1[i].selection, m2[i].selection)) return false
	}
	return true
}

const ModelSelectBox = ({ options, featureName, className }: { options: ModelOption[], featureName: FeatureName, className: string }) => {
	const accessor = useAccessor()
	const vaderSettingsService = accessor.get('IVaderSettingsService')

	const selection = vaderSettingsService.state.modelSelectionOfFeature[featureName]
	const selectedOption = selection ? vaderSettingsService.state._modelOptions.find(v => modelSelectionsEqual(v.selection, selection))! : options[0]

	const onChangeOption = useCallback((newOption: ModelOption) => {
		vaderSettingsService.setModelSelectionOfFeature(featureName, newOption.selection)
	}, [vaderSettingsService, featureName])

	// a saved choice that is not among the models offered here (a provider was removed, or the feature needs a kind of model) moves to the first one offered
	useEffect(() => {
		if (options.length === 0 || selectedOption !== undefined && options.some(o => modelSelectionsEqual(o.selection, selectedOption.selection))) return
		onChangeOption(options[0])
	}, [options, selectedOption, onChangeOption])

	// the picker shows one provider's live list flat, and several providers as a list of providers that open into their models (ProviderModelPicker)
	const pickerOptions = useMemo(() => options.map(o => ({ selection: o.selection, providerName: o.selection.providerName, providerTitle: displayInfoOfProviderName(o.selection.providerName).title, modelName: o.selection.modelName })), [options])

	// what the picker says besides the models: the providers that have no key (offered, not hidden), whether each list is being asked for or could not be, and where to add a key
	const settingsState = useSettingsState()
	const cloud = useCloudModelListState()
	const refresh = accessor.get('IRefreshModelService')
	const commands = accessor.get('ICommandService')
	const keyed = useMemo(() => Array.from(new Set(options.map(o => o.selection.providerName))), [options])
	const providerStates = useMemo(() => keyed.map(p => {
		const st = isCloudListedProvider(p) ? cloud[p] : undefined
		return { providerName: p, providerTitle: displayInfoOfProviderName(p).title, status: st ? (st.status === 'loading' ? 'loading' as const : st.status === 'error' ? 'error' as const : st.status === 'ok' ? 'ok' as const : 'idle' as const) : 'idle' as const, fetchedAt: isCloudListedProvider(p) ? refresh.cloudFetchedAt[p] : undefined }
	}), [keyed, cloud, refresh])
	const unkeyed = useMemo(() => nonlocalProviderNames.filter(p => !(settingsState.settingsOfProvider[p] as { _didFillInProviderSettings?: boolean })._didFillInProviderSettings && !keyed.includes(p)), [settingsState.settingsOfProvider, keyed])
	const offered = useMemo(() => (['openAI', 'anthropic', 'gemini', 'groq', 'openRouter', 'xAI', 'mistral', 'deepseek'] as ProviderName[]).filter(p => unkeyed.includes(p)).slice(0, 3).map(p => ({ providerName: p, providerTitle: displayInfoOfProviderName(p).title })), [unkeyed])

	return <ProviderModelPicker
		options={pickerOptions}
		selected={selectedOption?.selection}
		onChange={(o) => onChangeOption({ name: o.modelName, selection: o.selection })}
		className={className}
		providerStates={providerStates}
		withoutKey={featureName === 'Chat' ? offered : []}
		addableCount={featureName === 'Chat' ? unkeyed.length : undefined}
		isLocal={(p) => (localProviderNames as string[]).includes(p)}
		onRetry={(p) => { if (isCloudListedProvider(p)) void refresh.refreshCloudModels(p) }}
		onAddKey={() => { void commands.executeCommand(VADER_OPEN_SETTINGS_ACTION_ID, 'models') }}
		onOpen={() => { for (const p of keyed) { if (isCloudListedProvider(p)) void refresh.refreshCloudModelsIfStale(p) } }}
	/>
}


const MemoizedModelDropdown = ({ featureName, className }: { featureName: FeatureName, className: string }) => {
	const settingsState = useSettingsState()
	const oldOptionsRef = useRef<ModelOption[]>([])
	const [memoizedOptions, setMemoizedOptions] = useState(oldOptionsRef.current)

	const { filter, emptyMessage } = modelFilterOfFeatureName[featureName]

	useEffect(() => {
		const oldOptions = oldOptionsRef.current
		const newOptions = settingsState._modelOptions.filter((o) => filter(o.selection, { chatMode: settingsState.globalSettings.chatMode, overridesOfModel: settingsState.overridesOfModel }))

		if (!optionsEqual(oldOptions, newOptions)) {
			setMemoizedOptions(newOptions)
		}
		oldOptionsRef.current = newOptions
	}, [settingsState._modelOptions, filter])

	if (memoizedOptions.length === 0) { // Pretty sure this will never be reached unless filter is enabled
		return <WarningBox text={emptyMessage?.message || 'No models available'} />
	}

	return <ModelSelectBox featureName={featureName} options={memoizedOptions} className={className} />

}

export const ModelDropdown = ({ featureName, className }: { featureName: FeatureName, className: string }) => {
	const settingsState = useSettingsState()

	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')

	const openSettings = () => { commandService.executeCommand(VADER_OPEN_SETTINGS_ACTION_ID); };


	const { emptyMessage } = modelFilterOfFeatureName[featureName]

	// a coding agent chosen for the chat takes the place of the model: the picker next to this box shows which one
	if (featureName === 'Chat' && settingsState.globalSettings.externalAgentId) return null

	const isDisabled = isFeatureNameDisabled(featureName, settingsState)
	if (isDisabled)
		return <WarningBox onClick={openSettings} text={
			emptyMessage && emptyMessage.priority === 'always' ? emptyMessage.message :
				isDisabled === 'needToEnableModel' ? 'Enable a model'
					: isDisabled === 'addModel' ? 'Add a model'
						: (isDisabled === 'addProvider' || isDisabled === 'notFilledIn' || isDisabled === 'providerNotAutoDetected') ? 'Provider required'
							: 'Provider required'
		} />

	return <ErrorBoundary>
		<MemoizedModelDropdown featureName={featureName} className={className} />
	</ErrorBoundary>
}
