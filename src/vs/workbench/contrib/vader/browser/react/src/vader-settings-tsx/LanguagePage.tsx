/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React from 'react'
import { useAccessor, useSettingsState } from '../util/services.js'
import { UiLanguage, uiLanguages } from '../../../../common/vaderSettingsTypes.js'
import { LANGUAGE_NAMES } from '../util/i18n/translator.js'
import { Group, Line, PageHead } from './ui.js'

// Language: the language of Vader's own screens. The change is made on the spot, in every screen that is open. The names of the languages are written in each language and are
// never translated (a person who cannot read the current language can still find their own).

const Radio = ({ on }: { on: boolean }) => <span className='r' style={{ width: 16, height: 16, borderRadius: 8, border: '1px solid ' + (on ? 'var(--t1)' : 'var(--t4)'), justifyContent: 'center', flex: 'none' }}>{on ? <span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--t1)' }} /> : null}</span>

const ENGLISH_NAME: Record<UiLanguage, string> = { en: 'English', ar: 'Arabic', zh: 'Chinese' }

export const LanguagePage = () => {
	const accessor = useAccessor()
	const settings = accessor.get('IVaderSettingsService')
	const current = useSettingsState().globalSettings.uiLanguage ?? 'en'
	return <div data-testid='vader-settings-language'>
		<PageHead title='Language' desc='The language of Vader&rsquo;s screens. The editor around them, and what you and the agent write, stay as they are.' />
		<Group title='Language of the screens' first>
			<div role='radiogroup' aria-label='Language of the screens'>
				{uiLanguages.map((id, i) => <button key={id} role='radio' aria-checked={current === id} data-testid={`vader-language-${id}`} lang={id} data-i18n-skip className='r' onClick={() => { void settings.setGlobalSetting('uiLanguage', id) }}
					style={{ width: '100%', gap: 14, minHeight: 44, padding: '8px 2px', borderTop: i === 0 ? '1px solid var(--ln)' : undefined, borderBottom: '1px solid var(--ln)', textAlign: 'start' }}>
					<Radio on={current === id} />
					<span className='c fl' style={{ gap: 1, minWidth: 0 }}><span className='t1' style={{ fontWeight: 500, fontSize: 14 }}>{LANGUAGE_NAMES[id]}</span>{id !== 'en' ? <span className='hint'>{ENGLISH_NAME[id]}</span> : null}</span>
				</button>)}
			</div>
			<Line title='Arabic is written from right to left' detail='Choosing Arabic turns the screens around, so the first thing you read is on the right. Code, file names and paths stay left to right.' />
		</Group>
	</div>
}
