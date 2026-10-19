/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useState } from 'react'
import { useAccessor, useSettingsState } from '../util/services.js'
import { FeatureModelSelect } from './FeatureModelSelect.js'
import { defaultGlobalSettings } from '../../../../common/vaderSettingsTypes.js'
import { Group, Line, PageHead, Switch } from './ui.js'

// Editor (board R27): the help that appears inside a file, and which model gives it. Each model choice is the real feature setting; "Same as chat" is the real
// sync switch of that feature, not a copy of the chat's model.

export const EditorPage = () => {
	const accessor = useAccessor()
	const settings = accessor.get('IVaderSettingsService')
	const g = useSettingsState().globalSettings
	const set = (k: any, v: any) => settings.setGlobalSetting(k, v)
	const [confirmReset, setConfirmReset] = useState(false)
	const RESET: (keyof typeof defaultGlobalSettings)[] = ['enableAutocomplete', 'showInlineSuggestions', 'syncApplyToChat', 'syncSCMToChat', 'enableFastApply', 'includeToolLintErrors']
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

		<div style={{ marginTop: 30 }}>
			{confirmReset ? <div className='c' data-testid='vader-editor-reset-confirm' role='alertdialog' style={{ gap: 10, padding: '16px 18px', border: '1px solid var(--ln2)', borderRadius: 12, background: 'var(--g2)', maxWidth: 440 }}>
				<span className='t1' style={{ fontWeight: 600, fontSize: 15 }}>Reset Editor settings?</span>
				<span className='t2' style={{ lineHeight: 1.55 }}>Suggestions, Ctrl K, applying and commit messages go back to how a new install has them. The models you chose, your keys and your chats are not touched.</span>
				<span className='r' style={{ gap: 8, justifyContent: 'flex-end' }}><button className='gb' onClick={() => setConfirmReset(false)}>Cancel</button><button className='pb' data-testid='vader-editor-reset-do' onClick={() => { for (const k of RESET) set(k, defaultGlobalSettings[k]); setConfirmReset(false) }}>Reset</button></span>
			</div> : <button className='tx' style={{ padding: 0 }} data-testid='vader-editor-reset' onClick={() => setConfirmReset(true)}>Reset these settings</button>}
		</div>
	</div>
}
