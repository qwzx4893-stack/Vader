/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React from 'react'
import { useAccessor, useSettingsState } from '../util/services.js'
import { ProviderLogo } from '../util/ProviderLogo.js'
import { FeatureName, ModelSelection, modelSelectionsEqual } from '../../../../common/vaderSettingsTypes.js'
import { modelFilterOfFeatureName } from '../../../../common/vaderSettingsService.js'
import { Group, Line, PageHead, Switch } from './ui.js'

// Editor (board R27): the help that appears inside a file, and which model gives it. Each model choice is the real feature setting; "Same as chat" is the real
// sync switch of that feature, not a copy of the chat's model.

/** the models a feature can use, as a list; the choice is the feature's own setting */
const FeatureModelSelect = ({ feature, testId }: { feature: FeatureName, testId: string }) => {
	const accessor = useAccessor()
	const settings = accessor.get('IVaderSettingsService')
	const state = useSettingsState()
	const { filter, emptyMessage } = modelFilterOfFeatureName[feature]
	const options = state._modelOptions.filter((o: { selection: ModelSelection }) => filter(o.selection, { chatMode: state.globalSettings.chatMode, overridesOfModel: state.overridesOfModel }))
	const chosen: ModelSelection | null = state.modelSelectionOfFeature[feature]
	const key = (s: ModelSelection) => `${s.providerName}/${s.modelName}`
	if (options.length === 0) return <span className='t3' data-testid={testId}>{emptyMessage?.message ?? 'No model is set up for this yet'}</span>
	const current = chosen && options.some((o: { selection: ModelSelection }) => modelSelectionsEqual(o.selection, chosen)) ? chosen : undefined
	return <span className='fld r' style={{ gap: 8, width: 250 }}>{current ? <ProviderLogo providerName={current.providerName} size={14} /> : null}
		<select className='fl' data-testid={testId} aria-label={`Model for ${feature}`} value={current ? key(current) : ''} style={{ background: 'transparent', color: 'var(--t1)', border: 0, outline: 0, minWidth: 0 }}
			onChange={e => { const o = options.find((x: { selection: ModelSelection }) => key(x.selection) === e.target.value); if (o) settings.setModelSelectionOfFeature(feature, o.selection) }}>
			{!current ? <option value='' style={{ background: '#19191c' }}>Choose a model</option> : null}
			{options.map((o: { selection: ModelSelection, name: string }) => <option key={key(o.selection)} value={key(o.selection)} style={{ background: '#19191c' }}>{o.name}</option>)}
		</select></span>
}

export const EditorPage = () => {
	const accessor = useAccessor()
	const settings = accessor.get('IVaderSettingsService')
	const g = useSettingsState().globalSettings
	const set = (k: any, v: any) => settings.setGlobalSetting(k, v)
	return <div data-testid='vader-settings-editor'>
		<PageHead title='Editor' desc='Help that appears inside a file, and which model gives it.' />

		<Group title='Suggestions while you type' first>
			<Line first title='Suggest the next lines' detail='Tab accepts, Esc dismisses. Off by default. It works with models that can fill in the middle of a file.' right={<Switch on={g.enableAutocomplete} label='Suggest the next lines' testId='vader-editor-autocomplete' onChange={v => set('enableAutocomplete', v)} />} />
			{g.enableAutocomplete ? <Line title='Model for suggestions' detail='A fast model works best here' right={<FeatureModelSelect feature='Autocomplete' testId='vader-editor-model-autocomplete' />} /> : null}
			<Line title='Show Add to chat and Edit next to selected code' right={<Switch on={g.showInlineSuggestions} label='Show Add to chat and Edit next to selected code' testId='vader-editor-selection' onChange={v => set('showInlineSuggestions', v)} />} />
		</Group>

		<Group title='Edit here (Ctrl K) and applying changes'>
			<Line first title='Use the chat model for applying changes' detail='Off lets applying use its own model' right={<Switch on={g.syncApplyToChat} label='Use the chat model for applying changes' testId='vader-editor-sync-apply' onChange={v => set('syncApplyToChat', v)} />} />
			{!g.syncApplyToChat ? <Line title='Model for Ctrl K and applying' right={<FeatureModelSelect feature='Apply' testId='vader-editor-model-apply' />} /> : null}
			<Line title='Rewrite only the lines that change' detail='Faster and cheaper. Turn off to rewrite the whole file each time.' right={<Switch on={g.enableFastApply} label='Rewrite only the lines that change' testId='vader-editor-fast-apply' onChange={v => set('enableFastApply', v)} />} />
		</Group>

		<Group title='What the agent sees'>
			<Line first title='Include errors and warnings after an edit' detail='The agent reads the editor&rsquo;s problems for the file it just changed' right={<Switch on={g.includeToolLintErrors} label='Include errors and warnings after an edit' testId='vader-editor-lint' onChange={v => set('includeToolLintErrors', v)} />} />
		</Group>

		<Group title='Source control'>
			<Line first title='Write the commit message with the chat model' detail='The button next to the message box' right={<Switch on={g.syncSCMToChat} label='Write the commit message with the chat model' testId='vader-editor-sync-scm' onChange={v => set('syncSCMToChat', v)} />} />
			{!g.syncSCMToChat ? <Line title='Model for commit messages' right={<FeatureModelSelect feature='SCM' testId='vader-editor-model-scm' />} /> : null}
		</Group>
	</div>
}
