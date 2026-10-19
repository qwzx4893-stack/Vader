/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React from 'react'
import { useAccessor, useSettingsState } from '../util/services.js'
import { ProviderLogo } from '../util/ProviderLogo.js'
import { FeatureName, ModelSelection, modelSelectionsEqual } from '../../../../common/vaderSettingsTypes.js'
import { modelFilterOfFeatureName } from '../../../../common/vaderSettingsService.js'

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
	if (options.length === 0 && !special) return <span className='t3' data-testid={testId} style={{ maxWidth: width, textAlign: 'right' }}>{emptyMessage?.message ?? 'No model is set up for this yet'}</span>
	const value = special?.active ? '' : current ? key(current) : ''
	return <span className='fld r' style={{ gap: 8, width }}>{!special?.active && current ? <ProviderLogo providerName={current.providerName} size={14} /> : null}
		<select className='fl' data-testid={testId} aria-label={`Model for ${feature}`} value={value} style={{ background: 'transparent', color: 'var(--t1)', border: 0, outline: 0, minWidth: 0 }}
			onChange={e => {
				if (e.target.value === '') { special?.onPick(); return }
				const o = options.find(x => key(x.selection) === e.target.value)
				if (o) { settings.setModelSelectionOfFeature(feature, o.selection); onModel?.() }
			}}>
			{special ? <option value='' style={{ background: '#19191c' }}>{special.label}</option> : !current ? <option value='' style={{ background: '#19191c' }}>Choose a model</option> : null}
			{options.map(o => <option key={key(o.selection)} value={key(o.selection)} style={{ background: '#19191c' }}>{o.name}</option>)}
		</select></span>
}
