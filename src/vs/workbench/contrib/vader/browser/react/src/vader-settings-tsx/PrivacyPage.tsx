/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React from 'react'
import { URI } from '../../../../../../../base/common/uri.js'
import { useAccessor, useSettingsState } from '../util/services.js'
import { Group, Line, PageHead, Switch } from './ui.js'

// Privacy and network (board R20): what Vader sends over the network, and to whom. The list of who it can contact is the whole list; nothing else is contacted at
// start-up (docs/integrations/privacy.md says how that is checked).

export const REPO_URL = 'https://github.com/qwzx4893-stack/Vader'

export const PrivacyPage = () => {
	const accessor = useAccessor()
	const settings = accessor.get('IVaderSettingsService')
	const opener = accessor.get('IOpenerService')
	const auto = useSettingsState().globalSettings.autoCheckUpdates

	const contacts: { who: string, when: string, host: string }[] = [
		{ who: 'Your model provider', when: 'Only when you chat or fetch the model list with a key you set. Your code goes to that provider and nowhere else.', host: 'the provider you configure, or localhost' },
		{ who: 'Extension registry', when: 'When you look at extensions in Add-ons or the editor, or install one.', host: 'open-vsx.org' },
		{ who: 'Add-ons lists', when: 'When you open Add-ons or search there, and when the agent searches for a skill or a server. Only the search words are sent, or a repository’s public file list. Nothing from your project.', host: 'api.github.com, raw.githubusercontent.com, registry.modelcontextprotocol.io, skills.sh, registry.smithery.ai, registry.npmjs.org, api-skillnet.openkg.cn' },
		{ who: 'Release check', when: auto ? 'Now on: a quiet check for a newer release every few hours, and the Check for updates button.' : 'Only when you press "Check for updates", or if you turn the automatic check on.', host: 'api.github.com' },
		{ who: 'Connected agents you add', when: 'Only after you press Install, or send the agent a message. The vendor’s own program then talks to the vendor with your account. Vader does not see the sign-in.', host: 'the vendor of that agent' },
		{ who: 'Pages the agent opens', when: 'Only when it uses its browser, and only sites it was told to visit.', host: 'the sites in question' },
	]

	return <div data-testid='vader-settings-privacy'>
		<PageHead title='Privacy and network' desc='What Vader sends over the network, and to whom. Nothing else is contacted at start-up.' />
		<div className='r' style={{ gap: 40, marginBottom: 6 }}>
			{[['No analytics', 'no crash reporter, no account'], ['Keys stay here', 'sent only to their provider'], ['Your code and chats', 'leave only to the model you chose']].map(([t, d]) => <div key={t} className='c' style={{ gap: 1 }}><span className='t1' style={{ fontWeight: 600 }}>{t}</span><span className='hint'>{d}</span></div>)}
		</div>

		<Group title='Who Vader can contact'>
			<div data-testid='vader-settings-contacts'>
				{contacts.map((c, i) => <Line key={c.who} first={i === 0} testId='vader-privacy-contact' title={c.who} detail={c.when} right={<span className='mo t3' style={{ maxWidth: 300, textAlign: 'right', overflowWrap: 'anywhere' }}>{c.host}</span>} />)}
			</div>
		</Group>

		<Group title='Updates'>
			<Line first title='Check for new releases automatically' lockKey='autoCheckUpdates' detail='Looks at the public list of Vader releases and sends nothing about you. Off by default.' right={<Switch on={auto} label='Check for new releases automatically' testId='vader-settings-privacy-autocheck' onChange={v => settings.setGlobalSetting('autoCheckUpdates', v)} />} />
		</Group>
		<div style={{ paddingTop: 14 }}><button className='gb' data-testid='vader-privacy-verified' onClick={() => { void opener.open(URI.parse(`${REPO_URL}/blob/main/docs/integrations/privacy.md`)) }}>How this is verified</button></div>
	</div>
}
