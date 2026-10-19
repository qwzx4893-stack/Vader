/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useState } from 'react'
import { URI } from '../../../../../../../base/common/uri.js'
import { useAccessor, useSettingsState } from '../util/services.js'
import { Group, Line, PageHead, Switch } from './ui.js'
import { REPO_URL } from './PrivacyPage.js'

// About and updates (board R29): the version, what it is built on, and the update check. Vader does not update itself: it can tell you a newer release is on GitHub,
// and you download and install it. The result of a check is the message the app shows in the corner; this page says only that the check was asked for.

export const AboutPage = () => {
	const accessor = useAccessor()
	const product = accessor.get('IProductService')
	const commands = accessor.get('ICommandService')
	const opener = accessor.get('IOpenerService')
	const settings = accessor.get('IVaderSettingsService')
	const auto = useSettingsState().globalSettings.autoCheckUpdates
	const [asked, setAsked] = useState<number | undefined>()
	const open = (u: string) => { void opener.open(URI.parse(u)) }
	const check = () => { setAsked(Date.now()); void commands.executeCommand('vader.vaderCheckUpdate') }
	const version = product.vaderVersion ?? 'unknown'

	return <div data-testid='vader-settings-about'>
		<PageHead title='Vader' desc={<span data-testid='vader-settings-version'>Version {version} · built on VS Code {product.version}</span>} right={<button className='gb' data-testid='vader-about-check' onClick={check}>Check for updates</button>} />
		<Group title='This build' first>
			<Line first title='Version' right={<span className='mo t2'>{version}</span>} />
			<Line title='Commit' right={<span className='mo t2'>{product.commit ? product.commit.slice(0, 10) : 'development build'}</span>} />
			<Line title='Built' right={<span className='t2'>{product.date ? new Date(product.date).toLocaleString() : 'not recorded'}</span>} />
		</Group>
		<Group title='Updates'>
			<Line first title='Check for new releases automatically' detail='Looks at the public list of Vader releases and sends nothing about you. Off by default.' right={<Switch on={auto} label='Check for new releases automatically' testId='vader-settings-about-autocheck' onChange={v => settings.setGlobalSetting('autoCheckUpdates', v)} />} />
			<Line title='Vader does not update itself' detail={asked ? 'The check was asked for. Its result is the message in the corner of the window.' : 'It can tell you when a newer release is on GitHub. You download and install it.'} right={<button className='tx' data-testid='vader-about-releases' onClick={() => open(`${REPO_URL}/releases`)}>All releases</button>} />
		</Group>
		<Group title='Help'>
			<Line first testId='vader-about-changes' title='What changed in this version' right={<button className='tx' onClick={() => open(`${REPO_URL}/blob/main/CHANGELOG.md`)}>Open</button>} />
			<Line title='Report an issue' right={<button className='tx' onClick={() => open(`${REPO_URL}/issues`)}>Open</button>} />
			<Line title='Source code' right={<button className='tx' onClick={() => open(REPO_URL)}>GitHub</button>} />
			<Line title='Licences' detail='Apache 2.0, and the open-source parts it is built on' right={<span className='r' style={{ gap: 4 }}><button className='tx' onClick={() => open(`${REPO_URL}/blob/main/LICENSE.txt`)}>Licence</button><button className='tx' onClick={() => open(`${REPO_URL}/blob/main/ThirdPartyNotices.txt`)}>Third-party notices</button></span>} />
		</Group>
		<p className='hint' style={{ margin: '22px 0 0', maxWidth: 560, lineHeight: 1.6 }}>Built on the open-source VS Code workbench (Microsoft, MIT) and on Void by Glass Devtools, Inc. (Apache 2.0). It runs its agent on the Cline SDK (Apache 2.0).</p>
	</div>
}
