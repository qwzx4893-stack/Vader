/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react'
import { URI } from '../../../../../../../base/common/uri.js'
import { useAccessor } from '../util/services.js'
import { Group, Line, PageHead, Switch } from './ui.js'
import { REPO_URL } from './PrivacyPage.js'

// Editor extensions: Vader runs VS Code extensions (themes, languages, formatters, debuggers). Where they come from, what is not there, and whether signed ones are
// required. Skills, MCP servers and agents are in Add-ons; this is only the editor's own extensions.

export const ExtensionsPage = () => {
	const accessor = useAccessor()
	const commands = accessor.get('ICommandService')
	const opener = accessor.get('IOpenerService')
	const config = accessor.get('IConfigurationService')
	const product = accessor.get('IProductService')
	const host = (() => { try { return new URL(product.extensionsGallery?.serviceUrl ?? '').host } catch { return null } })()
	const [signed, setSigned] = useState<boolean>(!!config.getValue('extensions.verifySignature'))
	useEffect(() => {
		const d = config.onDidChangeConfiguration((e: { affectsConfiguration: (k: string) => boolean }) => { if (e.affectsConfiguration('extensions.verifySignature')) setSigned(!!config.getValue('extensions.verifySignature')) })
		return () => d.dispose()
	}, [config])

	return <div data-testid='vader-settings-extensions'>
		<PageHead title='Editor extensions' desc='Vader runs VS Code extensions: themes, languages, formatters, debuggers and more.' />
		<Group title='Where they come from' first>
			<Line first testId='vader-settings-gallery' title='Marketplace' detail='Open VSX, the open extension registry' right={<span className='mo t2'>{host ?? 'not configured'}</span>} />
			<Line title='Not available' detail='Extensions that Microsoft publishes only on its own Marketplace (for example Remote-SSH and the C/C++ pack) are not on Open VSX. The guide lists alternatives, or install a .vsix you trust.' />
		</Group>
		<div className='r' style={{ gap: 10, flexWrap: 'wrap', margin: '18px 0 6px' }}>
			<button className='pb' data-testid='vader-ext-browse' onClick={() => { void commands.executeCommand('workbench.view.extensions') }}>Browse extensions</button>
			<button className='gb' data-testid='vader-ext-vsix' onClick={() => { void commands.executeCommand('workbench.extensions.action.installVSIX') }}>Install from VSIX...</button>
			<button className='gb' data-testid='vader-ext-guide' onClick={() => { void opener.open(URI.parse(`${REPO_URL}/blob/main/docs/EXTENSIONS.md`)) }}>Extensions guide</button>
		</div>
		<Group title='Safety'>
			<Line first title='Require signed extensions' detail='Off by default: Open VSX does not sign extensions with the Microsoft certificate chain this check needs, so turning it on makes extensions from Open VSX fail to install.' right={<Switch on={signed} label='Require signed extensions' testId='vader-settings-verify-signature' onChange={v => { void config.updateValue('extensions.verifySignature', v) }} />} />
		</Group>
	</div>
}
