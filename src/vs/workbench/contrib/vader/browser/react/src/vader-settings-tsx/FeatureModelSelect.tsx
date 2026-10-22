/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect } from 'react'
import { useAccessor, useSettingsState } from '../util/services.js'
import { ProviderLogo } from '../util/ProviderLogo.js'
import { FeatureName, ModelSelection, modelSelectionsEqual } from '../../../../common/vaderSettingsTypes.js'
import { modelFilterOfFeatureName } from '../../../../common/vaderSettingsService.js'
import { Dropdown, DropOption } from './Dropdown.js'

// A list of the models a feature can use (the chat, suggestions, applying changes, commit messages). The choice is the feature's own setting. A feature that can
// follow the chat's model, or be switched off, offers that as the first entry, and it is the real switch of that feature, not a copy of the chat's model.

type Option = { name: string, selection: ModelSelection }
const key = (s: ModelSelection) => `${s.providerName}/${s.modelName}`

export const FeatureModelSelect = ({ feature, testId, special, onModel, width = 250 }: {
	feature: FeatureName, testId: string, width?: number,
	/** called after a model was picked, for a feature whose "same as chat" or "off" state has to change with it */
	onModel?: () => void,
	/** the first entry: "Same as chat" or "Off". `active` says it is the current state; `onPick` makes it so. */
	special?: { label: string, active: boolean, onPick: () => void },
}) => {
	const accessor = useAccessor()
	const settings = accessor.get('IVaderSettingsService')
	const state = useSettingsState()
	const { filter, emptyMessage } = modelFilterOfFeatureName[feature]
	const options: Option[] = state._modelOptions.filter((o: Option) => filter(o.selection, { chatMode: state.globalSettings.chatMode, overridesOfModel: state.overridesOfModel }))
	const chosen: ModelSelection | null = state.modelSelectionOfFeature[feature]
	const current = chosen && options.some(o => modelSelectionsEqual(o.selection, chosen)) ? chosen : undefined
	// a feature with no usable choice (a provider was removed, or the feature needs a kind of model) takes the first model it can use, unless it is off or follows the chat
	const needsPick = !special?.active && options.length > 0 && !current
	useEffect(() => { if (needsPick) settings.setModelSelectionOfFeature(feature, options[0].selection) }, [needsPick, feature]) // eslint-disable-line react-hooks/exhaustive-deps
	if (options.length === 0 && !special) return <span className='t3' data-testid={testId} style={{ maxWidth: width, textAlign: 'right' }}>{emptyMessage?.message ?? 'No model is set up for this yet'}</span>
	const value = special?.active ? '@special' : current ? key(current) : ''
	const drop: DropOption[] = [
		...(special ? [{ value: '@special', label: special.label }] : !current ? [{ value: '', label: 'Choose a model' }] : []),
		...options.map(o => ({ value: key(o.selection), label: o.name, mark: <ProviderLogo providerName={o.selection.providerName} size={14} /> })),
	]
	return <Dropdown testId={testId} label={`Model for ${feature}`} width={width} value={value} options={drop} placeholder={emptyMessage?.message ?? 'Choose a model'}
		onChange={v => {
			if (v === '@special') { special?.onPick(); return }
			const o = options.find(x => key(x.selection) === v)
			if (o) { settings.setModelSelectionOfFeature(feature, o.selection); onModel?.() }
		}} />
}
