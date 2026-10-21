/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useState } from 'react'
import { URI } from '../../../../../../../base/common/uri.js'
import { useAccessor, useSettingsState } from '../util/services.js'
import { Group, Line, PageHead, Switch } from './ui.js'
import { REPO_URL } from './PrivacyPage.js'
import { UpdateCards } from './UpdateCards.js'

// About and updates (boards R29 and S11): the version, what it is built on, and the update check. A check says its result here; a newer release is offered with its
// download, progress and restart (UpdateCards.tsx). Nothing is installed without a click.

export const AboutPage = () => {
	const accessor = useAccessor()
	const product = accessor.get('IProductService')
	const updates = accessor.get('IVaderUpdateService')
	const opener = accessor.get('IOpenerService')
	const settings = accessor.get('IVaderSettingsService')
	const auto = useSettingsState().globalSettings.autoCheckUpdates
	const [checking, setChecking] = useState(false)
	const [result, setResult] = useState<{ message: string, at: number } | undefined>()
	const open = (u: string) => { void opener.open(URI.parse(u)) }
	const check = () => {
		setChecking(true)
		void updates.check(true).then(r => setResult({ message: r?.message ?? 'Vader could not look for updates just now.', at: Date.now() }), () => setResult({ message: 'Vader could not look for updates just now.', at: Date.now() })).finally(() => setChecking(false))
	}
	const version = product.vaderVersion ?? 'unknown'

	return <div data-testid='vader-settings-about'>
		<PageHead title='Vader' desc={<span data-testid='vader-settings-version'>Version {version} · built on VS Code {product.version}</span>} right={<button className='gb' data-testid='vader-about-check' disabled={checking} onClick={check}>{checking ? 'Checking\u2026' : 'Check for updates'}</button>} />
		<Group title='This build' first>
			<Line first title='Version' right={<span className='mo t2'>{version}</span>} />
			<Line title='Commit' right={<span className='mo t2'>{product.commit ? product.commit.slice(0, 10) : 'development build'}</span>} />
			<Line title='Built' right={<span className='t2'>{product.date ? new Date(product.date).toLocaleString() : 'not recorded'}</span>} />
		</Group>
		<Group title='Updates'>
			<Line first title='Check for new releases automatically' lockKey='autoCheckUpdates' detail='Looks at the public list of Vader releases and sends nothing about you. Off by default.' right={<Switch on={auto} label='Check for new releases automatically' testId='vader-settings-about-autocheck' onChange={v => settings.setGlobalSetting('autoCheckUpdates', v)} />} />
			<Line testId='vader-about-result' title={result ? result.message : `Vader ${version}`} detail={checking ? 'Looking at the public list of releases\u2026' : result ? 'Checked just now. Nothing is installed without your click.' : 'Not checked yet in this session. Nothing is installed without your click.'} right={<span className='r' style={{ gap: 6 }}><button className='tx' data-testid='vader-about-releases' onClick={() => open(`${REPO_URL}/releases`)}>All releases</button><button className='gb' data-testid='vader-about-check-row' disabled={checking} onClick={check}>Check for updates</button></span>} />
		</Group>
		<UpdateCards current={version} openUrl={open} />
		<Group title='Help'>
			<Line first testId='vader-about-changes' title='What changed in this version' right={<button className='tx' onClick={() => open(`${REPO_URL}/blob/main/CHANGELOG.md`)}>Open</button>} />
			<Line title='Report an issue' right={<button className='tx' onClick={() => open(`${REPO_URL}/issues`)}>Open</button>} />
			<Line title='Source code' right={<button className='tx' onClick={() => open(REPO_URL)}>GitHub</button>} />
			<Line title='Licences' detail='Apache 2.0, and the open-source parts it is built on' right={<span className='r' style={{ gap: 4 }}><button className='tx' onClick={() => open(`${REPO_URL}/blob/main/LICENSE.txt`)}>Licence</button><button className='tx' onClick={() => open(`${REPO_URL}/blob/main/ThirdPartyNotices.txt`)}>Third-party notices</button></span>} />
		</Group>
		<p className='hint' style={{ margin: '22px 0 0', maxWidth: 560, lineHeight: 1.6 }}>Built on the open-source VS Code workbench (Microsoft, MIT) and on Void by Glass Devtools, Inc. (Apache 2.0). It runs its agent on the Cline SDK (Apache 2.0).</p>
	</div>
}
